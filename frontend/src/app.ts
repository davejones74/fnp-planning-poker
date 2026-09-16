import { setRouter, el, clear } from "./components/dom.ts";
import { renderHeader } from "./components/header.ts";
import { renderFooter } from "./components/footer.ts";
import { renderHome } from "./components/home.ts";
import { renderRoomPage } from "./components/room.ts";
import { appState } from "./state/app-state.ts";

const app = document.getElementById("app");
if (app) {
  document.documentElement.dataset.theme = appState.theme;

  const headerRoot = el("header", { class: "app-header" });
  const contentRoot = el("main", { class: "app-content" });
  const footerRoot = el("footer", { class: "app-footer" });
  app.append(headerRoot, contentRoot, footerRoot);

  renderHeader(headerRoot);
  renderFooter(footerRoot);

  async function route(): Promise<void> {
    clear(contentRoot);
    const match = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,10})$/);
    if (match) {
      await renderRoomPage(contentRoot, match[1] as string);
    } else {
      await renderHome(contentRoot);
    }
    renderHeader(headerRoot);
  }

  setRouter(route);
  window.addEventListener("popstate", () => void route());
  void route();
}