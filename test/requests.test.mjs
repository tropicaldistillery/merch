import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestEmails, renderEmail } from "../src/email.mjs";
import { MAX_OPEN_REQUESTS, placeRequest, requestsWithStock, settleRequests, withdrawRequest } from "../src/requests.mjs";
import { initialState } from "../src/store/initial-state.mjs";

const NOW = new Date("2026-10-13T15:00:00Z");
const JANE = { name: "Jane Rep", email: "jane@tropicaldistillery.com", personId: "p-jane" };
const REP = { name: "Dee", email: "jane@tropicaldistillery.com", distributorId: "d1", distributor: "Reyes Beverage Group Florida" };

function store() {
  const db = initialState();
  const item = (id) => db.catalog.find((i) => i.id === id);
  item("td-team-polo").variants.find((v) => v.id === "l").stock = 0;
  item("jfh-citrus-bottle").variants[0].stock = 0;
  return { db, item };
}

const status = (fn) => {
  try {
    fn();
    return 0;
  } catch (error) {
    return error.status;
  }
};

describe("requests for out-of-stock items", () => {
  it("take the option, color and how many, and only for what can't be ordered now", () => {
    const { db, item } = store();
    const { request, updated } = placeRequest(
      db,
      { itemId: "td-team-polo", variantId: "l", color: "Navy", quantity: 12, note: "  For the Miami launch  " },
      { requester: JANE, now: NOW }
    );
    assert.equal(updated, false);
    assert.deepEqual(
      [request.status, request.name, request.variantLabel, request.color, request.quantity, request.note, request.category],
      ["open", item("td-team-polo").name, "L", "Navy", 12, "For the Miami launch", "Apparel"]
    );
    assert.equal(request.requester.personId, "p-jane");

    const errorsOf = (input) => {
      try {
        placeRequest(db, input, { requester: JANE, now: NOW });
      } catch (error) {
        return error.fieldErrors;
      }
    };
    assert.ok(errorsOf({ itemId: "td-team-polo", color: "Navy", quantity: 2 }).variantId, "a size is needed");
    assert.ok(errorsOf({ itemId: "td-team-polo", variantId: "l", quantity: 2 }).color, "so is a color");
    assert.ok(errorsOf({ itemId: "jfh-citrus-bottle", quantity: 0 }).quantity, "and how many");
    assert.equal(status(() => placeRequest(db, { itemId: "td-team-polo", variantId: "m", color: "Navy", quantity: 2 }, { requester: JANE })), 409, "M is in stock");
    assert.equal(status(() => placeRequest(db, { itemId: "td-team-polo", variantId: "m", color: "Navy", quantity: 20 }, { requester: JANE })), 0, "but not 20 of them");
    assert.equal(status(() => placeRequest(db, { itemId: "td-sample-cups", quantity: 5 }, { requester: JANE })), 409, "made to order");
    assert.equal(status(() => placeRequest(db, { itemId: "nope", quantity: 5 }, { requester: JANE })), 404);
  });

  it("update an open request for the same thing, and cap how many are open", () => {
    const { db } = store();
    const first = placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 6 }, { requester: JANE, now: NOW }).request;
    const again = placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 10, note: "More" }, { requester: JANE, now: NOW });
    assert.equal(again.updated, true);
    assert.equal(again.request, first);
    assert.equal(first.quantity, 10);
    assert.equal(db.requests.length, 1);

    // The rep with the same email is someone else.
    placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 3 }, { requester: REP, now: NOW });
    assert.equal(db.requests.length, 2);

    for (let i = 0; i < MAX_OPEN_REQUESTS - 1; i += 1) {
      db.requests.push({ ...first, id: `x${i}`, itemId: `other-${i}`, history: [] });
    }
    assert.equal(status(() => placeRequest(db, { itemId: "td-team-polo", variantId: "l", color: "Navy", quantity: 1 }, { requester: JANE })), 409);
  });

  it("keep a rep to their distributor's categories", () => {
    const { db } = store();
    assert.equal(status(() => placeRequest(db, { itemId: "td-team-polo", variantId: "l", color: "Navy", quantity: 1 }, { requester: REP, categories: ["Print"] })), 404);
    assert.equal(status(() => placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 1 }, { requester: REP, categories: ["Samples"] })), 0);
  });

  it("can be withdrawn by the requester only, and settled by the admin once", () => {
    const { db, item } = store();
    const mine = placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 6 }, { requester: JANE, now: NOW }).request;
    const theirs = placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 2 }, { requester: REP, now: NOW }).request;
    assert.equal(status(() => withdrawRequest(db, theirs.id, { requester: JANE })), 404);
    withdrawRequest(db, mine.id, { requester: JANE, now: NOW });
    assert.equal(mine.status, "withdrawn");
    assert.equal(status(() => withdrawRequest(db, mine.id, { requester: JANE })), 409);

    item("jfh-citrus-bottle").variants[0].stock = 12;
    const updated = settleRequests(db, { ids: [mine.id, theirs.id], action: "notified", note: "Restocked" }, { actor: "Allie", now: NOW });
    assert.deepEqual(updated.map((r) => r.id), [theirs.id], "the withdrawn one is skipped");
    assert.equal(theirs.history.at(-1).note, "Restocked");
    assert.equal(status(() => settleRequests(db, { ids: [theirs.id], action: "closed" }, { actor: "Allie" })), 409);
    assert.equal(status(() => settleRequests(db, { ids: [theirs.id], action: "shipped" }, { actor: "Allie" })), 400);
    assert.equal(requestsWithStock(db)[0].stockNow, 12);
  });
});

describe("request emails", () => {
  const ADMINS = ["allie@tropicaldistillery.com"];
  const routes = { pos: ["pos@tropicaldistillery.com"], samples: ["samples@tropicaldistillery.com"], cc: {} };

  it("alert the right inbox, then tell the requester", () => {
    const { db } = store();
    const polo = placeRequest(db, { itemId: "td-team-polo", variantId: "l", color: "Navy", quantity: 12, note: "Launch" }, { requester: REP, now: NOW }).request;
    const bottle = placeRequest(db, { itemId: "jfh-citrus-bottle", quantity: 6 }, { requester: JANE, now: NOW }).request;
    const base = "https://merch.tropicaldistillery.com";

    const [alert] = requestEmails("request.created", polo, { adminTo: ADMINS, routes, baseUrl: base });
    assert.deepEqual(alert.to, ["pos@tropicaldistillery.com"]);
    assert.deepEqual(alert.replyTo, ["jane@tropicaldistillery.com"]);
    assert.match(alert.subject, /^Item request: 12 × .*Polo \(Navy · L\) from Dee \(Reyes Beverage Group Florida\)$/);
    const text = renderEmail(alert).text;
    assert.match(text, /How many: 12/);
    assert.match(text, /Their note: Launch/);
    assert.match(text, /admin#requests/);
    assert.deepEqual(requestEmails("request.created", bottle, { adminTo: ADMINS, routes })[0].to, ["samples@tropicaldistillery.com"]);

    settleRequests(db, { ids: [polo.id], action: "notified" }, { actor: "Allie", now: NOW });
    const [back] = requestEmails("request.notified", polo, { adminTo: ADMINS, routes, baseUrl: base });
    assert.deepEqual(back.to, ["jane@tropicaldistillery.com"]);
    assert.match(back.subject, /is back in stock$/);
    assert.match(renderEmail(back).text, /Order it now: https:\/\/merch\.tropicaldistillery\.com\/shop/);

    settleRequests(db, { ids: [bottle.id], action: "closed", note: "Discontinued" }, { actor: "Allie", now: NOW });
    const [closed] = requestEmails("request.closed", bottle, { adminTo: ADMINS, routes });
    assert.match(renderEmail(closed).text, /Why: Discontinued/);
  });
});
