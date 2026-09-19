/**
 * Published package IDs that are allowed to create a calendar booking.
 *
 * Package identity comes from the Admin Published package catalog.
 * Customer-facing name, price and description come from /api/packages.
 * The backend trusts packageId only after it passes this allowlist.
 *
 * One-TV custom service is intentionally absent. It belongs to the
 * Calculator flow.
 */

export const PACKAGE_BOOKING_IDS = [
  // Multiple TVs
  'NL-PKG-UNTITLED-PACKAGE-ETTA',
  'NL-PKG-UNTITLED-PACKAGE-KE7Y',
  'NL-PKG-UNTITLED-PACKAGE-MT9K',

  // Above fireplace
  'NL-PKG-FIRE',
  'NL-PKG-FRAME',

  // Samsung Frame
  'NL-PKG-UNTITLED-PACKAGE-J3HC',
  'NL-PKG-UNTITLED-PACKAGE-FQD8',

  // Wire concealment
  'NL-PKG-UNTITLED-PACKAGE-IUXK',
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
