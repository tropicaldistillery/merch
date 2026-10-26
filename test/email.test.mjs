import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEmailer, escapeHtml, inviteEmail, orderEmails, parseAddresses, renderEmail } from "../src/email.mjs";
import { forwardItems, placeOrder, pullBackForward, reviewOrder, shipForward, updateOrder } from "../src/orders.mjs";
import { initialState } from "../src/store/initial-state.mjs";

const NOW = new Date("2026-10-06T15:00:00Z");
const ADMINS = ["allie@tropicaldistillery.com", "ops@tropicaldistillery.com"];
const BASE = "https://tropical-merch.onrender.com/";

function placed({ name = "Jane Rep", rush = false, notes = "", lines = [{ itemId: "jfh-bar-mat", variantId: "default", quantity: 2 }] } = {}) {
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
      notes,
      lines,
    },
    { requester: { name, email: "jane@tropicaldistillery.com" }, now: NOW, timeZone: "America/New_York", prefix: "TD" }
  );
  // Rush isn't offered any more; an order placed as rush before then still shows it.
  if (rush) Object.assign(order, { shippingSpeed: "rush", rushReason: "Launch party Friday" });
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

  it("tells the requester which items were approved and which weren't, and why", () => {
    const { db, order } = placed({ lines: [{ itemId: "jfh-bar-mat", variantId: "default", quantity: 2 }, { itemId: "jfh-logo-tee", variantId: "m", quantity: 1 }] });
    const { event } = reviewOrder(db, order.id, { decisions: [{ status: "approved" }, { status: "denied", reason: "Tees are for the team" }], note: "Mats ship Monday" }, by);
    const [email] = orderEmails(event, order, { adminTo: ADMINS, baseUrl: BASE });
    assert.equal(email.role, "requester");
    assert.equal(email.subject, "Your merch order TD-1001: 1 of 2 items approved");
    const { text, html } = renderEmail(email);
    assert.match(text, /One item is approved and will be packed and shipped next\. One item wasn't approved/);
    assert.match(text, /1 × J\.F\. Haden's Logo Tee \(M\): \$11\.50 \(NOT APPROVED: Tees are for the team\)/);
    assert.match(text, /Approved: 2 units, /);
    assert.match(text, /Note from the merch admin: Mats ship Monday/);
    assert.match(html, /Not approved: Tees are for the team/);

    // Once it ships, only the approved items are listed.
    updateOrder(db, order.id, { status: "shipped", carrier: "ups" }, by);
    const shipped = renderEmail(orderEmails("order.shipped", order)[0]).text;
    assert.match(shipped, /has shipped via UPS\./);
    assert.match(shipped, /We'll email you the tracking number as soon as we have it\./);
    assert.ok(!shipped.includes("Logo Tee"));

    updateOrder(db, order.id, { carrier: "ups", trackingNumber: "1Z999" }, by);
    const [tracking] = orderEmails("order.tracking", order, { baseUrl: BASE });
    assert.equal(tracking.subject, "Tracking for your merch order TD-1001");
    assert.match(renderEmail(tracking).html, /href="https:\/\/www\.ups\.com\/track\?tracknum=1Z999"/);
  });

  it("gives each item's reason when every item is declined", () => {
    const { db, order } = placed();
    reviewOrder(db, order.id, { decisions: [{ status: "denied", reason: "Mats are back-ordered" }] }, by);
    const text = renderEmail(orderEmails("order.declined", order)[0]).text;
    assert.match(text, /NOT APPROVED: Mats are back-ordered/);
    assert.ok(!text.includes("No reason was given"));
  });

  it("tells whoever prints business cards exactly what goes on them", () => {
    const card = { name: "Allie Mindermann", title: "COO", phone: "(954) 600-3005", email: "allie@tropicaldistillery.com" };
    const { db, order } = placed({ lines: [{ itemId: "td-business-cards", variantId: "default", quantity: 1, card }] });
    reviewOrder(db, order.id, { decisions: [{ status: "approved" }] }, by);
    const { forward } = forwardItems(db, order.id, { toName: "Print Shop", toEmail: "orders@printshop.com", lines: [0] }, by);
    const [sent] = orderEmails("forward.sent", order, { adminTo: ADMINS, baseUrl: BASE, forward });
    const { text, html } = renderEmail(sent);
    assert.match(text, /1 × Business Cards \(for Allie Mindermann\), SKU TD-PRI-\d{3}\n {4}Print: Allie Mindermann · COO · \(954\) 600-3005 · allie@tropicaldistillery\.com/);
    assert.match(html, /Print: Allie Mindermann · COO/);
  });

  it("emails whoever items are forwarded to, and tells the requester when they ship", () => {
    const { db, order } = placed({
      rush: true,
      lines: [{ itemId: "jfh-bar-mat", variantId: "default", quantity: 2 }, { itemId: "jfh-led-sign", quantity: 1 }],
    });
    reviewOrder(db, order.id, { decisions: [{ status: "approved" }, { status: "approved" }] }, by);
    const { forward } = forwardItems(db, order.id, { toName: "Ten 10 Design", toEmail: "orders@ten10.com", lines: [1], note: "PO 4471" }, by);

    const [sent, ...more] = orderEmails("forward.sent", order, { adminTo: ADMINS, baseUrl: BASE, forward });
    assert.equal(more.length, 0);
    assert.deepEqual(sent.to, ["orders@ten10.com"]);
    assert.deepEqual(sent.replyTo, ADMINS, "their reply with tracking comes to the merch inbox");
    assert.equal(sent.subject, "RUSH: Please ship 1 item for Tropical Distillery merch order TD-1001");
    const text = renderEmail(sent).text;
    assert.match(text, /1 × J\.F\. Haden's LED Back-bar Sign.*SKU /);
    assert.doesNotMatch(text, /Bar Mat|\$/, "only their items, and no prices");
    assert.match(text, /Message from Allie: PO 4471/);
    assert.match(text, /Ship to: The Rusty Pelican.*Attn: Marco.*Key Biscayne, FL 33149/);
    assert.match(text, /Shipping: Rush: Launch party Friday/);
    assert.match(text, /reply to this email with the carrier and tracking number/);
    assert.doesNotMatch(text, /jane@/);
    assert.doesNotMatch(renderEmail(sent).html, /Nothing is ever charged to you/);
    assert.match(renderEmail(sent).html, /on behalf of the merch team/);

    // The merch team ships the mats; the requester hears the sign comes separately.
    updateOrder(db, order.id, { status: "shipped", carrier: "ups", trackingNumber: "1ZMAT" }, by);
    const shipped = renderEmail(orderEmails("order.shipped", order, { adminTo: ADMINS })[0]).text;
    assert.match(shipped, /2 × J\.F\. Haden's Rubber Bar Mat/);
    assert.doesNotMatch(shipped, /LED/);
    assert.match(shipped, /One item ships separately from Ten 10 Design\. You'll get its tracking in a separate email\./);

    shipForward(db, order.id, forward.id, { carrier: "fedex" }, by);
    const [part] = orderEmails("forward.shipped", order, { adminTo: ADMINS, forward });
    assert.deepEqual(part.to, ["jane@tropicaldistillery.com"]);
    assert.equal(part.subject, "Part of your merch order TD-1001 has shipped");
    const partText = renderEmail(part).text;
    assert.match(partText, /1 item from order TD-1001 shipped from Ten 10 Design via FedEx\./);
    assert.match(partText, /We'll email you the tracking number/);
    assert.match(partText, /1 × J\.F\. Haden's LED Back-bar Sign/);

    shipForward(db, order.id, forward.id, { carrier: "fedex", trackingNumber: "7777" }, by);
    const [tracking] = orderEmails("forward.tracking", order, { adminTo: ADMINS, forward });
    assert.equal(tracking.subject, "Tracking for your merch order TD-1001");
    assert.match(renderEmail(tracking).text, /1 item from order TD-1001 shipping from Ten 10 Design via FedEx: 7777\./);
    assert.match(renderEmail(tracking).html, /href="https:\/\/www\.fedex\.com\/fedextrack\/\?trknbr=7777"/);
  });

  it("links the supplier to their page, and tells the admins when they use it", () => {
    const { db, order } = placed();
    reviewOrder(db, order.id, { decisions: [{ status: "approved" }] }, by);
    const { forward } = forwardItems(db, order.id, { toName: "Ten 10 Design", toEmail: "orders@ten10.com", lines: [0] }, by);
    const link = "https://merch.example.com/ship#abc.def";
    const [sent] = orderEmails("forward.sent", order, { adminTo: ADMINS, forward, shipLink: link });
    assert.match(renderEmail(sent).html, /href="https:\/\/merch\.example\.com\/ship#abc\.def"[^>]*>Enter shipping &amp; tracking</);
    assert.match(renderEmail(sent).text, /enter the carrier and tracking number on this page/);

    shipForward(db, order.id, forward.id, { carrier: "ups", trackingNumber: "1Z5" }, { ...by, actor: "Ten 10 Design" });
    const emails = orderEmails("forward.shipped", order, { adminTo: ADMINS, baseUrl: BASE, forward, bySupplier: true });
    assert.deepEqual(emails.map((e) => e.role), ["admin", "requester"]);
    const [admin] = emails;
    assert.deepEqual(admin.to, ADMINS);
    assert.deepEqual(admin.replyTo, ["orders@ten10.com"]);
    assert.equal(admin.subject, "Ten 10 Design shipped 1 item for merch order TD-1001");
    assert.match(renderEmail(admin).text, /marked these shipped for Jane Rep's order TD-1001: UPS, tracking 1Z5\. Jane Rep has been emailed\./);
    assert.equal(orderEmails("forward.shipped", order, { adminTo: ADMINS, forward }).length, 1, "only when the supplier did it");
  });

  it("says the whole order shipped when one forward has all of it", () => {
    const { db, order } = placed();
    reviewOrder(db, order.id, { decisions: [{ status: "approved" }] }, by);
    const { forward } = forwardItems(db, order.id, { toName: "Jo Rep", toEmail: "jo@tropicaldistillery.com", lines: [0] }, by);
    shipForward(db, order.id, forward.id, { carrier: "hand" }, by);
    const [email] = orderEmails("forward.shipped", order, { forward });
    assert.equal(email.subject, "Your merch order TD-1001 has shipped");
    const text = renderEmail(email).text;
    assert.match(text, /Order TD-1001 is on the way: Jo Rep is hand-delivering it\./);
    assert.doesNotMatch(text, /tracking number|ships separately/);
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

  it("names a rep's distributor to the admins", () => {
    const { order } = placed();
    order.requester = { ...order.requester, distributorId: "d1", distributor: "Southern Glazer's FL" };
    const [alert, confirmation] = orderEmails("order.created", order, { adminTo: ADMINS });
    assert.equal(alert.subject, "New merch order TD-1001 from Jane Rep (Southern Glazer's FL)");
    assert.match(renderEmail(alert).text, /Distributor: Southern Glazer's FL/);
    assert.doesNotMatch(renderEmail(confirmation).text, /Distributor/);
  });
});

describe("point-of-sale and samples inboxes", () => {
  const POS = ["pos@tropicaldistillery.com"], SAMPLES = ["samples@tropicaldistillery.com"];
  function mixed(lines) {
    const db = initialState();
    return placeOrder(
      db,
      {
        shipTo: { type: "self", attention: "Jane Rep", phone: "(305) 555-0100", address1: "1 Main St", city: "Miami", state: "FL", postalCode: "33101" },
        purpose: "account-activation",
        neededBy: "2026-10-20",
        shippingSpeed: "standard",
        lines,
      },
      { requester: { name: "Jane Rep", email: "jane@tropicaldistillery.com" }, now: NOW, timeZone: "America/New_York", prefix: "TD" }
    );
  }
  const mat = { itemId: "jfh-bar-mat", variantId: "default", quantity: 2 };
  const bottle = { itemId: "jfh-citrus-bottle", variantId: "default", quantity: 3 };

  it("splits an order with both: each inbox gets just its own lines", () => {
    const order = mixed([mat, bottle]);
    assert.equal(order.lines.find((l) => l.itemId === "jfh-citrus-bottle").category, "Samples", "lines keep their category");
    const emails = orderEmails("order.created", order, { adminTo: ADMINS, routes: { pos: POS, samples: SAMPLES } });
    const pos = emails.find((e) => e.role === "admin-pos"), samples = emails.find((e) => e.role === "admin-samples");
    assert.deepEqual(pos.to, POS);
    assert.equal(pos.subject, "New point-of-sale request TD-1001 from Jane Rep");
    const posText = renderEmail(pos).text;
    assert.match(posText, /2 × J\.F\. Haden's Rubber Bar Mat/);
    assert.doesNotMatch(posText, /Citrus/);
    assert.match(posText, /also has samples, which went to the samples inbox/);
    assert.match(posText, /Total: 2 units/);
    assert.deepEqual(samples.to, SAMPLES);
    assert.equal(samples.subject, "New samples request TD-1001 from Jane Rep");
    const samplesText = renderEmail(samples).text;
    assert.match(samplesText, /3 × J\.F\. Haden's Citrus/);
    assert.doesNotMatch(samplesText, /Bar Mat/);
    const requester = emails.find((e) => e.role === "requester");
    assert.deepEqual(requester.replyTo.sort(), [...POS, ...SAMPLES].sort(), "the requester can reply to both");
  });

  it("sends an all-samples order only to the samples inbox, whole", () => {
    const emails = orderEmails("order.created", mixed([bottle]), { adminTo: ADMINS, routes: { pos: POS, samples: SAMPLES } });
    assert.deepEqual(emails.filter((e) => e.role.startsWith("admin")).map((e) => e.to), [SAMPLES]);
    assert.doesNotMatch(renderEmail(emails[0]).text, /also has/);
  });

  it("falls back to ORDER_EMAIL_TO for a part with no inbox of its own", () => {
    const emails = orderEmails("order.created", mixed([mat, bottle]), { adminTo: ADMINS, routes: { samples: SAMPLES } });
    assert.deepEqual(emails.find((e) => e.role === "admin-pos").to, ADMINS);
    assert.deepEqual(emails.find((e) => e.role === "admin-samples").to, SAMPLES);
  });

  it("tells each inbox when a requester cancels, and spots older sample lines by SKU", () => {
    const order = mixed([mat, bottle]);
    for (const line of order.lines) delete line.category; // as orders from before lines kept it
    const emails = orderEmails("order.cancelled", order, { adminTo: ADMINS, routes: { pos: POS, samples: SAMPLES }, byRequester: true });
    assert.deepEqual(emails.map((e) => e.subject), ["Jane Rep cancelled point-of-sale request TD-1001", "Jane Rep cancelled samples request TD-1001"]);
  });

  it("copies people in on each inbox's alerts, falling back to the general cc list", () => {
    const routes = { pos: POS, samples: SAMPLES, cc: { pos: ["boss@tropicaldistillery.com"], all: ["ops@tropicaldistillery.com", "pos@tropicaldistillery.com"] } };
    const emails = orderEmails("order.created", mixed([mat, bottle]), { adminTo: ADMINS, routes });
    assert.deepEqual(emails.find((e) => e.role === "admin-pos").cc, ["boss@tropicaldistillery.com"]);
    assert.deepEqual(emails.find((e) => e.role === "admin-samples").cc, ["ops@tropicaldistillery.com", "pos@tropicaldistillery.com"]);
    assert.equal(emails.find((e) => e.role === "requester").cc, undefined, "the requester's own emails aren't copied");
    // without routes, the general list copies the one alert, minus anyone already on To
    const [plain] = orderEmails("order.created", mixed([mat]), { adminTo: ADMINS, routes: { cc: { all: ["ops@tropicaldistillery.com", "boss@tropicaldistillery.com"] } } });
    assert.deepEqual(plain.cc, ["boss@tropicaldistillery.com"]);
  });

  it("copies both parts' people when both parts go to the same inbox", () => {
    const routes = { pos: POS, samples: POS, cc: { pos: ["a@tropicaldistillery.com"], samples: ["b@tropicaldistillery.com"] } };
    const emails = orderEmails("order.created", mixed([mat, bottle]), { adminTo: ADMINS, routes });
    const admin = emails.filter((e) => e.role.startsWith("admin"));
    assert.equal(admin.length, 1);
    assert.deepEqual(admin[0].cc, ["a@tropicaldistillery.com", "b@tropicaldistillery.com"]);
  });

  it("sends the cc list to Resend", async () => {
    const bodies = [];
    const notify = createEmailer({ apiKey: "re_test", from: "merch@tropicaldistillery.com", adminTo: ADMINS, routes: { cc: { all: ["boss@tropicaldistillery.com"] } }, sleep: async () => {}, log: { error: () => {} },
      fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); } });
    await notify("order.created", mixed([mat]));
    assert.deepEqual(bodies[0].cc, ["boss@tropicaldistillery.com"]);
    assert.equal(bodies[1].cc, undefined);
  });

  it("emails each inbox under its own key, so Resend sends both", async () => {
    const calls = [];
    const notify = createEmailer({ apiKey: "re_test", from: "merch@tropicaldistillery.com", adminTo: ADMINS, routes: { pos: POS, samples: SAMPLES }, sleep: async () => {}, log: { error: () => {} },
      fetchImpl: async (url, init) => { calls.push(init.headers["Idempotency-Key"]); return new Response("{}", { status: 200 }); } });
    const order = mixed([mat, bottle]);
    await notify("order.created", order);
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls).size, 3);
  });
});

describe("invite emails", () => {
  const LINK = "https://merch.tropicaldistillery.com/welcome?invite=abc";

  it("invite people to create a password, or to choose a new one", () => {
    const invite = inviteEmail({ name: "Jane Rep", email: "jane@tropicaldistillery.com" }, { link: LINK, by: "Allie" });
    assert.deepEqual(invite.to, ["jane@tropicaldistillery.com"]);
    assert.equal(invite.subject, "Create your Tropical Distillery merch store password");
    const { html, text } = renderEmail(invite);
    assert.match(text, /Hi Jane,/);
    assert.match(text, /Allie invited you/);
    assert.match(text, /Create your password: https:\/\/merch\.tropicaldistillery\.com\/welcome\?invite=abc/);
    assert.ok(html.includes(`href="${LINK}"`));

    const reset = inviteEmail({ name: "<b>Jane</b>", email: "jane@tropicaldistillery.com", passwordSetAt: "2026-10-01" }, { link: LINK });
    assert.equal(reset.subject, "Choose a new password for the Tropical Distillery merch store");
    assert.match(renderEmail(reset).text, /The merch admin sent you a link/);
    assert.ok(!renderEmail(reset).html.includes("<b>Jane"));
  });

  it("are sent through the same queue, each under its own key", async () => {
    const calls = [];
    const notify = createEmailer({
      apiKey: "re_test",
      from: "merch@tropicaldistillery.com",
      adminTo: ADMINS,
      sleep: async () => {},
      log: { error: () => {} },
      fetchImpl: async (url, init) => {
        calls.push({ key: init.headers["Idempotency-Key"], body: JSON.parse(init.body) });
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(notify.enabled, true);
    await notify.invite({ id: "p1", name: "Jane", email: "jane@tropicaldistillery.com" }, { link: LINK, by: "Allie", key: "k1" });
    assert.equal(calls[0].key, "invite:p1:k1");
    assert.deepEqual(calls[0].body.reply_to, ADMINS);
    assert.equal(createEmailer({}).enabled, false);
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

  it("logs each email Resend accepts", async () => {
    const sent = [];
    const { fetchImpl } = fakeResend([]);
    const notify = createEmailer({ apiKey: "re_test", from: "merch@tropicaldistillery.com", adminTo: ADMINS, fetchImpl, sleep: noWait, log: { error: () => {}, info: (m) => sent.push(m) } });
    await notify("order.created", placed().order);
    assert.equal(sent.length, 2);
    assert.match(sent[1], /^\[email\] sent "We got your merch order TD-1001" to 1 address \(Resend id email-1\)$/);
  });

  it("keys forward emails by forward, and tells them when it's called off", async () => {
    const { calls, fetchImpl } = fakeResend([]);
    const notify = createEmailer({ apiKey: "re_test", from: "merch@tropicaldistillery.com", adminTo: ADMINS, fetchImpl, sleep: noWait, log: quiet });
    const { db, order } = placed();
    reviewOrder(db, order.id, { decisions: [{ status: "approved" }] }, by);
    const { forward } = forwardItems(db, order.id, { toName: "Ten 10 Design", toEmail: "orders@ten10.com", lines: [0] }, by);
    await notify("forward.sent", order, { forward });
    await notify("forward.sent", order, { forward, resend: "1" });
    pullBackForward(db, order.id, forward.id, by);
    await notify("forward.cancelled", order, { forward });
    assert.deepEqual(calls.map((c) => c.init.headers["Idempotency-Key"]), [
      `${order.id}:forward.sent:${forward.id}:fulfiller`,
      `${order.id}:forward.sent:${forward.id}:fulfiller:1`,
      `${order.id}:forward.cancelled:${forward.id}:fulfiller`,
    ]);
    assert.deepEqual(calls[2].body.to, ["orders@ten10.com"]);
    assert.equal(calls[2].body.subject, "Cancelled: please don't ship merch order TD-1001");
    assert.match(calls[2].body.text, /Please don't ship this item from order TD-1001/);
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
