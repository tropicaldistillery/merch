import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { initialState } from "../src/store/initial-state.mjs";
import {
  bulkUpdateOrders,
  cancelOwnOrder,
  csvCell,
  decisionEvent,
  forwardItems,
  normalizeAccountEdit,
  ordersToCsv,
  placeOrder,
  pullBackForward,
  requesterView,
  reviewOrder,
  shipForward,
  supplierView,
  updateOrder,
  validateOrderInput,
} from "../src/orders.mjs";
import { inHouseLines } from "../public/assets/shared.js";
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

  it("always ships standard: rush isn't offered any more", () => {
    // as sent by a checkout page opened before rush was taken away
    const placed = place(initialState(), order({ shippingSpeed: "rush", rushReason: "Tasting Friday" }));
    assert.equal(placed.shippingSpeed, "standard");
    assert.equal(placed.rushReason, "");
  });

  it("reports every missing field at once", () => {
    const errors = fieldErrors(() =>
      place(initialState(), { shipTo: { type: "account" }, shippingSpeed: "rush", lines: [] })
    );
    assert.deepEqual(Object.keys(errors).sort(), [
      "lines",
      "purpose",
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

  it("enforces an item's minimum across its lines", () => {
    const db = initialState();
    const jigger = db.catalog.find((i) => i.id === "jfh-jigger");
    assert.equal(jigger.minPerOrder, 3, "the starter jigger has a minimum");
    const errors = fieldErrors(() => place(db, order({ lines: [{ itemId: "jfh-jigger", variantId: "default", quantity: 2 }] })));
    assert.match(errors.lines, /Japanese Jigger is ordered in at least 3/);
    const placed = place(db, order({ lines: [{ itemId: "jfh-jigger", variantId: "default", quantity: 3 }] }));
    assert.equal(placed.totalUnits, 3);
  });

  it("only takes whole steps of an item sold in increments", () => {
    const db = initialState();
    Object.assign(db.catalog.find((i) => i.id === "jfh-jigger"), { minPerOrder: 6, maxPerOrder: 24, orderIncrement: 6 });
    const errors = fieldErrors(() => place(db, order({ lines: [{ itemId: "jfh-jigger", variantId: "default", quantity: 9 }] })));
    assert.match(errors.lines, /Japanese Jigger is ordered in multiples of 6/);
    assert.equal(place(db, order({ lines: [{ itemId: "jfh-jigger", variantId: "default", quantity: 12 }] })).totalUnits, 12);
  });

  it("treats items saved before minimums existed as minimum one", () => {
    const db = initialState();
    delete db.catalog.find((i) => i.id === "jfh-jigger").minPerOrder;
    const placed = place(db, order({ lines: [{ itemId: "jfh-jigger", variantId: "default", quantity: 1 }] }));
    assert.equal(placed.totalUnits, 1);
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
    assert.equal(placed.lines[0].sku, "JFH-APP-001");
  });

  it("needs one of the item's colors when it comes in colors", () => {
    const db = initialState();
    const polo = (color, variantId = "m", quantity = 1) => ({ itemId: "td-team-polo", variantId, color, quantity });
    assert.match(fieldErrors(() => place(db, order({ lines: [polo("")] }))).lines, /Choose a color for Tropical Distillery Team Polo/);
    assert.match(fieldErrors(() => place(db, order({ lines: [polo("Chartreuse")] }))).lines, /Choose a color/);

    const photo = "/images/0000000000000000000000000000000a.webp";
    db.catalog.find((i) => i.id === "td-team-polo").images = [{ url: photo, color: "Navy" }];
    const placed = place(db, order({ lines: [polo("Navy", "m"), polo("Red", "l"), polo("Navy", "m")] }));
    assert.deepEqual(placed.lines.map((l) => [l.color, l.variantLabel, l.quantity]), [["Navy", "M", 2], ["Red", "L", 1]]);
    assert.equal(placed.lines[0].image, photo, "the line shows the chosen color's photo");
    assert.equal(stock(db, "td-team-polo", "m"), 6);
  });

  it("ignores a color on an item that doesn't come in colors", () => {
    const placed = place(initialState(), order({ lines: [{ itemId: "jfh-cap", quantity: 1, color: "Navy" }] }));
    assert.equal(placed.lines[0].color, "");
  });

  it("shares an option's stock across colors and counts colors toward the limit", () => {
    const db = initialState();
    const lines = [
      { itemId: "td-team-polo", variantId: "3xl", color: "Navy", quantity: 1 },
      { itemId: "td-team-polo", variantId: "3xl", color: "Black", quantity: 2 },
    ];
    assert.match(fieldErrors(() => place(db, order({ lines }))).lines, /Only 2 left of Tropical Distillery Team Polo \(3XL\)/);
    const tooMany = [
      { itemId: "td-team-polo", variantId: "m", color: "Navy", quantity: 2 },
      { itemId: "td-team-polo", variantId: "m", color: "Red", quantity: 2 },
    ];
    assert.match(fieldErrors(() => place(db, order({ lines: tooMany }))).lines, /up to 3 of Tropical Distillery Team Polo/);
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

  it("ships now and takes the tracking number later", () => {
    const { db, id } = setup();
    assert.ok(fieldErrors(() => updateOrder(db, id, { status: "shipped", carrier: "pigeon" }, by)).carrier);
    assert.ok(fieldErrors(() => updateOrder(db, id, { status: "shipped", trackingNumber: "1Z1" }, by)).carrier, "a tracking number needs its carrier");
    const { order: shipped } = updateOrder(db, id, { status: "shipped", carrier: "ups" }, by);
    assert.equal(shipped.status, "shipped");
    assert.equal(shipped.shipment.trackingNumber, "");

    const added = updateOrder(db, id, { carrier: "ups", trackingNumber: "1Z 999" }, by);
    assert.deepEqual([added.statusChanged, added.trackingAdded, added.order.shipment.trackingNumber], [false, true, "1Z999"]);
    assert.equal(added.order.shipment.shippedAt, shipped.shipment.shippedAt, "still shipped when it shipped");
    assert.equal(updateOrder(db, id, { carrier: "ups", trackingNumber: "1Z999" }, by).trackingAdded, false, "the same number isn't news");
    assert.equal(updateOrder(db, id, { adminNote: "Boxed" }, by).trackingAdded, false);
  });

  it("can ship with no carrier yet", () => {
    const { db, id } = setup();
    const { order: shipped } = updateOrder(db, id, { status: "shipped" }, by);
    assert.deepEqual([shipped.shipment.carrier, shipped.shipment.trackingNumber], ["", ""]);
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
    assert.match(rows[0], /,item,color,option,quantity,/);
    assert.match(rows[1], /TD-1001/);
    assert.match(rows[1], /'@everyone$/);
  });
});

describe("the per-person tracker", () => {
  it("adds up each person's items, joins their shared-code and personal orders, and lists everyone", async () => {
    const { trackByPerson } = await import("../public/assets/shared.js");
    const { trackerToCsv } = await import("../src/orders.mjs");
    const db = initialState();
    const people = [
      { id: "p-jane", name: "Jane Rep", email: JANE.email },
      { id: "p-lee", name: "Lee", email: "lee@tropicaldistillery.com" },
    ];
    const first = place(db, order({ lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 2 }] }));
    const second = placeOrder(db, order({ lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 1 }] }), {
      requester: { ...JANE, personId: "p-jane" },
      now: new Date("2026-11-02T15:00:00Z"),
      timeZone: "America/New_York",
      prefix: "TD",
    });
    const dropped = place(db, order({ lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 5 }] }));
    updateOrder(db, dropped.id, { status: "cancelled" }, { actor: "Allie", now: NOW });
    place(db, order({ lines: [{ itemId: "jfh-cap", quantity: 1 }] }), SAM);

    const rows = trackByPerson(db.orders, { people });
    assert.deepEqual(rows.map((r) => r.email), [JANE.email, SAM.email, "lee@tropicaldistillery.com"]);
    const [jane, sam, lee] = rows;
    assert.equal(jane.orders, 2, "the cancelled order doesn't count");
    assert.deepEqual(jane.orderIds, [first.id, second.id]);
    assert.equal(jane.items.length, 1);
    assert.equal(jane.items[0].quantity, 3);
    assert.equal(jane.items[0].orders, 2);
    assert.equal(jane.lastOrderAt, second.createdAt);
    assert.equal(sam.onList, false);
    assert.equal(lee.orders, 0, "on the list but hasn't ordered");

    const november = trackByPerson(db.orders, { people, from: "2026-11-01T04:00:00.000Z", to: "2026-12-01T05:00:00.000Z" });
    assert.equal(november[0].orders, 1);
    assert.equal(november.find((r) => r.email === SAM.email), undefined);

    const csv = trackerToCsv(rows).trim().split("\r\n");
    assert.equal(csv.length, 4, "a header, Jane's tee, Sam's cap, Lee's empty row");
    assert.match(csv[3], /^Lee,lee@tropicaldistillery.com,,yes,0,0,0.00,,,,,,0,0.00,0$/);
  });
});

describe("approving and denying item by item", () => {
  const by = { actor: "Allie", now: NOW };
  function setup() {
    const db = initialState();
    const placed = place(db, order({
      shipTo: PELICAN,
      purpose: "event",
      lines: [
        { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 },
        { itemId: "jfh-led-sign", quantity: 1 },
      ],
    }));
    return { db, id: placed.id, tees: stock(db, "jfh-logo-tee", "m"), signs: stock(db, "jfh-led-sign") };
  }
  const yes = { status: "approved" };

  it("approves some items and denies others, putting the denied units back", () => {
    const { db, id, tees, signs } = setup();
    const { order: reviewed, event } = reviewOrder(db, id, {
      decisions: [yes, { status: "denied", reason: "  Signs are for priority accounts  " }],
      note: "Tees are on the way",
    }, by);
    assert.equal(event, "order.reviewed");
    assert.equal(reviewed.status, "approved");
    assert.deepEqual(reviewed.lines.map((l) => l.decision.status), ["approved", "denied"]);
    assert.equal(reviewed.lines[1].decision.reason, "Signs are for priority accounts");
    assert.equal(reviewed.lines[0].decision.reason, "", "only a denied item keeps a reason");
    assert.deepEqual(reviewed.history.at(-1).review, { approved: 1, denied: 1 });
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees);
    assert.equal(stock(db, "jfh-led-sign"), signs + 1);
    assert.equal(decisionEvent(reviewed), "order.reviewed");

    const rows = ordersToCsv(db.orders).trim().split("\r\n");
    assert.match(rows[0], /,item_status,item_note,/);
    assert.match(rows[2], /,Not approved,Signs are for priority accounts,/);

    // Cancelling it now returns only the units still held.
    updateOrder(db, id, { status: "cancelled" }, by);
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees + 2);
    assert.equal(stock(db, "jfh-led-sign"), signs + 1);
  });

  it("approves everything as order.approved", () => {
    const { db, id } = setup();
    const { order: reviewed, event } = reviewOrder(db, id, { decisions: [yes, yes] }, by);
    assert.deepEqual([reviewed.status, event, decisionEvent(reviewed)], ["approved", "order.approved", "order.approved"]);
  });

  it("declines the order when everything is denied, and needs a reason", () => {
    const { db, id, tees, signs } = setup();
    const no = { status: "denied" };
    assert.ok(fieldErrors(() => reviewOrder(db, id, { decisions: [no, no] }, by)).note);
    assert.equal(stock(db, "jfh-led-sign"), signs, "a refused review leaves stock alone");
    // Reasons on each item are enough.
    const { order: declined, event } = reviewOrder(db, id, { decisions: [{ ...no, reason: "Out of budget" }, { ...no, reason: "Not this quarter" }] }, by);
    assert.deepEqual([declined.status, event], ["declined", "order.declined"]);
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees + 2);
    assert.equal(stock(db, "jfh-led-sign"), signs + 1);
    assert.equal(declined.history.at(-1).status, "declined");
    assert.throws(() => reviewOrder(db, id, { decisions: [yes, yes] }, by), (e) => e.status === 409, "declined is final");
  });

  it("needs a decision for every item", () => {
    const { db, id } = setup();
    const errors = fieldErrors(() => reviewOrder(db, id, { decisions: [yes] }, by));
    assert.ok(errors["decisions.1"]);
    assert.ok(fieldErrors(() => reviewOrder(db, id, { decisions: [yes, { status: "maybe" }] }, by))["decisions.1"]);
  });

  it("can change a decision before shipping, taking the stock again if it's there", () => {
    const { db, id, signs } = setup();
    reviewOrder(db, id, { decisions: [yes, { status: "denied", reason: "No" }] }, by);
    assert.equal(stock(db, "jfh-led-sign"), signs + 1);
    const { order: changed, event } = reviewOrder(db, id, { decisions: [yes, yes] }, by);
    assert.equal(event, "order.approved");
    assert.equal(changed.lines[1].decision.status, "approved");
    assert.equal(stock(db, "jfh-led-sign"), signs);

    // Denied again, and then the stock runs out before it's approved again.
    reviewOrder(db, id, { decisions: [yes, { status: "denied" }] }, by);
    db.catalog.find((i) => i.id === "jfh-led-sign").variants[0].stock = 0;
    assert.match(fieldErrors(() => reviewOrder(db, id, { decisions: [yes, yes] }, by))["decisions.1"], /Only 0 left/);
  });

  it("can't review an order once it has shipped", () => {
    const { db, id } = setup();
    reviewOrder(db, id, { decisions: [yes, yes] }, by);
    updateOrder(db, id, { status: "shipped", carrier: "hand" }, by);
    assert.throws(() => reviewOrder(db, id, { decisions: [yes, yes] }, by), (e) => e.status === 409);
    assert.equal(decisionEvent(db.orders[0]), null);
  });
});

describe("forwarding items to someone else to ship", () => {
  const by = { actor: "Allie", now: NOW };
  const TEN10 = { toName: "Ten 10 Design", toEmail: " Orders@Ten10Design.com " };
  function setup({ approve = true } = {}) {
    const db = initialState();
    const placed = place(db, order({
      shipTo: PELICAN,
      purpose: "event",
      lines: [
        { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 },
        { itemId: "jfh-led-sign", quantity: 1 },
        { itemId: "jfh-logo-tee", variantId: "l", quantity: 1 },
      ],
    }));
    if (approve) reviewOrder(db, placed.id, { decisions: [{ status: "approved" }, { status: "approved" }, { status: "approved" }] }, by);
    return { db, id: placed.id, tees: stock(db, "jfh-logo-tee", "m"), large: stock(db, "jfh-logo-tee", "l"), signs: stock(db, "jfh-led-sign") };
  }

  it("hands the picked items to someone, leaving the rest to pack", () => {
    const { db, id, tees, signs } = setup();
    const { order: o, forward } = forwardItems(db, id, { ...TEN10, lines: [1, 0], note: "PO 4471" }, by);
    assert.deepEqual(forward.to, { name: "Ten 10 Design", email: "orders@ten10design.com" });
    assert.deepEqual(forward.lines, [0, 1]);
    assert.deepEqual([forward.status, forward.note, forward.by, forward.restocked], ["sent", "PO 4471", "Allie", false]);
    assert.equal(o.status, "approved");
    assert.deepEqual(inHouseLines(o).map((l) => l.variantId), ["l"]);
    assert.deepEqual(o.history.at(-1).forward, { id: forward.id, event: "sent", to: "Ten 10 Design", items: 2 });
    // Without restocking, the units stay set aside.
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees);
    assert.equal(stock(db, "jfh-led-sign"), signs);

    const rows = ordersToCsv(db.orders).trim().split("\r\n");
    assert.match(rows[0], /,item_note,fulfilled_by,carrier,tracking_number,/);
    assert.match(rows[1], /,Ten 10 Design,,,/);
    assert.match(rows[3], /,Approved,,,,,/);

    // The requester sees who ships what, but not their email, the message or the admin note.
    o.adminNote = "Charge to the Q4 events budget";
    const seen = requesterView(o);
    assert.equal("adminNote" in seen, false);
    assert.deepEqual(seen.forwards, [{ id: forward.id, name: "Ten 10 Design", lines: [0, 1], status: "sent", shipment: null }]);
    assert.ok(seen.history.every((h) => !h.forward));
    assert.doesNotMatch(JSON.stringify(seen), /ten10design|PO 4471|Q4 events/);
    assert.ok(o.adminNote, "the order itself keeps its note");
  });

  it("checks what can be forwarded and to whom", () => {
    const fresh = setup({ approve: false });
    assert.throws(() => forwardItems(fresh.db, fresh.id, { ...TEN10, lines: [0] }, by), (e) => e.status === 409 && /Approve the order/.test(e.message));

    const { db, id } = setup();
    assert.ok(fieldErrors(() => forwardItems(db, id, { ...TEN10, lines: [] }, by)).lines);
    assert.ok(fieldErrors(() => forwardItems(db, id, { ...TEN10, lines: [7] }, by)).lines);
    const errors = fieldErrors(() => forwardItems(db, id, { toName: " ", toEmail: "ten10", lines: [0] }, by));
    assert.ok(errors.toName && errors.toEmail);

    forwardItems(db, id, { ...TEN10, lines: [0] }, by);
    assert.ok(fieldErrors(() => forwardItems(db, id, { toName: "Jo", toEmail: "jo@x.com", lines: [0] }, by)).lines, "already forwarded");
    // A forwarded item can't be denied until it's pulled back.
    const review = fieldErrors(() => reviewOrder(db, id, { decisions: [{ status: "denied", reason: "x" }, { status: "approved" }, { status: "approved" }] }, by));
    assert.match(review["decisions.0"], /Pull it back/);
    // Denied items can't be forwarded.
    reviewOrder(db, id, { decisions: [{ status: "approved" }, { status: "denied", reason: "No" }, { status: "approved" }] }, by);
    assert.ok(fieldErrors(() => forwardItems(db, id, { ...TEN10, lines: [1] }, by)).lines);
  });

  it("can put the units back on the shelf, and takes them again when pulled back", () => {
    const { db, id, tees, signs } = setup();
    const { forward } = forwardItems(db, id, { ...TEN10, lines: [0, 1], restock: true }, by);
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees + 2);
    assert.equal(stock(db, "jfh-led-sign"), signs + 1);

    // Units that have gone since can't come back.
    db.catalog.find((i) => i.id === "jfh-led-sign").variants[0].stock = 0;
    assert.throws(() => pullBackForward(db, id, forward.id, by), (e) => e.status === 409 && /Only 0 .*LED/i.test(e.message));
    db.catalog.find((i) => i.id === "jfh-led-sign").variants[0].stock = signs + 1;

    const { order: o } = pullBackForward(db, id, forward.id, by);
    assert.equal(forward.status, "cancelled");
    assert.equal(inHouseLines(o).length, 3, "the items are the merch team's to ship again");
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees);
    assert.equal(stock(db, "jfh-led-sign"), signs);
    assert.equal(o.history.at(-1).forward.event, "cancelled");
    assert.throws(() => pullBackForward(db, id, forward.id, by), (e) => e.status === 409);
    // They can be forwarded again.
    assert.equal(forwardItems(db, id, { ...TEN10, lines: [0] }, by).forward.lines[0], 0);
  });

  it("shows whoever has a forward just their items and where they go", () => {
    const { db, id } = setup();
    const { order: o, forward } = forwardItems(db, id, { ...TEN10, lines: [1], note: "PO 4471" }, by);
    o.adminNote = "Q4 events budget";
    const view = supplierView(o, forward);
    assert.equal(view.number, "TD-1001");
    assert.deepEqual(view.forward.items.map((i) => [i.quantity, i.sku]), [[1, o.lines[1].sku]]);
    assert.equal(view.forward.note, "PO 4471");
    assert.equal(view.shipTo.accountName, "The Rusty Pelican");
    assert.equal(view.shipTo.deliveryNotes, "Before 11am, side door");
    assert.deepEqual([view.forward.status, view.canUpdate], ["sent", true]);
    const text = JSON.stringify(view);
    assert.doesNotMatch(text, /jane@|Cents|Q4 events|ten10design/i, "no requester email, prices, admin note or their own address");
    assert.doesNotMatch(text, /Logo Tee/, "nothing else on the order");

    // A supplier has to say how it shipped.
    assert.ok(fieldErrors(() => shipForward(db, id, forward.id, { trackingNumber: "" }, { ...by, requireCarrier: true })).carrier);
    shipForward(db, id, forward.id, { carrier: "fedex" }, { ...by, requireCarrier: true });
    assert.equal(supplierView(o, forward).forward.status, "shipped");

    // Once the order is cancelled, the page says it's called off and nothing more can be done.
    const other = setup();
    const f2 = forwardItems(other.db, other.id, { ...TEN10, lines: [0] }, by).forward;
    updateOrder(other.db, other.id, { status: "cancelled" }, by);
    const off = supplierView(other.db.orders[0], f2);
    assert.deepEqual([off.forward.status, off.canUpdate], ["cancelled", false]);
    assert.throws(() => shipForward(other.db, other.id, f2.id, { carrier: "ups" }, by), (e) => e.status === 409);
  });

  it("ships a forward now and takes its tracking later", () => {
    const { db, id } = setup();
    const { forward } = forwardItems(db, id, { ...TEN10, lines: [0] }, by);
    const first = shipForward(db, id, forward.id, { carrier: "ups" }, by);
    assert.equal(first.event, "forward.shipped");
    assert.deepEqual([forward.status, forward.shipment.carrier, forward.shipment.trackingNumber], ["shipped", "ups", ""]);
    assert.equal(first.order.status, "approved", "the rest still has to ship");
    assert.equal(shipForward(db, id, forward.id, { carrier: "ups", trackingNumber: "1Z 999" }, by).event, "forward.tracking");
    assert.equal(forward.shipment.trackingNumber, "1Z999");
    assert.equal(forward.shipment.shippedAt, first.forward.shipment.shippedAt);
    assert.equal(shipForward(db, id, forward.id, { carrier: "ups", trackingNumber: "1Z999" }, by).event, null, "same number, nothing new");
    assert.ok(fieldErrors(() => shipForward(db, id, forward.id, { trackingNumber: "123" }, by)).carrier);
    assert.throws(() => pullBackForward(db, id, forward.id, by), (e) => e.status === 409 && /already shipped/.test(e.message));
    const rows = ordersToCsv(db.orders).trim().split("\r\n");
    assert.match(rows[1], /,Ten 10 Design,UPS,1Z999,/);
  });

  it("marks the order shipped once every forward has gone and nothing is left to pack", () => {
    const { db, id } = setup();
    const a = forwardItems(db, id, { ...TEN10, lines: [0, 1] }, by).forward;
    const b = forwardItems(db, id, { toName: "Jo Rep", toEmail: "jo@tropicaldistillery.com", lines: [2] }, by).forward;
    assert.equal(shipForward(db, id, a.id, {}, by).order.status, "approved");
    const { order: o } = shipForward(db, id, b.id, { carrier: "hand" }, by);
    assert.equal(o.status, "shipped");
    assert.equal(o.shipment, null);
    assert.deepEqual(o.history.slice(-2).map((h) => h.forward?.event ?? h.status), ["shipped", "shipped"]);
    const { order: done } = updateOrder(db, id, { status: "delivered" }, by);
    assert.deepEqual([done.status, done.shipment], ["delivered", null]);
  });

  it("ships through its forwards alone once nothing is left for the merch team", () => {
    const { db, id } = setup();
    const f = forwardItems(db, id, { ...TEN10, lines: [0, 1, 2] }, by).forward;
    assert.throws(() => updateOrder(db, id, { status: "shipped", carrier: "ups" }, by), (e) => e.status === 409 && /mark each forward shipped/.test(e.message));
    const other = place(db, order()).id;
    const bulk = bulkUpdateOrders(db, { orderIds: [id, other], action: "shipped" }, by);
    assert.deepEqual(bulk.updated.map((o) => o.id), [other]);
    assert.deepEqual(bulk.skipped.map((x) => x.reason), ["Everything on it was forwarded."]);
    pullBackForward(db, id, f.id, by);

    // Denying the last item left for the merch team, after the forward shipped.
    const g = forwardItems(db, id, { ...TEN10, lines: [0, 1] }, by).forward;
    shipForward(db, id, g.id, {}, by);
    const { order: o } = reviewOrder(db, id, { decisions: [{ status: "approved" }, { status: "approved" }, { status: "denied", reason: "Out of L" }] }, by);
    assert.equal(o.status, "shipped");
  });

  it("calls off waiting forwards when the order is cancelled", () => {
    const { db, id, tees, large, signs } = setup();
    const kept = forwardItems(db, id, { ...TEN10, lines: [0], restock: true }, by).forward;
    const shipped = forwardItems(db, id, { toName: "Jo Rep", toEmail: "jo@tropicaldistillery.com", lines: [1] }, by).forward;
    shipForward(db, id, shipped.id, {}, by);
    const { cancelledForwards } = updateOrder(db, id, { status: "cancelled", note: "Event moved" }, by);
    assert.deepEqual(cancelledForwards.map((f) => f.id), [kept.id]);
    assert.equal(shipped.status, "shipped", "what already went out stays shipped");
    // The restocked tees and the shipped sign aren't put back twice; the L tee is.
    assert.equal(stock(db, "jfh-logo-tee", "m"), tees + 2);
    assert.equal(stock(db, "jfh-led-sign"), signs);
    assert.equal(stock(db, "jfh-logo-tee", "l"), large + 1);

    const other = setup();
    const f = forwardItems(other.db, other.id, { ...TEN10, lines: [0] }, by).forward;
    const bulk = bulkUpdateOrders(other.db, { orderIds: [other.id], action: "cancelled" }, by);
    assert.deepEqual(bulk.cancelledForwards.map((c) => c.forward.id), [f.id]);
  });
});
