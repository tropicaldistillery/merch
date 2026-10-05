// Both stores must serialize mutations and never apply a failed one. The
// Postgres half runs only when MERCH_TEST_DATABASE_URL points at a disposable
// database and `pg` is installed; it drops its table when it finishes.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createFileStore } from "../src/store/file-store.mjs";
import { initialState } from "../src/store/initial-state.mjs";

async function exercise(store) {
  // Fifty concurrent increments must all land.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      store.mutate((db) => {
        db.meta.nextOrderNumber += 1;
      })
    )
  );
  assert.equal((await store.read()).meta.nextOrderNumber, 1051);

  // A mutation that throws leaves no trace.
  await assert.rejects(
    store.mutate((db) => {
      db.meta.nextOrderNumber = 0;
      throw new Error("boom");
    }),
    /boom/
  );
  assert.equal((await store.read()).meta.nextOrderNumber, 1051);

  // Reads are copies: changing one cannot change the store.
  const snapshot = await store.read();
  snapshot.orders.push({ id: "ghost" });
  assert.equal((await store.read()).orders.length, 0);
}

describe("file store", () => {
  it("serializes and isolates mutations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-store-"));
    try {
      const store = await createFileStore({ dir, initialState });
      await exercise(store);
      await store.close();

      const reopened = await createFileStore({ dir, initialState });
      assert.equal((await reopened.read()).meta.nextOrderNumber, 1051);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start over a corrupt file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tropical-merch-store-"));
    try {
      await fs.writeFile(path.join(dir, "store.json"), "{ not json");
      await assert.rejects(createFileStore({ dir, initialState }), /Could not read/);
      assert.equal(await fs.readFile(path.join(dir, "store.json"), "utf8"), "{ not json");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

const databaseUrl = process.env.MERCH_TEST_DATABASE_URL;
let hasDriver = false;
try {
  await import("pg");
  hasDriver = true;
} catch {
  // optional dependency not installed
}

describe("postgres store", { skip: !databaseUrl || !hasDriver ? "set MERCH_TEST_DATABASE_URL and npm install to run" : false }, () => {
  it("serializes and isolates mutations across connections", async () => {
    const { default: pg } = await import("pg");
    const reset = new pg.Client({ connectionString: databaseUrl });
    await reset.connect();
    await reset.query("drop table if exists tropical_merch_store");
    await reset.end();

    const { createPostgresStore } = await import("../src/store/postgres-store.mjs");
    // Two stores stand in for two app instances sharing one database.
    const a = await createPostgresStore({ connectionString: databaseUrl, initialState });
    const b = await createPostgresStore({ connectionString: databaseUrl, initialState });
    try {
      await exercise(a);
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? a : b).mutate((db) => {
            db.meta.nextOrderNumber += 1;
          })
        )
      );
      assert.equal((await b.read()).meta.nextOrderNumber, 1071);
    } finally {
      await a.close();
      await b.close();
      const cleanup = new pg.Client({ connectionString: databaseUrl });
      await cleanup.connect();
      await cleanup.query("drop table if exists tropical_merch_store");
      await cleanup.end();
    }
  });
});
