// The starter catalog and the rules for editing it.
//
// Costs and stock levels below are placeholders to be replaced from the admin
// console (Catalog tab) with real numbers. The seed is only used when a store
// is created for the first time; after that the catalog lives in the store.

import { BRANDS, CATEGORIES, COLOR_OPTIONS, MAX_IMAGES, TONES, byCategory, generateSku, itemImages, skuPrefix, suggestedMinPerOrder } from "../public/assets/shared.js";
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
const ALL_COLORS = ["White", "Navy", "Burgundy", "Black", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"];
const SEED_COLORS = {
  "td-team-polo": ALL_COLORS,
  "jfh-polo": ALL_COLORS,
  "jfh-good-spirits-tee": ["White", "Navy", "Burgundy", "Black", "Forest Green", "Grey", "Carolina Blue"],
  "jfh-martini-tee": ["White", "Black", "Navy", "Grey", "Carolina Blue"],
  "jfh-gradient-tee": ["White"],
  "jfh-gradient-crop": ["White", "Black"],
  "jfh-dad-hat": ["Burgundy", "Navy", "Khaki"],
};

// The spirits themselves, for tastings, events and accounts: every J.F.
// Haden's flavour and Twin P Whiskey as a 750 ml bottle and as a case.
const CASE_SIZE = 6;
const BOTTLE_COST_CENTS = 1500; // a placeholder, like every starter cost
const PRODUCTS = [
  ["citrus", "Citrus Liqueur", "citrus", "Made with 100% Florida citrus."],
  ["espresso", "Espresso Liqueur", "espresso", "Made with 100% real espresso."],
  ["key-lime-pie", "Key Lime Pie Liqueur", "lime", "Made with 100% real key lime."],
  ["lychee", "Lychee Liqueur", "lychee", "Made with 100% real lychee."],
  ["mango", "Mango Liqueur", "mango", "Made with 100% real mango."],
  ["orange", "Orange Liqueur", "mango", "Made with 100% Florida oranges."],
]
  .map(([flavor, liqueur, tone, made]) => ({ key: `jfh-${flavor}`, flavor, product: `J.F. Haden's ${liqueur}`, brand: "jf-hadens", tone, made }))
  .concat({ key: "twinp", flavor: "", product: "Twin P Whiskey", brand: "twin-p", tone: "oak", made: "Smooth and full-bodied, with notes of oak, vanilla and warm spice." });
const SPIRITS = PRODUCTS.flatMap((p) => [
  { ...p, id: `${p.key}-bottle`, kind: "bottle" },
  { ...p, id: `${p.key}-case`, kind: "case" },
]);

// The 50 ml samples these replaced, the day they went in. They are removed
// from a store that has them, unless an admin has renamed them.
const RETIRED_SAMPLES = PRODUCTS.map(({ flavor, product }) => ({
  id: flavor ? `jfh-sample-${flavor}` : "twinp-sample",
  name: `${product} Sample, 50 ml`,
}));

// Product photos for the starter items, in public/assets/merch, main photo
// first: one named after the item, numbered ones for a gallery, or one per
// colour (td-team-polo-navy.jpg). Bump the version when photos are added so
// existing stores pick them up once. The polos' main photo is Royal, the
// colour they were actually photographed in. Version 3: the booklet's photo.
export const SEED_PHOTOS_VERSION = 3;
const photo = (file, color = "") => ({ url: `/assets/merch/${file}.jpg`, color });
const one = (id) => [photo(id)];
const numbered = (id, n) => Array.from({ length: n }, (_, i) => photo(`${id}-${i + 1}`));
const perColor = (id, main) => [main, ...SEED_COLORS[id].filter((c) => c !== main)].map((c) => photo(`${id}-${slug(c)}`, c));
export const SEED_PHOTOS = {
  "jfh-logo-tee": one("jfh-logo-tee"),
  "td-team-polo": perColor("td-team-polo", "Royal"),
  "jfh-polo": perColor("jfh-polo", "Royal"),
  "jfh-espresso-tee": numbered("jfh-espresso-tee", 5),
  "jfh-espresso-tank": one("jfh-espresso-tank"),
  // printed on the back: black first, then every colour
  "jfh-good-spirits-tee": perColor("jfh-good-spirits-tee", "Black"),
  // on the models (in white) first, then every colour
  "jfh-martini-tee": [photo("jfh-martini-tee-woman", "White"), photo("jfh-martini-tee-man", "White"), ...perColor("jfh-martini-tee", "White")],
  "jfh-cap": one("jfh-cap"),
  "twinp-trucker": one("twinp-trucker"),
  // printed on the back
  "twinp-game-day-tee": one("twinp-game-day-tee"),
  "twinp-sunday-funday-tee": one("twinp-sunday-funday-tee"),
  "twinp-sunday-funday-hat": one("twinp-sunday-funday-hat"),
  "twinp-sunday-funday-tote": one("twinp-sunday-funday-tote"),
  "jfh-bar-mat": one("jfh-bar-mat"),
  "jfh-spill-mat": one("jfh-spill-mat"),
  "jfh-lychee-pin": one("jfh-lychee-pin"),
  "jfh-koozies": one("jfh-koozies"),
  "jfh-espresso-coasters": one("jfh-espresso-coasters"),
  "jfh-espresso-stickers": one("jfh-espresso-stickers"),
  "jfh-throw-pillow": numbered("jfh-throw-pillow", 2),
  "jfh-key-lime-colada-talkers": one("jfh-key-lime-colada-talkers"),
  "jfh-tote-bag": one("jfh-tote-bag"),
  "jfh-beach-towel": one("jfh-beach-towel"),
  "jfh-cobbler-shaker": one("jfh-cobbler-shaker"),
  "td-cobbler-shaker": one("td-cobbler-shaker"),
  "jfh-stirrers": one("jfh-stirrers"),
  "jfh-sample-cups": one("jfh-sample-cups"),
  "td-booklet": one("td-booklet"),
  // the photo from the pool first, then the studio shot
  "jfh-pool-koozie": numbered("jfh-pool-koozie", 2),
  "jfh-bluetooth-speaker": one("jfh-bluetooth-speaker"),
  "jfh-drake-tumbler": one("jfh-drake-tumbler"),
  "jfh-square-coasters": one("jfh-square-coasters"),
  "jfh-phone-stand": one("jfh-phone-stand"),
  "jfh-napkin-caddy": one("jfh-napkin-caddy"),
  "jfh-wine-bag": one("jfh-wine-bag"),
  "jfh-lip-balm": one("jfh-lip-balm"),
  "jfh-gradient-tee": perColor("jfh-gradient-tee", "White"),
  "jfh-gradient-crop": perColor("jfh-gradient-crop", "White"),
  "jfh-dad-hat": perColor("jfh-dad-hat", "Burgundy"),
  "jfh-martini-keychain-color": one("jfh-martini-keychain-color"),
  "jfh-martini-keychain-line": one("jfh-martini-keychain-line"),
  "jfh-sunglasses-laser": one("jfh-sunglasses-laser"),
  "jfh-sunglasses-vicky": one("jfh-sunglasses-vicky"),
  "jfh-sunglasses-rainbow": one("jfh-sunglasses-rainbow"),
  "jfh-sunglasses-andy-green": one("jfh-sunglasses-andy-green"),
  "jfh-sunglasses-andy-black": one("jfh-sunglasses-andy-black"),
  ...Object.fromEntries(SPIRITS.map(({ id }) => [id, one(id)])),
};

// Where an admin orders each item from. Merch comes through Ten 10 Design
// unless an item says otherwise, and any item can carry a link for ordering
// it online instead. Only admins see this; it is never part of what the
// store shows. The details for the starter items come from the vendor proofs.
export const SUPPLIER_FIELDS = { company: 120, contact: 120, email: 160, phone: 40, link: 500, itemNumber: 160, notes: 600 };
export const DEFAULT_SUPPLIER = "Ten 10 Design LLC";
const emptySupplier = () => Object.fromEntries(Object.keys(SUPPLIER_FIELDS).map((k) => [k, ""]));
const TEN10 = DEFAULT_SUPPLIER;
const SPIRITS_SHIPPING =
  "Pulled from distillery stock. Spirits can't go by USPS: hand-deliver, or ship with a carrier the distillery has an alcohol shipping agreement with.";
const SEED_SUPPLIERS = {
  ...Object.fromEntries(
    SPIRITS.map(({ id, product, kind }) => [
      id,
      { company: "Tropical Distillery (own stock)", itemNumber: kind === "case" ? `${product}, case of ${CASE_SIZE} × 750 ml` : `${product}, 750 ml`, notes: SPIRITS_SHIPPING },
    ])
  ),
  "td-booklet": { itemNumber: "Saddle-stitched booklet" },
  "jfh-tote-bag": { itemNumber: "337572 Full Color Sublimated Canvas Everyday Bag with Zipper Closure", notes: "Top zipper in white; base band PMS 4260 C; logo front and back." },
  "jfh-beach-towel": { company: TEN10, itemNumber: "BP1518SB sublimated towel, 28 × 56 in, white", notes: "Sales order 1282403; 50 ordered." },
  "jfh-pool-koozie": { notes: "Inflatable stars-and-stripes drink float, 7.87 in." },
  "jfh-lip-balm": { itemNumber: "IBALM, Orange, Vanilla flavor", notes: "SO6664443, WO1267123. Logo printed in black on top." },
  "jfh-gradient-tee": { itemNumber: "Next Level 6210 tee (60/40 cotton/poly), white", notes: "PO 21165-B, design 32739. Full front, 10 × 2.6 in: black, PMS 674 C pink, 2725 C purple, 311 C blue." },
  "jfh-gradient-crop": { itemNumber: "1501 long sleeve crop top (52/48 cotton/poly), white and black", notes: "PO 21165-B: design 32739 on white, 32741 on black (white outline and tagline). PMS 674 C, 2725 C, 311 C." },
  "jfh-dad-hat": { itemNumber: "Washed (pigment-dyed) dad cap", notes: "Varsity J.F. HADEN'S across the front: navy with a light blue outline on burgundy, brown with an orange outline on navy, light blue with a navy outline on khaki." },
  "jfh-martini-keychain-color": { itemNumber: "Acrylic keychain, espresso martini glass die cut", notes: "Full-colour hand-drawn version, logo in orange." },
  "jfh-martini-keychain-line": { itemNumber: "Acrylic keychain, espresso martini glass die cut", notes: "Black-and-white line-art version, logo in orange." },
  "jfh-sunglasses-laser": { itemNumber: "Laser sunglasses, black, dark UV400 lenses", notes: "Proof 44400: logo screen printed white on the left arm (1.16 × 0.3 in) and the left lens corner (0.55 × 1.14 in)." },
  "jfh-sunglasses-vicky": { itemNumber: "Vicky sunglasses, stock green, dark UV400 lenses", notes: "Proof 44400: logo screen printed white on the left arm (0.72 × 0.18 in)." },
  "jfh-sunglasses-rainbow": { itemNumber: "Retro Pride Rainbow sunglasses, dark UV400 lenses", notes: "Proof 44400: logo UV printed white on the left arm (1.45 × 0.37 in)." },
  "jfh-sunglasses-andy-green": { itemNumber: "Andy sunglasses, stock green, pink mirror lenses", notes: "Logo on the left arm (1.10 × 0.25 in) in PMS 1495 C, PMS 732 C and black." },
  "jfh-sunglasses-andy-black": { itemNumber: "Andy sunglasses, black, pink mirror lenses", notes: "Logo on the left arm (1.10 × 0.25 in) in PMS 1495 C, PMS 732 C and white." },
  "jfh-drake-tumbler": { company: TEN10, itemNumber: "PCNA 1602-14 Drake Eco-Friendly Vacuum Insulated Tumbler 16 oz, Midnight Blue", notes: "Leed's proof 496309, order L0461549-0, PO 8574-6309. Laser engraved 1.5 × 0.34 in, centred 3.23 in up." },
  "jfh-square-coasters": { company: TEN10, itemNumber: "D-C35SQ35 35 pt 3.5 in square coaster, 1-sided", notes: "SO 709242, PO 8574-6312. 250 ordered, packed 25." },
  "jfh-phone-stand": { itemNumber: "WSC195 bamboo phone stand", notes: "Job 9406544, order 1304439. Laser engraved." },
  "jfh-wine-bag": { company: TEN10, itemNumber: "Chablis wine bag, black", notes: "PO 8596-6213, proof 2620042. HM-9 Metallic Gold, 3.5 × 0.8 in, centred. 300 ordered." },
  "jfh-cobbler-shaker": { notes: "Matte black cobbler shaker; J.F. Haden's on one side, Miami in a Bottle on the other, white." },
  "jfh-napkin-caddy": { itemNumber: "#7107-01 bar caddy", notes: "Proof 25_261b_PM. Full-colour logo on the front." },
  "jfh-bluetooth-speaker": { company: TEN10, itemNumber: "PCNA 7195-78 Micro Mag Magnetic Bluetooth Speaker, Black", notes: "Leed's proof 496308, order L0461549-0, PO 8574-6309. White, 0.85 × 0.19 in above the power button." },
};

function sized(stockBySize) {
  return SIZES.map((size, i) => ({ id: size.toLowerCase(), label: size, stock: stockBySize[i] }));
}

function single(stock) {
  return [{ id: "default", label: "", stock }];
}

export const SEED_CATALOG = [
  // Apparel
  {
    id: "jfh-logo-tee", name: "J.F. Haden's Logo Tee",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "tee", unit: "Each",
    description: "Soft ring-spun cotton tee with the J.F. Haden's mango mark on the chest. Good for tastings and ride-alongs.",
    costCents: 1150, maxPerOrder: 6, variants: sized([8, 14, 14, 10, 6, 3]),
  },
  {
    id: "td-team-polo", name: "Tropical Distillery Team Polo",
    brand: "tropical-distillery", category: "Apparel", tone: "palm", art: "polo", unit: "Each",
    description: "Moisture-wicking polo with the embroidered Tropical Distillery logo. The standard uniform for account visits and trade shows.",
    costCents: 2600, maxPerOrder: 3, variants: sized([4, 8, 8, 6, 4, 2]),
  },
  {
    id: "jfh-polo", name: "J.F. Haden's Polo",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "polo", unit: "Each",
    description: "Moisture-wicking polo with the J.F. Haden's logo embroidered on the chest. Sharp enough for account visits, tastings and trade shows.",
    costCents: 2600, maxPerOrder: 3, variants: sized([4, 8, 8, 6, 4, 2]),
  },
  {
    id: "jfh-espresso-tee", name: "In My Espresso Martini Era Tee",
    brand: "jf-hadens", category: "Apparel", tone: "espresso", art: "tee", unit: "Each",
    description: "Soft white tee with the In My Espresso Martini Era badge on the chest or the big print, and the J.F. Haden's logo. Made for Espresso Liqueur nights.",
    costCents: 1400, maxPerOrder: 6, variants: sized([6, 12, 12, 8, 4, 2]),
  },
  {
    id: "jfh-espresso-tank", name: "In My Espresso Martini Era Tank",
    brand: "jf-hadens", category: "Apparel", tone: "espresso", art: "tee", unit: "Each",
    description: "White racerback tank with the In My Espresso Martini Era print and the J.F. Haden's logo. Great for summer events.",
    costCents: 1300, maxPerOrder: 6, variants: sized([6, 10, 10, 6, 3, 1]),
  },
  {
    id: "jfh-good-spirits-tee", name: "Good Spirits Only Tee",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "tee", unit: "Each",
    description: "Retro striped GOOD SPIRITS ONLY in orange, sky blue and pink, with the J.F. Haden's logo, printed on the back.",
    costCents: 1400, maxPerOrder: 6, variants: sized([6, 12, 12, 8, 4, 2]),
  },
  {
    id: "jfh-martini-tee", name: "J.F. Haden's Martini Glass Tee",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "tee", unit: "Each",
    description: "A hand-drawn martini glass made of all six J.F. Haden's flavors (mango, espresso, key lime, citrus, lychee and orange) with the J.F. Haden's logo, printed on the front.",
    costCents: 1400, maxPerOrder: 6, variants: sized([6, 12, 12, 8, 4, 2]),
  },
  {
    id: "jfh-gradient-tee", name: "J.F. Haden's Gradient Logo Tee",
    brand: "jf-hadens", category: "Apparel", tone: "lychee", art: "tee", unit: "Each",
    description: "Soft Next Level tee in white with the J.F. Haden's logo across the chest in a blue-to-pink gradient.",
    costCents: 1300, maxPerOrder: 6, variants: sized([6, 12, 12, 8, 4, 2]),
  },
  {
    id: "jfh-gradient-crop", name: "J.F. Haden's Gradient Logo Long Sleeve Crop Top",
    brand: "jf-hadens", category: "Apparel", tone: "lychee", art: "tee", unit: "Each",
    description: "Fitted long sleeve crop top with the J.F. Haden's gradient logo on the chest. White, or black with the logo outlined in white.",
    costCents: 1500, maxPerOrder: 6, variants: sized([6, 10, 10, 6, 3, 1]),
  },
  {
    id: "jfh-dad-hat", name: "J.F. Haden's Washed Dad Hat",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "cap", unit: "Each",
    description: "Soft washed-cotton dad hat with J.F. HADEN'S in varsity letters across the front. Adjustable strap.",
    costCents: 1400, maxPerOrder: 4, variants: single(36),
  },
  {
    id: "jfh-cap", name: "J.F. Haden's Embroidered Cap",
    brand: "jf-hadens", category: "Apparel", tone: "mango", art: "cap", unit: "Each",
    description: "Unstructured cotton cap with an adjustable strap.",
    costCents: 1400, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "twinp-trucker", name: "Twin P Whiskey Trucker Hat",
    brand: "twin-p", category: "Apparel", tone: "oak", art: "cap", unit: "Each",
    description: "Mesh-back trucker with a leather Twin P patch.",
    costCents: 1300, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "twinp-game-day-tee", name: "From Happy Hour to Game Day Tee",
    brand: "twin-p", category: "Apparel", tone: "oak", art: "tee", unit: "Each",
    description: "White tee with FROM HAPPY HOUR TO GAME DAY in navy and gold varsity letters and the Twin P Whiskey badge, printed on the back.",
    // Added after the 7 Oct 2026 stock reset, so it starts at 0 like everything else until it's counted.
    costCents: 1400, maxPerOrder: 6, variants: sized([0, 0, 0, 0, 0, 0]),
  },
  // The Sunday Funday set, also added after the stock reset.
  {
    id: "twinp-sunday-funday-tee", name: "Sunday Funday Tee",
    brand: "twin-p", category: "Apparel", tone: "oak", art: "tee", unit: "Each",
    description: "Royal blue tee with SUNDAY FUNDAY in white and gold block letters around a Twin P Whiskey football helmet, printed on the front.",
    costCents: 1400, maxPerOrder: 6, variants: sized([0, 0, 0, 0, 0, 0]),
  },
  {
    id: "twinp-sunday-funday-hat", name: "Sunday Funday Dad Hat",
    brand: "twin-p", category: "Apparel", tone: "oak", art: "cap", unit: "Each",
    description: "Royal blue cotton dad hat with the SUNDAY FUNDAY Twin P Whiskey helmet design on the front.",
    costCents: 1400, maxPerOrder: 4, variants: single(0),
  },
  {
    id: "jfh-apron", name: "J.F. Haden's Bartender Apron",
    brand: "jf-hadens", category: "Apparel", tone: "espresso", art: "apron", unit: "Each",
    description: "Waxed canvas bib apron with leather straps — a thank-you for the bartenders who pour us.",
    costCents: 2200, maxPerOrder: 6, variants: single(18),
  },

  // Giveaways, bar tools and VIP pieces
  {
    id: "jfh-rocks-12", name: "J.F. Haden's Etched Rocks Glasses",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "rocks", unit: "Case of 12",
    description: "10 oz double old fashioned glasses with an etched logo, for feature-cocktail programs.",
    costCents: 4200, maxPerOrder: 4, variants: single(25),
  },
  {
    id: "jfh-shot-24", name: "J.F. Haden's Shot Glasses",
    brand: "jf-hadens", category: "Giveaways", tone: "lime", art: "shot", unit: "Pack of 24",
    description: "1.5 oz shot glasses with the J.F. Haden's logo in Key Lime Pie green.",
    costCents: 2900, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "twinp-glencairn-6", name: "Twin P Whiskey Tasting Glasses",
    brand: "twin-p", category: "VIP", tone: "oak", art: "glencairn", unit: "Pack of 6",
    description: "Glencairn-style nosing glasses for whiskey dinners and tastings.",
    costCents: 4500, maxPerOrder: 2, variants: single(12),
  },
  {
    id: "td-tumbler", name: "Tropical Distillery Insulated Tumbler",
    brand: "tropical-distillery", category: "Giveaways", tone: "palm", art: "tumbler", unit: "20 oz",
    description: "Stainless steel tumbler with a slide lid and straw.",
    costCents: 1600, maxPerOrder: 4, variants: single(40),
  },

  // Print and display
  {
    id: "jfh-mango-shelf-talkers", name: "Mango Liqueur Shelf Talkers",
    brand: "jf-hadens", category: "Print", tone: "mango", art: "shelf-talker", unit: "Pack of 25",
    description: "Clip-on shelf talkers with tasting notes and a QR code to the cocktail menu. For off-premise accounts.",
    costCents: 1500, maxPerOrder: 10, variants: single(60),
  },
  {
    id: "jfh-espresso-neck-hangers", name: "Espresso Liqueur Neck Hangers",
    brand: "jf-hadens", category: "Print", tone: "espresso", art: "neck-hanger", unit: "Pack of 50",
    description: "Espresso Martini recipe neck hangers. Fit standard 750 ml necks.",
    costCents: 2000, maxPerOrder: 10, variants: single(45),
  },
  {
    id: "jfh-key-lime-table-tents", name: "Key Lime Pie Liqueur Table Tents",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "table-tent", unit: "Pack of 12",
    description: "Key Lime Pie Martini table tents for on-premise accounts, with space for the venue to write its price.",
    costCents: 1800, maxPerOrder: 6, variants: single(40),
  },
  {
    id: "jfh-bar-mat", name: "J.F. Haden's Rubber Bar Mat",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "bar-mat", unit: "Each",
    description: "20 × 3.5 in service-well bar mat.",
    costCents: 2200, maxPerOrder: 4, variants: single(35),
  },
  {
    id: "jfh-led-sign", name: "J.F. Haden's LED Back-bar Sign",
    brand: "jf-hadens", category: "VIP", tone: "mango", art: "neon", unit: "Each",
    description: "Low-voltage LED sign, 24 × 14 in, with wall mount and a 6 ft cord. For priority on-premise accounts.",
    costCents: 14500, maxPerOrder: 1, variants: single(6),
  },
  {
    id: "twinp-tin-sign", name: "Twin P Whiskey Tin Sign",
    brand: "twin-p", category: "VIP", tone: "oak", art: "tin-sign", unit: "Each",
    description: "Embossed 18 × 12 in tin sign, pre-drilled for hanging.",
    costCents: 3800, maxPerOrder: 2, variants: single(10),
  },

  // Bar Tools
  {
    id: "td-shaker-set", name: "Branded Shaker Tin Set",
    brand: "tropical-distillery", category: "Bar Tools", tone: "palm", art: "shaker", unit: "Set of 2",
    description: "Weighted 28 oz and 18 oz Boston tins, laser-etched.",
    costCents: 1900, maxPerOrder: 6, variants: single(24),
  },
  {
    id: "td-cobbler-shaker", name: "Tropical Distillery Cobbler Shaker",
    brand: "tropical-distillery", category: "Bar Tools", tone: "palm", art: "shaker", unit: "Each",
    description: "Polished stainless steel cobbler shaker with a built-in strainer and cap, and the Tropical Distillery palm logo in blue and pink.",
    // Added after the 7 Oct 2026 stock reset, so it starts at 0 until it's counted.
    costCents: 1600, maxPerOrder: 6, variants: single(0),
  },
  {
    id: "jfh-jigger", name: "J.F. Haden's Japanese Jigger",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "jigger", unit: "Each",
    description: "1 oz / 2 oz stainless jigger with interior measure lines.",
    costCents: 750, maxPerOrder: 12, variants: single(50),
  },

  // Sampling & Events
  {
    id: "td-tasting-kit", name: "Tasting Event Kit",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "kit", unit: "Kit",
    description: "Everything for an in-store tasting: branded table runner, 200 sample cups, 50 recipe cards, a sign-in sheet and a bottle riser.",
    costCents: 6500, maxPerOrder: 2, variants: single(10),
  },
  {
    id: "td-sample-cups", name: "Sample Cups, 1 oz",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "cups", unit: "Sleeve of 250",
    description: "Clear 1 oz plastic sampling cups. Bought to order, so never out of stock.",
    costCents: 1100, maxPerOrder: 8, variants: single(null),
  },
  {
    id: "jfh-sample-cups", name: "J.F. Haden's Clear Sample Cups",
    brand: "jf-hadens", category: "Sampling & Events", tone: "mango", art: "cups", unit: "Sleeve",
    description: "Clear plastic tasting cups printed in black with the J.F. Haden's wordmark and AMERICA'S CRAFT LIQUEUR COMPANY™. For samples at tastings and events.",
    // Added after the 7 Oct 2026 stock reset, so it starts at 0 until it's counted.
    costCents: 1000, maxPerOrder: 10, variants: single(0),
  },
  // 750 ml bottles and cases (see SPIRITS)
  ...SPIRITS.map(({ id, product, brand, tone, made, kind }) =>
    kind === "case"
      ? {
          id, name: `${product}, Case of ${CASE_SIZE}`,
          brand, category: "Samples", tone, art: "bottle", unit: `Case of ${CASE_SIZE} × 750 ml`,
          description: `A case of ${CASE_SIZE} bottles (750 ml each) of ${product}, for events, activations and accounts. ${made}`,
          costCents: BOTTLE_COST_CENTS * CASE_SIZE, minPerOrder: 1, maxPerOrder: 2, variants: single(10),
        }
      : {
          id, name: `${product}, 750 ml`,
          brand, category: "Samples", tone, art: "bottle", unit: "750 ml bottle",
          description: `A 750 ml bottle of ${product} for account visits, tastings and events. ${made}`,
          costCents: BOTTLE_COST_CENTS, minPerOrder: 1, maxPerOrder: 6, variants: single(24),
        }
  ),
  {
    id: "td-table-throw", name: "6 ft Table Throw",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "palm", art: "table-throw", unit: "Each",
    description: "Fitted, full-colour table throw for festivals and trade shows. Machine washable.",
    costCents: 8900, maxPerOrder: 1, variants: single(5),
  },
  {
    id: "td-pullup-banner", name: "Retractable Pull-up Banner",
    brand: "tropical-distillery", category: "Sampling & Events", tone: "mango", art: "banner", unit: "Each",
    description: "33 × 80 in portfolio banner with a carry case.",
    costCents: 12000, maxPerOrder: 1, variants: single(4),
  },

  // Print
  {
    id: "td-sell-sheets", name: "Portfolio Sell Sheets",
    brand: "tropical-distillery", category: "Print", tone: "palm", art: "sheets", unit: "Pack of 50",
    description: "Two-sided sell sheets for all six J.F. Haden's flavors (Citrus, Espresso, Key Lime Pie, Lychee, Mango and Orange) and Twin P Whiskey: tasting notes, SKUs, case packs and UPCs. Printed to order.",
    costCents: 2200, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "td-booklet", name: "Tropical Distillery Portfolio Booklet",
    brand: "tropical-distillery", category: "Print", tone: "palm", art: "sheets", unit: "Each",
    description: "Saddle-stitched booklet with the Tropical Distillery portfolio, J.F. Haden's liqueurs and Twin P Whiskey, to leave with accounts. Ordered in tens. Printed to order.",
    costCents: 250, minPerOrder: 10, maxPerOrder: 100, orderIncrement: 10, variants: single(null),
  },
  {
    id: "jfh-recipe-cards", name: "Signature Cocktail Recipe Cards",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "cards", unit: "Pack of 100",
    description: "Pocket recipe cards for J.F. Haden's signature cocktails: Iced Coffee, Tropical Sunset, Pink Lotus and Key Lime Pie Martini. Printed to order.",
    costCents: 1800, maxPerOrder: 6, variants: single(null),
  },
  {
    id: "jfh-stickers", name: "J.F. Haden's Logo Stickers",
    brand: "jf-hadens", category: "Giveaways", tone: "mango", art: "sticker", unit: "Pack of 100",
    description: "3 in die-cut vinyl stickers.",
    costCents: 2500, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "jfh-espresso-stickers", name: "Espresso Martini Era Stickers",
    brand: "jf-hadens", category: "Giveaways", tone: "espresso", art: "sticker", unit: "Pack of 50",
    description: "Glossy vinyl stickers: the 3 in round In My Espresso Martini Era badge and the 4 in die-cut print, mixed.",
    costCents: 2200, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "jfh-lychee-pin", name: "Lychee Liqueur Bottle Enamel Pin",
    brand: "jf-hadens", category: "Giveaways", tone: "lychee", art: "bottle", unit: "Each",
    description: "Hard-enamel pin of the J.F. Haden's Lychee bottle with a gold-tone finish and rubber clutch. Ordered in tens.",
    costCents: 350, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(200),
  },
  {
    id: "jfh-koozies", name: "Good Spirits Only Can Koozies",
    brand: "jf-hadens", category: "Giveaways", tone: "mango", art: "tumbler", unit: "Pack of 25",
    description: "Collapsible neoprene can koozies, black and white mixed, printed with Good Spirits Only and the J.F. Haden's logo.",
    costCents: 3000, maxPerOrder: 4, variants: single(12),
  },
  {
    id: "jfh-espresso-coasters", name: "Espresso Martini Era Coasters",
    brand: "jf-hadens", category: "Giveaways", tone: "espresso", art: "cards", unit: "Pack of 100",
    description: "4 in round pulpboard coasters, In My Espresso Martini Era on one design and the J.F. Haden's logo on the other. A bar favourite.",
    costCents: 2800, maxPerOrder: 4, variants: single(15),
  },
  {
    id: "jfh-throw-pillow", name: "J.F. Haden's Throw Pillow",
    brand: "jf-hadens", category: "VIP", tone: "mango", art: "table-throw", unit: "Each",
    description: "18 in square cream and orange throw pillow with the J.F. Haden's logo, Miami in a Bottle on the back. A thank-you for top accounts.",
    costCents: 3200, maxPerOrder: 2, variants: single(10),
  },
  {
    id: "jfh-key-lime-colada-talkers", name: "Key Lime Pie Colada Shelf Talkers",
    brand: "jf-hadens", category: "Print", tone: "lime", art: "shelf-talker", unit: "Pack of 25",
    description: "Clip-on shelf talkers with the Key Lime Pie Colada recipe and a QR code to more cocktails.",
    costCents: 1500, maxPerOrder: 10, variants: single(30),
  },
  {
    id: "jfh-spill-mat", name: "J.F. Haden's Square Spill Mat",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "bar-mat", unit: "Each",
    description: "12 x 12 in rubber spill mat for the service well, with the J.F. Haden's logo.",
    costCents: 1800, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "jfh-tote-bag", name: "J.F. Haden's Zipper Tote Bag",
    brand: "jf-hadens", category: "Giveaways", tone: "oak", art: "kit", unit: "Each",
    description: "Soft sublimated canvas tote, 17.5 × 12.5 in with a 5 in gusset and a white top zipper. Cream with a tan base and the J.F. Haden's logo on both sides.",
    costCents: 1400, maxPerOrder: 6, variants: single(30),
  },
  {
    id: "twinp-sunday-funday-tote", name: "Sunday Funday Tote Bag",
    brand: "twin-p", category: "Giveaways", tone: "oak", art: "kit", unit: "Each",
    description: "Royal blue canvas tote with long handles and the SUNDAY FUNDAY Twin P Whiskey helmet design on the front.",
    // Added after the 7 Oct 2026 stock reset.
    costCents: 1400, maxPerOrder: 6, variants: single(0),
  },
  {
    id: "jfh-beach-towel", name: "J.F. Haden's Beach Towel",
    brand: "jf-hadens", category: "Giveaways", tone: "oak", art: "table-throw", unit: "Each",
    description: "28 × 56 in sublimated beach towel, cream with tan stripes and the J.F. Haden's logo.",
    costCents: 1800, maxPerOrder: 4, variants: single(50),
  },
  {
    id: "jfh-pool-koozie", name: "J.F. Haden's Pool Koozie",
    brand: "jf-hadens", category: "Giveaways", tone: "sky", art: "tumbler", unit: "Each",
    description: "Inflatable stars-and-stripes drink float, 7.87 in across, that holds a can or cup in the pool. J.F. Haden's logo on the ring. Ordered in tens.",
    costCents: 250, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(200),
  },
  ...[
    ["laser", "Laser Sunglasses", "Square-front Laser sunglasses in black with dark UV400 lenses, the J.F. Haden's logo in white on the left arm and the corner of the left lens.", "espresso"],
    ["vicky", "Vicky Sunglasses", "Round Vicky sunglasses in green with dark UV400 lenses and the J.F. Haden's logo in white on the left arm.", "lime"],
    ["rainbow", "Retro Pride Rainbow Sunglasses", "Classic-shape sunglasses printed in rainbow stripes, white inside, with dark UV400 lenses and the J.F. Haden's logo in white on the left arm.", "palm"],
    ["andy-green", "Andy Sunglasses, Green", "Round Andy sunglasses in green with pink mirror lenses and the full-colour J.F. Haden's logo on the left arm.", "lime"],
    ["andy-black", "Andy Sunglasses, Black", "Round Andy sunglasses in black with pink mirror lenses and the J.F. Haden's logo on the left arm.", "espresso"],
  ].map(([style, name, description, tone], i) => ({
    id: `jfh-sunglasses-${style}`, sku: `TD-GIV-${String(13 + i).padStart(3, "0")}`, name: `J.F. Haden's ${name}`,
    brand: "jf-hadens", category: "Giveaways", tone, art: "kit", unit: "Each",
    description, costCents: 450, maxPerOrder: 20, variants: single(50),
  })),
  {
    id: "jfh-lip-balm", name: "J.F. Haden's Lip Balm",
    brand: "jf-hadens", category: "Giveaways", tone: "mango", art: "kit", unit: "Each",
    description: "Vanilla lip balm in a round orange ball, with the J.F. Haden's logo on top. Ordered in tens.",
    costCents: 150, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(200),
  },
  {
    id: "jfh-martini-keychain-color", name: "J.F. Haden's Espresso Martini Keychain",
    brand: "jf-hadens", category: "Giveaways", tone: "espresso", art: "kit", unit: "Each",
    description: "Acrylic keychain cut to the shape of a hand-drawn espresso martini, in full colour with the J.F. Haden's logo. Ordered in tens.",
    costCents: 180, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(200),
  },
  {
    id: "jfh-martini-keychain-line", name: "J.F. Haden's Espresso Martini Keychain, Black & White",
    brand: "jf-hadens", category: "Giveaways", tone: "espresso", art: "kit", unit: "Each",
    description: "Acrylic keychain cut to the shape of an espresso martini, in black-and-white line art with the J.F. Haden's logo in orange. Ordered in tens.",
    costCents: 180, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(200),
  },
  {
    id: "jfh-drake-tumbler", name: "J.F. Haden's Drake Tumbler",
    brand: "jf-hadens", category: "Giveaways", tone: "palm", art: "tumbler", unit: "16 oz",
    description: "16 oz vacuum-insulated tumbler in Midnight Blue with a slide lid. J.F. Haden's logo laser-engraved.",
    costCents: 1800, maxPerOrder: 4, variants: single(30),
  },
  {
    id: "jfh-square-coasters", name: "J.F. Haden's Square Coasters",
    brand: "jf-hadens", category: "Giveaways", tone: "mango", art: "cards", unit: "Pack of 25",
    description: "3.5 in square pulpboard coasters, 35 pt, with the full-colour J.F. Haden's logo.",
    costCents: 900, maxPerOrder: 10, variants: single(10),
  },
  {
    id: "jfh-phone-stand", name: "J.F. Haden's Bamboo Phone Stand",
    brand: "jf-hadens", category: "Giveaways", tone: "oak", art: "table-tent", unit: "Each",
    description: "Bamboo desk stand for a phone, with the J.F. Haden's logo laser-engraved on the front panel.",
    costCents: 1200, maxPerOrder: 4, variants: single(25),
  },
  {
    id: "jfh-wine-bag", name: "J.F. Haden's Bottle Gift Bag",
    brand: "jf-hadens", category: "Giveaways", tone: "espresso", art: "kit", unit: "Each",
    description: "Black single-bottle gift bag with loop handles and the J.F. Haden's logo in metallic gold foil. Ordered in tens.",
    costCents: 150, minPerOrder: 10, maxPerOrder: 50, orderIncrement: 10, variants: single(300),
  },
  {
    id: "jfh-cobbler-shaker", name: "J.F. Haden's Cobbler Shaker",
    brand: "jf-hadens", category: "Bar Tools", tone: "espresso", art: "shaker", unit: "Each",
    description: "Matte black cobbler shaker with a built-in strainer and cap. J.F. Haden's on one side, Miami in a Bottle on the other, printed white.",
    costCents: 1600, maxPerOrder: 6, variants: single(24),
  },
  {
    id: "jfh-napkin-caddy", name: "J.F. Haden's Bar Napkin Caddy",
    brand: "jf-hadens", category: "Bar Tools", tone: "espresso", art: "kit", unit: "Each",
    description: "Black bar caddy for cocktail napkins, with a V-notch at the back and the full-colour J.F. Haden's logo on the front.",
    costCents: 1400, maxPerOrder: 4, variants: single(20),
  },
  {
    id: "jfh-stirrers", name: "J.F. Haden's Paddle Stirrers",
    brand: "jf-hadens", category: "Bar Tools", tone: "mango", art: "kit", unit: "Bag",
    description: "White plastic drink stirrers with a round paddle printed with the J.F. Haden's wordmark and AMERICA'S CRAFT LIQUEUR COMPANY™. For cocktails at accounts, tastings and events.",
    // Added after the 7 Oct 2026 stock reset, so it starts at 0 until it's counted.
    costCents: 1000, maxPerOrder: 10, variants: single(0),
  },
  {
    id: "jfh-bluetooth-speaker", name: "J.F. Haden's Bluetooth Speaker",
    brand: "jf-hadens", category: "VIP", tone: "espresso", art: "kit", unit: "Each",
    description: "Compact magnetic Bluetooth speaker in black, with the J.F. Haden's logo in white above the power button. A thank-you for top accounts.",
    costCents: 1500, maxPerOrder: 2, variants: single(20),
  },
].map((item) => ({
  ...item,
  minPerOrder: item.minPerOrder ?? Math.min(suggestedMinPerOrder(item.costCents, item.category), item.maxPerOrder),
  orderIncrement: item.orderIncrement ?? 1,
  image: SEED_PHOTOS[item.id]?.[0].url ?? "",
  images: structuredClone(SEED_PHOTOS[item.id] ?? []),
  colors: SEED_COLORS[item.id] ?? [],
  supplier: { ...emptySupplier(), company: DEFAULT_SUPPLIER, ...SEED_SUPPLIERS[item.id] },
  active: true,
}));
renumberSkus(SEED_CATALOG);

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

  // Good Spirits Only moved to the back of the tee and dropped Red and Royal.
  // Each field changes only while it is still exactly as first added.
  ...(() => {
    const id = "jfh-good-spirits-tee";
    const old = ["Black", "White", "Navy", "Burgundy", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"];
    return [
      { id, field: "colors", from: ALL_COLORS },
      { id, field: "images", from: [photo(`${id}-model`, "Black"), ...old.map((c) => photo(`${id}-${slug(c)}`, c))] },
      { id, field: "image", from: `/assets/merch/${id}-model.jpg` },
      { id, field: "description", from: "Retro striped GOOD SPIRITS ONLY in orange, sky blue and pink, with the J.F. Haden's logo." },
    ];
  })(),
].map((fix) => ({ ...fix, to: SEED_CATALOG.find((item) => item.id === fix.id)[fix.field] }));

function pendingFixes(catalog) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return SEED_TEXT_FIXES.filter((fix) => {
    const item = catalog.find((entry) => entry.id === fix.id);
    return item !== undefined && same(item[fix.field], fix.from);
  });
}

export function needsSeedTextFixes(db) {
  return pendingFixes(db.catalog).length > 0;
}

/** Apply the seed corrections still pending; returns how many fields changed. */
export function applySeedTextFixes(db) {
  const pending = pendingFixes(db.catalog);
  for (const fix of pending) {
    db.catalog.find((item) => item.id === fix.id)[fix.field] = structuredClone(fix.to);
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
 * Starter items put into existing stores once, with their colours and
 * photos: the Team Polo (back in stores that had deleted it), the J.F.
 * Haden's Polo, the second merch drop, and the items made from vendor
 * proofs. Each goes after the item named, when that's still there, with
 * the next SKU number for its brand and category in that store. A store
 * that has the item, or its own item of the same name, is left alone; and
 * deleting one afterwards sticks, since each group is only tried once.
 */
const ADDED_ITEMS = [
  { flag: "teamPolo", id: "td-team-polo", after: "jfh-logo-tee" },
  { flag: "jfhPolo", id: "jfh-polo", after: "td-team-polo" },
  { flag: "merchDrop2", id: "jfh-espresso-tee", after: "jfh-polo" },
  { flag: "merchDrop2", id: "jfh-espresso-tank", after: "jfh-espresso-tee" },
  { flag: "merchDrop2", id: "jfh-good-spirits-tee", after: "jfh-espresso-tank" },
  { flag: "merchDrop2", id: "jfh-espresso-stickers", after: "jfh-stickers" },
  { flag: "merchDrop2", id: "jfh-lychee-pin", after: "jfh-espresso-stickers" },
  { flag: "merchDrop2", id: "jfh-koozies", after: "jfh-lychee-pin" },
  { flag: "merchDrop2", id: "jfh-espresso-coasters", after: "jfh-koozies" },
  { flag: "merchDrop2", id: "jfh-throw-pillow", after: "twinp-glencairn-6" },
  { flag: "merchDrop2", id: "jfh-key-lime-colada-talkers", after: "jfh-key-lime-table-tents" },
  { flag: "merchDrop2", id: "jfh-spill-mat", after: "jfh-bar-mat" },
  { flag: "martiniTee", id: "jfh-martini-tee", after: "jfh-good-spirits-tee" },
  { flag: "proofDrop", id: "jfh-tote-bag", after: "jfh-espresso-coasters" },
  { flag: "proofDrop", id: "jfh-beach-towel", after: "jfh-tote-bag" },
  { flag: "proofDrop", id: "jfh-pool-koozie", after: "jfh-koozies" },
  { flag: "proofDrop", id: "jfh-drake-tumbler", after: "td-tumbler" },
  { flag: "proofDrop", id: "jfh-square-coasters", after: "jfh-espresso-coasters" },
  { flag: "proofDrop", id: "jfh-phone-stand", after: "jfh-beach-towel" },
  { flag: "proofDrop", id: "jfh-wine-bag", after: "jfh-phone-stand" },
  { flag: "proofDrop", id: "jfh-cobbler-shaker", after: "jfh-jigger" },
  { flag: "proofDrop", id: "jfh-napkin-caddy", after: "jfh-cobbler-shaker" },
  { flag: "proofDrop", id: "jfh-bluetooth-speaker", after: "jfh-throw-pillow" },
  // the sunglasses as one item per style, where the single item with style options was
  { flag: "sunglassesSplit", id: "jfh-sunglasses-laser", after: ["jfh-sunglasses", "jfh-beach-towel"] },
  { flag: "sunglassesSplit", id: "jfh-sunglasses-vicky", after: "jfh-sunglasses-laser" },
  { flag: "sunglassesSplit", id: "jfh-sunglasses-rainbow", after: "jfh-sunglasses-vicky" },
  { flag: "sunglassesSplit", id: "jfh-sunglasses-andy-green", after: "jfh-sunglasses-rainbow" },
  { flag: "sunglassesSplit", id: "jfh-sunglasses-andy-black", after: "jfh-sunglasses-andy-green" },
  { flag: "lipBalm", id: "jfh-lip-balm", after: ["jfh-pool-koozie", "jfh-koozies"] },
  { flag: "proofDrop3", id: "jfh-gradient-tee", after: ["jfh-martini-tee", "jfh-good-spirits-tee"] },
  { flag: "proofDrop3", id: "jfh-gradient-crop", after: "jfh-gradient-tee" },
  { flag: "proofDrop3", id: "jfh-dad-hat", after: "jfh-cap" },
  { flag: "proofDrop3", id: "jfh-martini-keychain-color", after: ["jfh-lip-balm", "jfh-pool-koozie"] },
  { flag: "proofDrop3", id: "jfh-martini-keychain-line", after: "jfh-martini-keychain-color" },
  { flag: "samplesDrop", id: "td-booklet", after: ["td-sell-sheets", "jfh-recipe-cards"] },
  { flag: "gameDayTee", id: "twinp-game-day-tee", after: ["twinp-trucker", "jfh-gradient-crop", "jfh-gradient-tee"] },
  { flag: "sundayFunday", id: "twinp-sunday-funday-tee", after: ["twinp-game-day-tee", "twinp-trucker"] },
  { flag: "sundayFunday", id: "twinp-sunday-funday-hat", after: ["twinp-sunday-funday-tee", "twinp-trucker"] },
  { flag: "sundayFunday", id: "twinp-sunday-funday-tote", after: ["jfh-tote-bag", "jfh-beach-towel"] },
  { flag: "tdShaker", id: "td-cobbler-shaker", after: ["td-shaker-set", "jfh-cobbler-shaker"] },
  { flag: "stirrers", id: "jfh-stirrers", after: ["jfh-napkin-caddy", "jfh-cobbler-shaker", "jfh-jigger"] },
  { flag: "sampleCups", id: "jfh-sample-cups", after: ["td-sample-cups", "td-tasting-kit"] },
  ...SPIRITS.map(({ id }, i) => ({ flag: "spiritsDrop", id, after: i ? SPIRITS[i - 1].id : ["td-sample-cups", "td-tasting-kit"] })),
];

// The first version of the sunglasses: one item with the five styles as
// options. It goes when the separate items come in, unless an admin has
// renamed it or changed its options.
const COMBINED_SUNGLASSES = {
  id: "jfh-sunglasses",
  name: "J.F. Haden's Sunglasses",
  labels: ["Laser, Black", "Vicky, Green", "Retro Pride Rainbow", "Andy, Green, Pink Mirror", "Andy, Black, Pink Mirror"],
};

export function needsAddedItems(db) {
  return ADDED_ITEMS.some(({ flag }) => !db.meta?.[flag]);
}

/** Returns the items added; any item they replace is listed in `.removed`. */
export function applyAddedItems(db) {
  const pending = new Set(ADDED_ITEMS.filter(({ flag }) => !db.meta[flag]).map(({ flag }) => flag));
  const added = [];
  Object.defineProperty(added, "removed", { value: [], enumerable: false });
  // Before adding, so the bottles and cases take the samples' place.
  if (pending.has("spiritsDrop")) {
    for (const retired of RETIRED_SAMPLES) {
      const old = db.catalog.find((i) => i.id === retired.id);
      if (old && old.name === retired.name) {
        db.catalog.splice(db.catalog.indexOf(old), 1);
        added.removed.push(old);
      }
    }
  }
  for (const { flag, id, after } of ADDED_ITEMS) {
    if (!pending.has(flag)) continue;
    const seed = SEED_CATALOG.find((i) => i.id === id);
    const name = seed.name.toLowerCase();
    if (db.catalog.some((i) => i.id === seed.id || String(i.name).trim().toLowerCase() === name)) continue;
    const item = structuredClone(seed);
    // The next number for its brand and category in this store, as a new item gets.
    item.sku = generateSku(item.brand, item.category, db.catalog.map((i) => i.sku));
    const anchor = [after].flat().find((a) => db.catalog.some((i) => i.id === a));
    const at = db.catalog.findIndex((i) => i.id === anchor);
    db.catalog.splice(at >= 0 ? at + 1 : db.catalog.length, 0, item);
    added.push(item);
  }
  if (pending.has("sunglassesSplit")) {
    const old = db.catalog.find((i) => i.id === COMBINED_SUNGLASSES.id);
    const untouched = old && old.name === COMBINED_SUNGLASSES.name &&
      JSON.stringify(old.variants.map((v) => v.label)) === JSON.stringify(COMBINED_SUNGLASSES.labels);
    if (untouched) {
      db.catalog.splice(db.catalog.indexOf(old), 1);
      added.removed.push(old);
    }
  }
  for (const flag of pending) db.meta[flag] = 1;
  return added;
}

/**
 * Where to order each starter item, from the vendor proofs: filled in once
 * for starter items that have no supplier details yet.
 */
export function needsSeedSuppliers(db) {
  return !db.meta?.seedSuppliers;
}

export function applySeedSuppliers(db) {
  let changed = 0;
  for (const item of db.catalog) {
    const seed = SEED_SUPPLIERS[item.id];
    if (!seed || Object.values(item.supplier ?? {}).some(Boolean)) continue;
    item.supplier = { ...emptySupplier(), ...seed };
    changed += 1;
  }
  db.meta.seedSuppliers = 1;
  return changed;
}

/**
 * Ten 10 Design as the supplier of every item that doesn't name one, once;
 * and the first version's "website" field becomes the online order link.
 */
export function needsSupplierDefaults(db) {
  return !db.meta?.supplierDefaults;
}

export function applySupplierDefaults(db) {
  let changed = 0;
  for (const item of db.catalog) {
    const { website = "", ...rest } = item.supplier ?? {};
    const supplier = { ...emptySupplier(), ...rest };
    if (!supplier.link && website) supplier.link = website;
    if (!supplier.company) {
      supplier.company = DEFAULT_SUPPLIER;
      changed += 1;
    }
    item.supplier = supplier;
  }
  db.meta.supplierDefaults = 1;
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
    item.colors = [...ALL_COLORS];
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
// Version 2 gave the 750 ml bottles and cases their own Samples category.
export const CATEGORIES_VERSION = 2;
const CATEGORY_MOVES = {
  ...Object.fromEntries(SPIRITS.map(({ id }) => [id, "Sampling & Events"])),
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

/* -------------------------------------------------------------------- SKUs */

// Version 2: every SKU is the first three letters of the brand and of the
// category and a number, numbered in the store's order: JFH-APP-001.
// Version 3: Samples use SMP, so they don't share SAM with Sampling & Events.
// Version 4: Sampling & Events use EVNT.
// Version 5: Tropical Distillery uses TD.
// Versions 6 and 7: every Tropical Distillery item starts with TD, whatever
// it had, including items saved under another brand whose name says
// Tropical Distillery.
export const SKU_FORMAT_VERSION = 7;

/** Give every item a brand-category-number SKU, in the store's order. */
export function renumberSkus(items) {
  const counts = new Map();
  for (const item of byCategory(items)) {
    const prefix = skuPrefix(item.brand, item.category);
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    item.sku = `${prefix}-${String(n).padStart(3, "0")}`;
  }
  return items;
}

export function needsSkuFormat(db) {
  return (db.meta?.skuFormat ?? 1) < SKU_FORMAT_VERSION;
}

/**
 * Bring an existing store's SKUs up to date once: a store from before
 * version 2 is renumbered throughout; a later one only has the codes that
 * changed since swapped (Samples SAM → SMP, Sampling & Events SAM → EVNT,
 * Tropical Distillery TRO → TD), keeping their numbers, so nothing else an
 * admin has changed is touched. The one exception is Tropical Distillery:
 * an item that's its by name (or started as one of its items) but was saved
 * under another brand moves back to it, and every Tropical Distillery item
 * without a TD SKU gets the next TD number for its category. Past orders
 * keep the SKUs they were placed with.
 */
export function applySkuFormat(db) {
  const before = new Map(db.catalog.map((item) => [item.id, item.sku]));
  const version = db.meta.skuFormat ?? 1;
  if (version < 2) {
    renumberSkus(db.catalog);
  } else {
    if (version < 3) swapSkus(db, (i) => i.category === "Samples", /^([A-Z]{2,3})-SAM-(\d+)$/, (m) => `${m[1]}-SMP-${m[2]}`);
    if (version < 4) swapSkus(db, (i) => i.category === "Sampling & Events", /^([A-Z]{2,3})-SAM-(\d+)$/, (m) => `${m[1]}-EVNT-${m[2]}`);
    if (version < 5) swapSkus(db, (i) => i.brand === "tropical-distillery", /^TRO-([A-Z]{3,4})-(\d+)$/, (m) => `TD-${m[1]}-${m[2]}`);
  }
  if (version < 7) {
    for (const item of db.catalog) if (isTropicalByName(item)) item.brand = "tropical-distillery";
    swapSkus(db, (i) => i.brand === "tropical-distillery" && !/^TD-[A-Z]{3,4}-\d+$/.test(i.sku ?? ""), /^/, () => null);
  }
  db.meta.skuFormat = SKU_FORMAT_VERSION;
  return db.catalog.filter((item) => before.get(item.id) !== item.sku).length;
}

/** A Tropical Distillery item saved under another brand (the editor starts on J.F. Haden's). */
function isTropicalByName(item) {
  return item.brand !== "tropical-distillery" && (item.id.startsWith("td-") || /\btropical\s+distillery\b/i.test(item.name ?? ""));
}

/**
 * Rewrite the SKUs of the items `applies` picks that match `pattern`. When
 * `rebuild` gives nothing, or a SKU that's taken, the item gets the next
 * number for its brand and category instead.
 */
function swapSkus(db, applies, pattern, rebuild) {
  const taken = new Set(db.catalog.map((item) => item.sku));
  for (const item of db.catalog) {
    const match = applies(item) && pattern.exec(String(item.sku ?? "").toUpperCase());
    if (!match) continue;
    let next = rebuild(match);
    if (!next || taken.has(next)) next = generateSku(item.brand, item.category, [...taken]);
    taken.delete(item.sku);
    taken.add(next);
    item.sku = next;
  }
}

/* ------------------------------------------------------ one-off resets */

// Asked for on 7 October 2026: every stock level back to 0, so the real
// counts can be entered from scratch. Options that aren't tracked (made or
// bought to order) stay untracked, or they couldn't be ordered at all.
export function needsStockCleared(db) {
  return !db.meta?.stockCleared;
}

export function applyStockCleared(db) {
  let cleared = 0;
  for (const item of db.catalog) {
    for (const variant of item.variants) {
      if (Number.isInteger(variant.stock) && variant.stock !== 0) {
        variant.stock = 0;
        cleared += 1;
      }
    }
  }
  db.meta.stockCleared = 1;
  return cleared;
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

export const MAX_STOCK_CHANGES = 2000;

/**
 * Many stock levels at once, from the console's stock editor. Each change is
 * for one option of one item, either
 *   { itemId, variantId, from, to }  set it to `to`, where `from` is what the
 *                                    admin saw; or
 *   { itemId, variantId, add }       a delivery of `add` units.
 * Orders placed while the admin was typing have already taken units, so a
 * tracked level moves by `to - from` rather than being overwritten; those
 * are reported in `adjusted`. Setting an untracked option starts tracking
 * it. Any problem changes nothing.
 */
export function updateStock(db, input) {
  const changes = Array.isArray(input?.changes) ? input.changes : [];
  if (!changes.length) throw new ValidationError("Change at least one stock level.", {});
  const { plan, errors } = planStock(db, changes);
  if (Object.keys(errors).length) throw new ValidationError("Some stock levels need attention.", errors);
  return { ...applyStockPlan(db, plan), changed: plan.length };
}

/** Check stock changes without making them: `{ plan, errors }`. */
function planStock(db, changes) {
  if (changes.length > MAX_STOCK_CHANGES) {
    throw new ValidationError(`Change at most ${MAX_STOCK_CHANGES} stock levels at a time.`, {});
  }
  const errors = {};
  const plan = [];
  const seen = new Set();
  for (const raw of changes) {
    const itemId = cleanText(raw?.itemId, 80);
    const variantId = cleanText(raw?.variantId, 80);
    const key = `stock.${itemId}.${variantId}`;
    const item = db.catalog.find((i) => i.id === itemId);
    const variant = item?.variants.find((v) => v.id === variantId);
    if (!variant) {
      errors[key] = "This item or option no longer exists. Reload the catalog.";
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    let next;
    if (raw && "add" in raw) {
      const add = Number(raw.add);
      if (!Number.isInteger(add) || add < 1 || add > 100000) errors[key] = "Enter how many arrived, as a whole number.";
      else if (!Number.isInteger(variant.stock)) errors[key] = "This option isn't tracked. Set its stock instead.";
      else next = variant.stock + add;
    } else {
      const to = parseStock(raw?.to);
      const from = parseStock(raw?.from);
      if (to === null || Number.isNaN(to)) errors[key] = "Enter a whole number from 0 to 100,000.";
      else if (Number.isInteger(variant.stock) && Number.isInteger(from)) next = Math.max(0, variant.stock + to - from);
      else next = to;
    }
    if (next > 100000) errors[key] = "That's more than 100,000.";
    if (!errors[key]) plan.push({ itemId, variantId, next, wanted: raw && "add" in raw ? next : parseStock(raw.to) });
  }
  return { plan, errors };
}

function applyStockPlan(db, plan) {
  const items = new Map();
  const adjusted = [];
  for (const { itemId, variantId, next, wanted } of plan) {
    const item = db.catalog.find((i) => i.id === itemId);
    const variant = item.variants.find((v) => v.id === variantId);
    variant.stock = next;
    items.set(item.id, item);
    if (next !== wanted) adjusted.push({ itemId: item.id, name: item.name, option: variant.label, stock: next });
  }
  return { items: [...items.values()], adjusted };
}

// What the bulk editor can change on many items at once. Photos, options and
// colours stay with the one-item editor.
export const BULK_FIELDS = ["name", "sku", "category", "brand", "unit", "costCents", "minPerOrder", "maxPerOrder", "orderIncrement", "active", "description"];
export const BULK_SUPPLIER_FIELDS = ["company", "itemNumber", "link"];
export const MAX_BULK_ITEMS = 1000;

/**
 * The console's bulk editor: `items` are `{ id, patch }` with any of
 * BULK_FIELDS and `supplier` (BULK_SUPPLIER_FIELDS), each checked with the
 * same rules as the one-item editor; `stock` are stock changes as in
 * updateStock; `order` is item ids in the order the store should list them
 * (within each category). Problems come back per field as
 * "<item id>.<field>" (or "stock.<item id>.<option id>"), and any problem
 * changes nothing.
 */
export function bulkEditCatalog(db, input) {
  const rawItems = Array.isArray(input?.items) ? input.items : [];
  const stock = Array.isArray(input?.stock) ? input.stock : [];
  const order = Array.isArray(input?.order) ? input.order.slice(0, MAX_BULK_ITEMS * 2).map((id) => cleanText(id, 80)) : null;
  if (!rawItems.length && !stock.length && !order?.length) throw new ValidationError("Change at least one thing.", {});
  if (rawItems.length > MAX_BULK_ITEMS) throw new ValidationError(`Change at most ${MAX_BULK_ITEMS} items at a time.`, {});

  const errors = {};
  const edited = new Map();
  // SKUs are checked against the catalog as it will be, so two items can swap
  // theirs in one save: the one-item check leaves out every item whose SKU is
  // being changed, and the final SKUs are compared below.
  const renaming = new Set(rawItems.filter((raw) => cleanText(raw?.patch?.sku, 40)).map((raw) => cleanText(raw.id, 80)));
  const others = db.catalog.filter((i) => !renaming.has(i.id));
  for (const raw of rawItems) {
    const id = cleanText(raw?.id, 80);
    const existing = db.catalog.find((i) => i.id === id);
    if (!existing) {
      errors[`${id}.name`] = "This item no longer exists. Reload the catalog.";
      continue;
    }
    if (edited.has(id)) continue;
    const patch = raw.patch && typeof raw.patch === "object" ? raw.patch : {};
    const merged = structuredClone(existing);
    for (const field of BULK_FIELDS) if (field in patch) merged[field] = patch[field];
    if (patch.supplier && typeof patch.supplier === "object") {
      merged.supplier = { ...existing.supplier };
      for (const field of BULK_SUPPLIER_FIELDS) if (field in patch.supplier) merged.supplier[field] = patch.supplier[field];
    }
    try {
      edited.set(id, normalizeItem(merged, { catalog: others.includes(existing) ? others : [...others, existing], existing }));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      for (const [field, message] of Object.entries(error.fieldErrors)) errors[`${id}.${field}`] = message;
    }
  }
  const owners = new Map();
  for (const item of db.catalog) {
    const sku = edited.get(item.id)?.sku ?? item.sku;
    owners.set(sku, [...(owners.get(sku) ?? []), item.id]);
  }
  for (const ids of owners.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) if (edited.has(id)) errors[`${id}.sku`] = "Another item already uses this SKU.";
  }

  const { plan, errors: stockErrors } = planStock(db, stock);
  Object.assign(errors, stockErrors);
  if (Object.keys(errors).length) {
    const items = new Set(Object.keys(errors).map((key) => key.replace(/^stock\./, "").split(".")[0])).size;
    throw new ValidationError(`${items === 1 ? "1 item needs" : `${items} items need`} attention. Nothing was saved.`, errors);
  }

  for (const [id, item] of edited) db.catalog[db.catalog.findIndex((i) => i.id === id)] = item;
  const { adjusted } = applyStockPlan(db, plan);
  const reordered = order?.length ? reorderCatalog(db, order) : false;
  const ids = new Set([...edited.keys(), ...plan.map((p) => p.itemId)]);
  return { items: db.catalog.filter((i) => ids.has(i.id)), changed: ids.size, adjusted, reordered };
}

/**
 * Put the catalog in the given order. Ids it doesn't know are ignored, and
 * items it doesn't list (one added meanwhile) keep their order after the
 * rest. The store still groups items by category, so this decides the
 * order within each. Returns whether anything moved.
 */
export function reorderCatalog(db, order) {
  const rank = new Map();
  for (const id of order) if (!rank.has(id)) rank.set(id, rank.size);
  const before = db.catalog.map((i) => i.id).join("\n");
  const at = (item) => rank.get(item.id) ?? Infinity;
  db.catalog = db.catalog.map((item, i) => [item, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([item]) => item);
  return db.catalog.map((i) => i.id).join("\n") !== before;
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
    sku = generateSku(cleanText(src.brand, 40), cleanText(src.category, 40), others);
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

  // Where to order it: admin-only details. A client that doesn't send them
  // leaves them as they were.
  const supplier = emptySupplier();
  const rawSupplier = src.supplier && typeof src.supplier === "object" ? src.supplier : existing?.supplier ?? {};
  for (const [key, max] of Object.entries(SUPPLIER_FIELDS)) supplier[key] = cleanText(rawSupplier[key], max);
  if (!supplier.link) supplier.link = cleanText(rawSupplier.website, SUPPLIER_FIELDS.link);   // older clients
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    errors.supplierEmail = "Enter an email address like name@company.com, or leave it blank.";
  }
  if (supplier.link) {
    const withScheme = /^https?:\/\//i.test(supplier.link) ? supplier.link : `https://${supplier.link}`;
    try {
      const url = new URL(withScheme);
      if (!url.hostname.includes(".")) throw new Error("no host");
      supplier.link = url.href;
    } catch {
      errors.supplierLink = "Enter a web address like amazon.com/…, or leave it blank.";
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
    supplier,
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
