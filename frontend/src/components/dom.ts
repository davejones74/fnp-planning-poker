export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") {
      node.textContent = String(value);
    } else if (key === "html") {
      // Internal use only; never with user input.
      node.innerHTML = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "class" || key === "className") {
      node.className = String(value);
    } else if (key === "disabled") {
      (node as HTMLButtonElement).disabled = Boolean(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function navigate(path: string): void {
  if (location.pathname === path) {
    void route();
    return;
  }
  history.pushState({}, "", path);
  void route();
}

type Router = () => Promise<void> | void;
let currentRouter: Router | null = null;

export function setRouter(router: Router): void {
  currentRouter = router;
}

async function route(): Promise<void> {
  if (currentRouter) await currentRouter();
}

export function showToast(message: string, isError = false): void {
  const toastRoot = document.getElementById("toast");
  if (!toastRoot) return;
  const node = el("div", { class: `toast${isError ? " error" : ""}`, text: message });
  toastRoot.append(node);
  setTimeout(() => node.remove(), 3500);
}

export function inputValue(input: HTMLInputElement | null): string {
  return (input?.value ?? "").trim();
}