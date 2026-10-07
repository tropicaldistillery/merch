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

async function start(dir, overrides = {}) {
  const store = await openStore({ dataDir: dir });
  const notifications = [];
  const handler = await createApp({
    store,
    notify: (event, order) => notifications.push({ event, number: order.number }),
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

      // A missing tracking number stops the whole batch and names the order.
      const missing = await bulk({ action: "shipped", orderIds: [o1.id, o2.id], carrier: "ups", tracking: { [o1.id]: "1Z1" } });
      assert.equal(missing.status, 400);
      assert.ok(missing.data.fieldErrors[`tracking.${o2.id}`]);
      assert.equal((await admin(`/api/admin/orders/${o1.id}`)).data.order.status, "approved", "nothing shipped");

      const shipped = await bulk({ action: "shipped", orderIds: [o1.id, o2.id], carrier: "ups", tracking: { [o1.id]: "1Z1", [o2.id]: "1Z 2" } });
      assert.deepEqual(shipped.data.orders.map((o) => o.shipment.trackingNumber), ["1Z1", "1Z2"]);

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
      assert.match(header, /^name,email,on_team_list,orders,units,order_value,last_order,sku,item,color,option,quantity/);
      assert.equal(rows.length, 2);
      assert.match(rows[0], /^Jane Rep,jane@tropicaldistillery.com,no,2,4,88.00,/);
      assert.match(rows[1], /^Sam Rep,sam@tropicaldistillery.com,no,1,2,44.00,/);

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
