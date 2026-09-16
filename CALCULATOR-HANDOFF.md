# Northline calculator — integration contract & status

## Files

| Path | Role |
| --- | --- |
| `astro/src/components/Calculator.astro` | modal shell (semantic `<dialog>`), imports CSS + script |
| `astro/src/styles/calculator.css` | approved Northline visual direction |
| `astro/src/data/calculator-inventory.js` | the single identifier vocabulary: family + groupCode + itemCode, approved labels |
| `astro/src/scripts/calculator.js` | state, rendering, validation, lead upsert, booking flow, modal a11y |
| `astro/src/scripts/calculator-api.js` | **integration boundary** — 4 server operations, all TODO |

Prototype (design reference only, never shipped): `Northline Calculator.dc.html` — contains
`PRICING_FIXTURE`, `slotFree()`, mock lead persistence and `bookWillFail`. None of these exist
in the Astro implementation.

## Usage

```astro
---
import Calculator from '../components/Calculator.astro';
---
<button class="nl-cta" data-nl-open><span>Get exact price</span><span aria-hidden="true">&rarr;</span></button>
<Calculator />
```

Any element with `data-nl-open` opens the calculator and gets focus back on close.

## Unresolved server-side operations

All four live in `calculator-api.js`. Endpoint paths are `null` until the real Northline routes
are defined; each function throws `PRODUCTION INTEGRATION REQUIRED` and the UI falls back to its
honest unavailable / error states. No fake success anywhere.

**1. `loadPublishedPricing()`** — published D1 snapshot only, never draft.

```json
{
  "version": "2026-09-15.3",
  "multiTvPercent": 0.07,
  "base": { "standard_tv": 0, "samsung_frame": 0 },
  "items": { "standard_tv.mount.customer_mount": 0, "standard_tv.wall.stone_tile": "quote" },
  "clientLiftRule": { "true": 0, "false": 0 }
}
```

`items` keys are `family.groupCode.itemCode`. Values: number, `0` (included) or `"quote"`.
`clientLiftRule` is the pricing rule for the context flag — it is not a pricing item.

**2. `upsertCalculatorLead({ quoteId, phone, quote })` → `{ quoteId }`** — one quote identity.
Called on every phone change and every configuration change while the phone is valid and the
estimate complete, and immediately before booking. `calculator_lead_saved` fires only on success.

**3. `loadBookingAvailability({ from, to })` → `{ "YYYY-MM-DD": ["am","mid","pm"] }`** — derived
from Cal.com server-side. Windows are exactly `am` 8–11 AM, `mid` 11 AM–2 PM, `pm` 2–5 PM,
Monday–Saturday, America/New_York. Cal.com credentials stay server-side.

**4. `createInstallationBooking({ quoteId, phone, date, windowCode, quote })` → `{ bookingId }`** —
creates the booking through Cal.com. Only a resolved response carrying `bookingId` triggers
`window.location.assign('/paul')`. Any failure keeps the customer in the modal.

## Invariants encoded in the code

- One identifier vocabulary. No mapping table, no second ID system.
- `clientLift` is a boolean pricing context, rendered only for `standard_tv` with `tv_size` of
  `66_77` or `78_90`; read exclusively through `liftValue()`, so a stale value cannot reach
  pricing, validation, summaries, the SMS body or the serialized quote.
- `cable` and `addons` may be empty; there is no "None" item.
- Max 6 TVs; mixed families; multi-TV percentage comes from published pricing — no tiers, no packages.
- `calculator_phone_valid` fires on the not-valid → valid transition only; `phoneWasValid` gates
  nothing else.
- `calculator_book_click` is interaction analytics. `/paul` is the only success destination and the
  only primary conversion.
- No PII in `dataLayer`, no secrets in client code.
