const PACKAGE_ID =
  'NL-PKG-UNTITLED-PACKAGE-GNIC';

const root =
  document.querySelector(
    '[data-sa-package]',
  );

function money(cents) {
  const dollars = cents / 100;

  return (
    '$' +
    dollars.toFixed(
      cents % 100 === 0
        ? 0
        : 2,
    )
  );
}

if (root) {
  const name =
    root.querySelector(
      '[data-sa-package-name]',
    );

  const description =
    root.querySelector(
      '[data-sa-package-description]',
    );

  const price =
    root.querySelector(
      '[data-sa-package-price]',
    );

  const book =
    root.querySelector(
      '[data-sa-package-book]',
    );

  let packageData = null;

  fetch('/api/packages', {
    headers: {
      accept: 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          'packages_unavailable',
        );
      }

      return response.json();
    })
    .then((body) => {
      const packages =
        Array.isArray(
          body?.packages,
        )
          ? body.packages
          : [];

      const pkg =
        packages.find(
          (item) =>
            item?.packageId ===
            PACKAGE_ID,
        );

      if (
        !pkg ||
        typeof pkg.name !==
          'string' ||
        typeof pkg.description !==
          'string' ||
        !Number.isInteger(
          pkg.priceCents,
        )
      ) {
        throw new Error(
          'package_not_found',
        );
      }

      packageData = pkg;

      if (name) {
        name.textContent =
          pkg.name;
      }

      const cleanDescription =
        pkg.description.trim();

      if (
        description &&
        cleanDescription
      ) {
        description.textContent =
          cleanDescription;

        description.hidden =
          false;
      }

      if (price) {
        price.textContent =
          money(
            pkg.priceCents,
          );
      }

      root.dataset.packageId =
        pkg.packageId;

      root.hidden = false;

      root.setAttribute(
        'aria-busy',
        'false',
      );
    })
    .catch((error) => {
      console.error(
        '[service-area-package]',
        error instanceof Error
          ? error.message
          : 'unknown_error',
      );
    });

  book?.addEventListener(
    'click',
    () => {
      if (!packageData) {
        return;
      }

      const openPackageBooking =
        window.openPackageBooking;

      if (
        typeof openPackageBooking !==
        'function'
      ) {
        console.error(
          '[service-area-package] package_booking_unavailable',
        );

        return;
      }

      openPackageBooking({
        packageId:
          packageData.packageId,
        category:
          packageData.name,
        priceLabel:
          money(
            packageData.priceCents,
          ),
        description:
          packageData.description.trim(),
      });
    },
  );
}
