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
  COLOR_OPTIONS,
  MAX_IMAGES,
  OPEN_STATUSES,
  PURPOSES,
  STATUSES,
  TONES,
  TRANSITIONS,
  US_STATES,
  byCategory,
  formatMoney,
  generateSku,
  itemImages,
  labelFor,
  quantityRuleText,
  suggestedMaxPerOrder,
  suggestedMinPerOrder,
  trackByPerson,
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
  teamQuery: "",
  selected: new Set(),
  trackerPeriod: "all",
  trackerQuery: "",
};

let orders = [];
let catalog = [];
let accounts = [];
let team = { mode: "shared", people: [], suggestions: [] };

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
  const [o, c, a, t] = await Promise.all([
    adminApi("/api/admin/orders"),
    adminApi("/api/admin/catalog"),
    adminApi("/api/admin/accounts"),
    adminApi("/api/admin/team"),
  ]);
  orders = o.orders;
  catalog = c.items;
  accounts = a.accounts;
  team = t;
}

function renderAll() {
  renderKpis();
  renderOrders();
  renderTracker();
  renderCatalog();
  renderAccounts();
  renderTeam();
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
  if (document.hidden || appSection.hidden || drawer.isOpen || bulkMode) return;
  try {
    await loadAll();
    renderAll();
  } catch {
    // the next tick or a manual refresh will try again
  }
}, 60_000);

/* ------------------------------------------------------------------ tabs */

function setTab(tab, { focus = true } = {}) {
  if (!["orders", "tracker", "catalog", "accounts", "team"].includes(tab)) tab = "orders";
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
  shownOrders = visible;
  // Only orders on screen stay selected, so a bulk change never reaches one
  // hidden by the filter or search.
  const shown = new Set(visible.map((o) => o.id));
  for (const id of ui.selected) if (!shown.has(id)) ui.selected.delete(id);
  $("#order-count").textContent =
    `${plural(visible.length, "order")}${ui.status === "needs-action" ? " · rush first, then by needed-by date" : ""}`;

  const table = $("#orders-table");
  if (!visible.length) {
    renderBulkBar();
    clear(
      table,
      el("tbody", {}, el("tr", {}, el("td", { class: "empty", colspan: "8", text: orders.length ? "No orders match." : "No orders yet. They'll appear here as the team places them." })))
    );
    return;
  }

  clear(
    table,
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { scope: "col", class: "select-col" }, el("input", {
          type: "checkbox",
          id: "select-all-orders",
          "aria-label": "Select every order shown",
          onchange: (event) => {
            for (const order of shownOrders) {
              if (event.target.checked) ui.selected.add(order.id);
              else ui.selected.delete(order.id);
            }
            syncSelection();
          },
        })),
        ["Order", "Placed", "Requested by", "Ships to", "Units", "Needed by", "Status"].map((h) =>
          el("th", { scope: "col", class: h === "Units" ? "num" : "", text: h })
        )
      )
    ),
    el(
      "tbody",
      {},
      visible.map((order, index) =>
        el(
          "tr",
          { class: "clickable", onclick: (event) => { if (!event.target.closest("button, input, label")) openOrder(order.id); } },
          el(
            "td",
            { class: "select-col" },
            el("label", { class: "select-hit" }, el("input", {
              type: "checkbox",
              class: "row-check",
              "data-index": String(index),
              "aria-label": `Select ${order.number}`,
              checked: ui.selected.has(order.id),
              onclick: (event) => pickOrder(index, event.target.checked, event.shiftKey),
            }))
          ),
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
  syncSelection();
}

/* ------------------------------------------------------ bulk order edits */

const BULK_STATUSES = ["approved", "shipped", "delivered", "declined", "cancelled"];
const MAX_BULK = 200;
const BULK_TITLES = {
  approved: (n) => `Approve ${n}`,
  shipped: (n) => `Mark ${n} shipped`,
  delivered: (n) => `Mark ${n} delivered`,
  declined: (n) => `Decline ${n}`,
  cancelled: (n) => `Cancel ${n}`,
  note: (n) => `Add a note to ${n}`,
};
const BULK_DONE = {
  approved: "Approved",
  shipped: "Marked shipped:",
  delivered: "Marked delivered:",
  declined: "Declined",
  cancelled: "Cancelled",
  note: "Added the note to",
};

let shownOrders = [];
let lastPicked = null;

function selectedOrders() {
  return shownOrders.filter((o) => ui.selected.has(o.id));
}

// Shift-click ticks or unticks everything between this row and the last one.
function pickOrder(index, checked, shift) {
  const from = shift && lastPicked !== null ? Math.min(lastPicked, index) : index;
  const to = shift && lastPicked !== null ? Math.max(lastPicked, index) : index;
  for (const order of shownOrders.slice(from, to + 1)) {
    if (checked) ui.selected.add(order.id);
    else ui.selected.delete(order.id);
  }
  lastPicked = index;
  syncSelection();
}

function syncSelection() {
  for (const box of $$("#orders-table .row-check")) {
    box.checked = ui.selected.has(shownOrders[Number(box.dataset.index)]?.id);
    box.closest("tr").classList.toggle("selected", box.checked);
  }
  const all = $("#select-all-orders");
  if (all) {
    const count = selectedOrders().length;
    all.checked = count > 0 && count === shownOrders.length;
    all.indeterminate = count > 0 && count < shownOrders.length;
  }
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $("#bulk-bar");
  const picked = selectedOrders();
  bar.hidden = picked.length === 0;
  if (!picked.length) return clear(bar);

  const ids = picked.map((o) => o.id).join(",");
  const tooMany = picked.length > MAX_BULK;
  const button = (action, label, count, { danger = false } = {}) =>
    el("button", {
      type: "button",
      class: `btn btn-sm ${danger ? "btn-danger" : "btn-secondary"}`,
      disabled: tooMany,
      title: count < picked.length ? `${count} of the ${picked.length} selected can be changed this way` : null,
      text: count < picked.length ? `${label} (${count})` : label,
      onclick: () => openBulk(action),
    });

  clear(
    bar,
    el("strong", { class: "bulk-count", text: `${plural(picked.length, "order")} selected` }),
    tooMany ? el("span", { class: "low-text", text: `Select at most ${MAX_BULK} at a time.` }) : null,
    el(
      "div",
      { class: "bulk-actions" },
      BULK_STATUSES.map((status) => {
        const count = picked.filter((o) => TRANSITIONS[o.status]?.includes(status)).length;
        return count ? button(status, ACTIONS[status].label, count, { danger: ACTIONS[status].danger }) : null;
      }),
      button("note", "Add internal note", picked.length),
      el("a", { class: "btn btn-sm btn-secondary", href: `/packing-slip?ids=${ids}`, target: "_blank", rel: "noopener", text: "Print packing slips" }),
      el("a", { class: "btn btn-sm btn-secondary", href: `/api/admin/orders.csv?ids=${ids}`, text: "Export CSV" }),
      el("button", {
        type: "button",
        class: "link-button",
        text: "Clear selection",
        onclick: () => {
          ui.selected.clear();
          syncSelection();
        },
      })
    )
  );
}

function openBulk(action) {
  const picked = selectedOrders();
  const targets = action === "note" ? picked : picked.filter((o) => TRANSITIONS[o.status]?.includes(action));
  const left = picked.filter((o) => !targets.includes(o));
  const shipping = action === "shipped";
  if (!targets.length) return;

  detailTitle.textContent = BULK_TITLES[action](plural(targets.length, "order"));
  const form = el("form", { class: "action-form bulk-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });

  const who = (o) => (o.shipTo.type === "account" ? o.shipTo.accountName : o.requester.name);
  const list = shipping
    ? el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "table bulk-tracking" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Order" }), el("th", { scope: "col", text: "Tracking number" }))),
          el(
            "tbody",
            {},
            targets.map((o) =>
              el(
                "tr",
                {},
                el("td", {}, el("div", { class: "cell-main", text: o.number }), el("div", { class: "cell-sub", text: `${who(o)} · ${o.shipTo.city}, ${o.shipTo.state}` })),
                el(
                  "td",
                  {},
                  el(
                    "div",
                    { class: "field" },
                    el("label", { class: "sr-only", for: `bulk-track-${o.id}`, text: `Tracking number for ${o.number}` }),
                    el("input", { id: `bulk-track-${o.id}`, name: `tracking.${o.id}`, type: "text", maxlength: "60", autocomplete: "off" })
                  )
                )
              )
            )
          )
        )
      )
    : el(
        "ul",
        { class: "bulk-list" },
        targets.map((o) =>
          el("li", {}, el("strong", { text: o.number }), ` · ${o.requester.name} · ${who(o)}, ${o.shipTo.city} `, statusBadge(o.status))
        )
      );

  const noteField =
    action === "note"
      ? el(
          "div",
          { class: "field" },
          el("label", { for: "bulk-admin-note", text: "Note to add" }),
          el("textarea", { id: "bulk-admin-note", name: "adminNote", rows: "3", maxlength: "500" }),
          el("p", { class: "hint", text: "Added on a new line to each order's internal note. Only admins see it." })
        )
      : el(
          "div",
          { class: "field" },
          el(
            "label",
            { for: "bulk-note" },
            ACTIONS[action].noteRequired ? "Reason — every requester sees this" : "Note to the requesters",
            ACTIONS[action].noteRequired ? null : el("span", { class: "optional", text: " (optional)" })
          ),
          el("textarea", { id: "bulk-note", name: "note", rows: "2", maxlength: "500" }),
          el("p", { class: "hint", text: "The same note goes into each order's history." })
        );

  form.append(
    alertBox,
    shipping
      ? el(
          "div",
          { class: "form-grid" },
          el(
            "div",
            { class: "field span-3" },
            el("label", { for: "bulk-carrier", text: "Carrier" }),
            el("select", { id: "bulk-carrier", name: "carrier" }, options(CARRIERS, { placeholder: "Choose…" })),
            el("p", { class: "hint", text: "Hand-delivered and other carriers don't need tracking numbers." })
          )
        )
      : "",
    list,
    left.length
      ? el("p", {
          class: "fine",
          text: `${plural(left.length, "selected order")} can't be changed this way and will be left as ${left.length === 1 ? "it is" : "they are"}: ${left
            .map((o) => `${o.number} (${labelFor(STATUSES, o.status).toLowerCase()})`)
            .join(", ")}.`,
        })
      : "",
    noteField,
    el(
      "div",
      { class: "inline-actions" },
      el("button", {
        type: "submit",
        class: action === "declined" || action === "cancelled" ? "btn btn-danger solid" : "btn",
        text: BULK_TITLES[action](plural(targets.length, "order")),
      }),
      el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Never mind" })
    )
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    const body = { action, orderIds: targets.map((o) => o.id) };
    if (action === "note") body.adminNote = form.elements.namedItem("adminNote").value;
    else body.note = form.elements.namedItem("note").value;
    if (shipping) {
      body.carrier = form.elements.namedItem("carrier").value;
      body.tracking = Object.fromEntries(targets.map((o) => [o.id, form.elements.namedItem(`tracking.${o.id}`).value]));
    }
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    try {
      const result = await adminApi("/api/admin/orders/bulk", { method: "POST", body });
      const changed = new Map(result.orders.map((o) => [o.id, o]));
      orders = orders.map((o) => changed.get(o.id) ?? o);
      drawer.close();
      renderKpis();
      renderOrders();
      renderTracker();
      const skipped = result.skipped.length
        ? ` Left alone: ${result.skipped.map((s) => `${s.number || "an order"} (${s.reason.replace(/\.$/, "").toLowerCase()})`).join(", ")}.`
        : "";
      toast(`${BULK_DONE[action]} ${plural(result.orders.length, "order")}.${skipped}`, { timeout: skipped ? 9000 : 5000 });
      if (action === "cancelled" || action === "declined") {
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

  clear(detailBody, form);
  clear(detailFoot);
  drawer.open();
  $("select, textarea", form)?.focus();
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
  renderTracker();
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
                el("td", {}, el("div", { class: "cell-main", text: line.name }), el("div", { class: "cell-sub", text: [line.color, line.variantLabel, line.unit].filter(Boolean).join(" · ") }), supplierLine(catalog.find((i) => i.id === line.itemId))),
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

/* --------------------------------------------------------------- tracker */

// Periods start at local midnight on the first day; `to` is exclusive.
function trackerRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const at = (date) => date.toISOString();
  switch (period) {
    case "this-month":
      return { from: at(new Date(y, m, 1)), to: "" };
    case "last-month":
      return { from: at(new Date(y, m - 1, 1)), to: at(new Date(y, m, 1)) };
    case "this-quarter":
      return { from: at(new Date(y, Math.floor(m / 3) * 3, 1)), to: "" };
    case "this-year":
      return { from: at(new Date(y, 0, 1)), to: "" };
    default:
      return { from: "", to: "" };
  }
}

function trackerRows() {
  return trackByPerson(orders, { ...trackerRange(ui.trackerPeriod), people: team.people });
}

function itemText(item) {
  const detail = [item.color, item.variantLabel].filter(Boolean).join(", ");
  return `${item.quantity} × ${item.name}${detail ? ` (${detail})` : ""}`;
}

function renderTracker() {
  const range = trackerRange(ui.trackerPeriod);
  const query = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
  $("#tracker-csv").href = `/api/admin/tracker.csv${query ? `?${query}` : ""}`;

  const words = ui.trackerQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = trackerRows().filter((row) => {
    if (!words.length) return true;
    const haystack = [row.name, row.email, ...row.items.flatMap((i) => [i.name, i.sku, i.color])].join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  const ordered = rows.filter((r) => r.orders);
  $("#tracker-count").textContent =
    `${plural(ordered.length, "person", "people")} ordered · ${plural(ordered.reduce((n, r) => n + r.orders, 0), "order")} · ` +
    `${plural(ordered.reduce((n, r) => n + r.units, 0), "unit")} · ${formatMoney(ordered.reduce((n, r) => n + r.valueCents, 0))}`;

  const table = $("#tracker-table");
  if (!rows.length) {
    clear(table, el("tbody", {}, el("tr", {}, el("td", { class: "empty", colspan: "6", text: orders.length ? "Nobody matches." : "No orders yet. Each person's orders will add up here." }))));
    return;
  }

  clear(
    table,
    el("thead", {}, el("tr", {}, ["Person", "Orders", "Units", "Order value", "What they ordered", "Last order"].map((h) =>
      el("th", { scope: "col", class: ["Orders", "Units", "Order value"].includes(h) ? "num" : "", text: h })
    ))),
    el(
      "tbody",
      {},
      rows.map((row) => {
        const top = row.items.slice(0, 3).map(itemText).join(" · ");
        const more = row.items.length > 3 ? ` · and ${plural(row.items.length - 3, "more item")}` : "";
        return el(
          "tr",
          { class: "clickable", onclick: (event) => { if (!event.target.closest("button")) openTrackerPerson(row.key); } },
          el(
            "td",
            {},
            el("button", { type: "button", class: "row-button", text: row.name || row.email, onclick: () => openTrackerPerson(row.key) }),
            el("div", { class: "cell-sub", text: row.email }),
            row.onList || team.mode !== "personal" ? null : el("span", { class: "tag", text: "Not on the team list" })
          ),
          el("td", { class: "num" }, el("div", { text: String(row.orders) }), row.openOrders ? el("div", { class: "cell-sub", text: `${row.openOrders} open` }) : null),
          el("td", { class: "num", text: String(row.units) }),
          el("td", { class: "num", text: formatMoney(row.valueCents) }),
          el("td", {}, row.items.length ? el("div", { class: "cell-sub tracker-items", text: top + more }) : el("span", { class: "muted", text: "Nothing yet" })),
          el("td", { text: row.lastOrderAt ? formatDate(row.lastOrderAt) : "—" })
        );
      })
    )
  );
}

function openTrackerPerson(key) {
  const row = trackerRows().find((r) => r.key === key);
  if (!row) return;
  const period = $("#tracker-period").selectedOptions[0]?.textContent ?? "All time";
  const placed = row.orderIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean).reverse();

  detailTitle.textContent = row.name || row.email;
  clear(
    detailBody,
    el(
      "div",
      { class: "detail-top" },
      el("span", { class: "tag", text: period }),
      el("a", { href: `mailto:${row.email}`, text: row.email })
    ),
    section(
      "Totals",
      kv([
        ["Orders", row.openOrders ? `${row.orders} (${row.openOrders} still open)` : String(row.orders)],
        ["Units", String(row.units)],
        ["Order value", formatMoney(row.valueCents)],
        row.firstOrderAt ? ["First order", formatDate(row.firstOrderAt)] : null,
        row.lastOrderAt ? ["Last order", formatDate(row.lastOrderAt)] : null,
      ])
    ),
    section(
      "Items",
      row.items.length
        ? el(
            "div",
            { class: "table-wrap" },
            el(
              "table",
              { class: "table items-table" },
              el("thead", {}, el("tr", {}, ["Item", "Qty", "Value", "Orders"].map((h) => el("th", { class: h === "Item" ? "" : "num", text: h })))),
              el(
                "tbody",
                {},
                row.items.map((item) =>
                  el(
                    "tr",
                    {},
                    el("td", {}, el("div", { class: "cell-main", text: item.name }), el("div", { class: "cell-sub", text: [item.sku, item.color, item.variantLabel].filter(Boolean).join(" · ") })),
                    el("td", { class: "num", text: String(item.quantity) }),
                    el("td", { class: "num", text: formatMoney(item.valueCents) }),
                    el("td", { class: "num", text: String(item.orders) })
                  )
                )
              )
            )
          )
        : el("p", { class: "muted", text: "No orders in this period." })
    ),
    placed.length
      ? section(
          "Orders",
          el(
            "div",
            { class: "table-wrap" },
            el(
              "table",
              { class: "table items-table" },
              el("thead", {}, el("tr", {}, ["Order", "Placed", "Ships to", "Units", "Status"].map((h) => el("th", { class: h === "Units" ? "num" : "", text: h })))),
              el(
                "tbody",
                {},
                placed.map((order) =>
                  el(
                    "tr",
                    {},
                    el("td", {}, el("button", { type: "button", class: "row-button", text: order.number, onclick: () => openOrder(order.id) })),
                    el("td", { text: formatDate(order.createdAt) }),
                    el("td", { text: order.shipTo.type === "account" ? order.shipTo.accountName : "Themselves" }),
                    el("td", { class: "num", text: String(order.totalUnits) }),
                    el("td", {}, statusBadge(order.status))
                  )
                )
              )
            )
          )
        )
      : null
  );
  clear(detailFoot, el("div", { class: "inline-actions" }, el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Close" })));
  drawer.open();
}

$("#tracker-period").addEventListener("change", (event) => {
  ui.trackerPeriod = event.target.value;
  renderTracker();
});

let trackerSearchTimer;
$("#tracker-search").addEventListener("input", (event) => {
  clearTimeout(trackerSearchTimer);
  trackerSearchTimer = setTimeout(() => {
    ui.trackerQuery = event.target.value.trim();
    renderTracker();
  }, 120);
});

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

/** "From Ten 10 Design LLC · #1602-14 · Order online ↗", for admins only. */
function supplierLine(item) {
  const s = item?.supplier ?? {};
  const who = s.company || s.contact;
  const text = [who ? `From ${who}` : "", s.itemNumber].filter(Boolean).join(" · ");
  const link = /^https?:\/\//i.test(s.link || "")
    ? el("a", { href: s.link, target: "_blank", rel: "noopener noreferrer", text: "Order online ↗", "aria-label": `Order ${item.name} online (opens in a new tab)` })
    : null;
  if (!text && !link) return null;
  return el("div", { class: "cell-sub supplier-line" }, text, text && link ? " · " : "", link);
}

function visibleCatalog() {
  const query = ui.catalogQuery.toLowerCase();
  return catalog.filter(
    (item) =>
      (ui.showHidden || item.active) &&
      (!ui.catalogCategory || item.category === ui.catalogCategory) &&
      (!query || `${item.name} ${item.sku}`.toLowerCase().includes(query))
  );
}

function renderCatalog() {
  const visible = visibleCatalog();
  $("#catalog-count").textContent = `${plural(visible.length, "item")}${catalog.some((i) => !i.active) && !ui.showHidden ? " · hidden items not shown" : ""}`;
  $("#catalog-list").hidden = Boolean(bulkMode);
  $("#bulk-editor").hidden = !bulkMode;
  $("#bulk-edit").hidden = Boolean(bulkMode);
  if (bulkMode) return renderBulkEditor(visible);
  bulkCountNode = null;
  clear($("#catalog-bulk-bar"));
  $("#catalog-bulk-bar").hidden = true;
  measureBulkScroll();

  clear(
    $("#catalog-table"),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col", class: "move-col" }, el("span", { class: "sr-only", text: "Order" })),
      ["Item", "Category", "Cost", "Available", "Per order", "In store", ""].map((h) =>
        el("th", { scope: "col", class: h === "Cost" ? "num" : "", text: h })
      ))),
    el(
      "tbody",
      {},
      visible.map((item, index) => dropTarget(
        el(
          "tr",
          { class: index && visible[index - 1].category !== item.category ? "category-start" : "" },
          el("td", { class: "move-col" }, moveTools(item)),
          el("td", {}, el("div", { class: "item-cell" }, artwork(item, "thumb"), el("div", {}, el("div", { class: "cell-main", text: item.name }), el("div", { class: "cell-sub", text: [item.sku, item.unit, item.colors?.length ? plural(item.colors.length, "color") : ""].filter(Boolean).join(" · ") }), supplierLine(item)))),
          el("td", {}, el("div", { text: item.category }), el("div", { class: "cell-sub", text: labelFor(BRANDS, item.brand) })),
          el("td", { class: "num", text: formatMoney(item.costCents) }),
          el("td", {}, stockSummary(item)),
          el("td", { class: "per-order", text: quantityRuleText(item).replace(/ per order$/, "") }),
          el("td", {}, el("span", { class: `tag ${item.active ? "account" : ""}`.trim(), text: item.active ? "Shown" : "Hidden" })),
          el("td", {}, el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Edit", "aria-label": `Edit ${item.name}`, onclick: () => openItem(item) }))
        ), item)
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

/* ----------------------------------------------------------- bulk editor */

// Many items at once, in one of three views:
//   "all"  every item's details, stock and where to order it, as a grid
//   "set"  every option's stock level, one row per option
//   "add"  a delivery: how many of each option arrived
// What's typed survives searching, filtering and switching views (counts and
// deliveries mean different things, so switching between those two starts
// the numbers over), and all of it is saved together, shown or not.
let bulkMode = null;
const fieldEdits = new Map(); // item id → { field: value as typed }
const stockEdits = new Map(); // item id + option id → value as typed
const bulkSelected = new Set();
const stockKey = (item, variant) => `${item.id}\u0000${variant.id}`;
let pendingOrder = null; // item ids in a new store order, until saved
let bulkSort = null; // { key, dir } while the grid is sorted by a column

const EDIT_FIELDS = [
  "name", "sku", "category", "brand", "unit", "costCents", "minPerOrder", "maxPerOrder", "orderIncrement", "active",
  "description", "supplier.company", "supplier.itemNumber", "supplier.link",
];
const NUMBER_FIELDS = ["minPerOrder", "maxPerOrder", "orderIncrement"];

function centsText(cents) {
  return Number.isInteger(cents) ? (cents / 100).toFixed(2) : "";
}

function parseDollars(text) {
  const raw = String(text ?? "").replace(/[$,\s]/g, "");
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** A field's saved value, as the editor shows it. */
function currentValue(item, field) {
  if (field === "costCents") return centsText(item.costCents);
  if (field === "minPerOrder" || field === "orderIncrement") return String(item[field] ?? 1);
  if (field === "maxPerOrder") return String(item.maxPerOrder);
  if (field === "active") return item.active;
  if (field.startsWith("supplier.")) return item.supplier?.[field.slice(9)] ?? "";
  return item[field] ?? "";
}

function editedValue(item, field) {
  const edits = fieldEdits.get(item.id);
  return edits && field in edits ? edits[field] : currentValue(item, field);
}

function isChanged(item, field) {
  const edits = fieldEdits.get(item.id);
  if (!edits || !(field in edits)) return false;
  const typed = edits[field];
  if (field === "active") return typed !== item.active;
  if (field === "costCents") return parseDollars(typed) !== item.costCents;
  // SKUs are saved in capitals, and a blank one keeps the item's own.
  if (field === "sku") return String(typed).trim() !== "" && String(typed).trim().toUpperCase() !== item.sku;
  return String(typed).trim() !== String(currentValue(item, field)).trim();
}

function setField(item, field, value) {
  fieldEdits.set(item.id, { ...fieldEdits.get(item.id), [field]: value });
}

function itemPatches() {
  const patches = [];
  for (const item of catalog) {
    const patch = {};
    for (const field of EDIT_FIELDS) {
      if (!isChanged(item, field)) continue;
      const typed = fieldEdits.get(item.id)[field];
      let value = typeof typed === "string" ? typed.trim() : typed;
      // Anything that isn't a number goes as null, and the server says what's wrong.
      if (field === "costCents") value = Number.isNaN(parseDollars(typed)) ? null : parseDollars(typed);
      if (field === "sku") value = value.toUpperCase();
      if (NUMBER_FIELDS.includes(field) && value !== "") value = Number.isFinite(Number(value)) ? Number(value) : null;
      if (field.startsWith("supplier.")) (patch.supplier ??= {})[field.slice(9)] = value;
      else patch[field] = value;
    }
    if (Object.keys(patch).length) patches.push({ id: item.id, patch });
  }
  return patches;
}

function stockChanges() {
  const changes = [];
  for (const item of catalog) {
    for (const variant of item.variants) {
      const raw = (stockEdits.get(stockKey(item, variant)) ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (bulkMode === "add") changes.push({ itemId: item.id, variantId: variant.id, add: n });
      else if (n !== variant.stock) changes.push({ itemId: item.id, variantId: variant.id, from: variant.stock, to: n });
    }
  }
  return changes;
}

function changedItemCount() {
  return new Set([...itemPatches().map((p) => p.id), ...stockChanges().map((c) => c.itemId)]).size;
}

/* -------- order: the store lists items in this order within each category */

function currentOrder() {
  return pendingOrder ?? catalog.map((i) => i.id);
}

function setOrder(order, focusId = null) {
  pendingOrder = order.join("\n") === catalog.map((i) => i.id).join("\n") ? null : order;
  renderCatalog();
  if (focusId) $(`[data-move="${CSS.escape(focusId)}"]`)?.focus();
}

/** Items as the store will list them: by category, then the (new) order. */
function storeOrdered(list) {
  const rank = new Map(currentOrder().map((id, i) => [id, i]));
  return byCategory([...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)));
}

function moveItem(id, targetId, before) {
  if (id === targetId) return;
  const [a, b] = [catalog.find((i) => i.id === id), catalog.find((i) => i.id === targetId)];
  if (!a || !b) return;
  if (a.category !== b.category) {
    toast("Items stay with their category. Change an item's category to move it to another.", { tone: "error" });
    return;
  }
  const order = currentOrder().filter((x) => x !== id);
  order.splice(order.indexOf(targetId) + (before ? 0 : 1), 0, id);
  // In the bulk editor a new order waits for Save; in the catalog list it is
  // saved straight away.
  if (bulkMode) setOrder(order, id);
  else commitOrder(order, id);
}

// Moves in the catalog list are saved together a moment after the last one,
// with an Undo back to the order before the first.
let orderSaveTimer = null;
let orderBeforeMoves = null;

function commitOrder(order, focusId = null) {
  orderBeforeMoves ??= catalog.map((i) => i.id);
  const rank = new Map(order.map((id, i) => [id, i]));
  catalog = byCategory([...catalog].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)));
  renderCatalog();
  if (focusId) $(`[data-move="${CSS.escape(focusId)}"]`)?.focus();
  clearTimeout(orderSaveTimer);
  orderSaveTimer = setTimeout(saveCatalogOrder, 700);
}

async function saveCatalogOrder() {
  const previous = orderBeforeMoves;
  orderBeforeMoves = null;
  try {
    await adminApi("/api/admin/catalog/bulk", { method: "POST", body: { order: catalog.map((i) => i.id) } });
    toast("Store order saved.", { action: previous ? { label: "Undo", onClick: () => commitOrder(previous) } : null });
  } catch (error) {
    toast(`The new order wasn't saved: ${error.message}`, { tone: "error" });
    ({ items: catalog } = await adminApi("/api/admin/catalog"));
    renderCatalog();
  }
}

/** Up or down one place among the items shown in its category. */
function nudgeItem(item, step) {
  const sameCategory = storeOrdered(visibleCatalog()).filter((i) => i.category === item.category);
  const neighbor = sameCategory[sameCategory.findIndex((i) => i.id === item.id) + step];
  if (neighbor) moveItem(item.id, neighbor.id, step < 0);
}

/* -------- sorting: a view of the grid, until it's made the store order */

const SORTS = {
  Item: (i) => String(editedValue(i, "name")).toLowerCase(),
  SKU: (i) => String(editedValue(i, "sku")).toUpperCase(),
  Category: (i) => CATEGORIES.indexOf(editedValue(i, "category")),
  Brand: (i) => labelFor(BRANDS, editedValue(i, "brand")),
  Unit: (i) => String(editedValue(i, "unit")).toLowerCase(),
  "Cost ($)": (i) => parseDollars(editedValue(i, "costCents")),
  Min: (i) => Number(editedValue(i, "minPerOrder")),
  Max: (i) => Number(editedValue(i, "maxPerOrder")),
  Steps: (i) => Number(editedValue(i, "orderIncrement")),
  Stock: (i) =>
    i.variants.reduce((sum, v) => {
      const typed = (stockEdits.get(stockKey(i, v)) ?? "").trim();
      const n = typed !== "" ? Number(typed) : v.stock;
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0),
  "In store": (i) => (editedValue(i, "active") ? 0 : 1),
  Supplier: (i) => String(editedValue(i, "supplier.company")).toLowerCase(),
  "Their item #": (i) => String(editedValue(i, "supplier.itemNumber")).toLowerCase(),
  "Order link": (i) => String(editedValue(i, "supplier.link")).toLowerCase(),
  Description: (i) => String(editedValue(i, "description")).toLowerCase(),
};

function sortedRows(list) {
  const rows = storeOrdered(list);
  if (!bulkSort) return rows;
  const value = SORTS[bulkSort.key];
  const dir = bulkSort.dir === "desc" ? -1 : 1;
  const compare = (a, b) => {
    const [x, y] = [value(a), value(b)];
    if (typeof x === "number" && typeof y === "number") return (Number.isNaN(x) ? Infinity : x) - (Number.isNaN(y) ? Infinity : y);
    return String(x).localeCompare(String(y), undefined, { numeric: true });
  };
  return [...rows].sort((a, b) => dir * compare(a, b));
}

function toggleSort(key) {
  if (!bulkSort || bulkSort.key !== key) bulkSort = { key, dir: "asc" };
  else if (bulkSort.dir === "asc") bulkSort = { key, dir: "desc" };
  else bulkSort = null;
  renderCatalog();
}

/** Make the sorted view the store order: the items shown are re-sequenced
 * in the places they already hold, category by category. */
function useSortedOrder() {
  const sorted = sortedRows(visibleCatalog());
  const order = currentOrder();
  const result = [...order];
  for (const category of new Set(sorted.map((i) => i.category))) {
    const items = sorted.filter((i) => i.category === category);
    const ids = new Set(items.map((i) => i.id));
    const slots = order.map((id, at) => (ids.has(id) ? at : -1)).filter((at) => at >= 0);
    items.forEach((item, k) => {
      result[slots[k]] = item.id;
    });
  }
  bulkSort = null;
  setOrder(result);
  toast("This becomes the store's order when you save.");
}

async function setBulkMode(mode) {
  const countsChange = (bulkMode === "add") !== (mode === "add");
  const losing = mode === null ? changedItemCount() + (pendingOrder ? 1 : 0) : countsChange ? new Set(stockChanges().map((c) => c.itemId)).size : 0;
  if (losing) {
    const ok = await confirmDialog({
      title: mode === null ? "Discard your changes?" : "Discard the stock you typed?",
      body:
        mode === null
          ? [changedItemCount() ? `Changes to ${plural(changedItemCount(), "item")}` : "", pendingOrder ? "the new order" : ""].filter(Boolean).join(" and ").replace(/^./, (c) => c.toUpperCase()) + " haven't been saved."
          : `Stock typed for ${plural(losing, "item")} hasn't been saved. ${mode === "add" ? "A delivery adds to what's there" : "Stock levels replace what's there"}, so those numbers start over.`,
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (!ok) return;
  }
  if (mode === null) {
    fieldEdits.clear();
    stockEdits.clear();
    bulkSelected.clear();
    pendingOrder = null;
    bulkSort = null;
  } else if (countsChange) {
    stockEdits.clear();
  }
  bulkMode = mode;
  renderCatalog();
  if (mode) $("#bulk-editor input:not([disabled]):not([type=checkbox])")?.focus();
}

let bulkCountNode = null;
let bulkSaveButton = null;

function updateBulkCount() {
  if (!bulkCountNode) return;
  const count = changedItemCount();
  const parts = [count ? `${plural(count, "item")} changed` : "", pendingOrder ? "new order" : ""].filter(Boolean);
  bulkCountNode.textContent = parts.length ? parts.join(" · ") : "No changes yet";
  bulkSaveButton.disabled = !parts.length;
}

const BULK_HINTS = {
  all: "Edit any cell. Click a heading to sort; drag ⠿ or use ▲▼ to change the store's order. Tick items to change one thing on all of them.",
  set: "Type the new count for anything that's changed.",
  add: "Type how many arrived; they're added to what's there.",
};

function renderCatalogBulkBar() {
  const bar = $("#catalog-bulk-bar");
  bar.hidden = false;
  const modeButton = (mode, label) =>
    el("button", { type: "button", class: "chip", "aria-pressed": String(bulkMode === mode), text: label, onclick: () => setBulkMode(mode) });
  bulkCountNode = el("strong", { class: "bulk-count", "aria-live": "polite" });
  bulkSaveButton = el("button", { type: "submit", form: "bulk-editor", class: "btn btn-sm", text: "Save changes" });
  clear(
    bar,
    el("div", { class: "chips bulk-modes", role: "group", "aria-label": "What to edit" },
      modeButton("all", "All details"), modeButton("set", "Stock levels"), modeButton("add", "Add a delivery")),
    el("span", { class: "muted bulk-hint", text: BULK_HINTS[bulkMode] }),
    el("div", { class: "bulk-actions" },
      bulkCountNode,
      bulkSaveButton,
      el("button", { type: "button", class: "btn btn-sm btn-secondary", text: "Done", onclick: () => setBulkMode(null) })),
    bulkMode === "set"
      ? el("div", { class: "bulk-sorted" },
          el("button", {
            type: "button",
            class: "btn btn-sm btn-secondary",
            text: "Set all shown to 0",
            onclick: () => {
              let count = 0;
              for (const item of visibleCatalog()) {
                for (const variant of item.variants) {
                  if (!Number.isInteger(variant.stock)) continue;
                  stockEdits.set(stockKey(item, variant), "0");
                  count += 1;
                }
              }
              renderCatalog();
              toast(`${plural(count, "stock level")} set to 0. Check them, then save.`);
            },
          }),
          el("span", { class: "muted", text: "Items that aren't tracked stay that way." }))
      : null,
    bulkMode === "all" && bulkSort
      ? el("div", { class: "bulk-sorted" },
          el("span", { text: `Sorted by ${bulkSort.key.replace(" ($)", "")}, ${bulkSort.dir === "asc" ? "A→Z / low→high" : "Z→A / high→low"}.` }),
          el("button", { type: "button", class: "btn btn-sm", text: "Use this order in the store", onclick: useSortedOrder }),
          el("button", { type: "button", class: "link-button", text: "Back to store order", onclick: () => { bulkSort = null; renderCatalog(); } }))
      : null,
    el("div", { class: "bulk-apply", id: "bulk-apply" })
  );
  updateBulkCount();
  renderApplyPanel();
}

// "Change one thing on every ticked item": it fills in their cells, to be
// checked and saved like anything typed.
const APPLY_FIELDS = [
  { field: "category", label: "Category", choices: () => CATEGORIES.map((c) => ({ id: c, label: c })) },
  { field: "brand", label: "Brand", choices: () => BRANDS },
  { field: "active", label: "In store", choices: () => [{ id: "shown", label: "Shown" }, { id: "hidden", label: "Hidden" }] },
  { field: "costCents", label: "Cost ($)", type: "text", inputmode: "decimal" },
  { field: "minPerOrder", label: "Min per order", type: "number" },
  { field: "maxPerOrder", label: "Max per order", type: "number" },
  { field: "orderIncrement", label: "Sold in steps of", type: "number" },
  { field: "unit", label: "Unit", type: "text" },
  { field: "supplier.company", label: "Supplier", type: "text" },
  { field: "supplier.link", label: "Order link", type: "text" },
];
let applyField = "category";

function renderApplyPanel() {
  const panel = $("#bulk-apply");
  if (!panel) return;
  const picked = catalog.filter((i) => bulkSelected.has(i.id));
  panel.hidden = bulkMode !== "all" || !picked.length;
  if (panel.hidden) return clear(panel);
  const spec = APPLY_FIELDS.find((f) => f.field === applyField);
  const value = spec.choices
    ? el("select", { id: "bulk-apply-value", "aria-label": `New ${spec.label.toLowerCase()}` }, options(spec.choices()))
    : el("input", { id: "bulk-apply-value", type: spec.type, inputmode: spec.inputmode, min: spec.type === "number" ? "1" : null, "aria-label": `New ${spec.label.toLowerCase()}` });
  clear(
    panel,
    el("strong", { text: `${plural(picked.length, "item")} ticked:` }),
    el("label", { class: "sr-only", for: "bulk-apply-field", text: "Change" }),
    el(
      "select",
      { id: "bulk-apply-field", onchange: (event) => { applyField = event.target.value; renderApplyPanel(); } },
      APPLY_FIELDS.map((f) => el("option", { value: f.field, selected: f.field === applyField, text: `Set ${f.label.toLowerCase()}` }))
    ),
    value,
    el("button", {
      type: "button",
      class: "btn btn-sm",
      text: `Apply to ${plural(picked.length, "item")}`,
      onclick: () => {
        const raw = value.value;
        if (!spec.choices && !raw.trim() && !spec.field.startsWith("supplier.") && spec.field !== "unit") {
          value.focus();
          return toast(`Enter the ${spec.label.toLowerCase()} first.`, { tone: "error" });
        }
        for (const item of picked) setField(item, spec.field, spec.field === "active" ? raw === "shown" : raw);
        renderCatalog();
        toast(`${spec.label} set on ${plural(picked.length, "item")}. Check them, then save.`);
      },
    }),
    el("button", { type: "button", class: "link-button", text: "Untick all", onclick: () => { bulkSelected.clear(); renderCatalog(); } })
  );
}

// One editable cell. `name` matches the server's field errors.
function bulkCell(item, field, control) {
  const wrap = el("div", { class: `field bulk-cell${isChanged(item, field) ? " dirty" : ""}` }, control);
  const changed = () => {
    wrap.classList.toggle("dirty", isChanged(item, field));
    updateBulkCount();
  };
  control.addEventListener(control.tagName === "SELECT" || control.type === "checkbox" ? "change" : "input", () => {
    setField(item, field, control.type === "checkbox" ? control.checked : control.value);
    changed();
  });
  return wrap;
}

function bulkText(item, field, attrs = {}) {
  const errorName = { "supplier.link": "supplierLink" }[field] ?? field;
  return bulkCell(item, field, el(attrs.rows ? "textarea" : "input", {
    type: attrs.rows ? null : attrs.type ?? "text",
    name: `${item.id}.${errorName}`,
    value: String(editedValue(item, field)),
    "aria-label": `${attrs.label} for ${item.name}`,
    ...attrs,
    label: null,
  }));
}

function bulkStockInputs(item, { compact }) {
  return item.variants.map((variant) => {
    const tracked = Number.isInteger(variant.stock);
    const key = stockKey(item, variant);
    const input = el("input", {
      type: "number",
      name: `stock.${item.id}.${variant.id}`,
      min: "0",
      max: "100000",
      step: "1",
      inputmode: "numeric",
      class: "stock-input",
      value: stockEdits.get(key) ?? (tracked ? String(variant.stock) : ""),
      placeholder: tracked ? "" : "—",
      "aria-label": `Stock of ${item.name}${variant.label ? `, ${variant.label}` : ""}`,
      onfocus: (event) => event.target.select(),
    });
    const wrap = el("label", { class: "field bulk-stock" }, compact && variant.label ? el("span", { class: "bulk-stock-label", text: variant.label }) : null, input);
    input.addEventListener("input", () => {
      stockEdits.set(key, input.value);
      const raw = input.value.trim();
      wrap.classList.toggle("dirty", raw !== "" && Number(raw) !== variant.stock);
      updateBulkCount();
    });
    const raw = (stockEdits.get(key) ?? "").trim();
    if (raw !== "" && Number(raw) !== variant.stock) wrap.classList.add("dirty");
    return wrap;
  });
}

let dragId = null;

// ⠿ and ▲▼ on a row. The handle drags; with it focused, the arrow keys move.
function moveTools(item) {
  const sorted = Boolean(bulkSort);
  return el(
    "div",
    { class: "move-tools" },
    el("button", { type: "button", class: "move-btn", text: "▲", disabled: sorted, "aria-label": `Move ${item.name} up`, onclick: () => nudgeItem(item, -1) }),
    el("span", {
      class: "grip",
      text: "⠿",
      tabindex: sorted ? null : "0",
      role: "button",
      draggable: sorted ? null : "true",
      "data-move": item.id,
      "aria-disabled": sorted ? "true" : null,
      "aria-label": `Move ${item.name}: drag, or press the up and down arrow keys`,
      title: sorted ? "Back to store order to move items" : "Drag to move",
      onkeydown: (event) => {
        if (sorted || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        nudgeItem(item, event.key === "ArrowUp" ? -1 : 1);
      },
      ondragstart: (event) => {
        dragId = item.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        const row = event.target.closest("tr");
        event.dataTransfer.setDragImage(row, 40, 24);
        row.classList.add("dragging");
      },
      ondragend: (event) => {
        dragId = null;
        event.target.closest("tr")?.classList.remove("dragging");
        $$(".drop-before, .drop-after").forEach((r) => r.classList.remove("drop-before", "drop-after"));
      },
    }),
    el("button", { type: "button", class: "move-btn", text: "▼", disabled: sorted, "aria-label": `Move ${item.name} down`, onclick: () => nudgeItem(item, 1) })
  );
}

function dropTarget(row, item) {
  row.addEventListener("dragover", (event) => {
    if (!dragId || dragId === item.id) return;
    event.preventDefault();
    const box = row.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    row.classList.toggle("drop-before", before);
    row.classList.toggle("drop-after", !before);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const before = row.classList.contains("drop-before");
    row.classList.remove("drop-before", "drop-after");
    if (dragId) moveItem(dragId, item.id, before);
  });
  return row;
}

function renderBulkGrid(visible) {
  const form = $("#bulk-editor");
  visible = sortedRows(visible);
  const allTicked = visible.length > 0 && visible.every((i) => bulkSelected.has(i.id));
  const head = ["Item", "SKU", "Category", "Brand", "Unit", "Cost ($)", "Min", "Max", "Steps", "Stock", "In store", "Supplier", "Their item #", "Order link", "Description"];
  const heading = (h, i) => {
    const sorted = bulkSort?.key === h ? bulkSort.dir : null;
    return el(
      "th",
      { scope: "col", class: i === 0 ? "sticky-col item-col" : "", "aria-sort": sorted ? (sorted === "asc" ? "ascending" : "descending") : null },
      el("button", { type: "button", class: `sort-btn${sorted ? " sorted" : ""}`, onclick: () => toggleSort(h) },
        h, el("span", { class: "sort-mark", "aria-hidden": "true", text: sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕" }))
    );
  };
  clear(
    form,
    el(
      "table",
      { class: "table bulk-table" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", class: "select-col sticky-col" }, el("input", {
          type: "checkbox",
          checked: allTicked,
          "aria-label": "Tick every item shown",
          onchange: (event) => {
            for (const item of visible) event.target.checked ? bulkSelected.add(item.id) : bulkSelected.delete(item.id);
            renderCatalog();
          },
        })),
        head.map(heading))),
      el("tbody", {}, visible.length
        ? visible.map((item, index) => dropTarget(
            el("tr", { class: [bulkSelected.has(item.id) ? "selected" : "", index && visible[index - 1].category !== item.category ? "category-start" : ""].filter(Boolean).join(" ") },
              el("td", { class: "select-col sticky-col" }, el("div", { class: "row-tools" }, el("input", {
                type: "checkbox",
                checked: bulkSelected.has(item.id),
                "aria-label": `Tick ${item.name}`,
                onchange: (event) => {
                  event.target.checked ? bulkSelected.add(item.id) : bulkSelected.delete(item.id);
                  event.target.closest("tr").classList.toggle("selected", event.target.checked);
                  renderApplyPanel();
                },
              }), moveTools(item))),
              el("td", { class: "sticky-col item-col" },
                el("div", { class: "item-cell" }, artwork(item, "thumb"),
                  el("div", { class: "bulk-name" },
                    bulkText(item, "name", { label: "Name", maxlength: "120" }),
                    item.active ? null : el("div", { class: "cell-sub", text: "Hidden" })))),
              el("td", {}, bulkText(item, "sku", { label: "SKU", maxlength: "40", class: "w-sku", autocapitalize: "characters", spellcheck: "false" })),
              el("td", {}, bulkCell(item, "category", el("select", { name: `${item.id}.category`, class: "w-cat", "aria-label": `Category for ${item.name}` }, options(CATEGORIES, { selected: editedValue(item, "category") })))),
              el("td", {}, bulkCell(item, "brand", el("select", { name: `${item.id}.brand`, class: "w-brand", "aria-label": `Brand for ${item.name}` }, options(BRANDS, { selected: editedValue(item, "brand") })))),
              el("td", {}, bulkText(item, "unit", { label: "Unit", maxlength: "40", class: "w-unit" })),
              el("td", {}, bulkText(item, "costCents", { label: "Cost in dollars", inputmode: "decimal", class: "w-num" })),
              el("td", {}, bulkText(item, "minPerOrder", { label: "Minimum per order", type: "number", min: "1", class: "w-num" })),
              el("td", {}, bulkText(item, "maxPerOrder", { label: "Maximum per order", type: "number", min: "1", class: "w-num" })),
              el("td", {}, bulkText(item, "orderIncrement", { label: "Sold in steps of", type: "number", min: "1", class: "w-num" })),
              el("td", {}, el("div", { class: "bulk-stocks" }, bulkStockInputs(item, { compact: true }))),
              el("td", {}, bulkCell(item, "active", el("input", { type: "checkbox", name: `${item.id}.active`, checked: editedValue(item, "active"), "aria-label": `Show ${item.name} in the store` }))),
              el("td", {}, bulkText(item, "supplier.company", { label: "Supplier", maxlength: "120", class: "w-supplier" })),
              el("td", {}, bulkText(item, "supplier.itemNumber", { label: "Their item number", maxlength: "160", class: "w-supplier" })),
              el("td", {}, bulkText(item, "supplier.link", { label: "Order link", maxlength: "500", class: "w-link", placeholder: "https://…" })),
              el("td", {}, bulkText(item, "description", { label: "Description", rows: "2", maxlength: "600", class: "w-desc" }))
            ), item)
          )
        : el("tr", {}, el("td", { class: "empty", colspan: String(head.length + 1), text: "No items match." })))
    )
  );
}

// One row per option, for counting stock or taking in a delivery.
function renderStockRows(visible) {
  const form = $("#bulk-editor");
  const rows = storeOrdered(visible).flatMap((item) =>
    item.variants.map((variant, i) => {
      const tracked = Number.isInteger(variant.stock);
      const key = stockKey(item, variant);
      const note = el("div", { class: "cell-sub stock-note" });
      const describe = (value) => {
        const raw = String(value ?? "").trim();
        const n = Number(raw);
        if (!raw || !Number.isInteger(n)) return "";
        if (bulkMode === "add") return tracked && n > 0 ? `→ ${variant.stock + n}` : "";
        if (!tracked) return "starts tracking";
        const diff = n - variant.stock;
        return diff ? `${diff > 0 ? "+" : "−"}${Math.abs(diff)}` : "";
      };
      note.textContent = describe(stockEdits.get(key));
      const input = el("input", {
        type: "number",
        name: `stock.${item.id}.${variant.id}`,
        min: bulkMode === "add" ? "1" : "0",
        max: "100000",
        step: "1",
        inputmode: "numeric",
        class: "stock-input",
        value: stockEdits.get(key) ?? (bulkMode === "set" && tracked ? String(variant.stock) : ""),
        placeholder: tracked ? (bulkMode === "add" ? "0" : "") : "—",
        disabled: bulkMode === "add" && !tracked,
        "aria-label": `${bulkMode === "add" ? "Units arriving" : "New stock"} for ${item.name}${variant.label ? `, ${variant.label}` : ""}`,
        // Typing replaces the number rather than adding to it.
        onfocus: (event) => event.target.select(),
        oninput: (event) => {
          stockEdits.set(key, event.target.value);
          note.textContent = describe(event.target.value);
          updateBulkCount();
        },
        onkeydown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const inputs = $$("#bulk-editor input:not([disabled])");
          inputs[inputs.indexOf(event.target) + 1]?.focus();
        },
      });
      return el(
        "tr",
        { class: i === 0 ? "group-start" : "" },
        i === 0
          ? el("td", { rowspan: String(item.variants.length) },
              el("div", { class: "item-cell" }, artwork(item, "thumb"),
                el("div", {}, el("div", { class: "cell-main", text: item.name }), el("div", { class: "cell-sub", text: [item.sku, item.active ? "" : "Hidden"].filter(Boolean).join(" · ") }))))
          : null,
        el("td", { text: variant.label || "—" }),
        el("td", { class: `num ${tracked && variant.stock <= 5 ? "low-text" : ""}`.trim(), text: tracked ? String(variant.stock) : "Not tracked" }),
        el("td", {}, el("div", { class: "field stock-field" }, input, note))
      );
    })
  );
  clear(
    form,
    el(
      "table",
      { class: "table stock-table" },
      el("thead", {}, el("tr", {}, ["Item", "Option", "Available now", bulkMode === "add" ? "Arriving" : "New stock"].map((h) =>
        el("th", { scope: "col", class: h === "Available now" ? "num" : "", text: h })
      ))),
      el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { class: "empty", colspan: "4", text: "No items match." })))
    )
  );
}

function renderBulkEditor(visible) {
  renderCatalogBulkBar();
  if (bulkMode === "all") renderBulkGrid(visible);
  else renderStockRows(visible);
  measureBulkScroll();
}

$("#bulk-editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  const items = itemPatches();
  const stock = stockChanges();
  const order = pendingOrder;
  if (!items.length && !stock.length && !order) return;
  bulkSaveButton.disabled = true;
  try {
    const result = await adminApi("/api/admin/catalog/bulk", { method: "POST", body: { items, stock, ...(order ? { order } : {}) } });
    if (order) {
      ({ items: catalog } = await adminApi("/api/admin/catalog"));
    } else {
      const fresh = new Map(result.items.map((item) => [item.id, item]));
      catalog = catalog.map((item) => fresh.get(item.id) ?? item);
    }
    fieldEdits.clear();
    stockEdits.clear();
    bulkSelected.clear();
    pendingOrder = null;
    bulkSort = null;
    bulkMode = null;
    renderCatalog();
    renderKpis();
    const adjusted = result.adjusted.length
      ? ` ${plural(result.adjusted.length, "stock level")} also took account of orders placed while you were editing.`
      : "";
    const what = [result.changed ? `changes to ${plural(result.changed, "item")}` : "", order ? "the new store order" : ""].filter(Boolean).join(" and ");
    toast(`Saved ${what}.${adjusted}`, { timeout: adjusted ? 9000 : 5000 });
  } catch (error) {
    bulkSaveButton.disabled = false;
    toast(error.message, { tone: "error", timeout: 8000 });
    const errors = error.fieldErrors ?? {};
    if (Object.keys(errors).length) {
      // Problems may be on rows the filters hide, or in the details grid.
      ui.catalogQuery = "";
      ui.catalogCategory = "";
      ui.showHidden = true;
      $("#catalog-search").value = "";
      $("#catalog-category").value = "";
      $("#show-hidden").checked = true;
      if (bulkMode === "set" && Object.keys(errors).some((key) => !key.startsWith("stock."))) bulkMode = "all";
      renderCatalog();
      showFieldErrors(form, errors);
    }
  }
});

$("#bulk-edit").addEventListener("click", () => setBulkMode("all"));

/**
 * A copy of a wide table's sideways scrollbar, stuck to the bottom of the
 * window while the table is on screen, so it can be scrolled without first
 * scrolling down to the end of the table. Returns a function to call when
 * the table's width may have changed.
 */
function stickyScrollbar(scroller) {
  const inner = el("div", { class: "hscroll-inner" });
  const bar = el("div", { class: "hscroll", "aria-hidden": "true", hidden: true }, inner);
  scroller.after(bar);
  scroller.classList.add("has-hscroll");
  // Each follows the other; setting an equal value fires nothing back.
  bar.addEventListener("scroll", () => {
    if (scroller.scrollLeft !== bar.scrollLeft) scroller.scrollLeft = bar.scrollLeft;
  });
  scroller.addEventListener("scroll", () => {
    if (bar.scrollLeft !== scroller.scrollLeft) bar.scrollLeft = scroller.scrollLeft;
  });
  const measure = () => {
    inner.style.width = `${scroller.scrollWidth}px`;
    bar.hidden = scroller.hidden || scroller.scrollWidth <= scroller.clientWidth + 1;
    bar.scrollLeft = scroller.scrollLeft;
  };
  new ResizeObserver(measure).observe(scroller);
  return measure;
}

const measureBulkScroll = stickyScrollbar($("#bulk-editor"));

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

/* ------------------------------------------------------- product photos */

// Every photo is redrawn at exactly this size before upload, so all product
// cards match. The server refuses anything else.
const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 900;

async function uniformPhoto(blob, fit) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("That file couldn't be opened as a photo. Try a JPG or PNG.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  // "whole": fit inside on white, nothing cut off. "fill": cover, cropping edges.
  const scale = (fit === "fill" ? Math.max : Math.min)(PHOTO_WIDTH / bitmap.width, PHOTO_HEIGHT / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (PHOTO_WIDTH - w) / 2, (PHOTO_HEIGHT - h) / 2, w, h);
  bitmap.close?.();
  const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let out = await encode("image/webp", 0.86);
  // Safari can't encode WebP and quietly returns a PNG instead.
  if (!out || out.type !== "image/webp") out = await encode("image/jpeg", 0.88);
  return out;
}

async function uploadPhoto(blob) {
  let response;
  try {
    response = await fetch("/api/admin/images", {
      method: "POST",
      headers: { "Content-Type": blob.type, "X-Requested-With": "fetch", Accept: "application/json" },
      credentials: "same-origin",
      body: blob,
    });
  } catch {
    throw new Error("The photo couldn't be uploaded. Check your connection.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `Upload failed (${response.status}).`);
  return data.url;
}

/**
 * The colours an item comes in, ticked from the standard list. Team members
 * pick one when they order.
 */
function colorChoices(selected, onChange) {
  const boxes = COLOR_OPTIONS.map(({ name, hex }) => {
    const dot = el("span", { class: "swatch-dot", "aria-hidden": "true" });
    dot.style.setProperty("--swatch", hex);
    const input = el("input", { type: "checkbox", name: "colors", value: name, checked: selected.includes(name) });
    input.addEventListener("change", onChange);
    return el("label", { class: `color-choice${hex.toUpperCase() === "#FFFFFF" ? " light" : ""}` }, input, dot, el("span", { text: name }));
  });
  const setAll = (checked) => {
    for (const label of boxes) label.querySelector("input").checked = checked;
    onChange();
  };
  const element = el(
    "fieldset",
    { class: "field span-6 color-choices" },
    el("legend", { class: "label", text: "Color choices" }),
    el("p", { class: "hint", text: "Tick every color this item comes in; team members choose one when they order. Leave them all unticked if it only comes one way." }),
    el("div", { class: "color-grid" }, boxes),
    el(
      "div",
      { class: "inline-actions" },
      el("button", { type: "button", class: "link-button", text: "Select all", onclick: () => setAll(true) }),
      el("button", { type: "button", class: "link-button", text: "Clear", onclick: () => setAll(false) })
    )
  );
  return {
    element,
    get value() {
      return boxes.map((label) => label.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
    },
  };
}

/**
 * The item's photos: upload several at once by choosing files or dropping
 * them on the box. Each is resized to the standard size and stored. The first
 * is the main photo; any can be tagged with a colour so the store shows it
 * when that colour is picked.
 */
function photoGallery({ images, colors, onChange }) {
  // Photos uploaded in this visit keep their original, so changing the fit
  // re-crops them.
  let photos = images.map((i) => ({ url: i.url, color: i.color ?? "", source: null }));
  const status = el("p", { class: "hint", "aria-live": "polite" });
  const list = el("ul", { class: "photo-list", "aria-label": "Photos" });
  // Server errors about photos land here.
  const anchor = el("input", { type: "hidden", name: "image" });
  const file = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", multiple: true, class: "sr-only", id: "photo-file" });
  const fitName = "photo-fit";
  const fits = el(
    "div",
    { class: "chips", role: "radiogroup", "aria-label": "How to fit photos" },
    [["whole", "Show the whole photo"], ["fill", "Fill the frame"]].map(([value, label]) =>
      el("label", { class: "check" }, el("input", { type: "radio", name: fitName, value, checked: value === "whole" }), label)
    )
  );
  const chooseLabel = el("span", { text: "Upload images" });
  const fit = () => fits.querySelector("input:checked").value;

  function changed() {
    render();
    onChange();
  }

  async function prepare(blob) {
    return uploadPhoto(await uniformPhoto(blob, fit()));
  }

  async function add(files) {
    const usable = files.filter((f) => !f.type || f.type.startsWith("image/"));
    if (!usable.length) {
      status.textContent = "Those files aren't images. Use JPG, PNG or WebP photos.";
      return;
    }
    const room = MAX_IMAGES - photos.length;
    if (room <= 0) {
      status.textContent = `An item can have up to ${MAX_IMAGES} photos. Remove one to add another.`;
      return;
    }
    const batch = usable.slice(0, room);
    let done = 0;
    for (const blob of batch) {
      status.textContent = batch.length > 1 ? `Uploading ${done + 1} of ${batch.length}…` : "Uploading…";
      try {
        photos.push({ url: await prepare(blob), color: "", source: blob });
        done += 1;
        changed();
      } catch (error) {
        status.textContent = error.message;
        return;
      }
    }
    status.textContent =
      (done === 1 ? "Photo added." : `${done} photos added.`) +
      (usable.length > batch.length ? ` ${usable.length - batch.length} left out: the limit is ${MAX_IMAGES}.` : "") +
      " Save the item to keep them.";
  }

  file.addEventListener("change", () => {
    add([...file.files]);
    file.value = "";
  });

  const drop = el(
    "div",
    { class: "photo-drop" },
    el("label", { class: "btn btn-sm", for: "photo-file", tabindex: "0", role: "button", onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } } }, chooseLabel),
    file,
    el("span", { class: "muted", text: "or drag photos here" })
  );
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const type of ["dragleave", "dragend"]) drop.addEventListener(type, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const dropped = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (dropped.length) add(dropped);
    else status.textContent = "Drop photo files (JPG, PNG or WebP).";
  });

  for (const radio of fits.querySelectorAll("input")) {
    radio.addEventListener("change", async () => {
      const fresh = photos.filter((p) => p.source);
      if (!fresh.length) return;
      status.textContent = "Re-cropping…";
      try {
        for (const photo of fresh) photo.url = await prepare(photo.source);
        status.textContent = "Photos re-cropped. Save the item to keep them.";
        changed();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  function tile(photo, index) {
    const offered = colors();
    const colorSelect = offered.length
      ? el(
          "select",
          { "aria-label": `Color shown in photo ${index + 1}` },
          el("option", { value: "", text: "Any color" }),
          offered.map((c) => el("option", { value: c, text: c, selected: photo.color === c }))
        )
      : null;
    colorSelect?.addEventListener("change", () => {
      photo.color = colorSelect.value;
      onChange();
    });
    const move = (to) => {
      photos.splice(to, 0, ...photos.splice(index, 1));
      changed();
      list.children[to]?.querySelector("button")?.focus();
    };
    return el(
      "li",
      { class: "photo-tile" },
      el("div", { class: "photo-thumb" }, el("img", { src: photo.url, alt: `Photo ${index + 1}` }), index === 0 ? el("span", { class: "photo-badge", text: "Main" }) : null),
      colorSelect,
      el(
        "div",
        { class: "photo-actions" },
        index > 0 ? el("button", { type: "button", class: "link-button", text: "Make main", onclick: () => move(0) }) : null,
        el("button", {
          type: "button",
          class: "link-button danger",
          text: "Remove",
          "aria-label": `Remove photo ${index + 1}`,
          onclick: () => {
            photos.splice(index, 1);
            status.textContent = photos.length ? "Photo removed." : "Photos removed; the illustration will show instead.";
            changed();
          },
        })
      )
    );
  }

  function render() {
    // A photo tagged with a colour the item no longer comes in goes back to any.
    const offered = colors();
    for (const photo of photos) if (photo.color && !offered.includes(photo.color)) photo.color = "";
    clear(list, photos.map(tile));
    list.hidden = !photos.length;
    chooseLabel.textContent = photos.length ? "Add more images" : "Upload images";
    drop.hidden = photos.length >= MAX_IMAGES;
  }

  const element = el(
    "div",
    { class: "field span-6 photo-picker" },
    el("span", { class: "label", text: "Photos" }),
    list,
    drop,
    fits,
    el("p", {
      class: "hint",
      text: `Up to ${MAX_IMAGES} photos; the first is the main one. Tag a photo with a color to show it when that color is picked. Every photo is resized to ${PHOTO_WIDTH} × ${PHOTO_HEIGHT} so all items match: "Show the whole photo" never cuts anything off; "Fill the frame" crops the edges.`,
    }),
    status,
    anchor
  );
  render();

  return {
    element,
    render,
    get value() {
      return photos.map(({ url, color }) => ({ url, color }));
    },
  };
}

function openItem(item) {
  const editing = Boolean(item);
  const draft = item ?? {
    name: "", sku: "", brand: "jf-hadens", category: "Apparel", unit: "Each", costCents: 0, minPerOrder: 1, maxPerOrder: 6, orderIncrement: 1,
    description: "", tone: "mango", art: "tee", image: "", images: [], colors: [], active: true,
    variants: [{ id: "default", label: "", stock: 0 }],
    supplier: { company: "Ten 10 Design LLC" },
  };
  const hasOptions = draft.variants.length > 1 || Boolean(draft.variants[0]?.label);

  const form = el("form", { id: "item-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  const preview = el("div", { class: "span-6" });

  const tone = el("select", { id: "item-tone", name: "tone" }, options(TONES, { selected: draft.tone }));
  const art = el("select", { id: "item-art", name: "art" }, options(Object.entries(ART_LABELS), { selected: draft.art }));
  // Photos, as stored: uploaded /images/ paths (or older links), each maybe
  // tagged with a colour.
  const colorField = colorChoices(draft.colors ?? [], () => photos.render());
  const photos = photoGallery({ images: itemImages(draft), colors: () => colorField.value, onChange: () => renderPreview() });

  function renderPreview() {
    clear(preview, artwork({ tone: tone.value, art: art.value, image: photos.value[0]?.url ?? "" }, "art-preview"));
  }
  for (const control of [tone, art]) control.addEventListener("change", renderPreview);

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

  const category = el("select", { id: "item-category", name: "category" }, options(CATEGORIES, { selected: draft.category }));

  // A new item's SKU is the brand's and category's first three letters and
  // the next number (JFH-APP-014), following the brand and category as they
  // are chosen, until someone types their own. An existing item keeps its SKU.
  const nameInput = el("input", { id: "item-name", name: "name", type: "text", maxlength: "120", value: draft.name, autofocus: true });
  const skuInput = el("input", { id: "item-sku", name: "sku", type: "text", maxlength: "40", value: draft.sku, placeholder: "Brand-category-number" });
  const skuField = field("SKU", skuInput, { span: 2 });
  let skuTouched = editing;
  function refreshSku() {
    if (skuTouched) return;
    const brand = form.elements.namedItem("brand")?.value || draft.brand;
    skuInput.value = generateSku(brand, category.value, catalog.map((i) => i.sku));
  }
  skuInput.addEventListener("input", () => {
    skuTouched = skuInput.value.trim() !== "";
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "brand" || event.target.name === "category") refreshSku();
  });
  if (!editing) skuInput.value = generateSku(draft.brand, draft.category, catalog.map((i) => i.sku));

  // Suggested min and max per order follow the cost (and category) as they
  // are typed. A new item takes the suggestions until someone sets its own.
  function suggestedField({ id, name, label, value, suggest }) {
    const input = el("input", { id, name, type: "number", min: "1", max: "999", step: "1", value: String(value) });
    const hint = el("p", { class: "hint suggestion", "aria-live": "polite" });
    const wrap = field(label, input, { span: 2 });
    wrap.append(hint);
    let touched = editing;
    function refresh() {
      const dollars = Number.parseFloat(cost.value);
      const suggested = suggest(Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN);
      if (!suggested) return clear(hint);
      if (!touched) input.value = String(suggested);
      clear(
        hint,
        `Suggested: ${suggested}`,
        String(suggested) === input.value
          ? null
          : el("button", {
              type: "button",
              class: "link-button",
              text: "Use",
              onclick: () => {
                input.value = String(suggested);
                refresh();
              },
            })
      );
    }
    input.addEventListener("input", () => {
      touched = true;
      refresh();
    });
    return { field: wrap, refresh };
  }
  // Ordered in steps: 6 means 6, 12, 18… The suggestions round to the step.
  const stepInput = el("input", { id: "item-step", name: "orderIncrement", type: "number", min: "1", max: "999", step: "1", value: String(draft.orderIncrement ?? 1) });
  const stepField = field("Order increment", stepInput, { span: 2 });
  stepField.append(el("p", { class: "hint", text: "Quantities go up by this much, e.g. 6 for six-packs. 1 for any amount." }));
  const step = () => {
    const n = Number.parseInt(stepInput.value, 10);
    return Number.isInteger(n) && n > 1 ? n : 1;
  };
  const maxSetting = suggestedField({
    id: "item-max",
    name: "maxPerOrder",
    label: "Maximum order",
    value: draft.maxPerOrder,
    suggest: (cents) => {
      const n = suggestedMaxPerOrder(cents);
      return n && Math.max(step(), Math.floor(n / step()) * step());
    },
  });
  const minSetting = suggestedField({
    id: "item-min",
    name: "minPerOrder",
    label: "Minimum order",
    value: draft.minPerOrder ?? 1,
    suggest: (cents) => {
      const n = suggestedMinPerOrder(cents, category.value);
      return n && Math.ceil(n / step()) * step();
    },
  });
  const maxField = maxSetting.field;
  const minField = minSetting.field;
  for (const setting of [minSetting, maxSetting]) {
    cost.addEventListener("input", setting.refresh);
    stepInput.addEventListener("input", setting.refresh);
    setting.refresh();
  }
  category.addEventListener("change", minSetting.refresh);

  // Where to order it from: admin-only, never part of what the store shows.
  const supplier = draft.supplier ?? {};
  const supplierInput = (key, attrs = {}) =>
    el("input", { id: `item-supplier-${key}`, name: `supplier${key[0].toUpperCase()}${key.slice(1)}`, type: "text", value: supplier[key] ?? "", ...attrs });
  const supplierFields = {
    company: supplierInput("company", { maxlength: "120", placeholder: "e.g. Ten 10 Design LLC" }),
    contact: supplierInput("contact", { maxlength: "120", autocomplete: "off" }),
    email: supplierInput("email", { type: "email", maxlength: "160", autocomplete: "off" }),
    phone: supplierInput("phone", { type: "tel", maxlength: "40", autocomplete: "off" }),
    link: supplierInput("link", { type: "url", maxlength: "500", placeholder: "https://…", autocomplete: "off" }),
    itemNumber: supplierInput("itemNumber", { maxlength: "160", placeholder: "Their item or style number" }),
    notes: el("textarea", { id: "item-supplier-notes", name: "supplierNotes", rows: "2", maxlength: "600", value: supplier.notes ?? "", placeholder: "PO numbers, imprint specs, lead times…" }),
  };
  const supplierBox = el(
    "fieldset",
    { class: "span-6 admin-only" },
    el("legend", {}, "Where to order ", el("span", { class: "tag", text: "Admin only" })),
    el("p", { class: "hint", text: "For reordering. Team members never see this." }),
    el(
      "div",
      { class: "form-grid" },
      field("Supplier", supplierFields.company, { span: 3, optional: true }),
      field("Contact", supplierFields.contact, { span: 3, optional: true }),
      field("Email", supplierFields.email, { span: 3, optional: true }),
      field("Phone", supplierFields.phone, { span: 3, optional: true }),
      field("Their item #", supplierFields.itemNumber, { span: 3, optional: true }),
      field("Online order link", supplierFields.link, { span: 3, optional: true, hint: "If it can be bought online, the page to order it from." }),
      field("Notes", supplierFields.notes, { optional: true })
    )
  );

  form.append(
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      field("Name", nameInput, { span: 4 }),
      skuField,
      field("Brand", el("select", { id: "item-brand", name: "brand" }, options(BRANDS, { selected: draft.brand })), { span: 2 }),
      field("Category", category, { span: 2 }),
      field("Sold as", el("input", { id: "item-unit", name: "unit", type: "text", maxlength: "40", value: draft.unit, placeholder: "Each, Pack of 25…" }), { span: 2 }),
      field("Cost to us ($)", cost, { span: 2 }),
      minField,
      maxField,
      stepField,
      el("div", { class: "field span-2" }, el("span", { class: "label", text: "Visibility" }), el("label", { class: "check" }, el("input", { id: "item-active", type: "checkbox", checked: draft.active }), "Show in the store")),
      field("Description", el("textarea", { id: "item-description", name: "description", rows: "3", maxlength: "600", value: draft.description }), { optional: true }),
      field("Colourway", tone, { span: 3 }),
      field("Illustration", art, { span: 3 }),
      preview,
      colorField.element,
      photos.element,
      el("fieldset", { class: "span-6", name: "variants" }, el("legend", { text: "Stock" }), modeRadios, singleBox, optionsBox),
      supplierBox
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
      minPerOrder: Number(form.elements.namedItem("minPerOrder").value),
      orderIncrement: Number(form.elements.namedItem("orderIncrement").value),
      maxPerOrder: Number(form.elements.namedItem("maxPerOrder").value),
      description: form.elements.namedItem("description").value,
      tone: tone.value,
      art: art.value,
      image: photos.value[0]?.url ?? "",
      images: photos.value,
      colors: colorField.value,
      active: $("#item-active", form).checked,
      variants,
      supplier: Object.fromEntries(Object.entries(supplierFields).map(([key, input]) => [key, input.value])),
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
      el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Cancel" }),
      editing ? el("button", { type: "button", class: "btn btn-danger push-end", id: "item-delete", text: "Delete item", onclick: () => deleteItem(item) }) : null
    )
  );
  drawer.open();
}

async function deleteItem(item) {
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status) && o.lines.some((l) => l.itemId === item.id)).length;
  const ok = await confirmDialog({
    title: `Delete ${item.name}?`,
    body: [
      "It disappears from the store and from this catalog for good. Past orders keep their details.",
      open ? `${plural(open, "open order")} include${open === 1 ? "s" : ""} it and will still go out as normal.` : "",
      item.active ? "If you might stock it again, hide it instead: edit it and untick “Show in the store”." : "",
    ].filter(Boolean).join(" "),
    confirmLabel: "Delete item",
    cancelLabel: "Keep it",
    danger: true,
  });
  if (!ok) return;
  try {
    await adminApi(`/api/admin/catalog/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    catalog = catalog.filter((i) => i.id !== item.id);
    renderCatalog();
    renderKpis();
    drawer.close();
    toast(`${item.name} deleted.`);
  } catch (error) {
    toast(error.message, { tone: "error" });
  }
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

/* ------------------------------------------------------------------ team */

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied.`);
  } catch {
    toast("Couldn't copy — select the text instead.", { tone: "error" });
  }
}

const codeLine = (p) => `${p.name || p.email} — ${p.email} — ${p.code}`;

// Codes just created or reset, with a reminder to send them.
function showNewCodes(people, title) {
  const box = $("#team-new-codes");
  if (!people.length) return clear(box);
  const site = location.origin;
  clear(
    box,
    el(
      "section",
      { class: "card card-pad new-codes", "aria-labelledby": "new-codes-title" },
      el(
        "div",
        { class: "section-title" },
        el("h2", { id: "new-codes-title", text: title }),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Dismiss", text: "×", onclick: () => clear(box) })
      ),
      el("p", { class: "muted", text: `Send each person their code. They sign in at ${site} with their email and code.` }),
      el(
        "ul",
        { class: "code-list" },
        people.map((p) =>
          el(
            "li",
            {},
            el("div", {}, el("div", { class: "cell-main", text: p.name || p.email }), el("div", { class: "cell-sub", text: p.email })),
            el("span", { class: "code-chip", text: p.code }),
            el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Copy", onclick: () => copyText(`Your Tropical Distillery merch store code: ${p.code}\nSign in at ${site} with ${p.email}.`, "Message") })
          )
        )
      ),
      people.length > 1
        ? el("button", {
            type: "button",
            class: "btn btn-sm",
            text: "Copy all",
            onclick: () => copyText(people.map(codeLine).join("\n"), "Codes"),
          })
        : null
    )
  );
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function reloadTeam() {
  team = await adminApi("/api/admin/team");
  renderTeam();
  renderTracker();
}

function lastActive(p) {
  const times = [p.lastSignInAt, p.lastOrderAt].filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}

function renderTeam() {
  for (const radio of $$("input[name=team-mode]")) radio.checked = radio.value === team.mode;
  $("#team-mode-note").textContent =
    team.mode === "personal"
      ? `Personal codes are on: ${plural(team.people.length, "person", "people")} can sign in. The shared team code no longer works.`
      : team.people.length
        ? "The shared team code is still in use. Once everyone has their personal code, switch to personal codes."
        : "Add your team, send them their codes, then switch to personal codes.";

  const query = ui.teamQuery.toLowerCase();
  const visible = team.people
    .filter((p) => !query || `${p.name} ${p.email}`.toLowerCase().includes(query))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "en", { sensitivity: "base" }));
  $("#team-count").textContent = `${plural(team.people.length, "person", "people")} on the team list`;

  const table = $("#team-table");
  if (!visible.length) {
    clear(
      table,
      el("tbody", {}, el("tr", {}, el("td", { class: "empty", colspan: "6", text: team.people.length ? "Nobody matches." : "Nobody on the team list yet. Add people above." })))
    );
  } else {
    clear(
      table,
      el("thead", {}, el("tr", {}, ["Person", "Personal code", "Orders", "Order value", "Last active", ""].map((h) =>
        el("th", { scope: "col", class: h === "Orders" || h === "Order value" ? "num" : "", text: h })
      ))),
      el(
        "tbody",
        {},
        visible.map((p) => {
          // Someone who chose their own password has no code to show; a new
          // code is how they get back in if they forget it.
          const codeCell = p.ownPasswordSetAt
            ? el("td", {}, el("span", { class: "tag", text: "Own password" }), el("div", { class: "cell-sub", text: `Set ${formatDate(p.ownPasswordSetAt)}` }))
            : el(
            "td",
            {},
            el("button", {
              type: "button",
              class: "btn btn-secondary btn-sm",
              text: "Show",
              "aria-label": `Show ${p.name || p.email}'s code`,
              onclick: async () => {
                try {
                  const { code } = await adminApi(`/api/admin/team/${encodeURIComponent(p.id)}/code`);
                  clear(
                    codeCell,
                    el("span", { class: "code-chip", text: code }),
                    el("button", { type: "button", class: "link-button", text: "Copy", onclick: () => copyText(code, "Code") })
                  );
                } catch (error) {
                  toast(error.message, { tone: "error" });
                }
              },
            })
          );
          const active = lastActive(p);
          return el(
            "tr",
            {},
            el("td", {}, el("div", { class: "cell-main", text: p.name || "—" }), el("div", { class: "cell-sub", text: p.email })),
            codeCell,
            el("td", { class: "num" }, el("div", { text: String(p.orders) }), el("div", { class: "cell-sub", text: plural(p.units, "unit") })),
            el("td", { class: "num" }, el("div", { text: formatMoney(p.valueCents) }), el("div", { class: "cell-sub", text: `${formatMoney(p.monthValueCents)} this month` })),
            el("td", { text: active ? formatDate(active) : "Not yet" }),
            el(
              "td",
              {},
              el(
                "div",
                { class: "action-row" },
                el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Edit", "aria-label": `Edit ${p.name || p.email}`, onclick: () => openPerson(p) }),
                el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "New code", "aria-label": `New code for ${p.name || p.email}`, onclick: () => resetCode(p) })
              )
            )
          );
        })
      )
    );
  }

  const suggestionsBox = $("#team-suggestions");
  if (!team.suggestions.length) {
    clear(suggestionsBox);
  } else {
    const add = (list) => addPeopleText(list.map((x) => (x.name ? `${x.name}, ${x.email}` : x.email)).join("\n"));
    clear(
      suggestionsBox,
      el(
        "section",
        { class: "card card-pad suggestions", "aria-labelledby": "suggestions-title" },
        el(
          "div",
          { class: "section-title" },
          el("h2", { id: "suggestions-title", text: "Using the store, not on the list" }),
          team.suggestions.length > 1
            ? el("button", { type: "button", class: "btn btn-sm", text: "Add all", onclick: () => add(team.suggestions) })
            : null
        ),
        el("p", { class: "muted", text: "These people have signed in or ordered with the shared team code. Add them before switching to personal codes, or they won't be able to sign in." }),
        el(
          "ul",
          { class: "code-list" },
          team.suggestions.map((x) =>
            el(
              "li",
              {},
              el("div", {}, el("div", { class: "cell-main", text: x.name || x.email }), el("div", { class: "cell-sub", text: x.email })),
              el("span", { class: "cell-sub", text: x.lastSeenAt ? `Last seen ${formatDate(x.lastSeenAt)}` : "" }),
              el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Add", onclick: () => add([x]) })
            )
          )
        )
      )
    );
  }
}

async function addPeopleText(entries) {
  const form = $("#team-add-form");
  const alertBox = $(".form-alert", form);
  clearFieldErrors(form);
  setAlert(alertBox, "");
  const { added, already, invalid } = await adminApi("/api/admin/team", { method: "POST", body: { entries } });
  const notes = [];
  if (already.length) notes.push(`Already on the list: ${already.join(", ")}.`);
  if (invalid.length) notes.push(`Not an email address, so skipped: ${invalid.join("; ")}.`);
  setAlert(alertBox, notes.join("\n"));
  await reloadTeam();
  showNewCodes(added, added.length === 1 ? "New code" : `${added.length} new codes`);
  if (added.length) toast(`Added ${plural(added.length, "person", "people")} to the team list.`);
  return added;
}

$("#team-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    const added = await addPeopleText($("#team-entries").value);
    if (added.length) $("#team-entries").value = "";
  } catch (error) {
    setAlert($(".form-alert", form), error.message);
    showFieldErrors(form, error.fieldErrors);
  } finally {
    button.disabled = false;
  }
});

$("#team-search").addEventListener("input", (event) => {
  ui.teamQuery = event.target.value.trim();
  renderTeam();
});

for (const radio of $$("input[name=team-mode]")) {
  radio.addEventListener("change", async () => {
    const mode = radio.value;
    const ok = await confirmDialog(
      mode === "personal"
        ? {
            title: "Switch to personal codes?",
            body: "From now on everyone signs in with their own email and code. The shared team code stops working, and everyone signed in with it will need to sign in again. Send people their codes first.",
            confirmLabel: "Use personal codes",
            cancelLabel: "Not yet",
          }
        : {
            title: "Go back to the shared code?",
            body: "Personal codes stop working and everyone is signed out. They'll sign in again with the shared team code and their own name and email.",
            confirmLabel: "Use the shared code",
            cancelLabel: "Keep personal codes",
          }
    );
    if (!ok) return renderTeam();
    try {
      await adminApi("/api/admin/team/mode", { method: "PUT", body: { mode } });
      await reloadTeam();
      toast(mode === "personal" ? "Personal codes are on." : "Back to the shared team code.");
    } catch (error) {
      toast(error.message, { tone: "error" });
      renderTeam();
    }
  });
}

$("#team-reset-all").addEventListener("click", async () => {
  if (!team.people.length) return toast("Add people to the team list first.", { tone: "error" });
  const ok = await confirmDialog({
    title: `New codes for all ${plural(team.people.length, "person", "people")}?`,
    body: [
      "Everyone gets a new tropical-name-number code. Their current codes stop working and they're signed out, so send the new codes straight away.",
      team.people.some((p) => p.ownPasswordSetAt) ? "That includes anyone who chose their own password: it's replaced by the new code too." : "",
    ].filter(Boolean).join(" "),
    confirmLabel: "Make new codes",
    cancelLabel: "Keep current codes",
    danger: true,
  });
  if (!ok) return;
  try {
    const { people } = await adminApi("/api/admin/team/reset-codes", { method: "POST" });
    await reloadTeam();
    showNewCodes(people, `${plural(people.length, "new code")}`);
  } catch (error) {
    toast(error.message, { tone: "error" });
  }
});

async function resetCode(p) {
  const ok = await confirmDialog({
    title: `New code for ${p.name || p.email}?`,
    body: p.ownPasswordSetAt
      ? "They chose their own password. A new code replaces it, signs them out, and they sign in with the code (they can then choose a new password). You'll need to send it to them."
      : "Their current code stops working and they're signed out. You'll need to send them the new one.",
    confirmLabel: "Make a new code",
    cancelLabel: "Keep the current code",
  });
  if (!ok) return;
  try {
    const { person } = await adminApi(`/api/admin/team/${encodeURIComponent(p.id)}`, { method: "PATCH", body: { resetCode: true } });
    await reloadTeam();
    showNewCodes([person], "New code");
  } catch (error) {
    toast(error.message, { tone: "error" });
  }
}

function openPerson(p) {
  const form = el("form", { id: "person-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  form.append(
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      field("Name", el("input", { id: "person-name", name: "name", type: "text", maxlength: "80", value: p.name, autofocus: true })),
      field("Email", el("input", { id: "person-email", name: "email", type: "email", maxlength: "160", value: p.email }), {
        hint: "They sign in with this email. Past orders stay linked to them.",
      })
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    try {
      await adminApi(`/api/admin/team/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        body: { name: form.elements.namedItem("name").value, email: form.elements.namedItem("email").value },
      });
      await reloadTeam();
      drawer.close();
      toast("Saved.");
    } catch (error) {
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });

  detailTitle.textContent = p.name || p.email;
  clear(detailBody, form);
  clear(
    detailFoot,
    el(
      "div",
      { class: "inline-actions" },
      el(
        "div",
        { class: "inline-actions" },
        el("button", { type: "submit", form: "person-form", class: "btn", text: "Save" }),
        el("button", { type: "button", class: "btn btn-secondary", "data-close": "", text: "Cancel" })
      ),
      el("button", {
        type: "button",
        class: "btn btn-danger",
        text: "Remove from team",
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Remove ${p.name || p.email}?`,
            body: "Their code stops working and they're signed out straight away. Their past orders stay in the order history.",
            confirmLabel: "Remove",
            cancelLabel: "Keep them",
            danger: true,
          });
          if (!ok) return;
          try {
            await adminApi(`/api/admin/team/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            await reloadTeam();
            drawer.close();
            toast(`${p.name || p.email} removed.`);
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
