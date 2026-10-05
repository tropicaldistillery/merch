import { createFileStore } from "./file-store.mjs";
import { createPostgresStore } from "./postgres-store.mjs";
import { initialState } from "./initial-state.mjs";

/** Postgres when a connection string is configured, otherwise a JSON file. */
export function openStore({ databaseUrl, dataDir }) {
  return databaseUrl
    ? createPostgresStore({ connectionString: databaseUrl, initialState })
    : createFileStore({ dir: dataDir, initialState });
}

export { initialState };
