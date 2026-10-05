// The starter catalog and the rules for editing it.
//
// Costs and stock levels below are placeholders to be replaced from the admin
// console (Catalog tab) with real numbers. The seed is only used when a store
// is created for the first time; after that the catalog lives in the store.

import { BRANDS, CATEGORIES, TONES } from "../public/assets/shared.js";
import { ValidationError, cleanText } from "./validation.mjs";

export const ART_KINDS = [
  "tee", "polo", "cap", "apron", "rocks", "shot", "glencairn", "tumbler",
  "shelf-talker", "neck-hanger", "table-tent", "bar-mat", "neon", "tin-sign",
  "shaker", "jigger", "kit", "cups", "table-throw", "banner", "sheets", "cards",
  "sticker", "bottle",
];

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

function sized(stockBySize) {
  return SIZES.map((size, i) => ({ id: size.toLowerCase(), label: size, stock: stockBySize[i] }));
}

function single(stock) {
  return [{ id: "default", label: "", stock }];
}

export const SEED_CATALOG = [
  // Apparel
  {
    id: "jfh-logo-tee", sku: "TD-APP-001", name: "J.F. Haden's Logo Tee",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "tee", unit: "Each",
    description: "Soft ring-spun cotton tee with the J.F. Haden's mango mark on the chest. Good for tastings and ride-alongs.",
    costCents: 1150, maxPerOrder: 6, variants: sized([8, 14, 14, 10, 6, 3]),
  },
  {
    id: "td-team-polo", sku: "TD-APP-002", name: "Tropical Distillery Team Polo",
    brand: "tropical-distillery", category: "Apparel", tone: "palm", art: "polo", unit: "Each",
    description: "Moisture-wicking polo with the embroidered Tropical Distillery logo. The standard uniform for account visits and trade shows.",
    costCents: 2600, maxPerOrder: 3, variants: sized([4, 8, 8, 6, 4, 2]),
  },
  {
    id: "jfh-cap", sku: "TD-APP-003", name: "J.F. Haden's Embroidered Cap",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "cap", unit: "Each",
    description: "Unstructured cotton cap with an adjustable strap.",
    costCents: 1400, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "twinp-trucker", sku: "TD-APP-004", name: "Twin P Whiskey Trucker Hat",
    brand: "twin-p", category: "Apparel", tone: "oak", art: "cap", unit: "Each",
    description: "Mesh-back trucker with a leather Twin P patch.",
    costCents: 1300, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "jfh-apron", sku: "TD-APP-005", name: "J.F. Haden's Bartender Apron",
    brand: "jf-hadens", category: "Apparel", tone: "espresso", art: "apron", unit: "Each",
    description: "Waxed canvas bib apron with leather straps — a thank-you for the bartenders who pour us.",
    costCents: 2200, maxPerOrder: 6, variants: single(18),
  },

  // Drinkware
  {
    id: "jfh-rocks-12", sku: "TD-DRK-001", name: "J.F. Haden's Etched Rocks Glasses",
    brand: "jf-hadens", category: "Drinkware", tone: "mango", art: "rocks", unit: "Case of 12",
    description: "10 oz double old fashioned glasses with an etched logo, for feature-cocktail programs.",
    costCents: 4200, maxPerOrder: 4, variants: single(25),
  },
  {
    id: "jfh-shot-24", sku: "TD-DRK-002", name: "J.F. Haden's Shot Glasses",
    brand: "jf-hadens", category: "Drinkware", tone: "lime", art: "shot", unit: "Pack of 24",
    description: "1.5 oz shot glasses with a printed Key Lime logo.",
    costCents: 2900, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "twinp-glencairn-6", sku: "TD-DRK-003", name: "Twin P Whiskey Tasting Glasses",
    brand: "twin-p", category: "Drinkware", tone: "oak", art: "glencairn", unit: "Pack of 6",
    description: "Glencairn-style nosing glasses for whiskey dinners and tastings.",
    costCents: 4500, maxPerOrder: 2, variants: single(12),
  },
  {
    id: "td-tumbler", sku: "TD-DRK-004", name: "Tropical Distillery Insulated Tumbler",
    brand: "tropical-distillery", category: "Drinkware", tone: "palm", art: "tumbler", unit: "20 oz",
    description: "Stainless steel tumbler with a slide lid and straw.",
    costCents: 1600, maxPerOrder: 4, variants: single(40),
  },

  // Point of Sale
  {
    id: "jfh-mango-shelf-talkers", sku: "TD-POS-001", name: "Mango Liqueur Shelf Talkers",
    brand: "jf-hadens", category: "Point of Sale", tone: "mango", art: "shelf-talker", unit: "Pack of 25",
    description: "Clip-on shelf talkers with tasting notes and a QR code to the cocktail menu. For off-premise accounts.",
    costCents: 1500, maxPerOrder: 10, variants: single(60),
  },
  {
    id: "jfh-espresso-neck-hangers", sku: "TD-POS-002", name: "Espresso Liqueur Neck Hangers",
    brand: "jf-hadens", category: "Point of Sale", tone: "espresso", art: "neck-hanger", unit: "Pack of 50",
    description: "Espresso Martini recipe neck hangers. Fit standard 750 ml necks.",
    costCents: 2000, maxPerOrder: 10, variants: single(45),
  },
  {
    id: "jfh-key-lime-table-tents", sku: "TD-POS-003", name: "Key Lime Liqueur Table Tents",
    brand: "jf-hadens", category: "Point of Sale", tone: "lime", art: "table-tent", unit: "Pack of 12",
    description: "Feature-cocktail table tents for on-premise accounts, with space for the venue to write its price.",
    costCents: 1800, maxPerOrder: 6, variants: single(40),
  },
  {
    id: "jfh-bar-mat", sku: "TD-POS-004", name: "J.F. Haden's Rubber Bar Mat",
    brand: "jf-hadens", category: "Point of Sale", tone: "mango", art: "bar-mat", unit: "Each",
    description: "20 × 3.5 in service-well bar mat.",
    costCents: 2200, maxPerOrder: 4, variants: single(35),
  },
  {
    id: "jfh-led-sign", sku: "TD-POS-005", name: "J.F. Haden's LED Back-bar Sign",
    brand: "jf-hadens", category: "Point of Sale", tone: "mango", art: "neon", unit: "Each",
    description: "Low-voltage LED sign, 24 × 14 in, with wall mount and a 6 ft cord. For priority on-premise accounts.",
    costCents: 14500, maxPerOrder: 1, variants: single(6),
  },
  {
    id: "twinp-tin-sign", sku: "TD-POS-006", name: "Twin P Whiskey Tin Sign",
    brand: "twin-p", category: "Point of Sale", tone: "oak", art: "tin-sign", unit: "Each",
    description: "Embossed 18 × 12 in tin sign, pre-drilled for hanging.",
    costCents: 3800, maxPerOrder: 2, variants: single(10),
  },

  // Bar Tools
  {
    id: "td-shaker-set", sku: "TD-BAR-001", name: "Branded Shaker Tin Set",
    brand: "tropical-distillery", category: "Bar Tools", tone: "palm", art: "shaker", unit: "Set of 2",
    description: "Weighted 28 oz and 18 oz Boston tins, laser-etched.",
    costCents: 1900, maxPerOrder: 6, variants: single(24),
  },
  {
    id: "jfh-jigger", sku: "TD-BAR-002", name: "J.F. Haden's Japanese Jigger",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "jigger", unit: "Each",
    description: "1 oz / 2 oz stainless jigger with interior measure lines.",
    costCents: 750, maxPerOrder: 12, variants: single(50),
  },

  // Sampling & Events
  {
    id: "td-tasting-kit", sku: "TD-EVT-001", name: "Tasting Event Kit",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "kit", unit: "Kit",
    description: "Everything for an in-store tasting: branded table runner, 200 sample cups, 50 recipe cards, a sign-in sheet and a bottle riser.",
    costCents: 6500, maxPerOrder: 2, variants: single(10),
  },
  {
    id: "td-sample-cups", sku: "TD-EVT-002", name: "Sample Cups, 1 oz",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "cups", unit: "Sleeve of 250",
    description: "Clear 1 oz plastic sampling cups. Bought to order, so never out of stock.",
    costCents: 1100, maxPerOrder: 8, variants: single(null),
  },
  {
    id: "td-table-throw", sku: "TD-EVT-003", name: "6 ft Table Throw",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "table-throw", unit: "Each",
    description: "Fitted, full-colour table throw for festivals and trade shows. Machine washable.",
    costCents: 8900, maxPerOrder: 1, variants: single(5),
  },
  {
    id: "td-pullup-banner", sku: "TD-EVT-004", name: "Retractable Pull-up Banner",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "mango", art: "banner", unit: "Each",
    description: "33 × 80 in portfolio banner with a carry case.",
    costCents: 12000, maxPerOrder: 1, variants: single(4),
  },

  // Print
  {
    id: "td-sell-sheets", sku: "TD-PRT-001", name: "Portfolio Sell Sheets",
    brand: "tropical-distillery", category: "Print", tone: "palm", art: "sheets", unit: "Pack of 50",
    description: "Two-sided sell sheets for J.F. Haden's Mango, Espresso and Key Lime and Twin P Whiskey: tasting notes, SKUs, case packs and UPCs. Printed to order.",
    costCents: 2200, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "jfh-recipe-cards", sku: "TD-PRT-002", name: "Signature Cocktail Recipe Cards",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "cards", unit: "Pack of 100",
    description: "Pocket recipe cards for the Mango Mule, Espresso Martini and Key Lime Pie Martini. Printed to order.",
    costCents: 1800, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "jfh-stickers", sku: "TD-PRT-003", name: "J.F. Haden's Logo Stickers",
    brand: "jf-hadens", category: "Print", tone: "mango", art: "sticker", unit: "Pack of 100",
    description: "3 in die-cut vinyl stickers.",
    costCents: 2500, maxPerOrder: 4, variants: single(20),
  },
].map((item) => ({ ...item, image: "", active: true }));

/* ------------------------------------------------------------ admin edits */

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseCents(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  return null;
}

function parseStock(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : NaN;
}

// Images are either one of our own files or an https URL. Anything else (a
// javascript: or data: URL, a protocol-relative path) is refused.
function cleanImage(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  if (/^\/assets\/[A-Za-z0-9._/-]+$/.test(text) && !text.includes("..")) return text;
  try {
    const url = new URL(text);
    if (url.protocol === "https:") return url.href;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Validate an item submitted from the admin console. Returns the normalized
 * item; throws ValidationError with per-field messages otherwise.
 *
 * `existing` is the item being edited, if any: its id is kept, and variant ids
 * are kept for labels that already existed, so stock history stays attached.
 */
export function normalizeItem(input, { catalog, existing = null }) {
  const errors = {};
  const src = input && typeof input === "object" ? input : {};

  const name = cleanText(src.name, 120);
  if (!name) errors.name = "Give the item a name.";

  const sku = cleanText(src.sku, 40).toUpperCase();
  if (!sku) errors.sku = "Add a SKU.";
  else if (catalog.some((item) => item.sku === sku && item.id !== existing?.id)) {
    errors.sku = "Another item already uses this SKU.";
  }

  const brand = cleanText(src.brand, 40);
  if (!BRANDS.some((b) => b.id === brand)) errors.brand = "Choose a brand.";

  const category = cleanText(src.category, 40);
  if (!CATEGORIES.includes(category)) errors.category = "Choose a category.";

  const tone = cleanText(src.tone, 20);
  if (!TONES.some((t) => t.id === tone)) errors.tone = "Choose a colourway.";

  const art = cleanText(src.art, 30);
  if (!ART_KINDS.includes(art)) errors.art = "Choose an illustration.";

  const image = cleanImage(src.image);
  if (image === null) errors.image = "Use an https:// image URL, or leave this blank.";

  const costCents = parseCents(src.costCents);
  if (costCents === null || costCents > 10_000_000) errors.costCents = "Enter a cost of $0 or more.";

  const maxPerOrder = Number(src.maxPerOrder);
  if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 999) {
    errors.maxPerOrder = "Enter a whole number from 1 to 999.";
  }

  const rawVariants = Array.isArray(src.variants) ? src.variants : [];
  const variants = [];
  if (!rawVariants.length || rawVariants.length > 20) {
    errors.variants = "An item needs between 1 and 20 options.";
  } else if (rawVariants.length === 1 && !cleanText(rawVariants[0]?.label, 40)) {
    // A single unlabelled variant is an item without options.
    const stock = parseStock(rawVariants[0]?.stock);
    if (Number.isNaN(stock)) errors.variants = "Stock must be a whole number, or blank if not tracked.";
    variants.push({ id: "default", label: "", stock });
  } else {
    const seen = new Set();
    for (const raw of rawVariants) {
      const label = cleanText(raw?.label, 40);
      const stock = parseStock(raw?.stock);
      if (!label) {
        errors.variants = "Every option needs a label, such as a size.";
        break;
      }
      if (Number.isNaN(stock)) {
        errors.variants = `Stock for “${label}” must be a whole number, or blank if not tracked.`;
        break;
      }
      const prior = existing?.variants.find((v) => v.label.toLowerCase() === label.toLowerCase());
      const id = prior?.id || slug(label) || `option-${variants.length + 1}`;
      if (seen.has(id)) {
        errors.variants = `“${label}” is listed twice.`;
        break;
      }
      seen.add(id);
      variants.push({ id, label, stock });
    }
  }

  if (Object.keys(errors).length) {
    throw new ValidationError("Some details need attention.", errors);
  }

  let id = existing?.id;
  if (!id) {
    const base = slug(`${sku}-${name}`) || "item";
    id = base;
    for (let n = 2; catalog.some((item) => item.id === id); n += 1) id = `${base}-${n}`;
  }

  return {
    id,
    sku,
    name,
    brand,
    category,
    tone,
    art,
    image,
    unit: cleanText(src.unit, 40) || "Each",
    description: cleanText(src.description, 600),
    costCents,
    maxPerOrder,
    variants,
    active: src.active !== false,
  };
}

/** The view of an item a team member gets: no inactive items, stock as availability. */
export function publicItem(item) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    brand: item.brand,
    category: item.category,
    tone: item.tone,
    art: item.art,
    image: item.image,
    unit: item.unit,
    description: item.description,
    costCents: item.costCents,
    maxPerOrder: item.maxPerOrder,
    variants: item.variants.map((v) => ({ id: v.id, label: v.label, stock: v.stock })),
  };
}
