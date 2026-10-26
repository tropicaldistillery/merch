// Print-ready business card files for a printer's upload page, such as
// Vistaprint's: one PDF per side at their full-bleed size for a standard
// card (3.61 x 2.11 in: the 3.5 x 2 in card plus 0.055 in all round, which is
// trimmed off), at 600 dpi. They're made here in the browser from the same
// drawing as the proof. The artwork has no bleed of its own, so its edges
// are mirrored out into it; the text stays well inside the safe area.

import { CARD_HEIGHT, CARD_WIDTH, cardBack, cardFront, fitCard } from "./card.js";

const DPI = 600;
const BLEED = Math.round(0.055 * DPI);
const FULL_WIDTH = CARD_WIDTH + 2 * BLEED;
const FULL_HEIGHT = CARD_HEIGHT + 2 * BLEED;
const PT = 72 / DPI;

const FONTS = [
  { family: "Card Name", url: "/assets/fonts/card-name-jost-600.woff" },
  { family: "Card Text", url: "/assets/fonts/card-text-inter-400.woff" },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src.startsWith("data:") ? "the card text" : src}`));
    img.src = src;
  });
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// An SVG drawn as an image can't reach the page's fonts, so they go inside it.
let fontCss = null;
function embeddedFonts() {
  fontCss ??= Promise.all(
    FONTS.map(async ({ family, url }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`couldn't load the card fonts (${response.status})`);
      return `@font-face { font-family: "${family}"; src: url(${await dataUrl(await response.blob())}) format("woff"); }`;
    })
  ).then((rules) => rules.join("\n"));
  return fontCss;
}

// The card's text, fitted exactly as on the proof, as an image to draw.
async function textLayer(details) {
  const svg = cardFront(details, { print: true });
  svg.querySelector("image")?.remove();
  svg.setAttribute("width", CARD_WIDTH);
  svg.setAttribute("height", CARD_HEIGHT);
  svg.style.position = "absolute";
  svg.style.left = "-99999px";
  svg.style.width = `${CARD_WIDTH}px`;
  document.body.append(svg);
  try {
    await fitCard(svg);
  } finally {
    svg.remove();
  }
  svg.removeAttribute("style");
  svg.removeAttribute("class");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await embeddedFonts();
  svg.prepend(style);
  // A data: URL, as the site's content policy allows images from those.
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`);
  await img.decode?.().catch(() => {});
  return img;
}

// The artwork over the trim area, and mirrored into the bleed on each side.
function drawArtwork(ctx, img) {
  const draw = () => ctx.drawImage(img, BLEED, BLEED, CARD_WIDTH, CARD_HEIGHT);
  draw();
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-1, 0, 1]) {
      if (!fx && !fy) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx < 0 ? 0 : fx > 0 ? BLEED + CARD_WIDTH : BLEED, fy < 0 ? 0 : fy > 0 ? BLEED + CARD_HEIGHT : BLEED, fx ? BLEED : CARD_WIDTH, fy ? BLEED : CARD_HEIGHT);
      ctx.clip();
      // Flip about the trim line on that side.
      ctx.translate(fx ? 2 * (fx < 0 ? BLEED : BLEED + CARD_WIDTH) : 0, fy ? 2 * (fy < 0 ? BLEED : BLEED + CARD_HEIGHT) : 0);
      ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
      draw();
      ctx.restore();
    }
  }
}

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("couldn't encode the image"))), "image/jpeg", 0.95)
  );
}

// PDF text strings are kept to plain ASCII.
const pdfString = (text) =>
  `(${String(text)
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\()]/g, "\\$&")})`;

/** A one-page PDF of a JPEG, with the trim marked inside the bleed. */
export function jpegPdf(jpeg, { width, height, bleed, title }) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n, dict, stream) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${dict}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };
  const w = (width * PT).toFixed(2);
  const h = (height * PT).toFixed(2);
  const b = (bleed * PT).toFixed(2);
  const trim = `[${b} ${b} ${((width - bleed) * PT).toFixed(2)} ${((height - bleed) * PT).toFixed(2)}]`;
  const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 and a binary marker
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /BleedBox [0 0 ${w} ${h}] /TrimBox ${trim} /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  object(5, `<< /Length ${content.length} >>`, content);
  object(6, `<< /Title ${pdfString(title)} /Producer (Tropical Distillery Team Merch) >>`);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/** One side of a card, `front` or `back`, as a print-ready PDF. */
export async function cardSidePdf(details, side) {
  const art = (side === "front" ? cardFront({}, { print: true }) : cardBack({ print: true })).querySelector("image").getAttribute("href");
  const [background, text] = await Promise.all([loadImage(art), side === "front" ? textLayer(details) : null]);
  const canvas = document.createElement("canvas");
  canvas.width = FULL_WIDTH;
  canvas.height = FULL_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  drawArtwork(ctx, background);
  if (text) ctx.drawImage(text, BLEED, BLEED, CARD_WIDTH, CARD_HEIGHT);
  const jpeg = await canvasJpeg(canvas);
  return jpegPdf(jpeg, { width: FULL_WIDTH, height: FULL_HEIGHT, bleed: BLEED, title: `Business card for ${details.name}, ${side}` });
}

/** "TD-1001 Jane Rep front.pdf", in plain ASCII, which every browser keeps. */
export function cardFileName(order, details, side) {
  const name =
    String(details.name ?? "")
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "card";
  return `${order.number} ${name} ${side}.pdf`;
}
