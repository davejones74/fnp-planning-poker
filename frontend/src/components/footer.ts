import { el } from "./dom.ts";
import { pickRandomQuote } from "../data/quotes.ts";

const MARKS = {
  cgi: { src: "/brand/CGI-solrus-logo.png", fallback: "CGI Solirius" },
  hmcts: { src: "/brand/Ministry-of-Justice-logo.jpg", fallback: "HMCTS" },
} as const;

const QUOTE = pickRandomQuote();

export function renderFooter(root: HTMLElement): void {
  const inner = el("div", { class: "app-footer-inner" });
  inner.append(brand("cgi"), footerQuote(), brand("hmcts"));
  root.append(inner);
}

function brand(name: keyof typeof MARKS): HTMLElement {
  const mark = MARKS[name];
  const img = el("img", {
    class: "brand-logo",
    src: mark.src,
    alt: mark.fallback,
  }) as HTMLImageElement;
  img.addEventListener("error", () => img.remove());
  return el(
    "span",
    { class: `footer-brand ${name}` },
    img,
    el("span", { class: "brand-text", text: mark.fallback }),
  );
}

function footerQuote(): HTMLElement {
  return el(
    "p",
    { class: "footer-quote" },
    el("span", { text: `"${QUOTE.quote}"` }),
    el("span", { class: "footer-quote-author", text: ` - ${QUOTE.author}` }),
  );
}