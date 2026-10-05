// The whole store as one JSON file, for a single server with a persistent
// disk. Writes go to a temporary file that is then renamed over the original,
// so a crash mid-write leaves the previous version intact rather than half a
// file. Mutations run one at a time, each against a copy of the state that
// only replaces the live state once it is safely on disk.

import fs from "node:fs/promises";
import path from "node:path";

export async function createFileStore({ dir, initialState }) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "store.json");

  async function write(next) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  }

  let state;
  try {
    state = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      // Never start over on top of data we could not read.
      throw new Error(`Could not read ${file}: ${error.message}. Fix or restore the file before starting.`);
    }
    state = initialState();
    await write(state);
  }

  let queue = Promise.resolve();

  return {
    kind: "file",
    location: file,

    async read() {
      return structuredClone(state);
    },

    mutate(fn) {
      const run = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await fn(draft);
        await write(draft);
        state = draft;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },

    // Photos live beside the store as files named by their content hash.
    async putImage({ id, ext, bytes }) {
      const images = path.join(dir, "images");
      await fs.mkdir(images, { recursive: true });
      const target = path.join(images, `${id}.${ext}`);
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, bytes, { mode: 0o600 });
      await fs.rename(tmp, target);
    },

    async getImage(id, ext) {
      try {
        return await fs.readFile(path.join(dir, "images", `${id}.${ext}`));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },

    async close() {
      await queue;
    },
  };
}
