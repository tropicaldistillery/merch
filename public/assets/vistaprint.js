// Ordering business cards at Vistaprint, which has no way for the store to
// send it orders: download each card's print files, order on Vistaprint's
// site, ship straight to the order's address, then save Vistaprint's order
// number here. The requester does this for their own cards (paying with
// CARD_PAYMENT); the merch team can do it for them from the admin console.

import { clearFieldErrors, el, setAlert, showFieldErrors, toast } from "./core.js";
import { VENDORS } from "./shared.js";

export const VISTAPRINT = VENDORS.find((v) => v.id === "vistaprint");

/** 250 cards from 1 × "Box of 250". */
function cardCount(line) {
  const perBox = Number(/(\d[\d,]*)/.exec(line.unit ?? "")?.[1]?.replace(/,/g, ""));
  return perBox ? perBox * line.quantity : null;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied.`);
  } catch {
    toast("Couldn't copy — select the text instead.", { tone: "error" });
  }
}

async function downloadCardFile(order, line, side, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Making…";
  try {
    const { cardFileName, cardSidePdf } = await import("./card-files.js");
    const blob = await cardSidePdf(line.card, side);
    const link = el("a", { href: URL.createObjectURL(blob), download: cardFileName(order, line.card, side), hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch (error) {
    toast(`Couldn't make the file: ${error.message}`, { tone: "error" });
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * The steps, for `cards` ([{ line, index }]) on `order`. `payWith` adds who
 * pays at Vistaprint's checkout; `onSave({ lines, reference })` saves the
 * order number, and throws to show what's wrong.
 */
export function vistaprintForm(order, { cards, intro, payWith = "", onSave, onCancel }) {
  const form = el("form", { class: "action-form vistaprint-form", novalidate: true });
  const alertBox = el("div", { class: "form-alert", role: "alert", hidden: true });
  const s = order.shipTo;
  const id = (name) => `vp-${order.id}-${name}`;
  const submit = el("button", { type: "submit", class: "btn", text: "Save the Vistaprint order" });
  const copyRow = (label, value) =>
    value
      ? el(
          "li",
          {},
          el("span", { class: "kv-label", text: label }),
          el("span", { class: "vp-value", text: value }),
          el("button", { type: "button", class: "link-button", text: "Copy", "aria-label": `Copy ${label.toLowerCase()}`, onclick: () => copyText(value, label) })
        )
      : null;
  const step = (n, title, ...body) => el("li", { class: "vp-step" }, el("h4", {}, el("span", { class: "vp-n", text: String(n) }), title), ...body);

  form.append(
    alertBox,
    // (append() would print a null as text)
    intro ? el("p", { class: "hint", text: intro }) : "",
    el(
      "ol",
      { class: "vp-steps" },
      step(
        1,
        cards.length === 1 ? "Download the card" : "Download each card",
        el(
          "ul",
          { class: "vp-cards" },
          cards.map(({ line, index }) => {
            const count = cardCount(line);
            const button = (side) =>
              el("button", { type: "button", class: "btn btn-secondary btn-sm", text: side === "front" ? "Front PDF" : "Back PDF", onclick: (event) => downloadCardFile(order, line, side, event.currentTarget) });
            const about = el("span", {}, el("span", { class: "cell-main", text: line.card.name }), el("span", { class: "cell-sub", text: [count ? `Quantity ${count.toLocaleString("en-US")}` : `${line.quantity} × ${line.unit}`, line.card.title].filter(Boolean).join(" · ") }));
            return el(
              "li",
              {},
              // With one card there's nothing to pick.
              cards.length === 1
                ? el("div", {}, el("input", { type: "hidden", name: "lines", value: String(index) }), about)
                : el("label", { class: "check" }, el("input", { type: "checkbox", name: "lines", value: String(index), checked: true }), about),
              el("div", { class: "inline-actions" }, button("front"), button("back"))
            );
          })
        ),
        el("p", { class: "hint", text: "Each file is 3.61 × 2.11 in at 600 dpi, Vistaprint's full-bleed size for a 3.5 × 2 in card; the edge is trimmed off." })
      ),
      step(
        2,
        "Order on Vistaprint",
        el("p", {
          text: `Open ${VISTAPRINT.product} and choose ${VISTAPRINT.options}. Upload your own design: the front file, then the back. Set the quantity shown above${cards.length > 1 ? ", and repeat for each card" : ""}.`,
        }),
        el("a", { class: "btn btn-sm", href: VISTAPRINT.url, target: "_blank", rel: "noopener noreferrer", text: "Open Vistaprint ↗" })
      ),
      step(
        3,
        payWith ? `Ship it here, and pay with ${payWith}` : "Ship it straight to them",
        el(
          "ul",
          { class: "vp-address" },
          copyRow("Name", s.attention),
          copyRow("Company", s.type === "account" ? s.accountName : ""),
          copyRow("Address", s.address1),
          copyRow("Apt, suite", s.address2),
          copyRow("City", s.city),
          copyRow("State", s.state),
          copyRow("ZIP", s.postalCode),
          copyRow("Phone", s.phone)
        )
      ),
      step(
        4,
        "Save Vistaprint's order number",
        el(
          "div",
          { class: "field" },
          el("label", { for: id("reference"), text: "Vistaprint order number" }),
          el("input", { id: id("reference"), name: "reference", type: "text", maxlength: "60", autocomplete: "off" }),
          el("p", { class: "hint", text: "It's on Vistaprint's order confirmation." })
        )
      )
    ),
    el("div", { class: "inline-actions" }, submit, onCancel ? el("button", { type: "button", class: "btn btn-secondary", text: "Never mind", onclick: onCancel }) : null)
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setAlert(alertBox, "");
    const lines = [...form.querySelectorAll('input[name="lines"]')].filter((input) => input.type === "hidden" || input.checked).map((input) => Number(input.value));
    if (!lines.length) {
      setAlert(alertBox, "Tick the cards in this Vistaprint order.");
      return;
    }
    submit.disabled = true;
    try {
      await onSave({ lines, reference: form.elements.namedItem("reference").value });
    } catch (error) {
      submit.disabled = false;
      setAlert(alertBox, error.message);
      showFieldErrors(form, error.fieldErrors);
    }
  });
  return form;
}
