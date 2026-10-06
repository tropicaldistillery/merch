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
  applySeedTextFixes,
  needsAddedItems,
  needsCategoryMoves,
  needsColors,
  needsMinimums,
  needsPoloColors,
  needsSeedPhotos,
  needsSeedSuppliers,
  needsSeedTextFixes,
  normalizeItem,
  publicItem,
} from "../src/catalog.mjs";
import { CATEGORIES, COLOR_OPTIONS, MAX_IMAGES, generateSku, imageFor, itemImages, quantityRuleText } from "../public/assets/shared.js";
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
      normalizeItem({ ...VALID, sku: "TD-APP-001", costCents: -5, variants: [{ label: "", stock: "2.5" }] }, { catalog: SEED_CATALOG })
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
    const supplier = { company: "Ten 10 Design LLC", contact: "Sam", email: "sam@example.com", phone: "555-0100", website: "example.com/order", itemNumber: "1602-14", notes: "PO 1" };
    const item = normalizeItem({ ...VALID, supplier }, { catalog: SEED_CATALOG });
    assert.deepEqual(item.supplier, { ...supplier, website: "https://example.com/order" });
    assert.equal("supplier" in publicItem(item), false);
    // a client that doesn't send them leaves them as they were
    const edited = normalizeItem({ ...VALID, name: "Renamed" }, { catalog: SEED_CATALOG, existing: item });
    assert.equal(edited.supplier.company, "Ten 10 Design LLC");
    // and clearing them clears them
    assert.equal(normalizeItem({ ...VALID, supplier: {} }, { catalog: SEED_CATALOG, existing: item }).supplier.company, "");
  });

  it("refuses a bad supplier email or website", () => {
    const errors = errorsOf(() => normalizeItem({ ...VALID, supplier: { email: "not an email", website: "nope" } }, { catalog: SEED_CATALOG }));
    assert.ok(errors.supplierEmail);
    assert.ok(errors.supplierWebsite);
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
    const old = { "td-tumbler": "Drinkware", "jfh-led-sign": "Point of Sale", "jfh-stickers": "Print", "jfh-bar-mat": "Point of Sale" };
    const catalog = structuredClone(SEED_CATALOG).map((i) => ({ ...i, category: old[i.id] ?? i.category }));
    catalog.find((i) => i.id === "jfh-bar-mat").category = "Sampling & Events"; // the admin moved it
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
  it("builds a readable SKU from the category and the name's key words", () => {
    assert.equal(generateSku("J.F. Haden's Throw Pillow", "VIP"), "VIP-THROW-PILLOW");
    assert.equal(generateSku("Twin P Whiskey Barrel Head Sign", "VIP"), "VIP-BARREL-HEAD-SIGN");
    assert.equal(generateSku("6 ft Table Throw", "Sampling & Events"), "EVT-6FT-TABLE-THROW");
    assert.equal(generateSku("Mango Koozie", "Giveaways", ["GIV-MANGO-KOOZIE", "GIV-MANGO-KOOZIE-2"]), "GIV-MANGO-KOOZIE-3");
    assert.equal(generateSku("J.F. Haden's", "Print"), "PRT-JF-HADENS", "falls back to the brand words");
  });

  it("fills a blank SKU on a new item and keeps an existing item's", () => {
    const made = normalizeItem({ ...VALID, sku: "" }, { catalog: [{ id: "x", sku: "GIV-MANGO-KOOZIE" }] });
    assert.equal(made.sku, "GIV-MANGO-KOOZIE-2");
    const kept = normalizeItem({ ...VALID, sku: "" }, { catalog: [made], existing: made });
    assert.equal(kept.sku, "GIV-MANGO-KOOZIE-2");
  });
});

describe("colors and photo galleries", () => {
  const photo = (n) => `/images/${String(n).padStart(32, "0")}.webp`;

  it("offers the team polo in the nine standard colors", () => {
    const polo = SEED_CATALOG.find((i) => i.id === "td-team-polo");
    assert.deepEqual(polo.colors, ["White", "Navy", "Burgundy", "Black", "Royal", "Red", "Forest Green", "Grey", "Carolina Blue"]);
    assert.deepEqual(polo.colors, COLOR_OPTIONS.map((c) => c.name));
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
    assert.equal(applyColors(db), 4);
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
    db.catalog.find((i) => i.id === "jfh-cap").sku = "TD-APP-006";
    const jfh = applyAddedItems(db).find((i) => i.id === "jfh-polo");
    assert.notEqual(jfh.sku, "TD-APP-006");
    assert.match(jfh.sku, /^APP-/);
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
