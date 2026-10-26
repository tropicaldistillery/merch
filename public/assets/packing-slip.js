import { addressLines, api, clear, el, formatCalendarDate, formatDate } from "./core.js";
import { ACCOUNT_TYPES, PURPOSES, activeForwards, cardsToOrder, forwardLines, inHouseLines, labelFor, optionText } from "./shared.js";

const slip = document.getElementById("slip");

document.getElementById("print").addEventListener("click", () => window.print());

function block(label, ...lines) {
  return el("div", { class: "slip-block" }, el("p", { class: "kv-label", text: label }), el("div", { class: "address" }, lines.filter(Boolean).map((l) => el("div", { text: l }))));
}

// One order (?id=) or several picked in the console (?ids=a,b,c), one per page.
const params = new URLSearchParams(location.search);
const ids = (params.get("ids") || params.get("id") || "").split(",").filter(Boolean);

function slipContent(order) {
  const s = order.shipTo;
  const brand = el(
    "div",
    { class: "brand" },
    el("img", { class: "brand-mark", src: "/assets/brand/td-palm.png", alt: "", width: "50", height: "36" }),
    el("span", { class: "brand-name" }, "Tropical Distillery", el("span", { class: "brand-sub", text: "Team merch" }))
  );

  return [
    el(
      "header",
      { class: "slip-head" },
      brand,
      el("div", { class: "slip-title" }, el("h1", { text: "Packing slip" }), el("p", { class: "muted", text: `${order.number} · ${formatDate(order.createdAt)}` }))
    ),
    el(
      "div",
      { class: "slip-cols" },
      block(
        "Ship to",
        s.type === "account" ? s.accountName : null,
        s.type === "account" ? `Attn: ${s.attention}` : s.attention,
        ...addressLines(s),
        s.phone
      ),
      block(
        "Order",
        `Requested by ${order.requester.name}`,
        order.requester.email,
        s.type === "account" ? labelFor(ACCOUNT_TYPES, s.accountType) : "Ships to the team member",
        labelFor(PURPOSES, order.purpose),
        order.neededBy ? `Needed by ${formatCalendarDate(order.neededBy)}` : null,
        order.shippingSpeed === "rush" ? `RUSH — ${order.rushReason}` : "Standard shipping"
      )
    ),
    el(
      "table",
      {},
      el("thead", {}, el("tr", {}, ["", "SKU", "Item", "Option", "Qty"].map((h) => el("th", { text: h })))),
      el(
        "tbody",
        {},
        // Only what was approved, and not forwarded to someone else, goes in the
        // box; business cards come from Vistaprint, ordered by the requester.
        inHouseLines(order).filter((line) => !cardsToOrder(order).some((c) => c.line === line)).map((line) =>
          el(
            "tr",
            {},
            el("td", {}, el("div", { class: "box", "aria-hidden": "true" })),
            el("td", { text: line.sku }),
            el("td", {}, el("div", { text: line.name }), el("div", { class: "cell-sub", text: line.unit })),
            el("td", { text: optionText(line) || "—" }),
            el("td", { text: String(line.quantity) })
          )
        )
      )
    ),
    cardsToOrder(order).length
      ? block(
          "Not in this box: business cards",
          `${order.requester.name} orders these at Vistaprint`,
          ...cardsToOrder(order).map(({ line }) => `${line.quantity} × ${line.name}${optionText(line) ? ` (${optionText(line)})` : ""}`)
        )
      : null,
    ...activeForwards(order).map((forward) =>
      block(
        `Not in this box: shipping from ${forward.to.name}`,
        ...forwardLines(order, forward).map((line) => `${line.quantity} × ${line.name}${optionText(line) ? ` (${optionText(line)})` : ""}`)
      )
    ),
    s.deliveryNotes ? block("Delivery notes", s.deliveryNotes) : null,
    order.notes ? block("Requester notes", order.notes) : null,
    el("div", { class: "slip-sign" }, el("div", { text: "Packed by" }), el("div", { text: "Date" })),
  ];
}

try {
  let list;
  if (ids.length > 1) {
    const { orders } = await api("/api/admin/orders");
    const byId = new Map(orders.map((o) => [o.id, o]));
    list = ids.map((id) => byId.get(id)).filter(Boolean);
    if (!list.length) throw new Error("Those orders could not be found.");
  } else {
    const { order } = await api(`/api/admin/orders/${encodeURIComponent(ids[0] ?? "")}`);
    list = [order];
  }

  document.title = `${list.length === 1 ? `Packing slip ${list[0].number}` : `${list.length} packing slips`} · Tropical Distillery Team Merch`;
  slip.removeAttribute("aria-busy");
  clear(slip, slipContent(list[0]));
  let previous = slip;
  for (const order of list.slice(1)) {
    const next = el("article", { class: "slip" }, slipContent(order));
    previous.after(next);
    previous = next;
  }
} catch (error) {
  slip.removeAttribute("aria-busy");
  clear(
    slip,
    el("h1", { text: error.status === 401 ? "Sign in to print packing slips" : "Couldn't load this order" }),
    el("p", { class: "muted", text: error.status === 401 ? "Packing slips are part of the admin console." : error.message }),
    el("p", {}, el("a", { class: "btn", href: "/admin", text: "Open the admin console" }))
  );
}
