// The print proof for business cards on an order: each card's front and back
// at full resolution, to check and then print (or save as PDF) at 3.5 x 2 in,
// one side per page, for the printer.
//
// The merch team opens it from an order in the admin console
// (?order=ID, or &line=N for one card). A supplier the cards were forwarded to
// opens it from their shipping page; their link's token is in the #fragment,
// as on that page, and is only ever sent in a request body.

import { api, clear, el } from "./core.js";
import { cardBack, cardFront, fitCard } from "./card.js";
import { cardText } from "./shared.js";

const root = document.getElementById("proof");
const printButton = document.getElementById("print");
const back = document.getElementById("back");
const params = new URLSearchParams(location.search);
const token = decodeURIComponent(location.hash.slice(1));
const only = params.has("line") ? Number(params.get("line")) : null;

printButton.addEventListener("click", () => window.print());

function problem(title, message, link) {
  root.removeAttribute("aria-busy");
  clear(root, el("h1", { text: title }), el("p", { class: "muted", text: message }), link ? el("p", {}, link) : null);
}

function proofCard(line) {
  const front = cardFront(line.card, { print: true });
  const card = el(
    "section",
    { class: "proof-card", "aria-label": `Card for ${line.card.name}` },
    el("h2", { text: line.card.name }),
    el("p", { class: "cell-sub", text: [`${line.quantity} × ${line.unit || "box"}`, cardText(line.card)].join(" · ") }),
    el(
      "div",
      { class: "proof-sides" },
      el("figure", {}, front, el("figcaption", { text: "Front" })),
      el("figure", {}, cardBack({ print: true }), el("figcaption", { text: "Back" }))
    )
  );
  return { card, front };
}

async function render(number, lines) {
  // Lines are numbered as they are on the order, so ?line= picks one out.
  const cards = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => line.card && (only === null || index === only));
  if (!cards.length) {
    problem("No business cards here", only === null ? "This order has no business cards on it." : "That line of the order isn't a business card.");
    return;
  }
  document.title = `Business card proof · ${number} · Tropical Distillery Team Merch`;
  const built = cards.map(({ line }) => proofCard(line));
  root.removeAttribute("aria-busy");
  clear(
    root,
    el(
      "div",
      { class: "proof-intro" },
      el("h1", { text: cards.length === 1 ? "Business card proof" : `${cards.length} business card proofs` }),
      el("p", { class: "muted", text: `Order ${number}. Each card prints at 3.5 × 2 in, front then back, one side per page.` }),
      el("p", {
        class: "hint",
        text: "To make a print-ready PDF, choose Save as PDF, with margins set to None and headers and footers off. Check every detail before it goes to the printer.",
      })
    ),
    built.map((b) => b.card)
  );
  await Promise.all(built.map((b) => fitCard(b.front)));
  printButton.disabled = false;
}

try {
  if (token) {
    back.href = `/ship#${encodeURIComponent(token)}`;
    back.textContent = "Back to the shipping request";
    const view = await api("/api/ship/view", { method: "POST", body: { token } });
    await render(view.number, view.forward.items);
  } else {
    const id = params.get("order") ?? "";
    const { order } = await api(`/api/admin/orders/${encodeURIComponent(id)}`);
    await render(order.number, order.lines);
  }
} catch (error) {
  if (!token && error.status === 401) {
    problem("Sign in to see this proof", "Business card proofs are part of the admin console.", el("a", { class: "btn", href: "/admin", text: "Open the admin console" }));
  } else {
    problem("Couldn't load this proof", error.message);
  }
}
