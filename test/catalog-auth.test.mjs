import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createThrottle, parseCookies, signSession, verifySession } from "../src/auth.mjs";
import { SEED_CATALOG, normalizeItem } from "../src/catalog.mjs";
import { ValidationError } from "../src/validation.mjs";

const VALID = {
  name: "Mango Koozie",
  sku: "td-acc-001",
  brand: "jf-hadens",
  category: "Drinkware",
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
