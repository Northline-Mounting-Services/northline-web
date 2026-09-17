# Northline TV Installation Calculator

## Status

Customer-facing TV installation calculator for Northline Mounting Services.

The calculator is a modal overlay over the current page.
It is NOT a standalone `/calculator` page.
Opening it must not change the current URL.

Verified triggers:

- Footer -> Calculate Price
- HomeExplore -> TV mounting pricing

Calculator is mounted once through:

`src/components/Footer.astro`

Production booking creation is implemented and verified end-to-end:

Calculator
-> northline-web
-> canonical server-side repricing
-> northline-admin
-> Google Calendar
-> confirmed booking
-> `/paul`

Current remaining calendar migration work:
availability is still derived from the legacy Cal.com snapshot. Booking creation already uses Google Calendar.

## Repositories

### WEB

- repo: `northline-web`
- local: `/Users/pavelshymko/Downloads/Astro/Claude-design/northline-web`
- Worker: `northline-web`
- production: `https://northline-web.wispy-glitter-409c.workers.dev`

### ADMIN

- repo: `northline-admin`
- local: `/Users/pavelshymko/Downloads/Astro/Claude-design/northline-admin`
- Worker: `northline-admin`
- production: `https://northline-admin.wispy-glitter-409c.workers.dev`
- D1: `northline-core`
- shared KV: `HOME_STATE`

## Current architecture

### Pricing

Pricing Admin
-> D1 Published pricing
-> northline-web Worker
-> `GET /api/calculator-pricing`
-> Calculator

Production prices must not be trusted from the browser.

### Leads

Calculator
-> `POST /api/calculator-lead`
-> D1 `calculator_leads`

### Availability - CURRENT LEGACY PATH

Cal.com
-> northline-admin
-> `HOME_STATE` KV
-> northline-web
-> `GET /api/calculator-availability`
-> Calculator

This availability path is the NEXT calendar migration task.

Do not remove the current Cal.com availability path until Google Calendar availability is implemented and verified.

### Booking creation - CURRENT PRODUCTION PATH

Calculator
-> `POST /api/calculator-booking`
-> northline-web canonical validation/repricing
-> Cloudflare Service Binding `NORTHLINE_ADMIN`
-> `POST /internal/calculator-booking`
-> northline-admin booking engine
-> Google Calendar
-> D1 confirmation
-> `{ bookingId }`
-> `/paul`

Only a confirmed response carrying a real `bookingId` may redirect to `/paul`.

## Frontend files

### `src/components/Calculator.astro`

- modal shell
- semantic dialog
- imports calculator CSS and JavaScript

### `src/scripts/calculator.js`

- state and rendering
- Standard TV flow
- Samsung Frame flow
- multiple TVs
- pricing calculations
- phone validation
- lead persistence
- availability UI
- booking flow
- SMS
- accessibility
- redirects to `/paul` only after confirmed booking

### `src/scripts/calculator-api.js`

Frontend integration boundary.

Current endpoints:

- published pricing: `/api/calculator-pricing`
- lead persistence: `/api/calculator-lead`
- availability: `/api/calculator-availability`
- booking creation: `/api/calculator-booking`

Availability is still backed by the Cal.com snapshot.
Booking creation is backed by Google Calendar.

### `src/data/calculator-inventory.js`

- UI structure
- labels
- group/item identifiers
- dependencies and visibility

### `src/styles/calculator.css`

- calculator design
- responsive behavior

### `src/components/Footer.astro`

- imports Calculator
- mounts Calculator once
- Calculate Price uses `data-nl-open`

### `src/components/home/HomeExplore.astro`

- TV mounting pricing uses `data-nl-open`

There must be no standalone `/calculator` route.

## Success page

Production success route:

`/paul`

Files:

- `src/pages/paul.astro`
- `src/styles/paul.css`

Behavior:

- shown only after the booking API returns a real `bookingId`
- confirms appointment success
- shows Paul as technician
- Save to Contacts downloads a `.vcf`
- Call uses `tel:+14704709331,5`
- SMS uses `sms:+14704709331`
- page is `noindex,nofollow`

Current production route:

`https://northline-web.wispy-glitter-409c.workers.dev/paul`

After the production custom domain is attached, the relative `/paul` redirect requires no code change.

## Pricing

Pricing source:

latest Published pricing version in D1.

Production prices must not be hardcoded in browser code.

Supported:

- Standard TV
- Samsung Frame
- mixed Standard + Frame
- maximum 6 TVs

Excluded:

- packages
- package discounts

TV count is global across Standard and Samsung Frame.

Only one multi-TV discount applies to subtotal.

Current customer-facing prices use whole dollars.

D1 stores money in cents.

Do not introduce visible cents unless this business rule is intentionally changed.

## Canonical order types

Use these canonical family/order identifiers in booking code:

- `standard_tv`
- `samsung_frame`
- `mixed`

Do not reintroduce stale `standard` / `frame` booking enums.

## Standard client-lift rule

Current behavior:

- up to 50: hidden
- 51-65: hidden
- 66-77: available
- 78-90: available
- over 90: custom quote

Current Published adjustment:

`-$40`

Changing size must clear stale lift state when the new size is not eligible.

## Leads

Endpoint:

`POST /api/calculator-lead`

Lead saves when:

1. configuration is complete
2. phone number is valid

Customer does not need to click Book first.

Server creates `quote_id` on first successful save.
Frontend reuses that `quote_id` for later updates.
Configuration edits after a valid save update the same quote.

Current debounce:

`700 ms`

Book and SMS actions perform a final lead save.

## Phone

US/NANP plausibility validation only.

No OTP.

Stored normalized format:

`+1XXXXXXXXXX`

Never send phone numbers or other PII to GTM or GA4.

## `calculator_leads`

Important fields include:

- `quote_id`
- `created_at`
- `updated_at`
- `phone_e164`
- `source_page`
- `status`
- `tv_count`
- `order_type`
- `configuration_json`
- `subtotal_cents`
- `multi_tv_percent`
- `discount_cents`
- `total_cents`
- `pricing_version`
- `booking_started_at`
- `booking_completed_at`
- `sms_opened_at`

Statuses include:

- `calculated`
- `booking_started`
- `booked`

After successful booking, canonical quote fields are synchronized back to the lead from the confirmed booking record.

`booking_completed_at` is preserved on idempotent retries and is not overwritten after it is first set.

## Server-side repricing rule

The browser is NOT authoritative for booking totals.

`POST /api/calculator-booking` must:

1. validate request structure
2. verify quote ownership using `quote_id` + phone
3. load current Published pricing
4. canonicalize the submitted configuration
5. reprice server-side
6. forward only canonical booking data to Admin

Controlled production testing confirmed that forged browser totals are ignored and replaced with canonical Published pricing.

Custom quote rule:

`quoteRequired = true` MUST NOT create a booking.

Admin returns `quote_required`.

## Web -> Admin transport

northline-web uses Cloudflare Service Binding:

`NORTHLINE_ADMIN`

Shared secret:

`INTERNAL_API_TOKEN`

Web sends:

`POST /internal/calculator-booking`

with:

`x-northline-internal-token`

Secrets must remain server-side.

## Booking engine

Admin file:

`src/lib/booking/calculator-booking-engine.ts`

Current technician:

`paul`

Current technician calendar:

`info@atltvmount.com`

Timezone:

`America/New_York`

Customer arrival windows are exactly:

- `am` = 8:00 AM - 11:00 AM
- `mid` = 11:00 AM - 2:00 PM
- `pm` = 2:00 PM - 5:00 PM

Service days:

Monday-Saturday.

Sunday is excluded.

Current service-date horizon:

12 upcoming Monday-Saturday dates.

A mixed/multi-TV order occupies ONE arrival window.

## D1 booking tables

Admin migrations created:

- `calculator_technicians`
- `calculator_bookings`

`calculator_bookings` is calculator-specific.

Important properties:

- `booking_id` is the booking identity
- `quote_id` is required and references `calculator_leads`
- `technician_id`
- `service_date`
- `window_code`
- `timezone`
- `status`
- `hold_expires_at`
- `google_calendar_id`
- `google_event_id`
- customer fields
- canonical quote/configuration fields
- pricing version
- confirmation/failure timestamps

Active slot uniqueness is enforced in D1 for:

`technician_id + service_date + window_code`

Active quote uniqueness is also enforced.

Do not force package-offer bookings into this table without an explicit source/schema redesign because `quote_id` is required and the table is calculator-specific.

## Reservation and idempotency

Booking reservation store:

`src/lib/booking/calculator-booking-store.ts`

Behavior:

- creates a short pending hold before Google event creation
- current hold duration: 5 minutes
- confirmed booking is idempotent by quote
- deterministic Google event identity is used for reconciliation
- repeated successful requests return the same booking
- retries do not create duplicate D1 rows
- retries do not create duplicate Google events
- confirmed lead state is healed/synchronized on retry
- expired stale pending holds can be failed and released

Production testing verified:

- one D1 booking after repeated requests
- same `bookingId`
- same `google_event_id`
- canonical pricing preserved
- `booking_completed_at` remains stable after the timestamp fix

All controlled test booking rows and test leads were removed after verification.

## Google Calendar integration

Admin calendar files include:

- `src/lib/calendar/google-auth.ts`
- `src/lib/calendar/google-freebusy.ts`
- `src/lib/calendar/google-events.ts`

Production secret:

`GOOGLE_CALENDAR_REFRESH_TOKEN`

Never place refresh/access tokens or Google client secrets in Git or documentation.

Authorized scopes used for the booking integration:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`

Health route:

`POST /api/google-calendar-health`

Google Calendar write access has been verified in production by a real controlled booking and later by the browser calculator flow.

Google event creation:

- event is private
- event blocks time (`transparency: opaque`)
- no guest update emails are sent
- event includes booking/quote metadata in private extended properties
- deterministic event ID is derived from `booking_id`
- 409/event-create uncertainty is reconciled by lookup before deciding failure

## Booking UI

Customer windows are exactly:

- 8-11 AM
- 11 AM-2 PM
- 2-5 PM

Approved copy:

> Please select a start time below. This begins your 3-hour arrival window
> (e.g., selecting 08:00 means we arrive between 8:00 AM and 11:00 AM).

Booking failure must:

- remain in calculator
- preserve selected date
- preserve selected window
- allow retry
- keep SMS fallback available

`calculator_book_click` is intent only, not booking success.

## Known booking error-transport follow-up

Admin distinguishes expected booking errors such as:

- `slot_unavailable`
- `booking_in_progress`
- `quote_required`
- `invalid_service_date`
- `calendar_not_configured`

Before final UI error polishing, inspect the current northline-web booking route and preserve/map expected Admin statuses intentionally.

Do not assume every Admin non-2xx should become a generic 502.

## Availability - current state

Availability still uses the legacy Cal.com path.

Current legacy configuration:

- `CAL_EVENT_TYPE_ID = 6614446`
- `CAL_TIMEZONE = America/New_York`
- `CAL_API_KEY` is a Wrangler production secret

Never put the key value in Git, browser code, or documentation.

Admin cron:

`*/5 * * * *`

Current cron synchronizes availability into `HOME_STATE`.

Calculator snapshot contains 12 upcoming Monday-Saturday service dates.

Arrival windows:

- `am` = 8:00 AM - 11:00 AM
- `mid` = 11:00 AM - 2:00 PM
- `pm` = 2:00 PM - 5:00 PM

Availability endpoint contract:

`GET /api/calculator-availability?from=YYYY-MM-DD&to=YYYY-MM-DD`

Expected shape:

```json
{
  "YYYY-MM-DD": ["am", "mid", "pm"]
}
```

If availability is missing, the Web API must fail rather than invent availability.

## NEXT DEVELOPMENT TASK - migrate availability to Google Calendar

Goal:

Google Calendar becomes the single calendar source for:

1. Calculator booking creation
2. Calculator arrival-window availability
3. Homepage `TODAY / NEXT AVAILABLE`
4. Later package-offer booking

Do not change the public calculator availability response contract unless there is a clear reason.

Preferred migration:

Google Calendar FreeBusy
-> northline-admin
-> calculate exact `am` / `mid` / `pm` availability
-> update `HOME_STATE`
-> northline-web
-> existing `/api/calculator-availability`
-> Calculator

Homepage availability should derive from the same Google Calendar source.

Rules to preserve:

- one shared technician calendar
- `America/New_York`
- Monday-Saturday only
- 12 upcoming service dates
- exact 3-hour windows
- no client-side availability generation
- busy Google Calendar time must block the overlapping arrival window
- booking and displayed availability must use the same calendar truth

Migration sequence:

1. inspect current legacy `availability.ts`, `cal-client.ts`, `sync-availability.ts`
2. reuse existing Google OAuth + FreeBusy helpers
3. replace Cal.com availability calculation with Google FreeBusy
4. keep existing Web/API response contract
5. verify Calculator availability against real Google Calendar events
6. verify homepage `TODAY / NEXT AVAILABLE`
7. verify a newly booked Google event immediately blocks that window
8. only after verification remove legacy Cal.com availability code/secrets/references

Do NOT remove the current Cal.com availability path before step 7 is verified.

## Google OAuth operational follow-up

Verify the Google OAuth consent app is in Production / Published status.

During initial authorization, OAuth Playground exposed a refresh-token lifetime around seven days, which can happen while an OAuth consent app is in Testing.

Do not assume the integration is durable until consent-screen publication/status is verified.

## SMS

Recipient:

`+14704709331`

SMS should ideally contain:

- quote ID
- TV configuration
- per-TV detail
- subtotal
- multi-TV discount
- final total

Approved help title:

`Need help choosing the right option?`

Approved body:

`If the estimate looks higher than expected or you’re not sure about the wall type, send a photo of the wall and TV area. We’ll review the setup and confirm the best option before you book.`

Approved action:

`Send Photo for Review →`

Small text:

`Opens Messages · (470) 470-9331`

## Analytics

Intended GTM events:

- `calculator_open`
- `calculator_standard_tv`
- `calculator_samsung_frame`
- `calculator_add_tv`
- `calculator_remove_tv`
- `calculator_phone_valid`
- `calculator_lead_saved`
- `calculator_book_click`
- `calculator_sms_click`
- `calculator_close`

No PII in GTM or GA4.

Google Ads mapping is not finalized.

## Accessibility

Requirements:

- semantic dialog
- Escape closes
- focus trap
- body scroll lock
- restore focus to opening trigger
- keyboard navigation
- visible focus states
- reduced-motion support

## Verified browser behavior

Verified on `/test/`:

- HomeExplore TV mounting pricing opens Calculator
- Footer Calculate Price opens same Calculator
- Calculator appears over current page
- URL does not change
- no `/calculator` page is required
- calculator can complete a real booking through Google Calendar
- successful booking redirects to `/paul`
- `/paul` is live in the production Worker

## Repository hygiene

For calculator/calendar work:

- targeted changes only
- no diagnostic leftovers
- never commit `.dev.vars`
- never commit secrets/tokens
- remove temporary routes/files after testing
- remove controlled production test records after testing
- run `npm run check`
- run `npm run build`
- run `git diff --check`
- inspect `git diff`
- inspect `git status`
- commit only intended files
- verify `HEAD` matches `origin/main` after push

Do not casually modify `/test/`.

## Current route state

Current Astro build includes:

- `/`
- `/test/`
- `/paul/`

Some surrounding navigation links may still point to routes not yet implemented in this repository.

Perform a separate site-wide route/link audit when completing the website.

## Recent verified checkpoints

### northline-web

- `1e84076` Enable calculator booking endpoint
- `e601786` Add booking confirmation page

### northline-admin

- `80f8ea7` Add calculator booking engine
- `1b2675d` Connect calculator booking engine
- `47a8a06` Sync booked lead with canonical quote
- `c027a0d` Preserve booking completion timestamp

## Next chat / continuation

Do not rediscover booking architecture from scratch.

Booking creation is complete and production-verified.

Current next steps:

1. verify Google OAuth consent app remains Production / Published
2. preserve the current Google Calendar booking and availability contracts
3. later add package-offer booking against the same calendar source
4. keep homepage and Calculator availability on the same calendar truth
