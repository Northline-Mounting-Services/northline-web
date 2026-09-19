# TV Mounting Service Pages

## Purpose

This document defines the shared implementation pattern for Northline pages under `/tv-mounting`.

The approved `/tv-mounting/` page is the visual source of truth.

Service pages are variations of the homepage layout, not independent page designs.

## Canonical routes

- `/tv-mounting`
- `/tv-mounting/samsung-frame`
- `/tv-mounting/above-fireplace`
- `/tv-mounting/large-tv`
- `/tv-mounting/wire-concealment`

A service page must not link to itself in the Explore Northline service list.

## Visual source of truth

Base route: `/tv-mounting/`

Shared structure:

- Header
- `.nl-home`
- `.nl-shell`
- `.nl-h1`
- proxy/location block
- `.nl-focus`
- left pricing/package card
- `.nl-media`
- call row
- HomeAvailability
- HomeTrust
- HomeReviews
- HomeExplore
- Footer

Shared styles:

- `src/styles/home-test.css`

Do not create a separate visual language for individual service pages.

Do not duplicate homepage CSS inside specialized service components.

## What changes on a service page

Normally only the upper content changes:

1. page title
2. meta description
3. H1
4. left card inside `.nl-focus`

The media block and lower page structure remain based on `/tv-mounting/`.

## Specialized cards

A service page may use a dedicated component when its pricing or booking logic differs from the homepage card.

Example:

- `src/components/home/FireplacePackage.astro`

Specialized cards should reuse existing homepage classes:

- `nl-package`
- `nl-kicker`
- `nl-tabs`
- `nl-tab`
- `nl-panel`
- `nl-price`
- `nl-price__label`
- `nl-price__value`
- `nl-package__descriptor`
- `nl-qty`
- `nl-qty__row`
- `nl-chip`
- `nl-action`

## Above Fireplace

Route:

- `/tv-mounting/above-fireplace`

Page:

- `src/pages/tv-mounting/above-fireplace.astro`

Card:

- `src/components/home/FireplacePackage.astro`

The card contains two modes:

- Standard
- Package

### Standard

Customer-facing content:

- starting price
- drywall description
- Calculate price & book CTA

The starting price comes from Published calculator pricing.

Current pricing keys:

- `standard_tv.tv_size.up_to_50`
- `standard_tv.location.fireplace`

The CTA opens the existing Calculator using `data-nl-open`.

Do not create a separate calculator for this page.

### Package

Published package identities currently used:

- `NL-PKG-FIRE` = Brick / Stone
- `NL-PKG-FRAME` = Tile / Granite

Package data comes from:

- `GET /api/packages`

Published Admin is authoritative for:

- packageId
- name
- description
- price

The browser must not calculate package pricing.

The Book installation CTA opens the existing PackageBooking flow.

## Pricing architecture

Standard:

Published Admin pricing
→ `/api/calculator-pricing`
→ service page

Package:

Published Admin package
→ northline-admin internal published-packages API
→ Cloudflare Service Binding
→ northline-web `/api/packages`
→ service page

Public pages must never consume Draft pricing.

## Booking architecture

Standard installation:

service page
→ existing Calculator
→ calculator booking flow

Package installation:

service page
→ existing PackageBooking
→ packageId
→ `/api/package-booking`

Do not create duplicate booking implementations for service pages.

## Explore Northline

Shared component:

- `src/components/home/HomeExplore.astro`

Canonical TV mounting links are maintained there.

Service pages exclude their own route with `excludeHref`.

Example:

`<HomeExplore excludeHref="/tv-mounting/above-fireplace" />`

The `/tv-mounting/` base page excludes only its own `/tv-mounting` route.

## Large TV page

Route:

- `/tv-mounting/large-tv`

This page is not a package page.

It uses two size-based modes:

- `78–90″`
  - starting price is calculated from Published `/api/calculator-pricing`
  - formula: `standard_tv.tv_size.78_90 + clientLiftRule.true`
  - this is displayed as `FROM`
  - client-lift savings are also read from `clientLiftRule.true`
  - display the savings as a positive amount with `Math.abs(...)`
  - do not hardcode either the starting price or savings
  - CTA opens the existing Calculator with `data-nl-open`

- `90″+`
  - no fixed price
  - displays `QUOTE`
  - CTA opens a prefilled SMS quote request
  - the SMS asks for the TV model and a photo of the installation area

Content rules:

- do not use PackageBooking on this page
- do not create package IDs for Large TV
- do not hardcode the `78–90″` price or client-lift savings
- keep the TV size at the end of the customer-facing description
- availability is loaded from `/api/home-state`
- do not modify the shared Calculator for this page

## Multiple TV packages on `/tv-mounting`

The `Multiple TVs` mode uses real Published Admin packages.

Package data comes from `/api/packages`:

- `2 TVs` → `NL-PKG-UNTITLED-PACKAGE-ETTA`
- `3 TVs` → `NL-PKG-UNTITLED-PACKAGE-KE7Y`
- `4 TVs` → `NL-PKG-UNTITLED-PACKAGE-MT9K`

For Multiple TVs:

- `packageId` comes from the Published Admin package
- price comes from `/api/packages`
- description comes from `/api/packages`
- the browser does not calculate package pricing
- synthetic `NL-PKG-MULTI-*` IDs are not used
- `/api/home-state` remains responsible for One-TV starting price and availability

## Wire Concealment page

Route:

- `/tv-mounting/wire-concealment`

The page has two modes:

- `CUSTOM`
  - starting price comes from Published `/api/calculator-pricing`
  - formula: `base.standard_tv + standard_tv.tv_size.up_to_50 + standard_tv.wire.cord_cover`
  - CTA opens the existing Calculator with `data-nl-open`

- `PACKAGE`
  - uses the Published `POWER` package
  - package ID: `NL-PKG-UNTITLED-PACKAGE-IUXK`
  - name, price and description come from `/api/packages`
  - CTA opens the existing PackageBooking flow

Content and architecture rules:

- do not hardcode CUSTOM or POWER prices
- do not duplicate package descriptions in page logic
- PackageBooking business identity is the Published Admin `packageId`
- availability is loaded from `/api/home-state`
- do not modify the shared Calculator for this page

## Creating another service page

1. Start from `/tv-mounting/`.
2. Correct relative imports for the nested route.
3. Keep the shared homepage structure intact.
4. Change title, meta description and H1.
5. Replace only the left card when specialized logic is needed.
6. Reuse `home-test.css`.
7. Use the existing Calculator or PackageBooking.
8. Load prices only from Published APIs.
9. Exclude the current route from HomeExplore.
10. Compare the result visually with `/tv-mounting/`.

Do not design the page from scratch.

## Repository hygiene

Before commit run:

- `npm run check`
- `npm run build`
- `git diff --check`
- `git diff`
- `git status --short --untracked-files=all`

Requirements:

- only intentional files changed
- no temporary routes
- no diagnostics
- no backup files
- no `.dev.vars`
- no secrets
- no debug code
- no unrelated formatting changes

## Current status

Implemented:

- `/tv-mounting`
- `/tv-mounting/above-fireplace`
- `/tv-mounting/samsung-frame`
- `/tv-mounting/large-tv`
- `/tv-mounting/wire-concealment`

Planned:

- none
