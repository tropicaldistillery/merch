// The whole store as one JSONB row, for hosts without a persistent disk
// (Replit deployments included) or running more than one instance. Every
// mutation locks the row, applies the change to the freshest copy and writes
// it back in one transaction, so concurrent orders from different instances
// can never both take the last unit of stock.
//
// Needs the `pg` package: run `npm install` once.

const TABLE = "tropical_merch_store";
// Photos are kept out of the store document, which is rewritten on every
// change, in a table of their own.
const IMAGES = "tropical_merch_images";

export async function createPostgresStore({ connectionString, initialState }) {
  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    throw new Error("DATABASE_URL is set but the Postgres driver is missing. Run `npm install` first.");
  }

  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on("error", (error) => console.error("[store] idle Postgres client error:", error.message));

  await pool.query(`
    create table if not exists ${TABLE} (
      id smallint primary key check (id = 1),
      doc jsonb not null,
      updated_at timestamptz not null default now()
    )`);
  await pool.query(`
    create table if not exists ${IMAGES} (
      id text primary key,
      ext text not null,
      bytes bytea not null,
      created_at timestamptz not null default now()
    )`);
  await pool.query(`insert into ${TABLE} (id, doc) values (1, $1::jsonb) on conflict (id) do nothing`, [
    JSON.stringify(initialState()),
  ]);

  return {
    kind: "postgres",
    location: `table ${TABLE}`,

    async read() {
      const { rows } = await pool.query(`select doc from ${TABLE} where id = 1`);
      return rows[0].doc;
    },

    async mutate(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query(`select doc from ${TABLE} where id = 1 for update`);
        const draft = rows[0].doc;
        const result = await fn(draft);
        await client.query(`update ${TABLE} set doc = $1::jsonb, updated_at = now() where id = 1`, [
          JSON.stringify(draft),
        ]);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async putImage({ id, ext, bytes }) {
      await pool.query(`insert into ${IMAGES} (id, ext, bytes) values ($1, $2, $3) on conflict (id) do nothing`, [id, ext, bytes]);
    },

    async getImage(id, ext) {
      const { rows } = await pool.query(`select bytes from ${IMAGES} where id = $1 and ext = $2`, [id, ext]);
      return rows[0]?.bytes ?? null;
    },

    async close() {
      await pool.end();
    },
  };
}
