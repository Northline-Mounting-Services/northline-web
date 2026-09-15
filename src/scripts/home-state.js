// Test homepage client module. Owns only: tab switching, quantity selection,
// one fetch of /api/home-state, and writing price + availability text.
// No pricing maths, no calendar logic, no rendering of static content.

const root = document.querySelector("[data-package]");
if (root) {
  const tabs = [...root.querySelectorAll("[data-mode]")];
  const panels = new Map([...root.querySelectorAll("[data-panel]")].map((p) => [p.dataset.panel, p]));
  const chips = [...root.querySelectorAll("[data-qty]")];
  const qtyLabel = root.querySelector("[data-qty-label]");
  const priceOne = root.querySelector('[data-price="one"]');
  const priceMulti = root.querySelector('[data-price="multiple"]');

  let state = { mode: "one", qty: 2, pricing: null };

  const money = (cents) =>
    "$" + (cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2));

  // Only ever writes over the HTML fallback once real pricing has arrived.
  function paintPrices() {
    const p = state.pricing;
    if (!p) return;
    const one = p.oneTv?.priceCents;
    const multi = p.multipleTv?.[String(state.qty)]?.priceCents;
    if (typeof one === "number") priceOne.textContent = money(one);
    if (typeof multi === "number") priceMulti.textContent = money(multi);
  }

  function setMode(mode) {
    state.mode = mode;
    tabs.forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    panels.forEach((panel, key) => { panel.hidden = key !== mode; });
  }

  function setQty(qty) {
    state.qty = qty;
    chips.forEach((c) => {
      const on = Number(c.dataset.qty) === qty;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    if (qtyLabel) qtyLabel.textContent = String(qty);
    paintPrices();
  }

  tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
  chips.forEach((c) => c.addEventListener("click", () => setQty(Number(c.dataset.qty))));

  // Roving arrow-key nav across the tablist.
  root.querySelector('[role="tablist"]')?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.dataset.mode === state.mode);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setMode(next.dataset.mode);
    next.focus();
  });

  const today = document.querySelector('[data-avail="today"]');
  const next = document.querySelector('[data-avail="next"]');
  const count = document.querySelector("[data-review-count]");

  fetch("/api/home-state", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      if (!data?.ok) return;
      state.pricing = data.pricing || null;
      paintPrices();

      // Availability labels only — never a dash, never a computed date.
      const todayLabel = data.availability?.today?.label;
      const nextLabel = data.availability?.next?.label;
      if (today && typeof todayLabel === "string" && todayLabel) today.textContent = todayLabel;
      if (next && typeof nextLabel === "string" && nextLabel) next.textContent = nextLabel;

      if (count && typeof data.reviews?.count === "number") count.textContent = String(data.reviews.count);
    })
    // On failure the HTML fallback stays exactly as rendered.
    .catch(() => {});

  setQty(2);
  setMode("one");
}

// Call tracking. Pushes to an existing dataLayer only — never creates GTM,
// never touches Header.
const call = document.querySelector("[data-call]");
if (call) {
  call.addEventListener("click", () => {
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({
        event: "call_click",
        placement: "hero",
        source_page: window.location.pathname
      });
    }
  });
}
