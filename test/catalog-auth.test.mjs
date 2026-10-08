import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { createThrottle, parseCookies, signSession, verifySession } from "../src/auth.mjs";
import {
  CATEGORIES_VERSION,
  SEED_CATALOG,
  SEED_PHOTOS,
  SEED_PHOTOS_VERSION,
  SEED_TEXT_FIXES,
  applyAddedItems,
  applyCategoryMoves,
  applyColors,
  applyMinimums,
  applyPoloColors,
  applySeedPhotos,
  applySeedSuppliers,
  applySupplierDefaults,
  applySeedTextFixes,
  needsAddedItems,
  needsCategoryMoves,
  needsColors,
  needsMinimums,
  needsPoloColors,
  needsSeedPhotos,
  needsSeedSuppliers,
  needsSupplierDefaults,
  needsSeedTextFixes,
  needsSkuFormat,
  applySkuFormat,
  needsStockCleared,
  applyStockCleared,
  normalizeItem,
  publicItem,
  bulkEditCatalog,
  updateStock,
} from "../src/catalog.mjs";
import { CATEGORIES, COLOR_OPTIONS, MAX_IMAGES, generateSku, imageFor, itemImages, quantityRuleText, skuPrefix } from "../public/assets/shared.js";
import { initialState } from "../src/store/initial-state.mjs";
import { ValidationError } from "../src/validation.mjs";

const VALID = {
  name: "Mango Koozie",
  sku: "td-acc-001",
  brand: "jf-hadens",
  category: "Giveaways",
  tone: "mango",
  art: "tumbler",
  unit: "Pack of 10",
  costCents: 900,
  maxPerOrder: 5,
  variants: [{ label: "", stock: "25" }],
};

function errorsOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    return error.fieldErrors;
  }
  assert.fail("expected a ValidationError");
}

describe("catalog items", () => {
  it("seeds unique ids and SKUs", () => {
    assert.equal(new Set(SEED_CATALOG.map((i) => i.id)).size, SEED_CATALOG.length);
    assert.equal(new Set(SEED_CATALOG.map((i) => i.sku)).size, SEED_CATALOG.length);
  });

  it("normalizes a new item", () => {
    const item = normalizeItem(VALID, { catalog: SEED_CATALOG });
    assert.equal(item.sku, "TD-ACC-001");
    assert.equal(item.id, "td-acc-001-mango-koozie");
    assert.deepEqual(item.variants, [{ id: "default", label: "", stock: 25 }]);
    assert.equal(item.active, true);
  });

  it("treats a blank stock as not tracked", () => {
    const item = normalizeItem({ ...VALID, variants: [{ label: "", stock: "" }] }, { catalog: SEED_CATALOG });
    assert.equal(item.variants[0].stock, null);
  });

  it("refuses a duplicate SKU, a bad cost and bad stock", () => {
    const errors = errorsOf(() =>
      normalizeItem({ ...VALID, sku: SEED_CATALOG[0].sku, costCents: -5, variants: [{ label: "", stock: "2.5" }] }, { catalog: SEED_CATALOG })
    );
    assert.ok(errors.sku);
    assert.ok(errors.costCents);
    assert.ok(errors.variants);
  });

  it("only accepts https or local image paths", () => {
    for (const bad of ["javascript:alert(1)", "http://example.com/a.png", "//evil.example/a.png", "/assets/../server.mjs", "data:image/png;base64,AAAA"]) {
      assert.ok(errorsOf(() => normalizeItem({ ...VALID, image: bad }, { catalog: SEED_CATALOG })).image, bad);
    }
    assert.equal(normalizeItem({ ...VALID, image: "https://cdn.example.com/koozie.jpg" }, { catalog: SEED_CATALOG }).image, "https://cdn.example.com/koozie.jpg");
    assert.equal(normalizeItem({ ...VALID, image: "/assets/photos/koozie.jpg" }, { catalog: SEED_CATALOG }).image, "/assets/photos/koozie.jpg");
  });

  it("keeps option ids stable across edits so stock stays attached", () => {
    const tee = SEED_CATALOG.find((i) => i.id === "jfh-logo-tee");
    const edited = normalizeItem(
      { ...tee, variants: [{ label: "m", stock: 3 }, { label: "XS", stock: 2 }] },
      { catalog: SEED_CATALOG, existing: tee }
    );
    assert.equal(edited.id, "jfh-logo-tee");
    assert.deepEqual(edited.variants.map((v) => v.id), ["m", "xs"]);
  });

  it("keeps where-to-order details for admins only", () => {
    const supplier = { company: "Ten 10 Design LLC", contact: "Sam", email: "sam@example.com", phone: "555-0100", link: "example.com/order", itemNumber: "1602-14", notes: "PO 1" };
    const item = normalizeItem({ ...VALID, supplier }, { catalog: SEED_CATALOG });
    assert.deepEqual(item.supplier, { ...supplier, link: "https://example.com/order" });
    assert.equal("supplier" in publicItem(item), false);
    // a client that doesn't send them leaves them as they were
    const edited = normalizeItem({ ...VALID, name: "Renamed" }, { catalog: SEED_CATALOG, existing: item });
    assert.equal(edited.supplier.company, "Ten 10 Design LLC");
    // and clearing them clears them
    assert.equal(normalizeItem({ ...VALID, supplier: {} }, { catalog: SEED_CATALOG, existing: item }).supplier.company, "");
  });

  it("refuses a bad supplier email or online link", () => {
    const errors = errorsOf(() => normalizeItem({ ...VALID, supplier: { email: "not an email", link: "nope" } }, { catalog: SEED_CATALOG }));
    assert.ok(errors.supplierEmail);
    assert.ok(errors.supplierLink);
    assert.ok(errorsOf(() => normalizeItem({ ...VALID, supplier: { link: "javascript:alert(1)" } }, { catalog: SEED_CATALOG })).supplierLink);
  });

  it("orders every starter item through Ten 10 Design unless it says otherwise", () => {
    // Bottles and cases come from the distillery's own stock.
    for (const item of SEED_CATALOG) {
      const own = /-(bottle|case)$/.test(item.id);
      assert.equal(item.supplier.company, own ? "Tropical Distillery (own stock)" : "Ten 10 Design LLC", item.id);
    }
  });

  it("refuses unlabelled or repeated options", () => {
    assert.ok(errorsOf(() => normalizeItem({ ...VALID, variants: [{ label: "S", stock: 1 }, { label: "", stock: 1 }] }, { catalog: SEED_CATALOG })).variants);
    assert.ok(errorsOf(() => normalizeItem({ ...VALID, variants: [{ label: "S", stock: 1 }, { label: "s", stock: 1 }] }, { catalog: SEED_CATALOG })).variants);
  });
});

describe("starter catalog corrections", () => {
  function storeSeededWithOldText() {
    const catalog = structuredClone(SEED_CATALOG);
    for (const fix of SEED_TEXT_FIXES) catalog.find((i) => i.id === fix.id)[fix.field] = fix.from;
    return { catalog };
  }

  it("brings untouched seed items up to date, once", () => {
    const db = storeSeededWithOldText();
    assert.equal(needsSeedTextFixes(db), true);
    assert.equal(applySeedTextFixes(db), SEED_TEXT_FIXES.length);
    assert.equal(db.catalog.find((i) => i.id === "jfh-key-lime-table-tents").name, "Key Lime Pie Liqueur Table Tents");
    assert.match(db.catalog.find((i) => i.id === "td-sell-sheets").description, /all six/);
    assert.equal(needsSeedTextFixes(db), false);
    assert.equal(applySeedTextFixes(db), 0);
  });

  it("leaves anything an admin has edited, and missing items, alone", () => {
    const db = storeSeededWithOldText();
    db.catalog.find((i) => i.id === "jfh-recipe-cards").description = "Our own wording";
    db.catalog = db.catalog.filter((i) => i.id !== "jfh-shot-24");
    applySeedTextFixes(db);
    assert.equal(db.catalog.find((i) => i.id === "jfh-recipe-cards").description, "Our own wording");
    assert.equal(db.catalog.find((i) => i.id === "td-sell-sheets").description, SEED_CATALOG.find((i) => i.id === "td-sell-sheets").description);
  });

  it("has nothing to do for a fresh store", () => {
    assert.equal(needsSeedTextFixes({ catalog: structuredClone(SEED_CATALOG) }), false);
  });
});

describe("categories", () => {
  it("files every starter item under one of the six categories", () => {
    for (const item of SEED_CATALOG) assert.ok(CATEGORIES.includes(item.category), `${item.id}: ${item.category}`);
    const of = (id) => SEED_CATALOG.find((i) => i.id === id).category;
    assert.equal(of("td-tumbler"), "Giveaways");
    assert.equal(of("jfh-stickers"), "Giveaways");
    assert.equal(of("jfh-led-sign"), "VIP");
    assert.equal(of("jfh-bar-mat"), "Bar Tools");
    assert.equal(of("jfh-key-lime-table-tents"), "Print");
  });

  it("moves an older store over once, respecting the admin's own choices", () => {
    const old = { "td-tumbler": "Drinkware", "jfh-led-sign": "Point of Sale", "jfh-stickers": "Print", "jfh-bar-mat": "Point of Sale", "twinp-case": "Sampling & Events", "jfh-mango-bottle": "Sampling & Events" };
    const catalog = structuredClone(SEED_CATALOG).map((i) => ({ ...i, category: old[i.id] ?? i.category }));
    catalog.find((i) => i.id === "jfh-bar-mat").category = "Sampling & Events"; // the admin moved it
    catalog.find((i) => i.id === "jfh-mango-bottle").category = "VIP"; // and this one
    catalog.push({ ...structuredClone(catalog[0]), id: "custom-glass", category: "Drinkware" });
    catalog.push({ ...structuredClone(catalog[0]), id: "custom-sign", category: "Point of Sale" });
    const db = { meta: {}, catalog };
    assert.equal(needsCategoryMoves(db), true);
    applyCategoryMoves(db);
    const of = (id) => db.catalog.find((i) => i.id === id).category;
    assert.equal(of("td-tumbler"), "Giveaways");
    assert.equal(of("jfh-led-sign"), "VIP");
    assert.equal(of("jfh-stickers"), "Giveaways");
    assert.equal(of("jfh-bar-mat"), "Sampling & Events");
    assert.equal(of("custom-glass"), "Giveaways");
    assert.equal(of("custom-sign"), "Print");
    assert.equal(of("twinp-case"), "Samples", "bottles and cases get their own category");
    assert.equal(of("jfh-mango-bottle"), "VIP");
    assert.equal(db.meta.categories, CATEGORIES_VERSION);
    assert.equal(needsCategoryMoves(db), false);
    assert.equal(needsCategoryMoves(initialState()), false);
  });
});

describe("per-order minimums", () => {
  it("defaults to one and can't exceed the max", () => {
    const item = normalizeItem({ ...VALID }, { catalog: [] });
    assert.equal(item.minPerOrder, 1);
    assert.equal(normalizeItem({ ...VALID, minPerOrder: 4 }, { catalog: [] }).minPerOrder, 4);
    assert.throws(() => normalizeItem({ ...VALID, minPerOrder: VALID.maxPerOrder + 1 }, { catalog: [] }), (e) => /more than the max/.test(e.fieldErrors.minPerOrder));
    assert.throws(() => normalizeItem({ ...VALID, minPerOrder: 0 }, { catalog: [] }), (e) => Boolean(e.fieldErrors.minPerOrder));
  });

  it("suggests minimums for the small, cheap items only", () => {
    const mins = Object.fromEntries(SEED_CATALOG.map((i) => [i.id, i.minPerOrder]));
    assert.equal(mins["jfh-jigger"], 3);
    assert.equal(mins["td-sample-cups"], 2);
    assert.equal(mins["jfh-logo-tee"], 1, "clothing stays at one");
    assert.equal(mins["jfh-led-sign"], 1);
    for (const item of SEED_CATALOG) assert.ok(item.minPerOrder <= item.maxPerOrder, item.id);
  });

  it("gives older stores their minimums once, within each item's max", () => {
    const catalog = structuredClone(SEED_CATALOG).map(({ minPerOrder, ...rest }) => rest);
    catalog.find((i) => i.id === "td-sample-cups").maxPerOrder = 1;
    catalog.push({ ...structuredClone(catalog[0]), id: "custom-item" });
    const db = { catalog };
    assert.equal(needsMinimums(db), true);
    const raised = catalog.filter((i) => i.id !== "custom-item" && Math.min(SEED_CATALOG.find((s) => s.id === i.id).minPerOrder, i.maxPerOrder) > 1).length;
    assert.ok(raised >= 2);
    assert.equal(applyMinimums(db), raised);
    assert.equal(db.catalog.find((i) => i.id === "jfh-jigger").minPerOrder, 3);
    assert.equal(db.catalog.find((i) => i.id === "jfh-lychee-pin").minPerOrder, 10);
    assert.equal(db.catalog.find((i) => i.id === "td-sample-cups").minPerOrder, 1);
    assert.equal(db.catalog.find((i) => i.id === "custom-item").minPerOrder, 1);
    assert.equal(needsMinimums(db), false);
  });
});

describe("order increments", () => {
  it("defaults to one and keeps the min and max on the steps", () => {
    assert.equal(normalizeItem({ ...VALID }, { catalog: [] }).orderIncrement, 1);
    const sixes = normalizeItem({ ...VALID, orderIncrement: 6, minPerOrder: 6, maxPerOrder: 24 }, { catalog: [] });
    assert.deepEqual([sixes.minPerOrder, sixes.maxPerOrder, sixes.orderIncrement], [6, 24, 6]);
    assert.throws(() => normalizeItem({ ...VALID, orderIncrement: 6, minPerOrder: 4, maxPerOrder: 24 }, { catalog: [] }), (e) => /multiple of 6/.test(e.fieldErrors.minPerOrder));
    assert.throws(() => normalizeItem({ ...VALID, orderIncrement: 6, minPerOrder: 6, maxPerOrder: 20 }, { catalog: [] }), (e) => /multiple of 6/.test(e.fieldErrors.maxPerOrder));
    assert.throws(() => normalizeItem({ ...VALID, orderIncrement: 0 }, { catalog: [] }), (e) => Boolean(e.fieldErrors.orderIncrement));
  });

  it("describes the rule for the shop", () => {
    assert.equal(quantityRuleText({ maxPerOrder: 6 }), "Up to 6 per order");
    assert.equal(quantityRuleText({ minPerOrder: 3, maxPerOrder: 12 }), "Min 3 · up to 12 per order");
    assert.equal(quantityRuleText({ minPerOrder: 6, maxPerOrder: 24, orderIncrement: 6 }), "Sold in 6s · up to 24 per order");
    assert.equal(quantityRuleText({ minPerOrder: 12, maxPerOrder: 24, orderIncrement: 6 }), "Sold in 6s · min 12 · up to 24 per order");
  });
});

describe("automatic SKUs", () => {
  it("is the brand's and category's first three letters and the next number", () => {
    assert.equal(skuPrefix("jf-hadens", "Apparel"), "JFH-APP");
    assert.equal(skuPrefix("twin-p", "Bar Tools"), "TWI-BAR");
    assert.equal(skuPrefix("tropical-distillery", "Sampling & Events"), "TD-EVNT", "Tropical Distillery is TD");
    assert.equal(skuPrefix("twin-p", "Samples"), "TWI-SMP", "so Samples don't share SAM");
    assert.equal(generateSku("jf-hadens", "Giveaways"), "JFH-GIV-001");
    // after the highest number with the same start, so a deleted item's isn't reused
    assert.equal(generateSku("jf-hadens", "Giveaways", ["JFH-GIV-001", "jfh-giv-007", "JFH-APP-020", "TD-GIV-009"]), "JFH-GIV-008");
  });

  it("fills a blank SKU on a new item and keeps an existing item's", () => {
    const made = normalizeItem({ ...VALID, sku: "" }, { catalog: [{ id: "x", sku: "JFH-GIV-004" }] });
    assert.equal(made.sku, "JFH-GIV-005");
    const kept = normalizeItem({ ...VALID, sku: "" }, { catalog: [made], existing: made });
    assert.equal(kept.sku, "JFH-GIV-005");
  });

  it("numbers the starter catalog in the store's order", () => {
    const sku = (id) => SEED_CATALOG.find((i) => i.id === id).sku;
    assert.equal(sku("jfh-logo-tee"), "JFH-APP-001");
    assert.equal(sku("td-team-polo"), "TD-APP-001");
    assert.equal(sku("twinp-trucker"), "TWI-APP-001");
    assert.ok(SEED_CATALOG.every((i) => /^[A-Z]{2,3}-[A-Z]{3,4}-\d{3}$/.test(i.sku)), "every SKU in the new format");
    assert.equal(sku("td-tasting-kit"), "TD-EVNT-001");
    assert.equal(generateSku("tropical-distillery", "Sampling & Events", SEED_CATALOG.map((i) => i.sku)), "TD-EVNT-005");
  });

  it("renumbers an existing store's SKUs once, in store order", () => {
    const catalog = structuredClone(SEED_CATALOG).map((item, i) => ({ ...item, sku: `TD-OLD-${i}` }));
    catalog.push({ ...structuredClone(SEED_CATALOG[0]), id: "custom-tee", name: "Custom Tee", sku: "MY-OWN" });
    const db = { meta: { skuFormat: 1 }, catalog };
    assert.equal(needsSkuFormat(db), true);
    assert.equal(applySkuFormat(db), catalog.length);
    const sku = (id) => db.catalog.find((i) => i.id === id).sku;
    assert.equal(sku("jfh-logo-tee"), "JFH-APP-001");
    const lastTee = db.catalog.filter((i) => i.brand === "jf-hadens" && i.category === "Apparel").length;
    assert.equal(sku("custom-tee"), `JFH-APP-${String(lastTee).padStart(3, "0")}`, "an admin's own item is numbered too");
    assert.equal(new Set(db.catalog.map((i) => i.sku)).size, db.catalog.length);
    assert.equal(needsSkuFormat(db), false);
    assert.equal(needsSkuFormat(initialState()), false);
  });

  it("moves a version 2 store's Samples from SAM to SMP, touching nothing else", () => {
    const db = initialState();
    db.meta.skuFormat = 2;
    for (const item of db.catalog) if (item.category === "Samples") item.sku = item.sku.replace("-SMP-", "-SAM-");
    const kit = db.catalog.find((i) => i.id === "td-tasting-kit");
    kit.sku = "TRO-SAM-001"; // as version 2 numbered it
    const tee = db.catalog.find((i) => i.id === "jfh-logo-tee");
    tee.sku = "MY-OWN-TEE"; // an admin's own SKU since
    assert.equal(needsSkuFormat(db), true);
    assert.equal(applySkuFormat(db), 14 + 1, "the 14 samples, and the kit (the only Sampling & Events item given SAM here)");
    assert.equal(db.catalog.find((i) => i.id === "jfh-citrus-bottle").sku, "JFH-SMP-001");
    assert.equal(db.catalog.find((i) => i.id === "twinp-case").sku, "TWI-SMP-002");
    assert.equal(kit.sku, "TD-EVNT-001", "and Sampling & Events moves to EVNT, Tropical Distillery to TD");
    assert.equal(tee.sku, "MY-OWN-TEE");
    assert.equal(needsSkuFormat(db), false);
  });

  it("moves a version 3 store's Sampling & Events from SAM to EVNT, touching nothing else", () => {
    const db = initialState();
    db.meta.skuFormat = 3;
    for (const item of db.catalog) if (item.category === "Sampling & Events") item.sku = item.sku.replace("TD-EVNT-", "TRO-SAM-");
    const sampleSku = db.catalog.find((i) => i.id === "jfh-citrus-bottle").sku;
    assert.equal(applySkuFormat(db), 4);
    assert.equal(db.catalog.find((i) => i.id === "td-pullup-banner").sku, "TD-EVNT-004");
    assert.equal(db.catalog.find((i) => i.id === "jfh-citrus-bottle").sku, sampleSku);
  });

  it("moves a version 4 store's Tropical Distillery SKUs from TRO to TD, keeping their numbers", () => {
    const db = initialState();
    db.meta.skuFormat = 4;
    const tdItems = db.catalog.filter((i) => i.brand === "tropical-distillery");
    for (const item of tdItems) item.sku = item.sku.replace(/^TD-/, "TRO-");
    const want = new Map(tdItems.map((i) => [i.id, i.sku.replace(/^TRO-/, "TD-")]));
    const jfh = db.catalog.find((i) => i.id === "jfh-logo-tee").sku;
    assert.equal(applySkuFormat(db), tdItems.length);
    for (const item of tdItems) assert.equal(item.sku, want.get(item.id));
    assert.equal(db.catalog.find((i) => i.id === "jfh-logo-tee").sku, jfh, "other brands untouched");
    assert.equal(needsSkuFormat(db), false);
  });

  it("gives every Tropical Distillery item a TD SKU, including typed-in ones and ones saved under another brand", () => {
    const db = initialState();
    db.meta.skuFormat = 5;
    const item = (id) => db.catalog.find((i) => i.id === id);
    item("td-team-polo").sku = "POLO-2026"; // typed in
    item("td-tumbler").sku = "JFH-GIV-007"; // another brand's code
    item("td-shaker-set").sku = "TRO-APP-009"; // category part doesn't fit any more
    item("td-booklet").sku = ""; // none at all
    const kept = item("td-sell-sheets").sku;
    const jfhTee = { ...structuredClone(item("jfh-logo-tee")), id: "jfh-typed", sku: "MY-OWN-TEE" };
    db.catalog.push(jfhTee);
    // Saved under J.F. Haden's, the brand a new item starts on.
    const banner = { ...structuredClone(item("td-pullup-banner")), id: "banner-2", name: "Tropical Distillery Step & Repeat", brand: "jf-hadens", sku: "JFH-EVNT-001" };
    db.catalog.push(banner);
    item("td-table-throw").brand = "twin-p"; // started as a Tropical Distillery item
    const mangoTee = { ...structuredClone(item("jfh-logo-tee")), id: "jfh-tropical-tee", name: "Tropical Mango Tee", sku: "JFH-APP-099" };
    db.catalog.push(mangoTee);
    assert.equal(applySkuFormat(db), 5);
    assert.equal(banner.brand, "tropical-distillery");
    assert.equal(banner.sku, "TD-EVNT-005", "the next TD Sampling & Events number");
    assert.equal(item("td-table-throw").brand, "tropical-distillery");
    assert.equal(item("td-table-throw").sku, "TD-EVNT-003", "already TD, so it keeps its SKU");
    assert.equal(mangoTee.brand, "jf-hadens", "only items named Tropical Distillery move");
    assert.equal(mangoTee.sku, "JFH-APP-099");
    assert.equal(item("td-team-polo").sku, "TD-APP-001", "the next free TD apparel number");
    assert.equal(item("td-tumbler").sku, "TD-GIV-001");
    assert.equal(item("td-shaker-set").sku, "TD-BAR-003", "after the cobbler shaker's 002");
    assert.equal(item("td-booklet").sku, "TD-PRI-002");
    assert.equal(item("td-sell-sheets").sku, kept, "TD SKUs untouched");
    assert.equal(jfhTee.sku, "MY-OWN-TEE", "other brands keep typed-in SKUs");
    assert.ok(db.catalog.filter((i) => i.brand === "tropical-distillery").every((i) => /^TD-[A-Z]{3,4}-\d{3}$/.test(i.sku)));
    assert.equal(new Set(db.catalog.map((i) => i.sku)).size, db.catalog.length);
    assert.equal(needsSkuFormat(db), false);
  });
});

describe("colors and photo galleries", () => {
  const photo = (n) => `/images/${String(n).padStart(32, "0")}.webp`;

  it("offers the team polo in the nine standard colors", () => {
    const polo = SEED_CATALOG.find((i) => i.id === "td-team-polo");
    assert.deepEqual(polo.colors, ["White", "Navy", "Burgundy", "Black", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"]);
    assert.deepEqual(polo.colors, COLOR_OPTIONS.map((c) => c.name).filter((c) => c !== "Khaki"));
    assert.deepEqual(SEED_CATALOG.find((i) => i.id === "jfh-cap").colors, []);
  });

  it("keeps known colors once each, in the order given", () => {
    const item = normalizeItem({ ...VALID, colors: ["Navy", "Chartreuse", "navy", "Navy", "Red"] }, { catalog: SEED_CATALOG });
    assert.deepEqual(item.colors, ["Navy", "Red"]);
    assert.deepEqual(normalizeItem(VALID, { catalog: SEED_CATALOG }).colors, []);
  });

  it("saves several photos, main first, each tagged with one of the item's colors", () => {
    const item = normalizeItem(
      {
        ...VALID,
        colors: ["Navy", "Red"],
        images: [{ url: photo(1) }, { url: photo(2), color: "Red" }, { url: photo(3), color: "Black" }, { url: photo(2), color: "Navy" }, { url: "" }],
      },
      { catalog: SEED_CATALOG }
    );
    assert.deepEqual(item.images, [
      { url: photo(1), color: "" },
      { url: photo(2), color: "Red" },
      { url: photo(3), color: "" },
    ]);
    assert.equal(item.image, photo(1), "the main photo is the first");
    assert.equal(imageFor(item, "Red"), photo(2));
    assert.equal(imageFor(item, "Navy"), photo(1), "falls back to the main photo");
    assert.equal(imageFor(item), photo(1));
  });

  it("refuses too many photos and bad links in a gallery", () => {
    const many = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => ({ url: photo(i + 1) }));
    assert.match(errorsOf(() => normalizeItem({ ...VALID, images: many }, { catalog: SEED_CATALOG })).image, /at most/);
    assert.ok(errorsOf(() => normalizeItem({ ...VALID, images: [{ url: "javascript:alert(1)" }] }, { catalog: SEED_CATALOG })).image);
  });

  it("still takes a single image from older clients", () => {
    const item = normalizeItem({ ...VALID, image: photo(7) }, { catalog: SEED_CATALOG });
    assert.deepEqual(item.images, [{ url: photo(7), color: "" }]);
    const moved = normalizeItem({ ...VALID, images: [{ url: photo(1) }], image: photo(7) }, { catalog: SEED_CATALOG });
    assert.deepEqual(moved.images.map((i) => i.url), [photo(7), photo(1)], "a new single image becomes the main one");
    assert.deepEqual(itemImages({ image: photo(9) }), [{ url: photo(9), color: "" }], "items saved before galleries");
    assert.deepEqual(itemImages({ image: "" }), []);
  });

  it("offers an admin's own polos in the nine colors, once", () => {
    const db = {
      meta: {},
      catalog: [
        { id: "a", name: "J.F. Haden's Royal Polo", colors: [] },
        { id: "b", name: "Bartender POLOS (6-pack)", colors: [] },
        { id: "c", name: "Polo already set", colors: ["Red"] },
        { id: "d", name: "Polonaise Napkins", colors: [] },
      ],
    };
    assert.equal(needsPoloColors(db), true);
    assert.deepEqual(applyPoloColors(db), ["J.F. Haden's Royal Polo", "Bartender POLOS (6-pack)"]);
    assert.equal(db.catalog[0].colors.length, 9);
    assert.deepEqual(db.catalog[2].colors, ["Red"], "an admin's own choice stays");
    assert.deepEqual(db.catalog[3].colors, []);
    assert.equal(needsPoloColors(db), false);
  });

  it("gives older stores their colors once", () => {
    const catalog = structuredClone(SEED_CATALOG).map(({ colors, ...rest }) => rest);
    const db = { meta: {}, catalog };
    assert.equal(needsColors(db), true);
    assert.equal(applyColors(db), SEED_CATALOG.filter((i) => i.colors.length).length);
    assert.equal(db.catalog.find((i) => i.id === "jfh-good-spirits-tee").colors.length, 7);
    assert.equal(db.catalog.find((i) => i.id === "td-team-polo").colors.length, 9);
    assert.equal(db.catalog.find((i) => i.id === "jfh-polo").colors.length, 9);
    assert.deepEqual(db.catalog.find((i) => i.id === "jfh-cap").colors, []);
    assert.equal(needsColors(db), false);
  });
});

describe("starter items added to existing stores", () => {
  const POLOS = ["td-team-polo", "jfh-polo"];
  const without = (ids = POLOS) => ({ meta: {}, catalog: structuredClone(SEED_CATALOG).filter((i) => !ids.includes(i.id)) });

  it("adds both polos once, with their colors and photos, in their usual places", () => {
    const db = without();
    assert.equal(needsAddedItems(db), true);
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), POLOS);
    const ids = db.catalog.map((i) => i.id);
    assert.deepEqual(ids.slice(ids.indexOf("jfh-logo-tee"), ids.indexOf("jfh-logo-tee") + 3), ["jfh-logo-tee", ...POLOS]);
    for (const id of POLOS) {
      const polo = db.catalog.find((i) => i.id === id);
      assert.equal(polo.colors.length, 9);
      assert.equal(polo.images.length, 9);
      assert.equal(polo.image, `/assets/merch/${id}-royal.jpg`);
    }
    assert.equal(needsAddedItems(db), false);
    db.catalog = db.catalog.filter((i) => !POLOS.includes(i.id));
    assert.equal(needsAddedItems(db), false, "deleting them again sticks");
  });

  it("adds only the J.F. Haden's Polo to a store that already brought back the Team Polo", () => {
    const db = without(["jfh-polo"]);
    db.meta.teamPolo = 1;
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["jfh-polo"]);
  });

  it("leaves a store that has them, or its own polo of that name, alone", () => {
    const fresh = { meta: {}, catalog: structuredClone(SEED_CATALOG) };
    assert.deepEqual(applyAddedItems(fresh), []);
    assert.equal(fresh.catalog.length, SEED_CATALOG.length);

    const own = without();
    own.catalog.push({ ...structuredClone(SEED_CATALOG[0]), id: "app-my-polo", sku: "APP-MY-POLO", name: " j.f. haden's polo " });
    assert.deepEqual(applyAddedItems(own).map((i) => i.id), ["td-team-polo"]);
  });

  it("makes a new SKU if its old one has been taken", () => {
    const db = without();
    const poloSku = SEED_CATALOG.find((i) => i.id === "jfh-polo").sku;
    db.catalog.find((i) => i.id === "jfh-cap").sku = poloSku;
    const jfh = applyAddedItems(db).find((i) => i.id === "jfh-polo");
    assert.notEqual(jfh.sku, poloSku);
    assert.match(jfh.sku, /^JFH-APP-\d{3}$/);
    assert.equal(new Set(db.catalog.map((i) => i.sku)).size, db.catalog.length);
  });

  it("is already in place in a new store", () => {
    const db = initialState();
    for (const id of POLOS) assert.ok(db.catalog.some((i) => i.id === id), id);
  });

  it("adds the second merch drop once, each piece next to its kind", () => {
    const DROP = ["jfh-espresso-tee", "jfh-espresso-tank", "jfh-good-spirits-tee", "jfh-espresso-stickers", "jfh-lychee-pin", "jfh-koozies", "jfh-espresso-coasters", "jfh-throw-pillow", "jfh-key-lime-colada-talkers", "jfh-spill-mat"];
    const db = { meta: { teamPolo: 1, jfhPolo: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => !DROP.includes(i.id)) };
    db.catalog.find((i) => i.id === "jfh-cap").name = "In My Espresso Martini Era Tank";   // the admin's own item of that name
    assert.equal(needsAddedItems(db), true);
    const added = applyAddedItems(db).map((i) => i.id);
    assert.deepEqual(added, DROP.filter((id) => id !== "jfh-espresso-tank"));
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("jfh-polo") + 1], "jfh-espresso-tee");
    assert.equal(ids[ids.indexOf("jfh-bar-mat") + 1], "jfh-spill-mat");
    assert.equal(ids[ids.indexOf("jfh-stickers") + 1], "jfh-espresso-stickers");
    assert.equal(db.meta.merchDrop2, 1);
    assert.equal(needsAddedItems(db), false);
    const pin = db.catalog.find((i) => i.id === "jfh-lychee-pin");
    assert.deepEqual([pin.minPerOrder, pin.maxPerOrder, pin.orderIncrement], [10, 50, 10]);
    const gso = db.catalog.find((i) => i.id === "jfh-good-spirits-tee");
    assert.equal(imageFor(gso, "Black"), "/assets/merch/jfh-good-spirits-tee-black.jpg");
    assert.equal(imageFor(gso, "Navy"), "/assets/merch/jfh-good-spirits-tee-navy.jpg");
    assert.ok(!gso.colors.includes("Red") && !gso.colors.includes("Royal"));
  });

  it("adds the Martini Glass Tee once, after the Good Spirits Only Tee", () => {
    const db = { meta: { teamPolo: 1, jfhPolo: 1, merchDrop2: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => i.id !== "jfh-martini-tee") };
    assert.equal(needsAddedItems(db), true);
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["jfh-martini-tee"]);
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("jfh-good-spirits-tee") + 1], "jfh-martini-tee");
    const tee = db.catalog.find((i) => i.id === "jfh-martini-tee");
    assert.deepEqual(tee.colors, ["White", "Black", "Navy", "Grey", "Carolina Blue"]);
    assert.equal(tee.image, "/assets/merch/jfh-martini-tee-woman.jpg");
    assert.equal(imageFor(tee, "Navy"), "/assets/merch/jfh-martini-tee-navy.jpg");
    assert.equal(needsAddedItems(db), false);
  });

  it("adds the items made from vendor proofs once, each next to its kind, with their photos", () => {
    const SHADES = ["laser", "vicky", "rainbow", "andy-green", "andy-black"].map((s) => `jfh-sunglasses-${s}`);
    const PROOFS = ["jfh-tote-bag", "jfh-beach-towel", "jfh-pool-koozie", "jfh-drake-tumbler", "jfh-square-coasters", "jfh-phone-stand", "jfh-wine-bag", "jfh-cobbler-shaker", "jfh-napkin-caddy", "jfh-bluetooth-speaker", ...SHADES];
    const db = { meta: { teamPolo: 1, jfhPolo: 1, merchDrop2: 1, martiniTee: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => !PROOFS.includes(i.id)) };
    assert.equal(needsAddedItems(db), true);
    assert.deepEqual(applyAddedItems(db).map((i) => i.id).sort(), [...PROOFS].sort());
    const ids = db.catalog.map((i) => i.id);
    const after = (id) => ids[ids.indexOf(id) + 1];
    assert.equal(after("jfh-koozies"), "jfh-pool-koozie");
    assert.equal(after("jfh-espresso-coasters"), "jfh-square-coasters");
    assert.equal(after("td-tumbler"), "jfh-drake-tumbler");
    assert.equal(after("jfh-jigger"), "jfh-cobbler-shaker");
    assert.equal(after("jfh-cobbler-shaker"), "jfh-napkin-caddy");
    assert.equal(after("jfh-throw-pillow"), "jfh-bluetooth-speaker");
    assert.equal(db.meta.proofDrop, 1);
    assert.equal(needsAddedItems(db), false);
    const koozie = db.catalog.find((i) => i.id === "jfh-pool-koozie");
    assert.deepEqual(koozie.images.map((p) => p.url), ["/assets/merch/jfh-pool-koozie-1.jpg", "/assets/merch/jfh-pool-koozie-2.jpg"]);
    assert.deepEqual([koozie.minPerOrder, koozie.maxPerOrder, koozie.orderIncrement], [10, 50, 10]);
    assert.deepEqual(ids.slice(ids.indexOf("jfh-beach-towel") + 1, ids.indexOf("jfh-beach-towel") + 7), [...SHADES, "jfh-phone-stand"]);
    for (const id of SHADES) assert.equal(db.catalog.find((i) => i.id === id).image, `/assets/merch/${id}.jpg`);
    assert.equal(db.catalog.find((i) => i.id === "jfh-drake-tumbler").supplier.company, "Ten 10 Design LLC");
    assert.equal(new Set(db.catalog.map((i) => i.sku)).size, db.catalog.length);
  });

  it("swaps the sunglasses with style options for one item per style, in its place", () => {
    const SHADES = ["laser", "vicky", "rainbow", "andy-green", "andy-black"].map((s) => `jfh-sunglasses-${s}`);
    const combined = () => ({
      ...structuredClone(SEED_CATALOG.find((i) => i.id === "jfh-tote-bag")),
      id: "jfh-sunglasses", sku: "TD-GIV-008", name: "J.F. Haden's Sunglasses",
      variants: ["Laser, Black", "Vicky, Green", "Retro Pride Rainbow", "Andy, Green, Pink Mirror", "Andy, Black, Pink Mirror"].map((label, i) => ({ id: `s${i}`, label, stock: 50 })),
    });
    const store = () => {
      const catalog = structuredClone(SEED_CATALOG).filter((i) => !SHADES.includes(i.id));
      catalog.splice(catalog.findIndex((i) => i.id === "jfh-beach-towel") + 1, 0, combined());
      return { meta: { teamPolo: 1, jfhPolo: 1, merchDrop2: 1, martiniTee: 1, proofDrop: 1 }, catalog };
    };
    const db = store();
    const added = applyAddedItems(db);
    assert.deepEqual(added.map((i) => i.id), SHADES);
    assert.deepEqual(added.removed.map((i) => i.id), ["jfh-sunglasses"]);
    const ids = db.catalog.map((i) => i.id);
    assert.ok(!ids.includes("jfh-sunglasses"));
    assert.deepEqual(ids.slice(ids.indexOf("jfh-beach-towel") + 1, ids.indexOf("jfh-beach-towel") + 6), SHADES);

    // one an admin has changed stays
    const edited = store();
    edited.catalog.find((i) => i.id === "jfh-sunglasses").name = "Sunnies";
    assert.equal(applyAddedItems(edited).removed.length, 0);
    assert.ok(edited.catalog.some((i) => i.id === "jfh-sunglasses"));
  });

  it("adds the lip balm once, after the pool koozie, sold in tens", () => {
    const db = { meta: { teamPolo: 1, jfhPolo: 1, merchDrop2: 1, martiniTee: 1, proofDrop: 1, sunglassesSplit: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => i.id !== "jfh-lip-balm") };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["jfh-lip-balm"]);
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("jfh-pool-koozie") + 1], "jfh-lip-balm");
    const balm = db.catalog.find((i) => i.id === "jfh-lip-balm");
    assert.deepEqual([balm.minPerOrder, balm.maxPerOrder, balm.orderIncrement], [10, 50, 10]);
    assert.equal(balm.image, "/assets/merch/jfh-lip-balm.jpg");
    assert.equal(balm.supplier.company, "Ten 10 Design LLC");
  });

  it("adds the gradient shirts, the dad hat and the keychains once, each next to its kind", () => {
    const NEW = ["jfh-gradient-tee", "jfh-gradient-crop", "jfh-dad-hat", "jfh-martini-keychain-color", "jfh-martini-keychain-line"];
    const db = { meta: { teamPolo: 1, jfhPolo: 1, merchDrop2: 1, martiniTee: 1, proofDrop: 1, sunglassesSplit: 1, lipBalm: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => !NEW.includes(i.id)) };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), NEW);
    const ids = db.catalog.map((i) => i.id);
    const after = (id) => ids[ids.indexOf(id) + 1];
    assert.equal(after("jfh-martini-tee"), "jfh-gradient-tee");
    assert.equal(after("jfh-gradient-tee"), "jfh-gradient-crop");
    assert.equal(after("jfh-cap"), "jfh-dad-hat");
    assert.equal(after("jfh-lip-balm"), "jfh-martini-keychain-color");
    const hat = db.catalog.find((i) => i.id === "jfh-dad-hat");
    assert.deepEqual(hat.colors, ["Burgundy", "Navy", "Khaki"]);
    assert.equal(imageFor(hat, "Khaki"), "/assets/merch/jfh-dad-hat-khaki.jpg");
    const crop = db.catalog.find((i) => i.id === "jfh-gradient-crop");
    assert.equal(imageFor(crop, "Black"), "/assets/merch/jfh-gradient-crop-black.jpg");
    assert.equal(crop.variants.length, 6);
  });

  const SPIRIT_IDS = ["jfh-citrus", "jfh-espresso", "jfh-key-lime-pie", "jfh-lychee", "jfh-mango", "jfh-orange", "twinp"].flatMap((p) => [`${p}-bottle`, `${p}-case`]);
  const BEFORE_SPIRITS = { teamPolo: 1, jfhPolo: 1, merchDrop2: 1, martiniTee: 1, proofDrop: 1, sunglassesSplit: 1, lipBalm: 1, proofDrop3: 1 };

  it("adds a 750 ml bottle and a case of every spirit, and the booklet, once, next to their kind", () => {
    const NEW = ["td-booklet", ...SPIRIT_IDS];
    const db = { meta: { ...BEFORE_SPIRITS }, catalog: structuredClone(SEED_CATALOG).filter((i) => !NEW.includes(i.id)) };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), NEW);
    assert.equal(needsAddedItems(db), false);
    const ids = db.catalog.map((i) => i.id);
    const at = ids.indexOf("td-sample-cups");
    assert.deepEqual(ids.slice(at + 1, at + 15), SPIRIT_IDS, "in a run after the sample cups");
    assert.equal(ids[ids.indexOf("td-sell-sheets") + 1], "td-booklet");

    const bottle = db.catalog.find((i) => i.id === "jfh-lychee-bottle");
    assert.equal(bottle.name, "J.F. Haden's Lychee Liqueur, 750 ml");
    assert.equal(bottle.category, "Samples");
    assert.equal(bottle.image, "/assets/merch/jfh-lychee-bottle.jpg");
    assert.equal(bottle.minPerOrder, 1);
    assert.match(bottle.supplier.notes, /USPS/);
    const box = db.catalog.find((i) => i.id === "twinp-case");
    assert.equal(box.name, "Twin P Whiskey, Case of 6");
    assert.equal(box.unit, "Case of 6 × 750 ml");
    assert.equal(box.costCents, 6 * bottle.costCents);
    assert.equal(box.brand, "twin-p");
    const expected = [...Array.from({ length: 12 }, (_, i) => `JFH-SMP-${String(i + 1).padStart(3, "0")}`), "TWI-SMP-001", "TWI-SMP-002"];
    assert.deepEqual(SPIRIT_IDS.map((id) => db.catalog.find((i) => i.id === id).sku), expected);
    const booklet = db.catalog.find((i) => i.id === "td-booklet");
    assert.equal(booklet.variants[0].stock, null, "printed to order");
    assert.equal(booklet.supplier.company, "Ten 10 Design LLC");
  });

  it("adds the From Happy Hour to Game Day tee once, after the Twin P trucker, with no stock yet", () => {
    const catalog = structuredClone(SEED_CATALOG).filter((i) => i.id !== "twinp-game-day-tee");
    // an admin's own Twin P item already has the number the starter catalog gives the tee
    catalog.push({ ...structuredClone(catalog.find((i) => i.id === "twinp-trucker")), id: "own-twinp", name: "Twin P Koozie", sku: "TWI-APP-002" });
    const db = { meta: { ...BEFORE_SPIRITS, samplesDrop: 1, spiritsDrop: 1, sundayFunday: 1 }, catalog };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["twinp-game-day-tee"]);
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("twinp-trucker") + 1], "twinp-game-day-tee");
    const tee = db.catalog.find((i) => i.id === "twinp-game-day-tee");
    assert.equal(tee.brand, "twin-p");
    assert.equal(tee.category, "Apparel");
    assert.equal(tee.sku, "TWI-APP-005", "after the highest Twin P apparel number (the Sunday Funday tee and hat have 003 and 004)");
    assert.equal(tee.image, "/assets/merch/twinp-game-day-tee.jpg");
    assert.deepEqual(tee.variants.map((v) => v.stock), [0, 0, 0, 0, 0, 0]);
    assert.equal(needsAddedItems(db), false);
    assert.deepEqual(applyAddedItems(db), [], "only once");
  });

  it("adds the Sunday Funday tee, dad hat and tote once, next to their kind, with no stock yet", () => {
    const NEW = ["twinp-sunday-funday-tee", "twinp-sunday-funday-hat", "twinp-sunday-funday-tote"];
    const db = { meta: { ...BEFORE_SPIRITS, samplesDrop: 1, spiritsDrop: 1, gameDayTee: 1 }, catalog: structuredClone(SEED_CATALOG).filter((i) => !NEW.includes(i.id)) };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), NEW);
    const ids = db.catalog.map((i) => i.id);
    assert.deepEqual(ids.slice(ids.indexOf("twinp-game-day-tee") + 1, ids.indexOf("twinp-game-day-tee") + 3), NEW.slice(0, 2));
    assert.equal(ids[ids.indexOf("jfh-tote-bag") + 1], "twinp-sunday-funday-tote");
    const item = (id) => db.catalog.find((i) => i.id === id);
    assert.deepEqual(NEW.map((id) => item(id).sku), ["TWI-APP-003", "TWI-APP-004", "TWI-GIV-001"]);
    assert.deepEqual(NEW.map((id) => item(id).image), NEW.map((id) => `/assets/merch/${id}.jpg`));
    assert.ok(NEW.every((id) => item(id).brand === "twin-p" && item(id).variants.every((v) => v.stock === 0)));
    assert.equal(item("twinp-sunday-funday-tee").variants.length, 6, "sized");
    assert.equal(item("twinp-sunday-funday-tote").category, "Giveaways");
    assert.equal(needsAddedItems(db), false);
  });

  it("adds the Tropical Distillery cobbler shaker once, with the next TD Bar Tools number", () => {
    // like the live store: no other Tropical Distillery bar tools
    const catalog = structuredClone(SEED_CATALOG).filter((i) => !["td-cobbler-shaker", "td-shaker-set"].includes(i.id));
    const db = { meta: { ...BEFORE_SPIRITS, samplesDrop: 1, spiritsDrop: 1, gameDayTee: 1, sundayFunday: 1 }, catalog };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["td-cobbler-shaker"]);
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("jfh-cobbler-shaker") + 1], "td-cobbler-shaker");
    const shaker = db.catalog.find((i) => i.id === "td-cobbler-shaker");
    assert.equal(shaker.sku, "TD-BAR-001");
    assert.equal(shaker.category, "Bar Tools");
    assert.equal(shaker.image, "/assets/merch/td-cobbler-shaker.jpg");
    assert.deepEqual(shaker.variants.map((v) => v.stock), [0]);
  });

  it("adds the J.F. Haden's paddle stirrers once, after the napkin caddy, with no stock yet", () => {
    const catalog = structuredClone(SEED_CATALOG).filter((i) => i.id !== "jfh-stirrers");
    const lastBar = Math.max(...catalog.filter((i) => /^JFH-BAR-\d+$/.test(i.sku)).map((i) => Number(i.sku.slice(-3))));
    const db = { meta: { ...BEFORE_SPIRITS, samplesDrop: 1, spiritsDrop: 1, gameDayTee: 1, sundayFunday: 1, tdShaker: 1 }, catalog };
    assert.deepEqual(applyAddedItems(db).map((i) => i.id), ["jfh-stirrers"]);
    const ids = db.catalog.map((i) => i.id);
    assert.equal(ids[ids.indexOf("jfh-napkin-caddy") + 1], "jfh-stirrers");
    const stirrers = db.catalog.find((i) => i.id === "jfh-stirrers");
    assert.equal(stirrers.sku, `JFH-BAR-${String(lastBar + 1).padStart(3, "0")}`, "the next J.F. Haden's Bar Tools number");
    assert.equal(stirrers.image, "/assets/merch/jfh-stirrers.jpg");
    assert.deepEqual(stirrers.variants.map((v) => v.stock), [0]);
    assert.equal(needsAddedItems(db), false);
  });

  it("gives the booklet its photo when it has none, leaving an admin's own photo alone", () => {
    const db = { meta: { seedPhotos: 2 }, catalog: structuredClone(SEED_CATALOG) };
    const booklet = db.catalog.find((i) => i.id === "td-booklet");
    booklet.image = "";
    booklet.images = [];
    const tee = db.catalog.find((i) => i.id === "jfh-logo-tee");
    tee.images = [{ url: "/images/" + "0".repeat(32) + ".webp", color: "" }];
    tee.image = tee.images[0].url;
    assert.equal(needsSeedPhotos(db), true);
    assert.equal(applySeedPhotos(db), 1);
    assert.equal(booklet.image, "/assets/merch/td-booklet.jpg");
    assert.equal(tee.image, "/images/" + "0".repeat(32) + ".webp");
  });

  it("replaces the 50 ml samples with the bottles and cases", () => {
    const sample = (flavor, product, sku) => ({ ...structuredClone(SEED_CATALOG.find((i) => i.id === "jfh-citrus-bottle")), id: flavor, name: `${product} Sample, 50 ml`, sku });
    const catalog = structuredClone(SEED_CATALOG).filter((i) => !SPIRIT_IDS.includes(i.id));
    const at = catalog.findIndex((i) => i.id === "td-sample-cups") + 1;
    catalog.splice(at, 0,
      sample("jfh-sample-citrus", "J.F. Haden's Citrus Liqueur", "TD-EVT-005"),
      sample("twinp-sample", "Twin P Whiskey", "TD-EVT-011"),
      // renamed by an admin, so it stays
      sample("jfh-sample-mango", "J.F. Haden's Mango Liqueur (tasting only)", "TD-EVT-009"));
    catalog[at + 2].name = "Mango tasting minis";
    const db = { meta: { ...BEFORE_SPIRITS, samplesDrop: 1 }, catalog };
    const added = applyAddedItems(db);
    assert.deepEqual(added.removed.map((i) => i.id), ["jfh-sample-citrus", "twinp-sample"]);
    assert.ok(db.catalog.some((i) => i.id === "jfh-sample-mango"));
    assert.equal(db.catalog.find((i) => i.id === "jfh-citrus-bottle").sku, "JFH-SMP-001");
    assert.equal(db.catalog.find((i) => i.id === "jfh-sample-mango").sku, "TD-EVT-009", "the kept sample keeps its SKU");
    assert.equal(new Set(db.catalog.map((i) => i.sku)).size, db.catalog.length, "SKUs stay unique");
  });

  it("fills in where to order starter items once, leaving an admin's details alone", () => {
    const db = { meta: {}, catalog: structuredClone(SEED_CATALOG).map(({ supplier, ...rest }) => rest) };
    db.catalog.find((i) => i.id === "jfh-wine-bag").supplier = { company: "Our own vendor" };
    assert.equal(needsSeedSuppliers(db), true);
    const changed = applySeedSuppliers(db);
    assert.ok(changed >= 10);
    assert.equal(db.catalog.find((i) => i.id === "jfh-wine-bag").supplier.company, "Our own vendor");
    assert.match(db.catalog.find((i) => i.id === "jfh-bluetooth-speaker").supplier.itemNumber, /7195-78/);
    assert.equal(db.catalog.find((i) => i.id === "jfh-logo-tee").supplier, undefined);
    assert.equal(needsSeedSuppliers(db), false);
  });

  it("makes Ten 10 Design the supplier of every item that names none, once, keeping any link", () => {
    const db = { meta: {}, catalog: structuredClone(SEED_CATALOG).map(({ supplier, ...rest }) => rest) };
    db.catalog.push({ ...structuredClone(db.catalog[0]), id: "own-item", sku: "OWN-1" });
    db.catalog.find((i) => i.id === "jfh-wine-bag").supplier = { company: "Our own vendor" };
    db.catalog.find((i) => i.id === "jfh-tote-bag").supplier = { company: "", website: "https://example.com/tote" };
    assert.equal(needsSupplierDefaults(db), true);
    assert.equal(applySupplierDefaults(db), db.catalog.length - 1);
    for (const item of db.catalog) assert.ok(item.supplier.company, item.id);
    assert.equal(db.catalog.find((i) => i.id === "own-item").supplier.company, "Ten 10 Design LLC");
    assert.equal(db.catalog.find((i) => i.id === "jfh-wine-bag").supplier.company, "Our own vendor");
    const tote = db.catalog.find((i) => i.id === "jfh-tote-bag").supplier;
    assert.equal(tote.link, "https://example.com/tote");
    assert.equal("website" in tote, false);
    assert.equal(needsSupplierDefaults(db), false);
  });

  it("moves an untouched Good Spirits Only Tee to the back print without Red and Royal, once", () => {
    const id = "jfh-good-spirits-tee";
    const ALL = ["White", "Navy", "Burgundy", "Black", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"];
    const firstVersion = () => ({
      ...structuredClone(SEED_CATALOG.find((i) => i.id === id)),
      colors: [...ALL],
      image: `/assets/merch/${id}-model.jpg`,
      images: [{ url: `/assets/merch/${id}-model.jpg`, color: "Black" },
        ...["Black", "White", "Navy", "Burgundy", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"].map((c) => ({ url: `/assets/merch/${id}-${c.toLowerCase().replace(" ", "-")}.jpg`, color: c }))],
      description: "Retro striped GOOD SPIRITS ONLY in orange, sky blue and pink, with the J.F. Haden's logo.",
    });
    const db = { meta: {}, catalog: [firstVersion()] };
    assert.equal(needsSeedTextFixes(db), true);
    assert.equal(applySeedTextFixes(db), 4);
    const tee = db.catalog[0];
    assert.deepEqual(tee.colors, ["White", "Navy", "Burgundy", "Black", "Forest Green", "Grey", "Carolina Blue"]);
    assert.equal(tee.images.length, 7);
    assert.equal(tee.image, `/assets/merch/${id}-black.jpg`);
    assert.match(tee.description, /printed on the back/);
    assert.equal(needsSeedTextFixes(db), false);

    // an admin's own photos and colours stay
    const edited = firstVersion();
    edited.images = [{ url: "/images/0123456789abcdef0123456789abcdef.webp", color: "" }];
    edited.colors = ["Red"];
    const db2 = { meta: {}, catalog: [edited] };
    applySeedTextFixes(db2);
    assert.deepEqual(db2.catalog[0].colors, ["Red"]);
    assert.equal(db2.catalog[0].images.length, 1);
  });
});

describe("starter catalog photos", () => {
  it("has a photo file for every starter item that names one", () => {
    for (const item of SEED_CATALOG) {
      const gallery = SEED_PHOTOS[item.id] ?? [];
      assert.deepEqual(item.images, gallery);
      assert.equal(item.image, gallery[0]?.url ?? "");
      for (const { url, color } of gallery) {
        assert.ok(existsSync(new URL(`../public${url}`, import.meta.url)), `${url} is missing`);
        assert.ok(!color || item.colors.includes(color), `${url} is tagged with a color the item doesn't come in`);
      }
      assert.deepEqual(normalizeItem(structuredClone(item), { catalog: SEED_CATALOG, existing: item }).images, gallery);
    }
  });

  it("shows the team polo in each of its colors, royal first", () => {
    const polo = SEED_CATALOG.find((i) => i.id === "td-team-polo");
    assert.equal(polo.images.length, 9);
    assert.equal(polo.image, "/assets/merch/td-team-polo-royal.jpg");
    assert.equal(imageFor(polo, "Carolina Blue"), "/assets/merch/td-team-polo-carolina-blue.jpg");
  });

  it("fills in photos once, keeping the admin's own and respecting removals", () => {
    const fresh = () => structuredClone(SEED_CATALOG).map((i) => ({ ...i, image: "", images: [] }));
    const db = { meta: {}, catalog: fresh() };
    assert.equal(needsSeedPhotos(db), true);
    assert.equal(applySeedPhotos(db), Object.keys(SEED_PHOTOS).length);
    assert.deepEqual(db.catalog.find((i) => i.id === "td-team-polo").images, SEED_PHOTOS["td-team-polo"]);
    assert.equal(db.meta.seedPhotos, SEED_PHOTOS_VERSION);
    db.catalog.find((i) => i.id === "td-team-polo").images = [];
    assert.equal(needsSeedPhotos(db), false, "a removed photo doesn't come back");

    const own = { meta: {}, catalog: fresh() };
    const polo = own.catalog.find((i) => i.id === "td-team-polo");
    polo.image = "/images/0123456789abcdef0123456789abcdef.webp";
    applySeedPhotos(own);
    assert.deepEqual(itemImages(polo), [{ url: "/images/0123456789abcdef0123456789abcdef.webp", color: "" }], "an admin's own photo stays");

    const fewer = { meta: {}, catalog: fresh() };
    const trimmed = fewer.catalog.find((i) => i.id === "td-team-polo");
    trimmed.colors = ["Red", "Black"];
    applySeedPhotos(fewer);
    assert.deepEqual(trimmed.images.map((i) => i.color), ["Black", "Red"], "only colors still offered");
  });

  it("has nothing to do for a fresh store", () => {
    assert.equal(needsSeedPhotos(initialState()), false);
  });
});

describe("sessions", () => {
  const secret = "test-secret";
  const payload = { role: "team", email: "jane@tropicaldistillery.com", exp: Date.now() + 60_000 };

  it("round-trips a signed session", () => {
    assert.deepEqual(verifySession(secret, signSession(secret, payload)), payload);
  });

  it("rejects tampering, the wrong secret and expiry", () => {
    const token = signSession(secret, payload);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, role: "admin" })).toString("base64url");
    assert.equal(verifySession(secret, `${forged}.${sig}`), null);
    assert.equal(verifySession("other-secret", token), null);
    assert.equal(verifySession(secret, `${body}.${sig}.extra`), null);
    assert.equal(verifySession(secret, signSession(secret, { ...payload, exp: Date.now() - 1 })), null);
    assert.equal(verifySession(secret, undefined), null);
  });

  it("parses cookie headers", () => {
    assert.deepEqual(parseCookies("a=1; tdm_team=x%3Dy; junk"), { a: "1", tdm_team: "x=y" });
  });

  it("throttles repeated failures per address", () => {
    const throttle = createThrottle({ max: 2, windowMs: 1000 });
    throttle.fail("1.2.3.4", 0);
    assert.equal(throttle.blocked("1.2.3.4", 10), false);
    throttle.fail("1.2.3.4", 20);
    assert.equal(throttle.blocked("1.2.3.4", 30), true);
    assert.equal(throttle.blocked("5.6.7.8", 30), false);
    assert.equal(throttle.blocked("1.2.3.4", 1500), false, "failures age out");
  });
});

describe("bulk stock edits", () => {
  const variantOf = (db, itemId, variantId = "default") => db.catalog.find((i) => i.id === itemId).variants.find((v) => v.id === variantId);

  it("sets levels, adds deliveries and starts tracking, all at once", () => {
    const db = initialState();
    const mat = variantOf(db, "jfh-bar-mat");
    const tee = variantOf(db, "jfh-logo-tee", "m");
    const cups = variantOf(db, "td-sample-cups");
    assert.equal(cups.stock, null);
    const { changed, adjusted, items } = updateStock(db, {
      changes: [
        { itemId: "jfh-bar-mat", variantId: "default", from: mat.stock, to: 50 },
        { itemId: "jfh-logo-tee", variantId: "m", add: 24 },
        { itemId: "td-sample-cups", variantId: "default", from: null, to: 30 },
      ],
    });
    const before = structuredClone(initialState());
    assert.equal(changed, 3);
    assert.deepEqual(adjusted, []);
    assert.equal(mat.stock, 50);
    assert.equal(tee.stock, before.catalog.find((i) => i.id === "jfh-logo-tee").variants.find((v) => v.id === "m").stock + 24);
    assert.equal(cups.stock, 30, "now tracked");
    assert.deepEqual(items.map((i) => i.id), ["jfh-bar-mat", "jfh-logo-tee", "td-sample-cups"]);
  });

  it("keeps units that orders took while the admin was typing", () => {
    const db = initialState();
    const mat = variantOf(db, "jfh-bar-mat");
    const seen = mat.stock;
    mat.stock -= 3; // an order came in after the editor was opened
    const { adjusted } = updateStock(db, { changes: [{ itemId: "jfh-bar-mat", variantId: "default", from: seen, to: 40 }] });
    assert.equal(mat.stock, 37);
    assert.deepEqual(adjusted.map((a) => a.stock), [37]);
  });

  it("changes nothing if any entry is wrong", () => {
    const db = initialState();
    const mat = variantOf(db, "jfh-bar-mat");
    const was = mat.stock;
    const errors = (input) => {
      try {
        updateStock(db, input);
      } catch (error) {
        assert.ok(error instanceof ValidationError);
        return error.fieldErrors;
      }
      assert.fail("expected a ValidationError");
    };
    const bad = errors({
      changes: [
        { itemId: "jfh-bar-mat", variantId: "default", from: was, to: 99 },
        { itemId: "jfh-logo-tee", variantId: "m", from: 1, to: -4 },
        { itemId: "td-sample-cups", variantId: "default", add: 5 },
        { itemId: "nope", variantId: "default", to: 1 },
      ],
    });
    assert.ok(bad["stock.jfh-logo-tee.m"]);
    assert.match(bad["stock.td-sample-cups.default"], /isn't tracked/);
    assert.ok(bad["stock.nope.default"]);
    assert.equal(mat.stock, was, "the good entry wasn't applied either");
    assert.throws(() => updateStock(db, { changes: [] }), ValidationError);
    assert.ok(errors({ changes: [{ itemId: "jfh-bar-mat", variantId: "default", add: 0 }] })["stock.jfh-bar-mat.default"]);
  });
});

describe("bulk catalog edits", () => {
  const find = (db, id) => db.catalog.find((i) => i.id === id);
  const fieldErrors = (fn) => {
    try {
      fn();
    } catch (error) {
      assert.ok(error instanceof ValidationError, String(error));
      return error.fieldErrors;
    }
    assert.fail("expected a ValidationError");
  };

  it("changes details, supplier and stock on many items in one go", () => {
    const db = initialState();
    const mat = find(db, "jfh-bar-mat");
    const result = bulkEditCatalog(db, {
      items: [
        { id: "jfh-bar-mat", patch: { name: "Rubber Bar Mat, 18 in", costCents: 2500, maxPerOrder: 6, active: false, supplier: { company: "Bar Supply Co", link: "barsupply.com/mats" } } },
        { id: "jfh-cap", patch: { category: "Giveaways", unit: "Each, adjustable" } },
      ],
      stock: [{ itemId: "jfh-bar-mat", variantId: "default", from: mat.variants[0].stock, to: 80 }],
    });
    assert.equal(result.changed, 2);
    const saved = find(db, "jfh-bar-mat");
    assert.equal(saved.name, "Rubber Bar Mat, 18 in");
    assert.equal(saved.costCents, 2500);
    assert.equal(saved.maxPerOrder, 6);
    assert.equal(saved.active, false);
    assert.equal(saved.supplier.company, "Bar Supply Co");
    assert.equal(saved.supplier.link, "https://barsupply.com/mats");
    assert.equal(saved.supplier.notes, mat.supplier.notes, "fields not sent are kept");
    assert.equal(saved.variants[0].stock, 80);
    assert.equal(saved.sku, mat.sku);
    assert.deepEqual(saved.images, mat.images);
    assert.equal(find(db, "jfh-cap").category, "Giveaways");
  });

  it("checks every item with the one-item rules and saves nothing if any fails", () => {
    const db = initialState();
    const before = structuredClone(db.catalog);
    const errors = fieldErrors(() =>
      bulkEditCatalog(db, {
        items: [
          { id: "jfh-bar-mat", patch: { name: "Fine" } },
          { id: "jfh-cap", patch: { name: "", minPerOrder: 5, maxPerOrder: 4, supplier: { link: "not a link" } } },
          { id: "gone", patch: { name: "x" } },
        ],
        stock: [{ itemId: "jfh-logo-tee", variantId: "m", from: 1, to: -1 }],
      })
    );
    assert.ok(errors["jfh-cap.name"]);
    assert.ok(errors["jfh-cap.minPerOrder"]);
    assert.ok(errors["jfh-cap.supplierLink"]);
    assert.ok(errors["gone.name"]);
    assert.ok(errors["stock.jfh-logo-tee.m"]);
    assert.deepEqual(db.catalog, before, "nothing changed");
    assert.throws(() => bulkEditCatalog(db, {}), ValidationError);
  });

  it("puts items in the order given, keeping any it wasn't told about at the end", () => {
    const db = initialState();
    const ids = db.catalog.map((i) => i.id);
    const wanted = [...ids.slice(1).reverse(), "not-an-item"];
    const { reordered, changed } = bulkEditCatalog(db, { order: wanted });
    assert.equal(reordered, true);
    assert.equal(changed, 0);
    assert.deepEqual(db.catalog.map((i) => i.id), [...ids.slice(1).reverse(), ids[0]], "the unlisted first item goes last");
    assert.equal(bulkEditCatalog(db, { order: db.catalog.map((i) => i.id) }).reordered, false, "the same order moves nothing");
  });

  it("edits SKUs, lets two items swap theirs, and refuses duplicates", () => {
    const db = initialState();
    const [cap, mat] = [find(db, "jfh-cap"), find(db, "jfh-bar-mat")];
    const [capSku, matSku] = [cap.sku, mat.sku];
    bulkEditCatalog(db, { items: [{ id: "jfh-cap", patch: { sku: matSku } }, { id: "jfh-bar-mat", patch: { sku: capSku } }] });
    assert.equal(find(db, "jfh-cap").sku, matSku);
    assert.equal(find(db, "jfh-bar-mat").sku, capSku);

    bulkEditCatalog(db, { items: [{ id: "jfh-cap", patch: { sku: " td-hat-001 " } }] });
    assert.equal(find(db, "jfh-cap").sku, "TD-HAT-001", "tidied like the one-item editor");

    const teeSku = find(db, "jfh-logo-tee").sku;
    const clash = fieldErrors(() => bulkEditCatalog(db, { items: [{ id: "jfh-cap", patch: { sku: teeSku } }] }));
    assert.ok(clash["jfh-cap.sku"]);
    const twice = fieldErrors(() => bulkEditCatalog(db, { items: [{ id: "jfh-cap", patch: { sku: "TD-NEW-1" } }, { id: "jfh-bar-mat", patch: { sku: "TD-NEW-1" } }] }));
    assert.ok(twice["jfh-cap.sku"] && twice["jfh-bar-mat.sku"]);
    assert.equal(find(db, "jfh-cap").sku, "TD-HAT-001", "nothing saved");
  });
});

describe("the one-off stock reset", () => {
  it("sets every tracked stock level to 0 once, and leaves untracked items alone", () => {
    const db = initialState();
    delete db.meta.stockCleared;
    const tracked = db.catalog.flatMap((i) => i.variants).filter((v) => Number.isInteger(v.stock) && v.stock > 0).length;
    assert.ok(tracked > 0);
    assert.equal(needsStockCleared(db), true);
    assert.equal(applyStockCleared(db), tracked);
    assert.ok(db.catalog.flatMap((i) => i.variants).every((v) => v.stock === 0 || v.stock === null));
    assert.equal(db.catalog.find((i) => i.id === "td-sample-cups").variants[0].stock, null, "made to order stays untracked");
    assert.equal(needsStockCleared(db), false);
    assert.equal(needsStockCleared(initialState()), false, "a new store keeps its starter stock");
  });
});
