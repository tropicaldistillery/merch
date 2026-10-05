import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeEqual } from "../src/auth.mjs";
import { initialState } from "../src/store/initial-state.mjs";
import {
  addPeople,
  generateCode,
  normalizeCode,
  parseTeamEntries,
  personForSignIn,
  removePerson,
  setMode,
  teamReport,
  updatePerson,
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
    assert.match(first.added[0].code, /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
    assert.notEqual(first.added[0].code, first.added[1].code);

    const second = addPeople(db, "JANE@tropicaldistillery.com\nnew@tropicaldistillery.com", { by: "Allie", at: AT });
    assert.deepEqual(second.already, ["jane@tropicaldistillery.com"]);
    assert.equal(db.team.people.length, 3);
  });

  it("refuses an empty paste", () => {
    assert.throws(() => addPeople(initialState(), "  \n ", { by: "A", at: AT }), ValidationError);
  });

  it("forgives how a code is typed, and only matches the right person", () => {
    const db = initialState();
    const { added } = addPeople(db, "jane@tropicaldistillery.com\nsam@tropicaldistillery.com", { by: "A", at: AT });
    const [jane, sam] = added;
    const typed = jane.code.toUpperCase().replace(/-/g, " ") + "  ";
    assert.equal(normalizeCode(typed), jane.code);
    assert.equal(personForSignIn(db.team, "jane@tropicaldistillery.com", typed, safeEqual)?.id, jane.id);
    assert.equal(personForSignIn(db.team, "jane@tropicaldistillery.com", sam.code, safeEqual), null);
    assert.equal(personForSignIn(db.team, "nobody@tropicaldistillery.com", jane.code, safeEqual), null);
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
