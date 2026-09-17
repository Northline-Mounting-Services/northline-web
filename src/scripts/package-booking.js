/**
 * Northline package booking popup — ONE instance for the whole site.
 *
 * A package page supplies the selected package and opens the popup:
 *   window.openPackageBooking({ packageId, category, priceLabel, description })
 * or declaratively, via a CTA carrying data-nl-package-* attributes.
 *
 * The popup prices nothing. priceLabel is rendered verbatim — "from $178.20"
 * stays "from $178.20". Rounding belongs to the calculator, not here.
 *
 * Booking creation is a single call to createPackageBooking(). No success is
 * simulated and no redirect happens without a real bookingId.
 */

import { ARRIVAL_WINDOWS, SMS_RECIPIENT, BOOKING_SUCCESS_URL } from '../data/calculator-inventory.js';
import { loadBookingAvailability, createPackageBooking } from './package-booking-api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BOOKING_TIMEZONE = 'America/New_York';
const BUSINESS_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOOKING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/* Interaction analytics only. Never PII — no phone, no name, no address. */
const track = (event) => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event });
};

const esc = (v) =>
  String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FIELDS = [
  { name: 'name', label: 'Full name', type: 'text', autocomplete: 'name', required: true },
  { name: 'phone', label: 'US phone number', type: 'tel', autocomplete: 'tel', required: true, inputmode: 'tel', placeholder: '(770) 555-1234' },
  { name: 'address1', label: 'Street address', type: 'text', autocomplete: 'address-line1', required: true },
  { name: 'address2', label: 'Apt, suite, unit (optional)', type: 'text', autocomplete: 'address-line2' },
  { name: 'city', label: 'City', type: 'text', autocomplete: 'address-level2', required: true }
];

const blankCustomer = () => ({ name: '', phone: '', address1: '', address2: '', city: '', state: 'GA', notes: '' });

export function initPackageBooking(root) {
  const dialog = root.querySelector('dialog');
  const main = root.querySelector('[data-nl-pkg-main]');
  const summary = root.querySelector('[data-nl-pkg-summary]');
  if (!dialog || !main || !summary) return null;

  const state = {
    pkg: null,
    customer: blankCustomer(),
    availability: null, // null = loading, {} = unknown
    day: null,
    windowCode: null,
    status: 'idle', // idle | sending | error
    showErrors: false,
    requestId: null,
    requestFingerprint: null
  };

  let opener = null;
  let availabilityRequestId = 0;

  /* ---------------- validation ---------------- */

  const phoneDigits = () => state.customer.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const phoneValid = () => /^[2-9]\d{9}$/.test(phoneDigits());

  function fieldError(name) {
    const value = state.customer[name].trim();
    if (name === 'phone') {
      if (!value) return 'Required — we confirm the appointment by phone.';
      return phoneValid() ? null : "That doesn't look like a US phone number.";
    }
    const def = FIELDS.find((f) => f.name === name);
    if (def && def.required && !value) return 'Required.';
    return null;
  }

  const customerComplete = () => FIELDS.every((f) => !fieldError(f.name));
  const readyToBook = () => customerComplete() && !!state.day && !!state.windowCode;

  /* ---------------- availability ---------------- */

  function easternTodayIso() {
    const parts = Object.fromEntries(
      BUSINESS_DATE.formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  const dateFromIso = (isoDate) => new Date(`${isoDate}T12:00:00Z`);
  const isoFromUtcDate = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  function bookingDays() {
    const out = [];
    const cursor = dateFromIso(easternTodayIso());
    while (out.length < 12) {
      if (cursor.getUTCDay() !== 0) out.push(isoFromUtcDate(cursor)); // Monday–Saturday
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  const windowsFor = (isoDate) => (state.availability && state.availability[isoDate]) || [];

  async function refreshAvailability() {
    const requestId = ++availabilityRequestId;
    const days = bookingDays();
    state.availability = null;
    render();

    try {
      const availability = await loadBookingAvailability({
        from: days[0],
        to: days[days.length - 1]
      });
      if (requestId !== availabilityRequestId) return;

      state.availability = availability && typeof availability === 'object' ? availability : {};

      if (state.day && windowsFor(state.day).length === 0) {
        state.day = null;
        state.windowCode = null;
      } else if (state.day && state.windowCode && !windowsFor(state.day).includes(state.windowCode)) {
        state.windowCode = null;
      }
    } catch (err) {
      if (requestId !== availabilityRequestId) return;
      state.availability = {}; // fail closed — never invent availability
      console.warn('[package-booking]', err.message);
    }

    render();
  }

  /* ---------------- booking ---------------- */

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function bookingFingerprint() {
    return JSON.stringify({
      packageId: state.pkg && state.pkg.packageId,
      date: state.day,
      windowCode: state.windowCode,
      customer: state.customer
    });
  }

  function requestIdForCurrentBooking() {
    const fingerprint = bookingFingerprint();
    if (!state.requestId || state.requestFingerprint !== fingerprint) {
      state.requestId = newRequestId();
      state.requestFingerprint = fingerprint;
    }
    return state.requestId;
  }

  async function confirmBooking() {
    state.showErrors = true;
    if (!readyToBook() || state.status === 'sending') return render();
    state.status = 'sending';
    render();
    try {
      const result = await createPackageBooking({
        requestId: requestIdForCurrentBooking(),
        packageId: state.pkg.packageId,
        date: state.day,
        windowCode: state.windowCode,
        customer: { ...state.customer, phone: phoneDigits() }
      });
      if (!result || !result.bookingId) throw new Error('booking_not_confirmed');
      /* Confirmed by the backend. /paul carries the primary booking
         conversion — no duplicate conversion event fires here. */
      window.location.assign(BOOKING_SUCCESS_URL);
    } catch (err) {
      console.warn('[package-booking]', err.message);
      state.status = 'error'; // package, customer, day and window all preserved
      render();
    }
  }

  /* ---------------- rendering ---------------- */

  const smsHref = () =>
    `sms:${SMS_RECIPIENT}?&body=${encodeURIComponent(
      `Northline — ${state.pkg ? state.pkg.category : 'package'} (${state.pkg ? state.pkg.priceLabel : ''})\n\nQuestion: `
    )}`;

  function renderSummary() {
    const p = state.pkg;
    if (!p) return '';
    return `<p class="nl-eyebrow">Booking</p>
      <p class="nl-pkg__category">${esc(p.category)}</p>
      <p class="nl-pkg__price">${esc(p.priceLabel)}</p>
      <p class="nl-pkg__desc">${esc(p.description)}</p>`;
  }

  function renderField(f) {
    const err = state.showErrors ? fieldError(f.name) : null;
    const id = `nl-pkg-${f.name}`;
    const attrs = [
      `id="${id}"`,
      `name="${f.name}"`,
      `type="${f.type}"`,
      `class="nl-input"`,
      `value="${esc(state.customer[f.name])}"`,
      `autocomplete="${f.autocomplete}"`,
      f.inputmode ? `inputmode="${f.inputmode}"` : '',
      f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
      f.required ? 'required' : '',
      err ? `data-state="invalid" aria-invalid="true" aria-describedby="${id}-help"` : '',
      `data-nl-pkg-field="${f.name}"`
    ]
      .filter(Boolean)
      .join(' ');
    return `<div class="nl-pkg__field">
      <label class="nl-label" for="${id}">${esc(f.label)}</label>
      <input ${attrs} />
      ${err ? `<p class="nl-help" id="${id}-help" data-state="invalid">${esc(err)}</p>` : ''}
    </div>`;
  }

  function renderDays() {
    const loading = state.availability === null;
    const today = easternTodayIso();
    return bookingDays()
      .map((key) => {
        const d = dateFromIso(key);
        const free = windowsFor(key).length > 0;
        const selected = state.day === key;
        return `<button type="button" class="nl-day" aria-pressed="${selected}" ${free ? '' : 'disabled'} data-nl-pkg-day="${key}">
          <span class="nl-day__dow">${DOW[d.getUTCDay()]}</span>
          <span class="nl-day__date">${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}</span>
          <span class="nl-day__note">${loading ? '…' : free ? (key === today ? 'today' : 'open') : 'full'}</span>
        </button>`;
      })
      .join('');
  }

  function renderSlots() {
    if (!state.day) return '';
    const open = windowsFor(state.day);
    const buttons = ARRIVAL_WINDOWS.map((w) => {
      const free = open.includes(w.windowCode);
      const selected = state.windowCode === w.windowCode;
      return `<button type="button" class="nl-slot" aria-pressed="${selected}" ${free ? '' : 'disabled'} data-nl-pkg-window="${w.windowCode}">
        <span class="nl-slot__label">${esc(w.label)}</span>
        <span class="nl-slot__state">${selected ? 'Selected' : free ? 'Available' : 'Booked'}</span>
      </button>`;
    }).join('');
    const d = dateFromIso(state.day);
    return `<div class="nl-section">
      <p class="nl-eyebrow">Arrival window · ${DOW[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}</p>
      <div class="nl-slots" role="group" aria-label="Arrival window">${buttons}</div>
    </div>`;
  }

  function renderBody() {
    const sending = state.status === 'sending';
    const error =
      state.status === 'error'
        ? `<div class="nl-error" role="alert">
            <p class="nl-error__title">We couldn't create that booking</p>
            <p class="nl-error__body">Your package, details, day and arrival window are still selected. Try again, or text us and we'll book it for you.</p>
            <div class="nl-error__actions">
              <button type="button" class="nl-retry" data-nl-pkg-confirm>Retry</button>
              <a class="nl-secondary" style="margin:0;width:auto;max-width:none" href="${esc(smsHref())}">Text us instead</a>
            </div>
          </div>`
        : '';

    const blocked = state.showErrors && !readyToBook() && state.status !== 'error';
    const blockedNote = blocked
      ? `<p class="nl-help" data-state="invalid" role="alert">${
          customerComplete() ? 'Choose a day and an arrival window.' : 'Check the highlighted details above.'
        }</p>`
      : '';

    return `<div class="nl-section">
        <p class="nl-section__title">Your details</p>
        <div class="nl-pkg__fields">
          ${FIELDS.map(renderField).join('')}
          <div class="nl-pkg__field">
            <label class="nl-label" for="nl-pkg-state">State</label>
            <input class="nl-input" id="nl-pkg-state" name="state" type="text" value="GA" readonly aria-readonly="true" />
          </div>
        </div>
        <div class="nl-pkg__field nl-pkg__field--wide">
          <label class="nl-label" for="nl-pkg-notes">Notes for the installer (optional)</label>
          <textarea class="nl-input nl-pkg__textarea" id="nl-pkg-notes" name="notes" rows="3"
            data-nl-pkg-field="notes">${esc(state.customer.notes)}</textarea>
        </div>
      </div>

      <div class="nl-section">
        <p class="nl-section__title">Pick a day</p>
        <p class="nl-lede">Monday to Saturday, Eastern time. Three arrival windows a day.</p>
        <div class="nl-days" role="group" aria-label="Installation date">${renderDays()}</div>
      </div>
      ${renderSlots()}
      ${error}
      <div style="margin-top:22px;max-width:420px">
        <button type="button" class="nl-primary" data-nl-pkg-confirm ${sending ? 'disabled aria-disabled="true"' : ''}>
          <span>${sending ? 'Booking…' : 'Book installation'}</span><span aria-hidden="true">&rarr;</span>
        </button>
        ${blockedNote}
      </div>`;
  }

  function render() {
    const active = document.activeElement;
    const focusedField = active && active.dataset ? active.dataset.nlPkgField : null;
    const caret = focusedField && active.setSelectionRange ? active.selectionStart : null;

    summary.innerHTML = renderSummary();
    main.innerHTML = renderBody();

    if (focusedField) {
      const next = main.querySelector(`[data-nl-pkg-field="${focusedField}"]`);
      if (next) {
        next.focus();
        if (caret != null) {
          try { next.setSelectionRange(caret, caret); } catch (e) {}
        }
      }
    }
  }

  /* ---------------- events ---------------- */

  root.addEventListener('input', (event) => {
    const field = event.target.closest('[data-nl-pkg-field]');
    if (!field) return;
    state.customer[field.dataset.nlPkgField] = field.value;
    if (state.showErrors) render();
  });

  root.addEventListener('click', (event) => {
    const day = event.target.closest('[data-nl-pkg-day]');
    if (day) {
      state.day = day.dataset.nlPkgDay;
      state.windowCode = null;
      state.status = 'idle';
      return render();
    }
    const win = event.target.closest('[data-nl-pkg-window]');
    if (win) {
      state.windowCode = win.dataset.nlPkgWindow;
      state.status = 'idle';
      return render();
    }
    if (event.target.closest('[data-nl-pkg-confirm]')) return confirmBooking();
    if (event.target.closest('[data-nl-pkg-close]')) return close();
  });

  /* ---------------- modal ---------------- */

  function open(pkg, trigger) {
    if (!pkg || !pkg.packageId) return;
    const changed = !state.pkg || state.pkg.packageId !== pkg.packageId;
    state.pkg = {
      packageId: pkg.packageId,
      category: pkg.category || '',
      priceLabel: pkg.priceLabel || '',
      description: pkg.description || ''
    };
    if (changed) {
      state.day = null;
      state.windowCode = null;
      state.status = 'idle';
      state.showErrors = false;
      state.requestId = null;
      state.requestFingerprint = null;
    }
    opener = trigger || document.activeElement;
    document.body.classList.add('nl-locked');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    track('package_booking_open');
    render();
    refreshAvailability();
    const first = dialog.querySelector('input:not([readonly]), button:not([disabled]), a[href]');
    if (first) first.focus();
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('nl-locked');
    track('package_booking_close');
    if (opener && opener.focus) opener.focus(); // entered details are kept for reopen
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault(); // Escape routed through our own close
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(); // overlay click
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      dialog.querySelectorAll('button:not([disabled]), a[href], input:not([readonly]), textarea, [tabindex="0"]')
    ).filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  /* Declarative CTAs anywhere on the page. The variant a card resolves at
     click time wins — a card may rewrite these attributes as the customer
     switches variants. */
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-nl-package-open]');
    if (!trigger) return;
    event.preventDefault();
    const source = trigger.closest('[data-nl-package-id]') || trigger;
    open(
      {
        packageId: source.dataset.nlPackageId,
        category: source.dataset.nlPackageCategory,
        priceLabel: source.dataset.nlPackagePrice,
        description: source.dataset.nlPackageDescription
      },
      trigger
    );
  });

  const api = { open, close };
  window.openPackageBooking = (pkg) => api.open(pkg);
  return api;
}
