// A supplier's page for items the merch team forwarded to them: what to ship
// and where, and a form to mark it shipped with the tracking number. The
// link's token is in the #fragment, so it never reaches the server's logs;
// it's sent back in the body of each request.

import { addressLines, api, clear, clearFieldErrors, el, formatCalendarDate, formatDate, options, setAlert, showFieldErrors } from "./core.js";
import { CARRIERS, cardText, labelFor, optionText, trackingUrl } from "./shared.js";

const root = document.getElementById("ship");
const token = decodeURIComponent(location.hash.slice(1));

function problem(title, message) {
  root.removeAttribute("aria-busy");
  clear(root, el("h1", { text: title }), el("p", { class: "muted", text: message }));
}

function block(label, ...children) {
  return el("div", { class: "ship-block" }, el("p", { class: "kv-label", text: label }), ...children);
}

function addressText(s) {
  return [s.type === "account" ? s.accountName : null, s.type === "account" ? `Attn: ${s.attention}` : s.attention, ...addressLines(s), s.phone]
    .filter(Boolean)
    .join("\n");
}

function shipmentText(shipment) {
  const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
  return el(
    "p",
    {},
    `Shipped ${formatDate(shipment.shippedAt)}`,
    shipment.carrier ? ` via ${labelFor(CARRIERS, shipment.carrier)}` : "",
    shipment.trackingNumber ? ". Tracking " : shipment.carrier === "hand" ? "." : ". No tracking number yet.",
    shipment.trackingNumber
      ? url
        ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: shipment.trackingNumber })
        : shipment.trackingNumber
      : ""
  );
}

function shipForm(view) {
  const f = view.forward;
  const shipped = f.status === "shipped";
  const form = el("form", { class: "ship-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  const submit = el("button", { type: "submit", class: "btn", text: shipped ? "Save tracking" : "Mark shipped" });
  form.append(
    el("h2", { text: shipped ? "Update the tracking" : "Shipped? Let us know" }),
    alertBox,
    el(
      "div",
      { class: "form-grid" },
      el(
        "div",
        { class: "field span-3" },
        el("label", { for: "carrier", text: "Shipped with" }),
        el("select", { id: "carrier", name: "carrier", required: true }, options(CARRIERS, { placeholder: "Choose…", selected: f.shipment?.carrier }))
      ),
      el(
        "div",
        { class: "field span-3" },
        el("label", { for: "trackingNumber" }, "Tracking number", el("span", { class: "optional", text: " (optional)" })),
        el("input", { id: "trackingNumber", name: "trackingNumber", type: "text", maxlength: "60", autocomplete: "off", value: f.shipment?.trackingNumber ?? "" })
      )
    ),
    el("p", { class: "hint", text: shipped ? "Fix a typo or add a number you didn't have before." : "Don't have the tracking number yet? Mark it shipped now and come back to this link to add it." }),
    submit
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    submit.disabled = true;
    try {
      const body = { token, carrier: form.elements.namedItem("carrier").value, trackingNumber: form.elements.namedItem("trackingNumber").value };
      const updated = await api("/api/ship", { method: "POST", body });
      render(updated, { thanks: true });
    } catch (error) {
      submit.disabled = false;
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });
  return form;
}

function render(view, { thanks = false } = {}) {
  const f = view.forward;
  const s = view.shipTo;
  const count = f.items.length;
  const calledOff = f.status === "cancelled";
  root.removeAttribute("aria-busy");
  document.title = `Order ${view.number} · Shipping request · Tropical Distillery Team Merch`;

  const copy = el("button", {
    type: "button",
    class: "btn btn-secondary btn-sm",
    text: "Copy address",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(addressText(s));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Select the address to copy it";
      }
    },
  });

  clear(
    root,
    el("p", { class: "eyebrow", text: `Shipping request · Order ${view.number}` }),
    el("h1", {
      text: calledOff
        ? "Called off: please don't ship these"
        : f.status === "shipped"
          ? "Shipped. Thank you!"
          : `Please ship ${count === 1 ? "this item" : `these ${count} items`}`,
    }),
    calledOff
      ? el("p", { class: "callout declined", text: "The merch team no longer needs you to ship these. If they've already gone out, reply to the merch team's email." })
      : thanks
        ? el("p", { class: "callout ok", role: "status", text: `Saved. The merch team and ${view.requestedBy} have been told.` })
        : null,
    f.status === "sent" && view.shippingSpeed === "rush" ? el("p", { class: "callout rush" }, el("strong", { text: "Rush: " }), view.rushReason) : null,
    f.status === "shipped" && f.shipment ? shipmentText(f.shipment) : null,
    el(
      "ul",
      { class: "ship-items", "aria-label": "Items to ship" },
      f.items.map((item, index) =>
        el(
          "li",
          {},
          el("strong", { class: "ship-qty", text: `${item.quantity} ×` }),
          el(
            "span",
            {},
            el("span", { class: "cell-main", text: item.name }),
            el("span", { class: "cell-sub", text: [optionText(item), item.unit, `SKU ${item.sku}`].filter(Boolean).join(" · ") }),
            // Business cards: what to print on them, and the proof to print from.
            item.card
              ? el(
                  "span",
                  { class: "cell-sub card-details" },
                  cardText(item.card),
                  " · ",
                  el("a", { href: `/business-card?line=${index}#${encodeURIComponent(token)}`, target: "_blank", rel: "noopener", text: "Print proof ↗" })
                )
              : null
          )
        )
      )
    ),
    el(
      "div",
      { class: "ship-grid" },
      block(
        "Ship to",
        el("div", { class: "address" }, addressText(s).split("\n").map((line) => el("div", { text: line }))),
        s.deliveryNotes ? el("p", { class: "cell-sub", text: `Delivery notes: ${s.deliveryNotes}` }) : null,
        el("div", { class: "inline-actions" }, copy)
      ),
      block(
        "Details",
        el(
          "div",
          { class: "address" },
          el("div", { text: view.neededBy ? `Needed by ${formatCalendarDate(view.neededBy)}` : "No needed-by date" }),
          el("div", { text: view.shippingSpeed === "rush" ? "Rush shipping" : "Standard shipping" }),
          el("div", { text: `Requested by ${view.requestedBy}` }),
          el("div", { class: "cell-sub", text: `Sent to ${f.to} by ${f.by}, ${formatDate(f.at)}` })
        )
      )
    ),
    f.note ? el("div", { class: "ship-note" }, el("p", { class: "kv-label", text: `Message from ${f.by}` }), el("p", { text: f.note })) : null,
    view.canUpdate ? shipForm(view) : null,
    el("p", { class: "fine", text: "Questions? Reply to the email this link came in." })
  );
}

if (!token) {
  problem("Open the link from your email", "This page shows a shipping request from the Tropical Distillery merch team. Open it from the link in their email.");
} else {
  try {
    render(await api("/api/ship/view", { method: "POST", body: { token } }));
  } catch (error) {
    problem("This link doesn't work", error.message);
  }
}
