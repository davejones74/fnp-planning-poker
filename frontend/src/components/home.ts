import { appState } from "../state/app-state.ts";
import { roomsApi, ApiClientError } from "../api/rooms.ts";
import { navigate, el, clear, showToast, inputValue } from "./dom.ts";
import { normalizeRoomCode } from "../../../shared/validation.ts";

export async function renderHome(root: HTMLElement): Promise<void> {
  clear(root);
  const container = el("div", { class: "home" });
  const savedName = appState.displayName;

  container.append(
    el("h1", { class: "home-heading", text: "Create or join an estimation room" }),
    el("p", {
      class: "hint",
      text: "Get started in seconds — share the room code to invite your team.",
    }),
  );

  // Display name
  const nameField = el("div", { class: "form-field" }, el("label", { text: "Your name" }));
  const nameInput = el("input", {
    type: "text",
    placeholder: "e.g. Dave",
    value: savedName,
    maxLength: "30",
    autocomplete: "off",
  }) as HTMLInputElement;
  nameField.append(nameInput);
  container.append(nameField);

  // Create
  const createButton = el(
    "button",
    { class: "create-zone", type: "button" },
    "Create Room",
  );
  createButton.addEventListener("click", async () => {
    const name = inputValue(nameInput);
    if (!name) {
      showToast("Enter your name first.", true);
      nameInput.focus();
      return;
    }
    createButton.disabled = true;
    try {
      const result = await roomsApi.create(name);
      appState.setSession(result.roomCode, result.participantId, result.displayName);
      navigate(`/room/${result.roomCode}`);
    } catch (err) {
      showToast(format(err), true);
      createButton.disabled = false;
    }
  });
  container.append(createButton);

  // Join
  const joinForm = el("form");
  const joinCodeField = el("div", { class: "form-field" }, el("label", { text: "Room code" }));
  const joinCode = el("input", {
    type: "text",
    placeholder: "ABC123",
    maxLength: "6",
    autocomplete: "off",
  }) as HTMLInputElement;
  joinCodeField.append(joinCode);
  joinForm.append(joinCodeField);
  const joinButton = el("button", { type: "submit" }, "Join Room");
  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = normalizeRoomCode(joinCode.value);
    const name = inputValue(nameInput);
    if (!name) {
      showToast("Enter your name first.", true);
      nameInput.focus();
      return;
    }
    if (!code) {
      showToast("Enter a valid 6-character room code.", true);
      joinCode.focus();
      return;
    }
    joinButton.disabled = true;
    try {
      // Resume the participant this browser last used for this room; the
      // server returns the existing participant instead of creating a
      // duplicate, and reconnects don't double-count against capacity.
      const participantId = appState.getParticipantId(code) ?? undefined;
      const result = await roomsApi.join(code, name, participantId);
      appState.setSession(result.roomCode, result.participantId, result.displayName);
      navigate(`/room/${result.roomCode}`);
    } catch (err) {
      const isNotFound = err instanceof ApiClientError && err.status === 404;
      showToast(isNotFound ? "Room not found or expired." : format(err), true);
      joinButton.disabled = false;
    }
  });
  joinForm.append(joinButton);
  container.append(el("div", { class: "form-field", style: "margin-top:20px;" }, joinForm));

  // Recent rooms
  const recent = appState.getRecentRooms();
  if (recent.length > 0) {
    const section = el("div", { class: "recent panel", style: "margin-top:24px;max-width:380px;margin-left:auto;margin-right:auto;" });
    const head = el("div", { class: "recent-head" });
    head.append(el("h2", { text: "Recent rooms" }));
    const clearBtn = el("button", { type: "button", class: "text-btn", text: "Clear" });
    clearBtn.addEventListener("click", () => {
      appState.clearRecentRooms();
      section.remove();
    });
    head.append(clearBtn);
    section.append(head);
    const list = el("div", { class: "recent-list" });
    for (const code of recent) {
      const recentBtn = el(
        "button",
        { type: "button", text: `Rejoin ${code}`, style: "text-align:center;" },
      );
      recentBtn.addEventListener("click", () => navigate(`/room/${code}`));
      list.append(recentBtn);
    }
    section.append(list);
    container.append(section);
  }

  root.append(container);
}

function format(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}