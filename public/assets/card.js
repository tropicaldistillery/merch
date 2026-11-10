// Business cards: the personal side, drawn as SVG over the artwork from the
// designer's PSD (3.5 x 2 in at 600 dpi, so 2100 x 1200 units), and the fixed
// navy back. The same drawing is the shop's live preview and the print
// proof, so what someone sees is what goes to the printer.
//
// The name is in capitals in Jost Bold, the title under it in Jost Regular,
// and each contact line has its icon beside it in blue: phone, email (in
// Jost SemiBold, so it stands out), address and website. The PSD set the
// name in LEMON MILK, which can't be served on the web; Jost is the geometric
// type of the brand (the TROPICAL DISTILLERY lettering on the back), open-
// licensed and hosted with the store.

import { CARD_FIELDS } from "./shared.js";

export { CARD_DEFAULTS, CARD_FIELDS } from "./shared.js";

const SVG = "http://www.w3.org/2000/svg";
export const CARD_WIDTH = 2100;
export const CARD_HEIGHT = 1200;
const LEFT = 112;
const RIGHT = 2000;
const INK = "#222222";
const ICON_BLUE = "#1b4f9c";

// Each line's baseline, size and font. The contact lines stack from the
// first one's baseline, so a blank one leaves no gap.
const NAME = { y: 662, size: 110, font: "Card Name", spacing: "0.005em" };
const TITLE = { y: 738, size: 66, font: "Card Text", spacing: "0.005em" };
const CONTACT_TOP = 868;
const CONTACT_GAP = 86;
const CONTACT_X = 232;
const CONTACT = {
  phone: { size: 58, spacing: "0.01em" },
  email: { size: 56, font: "Card Bold", spacing: "0" },
  address: { size: 58, spacing: "0.01em" },
  website: { size: 58, spacing: "0.01em" },
};

// Material icons (Apache License 2.0), drawn on a 24-unit grid; each sits
// centred on its line's lowercase letters.
const ICON_SIZE = 54;
const ICON_CENTER = 150;
const ICONS = {
  phone:
    "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  email: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z",
  address: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  website:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
};

function node(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

function line(text, { x = LEFT, y, size, font = "Card Text", spacing = "0", upper = false, fill = INK }) {
  return node(
    "text",
    {
      x,
      y,
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

function icon(id, baseline) {
  const top = baseline - 0.36 * CONTACT[id].size - ICON_SIZE / 2;
  return node("path", {
    d: ICONS[id],
    fill: ICON_BLUE,
    transform: `translate(${ICON_CENTER - ICON_SIZE / 2} ${top.toFixed(1)}) scale(${ICON_SIZE / 24})`,
    "aria-hidden": "true",
  });
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
  for (const id of ["phone", "email", "address", "website"]) {
    if (!d[id]) continue;
    svg.append(icon(id, y), line(d[id], { x: CONTACT_X, y, ...CONTACT[id] }));
    y += CONTACT_GAP;
  }
  return svg;
}

// The back: TROPICAL DISTILLERY in two lines of Jost the same width, the
// tagline in pink, and the Instagram handles along the bottom, over the navy
// artwork with the palm in the bottom right corner.
const PINK = "#ef6aa8";
const WORDMARK = [
  { text: "TROPICAL", y: 440, size: 428.4 },
  { text: "DISTILLERY", y: 790, size: 395.5 },
];
const TAGLINE = { text: "CRAFTED IN MIAMI · OWNED BY THE POUNCEY TWINS", x: 114, y: 900, size: 62, spacing: "0.06em" };
export const INSTAGRAM = ["@j.f.hadens", "@twinpwhiskey", "@tropicaldistillery"];
const HANDLES = { x: 200, y: 1030, size: 58, spacing: "0.01em", gap: 34 };
const GLYPH = { x: 112, size: 58 };

// Instagram's glyph, outlined on a 24-unit grid.
function instagramGlyph() {
  const top = HANDLES.y - 0.36 * HANDLES.size - GLYPH.size / 2;
  const g = node("g", { fill: "none", stroke: PINK, "stroke-width": 2, transform: `translate(${GLYPH.x} ${top.toFixed(1)}) scale(${GLYPH.size / 24})`, "aria-hidden": "true" });
  g.append(node("rect", { x: 2.5, y: 2.5, width: 19, height: 19, rx: 5.5 }), node("circle", { cx: 12, cy: 12, r: 4.6 }), node("circle", { cx: 17.4, cy: 6.6, r: 1.25, fill: PINK, stroke: "none" }));
  return g;
}

/** The back, the same on every card. `print` uses the full-resolution artwork. */
export function cardBack({ print = false } = {}) {
  const svg = node("svg", {
    viewBox: `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`,
    class: "bcard bcard-back",
    role: "img",
    "aria-label": `Back of the card: Tropical Distillery, crafted in Miami, owned by the Pouncey twins. On Instagram: ${INSTAGRAM.join(", ")}`,
  });
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
  for (const word of WORDMARK) {
    // a touch of outline makes Jost Regular as heavy as the old lettering
    const text = line(word.text, { x: LEFT - 2, y: word.y, size: word.size, fill: "#ffffff" });
    text.setAttribute("stroke", "#ffffff");
    text.setAttribute("stroke-width", 5);
    text.setAttribute("stroke-linejoin", "round");
    svg.append(text);
  }
  svg.append(line(TAGLINE.text, { ...TAGLINE, fill: PINK }), instagramGlyph());
  const handles = line("", { ...HANDLES, fill: "#ffffff" });
  INSTAGRAM.forEach((handle, i) => {
    if (i) handles.append(node("tspan", { dx: HANDLES.gap, fill: PINK }, "·"));
    handles.append(node("tspan", i ? { dx: HANDLES.gap } : {}, handle));
  });
  svg.append(handles);
  return svg;
}

/**
 * Shrink any line too long for the card once it is on the page (it has to be
 * laid out to be measured), and once the card fonts have loaded.
 */
export async function fitCard(svg) {
  try {
    await Promise.all([document.fonts.load('110px "Card Name"'), document.fonts.load('56px "Card Bold"'), document.fonts.load('58px "Card Text"')]);
  } catch {
    // fall back to whatever font is there
  }
  for (const text of svg.querySelectorAll("text")) shrinkTo(text, RIGHT - Number(text.getAttribute("x")));
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
