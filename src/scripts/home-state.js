// Home page runtime state.
//
// /api/home-state:
//   - One-TV starting price
//   - availability
//
// /api/packages:
//   - Multiple-TV package identity
//   - price
//   - customer description
//
// No package pricing is calculated in the browser.

const root = document.querySelector("[data-package]");

if (root) {
  const tabs = [...root.querySelectorAll("[data-mode]")];

  const panels = new Map(
    [...root.querySelectorAll("[data-panel]")].map((panel) => [
      panel.dataset.panel,
      panel
    ])
  );

  const chips = [...root.querySelectorAll("[data-qty]")];

  const priceOne = root.querySelector('[data-price="one"]');
  const priceMulti = root.querySelector('[data-price="multiple"]');

  const multiPanel = panels.get("multiple");

  const multiDescription =
    multiPanel?.querySelector("[data-multi-description]");

  const multiBook =
    multiPanel?.querySelector("[data-nl-package-open]");

  const MULTI_PACKAGE_IDS = {
    2: "NL-PKG-UNTITLED-PACKAGE-ETTA",
    3: "NL-PKG-UNTITLED-PACKAGE-KE7Y",
    4: "NL-PKG-UNTITLED-PACKAGE-MT9K"
  };

  const packages = new Map();

  let state = {
    mode: "one",
    qty: 2,
    oneTvPricing: null
  };

  const money = (cents) =>
    "$" +
    (cents % 100 === 0
      ? cents / 100
      : (cents / 100).toFixed(2));

  function selectedMultiPackage() {
    const packageId = MULTI_PACKAGE_IDS[state.qty];
    return packageId ? packages.get(packageId) : null;
  }

  function paintOnePrice() {
    const cents = state.oneTvPricing?.priceCents;

    if (
      typeof cents === "number" &&
      priceOne
    ) {
      priceOne.textContent = money(cents);
    }
  }

  function paintMultiPackage() {
    if (!multiPanel) return;

    const pkg = selectedMultiPackage();

    if (!pkg) {
      if (priceMulti) {
        priceMulti.textContent = "—";
      }

      if (multiDescription) {
        multiDescription.textContent =
          "Package pricing is temporarily unavailable.";
      }

      delete multiPanel.dataset.nlPackageId;
      delete multiPanel.dataset.nlPackageCategory;
      delete multiPanel.dataset.nlPackagePrice;
      delete multiPanel.dataset.nlPackageDescription;

      if (multiBook) {
        multiBook.disabled = true;
      }

      return;
    }

    if (priceMulti) {
      priceMulti.textContent = money(pkg.priceCents);
    }

    if (multiDescription) {
      multiDescription.textContent = pkg.description;
    }

    multiPanel.dataset.nlPackageId = pkg.packageId;
    multiPanel.dataset.nlPackageCategory = pkg.name;
    multiPanel.dataset.nlPackagePrice = money(pkg.priceCents);
    multiPanel.dataset.nlPackageDescription = pkg.description;

    if (multiBook) {
      multiBook.disabled = false;
    }
  }

  function setMode(mode) {
    state.mode = mode;

    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;

      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    panels.forEach((panel, key) => {
      panel.hidden = key !== mode;
    });
  }

  function setQty(qty) {
    state.qty = qty;

    chips.forEach((chip) => {
      const active =
        Number(chip.dataset.qty) === qty;

      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });

    paintMultiPackage();
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setMode(tab.dataset.mode);
    });
  });

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      setQty(Number(chip.dataset.qty));
    });
  });

  root
    .querySelector('[role="tablist"]')
    ?.addEventListener("keydown", (event) => {
      if (
        event.key !== "ArrowRight" &&
        event.key !== "ArrowLeft"
      ) {
        return;
      }

      event.preventDefault();

      const current = tabs.findIndex(
        (tab) => tab.dataset.mode === state.mode
      );

      const offset =
        event.key === "ArrowRight"
          ? 1
          : tabs.length - 1;

      const next =
        tabs[(current + offset) % tabs.length];

      setMode(next.dataset.mode);
      next.focus();
    });

  const today =
    document.querySelector('[data-avail="today"]');

  const next =
    document.querySelector('[data-avail="next"]');

  const count =
    document.querySelector("[data-review-count]");

  fetch("/api/home-state", {
    headers: { accept: "application/json" }
  })
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(response.status)
    )
    .then((data) => {
      if (!data?.ok) return;

      state.oneTvPricing =
        data.pricing?.oneTv || null;

      paintOnePrice();

      const todayLabel =
        data.availability?.today?.label;

      const nextLabel =
        data.availability?.next?.label;

      if (
        today &&
        typeof todayLabel === "string" &&
        todayLabel
      ) {
        today.textContent = todayLabel;
      }

      if (
        next &&
        typeof nextLabel === "string" &&
        nextLabel
      ) {
        next.textContent = nextLabel;
      }

      if (
        count &&
        typeof data.reviews?.count === "number"
      ) {
        count.textContent =
          String(data.reviews.count);
      }
    })
    .catch(() => {});

  fetch("/api/packages", {
    headers: { accept: "application/json" }
  })
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(response.status)
    )
    .then((data) => {
      if (!Array.isArray(data?.packages)) {
        return;
      }

      const allowedIds =
        new Set(Object.values(MULTI_PACKAGE_IDS));

      data.packages.forEach((pkg) => {
        if (
          allowedIds.has(pkg.packageId) &&
          typeof pkg.priceCents === "number"
        ) {
          packages.set(pkg.packageId, pkg);
        }
      });

      paintMultiPackage();
    })
    .catch(() => {
      paintMultiPackage();
    });

  setQty(2);
  setMode("one");
}


// Call tracking.
// Pushes to an existing dataLayer only.
// Never creates GTM and never touches Header.

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
