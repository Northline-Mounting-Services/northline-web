import { SERVED_ZIPS_PLACEHOLDER } from '../data/service-area-zips.js';

/** ZIP validation only. ZIP geography never implies scheduling availability. */
document.querySelectorAll('[data-zip-form]').forEach((form) => {
  const input = form.querySelector('input');
  const result = form.querySelector('[data-zip-result]');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const zip = input.value.trim();
    result.hidden = false;

    if (!/^\d{5}$/.test(zip)) {
      result.textContent = 'Enter a 5-digit ZIP code.';
      return;
    }

    result.textContent = SERVED_ZIPS_PLACEHOLDER.has(zip)
      ? `Yes — we serve ${zip}.`
      : `${zip} is outside our regular area. Call to check.`;
  });
});
