// Orders: validation, stock reservation, the shared account directory, status
// changes and export. Everything here is a pure function of the store state
// (`db`) it is handed, so the store decides atomicity and these stay testable.

import { randomUUID } from "node:crypto";
import {
  ACCOUNT_TYPES,
  CARRIERS,
  LINE_DECISIONS,
  PURPOSES,
  RELEASED_STATUSES,
  STATUSES,
  TRANSITIONS,
  US_STATES,
  activeForwards,
  forwardLines,
  forwardOf,
  imageFor,
  inHouseLines,
  isDenied,
  labelFor,
  optionText,
  quantityProblem,
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

  // Merge repeated item/option/colour lines so limits apply to the combined quantity.
  const merged = new Map();
  for (const raw of rawLines) {
    const itemId = cleanLine(raw?.itemId, 80);
    const variantId = cleanLine(raw?.variantId, 80) || "default";
    const color = cleanLine(raw?.color, 40);
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      errors.lines = `Quantities must be whole numbers from 1 to ${MAX_QUANTITY}.`;
      return [];
    }
    const key = `${itemId}::${variantId}::${color}`;
    const prior = merged.get(key);
    merged.set(key, { itemId, variantId, color, quantity: (prior?.quantity ?? 0) + quantity });
  }

  const problems = [];
  const perItem = new Map();
  const perVariant = new Map();
  const lines = [];

  for (const { itemId, variantId, color, quantity } of merged.values()) {
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
    const colors = item.colors ?? [];
    if (colors.length && !colors.includes(color)) {
      problems.push(`Choose a color for ${item.name}.`);
      continue;
    }
    perItem.set(item.id, (perItem.get(item.id) ?? 0) + quantity);
    // Stock is counted per option, whatever colours it is ordered in.
    const variantKey = `${item.id}::${variant.id}`;
    perVariant.set(variantKey, { item, variant, total: (perVariant.get(variantKey)?.total ?? 0) + quantity });

    lines.push({
      itemId: item.id,
      variantId: variant.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      variantLabel: variant.label,
      color: colors.length ? color : "",
      unit: item.unit,
      tone: item.tone,
      art: item.art,
      image: imageFor(item, colors.length ? color : ""),
      quantity,
      unitCostCents: item.costCents,
      lineTotalCents: item.costCents * quantity,
    });
  }

  for (const { item, variant, total } of perVariant.values()) {
    if (Number.isInteger(variant.stock) && total > variant.stock) {
      problems.push(
        variant.stock === 0
          ? `${describeVariant(item, variant)} is out of stock.`
          : `Only ${variant.stock} left of ${describeVariant(item, variant)}.`
      );
    }
  }

  for (const [itemId, total] of perItem) {
    const item = catalog.find((entry) => entry.id === itemId);
    const problem = quantityProblem(item, total);
    if (problem) problems.push(problem);
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

  const lines = readLines(src.lines, catalog, errors);

  return {
    value: {
      shipTo,
      purpose,
      neededBy,
      // Rush shipping isn't offered any more, so every order ships standard,
      // even one sent from a checkout page opened before rush went. Orders
      // placed as rush before then keep it, and still show it.
      shippingSpeed: "standard",
      rushReason: "",
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
export function upsertAccount(db, shipTo, { by, at, distributorId = null }) {
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
  // A distributor's reps are offered only the accounts it has shipped to.
  if (distributorId && !account.distributorIds?.includes(distributorId)) {
    account.distributorIds = [...(account.distributorIds ?? []), distributorId];
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
// removed, or stopped being stock-tracked, is skipped, and so is a line that
// wasn't approved (its units went back when it was denied) or one forwarded
// with its units put back, or already shipped by whoever it was forwarded to.
export function releaseStock(db, order) {
  for (const line of order.lines) {
    const forward = forwardOf(order, line);
    if (isDenied(line) || forward?.restocked || forward?.status === "shipped") continue;
    const variant = variantFor(db, line);
    if (variant && Number.isInteger(variant.stock)) variant.stock += line.quantity;
  }
}

/* ------------------------------------------------------------ place order */

/**
 * Validate and place an order inside a store mutation: reserves stock, numbers
 * the order, saves the account and (if asked) the requester's own address.
 */
/** The accounts someone may pick at checkout: all of them, or a distributor's own. */
export function accountsFor(db, distributorId) {
  return distributorId ? db.accounts.filter((a) => a.distributorIds?.includes(distributorId)) : db.accounts;
}

/** Whether this order is one the signed-in team member or rep placed. */
export function ownsOrder(order, user) {
  if ((order.requester.distributorId ?? null) !== (user.distributorId ?? null)) return false;
  return order.requester.email === user.email || Boolean(user.personId && order.requester.personId === user.personId);
}

/**
 * An order as the person who placed it sees it: no internal admin note, and
 * for each forward only who ships it and how it's going (not their email,
 * the message they were sent, or the forwarding steps in the history).
 */
export function requesterView(order) {
  const { adminNote, forwards = [], ...rest } = order;
  return {
    ...rest,
    history: order.history.filter((entry) => !entry.forward),
    forwards: forwards
      .filter((f) => f.status !== "cancelled")
      .map((f) => ({ id: f.id, name: f.to.name, lines: f.lines, status: f.status, shipment: f.shipment })),
  };
}

/**
 * `categories`, for a distributor's rep, limits the order to the categories
 * chosen for that distributor; anything else reads as unavailable.
 */
export function placeOrder(
  db,
  input,
  { requester, categories = null, now = new Date(), timeZone = "America/New_York", prefix = "TD" }
) {
  const distributorId = requester.distributorId ?? null;
  const { value, errors } = validateOrderInput(input, {
    catalog: categories ? db.catalog.filter((item) => categories.includes(item.category)) : db.catalog,
    accounts: accountsFor(db, distributorId),
    today: todayIn(timeZone, now),
  });
  if (Object.keys(errors).length) failWith(errors);

  const at = now.toISOString();
  const number = `${prefix}-${db.meta.nextOrderNumber}`;
  db.meta.nextOrderNumber += 1;

  const shipTo = { ...value.shipTo };
  if (shipTo.type === "account") {
    shipTo.accountId = upsertAccount(db, shipTo, { by: requester.email, at, distributorId }).id;
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
      ...(distributorId ? { distributorId, distributor: requester.distributor } : {}),
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

  // Reps are kept apart, per distributor: anyone with a distributor's code
  // can type any email, so they never see or change a team member's details.
  const people = distributorId ? (db.reps ??= {}) : db.members;
  const key = distributorId ? `${distributorId}:${requester.email}` : requester.email;
  const member = people[key] ?? {};
  people[key] = {
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
export function cancelOwnOrder(db, orderId, { email, name, personId = null, distributorId = null, now = new Date() }) {
  const order = db.orders.find((o) => o.id === orderId && ownsOrder(o, { email, personId, distributorId }));
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

// The carrier and tracking number can both wait: an order can be marked
// shipped first and its tracking added once it's known. A tracking number
// does need its carrier, to make the tracking link.
function readShipment(patch, errors, at, previous) {
  const carrier = cleanLine(patch.carrier, 20);
  if (carrier && !CARRIERS.some((c) => c.id === carrier)) errors.carrier = "Choose a carrier.";
  const trackingNumber = cleanLine(patch.trackingNumber, 60).replace(/\s+/g, "");
  if (trackingNumber && !carrier) errors.carrier = "Choose the carrier for this tracking number.";
  return { ...previous, carrier, trackingNumber, shippedAt: previous?.shippedAt ?? at };
}

/**
 * Admin changes to an order: a status change (with its note and, when
 * shipping, carrier and tracking), tracking added or corrected on an order
 * already shipped, and the internal admin note. `trackingAdded` says a
 * tracking number is new or different, so the requester can be told.
 * Cancelling an order calls off its forwards that haven't shipped; they come
 * back in `cancelledForwards`, so whoever had them can be told not to ship.
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
    if (next === "shipped" && allForwarded(order)) {
      throw new ValidationError("Everything on this order was forwarded, so mark each forward shipped instead.", {}, 409);
    }
  }

  let shipment = order.shipment;
  const correctingShipment =
    !statusChanged && order.shipment && ("carrier" in src || "trackingNumber" in src);
  if ((statusChanged && next === "shipped") || correctingShipment) {
    shipment = readShipment(src, errors, at, order.shipment);
  }

  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  const trackingAdded =
    correctingShipment && Boolean(shipment.trackingNumber) && shipment.trackingNumber !== order.shipment.trackingNumber;

  const cancelledForwards = [];
  if (statusChanged) {
    if (RELEASED_STATUSES.includes(next)) {
      releaseStock(db, order);
      for (const forward of order.forwards ?? []) {
        if (forward.status !== "sent") continue;
        forward.status = "cancelled";
        forward.cancelledAt = at;
        cancelledForwards.push(forward);
      }
    }
    // An order its forwards shipped all of has no shipment of its own.
    if (next === "delivered" && shipment) shipment = { ...shipment, deliveredAt: at };
    order.status = next;
    order.history.push({ at, status: next, by: actor, note });
  }
  order.shipment = shipment;
  if ("adminNote" in src) order.adminNote = cleanText(src.adminNote, 1000);
  order.updatedAt = at;

  return { order, statusChanged, trackingAdded, cancelledForwards };
}

export const MAX_DECISION_REASON = 200;

/**
 * Approve or deny each line of an order that hasn't shipped yet, in one go.
 * `input.decisions` has one { status: "approved" | "denied", reason } per
 * line, in order; the reason is what the requester sees for a denied line.
 *
 * A denied line's units go back to stock, and approving a line that was
 * denied takes them again (if they're still there). With every line denied
 * the order is declined, and the requester needs to be told why; otherwise
 * it's approved, with just the approved lines to ship. Returns the event to
 * tell the requester about: order.approved, order.reviewed (some lines
 * denied) or order.declined.
 */
export function reviewOrder(db, orderId, input, { actor, now = new Date() }) {
  const order = findOrder(db, orderId);
  if (order.status !== "submitted" && order.status !== "approved") {
    throw new ValidationError(
      `This order is already ${labelFor(STATUSES, order.status).toLowerCase()}, so its items can't be approved or denied now.`,
      {},
      409
    );
  }
  const src = input && typeof input === "object" ? input : {};
  const raw = Array.isArray(src.decisions) ? src.decisions : [];
  const errors = {};

  const decisions = order.lines.map((line, i) => {
    const d = raw[i] && typeof raw[i] === "object" ? raw[i] : {};
    const status = cleanLine(d.status, 20);
    if (!LINE_DECISIONS.some((x) => x.id === status)) errors[`decisions.${i}`] = "Approve or deny this item.";
    const forward = forwardOf(order, line);
    if (status === "denied" && forward) {
      errors[`decisions.${i}`] = `This was forwarded to ${forward.to.name}. Pull it back before denying it.`;
    }
    if (status === "approved" && isDenied(line)) {
      const variant = variantFor(db, line);
      if (variant && Number.isInteger(variant.stock) && variant.stock < line.quantity) {
        errors[`decisions.${i}`] = `Only ${variant.stock} left, so this can't be approved now.`;
      }
    }
    return { status, reason: status === "denied" ? cleanText(d.reason, MAX_DECISION_REASON) : "" };
  });

  const note = cleanText(src.note, 500);
  const denied = decisions.filter((d) => d.status === "denied").length;
  const allDenied = denied === order.lines.length;
  if (allDenied && !note && decisions.some((d) => !d.reason)) {
    errors.note = "Nothing is approved, so tell the requester why.";
  }
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  // Everything has been checked, so none of this can fail part-way.
  const at = now.toISOString();
  order.lines.forEach((line, i) => {
    const wasDenied = isDenied(line);
    const nowDenied = decisions[i].status === "denied";
    const variant = variantFor(db, line);
    if (variant && Number.isInteger(variant.stock) && wasDenied !== nowDenied) {
      variant.stock += nowDenied ? line.quantity : -line.quantity;
    }
    line.decision = { status: decisions[i].status, reason: decisions[i].reason, at, by: actor };
  });

  const next = allDenied ? "declined" : "approved";
  order.status = next;
  order.updatedAt = at;
  order.history.push({ at, status: next, by: actor, note, review: { approved: order.lines.length - denied, denied } });
  // Denying what was left for the merch team can leave only forwards that already shipped.
  shipIfAllForwardsOut(order, { at, actor });

  const event = denied === 0 ? "order.approved" : allDenied ? "order.declined" : "order.reviewed";
  return { order, event };
}

/** The email (and webhook) event that tells the requester where a reviewed order stands. */
export function decisionEvent(order) {
  const denied = order.lines.filter(isDenied).length;
  if (order.status === "declined") return "order.declined";
  if (order.status !== "approved") return null;
  return denied ? "order.reviewed" : "order.approved";
}

/* -------------------------------------------------------------- forwarding */

/** Everything still to ship was forwarded, so the order ships through its forwards. */
function allForwarded(order) {
  return activeForwards(order).length > 0 && !inHouseLines(order).length;
}

// Once every forward has gone out and nothing is left for the merch team to
// pack, the approved order is shipped.
function shipIfAllForwardsOut(order, { at, actor }) {
  if (order.status === "approved" && allForwarded(order) && activeForwards(order).every((f) => f.status === "shipped")) {
    order.status = "shipped";
    order.history.push({ at, status: "shipped", by: actor, note: "" });
  }
}

export const MAX_FORWARD_NOTE = 1000;
const EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]{2,}$/;

function findForward(order, forwardId) {
  const forward = (order.forwards ?? []).find((f) => f.id === forwardId);
  if (!forward) throw new ValidationError("That forward could not be found.", {}, 404);
  return forward;
}

function forwardEntry(forward, event, order) {
  return { id: forward.id, event, to: forward.to.name, items: forwardLines(order, forward).length };
}

/**
 * Hand some of an approved order's lines to someone else (a supplier, a rep
 * with stock on hand) to ship straight to the order's address. `input` is
 * { lines: [line index…], toName, toEmail, note, restock }; the app then
 * emails them the items and where they go. With `restock`, the lines' units
 * go back on the shelf, since they won't come from it; otherwise they stay
 * set aside.
 */
export function forwardItems(db, orderId, input, { actor, now = new Date() }) {
  const order = findOrder(db, orderId);
  if (order.status !== "approved") {
    throw new ValidationError(
      order.status === "submitted"
        ? "Approve the order before forwarding its items."
        : `This order is already ${labelFor(STATUSES, order.status).toLowerCase()}, so its items can't be forwarded now.`,
      {},
      409
    );
  }
  const src = input && typeof input === "object" ? input : {};
  const errors = {};
  const picked = [...new Set((Array.isArray(src.lines) ? src.lines : []).map(Number))];
  if (!picked.length) errors.lines = "Choose the items to forward.";
  for (const i of picked) {
    const line = Number.isInteger(i) ? order.lines[i] : undefined;
    if (!line || isDenied(line) || forwardOf(order, line)) {
      errors.lines = "Some of those items can't be forwarded any more. Close the order and open it again.";
    }
  }
  const name = cleanLine(src.toName, 120);
  const email = cleanLine(src.toEmail, 160).toLowerCase();
  if (!name) errors.toName = "Who's shipping these? Enter a name or company.";
  if (!EMAIL_RE.test(email)) errors.toEmail = "Enter their email address, like name@company.com.";
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  const at = now.toISOString();
  const forward = {
    id: randomUUID(),
    to: { name, email },
    lines: picked.sort((a, b) => a - b),
    note: cleanText(src.note, MAX_FORWARD_NOTE),
    at,
    by: actor,
    status: "sent",
    restocked: Boolean(src.restock),
    shipment: null,
  };
  if (forward.restocked) {
    for (const line of forwardLines(order, forward)) {
      const variant = variantFor(db, line);
      if (variant && Number.isInteger(variant.stock)) variant.stock += line.quantity;
    }
  }
  (order.forwards ??= []).push(forward);
  order.updatedAt = at;
  order.history.push({ at, status: order.status, by: actor, note: "", forward: forwardEntry(forward, "sent", order) });
  return { order, forward };
}

/**
 * A forward has shipped: mark it so, with the carrier and tracking number if
 * they're known yet, or add or correct them afterwards. Once every forward
 * has gone out and nothing is left for the merch team to ship, the order is
 * marked shipped too. `event` is what to tell the requester: forward.shipped,
 * forward.tracking (a new tracking number on one already shipped) or null.
 */
export function shipForward(db, orderId, forwardId, input, { actor, now = new Date(), requireCarrier = false }) {
  const order = findOrder(db, orderId);
  const forward = findForward(order, forwardId);
  if (forward.status === "cancelled" || RELEASED_STATUSES.includes(order.status)) {
    throw new ValidationError("This was called off, so it can't be marked shipped.", {}, 409);
  }
  const src = input && typeof input === "object" ? input : {};
  const errors = {};
  const at = now.toISOString();
  const shipment = readShipment(src, errors, at, forward.shipment);
  if (requireCarrier && !shipment.carrier && !errors.carrier) errors.carrier = "Choose how it shipped.";
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  const firstTime = forward.status === "sent";
  const newTracking = Boolean(shipment.trackingNumber) && shipment.trackingNumber !== forward.shipment?.trackingNumber;
  forward.status = "shipped";
  forward.shipment = shipment;
  order.updatedAt = at;
  if (firstTime) {
    order.history.push({ at, status: order.status, by: actor, note: "", forward: forwardEntry(forward, "shipped", order) });
    shipIfAllForwardsOut(order, { at, actor });
  }
  return { order, forward, event: firstTime ? "forward.shipped" : newTracking ? "forward.tracking" : null };
}

/** The order and forward a supplier's link opens, or null. */
export function findForwardById(db, forwardId) {
  for (const order of db.orders) {
    const forward = (order.forwards ?? []).find((f) => f.id === forwardId);
    if (forward) return { order, forward };
  }
  return null;
}

/**
 * What whoever has a forward sees on their shipping page: the order number,
 * their items (no prices), where they go and by when, and the message they
 * were sent. Nothing about the requester beyond their name, and nothing
 * else on the order.
 */
export function supplierView(order, forward) {
  const s = order.shipTo;
  const calledOff = forward.status === "cancelled" || RELEASED_STATUSES.includes(order.status);
  return {
    number: order.number,
    requestedBy: order.requester.name,
    neededBy: order.neededBy,
    shippingSpeed: order.shippingSpeed,
    rushReason: order.rushReason,
    shipTo: {
      type: s.type,
      accountName: s.accountName ?? "",
      attention: s.attention,
      phone: s.phone,
      address1: s.address1,
      address2: s.address2,
      city: s.city,
      state: s.state,
      postalCode: s.postalCode,
      deliveryNotes: s.deliveryNotes,
    },
    forward: {
      to: forward.to.name,
      at: forward.at,
      by: forward.by,
      note: forward.note,
      status: calledOff ? "cancelled" : forward.status,
      shipment: calledOff ? null : forward.shipment,
      items: forwardLines(order, forward).map((l) => ({
        sku: l.sku,
        name: l.name,
        color: l.color ?? "",
        variantLabel: l.variantLabel,
        unit: l.unit,
        quantity: l.quantity,
      })),
    },
    // Tracking can be added or fixed until the order is delivered.
    canUpdate: !calledOff && order.status !== "delivered",
  };
}

/**
 * Take back a forward that hasn't shipped, for the merch team to ship
 * itself. Units that were put back on the shelf are set aside again, so
 * they have to still be there.
 */
export function pullBackForward(db, orderId, forwardId, { actor, now = new Date() }) {
  const order = findOrder(db, orderId);
  const forward = findForward(order, forwardId);
  if (forward.status !== "sent") {
    throw new ValidationError(
      forward.status === "shipped" ? `${forward.to.name} already shipped these.` : "This forward was already pulled back.",
      {},
      409
    );
  }
  const needs = new Map();
  if (forward.restocked) {
    for (const line of forwardLines(order, forward)) {
      const variant = variantFor(db, line);
      if (!variant || !Number.isInteger(variant.stock)) continue;
      const need = needs.get(variant) ?? { quantity: 0, line };
      need.quantity += line.quantity;
      needs.set(variant, need);
    }
  }
  for (const [variant, { quantity, line }] of needs) {
    if (variant.stock < quantity) {
      const what = `${line.name}${optionText(line) ? ` (${optionText(line)})` : ""}`;
      throw new ValidationError(
        `Only ${variant.stock} ${what} left in stock, and ${quantity} would come back to the merch team. Update the stock first.`,
        {},
        409
      );
    }
  }
  const at = now.toISOString();
  for (const [variant, { quantity }] of needs) variant.stock -= quantity;
  forward.status = "cancelled";
  forward.cancelledAt = at;
  order.updatedAt = at;
  order.history.push({ at, status: order.status, by: actor, note: "", forward: forwardEntry(forward, "cancelled", order) });
  return { order, forward };
}

export const MAX_BULK_ORDERS = 200;
export const BULK_ACTIONS = ["approved", "shipped", "delivered", "declined", "cancelled", "note"];

/**
 * One change made to many orders at once from the admin console: a status
 * change, with one note for them all and, when shipping, one carrier and each
 * order's own tracking number; or a line added to each order's internal note.
 *
 * A problem with what was typed changes nothing. An order that can't take the
 * change (someone moved it on in the meantime) is left alone and reported in
 * `skipped`, and the rest go ahead.
 */
export function bulkUpdateOrders(db, input, { actor, now = new Date() }) {
  const src = input && typeof input === "object" ? input : {};
  const ids = Array.isArray(src.orderIds)
    ? [...new Set(src.orderIds.map((id) => cleanLine(id, 80)).filter(Boolean))]
    : [];
  if (!ids.length) throw new ValidationError("Select at least one order.", {});
  if (ids.length > MAX_BULK_ORDERS) {
    throw new ValidationError(`Change at most ${MAX_BULK_ORDERS} orders at a time.`, {});
  }
  const action = cleanLine(src.action, 20);
  if (!BULK_ACTIONS.includes(action)) throw new ValidationError("Choose what to change.", {});

  const targets = [];
  const skipped = [];
  for (const id of ids) {
    const order = db.orders.find((o) => o.id === id);
    if (!order) skipped.push({ id, number: "", reason: "It could not be found." });
    else if (action !== "note" && !TRANSITIONS[order.status]?.includes(action)) {
      skipped.push({ id, number: order.number, reason: `It's ${labelFor(STATUSES, order.status).toLowerCase()}.` });
    } else if (action === "shipped" && allForwarded(order)) {
      skipped.push({ id, number: order.number, reason: "Everything on it was forwarded." });
    } else targets.push(order);
  }

  const errors = {};
  const at = now.toISOString();

  if (action === "note") {
    const text = cleanText(src.adminNote, 500);
    if (!text) errors.adminNote = "Write the note to add.";
    if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);
    const updated = [];
    for (const order of targets) {
      const combined = [order.adminNote, text].filter(Boolean).join("\n");
      if (combined.length > 1000) {
        skipped.push({ id: order.id, number: order.number, reason: "Its internal note is full." });
        continue;
      }
      order.adminNote = combined;
      order.updatedAt = at;
      updated.push(order);
    }
    return { updated, skipped };
  }

  if (!targets.length) {
    const label = labelFor(STATUSES, action).toLowerCase();
    throw new ValidationError(`None of the selected orders can be marked ${label}.`, {}, 409);
  }

  const note = cleanText(src.note, 500);
  if (action === "declined" && !note) errors.note = "Tell the requesters why they were declined.";

  // Tracking numbers are optional here too, and can be added to each order
  // later; any that are given need the carrier.
  let carrier = "";
  const tracking = src.tracking && typeof src.tracking === "object" ? src.tracking : {};
  if (action === "shipped") {
    carrier = cleanLine(src.carrier, 20);
    if (carrier && !CARRIERS.some((c) => c.id === carrier)) errors.carrier = "Choose a carrier.";
    else if (!carrier && targets.some((order) => cleanLine(tracking[order.id], 60))) {
      errors.carrier = "Choose the carrier for these tracking numbers.";
    }
  }
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  // Everything has been checked, so none of these can fail part-way.
  const cancelledForwards = [];
  const updated = targets.map((order) => {
    const result = updateOrder(
      db,
      order.id,
      action === "shipped"
        ? { status: action, note, carrier, trackingNumber: tracking[order.id] ?? "" }
        : { status: action, note },
      { actor, now }
    );
    for (const forward of result.cancelledForwards) cancelledForwards.push({ order, forward });
    return result.order;
  });
  return { updated, skipped, cancelledForwards };
}

/* ------------------------------------------------------------------ export */

// A forwarded line ships with its forward, everything else with the order.
function lineShipment(order, line) {
  const forward = forwardOf(order, line);
  return forward ? forward.shipment : order.shipment;
}

export const CSV_COLUMNS = [
  ["order_number", (o) => o.number],
  ["placed_at", (o) => o.createdAt],
  ["status", (o) => o.status],
  ["requester_name", (o) => o.requester.name],
  ["requester_email", (o) => o.requester.email],
  ["distributor", (o) => o.requester.distributor ?? ""],
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
  ["color", (o, l) => l.color ?? ""],
  ["option", (o, l) => l.variantLabel],
  ["quantity", (o, l) => l.quantity],
  ["unit_cost", (o, l) => (l.unitCostCents / 100).toFixed(2)],
  ["line_cost", (o, l) => (l.lineTotalCents / 100).toFixed(2)],
  ["item_status", (o, l) => (l.decision ? labelFor(LINE_DECISIONS, l.decision.status) : "")],
  ["item_note", (o, l) => l.decision?.reason ?? ""],
  ["fulfilled_by", (o, l) => forwardOf(o, l)?.to.name ?? ""],
  ["carrier", (o, l) => labelFor(CARRIERS, lineShipment(o, l)?.carrier ?? "")],
  ["tracking_number", (o, l) => lineShipment(o, l)?.trackingNumber ?? ""],
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

/**
 * The tracker as a spreadsheet: one row per person and item they ordered,
 * with the person's totals repeated on each row so it filters and pivots
 * cleanly. Someone who ordered nothing in the period gets one row of zeros.
 */
export function trackerToCsv(rows) {
  const header = [
    "name", "email", "distributor", "on_team_list", "orders", "units", "order_value", "last_order",
    "sku", "item", "color", "option", "quantity", "item_value", "orders_with_item",
  ];
  const out = [header.join(",")];
  for (const row of rows) {
    const person = [
      row.name, row.email, row.distributor ?? "", row.onList ? "yes" : "no", row.orders, row.units,
      (row.valueCents / 100).toFixed(2), row.lastOrderAt ?? "",
    ];
    const items = row.items.length ? row.items : [null];
    for (const item of items) {
      const cells = item
        ? [item.sku, item.name, item.color, item.variantLabel, item.quantity, (item.valueCents / 100).toFixed(2), item.orders]
        : ["", "", "", "", 0, "0.00", 0];
      out.push([...person, ...cells].map(csvCell).join(","));
    }
  }
  return out.join("\r\n") + "\r\n";
}
