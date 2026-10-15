// End-to-end over HTTP: the real handler on an ephemeral port, backed by a
// file store in a temporary directory.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.mjs";
import { createThrottle } from "../src/auth.mjs";
import { openStore } from "../src/store/index.mjs";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TEAM_CODE = "mango sunrise tasting";
const ADMIN_PASSWORD = "correct horse battery";

const ACCOUNT_ORDER = {
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
  lines: [{ itemId: "jfh-bar-mat", variantId: "default", quantity: 2 }],
};

async function start(dir, overrides = {}, { mailer = null } = {}) {
  const store = await openStore({ dataDir: dir });
  const notifications = [];
  const contexts = [];
  const handler = await createApp({
    store,
    mailer,
    notify: (event, order, context) => {
      notifications.push({ event, number: order.number, ...(context?.forward ? { to: context.forward.to.email } : {}) });
      contexts.push(context ?? {});
    },
    config: {
      teamAccessCode: TEAM_CODE,
      adminPassword: ADMIN_PASSWORD,
      allowedEmailDomains: ["tropicaldistillery.com"],
      publicDir: PUBLIC_DIR,
      failureDelayMs: 0,
      accessCacheMs: 0,
      throttle: createThrottle({ max: 3 }),
      ...overrides,
    },
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // A tiny cookie-jar client per "browser".
  function client() {
    const jar = new Map();
    return async function request(pathname, { method = "GET", body, headers = {}, csrf = true } = {}) {
      const response = await fetch(base + pathname, {
        method,
        redirect: "manual",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(csrf && method !== "GET" ? { "X-Requested-With": "fetch" } : {}),
          ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const [name, value] = pair.split("=");
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
      const type = response.headers.get("content-type") || "";
      const data = type.includes("json") ? await response.json() : await response.text();
      return { status: response.status, headers: response.headers, data };
    };
  }

  return {
    base,
    store,
    notifications,
    contexts,
    client,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function signedInTeam(app, email = "jane@tropicaldistillery.com", name = "Jane Rep") {
  const request = app.client();
  const res = await request("/api/session", { method: "POST", body: { name, email, code: TEAM_CODE } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return request;
}

async function signedInAdmin(app) {
  const request = app.client();
  const res = await request("/api/admin/session", { method: "POST", body: { name: "Allie", password: ADMIN_PASSWORD } });
  assert.equal(res.status, 200);
  return request;
}

describe("merch store over HTTP", () => {
  let dir;
  let app;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    app = await start(dir);
  });

  after(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps the store behind sign-in", async () => {
    const request = app.client();
    const page = await request("/shop?x=1");
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/?next=%2Fshop%3Fx%3D1");
    assert.equal((await request("/api/catalog")).status, 401);
    assert.equal((await request("/api/orders", { method: "POST", body: ACCOUNT_ORDER })).status, 401);
  });

  it("sends security headers", async () => {
    const res = await app.client()("/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });

  it("requires the forgery-protection header on every change", async () => {
    const request = app.client();
    const res = await request("/api/session", {
      method: "POST",
      csrf: false,
      body: { name: "Jane", email: "jane@tropicaldistillery.com", code: TEAM_CODE },
    });
    assert.equal(res.status, 403);
  });

  it("checks the code, the email domain, and sets a hardened cookie", async () => {
    const request = app.client();
    const wrong = await request("/api/session", { method: "POST", body: { name: "Jane", email: "jane@tropicaldistillery.com", code: "nope" } });
    assert.equal(wrong.status, 401);
    assert.ok(wrong.data.fieldErrors.code);

    const domain = await request("/api/session", { method: "POST", body: { name: "Jane", email: "jane@gmail.com", code: TEAM_CODE } });
    assert.equal(domain.status, 400);
    assert.match(domain.data.fieldErrors.email, /@tropicaldistillery\.com/);

    const ok = await request("/api/session", {
      method: "POST",
      body: { name: "Jane Rep", email: "Jane@TropicalDistillery.com", code: "  MANGO Sunrise tasting " },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.email, "jane@tropicaldistillery.com");
    const cookie = ok.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const home = await request("/");
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/shop");
  });

  it("only follows same-site next= destinations", async () => {
    const request = await signedInTeam(app);
    assert.equal((await request("/?next=//evil.example")).headers.get("location"), "/shop");
    assert.equal((await request("/?next=https://evil.example")).headers.get("location"), "/shop");
    assert.equal((await request("/?next=/orders")).headers.get("location"), "/orders");
  });

  it("throttles repeated wrong codes", async () => {
    const isolated = await start(await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-")));
    try {
      const request = isolated.client();
      const attempt = () => request("/api/session", { method: "POST", body: { name: "X", email: "x@tropicaldistillery.com", code: "guess" } });
      for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
      assert.equal((await attempt()).status, 429);
    } finally {
      await isolated.close();
    }
  });

  it("caps failed sign-ins across all addresses", async () => {
    const isolated = await start(await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-")), {
      throttle: createThrottle({ max: 100 }),
      globalThrottle: createThrottle({ max: 2 }),
    });
    try {
      const request = isolated.client();
      const attempt = (ip) =>
        request("/api/session", {
          method: "POST",
          headers: { "X-Forwarded-For": ip },
          body: { name: "X", email: "x@tropicaldistillery.com", code: "guess" },
        });
      assert.equal((await attempt("10.0.0.1")).status, 401);
      assert.equal((await attempt("10.0.0.2")).status, 401);
      assert.equal((await attempt("10.0.0.3")).status, 429, "a forged new address does not reset the count");
    } finally {
      await isolated.close();
    }
  });

  it("places an order, notifies, and shows it only to its requester", async () => {
    const jane = await signedInTeam(app);
    const placed = await jane("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.match(placed.data.order.number, /^TD-\d+$/);
    assert.deepEqual(app.notifications.at(-1), { event: "order.created", number: placed.data.order.number });

    const mine = await jane("/api/orders");
    assert.ok(mine.data.orders.some((o) => o.id === placed.data.order.id));

    const sam = await signedInTeam(app, "sam@tropicaldistillery.com", "Sam Rep");
    assert.equal((await sam("/api/orders")).data.orders.length, 0);
    assert.equal((await sam(`/api/orders/${placed.data.order.id}/cancel`, { method: "POST" })).status, 404);

    const accounts = await sam("/api/accounts");
    assert.equal(accounts.data.accounts[0].name, "The Rusty Pelican", "accounts are shared with the team");
    assert.equal(accounts.data.accounts[0].createdBy, undefined, "but not who created them");

    const cancelled = await jane(`/api/orders/${placed.data.order.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.data.order.status, "cancelled");
  });

  it("returns field errors for a bad order", async () => {
    const jane = await signedInTeam(app);
    const res = await jane("/api/orders", { method: "POST", body: { shipTo: { type: "self" }, lines: [] } });
    assert.equal(res.status, 400);
    assert.ok(res.data.fieldErrors["shipTo.address1"]);
    assert.ok(res.data.fieldErrors.lines);
  });

  it("refuses bodies that aren't JSON objects", async () => {
    const jane = await signedInTeam(app);
    assert.equal((await jane("/api/orders", { method: "POST", body: [1, 2] })).status, 400);
    assert.equal((await jane("/api/orders", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status, 415);
  });

  it("keeps team sessions out of the admin console", async () => {
    const jane = await signedInTeam(app);
    assert.equal((await jane("/api/admin/orders")).status, 401);
    assert.equal((await app.client()("/api/admin/session", { method: "POST", body: { password: "guess" } })).status, 401);
  });

  it("runs the admin workflow and exports CSV", async () => {
    const jane = await signedInTeam(app);
    const { data } = await jane("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
    const id = data.order.id;
    const admin = await signedInAdmin(app);

    const list = await admin("/api/admin/orders");
    assert.equal(list.data.orders[0].id, id, "newest first");

    const approved = await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "approved" } });
    assert.equal(approved.data.order.history.at(-1).by, "Allie");
    const shipped = await admin(`/api/admin/orders/${id}`, {
      method: "PATCH",
      body: { status: "shipped", carrier: "ups", trackingNumber: "1Z999AA10123456784" },
    });
    assert.equal(shipped.data.order.status, "shipped");
    assert.deepEqual(app.notifications.at(-1), { event: "order.shipped", number: data.order.number });

    const bad = await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "approved" } });
    assert.equal(bad.status, 409);

    const csv = await admin("/api/admin/orders.csv?status=shipped");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-disposition"), /attachment; filename="tropical-merch-orders-/);
    const rows = csv.data.trim().split("\r\n");
    assert.equal(rows.length, 2);
    assert.match(rows[1], /1Z999AA10123456784/);

    const mine = await jane("/api/orders");
    assert.equal(mine.data.orders.find((o) => o.id === id).shipment.carrier, "ups");
  });

  it("approves and denies item by item, emails the decision, and adds tracking later", async () => {
    const jane = await signedInTeam(app);
    const body = { ...ACCOUNT_ORDER, lines: [ACCOUNT_ORDER.lines[0], { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 }] };
    const placed = await jane("/api/orders", { method: "POST", body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const { id, number } = placed.data.order;
    const admin = await signedInAdmin(app);
    const review = (b) => admin(`/api/admin/orders/${id}/review`, { method: "POST", body: b });

    assert.equal((await jane(`/api/admin/orders/${id}/review`, { method: "POST", body: {} })).status, 401);
    assert.ok((await review({ decisions: [{ status: "approved" }] })).data.fieldErrors["decisions.1"]);

    // Saved without emailing, then emailed on purpose.
    const quiet = await review({ decisions: [{ status: "approved" }, { status: "denied", reason: "Tees are for the team" }], notify: false });
    assert.equal(quiet.status, 200, JSON.stringify(quiet.data));
    assert.equal(quiet.data.emailed, false);
    assert.equal(quiet.data.order.status, "approved");
    assert.notEqual(app.notifications.at(-1).event, "order.reviewed");
    const sent = await admin(`/api/admin/orders/${id}/notify`, { method: "POST", body: {} });
    assert.equal(sent.data.event, "order.reviewed");
    assert.deepEqual(app.notifications.at(-1), { event: "order.reviewed", number });

    // Changed to approve everything, emailed straight away.
    const all = await review({ decisions: [{ status: "approved" }, { status: "approved" }] });
    assert.equal(all.data.emailed, true);
    assert.deepEqual(app.notifications.at(-1), { event: "order.approved", number });

    // The requester sees the decisions on their order.
    const mine = (await jane("/api/orders")).data.orders.find((o) => o.id === id);
    assert.deepEqual(mine.lines.map((l) => l.decision.status), ["approved", "approved"]);

    // Shipped with no tracking, which is emailed once it's added.
    const shipped = await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "shipped", carrier: "ups" } });
    assert.equal(shipped.status, 200, JSON.stringify(shipped.data));
    assert.deepEqual(app.notifications.at(-1), { event: "order.shipped", number });
    await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { carrier: "ups", trackingNumber: "1Z999", notify: false } });
    assert.deepEqual(app.notifications.at(-1), { event: "order.shipped", number }, "not emailed when asked not to");
    await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { carrier: "ups", trackingNumber: "1Z1000" } });
    assert.deepEqual(app.notifications.at(-1), { event: "order.tracking", number });

    assert.equal((await review({ decisions: [{ status: "approved" }, { status: "approved" }] })).status, 409, "too late once shipped");
    assert.equal((await admin(`/api/admin/orders/${id}/notify`, { method: "POST", body: {} })).status, 409);
  });

  it("forwards items to someone else to ship, and keeps admin-only details from the requester", async () => {
    const jane = await signedInTeam(app);
    const body = { ...ACCOUNT_ORDER, lines: [ACCOUNT_ORDER.lines[0], { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 }] };
    const placed = await jane("/api/orders", { method: "POST", body });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.equal("adminNote" in placed.data.order, false);
    const { id, number } = placed.data.order;
    const admin = await signedInAdmin(app);
    const TEN10 = { toName: "Ten 10 Design", toEmail: "orders@ten10.com" };
    const forwardTo = (b) => admin(`/api/admin/orders/${id}/forwards`, { method: "POST", body: b });

    assert.equal((await forwardTo({ ...TEN10, lines: [1] })).status, 409, "approved first");
    await admin(`/api/admin/orders/${id}/review`, { method: "POST", body: { decisions: [{ status: "approved" }, { status: "approved" }], notify: false } });
    assert.equal((await jane(`/api/admin/orders/${id}/forwards`, { method: "POST", body: { ...TEN10, lines: [1] } })).status, 401);
    assert.ok((await forwardTo({ ...TEN10, toEmail: "ten10", lines: [1] })).data.fieldErrors.toEmail);

    const sent = await forwardTo({ ...TEN10, lines: [1], note: "PO 4471" });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.equal(sent.data.emailed, true);
    const fid = sent.data.forward.id;
    assert.deepEqual(app.notifications.at(-1), { event: "forward.sent", number, to: "orders@ten10.com" });
    const again = await admin(`/api/admin/orders/${id}/forwards/${fid}/notify`, { method: "POST", body: {} });
    assert.equal(again.status, 200);
    assert.equal(app.notifications.filter((n) => n.event === "forward.sent").length, 2);
    await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { adminNote: "Bill to the Q4 events budget" } });

    // The requester sees the tees ship separately, and nothing meant for admins.
    const mine = (await jane("/api/orders")).data.orders.find((o) => o.id === id);
    assert.deepEqual(mine.forwards, [{ id: fid, name: "Ten 10 Design", lines: [1], status: "sent", shipment: null }]);
    assert.doesNotMatch(JSON.stringify(mine), /adminNote|Q4 events|orders@ten10|PO 4471/);
    const full = (await admin(`/api/admin/orders/${id}`)).data.order;
    assert.equal(full.adminNote, "Bill to the Q4 events budget");
    assert.equal(full.forwards[0].to.email, "orders@ten10.com");

    // Shipped with tracking to come, then the tracking.
    const ship = (b) => admin(`/api/admin/orders/${id}/forwards/${fid}/ship`, { method: "POST", body: b });
    const shipped = await ship({ carrier: "fedex" });
    assert.equal(shipped.status, 200, JSON.stringify(shipped.data));
    assert.equal(shipped.data.order.status, "approved", "the sign is still the merch team's to ship");
    assert.deepEqual(app.notifications.at(-1), { event: "forward.shipped", number, to: "orders@ten10.com" });
    await ship({ carrier: "fedex", trackingNumber: "7777", notify: false });
    assert.equal(app.notifications.at(-1).event, "forward.shipped", "not emailed when asked not to");
    await ship({ carrier: "fedex", trackingNumber: "7778" });
    assert.equal(app.notifications.at(-1).event, "forward.tracking");
    assert.equal((await admin(`/api/admin/orders/${id}/forwards/${fid}/pull-back`, { method: "POST", body: {} })).status, 409);
    assert.equal((await admin(`/api/admin/orders/${id}/forwards/${fid}/notify`, { method: "POST", body: {} })).status, 409);
    assert.equal((await admin(`/api/admin/orders/${id}/forwards/nope/ship`, { method: "POST", body: {} })).status, 404);

    // Forwarded to a rep, then pulled back: the rep is told not to ship.
    const second = await forwardTo({ toName: "Jo Rep", toEmail: "jo@tropicaldistillery.com", lines: [0], notify: false });
    assert.equal(second.data.emailed, false);
    assert.equal(app.notifications.at(-1).event, "forward.tracking");
    const back = await admin(`/api/admin/orders/${id}/forwards/${second.data.forward.id}/pull-back`, { method: "POST", body: {} });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.deepEqual(app.notifications.at(-1), { event: "forward.cancelled", number, to: "jo@tropicaldistillery.com" });

    const csv = (await admin(`/api/admin/orders.csv?ids=${id}`)).data.trim().split("\r\n");
    assert.match(csv[2], /,Ten 10 Design,FedEx,7778,/);
    assert.match(csv[1], /,Approved,,,,,/);

    // The sign ships from the merch team, which ships the order.
    const done = await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "shipped", carrier: "ups" } });
    assert.equal(done.data.order.status, "shipped");

    // Cancelling an order tells whoever still has its items not to ship them.
    const other = (await jane("/api/orders", { method: "POST", body })).data.order;
    await admin(`/api/admin/orders/${other.id}/review`, { method: "POST", body: { decisions: [{ status: "approved" }, { status: "approved" }], notify: false } });
    await admin(`/api/admin/orders/${other.id}/forwards`, { method: "POST", body: { ...TEN10, lines: [1] } });
    await admin(`/api/admin/orders/${other.id}`, { method: "PATCH", body: { status: "cancelled", note: "Event moved" } });
    assert.deepEqual(app.notifications.slice(-2), [
      { event: "order.cancelled", number: other.number },
      { event: "forward.cancelled", number: other.number, to: "orders@ten10.com" },
    ]);
  });

  it("lets a supplier mark forwarded items shipped from their emailed link", async () => {
    const jane = await signedInTeam(app);
    const body = { ...ACCOUNT_ORDER, lines: [ACCOUNT_ORDER.lines[0], { itemId: "jfh-logo-tee", variantId: "m", quantity: 2 }] };
    const { id, number } = (await jane("/api/orders", { method: "POST", body })).data.order;
    const admin = await signedInAdmin(app);
    await admin(`/api/admin/orders/${id}/review`, { method: "POST", body: { decisions: [{ status: "approved" }, { status: "approved" }], notify: false } });
    const sent = await admin(`/api/admin/orders/${id}/forwards`, { method: "POST", body: { toName: "Ten 10 Design", toEmail: "orders@ten10.com", lines: [1], note: "PO 4471" } });
    const fid = sent.data.forward.id;
    const emailedLink = app.contexts.at(-1).shipLink;
    assert.match(emailedLink, /^http:\/\/127\.0\.0\.1:\d+\/ship#[\w-]+\.[\w-]+$/);

    // The admin can copy the same link; nobody else can get it.
    const copied = await admin(`/api/admin/orders/${id}/forwards/${fid}/link`);
    assert.equal(copied.data.url, emailedLink);
    assert.equal((await jane(`/api/admin/orders/${id}/forwards/${fid}/link`)).status, 401);
    const token = new URL(emailedLink).hash.slice(1);

    // The page itself and what it shows, with no sign-in.
    const supplier = app.client();
    const page = await supplier("/ship");
    assert.equal(page.status, 200);
    assert.match(page.data, /assets\/ship\.js/);
    const view = await supplier("/api/ship/view", { method: "POST", body: { token } });
    assert.equal(view.status, 200, JSON.stringify(view.data));
    assert.equal(view.headers.get("cache-control"), "no-store");
    assert.deepEqual([view.data.number, view.data.forward.items.length, view.data.forward.note], [number, 1, "PO 4471"]);
    assert.doesNotMatch(JSON.stringify(view.data), /jane@|Cents|orders@ten10/);
    for (const bad of ["", "nope", `${fid}.forged`, token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))]) {
      assert.equal((await supplier("/api/ship/view", { method: "POST", body: { token: bad } })).status, 404, bad);
    }
    assert.equal((await supplier("/api/ship", { method: "POST", body: { token, carrier: "ups" }, csrf: false })).status, 403);

    // Marked shipped from the page: needs the carrier; tracking can follow.
    const missing = await supplier("/api/ship", { method: "POST", body: { token, trackingNumber: "1Z5" } });
    assert.equal(missing.status, 400);
    assert.ok(missing.data.fieldErrors.carrier);
    const shipped = await supplier("/api/ship", { method: "POST", body: { token, carrier: "ups" } });
    assert.equal(shipped.status, 200, JSON.stringify(shipped.data));
    assert.equal(shipped.data.forward.status, "shipped");
    assert.deepEqual(app.notifications.at(-1), { event: "forward.shipped", number, to: "orders@ten10.com" });
    assert.equal(app.contexts.at(-1).bySupplier, true);
    await supplier("/api/ship", { method: "POST", body: { token, carrier: "ups", trackingNumber: "1Z 5" } });
    assert.equal(app.notifications.at(-1).event, "forward.tracking");
    const full = (await admin(`/api/admin/orders/${id}`)).data.order;
    assert.equal(full.forwards[0].shipment.trackingNumber, "1Z5");
    assert.equal(full.history.at(-1).by, "Ten 10 Design");

    // Once the order is delivered, the page can't change it.
    await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "shipped", carrier: "ups" } });
    await admin(`/api/admin/orders/${id}`, { method: "PATCH", body: { status: "delivered" } });
    assert.equal((await supplier("/api/ship/view", { method: "POST", body: { token } })).data.canUpdate, false);
    assert.equal((await supplier("/api/ship", { method: "POST", body: { token, carrier: "ups", trackingNumber: "9" } })).status, 409);

    // A pulled-back forward's page says it's called off.
    const other = (await jane("/api/orders", { method: "POST", body })).data.order;
    await admin(`/api/admin/orders/${other.id}/review`, { method: "POST", body: { decisions: [{ status: "approved" }, { status: "approved" }], notify: false } });
    const f2 = (await admin(`/api/admin/orders/${other.id}/forwards`, { method: "POST", body: { toName: "Jo", toEmail: "jo@tropicaldistillery.com", lines: [0] } })).data.forward;
    const token2 = new URL(app.contexts.at(-1).shipLink).hash.slice(1);
    await admin(`/api/admin/orders/${other.id}/forwards/${f2.id}/pull-back`, { method: "POST", body: {} });
    const off = await supplier("/api/ship/view", { method: "POST", body: { token: token2 } });
    assert.deepEqual([off.data.forward.status, off.data.canUpdate], ["cancelled", false]);
    assert.equal((await supplier("/api/ship", { method: "POST", body: { token: token2, carrier: "ups" } })).status, 409);
  });

  it("edits the catalog and the account directory", async () => {
    const admin = await signedInAdmin(app);
    const created = await admin("/api/admin/catalog", {
      method: "POST",
      body: {
        name: "Mango Koozie", sku: "TD-ACC-001", brand: "jf-hadens", category: "Giveaways",
        tone: "mango", art: "tumbler", unit: "Pack of 10", costCents: 900, maxPerOrder: 5,
        variants: [{ label: "", stock: 1 }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const hidden = await admin(`/api/admin/catalog/${created.data.item.id}`, {
      method: "PUT",
      body: { ...created.data.item, active: false },
    });
    assert.equal(hidden.data.item.active, false);

    const jane = await signedInTeam(app);
    const catalog = await jane("/api/catalog");
    assert.ok(!catalog.data.items.some((i) => i.id === created.data.item.id), "hidden items leave the store");

    const accounts = await admin("/api/admin/accounts");
    const pelican = accounts.data.accounts[0];
    const renamed = await admin(`/api/admin/accounts/${pelican.id}`, { method: "PUT", body: { ...pelican, name: "Rusty Pelican" } });
    assert.equal(renamed.data.account.name, "Rusty Pelican");
    assert.equal((await admin(`/api/admin/accounts/${pelican.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await admin("/api/admin/accounts")).data.accounts.length, 0);
  });

  it("deletes an item without touching past orders", async () => {
    const admin = await signedInAdmin(app);
    const created = await admin("/api/admin/catalog", {
      method: "POST",
      body: {
        name: "Retired Coaster", sku: "TD-OLD-001", brand: "tropical-distillery", category: "Print",
        tone: "palm", art: "bar-mat", unit: "Pack of 50", costCents: 2000, maxPerOrder: 4,
        variants: [{ label: "", stock: 5 }],
      },
    });
    const itemId = created.data.item.id;
    const jane = await signedInTeam(app);
    const placed = await jane("/api/orders", { method: "POST", body: { ...ACCOUNT_ORDER, lines: [{ itemId, variantId: "default", quantity: 2 }] } });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));

    assert.equal((await admin(`/api/admin/catalog/${itemId}`, { method: "DELETE" })).status, 200);
    assert.equal((await admin(`/api/admin/catalog/${itemId}`, { method: "DELETE" })).status, 404);
    assert.ok(!(await admin("/api/admin/catalog")).data.items.some((i) => i.id === itemId));
    assert.ok(!(await jane("/api/catalog")).data.items.some((i) => i.id === itemId));

    const mine = await jane("/api/orders");
    assert.equal(mine.data.orders.find((o) => o.id === placed.data.order.id).lines[0].name, "Retired Coaster");
    const cancelled = await admin(`/api/admin/orders/${placed.data.order.id}`, { method: "PATCH", body: { status: "cancelled" } });
    assert.equal(cancelled.status, 200, "an open order for a deleted item can still be cancelled");
    assert.equal((await jane("/api/admin/catalog/x", { method: "DELETE" })).status, 401);
  });

  it("sells the last unit exactly once under concurrent orders", async () => {
    const admin = await signedInAdmin(app);
    const { data } = await admin("/api/admin/catalog");
    const sign = data.items.find((i) => i.id === "twinp-tin-sign");
    await admin(`/api/admin/catalog/${sign.id}`, { method: "PUT", body: { ...sign, variants: [{ label: "", stock: 1 }] } });

    const buyers = await Promise.all(
      ["a", "b", "c", "d"].map((who) => signedInTeam(app, `${who}@tropicaldistillery.com`, who))
    );
    const results = await Promise.all(
      buyers.map((buy) =>
        buy("/api/orders", { method: "POST", body: { ...ACCOUNT_ORDER, lines: [{ itemId: "twinp-tin-sign", quantity: 1 }] } })
      )
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400, 400, 400]);
  });

  it("stores uploaded photos and serves them for good", async () => {
    const admin = await signedInAdmin(app);
    const { png } = await import("./images.test.mjs");
    const upload = (bytes, headers = {}) =>
      fetch(`${app.base}/api/admin/images`, {
        method: "POST",
        headers: { "Content-Type": "image/png", "X-Requested-With": "fetch", ...headers },
        body: bytes,
      });

    assert.equal((await upload(png(1200, 900))).status, 401, "admins only");

    const adminCookie = await (async () => {
      const res = await fetch(`${app.base}/api/admin/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ name: "Allie", password: ADMIN_PASSWORD }),
      });
      return res.headers.getSetCookie()[0].split(";")[0];
    })();

    const wrongSize = await upload(png(800, 600), { Cookie: adminCookie });
    assert.equal(wrongSize.status, 400);

    const res = await upload(png(1200, 900), { Cookie: adminCookie });
    assert.equal(res.status, 201);
    const { url } = await res.json();
    const served = await fetch(app.base + url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.match(served.headers.get("cache-control"), /immutable/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png(1200, 900));
    assert.equal((await fetch(`${app.base}/images/${"0".repeat(32)}.png`)).status, 404);

    // The photo can then be put on an item.
    const { data } = await admin("/api/admin/catalog");
    const cap = data.items.find((i) => i.id === "jfh-cap");
    const saved = await admin(`/api/admin/catalog/${cap.id}`, { method: "PUT", body: { ...cap, image: url } });
    assert.equal(saved.data.item.image, url);

    // Several photos, one tagged with a colour the item comes in.
    const second = (await (await upload(png(1200, 900).fill(7, 40), { Cookie: adminCookie })).json()).url;
    const gallery = await admin(`/api/admin/catalog/${cap.id}`, {
      method: "PUT",
      body: { ...saved.data.item, colors: ["Navy", "Black"], images: [{ url: second, color: "Black" }, { url, color: "" }] },
    });
    assert.equal(gallery.status, 200);
    assert.deepEqual(gallery.data.item.colors, ["Navy", "Black"]);
    assert.deepEqual(gallery.data.item.images, [{ url: second, color: "Black" }, { url, color: "" }]);
    assert.equal(gallery.data.item.image, second);
  });

  it("serves assets but nothing outside them", async () => {
    const request = app.client();
    assert.equal((await request("/assets/styles.css")).status, 200);
    assert.equal((await request("/assets/%2e%2e/shop.html")).status, 404);
    assert.equal((await request("/assets/%2e%2e/%2e%2e/server.mjs")).status, 404);
    assert.equal((await request("/server.mjs")).status, 404);
    assert.equal((await request("/data/store.json")).status, 404);
  });

  it("persists across a restart", async () => {
    const reopened = await openStore({ dataDir: dir });
    const db = await reopened.read();
    assert.ok(db.orders.length >= 3);
    await reopened.close();
  });
});

describe("bulk order edits and the per-person tracker", () => {
  it("changes many orders at once, skipping any that can't take the change", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const jane = await signedInTeam(app);
      const sam = await signedInTeam(app, "sam@tropicaldistillery.com", "Sam Rep");
      const place = async (who) => (await who("/api/orders", { method: "POST", body: ACCOUNT_ORDER })).data.order;
      const [o1, o2, o3] = [await place(jane), await place(jane), await place(jane)];
      const s1 = await place(sam);
      const admin = await signedInAdmin(app);
      const bulk = (body) => admin("/api/admin/orders/bulk", { method: "POST", body });

      assert.equal((await jane("/api/admin/orders/bulk", { method: "POST", body: { action: "approved", orderIds: [o1.id] } })).status, 401);

      const approved = await bulk({ action: "approved", orderIds: [o1.id, o2.id], note: "Go ahead" });
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      assert.deepEqual(approved.data.orders.map((o) => o.status), ["approved", "approved"]);
      assert.equal(approved.data.orders[0].history.at(-1).note, "Go ahead");
      assert.equal(app.notifications.filter((n) => n.event === "order.approved").length, 2);

      // Tracking numbers need a carrier, which stops the whole batch.
      const noCarrier = await bulk({ action: "shipped", orderIds: [o1.id, o2.id], tracking: { [o1.id]: "1Z1" } });
      assert.equal(noCarrier.status, 400);
      assert.ok(noCarrier.data.fieldErrors.carrier);
      assert.equal((await admin(`/api/admin/orders/${o1.id}`)).data.order.status, "approved", "nothing shipped");

      // A tracking number can be left out and added later.
      const shipped = await bulk({ action: "shipped", orderIds: [o1.id, o2.id], carrier: "ups", tracking: { [o1.id]: "1Z1", [o2.id]: "" } });
      assert.deepEqual(shipped.data.orders.map((o) => o.shipment.trackingNumber), ["1Z1", ""]);

      const mixed = await bulk({ action: "approved", orderIds: [o1.id, s1.id] });
      assert.deepEqual(mixed.data.orders.map((o) => o.id), [s1.id]);
      assert.deepEqual(mixed.data.skipped, [{ id: o1.id, number: o1.number, reason: "It's shipped." }]);
      assert.equal((await bulk({ action: "delivered", orderIds: [o3.id] })).status, 409, "nothing could take it");

      assert.ok((await bulk({ action: "declined", orderIds: [o3.id] })).data.fieldErrors.note);
      assert.equal((await bulk({ action: "declined", orderIds: [o3.id], note: "Duplicate" })).data.orders[0].status, "declined");

      const noted = await bulk({ action: "note", orderIds: [o1.id, s1.id], adminNote: "Invoice Q4" });
      assert.deepEqual(noted.data.orders.map((o) => o.adminNote), ["Invoice Q4", "Invoice Q4"]);
      await bulk({ action: "note", orderIds: [o1.id], adminNote: "Paid" });
      assert.equal((await admin(`/api/admin/orders/${o1.id}`)).data.order.adminNote, "Invoice Q4\nPaid");

      const picked = await admin(`/api/admin/orders.csv?ids=${o1.id},${s1.id}`);
      assert.equal(picked.data.trim().split("\r\n").length, 3);

      // Jane: two orders count (the declined one doesn't), Sam: one.
      const tracker = await admin("/api/admin/tracker.csv");
      assert.match(tracker.headers.get("content-disposition"), /tropical-merch-by-person-/);
      const [header, ...rows] = tracker.data.trim().split("\r\n");
      assert.match(header, /^name,email,distributor,on_team_list,orders,units,order_value,last_order,sku,item,color,option,quantity/);
      assert.equal(rows.length, 2);
      assert.match(rows[0], /^Jane Rep,jane@tropicaldistillery.com,,no,2,4,88.00,/);
      assert.match(rows[1], /^Sam Rep,sam@tropicaldistillery.com,,no,1,2,44.00,/);

      const later = await admin(`/api/admin/tracker.csv?from=${encodeURIComponent("2999-01-01T00:00:00Z")}`);
      assert.equal(later.data.trim().split("\r\n").length, 1, "nobody ordered in the future");
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("personal codes", () => {
  it("signs people in with their own code and tracks their orders", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const admin = await signedInAdmin(app);
      // Someone already using the shared code shows up as a suggestion.
      const shared = await signedInTeam(app, "lee@tropicaldistillery.com", "Lee");
      assert.equal((await admin("/api/admin/team")).data.suggestions[0].email, "lee@tropicaldistillery.com");

      const switchEarly = await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } });
      assert.equal(switchEarly.status, 409, "can't switch with nobody listed");

      const added = await admin("/api/admin/team", {
        method: "POST",
        body: { entries: "Jane Rep, jane@tropicaldistillery.com\nMarco <marco.ambassador@gmail.com>" },
      });
      const [jane, marco] = added.data.added;
      assert.ok(jane.code && marco.code);
      assert.equal((await admin("/api/admin/team")).data.people[0].code, undefined, "the list never includes codes");
      assert.equal((await admin(`/api/admin/team/${jane.id}/code`)).data.code, jane.code);

      assert.equal((await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } })).status, 200);
      assert.equal((await app.client()("/api/config")).data.signInMode, "personal");
      assert.equal((await shared("/api/catalog")).status, 401, "shared-code sessions end");

      const anon = app.client();
      const sharedAttempt = await anon("/api/session", { method: "POST", body: { name: "X", email: "jane@tropicaldistillery.com", code: TEAM_CODE } });
      assert.equal(sharedAttempt.status, 401, "the shared code no longer works");

      // Personal email domains are fine once someone is on the list.
      const marcoClient = app.client();
      const marcoIn = await marcoClient("/api/session", { method: "POST", body: { email: "Marco.Ambassador@gmail.com", code: marco.code.toUpperCase() } });
      assert.equal(marcoIn.status, 200, JSON.stringify(marcoIn.data));
      assert.equal(marcoIn.data.user.name, "Marco");

      const janeClient = app.client();
      assert.equal((await janeClient("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: jane.code } })).status, 200);
      const placed = await janeClient("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
      assert.equal(placed.status, 201);
      assert.equal(placed.data.order.requester.personId, jane.id);
      assert.equal(placed.data.order.requester.name, "Jane Rep");

      const report = (await admin("/api/admin/team")).data.people.find((p) => p.id === jane.id);
      assert.equal(report.orders, 1);
      assert.ok(report.lastSignInAt);

      // A new code signs Jane out; Marco is unaffected.
      const reset = await admin(`/api/admin/team/${jane.id}`, { method: "PATCH", body: { resetCode: true } });
      assert.notEqual(reset.data.person.code, jane.code);
      assert.equal((await janeClient("/api/catalog")).status, 401);
      assert.equal((await marcoClient("/api/catalog")).status, 200);

      // Removing Marco signs him out.
      assert.equal((await admin(`/api/admin/team/${marco.id}`, { method: "DELETE" })).status, 200);
      assert.equal((await marcoClient("/api/catalog")).status, 401);

      const csv = await admin("/api/admin/team.csv");
      assert.match(csv.data, /^name,email,personal_code,sign_in_link/);
      assert.match(csv.data, new RegExp(reset.data.person.code));
      assert.equal((await janeClient("/api/admin/team")).status, 401, "team sessions can't read the list");
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("counts wrong codes per email, so one person's code can't be worked out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir, { throttle: createThrottle({ max: 100 }), emailThrottle: createThrottle({ max: 2 }) });
    try {
      const admin = await signedInAdmin(app);
      const { added } = (await admin("/api/admin/team", { method: "POST", body: { entries: "Jane Rep, jane@tropicaldistillery.com\nSam, sam@tropicaldistillery.com" } })).data;
      const [jane, sam] = added;
      assert.match(jane.code, /^tropical-jane-\d{4}$/);
      await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } });
      const anon = app.client();
      const attempt = (email, code) => anon("/api/session", { method: "POST", body: { email, code } });
      assert.equal((await attempt("jane@tropicaldistillery.com", "tropical-jane-0010")).status, 401);
      assert.equal((await attempt("jane@tropicaldistillery.com", "tropical-jane-0011")).status, 401);
      assert.equal((await attempt("jane@tropicaldistillery.com", jane.code)).status, 429, "even the right code waits");
      assert.equal((await attempt("sam@tropicaldistillery.com", sam.code)).status, 200, "other people are unaffected");

      // New codes for everyone: old ones stop working, new ones do.
      const reset = (await admin("/api/admin/team/reset-codes", { method: "POST" })).data.people;
      const newSam = reset.find((p) => p.email === "sam@tropicaldistillery.com");
      assert.match(newSam.code, /^tropical-sam-\d{4}$/);
      assert.equal((await attempt("sam@tropicaldistillery.com", sam.code)).status, 401);
      assert.equal((await attempt("sam@tropicaldistillery.com", newSam.code)).status, 200);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("invites", () => {
  function fakeMailer() {
    const sent = [];
    const invite = (person, { link, by }) => {
      sent.push({ email: person.email, link, by });
      return Promise.resolve();
    };
    return { sent, mailer: { enabled: true, invite } };
  }
  const tokenOf = (link) => new URL(link).searchParams.get("invite");

  it("emails a link to create a password, which signs them in and works once", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const { sent, mailer } = fakeMailer();
    const app = await start(dir, { publicUrl: "https://merch.tropicaldistillery.com/" }, { mailer });
    try {
      const admin = await signedInAdmin(app);
      assert.equal((await admin("/api/admin/team")).data.inviteEmail, true);
      const added = await admin("/api/admin/team", {
        method: "POST",
        body: { entries: "Jane Rep, jane@tropicaldistillery.com\nMarco <marco.ambassador@gmail.com>", invite: true },
      });
      assert.equal(added.data.emailed, true);
      assert.equal(added.data.invites.length, 2);
      assert.deepEqual(sent.map((m) => m.email), ["jane@tropicaldistillery.com", "marco.ambassador@gmail.com"]);
      assert.match(sent[0].link, /^https:\/\/merch\.tropicaldistillery\.com\/welcome\?invite=[\w-]{32}$/);
      assert.equal(sent[0].by, "Allie");
      const stored = JSON.stringify(await app.store.read());
      assert.ok(!stored.includes(tokenOf(sent[0].link)), "only a hash of the token is kept");

      const anon = app.client();
      const token = tokenOf(sent[0].link);
      const who = await anon(`/api/invite?invite=${token}`);
      assert.deepEqual([who.data.name, who.data.email, who.data.reset], ["Jane Rep", "jane@tropicaldistillery.com", false]);
      assert.equal((await anon("/api/invite?invite=not-a-real-invite-token-at-all")).status, 410);

      const weak = await anon("/api/invite", { method: "POST", body: { token, password: "password1" } });
      assert.equal(weak.status, 400);
      assert.ok(weak.data.fieldErrors.password);
      const created = await anon("/api/invite", { method: "POST", body: { token, password: "mango sunset 77" } });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      assert.equal(created.data.user.name, "Jane Rep");
      assert.equal((await anon("/api/session")).data.user.personId, added.data.invites[0].id, "signed in straight away");
      assert.equal((await app.client()("/api/invite", { method: "POST", body: { token, password: "another phrase 8" } })).status, 410, "works once");

      // Her password works in shared mode (no name needed) and in personal mode.
      const janeAgain = app.client();
      const signIn = await janeAgain("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: "mango sunset 77" } });
      assert.equal(signIn.status, 200, JSON.stringify(signIn.data));
      const lee = await signedInTeam(app, "lee@tropicaldistillery.com", "Lee");
      assert.equal((await lee("/api/catalog")).status, 200, "the shared code still works alongside");
      await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } });
      assert.equal((await janeAgain("/api/catalog")).status, 200, "her session carries on");
      assert.equal((await lee("/api/catalog")).status, 401, "shared-code sessions end");
      const personal = await app.client()("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: "mango sunset 77" } });
      assert.equal(personal.status, 200);

      const report = (await admin("/api/admin/team")).data.people;
      const jane = report.find((p) => p.email === "jane@tropicaldistillery.com");
      const marco = report.find((p) => p.email === "marco.ambassador@gmail.com");
      assert.ok(jane.ownPasswordSetAt);
      assert.equal(jane.invitedAt, null, "an accepted invite is gone");
      assert.ok(marco.invitedAt);

      // Inviting everyone not set up skips Jane; a new invite replaces Marco's old link.
      const again = await admin("/api/admin/team/invite", { method: "POST", body: { notSetUp: true } });
      assert.deepEqual(again.data.invites.map((i) => i.email), ["marco.ambassador@gmail.com"]);
      assert.equal((await anon(`/api/invite?invite=${tokenOf(sent[1].link)}`)).status, 410, "the earlier link stops working");
      assert.equal((await anon(`/api/invite?invite=${tokenOf(sent.at(-1).link)}`)).status, 200);

      // For Jane, an invite is a reset link: her password works until she uses it.
      const reset = await admin("/api/admin/team/invite", { method: "POST", body: { ids: [jane.id] } });
      const resetToken = tokenOf(reset.data.invites[0].link);
      assert.equal((await anon(`/api/invite?invite=${resetToken}`)).data.reset, true);
      assert.equal((await janeAgain("/api/catalog")).status, 200);
      await anon("/api/invite", { method: "POST", body: { token: resetToken, password: "new phrase 2026" } });
      assert.equal((await janeAgain("/api/catalog")).status, 401, "a new password signs her other sessions out");
      const fresh = await app.client()("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: "new phrase 2026" } });
      assert.equal(fresh.status, 200);
      assert.equal((await anon("/api/admin/team/invite", { method: "POST", body: { notSetUp: true } })).status, 401);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("hands the admin the links when email is off, and serves the welcome page", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir, {}, { mailer: null });
    try {
      const admin = await signedInAdmin(app);
      await admin("/api/admin/team", { method: "POST", body: { entries: "Sam, sam@tropicaldistillery.com" } });
      const res = await admin("/api/admin/team/invite", { method: "POST", body: { notSetUp: true } });
      assert.equal(res.data.emailed, false);
      assert.match(res.data.invites[0].link, /^http:\/\/127\.0\.0\.1:\d+\/welcome\?invite=/, "from the admin's own address without PUBLIC_URL");
      const page = await app.client()(new URL(res.data.invites[0].link).pathname);
      assert.equal(page.status, 200);
      assert.match(page.data, /Create your password/);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("out-of-stock requests over HTTP", () => {
  it("lets people ask for what's out of stock, and the admin tell them it's back", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const events = [];
    const mailer = { enabled: true, invite: () => Promise.resolve(), request: (event, r) => events.push([event, r.requester.email, r.quantity]) };
    const app = await start(dir, {}, { mailer });
    try {
      await app.store.mutate((db) => {
        db.catalog.find((i) => i.id === "jfh-bar-mat").variants[0].stock = 0;
      });
      const jane = await signedInTeam(app);
      const catalog = (await jane("/api/catalog")).data.items;
      assert.equal(catalog.find((i) => i.id === "jfh-bar-mat").variants[0].stock, 0);

      const asked = await jane("/api/requests", { method: "POST", body: { itemId: "jfh-bar-mat", quantity: 10, note: "Two new accounts" } });
      assert.equal(asked.status, 201, JSON.stringify(asked.data));
      assert.deepEqual(events.shift(), ["request.created", "jane@tropicaldistillery.com", 10]);
      const more = await jane("/api/requests", { method: "POST", body: { itemId: "jfh-bar-mat", quantity: 12 } });
      assert.equal(more.status, 200);
      assert.equal(more.data.updated, true);
      assert.equal(events.length, 0, "an update doesn't alert the admins again");
      assert.equal((await jane("/api/requests", { method: "POST", body: { itemId: "jfh-logo-tee", variantId: "m", quantity: 1 } })).status, 409, "in stock");

      const sam = await signedInTeam(app, "sam@tropicaldistillery.com", "Sam Rep");
      await sam("/api/requests", { method: "POST", body: { itemId: "jfh-bar-mat", quantity: 4 } });
      assert.equal((await sam("/api/requests")).data.requests.length, 1, "each sees only their own");
      assert.equal((await sam(`/api/requests/${asked.data.request.id}/withdraw`, { method: "POST" })).status, 404);

      const admin = await signedInAdmin(app);
      const list = (await admin("/api/admin/requests")).data.requests;
      assert.equal(list.length, 2);
      assert.equal(list[0].stockNow, 0);
      await app.store.mutate((db) => {
        db.catalog.find((i) => i.id === "jfh-bar-mat").variants[0].stock = 30;
      });
      events.length = 0;
      const settled = await admin("/api/admin/requests/settle", { method: "POST", body: { ids: list.map((r) => r.id), action: "notified" } });
      assert.equal(settled.status, 200);
      assert.deepEqual(events.map((e) => e[0]).sort(), ["request.notified", "request.notified"]);
      assert.equal((await jane("/api/requests")).data.requests[0].status, "notified");
      assert.equal((await jane("/api/admin/requests")).status, 401);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("distributor codes", () => {
  const TEE_ORDER = { ...ACCOUNT_ORDER, lines: [{ itemId: "jfh-logo-tee", variantId: "m", quantity: 1 }] };

  it("lets reps sign in with their distributor's code next to personal codes, and keeps them apart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const admin = await signedInAdmin(app);
      const missing = await admin("/api/admin/distributors", { method: "POST", body: { name: "Southern Glazer's FL", categories: [] } });
      assert.equal(missing.status, 400);
      assert.ok(missing.data.fieldErrors.categories);
      const created = await admin("/api/admin/distributors", {
        method: "POST",
        body: { name: "Southern Glazer's FL", categories: ["Bar Tools", "Print", "Not a category"] },
      });
      assert.equal(created.status, 201);
      const sgws = created.data.distributor;
      assert.equal(sgws.code, "td-sgfl");
      assert.deepEqual(sgws.categories, ["Print", "Bar Tools"]);
      const dupe = await admin("/api/admin/distributors", { method: "POST", body: { name: "southern glazer's fl", categories: ["Print"] } });
      assert.equal(dupe.status, 400);

      // The team on personal codes; Jane ships to an account.
      const { added } = (await admin("/api/admin/team", { method: "POST", body: { entries: "Jane Rep, jane@tropicaldistillery.com" } })).data;
      await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } });
      const jane = app.client();
      await jane("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: added[0].code } });
      const janeOrder = (await jane("/api/orders", { method: "POST", body: ACCOUNT_ORDER })).data.order;
      assert.equal((await app.client()("/api/config")).data.distributorSignIn, true);

      // A rep needs their name; any email will do, even one already on the team.
      const rep = app.client();
      const noName = await rep("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code: sgws.code } });
      assert.equal(noName.status, 400);
      assert.ok(noName.data.fieldErrors.name);
      const repIn = await rep("/api/session", {
        method: "POST",
        body: { name: "Dee Rep", email: "jane@tropicaldistillery.com", code: ` ${sgws.code.toUpperCase()} ` },
      });
      assert.equal(repIn.status, 200, JSON.stringify(repIn.data));
      assert.equal(repIn.data.user.distributor, "Southern Glazer's FL");
      const session = (await rep("/api/session")).data.user;
      assert.equal(session.distributorId, sgws.id);
      assert.equal(session.personId, undefined);

      // Only their distributor's categories, and nothing of Jane's.
      const categories = new Set((await rep("/api/catalog")).data.items.map((i) => i.category));
      assert.deepEqual([...categories].sort(), ["Bar Tools", "Print"]);
      assert.deepEqual((await rep("/api/orders")).data.orders, []);
      assert.deepEqual((await rep("/api/accounts")).data.accounts, [], "Jane's accounts aren't offered");
      assert.equal((await rep(`/api/orders/${janeOrder.id}/cancel`, { method: "POST" })).status, 404);
      assert.equal((await rep("/api/me/password", { method: "POST", body: { current: sgws.code, password: "a new phrase" } })).status, 409);

      const tee = await rep("/api/orders", { method: "POST", body: TEE_ORDER });
      assert.equal(tee.status, 400, "apparel isn't one of its categories");
      const placed = await rep("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
      assert.equal(placed.status, 201, JSON.stringify(placed.data));
      assert.equal(placed.data.order.requester.distributorId, sgws.id);
      assert.equal(placed.data.order.requester.distributor, "Southern Glazer's FL");
      assert.deepEqual((await rep("/api/orders")).data.orders.map((o) => o.id), [placed.data.order.id]);
      assert.equal((await rep("/api/accounts")).data.accounts.length, 1, "now its own account is offered");
      assert.deepEqual((await jane("/api/orders")).data.orders.map((o) => o.id), [janeOrder.id], "Jane sees only hers");

      const report = (await admin("/api/admin/team")).data;
      const row = report.distributors.find((d) => d.id === sgws.id);
      assert.equal(row.orders, 1);
      assert.equal(row.reps, 1);
      assert.ok(row.lastSignInAt);
      assert.equal(report.people[0].orders, 1, "the rep's order isn't counted as Jane's");
      assert.match((await admin("/api/admin/orders.csv")).data, /,jane@tropicaldistillery.com,Southern Glazer's FL,/);
      assert.match((await admin("/api/admin/tracker.csv")).data, /\r\nDee Rep,jane@tropicaldistillery.com,Southern Glazer's FL,no,1,/);

      // Turned off, its reps are signed out; on again with a new code, only that works.
      await admin(`/api/admin/distributors/${sgws.id}`, { method: "PATCH", body: { active: false } });
      assert.equal((await rep("/api/catalog")).status, 401);
      assert.equal((await app.client()("/api/session", { method: "POST", body: { name: "Dee", email: "dee@sgws.com", code: sgws.code } })).status, 401);
      const renewed = (await admin(`/api/admin/distributors/${sgws.id}`, { method: "PATCH", body: { active: true, resetCode: true, categories: ["Print"] } })).data.distributor;
      assert.equal(renewed.code, "td-sgfl-2");
      assert.equal((await app.client()("/api/session", { method: "POST", body: { name: "Dee", email: "dee@sgws.com", code: sgws.code } })).status, 401);
      const again = app.client();
      assert.equal((await again("/api/session", { method: "POST", body: { name: "Dee", email: "dee@sgws.com", code: renewed.code } })).status, 200);
      assert.deepEqual([...new Set((await again("/api/catalog")).data.items.map((i) => i.category))], ["Print"]);

      // Removed: signed out, and past orders keep its name.
      assert.equal((await admin(`/api/admin/distributors/${sgws.id}`, { method: "DELETE" })).status, 200);
      assert.equal((await again("/api/catalog")).status, 401);
      const kept = (await admin(`/api/admin/orders/${placed.data.order.id}`)).data.order;
      assert.equal(kept.requester.distributor, "Southern Glazer's FL");
      assert.equal((await jane("/api/catalog")).status, 200, "the team is unaffected throughout");
      assert.equal((await rep("/api/admin/team")).status, 401);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("logs who signs in with each distributor's code, for the admin and as a CSV", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const admin = await signedInAdmin(app);
      const make = async (name) =>
        (await admin("/api/admin/distributors", { method: "POST", body: { name, categories: ["Bar Tools"] } })).data.distributor;
      const reyes = await make("Reyes Beverage Group Florida");
      const rndc = await make("RNDC Texas");
      const signIn = (name, email, code) =>
        app.client()("/api/session", { method: "POST", body: { name, email, code } });
      await signIn("Rita Rep", "rita@rbg.com", reyes.code);
      await signIn("Rita R.", "Rita@RBG.com", reyes.code);
      const sam = app.client();
      await sam("/api/session", { method: "POST", body: { name: "Sam", email: "sam@rbg.com", code: reyes.code } });
      await sam("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
      await signIn("Tex", "tex@rndc.com", rndc.code);
      await signIn("Nobody", "x@rbg.com", "td-wrong");

      const { reps, signIns } = (await admin(`/api/admin/distributors/${reyes.id}/activity`)).data;
      assert.deepEqual(reps.map((r) => [r.email, r.name, r.signIns, r.orders]), [
        ["sam@rbg.com", "Sam", 1, 1],
        ["rita@rbg.com", "Rita R.", 2, 0],
      ]);
      assert.ok(reps[1].firstSignInAt <= reps[1].lastSignInAt);
      assert.deepEqual(signIns.map((e) => e.email), ["sam@rbg.com", "rita@rbg.com", "rita@rbg.com"], "newest first, this distributor only");
      assert.equal((await admin("/api/admin/team")).data.distributors.find((d) => d.id === reyes.id).reps, 2);

      const csv = await admin(`/api/admin/distributors/${reyes.id}/sign-ins.csv`);
      assert.match(csv.headers.get("content-disposition"), /td-rbgfl-sign-ins-/);
      const lines = csv.data.trim().split("\r\n");
      assert.equal(lines[0], "signed_in_at,name,email,distributor,first_sign_in,sign_ins,orders,order_value");
      assert.equal(lines.length, 4);
      assert.match(lines[1], /,Sam,sam@rbg\.com,Reyes Beverage Group Florida,.*,1,1,44\.00$/);
      assert.ok(!csv.data.includes("tex@rndc.com"));
      assert.equal((await admin("/api/admin/distributors/nope/activity")).status, 404);
      assert.equal((await sam(`/api/admin/distributors/${reyes.id}/activity`)).status, 401);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("works without a shared team code too, with any email", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir, { teamAccessCode: "" });
    try {
      const anon = app.client();
      assert.equal((await anon("/api/config")).data.teamSignIn, false);
      const admin = await signedInAdmin(app);
      const { distributor } = (await admin("/api/admin/distributors", { method: "POST", body: { name: "RNDC", categories: ["Bar Tools"] } })).data;
      assert.equal((await anon("/api/config")).data.teamSignIn, true, "a distributor code opens the store");
      const res = await anon("/api/session", { method: "POST", body: { name: "Ray", email: "ray@rndc-usa.com", code: distributor.code } });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const placed = await anon("/api/orders", { method: "POST", body: ACCOUNT_ORDER });
      assert.equal(placed.status, 201);
      assert.equal(app.notifications.at(-1).number, placed.data.order.number);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("bulk stock edits over HTTP", () => {
  it("saves many stock levels in one request, for admins only", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const jane = await signedInTeam(app);
      const admin = await signedInAdmin(app);
      const body = { changes: [{ itemId: "jfh-bar-mat", variantId: "default", add: 10 }, { itemId: "jfh-logo-tee", variantId: "m", from: 14, to: 20 }] };
      assert.equal((await jane("/api/admin/catalog/stock", { method: "POST", body })).status, 401);
      const before = (await admin("/api/admin/catalog")).data.items.find((i) => i.id === "jfh-bar-mat").variants[0].stock;
      const saved = await admin("/api/admin/catalog/stock", { method: "POST", body });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.changed, 2);
      const items = (await admin("/api/admin/catalog")).data.items;
      assert.equal(items.find((i) => i.id === "jfh-bar-mat").variants[0].stock, before + 10);
      assert.equal(items.find((i) => i.id === "jfh-logo-tee").variants.find((v) => v.id === "m").stock, 20);
      const bad = await admin("/api/admin/catalog/stock", { method: "POST", body: { changes: [{ itemId: "jfh-bar-mat", variantId: "default", to: "lots" }] } });
      assert.equal(bad.status, 400);
      assert.ok(bad.data.fieldErrors["stock.jfh-bar-mat.default"]);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("bulk catalog edits over HTTP", () => {
  it("saves details and stock together, for admins only", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir);
    try {
      const jane = await signedInTeam(app);
      const admin = await signedInAdmin(app);
      const body = { items: [{ id: "jfh-cap", patch: { costCents: 1999, category: "Giveaways" } }], stock: [{ itemId: "jfh-cap", variantId: "default", add: 5 }] };
      assert.equal((await jane("/api/admin/catalog/bulk", { method: "POST", body })).status, 401);
      const before = (await admin("/api/admin/catalog")).data.items.find((i) => i.id === "jfh-cap");
      const saved = await admin("/api/admin/catalog/bulk", { method: "POST", body });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      const cap = saved.data.items.find((i) => i.id === "jfh-cap");
      assert.equal(cap.costCents, 1999);
      assert.equal(cap.category, "Giveaways");
      assert.equal(cap.variants[0].stock, before.variants[0].stock + 5);
      const shop = (await jane("/api/catalog")).data.items.find((i) => i.id === "jfh-cap");
      assert.equal(shop.costCents, 1999, "the store shows it straight away");
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("own passwords", () => {
  it("lets someone swap their code for a password, signing out their other devices", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir, { throttle: createThrottle({ max: 100 }) });
    try {
      const admin = await signedInAdmin(app);
      const shared = await signedInTeam(app);
      const sharedTry = await shared("/api/me/password", { method: "POST", body: { current: TEAM_CODE, password: "mango sunset 42" } });
      assert.equal(sharedTry.status, 409, "nothing to change on the shared code");

      const [jane] = (await admin("/api/admin/team", { method: "POST", body: { entries: "Jane Rep, jane@tropicaldistillery.com" } })).data.added;
      await admin("/api/admin/team/mode", { method: "PUT", body: { mode: "personal" } });
      const signIn = (client, code) => client("/api/session", { method: "POST", body: { email: "jane@tropicaldistillery.com", code } });
      const laptop = app.client();
      const phone = app.client();
      assert.equal((await signIn(laptop, jane.code)).status, 200);
      assert.equal((await signIn(phone, jane.code)).status, 200);
      const change = (body) => laptop("/api/me/password", { method: "POST", body });

      const wrong = await change({ current: "tropical-jane-0000", password: "mango sunset 42" });
      assert.equal(wrong.status, 400, "a wrong current code isn't a lost session");
      assert.ok(wrong.data.fieldErrors.current);
      assert.ok((await change({ current: jane.code, password: "short" })).data.fieldErrors.password);
      assert.equal((await laptop("/api/catalog")).status, 200);

      const changed = await change({ current: jane.code, password: "mango sunset 42" });
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal((await laptop("/api/catalog")).status, 200, "this device stays signed in");
      assert.equal((await phone("/api/catalog")).status, 401, "other devices are signed out");

      const fresh = app.client();
      assert.equal((await signIn(fresh, jane.code)).status, 401, "the code stops working");
      assert.equal((await signIn(fresh, "mango sunset 42")).status, 200);

      const row = (await admin("/api/admin/team")).data.people.find((p) => p.id === jane.id);
      assert.ok(row.ownPasswordSetAt);
      assert.equal((await admin(`/api/admin/team/${jane.id}/code`)).data.code, null);
      const csv = (await admin("/api/admin/team.csv")).data;
      assert.ok(!csv.includes("mango") && !csv.includes("scrypt"));

      // Forgotten: a new code from the admin replaces the password.
      const reset = await admin(`/api/admin/team/${jane.id}`, { method: "PATCH", body: { resetCode: true } });
      assert.equal((await fresh("/api/catalog")).status, 401);
      assert.equal((await signIn(app.client(), "mango sunset 42")).status, 401);
      assert.equal((await signIn(app.client(), reset.data.person.code)).status, 200);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("configuration", () => {
  it("signs everyone out when the team code changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const first = await start(dir);
    const jane = await signedInTeam(first);
    const cookieHeader = await (async () => {
      // Grab the cookie from a fresh sign-in on a raw fetch.
      const res = await fetch(`${first.base}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ name: "Jane", email: "jane@tropicaldistillery.com", code: TEAM_CODE }),
      });
      return res.headers.getSetCookie()[0].split(";")[0];
    })();
    assert.equal((await jane("/api/catalog")).status, 200);
    await first.close();

    const second = await start(dir, { teamAccessCode: "a brand new code" });
    try {
      const res = await fetch(`${second.base}/api/catalog`, { headers: { Cookie: cookieHeader } });
      assert.equal(res.status, 401);
    } finally {
      await second.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("closes the store without a team code and the console without a password", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-"));
    const app = await start(dir, { teamAccessCode: "", adminPassword: "" });
    try {
      const request = app.client();
      const signIn = await request("/api/session", { method: "POST", body: { name: "Jane", email: "jane@tropicaldistillery.com", code: "" } });
      assert.equal(signIn.status, 503);
      assert.equal((await request("/api/admin/session", { method: "POST", body: { password: "" } })).status, 404);
      const config = await request("/api/config");
      assert.deepEqual([config.data.teamSignIn, config.data.adminSignIn], [false, false]);
    } finally {
      await app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
