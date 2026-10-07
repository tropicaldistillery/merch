import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEmailer, escapeHtml, orderEmails, parseAddresses, renderEmail } from "../src/email.mjs";
import { placeOrder, updateOrder } from "../src/orders.mjs";
import { initialState } from "../src/store/initial-state.mjs";

const NOW = new Date("2026-10-06T15:00:00Z");
const ADMINS = ["allie@tropicaldistillery.com", "ops@tropicaldistillery.com"];
const BASE = "https://tropical-merch.onrender.com/";

function placed({ name = "Jane Rep", rush = false, notes = "" } = {}) {
  const db = initialState();
  const order = placeOrder(
    db,
    {
      shipTo: {
        type: "account",
        accountName: "The Rusty Pelican",
        accountType: "on-premise",
        attention: "Marco",
        phone: "(305) 555-0199",
        address1: "3201 Rickenbacker Cswy",
        city: "Key Biscayne",
        state: "FL",
        postalCode: "33149",
      },
      purpose: "account-activation",
      neededBy: "2026-10-20",
      shippingSpeed: rush ? "rush" : "standard",
      rushReason: rush ? "Launch party Friday" : "",
      notes,
      lines: [{ itemId: "jfh-bar-mat", variantId: "default", quantity: 2 }],
    },
    { requester: { name, email: "jane@tropicaldistillery.com" }, now: NOW, timeZone: "America/New_York", prefix: "TD" }
  );
  return { db, order };
}

const by = { actor: "Allie", now: NOW };

describe("order emails", () => {
  it("alerts the admins and confirms to the requester when an order comes in", () => {
    const { order } = placed({ rush: true });
    const [admin, requester] = orderEmails("order.created", order, { adminTo: ADMINS, baseUrl: BASE });
    assert.deepEqual(admin.to, ADMINS);
    assert.deepEqual(admin.replyTo, ["jane@tropicaldistillery.com"], "the admin can reply straight to the requester");
    assert.equal(admin.subject, "RUSH: New merch order TD-1001 from Jane Rep");
    const adminText = renderEmail(admin).text;
    assert.match(adminText, /2 × J\.F\. Haden's Rubber Bar Mat/);
    assert.match(adminText, /Rush: Launch party Friday/);
    assert.match(adminText, /https:\/\/tropical-merch\.onrender\.com\/admin\?order=/);

    assert.deepEqual(requester.to, ["jane@tropicaldistillery.com"]);
    assert.deepEqual(requester.replyTo, ADMINS);
    assert.equal(requester.subject, "We got your merch order TD-1001");
    assert.match(renderEmail(requester).text, /Hi Jane,/);
  });

  it("still confirms to the requester when no admin address is set", () => {
    const { order } = placed();
    const emails = orderEmails("order.created", order, { adminTo: [] });
    assert.deepEqual(emails.map((e) => e.role), ["requester"]);
    assert.ok(!renderEmail(emails[0]).text.includes("My orders:"), "no link without PUBLIC_URL");
  });

  it("tells the requester about each status change, with tracking and reasons", () => {
    const { db, order } = placed();
    updateOrder(db, order.id, { status: "approved", note: "Packing it today" }, by);
    const [approved] = orderEmails("order.approved", order, { adminTo: ADMINS, baseUrl: BASE });
    assert.equal(approved.subject, "Your merch order TD-1001 is approved");
    assert.match(renderEmail(approved).text, /Note from the merch admin: Packing it today/);

    updateOrder(db, order.id, { status: "shipped", carrier: "ups", trackingNumber: "1Z999AA10123456784" }, by);
    const shipped = renderEmail(orderEmails("order.shipped", order, { baseUrl: BASE })[0]);
    assert.match(shipped.text, /shipped via UPS, tracking number 1Z999AA10123456784/);
    assert.match(shipped.html, /href="https:\/\/www\.ups\.com\/track\?tracknum=1Z999AA10123456784"/);

    const declinedOrder = placed().order;
    const db2 = initialState();
    db2.orders.push(declinedOrder);
    updateOrder(db2, declinedOrder.id, { status: "declined", note: "Over budget this month" }, by);
    assert.match(renderEmail(orderEmails("order.declined", declinedOrder)[0]).text, /Reason: Over budget this month/);
  });

  it("emails the admins, not the requester, when requesters cancel their own order", () => {
    const { order } = placed();
    const [own] = orderEmails("order.cancelled", order, { adminTo: ADMINS, byRequester: true });
    assert.equal(own.role, "admin");
    assert.equal(own.subject, "Jane Rep cancelled merch order TD-1001");
    const [byAdmin] = orderEmails("order.cancelled", order, { adminTo: ADMINS });
    assert.equal(byAdmin.role, "requester");
  });

  it("escapes everything people typed", () => {
    const { order } = placed({ name: "<script>alert(1)</script>", notes: 'Side door <b>"now"</b>' });
    const { html } = renderEmail(orderEmails("order.created", order, { adminTo: ADMINS })[0]);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("Side door &lt;b&gt;&quot;now&quot;&lt;/b&gt;"));
    assert.equal(escapeHtml(`a&b'c`), "a&amp;b&#39;c");
  });

  it("reads admin addresses from a comma-separated list", () => {
    assert.deepEqual(parseAddresses(" Allie@TropicalDistillery.com, nope ,ops@tropicaldistillery.com;"), ADMINS);
  });
});

describe("sending through Resend", () => {
  function fakeResend(statuses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const status = statuses.shift() ?? 200;
      return new Response(JSON.stringify(status === 200 ? { id: "email-1" } : { message: "nope" }), { status });
    };
    return { calls, fetchImpl };
  }
  const quiet = { error: () => {} };
  const noWait = async () => {};

  it("does nothing without an API key or a from address", async () => {
    const { calls, fetchImpl } = fakeResend([]);
    await createEmailer({ apiKey: "", from: "x@y.com", fetchImpl })("order.created", placed().order);
    await createEmailer({ apiKey: "re_test", from: "", fetchImpl })("order.created", placed().order);
    assert.equal(calls.length, 0);
  });

  it("sends each email once, in order, with an idempotency key", async () => {
    const { calls, fetchImpl } = fakeResend([]);
    const notify = createEmailer({ apiKey: "re_test", from: "Merch <merch@tropicaldistillery.com>", adminTo: ADMINS, fetchImpl, sleep: noWait, log: quiet });
    const { order } = placed();
    await notify("order.created", order);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].init.headers.Authorization, "Bearer re_test");
    assert.equal(calls[0].body.from, "Merch <merch@tropicaldistillery.com>");
    assert.deepEqual(calls[0].body.to, ADMINS);
    assert.deepEqual(calls[1].body.reply_to, ADMINS);
    assert.ok(calls[0].body.html.includes("TD-1001") && calls[0].body.text.includes("TD-1001"));
    assert.equal(calls[0].init.headers["Idempotency-Key"], `${order.id}:order.created:1:admin`);
    assert.notEqual(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  });

  it("retries when Resend is busy, and logs what it can't send", async () => {
    const errors = [];
    const { calls, fetchImpl } = fakeResend([429, 200, 422]);
    const notify = createEmailer({ apiKey: "re_test", from: "merch@tropicaldistillery.com", adminTo: ADMINS, fetchImpl, sleep: noWait, log: { error: (m) => errors.push(m) } });
    await notify("order.created", placed().order);
    assert.equal(calls.length, 3, "the admin email retried once, the requester email failed for good");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Resend answered 422 for "We got your merch order TD-1001"/);
  });
});
