import { el, clear, inputValue, showToast } from "./dom.ts";
import type { RoomState } from "../state/room-state.ts";

type TabId = "active" | "completed" | "all";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "active", label: "Active Stories" },
  { id: "completed", label: "Completed Stories" },
  { id: "all", label: "All Stories" },
];

function tabCount(tab: TabId, hasStory: boolean): number {
  if (tab === "completed") return 0;
  return hasStory ? 1 : 0;
}

/** Visual-only story panel. Backed by the current round's story for now;
 *  structured as a list so a future Jira/RSS feed can supply a Story[]. */
export function renderStoryPanel(
  root: HTMLElement,
  state: RoomState,
  onSave: (title: string, description: string) => Promise<void> | void,
): void {
  let tab: TabId = "active";

  const haveStory = Boolean(state.room.story);

  function render(): void {
    clear(root);

    const panel = el("section", { class: "story-panel" });

    const tabs = el("div", { class: "story-tabs", role: "tablist" });
    for (const def of TABS) {
      const count = tabCount(def.id, haveStory);
      const button = el("button", {
        type: "button",
        class: "story-tab" + (def.id === tab ? " active" : ""),
        role: "tab",
        "aria-selected": def.id === tab ? "true" : "false",
      });
      button.append(el("span", { class: "story-tab-label", text: def.label }));
      const badge = el("span", {
        class: "tab-count" + (count > 0 ? " positive" : ""),
        text: String(count),
      });
      button.append(badge);
      button.addEventListener("click", () => {
        tab = def.id;
        render();
      });
      tabs.append(button);
    }
    panel.append(tabs);

    panel.append(renderList(state, tab, onSave, haveStory));
    root.append(panel);
  }

  render();
}

function renderList(
  state: RoomState,
  tab: TabId,
  onSave: (title: string, description: string) => Promise<void> | void,
  haveStory: boolean,
): HTMLElement {
  const list = el("div", { class: "story-list" });

  if (tab === "completed") {
    list.append(el("p", { class: "story-empty", text: "No completed stories." }));
    return list;
  }

  if (!haveStory) {
    list.append(el("p", { class: "story-empty", text: "No active story yet." }));
    if (state.isFacilitator()) {
      list.append(renderAddButton(list, state, onSave));
    }
    return list;
  }

  const story = state.room.story;
  if (!story) return list;

  const colon = story.title.indexOf(":");
  const key = colon >= 0 ? story.title.slice(0, colon).trim() : "Story";
  const title = colon >= 0 ? story.title.slice(colon + 1).trim() : story.title;

  const row = el("article", { class: "story-row selected" });
  row.append(
    el("span", { class: "story-key", text: key }),
    el("span", { class: "story-title", text: title }),
  );
  if (story.description) {
    row.append(el("p", { class: "story-desc", text: story.description }));
  }
  list.append(row);

  if (state.isFacilitator()) {
    list.append(renderEditButton(list, state, onSave));
  }

  return list;
}

function renderAddButton(
  list: HTMLElement,
  state: RoomState,
  onSave: (title: string, description: string) => Promise<void> | void,
): HTMLElement {
  const button = el("button", { class: "ghost story-edit-btn", type: "button", text: "Add story" });
  button.addEventListener("click", () => {
    button.remove();
    list.append(renderEditor(state, onSave));
  });
  return button;
}

function renderEditButton(
  list: HTMLElement,
  state: RoomState,
  onSave: (title: string, description: string) => Promise<void> | void,
): HTMLElement {
  const button = el("button", { class: "ghost story-edit-btn", type: "button", text: "Edit story" });
  button.addEventListener("click", () => {
    button.remove();
    list.append(renderEditor(state, onSave));
  });
  return button;
}

function renderEditor(
  state: RoomState,
  onSave: (title: string, description: string) => Promise<void> | void,
): HTMLElement {
  const form = el("form", { class: "story-editor" });
  const story = state.room.story;

  const titleField = el("div", { class: "form-field" }, el("label", { text: "Title (e.g. JIRA-123)" }));
  const titleInput = el("input", {
    type: "text",
    maxLength: "100",
    placeholder: "JIRA-123",
  }) as HTMLInputElement;
  titleInput.value = story?.title ?? "";
  titleField.append(titleInput);
  form.append(titleField);

  const descField = el("div", { class: "form-field" }, el("label", { text: "Description" }));
  const descInput = el("textarea", { maxLength: "500", placeholder: "What are we estimating?" }) as HTMLTextAreaElement;
  descInput.value = story?.description ?? "";
  descField.append(descInput);
  form.append(descField);

  const buttons = el("div", { class: "editor-buttons" });
  const saveButton = el("button", { type: "submit", text: "Save story" });
  const cancelButton = el("button", { type: "button", class: "ghost", text: "Cancel" });
  buttons.append(saveButton, cancelButton);
  form.append(buttons);

  saveButton.addEventListener("click", async (e) => {
    e.preventDefault();
    const title = inputValue(titleInput);
    if (!title) {
      showToast("Story title is required.", true);
      titleInput.focus();
      return;
    }
    saveButton.disabled = true;
    await onSave(title, descInput.value);
  });

  cancelButton.addEventListener("click", () => form.remove());
  return form;
}