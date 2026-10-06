// The team list and personal sign-in codes.
//
// Two ways to sign in, chosen in the admin console:
//   shared   — everyone uses TEAM_ACCESS_CODE and types their own name and
//              email (the original behaviour)
//   personal — each person on the team list has their own code; who placed
//              an order is then known, not self-declared
//
// Codes are kept so the admin can look one up again when someone forgets it;
// whoever can read the store can already read every order and address, so
// hashing them would protect nothing extra while making the admin's job
// harder. They are only ever sent to the admin console, one at a time or in
// the codes download.

import { randomInt, randomUUID } from "node:crypto";

import { RELEASED_STATUSES } from "../public/assets/shared.js";
import { ValidationError, cleanLine, isValidEmail, normalizeEmail } from "./validation.mjs";

export const MODES = ["shared", "personal"];
export const MAX_PEOPLE = 1000;

// Codes are easy to remember: "tropical", the person's first name and a
// four-digit number, like tropical-jane-4821. That leaves 9,000 possible codes
// for each name; sign-in throttling, per address and per email, keeps guessing
// one impractical, and every order still needs the admin's approval.

/** The first name, as plain lowercase letters, to start someone's code. */
function codeName(name, email) {
  const plain = (text) =>
    String(text ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const first = plain(name).split(/[^a-z]+/).find((part) => part.length >= 2);
  const fromEmail = plain(String(email ?? "").split("@")[0]).split(/[^a-z]+/).find((part) => part.length >= 2);
  return (first || fromEmail || "team").slice(0, 12);
}

export function generateCode(taken = new Set(), { name = "", email = "" } = {}) {
  const who = codeName(name, email);
  for (;;) {
    const code = `tropical-${who}-${randomInt(1000, 10000)}`;
    if (!taken.has(code)) return code;
  }
}

/** Forgive capitals, spaces or underscores for hyphens, and stray punctuation. */
export function normalizeCode(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function teamState(db) {
  return db.team ?? { mode: "shared", people: [] };
}

function ensureTeam(db) {
  db.team ??= { mode: "shared", people: [] };
  return db.team;
}

/* ------------------------------------------------------------- the list */

/**
 * One person per line, in whichever of these shapes is handy to paste:
 *   jane@tropicaldistillery.com
 *   Jane Rep, jane@tropicaldistillery.com      (or tab-separated, from a sheet)
 *   jane@tropicaldistillery.com, Jane Rep
 *   Jane Rep <jane@tropicaldistillery.com>
 */
export function parseTeamEntries(text) {
  const entries = [];
  const invalid = [];
  const seen = new Set();
  const lines = String(text ?? "").split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_PEOPLE) {
    throw new ValidationError(`Add at most ${MAX_PEOPLE} people at a time.`, { entries: "That's too many lines." });
  }
  for (const line of lines) {
    let name = "";
    let email = "";
    const angle = /^(.*)<([^>]+)>\s*$/.exec(line);
    if (angle) {
      name = angle[1];
      email = angle[2];
    } else {
      const parts = line.split(/[,\t]/).map((p) => p.trim()).filter(Boolean);
      const at = parts.findIndex((p) => p.includes("@"));
      if (at >= 0) {
        email = parts[at];
        name = parts.filter((_, i) => i !== at).join(" ");
      }
    }
    email = normalizeEmail(email);
    name = cleanLine(name.replace(/^["']|["']$/g, ""), 80);
    if (!isValidEmail(email)) {
      invalid.push(cleanLine(line, 120));
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    entries.push({ name, email });
  }
  return { entries, invalid };
}

/** Add people to the list, each with a fresh code. Existing emails are skipped. */
export function addPeople(db, text, { by, at }) {
  const team = ensureTeam(db);
  const { entries, invalid } = parseTeamEntries(text);
  if (!entries.length && !invalid.length) {
    throw new ValidationError("Add at least one email address.", { entries: "Add at least one email address." });
  }
  if (team.people.length + entries.length > MAX_PEOPLE) {
    throw new ValidationError(`The team list holds at most ${MAX_PEOPLE} people.`, {});
  }

  const taken = new Set(team.people.map((p) => p.code));
  const added = [];
  const already = [];
  for (const { name, email } of entries) {
    if (team.people.some((p) => p.email === email)) {
      already.push(email);
      continue;
    }
    const personName = name || db.members?.[email]?.name || "";
    const code = generateCode(taken, { name: personName, email });
    taken.add(code);
    const person = {
      id: randomUUID(),
      name: personName,
      email,
      code,
      codeSetAt: at,
      addedAt: at,
      addedBy: by,
    };
    team.people.push(person);
    added.push(person);
  }
  return { added, already, invalid };
}

function findPerson(team, id) {
  const person = team.people.find((p) => p.id === id);
  if (!person) throw new ValidationError("That person isn't on the team list.", {}, 404);
  return person;
}

/** Rename, change email, or issue a new code (which signs the old one out). */
export function updatePerson(db, id, patch, { at }) {
  const team = ensureTeam(db);
  const person = findPerson(team, id);
  const src = patch && typeof patch === "object" ? patch : {};
  const errors = {};

  if ("email" in src) {
    const email = normalizeEmail(src.email);
    if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    else if (team.people.some((p) => p.id !== id && p.email === email)) errors.email = "Someone else on the list has that email.";
    else person.email = email;
  }
  if ("name" in src) person.name = cleanLine(src.name, 80);
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  if (src.resetCode === true) {
    person.code = generateCode(new Set(team.people.map((p) => p.code)), person);
    person.codeSetAt = at;
  }
  return person;
}

/** A new code for everyone on the list, e.g. after changing the code style. */
export function resetAllCodes(db, { at }) {
  const team = ensureTeam(db);
  const taken = new Set();
  for (const person of team.people) {
    person.code = generateCode(taken, person);
    person.codeSetAt = at;
    taken.add(person.code);
  }
  return team.people;
}

export function removePerson(db, id) {
  const team = ensureTeam(db);
  const person = findPerson(team, id);
  if (team.mode === "personal" && team.people.length === 1) {
    throw new ValidationError(
      "That's the last person on the list. Switch back to the shared team code before removing them, or nobody could sign in.",
      {},
      409
    );
  }
  team.people.splice(team.people.indexOf(person), 1);
  return person;
}

export function setMode(db, mode) {
  const team = ensureTeam(db);
  if (!MODES.includes(mode)) throw new ValidationError("Choose how people sign in.", {});
  if (mode === "personal" && team.people.length === 0) {
    throw new ValidationError("Add people to the team list before switching to personal codes.", {}, 409);
  }
  team.mode = mode;
  return team;
}

/* ------------------------------------------------------------- sign-in */

export function personForSignIn(team, email, code, safeEqual) {
  const person = team.people.find((p) => p.email === email);
  const supplied = normalizeCode(code);
  // Compare against a dummy when the email is unknown so a miss takes the same time.
  const ok = safeEqual(supplied, person ? person.code : "not-a-real-code-00");
  return ok && person ? person : null;
}

/* ------------------------------------------------------------- tracking */

function belongsTo(order, person) {
  return order.requester.personId === person.id || order.requester.email === person.email;
}

/** Orders, units and order value per person, plus when they were last seen. */
export function teamReport(db, { now = new Date() } = {}) {
  const team = teamState(db);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const people = team.people.map((person) => {
    const orders = db.orders.filter((o) => belongsTo(o, person));
    const counted = orders.filter((o) => !RELEASED_STATUSES.includes(o.status));
    const member = db.members?.[person.email] ?? {};
    return {
      id: person.id,
      name: person.name,
      email: person.email,
      addedAt: person.addedAt,
      codeSetAt: person.codeSetAt,
      orders: counted.length,
      units: counted.reduce((sum, o) => sum + o.totalUnits, 0),
      valueCents: counted.reduce((sum, o) => sum + o.totalCents, 0),
      monthValueCents: counted.filter((o) => o.createdAt >= monthStart).reduce((sum, o) => sum + o.totalCents, 0),
      lastOrderAt: orders.length ? orders[orders.length - 1].createdAt : null,
      lastSignInAt: member.lastSignInAt ?? null,
    };
  });

  // People who have used the store but aren't on the list yet, so the admin
  // can add them before switching to personal codes.
  const listed = new Set(team.people.map((p) => p.email));
  const suggestions = Object.entries(db.members ?? {})
    .filter(([email]) => !listed.has(email))
    .map(([email, m]) => ({ email, name: m.name ?? "", lastSeenAt: m.lastSignInAt ?? m.lastOrderAt ?? null }))
    .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));

  return { mode: team.mode, people, suggestions };
}
