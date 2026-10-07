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
 *   REQUIRE_DATABASE    set to 1 on hosts without a permanent disk: refuse to start
 *                       without DATABASE_URL rather than keep orders in a file
 *                       that disappears on the next restart
 *   DATA_DIR            where the JSON store lives (default ./data)
 *   ORDER_WEBHOOK_URL   optional Slack/Zapier webhook for new orders and status changes
 *   RESEND_API_KEY      optional Resend API key: turns on order emails
 *   ORDER_EMAIL_FROM    the address emails come from, on a domain verified in Resend,
 *                       e.g. "Tropical Distillery Merch <merch@tropicaldistillery.com>"
 *   ORDER_EMAIL_TO      comma-separated admin addresses that get new-order alerts
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
import { createEmailer, parseAddresses } from "./src/email.mjs";
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

if (/^(1|true|yes)$/i.test(env.REQUIRE_DATABASE || "") && !env.DATABASE_URL) {
  fail("REQUIRE_DATABASE is set but DATABASE_URL is missing. Add the database's connection string as DATABASE_URL.");
}

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
  publicUrl: env.PUBLIC_URL || "",
};

const port = Number(env.PORT || 4100);
const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, "data");

if (!config.teamAccessCode) console.warn("[config] TEAM_ACCESS_CODE is not set — nobody can sign in to the store.");
else if (config.teamAccessCode.length < 10) console.warn("[config] TEAM_ACCESS_CODE is short. Use a passphrase of a few words.");
if (!config.adminPassword) console.warn("[config] ADMIN_PASSWORD is not set — the admin console is off.");
else if (config.adminPassword.length < 12) console.warn("[config] ADMIN_PASSWORD is short. Use at least 12 characters.");

const emailTo = parseAddresses(env.ORDER_EMAIL_TO);
const emailFrom = (env.ORDER_EMAIL_FROM || "").trim();
const emailsOn = Boolean(env.RESEND_API_KEY && emailFrom);
if (env.RESEND_API_KEY && !emailFrom) {
  console.warn("[config] Order emails are off: set ORDER_EMAIL_FROM to an address on a domain verified in Resend.");
}
if (emailsOn && !emailTo.length) console.warn("[config] ORDER_EMAIL_TO is not set, so no admin gets new-order emails.");
if (emailsOn && !env.PUBLIC_URL) console.warn("[config] PUBLIC_URL is not set, so order emails can't link to the store.");

const store = await openStore({ databaseUrl: env.DATABASE_URL, dataDir });
const webhook = createNotifier(env.ORDER_WEBHOOK_URL, { baseUrl: env.PUBLIC_URL || "" });
const email = createEmailer({ apiKey: env.RESEND_API_KEY, from: emailFrom, adminTo: emailTo, baseUrl: env.PUBLIC_URL || "" });
function notify(event, order, context) {
  webhook(event, order);
  email(event, order, context);
}
const handler = await createApp({ store, config, notify });

const server = http.createServer(handler);
server.listen(port, () => {
  console.log(`Tropical Distillery merch store   http://localhost:${port}`);
  console.log(`Data                              ${store.kind} (${store.location})`);
  console.log(`Admin console                     ${config.adminPassword ? `http://localhost:${port}/admin` : "off"}`);
  if (env.ORDER_WEBHOOK_URL) console.log("Order notifications               on");
  if (emailsOn) console.log(`Order emails                      on (Resend, alerts to ${emailTo.length} admin address${emailTo.length === 1 ? "" : "es"})`);
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
