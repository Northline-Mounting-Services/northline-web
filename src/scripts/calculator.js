/**
 * Northline calculator — client behaviour. Vanilla JS, no framework.
 *
 * Identifier vocabulary: family + groupCode + itemCode, straight from
 * ../data/calculator-inventory.js. Client lift assistance is pricing context
 * serialized as `clientLift` (boolean) and never as an item.
 *
 * All pricing, availability, lead persistence and booking creation go through
 * ./calculator-api.js, which is the single integration boundary. This file
 * contains no prices, no availability generation and no simulated success.
 */
import {
  INVENTORY,
  FAMILIES,
  CLIENT_LIFT,
  REQUIRED_GROUPS,
  ARRIVAL_WINDOWS,
  MAX_TVS,
  SMS_RECIPIENT,
  BOOKING_SUCCESS_URL,
  clientLiftApplies,
  itemLabel
} from '../data/calculator-inventory.js';
import {
  loadPublishedPricing,
  upsertCalculatorLead,
  loadBookingAvailability,
  createInstallationBooking
} from './calculator-api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Interaction analytics only. Never PII — no phone, no name, no address. */
const track = (event) => {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event });
};

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const newTv = () => ({ family: null, selection: {}, clientLift: null, step: 0, editing: null });

export function initCalculator(root) {
  const dialog = root.querySelector('.nl-calc');
  const main = root.querySelector('[data-nl-main]');
  const rail = root.querySelector('[data-nl-rail]');
  const bar = root.querySelector('[data-nl-bar]');
  const stageTitle = root.querySelector('[data-nl-stage-title]');
  const backBtn = root.querySelector('[data-nl-back]');

  const state = {
    stage: 'config', // config | review | booking
    tvs: [newTv()],
    active: 0,
    phone: '',
    day: null, // YYYY-MM-DD
    windowCode: null,
    availability: null, // null = not loaded
    bookStatus: 'idle', // idle | sending | error
    pricingStatus: 'loading', // loading | ok | unavailable
    pricing: null
  };

  let opener = null;
  let phoneWasValid = false; // gates calculator_phone_valid ONLY
  let quoteId = null; // one lead/quote identity for the whole session
  let leadTimer = null;

  /* ---------------- pricing (published, read-only) ---------------- */

  async function initPricing() {
    try {
      state.pricing = await loadPublishedPricing();
      state.pricingStatus = 'ok';
    } catch (err) {
      state.pricingStatus = 'unavailable';
      console.warn('[calculator]', err.message);
    }
    render();
  }

  const itemPrice = (family, groupCode, itemCode) => {
    if (!state.pricing) return null;
    const value = state.pricing.items[`${family}.${groupCode}.${itemCode}`];
    return value === undefined ? null : value;
  };

  /* Client lift is a published pricing RULE, not an item. */
  const liftAdjustment = (value) => {
    const rule = state.pricing && state.pricing.clientLiftRule;
    if (!rule) return null;
    const v = rule[String(value)];
    return v === undefined ? null : v;
  };

  function priceLabel(value) {
    if (state.pricingStatus !== 'ok' || value === null) return '';
    if (value === 'quote') return 'Custom quote';
    if (value === 0) return 'Included';
    return '+' + money(value);
  }

  /* ---------------- derived model ---------------- */

  const liftShown = (tv) => !!tv.family && clientLiftApplies(tv.family, tv.selection);
  /* Stale conditional value never leaks: read it only through this. */
  const liftValue = (tv) => (liftShown(tv) && typeof tv.clientLift === 'boolean' ? tv.clientLift : null);

  function tvPrice(tv) {
    if (!tv.family || state.pricingStatus !== 'ok') return { total: 0, quote: false, complete: false };
    const def = INVENTORY[tv.family];
    let total = (state.pricing.base && state.pricing.base[tv.family]) || 0;
    let quote = false;
    let complete = true;

    Object.keys(def.groups).forEach((groupCode) => {
      const group = def.groups[groupCode];
      const picked = tv.selection[groupCode];
      if (group.multi) {
        (picked || []).forEach((itemCode) => {
          const value = itemPrice(tv.family, groupCode, itemCode);
          if (value === 'quote') quote = true;
          else if (typeof value === 'number') total += value;
        });
      } else if (picked) {
        const value = itemPrice(tv.family, groupCode, picked);
        if (value === 'quote') quote = true;
        else if (typeof value === 'number') total += value;
      }
    });

    REQUIRED_GROUPS[tv.family].forEach((groupCode) => {
      if (!tv.selection[groupCode]) complete = false;
    });

    const lift = liftValue(tv);
    if (liftShown(tv) && lift === null) complete = false;
    if (lift !== null) {
      const adj = liftAdjustment(lift);
      if (adj === 'quote') quote = true;
      else if (typeof adj === 'number') total += adj;
    }

    return { total, quote, complete };
  }

  function summaryLines(tv, groupCodes, includeLift) {
    const out = [];
    groupCodes.forEach((groupCode) => {
      const group = INVENTORY[tv.family].groups[groupCode];
      const picked = tv.selection[groupCode];
      if (group.multi) {
        const names = (picked || []).map((c) => itemLabel(tv.family, groupCode, c)).filter(Boolean);
        if (names.length) out.push(names.join(', '));
      } else if (picked) {
        out.push(itemLabel(tv.family, groupCode, picked));
      }
    });
    if (includeLift) {
      const lift = liftValue(tv);
      if (lift !== null) out.push(`${CLIENT_LIFT.label}: ${lift ? 'Yes' : 'No'}`);
    }
    return out;
  }

  function fullSummaryLines(tv) {
    if (!tv.family) return [];
    const codes = [];
    INVENTORY[tv.family].sections.forEach((s) => s.groups.forEach((c) => codes.push(c)));
    return summaryLines(tv, codes, true);
  }

  const fullSummary = (tv) => fullSummaryLines(tv).join(' · ') || 'Not configured yet';

  function multiTvPercentForCount(count) {
    if (count <= 1 || !state.pricing) return 0;

    const rules = Array.isArray(state.pricing.multiTvRules)
      ? state.pricing.multiTvRules
      : [];

    const rule = rules.find((candidate) =>
      count >= candidate.minQuantity &&
      (candidate.maxQuantity === null || count <= candidate.maxQuantity)
    );

    return rule ? rule.percent : 0;
  }

  function totals() {
    const priced = state.tvs.map(tvPrice);
    const subtotal = priced.reduce((sum, p) => sum + p.total, 0);
    const percent = multiTvPercentForCount(state.tvs.length);
    return { subtotal, percent, total: subtotal * (1 - percent), quote: priced.some((p) => p.quote) };
  }

  const estimateComplete = () => state.tvs.length > 0 && state.tvs.every((tv) => tv.family && tvPrice(tv).complete);

  /* ---------------- quote payload ---------------- */

  function serializeQuote() {
    const t = totals();
    return {
      pricingVersion: state.pricing && state.pricing.version,
      multiTvPercent: t.percent,
      quoteRequired: t.quote,
      subtotal: t.quote ? null : Math.round(t.subtotal),
      total: t.quote ? null : Math.round(t.total),
      tvs: state.tvs.map((tv) => {
        if (!tv.family) return { family: null };
        const selection = {};
        Object.keys(tv.selection).forEach((groupCode) => {
          const value = tv.selection[groupCode];
          if (value === undefined) return;
          if (Array.isArray(value) && !value.length) return;
          selection[groupCode] = value;
        });
        const out = { family: tv.family, selection };
        const lift = liftValue(tv);
        if (lift !== null) out.clientLift = lift; // pricing context, boolean
        return out;
      })
    };
  }

  /* ---------------- phone ---------------- */

  const phoneDigits = () => state.phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const phoneE164 = () => (phoneState() === 'valid' ? `+1${phoneDigits()}` : null);

  function phoneState() {
    const d = phoneDigits();
    if (!d) return 'empty';
    if (d.length < 10) return 'incomplete';
    if (d.length > 10) return 'invalid';
    return /^[2-9]\d\d[2-9]\d{6}$/.test(d) ? 'valid' : 'invalid';
  }

  function prettyPhone() {
    const d = phoneDigits();
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : state.phone;
  }

  /* ---------------- lead / quote upsert ---------------- */

  /**
   * Upsert against the same quote identity. Runs on every phone change and
   * every configuration change once the phone is valid and the estimate is
   * complete — including valid → a different valid number. `phoneWasValid`
   * is deliberately NOT consulted here; it only gates the analytics event.
   */
  function scheduleLeadUpsert({ immediate = false } = {}) {
    clearTimeout(leadTimer);
    const run = async () => {
      if (phoneState() !== 'valid' || !estimateComplete()) return;
      try {
        const result = await upsertCalculatorLead({ quoteId, phone: phoneE164(), quote: serializeQuote() });
        if (result && result.quoteId) quoteId = result.quoteId;
        track('calculator_lead_saved'); // only after the backend persisted it
      } catch (err) {
        console.warn('[calculator]', err.message);
      }
    };
    if (immediate) return run();
    leadTimer = setTimeout(run, 700);
  }

  /* ---------------- SMS (never depends on the phone field) ---------------- */

  function smsBody() {
    const t = totals();
    const lines = ['Northline estimate', ''];
    state.tvs.forEach((tv, i) => {
      lines.push(`TV ${i + 1} — ${tv.family ? INVENTORY[tv.family].label : 'not chosen'}`);
      if (tv.family) {
        fullSummaryLines(tv).forEach((line) => lines.push(line));
        const p = tvPrice(tv);
        if (state.pricingStatus === 'ok') lines.push(p.quote ? 'Price: custom quote' : 'Price: ' + money(p.total));
      }
      lines.push('');
    });
    if (state.pricingStatus === 'ok') {
      if (t.percent) lines.push(`Multi-TV discount: ${Math.round(t.percent * 100)}%`);
      lines.push('Estimated total: ' + (t.quote ? 'custom quote' : money(t.total)));
    }
    lines.push('', 'Question: ');
    return lines.join('\n');
  }

  const smsHref = () => `sms:${SMS_RECIPIENT}?&body=${encodeURIComponent(smsBody())}`;

  /* ---------------- booking ---------------- */

  const ET_TIME_ZONE = 'America/New_York';

  function easternTodayParts() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
  }

  function bookingDays() {
    const out = [];
    const today = easternTodayParts();
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day, 12));
    for (let i = 0; out.length < 12; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      if (d.getUTCDay() === 0) continue; // Monday–Saturday in the business calendar
      out.push(d);
    }
    return out;
  }

  const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  async function initAvailability() {
    const days = bookingDays();
    try {
      state.availability = await loadBookingAvailability({ from: iso(days[0]), to: iso(days[days.length - 1]) });
    } catch (err) {
      state.availability = {}; // unknown — every day reads as unavailable
      console.warn('[calculator]', err.message);
    }
    render();
  }

  const windowsFor = (isoDate) => (state.availability && state.availability[isoDate]) || [];

  async function confirmBooking() {
    if (!state.day || !state.windowCode || state.bookStatus === 'sending') return;
    state.bookStatus = 'sending';
    render();
    try {
      await scheduleLeadUpsert({ immediate: true }); // final quote save before creation
      const result = await createInstallationBooking({
        quoteId,
        phone: phoneE164(),
        date: state.day,
        windowCode: state.windowCode,
        quote: serializeQuote()
      });
      if (!result || !result.bookingId) throw new Error('booking_not_confirmed');
      /* Confirmed by the backend. /paul carries the existing GTM primary
         booking conversion — no duplicate conversion event fires here. */
      window.location.assign(BOOKING_SUCCESS_URL);
    } catch (err) {
      console.warn('[calculator]', err.message);
      state.bookStatus = 'error'; // day + window preserved, no redirect
      render();
    }
  }

  /* ---------------- rendering ---------------- */

  const activeSectionIndex = (tv) => {
    const def = INVENTORY[tv.family];
    return tv.editing ? def.sections.findIndex((s) => s.id === tv.editing) : tv.step;
  };

  function sectionComplete(tv, section) {
    const required = REQUIRED_GROUPS[tv.family];
    const groupsOk = section.groups.every((code) => !required.includes(code) || !!tv.selection[code]);
    const liftOk = !(section.clientLift && liftShown(tv)) || liftValue(tv) !== null;
    return groupsOk && liftOk;
  }

  function renderOption({ label, price, selected, attrs }) {
    return `<button type="button" class="nl-option" aria-pressed="${selected}" ${attrs}>
      <span class="nl-option__label">${selected ? '<span class="nl-option__tick" aria-hidden="true">&#10003;</span>' : ''}<span>${esc(label)}</span></span>
      ${price ? `<span class="nl-option__price">${esc(price)}</span>` : ''}
    </button>`;
  }

  function renderGroup(tv, groupCode) {
    const group = INVENTORY[tv.family].groups[groupCode];
    const picked = tv.selection[groupCode];
    const options = group.items
      .map((item) => {
        const selected = group.multi ? (picked || []).includes(item.itemCode) : picked === item.itemCode;
        return renderOption({
          label: item.label,
          price: priceLabel(itemPrice(tv.family, groupCode, item.itemCode)),
          selected,
          attrs: `data-nl-pick data-group="${esc(groupCode)}" data-item="${esc(item.itemCode)}"`
        });
      })
      .join('');
    return `<fieldset class="nl-group">
      <legend><span class="nl-group__label">${esc(group.label)}</span>${group.hint ? `<span class="nl-group__hint">${esc(group.hint)}</span>` : ''}</legend>
      <div class="nl-options">${options}</div>
    </fieldset>`;
  }

  function renderClientLift(tv) {
    if (!liftShown(tv)) return '';
    const current = liftValue(tv);
    const options = CLIENT_LIFT.options
      .map((opt) =>
        renderOption({
          label: opt.label,
          price: priceLabel(liftAdjustment(opt.value)),
          selected: current === opt.value,
          attrs: `data-nl-lift="${opt.value}"`
        })
      )
      .join('');
    return `<fieldset class="nl-group">
      <legend><span class="nl-group__label">${esc(CLIENT_LIFT.label)}</span><span class="nl-group__hint">${esc(CLIENT_LIFT.hint)}</span></legend>
      <div class="nl-options">${options}</div>
    </fieldset>`;
  }

  function renderConfig(tv) {
    if (!tv.family) {
      const cards = FAMILIES.map((f) => {
        const base =
          state.pricingStatus === 'ok' && state.pricing.base && typeof state.pricing.base[f.family] === 'number'
            ? 'from ' + money(state.pricing.base[f.family])
            : '';
        return `<button type="button" class="nl-type" data-nl-family="${esc(f.family)}">
          <span class="nl-type__top"><span class="nl-type__name">${esc(f.label)}</span>${base ? `<span class="nl-type__meta">${esc(base)}</span>` : ''}</span>
          <span class="nl-type__note">${esc(f.note)}</span>
        </button>`;
      }).join('');
      return `<p class="nl-eyebrow">TV ${state.active + 1}</p>
        <h2 class="nl-h2">What are we mounting?</h2>
        <p class="nl-lede">Each television is configured on its own. You can mix Standard TVs and Samsung Frames in one visit.</p>
        <div class="nl-types">${cards}</div>`;
    }

    const def = INVENTORY[tv.family];
    const activeIndex = activeSectionIndex(tv);
    const sections = def.sections
      .map((section, i) => {
        const isActive = i === activeIndex;
        const isDone = !isActive && i < tv.step;
        let inner;
        if (isActive) {
          inner = `<div class="nl-groups">${section.groups.map((code) => renderGroup(tv, code)).join('')}${section.clientLift ? renderClientLift(tv) : ''}</div>`;
        } else if (isDone) {
          const summary = summaryLines(tv, section.groups, !!section.clientLift).join(' · ');
          inner = `<p class="nl-section__summary">${esc(summary || 'Nothing added')}</p>`;
        } else {
          inner = `<p class="nl-section__hint">${esc(section.hint)}</p>`;
        }
        return `<section class="nl-section${isActive ? ' nl-section--active' : ''}" aria-label="${esc(section.title)}">
          <div class="nl-row-between">
            <p class="nl-section__title">${esc(section.title)}</p>
            ${isDone ? `<button type="button" class="nl-link" data-nl-edit-section="${esc(section.id)}">Edit</button>` : ''}
          </div>
          ${inner}
        </section>`;
      })
      .join('');

    return `<div class="nl-row-between">
        <p class="nl-eyebrow">TV ${state.active + 1} · ${esc(def.label)}</p>
        <p class="nl-step">Step ${Math.min(activeIndex + 1, def.sections.length)} of ${def.sections.length}</p>
      </div>
      <div class="nl-sections">${sections}</div>`;
  }

  function renderReview() {
    const t = totals();
    const tvs = state.tvs
      .map((tv, i) => {
        const p = tvPrice(tv);
        const price = !tv.family || state.pricingStatus !== 'ok' ? '—' : p.quote ? 'Custom quote' : money(p.total);
        return `<article class="nl-tv">
          <div class="nl-row-between">
            <p class="nl-eyebrow">TV ${i + 1} · ${esc(tv.family ? INVENTORY[tv.family].label : 'Choosing')}</p>
            <p class="nl-tv__price">${esc(price)}</p>
          </div>
          <p class="nl-tv__summary">${esc(fullSummary(tv))}</p>
          <div class="nl-tv__actions">
            <button type="button" class="nl-link" data-nl-edit-tv="${i}">Edit</button>
            ${state.tvs.length > 1 ? `<button type="button" class="nl-link nl-link--muted" data-nl-remove-tv="${i}">Remove</button>` : ''}
          </div>
        </article>`;
      })
      .join('');

    const ph = phoneState();
    const help = {
      empty: 'US phone number. Used to confirm the appointment.',
      incomplete: 'Keep going — 10 digits.',
      invalid: "That doesn't look like a US phone number. Check the area code.",
      valid: prettyPhone()
    }[ph];

    const totalsBlock =
      state.pricingStatus === 'ok'
        ? `<dl class="nl-totals">
            <div class="nl-totals__row"><dt>Subtotal</dt><dd>${esc(t.quote ? 'Custom quote' : money(t.subtotal))}</dd></div>
            ${t.percent && !t.quote ? `<div class="nl-totals__row nl-totals__row--discount"><dt>Multi-TV discount</dt><dd>−${Math.round(t.percent * 100)}%</dd></div>` : ''}
            <div class="nl-totals__row nl-totals__row--total"><dt>Estimated total</dt><dd>${esc(t.quote ? 'Custom quote' : money(t.total))}</dd></div>
          </dl>`
        : '';

    return `<p class="nl-eyebrow">Estimate</p>
      <h2 class="nl-h2">${state.tvs.length > 1 ? state.tvs.length + ' installations, one visit' : 'One installation'}</h2>
      <div>${tvs}</div>
      <div class="nl-section">
        ${
          state.tvs.length < MAX_TVS
            ? '<button type="button" class="nl-add" data-nl-add-tv><span>Add another TV</span><span aria-hidden="true">+</span></button>'
            : '<p class="nl-limit">Six televisions is the maximum in this calculator. Remove one to swap it, or text us about a larger job.</p>'
        }
      </div>
      <div class="nl-section">${totalsBlock}</div>
      <div class="nl-book">
        <p class="nl-eyebrow">Book installation</p>
        <label class="nl-label" for="nl-phone">US phone number</label>
        <input class="nl-input" id="nl-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel"
          placeholder="(770) 555-1234" aria-describedby="nl-phone-help" data-state="${ph}" value="${esc(state.phone)}" data-nl-phone />
        <p class="nl-help" id="nl-phone-help" data-state="${ph}">${esc(help)}</p>
        <div style="margin-top:18px;max-width:420px">
          <button type="button" class="nl-primary" data-nl-primary="book" ${ph === 'valid' ? '' : 'disabled aria-disabled="true"'}>
            <span>Book installation</span><span aria-hidden="true">&rarr;</span>
          </button>
        </div>
        <div class="nl-sms-block">
          <p class="nl-eyebrow">Want to ask first</p>
          <p class="nl-lede">Questions about the wall, a fireplace, wire concealment or the price itself — no number needed. Your estimate travels with the message.</p>
          <a class="nl-secondary" href="${esc(smsHref())}" data-nl-sms><span>Text us about this estimate</span><span aria-hidden="true">&rarr;</span></a>
          <p class="nl-mono">Opens Messages · (470) 470-9331</p>
        </div>
      </div>`;
  }

  function renderBooking() {
    const loading = state.availability === null;
    const days = bookingDays()
      .map((d, i) => {
        const key = iso(d);
        const free = windowsFor(key).length > 0;
        const selected = state.day === key;
        return `<button type="button" class="nl-day" aria-pressed="${selected}" ${free ? '' : 'disabled'} data-nl-day="${key}">
          <span class="nl-day__dow">${DOW[d.getUTCDay()]}</span>
          <span class="nl-day__date">${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}</span>
          <span class="nl-day__note">${loading ? '…' : free ? (i === 0 ? 'today' : 'open') : 'full'}</span>
        </button>`;
      })
      .join('');

    let slots = '';
    if (state.day) {
      const open = windowsFor(state.day);
      const buttons = ARRIVAL_WINDOWS.map((w) => {
        const free = open.includes(w.windowCode);
        const selected = state.windowCode === w.windowCode;
        return `<button type="button" class="nl-slot" aria-pressed="${selected}" ${free ? '' : 'disabled'} data-nl-window="${w.windowCode}">
          <span class="nl-slot__label">${esc(w.label)}</span>
          <span class="nl-slot__state">${selected ? 'Selected' : free ? 'Available' : 'Booked'}</span>
        </button>`;
      }).join('');
      const d = new Date(state.day + 'T12:00:00Z');
      slots = `<div class="nl-section">
          <p class="nl-eyebrow">Arrival window · ${DOW[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}</p>
          <div class="nl-slots" role="group" aria-label="Arrival window">${buttons}</div>
        </div>`;
    }

    const error =
      state.bookStatus === 'error'
        ? `<div class="nl-error" role="alert">
            <p class="nl-error__title">We couldn't create that booking</p>
            <p class="nl-error__body">Your day and arrival window are still selected. Try again, or text us and we'll book it for you.</p>
            <div class="nl-error__actions">
              <button type="button" class="nl-retry" data-nl-primary="confirm">Retry</button>
              <a class="nl-secondary" style="margin:0;width:auto;max-width:none" href="${esc(smsHref())}" data-nl-sms>Text us instead</a>
            </div>
          </div>`
        : '';

    return `<p class="nl-eyebrow">Booking</p>
      <h2 class="nl-h2">Pick a day</h2>
      <p class="nl-lede">Monday to Saturday, Eastern time. Three arrival windows a day.</p>
      <div class="nl-days" role="group" aria-label="Installation date">${days}</div>
      ${slots}
      ${error}`;
  }

  function primary() {
    const tv = state.tvs[state.active];
    if (state.stage === 'config') {
      if (!tv.family) return null;
      const def = INVENTORY[tv.family];
      const index = activeSectionIndex(tv);
      const section = def.sections[index];
      if (!section) return { label: 'Review estimate', short: 'Review', action: 'continue', enabled: true, note: '' };
      const ok = sectionComplete(tv, section);
      return {
        label: 'Continue',
        short: 'Continue',
        action: 'continue',
        enabled: ok,
        note: ok ? '' : 'Choose an option in every required field above.'
      };
    }
    if (state.stage === 'review') {
      const valid = phoneState() === 'valid';
      return {
        label: valid ? 'Book installation' : 'Enter a phone number to book',
        short: 'Book',
        action: 'book',
        enabled: valid,
        note: valid ? 'Next: pick a day and arrival window.' : 'Or text us — no number needed.'
      };
    }
    const sending = state.bookStatus === 'sending';
    return {
      label: sending ? 'Sending request…' : state.bookStatus === 'error' ? 'Try again' : 'Confirm booking',
      short: sending ? 'Sending…' : 'Confirm',
      action: 'confirm',
      enabled: !sending && !!state.day && !!state.windowCode,
      note: sending ? 'Creating the booking.' : state.day && state.windowCode ? '' : 'Pick a day and an arrival window.'
    };
  }

  function renderRail() {
    const t = totals();
    const configured = state.tvs.some((tv) => tv.family);
    const list = state.tvs
      .map((tv, i) => {
        const p = tvPrice(tv);
        const priced = !!tv.family && state.pricingStatus === 'ok' && p.complete && !p.quote;
        const price = !tv.family || state.pricingStatus !== 'ok' ? '—' : p.quote ? 'Custom quote' : (p.complete ? '' : 'from ') + money(p.total);
        const showActions = !(i === state.active && state.stage === 'config');
        return `<div class="nl-rail__tv">
          <div class="nl-rail__tv-top">
            <p class="nl-rail__tv-name">TV ${i + 1} · ${esc(tv.family ? INVENTORY[tv.family].label : 'Choosing')}</p>
            <p class="nl-rail__tv-price" data-priced="${priced}">${esc(price)}</p>
          </div>
          <p class="nl-rail__tv-summary">${esc(tv.family ? fullSummary(tv) : 'Pick a TV type')}</p>
          ${
            showActions
              ? `<div class="nl-rail__tv-actions">
                  <button type="button" class="nl-link" data-nl-edit-tv="${i}">Edit</button>
                  ${state.tvs.length > 1 ? `<button type="button" class="nl-link nl-link--muted" data-nl-remove-tv="${i}">Remove</button>` : ''}
                </div>`
              : ''
          }
        </div>`;
      })
      .join('');

    let foot;
    if (state.pricingStatus === 'loading') {
      foot = `<div aria-live="polite" class="nl-rail__idle">
          <div class="nl-skeleton nl-skeleton--sm"></div>
          <div class="nl-skeleton"></div>
          <p class="nl-mono">Loading published pricing…</p>
        </div>`;
    } else if (state.pricingStatus === 'unavailable') {
      foot = `<div aria-live="polite" class="nl-rail__idle">
          <p class="nl-rail__idle-title">Pricing is briefly unavailable</p>
          <p class="nl-rail__note">Text us and we'll confirm the exact price for this configuration.</p>
        </div>`;
    } else if (!configured) {
      foot = `<div aria-live="polite" class="nl-rail__idle">
          <span class="nl-rail__total-label">Estimated total</span>
          <p class="nl-rail__idle-title">Choose a TV to price it</p>
          <p class="nl-rail__note">The total appears here and updates with every selection.</p>
        </div>`;
    } else {
      foot = `<div aria-live="polite">
          <div class="nl-rail__mini">
            <div class="nl-rail__mini-row"><span>Subtotal</span><span>${esc(t.quote ? 'Custom quote' : money(t.subtotal))}</span></div>
            ${t.percent && !t.quote ? `<div class="nl-rail__mini-row nl-rail__mini-row--discount"><span>Multi-TV discount</span><span>−${Math.round(t.percent * 100)}%</span></div>` : ''}
          </div>
          <span class="nl-rail__total-label">Estimated total</span>
          <p class="nl-rail__total" data-quote="${t.quote}">${esc(t.quote ? 'Custom quote' : money(t.total))}</p>
          <p class="nl-rail__note">${esc(
            t.quote
              ? "One selection needs an on-site look. Text us and we'll confirm the exact price."
              : state.tvs.length > 1
                ? `All ${state.tvs.length} installations, one visit.`
                : 'Price for this configuration.'
          )}</p>
        </div>`;
    }

    const p = primary();
    const cta = p
      ? `<div style="margin-top:18px">
          <button type="button" class="nl-primary" data-nl-primary="${p.action}" ${p.enabled ? '' : 'disabled aria-disabled="true"'}>
            <span>${esc(p.label)}</span><span aria-hidden="true">&rarr;</span>
          </button>
          ${p.note ? `<p class="nl-primary-note">${esc(p.note)}</p>` : ''}
        </div>`
      : '';

    return `<div class="nl-rail__list">
        <p class="nl-eyebrow">Order</p>
        ${list}
        ${
          state.tvs.length < MAX_TVS && state.stage !== 'booking'
            ? '<button type="button" class="nl-add nl-rail__add" data-nl-add-tv><span>Add another TV</span><span aria-hidden="true">+</span></button>'
            : state.tvs.length >= MAX_TVS
              ? '<p class="nl-rail__note" style="margin-top:14px">Six TVs — maximum in this calculator.</p>'
              : ''
        }
      </div>
      <div class="nl-rail__foot">${foot}${cta}</div>`;
  }

  function renderBar() {
    const t = totals();
    const configured = state.tvs.some((tv) => tv.family);
    let value = 'Choose a TV to price it';
    let compact = true;
    if (state.pricingStatus === 'loading') value = 'Loading…';
    else if (state.pricingStatus === 'unavailable') value = 'Unavailable';
    else if (configured) {
      value = t.quote ? 'Custom quote' : money(t.total);
      compact = t.quote;
    }
    const p = primary();
    return `<div style="min-width:0">
        <p class="nl-bar__label">Estimated total</p>
        <p class="nl-bar__value" data-compact="${compact}">${esc(value)}</p>
      </div>
      ${
        p
          ? `<button type="button" class="nl-primary" data-nl-primary="${p.action}" ${p.enabled ? '' : 'disabled aria-disabled="true"'}>
              <span>${esc(p.short)}</span><span aria-hidden="true">&rarr;</span>
            </button>`
          : ''
      }`;
  }

  function render() {
    const tv = state.tvs[state.active];
    stageTitle.textContent =
      state.stage === 'booking' ? 'Choose a time' : state.stage === 'review' ? 'Your estimate' : 'Price your installation';
    backBtn.classList.toggle('nl-hidden', state.stage === 'config' && !tv.family && state.tvs.length === 1);

    const focusedPhone = document.activeElement && document.activeElement.id === 'nl-phone';
    const caret = focusedPhone ? document.activeElement.selectionStart : null;

    main.innerHTML = state.stage === 'booking' ? renderBooking() : state.stage === 'review' ? renderReview() : renderConfig(tv);
    rail.innerHTML = renderRail();
    bar.innerHTML = renderBar();

    if (focusedPhone) {
      const input = main.querySelector('#nl-phone');
      if (input) {
        input.focus();
        try { input.setSelectionRange(caret, caret); } catch (e) {}
      }
    }
  }

  /* Any configuration change may change the stored quote. */
  function changed() {
    render();
    scheduleLeadUpsert();
  }

  /* ---------------- actions ---------------- */

  function advance() {
    const tv = state.tvs[state.active];
    const def = INVENTORY[tv.family];
    if (tv.editing) { tv.editing = null; return render(); }
    if (tv.step < def.sections.length) { tv.step += 1; return render(); }
    state.stage = 'review';
    render();
  }

  function back() {
    if (state.stage === 'booking') { state.stage = 'review'; state.bookStatus = 'idle'; return render(); }
    if (state.stage === 'review') { state.stage = 'config'; return render(); }
    const tv = state.tvs[state.active];
    if (tv.editing) { tv.editing = null; return render(); }
    if (!tv.family) {
      if (state.tvs.length > 1) return removeTv(state.active);
      return;
    }
    if (tv.step > 0) { tv.step -= 1; return render(); }
    state.tvs[state.active] = newTv();
    changed();
  }

  function addTv() {
    if (state.tvs.length >= MAX_TVS) return;
    state.tvs.push(newTv());
    state.active = state.tvs.length - 1;
    state.stage = 'config';
    track('calculator_add_tv');
    changed();
  }

  function removeTv(index) {
    state.tvs.splice(index, 1);
    if (!state.tvs.length) state.tvs.push(newTv());
    state.active = Math.min(state.active, state.tvs.length - 1);
    track('calculator_remove_tv');
    changed();
  }

  function editTv(index) {
    const tv = state.tvs[index];
    tv.step = tv.family ? INVENTORY[tv.family].sections.length : 0;
    tv.editing = null;
    state.active = index;
    state.stage = 'config';
    render();
  }

  function pick(groupCode, itemCode) {
    const tv = state.tvs[state.active];
    const group = INVENTORY[tv.family].groups[groupCode];
    if (group.multi) {
      const current = tv.selection[groupCode] || [];
      tv.selection[groupCode] = current.includes(itemCode) ? current.filter((c) => c !== itemCode) : current.concat(itemCode);
    } else {
      tv.selection[groupCode] = tv.selection[groupCode] === itemCode ? undefined : itemCode;
    }
    changed();
  }

  /* ---------------- events ---------------- */

  root.addEventListener('click', (event) => {
    const el = event.target.closest(
      '[data-nl-family],[data-nl-pick],[data-nl-lift],[data-nl-edit-section],[data-nl-edit-tv],[data-nl-remove-tv],[data-nl-add-tv],[data-nl-primary],[data-nl-sms],[data-nl-back],[data-nl-close]'
    );
    if (!el) return;

    if (el.hasAttribute('data-nl-close')) return close();
    if (el.hasAttribute('data-nl-back')) return back();
    if (el.hasAttribute('data-nl-sms')) {
      event.preventDefault();
      track('calculator_sms_click');
      const href = el.getAttribute('href');
      const continueToMessages = () => { if (href) window.location.href = href; };
      if (phoneState() === 'valid' && estimateComplete()) {
        Promise.resolve(scheduleLeadUpsert({ immediate: true })).finally(continueToMessages);
      } else {
        continueToMessages();
      }
      return;
    }

    if (el.dataset.nlFamily) {
      const tv = state.tvs[state.active];
      tv.family = el.dataset.nlFamily;
      tv.selection = {};
      tv.clientLift = null;
      tv.step = 0;
      tv.editing = null;
      track(tv.family === 'samsung_frame' ? 'calculator_samsung_frame' : 'calculator_standard_tv');
      return changed();
    }
    if (el.hasAttribute('data-nl-pick')) return pick(el.dataset.group, el.dataset.item);
    if (el.hasAttribute('data-nl-lift')) {
      const tv = state.tvs[state.active];
      const value = el.dataset.nlLift === 'true';
      tv.clientLift = tv.clientLift === value ? null : value;
      return changed();
    }
    if (el.dataset.nlEditSection) { state.tvs[state.active].editing = el.dataset.nlEditSection; return render(); }
    if (el.dataset.nlEditTv) return editTv(Number(el.dataset.nlEditTv));
    if (el.dataset.nlRemoveTv) return removeTv(Number(el.dataset.nlRemoveTv));
    if (el.hasAttribute('data-nl-add-tv')) return addTv();

    if (el.dataset.nlPrimary === 'book') {
      track('calculator_book_click'); // interaction only — never a conversion
      scheduleLeadUpsert({ immediate: true });
      state.stage = 'booking';
      state.bookStatus = 'idle';
      render();
      if (state.availability === null) initAvailability();
      return;
    }
    if (el.dataset.nlPrimary === 'continue') return advance();
    if (el.dataset.nlPrimary === 'confirm') return confirmBooking();
  });

  root.addEventListener('click', (event) => {
    const day = event.target.closest('[data-nl-day]');
    if (day) { state.day = day.dataset.nlDay; state.windowCode = null; state.bookStatus = 'idle'; return render(); }
    const win = event.target.closest('[data-nl-window]');
    if (win) { state.windowCode = win.dataset.nlWindow; state.bookStatus = 'idle'; return render(); }
  });

  root.addEventListener('input', (event) => {
    if (!event.target.matches('[data-nl-phone]')) return;
    state.phone = event.target.value;
    const nowValid = phoneState() === 'valid';
    if (nowValid && !phoneWasValid) track('calculator_phone_valid'); // transition only
    phoneWasValid = nowValid;
    render();
    if (nowValid) scheduleLeadUpsert(); // every change, including valid → valid
  });

  /* ---------------- modal ---------------- */

  function open(trigger) {
    opener = trigger || document.activeElement;
    document.body.classList.add('nl-locked');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    track('calculator_open');
    render();
    if (state.pricingStatus === 'loading') initPricing();
    const first = dialog.querySelector('button:not([disabled]), a[href], input');
    if (first) first.focus();
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('nl-locked');
    track('calculator_close');
    if (opener && opener.focus) opener.focus(); // partial state is kept for reopen
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
    const nodes = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input, [tabindex="0"]')).filter(
      (n) => n.offsetParent !== null
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  document.querySelectorAll('[data-nl-open]').forEach((trigger) => {
    trigger.addEventListener('click', () => open(trigger));
  });

  render();
  return { open, close };
}
