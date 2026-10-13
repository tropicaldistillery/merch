// Requests for items that are out of stock (or don't have enough left).
//
// A request isn't an order: it reserves nothing and ships nothing. It tells
// the merch admin who wants what, and how many, so they can restock; when it's
// back the admin tells everyone who asked, and they order it as usual. Or the
// admin closes the request with a note. Requesters see their own requests and
// can withdraw an open one.
//
// Statuses: open → notified (told it's back) | closed (by the admin) |
// withdrawn (by the requester).

import { randomUUID } from "node:crypto";

import { MAX_QUANTITY, ownsOrder } from "./orders.mjs";
import { ValidationError, cleanLine, cleanText } from "./validation.mjs";

export const REQUEST_STATUSES = ["open", "notified", "closed", "withdrawn"];
// Open requests one person may have at a time.
export const MAX_OPEN_REQUESTS = 25;

const tracked = (variant) => Number.isInteger(variant.stock);

/**
 * Ask for an item. `categories`, for a distributor's rep, limits it to the
 * categories chosen for that distributor. Asking again for the same item,
 * option and color while the first is open updates that request.
 */
export function placeRequest(db, input, { requester, categories = null, now = new Date() }) {
  const src = input && typeof input === "object" ? input : {};
  const errors = {};
  const item = db.catalog.find((i) => i.id === cleanLine(src.itemId, 80) && i.active);
  if (!item || (categories && !categories.includes(item.category))) {
    throw new ValidationError("That item isn't available to request.", {}, 404);
  }
  const variant = item.variants.find((v) => v.id === (cleanLine(src.variantId, 80) || "default")) ?? null;
  if (!variant) errors.variantId = item.category === "Apparel" ? "Choose a size." : "Choose an option.";
  const colors = item.colors ?? [];
  const color = cleanLine(src.color, 40);
  if (colors.length && !colors.includes(color)) errors.color = "Choose a color.";
  const quantity = Number(src.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.quantity = `Enter how many you need, from 1 to ${MAX_QUANTITY}.`;
  }
  const note = cleanText(src.note, 500);
  if (Object.keys(errors).length) throw new ValidationError("Some details need attention.", errors);

  // Only for what can't be ordered now: out of stock, or not enough left.
  if (!tracked(variant) || variant.stock >= quantity) {
    throw new ValidationError(
      tracked(variant) ? `There are ${variant.stock} in stock: add them to your order instead.` : "This is made to order: add it to your order instead.",
      {},
      409
    );
  }

  const at = now.toISOString();
  const who = {
    name: requester.name,
    email: requester.email,
    ...(requester.personId ? { personId: requester.personId } : {}),
    ...(requester.distributorId ? { distributorId: requester.distributorId, distributor: requester.distributor } : {}),
  };
  db.requests ??= [];
  const mine = db.requests.filter((r) => r.status === "open" && ownsOrder(r, requester));
  const same = mine.find((r) => r.itemId === item.id && r.variantId === variant.id && (r.color ?? "") === (colors.length ? color : ""));
  if (same) {
    Object.assign(same, { quantity, note, updatedAt: at });
    same.history.push({ at, status: "open", by: requester.name, note: "Updated the quantity or note" });
    return { request: same, updated: true };
  }
  if (mine.length >= MAX_OPEN_REQUESTS) {
    throw new ValidationError(`You have ${MAX_OPEN_REQUESTS} open requests already. Withdraw one you don't need first.`, {}, 409);
  }

  const request = {
    id: randomUUID(),
    createdAt: at,
    updatedAt: at,
    status: "open",
    requester: who,
    itemId: item.id,
    name: item.name,
    sku: item.sku,
    brand: item.brand,
    category: item.category,
    unit: item.unit,
    variantId: variant.id,
    variantLabel: variant.label,
    color: colors.length ? color : "",
    quantity,
    note,
    history: [{ at, status: "open", by: requester.name, note: "" }],
  };
  db.requests.push(request);
  return { request, updated: false };
}

/** The requester taking back an open request. */
export function withdrawRequest(db, id, { requester, now = new Date() }) {
  const request = (db.requests ?? []).find((r) => r.id === id && ownsOrder(r, requester));
  if (!request) throw new ValidationError("That request could not be found.", {}, 404);
  if (request.status !== "open") throw new ValidationError("That request is already settled.", {}, 409);
  const at = now.toISOString();
  request.status = "withdrawn";
  request.updatedAt = at;
  request.history.push({ at, status: "withdrawn", by: requester.name, note: "" });
  return request;
}

/**
 * The admin settling open requests: "notified" when the item is back (each
 * requester is emailed), or "closed" with an optional note to them. Requests
 * that aren't open are skipped.
 */
export function settleRequests(db, input, { actor, now = new Date() }) {
  const src = input && typeof input === "object" ? input : {};
  const action = cleanLine(src.action, 20);
  if (action !== "notified" && action !== "closed") throw new ValidationError("Choose what to do with the requests.", {});
  const ids = new Set(Array.isArray(src.ids) ? src.ids.map(String) : []);
  if (!ids.size) throw new ValidationError("Choose at least one request.", {});
  const note = cleanText(src.note, 500);
  const at = now.toISOString();
  const updated = [];
  for (const request of db.requests ?? []) {
    if (!ids.has(request.id) || request.status !== "open") continue;
    request.status = action;
    request.updatedAt = at;
    request.history.push({ at, status: action, by: actor, note });
    updated.push(request);
  }
  if (!updated.length) throw new ValidationError("Those requests are already settled.", {}, 409);
  return updated;
}

/** Each request with the stock its item and option have now, newest first. */
export function requestsWithStock(db) {
  return (db.requests ?? [])
    .map((r) => {
      const item = db.catalog.find((i) => i.id === r.itemId);
      const variant = item?.variants.find((v) => v.id === r.variantId);
      return {
        ...r,
        stockNow: variant ? (tracked(variant) ? variant.stock : null) : 0,
        itemActive: Boolean(item?.active),
      };
    })
    .reverse();
}
