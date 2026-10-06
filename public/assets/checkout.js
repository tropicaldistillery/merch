import { artwork } from "./art.js";
import {
  $,
  $$,
  clear,
  clearFieldErrors,
  el,
  localToday,
  options,
  plural,
  setAlert,
  showFieldErrors,
  teamApi,
  wireHeader,
} from "./core.js";
import { ACCOUNT_TYPES, PURPOSES, SHIPPING_SPEEDS, US_STATES, formatMoney, imageFor } from "./shared.js";

const form = $("#checkout-form");
const alertBox = $("#checkout-alert");
const linesAlert = $("#lines-alert");
const addressSection = $("#address-section");
const savedSelect = $("#saved-account");
const saveAddress = $("#save-address");
const placeButton = $("#place-order");

const ADDRESS_FIELDS = [
  "accountName", "accountType", "attention", "phone", "address1", "address2",
  "city", "state", "postalCode", "deliveryNotes",
];
const input = (field) => form.elements.namedItem(`shipTo.${field}`);

const { user } = await teamApi("/api/session");
const cart = wireHeader(user);

const [{ items }, me, { accounts }] = await Promise.all([
  teamApi("/api/catalog"),
  teamApi("/api/me"),
  teamApi("/api/accounts"),
]);

/* ---------------------------------------------------------------- empty */

if (!cart.count()) {
  const empty = $("#checkout-empty");
  clear(
    empty,
    el(
      "div",
      { class: "card empty" },
      el("h2", { text: "Your order is empty" }),
      el("p", { text: "Add a few things from the catalog, then come back here to choose where they ship." }),
      el("a", { class: "btn", href: "/shop", text: "Browse the catalog" })
    )
  );
  empty.hidden = false;
} else {
  form.hidden = false;
}

/* ---------------------------------------------------------------- fields */

clear(input("accountType"), options(ACCOUNT_TYPES, { placeholder: "Choose…" }));
clear(input("state"), options(US_STATES, { placeholder: "State" }));
clear($("#purpose"), options(PURPOSES, { placeholder: "Choose…" }));
clear(
  savedSelect,
  el("option", { value: "", text: accounts.length ? "New account" : "No saved accounts yet" }),
  accounts.map((a) => el("option", { value: a.id, text: `${a.name} — ${a.city}, ${a.state}` }))
);
savedSelect.disabled = !accounts.length;
$("#neededBy").min = localToday();

clear(
  $("#speed-choices"),
  SHIPPING_SPEEDS.map((speed) =>
    el(
      "label",
      { class: "choice compact" },
      el("input", { type: "radio", name: "shippingSpeed", value: speed.id, checked: speed.id === "standard" }),
      el("span", {}, el("span", { class: "choice-title", text: speed.label }), el("span", { class: "choice-text", text: speed.detail })),
      el("span", { class: "choice-tick", "aria-hidden": "true" })
    )
  )
);

/* --------------------------------------------------------------- ship to */

// What was typed for "me" and for "an account" is kept apart, so switching
// back and forth never mixes a home address into an account's.
const drafts = {
  self: { attention: user.name, ...(me.address ?? {}) },
  account: {},
};
let mode = null;

function readFields() {
  return Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, input(f).value]));
}

function writeFields(values) {
  for (const f of ADDRESS_FIELDS) input(f).value = values[f] ?? "";
}

function setMode(next) {
  if (mode) drafts[mode] = { ...readFields(), savedAccountId: mode === "account" ? savedSelect.value : undefined };
  mode = next;
  writeFields(drafts[mode]);
  savedSelect.value = drafts.account.savedAccountId ?? "";

  addressSection.hidden = false;
  for (const node of $$("[data-show]", form)) node.hidden = node.dataset.show !== mode;
  $("#attention-label").textContent = mode === "self" ? "Recipient name" : "Receiving contact";
  $("#phone-optional").hidden = mode !== "self";
  $("#delivery-hint").textContent =
    mode === "self"
      ? "Anything the carrier should know — gate code, leave with the front desk."
      : "Receiving hours, loading dock, who to ask for. Many bars only take deliveries before opening.";
  clearFieldErrors(addressSection);
}

for (const radio of form.elements.namedItem("shipTo.type")) {
  radio.addEventListener("change", () => setMode(radio.value));
}

savedSelect.addEventListener("change", () => {
  const account = accounts.find((a) => a.id === savedSelect.value);
  if (!account) {
    writeFields({});
    input("accountName").focus();
    return;
  }
  writeFields({
    accountName: account.name,
    accountType: account.type,
    attention: account.attention,
    phone: account.phone,
    address1: account.address1,
    address2: account.address2,
    city: account.city,
    state: account.state,
    postalCode: account.postalCode,
    deliveryNotes: account.deliveryNotes,
  });
  clearFieldErrors(addressSection);
});

// Renaming a picked account means it is a different place, not an update to
// the saved one.
input("accountName").addEventListener("input", () => {
  const account = accounts.find((a) => a.id === savedSelect.value);
  if (account && input("accountName").value.trim().toLowerCase() !== account.name.toLowerCase()) savedSelect.value = "";
});

/* ----------------------------------------------------------------- rush */

const rushField = $("#rush-field");
for (const radio of form.elements.namedItem("shippingSpeed")) {
  radio.addEventListener("change", () => {
    rushField.hidden = form.elements.namedItem("shippingSpeed").value !== "rush";
    if (!rushField.hidden) $("#rushReason").focus();
  });
}

/* --------------------------------------------------------------- summary */

function renderSummary() {
  const lines = cart.lines();
  const problems = [];
  let total = 0;
  let units = 0;

  clear(
    $("#summary-lines"),
    lines.map((line) => {
      const item = items.find((i) => i.id === line.itemId);
      const variant = item?.variants.find((v) => v.id === line.variantId);
      if (!item || !variant) {
        problems.push("An item in your order is no longer available. Edit your order to remove it.");
        return el("li", {}, el("div", { text: "Item no longer available" }));
      }
      const colors = item.colors ?? [];
      if (colors.length ? !colors.includes(line.color) : line.color) {
        problems.push(`${item.name} isn't offered in ${line.color || "that color"} any more. Edit your order to change it.`);
      }
      total += item.costCents * line.quantity;
      units += line.quantity;
      return el(
        "li",
        {},
        artwork({ ...item, image: imageFor(item, line.color) }, "thumb"),
        el(
          "div",
          { class: "line-info" },
          el("div", { class: "cell-main", text: item.name }),
          el("div", { class: "cell-sub", text: [line.color, variant.label, `Qty ${line.quantity}`].filter(Boolean).join(" · ") })
        ),
        el("span", { text: formatMoney(item.costCents * line.quantity) })
      );
    })
  );

  $("#summary-units").textContent = plural(units, "unit");
  $("#summary-total").textContent = formatMoney(total);
  setAlert(linesAlert, [...new Set(problems)].join(" "));
  placeButton.disabled = !lines.length || problems.length > 0;
}

renderSummary();
cart.subscribe(renderSummary);

/* ---------------------------------------------------------------- submit */

// Enter in a single-line field should not place the order by accident.
form.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "radio") {
    event.preventDefault();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  setAlert(alertBox, "");

  if (!mode) {
    setAlert(alertBox, "Choose whether this ships to you or to an account.");
    form.elements.namedItem("shipTo.type")[0].focus();
    return;
  }

  const fields = readFields();
  const payload = {
    shipTo: {
      type: mode,
      ...(mode === "account"
        ? { accountId: savedSelect.value || null, accountName: fields.accountName, accountType: fields.accountType }
        : {}),
      attention: fields.attention,
      phone: fields.phone,
      address1: fields.address1,
      address2: fields.address2,
      city: fields.city,
      state: fields.state,
      postalCode: fields.postalCode,
      deliveryNotes: fields.deliveryNotes,
    },
    purpose: $("#purpose").value,
    neededBy: $("#neededBy").value,
    shippingSpeed: form.elements.namedItem("shippingSpeed").value,
    rushReason: $("#rushReason").value,
    notes: $("#notes").value,
    saveAddress: mode === "self" && saveAddress.checked,
    lines: cart.lines(),
  };

  placeButton.disabled = true;
  placeButton.textContent = "Placing order…";
  try {
    const { order } = await teamApi("/api/orders", { method: "POST", body: payload });
    cart.clear();
    location.href = `/orders?placed=${encodeURIComponent(order.number)}`;
  } catch (error) {
    placeButton.disabled = false;
    placeButton.textContent = "Place order";
    const fieldErrors = error.fieldErrors || {};
    if (fieldErrors.lines) {
      setAlert(linesAlert, fieldErrors.lines);
      setAlert(alertBox, `${fieldErrors.lines} Edit your order and try again.`);
    } else {
      setAlert(alertBox, error.message);
    }
    if (!showFieldErrors(form, fieldErrors)) alertBox.focus();
  }
});
