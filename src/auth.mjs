// Signed session cookies and sign-in throttling.
//
// A session is `base64url(json).base64url(hmac)`. The payload carries a short
// fingerprint of the credential it was issued against, so changing
// TEAM_ACCESS_CODE or ADMIN_PASSWORD signs out every session issued under the
// old value — that is how someone leaving the team is locked out.

import { createHmac, timingSafeEqual } from "node:crypto";

export const TEAM_COOKIE = "tdm_team";
export const ADMIN_COOKIE = "tdm_admin";
export const TEAM_SESSION_DAYS = 30;
export const ADMIN_SESSION_HOURS = 12;

function hmac(secret, text) {
  return createHmac("sha256", secret).update(text).digest("base64url");
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function credentialFingerprint(secret, credential) {
  return hmac(secret, `credential:${credential}`).slice(0, 12);
}

export function signSession(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

/** Returns the payload, or null for anything forged, malformed or expired. */
export function verifySession(secret, token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || !(payload.exp > now)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function sessionCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    // Lax so a link from Slack or email lands signed in. Forgery is handled
    // by the custom header every mutating API call must carry (see app.mjs).
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(name, { secure }) {
  return sessionCookie(name, "", { maxAgeSeconds: 0, secure });
}

/**
 * Failed sign-ins allowed per client address per window. Successful sign-ins
 * are not counted, so a team behind one office address is not locked out by
 * its own use.
 */
export function createThrottle({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();

  function recent(key, now) {
    return (failures.get(key) || []).filter((t) => now - t < windowMs);
  }

  return {
    blocked(key, now = Date.now()) {
      return recent(key, now).length >= max;
    },
    fail(key, now = Date.now()) {
      const list = recent(key, now);
      list.push(now);
      failures.set(key, list);
      if (failures.size > 5000) {
        for (const [k, times] of failures) {
          if (!times.some((t) => now - t < windowMs)) failures.delete(k);
        }
      }
    },
  };
}
