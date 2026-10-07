import { randomBytes } from "node:crypto";
import { CATEGORIES_VERSION, SEED_CATALOG, SEED_PHOTOS_VERSION, SKU_FORMAT_VERSION } from "../catalog.mjs";

export const STATE_VERSION = 1;

/**
 * A brand-new store. The session secret is generated here and kept with the
 * data, so sessions survive restarts and are shared by every instance without
 * another setting to manage. SESSION_SECRET overrides it when set.
 */
export function initialState() {
  return {
    version: STATE_VERSION,
    meta: {
      createdAt: new Date().toISOString(),
      nextOrderNumber: 1001,
      sessionSecret: randomBytes(32).toString("base64url"),
      seedPhotos: SEED_PHOTOS_VERSION,
      categories: CATEGORIES_VERSION,
      skuFormat: SKU_FORMAT_VERSION,
      // a new store starts with the starter stock, not the 7 Oct 2026 reset
      stockCleared: 1,
    },
    catalog: structuredClone(SEED_CATALOG),
    orders: [],
    accounts: [],
    members: {},
    team: { mode: "shared", people: [] },
  };
}
