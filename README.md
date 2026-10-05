# Tropical Distillery team merch store

An internal ordering site for the Tropical Distillery team. Sales reps and brand
ambassadors order apparel, glassware, point-of-sale, bar tools, event kits and
print, and choose for each order whether it ships **to themselves** or
**straight to an account**: a bar, restaurant, store, distributor or event. An
admin approves, ships and tracks every order.

It runs entirely on Tropical Distillery's own GitHub and Render accounts and
shares nothing with SipScale.

## What it does

**For team members**

- Sign in with name, work email and the shared team code. A session lasts 30
  days on that device.
- Browse the catalog by category, brand or search, with live stock, sizes and a
  per-order limit on each item.
- At checkout, choose **Ship to me** (your address is remembered) or **Ship to
  an account**. Any account someone on the team has shipped to before can be
  picked from a list, which fills in its address, receiving contact and
  delivery notes.
- Say what the order is for, when it's needed, and whether it's a rush (with a
  reason).
- Under **My orders**, follow each order through Submitted → Approved →
  Shipped → Delivered, open the carrier's tracking page, cancel an order that
  hasn't been approved yet, or reorder in one click.

**For the admin** (`/admin`)

- A queue of orders needing action, rush orders first, then by needed-by date.
- Approve, decline (with a reason the requester sees), cancel, mark shipped
  (carrier and tracking number) and mark delivered. Every change is kept in
  the order's history with who made it.
- Print a packing slip, copy the delivery address, keep internal notes.
- Export orders to CSV, one row per item, for fulfilment or budgeting.
- Edit the catalog: add items, change cost, stock, sizes, per-order limits and
  photos, or hide an item from the store.
- Tidy the shared account directory.

Stock is reserved when an order is placed and returned if it is cancelled or
declined, so "available" always means what's left to promise. Items printed or
bought to order can be left untracked and never run out.

Costs are internal, for budgeting. Nobody is charged and there is no payment
step.

## The starter catalog

The store opens with 24 items across J.F. Haden's (Mango, Espresso and Key Lime
liqueurs), Twin P Whiskey and Tropical Distillery house branding. **Costs and
stock levels are placeholders.** Set the real numbers in the admin console
(Catalog & stock → Edit) before inviting the team, hide anything you don't
stock, and add a photo URL to any item to replace its illustration.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20.12 or newer.

```bash
cp .env.example .env      # then set TEAM_ACCESS_CODE and ADMIN_PASSWORD in .env
npm start
```

Open <http://localhost:4100>. Without `DATABASE_URL`, data is kept in
`data/store.json` (never committed). `npm run dev` restarts on file changes.

## Settings

| Variable | |
| --- | --- |
| `TEAM_ACCESS_CODE` | The code team members sign in with. Use a short passphrase; it is not case-sensitive. **Changing it signs everyone out**, which is how you lock out someone who has left. Without it the store is closed. |
| `ADMIN_PASSWORD` | Opens `/admin`. Changing it signs out every admin. Without it the admin console is off. |
| `TEAM_EMAIL_DOMAINS` | Optional, comma-separated, e.g. `tropicaldistillery.com`. Only these email addresses may sign in. Leave it empty if brand ambassadors use personal email. |
| `DATABASE_URL` | Optional Postgres connection string. When set, everything is stored in one table (`tropical_merch_store`) that the app creates itself. **Required on any host without a permanent disk**, Render and Replit included. Run `npm install` once to fetch the driver. |
| `REQUIRE_DATABASE` | Set to `1` on any host without a permanent disk. The site then refuses to start without `DATABASE_URL`, instead of keeping orders in a file that vanishes on the next restart. |
| `DATA_DIR` | Where `store.json` lives when there's no database. Default `./data`. |
| `ORDER_WEBHOOK_URL` | Optional. Every new order and status change is POSTed here as JSON with a ready-made `text` summary. A Slack incoming webhook works as-is; a Zapier or Make webhook can turn it into emails to the requester. |
| `PUBLIC_URL` | Optional. The site's address, e.g. `https://merch.tropicaldistillery.com`, so notifications link straight to the order. |
| `ORDER_PREFIX` | Order-number prefix. Default `TD` (TD-1001, TD-1002, …). |
| `TIMEZONE` | Where "today" is for needed-by dates. Default `America/New_York`. |
| `COOKIE_SECURE` | `auto` (default), `always` (set this on any HTTPS host) or `never`. |
| `SESSION_SECRET` | Optional. By default a secret is generated once and kept with the data. |
| `PORT` | Default `4100`. |

## Putting it online on Tropical Distillery's own accounts

You need three accounts, all owned by Tropical Distillery:

1. **GitHub** (free) holds the code, in this repository
   (`tropicaldistillery/merch`).
2. **Render** runs the site and its database. It watches the GitHub repository
   and redeploys whenever the code changes.
3. **Your domain registrar or DNS host**, to point a subdomain such as
   `merch.tropicaldistillery.com` at Render.

Then:

1. In Render, choose **New → Blueprint** and connect the GitHub repository.
   `render.yaml` creates the web service and a Postgres database together and
   wires the database in.
2. When asked, enter `TEAM_ACCESS_CODE` and `ADMIN_PASSWORD`. If brand
   ambassadors sign in with personal email, clear `TEAM_EMAIL_DOMAINS` on the
   service's Environment page.
3. When the deploy finishes, open the `.onrender.com` address Render shows,
   sign in at `/admin`, and set real costs and stock.
4. Under the service's **Settings → Custom Domains**, add
   `merch.tropicaldistillery.com` and create the DNS record Render gives you at
   your registrar. Then set `PUBLIC_URL` to that address.
5. Optional: create a Slack incoming webhook in Tropical Distillery's Slack and
   set it as `ORDER_WEBHOOK_URL`.

The Blueprint uses Render's `starter` web plan, which stays awake, and the
`basic-256mb` database plan; check Render's pricing page for current costs. The
free web plan also works but sleeps when idle, so the first visit after a quiet
spell takes a while to load.

Any other Node host works the same way: run `npm ci` then `npm start`, set the
variables above, and give it a Postgres `DATABASE_URL` (or a permanent disk for
`DATA_DIR`).

## Backups and limits

On Postgres, the database's own backups cover everything. On a single server
with the file store, back up `data/store.json`. Either way, **Export CSV** in
the admin console gives a spreadsheet of every order.

All data lives in a single JSON document, rewritten on each change. That keeps
the app dependency-free and every change atomic, and is comfortably fast for a
sales team's order volume — thousands of orders. If the store ever outgrows
that, the next step is real tables.

## Security model

- The team code is shared, so anyone who has it can order under any name; it
  is meant to keep the store private, not to prove identity. Restrict email
  domains where you can, and change the code when someone leaves.
- Sessions are signed, `HttpOnly` cookies. Every request that changes data
  must carry a header a cross-site page cannot send, so other sites cannot
  place or approve orders on someone's behalf.
- Wrong codes and passwords are throttled per address.
- Pages are served with a strict Content-Security-Policy; everything people
  type is rendered as text, never as HTML; CSV exports defuse spreadsheet
  formulas.
- Team members see only their own orders. The account directory, which holds
  business addresses, is shared with the whole team on purpose.

## Look and feel

The store is styled to match [tropicaldistillery.com](https://tropicaldistillery.com):
its colors, Josefin Sans headings and Inter body text, pill buttons, the
pink-to-blue "Miami" gradient and the sunset motif, all taken from the
Shopify theme there and kept as variables at the top of
`public/assets/styles.css`. The palm logo is `public/assets/brand/td-palm.png`.

One deliberate difference: the site's pink (`#E84890`) is too light for white
button text or small pink text to be readable by everyone, so buttons use a
slightly deeper pink (`#CF3579`) and pink text uses the theme's own darker
pink (`#C92F74`). The bright pink is still used for the logo, gradients,
outlines and highlights.

## Development

```
server.mjs              entry point: reads settings, opens the store, starts HTTP
src/app.mjs             routes, sign-in, security headers, static pages
src/orders.mjs          order validation, stock, account directory, status changes, CSV
src/catalog.mjs         starter catalog and item editing rules
src/auth.mjs            signed sessions and sign-in throttling
src/notify.mjs          webhook messages
src/store/              JSON-file and Postgres stores
public/                 the pages; assets/shared.js is imported by the server too
test/                   node:test suites
```

```bash
npm test
```

runs everything with Node's built-in test runner; no install is needed. The
Postgres store test runs too when `MERCH_TEST_DATABASE_URL` points at a
disposable database and `npm install` has been run. It creates and drops its
own table.
