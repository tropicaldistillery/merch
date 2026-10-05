// The HTTP application: JSON API, sign-in, and the static pages.
//
// createApp() returns a plain (req, res) handler so tests can mount it on an
// ephemeral port without the environment-reading entry point in server.mjs.

import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_HOURS,
  TEAM_COOKIE,
  TEAM_SESSION_DAYS,
  clearedCookie,
  createThrottle,
  credentialFingerprint,
  parseCookies,
  safeEqual,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth.mjs";
import { applySeedTextFixes, needsSeedTextFixes, normalizeItem, publicItem } from "./catalog.mjs";
import {
  cancelOwnOrder,
  normalizeAccountEdit,
  ordersToCsv,
  placeOrder,
  updateOrder,
} from "./orders.mjs";
import { OPEN_STATUSES, STATUSES } from "../public/assets/shared.js";
import { ValidationError, cleanLine, isValidEmail, normalizeEmail } from "./validation.mjs";

const MAX_BODY_BYTES = 64 * 1024;

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Pages behind the team sign-in redirect to it; the admin pages carry their
// own sign-in form because a different credential opens them.
const PAGES = {
  "/": { file: "index.html" },
  "/shop": { file: "shop.html", team: true },
  "/checkout": { file: "checkout.html", team: true },
  "/orders": { file: "orders.html", team: true },
  "/admin": { file: "admin.html" },
  "/packing-slip": { file: "packing-slip.html" },
};

/* ----------------------------------------------------------------- helpers */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  send(res, status, body, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
}

function readJson(req) {
  if (!String(req.headers["content-type"] || "").includes("application/json")) {
    return Promise.reject(new ValidationError("Send the request as JSON.", {}, 415));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError("That request is too large.", {}, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        resolve(parsed);
      } catch {
        reject(new ValidationError("We couldn't read that request.", {}, 400));
      }
    });
    req.on("error", reject);
  });
}

function clientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Only same-site paths are honoured as a post-sign-in destination.
export function safeNext(value) {
  const text = String(value || "");
  return /^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/.test(text) && !text.includes("\\") ? text : "/shop";
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    attention: account.attention,
    phone: account.phone,
    address1: account.address1,
    address2: account.address2,
    city: account.city,
    state: account.state,
    postalCode: account.postalCode,
    deliveryNotes: account.deliveryNotes,
    orderCount: account.orderCount ?? 0,
    lastOrderedAt: account.lastOrderedAt ?? null,
  };
}

function byName(a, b) {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/* ---------------------------------------------------------------- the app */

/**
 * @param {object} options
 * @param {{read: Function, mutate: Function, kind: string}} options.store
 * @param {object} options.config  see server.mjs for the fields
 * @param {(event: string, order: object) => void} [options.notify]
 * @param {() => Date} [options.clock]
 */
export async function createApp({ store, config, notify = () => {}, clock = () => new Date() }) {
  let initial = await store.read();
  if (needsSeedTextFixes(initial)) {
    const changed = await store.mutate((db) => applySeedTextFixes(db));
    console.log(`[catalog] brought ${changed} starter-catalog field(s) in line with tropicaldistillery.com`);
    initial = await store.read();
  }
  const secret = config.sessionSecret || initial.meta.sessionSecret;
  const teamCode = String(config.teamAccessCode || "").trim();
  const adminPassword = String(config.adminPassword || "");
  const teamFingerprint = teamCode ? credentialFingerprint(secret, `team:${teamCode.toLowerCase()}`) : null;
  const adminFingerprint = adminPassword ? credentialFingerprint(secret, `admin:${adminPassword}`) : null;
  const domains = config.allowedEmailDomains ?? [];
  const timeZone = config.timeZone || "America/New_York";
  const orderPrefix = config.orderPrefix || "TD";
  const publicDir = config.publicDir;
  const throttle = config.throttle ?? createThrottle();
  // X-Forwarded-For can be forged to look like many addresses, so a ceiling
  // on failures from everyone together backs up the per-address limit. It
  // only ever blocks new sign-ins; existing sessions keep working.
  const globalThrottle = config.globalThrottle ?? createThrottle({ max: 100 });

  function signInBlocked(address) {
    return throttle.blocked(address) || globalThrottle.blocked("*");
  }

  function signInFailed(address) {
    throttle.fail(address);
    globalThrottle.fail("*");
  }

  function secureCookies(req) {
    if (config.cookieSecure === "always") return true;
    if (config.cookieSecure === "never") return false;
    return req.socket.encrypted === true || req.headers["x-forwarded-proto"] === "https";
  }

  function teamUser(req) {
    if (!teamFingerprint) return null;
    const payload = verifySession(secret, parseCookies(req.headers.cookie)[TEAM_COOKIE]);
    if (!payload || payload.role !== "team" || payload.fp !== teamFingerprint) return null;
    return { name: payload.name, email: payload.email };
  }

  function adminUser(req) {
    if (!adminFingerprint) return null;
    const payload = verifySession(secret, parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
    if (!payload || payload.role !== "admin" || payload.fp !== adminFingerprint) return null;
    return { name: payload.name };
  }

  /* ------------------------------------------------------------- handlers */

  async function teamSignIn({ req, res }) {
    if (!teamCode) {
      throw new ValidationError("The store isn't set up yet — TEAM_ACCESS_CODE has not been configured.", {}, 503);
    }
    const address = clientAddress(req);
    if (signInBlocked(address)) {
      throw new ValidationError("Too many sign-in attempts. Wait 15 minutes and try again.", {}, 429);
    }
    const body = await readJson(req);
    const name = cleanLine(body.name, 80);
    const email = normalizeEmail(body.email);
    const errors = {};
    if (!name) errors.name = "Enter your name.";
    if (!isValidEmail(email)) errors.email = "Enter your work email address.";
    else if (domains.length && !domains.some((domain) => email.endsWith(`@${domain}`))) {
      errors.email = `Use your ${domains.map((d) => `@${d}`).join(" or ")} email address.`;
    }
    if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

    const code = String(body.code ?? "").trim().toLowerCase();
    if (!safeEqual(code, teamCode.toLowerCase())) {
      signInFailed(address);
      await delay(config.failureDelayMs ?? 400);
      throw new ValidationError("That team code isn't right.", { code: "That team code isn't right." }, 401);
    }

    const maxAgeSeconds = TEAM_SESSION_DAYS * 24 * 60 * 60;
    const token = signSession(secret, {
      role: "team",
      name,
      email,
      fp: teamFingerprint,
      exp: Date.now() + maxAgeSeconds * 1000,
    });
    sendJson(res, 200, { ok: true, user: { name, email } }, {
      "Set-Cookie": sessionCookie(TEAM_COOKIE, token, { maxAgeSeconds, secure: secureCookies(req) }),
    });
  }

  async function adminSignIn({ req, res }) {
    const address = clientAddress(req);
    if (signInBlocked(address)) {
      throw new ValidationError("Too many sign-in attempts. Wait 15 minutes and try again.", {}, 429);
    }
    const body = await readJson(req);
    if (!safeEqual(String(body.password ?? ""), adminPassword)) {
      signInFailed(address);
      await delay(config.failureDelayMs ?? 400);
      throw new ValidationError("That password isn't right.", { password: "That password isn't right." }, 401);
    }
    const name = cleanLine(body.name, 80) || "Admin";
    const maxAgeSeconds = ADMIN_SESSION_HOURS * 60 * 60;
    const token = signSession(secret, {
      role: "admin",
      name,
      fp: adminFingerprint,
      exp: Date.now() + maxAgeSeconds * 1000,
    });
    sendJson(res, 200, { ok: true, admin: { name } }, {
      "Set-Cookie": sessionCookie(ADMIN_COOKIE, token, { maxAgeSeconds, secure: secureCookies(req) }),
    });
  }

  function find(list, id, what) {
    const entry = list.find((x) => x.id === id);
    if (!entry) throw new ValidationError(`That ${what} could not be found.`, {}, 404);
    return entry;
  }

  /* --------------------------------------------------------------- routes */

  // [method, path, access, handler]. A string path matches exactly; a RegExp
  // passes its capture groups as `params`.
  const routes = [
    ["GET", "/api/health", "public", async ({ res }) => sendJson(res, 200, { ok: true, store: store.kind })],

    ["GET", "/api/config", "public", async ({ res }) =>
      sendJson(res, 200, {
        ok: true,
        teamSignIn: Boolean(teamCode),
        adminSignIn: Boolean(adminPassword),
        emailDomains: domains,
      })],

    // Team session
    ["POST", "/api/session", "public", teamSignIn],
    ["GET", "/api/session", "team", async ({ res, user }) => sendJson(res, 200, { ok: true, user })],
    ["DELETE", "/api/session", "public", async ({ req, res }) =>
      sendJson(res, 200, { ok: true }, { "Set-Cookie": clearedCookie(TEAM_COOKIE, { secure: secureCookies(req) }) })],

    // Store
    ["GET", "/api/catalog", "team", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, items: db.catalog.filter((item) => item.active).map(publicItem) });
    }],

    ["GET", "/api/me", "team", async ({ res, user }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, user, address: db.members[user.email]?.address ?? null });
    }],

    ["GET", "/api/accounts", "team", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, accounts: db.accounts.map(publicAccount).sort(byName) });
    }],

    ["GET", "/api/orders", "team", async ({ res, user }) => {
      const db = await store.read();
      const orders = db.orders.filter((o) => o.requester.email === user.email).reverse();
      sendJson(res, 200, { ok: true, orders });
    }],

    ["POST", "/api/orders", "team", async ({ req, res, user }) => {
      const body = await readJson(req);
      const order = await store.mutate((db) =>
        placeOrder(db, body, { requester: user, now: clock(), timeZone, prefix: orderPrefix })
      );
      notify("order.created", order);
      sendJson(res, 201, { ok: true, order });
    }],

    ["POST", /^\/api\/orders\/([\w-]+)\/cancel$/, "team", async ({ res, user, params }) => {
      const order = await store.mutate((db) =>
        cancelOwnOrder(db, params[0], { email: user.email, name: user.name, now: clock() })
      );
      notify("order.cancelled", order);
      sendJson(res, 200, { ok: true, order });
    }],

    // Admin session
    ["POST", "/api/admin/session", "admin-signin", adminSignIn],
    ["GET", "/api/admin/session", "admin", async ({ res, admin }) => sendJson(res, 200, { ok: true, admin })],
    ["DELETE", "/api/admin/session", "public", async ({ req, res }) =>
      sendJson(res, 200, { ok: true }, { "Set-Cookie": clearedCookie(ADMIN_COOKIE, { secure: secureCookies(req) }) })],

    // Admin: orders
    ["GET", "/api/admin/orders", "admin", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, orders: db.orders.slice().reverse() });
    }],

    ["GET", "/api/admin/orders.csv", "admin", async ({ res, url }) => {
      const db = await store.read();
      const wanted = (url.searchParams.get("status") || "all").split(",");
      const statuses = wanted.includes("all")
        ? null
        : wanted.flatMap((s) => (s === "open" ? OPEN_STATUSES : STATUSES.some((x) => x.id === s) ? [s] : []));
      const orders = db.orders.filter((o) => !statuses || statuses.includes(o.status));
      const stamp = clock().toISOString().slice(0, 10);
      send(res, 200, ordersToCsv(orders), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tropical-merch-orders-${stamp}.csv"`,
        "Cache-Control": "no-store",
      });
    }],

    ["GET", /^\/api\/admin\/orders\/([\w-]+)$/, "admin", async ({ res, params }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, order: find(db.orders, params[0], "order") });
    }],

    ["PATCH", /^\/api\/admin\/orders\/([\w-]+)$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, statusChanged } = await store.mutate((db) =>
        updateOrder(db, params[0], body, { actor: admin.name, now: clock() })
      );
      if (statusChanged) notify(`order.${order.status}`, order);
      sendJson(res, 200, { ok: true, order });
    }],

    // Admin: catalog
    ["GET", "/api/admin/catalog", "admin", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, items: db.catalog });
    }],

    ["POST", "/api/admin/catalog", "admin", async ({ req, res }) => {
      const body = await readJson(req);
      const item = await store.mutate((db) => {
        const next = normalizeItem(body, { catalog: db.catalog });
        db.catalog.push(next);
        return next;
      });
      sendJson(res, 201, { ok: true, item });
    }],

    ["PUT", /^\/api\/admin\/catalog\/([\w-]+)$/, "admin", async ({ req, res, params }) => {
      const body = await readJson(req);
      const item = await store.mutate((db) => {
        const existing = find(db.catalog, params[0], "item");
        const next = normalizeItem(body, { catalog: db.catalog, existing });
        db.catalog[db.catalog.indexOf(existing)] = next;
        return next;
      });
      sendJson(res, 200, { ok: true, item });
    }],

    // Admin: accounts
    ["GET", "/api/admin/accounts", "admin", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, accounts: db.accounts.slice().sort(byName) });
    }],

    ["PUT", /^\/api\/admin\/accounts\/([\w-]+)$/, "admin", async ({ req, res, params }) => {
      const body = await readJson(req);
      const account = await store.mutate((db) => {
        const existing = find(db.accounts, params[0], "account");
        Object.assign(existing, normalizeAccountEdit(body, existing, db), { updatedAt: clock().toISOString() });
        return existing;
      });
      sendJson(res, 200, { ok: true, account });
    }],

    ["DELETE", /^\/api\/admin\/accounts\/([\w-]+)$/, "admin", async ({ res, params }) => {
      await store.mutate((db) => {
        const existing = find(db.accounts, params[0], "account");
        db.accounts.splice(db.accounts.indexOf(existing), 1);
      });
      sendJson(res, 200, { ok: true });
    }],
  ];

  function matchRoute(pathname) {
    const matches = [];
    for (const [method, pattern, access, handle] of routes) {
      if (typeof pattern === "string") {
        if (pattern === pathname) matches.push({ method, access, handle, params: [] });
      } else {
        const m = pattern.exec(pathname);
        if (m) matches.push({ method, access, handle, params: m.slice(1) });
      }
    }
    return matches;
  }

  async function handleApi(req, res, url) {
    const matches = matchRoute(url.pathname);
    if (!matches.length) return sendJson(res, 404, { ok: false, error: "Not found." });

    const route = matches.find((m) => m.method === req.method);
    if (!route) {
      return sendJson(res, 405, { ok: false, error: "Method not allowed." }, {
        Allow: [...new Set(matches.map((m) => m.method))].join(", "),
      });
    }

    // Cross-site requests cannot set a custom header without a CORS
    // preflight, which this server never grants, so requiring one on every
    // state-changing call closes off cross-site request forgery.
    if (req.method !== "GET" && req.method !== "HEAD" && !req.headers["x-requested-with"]) {
      return sendJson(res, 403, { ok: false, error: "Missing request header." });
    }

    const ctx = { req, res, url, params: route.params, user: null, admin: null };

    if (route.access === "team") {
      ctx.user = teamUser(req);
      if (!ctx.user) return sendJson(res, 401, { ok: false, error: "Your session has ended. Sign in again." });
    } else if (route.access === "admin" || route.access === "admin-signin") {
      if (!adminPassword) {
        return sendJson(res, 404, { ok: false, error: "The admin console is off. Set ADMIN_PASSWORD to turn it on." });
      }
      if (route.access === "admin") {
        ctx.admin = adminUser(req);
        if (!ctx.admin) return sendJson(res, 401, { ok: false, error: "Sign in to the admin console." });
      }
    }

    return route.handle(ctx);
  }

  /* --------------------------------------------------------------- static */

  function resolveAsset(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const assetsDir = path.join(publicDir, "assets");
    const candidate = path.resolve(publicDir, `.${decoded}`);
    if (!candidate.startsWith(assetsDir + path.sep)) return null;
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
    return candidate;
  }

  function serveFile(req, res, filePath, status = 200) {
    const stat = statSync(filePath);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ETag: etag,
    };
    if (status === 200 && req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    headers["Content-Length"] = stat.size;
    res.writeHead(status, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  }

  function redirect(res, location) {
    send(res, 302, "", { Location: location, "Cache-Control": "no-store" });
  }

  function servePage(req, res, url) {
    const page = PAGES[url.pathname];
    if (page.team && !teamUser(req)) {
      return redirect(res, `/?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    if (url.pathname === "/" && teamUser(req)) {
      return redirect(res, safeNext(url.searchParams.get("next")));
    }
    return serveFile(req, res, path.join(publicDir, page.file));
  }

  /* -------------------------------------------------------------- handler */

  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    }

    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Method not allowed", { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      }

      if (Object.hasOwn(PAGES, url.pathname)) return servePage(req, res, url);

      if (url.pathname.startsWith("/assets/")) {
        const asset = resolveAsset(url.pathname);
        if (asset) return serveFile(req, res, asset);
      }

      return serveFile(req, res, path.join(publicDir, "404.html"), 404);
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendJson(res, error.status, { ok: false, error: error.message, fieldErrors: error.fieldErrors });
      }
      console.error("[server]", error);
      if (res.headersSent) return res.end();
      return sendJson(res, 500, { ok: false, error: "Something went wrong on our side. Try again in a moment." });
    }
  };
}
