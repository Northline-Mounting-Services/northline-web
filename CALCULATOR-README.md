# Northline TV Installation Calculator

## Status

Customer-facing TV installation calculator for Northline Mounting Services.

The calculator is a modal overlay over the current page.
It is NOT a standalone /calculator page.
Opening it must not change the current URL.

Verified triggers:
- Footer -> Calculate Price
- HomeExplore -> TV mounting pricing

Calculator is mounted once through:
src/components/Footer.astro

## Repositories

WEB
- repo: northline-web
- local: /Users/pavelshymko/Downloads/Astro/Claude-design/northline-web
- Worker: northline-web
- production: https://northline-web.wispy-glitter-409c.workers.dev

ADMIN
- repo: northline-admin
- local: /Users/pavelshymko/Downloads/Astro/Claude-design/northline-admin
- Worker: northline-admin
- production: https://northline-admin.wispy-glitter-409c.workers.dev
- D1: northline-core
- shared KV: HOME_STATE

## Architecture

Pricing:
Pricing Admin -> D1 Published pricing -> northline-web Worker
-> GET /api/calculator-pricing -> Calculator

Availability:
Cal.com -> northline-admin -> HOME_STATE KV -> northline-web
-> GET /api/calculator-availability -> Calculator

Leads:
Calculator -> POST /api/calculator-lead -> D1 calculator_leads

Booking creation is NOT implemented yet.

## Frontend files

src/components/Calculator.astro
- modal shell
- semantic dialog
- imports calculator CSS and JavaScript

src/scripts/calculator.js
- state and rendering
- Standard TV flow
- Samsung Frame flow
- multiple TVs
- pricing calculations
- phone validation
- lead persistence
- availability UI
- SMS
- accessibility

src/scripts/calculator-api.js
- frontend integration boundary
- pricing endpoint
- lead endpoint
- availability endpoint
- booking creation still pending

src/data/calculator-inventory.js
- UI structure
- labels
- group/item identifiers
- dependencies and visibility

src/styles/calculator.css
- calculator design
- responsive behavior

src/components/Footer.astro
- imports Calculator
- mounts Calculator once
- Calculate Price uses data-nl-open

src/components/home/HomeExplore.astro
- TV mounting pricing uses data-nl-open

There must be no standalone /calculator route.

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

Current Published multi-TV rules:
- 2 TVs -> 10%
- 3+ TVs -> 20%

TV count is global across Standard and Samsung Frame.
Only one multi-TV discount applies to subtotal.

## Whole-dollar rule

Customer-facing prices use whole dollars.

Examples:
178.20 -> $178
237.60 -> $238

D1 stores money in cents.

Do not introduce visible cents unless this business rule is intentionally changed.

## Standard client-lift rule

Current behavior:
- up to 50: hidden
- 51-65: hidden
- 66-77: available
- 78-90: available
- over 90: custom quote

Current Published adjustment:
-$40

Changing size must clear stale lift state when the new size is not eligible.

## Leads

Endpoint:
POST /api/calculator-lead

Lead saves when:
1. configuration is complete
2. phone number is valid

Customer does not need to click Book first.

Server creates quote_id on first successful save.
Frontend reuses that quote_id for later updates.

Configuration edits after a valid save update the same quote.

Current debounce:
700 ms

Book and SMS actions perform a final lead save.

## Phone

US/NANP plausibility validation only.
No OTP.

Stored normalized format:
+1XXXXXXXXXX

Never send phone numbers or other PII to GTM or GA4.

## calculator_leads fields

quote_id
created_at
updated_at
phone_e164
source_page
status
tv_count
order_type
configuration_json
subtotal_cents
multi_tv_percent
discount_cents
total_cents
pricing_version
booking_started_at
booking_completed_at
sms_opened_at

Statuses:
- calculated
- booking_started
- booked

Order types:
- standard
- frame
- mixed

## Lead integrity warning

The current lead endpoint performs structural validation but still accepts
browser-supplied configuration and calculated amounts beyond shallow checks.

Booking creation MUST NOT trust browser totals.

The booking path must perform canonical server-side repricing against valid
Published pricing before committing an appointment.

There is also a small theoretical first-save race if simultaneous requests
arrive before the browser receives its first quote_id.

## Availability

Cal.com credentials belong to northline-admin.

Configuration:
CAL_EVENT_TYPE_ID = 6614446
CAL_TIMEZONE = America/New_York

CAL_API_KEY is a Wrangler production secret.
Never put its value in Git, browser code, or documentation.

Admin cron:
*/5 * * * *

Admin synchronizes availability into HOME_STATE.

Calculator snapshot contains 12 upcoming Monday-Saturday service dates.
Sunday is excluded.

Arrival windows:
- am = 8:00 AM - 11:00 AM
- mid = 11:00 AM - 2:00 PM
- pm = 2:00 PM - 5:00 PM

Slot matching is intentionally strict.

Availability endpoint:
GET /api/calculator-availability?from=YYYY-MM-DD&to=YYYY-MM-DD

If calculator availability is missing, the Web API must fail rather than
invent availability.

## Booking UI

Customer windows are exactly:
- 8-11 AM
- 11 AM-2 PM
- 2-5 PM

Approved copy:

Please select a start time below. This begins your 3-hour arrival window
(e.g., selecting 08:00 means we arrive between 8:00 AM and 11:00 AM).

## BOOKING CREATION - NEXT DEVELOPMENT TASK

Booking creation is not implemented.

Preferred responsibility split:

Calculator
-> northline-web
-> private server-to-server integration
-> northline-admin
-> Cal.com API

northline-admin should remain owner of CAL_API_KEY.

Before implementation verify current:
- Cloudflare Worker-to-Worker / Service Binding architecture
- Cal.com API v2 booking documentation

Booking must:
1. receive quote_id
2. load saved lead
3. validate date/window
4. canonicalize and reprice server-side
5. create Cal.com booking
6. update lead status/timestamps
7. return confirmed success

Only after confirmed backend/Cal success may frontend redirect to:
/paul

If booking fails:
- remain in calculator
- preserve selected date
- preserve selected window
- show inline Retry
- keep SMS fallback available

calculator_book_click is intent only, not booking success.

## SMS

Recipient:
+14704709331

SMS should ideally contain:
- quote ID
- TV configuration
- per-TV detail
- subtotal
- multi-TV discount
- final total

Approved help title:
Need help choosing the right option?

Approved body:
If the estimate looks higher than expected or you’re not sure about the wall
type, send a photo of the wall and TV area. We’ll review the setup and confirm
the best option before you book.

Approved action:
Send Photo for Review →

Small text:
Opens Messages · (470) 470-9331

## Analytics

Intended GTM events:
- calculator_open
- calculator_standard_tv
- calculator_samsung_frame
- calculator_add_tv
- calculator_remove_tv
- calculator_phone_valid
- calculator_lead_saved
- calculator_book_click
- calculator_sms_click
- calculator_close

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

Verified on /test/:
- HomeExplore TV mounting pricing opens Calculator
- Footer Calculate Price opens same Calculator
- Calculator appears over current page
- URL does not change
- no /calculator page is required

## Approved visual state

Accepted:
- no NORTHLINE eyebrow in calculator header
- starting prices loaded dynamically from Published pricing
- Standard currently starts at $99
- Samsung Frame currently starts at $99
- client lift displays as -$40
- SMS help uses lightweight text link
- booking copy explains 3-hour arrival window

## Repository hygiene

Do not casually modify /test/.

For calculator work:
- targeted changes only
- no diagnostic leftovers
- never commit .dev.vars
- never commit secrets
- remove temporary calculator test pages
- run npm run check
- run npm run build
- run git diff --check
- inspect git diff
- inspect git status
- commit only intended files

## Known surrounding-site issue

Current Astro build contains only:
- /
- /test/

Some navigation links point to routes not yet implemented in this repository.

Example:
 /ai-tv-quote currently returns HTTP 404.

This is a surrounding-site issue, not a Calculator issue.

Perform a separate site-wide route/link audit when completing the website.

## Next chat

Do not rediscover calculator architecture from scratch.

Start with BOOKING CREATION.

Inspect:
1. northline-admin Cal client
2. northline-web Worker integration points
3. current Cloudflare private Worker-to-Worker options
4. current Cal.com v2 booking endpoint

Then implement the smallest secure booking path while keeping CAL_API_KEY
owned by Admin.
