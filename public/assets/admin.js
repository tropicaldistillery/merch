import { ART_LABELS, artwork } from "./art.js";
import {
  $,
  $$,
  addressLines,
  api,
  clear,
  clearFieldErrors,
  confirmDialog,
  createDrawer,
  el,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  localToday,
  options,
  plural,
  setAlert,
  showFieldErrors,
  statusBadge,
  toast,
} from "./core.js";
import {
  ACCOUNT_TYPES,
  BRANDS,
  CARRIERS,
  CATEGORIES,
  PURPOSES,
  STATUSES,
  TONES,
  TRANSITIONS,
  US_STATES,
  formatMoney,
  labelFor,
  trackingUrl,
} from "./shared.js";

const signinSection = $("#admin-signin");
const appSection = $("#admin-app");
const signinForm = $("#admin-signin-form");
const detailTitle = $("#detail-title");
const detailBody = $("#detail-body");
const detailFoot = $("#detail-foot");
const drawer = createDrawer($("#detail-drawer"));

const STATUS_FILTERS = [
  { id: "needs-action", label: "Needs action", statuses: ["submitted", "approved"], csv: "open" },
  { id: "submitted", label: "Submitted", statuses: ["submitted"], csv: "submitted" },
  { id: "approved", label: "Approved", statuses: ["approved"], csv: "approved" },
  { id: "shipped", label: "Shipped", statuses: ["shipped"], csv: "shipped" },
  { id: "delivered", label: "Delivered", statuses: ["delivered"], csv: "delivered" },
  { id: "closed", label: "Cancelled & declined", statuses: ["cancelled", "declined"], csv: "cancelled,declined" },
  { id: "all", label: "All", statuses: null, csv: "all" },
];

const ACTIONS = {
  approved: { label: "Approve", confirm: "Approve order", note: "Note to the requester", noteRequired: false },
  shipped: { label: "Mark shipped", confirm: "Mark shipped", note: "Note to the requester", noteRequired: false, shipment: true },
  delivered: { label: "Mark delivered", confirm: "Mark delivered", note: "Note", noteRequired: false },
  declined: { label: "Decline", confirm: "Decline order", note: "Reason — the requester sees this", noteRequired: true, danger: true },
  cancelled: { label: "Cancel order", confirm: "Cancel order", note: "Reason", noteRequired: false, danger: true },
};

const ui = {
  tab: "orders",
  status: "needs-action",
  orderQuery: "",
  catalogQuery: "",
  catalogCategory: "",
  showHidden: false,
  accountQuery: "",
};

let orders = [];
let catalog = [];
let accounts = [];

/* ------------------------------------------------------------ api + auth */

async function adminApi(path, options) {
  try {
    return await api(path, options);
  } catch (error) {
    if (error.status === 401) {
      drawer.close();
      showSignin("Your admin session ended. Sign in again.");
    }
    throw error;
  }
}

function showSignin(message = "") {
  appSection.hidden = true;
  $("#admin-chip").hidden = true;
  signinSection.hidden = false;
  setAlert($(".form-alert", signinForm), message);
  try {
    $("#admin-name").value ||= localStorage.getItem("tdmerch:admin-name") || "";
  } catch {
    // ignore
  }
  ($("#admin-name").value ? $("#admin-password") : $("#admin-name")).focus();
}

function showDisabled(message) {
  signinSection.hidden = false;
  clear(
    signinForm,
    el("div", {}, el("p", { class: "eyebrow", text: "Merch admin" }), el("h2", { text: "The admin console is off" })),
    el("p", { class: "muted", text: message })
  );
}

signinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const alertBox = $(".form-alert", signinForm);
  clearFieldErrors(signinForm);
  setAlert(alertBox, "");
  const button = $("button[type=submit]", signinForm);
  button.disabled = true;
  try {
    const name = $("#admin-name").value.trim();
    await api("/api/admin/session", { method: "POST", body: { name, password: $("#admin-password").value } });
    try {
      localStorage.setItem("tdmerch:admin-name", name);
    } catch {
      // ignore
    }
    $("#admin-password").value = "";
    await showApp();
  } catch (error) {
    setAlert(alertBox, error.message);
    showFieldErrors(signinForm, error.fieldErrors);
  } finally {
    button.disabled = false;
  }
});

$("[data-admin-sign-out]").addEventListener("click", async () => {
  try {
    await api("/api/admin/session", { method: "DELETE" });
  } finally {
    location.href = "/admin";
  }
});

/* ------------------------------------------------------------------ data */

async function loadAll() {
  const [o, c, a] = await Promise.all([
    adminApi("/api/admin/orders"),
    adminApi("/api/admin/catalog"),
    adminApi("/api/admin/accounts"),
  ]);
  orders = o.orders;
  catalog = c.items;
  accounts = a.accounts;
}

function renderAll() {
  renderKpis();
  renderOrders();
  renderCatalog();
  renderAccounts();
}

async function showApp() {
  const { admin } = await api("/api/admin/session");
  for (const node of $$("[data-admin-name]")) node.textContent = admin.name;
  signinSection.hidden = true;
  $("#admin-chip").hidden = false;
  appSection.hidden = false;
  await loadAll();
  renderAll();
  setTab(location.hash.slice(1) || "orders", { focus: false });

  const params = new URLSearchParams(location.search);
  const orderId = params.get("order");
  if (orderId) {
    history.replaceState(null, "", `/admin${location.hash}`);
    openOrder(orderId);
  }
}

$("#refresh").addEventListener("click", async () => {
  await loadAll();
  renderAll();
  toast("Up to date.");
});

// Keep the queue fresh while the console sits open, without disturbing an
// edit in progress.
setInterval(async () => {
  if (document.hidden || appSection.hidden || drawer.isOpen) return;
  try {
    await loadAll();
    renderAll();
  } catch {
    // the next tick or a manual refresh will try again
  }
}, 60_000);

/* ------------------------------------------------------------------ tabs */

function setTab(tab, { focus = true } = {}) {
  if (!["orders", "catalog", "accounts"].includes(tab)) tab = "orders";
  ui.tab = tab;
  for (const button of $$("[role=tab]")) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  for (const panel of $$("[role=tabpanel]")) panel.hidden = panel.id !== `panel-${tab}`;
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", `#${tab}`);
}

for (const button of $$("[role=tab]")) {
  button.addEventListener("click", () => setTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    const tabs = $$("[role=tab]");
    const index = tabs.indexOf(button);
    if (event.key === "ArrowRight") setTab(tabs[(index + 1) % tabs.length].dataset.tab);
    if (event.key === "ArrowLeft") setTab(tabs[(index - 1 + tabs.length) % tabs.length].dataset.tab);
  });
}
window.addEventListener("hashchange", () => setTab(location.hash.slice(1), { focus: false }));

/* ------------------------------------------------------------------ KPIs */

function renderKpis() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const submitted = orders.filter((o) => o.status === "submitted");
  const rush = submitted.filter((o) => o.shippingSpeed === "rush").length;
  const approved = orders.filter((o) => o.status === "approved").length;
  const shipped = orders.filter((o) => o.shipment?.shippedAt && new Date(o.shipment.shippedAt) >= monthStart).length;
  const spend = orders
    .filter((o) => new Date(o.createdAt) >= monthStart && o.status !== "cancelled" && o.status !== "declined")
    .reduce((sum, o) => sum + o.totalCents, 0);
  const low = catalog
    .filter((i) => i.active)
    .flatMap((i) => i.variants)
    .filter((v) => Number.isInteger(v.stock) && v.stock <= 5).length;

  const month = now.toLocaleDateString("en-US", { month: "long" });
  const tile = (label, value, sub) =>
    el("div", { class: "card kpi" }, el("p", { class: "kpi-label", text: label }), el("p", { class: "kpi-value", text: value }), el("p", { class: "kpi-sub", text: sub }));

  clear(
    $("#kpis"),
    tile("Awaiting approval", String(submitted.length), rush ? `${rush} rush` : "No rush orders"),
    tile("Ready to ship", String(approved), "Approved, not yet shipped"),
    tile("Shipped", String(shipped), `In ${month}`),
    tile("Ordered", formatMoney(spend), `Cost of ${month} orders`),
    tile("Low stock", String(low), "Options with 5 or fewer left")
  );
}

/* ---------------------------------------------------------------- orders */

function orderMatches(order) {
  const filter = STATUS_FILTERS.find((f) => f.id === ui.status);
  if (filter.statuses && !filter.statuses.includes(order.status)) return false;
  if (!ui.orderQuery) return true;
  const haystack = [
    order.number,
    order.requester.name,
    order.requester.email,
    order.shipTo.accountName,
    order.shipTo.attention,
    order.shipTo.city,
    order.shipTo.state,
    ...order.lines.flatMap((l) => [l.name, l.sku]),
  ]
    .join(" ")
    .toLowerCase();
  return ui.orderQuery.toLowerCase().split(/\s+/).every((w) => haystack.includes(w));
}

// The open queue is worked oldest-first with rush orders on top; everything
// else reads newest-first.
function sortOrders(list) {
  if (ui.status !== "needs-action" && ui.status !== "submitted" && ui.status !== "approved") return list;
  return list.slice().sort((a, b) => {
    const rush = (b.shippingSpeed === "rush") - (a.shippingSpeed === "rush");
    if (rush) return rush;
    const needA = a.neededBy || "9999-12-31";
    const needB = b.neededBy || "9999-12-31";
    if (needA !== needB) return needA < needB ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

function neededByCell(order) {
  if (!order.neededBy) return el("span", { class: "muted", text: "—" });
  const open = order.status === "submitted" || order.status === "approved";
  const overdue = open && order.neededBy < localToday();
  return el(
    "div",
    {},
    el("div", { class: overdue ? "low-text" : "", text: formatCalendarDate(order.neededBy) }),
    overdue ? el("div", { class: "cell-sub", text: "Past due" }) : null
  );
}

function shipToCell(order) {
  const s = order.shipTo;
  return el(
    "div",
    {},
    el("span", { class: `tag ${s.type === "account" ? "account" : "self"}`, text: s.type === "account" ? "Account" : "Team member" }),
    el("div", { class: "cell-main", text: s.type === "account" ? s.accountName : s.attention }),
    el("div", { class: "cell-sub", text: `${s.city}, ${s.state}` })
  );
}

function renderOrders() {
  clear(
    $("#status-chips"),
    STATUS_FILTERS.map((filter) => {
      const count = filter.statuses ? orders.filter((o) => filter.statuses.includes(o.status)).length : orders.length;
      return el(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-pressed": String(ui.status === filter.id),
          onclick: () => {
            ui.status = filter.id;
            renderOrders();
          },
        },
        filter.label,
        el("span", { class: "chip-count", text: String(count) })
      );
    })
  );

  const filter = STATUS_FILTERS.find((f) => f.id === ui.status);
  $("#export-csv").href = `/api/admin/orders.csv?status=${encodeURIComponent(filter.csv)}`;

  const visible = sortOrders(orders.filter(orderMatches));
  $("#order-count").textContent =
    `${plural(visible.length, "order")}${ui.status === "needs-action" ? " · rush first, then by needed-by date" : ""}`;

  const table = $("#orders-table");
  if (!visible.length) {
    clear(
      table,
      el("tbody", {}, el("tr", {}, el("td", { class: "empty", colspan: "7", text: orders.length ? "No orders match." : "No orders yet. They'll appear here as the team places them." })))
    );
    return;
  }

  clear(
    table,
    el(
      "thead",
      {},
      el("tr", {}, ["Order", "Placed", "Requested by", "Ships to", "Units", "Needed by", "Status"].map((h) =>
        el("th", { scope: "col", class: h === "Units" ? "num" : "", text: h })
      ))
    ),
    el(
      "tbody",
      {},
      visible.map((order) =>
        el(
          "tr",
          { class: "clickable", onclick: (event) => { if (!event.target.closest("button")) openOrder(order.id); } },
          el(
            "td",
            {},
            el("button", { type: "button", class: "row-button", text: order.number, onclick: () => openOrder(order.id) }),
            order.shippingSpeed === "rush" ? el("div", {}, el("span", { class: "tag rush", text: "Rush" })) : null
          ),
          el("td", { text: formatDate(order.createdAt) }),
          el("td", {}, el("div", { class: "cell-main", text: order.requester.name }), el("div", { class: "cell-sub", text: order.requester.email })),
          el("td", {}, shipToCell(order)),
          el("td", { class: "num" }, el("div", { text: String(order.totalUnits) }), el("div", { class: "cell-sub", text: formatMoney(order.totalCents) })),
          el("td", {}, neededByCell(order)),
          el("td", {}, statusBadge(order.status))
        )
      )
    )
  );
}

let orderSearchTimer;
$("#order-search").addEventListener("input", (event) => {
  clearTimeout(orderSearchTimer);
  orderSearchTimer = setTimeout(() => {
    ui.orderQuery = event.target.value.trim();
    renderOrders();
  }, 120);
});

/* ---------------------------------------------------------- order detail */

function kv(rows) {
  return el(
    "dl",
    { class: "kv" },
    rows.filter(Boolean).flatMap(([label, value]) => [el("dt", { text: label }), el("dd", {}, value)])
  );
}

function section(title, ...children) {
  return el("section", { class: "detail-section" }, el("h3", { text: title }), ...children);
}

function addressText(order) {
  const s = order.shipTo;
  return [
    s.type === "account" ? s.accountName : null,
    s.type === "account" ? `Attn: ${s.attention}` : s.attention,
    ...addressLines(s),
    s.phone,
  ]
    .filter(Boolean)
    .join("\n");
}

function replaceOrder(updated) {
  orders = orders.map((o) => (o.id === updated.id ? updated : o));
  renderKpis();
  renderOrders();
}

function actionForm(order, status) {
  const action = ACTIONS[status];
  const form = el("form", { class: "action-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });

  const shipmentFields = action.shipment
    ? el(
        "div",
        { class: "form-grid" },
        el(
          "div",
          { class: "field span-3" },
          el("label", { for: "carrier", text: "Carrier" }),
          el("select", { id: "carrier", name: "carrier" }, options(CARRIERS, { placeholder: "Choose…", selected: order.shipment?.carrier }))
        ),
        el(
          "div",
          { class: "field span-3" },
          el("label", { for: "trackingNumber", text: "Tracking number" }),
          el("input", { id: "trackingNumber", name: "trackingNumber", type: "text", maxlength: "60", value: order.shipment?.trackingNumber ?? "" })
        )
      )
    : null;

  const noteField = el(
    "div",
    { class: "field" },
    el("label", { for: "action-note" }, action.note, action.noteRequired ? null : el("span", { class: "optional", text: " (optional)" })),
    el("textarea", { id: "action-note", name: "note", rows: "2", maxlength: "500" })
  );

  form.append(
    alertBox,
    shipmentFields ?? "",
    noteField,
    el(
      "div",
      { class: "inline-actions" },
      el("button", { type: "submit", class: action.danger ? "btn btn-danger solid" : "btn", text: action.confirm }),
      el("button", { type: "button", class: "btn btn-secondary", text: "Never mind", onclick: () => form.remove() })
    )
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    const body = { status, note: form.elements.namedItem("note").value };
    if (action.shipment) {
      body.carrier = form.elements.namedItem("carrier").value;
      body.trackingNumber = form.elements.namedItem("trackingNumber").value;
    }
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    try {
      const { order: updated } = await adminApi(`/api/admin/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body });
      replaceOrder(updated);
      renderOrderDetail(updated);
      detailTitle.focus();
      toast(`${updated.number} is now ${labelFor(STATUSES, updated.status).toLowerCase()}.`);
      if (status === "cancelled" || status === "declined") {
        ({ items: catalog } = await adminApi("/api/admin/catalog"));
        renderCatalog();
        renderKpis();
      }
    } catch (error) {
      submit.disabled = false;
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });

  return form;
}

function trackingCorrectionForm(order) {
  const form = el("form", { class: "action-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  form.append(
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      el(
        "div",
        { class: "field span-3" },
        el("label", { for: "fix-carrier", text: "Carrier" }),
        el("select", { id: "fix-carrier", name: "carrier" }, options(CARRIERS, { selected: order.shipment.carrier }))
      ),
      el(
        "div",
        { class: "field span-3" },
        el("label", { for: "fix-tracking", text: "Tracking number" }),
        el("input", { id: "fix-tracking", name: "trackingNumber", type: "text", maxlength: "60", value: order.shipment.trackingNumber })
      )
    ),
    el(
      "div",
      { class: "inline-actions" },
      el("button", { type: "submit", class: "btn", text: "Save tracking" }),
      el("button", { type: "button", class: "btn btn-secondary", text: "Never mind", onclick: () => form.remove() })
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    try {
      const { order: updated } = await adminApi(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        body: { carrier: form.elements.namedItem("carrier").value, trackingNumber: form.elements.namedItem("trackingNumber").value },
      });
      replaceOrder(updated);
      renderOrderDetail(updated);
      detailTitle.focus();
      toast("Tracking updated.");
    } catch (error) {
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });
  return form;
}

function renderOrderDetail(order) {
  const s = order.shipTo;
  const url = order.shipment ? trackingUrl(order.shipment.carrier, order.shipment.trackingNumber) : null;
  detailTitle.textContent = order.number;

  const actionArea = el("div");
  const next = TRANSITIONS[order.status] ?? [];

  const noteInput = el("textarea", { id: "admin-note", rows: "2", maxlength: "1000", value: order.adminNote || "" });

  clear(
    detailBody,
    el(
      "div",
      { class: "detail-top" },
      statusBadge(order.status),
      order.shippingSpeed === "rush" ? el("span", { class: "tag rush", text: "Rush" }) : null,
      el(
        "span",
        { class: "muted" },
        `Placed ${formatDateTime(order.createdAt)} by `,
        el("a", { href: `mailto:${order.requester.email}?subject=${encodeURIComponent(`Merch order ${order.number}`)}`, text: order.requester.name })
      )
    ),

    next.length
      ? section(
          "Update",
          el(
            "div",
            { class: "action-row" },
            next.map((status) =>
              el("button", {
                type: "button",
                class: ACTIONS[status].danger ? "btn btn-danger btn-sm" : "btn btn-sm",
                text: ACTIONS[status].label,
                onclick: () => {
                  clear(actionArea, actionForm(order, status));
                  $("select, input, textarea", actionArea)?.focus();
                },
              })
            ),
            order.shipment
              ? el("button", {
                  type: "button",
                  class: "btn btn-secondary btn-sm",
                  text: "Edit tracking",
                  onclick: () => clear(actionArea, trackingCorrectionForm(order)),
                })
              : null
          ),
          actionArea
        )
      : order.shipment
        ? section(
            "Update",
            el("div", { class: "action-row" }, el("button", {
              type: "button",
              class: "btn btn-secondary btn-sm",
              text: "Edit tracking",
              onclick: () => clear(actionArea, trackingCorrectionForm(order)),
            })),
            actionArea
          )
        : null,

    section(
      "Ship to",
      kv([
        ["Destination", s.type === "account" ? `${s.accountName} — ${labelFor(ACCOUNT_TYPES, s.accountType)}` : "The requester (team member)"],
        ["Attention", s.attention],
        ["Address", el("div", { class: "address" }, addressLines(s).map((line) => el("div", { text: line })))],
        s.phone ? ["Phone", el("a", { href: `tel:${s.phone.replace(/[^\d+]/g, "")}`, text: s.phone })] : null,
        s.deliveryNotes ? ["Delivery notes", s.deliveryNotes] : null,
      ]),
      el(
        "div",
        { class: "inline-actions" },
        el("button", {
          type: "button",
          class: "btn btn-secondary btn-sm",
          text: "Copy address",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(addressText(order));
              toast("Address copied.");
            } catch {
              toast("Couldn't copy — select the address instead.", { tone: "error" });
            }
          },
        })
      )
    ),

    section(
      "Request",
      kv([
        ["For", labelFor(PURPOSES, order.purpose)],
        ["Needed by", order.neededBy ? formatCalendarDate(order.neededBy) : "No date given"],
        ["Shipping", order.shippingSpeed === "rush" ? `Rush — ${order.rushReason}` : "Standard"],
        order.notes ? ["Notes", order.notes] : null,
      ])
    ),

    section(
      "Items",
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "table items-table" },
          el("thead", {}, el("tr", {}, ["SKU", "Item", "Qty", "Cost"].map((h) => el("th", { class: h === "Qty" || h === "Cost" ? "num" : "", text: h })))),
          el(
            "tbody",
            {},
            order.lines.map((line) =>
              el(
                "tr",
                {},
                el("td", { text: line.sku }),
                el("td", {}, el("div", { class: "cell-main", text: line.name }), el("div", { class: "cell-sub", text: [line.variantLabel, line.unit].filter(Boolean).join(" · ") })),
                el("td", { class: "num", text: String(line.quantity) }),
                el("td", { class: "num", text: formatMoney(line.lineTotalCents) })
              )
            )
          ),
          el(
            "tfoot",
            {},
            el("tr", {}, el("td", { colspan: "2", text: "Total" }), el("td", { class: "num", text: String(order.totalUnits) }), el("td", { class: "num", text: formatMoney(order.totalCents) }))
          )
        )
      )
    ),

    order.shipment
      ? section(
          "Shipment",
          kv([
            ["Carrier", labelFor(CARRIERS, order.shipment.carrier)],
            order.shipment.trackingNumber
              ? ["Tracking", url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: order.shipment.trackingNumber }) : order.shipment.trackingNumber]
              : null,
            ["Shipped", formatDateTime(order.shipment.shippedAt)],
            order.shipment.deliveredAt ? ["Delivered", formatDateTime(order.shipment.deliveredAt)] : null,
          ])
        )
      : null,

    section(
      "Internal note",
      el("div", { class: "field" }, el("label", { class: "sr-only", for: "admin-note", text: "Internal note" }), noteInput, el("p", { class: "hint", text: "Only admins see this." })),
      el(
        "div",
        { class: "inline-actions" },
        el("button", {
          type: "button",
          class: "btn btn-secondary btn-sm",
          text: "Save note",
          onclick: async () => {
            try {
              const { order: updated } = await adminApi(`/api/admin/orders/${encodeURIComponent(order.id)}`, {
                method: "PATCH",
                body: { adminNote: noteInput.value },
              });
              replaceOrder(updated);
              toast("Note saved.");
            } catch (error) {
              toast(error.message, { tone: "error" });
            }
          },
        })
      )
    ),

    section(
      "History",
      el(
        "ol",
        { class: "timeline" },
        order.history
          .slice()
          .reverse()
          .map((entry) =>
            el(
              "li",
              {},
              el("strong", { text: labelFor(STATUSES, entry.status) }),
              ` · ${formatDateTime(entry.at)} · ${entry.by}`,
              entry.note ? el("div", { class: "cell-sub", text: entry.note }) : null
            )
          )
      )
    )
  );

  clear(
    detailFoot,
    el(
      "div",
      { class: "inline-actions" },
      el("a", { class: "btn btn-secondary", href: `/packing-slip?id=${encodeURIComponent(order.id)}`, target: "_blank", rel: "noopener", text: "Print packing slip" }),
      el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Close" })
    )
  );
}

function openOrder(id) {
  const order = orders.find((o) => o.id === id);
  if (!order) {
    toast("That order could not be found.", { tone: "error" });
    return;
  }
  renderOrderDetail(order);
  drawer.open();
}

/* --------------------------------------------------------------- catalog */

function stockSummary(item) {
  const tracked = item.variants.filter((v) => Number.isInteger(v.stock));
  if (!tracked.length) return el("span", { class: "muted", text: "Not tracked" });
  if (item.variants.length === 1 && !item.variants[0].label) {
    const v = item.variants[0];
    return el("span", { class: v.stock <= 5 ? "low-text" : "", text: String(v.stock) });
  }
  return el(
    "div",
    {},
    item.variants.map((v, i) => [
      i ? " · " : "",
      el("span", { class: Number.isInteger(v.stock) && v.stock <= 5 ? "low-text" : "", text: `${v.label} ${Number.isInteger(v.stock) ? v.stock : "—"}` }),
    ])
  );
}

function renderCatalog() {
  const query = ui.catalogQuery.toLowerCase();
  const visible = catalog.filter(
    (item) =>
      (ui.showHidden || item.active) &&
      (!ui.catalogCategory || item.category === ui.catalogCategory) &&
      (!query || `${item.name} ${item.sku}`.toLowerCase().includes(query))
  );
  $("#catalog-count").textContent = `${plural(visible.length, "item")}${catalog.some((i) => !i.active) && !ui.showHidden ? " · hidden items not shown" : ""}`;

  clear(
    $("#catalog-table"),
    el("thead", {}, el("tr", {}, ["Item", "Category", "Cost", "Available", "Max / order", "In store", ""].map((h) =>
      el("th", { scope: "col", class: h === "Cost" || h === "Max / order" ? "num" : "", text: h })
    ))),
    el(
      "tbody",
      {},
      visible.map((item) =>
        el(
          "tr",
          {},
          el("td", {}, el("div", { class: "item-cell" }, artwork(item, "thumb"), el("div", {}, el("div", { class: "cell-main", text: item.name }), el("div", { class: "cell-sub", text: `${item.sku} · ${item.unit}` })))),
          el("td", {}, el("div", { text: item.category }), el("div", { class: "cell-sub", text: labelFor(BRANDS, item.brand) })),
          el("td", { class: "num", text: formatMoney(item.costCents) }),
          el("td", {}, stockSummary(item)),
          el("td", { class: "num", text: String(item.maxPerOrder) }),
          el("td", {}, el("span", { class: `tag ${item.active ? "account" : ""}`.trim(), text: item.active ? "Shown" : "Hidden" })),
          el("td", {}, el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Edit", "aria-label": `Edit ${item.name}`, onclick: () => openItem(item) }))
        )
      )
    )
  );
}

clear($("#catalog-category"), options(CATEGORIES, { placeholder: "All categories" }));
$("#catalog-category").addEventListener("change", (event) => {
  ui.catalogCategory = event.target.value;
  renderCatalog();
});
$("#catalog-search").addEventListener("input", (event) => {
  ui.catalogQuery = event.target.value.trim();
  renderCatalog();
});
$("#show-hidden").addEventListener("change", (event) => {
  ui.showHidden = event.target.checked;
  renderCatalog();
});
$("#add-item").addEventListener("click", () => openItem(null));

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

function field(label, control, { span = 6, hint, optional = false } = {}) {
  return el(
    "div",
    { class: `field span-${span}` },
    el("label", { for: control.id }, label, optional ? el("span", { class: "optional", text: " (optional)" }) : null),
    control,
    hint ? el("p", { class: "hint", text: hint }) : null
  );
}

function openItem(item) {
  const editing = Boolean(item);
  const draft = item ?? {
    name: "", sku: "", brand: "jf-hadens", category: "Apparel", unit: "Each", costCents: 0, maxPerOrder: 6,
    description: "", tone: "mango", art: "tee", image: "", active: true,
    variants: [{ id: "default", label: "", stock: 0 }],
  };
  const hasOptions = draft.variants.length > 1 || Boolean(draft.variants[0]?.label);

  const form = el("form", { id: "item-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  const preview = el("div", { class: "span-6" });

  const tone = el("select", { id: "item-tone", name: "tone" }, options(TONES, { selected: draft.tone }));
  const art = el("select", { id: "item-art", name: "art" }, options(Object.entries(ART_LABELS), { selected: draft.art }));
  const image = el("input", { id: "item-image", name: "image", type: "url", maxlength: "500", value: draft.image, placeholder: "https://…" });

  function renderPreview() {
    clear(preview, artwork({ tone: tone.value, art: art.value, image: image.value.startsWith("https://") ? image.value : "" }, "art-preview"));
  }
  for (const control of [tone, art, image]) control.addEventListener("change", renderPreview);

  // Options and stock
  const singleStock = el("input", {
    id: "item-stock",
    type: "number",
    min: "0",
    step: "1",
    inputmode: "numeric",
    value: hasOptions || !Number.isInteger(draft.variants[0].stock) ? "" : String(draft.variants[0].stock),
  });
  const rows = el("div", { class: "variant-rows" });
  function variantRow(label = "", stock = "") {
    const row = el(
      "div",
      { class: "variant-row" },
      el("input", { type: "text", maxlength: "40", value: label, "aria-label": "Option label", placeholder: "e.g. XL" }),
      el("input", { type: "number", min: "0", step: "1", inputmode: "numeric", value: stock === null ? "" : String(stock), "aria-label": "Available", placeholder: "Not tracked" }),
      el("button", { type: "button", class: "icon-btn", "aria-label": "Remove option", text: "×", onclick: () => row.remove() })
    );
    return row;
  }
  if (hasOptions) for (const v of draft.variants) rows.append(variantRow(v.label, v.stock));

  const singleBox = el(
    "div",
    { class: "field" },
    el("label", { for: "item-stock", text: "Available units" }),
    singleStock,
    el("p", { class: "hint", text: "Leave blank for items printed or bought to order — they never show as out of stock." })
  );
  const optionsBox = el(
    "div",
    {},
    el("p", { class: "hint", text: "One row per size or option. Leave a stock box blank if that option isn't tracked." }),
    rows,
    el(
      "div",
      { class: "inline-actions" },
      el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Add option", onclick: () => rows.append(variantRow()) }),
      el("button", {
        type: "button",
        class: "btn btn-secondary btn-sm",
        text: "Add sizes S–3XL",
        onclick: () => {
          const existing = $$(".variant-row input[type=text]", rows).map((i) => i.value.trim().toLowerCase());
          for (const size of SIZES) if (!existing.includes(size.toLowerCase())) rows.append(variantRow(size, 0));
        },
      })
    )
  );

  const modeName = "item-has-options";
  const modeRadios = el(
    "div",
    { class: "chips" },
    [["single", "Single item"], ["options", "Sizes or options"]].map(([value, label]) =>
      el("label", { class: "check" }, el("input", { type: "radio", name: modeName, value, checked: (value === "options") === hasOptions }), label)
    )
  );
  function syncMode() {
    const withOptions = form.elements.namedItem(modeName).value === "options";
    singleBox.hidden = withOptions;
    optionsBox.hidden = !withOptions;
    if (withOptions && !rows.children.length) rows.append(variantRow());
  }

  const cost = el("input", { id: "item-cost", name: "costCents", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: (draft.costCents / 100).toFixed(2) });

  form.append(
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      field("Name", el("input", { id: "item-name", name: "name", type: "text", maxlength: "120", value: draft.name, autofocus: true }), { span: 4 }),
      field("SKU", el("input", { id: "item-sku", name: "sku", type: "text", maxlength: "40", value: draft.sku }), { span: 2 }),
      field("Brand", el("select", { id: "item-brand", name: "brand" }, options(BRANDS, { selected: draft.brand })), { span: 2 }),
      field("Category", el("select", { id: "item-category", name: "category" }, options(CATEGORIES, { selected: draft.category })), { span: 2 }),
      field("Sold as", el("input", { id: "item-unit", name: "unit", type: "text", maxlength: "40", value: draft.unit, placeholder: "Each, Pack of 25…" }), { span: 2 }),
      field("Cost to us ($)", cost, { span: 2 }),
      field("Max per order", el("input", { id: "item-max", name: "maxPerOrder", type: "number", min: "1", max: "999", step: "1", value: String(draft.maxPerOrder) }), { span: 2 }),
      el("div", { class: "field span-2" }, el("span", { class: "label", text: "Visibility" }), el("label", { class: "check" }, el("input", { id: "item-active", type: "checkbox", checked: draft.active }), "Show in the store")),
      field("Description", el("textarea", { id: "item-description", name: "description", rows: "3", maxlength: "600", value: draft.description }), { optional: true }),
      field("Colourway", tone, { span: 3 }),
      field("Illustration", art, { span: 3 }),
      preview,
      field("Photo URL", image, { optional: true, hint: "An https:// link to a product photo. It replaces the illustration." }),
      el("fieldset", { class: "span-6", name: "variants" }, el("legend", { text: "Stock" }), modeRadios, singleBox, optionsBox)
    )
  );

  for (const radio of form.elements.namedItem(modeName)) radio.addEventListener("change", syncMode);
  syncMode();
  renderPreview();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");

    const withOptions = form.elements.namedItem(modeName).value === "options";
    const variants = withOptions
      ? $$(".variant-row", rows).map((row) => {
          const [label, stock] = $$("input", row);
          return { label: label.value, stock: stock.value };
        })
      : [{ label: "", stock: singleStock.value }];
    const dollars = Number.parseFloat(cost.value);

    const body = {
      name: form.elements.namedItem("name").value,
      sku: form.elements.namedItem("sku").value,
      brand: form.elements.namedItem("brand").value,
      category: form.elements.namedItem("category").value,
      unit: form.elements.namedItem("unit").value,
      costCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null,
      maxPerOrder: Number(form.elements.namedItem("maxPerOrder").value),
      description: form.elements.namedItem("description").value,
      tone: tone.value,
      art: art.value,
      image: image.value,
      active: $("#item-active", form).checked,
      variants,
    };

    const submit = $("#item-save");
    submit.disabled = true;
    try {
      const { item: saved } = editing
        ? await adminApi(`/api/admin/catalog/${encodeURIComponent(item.id)}`, { method: "PUT", body })
        : await adminApi("/api/admin/catalog", { method: "POST", body });
      catalog = editing ? catalog.map((i) => (i.id === saved.id ? saved : i)) : [...catalog, saved];
      renderCatalog();
      renderKpis();
      drawer.close();
      toast(editing ? `${saved.name} saved.` : `${saved.name} added to the store.`);
    } catch (error) {
      submit.disabled = false;
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });

  detailTitle.textContent = editing ? `Edit ${draft.name}` : "Add an item";
  clear(detailBody, form);
  clear(
    detailFoot,
    el(
      "div",
      { class: "inline-actions" },
      el("button", { type: "submit", form: "item-form", class: "btn", id: "item-save", text: editing ? "Save changes" : "Add item" }),
      el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Cancel" })
    )
  );
  drawer.open();
}

/* -------------------------------------------------------------- accounts */

function renderAccounts() {
  const query = ui.accountQuery.toLowerCase();
  const visible = accounts.filter(
    (a) => !query || `${a.name} ${a.city} ${a.state} ${a.attention}`.toLowerCase().includes(query)
  );
  $("#account-count").textContent = plural(visible.length, "saved account");

  if (!visible.length) {
    clear(
      $("#accounts-table"),
      el("tbody", {}, el("tr", {}, el("td", { class: "empty", colspan: "6", text: accounts.length ? "No accounts match." : "No saved accounts yet. One is saved each time someone ships to a new account." })))
    );
    return;
  }

  clear(
    $("#accounts-table"),
    el("thead", {}, el("tr", {}, ["Account", "Location", "Receiving contact", "Orders", "Last order", ""].map((h) =>
      el("th", { scope: "col", class: h === "Orders" ? "num" : "", text: h })
    ))),
    el(
      "tbody",
      {},
      visible.map((a) =>
        el(
          "tr",
          {},
          el("td", {}, el("div", { class: "cell-main", text: a.name }), el("div", { class: "cell-sub", text: labelFor(ACCOUNT_TYPES, a.type) })),
          el("td", {}, el("div", { text: `${a.city}, ${a.state}` }), el("div", { class: "cell-sub", text: a.postalCode })),
          el("td", {}, el("div", { text: a.attention }), el("div", { class: "cell-sub", text: a.phone })),
          el("td", { class: "num", text: String(a.orderCount ?? 0) }),
          el("td", { text: a.lastOrderedAt ? formatDate(a.lastOrderedAt) : "—" }),
          el("td", {}, el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Edit", "aria-label": `Edit ${a.name}`, onclick: () => openAccount(a) }))
        )
      )
    )
  );
}

$("#account-search").addEventListener("input", (event) => {
  ui.accountQuery = event.target.value.trim();
  renderAccounts();
});

function openAccount(account) {
  const form = el("form", { id: "account-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  const text = (name, value, attrs = {}) => el("input", { id: `acct-${name}`, name, type: "text", value: value ?? "", ...attrs });

  form.append(
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      field("Account name", text("name", account.name, { maxlength: "120", autofocus: true }), { span: 4 }),
      field("Kind", el("select", { id: "acct-type", name: "type" }, options(ACCOUNT_TYPES, { selected: account.type })), { span: 2 }),
      field("Receiving contact", text("attention", account.attention, { maxlength: "100" }), { span: 3 }),
      field("Phone", text("phone", account.phone, { maxlength: "40", type: "tel" }), { span: 3 }),
      field("Street address", text("address1", account.address1, { maxlength: "120" })),
      field("Suite, unit or floor", text("address2", account.address2, { maxlength: "120" }), { optional: true }),
      field("City", text("city", account.city, { maxlength: "80" }), { span: 3 }),
      field("State", el("select", { id: "acct-state", name: "state" }, options(US_STATES, { selected: account.state })), { span: 2 }),
      field("ZIP", text("postalCode", account.postalCode, { maxlength: "10", inputmode: "numeric" }), { span: 1 }),
      field("Delivery notes", el("textarea", { id: "acct-deliveryNotes", name: "deliveryNotes", rows: "2", maxlength: "300", value: account.deliveryNotes ?? "" }), { optional: true })
    )
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    const body = Object.fromEntries(
      ["name", "type", "attention", "phone", "address1", "address2", "city", "state", "postalCode", "deliveryNotes"].map((n) => [n, form.elements.namedItem(n).value])
    );
    try {
      const { account: saved } = await adminApi(`/api/admin/accounts/${encodeURIComponent(account.id)}`, { method: "PUT", body });
      accounts = accounts.map((a) => (a.id === saved.id ? saved : a)).sort((a, b) => a.name.localeCompare(b.name));
      renderAccounts();
      drawer.close();
      toast(`${saved.name} saved.`);
    } catch (error) {
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });

  detailTitle.textContent = account.name;
  clear(detailBody, form);
  clear(
    detailFoot,
    el(
      "div",
      { class: "inline-actions" },
      el(
        "div",
        { class: "inline-actions" },
        el("button", { type: "submit", form: "account-form", class: "btn", text: "Save account" }),
        el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Cancel" })
      ),
      el("button", {
        type: "button",
        class: "btn btn-danger",
        text: "Delete",
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${account.name}?`,
            body: "It stops being offered at checkout. Past orders keep their address.",
            confirmLabel: "Delete account",
            cancelLabel: "Keep it",
            danger: true,
          });
          if (!ok) return;
          try {
            await adminApi(`/api/admin/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
            accounts = accounts.filter((a) => a.id !== account.id);
            renderAccounts();
            drawer.close();
            toast(`${account.name} deleted.`);
          } catch (error) {
            toast(error.message, { tone: "error" });
          }
        },
      })
    )
  );
  drawer.open();
}

/* ----------------------------------------------------------------- start */

try {
  await showApp();
} catch (error) {
  if (error.status === 404) showDisabled(error.message);
  else showSignin(error.status === 401 ? "" : error.message);
}
