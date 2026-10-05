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
import { ACCOUNT_TYPES, CARRIERS, PURPOSES, formatMoney, labelFor, orderRule, trackingUrl } from "./shared.js";

const STEPS = [
  ["submitted", "Submitted"],
  ["approved", "Approved"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
];

const list = $("#order-list");

const { user } = await teamApi("/api/session");
const cart = wireHeader(user);

let orders = [];
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

function shipmentBlock(order) {
  const shipment = order.shipment;
  const url = shipment ? trackingUrl(shipment.carrier, shipment.trackingNumber) : null;
  return el(
    "div",
    {},
    el("p", { class: "kv-label", text: "Shipment" }),
    shipment
      ? el(
          "div",
          { class: "address" },
          el("div", { text: labelFor(CARRIERS, shipment.carrier) }),
          shipment.trackingNumber
            ? url
              ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: `Track ${shipment.trackingNumber}` })
              : el("div", { text: shipment.trackingNumber })
            : null,
          el("div", { class: "cell-sub", text: `Shipped ${formatDate(shipment.shippedAt)}` }),
          shipment.deliveredAt ? el("div", { class: "cell-sub", text: `Delivered ${formatDate(shipment.deliveredAt)}` }) : null
        )
      : el("p", { class: "muted", text: order.status === "cancelled" || order.status === "declined" ? "Won't ship" : "Not shipped yet" })
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
    el(
      "ul",
      { class: "order-items", "aria-label": "Items" },
      order.lines.map((line) =>
        el(
          "li",
          {},
          artwork(line, "thumb"),
          el("span", {}, el("strong", { text: `${line.quantity} × ` }), line.name, line.variantLabel ? ` (${line.variantLabel})` : "")
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
    if (!item || !variant) {
      skipped += 1;
      continue;
    }
    const stock = Number.isInteger(variant.stock) ? variant.stock : Infinity;
    // Fit the item's current rules, which may have changed since the last order.
    const { min, max, step } = orderRule(item);
    const have = cart.quantityOf(item.id);
    const room = Math.floor(Math.min(max - have, stock - cart.quantityOf(item.id, variant.id)) / step) * step;
    const want = Math.ceil(Math.max(line.quantity, min - have) / step) * step;
    const quantity = Math.min(want, room);
    if (quantity > 0 && have + quantity >= min) {
      cart.add(item.id, variant.id, quantity);
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
    ({ orders } = await teamApi("/api/orders"));
    render();
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
