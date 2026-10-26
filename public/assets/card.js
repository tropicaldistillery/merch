// Business cards: the personal side, drawn as SVG over the artwork from the
// designer's PSD (3.5 x 2 in at 600 dpi, so 2100 x 1200 units), and the fixed
// navy back. The same drawing is the shop's live preview and the print
// proof, so what someone sees is what goes to the printer.
//
// The PSD sets the name in LEMON MILK Medium and the rest in SF Pro Display;
// those can't be served on the web, so the card uses Jost SemiBold and Inter (both
// open-licensed, hosted with the store) at the PSD's sizes and positions.

import { CARD_FIELDS } from "./shared.js";

export { CARD_DEFAULTS, CARD_FIELDS } from "./shared.js";

const SVG = "http://www.w3.org/2000/svg";
export const CARD_WIDTH = 2100;
export const CARD_HEIGHT = 1200;
const LEFT = 100;
const MAX_TEXT_WIDTH = 1900;
const INK = "#3b3b3b";

// Each line's baseline, size and font, measured off the PSD. The contact
// lines stack from the phone's baseline, so a blank one leaves no gap.
const NAME = { x: 103, y: 656, size: 101, font: "Card Name", spacing: "-0.028em" };
const TITLE = { y: 723, size: 63, font: "Card Text", spacing: "-0.019em" };
const CONTACT_TOP = 864;
const CONTACT = {
  phone: { size: 72, spacing: "0.005em", gap: 70 },
  email: { size: 57, spacing: "-0.023em", gap: 70 },
  address: { size: 57, spacing: "-0.006em", gap: 71 },
  website: { size: 57, spacing: "-0.025em", gap: 70 },
};

function node(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

function line(text, { x = LEFT, y, size, font = "Card Text", spacing = "0", upper = false }) {
  return node(
    "text",
    {
      x,
      y,
      "font-family": `"${font}", ${font === "Card Name" ? "Jost, Futura" : "Inter"}, system-ui, sans-serif`,
      "font-size": size,
      "letter-spacing": spacing,
      fill: INK,
      // Unhinted, so a line measures the same at any size it's shown at.
      "text-rendering": "geometricPrecision",
      "data-size": size,
    },
    upper ? text.toUpperCase() : text
  );
}

/** The card's personal side. `print` uses the full-resolution artwork. */
export function cardFront(details = {}, { print = false, label = "" } = {}) {
  const d = Object.fromEntries(CARD_FIELDS.map((f) => [f.id, String(details[f.id] ?? "").trim()]));
  const svg = node("svg", {
    viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`,
    class: "bcard bcard-front",
    role: "img",
    "aria-label": label || `Business card for ${d.name || "you"}`,
  });
  svg.append(
    node("image", {
      href: `/assets/business-card/${print ? "front" : "front-preview"}.jpg`,
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      preserveAspectRatio: "none",
    })
  );
  if (d.name) svg.append(line(d.name, { ...NAME, upper: true }));
  if (d.title) svg.append(line(d.title, TITLE));
  let y = CONTACT_TOP;
  let first = true;
  for (const id of ["phone", "email", "address", "website"]) {
    if (!d[id]) continue;
    if (!first) y += CONTACT[id].gap;
    svg.append(line(d[id], { y, size: CONTACT[id].size, spacing: CONTACT[id].spacing }));
    first = false;
  }
  return svg;
}

/** The fixed navy back: TROPICAL DISTILLERY, crafted in Miami. */
export function cardBack({ print = false } = {}) {
  const svg = node("svg", { viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`, class: "bcard bcard-back", role: "img", "aria-label": "Back of the card: Tropical Distillery, crafted in Miami, owned by the Pouncey twins" });
  svg.append(
    node("image", {
      href: `/assets/business-card/${print ? "back" : "back-preview"}.jpg`,
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      preserveAspectRatio: "none",
    })
  );
  return svg;
}

/**
 * Shrink any line too long for the card once it is on the page (it has to be
 * laid out to be measured), and once the card fonts have loaded.
 */
export async function fitCard(svg) {
  try {
    await Promise.all([document.fonts.load('101px "Card Name"'), document.fonts.load('57px "Card Text"')]);
  } catch {
    // fall back to whatever font is there
  }
  for (const text of svg.querySelectorAll("text")) {
    let size = Number(text.dataset.size);
    text.setAttribute("font-size", size);
    // Widths don't scale quite in step with the size, so check again.
    for (let pass = 0; pass < 4; pass += 1) {
      const width = text.getComputedTextLength();
      if (width <= MAX_TEXT_WIDTH) break;
      size = Math.floor(((size * MAX_TEXT_WIDTH) / width) * 0.995 * 10) / 10;
      text.setAttribute("font-size", size);
    }
  }
}
