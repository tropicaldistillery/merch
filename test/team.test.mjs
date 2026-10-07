import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeEqual } from "../src/auth.mjs";
import { initialState } from "../src/store/initial-state.mjs";
import {
  addPeople,
  generateCode,
  normalizeCode,
  parseTeamEntries,
  credentialOf,
  hashPassword,
  passwordProblem,
  personForSignIn,
  removePerson,
  resetAllCodes,
  setMode,
  setOwnPassword,
  teamReport,
  updatePerson,
  verifyPassword,
} from "../src/team.mjs";
import { suggestedMaxPerOrder } from "../public/assets/shared.js";
import { ValidationError } from "../src/validation.mjs";

const AT = "2026-10-05T12:00:00.000Z";

describe("team list", () => {
  it("reads the shapes people paste", () => {
    const { entries, invalid } = parseTeamEntries(
      [
        "Jane Rep, Jane@TropicalDistillery.com",
        "marco.ambassador@gmail.com, Marco Diaz",
        "Sam Smith <sam@tropicaldistillery.com>",
        "lee@tropicaldistillery.com",
        "Pat\tpat@tropicaldistillery.com",
        "not an email",
        "jane@tropicaldistillery.com",
        "",
      ].join("\n")
    );
    assert.deepEqual(entries, [
      { name: "Jane Rep", email: "jane@tropicaldistillery.com" },
      { name: "Marco Diaz", email: "marco.ambassador@gmail.com" },
      { name: "Sam Smith", email: "sam@tropicaldistillery.com" },
      { name: "", email: "lee@tropicaldistillery.com" },
      { name: "Pat", email: "pat@tropicaldistillery.com" },
    ]);
    assert.deepEqual(invalid, ["not an email"]);
  });

  it("gives everyone their own code and skips people already listed", () => {
    const db = initialState();
    db.members["lee@tropicaldistillery.com"] = { name: "Lee Known" };
    const first = addPeople(db, "Jane, jane@tropicaldistillery.com\nlee@tropicaldistillery.com", { by: "Allie", at: AT });
    assert.equal(first.added.length, 2);
    assert.equal(first.added[1].name, "Lee Known", "falls back to the name they signed in with");
    assert.match(first.added[0].code, /^tropical-jane-\d{4}$/, "tropical, their first name, a number");
    assert.match(first.added[1].code, /^tropical-lee-\d{4}$/);
    assert.notEqual(first.added[0].code, first.added[1].code);

    const second = addPeople(db, "JANE@tropicaldistillery.com\nnew@tropicaldistillery.com", { by: "Allie", at: AT });
    assert.deepEqual(second.already, ["jane@tropicaldistillery.com"]);
    assert.equal(db.team.people.length, 3);
  });

  it("refuses an empty paste", () => {
    assert.throws(() => addPeople(initialState(), "  \n ", { by: "A", at: AT }), ValidationError);
  });

  it("forgives how a code is typed, and only matches the right person", async () => {
    const db = initialState();
    const { added } = addPeople(db, "jane@tropicaldistillery.com\nsam@tropicaldistillery.com", { by: "A", at: AT });
    const [jane, sam] = added;
    const typed = jane.code.toUpperCase().replace(/-/g, " ") + "  ";
    assert.equal(normalizeCode(typed), jane.code);
    assert.equal((await personForSignIn(db.team, "jane@tropicaldistillery.com", typed, safeEqual))?.id, jane.id);
    assert.equal(await personForSignIn(db.team, "jane@tropicaldistillery.com", sam.code, safeEqual), null);
    assert.equal(await personForSignIn(db.team, "nobody@tropicaldistillery.com", jane.code, safeEqual), null);
  });

  it("issues a new code on reset and keeps emails unique", () => {
    const db = initialState();
    const { added } = addPeople(db, "jane@tropicaldistillery.com\nsam@tropicaldistillery.com", { by: "A", at: AT });
    const before = added[0].code;
    assert.notEqual(updatePerson(db, added[0].id, { resetCode: true }, { at: AT }).code, before);
    assert.throws(() => updatePerson(db, added[0].id, { email: "SAM@tropicaldistillery.com" }, { at: AT }), (e) => Boolean(e.fieldErrors.email));
    assert.equal(updatePerson(db, added[0].id, { name: "Jane R." }, { at: AT }).name, "Jane R.");
  });

  it("won't switch to personal codes with nobody listed, or remove the last person while on", () => {
    const db = initialState();
    assert.throws(() => setMode(db, "personal"), (e) => e.status === 409);
    const { added } = addPeople(db, "jane@tropicaldistillery.com", { by: "A", at: AT });
    setMode(db, "personal");
    assert.throws(() => removePerson(db, added[0].id), (e) => e.status === 409);
    setMode(db, "shared");
    removePerson(db, added[0].id);
    assert.equal(db.team.people.length, 0);
    assert.throws(() => setMode(db, "everyone"), ValidationError);
  });

  it("reports each person's orders and who isn't on the list yet", () => {
    const db = initialState();
    const { added } = addPeople(db, "Jane, jane@tropicaldistillery.com", { by: "A", at: AT });
    db.orders.push(
      { requester: { email: "jane@tropicaldistillery.com" }, status: "shipped", totalUnits: 3, totalCents: 4500, createdAt: "2026-10-02T00:00:00.000Z" },
      { requester: { email: "old@x.com", personId: added[0].id }, status: "submitted", totalUnits: 1, totalCents: 1000, createdAt: "2026-09-20T00:00:00.000Z" },
      { requester: { email: "jane@tropicaldistillery.com" }, status: "cancelled", totalUnits: 9, totalCents: 9900, createdAt: "2026-10-03T00:00:00.000Z" }
    );
    db.members["sam@tropicaldistillery.com"] = { name: "Sam", lastSignInAt: AT };
    const report = teamReport(db, { now: new Date("2026-10-05T12:00:00Z") });
    const jane = report.people[0];
    assert.deepEqual([jane.orders, jane.units, jane.valueCents, jane.monthValueCents], [2, 4, 5500, 4500]);
    assert.equal(report.suggestions[0].email, "sam@tropicaldistillery.com");
    assert.equal("code" in jane, false, "the report never carries codes");
  });

  it("builds codes from the first name, however it is written", () => {
    assert.match(generateCode(new Set(), { name: "José Álvarez" }), /^tropical-jose-\d{4}$/);
    assert.match(generateCode(new Set(), { name: "", email: "marco.ambassador@gmail.com" }), /^tropical-marco-\d{4}$/);
    assert.match(generateCode(new Set(), { name: "Mary-Kate O'Neil" }), /^tropical-mary-\d{4}$/);
    assert.match(generateCode(new Set(), { name: "", email: "42@x.com" }), /^tropical-team-\d{4}$/);
  });

  it("makes codes unique even when the space is crowded", () => {
    const taken = new Set();
    for (let i = 0; i < 500; i += 1) taken.add(generateCode(taken));
    assert.equal(taken.size, 500);
  });
});

describe("suggested max per order", () => {
  it("allows fewer of the expensive things", () => {
    assert.deepEqual([14500, 6500, 4200, 1150, 750].map(suggestedMaxPerOrder), [1, 2, 4, 6, 12]);
    assert.equal(suggestedMaxPerOrder(NaN), null);
  });
});

describe("own passwords", () => {
  function withJane() {
    const db = initialState();
    const { added } = addPeople(db, "Jane Rep, jane@tropicaldistillery.com", { by: "A", at: AT });
    return { db, jane: db.team.people.find((p) => p.id === added[0].id) };
  }

  it("keeps only a salted hash, and checks it exactly", async () => {
    const one = await hashPassword("mango sunset 42");
    const two = await hashPassword("mango sunset 42");
    assert.notEqual(one, two, "each hash has its own salt");
    assert.ok(!one.includes("mango"));
    assert.equal(await verifyPassword("mango sunset 42", one), true);
    assert.equal(await verifyPassword("Mango sunset 42", one), false);
    assert.equal(await verifyPassword("mango sunset 42", "not-a-hash"), false);
  });

  it("refuses passwords that are short, padded, guessable or the code itself", () => {
    const { jane } = withJane();
    assert.match(passwordProblem("short", jane), /at least 8/);
    assert.match(passwordProblem(" mango sunset ", jane), /spaces/);
    assert.match(passwordProblem("jane@tropicaldistillery.com", jane), /email/);
    assert.match(passwordProblem(jane.code.toUpperCase(), jane), /code you were sent/);
    assert.match(passwordProblem("password1", jane), /too easy/);
    assert.match(passwordProblem("aaaaaaaaaa", jane), /too easy/);
    assert.match(passwordProblem("x".repeat(129), jane), /at most/);
    assert.equal(passwordProblem("mango sunset 42", jane), null);
  });

  it("replaces the code, signs in with the password only, and shows the admin no secret", async () => {
    const { db, jane } = withJane();
    const code = jane.code;
    const hash = await hashPassword("mango sunset 42");
    setOwnPassword(db, jane.id, { hash, was: code }, { at: AT });

    assert.equal(jane.code, null);
    assert.equal(credentialOf(jane), hash);
    assert.equal((await personForSignIn(db.team, jane.email, "mango sunset 42", safeEqual))?.id, jane.id);
    assert.equal(await personForSignIn(db.team, jane.email, code, safeEqual), null, "the old code stops working");
    assert.equal(await personForSignIn(db.team, jane.email, "MANGO SUNSET 42", safeEqual), null);

    const [row] = teamReport(db).people;
    assert.equal(row.ownPasswordSetAt, AT);
    assert.ok(!JSON.stringify(teamReport(db)).includes(hash));
  });

  it("does nothing if the admin changed the code in the meantime", async () => {
    const { db, jane } = withJane();
    const was = jane.code;
    updatePerson(db, jane.id, { resetCode: true }, { at: AT });
    const hash = await hashPassword("mango sunset 42");
    assert.throws(() => setOwnPassword(db, jane.id, { hash, was }, { at: AT }), (e) => e.status === 409);
    assert.ok(jane.code);
  });

  it("is replaced by a new code from the admin, one at a time or for everyone", async () => {
    const { db, jane } = withJane();
    setOwnPassword(db, jane.id, { hash: await hashPassword("mango sunset 42"), was: jane.code }, { at: AT });
    updatePerson(db, jane.id, { resetCode: true }, { at: AT });
    assert.ok(jane.code);
    assert.equal(jane.passwordHash, undefined);
    assert.equal((await personForSignIn(db.team, jane.email, jane.code, safeEqual))?.id, jane.id);

    setOwnPassword(db, jane.id, { hash: await hashPassword("key lime pie 7"), was: jane.code }, { at: AT });
    resetAllCodes(db, { at: AT });
    assert.ok(jane.code);
    assert.equal(jane.passwordSetAt, undefined);
  });
});
