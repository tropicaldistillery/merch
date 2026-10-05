import { artwork } from "./art.js";
import {
  $,
  clear,
  createDrawer,
  el,
  options,
  plural,
  quantityStepper,
  teamApi,
  toast,
  wireHeader,
} from "./core.js";
import { BRANDS, CATEGORIES, PROFIT_PER_CASE_CENTS, formatMoney, labelFor, orderRule, quantityProblem, quantityRuleText, roiFor } from "./shared.js";

const grid = $("#product-grid");
const chips = $("#category-chips");
const resultCount = $("#result-count");
const searchInput = $("#search");
const brandSelect = $("#brand-filter");
const inStockToggle = $("#in-stock");
const cartBody = $("#cart-lines");
const checkoutLink = $("#checkout-link");

const filters = { category: "All", brand: "", query: "", inStock: false };
let items = [];
let cards = [];

const { user } = await teamApi("/api/session");
const cart = wireHeader(user);
const drawer = createDrawer($("#cart-drawer"));

/* ----------------------------------------------------------- availability */

const hasOptions = (item) => item.variants.length > 1 || Boolean(item.variants[0]?.label);
const tracked = (variant) => Number.isInteger(variant.stock);
const variantStock = (variant) => (tracked(variant) ? variant.stock : Infinity);

function itemAvailability(item) {
  if (item.variants.every((v) => !tracked(v))) return { label: "Made to order", tone: "made", available: Infinity };
  const total = item.variants.reduce((sum, v) => sum + variantStock(v), 0);
  if (total === 0) return { label: "Out of stock", tone: "out", available: 0 };
  if (total <= 5) return { label: `Only ${total} left`, tone: "low", available: total };
  return { label: "In stock", tone: "", available: total };
}

// How many more of this variant fit in the order: the per-order limit across
// all of the item's options, and the variant's own remaining stock.
function roomFor(item, variant) {
  const { max, step } = orderRule(item);
  const perOrder = max - cart.quantityOf(item.id);
  const stock = variantStock(variant) - cart.quantityOf(item.id, variant.id);
  const room = Math.max(0, Math.min(perOrder, stock));
  return Number.isFinite(room) ? Math.floor(room / step) * step : room;
}

// The most this cart line may hold, given the other lines for the same item.
function lineLimit(item, variant, line) {
  const othersOfItem = cart.quantityOf(item.id) - line.quantity;
  return Math.min(orderRule(item).max - othersOfItem, variantStock(variant));
}

// The fewest this cart line may hold so the item still meets its minimum.
function lineFloor(item, line) {
  const { min, step } = orderRule(item);
  const othersOfItem = cart.quantityOf(item.id) - line.quantity;
  return Math.max(step, Math.ceil((min - othersOfItem) / step) * step);
}

// The smallest amount that can be added now: enough to reach the minimum,
// in whole steps.
function stillNeeded(item) {
  const { min, step } = orderRule(item);
  return Math.max(step, Math.ceil((min - cart.quantityOf(item.id)) / step) * step);
}

const limitText = quantityRuleText;

function optionLabel(variant) {
  if (variant.stock === 0) return `${variant.label} — out of stock`;
  if (tracked(variant) && variant.stock <= 5) return `${variant.label} — ${variant.stock} left`;
  return variant.label;
}

/* --------------------------------------------------------------- catalog */

function matches(item) {
  if (filters.category !== "All" && item.category !== filters.category) return false;
  if (filters.brand && item.brand !== filters.brand) return false;
  if (filters.inStock && itemAvailability(item).available === 0) return false;
  if (!filters.query) return true;
  const haystack = [item.name, item.sku, item.description, item.category, item.unit, labelFor(BRANDS, item.brand)]
    .join(" ")
    .toLowerCase();
  return filters.query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function renderChips() {
  const categories = ["All", ...CATEGORIES.filter((c) => items.some((i) => i.category === c))];
  clear(
    chips,
    categories.map((category) =>
      el(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-pressed": String(filters.category === category),
          onclick: () => {
            filters.category = category;
            renderChips();
            renderGrid();
          },
        },
        category,
        el("span", {
          class: "chip-count",
          text: String(category === "All" ? items.length : items.filter((i) => i.category === category).length),
        })
      )
    )
  );
}

function productCard(item) {
  const availability = itemAvailability(item);
  const withOptions = hasOptions(item);

  const select = withOptions
    ? el(
        "select",
        { "aria-label": `Size or option for ${item.name}` },
        el("option", { value: "", text: item.category === "Apparel" ? "Choose a size" : "Choose an option" }),
        item.variants.map((v) => el("option", { value: v.id, text: optionLabel(v), disabled: v.stock === 0 }))
      )
    : null;

  const stepper = quantityStepper({ value: stillNeeded(item), min: stillNeeded(item), max: orderRule(item).max, step: orderRule(item).step, label: `Quantity of ${item.name}` });
  const addButton = el("button", { type: "button", class: "btn", text: "Add" });

  function selectedVariant() {
    return withOptions ? item.variants.find((v) => v.id === select.value) ?? null : item.variants[0];
  }

  function update() {
    const variant = selectedVariant();
    const room = variant
      ? roomFor(item, variant)
      : Math.max(0, orderRule(item).max - cart.quantityOf(item.id));
    const need = stillNeeded(item);
    stepper.setMin(need);
    stepper.setMax(Math.max(need, room));
    // Too few left to make up the minimum counts as unavailable.
    const short = room > 0 && room < need;
    addButton.disabled = availability.available === 0 || room === 0 || short;
    addButton.textContent =
      availability.available === 0 ? "Out of stock" : short ? "Not enough left" : room === 0 && variant ? "Limit reached" : "Add";
  }

  select?.addEventListener("change", () => {
    select.removeAttribute("aria-invalid");
    update();
  });

  addButton.addEventListener("click", () => {
    const variant = selectedVariant();
    if (!variant) {
      select.setAttribute("aria-invalid", "true");
      select.focus();
      toast(`Choose a size for ${item.name} first.`, { tone: "error" });
      return;
    }
    const room = roomFor(item, variant);
    if (room === 0) {
      toast(
        cart.quantityOf(item.id) >= orderRule(item).max
          ? `Your order already has the most allowed (${orderRule(item).max}) of ${item.name}.`
          : `There are no more ${item.name}${variant.label ? ` in ${variant.label}` : ""} available.`,
        { tone: "error" }
      );
      return;
    }
    const quantity = Math.min(stepper.value, room);
    if (quantity < stillNeeded(item)) {
      toast(`There aren't enough ${item.name} left to make up a full order quantity.`, { tone: "error" });
      return;
    }
    cart.add(item.id, variant.id, quantity);
    stepper.setValue(stillNeeded(item));
    toast(`Added ${quantity} × ${item.name}${variant.label ? ` (${variant.label})` : ""}`, {
      action: { label: "View order", onClick: () => openCart() },
    });
  });

  const card = el(
    "article",
    { class: "card product-card", "aria-labelledby": `name-${item.id}` },
    artwork(item),
    el(
      "div",
      { class: "product-body" },
      el("p", { class: "product-brand", text: `${labelFor(BRANDS, item.brand)} · ${item.category}` }),
      el("h2", { class: "product-name", id: `name-${item.id}`, text: item.name }),
      el("p", { class: "product-unit", text: `${item.unit} · ${item.sku}` }),
      item.description ? el("p", { class: "product-desc", text: item.description }) : null,
      el(
        "div",
        { class: "product-meta" },
        el(
          "span",
          { class: "price" },
          formatMoney(item.costCents),
          el("small", { text: item.unit === "Each" ? " each" : ` / ${item.unit.toLowerCase()}` }),
          el("span", { class: "free", text: "Free to you" })
        ),
        el("span", { class: `stock ${availability.tone}`.trim(), text: availability.label })
      ),
      el("div", { class: "product-actions" }, select, stepper.element, addButton),
      el("p", { class: "product-limit", text: limitText(item) })
    )
  );

  update();
  return { card, update };
}

function renderGrid() {
  const visible = items.filter(matches);
  cards = visible.map(productCard);
  grid.removeAttribute("aria-busy");

  if (!visible.length) {
    clear(
      grid,
      el(
        "div",
        { class: "card empty" },
        el("h2", { text: "Nothing matches" }),
        el("p", { text: "Try another search or category." }),
        el("button", {
          type: "button",
          class: "btn btn-secondary",
          text: "Clear filters",
          onclick: () => {
            Object.assign(filters, { category: "All", brand: "", query: "", inStock: false });
            searchInput.value = "";
            brandSelect.value = "";
            inStockToggle.checked = false;
            renderChips();
            renderGrid();
          },
        })
      )
    );
  } else {
    clear(grid, cards.map((c) => c.card));
  }

  resultCount.textContent =
    visible.length === items.length ? plural(items.length, "item") : `Showing ${visible.length} of ${plural(items.length, "item")}`;
}

/* ------------------------------------------------------------------ cart */

function cartLine(line) {
  const item = items.find((i) => i.id === line.itemId);
  const variant = item?.variants.find((v) => v.id === line.variantId);
  const key = `${line.itemId}::${line.variantId}`;

  if (!item || !variant) {
    return el(
      "div",
      { class: "cart-line", dataset: { line: key } },
      artwork({ art: "bottle", tone: "palm" }, "thumb"),
      el(
        "div",
        { class: "cart-line-main" },
        el("p", { class: "cart-line-name", text: "No longer available" }),
        el("p", { class: "cart-line-sub", text: "This item was removed from the catalog." }),
        el("button", {
          type: "button",
          class: "link-button",
          text: "Remove",
          dataset: { role: "remove" },
          onclick: () => cart.remove(line.itemId, line.variantId),
        })
      )
    );
  }

  const limit = lineLimit(item, variant, line);
  // An item in one size steps by its increment; across sizes the total has to
  // come out right, so each line moves one at a time.
  const single = item.variants.length === 1;
  const step = single ? orderRule(item).step : 1;
  const floor = Math.min(single ? lineFloor(item, line) : 1, line.quantity);
  const problem = quantityProblem(item, cart.quantityOf(item.id));
  const stepper = quantityStepper({
    value: line.quantity,
    min: floor,
    step,
    max: Math.max(1, Math.max(limit, line.quantity)),
    label: `Quantity of ${item.name}`,
    onChange: (n) => cart.set(item.id, variant.id, n),
  });

  return el(
    "div",
    { class: "cart-line", dataset: { line: key } },
    artwork(item, "thumb"),
    el(
      "div",
      { class: "cart-line-main" },
      el("p", { class: "cart-line-name", text: item.name }),
      el("p", {
        class: "cart-line-sub",
        text: [variant.label, item.unit, `${formatMoney(item.costCents)} each`].filter(Boolean).join(" · "),
      }),
      line.quantity > limit
        ? el("p", {
            class: "warn",
            text: limit <= 0 ? "No longer available in this quantity — remove it." : `Only ${limit} can be ordered — lower the quantity.`,
          })
        : problem
          ? el("p", { class: "warn", text: problem })
          : null,
      el(
        "div",
        { class: "cart-line-controls" },
        stepper.element,
        el("strong", { text: formatMoney(item.costCents * line.quantity) }),
        el("button", {
          type: "button",
          class: "link-button",
          text: "Remove",
          dataset: { role: "remove" },
          "aria-label": `Remove ${item.name}${variant.label ? ` (${variant.label})` : ""}`,
          onclick: () => cart.remove(item.id, variant.id),
        })
      )
    )
  );
}

/* --------------------------------------------------------- ROI calculator */

// Built once and kept, so the number typed survives the cart re-rendering.
const ROI_KEY = "tdmerch:roi-cases";
const roiCases = el("input", {
  id: "roi-cases",
  type: "number",
  min: "0",
  max: "100000",
  step: "1",
  inputmode: "numeric",
  placeholder: "0",
  "aria-describedby": "roi-basis",
});
try {
  roiCases.value = localStorage.getItem(ROI_KEY) ?? "";
} catch {
  // storage unavailable: start empty
}
const roiResults = el("div", { class: "roi-results", "aria-live": "polite" });
const roiPanel = el(
  "section",
  { class: "roi", "aria-labelledby": "roi-title" },
  el("h3", { id: "roi-title", text: "ROI calculator" }),
  el("label", { class: "roi-input", for: "roi-cases" }, el("span", { text: "Cases you expect this order to help sell" }), roiCases),
  el("p", { class: "hint", id: "roi-basis", text: `Based on an average profit of ${formatMoney(PROFIT_PER_CASE_CENTS)} per case.` }),
  roiResults
);
let roiCost = 0;

function renderRoi() {
  const typed = Number.parseInt(roiCases.value, 10);
  const cases = Number.isFinite(typed) && typed > 0 ? Math.min(typed, 100000) : 0;
  const { profitCents, netCents, roiPercent, breakEvenCases } = roiFor(roiCost, cases);
  const breakEven = roiCost > 0 ? `This order pays for itself at ${plural(breakEvenCases, "case")} sold.` : "";
  if (!cases) {
    clear(roiResults, el("p", { class: "roi-note", text: breakEven || "Enter cases to see the return." }));
    return;
  }
  const stat = (label, value, extra = "") => el("div", { class: `roi-stat ${extra}`.trim() }, el("span", { text: label }), el("strong", { text: value }));
  clear(
    roiResults,
    el(
      "div",
      { class: "roi-grid" },
      stat("Projected profit", formatMoney(profitCents)),
      stat("Merch cost", formatMoney(roiCost)),
      stat("Net return", `${netCents < 0 ? "−" : "+"}${formatMoney(Math.abs(netCents))}`, netCents < 0 ? "loss" : "gain"),
      stat("ROI", roiPercent === null ? "—" : `${roiPercent.toLocaleString("en-US")}%`, netCents < 0 ? "loss big" : "gain big")
    ),
    breakEven ? el("p", { class: "roi-note", text: breakEven }) : null
  );
}

roiCases.addEventListener("input", () => {
  try {
    localStorage.setItem(ROI_KEY, roiCases.value);
  } catch {
    // storage unavailable: nothing to remember
  }
  renderRoi();
});

function renderCart() {
  const lines = cart.lines();

  // Keep keyboard focus on the same control across the re-render.
  const active = document.activeElement;
  const focusLine = cartBody.contains(active) ? active.closest("[data-line]")?.dataset.line : null;
  const focusRole = focusLine ? active.dataset.role : null;

  if (!lines.length) {
    clear(
      cartBody,
      el(
        "div",
        { class: "empty" },
        el("h2", { text: "Nothing here yet" }),
        el("p", { text: "Add gear, POS or event supplies from the catalog." }),
        el("button", { type: "button", class: "btn btn-secondary", text: "Browse the catalog", dataset: { close: "" } })
      )
    );
  } else {
    clear(cartBody, lines.map(cartLine), roiPanel);
  }

  let total = 0;
  let units = 0;
  let blocked = false;
  for (const line of lines) {
    const item = items.find((i) => i.id === line.itemId);
    const variant = item?.variants.find((v) => v.id === line.variantId);
    if (!item || !variant) {
      blocked = true;
      continue;
    }
    total += item.costCents * line.quantity;
    units += line.quantity;
    if (line.quantity > lineLimit(item, variant, line)) blocked = true;
    if (quantityProblem(item, cart.quantityOf(item.id))) blocked = true;
  }
  $("#cart-total").textContent = formatMoney(total);
  roiCost = total;
  renderRoi();
  $("#cart-units").textContent = plural(units, "unit");

  const disabled = !lines.length || blocked;
  checkoutLink.setAttribute("aria-disabled", String(disabled));
  checkoutLink.classList.toggle("is-disabled", disabled);
  checkoutLink.tabIndex = disabled ? -1 : 0;

  if (focusLine) {
    const target =
      cartBody.querySelector(`[data-line="${CSS.escape(focusLine)}"] [data-role="${focusRole}"]`) ||
      cartBody.querySelector("[data-role]") ||
      $("[data-close]", $("#cart-drawer"));
    target?.focus();
  }
}

checkoutLink.addEventListener("click", (event) => {
  if (checkoutLink.getAttribute("aria-disabled") === "true") event.preventDefault();
});

function openCart() {
  renderCart();
  drawer.open();
}

$("[data-cart-open]").addEventListener("click", openCart);

cart.subscribe(() => {
  renderCart();
  cards.forEach((c) => c.update());
});

/* --------------------------------------------------------------- filters */

clear(brandSelect, options(BRANDS, { placeholder: "All brands" }));

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.query = searchInput.value.trim();
    renderGrid();
  }, 120);
});
brandSelect.addEventListener("change", () => {
  filters.brand = brandSelect.value;
  renderGrid();
});
inStockToggle.addEventListener("change", () => {
  filters.inStock = inStockToggle.checked;
  renderGrid();
});

/* ------------------------------------------------------------------ load */

try {
  ({ items } = await teamApi("/api/catalog"));
  renderChips();
  renderGrid();
  renderCart();
  const params = new URLSearchParams(location.search);
  if (params.get("cart") === "open") {
    history.replaceState(null, "", "/shop");
    openCart();
  }
  try {
    const note = sessionStorage.getItem("tdmerch:reorder-note");
    if (note) {
      sessionStorage.removeItem("tdmerch:reorder-note");
      toast(note, { tone: "error", timeout: 8000 });
    }
  } catch {
    // ignore
  }
} catch (error) {
  grid.removeAttribute("aria-busy");
  clear(
    grid,
    el(
      "div",
      { class: "card empty" },
      el("h2", { text: "The catalog didn't load" }),
      el("p", { text: error.message }),
      el("button", { type: "button", class: "btn", text: "Try again", onclick: () => location.reload() })
    )
  );
}
