// Shared by the browser and the server (src/ imports this file directly), so
// the lists a form offers and the values the server accepts cannot drift apart.

export const COMPANY_NAME = "Tropical Distillery";

export const BRANDS = [
  { id: "jf-hadens", label: "J.F. Haden's" },
  { id: "twin-p", label: "Twin P Whiskey" },
  { id: "tropical-distillery", label: "Tropical Distillery" },
];

export const CATEGORIES = [
  "Apparel",
  "Giveaways",
  "Print",
  "Bar Tools",
  "Samples",
  "Sampling & Events",
  "VIP",
];

// Garment colours an item can be offered in, with swatch colours for the shop.
export const COLOR_OPTIONS = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Navy", hex: "#333366" },
  { name: "Burgundy", hex: "#622D3F" },
  { name: "Black", hex: "#222222" },
  { name: "Royal", hex: "#304385" },
  { name: "Red", hex: "#CD0000" },
  { name: "Forest Green", hex: "#2F4F2F" },
  { name: "Grey", hex: "#82817D" },
  { name: "Carolina Blue", hex: "#6A91D4" },
  { name: "Khaki", hex: "#B39B6B" },
];
export const MAX_IMAGES = 10;

/** An item's photos, main one first; items saved before galleries had one. */
export function itemImages(item) {
  if (Array.isArray(item?.images) && item.images.length) return item.images;
  return item?.image ? [{ url: item.image, color: "" }] : [];
}

/** The photo to show for a colour: one tagged with it, else the main photo. */
export function imageFor(item, color = "") {
  const images = itemImages(item);
  return (color && images.find((i) => i.color === color)?.url) || images[0]?.url || "";
}

/** "Navy · L" for an order line or cart line; "for Allie Mindermann" for business cards. */
export function optionText(line) {
  return [line.color, line.variantLabel, line.card?.name ? `for ${line.card.name}` : ""].filter(Boolean).join(" · ");
}

// Business cards are made to order with each person's own details: the
// item says so with `customize: "business-card"`, and each cart and order
// line carries the details as `card`.
export const CARD_FIELDS = [
  { id: "name", label: "Name", max: 40 },
  { id: "title", label: "Title", max: 60 },
  { id: "phone", label: "Phone", max: 30 },
  { id: "email", label: "Email", max: 80 },
  { id: "address", label: "Address", max: 90 },
  { id: "website", label: "Website", max: 60 },
];

export const CARD_DEFAULTS = {
  address: "2141 NW 10th Ave, Miami, FL 33127",
  website: "tropicaldistillery.com",
};

export function isCardItem(item) {
  return item?.customize === "business-card";
}

/** Card details tidied up (spaces, lengths), and what's wrong with them by field. */
export function readCardDetails(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const value = {};
  for (const field of CARD_FIELDS) value[field.id] = String(src[field.id] ?? "").replace(/\s+/g, " ").trim().slice(0, field.max);
  const errors = {};
  if (!value.name) errors.name = "Enter the name for the card.";
  if (!value.phone && !value.email) errors.phone = "Add a phone number or an email.";
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.email = "Enter an email like name@tropicaldistillery.com.";
  return { value, errors };
}

/** Every detail on one line, for exports and the printer: "Allie Mindermann · COO · (954)…". */
export function cardText(card) {
  return CARD_FIELDS.map((field) => card?.[field.id]).filter(Boolean).join(" · ");
}

/** The first three letters of a name, in capitals: "J.F. Haden's" → JFH. */
function firstThreeLetters(text) {
  const letters = String(text ?? "").normalize("NFKD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters || "ITM").padEnd(3, "X").slice(0, 3);
}

// Codes that aren't simply the first three letters: Tropical Distillery is
// TD, and Samples and Sampling & Events would otherwise share SAM.
const BRAND_SKU_CODES = { "tropical-distillery": "TD" };
const CATEGORY_SKU_CODES = { Samples: "SMP", "Sampling & Events": "EVNT" };

/** The start of every SKU for a brand and category: JFH-APP, TD-EVNT. */
export function skuPrefix(brand, category) {
  const brandCode = BRAND_SKU_CODES[brand] ?? firstThreeLetters(labelFor(BRANDS, brand));
  return `${brandCode}-${CATEGORY_SKU_CODES[category] ?? firstThreeLetters(category)}`;
}

/**
 * The next SKU for a brand and category: the first three letters of each and
 * a number, like JFH-APP-014. The number follows the highest one already used
 * with that brand and category, so a deleted item's number isn't reused.
 */
export function generateSku(brand, category, taken = []) {
  const prefix = skuPrefix(brand, category);
  let highest = 0;
  for (const sku of taken) {
    const match = /^([A-Z]{2,3}-[A-Z]{3,4})-(\d+)$/.exec(String(sku).toUpperCase());
    if (match && match[1] === prefix) highest = Math.max(highest, Number(match[2]));
  }
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

/** Items in category order, keeping their order within each category. */
export function byCategory(items) {
  const rank = (item) => {
    const i = CATEGORIES.indexOf(item.category);
    return i === -1 ? CATEGORIES.length : i;
  };
  return items.map((item, i) => [item, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([item]) => item);
}

// Colourways for the product artwork, after the brand and its J.F. Haden's
// flavours. Each maps to CSS variables in styles.css (.tone-<id>). "palm" is
// the house Tropical Distillery look; the id predates the rebrand and stays
// because saved catalog items refer to it.
export const TONES = [
  { id: "palm", label: "Tropical Distillery navy & pink" },
  { id: "sky", label: "Miami sky blue" },
  { id: "mango", label: "Mango" },
  { id: "citrus", label: "Citrus" },
  { id: "lime", label: "Key Lime Pie" },
  { id: "lychee", label: "Lychee" },
  { id: "espresso", label: "Espresso" },
  { id: "oak", label: "Twin P Whiskey oak" },
];

export const ACCOUNT_TYPES = [
  { id: "on-premise", label: "On-premise — bar or restaurant" },
  { id: "off-premise", label: "Off-premise — liquor or retail store" },
  { id: "distributor", label: "Distributor or wholesaler" },
  { id: "event", label: "Event or venue" },
  { id: "other", label: "Other" },
];

export const PURPOSES = [
  { id: "account-activation", label: "Account activation or promotion" },
  { id: "new-placement", label: "New placement" },
  { id: "event", label: "Event or tasting" },
  { id: "team-gear", label: "Team gear or uniform" },
  { id: "sales-kit", label: "Restock my sales kit" },
  { id: "other", label: "Other" },
];

export const STATUSES = [
  { id: "submitted", label: "Submitted" },
  { id: "approved", label: "Approved" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
  { id: "declined", label: "Declined" },
];

// Which status an order may move to next. Cancelling or declining returns the
// order's units to stock; nothing else touches inventory after submission.
export const TRANSITIONS = {
  submitted: ["approved", "shipped", "declined", "cancelled"],
  approved: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  declined: [],
};

export const OPEN_STATUSES = ["submitted", "approved"];
export const RELEASED_STATUSES = ["cancelled", "declined"];

export const CARRIERS = [
  { id: "ups", label: "UPS", trackingUrl: "https://www.ups.com/track?tracknum=" },
  { id: "fedex", label: "FedEx", trackingUrl: "https://www.fedex.com/fedextrack/?trknbr=" },
  { id: "usps", label: "USPS", trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=" },
  { id: "dhl", label: "DHL", trackingUrl: "https://www.dhl.com/us-en/home/tracking.html?tracking-id=" },
  { id: "hand", label: "Hand-delivered", trackingUrl: null },
  { id: "other", label: "Other carrier", trackingUrl: null },
];

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["PR", "Puerto Rico"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"],
  ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

export function labelFor(list, id) {
  return list.find((entry) => entry.id === id)?.label ?? id ?? "";
}

export function formatMoney(cents) {
  const value = Number.isFinite(cents) ? cents : 0;
  return (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/* --------------------------------------------------- item-by-item review */

// Each line of an order can be approved or denied on its own. A line with no
// decision yet counts as going ahead (that's how orders approved as a whole
// were handled before), so only a denied line is left out.
export const LINE_DECISIONS = [
  { id: "approved", label: "Approved" },
  { id: "denied", label: "Not approved" },
];

export function isDenied(line) {
  return line?.decision?.status === "denied";
}

/** The lines that will ship. */
export function shippingLines(order) {
  return order.lines.filter((line) => !isDenied(line));
}

/** Units and value of the lines that will ship. */
export function shippingTotals(order) {
  const lines = shippingLines(order);
  return {
    units: lines.reduce((n, l) => n + l.quantity, 0),
    cents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
  };
}

// Some lines can be forwarded to someone else (a supplier, a rep with stock)
// to ship straight to the order's address. Each forward goes to one person
// and ships on its own; the merch team packs whatever is left.
export const FORWARD_STATUSES = [
  { id: "sent", label: "Waiting to ship" },
  { id: "shipped", label: "Shipped" },
  { id: "cancelled", label: "Pulled back" },
];

// Printers the merch team orders from on their own website, having no API to
// send orders to: the order is kept as a forward to them, with their order
// number, and nobody is emailed. `url` is the product to order, and
// `options` what to pick on it.
export const VENDORS = [
  {
    id: "vistaprint",
    label: "Vistaprint",
    product: "Painted Edge Business Cards",
    url: "https://www.vistaprint.com/business-cards/painted-edge",
    options: "horizontal, Gold edge (#C48A10), color backside",
  },
];

/** Forwards still in play: waiting to ship, or shipped. */
export function activeForwards(order) {
  return (order.forwards ?? []).filter((f) => f.status !== "cancelled");
}

/**
 * The forward a line (one of order.lines) was handed to, or null. One that
 * was pulled back, or whose order was cancelled, no longer counts.
 */
export function forwardOf(order, line) {
  const index = order.lines.indexOf(line);
  return activeForwards(order).find((f) => f.lines.includes(index)) ?? null;
}

/** The lines handed to this forward (each forward keeps their indexes). */
export function forwardLines(order, forward) {
  return forward.lines.map((i) => order.lines[i]).filter(Boolean);
}

/** The approved lines the merch team packs and ships itself: none denied or forwarded. */
export function inHouseLines(order) {
  return shippingLines(order).filter((line) => !forwardOf(order, line));
}

/** How many lines were approved and denied, once the order has been reviewed. */
export function reviewCounts(order) {
  const decided = order.lines.filter((l) => l.decision);
  return {
    reviewed: decided.length > 0,
    approved: order.lines.length - order.lines.filter(isDenied).length,
    denied: order.lines.filter(isDenied).length,
  };
}

export function trackingUrl(carrierId, trackingNumber) {
  const carrier = CARRIERS.find((c) => c.id === carrierId);
  if (!carrier?.trackingUrl || !trackingNumber) return null;
  return carrier.trackingUrl + encodeURIComponent(trackingNumber);
}

// Total units still available for a catalog variant. `null` means the item is
// not stock-tracked (printed or bought to order) and is never limited.
export function availableUnits(variant) {
  return variant && Number.isInteger(variant.stock) ? variant.stock : null;
}

// A sensible per-order cap for an item, from what it costs: one of the
// expensive display pieces, a few mid-priced items, a dozen of the cheap ones.
export function suggestedMaxPerOrder(costCents) {
  if (!Number.isFinite(costCents) || costCents < 0) return null;
  if (costCents >= 10000) return 1;
  if (costCents >= 5000) return 2;
  if (costCents >= 2500) return 4;
  if (costCents >= 1000) return 6;
  return 12;
}

// A sensible minimum for small, cheap items, so nobody ships a single jigger
// across the state. Clothing is ordered per person, so it stays at one.
export function suggestedMinPerOrder(costCents, category) {
  if (!Number.isFinite(costCents) || costCents < 0) return null;
  if (category === "Apparel") return 1;
  if (costCents < 500) return 10;
  if (costCents < 1000) return 3;
  if (costCents < 1500) return 2;
  return 1;
}

// What a case of product sold earns on average, for the ROI calculator in
// the cart.
export const PROFIT_PER_CASE_CENTS = 7500;

/** Return on an order's merch spend if it helps sell `cases` cases. */
export function roiFor(costCents, cases) {
  const profitCents = cases * PROFIT_PER_CASE_CENTS;
  return {
    profitCents,
    netCents: profitCents - costCents,
    roiPercent: costCents > 0 ? Math.round(((profitCents - costCents) / costCents) * 100) : null,
    breakEvenCases: Math.ceil(costCents / PROFIT_PER_CASE_CENTS),
  };
}

/** The minimum for an item; items saved before minimums existed have none. */
export function minPerOrder(item) {
  return Number.isInteger(item?.minPerOrder) && item.minPerOrder > 1 ? item.minPerOrder : 1;
}

/** How many at a time an item is ordered in (6 means 6, 12, 18…). */
export function orderIncrement(item) {
  return Number.isInteger(item?.orderIncrement) && item.orderIncrement > 1 ? item.orderIncrement : 1;
}

/**
 * How many of an item one person may get for each account they ship to (and
 * for themselves), across all their orders, or null for no such limit. The
 * sample bottles have 4.
 */
export function maxPerAccount(item) {
  return Number.isInteger(item?.maxPerAccount) && item.maxPerAccount > 0 ? item.maxPerAccount : null;
}

/** The quantities one order may hold of an item: from min to max in steps. */
export function orderRule(item) {
  const step = orderIncrement(item);
  const min = Math.ceil(Math.max(minPerOrder(item), step) / step) * step;
  const max = Math.floor(item.maxPerOrder / step) * step;
  return { min, max, step };
}

/** Why an order can't hold `total` of an item, or null if it can. */
export function quantityProblem(item, total) {
  const { min, max, step } = orderRule(item);
  if (total > max) return `You can order up to ${max} of ${item.name} per order.`;
  if (total < min) return `${item.name} is ordered in at least ${min} per order.`;
  if (total % step) return `${item.name} is ordered in multiples of ${step}.`;
  return null;
}

/** "Sold in 6s · up to 24 per order", for the shop and the console. */
export function quantityRuleText(item) {
  const { min, max, step } = orderRule(item);
  const parts = [];
  if (step > 1) parts.push(`Sold in ${step}s`);
  if (min > step) parts.push(`min ${min}`);
  const perAccount = maxPerAccount(item);
  // The tighter limit is the one to show.
  if (perAccount && perAccount <= max) parts.push(`up to ${perAccount} per account`);
  else parts.push(max === 1 && min <= 1 ? "1 per order" : `up to ${max} per order`, ...(perAccount ? [`${perAccount} per account`] : []));
  const text = parts.join(" · ");
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * What each person has ordered, for the admin's tracker: their orders, units
 * and order value, and every item they ordered by option and colour, most
 * ordered first. Cancelled and declined orders, and items that weren't
 * approved, don't count.
 *
 * `from` and `to` are ISO times (`to` is exclusive). `people` is the team
 * list: everyone on it gets a row, ordered or not, and orders placed before
 * personal codes (matched by email) land on the same row as later ones.
 */
export function trackByPerson(orders, { from = "", to = "", people = [] } = {}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const rows = new Map();

  const rowFor = (key, person, requester) => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        personId: person?.id ?? null,
        name: person?.name || requester?.name || person?.email || requester?.email || "",
        email: person?.email ?? requester?.email ?? "",
        distributor: requester?.distributor ?? "",
        onList: Boolean(person),
        orders: 0,
        openOrders: 0,
        units: 0,
        valueCents: 0,
        firstOrderAt: null,
        lastOrderAt: null,
        orderIds: [],
        items: new Map(),
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const person of people) rowFor(`person:${person.id}`, person, null);

  for (const order of orders) {
    if (RELEASED_STATUSES.includes(order.status)) continue;
    if (from && order.createdAt < from) continue;
    if (to && order.createdAt >= to) continue;
    // A distributor's reps are their own rows, even with a team member's email.
    const rep = order.requester.distributorId;
    const person = rep ? null : byId.get(order.requester.personId) ?? byEmail.get(order.requester.email) ?? null;
    const key = rep ? `rep:${rep}:${order.requester.email}` : person ? `person:${person.id}` : `email:${order.requester.email}`;
    const row = rowFor(key, person, order.requester);
    // Off the list, the most recent name they typed wins.
    if (!person && order.requester.name && (!row.lastOrderAt || order.createdAt >= row.lastOrderAt)) {
      row.name = order.requester.name;
    }
    const shipped = shippingTotals(order);
    row.orders += 1;
    if (OPEN_STATUSES.includes(order.status)) row.openOrders += 1;
    row.units += shipped.units;
    row.valueCents += shipped.cents;
    if (!row.firstOrderAt || order.createdAt < row.firstOrderAt) row.firstOrderAt = order.createdAt;
    if (!row.lastOrderAt || order.createdAt > row.lastOrderAt) row.lastOrderAt = order.createdAt;
    row.orderIds.push(order.id);
    for (const line of shippingLines(order)) {
      const key = `${line.itemId}::${line.variantId}::${line.color ?? ""}`;
      const item = row.items.get(key) ?? {
        itemId: line.itemId,
        sku: line.sku,
        name: line.name,
        variantLabel: line.variantLabel ?? "",
        color: line.color ?? "",
        quantity: 0,
        valueCents: 0,
        orders: 0,
      };
      item.quantity += line.quantity;
      item.valueCents += line.lineTotalCents;
      item.orders += 1;
      row.items.set(key, item);
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      items: [...row.items.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.valueCents - a.valueCents || b.units - a.units || a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------- distributors */

// State names, lowercased, to their postal codes: "new york" → "ny".
const STATE_CODES = Object.fromEntries(US_STATES.map(([code, name]) => [name.toLowerCase(), code.toLowerCase()]));
// Left out of the initials: "Breakthru Beverage Group of Florida" is td-bbgfl.
const CODE_FILLER = new Set(["of", "and", "the", "a", "an", "inc", "llc", "ltd", "corp", "corporation"]);

/**
 * A distributor's sign-in code: "td-", then the first letter of each word of
 * its name, with a state written out shortened to its postal code and an
 * acronym kept whole. Reyes Beverage Group Florida is td-rbgfl; RNDC Texas
 * is td-rndctx.
 */
export function distributorCodeFor(name) {
  const words = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const parts = [];
  for (let i = 0; i < words.length; i += 1) {
    // Two- and three-word states first: New York, District of Columbia.
    const span = [3, 2].find((n) => STATE_CODES[words.slice(i, i + n).join(" ").toLowerCase()]);
    if (span) {
      parts.push(STATE_CODES[words.slice(i, i + span).join(" ").toLowerCase()]);
      i += span - 1;
      continue;
    }
    const word = words[i];
    const lower = word.toLowerCase();
    if (STATE_CODES[lower]) parts.push(STATE_CODES[lower]);
    else if (CODE_FILLER.has(lower)) continue;
    else if (/^\d+$/.test(word)) parts.push(word);
    else if (word.length > 1 && word === word.toUpperCase()) parts.push(lower);
    else parts.push(lower[0]);
  }
  return `td-${parts.join("").slice(0, 24) || "distributor"}`;
}
