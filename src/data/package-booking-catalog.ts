/**
 * Package booking IDs that are allowed to create a calendar booking.
 *
 * Customer-facing package name, price and description stay on the page and
 * are read by the PackageBooking popup. This server-side list is deliberately
 * minimal: it is only an allowlist preventing arbitrary package IDs from
 * reaching the booking engine.
 *
 * Multi-TV quantity is part of the booking identity so the backend/calendar
 * can distinguish 2, 3 and 4 TV visits without trusting a browser price.
 * One-TV service is intentionally absent. It belongs to the calculator flow.
 */
export const PACKAGE_BOOKING_IDS = [
  'NL-PKG-MULTI-2',
  'NL-PKG-MULTI-3',
  'NL-PKG-MULTI-4',
  'NL-PKG-FIRE',
  'NL-PKG-FRAME',
  'NL-PKG-UNTITLED-PACKAGE-J3HC',
  'NL-PKG-UNTITLED-PACKAGE-FQD8',
] as const;

export type PackageBookingId =
  (typeof PACKAGE_BOOKING_IDS)[number];

const PACKAGE_BOOKING_ID_SET =
  new Set<string>(PACKAGE_BOOKING_IDS);

export function isAllowedPackageBookingId(
  value: string,
): value is PackageBookingId {
  return PACKAGE_BOOKING_ID_SET.has(value);
}
