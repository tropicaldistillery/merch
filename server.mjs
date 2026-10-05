/**
 * Tropical Distillery team merch store.
 *
 * Team members order merchandise, point-of-sale and event supplies shipped to
 * themselves or straight to an account; an admin approves and ships them.
 * Node 20.12+ only — no dependencies unless DATABASE_URL is used.
 *
 *   TEAM_ACCESS_CODE    code team members sign in with (store is closed without it)
 *   ADMIN_PASSWORD      opens /admin (the admin console is off without it)
 *   TEAM_EMAIL_DOMAINS  optional, comma-separated: only these email domains may sign in
 *   DATABASE_URL        optional Postgres URL; otherwise data is a JSON file in DATA_DIR
 *   DATA_DIR            where the JSON store lives (default ./data)
 *   ORDER_WEBHOOK_URL   optional Slack/Zapier webhook for new orders and status changes
 *   PUBLIC_URL          optional, this site's address, used for links in notifications
 *   SESSION_SECRET      optional; by default a secret is generated and kept with the data
 *   ORDER_PREFIX        order number prefix (default TD → TD-1001)
 *   TIMEZONE            where "today" is for needed-by dates (default America/New_York)
 *   COOKIE_SECURE       auto (default) | always | never
 *   PORT                default 4100
 *
 * A .env file next to this one is read if present; real environment
 * variables take precedence over it.
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./src/app.mjs";
import { createNotifier } from "./src/notify.mjs";
import { openStore } from "./src/store/index.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const env = process.env;

function fail(message) {
  console.error(`[config] ${message}`);
  process.exit(1);
}

const timeZone = env.TIMEZONE || "America/New_York";
try {
  new Intl.DateTimeFormat("en-US", { timeZone });
} catch {
  fail(`TIMEZONE "${timeZone}" is not a valid IANA time zone, e.g. America/New_York.`);
}

const orderPrefix = (env.ORDER_PREFIX || "TD").trim().toUpperCase();
if (!/^[A-Z0-9]{1,6}$/.test(orderPrefix)) fail("ORDER_PREFIX must be 1–6 letters or digits.");

const cookieSecure = env.COOKIE_SECURE || "auto";
if (!["auto", "always", "never"].includes(cookieSecure)) fail("COOKIE_SECURE must be auto, always or never.");

const config = {
  teamAccessCode: (env.TEAM_ACCESS_CODE || "").trim(),
  adminPassword: env.ADMIN_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  allowedEmailDomains: (env.TEAM_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean),
  timeZone,
  orderPrefix,
  cookieSecure,
  publicDir: path.join(ROOT, "public"),
};

const port = Number(env.PORT || 4100);
const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, "data");

if (!config.teamAccessCode) console.warn("[config] TEAM_ACCESS_CODE is not set — nobody can sign in to the store.");
else if (config.teamAccessCode.length < 10) console.warn("[config] TEAM_ACCESS_CODE is short. Use a passphrase of a few words.");
if (!config.adminPassword) console.warn("[config] ADMIN_PASSWORD is not set — the admin console is off.");
else if (config.adminPassword.length < 12) console.warn("[config] ADMIN_PASSWORD is short. Use at least 12 characters.");

const store = await openStore({ databaseUrl: env.DATABASE_URL, dataDir });
const notify = createNotifier(env.ORDER_WEBHOOK_URL, { baseUrl: env.PUBLIC_URL || "" });
const handler = await createApp({ store, config, notify });

const server = http.createServer(handler);
server.listen(port, () => {
  console.log(`Tropical Distillery merch store   http://localhost:${port}`);
  console.log(`Data                              ${store.kind} (${store.location})`);
  console.log(`Admin console                     ${config.adminPassword ? `http://localhost:${port}/admin` : "off"}`);
  if (env.ORDER_WEBHOOK_URL) console.log("Order notifications               on");
});

function shutdown(signal) {
  console.log(`[server] ${signal} received, closing`);
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
