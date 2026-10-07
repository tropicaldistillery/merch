// Order emails, sent through Resend (https://resend.com):
//   - every new order: an alert to the merch admins (ORDER_EMAIL_TO) and a
//     confirmation to the person who placed it
//   - every status change: an update to that person (approved, shipped with
//     the tracking link, delivered, declined with the reason, cancelled)
//   - a requester cancelling their own order: a note to the admins
//
// Everything typed by someone else is escaped before it goes into the HTML.
// Sending never holds up or undoes an order: emails go out one after another
// in the background, and failures are logged.

import { ACCOUNT_TYPES, CARRIERS, PURPOSES, STATUSES, formatMoney, labelFor, optionText, trackingUrl } from "../public/assets/shared.js";

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

/* ---------------------------------------------------------------- content */

// Each email is built from these blocks, rendered once as HTML and once as
// plain text.
const block = {
  p: (text) => ({ kind: "p", text }),
  note: (label, text) => ({ kind: "note", label, text }),
  items: (order) => ({ kind: "items", order }),
  details: (rows) => ({ kind: "details", rows: rows.filter(Boolean) }),
  button: (label, url) => (url ? { kind: "button", label, url } : null),
};

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
export function orderEmails(event, order, { adminTo = [], baseUrl = "", byRequester = false } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const adminLink = base ? `${base}/admin?order=${encodeURIComponent(order.id)}` : "";
  const mineLink = base ? `${base}/orders` : "";
  const latest = order.history[order.history.length - 1] ?? {};
  const requester = order.requester;
  const hi = `Hi ${firstName(requester.name)},`;
  const toRequester = (subject, blocks) => ({ role: "requester", to: [requester.email], replyTo: adminTo, subject, blocks });
  const toAdmins = (subject, blocks) =>
    adminTo.length ? { role: "admin", to: adminTo, replyTo: [requester.email], subject, blocks } : null;

  const emails = [];
  switch (event) {
    case "order.created": {
      const rush = order.shippingSpeed === "rush";
      emails.push(
        toAdmins(`${rush ? "RUSH: " : ""}New merch order ${order.number} from ${requester.name}`, [
          block.p(`${requester.name} placed order ${order.number}. It's waiting for your approval.`),
          block.items(order),
          orderDetails(order, { forAdmin: true }),
          block.button("Review it in the admin console", adminLink),
        ]),
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
    case "order.approved":
      emails.push(
        toRequester(`Your merch order ${order.number} is approved`, [
          block.p(hi),
          block.p(`Good news: order ${order.number} is approved and will be packed and shipped next.`),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.items(order),
          block.button("See it under My orders", mineLink),
        ])
      );
      break;
    case "order.shipped": {
      const shipment = order.shipment ?? {};
      const carrier = labelFor(CARRIERS, shipment.carrier);
      const url = trackingUrl(shipment.carrier, shipment.trackingNumber);
      const how =
        shipment.carrier === "hand"
          ? `Order ${order.number} is on its way: it's being hand-delivered.`
          : `Order ${order.number} has shipped via ${carrier}${shipment.trackingNumber ? `, tracking number ${shipment.trackingNumber}` : ""}.`;
      emails.push(
        toRequester(`Your merch order ${order.number} has shipped`, [
          block.p(hi),
          block.p(how),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.button("Track the package", url),
          block.items(order),
          block.details([["Ships to", shipToLines(order).join("\n")]]),
        ])
      );
      break;
    }
    case "order.delivered":
      emails.push(
        toRequester(`Your merch order ${order.number} was delivered`, [
          block.p(hi),
          block.p(`Order ${order.number} has been delivered. Reply to this email if anything is missing or damaged.`),
          latest.note ? block.note("Note from the merch admin", latest.note) : null,
          block.items(order),
        ])
      );
      break;
    case "order.declined":
      emails.push(
        toRequester(`Your merch order ${order.number} was declined`, [
          block.p(hi),
          block.p(`Order ${order.number} wasn't approved, and nothing will ship.`),
          block.note("Reason", latest.note || "No reason was given."),
          block.p("Reply to this email if you have questions, or place a new order from the store."),
          block.items(order),
        ])
      );
      break;
    case "order.cancelled":
      if (byRequester) {
        emails.push(
          toAdmins(`${requester.name} cancelled merch order ${order.number}`, [
            block.p(`${requester.name} cancelled order ${order.number} before it was approved. Its stock is back on the shelf.`),
            block.items(order),
            block.button("Open it in the admin console", adminLink),
          ])
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
      const rows = b.order.lines
        .map((l) => {
          const detail = [optionText(l), l.unit].filter(Boolean).join(" · ");
          return `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;vertical-align:top;width:44px"><strong>${l.quantity}×</strong></td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px"><div style="font-weight:600">${escapeHtml(l.name)}</div>${detail ? `<div style="color:${MUTED};font-size:13px">${escapeHtml(detail)}</div>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;white-space:nowrap;vertical-align:top">${escapeHtml(formatMoney(l.lineTotalCents))}</td></tr>`;
        })
        .join("");
      const total = `<tr><td></td><td style="padding:10px 0 0;font-size:14px;font-weight:700">${b.order.totalUnits} unit${b.order.totalUnits === 1 ? "" : "s"}</td><td style="padding:10px 0 0;font-size:14px;font-weight:700;text-align:right">${escapeHtml(formatMoney(b.order.totalCents))}</td></tr>`;
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
    case "items":
      return [
        ...b.order.lines.map((l) => {
          const detail = optionText(l);
          return `${l.quantity} × ${l.name}${detail ? ` (${detail})` : ""}: ${formatMoney(l.lineTotalCents)}`;
        }),
        `Total: ${b.order.totalUnits} unit${b.order.totalUnits === 1 ? "" : "s"}, ${formatMoney(b.order.totalCents)}`,
      ].join("\n");
    case "details":
      return b.rows.map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ", ")}`).join("\n");
    case "button":
      return `${b.label}: ${b.url}`;
    default:
      return "";
  }
}

export function renderEmail({ subject, blocks }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#fffaf5;color:${INK};font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf5"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden"><tr><td style="height:5px;background:#e84890;background-image:linear-gradient(90deg,#e84890,#50b0e0)"></td></tr><tr><td style="padding:26px 28px 10px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${PINK}">Tropical Distillery team merch</div><h1 style="margin:6px 0 16px;font-size:21px;line-height:1.3;color:${INK}">${escapeHtml(subject)}</h1>${blocks.map(htmlBlock).join("")}</td></tr></table><p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:${MUTED}">Sent by the Tropical Distillery team merch store. Nothing is ever charged to you: costs show what each order is worth.</p></td></tr></table></body></html>`;
  const text = `${subject}\n\n${blocks.map(textBlock).join("\n\n")}\n\n--\nTropical Distillery team merch store\n`;
  return { html, text };
}

/* ---------------------------------------------------------------- sending */

/**
 * notify(event, order, { byRequester }) for the app, or a no-op without an
 * API key and a from address. Emails are sent one at a time, a little apart,
 * well inside Resend's rate limit; a 429 or a server error is retried twice.
 */
export function createEmailer({
  apiKey,
  from,
  adminTo = [],
  baseUrl = "",
  log = console,
  fetchImpl = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gapMs = 250,
} = {}) {
  if (!apiKey || !from) return () => Promise.resolve();

  let queue = Promise.resolve();
  let last = 0;

  async function send(email, key) {
    const { html, text } = renderEmail(email);
    const body = JSON.stringify({ from, to: email.to, reply_to: email.replyTo.length ? email.replyTo : undefined, subject: email.subject, html, text });
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
      if (response.ok) return;
      const retry = response.status === 429 || response.status >= 500;
      if (!retry || attempt === 3) {
        const detail = await response.text().catch(() => "");
        return log.error(`[email] Resend answered ${response.status} for "${email.subject}": ${detail.slice(0, 300)}`);
      }
      await sleep(Math.max(1000 * attempt, Number(response.headers.get("retry-after")) * 1000 || 0));
    }
  }

  return function notify(event, order, { byRequester = false } = {}) {
    const emails = orderEmails(event, order, { adminTo, baseUrl, byRequester });
    for (const email of emails) {
      // The same event on the same order is only ever emailed once, even if a
      // request is retried.
      const key = `${order.id}:${event}:${order.history.length}:${email.role}`;
      queue = queue.then(() => send(email, key)).catch((error) => log.error(`[email] ${error.message}`));
    }
    return queue;
  };
}
