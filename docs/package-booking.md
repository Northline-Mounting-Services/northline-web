# Northline Package Booking

PackageBooking is the booking-only flow for predefined Northline installation packages. It is separate from the main TV Calculator.

## Customer flow

PackageBooking uses progressive reveal:

1. Popup opens with package information and available dates.
2. Customer selects a date.
3. Arrival windows appear below the dates.
4. Customer selects an available arrival window.
5. Customer details form appears below.
6. Booking can be confirmed after required fields are valid.

The approved visual design is the current Claude-designed PackageBooking UI.

## Package IDs

Current public package IDs:

- `NL-PKG-MULTI-2`
- `NL-PKG-MULTI-3`
- `NL-PKG-MULTI-4`
- `NL-PKG-FIRE`
- `NL-PKG-FRAME`

Legacy `NL-PKG-MULTI` must not be restored.

A single-TV installation does not use PackageBooking. It continues through the Calculator.

## Display data and pricing

The page opening PackageBooking supplies display context such as:

- `packageId`
- `category`
- `priceLabel`
- `description`

`priceLabel` is display-only.

Browser-supplied pricing is never booking authority. The backend identifies the service by `packageId`.

## Booking architecture

Production flow:

PackageBooking
→ `POST /api/package-booking`
→ northline-web
→ `NORTHLINE_ADMIN` Service Binding
→ northline-admin package booking engine
→ shared booking slot protection
→ Google Calendar
→ D1
→ confirmed `bookingId`
→ `/paul`

The browser must not redirect to `/paul` without a real confirmed `bookingId`.

## Calendar

Google Calendar is the single production calendar source for availability and confirmed bookings.

Cal.com is not used and must not be restored.

Do not add:

- Cal.com APIs
- Cal.com embeds or iframes
- Cal.com booking links
- another third-party scheduling service

Timezone:

`America/New_York`

Arrival windows:

- `am` — 8 AM–11 AM
- `mid` — 11 AM–2 PM
- `pm` — 2 PM–5 PM

Service days are Monday through Saturday. Sunday is excluded.

## Availability

PackageBooking uses the existing Northline availability API.

Availability is refreshed when the popup opens.

The browser does not calculate authoritative calendar availability. Unknown availability must fail closed rather than appear bookable.

## Idempotency

Package booking requests use a stable `requestId`.

Do not remove or replace the existing request identity/idempotency behavior.

Retries of the same booking attempt must not create duplicate appointments.

## D1

Relevant production tables include:

- `package_bookings`
- shared `booking_slots`

The shared slot layer prevents Calculator and PackageBooking from independently reserving the same technician/date/window.

Frontend code must not bypass this layer.

## Frontend files

PackageBooking frontend:

- `src/components/PackageBooking.astro`
- `src/data/package-booking-catalog.ts`
- `src/scripts/package-booking-api.js`
- `src/scripts/package-booking.js`
- `src/styles/package-booking.css`

Package launch data may also come from page-specific components or scripts.

## Calculator boundary

PackageBooking and Calculator share booking infrastructure but are separate frontend products.

Normal PackageBooking UI work must not modify:

- `src/components/Calculator.astro`
- `src/scripts/calculator.js`
- `src/scripts/calculator-api.js`
- `src/styles/calculator.css`

## Backend boundary

Normal PackageBooking UI work must not require changes to:

- D1 schema
- northline-admin booking engine
- Google Calendar integration
- Service Binding configuration
- shared booking-slot locking
- Calculator booking engine

A UI change must not silently redefine the booking contract.

## Verification

After PackageBooking changes run:

    npm run check
    npm run build
    git diff --check
    git status --short

Then manually inspect:

    git diff

For UI-only work, verify:

1. Dates are visible immediately.
2. Selecting a date reveals arrival windows.
3. Selecting an available window reveals customer details.
4. Confirm booking stays disabled until required data is valid.
5. Calculator remains unchanged.

Do not create a real production booking merely to test visual changes.

## Repository hygiene

Do not commit temporary routes, diagnostic files, debug logging, `.dev.vars`, secrets, credentials, or temporary booking data.

Keep changes narrowly scoped and review the final diff before every commit.
