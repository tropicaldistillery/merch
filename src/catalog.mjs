// The starter catalog and the rules for editing it.
//
// Costs and stock levels below are placeholders to be replaced from the admin
// console (Catalog tab) with real numbers. The seed is only used when a store
// is created for the first time; after that the catalog lives in the store.

import { BRANDS, CATEGORIES, COLOR_OPTIONS, MAX_IMAGES, TONES, generateSku, itemImages, suggestedMinPerOrder } from "../public/assets/shared.js";
import { IMAGE_PATH_RE } from "./images.mjs";
import { ValidationError, cleanText } from "./validation.mjs";

export const ART_KINDS = [
  "tee", "polo", "cap", "apron", "rocks", "shot", "glencairn", "tumbler",
  "shelf-talker", "neck-hanger", "table-tent", "bar-mat", "neon", "tin-sign",
  "shaker", "jigger", "kit", "cups", "table-throw", "banner", "sheets", "cards",
  "sticker", "bottle",
];

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

// Starter items offered in colours.
const SEED_COLORS = {
  "td-team-polo": ["White", "Navy", "Burgundy", "Black", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"],
};

// Product photos for the starter items, in public/assets/merch: one photo
// named after the item, or one per colour (td-team-polo-navy.jpg), main
// photo first. Bump the version when photos are added so existing stores
// pick them up once.
export const SEED_PHOTOS_VERSION = 1;
const SEED_PHOTO_IDS = [];
const SEED_MAIN_COLOR = { "td-team-polo": "Navy" };
export const SEED_PHOTOS = Object.fromEntries([
  ...SEED_PHOTO_IDS.map((id) => [id, [{ url: `/assets/merch/${id}.jpg`, color: "" }]]),
  ...Object.entries(SEED_MAIN_COLOR).map(([id, main]) => [
    id,
    [main, ...SEED_COLORS[id].filter((c) => c !== main)].map((color) => ({ url: `/assets/merch/${id}-${slug(color)}.jpg`, color })),
  ]),
]);

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

  // Giveaways, bar tools and VIP pieces
  {
    id: "jfh-rocks-12", sku: "TD-DRK-001", name: "J.F. Haden's Etched Rocks Glasses",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "rocks", unit: "Case of 12",
    description: "10 oz double old fashioned glasses with an etched logo, for feature-cocktail programs.",
    costCents: 4200, maxPerOrder: 4, variants: single(25),
  },
  {
    id: "jfh-shot-24", sku: "TD-DRK-002", name: "J.F. Haden's Shot Glasses",
    brand: "jf-hadens", category: "Giveaways", tone: "lime", art: "shot", unit: "Pack of 24",
    description: "1.5 oz shot glasses with the J.F. Haden's logo in Key Lime Pie green.",
    costCents: 2900, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "twinp-glencairn-6", sku: "TD-DRK-003", name: "Twin P Whiskey Tasting Glasses",
    brand: "twin-p", category: "VIP", tone: "oak", art: "glencairn", unit: "Pack of 6",
    description: "Glencairn-style nosing glasses for whiskey dinners and tastings.",
    costCents: 4500, maxPerOrder: 2, variants: single(12),
  },
  {
    id: "td-tumbler", sku: "TD-DRK-004", name: "Tropical Distillery Insulated Tumbler",
    brand: "tropical-distillery", category: "Giveaways", tone: "palm", art: "tumbler", unit: "20 oz",
    description: "Stainless steel tumbler with a slide lid and straw.",
    costCents: 1600, maxPerOrder: 4, variants: single(40),
  },

  // Print and display
  {
    id: "jfh-mango-shelf-talkers", sku: "TD-POS-001", name: "Mango Liqueur Shelf Talkers",
    brand: "jf-hadens", category: "Print", tone: "mango", art: "shelf-talker", unit: "Pack of 25",
    description: "Clip-on shelf talkers with tasting notes and a QR code to the cocktail menu. For off-premise accounts.",
    costCents: 1500, maxPerOrder: 10, variants: single(60),
  },
  {
    id: "jfh-espresso-neck-hangers", sku: "TD-POS-002", name: "Espresso Liqueur Neck Hangers",
    brand: "jf-hadens", category: "Print", tone: "espresso", art: "neck-hanger", unit: "Pack of 50",
    description: "Espresso Martini recipe neck hangers. Fit standard 750 ml necks.",
    costCents: 2000, maxPerOrder: 10, variants: single(45),
  },
  {
    id: "jfh-key-lime-table-tents", sku: "TD-POS-003", name: "Key Lime Pie Liqueur Table Tents",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "table-tent", unit: "Pack of 12",
    description: "Key Lime Pie Martini table tents for on-premise accounts, with space for the venue to write its price.",
    costCents: 1800, maxPerOrder: 6, variants: single(40),
  },
  {
    id: "jfh-bar-mat", sku: "TD-POS-004", name: "J.F. Haden's Rubber Bar Mat",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "bar-mat", unit: "Each",
    description: "20 × 3.5 in service-well bar mat.",
    costCents: 2200, maxPerOrder: 4, variants: single(35),
  },
  {
    id: "jfh-led-sign", sku: "TD-POS-005", name: "J.F. Haden's LED Back-bar Sign",
    brand: "jf-hadens", category: "VIP", tone: "mango", art: "neon", unit: "Each",
    description: "Low-voltage LED sign, 24 × 14 in, with wall mount and a 6 ft cord. For priority on-premise accounts.",
    costCents: 14500, maxPerOrder: 1, variants: single(6),
  },
  {
    id: "twinp-tin-sign", sku: "TD-POS-006", name: "Twin P Whiskey Tin Sign",
    brand: "twin-p", category: "VIP", tone: "oak", art: "tin-sign", unit: "Each",
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
    description: "Two-sided sell sheets for all six J.F. Haden's flavors (Citrus, Espresso, Key Lime Pie, Lychee, Mango and Orange) and Twin P Whiskey: tasting notes, SKUs, case packs and UPCs. Printed to order.",
    costCents: 2200, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "jfh-recipe-cards", sku: "TD-PRT-002", name: "Signature Cocktail Recipe Cards",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "cards", unit: "Pack of 100",
    description: "Pocket recipe cards for J.F. Haden's signature cocktails: Iced Coffee, Tropical Sunset, Pink Lotus and Key Lime Pie Martini. Printed to order.",
    costCents: 1800, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "jfh-stickers", sku: "TD-PRT-003", name: "J.F. Haden's Logo Stickers",
    brand: "jf-hadens", category: "Giveaways", tone: "mango", art: "sticker", unit: "Pack of 100",
    description: "3 in die-cut vinyl stickers.",
    costCents: 2500, maxPerOrder: 4, variants: single(20),
  },
].map((item) => ({
  ...item,
  minPerOrder: Math.min(suggestedMinPerOrder(item.costCents, item.category), item.maxPerOrder),
  orderIncrement: 1,
  image: SEED_PHOTOS[item.id]?.[0].url ?? "",
  images: structuredClone(SEED_PHOTOS[item.id] ?? []),
  colors: SEED_COLORS[item.id] ?? [],
  active: true,
}));

/* ------------------------------------------------------- seed corrections */

// Wording fixed in the starter catalog after stores were already seeded with
// it, matched to the flavours and recipes on tropicaldistillery.com. Applied
// at startup to items that still carry the old wording exactly, so anything
// an admin has edited is left alone.
export const SEED_TEXT_FIXES = [
  {
    id: "jfh-shot-24",
    field: "description",
    from: "1.5 oz shot glasses with a printed Key Lime logo.",
  },
  {
    id: "jfh-key-lime-table-tents",
    field: "name",
    from: "Key Lime Liqueur Table Tents",
  },
  {
    id: "jfh-key-lime-table-tents",
    field: "description",
    from: "Feature-cocktail table tents for on-premise accounts, with space for the venue to write its price.",
  },
  {
    id: "td-sell-sheets",
    field: "description",
    from: "Two-sided sell sheets for J.F. Haden's Mango, Espresso and Key Lime and Twin P Whiskey: tasting notes, SKUs, case packs and UPCs. Printed to order.",
  },
  {
    id: "jfh-recipe-cards",
    field: "description",
    from: "Pocket recipe cards for the Mango Mule, Espresso Martini and Key Lime Pie Martini. Printed to order.",
  },
].map((fix) => ({ ...fix, to: SEED_CATALOG.find((item) => item.id === fix.id)[fix.field] }));

function pendingFixes(catalog) {
  return SEED_TEXT_FIXES.filter((fix) => catalog.find((item) => item.id === fix.id)?.[fix.field] === fix.from);
}

export function needsSeedTextFixes(db) {
  return pendingFixes(db.catalog).length > 0;
}

/** Apply the seed corrections still pending; returns how many fields changed. */
export function applySeedTextFixes(db) {
  const pending = pendingFixes(db.catalog);
  for (const fix of pending) {
    db.catalog.find((item) => item.id === fix.id)[fix.field] = fix.to;
  }
  return pending.length;
}

/**
 * Give starter items their product photo, once per SEED_PHOTOS_VERSION. Only
 * items with no photo are touched, so an admin's own photos stay, and a photo
 * an admin removes doesn't come back on the next restart.
 */
export function needsSeedPhotos(db) {
  return (db.meta?.seedPhotos ?? 0) < SEED_PHOTOS_VERSION;
}

export function applySeedPhotos(db) {
  let changed = 0;
  for (const item of db.catalog) {
    const gallery = SEED_PHOTOS[item.id];
    if (!gallery || itemImages(item).length) continue;
    // Only the colours the item is still offered in; failing that, the main photo.
    const offered = gallery.filter((photo) => !photo.color || (item.colors ?? []).includes(photo.color));
    item.images = (offered.length ? offered : [{ ...gallery[0], color: "" }]).map((photo) => ({ ...photo }));
    item.image = item.images[0].url;
    changed += 1;
  }
  db.meta.seedPhotos = SEED_PHOTOS_VERSION;
  return changed;
}

/**
 * Polos come in the nine standard colours: any item named as a polo that has
 * no colours yet gets all nine, once, so an admin can trim them afterwards.
 * Returns the names of the items changed.
 */
export function needsPoloColors(db) {
  return !db.meta?.poloColors;
}

export function applyPoloColors(db) {
  const changed = [];
  for (const item of db.catalog) {
    if (!/\bpolos?\b/i.test(item.name) || (item.colors ?? []).length) continue;
    item.colors = COLOR_OPTIONS.map((c) => c.name);
    changed.push(item.name);
  }
  db.meta.poloColors = 1;
  return changed;
}

/**
 * Items saved before per-order minimums existed have none. Give the starter
 * items their suggested minimum and everything else a minimum of one, once.
 */
export function needsMinimums(db) {
  return db.catalog.some((item) => item.minPerOrder === undefined);
}

export function applyMinimums(db) {
  let raised = 0;
  for (const item of db.catalog) {
    if (item.minPerOrder !== undefined) continue;
    const seed = SEED_CATALOG.find((s) => s.id === item.id);
    item.minPerOrder = seed ? Math.min(seed.minPerOrder, item.maxPerOrder) : 1;
    if (item.minPerOrder > 1) raised += 1;
  }
  return raised;
}

/**
 * The categories changed from Drinkware and Point of Sale to Giveaways and
 * VIP. Move each starter item an admin hasn't recategorized to its new home,
 * and anything else left in a retired category to the nearest new one, once.
 */
export const CATEGORIES_VERSION = 1;
const CATEGORY_MOVES = {
  "jfh-rocks-12": "Drinkware",
  "jfh-shot-24": "Drinkware",
  "twinp-glencairn-6": "Drinkware",
  "td-tumbler": "Drinkware",
  "jfh-mango-shelf-talkers": "Point of Sale",
  "jfh-espresso-neck-hangers": "Point of Sale",
  "jfh-key-lime-table-tents": "Point of Sale",
  "jfh-bar-mat": "Point of Sale",
  "jfh-led-sign": "Point of Sale",
  "twinp-tin-sign": "Point of Sale",
  "jfh-stickers": "Print",
};
const RETIRED_CATEGORIES = { Drinkware: "Giveaways", "Point of Sale": "Print" };

export function needsCategoryMoves(db) {
  return (db.meta?.categories ?? 0) < CATEGORIES_VERSION;
}

export function applyCategoryMoves(db) {
  let moved = 0;
  for (const item of db.catalog) {
    const seed = SEED_CATALOG.find((s) => s.id === item.id);
    let next = item.category;
    if (seed && CATEGORY_MOVES[item.id] === item.category) next = seed.category;
    else if (!CATEGORIES.includes(item.category)) next = RETIRED_CATEGORIES[item.category] ?? "Giveaways";
    if (next !== item.category) {
      item.category = next;
      moved += 1;
    }
  }
  db.meta.categories = CATEGORIES_VERSION;
  return moved;
}

/** Items saved before colours existed: starter items get theirs, others none. */
export function needsColors(db) {
  return db.catalog.some((item) => !Array.isArray(item.colors));
}

export function applyColors(db) {
  let added = 0;
  for (const item of db.catalog) {
    if (Array.isArray(item.colors)) continue;
    item.colors = SEED_COLORS[item.id] ? [...SEED_COLORS[item.id]] : [];
    if (item.colors.length) added += 1;
  }
  return added;
}

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

// Images are an uploaded photo, one of our own files, or (from before
// uploads) an https URL. Anything else (a javascript: or data: URL, a
// protocol-relative path) is refused.
function cleanImage(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  if (IMAGE_PATH_RE.test(text)) return text;
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

  // A blank SKU keeps the item's current one, or is made from its name and
  // category for a new item.
  let sku = cleanText(src.sku, 40).toUpperCase();
  if (!sku && existing) sku = existing.sku;
  if (!sku) {
    const others = catalog.filter((item) => item.id !== existing?.id).map((item) => item.sku);
    sku = generateSku(cleanText(src.name, 120), cleanText(src.category, 40), others);
  }
  if (catalog.some((item) => item.sku === sku && item.id !== existing?.id)) {
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

  // Colours this item comes in, from the shared palette.
  const colorNames = COLOR_OPTIONS.map((c) => c.name);
  const colors = [...new Set((Array.isArray(src.colors) ? src.colors : []).map((c) => cleanText(c, 40)))].filter((c) => colorNames.includes(c));

  // Photos: a gallery, main photo first, each optionally tagged with a colour.
  // Older clients send a single image instead; one that isn't in the gallery
  // becomes the main photo.
  const rawImages = Array.isArray(src.images) ? [...src.images] : [];
  if (typeof src.image === "string" && src.image && !rawImages.some((i) => (typeof i === "string" ? i : i?.url) === src.image)) {
    rawImages.unshift({ url: src.image, color: "" });
  }
  const images = [];
  if (rawImages.length > MAX_IMAGES) errors.image = `An item can have at most ${MAX_IMAGES} photos.`;
  for (const raw of rawImages.slice(0, MAX_IMAGES)) {
    const url = cleanImage(typeof raw === "string" ? raw : raw?.url);
    if (url === null) { errors.image = "That photo couldn't be used. Upload it again."; continue; }
    if (!url || images.some((i) => i.url === url)) continue;
    const color = cleanText(raw?.color, 40);
    images.push({ url, color: colors.includes(color) ? color : "" });
  }
  const image = images[0]?.url ?? "";

  const costCents = parseCents(src.costCents);
  if (costCents === null || costCents > 10_000_000) errors.costCents = "Enter a cost of $0 or more.";

  const maxPerOrder = Number(src.maxPerOrder);
  if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 999) {
    errors.maxPerOrder = "Enter a whole number from 1 to 999.";
  }
  const blankIsOne = (value) => (value === undefined || value === null || value === "" ? 1 : Number(value));
  const minPerOrder = blankIsOne(src.minPerOrder);
  const orderIncrement = blankIsOne(src.orderIncrement);
  if (!Number.isInteger(orderIncrement) || orderIncrement < 1 || orderIncrement > 999) {
    errors.orderIncrement = "Enter a whole number from 1 to 999.";
  }
  if (!Number.isInteger(minPerOrder) || minPerOrder < 1 || minPerOrder > 999) {
    errors.minPerOrder = "Enter a whole number from 1 to 999.";
  } else if (!errors.maxPerOrder && minPerOrder > maxPerOrder) {
    errors.minPerOrder = "The minimum can't be more than the maximum.";
  } else if (!errors.orderIncrement && minPerOrder % orderIncrement) {
    errors.minPerOrder = `Make the minimum a multiple of ${orderIncrement}.`;
  }
  if (!errors.maxPerOrder && !errors.orderIncrement && maxPerOrder % orderIncrement) {
    errors.maxPerOrder = `Make the maximum a multiple of ${orderIncrement}.`;
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
    images,
    colors,
    unit: cleanText(src.unit, 40) || "Each",
    description: cleanText(src.description, 600),
    costCents,
    minPerOrder,
    maxPerOrder,
    orderIncrement,
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
    images: itemImages(item),
    colors: item.colors ?? [],
    unit: item.unit,
    description: item.description,
    costCents: item.costCents,
    minPerOrder: item.minPerOrder ?? 1,
    maxPerOrder: item.maxPerOrder,
    orderIncrement: item.orderIncrement ?? 1,
    variants: item.variants.map((v) => ({ id: v.id, label: v.label, stock: v.stock })),
  };
}
