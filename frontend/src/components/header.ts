import { el, clear, navigate } from "./dom.ts";
import { appState } from "../state/app-state.ts";
import { personIcon, moonIcon, sunIcon } from "./icons.ts";

/**
 * Global app header: brand left, current user + theme toggle right.
 * Rendered once above the routed content so it survives room changes.
 */
export function renderHeader(root: HTMLElement): void {
  clear(root);

  const inner = el("div", { class: "header-inner" });

  const brand = el("button", { class: "header-brand", type: "button" });
  brand.append(el("span", { class: "header-brand-text", text: "F&P Planning Poker" }));
  brand.addEventListener("click", () => navigate("/"));
  inner.append(brand);

  const right = el("div", { class: "header-right" });

  const user = el("span", { class: "header-user" });
  const avatar = el("span", { class: "header-avatar", "aria-hidden": "true" });
  avatar.append(personIcon(20));
  user.append(avatar);
  user.append(
    el("span", { class: "header-user-name", text: appState.displayName || "Guest" }),
  );
  right.append(user);

  const isDark = appState.theme === "dark";
  const themeButton = el("button", {
    class: "header-icon-btn",
    type: "button",
    "aria-label": isDark ? "Switch to light mode" : "Switch to dark mode",
    title: isDark ? "Switch to light mode" : "Switch to dark mode",
  });
  themeButton.append(isDark ? sunIcon(18) : moonIcon(18));
  themeButton.addEventListener("click", () => {
    appState.theme = isDark ? "light" : "dark";
    renderHeader(root);
  });
  right.append(themeButton);

  inner.append(right);
  root.append(inner);
}