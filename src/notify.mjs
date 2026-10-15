// Tell a webhook about new orders and status changes. The body carries a
// Slack-ready `text` summary plus the full order, so the same URL works for a
// Slack incoming webhook or a Zapier/Make hook that emails the requester.

import {
  CARRIERS,
  PURPOSES,
  STATUSES,
  formatMoney,
  isDenied,
  labelFor,
  trackingUrl,
} from "../public/assets/shared.js";

function shipToLine(order) {
  const where = `${order.shipTo.city}, ${order.shipTo.state}`;
  return order.shipTo.type === "account"
    ? `Ship to account: ${order.shipTo.accountName} · ${where}`
    : `Ship to: ${order.requester.name} (team member) · ${where}`;
}

export function orderMessage(event, order, { baseUrl = "" } = {}) {
  const link = baseUrl ? `${baseUrl.replace(/\/$/, "")}/admin?order=${encodeURIComponent(order.id)}` : "";

  if (event === "order.created") {
    return [
      `*New merch order ${order.number}* from ${order.requester.name}`,
      shipToLine(order),
      `${order.lines.length} item${order.lines.length === 1 ? "" : "s"} · ${order.totalUnits} unit${order.totalUnits === 1 ? "" : "s"} · ${formatMoney(order.totalCents)}`,
      `For: ${labelFor(PURPOSES, order.purpose)}${order.neededBy ? ` · Needed by ${order.neededBy}` : ""}`,
      order.shippingSpeed === "rush" ? `:rotating_light: Rush — ${order.rushReason}` : "",
      link ? `Review it: ${link}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const url = order.shipment ? trackingUrl(order.shipment.carrier, order.shipment.trackingNumber) : null;

  if (event === "order.tracking") {
    return [
      `Tracking added to merch order ${order.number} for ${order.requester.name}: ${labelFor(CARRIERS, order.shipment.carrier)} ${order.shipment.trackingNumber}`,
      url ? `Track it: ${url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const latest = order.history[order.history.length - 1];
  const status = labelFor(STATUSES, order.status);
  if (event === "order.reviewed") {
    const denied = order.lines.filter(isDenied);
    return [
      `Merch order ${order.number} for ${order.requester.name} is *approved in part*: ${order.lines.length - denied.length} of ${order.lines.length} items`,
      ...denied.map((l) => `• Not approved: ${l.quantity} × ${l.name}${l.decision.reason ? ` (${l.decision.reason})` : ""}`),
      latest?.note ? `> ${latest.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const tracking =
    order.status === "shipped" && order.shipment
      ? `${order.shipment.carrier ? ` via ${labelFor(CARRIERS, order.shipment.carrier)}` : ""}${order.shipment.trackingNumber ? ` ${order.shipment.trackingNumber}` : ""}`
      : "";
  return [
    `Merch order ${order.number} for ${order.requester.name} is now *${status}*${tracking}`,
    latest?.note ? `> ${latest.note}` : "",
    order.status === "shipped" && url ? `Track it: ${url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createNotifier(url, { baseUrl = "", log = console } = {}) {
  if (!url) return () => {};

  return function notify(event, order) {
    const body = JSON.stringify({ event, text: orderMessage(event, order, { baseUrl }), order });
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    })
      .then((response) => {
        if (!response.ok) log.error(`[notify] webhook answered ${response.status} for ${order.number}`);
      })
      .catch((error) => {
        // The order is already saved; a failed notification must not undo it.
        log.error(`[notify] webhook failed for ${order.number}: ${error.message}`);
      });
  };
}
