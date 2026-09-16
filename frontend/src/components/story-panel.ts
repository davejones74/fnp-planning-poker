import { el, clear, showToast, inputValue } from "./dom.ts";
import { configApi, type ClientConfig } from "../api/config.ts";
import { prepareImport } from "../import/index.ts";
import type { ImportResult } from "../import/import-types.ts";
import type { RoomState } from "../state/room-state.ts";

type TabId = "active" | "completed" | "all";

type StoryExtra = { key?: string; url?: string };
type SaveStory = (
  title: string,
  description: string,
  extra?: StoryExtra,
) => Promise<void> | void;

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
  onSave: SaveStory,
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
  onSave: SaveStory,
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
      list.append(renderImportButton(list, onSave));
    }
    return list;
  }

  const story = state.room.story;
  if (!story) return list;

  const colon = story.title.indexOf(":");
  const key = colon >= 0 ? story.title.slice(0, colon).trim() : "Story";
  const title = colon >= 0 ? story.title.slice(colon + 1).trim() : story.title;

  const keyEl = story.url
    ? el("a", {
        class: "story-key",
        href: story.url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: key,
      })
    : el("span", { class: "story-key", text: key });

  const row = el("article", { class: "story-row selected" });
  row.append(keyEl, el("span", { class: "story-title", text: title }));
  if (story.description) {
    row.append(el("p", { class: "story-desc", text: story.description }));
  }
  list.append(row);

  if (state.isFacilitator()) {
    list.append(renderEditButton(list, state, onSave));
    list.append(renderImportButton(list, onSave));
  }

  return list;
}

function renderAddButton(
  list: HTMLElement,
  state: RoomState,
  onSave: SaveStory,
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
  onSave: SaveStory,
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
  onSave: SaveStory,
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

function renderImportButton(
  list: HTMLElement,
  onSave: SaveStory,
): HTMLElement {
  const button = el("button", {
    class: "ghost story-edit-btn",
    type: "button",
    text: "Import stories",
  });
  button.addEventListener("click", () => {
    button.remove();
    list.append(openImportDialog(onSave));
  });
  return button;
}

function openImportDialog(onSave: SaveStory): HTMLElement {
  const dialog = el("div", { class: "jira-dialog" });
  const title = el("p", { class: "jira-dialog-title", text: "Import stories" });
  const hint = el("p", {
    class: "jira-hint",
    text: "Choose a Jira CSV or RSS export.",
  });

  const drop = el("label", { class: "import-drop", text: "Choose file…" });
  const file = el("input", {
    type: "file",
    accept: ".csv,.xml,.rss,.txt,text/csv,text/xml,application/xml",
  }) as HTMLInputElement;
  file.hidden = true;
  drop.append(file);

  const note = el("p", {
    class: "jira-hint",
    text: "Live Jira fetch is disabled (no credentials configured). Issue keys link to the configured Jira site via JIRA_HOST and KEY.",
  });

  const buttons = el("div", { class: "editor-buttons" });
  const cancelButton = el("button", { type: "button", class: "ghost", text: "Close" });
  buttons.append(cancelButton);
  dialog.append(title, hint, drop, note, buttons);

  const close = () => dialog.remove();
  cancelButton.addEventListener("click", close);

  let config: ClientConfig = { jiraHost: null, jiraProjectKey: null };
  void configApi
    .client()
    .then((loaded) => {
      config = loaded;
    })
    .catch(() => {});

  function renderStories(result: ImportResult): void {
    clear(dialog);
    const heading = el("p", {
      class: "jira-dialog-title",
      text: result.stories.length > 0 ? "Pick a story to import" : "No stories found",
    });
    dialog.append(heading);

    const storyList = el("div", { class: "jira-story-list" });
    if (result.stories.length > 0) {
      for (const story of result.stories) {
        const item = el("button", {
          type: "button",
          class: "jira-story",
          text: story.title,
        });
        item.title = story.url ?? "";
        item.addEventListener("click", async () => {
          item.disabled = true;
          try {
            await onSave(story.title, story.description, {
              key: story.key,
              url: story.url,
            });
            close();
          } catch {
            item.disabled = false;
          }
        });
        storyList.append(item);
      }
    } else {
      const message =
        result.source === "xml"
          ? "This RSS looks like a filter activity/comment feed, not the issue list. Use the CSV export from Jira instead."
          : "No usable issues were found in the CSV.";
      storyList.append(el("p", { class: "story-empty", text: message }));
    }
    if (result.skipped > 0) {
      storyList.append(
        el("p", {
          class: "jira-hint",
          text: `Skipped ${result.skipped} row/item${result.skipped === 1 ? "" : "s"} with no usable issue key.`,
        }),
      );
    }
    dialog.append(storyList);

    const done = el("button", { type: "button", class: "ghost", text: "Close" });
    done.addEventListener("click", close);
    dialog.append(done);
  }

  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    hint.textContent = "Reading " + selected.name + "…";
    void selected
      .text()
      .then((text) => {
        const result = prepareImport(text, config);
        renderStories(result);
      })
      .catch((err: unknown) => {
        hint.textContent =
          "Import failed: " +
          (err instanceof Error ? err.message : "could not read the file.");
      });
  });

  return dialog;
}