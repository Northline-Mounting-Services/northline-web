/**
 * INTEGRATION BOUNDARY — server-side operations the calculator depends on.
 *
 * Implemented:
 * - published pricing: /api/calculator-pricing
 * - lead persistence: /api/calculator-lead
 *
 * Still pending:
 * - Cal.com-backed booking creation
 *
 * Pending operations reject instead of returning fake success.
 * Secrets stay server-side.
 */

export const ENDPOINTS = {
  // Published pricing snapshot from the Northline Worker. Never draft.
  publishedPricing: '/api/calculator-pricing',
  // Lead/quote upsert into D1 calculator_leads.
  leadUpsert: '/api/calculator-lead',
  // Arrival-window availability from the shared Cal.com snapshot in HOME_STATE.
  availability: '/api/calculator-availability',
  // TODO(northline): confirm real route — booking creation through Cal.com, server-side.
  createBooking: null
};

class IntegrationRequired extends Error {
  constructor(operation) {
    super(`PRODUCTION INTEGRATION REQUIRED: ${operation}`);
    this.name = 'IntegrationRequired';
    this.operation = operation;
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}

/**
 * Published pricing only. Never draft.
 * Expected shape:
 *   {
 *     version: string,
 *     multiTvRules: Array<{
 *       minQuantity: number,
 *       maxQuantity: number | null,
 *       percent: number
 *     }>,                                // dynamic; tiers come from Published pricing
 *     base: { standard_tv: number, samsung_frame: number },
 *     items: { "<family>.<groupCode>.<itemCode>": number | 0 | "quote" },
 *     clientLiftRule: { true: number, false: number } | null   // pricing context
 *   }
 */
export async function loadPublishedPricing() {
  if (!ENDPOINTS.publishedPricing) throw new IntegrationRequired('loadPublishedPricing');
  return getJson(ENDPOINTS.publishedPricing);
}

/**
 * Lead / quote upsert against ONE identity. Called on every phone change and
 * every configuration change once the phone is valid and the estimate is
 * complete, and again before booking.
 *
 * Request: {
 *   quoteId: string | null,
 *   phone: "+17705551234",
 *   sourcePage: "/",
 *   customer?: {
 *     name?: string,
 *     streetAddress?: string,
 *     address2?: string,
 *     city?: string,
 *     notes?: string
 *   },
 *   quote: {...}
 * }
 * Expected response: { quoteId: string }
 * The caller fires calculator_lead_saved only on a resolved call.
 */
export async function upsertCalculatorLead(payload) {
  if (!ENDPOINTS.leadUpsert) throw new IntegrationRequired('upsertCalculatorLead');
  return postJson(ENDPOINTS.leadUpsert, payload);
}

/**
 * Arrival-window availability, derived from Cal.com server-side.
 * Request: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 * Expected response: { "YYYY-MM-DD": ["am", "mid", "pm"], ... }
 * Sundays absent. No client-side availability generation, ever.
 */
export async function loadBookingAvailability(range) {
  if (!ENDPOINTS.availability) throw new IntegrationRequired('loadBookingAvailability');
  return getJson(`${ENDPOINTS.availability}?from=${range.from}&to=${range.to}`);
}

/**
 * Booking creation through Cal.com, server-side.
 * Request: { quoteId, phone, date: "YYYY-MM-DD", windowCode: "am"|"mid"|"pm", quote }
 * Expected response: { bookingId: string }
 * Only a resolved call carrying a bookingId may redirect to /paul.
 */
export async function createInstallationBooking(payload) {
  if (!ENDPOINTS.createBooking) throw new IntegrationRequired('createInstallationBooking');
  return postJson(ENDPOINTS.createBooking, payload);
}
