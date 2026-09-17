/**
 * INTEGRATION BOUNDARY — package booking.
 *
 * Availability reuses the same public Google Calendar-backed endpoint as the
 * calculator. Package booking creation has its own endpoint because its
 * business identity is packageId, not calculator quoteId.
 *
 * Security: no Google credential, service credential or internal token may
 * appear in this file or anywhere else in the browser bundle.
 */

import { loadBookingAvailability } from './calculator-api.js';

export { loadBookingAvailability };

export const PACKAGE_ENDPOINTS = {
  createPackageBooking: '/api/package-booking'
};

/**
 * Package booking creation through the Northline backend, server-side.
 *
 * Request:
 *   {
 *     requestId: "UUID-v4",
 *     packageId: "NL-PKG-...",
 *     date: "YYYY-MM-DD",
 *     windowCode: "am" | "mid" | "pm",
 *     customer: { name, phone, address1, address2, city, state: "GA", notes }
 *   }
 * Expected response: { bookingId: string }
 *
 * The page owns customer-facing package name, price and description. The
 * server receives only packageId for business identity and validates it against
 * the package-booking allowlist. Display text and price are not sent as booking
 * authority. Only a confirmed response carrying a bookingId may redirect to
 * /paul.
 */
export async function createPackageBooking(payload) {
  const res = await fetch(PACKAGE_ENDPOINTS.createPackageBooking, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    },
    cache: 'no-store',
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}
