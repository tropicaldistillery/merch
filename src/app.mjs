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
  linkToken,
  parseCookies,
  readLinkToken,
  safeEqual,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth.mjs";
import {
  applyAddedItems,
  applyCategoryMoves,
  applyColors,
  applyMinimums,
  applySampleTrim,
  applyPoloColors,
  applySeedPhotos,
  applySeedSuppliers,
  applySupplierDefaults,
  applySeedTextFixes,
  applySkuFormat,
  applyStockCleared,
  needsAddedItems,
  needsCategoryMoves,
  needsColors,
  needsMinimums,
  needsSampleTrim,
  needsPoloColors,
  needsSeedPhotos,
  needsSeedSuppliers,
  needsSupplierDefaults,
  needsSeedTextFixes,
  needsSkuFormat,
  needsStockCleared,
  normalizeItem,
  publicItem,
  bulkEditCatalog,
  updateStock,
} from "./catalog.mjs";
import { IMAGE_PATH_RE, MAX_IMAGE_BYTES, acceptProductImage } from "./images.mjs";
import { placeRequest, requestsWithStock, settleRequests, withdrawRequest } from "./requests.mjs";
import {
  MAX_BULK_ORDERS,
  accountsFor,
  bulkUpdateOrders,
  cancelOwnOrder,
  csvCell,
  decisionEvent,
  findForwardById,
  forwardItems,
  normalizeAccountEdit,
  ordersToCsv,
  ownsOrder,
  placeOrder,
  pullBackForward,
  requesterView,
  reviewOrder,
  shipForward,
  supplierView,
  trackerToCsv,
  updateOrder,
} from "./orders.mjs";
import {
  INVITE_GONE,
  MAX_PEOPLE,
  acceptInvite,
  addDistributor,
  addPeople,
  applyReadableDistributorCodes,
  credentialOf,
  distributorActivity,
  distributorForCode,
  issueInvite,
  needsReadableDistributorCodes,
  normalizeCode,
  hashPassword,
  passwordProblem,
  personForInvite,
  personForSignIn,
  recordRepSignIn,
  removeDistributor,
  removePerson,
  repKey,
  resetAllCodes,
  setMode,
  setOwnPassword,
  teamReport,
  teamState,
  updateDistributor,
  updatePerson,
} from "./team.mjs";
import { OPEN_STATUSES, STATUSES, byCategory, trackByPerson } from "../public/assets/shared.js";
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
  "/welcome": { file: "welcome.html" },
  "/packing-slip": { file: "packing-slip.html" },
  "/ship": { file: "ship.html" },
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

function readJson(req, limit = MAX_BODY_BYTES) {
  if (!String(req.headers["content-type"] || "").includes("application/json")) {
    return Promise.reject(new ValidationError("Send the request as JSON.", {}, 415));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
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

// A binary upload, refused past `limit` bytes.
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ValidationError("That photo is too large. Try a smaller one.", {}, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
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
export async function createApp({ store, config, notify = () => {}, mailer = null, clock = () => new Date() }) {
  let initial = await store.read();
  if (needsSeedTextFixes(initial)) {
    const changed = await store.mutate((db) => applySeedTextFixes(db));
    console.log(`[catalog] brought ${changed} starter-catalog field(s) up to date`);
    initial = await store.read();
  }
  // Colours before photos: a starter item's photos are tagged with its colours.
  if (needsColors(initial)) {
    const added = await store.mutate((db) => applyColors(db));
    console.log(`[catalog] added colour choices to ${added} item(s)`);
    initial = await store.read();
  }
  if (needsAddedItems(initial)) {
    const added = await store.mutate((db) => applyAddedItems(db));
    for (const item of added) {
      console.log(`[catalog] added ${item.name} (${item.sku}) in ${item.colors.length} colors with ${item.images.length} photos`);
    }
    for (const item of added.removed) console.log(`[catalog] replaced ${item.name} (${item.sku}) with the items above`);
    initial = await store.read();
  }
  if (needsSeedSuppliers(initial)) {
    const changed = await store.mutate((db) => applySeedSuppliers(db));
    console.log(`[catalog] added where-to-order details to ${changed} starter item(s)`);
    initial = await store.read();
  }
  if (needsSupplierDefaults(initial)) {
    const changed = await store.mutate((db) => applySupplierDefaults(db));
    console.log(`[catalog] set Ten 10 Design as the supplier of ${changed} item(s)`);
    initial = await store.read();
  }
  if (needsPoloColors(initial)) {
    const polos = await store.mutate((db) => applyPoloColors(db));
    if (polos.length) console.log(`[catalog] offered ${polos.length} polo(s) in the nine colors: ${polos.join(", ")}`);
    initial = await store.read();
  }
  if (needsSeedPhotos(initial)) {
    const changed = await store.mutate((db) => applySeedPhotos(db));
    console.log(`[catalog] added product photos to ${changed} starter item(s)`);
    initial = await store.read();
  }
  if (needsCategoryMoves(initial)) {
    const moved = await store.mutate((db) => applyCategoryMoves(db));
    console.log(`[catalog] moved ${moved} item(s) into the new categories`);
    initial = await store.read();
  }
  // After the category moves, as the SKU says the category.
  if (needsSkuFormat(initial)) {
    const before = new Map(initial.catalog.map((item) => [item.id, item]));
    const changed = await store.mutate((db) => applySkuFormat(db));
    initial = await store.read();
    const was = (item) => before.get(item.id) ?? {};
    const swaps = initial.catalog.filter((item) => was(item).sku !== item.sku).map((item) => `${was(item).sku || "(none)"} → ${item.sku}`);
    const rebranded = initial.catalog.filter((item) => was(item).brand && was(item).brand !== item.brand).map((item) => `${item.name} (was ${was(item).brand})`);
    const td = initial.catalog.filter((item) => item.brand === "tropical-distillery").map((item) => `${item.sku} ${item.name}`);
    console.log(
      `[catalog] updated ${changed} SKU(s) to brand-category-number (TD for Tropical Distillery, SMP, EVNT)` +
        (swaps.length && swaps.length <= 40 ? `: ${swaps.join(", ")}` : "")
    );
    if (rebranded.length) console.log(`[catalog] moved ${rebranded.length} item(s) to Tropical Distillery: ${rebranded.join(", ")}`);
    console.log(`[catalog] ${td.length} Tropical Distillery item(s): ${td.join(", ")}`);
  }
  if (needsStockCleared(initial)) {
    const cleared = await store.mutate((db) => applyStockCleared(db));
    console.log(`[catalog] set ${cleared} stock level(s) to 0 (items not tracked stay untracked)`);
    initial = await store.read();
  }
  if (needsMinimums(initial)) {
    const raised = await store.mutate((db) => applyMinimums(db));
    console.log(`[catalog] set per-order minimums (${raised} item(s) above one)`);
    initial = await store.read();
  }
  if (needsSampleTrim(initial)) {
    const { removed, limited } = await store.mutate((db) => applySampleTrim(db));
    console.log(`[catalog] took out ${removed.length} sample case(s)${removed.length ? `: ${removed.map((i) => `${i.name} (${i.sku})`).join(", ")}` : ""}`);
    console.log(`[catalog] limited ${limited.length} 750 ml bottle(s) to 4 per order`);
    initial = await store.read();
  }
  const secret = config.sessionSecret || initial.meta.sessionSecret;
  const teamCode = String(config.teamAccessCode || "").trim();
  // No distributor may have the shared team code, or it would sign the team in as reps.
  const reservedCodes = teamCode ? [normalizeCode(teamCode)] : [];
  if (needsReadableDistributorCodes(initial)) {
    const changed = await store.mutate((db) =>
      applyReadableDistributorCodes(db, { at: clock().toISOString(), reserved: reservedCodes })
    );
    console.log(`[team] gave ${changed.length} distributor(s) td- codes: ${changed.map((d) => `${d.name} → ${d.code}`).join(", ")}`);
    initial = await store.read();
  }
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
  // Personal codes start with the person's name, so wrong guesses are also
  // counted per email: nobody can work through one person's possible codes.
  const emailThrottle = config.emailThrottle ?? createThrottle({ max: 10 });

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

  // Who may sign in changes from the admin console, so every request checks
  // it. A short-lived copy keeps that to one store read every few seconds;
  // changes made on this instance clear it at once.
  let access = null;

  async function teamAccess({ fresh = false } = {}) {
    const ttl = config.accessCacheMs ?? 5000;
    if (!fresh && access && Date.now() - access.at < ttl) return access;
    const team = teamState(await store.read());
    access = {
      at: Date.now(),
      mode: team.mode,
      team,
      byId: new Map(team.people.map((p) => [p.id, p])),
      distributors: new Map(team.distributors.map((d) => [d.id, d])),
    };
    return access;
  }

  function accessChanged() {
    access = null;
  }

  function personFingerprint(person) {
    return credentialFingerprint(secret, `person:${person.id}:${credentialOf(person)}`);
  }

  function distributorFingerprint(distributor) {
    return credentialFingerprint(secret, `distributor:${distributor.id}:${distributor.code}`);
  }

  /** The categories a rep may see and order from; null for the team (everything). */
  async function categoriesFor(user) {
    if (!user.distributorId) return null;
    return (await teamAccess()).distributors.get(user.distributorId)?.categories ?? [];
  }

  // Personal sessions carry the person and a fingerprint of their current
  // code or own password, so a reset, a new password or removal ends them,
  // in either mode. Shared-code sessions carry the team code's fingerprint
  // and end when personal codes are switched on. Distributor sessions carry
  // the distributor and its code's fingerprint, whichever mode the team is
  // in: a new code, turning it off or removing the distributor ends them.
  async function teamUser(req) {
    const payload = verifySession(secret, parseCookies(req.headers.cookie)[TEAM_COOKIE]);
    if (!payload || payload.role !== "team") return null;
    const { mode, byId, distributors } = await teamAccess();
    if (payload.did) {
      const distributor = distributors.get(payload.did);
      if (!distributor?.active || payload.fp !== distributorFingerprint(distributor)) return null;
      return { name: payload.name, email: payload.email, distributorId: distributor.id, distributor: distributor.name };
    }
    if (payload.pid) {
      const person = byId.get(payload.pid);
      if (!person || payload.fp !== personFingerprint(person)) return null;
      return { name: person.name || person.email, email: person.email, personId: person.id };
    }
    if (mode === "personal" || !teamFingerprint || payload.fp !== teamFingerprint) return null;
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
    const { mode, team } = await teamAccess({ fresh: true });
    if (mode === "shared" && !teamCode && !team.distributors.some((d) => d.active) && !team.people.length) {
      throw new ValidationError("The store isn't set up yet — TEAM_ACCESS_CODE has not been configured.", {}, 503);
    }
    const address = clientAddress(req);
    if (signInBlocked(address)) {
      throw new ValidationError("Too many sign-in attempts. Wait 15 minutes and try again.", {}, 429);
    }
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const errors = {};
    if (!isValidEmail(email)) errors.email = "Enter your email address.";

    let session;
    // A distributor's code works in either mode, with the rep's own name and
    // any email.
    const distributor = distributorForCode(team, body.code, safeEqual);
    if (distributor) {
      const name = cleanLine(body.name, 80);
      if (!name) errors.name = "Enter your name so the merch team knows who's ordering.";
      if (Object.keys(errors).length) {
        const message = errors.email ? "Some details need attention." : "That's a distributor code: add your name too.";
        throw new ValidationError(message, errors);
      }
      session = { did: distributor.id, name, email, distributor: distributor.name, fp: distributorFingerprint(distributor) };
    } else {
      if (!String(body.code ?? "").trim()) {
        errors.code = mode === "personal" ? "Enter your password or code." : "Enter the team code.";
      }
      if (errors.email || errors.code) throw new ValidationError("Some details need attention.", errors);
      if (emailThrottle.blocked(email)) {
        throw new ValidationError("Too many wrong tries for this email. Wait 15 minutes and try again.", {}, 429);
      }
      const failed = async (message, field = "code") => {
        signInFailed(address);
        emailThrottle.fail(email);
        await delay(config.failureDelayMs ?? 400);
        return new ValidationError(message, { [field]: message }, 401);
      };
      // Anyone on the team list signs in with their own password or code,
      // whichever mode; the shared code works too until personal codes are on.
      const person = await personForSignIn(team, email, body.code, safeEqual);
      if (person) {
        session = personSession(person);
      } else if (mode === "personal") {
        throw await failed("That email and password or code don't match. Check them, or ask the merch admin for a new invite.");
      } else {
        const name = cleanLine(body.name, 80);
        if (!name) errors.name = "Enter your name.";
        if (!errors.email && domains.length && !domains.some((domain) => email.endsWith(`@${domain}`))) {
          errors.email = `Use your ${domains.map((d) => `@${d}`).join(" or ")} email address.`;
        }
        const code = String(body.code ?? "").trim().toLowerCase();
        if (!teamCode || !safeEqual(code, teamCode.toLowerCase())) {
          throw await failed(team.people.length ? "That isn't the team code or your password." : "That team code isn't right.");
        }
        if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);
        session = { name, email, fp: teamFingerprint };
      }
    }

    // Remember the sign-in, for the admin's team report. Reps are kept apart,
    // per distributor, with a log of each sign-in.
    const at = clock().toISOString();
    await store.mutate((db) => {
      if (session.did) recordRepSignIn(db, distributor, { name: session.name, email: session.email, at });
      else db.members[session.email] = { ...db.members[session.email], name: session.name, lastSignInAt: at };
    });

    const user = { name: session.name, email: session.email, ...(session.did ? { distributor: session.distributor } : {}) };
    sendJson(res, 200, { ok: true, user }, { "Set-Cookie": teamSessionCookie(req, session) });
  }

  function personSession(person) {
    return { pid: person.id, name: person.name || person.email, email: person.email, fp: personFingerprint(person) };
  }

  function teamSessionCookie(req, session) {
    const maxAgeSeconds = TEAM_SESSION_DAYS * 24 * 60 * 60;
    const token = signSession(secret, { role: "team", ...session, exp: Date.now() + maxAgeSeconds * 1000 });
    return sessionCookie(TEAM_COOKIE, token, { maxAgeSeconds, secure: secureCookies(req) });
  }

  // Someone signed in with a personal code choosing their own password. Their
  // other devices are signed out; this one gets a fresh session.
  async function changeOwnPassword({ req, res, user }) {
    if (user.distributorId) {
      throw new ValidationError("You sign in with your distributor's code, so there's no code of your own to change.", {}, 409);
    }
    if (!user.personId) {
      throw new ValidationError(
        "Everyone signs in with the shared team code for now, so there's no password of your own to change. The merch admin can switch on personal codes.",
        {},
        409
      );
    }
    const address = clientAddress(req);
    if (signInBlocked(address) || emailThrottle.blocked(user.email)) {
      throw new ValidationError("Too many wrong tries. Wait 15 minutes and try again.", {}, 429);
    }
    const body = await readJson(req);
    const { team } = await teamAccess({ fresh: true });
    const person = team.people.find((p) => p.id === user.personId);
    if (!person) throw new ValidationError("You're no longer on the team list. Ask the merch admin.", {}, 403);

    const errors = {};
    if (!String(body.current ?? "")) errors.current = "Enter your current code or password.";
    const problem = passwordProblem(body.password, person);
    if (problem) errors.password = problem;
    if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

    if (!(await personForSignIn(team, person.email, body.current, safeEqual))) {
      signInFailed(address);
      emailThrottle.fail(person.email);
      await delay(config.failureDelayMs ?? 400);
      // Not 401: that would read as the session ending and sign them out.
      const message = "That isn't your current code or password.";
      throw new ValidationError(message, { current: message }, 400);
    }

    const hash = await hashPassword(body.password);
    const updated = await store.mutate((db) =>
      setOwnPassword(db, person.id, { hash, was: credentialOf(person) }, { at: clock().toISOString() })
    );
    accessChanged();
    sendJson(res, 200, { ok: true }, { "Set-Cookie": teamSessionCookie(req, personSession(updated)) });
  }

  /* -------------------------------------------------------------- invites */

  // Where invite links point: PUBLIC_URL, or else the site the admin is on.
  function siteUrl(req) {
    if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");
    return `${secureCookies(req) ? "https" : "http"}://${req.headers.host}`;
  }

  // A supplier's page for one forward. The token rides in the address's
  // #fragment, so it never reaches the server's logs or another site; the
  // page sends it back in the body of its requests.
  function shipLink(req, forward) {
    return `${siteUrl(req)}/ship#${linkToken(secret, "ship", forward.id)}`;
  }

  async function forwardForToken(body) {
    const id = readLinkToken(secret, "ship", body?.token);
    const found = id ? findForwardById(await store.read(), id) : null;
    if (!found) throw new ValidationError("This link doesn't work. Use the link in the latest email from the Tropical Distillery merch team.", {}, 404);
    return found;
  }

  /** New invite links for these people, emailed to them when email is on. */
  async function sendInvites(req, ids, by) {
    const at = clock().toISOString();
    const wanted = new Set(ids);
    const issued = await store.mutate((db) =>
      teamState(db).people.filter((p) => wanted.has(p.id)).map((p) => issueInvite(db, p.id, { by, at }))
    );
    const site = siteUrl(req);
    return issued.map(({ person, token }) => {
      const link = `${site}/welcome?invite=${token}`;
      // keyed by the token's hash, so the token itself goes nowhere but the email
      if (mailer?.enabled) mailer.invite(person, { link, by, key: person.invite.tokenHash.slice(0, 16) });
      return { id: person.id, name: person.name, email: person.email, link };
    });
  }

  async function invitee(token) {
    const person = personForInvite((await teamAccess({ fresh: true })).team, token, clock());
    if (!person) throw new ValidationError(INVITE_GONE, {}, 410);
    return person;
  }

  // From an invite link: choose a password and be signed in.
  async function acceptOwnInvite({ req, res }) {
    const address = clientAddress(req);
    if (signInBlocked(address)) {
      throw new ValidationError("Too many tries. Wait 15 minutes and try again.", {}, 429);
    }
    const body = await readJson(req);
    let person;
    try {
      person = await invitee(body.token);
    } catch (error) {
      signInFailed(address);
      throw error;
    }
    const problem = passwordProblem(body.password, person);
    if (problem) throw new ValidationError("Choose a different password.", { password: problem });
    const hash = await hashPassword(body.password);
    const now = clock();
    const updated = await store.mutate((db) => {
      const accepted = acceptInvite(db, body.token, { hash, now });
      db.members[accepted.email] = { ...db.members[accepted.email], name: accepted.name, lastSignInAt: now.toISOString() };
      return accepted;
    });
    accessChanged();
    const session = personSession(updated);
    sendJson(res, 200, { ok: true, user: { name: session.name, email: session.email } }, {
      "Set-Cookie": teamSessionCookie(req, session),
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

    ["GET", "/api/config", "public", async ({ res }) => {
      const { mode, team } = await teamAccess();
      const distributorSignIn = team.distributors.some((d) => d.active);
      sendJson(res, 200, {
        ok: true,
        signInMode: mode,
        teamSignIn: mode === "personal" || Boolean(teamCode) || distributorSignIn || team.people.length > 0,
        distributorSignIn,
        // People on the team list can use a password of their own in either mode.
        accounts: team.people.length > 0,
        adminSignIn: Boolean(adminPassword),
        emailDomains: mode === "personal" ? [] : domains,
      });
    }],

    // Invites: who a link is for, and choosing a password from it
    ["GET", "/api/invite", "public", async ({ res, url }) => {
      const person = await invitee(url.searchParams.get("invite"));
      sendJson(res, 200, { ok: true, name: person.name, email: person.email, reset: Boolean(person.passwordSetAt) });
    }],
    ["POST", "/api/invite", "public", acceptOwnInvite],

    // Team session
    ["POST", "/api/session", "public", teamSignIn],
    ["GET", "/api/session", "team", async ({ res, user }) => sendJson(res, 200, { ok: true, user })],
    ["DELETE", "/api/session", "public", async ({ req, res }) =>
      sendJson(res, 200, { ok: true }, { "Set-Cookie": clearedCookie(TEAM_COOKIE, { secure: secureCookies(req) }) })],

    // Store
    ["GET", "/api/catalog", "team", async ({ res, user }) => {
      const db = await store.read();
      const categories = await categoriesFor(user);
      const shown = db.catalog.filter((item) => item.active && (!categories || categories.includes(item.category)));
      sendJson(res, 200, { ok: true, items: byCategory(shown).map(publicItem) });
    }],

    ["POST", "/api/me/password", "team", changeOwnPassword],

    ["GET", "/api/me", "team", async ({ res, user }) => {
      const db = await store.read();
      const saved = user.distributorId ? db.reps?.[repKey(user.distributorId, user.email)] : db.members[user.email];
      sendJson(res, 200, { ok: true, user, address: saved?.address ?? null });
    }],

    ["GET", "/api/accounts", "team", async ({ res, user }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, accounts: accountsFor(db, user.distributorId).map(publicAccount).sort(byName) });
    }],

    ["GET", "/api/orders", "team", async ({ res, user }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, orders: db.orders.filter((o) => ownsOrder(o, user)).reverse().map(requesterView) });
    }],

    ["POST", "/api/orders", "team", async ({ req, res, user }) => {
      const body = await readJson(req);
      const categories = await categoriesFor(user);
      const order = await store.mutate((db) =>
        placeOrder(db, body, { requester: user, categories, now: clock(), timeZone, prefix: orderPrefix })
      );
      notify("order.created", order);
      sendJson(res, 201, { ok: true, order: requesterView(order) });
    }],

    ["POST", /^\/api\/orders\/([\w-]+)\/cancel$/, "team", async ({ res, user, params }) => {
      const order = await store.mutate((db) =>
        cancelOwnOrder(db, params[0], {
          email: user.email,
          name: user.name,
          personId: user.personId,
          distributorId: user.distributorId,
          now: clock(),
        })
      );
      notify("order.cancelled", order, { byRequester: true });
      sendJson(res, 200, { ok: true, order: requesterView(order) });
    }],

    // Requests for out-of-stock items
    ["GET", "/api/requests", "team", async ({ res, user }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, requests: (db.requests ?? []).filter((r) => ownsOrder(r, user)).reverse() });
    }],

    ["POST", "/api/requests", "team", async ({ req, res, user }) => {
      const body = await readJson(req);
      const categories = await categoriesFor(user);
      const { request, updated } = await store.mutate((db) => placeRequest(db, body, { requester: user, categories, now: clock() }));
      if (!updated) mailer?.request?.("request.created", request);
      sendJson(res, updated ? 200 : 201, { ok: true, request, updated });
    }],

    ["POST", /^\/api\/requests\/([\w-]+)\/withdraw$/, "team", async ({ res, user, params }) => {
      const request = await store.mutate((db) => withdrawRequest(db, params[0], { requester: user, now: clock() }));
      sendJson(res, 200, { ok: true, request });
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

    // By status, or the orders picked in the console (?ids=a,b,c).
    ["GET", "/api/admin/orders.csv", "admin", async ({ res, url }) => {
      const db = await store.read();
      const ids = url.searchParams.get("ids");
      let orders;
      if (ids) {
        const picked = new Set(ids.split(",").slice(0, MAX_BULK_ORDERS));
        orders = db.orders.filter((o) => picked.has(o.id));
      } else {
        const wanted = (url.searchParams.get("status") || "all").split(",");
        const statuses = wanted.includes("all")
          ? null
          : wanted.flatMap((s) => (s === "open" ? OPEN_STATUSES : STATUSES.some((x) => x.id === s) ? [s] : []));
        orders = db.orders.filter((o) => !statuses || statuses.includes(o.status));
      }
      const stamp = clock().toISOString().slice(0, 10);
      send(res, 200, ordersToCsv(orders), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tropical-merch-orders-${stamp}.csv"`,
        "Cache-Control": "no-store",
      });
    }],

    // One status change or internal note for many orders at once.
    ["POST", "/api/admin/orders/bulk", "admin", async ({ req, res, admin }) => {
      const body = await readJson(req);
      const { updated, skipped, cancelledForwards = [] } = await store.mutate((db) =>
        bulkUpdateOrders(db, body, { actor: admin.name, now: clock() })
      );
      if (body.action !== "note") for (const order of updated) notify(`order.${order.status}`, order);
      for (const { order, forward } of cancelledForwards) notify("forward.cancelled", order, { forward });
      sendJson(res, 200, { ok: true, orders: updated, skipped });
    }],

    // What each person has ordered, one row per person and item, for the
    // period the tracker shows (?from= and ?to=, ISO times; to is exclusive).
    ["GET", "/api/admin/tracker.csv", "admin", async ({ res, url }) => {
      const db = await store.read();
      const time = (name) => {
        const t = Date.parse(url.searchParams.get(name) || "");
        return Number.isNaN(t) ? "" : new Date(t).toISOString();
      };
      const rows = trackByPerson(db.orders, { from: time("from"), to: time("to"), people: teamState(db).people });
      const stamp = clock().toISOString().slice(0, 10);
      send(res, 200, trackerToCsv(rows), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tropical-merch-by-person-${stamp}.csv"`,
        "Cache-Control": "no-store",
      });
    }],

    ["GET", /^\/api\/admin\/orders\/([\w-]+)$/, "admin", async ({ res, params }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, order: find(db.orders, params[0], "order") });
    }],

    // A status change, tracking added or corrected after shipping (the
    // requester is emailed it unless `notify` is false) or the internal note.
    ["PATCH", /^\/api\/admin\/orders\/([\w-]+)$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, statusChanged, trackingAdded, cancelledForwards } = await store.mutate((db) =>
        updateOrder(db, params[0], body, { actor: admin.name, now: clock() })
      );
      if (statusChanged) notify(`order.${order.status}`, order);
      else if (trackingAdded && body.notify !== false) notify("order.tracking", order);
      // Whoever had forwarded items is told not to ship them.
      for (const forward of cancelledForwards) notify("forward.cancelled", order, { forward });
      sendJson(res, 200, { ok: true, order });
    }],

    // Forward some items to someone else to ship. They're emailed the items
    // and the address unless `notify` is false.
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/forwards$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, forward } = await store.mutate((db) => forwardItems(db, params[0], body, { actor: admin.name, now: clock() }));
      const emailed = body.notify !== false;
      if (emailed) notify("forward.sent", order, { forward, shipLink: shipLink(req, forward) });
      sendJson(res, 201, { ok: true, order, forward, emailed });
    }],

    // A forward shipped, or its tracking was added later: the requester is
    // emailed unless `notify` is false.
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/forwards\/([\w-]+)\/ship$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, forward, event } = await store.mutate((db) =>
        shipForward(db, params[0], params[1], body, { actor: admin.name, now: clock() })
      );
      if (event && body.notify !== false) notify(event, order, { forward });
      sendJson(res, 200, { ok: true, order, forward, emailed: Boolean(event) && body.notify !== false });
    }],

    // Take a forward back to ship in-house; whoever had it is told not to
    // ship it unless `notify` is false.
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/forwards\/([\w-]+)\/pull-back$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, forward } = await store.mutate((db) => pullBackForward(db, params[0], params[1], { actor: admin.name, now: clock() }));
      if (body.notify !== false) notify("forward.cancelled", order, { forward });
      sendJson(res, 200, { ok: true, order, forward, emailed: body.notify !== false });
    }],

    // Email the forward to whoever has it again.
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/forwards\/([\w-]+)\/notify$/, "admin", async ({ req, res, params }) => {
      const db = await store.read();
      const order = find(db.orders, params[0], "order");
      const forward = (order.forwards ?? []).find((f) => f.id === params[1]);
      if (!forward) throw new ValidationError("That forward could not be found.", {}, 404);
      if (forward.status !== "sent") throw new ValidationError("Only a forward that hasn't shipped can be sent again.", {}, 409);
      notify("forward.sent", order, { forward, shipLink: shipLink(req, forward), resend: String(clock().getTime()) });
      sendJson(res, 200, { ok: true, order, forward });
    }],

    // The supplier's shipping link, for the admin to pass on another way.
    ["GET", /^\/api\/admin\/orders\/([\w-]+)\/forwards\/([\w-]+)\/link$/, "admin", async ({ req, res, params }) => {
      const db = await store.read();
      const order = find(db.orders, params[0], "order");
      const forward = (order.forwards ?? []).find((f) => f.id === params[1]);
      if (!forward) throw new ValidationError("That forward could not be found.", {}, 404);
      sendJson(res, 200, { ok: true, url: shipLink(req, forward) }, { "Cache-Control": "no-store" });
    }],

    // Suppliers: their items and where they go, from the link they were
    // emailed, and marking them shipped with the tracking number. The
    // requester is emailed, and so are the admins, so they know.
    ["POST", "/api/ship/view", "public", async ({ req, res }) => {
      const { order, forward } = await forwardForToken(await readJson(req));
      sendJson(res, 200, { ok: true, ...supplierView(order, forward) }, { "Cache-Control": "no-store" });
    }],

    ["POST", "/api/ship", "public", async ({ req, res }) => {
      const body = await readJson(req);
      const found = await forwardForToken(body);
      if (!supplierView(found.order, found.forward).canUpdate) {
        throw new ValidationError("This order is closed, so it can't be changed here. Reply to the merch team's email instead.", {}, 409);
      }
      const { order, forward, event } = await store.mutate((db) =>
        shipForward(db, found.order.id, found.forward.id, { carrier: body.carrier, trackingNumber: body.trackingNumber }, {
          actor: found.forward.to.name,
          now: clock(),
          requireCarrier: true,
        })
      );
      if (event) notify(event, order, { forward, bySupplier: true });
      sendJson(res, 200, { ok: true, ...supplierView(order, forward) }, { "Cache-Control": "no-store" });
    }],

    // Approve or deny each item. The requester is emailed the outcome unless
    // `notify` is false; it can be sent (again) later with /notify.
    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/review$/, "admin", async ({ req, res, admin, params }) => {
      const body = await readJson(req);
      const { order, event } = await store.mutate((db) => reviewOrder(db, params[0], body, { actor: admin.name, now: clock() }));
      const emailed = body.notify !== false;
      if (emailed) notify(event, order);
      sendJson(res, 200, { ok: true, order, emailed });
    }],

    ["POST", /^\/api\/admin\/orders\/([\w-]+)\/notify$/, "admin", async ({ res, params }) => {
      const db = await store.read();
      const order = find(db.orders, params[0], "order");
      const event = decisionEvent(order);
      if (!event) throw new ValidationError("There's no decision to send for this order.", {}, 409);
      notify(event, order, { resend: String(clock().getTime()) });
      sendJson(res, 200, { ok: true, order, event });
    }],

    // Admin: requests for out-of-stock items, with the stock each has now
    ["GET", "/api/admin/requests", "admin", async ({ res }) => {
      sendJson(res, 200, { ok: true, requests: requestsWithStock(await store.read()) });
    }],

    // Back in stock (each requester is emailed) or closed, for one or many.
    ["POST", "/api/admin/requests/settle", "admin", async ({ req, res, admin }) => {
      const body = await readJson(req);
      const updated = await store.mutate((db) => settleRequests(db, body, { actor: admin.name, now: clock() }));
      for (const request of updated) mailer?.request?.(`request.${request.status}`, request);
      sendJson(res, 200, { ok: true, requests: updated });
    }],

    // Admin: catalog
    ["GET", "/api/admin/catalog", "admin", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, items: byCategory(db.catalog) });
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

    // Many items' details and stock at once, from the bulk editor.
    ["POST", "/api/admin/catalog/bulk", "admin", async ({ req, res }) => {
      // Room for every item's description at once.
      const body = await readJson(req, 1024 * 1024);
      const result = await store.mutate((db) => bulkEditCatalog(db, body));
      sendJson(res, 200, { ok: true, ...result });
    }],

    // Many stock levels at once, from the stock editor.
    ["POST", "/api/admin/catalog/stock", "admin", async ({ req, res }) => {
      const body = await readJson(req);
      const result = await store.mutate((db) => updateStock(db, body));
      sendJson(res, 200, { ok: true, ...result });
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

    // Deleting an item leaves past orders as they are: each order line keeps
    // its own copy of the item's name, SKU and cost.
    ["DELETE", /^\/api\/admin\/catalog\/([\w-]+)$/, "admin", async ({ res, params }) => {
      const removed = await store.mutate((db) => {
        const existing = find(db.catalog, params[0], "item");
        db.catalog.splice(db.catalog.indexOf(existing), 1);
        return existing;
      });
      sendJson(res, 200, { ok: true, removed: { id: removed.id, name: removed.name } });
    }],

    // Admin: team list and personal codes
    ["GET", "/api/admin/team", "admin", async ({ res }) => {
      const db = await store.read();
      sendJson(res, 200, { ok: true, ...teamReport(db, { now: clock() }), inviteEmail: Boolean(mailer?.enabled) });
    }],

    // invite: true also sends each new person an invite to create a password.
    ["POST", "/api/admin/team", "admin", async ({ req, res, admin }) => {
      const body = await readJson(req);
      const result = await store.mutate((db) =>
        addPeople(db, body.entries, { by: admin.name, at: clock().toISOString() })
      );
      accessChanged();
      const invites = body.invite === true ? await sendInvites(req, result.added.map((p) => p.id), admin.name) : [];
      sendJson(res, 200, {
        ok: true,
        added: result.added.map(({ id, name, email, code }) => ({ id, name, email, code })),
        already: result.already,
        invalid: result.invalid,
        invites,
        emailed: Boolean(mailer?.enabled),
      });
    }],

    // Invites for these people ({ ids }), or everyone without a password yet
    // ({ notSetUp: true }). A new invite replaces any earlier link.
    ["POST", "/api/admin/team/invite", "admin", async ({ req, res, admin }) => {
      const body = await readJson(req);
      const { people } = teamState(await store.read());
      const ids =
        body.notSetUp === true
          ? people.filter((p) => !p.passwordSetAt).map((p) => p.id)
          : Array.isArray(body.ids)
            ? body.ids.slice(0, MAX_PEOPLE).map(String)
            : [];
      if (!ids.length) throw new ValidationError(body.notSetUp ? "Everyone on the list has a password already." : "Choose who to invite.", {});
      const invites = await sendInvites(req, ids, admin.name);
      if (!invites.length) throw new ValidationError("Those people aren't on the team list.", {}, 404);
      sendJson(res, 200, { ok: true, invites, emailed: Boolean(mailer?.enabled) });
    }],

    // Everyone gets a new code at once; their old codes stop working.
    ["POST", "/api/admin/team/reset-codes", "admin", async ({ res }) => {
      const people = await store.mutate((db) => resetAllCodes(db, { at: clock().toISOString() }));
      accessChanged();
      sendJson(res, 200, { ok: true, people: people.map(({ id, name, email, code }) => ({ id, name, email, code })) });
    }],

    ["PUT", "/api/admin/team/mode", "admin", async ({ req, res }) => {
      const body = await readJson(req);
      const team = await store.mutate((db) => setMode(db, cleanLine(body.mode, 20)));
      accessChanged();
      sendJson(res, 200, { ok: true, mode: team.mode });
    }],

    // Admin: distributor codes, shared by each distributor's reps
    ["POST", "/api/admin/distributors", "admin", async ({ req, res, admin }) => {
      const body = await readJson(req);
      const distributor = await store.mutate((db) =>
        addDistributor(db, body, { by: admin.name, at: clock().toISOString(), reserved: reservedCodes })
      );
      accessChanged();
      sendJson(res, 201, { ok: true, distributor });
    }],

    ["PATCH", /^\/api\/admin\/distributors\/([\w-]+)$/, "admin", async ({ req, res, params }) => {
      const body = await readJson(req);
      const distributor = await store.mutate((db) =>
        updateDistributor(db, params[0], body, { at: clock().toISOString(), reserved: reservedCodes })
      );
      accessChanged();
      sendJson(res, 200, { ok: true, distributor });
    }],

    // Who has signed in with a distributor's code, and when.
    ["GET", /^\/api\/admin\/distributors\/([\w-]+)\/activity$/, "admin", async ({ res, params }) => {
      const db = await store.read();
      if (!teamState(db).distributors.some((d) => d.id === params[0])) {
        throw new ValidationError("That distributor could not be found.", {}, 404);
      }
      sendJson(res, 200, { ok: true, ...distributorActivity(db, params[0]) });
    }],

    // The same as a spreadsheet, to send the distributor: every rep, then each sign-in.
    ["GET", /^\/api\/admin\/distributors\/([\w-]+)\/sign-ins\.csv$/, "admin", async ({ res, params }) => {
      const db = await store.read();
      const distributor = teamState(db).distributors.find((d) => d.id === params[0]);
      if (!distributor) throw new ValidationError("That distributor could not be found.", {}, 404);
      const { reps, signIns } = distributorActivity(db, distributor.id);
      const rows = [["signed_in_at", "name", "email", "distributor", "first_sign_in", "sign_ins", "orders", "order_value"].join(",")];
      const byEmail = new Map(reps.map((r) => [r.email, r]));
      const line = (at, name, email) => {
        const rep = byEmail.get(email) ?? {};
        return [at, name, email, distributor.name, rep.firstSignInAt ?? "", rep.signIns ?? "", rep.orders ?? "", ((rep.valueCents ?? 0) / 100).toFixed(2)];
      };
      // Every sign-in still in the log, and a row for any rep whose sign-ins
      // are all older than it.
      const logged = new Set(signIns.map((e) => e.email));
      for (const e of signIns) rows.push(line(e.at, e.name, e.email).map(csvCell).join(","));
      for (const r of reps.filter((r) => !logged.has(r.email))) rows.push(line(r.lastSignInAt ?? "", r.name, r.email).map(csvCell).join(","));
      const slug = distributor.code.replace(/[^a-z0-9-]/g, "");
      send(res, 200, rows.join("\r\n") + "\r\n", {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-sign-ins-${clock().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      });
    }],

    ["DELETE", /^\/api\/admin\/distributors\/([\w-]+)$/, "admin", async ({ res, params }) => {
      await store.mutate((db) => removeDistributor(db, params[0]));
      accessChanged();
      sendJson(res, 200, { ok: true });
    }],

    ["GET", "/api/admin/team.csv", "admin", async ({ res }) => {
      const { people } = teamState(await store.read());
      const rows = [["name", "email", "personal_code", "sign_in_link", "own_password_since"].join(",")];
      const site = (config.publicUrl || "").replace(/\/$/, "");
      for (const p of people) {
        rows.push([p.name, p.email, p.code ?? "", site || "", p.passwordSetAt ?? ""].map(csvCell).join(","));
      }
      send(res, 200, rows.join("\r\n") + "\r\n", {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tropical-merch-team-codes.csv"',
        "Cache-Control": "no-store",
      });
    }],

    ["GET", /^\/api\/admin\/team\/([\w-]+)\/code$/, "admin", async ({ res, params }) => {
      const person = teamState(await store.read()).people.find((p) => p.id === params[0]);
      if (!person) throw new ValidationError("That person isn't on the team list.", {}, 404);
      sendJson(res, 200, { ok: true, code: person.code ?? null, ownPasswordSetAt: person.passwordSetAt ?? null });
    }],

    ["PATCH", /^\/api\/admin\/team\/([\w-]+)$/, "admin", async ({ req, res, params }) => {
      const body = await readJson(req);
      const person = await store.mutate((db) => updatePerson(db, params[0], body, { at: clock().toISOString() }));
      accessChanged();
      const { id, name, email, codeSetAt } = person;
      sendJson(res, 200, { ok: true, person: { id, name, email, codeSetAt, ...(body.resetCode === true ? { code: person.code } : {}) } });
    }],

    ["DELETE", /^\/api\/admin\/team\/([\w-]+)$/, "admin", async ({ res, params }) => {
      await store.mutate((db) => removePerson(db, params[0]));
      accessChanged();
      sendJson(res, 200, { ok: true });
    }],

    // Admin: product photos, already resized in the browser
    ["POST", "/api/admin/images", "admin", async ({ req, res }) => {
      const bytes = await readRaw(req, MAX_IMAGE_BYTES);
      const image = acceptProductImage(bytes);
      await store.putImage({ id: image.id, ext: image.ext, bytes });
      sendJson(res, 201, { ok: true, url: image.url });
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
      ctx.user = await teamUser(req);
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

  async function servePage(req, res, url) {
    const page = PAGES[url.pathname];
    if (page.team && !(await teamUser(req))) {
      return redirect(res, `/?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    if (url.pathname === "/" && (await teamUser(req))) {
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

      if (Object.hasOwn(PAGES, url.pathname)) return await servePage(req, res, url);

      const photo = IMAGE_PATH_RE.exec(url.pathname);
      if (photo) {
        const bytes = await store.getImage(photo[1], photo[2]);
        if (bytes) {
          // Named by content hash, so a given URL never changes.
          return send(res, 200, req.method === "HEAD" ? "" : bytes, {
            "Content-Type": { webp: "image/webp", jpg: "image/jpeg", png: "image/png" }[photo[2]],
            "Content-Length": bytes.length,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
        }
      }

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
