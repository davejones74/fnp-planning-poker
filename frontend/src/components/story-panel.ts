import { el, clear, showToast, inputValue } from "./dom.ts";
import { configApi, type ClientConfig } from "../api/config.ts";
import { roomsApi, type ImportSummary, type StoryPayload } from "../api/rooms.ts";
import { prepareImport } from "../import/index.ts";
import type { ImportResult } from "../import/import-types.ts";
import type { RoomState } from "../state/room-state.ts";
import type { SessionStory } from "../../../shared/types.ts";
import {
  formatCompletedTime,
  sessionProgress,
  statusLabel,
} from "../util/session.ts";

type TabId = "how" | "todo" | "done";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "how", label: "HOW IT WORKS" },
  { id: "todo", label: "STORIES TO ESTIMATE" },
  { id: "done", label: "COMPLETED" },
];

const KANBAN_URL =
  "https://hmcts.atlassian.net/jira/software/c/projects/PAY/boards/1124";
const FILTER_URL = "https://hmcts.atlassian.net/issues/?filter=18527";
const GUIDE_URL =
  "https://hmcts.atlassian.net/wiki/spaces/DTSFP/pages/278333270/Estimations#Ticket-T-Shirt-Sizes";

const SIZING: Array<[string, string]> = [
  ["XS", "0.5–1 day"],
  ["S", "2–4 days"],
  ["M", "5–10 days"],
  ["L", "11–21 days"],
  ["XL", "22–28 days"],
  ["XXL", "No day range defined"],
  ["?", "Unknown — discuss in the room"],
];

interface PanelUiState {
  tab: TabId;
  selectedKey: string | null;
}

const uiByRoot = new WeakMap<HTMLElement, PanelUiState>();

/**
 * Renders the F&P story panel (how it works / stories to estimate / completed).
 * UI state (active tab, selected story) is kept per panel root so it survives
 * re-renders. Mutations go through roomsApi and then `onChanged()` (the room
 * page's refresh) to re-sync from the server.
 */
export function renderStoryPanel(
  root: HTMLElement,
  state: RoomState,
  onChanged: () => Promise<void> | void,
): void {
  const prior = uiByRoot.get(root);
  const ui: PanelUiState = prior ?? (() => {
    const fresh: PanelUiState = {
      tab: state.room.stories.length > 0 ? "todo" : "how",
      selectedKey: null,
    };
    uiByRoot.set(root, fresh);
    return fresh;
  })();

  function render(): void {
    clear(root);
    root.append(buildPanel());
  }

  function buildPanel(): HTMLElement {
    const panel = el("section", { class: "story-panel" });
    panel.append(tabsNode());

    const { estimated, total } = sessionProgress(state.room.stories);
    if (total > 0) panel.append(progressNode(estimated, total));

    if (ui.tab === "how") {
      panel.append(howNode());
    } else if (ui.tab === "todo") {
      panel.append(todoNode());
    } else {
      panel.append(doneNode());
    }
    return panel;
  }

  function tabsNode(): HTMLElement {
    const tabs = el("div", { class: "story-tabs", role: "tablist" });
    for (const def of TABS) {
      const button = el("button", {
        type: "button",
        class: "story-tab" + (def.id === ui.tab ? " active" : ""),
        role: "tab",
        "aria-selected": def.id === ui.tab ? "true" : "false",
        "aria-controls": "story-tab-" + def.id,
      });
      button.append(el("span", { text: def.label }));
      if (def.id !== "how") {
        const count =
          def.id === "todo"
            ? state.room.stories.filter((s) => s.status !== "estimated").length
            : state.room.stories.filter((s) => s.status === "estimated").length;
        button.append(
          el("span", {
            class: "tab-count" + (def.id === "todo" && count > 0 ? " positive" : ""),
            text: String(count),
          }),
        );
      }
      button.addEventListener("click", () => {
        ui.tab = def.id;
        ui.selectedKey = null;
        render();
      });
      tabs.append(button);
    }
    return tabs;
  }

  function progressNode(estimated: number, total: number): HTMLElement {
    const pct = total > 0 ? Math.round((estimated / total) * 100) : 0;
    const container = el("div", { class: "session-progress" });
    container.append(
      el("p", {
        class: "session-progress-text",
        text: `Estimation session: ${estimated} / ${total} stories estimated`,
      }),
    );
    const track = el("div", { class: "session-progress-track" });
    track.append(
      el("div", {
        class: "session-progress-bar",
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(pct),
        style: `width: ${pct}%`,
      }),
    );
    container.append(track);
    return container;
  }

  function howNode(): HTMLElement {
    const intro = el("div", { class: "story-intro" });
    intro.id = "story-tab-how";

    intro.append(
      el("h3", { class: "story-intro-title", text: "F&P Estimation Session" }),
      el("p", {
        class: "story-intro-copy",
        text:
          "Stories are optional. Use this room as a normal Planning Poker session, or import a Jira story list to work through a prepared estimation backlog.",
      }),
      el("h4", { class: "story-intro-sub", text: "How story-based estimation works" }),
    );

    const steps = [
      "Prepare — export the Jira stories you want to estimate from the estimation filter.",
      "Import — upload the CSV into this estimation session.",
      "Select — the facilitator selects a story to estimate.",
      "Estimate — everyone independently selects an estimate.",
      "Reveal & discuss — reveal the cards and discuss differences in the estimates.",
      "Record — the facilitator records the agreed estimate and moves to the next story.",
    ];
    const list = el("ol", { class: "story-steps" });
    for (const step of steps) list.append(el("li", { text: step }));
    intro.append(list);

    const notes = [
      "Jira is not directly connected to this application.",
      "The imported CSV is a snapshot for the current estimation session only.",
      "Nothing is written back to Jira.",
      "Jira issue links are provided for reference.",
      "Importing stories is optional — Planning Poker works the same without them.",
    ];
    const noteList = el("ul", { class: "story-notes" });
    for (const note of notes) noteList.append(el("li", { text: note }));
    intro.append(noteList);

    intro.append(el("h4", { class: "story-intro-sub", text: "F&P sizing" }));
    const sizing = el("table", { class: "sizing-table" });
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", { text: "Size" }), el("th", { text: "Approx. duration" }));
    head.append(headRow);
    sizing.append(head);
    const body = el("tbody");
    for (const [size, days] of SIZING) {
      const row = el("tr");
      row.append(el("td", { class: "sizing-size", text: size }));
      row.append(el("td", { text: days }));
      body.append(row);
    }
    sizing.append(body);
    intro.append(sizing);

    intro.append(el("h4", { class: "story-intro-sub", text: "Useful links" }));
    const links = el("nav", { class: "story-links" });
    links.append(
      externalLink("F&P Kanban Board", KANBAN_URL),
      externalLink("Estimation Filter", FILTER_URL),
      externalLink("Story Guide", GUIDE_URL),
    );
    intro.append(links);

    if (state.isFacilitator()) {
      const actions = el("div", { class: "story-actions" });
      actions.append(importButton());
      const add = el("button", {
        type: "button",
        class: "ghost story-edit-btn",
        text: "Add a story manually",
      });
      add.addEventListener("click", () => actions.after(manualEditor()));
      actions.append(add);
      intro.append(actions);
    }

    return intro;
  }

  function todoNode(): HTMLElement {
    const list = el("div", { class: "story-list", id: "story-tab-todo" });
    const open = state.room.stories.filter((s) => s.status !== "estimated");

    if (state.isFacilitator()) {
      const actions = el("div", { class: "story-actions" });
      actions.append(importButton());
      const add = el("button", {
        type: "button",
        class: "ghost story-edit-btn",
        text: "Add a story manually",
      });
      add.addEventListener("click", () => actions.after(manualEditor()));
      actions.append(add);
      list.append(actions);
    }

    if (open.length === 0) {
      list.append(
        el("p", {
          class: "story-empty",
          text: "No stories waiting to be estimated.",
        }),
      );
      return list;
    }

    for (const story of open) list.append(todoRow(story));

    const selected =
      (ui.selectedKey
        ? open.find((s) => s.key === ui.selectedKey)
        : undefined) ??
      open.find((s) => s.status === "estimating");
    if (selected) list.append(detailNode(selected));

    return list;
  }

  function todoRow(story: SessionStory): HTMLElement {
    const row = el("article", {
      class:
        "story-row todo" +
        (story.status === "estimating" ? " estimating" : "") +
        (ui.selectedKey === story.key ? " selected" : ""),
      role: "button",
      tabindex: "0",
    });
    row.append(
      storyKeyNode(story),
      el("span", { class: "story-title", text: story.title }),
      statusBadge(story.status),
    );
    const select = (): void => {
      ui.selectedKey = story.key;
      render();
    };
    row.addEventListener("click", select);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    return row;
  }

  function detailNode(story: SessionStory): HTMLElement {
    const detail = el("div", { class: "story-detail" });

    const header = el("div", { class: "story-detail-header" });
    header.append(
      el("h3", { class: "story-detail-key", text: story.key }),
      statusBadge(story.status),
    );
    detail.append(header);
    detail.append(el("p", { class: "story-detail-title", text: story.title }));
    if (story.description) {
      detail.append(el("p", { class: "story-desc", text: story.description }));
    }
    if (story.url) {
      detail.append(
        el(
          "p",
          { class: "story-detail-links" },
          externalLink("Open in Jira", story.url),
        ),
      );
    }

    if (state.isFacilitator()) {
      const estimating = story.status === "estimating";
      const start = el("button", {
        type: "button",
        text: estimating ? "Estimating…" : "Start Estimation",
        disabled: estimating,
      });
      start.addEventListener("click", () => {
        start.disabled = true;
        void roomsApi
          .startStoryEstimation(state.room.code, story.key)
          .then(async () => {
            showToast(`${story.key} estimation started.`);
            ui.tab = "todo";
            ui.selectedKey = null;
            await onChanged();
          })
          .catch((err: unknown) => {
            start.disabled = false;
            showToast(formatError(err, "start estimation"), true);
          });
      });
      detail.append(start);
    }
    return detail;
  }

  function doneNode(): HTMLElement {
    const list = el("div", { class: "story-list", id: "story-tab-done" });
    const done = state.room.stories.filter((s) => s.status === "estimated");
    if (done.length === 0) {
      list.append(
        el("p", { class: "story-empty", text: "No stories have been estimated yet." }),
      );
      return list;
    }

    const table = el("table", { class: "story-table" });
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(
      el("th", { text: "Key" }),
      el("th", { text: "Story" }),
      el("th", { text: "Agreed estimate" }),
      el("th", { text: "Completed" }),
    );
    head.append(headRow);
    table.append(head);

    const body = el("tbody");
    for (const story of done) {
      const row = el("tr", { class: "story-done-row" });
      const keyCell = el("td");
      keyCell.append(storyKeyNode(story));
      row.append(keyCell);
      row.append(el("td", { class: "story-done-title", text: story.title }));
      row.append(
        el("td", {
          class: "story-done-estimate",
          text: story.agreedEstimate ?? "—",
        }),
      );
      row.append(
        el("td", {
          class: "story-done-time",
          text: story.estimatedAt ? formatCompletedTime(story.estimatedAt) : "—",
        }),
      );
      body.append(row);
    }
    table.append(body);
    list.append(table);
    return list;
  }

  function importButton(): HTMLElement {
    const button = el("button", {
      type: "button",
      class: "story-import-btn",
      text: "Import Stories",
    });
    button.addEventListener("click", () => {
      button.after(importDialog());
    });
    return button;
  }

  function importDialog(): HTMLElement {
    const dialog = el("div", { class: "jira-dialog" });
    const title = el("p", {
      class: "jira-dialog-title",
      text: "Import stories",
    });
    const hint = el("p", {
      class: "jira-hint",
      text: "Choose a Jira CSV or RSS export from your estimation filter.",
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
      text: "The file is parsed in your browser and never leaves this machine. Live Jira fetch is disabled (no credentials configured).",
    });

    const buttons = el("div", { class: "editor-buttons" });
    const cancel = el("button", { type: "button", class: "ghost", text: "Close" });
    cancel.addEventListener("click", () => dialog.remove());
    buttons.append(cancel);

    dialog.append(title, hint, drop, note, buttons);

    let config: ClientConfig = { jiraHost: null, jiraProjectKey: null };
    void configApi
      .client()
      .then((loaded) => {
        config = loaded;
      })
      .catch(() => {});

    function renderStories(result: ImportResult): void {
      clear(dialog);
      dialog.append(
        el("p", {
          class: "jira-dialog-title",
          text:
            result.stories.length > 0
              ? `${result.stories.length} item${result.stories.length === 1 ? "" : "s"} ready to import`
              : "No stories found",
        }),
      );

      const list = el("div", { class: "jira-story-list" });
      for (const story of result.stories) {
        list.append(
          el(
            "div",
            { class: "jira-story-item" },
            el("span", { class: "jira-story-key", text: story.key }),
            el("span", { class: "jira-story-title", text: story.title }),
          ),
        );
      }
      if (result.stories.length === 0) {
        list.append(
          el("p", {
            class: "story-empty",
            text:
              result.source === "xml"
                ? "This RSS looks like a filter activity/comment feed, not the issue list. Use the CSV export from Jira instead."
                : "No usable issues were found in the CSV.",
          }),
        );
      }
      if (result.skipped > 0) {
        list.append(
          el("p", {
            class: "jira-hint",
            text: `Skipped ${result.skipped} row/item${result.skipped === 1 ? "" : "s"} with no usable issue key.`,
          }),
        );
      }
      dialog.append(list);

      const actionButtons = el("div", { class: "editor-buttons" });
      if (result.stories.length > 0) {
        const importAll = el("button", {
          type: "button",
          text: `Import ${result.stories.length} story${result.stories.length === 1 ? "" : "s"}`,
        });
        importAll.addEventListener("click", () => {
          importAll.disabled = true;
          const candidates: StoryPayload[] = result.stories.map((s) => ({
            key: s.key,
            title: s.title,
            description: s.description,
            url: s.url,
          }));
          void roomsApi
            .importStories(state.room.code, candidates)
            .then(async (summary) => {
              showToast(summaryText(summary));
              dialog.remove();
              ui.tab = "todo";
              ui.selectedKey = null;
              await onChanged();
            })
            .catch((err: unknown) => {
              importAll.disabled = false;
              showToast(formatError(err, "import stories"), true);
            });
        });
        actionButtons.append(importAll);
      }
      const close = el("button", { type: "button", class: "ghost", text: "Close" });
      close.addEventListener("click", () => dialog.remove());
      actionButtons.append(close);
      dialog.append(actionButtons);
    }

    file.addEventListener("change", () => {
      const selected = file.files?.[0];
      if (!selected) return;
      hint.textContent = "Reading " + selected.name + "…";
      void selected
        .text()
        .then((text) => {
          renderStories(prepareImport(text, config));
        })
        .catch((err: unknown) => {
          hint.textContent =
            "Import failed: " +
            (err instanceof Error ? err.message : "could not read the file.");
        });
    });

    return dialog;
  }

  function manualEditor(): HTMLElement {
    const form = el("form", { class: "story-editor" });
    const formTitle = el("p", { class: "jira-dialog-title", text: "Add a story manually" });

    const titleField = el("div", { class: "form-field" }, el("label", { text: "Title" }));
    const titleInput = el("input", {
      type: "text",
      maxLength: "100",
      placeholder: "e.g. Allow users to search payments",
      autocomplete: "off",
    }) as HTMLInputElement;
    titleField.append(titleInput);
    form.append(formTitle, titleField);

    const descField = el("div", { class: "form-field" }, el("label", { text: "Description (optional)" }));
    const descInput = el("textarea", {
      maxLength: "500",
      placeholder: "What are we estimating?",
    }) as HTMLTextAreaElement;
    descField.append(descInput);
    form.append(descField);

    const buttons = el("div", { class: "editor-buttons" });
    const save = el("button", { type: "submit", text: "Add to backlog" });
    const cancel = el("button", { type: "button", class: "ghost", text: "Cancel" });
    cancel.addEventListener("click", () => form.remove());
    buttons.append(save, cancel);
    form.append(buttons);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = inputValue(titleInput);
      if (!title) {
        showToast("Story title is required.", true);
        titleInput.focus();
        return;
      }
      save.disabled = true;
      const key = nextManualKey(state.room.stories);
      void roomsApi
        .importStories(state.room.code, [
          { key, title, description: descInput.value },
        ])
        .then(async () => {
          showToast(`${key} added to the backlog.`);
          ui.tab = "todo";
          ui.selectedKey = key;
          await onChanged();
        })
        .catch((err: unknown) => {
          save.disabled = false;
          showToast(formatError(err, "add story"), true);
        });
    });

    return form;
  }

  function storyKeyNode(story: SessionStory): HTMLElement {
    if (story.url) {
      return el("a", {
        class: "story-key",
        href: story.url,
        target: "_blank",
        rel: "noopener noreferrer",
        text: story.key,
      });
    }
    return el("span", { class: "story-key", text: story.key });
  }

  function statusBadge(status: SessionStory["status"]): HTMLElement {
    return el("span", {
      class: `status-badge ${status}`,
      text: statusLabel(status),
    });
  }

  function externalLink(label: string, href: string): HTMLElement {
    return el("a", {
      class: "story-link",
      href,
      target: "_blank",
      rel: "noopener noreferrer",
      text: label,
    });
  }
}

function nextManualKey(stories: SessionStory[]): string {
  let max = 0;
  for (const story of stories) {
    const match = /^MAN-(\d+)$/.exec(story.key.toUpperCase());
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > max) max = value;
    }
  }
  return `MAN-${max + 1}`;
}

function summaryText(summary: ImportSummary): string {
  const plural = (n: number): string => (n === 1 ? "" : "s");
  const parts = [`${summary.imported} story${plural(summary.imported)} imported`];
  if (summary.duplicatesSkipped > 0) {
    parts.push(`${summary.duplicatesSkipped} duplicate${plural(summary.duplicatesSkipped)} skipped`);
  }
  if (summary.invalidSkipped > 0) {
    parts.push(`${summary.invalidSkipped} invalid row${plural(summary.invalidSkipped)} skipped`);
  }
  if (summary.limitSkipped > 0) {
    parts.push(
      `${summary.limitSkipped} row${plural(summary.limitSkipped)} over the backlog limit skipped`,
    );
  }
  return parts.join(", ");
}

function formatError(err: unknown, action: string): string {
  const detail = err instanceof Error ? err.message : "Unknown error.";
  return `Could not ${action}: ${detail}`;
}