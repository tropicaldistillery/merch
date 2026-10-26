// Business cards: the personal side, drawn as SVG over the artwork from the
// designer's PSD (3.5 x 2 in at 600 dpi, so 2100 x 1200 units), and the fixed
// navy back. The same drawing is the shop's live preview and the print
// proof, so what someone sees is what goes to the printer.
//
// The PSD sets the name in LEMON MILK Medium and the rest in SF Pro Display.
// LEMON MILK can't be served on the web, so the name is in Jost SemiBold; the
// details are in Jost Regular too, the geometric type of the brand (the
// TROPICAL DISTILLERY lettering and tagline on the back), rather than SF Pro.
// Both are open-licensed and hosted with the store; the lines sit where the
// PSD has them.

import { CARD_FIELDS } from "./shared.js";

export { CARD_DEFAULTS, CARD_FIELDS } from "./shared.js";

const SVG = "http://www.w3.org/2000/svg";
export const CARD_WIDTH = 2100;
export const CARD_HEIGHT = 1200;
const LEFT = 100;
const RIGHT = 2000;
const MAX_TEXT_WIDTH = 1900;
const INK = "#3b3b3b";
// The banner's colours, pink first: pink, purple, blue. They fill the title
// (or the name: see ACCENT) and the favourite cocktail.
const GRADIENT = ["#c94486", "#784c7f", "#499fce"];
export const ACCENT = "title";
let gradients = 0;

// Each line's baseline, size and font, from the PSD. The details are a size
// up from the PSD's (Jost's lowercase is shorter than SF Pro's), so they read
// the same. The contact lines stack from the phone's baseline, so a blank one
// leaves no gap.
const NAME = { x: 103, y: 656, size: 101, font: "Card Name", spacing: "-0.028em" };
const TITLE = { y: 726, size: 70, font: "Card Text", spacing: "0.01em" };
const CONTACT_TOP = 866;
const CONTACT = {
  phone: { size: 80, spacing: "0.01em", gap: 70 },
  email: { size: 64, spacing: "0.01em", gap: 72 },
  address: { size: 64, spacing: "0.01em", gap: 71 },
  website: { size: 64, spacing: "0.01em", gap: 71 },
};
// The favourite cocktail sits in the bottom right corner, level with the
// last contact line, under a small FAVORITE COCKTAIL label.
const COCKTAIL = { size: 64, spacing: "0.01em", maxWidth: 820 };
const COCKTAIL_LABEL = { size: 34, spacing: "0.16em", above: 66 };

function node(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

function line(text, { x = LEFT, y, size, font = "Card Text", spacing = "0", upper = false, fill = INK, right = false }) {
  return node(
    "text",
    {
      x: right ? RIGHT : x,
      y,
      ...(right ? { "text-anchor": "end", "data-right": "" } : {}),
      "font-family": `"${font}", Jost, Futura, system-ui, sans-serif`,
      "font-size": size,
      "letter-spacing": spacing,
      fill,
      // Unhinted, so a line measures the same at any size it's shown at.
      "text-rendering": "geometricPrecision",
      "data-size": size,
    },
    upper ? text.toUpperCase() : text
  );
}

/**
 * The card's personal side. `print` uses the full-resolution artwork;
 * `accent` is the line in the gradient, "title" or "name".
 */
export function cardFront(details = {}, { print = false, label = "", accent = ACCENT } = {}) {
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
  // One gradient for the card, spread across each line it fills; ids are
  // unique for pages with several cards.
  const id = `bcard-gradient-${(gradients += 1)}`;
  const gradient = node("linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 0 });
  GRADIENT.forEach((color, i) => gradient.append(node("stop", { offset: i / (GRADIENT.length - 1), "stop-color": color })));
  svg.append(node("defs"));
  svg.querySelector("defs").append(gradient);
  const paint = `url(#${id})`;

  if (d.name) svg.append(line(d.name, { ...NAME, upper: true, fill: accent === "name" ? paint : INK }));
  if (d.title) svg.append(line(d.title, { ...TITLE, fill: accent === "name" ? INK : paint }));
  let y = CONTACT_TOP;
  let first = true;
  for (const id of ["phone", "email", "address", "website"]) {
    if (!d[id]) continue;
    if (!first) y += CONTACT[id].gap;
    svg.append(line(d[id], { y, size: CONTACT[id].size, spacing: CONTACT[id].spacing }));
    first = false;
  }
  if (d.cocktail) {
    svg.append(
      line("Favorite cocktail", { y: y - COCKTAIL_LABEL.above, size: COCKTAIL_LABEL.size, spacing: COCKTAIL_LABEL.spacing, upper: true, right: true }),
      line(d.cocktail, { y, size: COCKTAIL.size, spacing: COCKTAIL.spacing, fill: paint, right: true })
    );
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
  const left = [...svg.querySelectorAll("text:not([data-right])")];
  const right = [...svg.querySelectorAll("text[data-right]")];
  for (const text of left) shrinkTo(text, MAX_TEXT_WIDTH);
  if (!right.length) return;
  // The cocktail and its label each keep clear of the contact line on their row.
  for (const text of right) {
    const y = Number(text.getAttribute("y"));
    const beside = left.filter((t) => Math.abs(Number(t.getAttribute("y")) - y) < 45).map((t) => Number(t.getAttribute("x")) + t.getComputedTextLength());
    shrinkTo(text, Math.min(COCKTAIL.maxWidth, RIGHT - Math.max(LEFT, ...beside) - 70));
  }
}

function shrinkTo(text, max) {
  let size = Number(text.dataset.size);
  text.setAttribute("font-size", size);
  // Widths don't scale quite in step with the size, so check again.
  for (let pass = 0; pass < 4; pass += 1) {
    const width = text.getComputedTextLength();
    if (width <= max) break;
    size = Math.floor(((size * max) / width) * 0.995 * 10) / 10;
    text.setAttribute("font-size", size);
  }
}
