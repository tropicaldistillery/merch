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
// (or the name: see ACCENT).
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
// The favourite cocktail has its own area in the bottom right corner: a
// white panel outlined in the gradient, with a small FAVORITE COCKTAIL label
// over the drink in capitals in the name's font, on two lines when it's long.
// Contact lines beside the panel keep clear of it.
const PANEL = { left: 1430, right: RIGHT, bottom: 1120, radius: 36, stroke: 6, pad: 40, clear: 60 };
const COCKTAIL = { size: 62, font: "Card Name", spacing: "-0.01em", lineGap: 70 };
const COCKTAIL_LABEL = { size: 36, spacing: "0.16em" };
const PANEL_CENTER = (PANEL.left + PANEL.right) / 2;

function node(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

function line(text, { x = LEFT, y, size, font = "Card Text", spacing = "0", upper = false, fill = INK, anchor = "start" }) {
  return node(
    "text",
    {
      x,
      y,
      ...(anchor === "start" ? {} : { "text-anchor": anchor }),
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
    const panel = node("g", { "data-cocktail": d.cocktail.toUpperCase() });
    const name = { x: PANEL_CENTER, size: COCKTAIL.size, font: COCKTAIL.font, spacing: COCKTAIL.spacing, anchor: "middle" };
    panel.append(
      node("rect", { x: PANEL.left, width: PANEL.right - PANEL.left, rx: PANEL.radius, fill: "#ffffff", "fill-opacity": 0.92, stroke: paint, "stroke-width": PANEL.stroke }),
      line("Favorite cocktail", { x: PANEL_CENTER, size: COCKTAIL_LABEL.size, spacing: COCKTAIL_LABEL.spacing, upper: true, anchor: "middle" }),
      line(d.cocktail.toUpperCase(), name),
      line("", name)
    );
    placeCocktail(panel, [d.cocktail.toUpperCase()]);
    svg.append(panel);
  }
  return svg;
}

/** Lay out the cocktail panel for one or two lines of drink, from the bottom up. */
function placeCocktail(panel, lines) {
  const [rect, label, first, second] = panel.children;
  const top = PANEL.bottom - (lines.length === 2 ? 262 : 196);
  rect.setAttribute("y", top);
  rect.setAttribute("height", PANEL.bottom - top);
  label.setAttribute("y", top + 72);
  first.setAttribute("y", top + 150);
  first.textContent = lines[0];
  second.setAttribute("y", top + 150 + COCKTAIL.lineGap);
  second.textContent = lines[1] ?? "";
  return top;
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
  const panel = svg.querySelector("[data-cocktail]");
  let top = Infinity;
  if (panel) {
    // The drink on one line if it fits the panel, or split across two
    // nearest the middle; a single long word shrinks to fit.
    const inner = PANEL.right - PANEL.left - 2 * PANEL.pad;
    const [, label, first, second] = panel.children;
    const whole = panel.dataset.cocktail;
    top = placeCocktail(panel, [whole]);
    shrinkTo(first, Infinity);
    const words = whole.split(" ");
    if (first.getComputedTextLength() > inner && words.length > 1) {
      const diff = (at) => Math.abs(words.slice(0, at).join(" ").length - words.slice(at).join(" ").length);
      let split = 1;
      for (let i = 2; i < words.length; i += 1) if (diff(i) < diff(split)) split = i;
      top = placeCocktail(panel, [words.slice(0, split).join(" "), words.slice(split).join(" ")]);
    }
    for (const text of [label, first, second]) shrinkTo(text, inner);
    // both lines of the drink at the same size
    const size = Math.min(Number(first.getAttribute("font-size")), Number(second.getAttribute("font-size")));
    for (const text of [first, second]) text.setAttribute("font-size", size);
  }
  // Every other line fits the card, and keeps clear of the panel beside it.
  for (const text of svg.querySelectorAll("text")) {
    if (panel?.contains(text)) continue;
    const besidePanel = Number(text.getAttribute("y")) > top - 15;
    shrinkTo(text, besidePanel ? PANEL.left - PANEL.clear - Number(text.getAttribute("x")) : MAX_TEXT_WIDTH);
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
