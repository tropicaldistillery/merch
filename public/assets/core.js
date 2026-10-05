// Shared browser helpers. Every page builds its DOM through el(), which only
// ever sets text — never HTML — so names, notes and addresses typed by anyone
// cannot inject markup.

import { STATUSES, labelFor } from "./shared.js";

/* -------------------------------------------------------------------- DOM */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value" && "value" in node) node.value = value;
    else if (key === "checked" || key === "selected" || key === "disabled") node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* -------------------------------------------------------------------- API */

export class ApiError extends Error {
  constructor(message, status, fieldErrors = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["X-Requested-With"] = "fetch";
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("We couldn't reach the store. Check your connection and try again.", 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // fall through with null
  }
  if (!response.ok || !data?.ok) {
    throw new ApiError(data?.error || `Something went wrong (${response.status}).`, response.status, data?.fieldErrors || {});
  }
  return data;
}

export function goToSignIn() {
  location.href = `/?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/** api() for team pages: an expired session sends you back to sign in. */
export async function teamApi(path, options) {
  try {
    return await api(path, options);
  } catch (error) {
    if (error.status === 401) goToSignIn();
    throw error;
  }
}

/* ------------------------------------------------------------------- cart */

// The cart lives in this browser only, one per signed-in email, and holds just
// ids and quantities. Names, costs and stock always come fresh from the server.
export function createCart(email) {
  const key = `tdmerch:cart:v1:${email}`;
  const listeners = new Set();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(raw)
        ? raw.filter((l) => l && typeof l.itemId === "string" && Number.isInteger(l.quantity) && l.quantity > 0)
        : [];
    } catch {
      return [];
    }
  }

  let lines = load();

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(lines));
    } catch {
      // Private browsing: the cart still works for this page view.
    }
    listeners.forEach((fn) => fn());
  }

  const find = (itemId, variantId) => lines.find((l) => l.itemId === itemId && l.variantId === variantId);

  window.addEventListener("storage", (event) => {
    if (event.key === key) {
      lines = load();
      listeners.forEach((fn) => fn());
    }
  });

  return {
    lines: () => lines.map((l) => ({ ...l })),
    count: () => lines.reduce((sum, l) => sum + l.quantity, 0),
    quantityOf: (itemId, variantId) =>
      lines
        .filter((l) => l.itemId === itemId && (variantId === undefined || l.variantId === variantId))
        .reduce((sum, l) => sum + l.quantity, 0),
    add(itemId, variantId, quantity) {
      const line = find(itemId, variantId);
      if (line) line.quantity += quantity;
      else lines.push({ itemId, variantId, quantity });
      save();
    },
    set(itemId, variantId, quantity) {
      const line = find(itemId, variantId);
      if (!line) return;
      if (quantity <= 0) lines = lines.filter((l) => l !== line);
      else line.quantity = quantity;
      save();
    },
    remove(itemId, variantId) {
      lines = lines.filter((l) => !(l.itemId === itemId && l.variantId === variantId));
      save();
    },
    clear() {
      lines = [];
      save();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/* ----------------------------------------------------------------- header */

/**
 * Fill in the static header: who is signed in, the cart count, sign-out.
 * Returns the cart so the page can use it.
 */
export function wireHeader(user) {
  const cart = createCart(user.email);
  for (const node of $$("[data-user-name]")) node.textContent = user.name;

  const countNode = $("[data-cart-count]");
  const renderCount = () => {
    if (!countNode) return;
    const count = cart.count();
    if (countNode.textContent !== String(count)) {
      countNode.textContent = String(count);
      countNode.classList.remove("bump");
      void countNode.offsetWidth;
      countNode.classList.add("bump");
    }
    countNode.closest("[data-cart-open]")?.setAttribute("aria-label", `Your order: ${count} item${count === 1 ? "" : "s"}`);
  };
  renderCount();
  cart.subscribe(renderCount);

  $("[data-sign-out]")?.addEventListener("click", async () => {
    try {
      await api("/api/session", { method: "DELETE" });
    } finally {
      location.href = "/";
    }
  });

  return cart;
}

/* ---------------------------------------------------------------- toasts */

export function toast(message, { tone = "info", action = null, timeout = 5000 } = {}) {
  let region = $("#toasts");
  if (!region) {
    region = el("div", { id: "toasts", class: "toasts", "aria-live": "polite" });
    document.body.append(region);
  }
  const node = el(
    "div",
    { class: `toast${tone === "error" ? " error" : ""}`, role: tone === "error" ? "alert" : "status" },
    el("span", { text: message }),
    action ? el("button", { type: "button", text: action.label, onclick: () => { node.remove(); action.onClick(); } }) : null
  );
  region.append(node);
  while (region.children.length > 3) region.firstElementChild.remove();
  setTimeout(() => node.remove(), timeout);
}

/* ---------------------------------------------------------------- dialogs */

export function confirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Keep it", danger = false }) {
  return new Promise((resolve) => {
    const dialog = el(
      "dialog",
      { class: "confirm", "aria-labelledby": "confirm-title" },
      el("h2", { id: "confirm-title", text: title }),
      el("p", { class: "muted", text: body }),
      el(
        "div",
        { class: "dialog-actions" },
        el("button", { type: "button", class: "btn btn-secondary", text: cancelLabel, onclick: () => dialog.close("cancel") }),
        el("button", {
          type: "button",
          class: danger ? "btn btn-danger solid" : "btn",
          text: confirmLabel,
          onclick: () => dialog.close("confirm"),
        })
      )
    );
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * A side drawer with a scrim. Escape and the scrim close it; focus moves in
 * on open and back to whatever opened it on close.
 */
export function createDrawer(drawer) {
  const scrim = el("div", { class: "scrim", hidden: true });
  drawer.before(scrim);
  let opener = null;

  function close() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    scrim.hidden = true;
    document.body.style.overflow = "";
    opener?.focus?.();
  }

  function open() {
    opener = document.activeElement;
    drawer.hidden = false;
    scrim.hidden = false;
    document.body.style.overflow = "hidden";
    (drawer.querySelector("[autofocus]") || drawer.querySelector("[data-close]"))?.focus();
  }

  scrim.addEventListener("click", close);
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) close();
  });
  // On the document, not the drawer: re-rendering the drawer's contents can
  // drop focus to <body>, and Escape must still close it.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden && !document.querySelector("dialog[open]")) close();
  });
  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])", drawer)
      .filter((n) => n.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return { open, close, get isOpen() { return !drawer.hidden; } };
}

/* ------------------------------------------------------------------ forms */

/** Show server field errors next to the inputs named after them. */
export function showFieldErrors(form, fieldErrors = {}) {
  clearFieldErrors(form);
  let first = null;
  for (const [name, message] of Object.entries(fieldErrors)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) continue;
    const field = input.closest(".field") || input.closest("fieldset") || input.parentElement;
    const id = `err-${name.replace(/[^\w-]/g, "-")}`;
    field.append(el("p", { class: "field-error", id, text: message }));
    const targets = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    for (const target of targets) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", id);
    }
    // Clear the message as soon as the field is edited.
    const resolve = () => {
      document.getElementById(id)?.remove();
      for (const target of targets) {
        target.removeAttribute("aria-invalid");
        target.removeAttribute("aria-describedby");
      }
    };
    for (const target of targets) {
      target.addEventListener("input", resolve, { once: true });
      target.addEventListener("change", resolve, { once: true });
    }
    first ??= input;
  }
  first?.focus();
  return first;
}

export function clearFieldErrors(form) {
  $$(".field-error", form).forEach((n) => n.remove());
  $$("[aria-invalid]", form).forEach((n) => {
    n.removeAttribute("aria-invalid");
    n.removeAttribute("aria-describedby");
  });
}

export function setAlert(node, message, { ok = false } = {}) {
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
  node.classList.toggle("ok", ok);
}

export function options(list, { selected, placeholder } = {}) {
  const out = [];
  if (placeholder) out.push(el("option", { value: "", text: placeholder }));
  for (const entry of list) {
    const [value, label] = Array.isArray(entry) ? entry : [entry.id ?? entry, entry.label ?? entry];
    out.push(el("option", { value, text: label, selected: value === selected }));
  }
  return out;
}

/* --------------------------------------------------------------- display */

export function statusBadge(status) {
  return el("span", { class: `badge status-${status}`, text: labelFor(STATUSES, status) });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// "YYYY-MM-DD" is a calendar date, not an instant: build it in local time so
// it never shows as the day before west of UTC.
export function formatCalendarDate(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addressLines(a) {
  return [
    a.address1,
    a.address2,
    `${a.city}, ${a.state} ${a.postalCode}`,
  ].filter(Boolean);
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** − [n] + quantity control. */
export function quantityStepper({ value = 1, min: initialMin = 1, max = 99, step = 1, label = "Quantity", onChange }) {
  // data-role lets a list that re-renders put focus back on the same control.
  const input = el("input", {
    type: "number",
    inputmode: "numeric",
    min: initialMin,
    max,
    step,
    value: String(value),
    "aria-label": label,
    dataset: { role: "qty" },
  });
  const minus = el("button", { type: "button", "aria-label": `Decrease ${label.toLowerCase()}`, text: "−", dataset: { role: "minus" } });
  const plus = el("button", { type: "button", "aria-label": `Increase ${label.toLowerCase()}`, text: "+", dataset: { role: "plus" } });
  const wrap = el("div", { class: "qty" }, minus, input, plus);

  let current = value;
  let limit = max;
  let min = initialMin;

  // Values run min, min + step, min + 2·step… up to the limit.
  function set(next, notify = true) {
    const top = min + Math.floor(Math.max(0, limit - min) / step) * step;
    const wanted = Math.round(((Number(next) || min) - min) / step) * step + min;
    const n = Math.max(min, Math.min(top, wanted));
    current = n;
    input.value = String(n);
    minus.disabled = n <= min;
    plus.disabled = n >= top;
    if (notify) onChange?.(n);
  }

  minus.addEventListener("click", () => set(current - step));
  plus.addEventListener("click", () => set(current + step));
  input.addEventListener("change", () => set(input.value));

  set(value, false);

  return {
    element: wrap,
    get value() {
      return current;
    },
    setMax(nextMax) {
      limit = Math.max(min, nextMax);
      input.max = String(limit);
      set(current, false);
    },
    setMin(nextMin) {
      min = Math.max(1, nextMin);
      input.min = String(min);
      limit = Math.max(min, limit);
      set(current, false);
    },
    setValue: (n) => set(n, false),
  };
}
