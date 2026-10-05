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
  "Drinkware",
  "Point of Sale",
  "Bar Tools",
  "Sampling & Events",
  "Print",
];

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
