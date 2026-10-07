# Tropical Distillery team merch store

An internal ordering site for the Tropical Distillery team. Sales reps and brand
ambassadors order from six categories (Apparel, Giveaways, Print, Bar Tools,
Sampling & Events and VIP) and choose for each order whether it ships **to themselves** or
**straight to an account**: a bar, restaurant, store, distributor or event. An
admin approves, ships and tracks every order.

It runs entirely on Tropical Distillery's own GitHub and Render accounts and
shares nothing with SipScale.

## What it does

**For team members**

- Sign in with their email and **personal code** (or, until personal codes are
  switched on, their name, work email and the shared team code). A session
  lasts 30 days on that device.
- Browse the catalog by category, brand or search, with live stock, sizes and a
  per-order limit on each item. Every item shows what it costs Tropical
  Distillery and that it's **free to them**; the cart and checkout show the
  order's value and "You pay $0.00". Small, cheap items can have a **minimum
  per order** (a jigger comes in threes), and the quantity picker starts there.
- Pick a **color** for items that come in several (the Tropical Distillery
  Team Polo and the J.F. Haden's Polo come in White, Navy, Burgundy, Black,
  Royal, Red, Forest Green, Grey and Carolina Blue; the tees in fewer): the
  photo switches to that color, and one order can mix colors.
  Arrows and dots page through an item's photos.
- Use the **ROI calculator** in the cart: enter the cases the order should help
  sell and see the projected profit (at an average of $75 a case, set as
  `PROFIT_PER_CASE_CENTS` in `public/assets/shared.js`), the net return, the
  ROI and how many cases pay for the order.
- At checkout, choose **Ship to me** (your address is remembered) or **Ship to
  an account**. Any account someone on the team has shipped to before can be
  picked from a list, which fills in its address, receiving contact and
  delivery notes.
- Say what the order is for, when it's needed, and whether it's a rush (with a
  reason).
- Under **My orders**, follow each order through Submitted → Approved →
  Shipped → Delivered, open the carrier's tracking page, cancel an order that
  hasn't been approved yet, or reorder in one click.
- Once personal codes are on, swap their code for a **password of their own**
  (**Change password** at the top of the store). It is kept only as a salted
  hash, so not even the admin can see it. Their other devices are signed out;
  if they forget it, the admin issues a new code.

**For the admin** (`/admin`)

- A queue of orders needing action, rush orders first, then by needed-by date.
- Approve, decline (with a reason the requester sees), cancel, mark shipped
  (carrier and tracking number) and mark delivered. Every change is kept in
  the order's history with who made it.
- Print a packing slip, copy the delivery address, keep internal notes.
- **Bulk edit**: tick orders (shift-click ticks a run of them) to approve,
  mark shipped (one carrier, with each order's own tracking number), mark
  delivered, decline, cancel or add an internal note to all of them at once,
  or print their packing slips (one per page) or export just those orders.
  Anything wrong with what you typed changes nothing; an order that can't take
  the change (one already shipped can't be approved) is left alone and named.
- Export orders to CSV, one row per item, for fulfilment or budgeting.
- The **Tracker** tab shows what each person has ordered: their orders (and how
  many are still open), units, order value, last order and every item by color
  and size, for all time, this month, last month, this quarter or this year.
  Everyone on the team list is included, even if they haven't ordered yet.
  Select a person to see each item and order; **Export CSV** gives one row per
  person and item. Cancelled and declined orders don't count.
- Edit the catalog: add items, change cost, stock, sizes, per-order limits and
  photos, hide an item from the store, or delete it (past orders keep their
  details). As the cost is typed, a **suggested max per order** appears (1 for
  $100+, 2 for $50+, 4 for $25+, 6 for $10+, otherwise 12) and a **suggested
  minimum** for small items (10 under $5, 3 under $10, 2 under $15; clothing
  always 1); new items take both automatically. An **order increment** sells
  an item in steps (6 means 6, 12, 18…); the minimum and maximum must be
  multiples of it, and the shop's quantity buttons move in those steps.
- A new item's **SKU is made from its category and name** as you type
  ("J.F. Haden's Throw Pillow" in VIP becomes `VIP-THROW-PILLOW`), and you can
  still type your own. Existing SKUs never change.
- **Upload photos**, up to 10 an item, with the button or by dragging several
  onto the editor at once. Each is resized in the browser to 1200 × 900, so
  every product card matches: "Show the whole photo" fits it on white, "Fill
  the frame" crops the edges. The first photo is the main one (**Make main**
  changes it), and a photo can be tagged with a color so the store shows it
  when that color is picked. Photos are stored with the rest of the data (in
  Postgres, or `DATA_DIR/images`).
- Tick an item's **color choices** from the standard nine (any item named as
  a polo was given all nine once; untick the ones you don't carry). Team members must
  pick one; stock is counted per size across colors, and the color shows on
  the order, packing slip and CSV export.
- Manage the **team list** (Team tab): paste names and emails, straight from a
  spreadsheet if you like, and everyone gets a personal code built from their
  first name, like `tropical-jane-4821`. **New codes for everyone** reissues
  the whole list in one go. Look up or copy a code, issue a new one (the old
  one stops working at once), download every code as a CSV, and see each
  person's orders, units and order value this month and overall. People who
  have used the shared code but aren't on the list yet are listed so they can
  be added in one click.
- Tidy the shared account directory.

Stock is reserved when an order is placed and returned if it is cancelled or
declined, so "available" always means what's left to promise. Items printed or
bought to order can be left untracked and never run out.

Costs are shown so the team knows what they're ordering is worth, but nobody
is charged and there is no payment step.

### Personal codes

1. In **Team**, add everyone (name and email, one per line). Each person gets a
   code.
2. Send people their codes: **Copy all**, or **Download codes** for a
   spreadsheet with each person's sign-in link.
3. Switch **How people sign in** to **Personal codes**. The shared team code
   stops working and anyone signed in with it signs in again with their own
   code.

From then on every order is tied to a person on the list. Removing someone or
giving them a new code signs them out everywhere. Anyone can then replace
their code with a password of their own; the Team tab shows "Own password"
instead of a code for them, and **New code** (or **New codes for everyone**)
replaces that password with a fresh code, which is how someone who forgot
theirs gets back in. The email-domain rule
(`TEAM_EMAIL_DOMAINS`) only applies to the shared code; anyone you put on the
list can sign in, personal email included. Switching back to the shared code
is one click.

## Where orders go

Every order is saved in the store's database and appears in the admin
console's **Orders** tab (`/admin`), newest first, with the ones needing action
on top. Nothing is emailed by the store itself. To hear about orders as they
come in, set `ORDER_WEBHOOK_URL` (below): each new order and status change is
then posted there, to a Slack channel as-is, or through Zapier or Make to
email.

## The starter catalog

The store opens with 36 items across J.F. Haden's (Mango, Espresso and Key Lime
liqueurs), Twin P Whiskey and Tropical Distillery house branding. **Costs and
stock levels are placeholders.** Set the real numbers in the admin console
(Catalog & stock → Edit) before inviting the team, hide anything you don't
stock, and upload photos for any item to replace its illustration.

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
| `TEAM_ACCESS_CODE` | The shared code team members sign in with until personal codes are switched on (Team tab). Use a short passphrase; it is not case-sensitive. **Changing it signs everyone using it out**, which is how you lock out someone who has left. Without it the store is closed, unless personal codes are on. |
| `ADMIN_PASSWORD` | Opens `/admin`. Changing it signs out every admin. Without it the admin console is off. |
| `TEAM_EMAIL_DOMAINS` | Optional, comma-separated, e.g. `tropicaldistillery.com`. With the shared code, only these email addresses may sign in. Ignored once personal codes are on: the team list decides. |
| `DATABASE_URL` | Optional Postgres connection string. When set, everything is stored in two tables the app creates itself (`tropical_merch_store` for the data, `tropical_merch_images` for photos). **Required on any host without a permanent disk**, Render and Replit included. Run `npm install` once to fetch the driver. |
| `REQUIRE_DATABASE` | Set to `1` on any host without a permanent disk. The site then refuses to start without `DATABASE_URL`, instead of keeping orders in a file that vanishes on the next restart. |
| `DATA_DIR` | Where `store.json` lives when there's no database. Default `./data`. |
| `ORDER_WEBHOOK_URL` | Optional. Every new order and status change is POSTed here as JSON with a ready-made `text` summary. A Slack incoming webhook works as-is; a Zapier or Make webhook can turn it into emails to the requester. |
| `PUBLIC_URL` | Optional. The site's address, e.g. `https://merch.tropicaldistillery.com`, so notifications link straight to the order. |
| `ORDER_PREFIX` | Order-number prefix. Default `TD` (TD-1001, TD-1002, …). |
| `TIMEZONE` | Where "today" is for needed-by dates. Default `America/New_York`. |
| `COOKIE_SECURE` | `auto` (default), `always` (set this on any HTTPS host) or `never`. |
| `SESSION_SECRET` | Optional. By default a secret is generated once and kept with the data. |
| `PORT` | Default `4100`. |

## Live setup

The production store runs entirely on Tropical Distillery's own accounts:

| | |
| --- | --- |
| Site | <https://tropical-merch.onrender.com> |
| Code | GitHub `tropicaldistillery/merch`, branch `main` |
| Web service | Render `tropical-merch`, Starter plan, Virginia region, Tropical Distillery workspace |
| Database | Render Postgres `tropical-merch-db`, `basic_256mb`, Postgres 17, Virginia. Outside connections are blocked; only the web service reaches it, through its internal address |
| Deploys | Automatic on every push to `main` |

The service's Environment page holds `TEAM_ACCESS_CODE`, `ADMIN_PASSWORD`,
`TEAM_EMAIL_DOMAINS`, `COOKIE_SECURE=always`, `REQUIRE_DATABASE=1`,
`TIMEZONE`, `PUBLIC_URL` and `DATABASE_URL` (the database's *Internal
Database URL*). Values live only there, never in this repository.

Automatic deploys depend on Render's GitHub app having access to this
repository. If deploys stop starting on their own, check
<https://github.com/settings/installations> while signed in as
`tropicaldistillery`: **Render** must be listed, with `merch` among its
repositories. Without it Render can still deploy a public repository when
asked, but not a private one, and never on its own.

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

- With **personal codes** on, each order is tied to the person whose code was
  used, and one person can be locked out without affecting anyone else. Codes
  are meant to be easy ("tropical", first name and a four-digit number: 9,000
  possibilities per name), so wrong guesses are limited per email as
  well as per address, and every order still needs the admin's approval.
  Codes are kept retrievable so the admin can look one
  up again; anyone who can read the database can already read every order, so
  hashing them would add little.
- A password someone chooses for themselves may be one they use elsewhere, so
  it is different: it's stored only as a salted scrypt hash, never shown to
  the admin or included in any export, and checked with the same per-email
  and per-address limits as codes. Setting one needs the current code or
  password and signs out every other device.
- The **shared** team code, by contrast, lets anyone who has it order under any
  name; it keeps the store private but doesn't prove identity. Restrict email
  domains, and change the code when someone leaves.
- Sessions are signed, `HttpOnly` cookies. Every request that changes data
  must carry a header a cross-site page cannot send, so other sites cannot
  place or approve orders on someone's behalf.
- Wrong codes and passwords are throttled per address, with an overall
  ceiling as well.
- Uploaded photos must already be 1200 × 900 JPG, PNG or WebP (checked from
  the file itself) and under 3 MB.
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
src/team.mjs            team list, personal codes, per-person tracking
src/images.mjs          photo checks for uploads
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
