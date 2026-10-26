import { artwork } from "./art.js";
import {
  $,
  addressLines,
  clear,
  confirmDialog,
  el,
  formatCalendarDate,
  formatDate,
  plural,
  statusBadge,
  teamApi,
  toast,
  wireHeader,
} from "./core.js";
import {
  ACCOUNT_TYPES,
  CARD_BOXES_PER_PERSON,
  CARRIERS,
  PURPOSES,
  cardHolderKey,
  forwardOf,
  formatMoney,
  inHouseLines,
  isCardItem,
  isDenied,
  labelFor,
  optionText,
  orderRule,
  reviewCounts,
  trackingUrl,
} from "./shared.js";

const STEPS = [
  ["submitted", "Submitted"],
  ["approved", "Approved"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
];

const list = $("#order-list");
const requestList = $("#request-list");

const { user } = await teamApi("/api/session");
const cart = wireHeader(user);

let orders = [];
let requests = [];
let catalog = [];

/* ---------------------------------------------------------------- banner */

const placed = new URLSearchParams(location.search).get("placed");
if (placed) {
  clear(
    $("#placed-banner"),
    el(
      "div",
      { class: "banner", role: "status" },
      el(
        "div",
        {},
        el("strong", { text: `Order ${placed} is in.` }),
        "The merch admin will review it. You'll see it move to approved and shipped here, with tracking once it's on its way."
      )
    )
  );
  history.replaceState(null, "", "/orders");
}

/* ----------------------------------------------------------------- cards */

function tracker(order) {
  const index = STEPS.findIndex(([id]) => id === order.status);
  return el(
    "ol",
    { class: "tracker", "aria-label": "Order progress" },
    STEPS.map(([id, label], i) =>
      el("li", {
        class: [i <= index ? "done" : "", i === index ? "current" : ""].join(" ").trim(),
        "aria-current": i === index ? "step" : null,
        text: label,
      })
    )
  );
}

function shipToBlock(order) {
  const s = order.shipTo;
  return el(
    "div",
    {},
    el("p", { class: "kv-label", text: "Ships to" }),
    el(
      "div",
      { class: "address" },
      s.type === "account"
        ? [
            el("div", { class: "cell-main", text: s.accountName }),
            el("div", { class: "cell-sub", text: labelFor(ACCOUNT_TYPES, s.accountType) }),
            el("div", { text: `Attn: ${s.attention}` }),
          ]
        : [el("div", { class: "cell-main", text: s.attention }), el("div", { class: "cell-sub", text: "Shipping to you" })],
      addressLines(s).map((line) => el("div", { text: line })),
      s.phone ? el("div", { class: "cell-sub", text: s.phone }) : null
    )
  );
}

function detailsBlock(order) {
  return el(
    "div",
    {},
    el("p", { class: "kv-label", text: "Request" }),
    el(
      "div",
      { class: "address" },
      el("div", { text: labelFor(PURPOSES, order.purpose) }),
      order.neededBy ? el("div", { text: `Needed by ${formatCalendarDate(order.neededBy)}` }) : null,
      el(
        "div",
        {},
        order.shippingSpeed === "rush" ? el("span", { class: "tag rush", text: "Rush" }) : "Standard shipping"
      ),
      order.notes ? el("div", { class: "cell-sub", text: `“${order.notes}”` }) : null
    )
  );
}

function trackingLink(shipment) {
  const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
  if (!shipment.trackingNumber) return null;
  return url
    ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: `Track ${shipment.trackingNumber}` })
    : el("div", { text: shipment.trackingNumber });
}

function shipmentLines(shipment) {
  return [
    shipment.carrier ? el("div", { text: labelFor(CARRIERS, shipment.carrier) }) : null,
    trackingLink(shipment) ??
      (shipment.carrier !== "hand" && !shipment.deliveredAt ? el("div", { class: "cell-sub", text: "Tracking number coming soon" }) : null),
    el("div", { class: "cell-sub", text: `Shipped ${formatDate(shipment.shippedAt)}` }),
    shipment.deliveredAt ? el("div", { class: "cell-sub", text: `Delivered ${formatDate(shipment.deliveredAt)}` }) : null,
  ];
}

// The merch team's own shipment, then each part someone else is shipping.
function shipmentBlock(order) {
  const shipment = order.shipment;
  const forwards = order.forwards ?? [];
  const closed = order.status === "cancelled" || order.status === "declined";
  const ours = shipment || !forwards.length || inHouseLines(order).length > 0;
  return el(
    "div",
    {},
    el("p", { class: "kv-label", text: forwards.length && !closed ? "Shipments" : "Shipment" }),
    closed
      ? el("p", { class: "muted", text: "Won't ship" })
      : [
          ours
            ? el(
                "div",
                { class: "address" },
                forwards.length ? el("div", { class: "cell-main", text: "From the merch team" }) : null,
                shipment ? shipmentLines(shipment) : el("div", { class: forwards.length ? "cell-sub" : "muted", text: "Not shipped yet" })
              )
            : null,
          forwards.map((forward) =>
            el(
              "div",
              { class: "address separate-shipment" },
              el("div", { class: "cell-main", text: `From ${forward.name}` }),
              forward.status === "shipped" && forward.shipment
                ? shipmentLines(forward.shipment)
                : el("div", { class: "cell-sub", text: "Not shipped yet" })
            )
          ),
        ]
  );
}

function orderCard(order) {
  const closed = order.status === "cancelled" || order.status === "declined";
  const last = order.history[order.history.length - 1];

  return el(
    "article",
    { class: "card order-card", "aria-labelledby": `order-${order.id}` },
    el(
      "div",
      { class: "order-head" },
      el(
        "div",
        {},
        el("h2", { id: `order-${order.id}`, text: order.number }),
        el("p", {
          class: "muted",
          text: `Placed ${formatDate(order.createdAt)} · ${plural(order.totalUnits, "unit")} · ${formatMoney(order.totalCents)} value, free to you`,
        })
      ),
      statusBadge(order.status)
    ),
    closed
      ? el(
          "p",
          { class: `callout ${order.status === "declined" ? "declined" : ""}`.trim() },
          order.status === "declined" ? "Declined" : "Cancelled",
          last?.by ? ` by ${last.by}` : "",
          last?.note ? ` — ${last.note}` : "."
        )
      : tracker(order),
    !closed && reviewCounts(order).denied
      ? el(
          "p",
          { class: "callout partial" },
          `${reviewCounts(order).approved} of ${plural(order.lines.length, "item")} approved. The rest won't ship.`,
          last?.note && last.review ? ` “${last.note}”` : ""
        )
      : null,
    el(
      "ul",
      { class: "order-items", "aria-label": "Items" },
      order.lines.map((line) =>
        el(
          "li",
          { class: isDenied(line) ? "line-denied" : "" },
          artwork(line, "thumb"),
          el(
            "span",
            {},
            el("strong", { text: `${line.quantity} × ` }),
            line.name,
            optionText(line) ? ` (${optionText(line)})` : "",
            isDenied(line)
              ? el("span", { class: "line-decision" }, el("span", { class: "tag denied", text: "Not approved" }), line.decision.reason ? ` ${line.decision.reason}` : "")
              : forwardOf(order, line)
                ? el("span", { class: "line-decision" }, `Ships separately from ${forwardOf(order, line).name}`)
                : null
          )
        )
      )
    ),
    el("div", { class: "order-grid" }, shipToBlock(order), detailsBlock(order), shipmentBlock(order)),
    el(
      "div",
      { class: "order-actions" },
      el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Order these again", onclick: () => reorder(order) }),
      order.status === "submitted"
        ? el("button", { type: "button", class: "btn btn-danger btn-sm", text: "Cancel order", onclick: () => cancel(order) })
        : null
    )
  );
}

function render() {
  list.removeAttribute("aria-busy");
  if (!orders.length) {
    clear(
      list,
      el(
        "div",
        { class: "card empty" },
        el("h2", { text: "No orders yet" }),
        el("p", { text: "When you place an order it shows up here, with its approval and shipping status." }),
        el("a", { class: "btn", href: "/shop", text: "Browse the catalog" })
      )
    );
    return;
  }
  clear(list, orders.map(orderCard));
}

/* -------------------------------------------------------------- requests */

const REQUEST_STATUS = {
  open: { label: "Waiting for stock", tone: "submitted" },
  notified: { label: "Back in stock", tone: "approved" },
  closed: { label: "Closed", tone: "declined" },
  withdrawn: { label: "Withdrawn", tone: "cancelled" },
};

function requestCard(request) {
  const status = REQUEST_STATUS[request.status] ?? REQUEST_STATUS.open;
  const detail = optionText(request);
  const latest = request.history[request.history.length - 1] ?? {};
  return el(
    "article",
    { class: "card request-card" },
    el(
      "div",
      { class: "request-main" },
      el("div", { class: "cell-main", text: `${request.quantity} × ${request.name}` }),
      el("div", { class: "cell-sub", text: [detail, `requested ${formatDate(request.createdAt)}`].filter(Boolean).join(" · ") }),
      request.note ? el("p", { class: "request-note", text: request.note }) : null,
      request.status === "closed" && latest.note ? el("p", { class: "request-note", text: `From the merch team: ${latest.note}` }) : null
    ),
    el("span", { class: `badge status-${status.tone}`, text: status.label }),
    request.status === "open"
      ? el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Withdraw", onclick: () => withdraw(request) })
      : request.status === "notified"
        ? el("a", { class: "btn btn-sm", href: "/shop", text: "Order it" })
        : null
  );
}

function renderRequests() {
  $("#requests").hidden = !requests.length;
  clear(requestList, requests.map(requestCard));
}

async function withdraw(request) {
  const ok = await confirmDialog({
    title: `Withdraw your request for ${request.name}?`,
    body: "The merch team will no longer see it, and you won't be emailed when it's back.",
    confirmLabel: "Withdraw it",
    cancelLabel: "Keep it",
  });
  if (!ok) return;
  try {
    const { request: updated } = await teamApi(`/api/requests/${encodeURIComponent(request.id)}/withdraw`, { method: "POST" });
    requests = requests.map((r) => (r.id === updated.id ? updated : r));
    renderRequests();
    toast("Request withdrawn.");
  } catch (error) {
    toast(error.message, { tone: "error" });
  }
}

/* --------------------------------------------------------------- actions */

async function cancel(order) {
  const ok = await confirmDialog({
    title: `Cancel ${order.number}?`,
    body: "The items go back into stock and the order won't ship. This can't be undone.",
    confirmLabel: "Cancel order",
    danger: true,
  });
  if (!ok) return;
  try {
    const { order: updated } = await teamApi(`/api/orders/${encodeURIComponent(order.id)}/cancel`, { method: "POST" });
    orders = orders.map((o) => (o.id === updated.id ? updated : o));
    render();
    toast(`${updated.number} was cancelled.`);
  } catch (error) {
    toast(error.message, { tone: "error" });
    await load();
  }
}

async function reorder(order) {
  if (!catalog.length) ({ items: catalog } = await teamApi("/api/catalog"));
  let added = 0;
  let skipped = 0;
  for (const line of order.lines) {
    const item = catalog.find((i) => i.id === line.itemId);
    const variant = item?.variants.find((v) => v.id === line.variantId);
    const colors = item?.colors ?? [];
    const color = colors.includes(line.color) ? line.color : "";
    // A business card goes back in with the same details, to edit there.
    const card = isCardItem(item) ? line.card ?? null : null;
    if (!item || !variant || (colors.length && !color) || (isCardItem(item) && !card)) {
      skipped += 1;
      continue;
    }
    const stock = Number.isInteger(variant.stock) ? variant.stock : Infinity;
    // Fit the item's current rules, which may have changed since the last order.
    const { min, max, step } = orderRule(item);
    const have = cart.quantityOf(item.id);
    const room = Math.floor(Math.min(max - have, stock - cart.quantityOf(item.id, variant.id)) / step) * step;
    const want = Math.ceil(Math.max(line.quantity, min - have) / step) * step;
    // Business cards: no more than each person's share, counting the cart.
    const holderRoom = card
      ? CARD_BOXES_PER_PERSON -
        cart.lines().filter((l) => l.itemId === item.id && l.card && cardHolderKey(l.card) === cardHolderKey(card)).reduce((sum, l) => sum + l.quantity, 0)
      : Infinity;
    const quantity = Math.min(want, room, holderRoom);
    if (quantity > 0 && have + quantity >= min) {
      cart.add(item.id, variant.id, quantity, color, card);
      added += 1;
    }
    if (quantity < line.quantity) skipped += 1;
  }
  if (!added) {
    toast("None of those items can be added right now — they're out of stock or no longer offered.", { tone: "error" });
    return;
  }
  if (skipped) {
    try {
      sessionStorage.setItem("tdmerch:reorder-note", "Some items couldn't be added in full because of stock or order limits.");
    } catch {
      // ignore
    }
  }
  location.href = "/shop?cart=open";
}

/* ------------------------------------------------------------------ load */

async function load() {
  try {
    [{ orders }, { requests }] = await Promise.all([teamApi("/api/orders"), teamApi("/api/requests")]);
    render();
    renderRequests();
    if (location.hash === "#requests" && requests.length) $("#requests").scrollIntoView({ block: "start" });
  } catch (error) {
    list.removeAttribute("aria-busy");
    clear(
      list,
      el(
        "div",
        { class: "card empty" },
        el("h2", { text: "Your orders didn't load" }),
        el("p", { text: error.message }),
        el("button", { type: "button", class: "btn", text: "Try again", onclick: load })
      )
    );
  }
}

await load();
