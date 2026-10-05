// Orders: validation, stock reservation, the shared account directory, status
// changes and export. Everything here is a pure function of the store state
// (`db`) it is handed, so the store decides atomicity and these stay testable.

import { randomUUID } from "node:crypto";
import {
  ACCOUNT_TYPES,
  CARRIERS,
  PURPOSES,
  RELEASED_STATUSES,
  SHIPPING_SPEEDS,
  STATUSES,
  TRANSITIONS,
  US_STATES,
  labelFor,
} from "../public/assets/shared.js";
import {
  ValidationError,
  cleanLine,
  cleanText,
  isIsoDate,
  normalizePhone,
  normalizePostalCode,
  todayIn,
} from "./validation.mjs";

export const MAX_LINES = 40;
export const MAX_QUANTITY = 999;

/* ----------------------------------------------------------------- address */

function readAddress(src, errors, { requirePhone }) {
  const attention = cleanLine(src.attention, 100);
  if (!attention) errors["shipTo.attention"] = "Who should the package be addressed to?";

  const address1 = cleanLine(src.address1, 120);
  if (!address1) errors["shipTo.address1"] = "Enter a street address.";

  const city = cleanLine(src.city, 80);
  if (!city) errors["shipTo.city"] = "Enter a city.";

  const state = cleanLine(src.state, 2).toUpperCase();
  if (!US_STATES.some(([code]) => code === state)) errors["shipTo.state"] = "Choose a state.";

  const postalCode = normalizePostalCode(src.postalCode);
  if (!postalCode) errors["shipTo.postalCode"] = "Enter a 5-digit ZIP code.";

  const phone = normalizePhone(src.phone);
  if (phone === null) errors["shipTo.phone"] = "Enter a phone number with its area code.";
  else if (requirePhone && !phone) errors["shipTo.phone"] = "Add a phone number for the delivery driver.";

  return {
    attention,
    address1,
    address2: cleanLine(src.address2, 120),
    city,
    state,
    postalCode: postalCode || "",
    phone: phone || "",
    deliveryNotes: cleanText(src.deliveryNotes, 300),
  };
}

/* -------------------------------------------------------------- validation */

function describeVariant(item, variant) {
  return variant.label ? `${item.name} (${variant.label})` : item.name;
}

function readLines(rawLines, catalog, errors) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    errors.lines = "Your cart is empty.";
    return [];
  }
  if (rawLines.length > MAX_LINES) {
    errors.lines = `An order can have at most ${MAX_LINES} lines. Split it into two orders.`;
    return [];
  }

  // Merge repeated item/option pairs so limits apply to the combined quantity.
  const merged = new Map();
  for (const raw of rawLines) {
    const itemId = cleanLine(raw?.itemId, 80);
    const variantId = cleanLine(raw?.variantId, 80) || "default";
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      errors.lines = `Quantities must be whole numbers from 1 to ${MAX_QUANTITY}.`;
      return [];
    }
    const key = `${itemId}::${variantId}`;
    const prior = merged.get(key);
    merged.set(key, { itemId, variantId, quantity: (prior?.quantity ?? 0) + quantity });
  }

  const problems = [];
  const perItem = new Map();
  const lines = [];

  for (const { itemId, variantId, quantity } of merged.values()) {
    const item = catalog.find((entry) => entry.id === itemId && entry.active);
    if (!item) {
      problems.push("An item in your cart is no longer available. Remove it and try again.");
      continue;
    }
    const variant = item.variants.find((v) => v.id === variantId);
    if (!variant) {
      problems.push(`Choose an option for ${item.name}.`);
      continue;
    }
    if (Number.isInteger(variant.stock) && quantity > variant.stock) {
      problems.push(
        variant.stock === 0
          ? `${describeVariant(item, variant)} is out of stock.`
          : `Only ${variant.stock} left of ${describeVariant(item, variant)}.`
      );
      continue;
    }
    perItem.set(item.id, (perItem.get(item.id) ?? 0) + quantity);

    lines.push({
      itemId: item.id,
      variantId: variant.id,
      sku: item.sku,
      name: item.name,
      variantLabel: variant.label,
      unit: item.unit,
      tone: item.tone,
      art: item.art,
      image: item.image,
      quantity,
      unitCostCents: item.costCents,
      lineTotalCents: item.costCents * quantity,
    });
  }

  for (const [itemId, total] of perItem) {
    const item = catalog.find((entry) => entry.id === itemId);
    if (total > item.maxPerOrder) {
      problems.push(`You can order up to ${item.maxPerOrder} of ${item.name} per order.`);
    }
  }

  if (problems.length) errors.lines = problems.join(" ");
  return lines;
}

/**
 * Check an order submitted from checkout against the current catalog.
 * Returns `{ value, errors }`; `errors` is empty when the order can be placed.
 */
export function validateOrderInput(input, { catalog, accounts = [], today }) {
  const errors = {};
  const src = input && typeof input === "object" ? input : {};
  const shipSrc = src.shipTo && typeof src.shipTo === "object" ? src.shipTo : {};

  const type = shipSrc.type;
  if (type !== "self" && type !== "account") errors["shipTo.type"] = "Choose where this order ships.";

  const shipTo = { type, ...readAddress(shipSrc, errors, { requirePhone: type === "account" }) };

  if (type === "account") {
    const accountName = cleanLine(shipSrc.accountName, 120);
    if (!accountName) errors["shipTo.accountName"] = "Enter the account's name.";

    const accountType = cleanLine(shipSrc.accountType, 30);
    if (!ACCOUNT_TYPES.some((t) => t.id === accountType)) {
      errors["shipTo.accountType"] = "Choose the kind of account.";
    }

    const accountId = cleanLine(shipSrc.accountId, 80);
    shipTo.accountId = accounts.some((a) => a.id === accountId) ? accountId : null;
    shipTo.accountName = accountName;
    shipTo.accountType = accountType;
  }

  const purpose = cleanLine(src.purpose, 40);
  if (!PURPOSES.some((p) => p.id === purpose)) errors.purpose = "Tell us what the order is for.";

  const neededBy = cleanLine(src.neededBy, 10);
  if (neededBy && !isIsoDate(neededBy)) errors.neededBy = "Enter a valid date.";
  else if (neededBy && neededBy < today) errors.neededBy = "Choose today or a later date.";

  const shippingSpeed = cleanLine(src.shippingSpeed, 20) || "standard";
  if (!SHIPPING_SPEEDS.some((s) => s.id === shippingSpeed)) errors.shippingSpeed = "Choose a shipping speed.";

  const rushReason = shippingSpeed === "rush" ? cleanText(src.rushReason, 300) : "";
  if (shippingSpeed === "rush" && !rushReason) errors.rushReason = "Tell us why this needs to rush.";

  const lines = readLines(src.lines, catalog, errors);

  return {
    value: {
      shipTo,
      purpose,
      neededBy,
      shippingSpeed,
      rushReason,
      notes: cleanText(src.notes, 1000),
      saveAddress: src.saveAddress === true,
      lines,
    },
    errors,
  };
}

function failWith(errors) {
  const keys = Object.keys(errors);
  const message = keys.length === 1 && errors.lines ? errors.lines : "Some details need attention.";
  throw new ValidationError(message, errors);
}

/* ---------------------------------------------------------------- accounts */

export function accountKey(name, postalCode) {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${n}|${String(postalCode || "").slice(0, 5)}`;
}

function accountDetails(shipTo) {
  return {
    name: shipTo.accountName,
    type: shipTo.accountType,
    attention: shipTo.attention,
    phone: shipTo.phone,
    address1: shipTo.address1,
    address2: shipTo.address2,
    city: shipTo.city,
    state: shipTo.state,
    postalCode: shipTo.postalCode,
    deliveryNotes: shipTo.deliveryNotes,
  };
}

/**
 * Save the account an order ships to into the shared directory, so the next
 * person shipping there can pick it instead of retyping it.
 *
 * An account picked from the directory takes the details exactly as checkout
 * sent them: the requester saw the saved values and edited them. One matched
 * only by name and ZIP was typed from scratch, so it keeps its saved name
 * (the match ignores case and punctuation) and a blank field does not erase a
 * saved one.
 */
export function upsertAccount(db, shipTo, { by, at }) {
  const picked = shipTo.accountId ? db.accounts.find((a) => a.id === shipTo.accountId) : null;
  const key = accountKey(shipTo.accountName, shipTo.postalCode);
  let account = picked || db.accounts.find((a) => accountKey(a.name, a.postalCode) === key);

  if (account) {
    const details = accountDetails(shipTo);
    if (!picked) {
      details.name = account.name;
      for (const [field, value] of Object.entries(details)) {
        if (!value && account[field]) details[field] = account[field];
      }
    }
    Object.assign(account, details, {
      updatedAt: at,
      lastOrderedAt: at,
      orderCount: (account.orderCount ?? 0) + 1,
    });
  } else {
    account = {
      id: randomUUID(),
      ...accountDetails(shipTo),
      createdAt: at,
      createdBy: by,
      updatedAt: at,
      lastOrderedAt: at,
      orderCount: 1,
    };
    db.accounts.push(account);
  }
  return account;
}

/** Validate an account edited in the admin console. */
export function normalizeAccountEdit(input, account, db) {
  const errors = {};
  const src = input && typeof input === "object" ? input : {};
  const address = readAddress(src, errors, { requirePhone: true });

  const name = cleanLine(src.name, 120);
  if (!name) errors.name = "Enter the account's name.";
  const type = cleanLine(src.type, 30);
  if (!ACCOUNT_TYPES.some((t) => t.id === type)) errors.type = "Choose the kind of account.";

  // Field paths from readAddress are prefixed for checkout; the account
  // editor uses bare names.
  const flat = {};
  for (const [key, message] of Object.entries(errors)) flat[key.replace(/^shipTo\./, "")] = message;

  const key = accountKey(name, address.postalCode);
  if (!flat.name && db.accounts.some((a) => a.id !== account.id && accountKey(a.name, a.postalCode) === key)) {
    flat.name = "Another saved account already has this name and ZIP code.";
  }
  if (Object.keys(flat).length) throw new ValidationError("Some details need attention.", flat);

  return { name, type, ...address };
}

/* ------------------------------------------------------------------- stock */

function variantFor(db, line) {
  const item = db.catalog.find((entry) => entry.id === line.itemId);
  return item?.variants.find((v) => v.id === line.variantId) ?? null;
}

function reserveStock(db, order) {
  for (const line of order.lines) {
    const variant = variantFor(db, line);
    if (variant && Number.isInteger(variant.stock)) variant.stock -= line.quantity;
  }
}

// Put a cancelled or declined order's units back. An item that has since been
// removed, or stopped being stock-tracked, is skipped.
export function releaseStock(db, order) {
  for (const line of order.lines) {
    const variant = variantFor(db, line);
    if (variant && Number.isInteger(variant.stock)) variant.stock += line.quantity;
  }
}

/* ------------------------------------------------------------ place order */

/**
 * Validate and place an order inside a store mutation: reserves stock, numbers
 * the order, saves the account and (if asked) the requester's own address.
 */
export function placeOrder(db, input, { requester, now = new Date(), timeZone = "America/New_York", prefix = "TD" }) {
  const { value, errors } = validateOrderInput(input, {
    catalog: db.catalog,
    accounts: db.accounts,
    today: todayIn(timeZone, now),
  });
  if (Object.keys(errors).length) failWith(errors);

  const at = now.toISOString();
  const number = `${prefix}-${db.meta.nextOrderNumber}`;
  db.meta.nextOrderNumber += 1;

  const shipTo = { ...value.shipTo };
  if (shipTo.type === "account") {
    shipTo.accountId = upsertAccount(db, shipTo, { by: requester.email, at }).id;
  }

  const order = {
    id: randomUUID(),
    number,
    createdAt: at,
    updatedAt: at,
    status: "submitted",
    requester: {
      name: requester.name,
      email: requester.email,
      ...(requester.personId ? { personId: requester.personId } : {}),
    },
    shipTo,
    purpose: value.purpose,
    neededBy: value.neededBy,
    shippingSpeed: value.shippingSpeed,
    rushReason: value.rushReason,
    notes: value.notes,
    lines: value.lines,
    totalUnits: value.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalCents: value.lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
    shipment: null,
    adminNote: "",
    history: [{ at, status: "submitted", by: requester.name, note: "" }],
  };

  reserveStock(db, order);
  db.orders.push(order);

  const member = db.members[requester.email] ?? {};
  db.members[requester.email] = {
    ...member,
    name: requester.name,
    lastOrderAt: at,
    ...(shipTo.type === "self" && value.saveAddress
      ? {
          address: {
            attention: shipTo.attention,
            phone: shipTo.phone,
            address1: shipTo.address1,
            address2: shipTo.address2,
            city: shipTo.city,
            state: shipTo.state,
            postalCode: shipTo.postalCode,
            deliveryNotes: shipTo.deliveryNotes,
          },
        }
      : {}),
  };

  return order;
}

/* ---------------------------------------------------------- status changes */

function findOrder(db, orderId) {
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new ValidationError("That order could not be found.", {}, 404);
  return order;
}

/** A team member cancelling their own order before anyone has acted on it. */
export function cancelOwnOrder(db, orderId, { email, name, now = new Date() }) {
  const order = db.orders.find((o) => o.id === orderId && o.requester.email === email);
  if (!order) throw new ValidationError("That order could not be found.", {}, 404);
  if (order.status !== "submitted") {
    throw new ValidationError(
      `This order is already ${labelFor(STATUSES, order.status).toLowerCase()}, so it can't be cancelled here. Ask the merch admin.`,
      {},
      409
    );
  }
  const at = now.toISOString();
  releaseStock(db, order);
  order.status = "cancelled";
  order.updatedAt = at;
  order.history.push({ at, status: "cancelled", by: name, note: "Cancelled by requester" });
  return order;
}

function readShipment(patch, errors, at, previous) {
  const carrier = cleanLine(patch.carrier, 20);
  if (!CARRIERS.some((c) => c.id === carrier)) errors.carrier = "Choose a carrier.";
  const trackingNumber = cleanLine(patch.trackingNumber, 60).replace(/\s+/g, "");
  if (!trackingNumber && carrier !== "hand" && carrier !== "other") {
    errors.trackingNumber = "Add the tracking number.";
  }
  return { ...previous, carrier, trackingNumber, shippedAt: previous?.shippedAt ?? at };
}

/**
 * Admin changes to an order: a status change (with its note and, when
 * shipping, carrier and tracking), a tracking correction on an order already
 * shipped, and the internal admin note.
 */
export function updateOrder(db, orderId, patch, { actor, now = new Date() }) {
  const order = findOrder(db, orderId);
  const src = patch && typeof patch === "object" ? patch : {};
  const at = now.toISOString();
  const errors = {};
  const note = cleanText(src.note, 500);
  const next = cleanLine(src.status, 20) || order.status;
  const statusChanged = next !== order.status;

  if (statusChanged) {
    if (!TRANSITIONS[order.status]?.includes(next)) {
      throw new ValidationError(
        `A ${labelFor(STATUSES, order.status).toLowerCase()} order can't be marked ${labelFor(STATUSES, next).toLowerCase()}.`,
        {},
        409
      );
    }
    if (next === "declined" && !note) errors.note = "Tell the requester why it was declined.";
  }

  let shipment = order.shipment;
  const correctingShipment =
    !statusChanged && order.shipment && ("carrier" in src || "trackingNumber" in src);
  if ((statusChanged && next === "shipped") || correctingShipment) {
    shipment = readShipment(src, errors, at, order.shipment);
  }

  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  if (statusChanged) {
    if (RELEASED_STATUSES.includes(next)) releaseStock(db, order);
    if (next === "delivered") shipment = { ...shipment, deliveredAt: at };
    order.status = next;
    order.history.push({ at, status: next, by: actor, note });
  }
  order.shipment = shipment;
  if ("adminNote" in src) order.adminNote = cleanText(src.adminNote, 1000);
  order.updatedAt = at;

  return { order, statusChanged };
}

/* ------------------------------------------------------------------ export */

export const CSV_COLUMNS = [
  ["order_number", (o) => o.number],
  ["placed_at", (o) => o.createdAt],
  ["status", (o) => o.status],
  ["requester_name", (o) => o.requester.name],
  ["requester_email", (o) => o.requester.email],
  ["ship_to", (o) => (o.shipTo.type === "account" ? "account" : "team member")],
  ["account_name", (o) => o.shipTo.accountName ?? ""],
  ["account_type", (o) => (o.shipTo.accountType ? labelFor(ACCOUNT_TYPES, o.shipTo.accountType) : "")],
  ["attention", (o) => o.shipTo.attention],
  ["phone", (o) => o.shipTo.phone],
  ["address1", (o) => o.shipTo.address1],
  ["address2", (o) => o.shipTo.address2],
  ["city", (o) => o.shipTo.city],
  ["state", (o) => o.shipTo.state],
  ["postal_code", (o) => o.shipTo.postalCode],
  ["delivery_notes", (o) => o.shipTo.deliveryNotes],
  ["purpose", (o) => labelFor(PURPOSES, o.purpose)],
  ["needed_by", (o) => o.neededBy],
  ["shipping_speed", (o) => o.shippingSpeed],
  ["rush_reason", (o) => o.rushReason],
  ["sku", (o, l) => l.sku],
  ["item", (o, l) => l.name],
  ["option", (o, l) => l.variantLabel],
  ["quantity", (o, l) => l.quantity],
  ["unit_cost", (o, l) => (l.unitCostCents / 100).toFixed(2)],
  ["line_cost", (o, l) => (l.lineTotalCents / 100).toFixed(2)],
  ["carrier", (o) => (o.shipment ? labelFor(CARRIERS, o.shipment.carrier) : "")],
  ["tracking_number", (o) => o.shipment?.trackingNumber ?? ""],
  ["notes", (o) => o.notes],
];

// Quote when needed, and defuse cells a spreadsheet would run as a formula —
// every free-text field here was typed by someone else.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per order line, which is what a fulfilment pick list needs. */
export function ordersToCsv(orders) {
  const rows = [CSV_COLUMNS.map(([name]) => name).join(",")];
  for (const order of orders) {
    for (const line of order.lines) {
      rows.push(CSV_COLUMNS.map(([, get]) => csvCell(get(order, line))).join(","));
    }
  }
  return rows.join("\r\n") + "\r\n";
}
