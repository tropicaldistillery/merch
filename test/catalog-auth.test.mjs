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
  applyCategoryMoves,
  applyMinimums,
  applySeedPhotos,
  applySeedTextFixes,
  needsCategoryMoves,
  needsMinimums,
  needsSeedPhotos,
  needsSeedTextFixes,
  normalizeItem,
} from "../src/catalog.mjs";
import { CATEGORIES } from "../public/assets/shared.js";
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
    assert.equal(applyMinimums(db), 1);
    assert.equal(db.catalog.find((i) => i.id === "jfh-jigger").minPerOrder, 3);
    assert.equal(db.catalog.find((i) => i.id === "td-sample-cups").minPerOrder, 1);
    assert.equal(db.catalog.find((i) => i.id === "custom-item").minPerOrder, 1);
    assert.equal(needsMinimums(db), false);
  });
});

describe("starter catalog photos", () => {
  it("has a photo file for every starter item that names one", () => {
    for (const item of SEED_CATALOG) {
      assert.equal(item.image, SEED_PHOTOS[item.id] ?? "");
      if (!SEED_PHOTOS[item.id]) continue;
      assert.ok(existsSync(new URL(`../public${SEED_PHOTOS[item.id]}`, import.meta.url)), `${SEED_PHOTOS[item.id]} is missing`);
      assert.equal(normalizeItem(structuredClone(item), { catalog: SEED_CATALOG, existing: item }).image, item.image);
    }
  });

  it("fills in photos once, keeping the admin's own and respecting removals", { skip: !Object.keys(SEED_PHOTOS).length && "no starter photos yet" }, () => {
    const catalog = structuredClone(SEED_CATALOG).map((i) => ({ ...i, image: "" }));
    catalog.find((i) => i.id === "jfh-cap").image = "/images/0123456789abcdef0123456789abcdef.webp";
    const db = { meta: {}, catalog };
    assert.equal(needsSeedPhotos(db), true);
    assert.equal(applySeedPhotos(db), SEED_CATALOG.length - 1);
    assert.equal(db.catalog.find((i) => i.id === "jfh-cap").image, "/images/0123456789abcdef0123456789abcdef.webp");
    assert.equal(db.catalog.find((i) => i.id === "jfh-logo-tee").image, "/assets/merch/jfh-logo-tee.jpg");
    assert.equal(db.meta.seedPhotos, SEED_PHOTOS_VERSION);

    db.catalog.find((i) => i.id === "jfh-logo-tee").image = "";
    assert.equal(needsSeedPhotos(db), false);
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
