const NS = "http://www.w3.org/2000/svg";

function elem(name: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function makeIcon(size: number, body: (svg: SVGSVGElement) => void): SVGSVGElement {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("width", String(size));
  node.setAttribute("height", String(size));
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.6");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  body(node);
  return node;
}

/** Coffee cup with handle and steam — used for the coffee estimation card. */
export function coffeeIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("path", { d: "M4.5 9.5h12v5a5.5 5.5 0 0 1-5.5 5.5h-1a5.5 5.5 0 0 1-5.5-5.5z" }),
      elem("path", { d: "M16.5 10.5H17.7a2.4 2.4 0 0 1 0 4.8H16.5" }),
      elem("path", { d: "M7 6.5v1.6M10.5 6.5v1.6M14 6.5v1.6" }),
    );
  });
}

export function personIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("circle", { cx: "12", cy: "8.2", r: "3.4" }),
      elem("path", { d: "M4.8 19a7.2 7.2 0 0 1 14.4 0" }),
    );
  });
}

export function checkIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(elem("path", { d: "M4.5 12.5l5 5L19.5 7" }));
  });
}

export function clockIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("circle", { cx: "12", cy: "12", r: "8.5" }),
      elem("path", { d: "M12 7.5V12l3.5 2" }),
    );
  });
}

export function moonIcon(size = 24): SVGSVGElement {
  const node = makeIcon(size, (svg) => {
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
    svg.append(
      elem("path", {
        d: "M20.6 13.7A8.6 8.6 0 1 1 10.3 3.4a7 7 0 0 0 10.3 10.3z",
      }),
    );
  });
  return node;
}

export function sunIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("circle", { cx: "12", cy: "12", r: "4" }),
      elem("path", {
        d: "M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4",
      }),
    );
  });
}

export function chevronIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(elem("path", { d: "M6 9.5l6 6 6-6" }));
  });
}

export function copyIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }),
      elem("path", { d: "M5 15.5V5a2 2 0 0 1 2-2h10.5" }),
    );
  });
}

export function linkIcon(size = 24): SVGSVGElement {
  return makeIcon(size, (svg) => {
    svg.append(
      elem("path", {
        d: "M10.5 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6",
      }),
      elem("path", {
        d: "M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6",
      }),
    );
  });
}