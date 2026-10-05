import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { initialState } from "../src/store/initial-state.mjs";
import {
  cancelOwnOrder,
  csvCell,
  normalizeAccountEdit,
  ordersToCsv,
  placeOrder,
  updateOrder,
  validateOrderInput,
} from "../src/orders.mjs";
import { ValidationError } from "../src/validation.mjs";

// 02:00 UTC on 6 Oct is still 5 Oct in New York.
const NOW = new Date("2026-10-06T02:00:00Z");
const JANE = { name: "Jane Rep", email: "jane@tropicaldistillery.com" };
const SAM = { name: "Sam Rep", email: "sam@tropicaldistillery.com" };

const HOME = {
  type: "self",
  attention: "Jane Rep",
  address1: "1 Palm Way",
  city: "Miami",
  state: "fl",
  postalCode: "331011234",
  phone: "1-305-555-0100",
};

const PELICAN = {
  type: "account",
  accountName: "The Rusty Pelican",
  accountType: "on-premise",
  attention: "Marco",
  phone: "(305) 555-0199",
  address1: "3201 Rickenbacker Cswy",
  city: "Key Biscayne",
  state: "FL",
  postalCode: "33149",
  deliveryNotes: "Before 11am, side door",
};

function order(overrides = {}) {
  return {
    shipTo: HOME,
    purpose: "team-gear",
    lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 2 }],
    ...overrides,
  };
}

function place(db, input, requester = JANE) {
  return placeOrder(db, input, { requester, now: NOW, timeZone: "America/New_York", prefix: "TD" });
}

function stock(db, itemId, variantId = "default") {
  return db.catalog.find((i) => i.id === itemId).variants.find((v) => v.id === variantId).stock;
}

function fieldErrors(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`);
    return error.fieldErrors;
  }
  assert.fail("expected a ValidationError");
}

describe("placing an order", () => {
  it("numbers it, reserves stock and normalizes the address", () => {
    const db = initialState();
    const before = stock(db, "jfh-logo-tee", "m");
    const placed = place(db, order({ saveAddress: true }));

    assert.equal(placed.number, "TD-1001");
    assert.equal(placed.status, "submitted");
    assert.equal(placed.totalUnits, 2);
    assert.equal(placed.totalCents, 2 * 1150);
    assert.equal(placed.shipTo.state, "FL");
    assert.equal(placed.shipTo.postalCode, "33101-1234");
    assert.equal(placed.shipTo.phone, "(305) 555-0100");
    assert.equal(stock(db, "jfh-logo-tee", "m"), before - 2);
    assert.equal(db.meta.nextOrderNumber, 1002);
    assert.equal(db.members[JANE.email].address.city, "Miami");
    assert.equal(place(db, order()).number, "TD-1002");
  });

  it("does not save the requester's address unless asked", () => {
    const db = initialState();
    place(db, order());
    assert.equal(db.members[JANE.email].address, undefined);
  });

  it("leaves untracked items unlimited", () => {
    const db = initialState();
    place(db, order({ lines: [{ itemId: "td-sample-cups", variantId: "default", quantity: 8 }] }));
    assert.equal(stock(db, "td-sample-cups"), null);
  });

  it("reports every missing field at once", () => {
    const errors = fieldErrors(() =>
      place(initialState(), { shipTo: { type: "account" }, shippingSpeed: "rush", lines: [] })
    );
    assert.deepEqual(Object.keys(errors).sort(), [
      "lines",
      "purpose",
      "rushReason",
      "shipTo.accountName",
      "shipTo.accountType",
      "shipTo.address1",
      "shipTo.attention",
      "shipTo.city",
      "shipTo.phone",
      "shipTo.postalCode",
      "shipTo.state",
    ]);
  });

  it("requires a phone for accounts but not for the requester", () => {
    const { phone, ...noPhone } = HOME;
    assert.ok(phone);
    assert.doesNotThrow(() => place(initialState(), order({ shipTo: noPhone })));
    const { phone: _p, ...accountNoPhone } = PELICAN;
    const errors = fieldErrors(() => place(initialState(), order({ shipTo: accountNoPhone, purpose: "event" })));
    assert.ok(errors["shipTo.phone"]);
  });

  it("rejects a bad ZIP and an unknown state", () => {
    const errors = fieldErrors(() =>
      place(initialState(), order({ shipTo: { ...HOME, postalCode: "1234", state: "ZZ" } }))
    );
    assert.ok(errors["shipTo.postalCode"]);
    assert.ok(errors["shipTo.state"]);
  });

  it("judges needed-by dates in the team's time zone", () => {
    const db = initialState();
    assert.doesNotThrow(() => place(db, order({ neededBy: "2026-10-05" })));
    assert.ok(fieldErrors(() => place(db, order({ neededBy: "2026-10-04" }))).neededBy);
    assert.ok(fieldErrors(() => place(db, order({ neededBy: "2026-02-30" }))).neededBy);
  });

  it("enforces the per-order limit across an item's sizes", () => {
    const errors = fieldErrors(() =>
      place(
        initialState(),
        order({
          lines: [
            { itemId: "jfh-logo-tee", variantId: "m", quantity: 4 },
            { itemId: "jfh-logo-tee", variantId: "l", quantity: 3 },
          ],
        })
      )
    );
    assert.match(errors.lines, /up to 6 of J\.F\. Haden's Logo Tee/);
  });

  it("merges repeated lines before checking stock", () => {
    const errors = fieldErrors(() =>
      place(
        initialState(),
        order({
          lines: [
            { itemId: "jfh-logo-tee", variantId: "3xl", quantity: 2 },
            { itemId: "jfh-logo-tee", variantId: "3xl", quantity: 2 },
          ],
        })
      )
    );
    assert.match(errors.lines, /Only 3 left of J\.F\. Haden's Logo Tee \(3XL\)/);
  });

  it("refuses hidden items, unknown options and silly quantities", () => {
    const db = initialState();
    db.catalog.find((i) => i.id === "jfh-cap").active = false;
    assert.match(fieldErrors(() => place(db, order({ lines: [{ itemId: "jfh-cap", quantity: 1 }] }))).lines, /no longer available/);
    assert.match(
      fieldErrors(() => place(db, order({ lines: [{ itemId: "jfh-logo-tee", variantId: "xxs", quantity: 1 }] }))).lines,
      /Choose an option/
    );
    assert.match(
      fieldErrors(() => place(db, order({ lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 1.5 }] }))).lines,
      /whole numbers/
    );
  });

  it("snapshots the line so later catalog edits don't rewrite history", () => {
    const db = initialState();
    const placed = place(db, order());
    db.catalog.find((i) => i.id === "jfh-logo-tee").costCents = 9999;
    assert.equal(placed.lines[0].unitCostCents, 1150);
    assert.equal(placed.lines[0].variantLabel, "M");
    assert.equal(placed.lines[0].sku, "TD-APP-001");
  });

  it("does not validate against the client's idea of price", () => {
    const { value } = validateOrderInput(
      order({ lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 1, unitCostCents: 1 }] }),
      { catalog: initialState().catalog, today: "2026-10-05" }
    );
    assert.equal(value.lines[0].unitCostCents, 1150);
  });
});

describe("the account directory", () => {
  it("saves a new account and links the order to it", () => {
    const db = initialState();
    const placed = place(db, order({ shipTo: PELICAN, purpose: "account-activation" }));
    assert.equal(db.accounts.length, 1);
    assert.equal(placed.shipTo.accountId, db.accounts[0].id);
    assert.equal(db.accounts[0].orderCount, 1);
    assert.equal(db.accounts[0].createdBy, JANE.email);
  });

  it("matches a retyped account by name and ZIP without degrading it", () => {
    const db = initialState();
    place(db, order({ shipTo: PELICAN, purpose: "event" }));
    place(
      db,
      order({
        shipTo: { ...PELICAN, accountName: "the rusty pelican!", deliveryNotes: "", address2: "" },
        purpose: "event",
      }),
      SAM
    );
    assert.equal(db.accounts.length, 1);
    assert.equal(db.accounts[0].name, "The Rusty Pelican");
    assert.equal(db.accounts[0].deliveryNotes, "Before 11am, side door");
    assert.equal(db.accounts[0].orderCount, 2);
  });

  it("takes a picked account's edits as given", () => {
    const db = initialState();
    place(db, order({ shipTo: PELICAN, purpose: "event" }));
    const id = db.accounts[0].id;
    place(db, order({ shipTo: { ...PELICAN, accountId: id, deliveryNotes: "", attention: "Ana" }, purpose: "event" }));
    assert.equal(db.accounts[0].deliveryNotes, "");
    assert.equal(db.accounts[0].attention, "Ana");
  });

  it("keeps two places with the same name in different ZIPs apart", () => {
    const db = initialState();
    place(db, order({ shipTo: PELICAN, purpose: "event" }));
    place(db, order({ shipTo: { ...PELICAN, city: "Naples", postalCode: "34102" }, purpose: "event" }));
    assert.equal(db.accounts.length, 2);
  });

  it("refuses an admin edit that would duplicate another account", () => {
    const db = initialState();
    place(db, order({ shipTo: PELICAN, purpose: "event" }));
    place(db, order({ shipTo: { ...PELICAN, accountName: "Pelican Annex" }, purpose: "event" }));
    const annex = db.accounts.find((a) => a.name === "Pelican Annex");
    const errors = fieldErrors(() =>
      normalizeAccountEdit({ ...annex, name: "THE RUSTY PELICAN" }, annex, db)
    );
    assert.ok(errors.name);
  });
});

describe("status changes", () => {
  function setup() {
    const db = initialState();
    const placed = place(db, order({ shipTo: PELICAN, purpose: "event", lines: [{ itemId: "jfh-led-sign", quantity: 1 }] }));
    return { db, id: placed.id };
  }
  const by = { actor: "Allie", now: NOW };

  it("walks submitted → approved → shipped → delivered with history", () => {
    const { db, id } = setup();
    updateOrder(db, id, { status: "approved", note: "Looks good" }, by);
    updateOrder(db, id, { status: "shipped", carrier: "ups", trackingNumber: "1Z 999 AA1" }, by);
    const { order: done } = updateOrder(db, id, { status: "delivered" }, by);
    assert.deepEqual(done.history.map((h) => h.status), ["submitted", "approved", "shipped", "delivered"]);
    assert.equal(done.shipment.trackingNumber, "1Z999AA1");
    assert.ok(done.shipment.deliveredAt);
    assert.equal(done.history[1].by, "Allie");
  });

  it("refuses transitions that skip or reverse the flow", () => {
    const { db, id } = setup();
    assert.throws(() => updateOrder(db, id, { status: "delivered" }, by), (e) => e.status === 409);
    updateOrder(db, id, { status: "cancelled" }, by);
    assert.throws(() => updateOrder(db, id, { status: "approved" }, by), (e) => e.status === 409);
  });

  it("needs a reason to decline, and puts the stock back", () => {
    const { db, id } = setup();
    assert.equal(stock(db, "jfh-led-sign"), 5);
    assert.ok(fieldErrors(() => updateOrder(db, id, { status: "declined" }, by)).note);
    assert.equal(stock(db, "jfh-led-sign"), 5, "a refused change leaves stock alone");
    updateOrder(db, id, { status: "declined", note: "Account isn't a priority this quarter" }, by);
    assert.equal(stock(db, "jfh-led-sign"), 6);
  });

  it("needs tracking to ship by carrier, but not by hand", () => {
    const { db, id } = setup();
    assert.ok(fieldErrors(() => updateOrder(db, id, { status: "shipped", carrier: "ups" }, by)).trackingNumber);
    assert.ok(fieldErrors(() => updateOrder(db, id, { status: "shipped", carrier: "pigeon" }, by)).carrier);
    const { order: shipped } = updateOrder(db, id, { status: "shipped", carrier: "hand" }, by);
    assert.equal(shipped.status, "shipped");
  });

  it("corrects tracking without a status change", () => {
    const { db, id } = setup();
    updateOrder(db, id, { status: "shipped", carrier: "ups", trackingNumber: "WRONG" }, by);
    const { order: fixed, statusChanged } = updateOrder(db, id, { carrier: "fedex", trackingNumber: "123456789012" }, by);
    assert.equal(statusChanged, false);
    assert.equal(fixed.shipment.carrier, "fedex");
    assert.equal(fixed.history.length, 2);
  });

  it("saves the internal note on its own", () => {
    const { db, id } = setup();
    const { order: noted, statusChanged } = updateOrder(db, id, { adminNote: "Call Marco first" }, by);
    assert.equal(statusChanged, false);
    assert.equal(noted.adminNote, "Call Marco first");
  });

  it("lets requesters cancel only their own submitted orders", () => {
    const { db, id } = setup();
    assert.throws(() => cancelOwnOrder(db, id, { ...SAM, now: NOW }), (e) => e.status === 404);
    cancelOwnOrder(db, id, { ...JANE, now: NOW });
    assert.equal(stock(db, "jfh-led-sign"), 6);

    const other = place(db, order({ lines: [{ itemId: "jfh-cap", quantity: 1 }] }));
    updateOrder(db, other.id, { status: "approved" }, by);
    assert.throws(() => cancelOwnOrder(db, other.id, { ...JANE, now: NOW }), (e) => e.status === 409);
  });
});

describe("CSV export", () => {
  it("defuses formulas and quotes awkward cells", () => {
    assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell("+1 305"), "'+1 305");
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell("plain"), "plain");
  });

  it("writes one row per order line", () => {
    const db = initialState();
    place(db, order({
      lines: [
        { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 },
        { itemId: "jfh-cap", quantity: 1 },
      ],
      notes: "@everyone",
    }));
    const rows = ordersToCsv(db.orders).trim().split("\r\n");
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^order_number,placed_at,status/);
    assert.match(rows[1], /TD-1001/);
    assert.match(rows[1], /'@everyone$/);
  });
});
