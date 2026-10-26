// Order emails, sent through Resend (https://resend.com):
//   - every new order: an alert to the merch admins (ORDER_EMAIL_TO) and a
//     confirmation to the person who placed it. With ORDER_EMAIL_TO_POS and/or
//     ORDER_EMAIL_TO_SAMPLES set, the alert is split: point-of-sale lines go
//     to one inbox and samples to the other, each with just its own lines
//   - every status change: an update to that person (approved, approved in
//     part with each item that wasn't and why, shipped with the tracking link
//     or a note that it's coming, delivered, declined with the reason,
//     cancelled), and the tracking link when it's added after shipping
//   - items forwarded to someone else to ship (a supplier, a rep): the items,
//     where they go and a link to their page for entering tracking to that
//     person, a note if they're called off, and an update to the requester
//     when they ship (and when tracking is added); when the supplier does it
//     on their page, the admins are told too
//   - a requester cancelling their own order: a note to the admins
//   - an invite from the admin: a link to create (or reset) a password
//   - a request for an out-of-stock item: an alert to the admins, then to the
//     requester when it's back in stock or the request is closed
//
// Everything typed by someone else is escaped before it goes into the HTML.
// Sending never holds up or undoes an order: emails go out one after another
// in the background, and failures are logged.

import {
  ACCOUNT_TYPES,
  CARRIERS,
  PURPOSES,
  activeForwards,
  cardText,
  forwardLines,
  formatMoney,
  inHouseLines,
  isDenied,
  labelFor,
  optionText,
  shippingLines,
  trackingUrl,
} from "../public/assets/shared.js";

const RESEND_URL = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]{2,}$/;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** "a@x.com, b@y.com" → valid addresses only. */
export function parseAddresses(value) {
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => EMAIL_RE.test(a));
}

function calendarDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

/* ---------------------------------------------------------------- routing */

/** A sample: the Samples category, or for orders from before lines kept it, an SMP SKU. */
export function isSampleLine(line) {
  return line.category ? line.category === "Samples" : /-SMP-\d+$/i.test(String(line.sku ?? ""));
}

/** Just these lines of an order, with their own totals. */
function partOf(order, lines) {
  return {
    ...order,
    lines,
    totalUnits: lines.reduce((n, l) => n + l.quantity, 0),
    totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
  };
}

const sameList = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Who the admin emails about an order go to, as [{ kind, to, cc, order }]. With
 * no routes, everyone in adminTo gets the whole order (kind ""). With routes,
 * point-of-sale lines go to routes.pos and samples to routes.samples (either
 * falling back to adminTo), each with only its part of the order; when both
 * parts go to the same people they get one email with the whole order.
 * routes.cc copies people in: cc.pos / cc.samples on those parts' emails,
 * falling back to cc.all, which is also the copy list when nothing is routed.
 */
export function adminRoutes(order, { adminTo = [], routes = {} } = {}) {
  const cc = routes.cc ?? {};
  // copy people in, but never someone already on the To line
  const ccFor = (kind) => (cc[kind]?.length ? cc[kind] : cc.all) ?? [];
  const withCc = (group) => {
    const list = group.kinds ? [...new Set(group.kinds.flatMap(ccFor))] : ccFor(group.kind);
    return { ...group, cc: list.filter((a) => !group.to.includes(a)) };
  };
  return routeGroups(order, adminTo, routes).map(withCc);
}

function routeGroups(order, adminTo, routes) {
  const posTo = routes.pos?.length ? routes.pos : adminTo;
  const samplesTo = routes.samples?.length ? routes.samples : adminTo;
  if (!routes.pos?.length && !routes.samples?.length) return adminTo.length ? [{ kind: "", to: adminTo, order }] : [];
  const samples = order.lines.filter(isSampleLine);
  const pos = order.lines.filter((l) => !isSampleLine(l));
  if (pos.length && samples.length && sameList(posTo, samplesTo)) return posTo.length ? [{ kind: "", kinds: ["pos", "samples"], to: posTo, order }] : [];
  const groups = [];
  if (pos.length && posTo.length) groups.push({ kind: "pos", to: posTo, order: samples.length ? partOf(order, pos) : order });
  if (samples.length && samplesTo.length) groups.push({ kind: "samples", to: samplesTo, order: pos.length ? partOf(order, samples) : order });
  return groups;
}

const KIND = {
  "": { request: "merch order", other: "" },
  pos: { request: "point-of-sale request", other: "This order also has samples, which went to the samples inbox." },
  samples: { request: "samples request", other: "This order also has point-of-sale items, which went to the point-of-sale inbox." },
};

/* ---------------------------------------------------------------- content */

// Each email is built from these blocks, rendered once as HTML and once as
// plain text.
const block = {
  p: (text) => ({ kind: "p", text }),
  note: (label, text) => ({ kind: "note", label, text }),
  // `forFulfiller`: no prices, and each SKU, for whoever ships them
  items: (order, { forFulfiller = false } = {}) => ({ kind: "items", order, forFulfiller }),
  details: (rows) => ({ kind: "details", rows: rows.filter(Boolean) }),
  button: (label, url) => (url ? { kind: "button", label, url } : null),
};

/** The order's total, or with lines denied, the total of what was approved. */
function itemTotals(order) {
  if (!order.lines.some(isDenied)) return { units: order.totalUnits, cents: order.totalCents, label: "" };
  const lines = shippingLines(order);
  return { units: lines.reduce((n, l) => n + l.quantity, 0), cents: lines.reduce((n, l) => n + l.lineTotalCents, 0), label: "Approved: " };
}

/** Just the lines that ship (none denied), for the email once it's delivered. */
function shippedPart(order) {
  return order.lines.some(isDenied) ? partOf(order, shippingLines(order)) : order;
}

/** Just what the merch team ships itself, leaving out what was forwarded. */
function inHousePart(order) {
  const lines = inHouseLines(order);
  return lines.length === order.lines.length ? order : partOf(order, lines);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Ten 10 Design and Jane Smith" */
function names(list) {
  const unique = [...new Set(list)];
  return unique.length <= 1 ? unique.join("") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** What the forwards of an order ship, for the requester's shipped email: "2 items ship separately from X." */
function separately(order) {
  const forwards = activeForwards(order);
  if (!forwards.length) return null;
  const count = forwards.reduce((n, f) => n + forwardLines(order, f).length, 0);
  return block.p(
    `${count === 1 ? "One item ships" : `${count} items ship`} separately from ${names(forwards.map((f) => f.to.name))}. You'll get ${count === 1 ? "its" : "their"} tracking in a separate email.`
  );
}

function shipToLines(order) {
  const s = order.shipTo;
  return [
    s.type === "account" ? `${s.accountName} (${labelFor(ACCOUNT_TYPES, s.accountType)})` : null,
    s.type === "account" ? `Attn: ${s.attention}` : s.attention,
    s.address1,
    s.address2,
    `${s.city}, ${s.state} ${s.postalCode}`,
    s.phone,
  ].filter(Boolean);
}

function orderDetails(order, { forAdmin }) {
  return block.details([
    forAdmin ? ["Requested by", `${order.requester.name} <${order.requester.email}>`] : null,
    forAdmin && order.requester.distributor ? ["Distributor", order.requester.distributor] : null,
    ["Ships to", shipToLines(order).join("\n")],
    order.shipTo.deliveryNotes ? ["Delivery notes", order.shipTo.deliveryNotes] : null,
    ["For", labelFor(PURPOSES, order.purpose)],
    ["Needed by", order.neededBy ? calendarDate(order.neededBy) : "No date given"],
    ["Shipping", order.shippingSpeed === "rush" ? `Rush: ${order.rushReason}` : "Standard"],
    order.notes ? ["Notes", order.notes] : null,
  ]);
}

/**
 * The emails one event sends, as [{ role, to, replyTo, subject, blocks }].
 * `byRequester` marks a cancellation the requester made themselves.
 */
export function orderEmails(
  event,
  order,
  { adminTo = [], routes = {}, baseUrl = "", byRequester = false, forward = null, shipLink = "", bySupplier = false } = {}
) {
  const base = baseUrl.replace(/\/$/, "");
  const adminLink = base ? `${base}/admin?order=${encodeURIComponent(order.id)}` : "";
  const mineLink = base ? `${base}/orders` : "";
  const latest = order.history[order.history.length - 1] ?? {};
  const requester = order.requester;
  const hi = `Hi ${firstName(requester.name)},`;
  const groups = adminRoutes(order, { adminTo, routes });
  const replyTo = [...new Set(groups.flatMap((g) => g.to))];
  const toRequester = (subject, blocks) => ({ role: "requester", to: [requester.email], replyTo, subject, blocks });
  // one email per inbox the order goes to, each about its own part
  const toAdmins = (build) =>
    groups.map((g) => {
      const { subject, blocks } = build(g.order, KIND[g.kind]);
      const split = g.order !== order;
      return { role: g.kind ? `admin-${g.kind}` : "admin", to: g.to, cc: g.cc, replyTo: [requester.email], subject, blocks: split ? [blocks[0], block.p(KIND[g.kind].other), ...blocks.slice(1)] : blocks };
    });

  const emails = [];
  switch (event) {
    case "order.created": {
      const rush = order.shippingSpeed === "rush";
      emails.push(
        ...toAdmins((part, kind) => ({
          subject: `${rush ? "RUSH: " : ""}New ${kind.request} ${order.number} from ${requester.name}${requester.distributor ? ` (${requester.distributor})` : ""}`,
          blocks: [
            block.p(`${requester.name} placed order ${order.number}. It's waiting for your approval.`),
            block.items(part),
            orderDetails(order, { forAdmin: true }),
            block.button("Review it in the admin console", adminLink),
          ],
        })),
        toRequester(`We got your merch order ${order.number}`, [
          block.p(hi),
          block.p(`Thanks for your order. The merch admin will review it, and you'll get an email when it's approved and when it ships.`),
          block.items(order),
          orderDetails(order, { forAdmin: false }),
          block.button("See it under My orders", mineLink),
        ])
      );
      break;
    }
    case "order.approved": {
      const itemByItem = order.lines.some((l) => l.decision);
      emails.push(
        toRequester(`Your merch order ${order.number} is approved`, [
          block.p(hi),
          block.p(
            itemByItem
              ? `Good news: every item in order ${order.number} is approved, and it will be packed and shipped next.`
              : `Good news: order ${order.number} is approved and will be packed and shipped next.`
          ),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.items(order),
          block.button("See it under My orders", mineLink),
        ])
      );
      break;
    }
    case "order.reviewed": {
      const denied = order.lines.filter(isDenied).length;
      const approved = order.lines.length - denied;
      emails.push(
        toRequester(`Your merch order ${order.number}: ${approved} of ${order.lines.length} items approved`, [
          block.p(hi),
          block.p(
            `The merch admin reviewed order ${order.number}. ${approved === 1 ? "One item is" : `${approved} items are`} approved and will be packed and shipped next. ${denied === 1 ? "One item wasn't" : `${denied} items weren't`} approved, so ${denied === 1 ? "it" : "they"} won't ship.`
          ),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.items(order),
          block.p("Reply to this email if you have questions."),
          block.button("See it under My orders", mineLink),
        ])
      );
      break;
    }
    case "order.shipped": {
      const shipment = order.shipment ?? {};
      const carrier = shipment.carrier ? labelFor(CARRIERS, shipment.carrier) : "";
      const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
      const later = shipment.carrier !== "hand" && !shipment.trackingNumber;
      const how =
        shipment.carrier === "hand"
          ? `Order ${order.number} is on its way: it's being hand-delivered.`
          : `Order ${order.number} has shipped${carrier ? ` via ${carrier}` : ""}${shipment.trackingNumber ? `, tracking number ${shipment.trackingNumber}` : ""}.`;
      emails.push(
        toRequester(`Your merch order ${order.number} has shipped`, [
          block.p(hi),
          block.p(how),
          later ? block.p("We'll email you the tracking number as soon as we have it.") : null,
          separately(order),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.button("Track the package", url),
          block.items(inHousePart(order)),
          block.details([["Ships to", shipToLines(order).join("\n")]]),
        ])
      );
      break;
    }
    case "order.tracking": {
      const shipment = order.shipment ?? {};
      const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
      emails.push(
        toRequester(`Tracking for your merch order ${order.number}`, [
          block.p(hi),
          block.p(
            `Here's the tracking for order ${order.number}${shipment.carrier ? `, shipped via ${labelFor(CARRIERS, shipment.carrier)}` : ""}: ${shipment.trackingNumber}.`
          ),
          block.button("Track the package", url),
          block.items(inHousePart(order)),
          block.details([["Ships to", shipToLines(order).join("\n")]]),
        ])
      );
      break;
    }
    case "forward.sent":
    case "forward.cancelled": {
      // An order placed on a printer's own site (forward.vendor) has no one to email.
      if (!forward?.to.email) break;
      const part = partOf(order, forwardLines(order, forward));
      const these = part.lines.length === 1 ? "this item" : `these ${part.lines.length} items`;
      // The requesters' footer (nothing is charged to you) isn't for a supplier.
      const toFulfiller = (subject, blocks) => ({ role: "fulfiller", to: [forward.to.email], replyTo, subject, blocks, footer: FULFILLER_FOOTER });
      if (event === "forward.sent") {
        const rush = order.shippingSpeed === "rush";
        emails.push(
          toFulfiller(`${rush ? "RUSH: " : ""}Please ship ${plural(part.lines.length, "item")} for Tropical Distillery merch order ${order.number}`, [
            block.p("Hello,"),
            block.p(
              `The Tropical Distillery merch team is asking you to ship ${these} from order ${order.number} straight to the address below${order.neededBy ? `, to arrive by ${calendarDate(order.neededBy)}` : ""}.`
            ),
            forward.note ? block.note(`Message from ${forward.by}`, forward.note) : null,
            block.items(part, { forFulfiller: true }),
            block.details([
              ["Ship to", shipToLines(order).join("\n")],
              order.shipTo.deliveryNotes ? ["Delivery notes", order.shipTo.deliveryNotes] : null,
              ["Needed by", order.neededBy ? calendarDate(order.neededBy) : "No date given"],
              ["Shipping", rush ? `Rush: ${order.rushReason}` : "Standard"],
              ["Ordered by", `${requester.name}${requester.distributor ? ` (${requester.distributor})` : ""}`],
            ]),
            shipLink
              ? block.p("When it ships, enter the carrier and tracking number on this page and we'll pass them on. You can come back to it to add tracking later.")
              : block.p("When it ships, reply to this email with the carrier and tracking number, and we'll pass them on."),
            block.button("Enter shipping & tracking", shipLink),
            block.p(shipLink ? "Questions? Just reply to this email." : "Reply with any questions too."),
          ])
        );
      } else {
        emails.push(
          toFulfiller(`Cancelled: please don't ship merch order ${order.number}`, [
            block.p("Hello,"),
            block.p(`Please don't ship ${these} from order ${order.number}, which we asked you to send. They're no longer needed from you.`),
            block.p("If they've already gone out, reply to let us know."),
            block.items(part, { forFulfiller: true }),
          ])
        );
      }
      break;
    }
    case "forward.shipped":
    case "forward.tracking": {
      if (!forward) break;
      const lines = forwardLines(order, forward);
      const whole = lines.length === shippingLines(order).length;
      const shipment = forward.shipment ?? {};
      const carrier = shipment.carrier ? labelFor(CARRIERS, shipment.carrier) : "";
      const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
      const what = whole ? `Order ${order.number}` : `${plural(lines.length, "item")} from order ${order.number}`;
      // Done by the supplier on their page: the admins hear about it too.
      if (bySupplier && replyTo.length) {
        emails.push({
          role: "admin",
          to: replyTo,
          replyTo: [forward.to.email],
          subject:
            event === "forward.shipped"
              ? `${forward.to.name} shipped ${plural(lines.length, "item")} for merch order ${order.number}`
              : `${forward.to.name} added tracking for merch order ${order.number}`,
          blocks: [
            block.p(
              `${forward.to.name} ${event === "forward.shipped" ? "marked these shipped" : "updated the tracking"} for ${requester.name}'s order ${order.number}${carrier ? `: ${carrier}` : ""}${shipment.trackingNumber ? `, tracking ${shipment.trackingNumber}` : event === "forward.shipped" && shipment.carrier !== "hand" ? ", no tracking number yet" : ""}. ${requester.name} has been emailed.`
            ),
            block.items(partOf(order, lines), { forFulfiller: true }),
            block.button("Open it in the admin console", adminLink),
          ],
        });
      }
      if (event === "forward.shipped") {
        const how =
          shipment.carrier === "hand"
            ? `${what} ${whole || lines.length === 1 ? "is" : "are"} on the way: ${forward.to.name} is hand-delivering ${whole || lines.length === 1 ? "it" : "them"}.`
            : `${what} shipped from ${forward.to.name}${carrier ? ` via ${carrier}` : ""}${shipment.trackingNumber ? `, tracking number ${shipment.trackingNumber}` : ""}.`;
        emails.push(
          toRequester(whole ? `Your merch order ${order.number} has shipped` : `Part of your merch order ${order.number} has shipped`, [
            block.p(hi),
            block.p(how),
            shipment.carrier !== "hand" && !shipment.trackingNumber ? block.p("We'll email you the tracking number as soon as we have it.") : null,
            whole ? null : block.p("The rest of your order ships separately."),
            block.button("Track the package", url),
            block.items(partOf(order, lines)),
            block.details([["Ships to", shipToLines(order).join("\n")]]),
          ])
        );
      } else {
        emails.push(
          toRequester(`Tracking for your merch order ${order.number}`, [
            block.p(hi),
            block.p(
              `Here's the tracking for ${whole ? `order ${order.number}` : `the ${plural(lines.length, "item")} from order ${order.number}`} shipping from ${forward.to.name}${carrier ? ` via ${carrier}` : ""}: ${shipment.trackingNumber}.`
            ),
            block.button("Track the package", url),
            block.items(partOf(order, lines)),
            block.details([["Ships to", shipToLines(order).join("\n")]]),
          ])
        );
      }
      break;
    }
    case "order.delivered":
      emails.push(
        toRequester(`Your merch order ${order.number} was delivered`, [
          block.p(hi),
          block.p(`Order ${order.number} has been delivered. Reply to this email if anything is missing or damaged.`),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.items(shippedPart(order)),
        ])
      );
      break;
    case "order.declined": {
      // Declined item by item, each line carries its own reason.
      const reasonsOnItems = order.lines.some((l) => l.decision?.reason);
      emails.push(
        toRequester(`Your merch order ${order.number} was declined`, [
          block.p(hi),
          block.p(`Order ${order.number} wasn't approved, and nothing will ship.`),
          latest.note || !reasonsOnItems ? block.note("Reason", latest.note || "No reason was given.") : null,
          block.p("Reply to this email if you have questions, or place a new order from the store."),
          block.items(order),
        ])
      );
      break;
    }
    case "order.cancelled":
      if (byRequester) {
        emails.push(
          ...toAdmins((part, kind) => ({
            subject: `${requester.name} cancelled ${kind.request} ${order.number}`,
            blocks: [
              block.p(`${requester.name} cancelled order ${order.number} before it was approved. Its stock is back on the shelf.`),
              block.items(part),
              block.button("Open it in the admin console", adminLink),
            ],
          }))
        );
      } else {
        emails.push(
          toRequester(`Your merch order ${order.number} was cancelled`, [
            block.p(hi),
            block.p(`Order ${order.number} was cancelled by the merch admin, and nothing will ship.`),
            latest.note ? block.note("Reason", latest.note) : null,
            block.items(order),
          ])
        );
      }
      break;
    default:
      break;
  }
  return emails.filter(Boolean).map((email) => ({ ...email, blocks: email.blocks.filter(Boolean) }));
}

/* -------------------------------------------------------------- rendering */

const INK = "#14203a";
const MUTED = "#556078";
const PINK = "#c92f74";
const BUTTON = "#cf3579";
const LINE = "#eadfd6";

function htmlBlock(b) {
  switch (b.kind) {
    case "p":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${escapeHtml(b.text)}</p>`;
    case "note":
      return `<div style="margin:0 0 16px;padding:12px 14px;background:#fdedf4;border-radius:10px"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${PINK}">${escapeHtml(b.label)}</div><div style="margin-top:4px;font-size:15px;line-height:1.5;white-space:pre-line">${escapeHtml(b.text)}</div></div>`;
    case "items": {
      if (b.forFulfiller) {
        const rows = b.order.lines
          .map((l) => {
            const detail = [optionText(l), l.unit, `SKU ${l.sku}`].filter(Boolean).join(" · ");
            // Business cards: exactly what to print (the proof is on their shipping page).
            const card = l.card ? `<div style="margin-top:3px;font-size:13px">Print: ${escapeHtml(cardText(l.card))}</div>` : "";
            return `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;vertical-align:top;width:52px"><strong>${l.quantity}×</strong></td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px"><div style="font-weight:600">${escapeHtml(l.name)}</div><div style="color:${MUTED};font-size:13px">${escapeHtml(detail)}</div>${card}</td></tr>`;
          })
          .join("");
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse">${rows}</table>`;
      }
      const rows = b.order.lines
        .map((l) => {
          const detail = [optionText(l), l.unit].filter(Boolean).join(" · ");
          const denied = isDenied(l);
          const status = denied
            ? `<div style="margin-top:3px;color:${PINK};font-size:13px;font-weight:600">Not approved${l.decision.reason ? `: ${escapeHtml(l.decision.reason)}` : ""}</div>`
            : l.decision
              ? `<div style="margin-top:3px;color:#2e6b1f;font-size:13px;font-weight:600">Approved</div>`
              : "";
          const strike = denied ? ";color:#8a93a6;text-decoration:line-through" : "";
          return `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;vertical-align:top;width:44px${strike}"><strong>${l.quantity}×</strong></td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px"><div style="font-weight:600${strike}">${escapeHtml(l.name)}</div>${detail ? `<div style="color:${MUTED};font-size:13px">${escapeHtml(detail)}</div>` : ""}${status}</td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;white-space:nowrap;vertical-align:top${strike}">${escapeHtml(formatMoney(l.lineTotalCents))}</td></tr>`;
        })
        .join("");
      const { units, cents, label } = itemTotals(b.order);
      const total = `<tr><td></td><td style="padding:10px 0 0;font-size:14px;font-weight:700">${label}${units} unit${units === 1 ? "" : "s"}</td><td style="padding:10px 0 0;font-size:14px;font-weight:700;text-align:right">${escapeHtml(formatMoney(cents))}</td></tr>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-collapse:collapse">${rows}${total}</table>`;
    }
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse">${b.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:5px 12px 5px 0;font-size:13px;color:${MUTED};vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:5px 0;font-size:14px;line-height:1.45;white-space:pre-line">${escapeHtml(v)}</td></tr>`
        )
        .join("")}</table>`;
    case "button":
      return `<p style="margin:6px 0 18px"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:12px 22px;background:${BUTTON};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:999px">${escapeHtml(b.label)}</a></p>`;
    default:
      return "";
  }
}

function textBlock(b) {
  switch (b.kind) {
    case "p":
      return b.text;
    case "note":
      return `${b.label}: ${b.text}`;
    case "items": {
      if (b.forFulfiller) {
        return b.order.lines
          .map((l) => `${l.quantity} × ${l.name}${optionText(l) ? ` (${optionText(l)})` : ""}, SKU ${l.sku}${l.card ? `\n    Print: ${cardText(l.card)}` : ""}`)
          .join("\n");
      }
      const { units, cents, label } = itemTotals(b.order);
      return [
        ...b.order.lines.map((l) => {
          const detail = optionText(l);
          const status = isDenied(l) ? ` (NOT APPROVED${l.decision.reason ? `: ${l.decision.reason}` : ""})` : l.decision ? " (approved)" : "";
          return `${l.quantity} × ${l.name}${detail ? ` (${detail})` : ""}: ${formatMoney(l.lineTotalCents)}${status}`;
        }),
        `${label ? label.replace(/: $/, "") : "Total"}: ${units} unit${units === 1 ? "" : "s"}, ${formatMoney(cents)}`,
      ].join("\n");
    }
    case "details":
      return b.rows.map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ", ")}`).join("\n");
    case "button":
      return `${b.label}: ${b.url}`;
    default:
      return "";
  }
}

const FOOTER = "Sent by the Tropical Distillery team merch store. Nothing is ever charged to you: costs show what each order is worth.";
const FULFILLER_FOOTER = "Sent by the Tropical Distillery team merch store on behalf of the merch team. Reply to reach them.";

export function renderEmail({ subject, blocks, footer = FOOTER }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#fffaf5;color:${INK};font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf5"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden"><tr><td style="height:5px;background:#e84890;background-image:linear-gradient(90deg,#e84890,#50b0e0)"></td></tr><tr><td style="padding:26px 28px 10px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${PINK}">Tropical Distillery team merch</div><h1 style="margin:6px 0 16px;font-size:21px;line-height:1.3;color:${INK}">${escapeHtml(subject)}</h1>${blocks.map(htmlBlock).join("")}</td></tr></table><p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${MUTED}">${escapeHtml(footer)}</p></td></tr></table></body></html>`;
  const text = `${subject}\n\n${blocks.map(textBlock).join("\n\n")}\n\n--\nTropical Distillery team merch store\n`;
  return { html, text };
}

/* -------------------------------------------------------------- requests */

/** Emails about a request for an out-of-stock item, as [{ role, to, cc, replyTo, subject, blocks }]. */
export function requestEmails(event, request, { adminTo = [], routes = {}, baseUrl = "" } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const who = request.requester;
  const detail = optionText({ color: request.color, variantLabel: request.variantLabel });
  const what = `${request.name}${detail ? ` (${detail})` : ""}`;
  // Routed like an order with this one line: samples to the samples inbox,
  // everything else to point of sale.
  const groups = adminRoutes({ lines: [{ category: request.category, sku: request.sku, quantity: request.quantity, lineTotalCents: 0 }] }, { adminTo, routes });
  const replyTo = [...new Set(groups.flatMap((g) => g.to))];
  const latest = request.history[request.history.length - 1] ?? {};
  const toRequester = (subject, blocks) => ({ role: "requester", to: [who.email], replyTo, subject, blocks });

  switch (event) {
    case "request.created":
      return groups.map((g) => ({
        role: g.kind ? `admin-${g.kind}` : "admin",
        to: g.to,
        cc: g.cc,
        replyTo: [who.email],
        subject: `Item request: ${request.quantity} × ${what} from ${who.name}${who.distributor ? ` (${who.distributor})` : ""}`,
        blocks: [
          block.p(`${who.name} asked for an item that's out of stock.`),
          block.details([
            ["Item", `${request.name} (${request.sku})`],
            detail ? ["Option", detail] : null,
            ["How many", `${request.quantity}${request.unit && request.unit !== "Each" ? ` × ${request.unit.toLowerCase()}` : ""}`],
            ["Requested by", `${who.name} <${who.email}>`],
            who.distributor ? ["Distributor", who.distributor] : null,
          ]),
          request.note ? block.note("Their note", request.note) : null,
          block.button("See requests in the admin console", base ? `${base}/admin#requests` : ""),
        ].filter(Boolean),
      }));
    case "request.notified":
      return [
        toRequester(`${request.name} is back in stock`, [
          block.p(`Hi ${firstName(who.name)},`),
          block.p(`Good news: ${what}, which you asked for, is back in stock. Order it while it lasts.`),
          block.button("Order it now", base ? `${base}/shop` : ""),
          latest.note ? block.note("From the merch team", latest.note) : null,
        ].filter(Boolean)),
      ];
    case "request.closed":
      return [
        toRequester(`About your request for ${request.name}`, [
          block.p(`Hi ${firstName(who.name)},`),
          block.p(`Your request for ${request.quantity} × ${what} has been closed by the merch team.`),
          latest.note ? block.note("Why", latest.note) : null,
          block.p("Reply to this email if you have questions."),
        ].filter(Boolean)),
      ];
    default:
      return [];
  }
}

/* ---------------------------------------------------------------- invites */

/**
 * An invite to create a password, or to choose a new one for someone who has
 * one already. Replies go to the admins.
 */
export function inviteEmail(person, { link, by = "", days = 14, replyTo = [] } = {}) {
  const reset = Boolean(person.passwordSetAt);
  const who = by && by !== "Admin" ? by : "The merch admin";
  return {
    role: "invite",
    to: [person.email],
    replyTo,
    subject: reset ? "Choose a new password for the Tropical Distillery merch store" : "Create your Tropical Distillery merch store password",
    blocks: [
      block.p(`Hi ${firstName(person.name)},`),
      reset
        ? block.p(`${who} sent you a link to choose a new password for the Tropical Distillery team merch store.`)
        : block.p(
            `${who} invited you to the Tropical Distillery team merch store, where you can order team gear, point-of-sale and event supplies for yourself or straight to your accounts. It's all covered by the marketing budget.`
          ),
      block.button(reset ? "Choose a new password" : "Create your password", link),
      block.p(
        `You'll sign in with ${person.email} and the password you choose. The link works once and expires in ${days} days; if it runs out, ask for a new one.`
      ),
    ],
  };
}

/* ---------------------------------------------------------------- sending */

/**
 * notify(event, order, { byRequester, resend, forward, shipLink, bySupplier }) for the app, or a no-op without an
 * API key and a from address. Emails are sent one at a time, a little apart,
 * well inside Resend's rate limit; a 429 or a server error is retried twice.
 * notify.invite(person, { link, by, key }) sends an invite the same way, and
 * notify.enabled says whether anything is sent at all.
 */
export function createEmailer({
  apiKey,
  from,
  adminTo = [],
  routes = {},
  baseUrl = "",
  log = console,
  fetchImpl = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gapMs = 250,
} = {}) {
  if (!apiKey || !from) {
    const off = () => Promise.resolve();
    off.enabled = false;
    off.invite = () => Promise.resolve();
    off.request = () => Promise.resolve();
    return off;
  }

  let queue = Promise.resolve();
  let last = 0;

  async function send(email, key) {
    const { html, text } = renderEmail(email);
    const body = JSON.stringify({ from, to: email.to, cc: email.cc?.length ? email.cc : undefined, reply_to: email.replyTo.length ? email.replyTo : undefined, subject: email.subject, html, text });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let response;
      try {
        response = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
          body,
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (attempt === 3) return log.error(`[email] couldn't reach Resend for "${email.subject}": ${error.message}`);
        await sleep(1000 * attempt);
        continue;
      }
      if (response.ok) {
        const { id } = await response.json().catch(() => ({}));
        const count = email.to.length + (email.cc?.length ?? 0);
        return log.info?.(`[email] sent "${email.subject}" to ${count} address${count === 1 ? "" : "es"}${id ? ` (Resend id ${id})` : ""}`);
      }
      const retry = response.status === 429 || response.status >= 500;
      if (!retry || attempt === 3) {
        const detail = await response.text().catch(() => "");
        return log.error(`[email] Resend answered ${response.status} for "${email.subject}": ${detail.slice(0, 300)}`);
      }
      await sleep(Math.max(1000 * attempt, Number(response.headers.get("retry-after")) * 1000 || 0));
    }
  }

  function enqueue(email, key) {
    queue = queue.then(() => send(email, key)).catch((error) => log.error(`[email] ${error.message}`));
    return queue;
  }

  function notify(event, order, { byRequester = false, resend = "", forward = null, shipLink = "", bySupplier = false } = {}) {
    const emails = orderEmails(event, order, { adminTo, routes, baseUrl, byRequester, forward, shipLink, bySupplier });
    // The same event on the same order is only ever emailed once, even if a
    // request is retried; the admin sending it again on purpose (`resend`)
    // gets a new key. Tracking is keyed by the tracking number it carries,
    // and a forward's emails by the forward.
    const at = forward
      ? `${forward.id}${event === "forward.tracking" ? `:${forward.shipment?.trackingNumber}` : ""}`
      : event === "order.tracking"
        ? order.shipment?.trackingNumber
        : order.history.length;
    for (const email of emails) enqueue(email, `${order.id}:${event}:${at}:${email.role}${resend ? `:${resend}` : ""}`);
    return queue;
  }

  notify.enabled = true;
  notify.request = (event, request) => {
    for (const email of requestEmails(event, request, { adminTo, routes, baseUrl })) {
      enqueue(email, `request:${request.id}:${event}:${request.history.length}:${email.role}`);
    }
    return queue;
  };
  // Each invite has its own key, so a new one is always sent.
  notify.invite = (person, { link, by, key }) =>
    enqueue(inviteEmail(person, { link, by, replyTo: adminTo.length ? adminTo : routes.pos ?? [] }), `invite:${person.id}:${key}`);
  return notify;
}
