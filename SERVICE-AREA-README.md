# Northline Service Area

Source of truth and implementation handoff for `/service-area`.

## Purpose

The page provides:

- ZIP-based service-area checking
- service-area map
- same-day SMS CTA
- published package booking
- trust content
- reviews
- Recent Work by Area
- internal service links

The Calculator is separate and must not be modified as part of Service Area work.

## Route

Public route: `/service-area`

Main page: `src/pages/service-area.astro`

## Page order

1. Service area / ZIP checker / map
2. Same-day SMS CTA
3. Published package
4. Trust
5. Reviews
6. Recent Work by Area
7. Internal links

## Main files

Service Area:

- `src/pages/service-area.astro`
- `src/components/service-area/ServiceAreaLinks.astro`
- `src/components/service-area/ServiceAreaPackage.astro`
- `src/components/service-area/ServiceAreaToday.astro`
- `src/components/service-area/ServiceAreaTrust.astro`
- `src/styles/service-area.css`

Map / ZIP:

- `src/data/service-area-zips.js`
- `src/data/work-routes.js`
- `src/components/work/WorkRouteSelector.astro`
- `src/components/work/WorkServiceMap.astro`
- `src/scripts/work-service-map.js`
- `src/scripts/work-zip-check.js`
- `src/styles/work-service-map.css`

Recent Work:

- `src/components/work/WorkServiceArea.astro`
- `src/lib/service-area/public-work.ts`

Worker:

- `src/worker.ts`
- `wrangler.jsonc`

## Same-day SMS

Phone: `+1 470-470-9331`

Prefilled message:

`Hi, I need a TV mounted today. Any chance you'll be nearby today?`

Tested URI:

`sms://+14704709331;?&body=...`

Tracking event:

`same_day_sms_click`

Tracking parameter:

`cta_location: service_area_same_day`

GTM / GA4 / Google Ads configuration is deferred.

Do not restore `data-call` to this CTA.

## Published package

Package ID:

`NL-PKG-UNTITLED-PACKAGE-GNIC`

Allowlist:

`src/data/package-booking-catalog.ts`

Package data comes from `/api/packages`.

Name, description and price must come from published Admin data.

Current tested values:

- Name: `Test`
- Description: `test fireplace`
- Price: `$168`

CTA: `Book installation →`

Booking uses the existing `window.openPackageBooking(...)`.

Do not create a separate Service Area booking system.

## Dynamic pricing decision

Dynamic rotating pricing was intentionally abandoned.

Do not reintroduce without a new explicit product decision:

- 5-minute price rotation
- countdowns
- per-visitor pricing
- offer IDs
- locked-price snapshots
- special Service Area booking persistence
- Admin/D1 migrations for price locking

No dynamic-price Admin migration was applied.

## Recent Work

Recent Work uses the existing Web Worker / Admin Service Binding architecture.

Do not expose:

- Admin credentials
- internal tokens
- private storage URLs
- private work-record data

Public work dates use coarse age labels rather than exact internal dates.

## Cloudflare

Worker-first routing includes:

- `/api/*`
- `/service-area`
- `/service-area/*`

Do not remove these routes without retesting Service Area APIs and media.

## Repository hygiene

Do not use `git add .`.

Do not commit:

- `.dev.vars`
- tokens
- OAuth secrets
- temporary diagnostic routes
- screenshots
- local artifacts

Before commit run:

- `npm run check`
- `npm run build`
- `git diff --check`
- `git status --short --untracked-files=all`

## Manual acceptance

Verify:

- `/service-area` loads
- ZIP checker works
- map works
- mobile layout works
- SMS opens with prefilled text
- `same_day_sms_click` reaches `window.dataLayer`
- package loads from `/api/packages`
- `Book installation` opens Package Booking
- availability loads
- Recent Work cards and media load
- no private/internal information is exposed

## Performance / CLS

Mobile performance was tested at 390 x 844 with Slow 4G and network cache disabled.

Final local metrics after stabilization:

- LCP: approximately 1.47 s
- CLS: 0

Intentional protections:
- Service Area package is rendered immediately; its booking button stays disabled until `/api/packages` loads.
- On mobile, Service Area review cards reserve `min-height: 234px` while `/api/google-reviews` loads.

Do not remove these reservations without repeating the mobile Performance test.

## Deferred analytics

Later configure:

- GTM trigger for `same_day_sms_click`
- GA4 event
- Google Ads conversion classification

## Architecture

Published Admin data
→ Web / API
→ Service Area
→ Existing Package Booking
→ Google Calendar + D1

Do not create a second booking system for this page.

Do not modify Calculator behavior as part of Service Area work.
