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

/** "Navy · L" for an order line or cart line. */
export function optionText(line) {
  return [line.color, line.variantLabel].filter(Boolean).join(" · ");
}

/** The first three letters of a name, in capitals: "J.F. Haden's" → JFH. */
function firstThreeLetters(text) {
  const letters = String(text ?? "").normalize("NFKD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters || "ITM").padEnd(3, "X").slice(0, 3);
}

// Categories that don't use their first three letters, which Samples and
// Sampling & Events would otherwise share.
const CATEGORY_SKU_CODES = { Samples: "SMP", "Sampling & Events": "EVNT" };

/** The start of every SKU for a brand and category: JFH-APP. */
export function skuPrefix(brand, category) {
  return `${firstThreeLetters(labelFor(BRANDS, brand))}-${CATEGORY_SKU_CODES[category] ?? firstThreeLetters(category)}`;
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
    const match = /^([A-Z]{3}-[A-Z]{3,4})-(\d+)$/.exec(String(sku).toUpperCase());
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

export const SHIPPING_SPEEDS = [
  { id: "standard", label: "Standard", detail: "Ships within 3 business days of approval" },
  { id: "rush", label: "Rush", detail: "Ships the next business day — tell us why" },
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
  parts.push(`up to ${max} per order`);
  const text = parts.join(" · ");
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * What each person has ordered, for the admin's tracker: their orders, units
 * and order value, and every item they ordered by option and colour, most
 * ordered first. Cancelled and declined orders don't count.
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
    const person = byId.get(order.requester.personId) ?? byEmail.get(order.requester.email) ?? null;
    const row = rowFor(person ? `person:${person.id}` : `email:${order.requester.email}`, person, order.requester);
    // Off the list, the most recent name they typed wins.
    if (!person && order.requester.name && (!row.lastOrderAt || order.createdAt >= row.lastOrderAt)) {
      row.name = order.requester.name;
    }
    row.orders += 1;
    if (OPEN_STATUSES.includes(order.status)) row.openOrders += 1;
    row.units += order.totalUnits;
    row.valueCents += order.totalCents;
    if (!row.firstOrderAt || order.createdAt < row.firstOrderAt) row.firstOrderAt = order.createdAt;
    if (!row.lastOrderAt || order.createdAt > row.lastOrderAt) row.lastOrderAt = order.createdAt;
    row.orderIds.push(order.id);
    for (const line of order.lines) {
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
