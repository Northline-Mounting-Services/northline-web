import type {
  D1Database,
  KVNamespace,
} from '@cloudflare/workers-types';

import {
  canonicalRepriceCalculatorQuote,
} from './lib/calculator/canonical-pricing';
import {
  isAllowedPackageBookingId,
} from './data/package-booking-catalog';
import {
  servePublicWorkMedia,
  serveServiceArea,
} from './lib/service-area/public-work';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface ServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  HOME_STATE: KVNamespace;
  DB: D1Database;
  NORTHLINE_ADMIN: ServiceFetcher;
  GOOGLE_PLACES_API_KEY: string;
  INTERNAL_API_TOKEN: string;
}

interface HomePricingSnapshot {
  version: string;
  publishedAt: string;
  syncedAt: string;
  oneTv: {
    priceCents: number;
  };
  multipleTv: Record<
    string,
    {
      quantity: number;
      priceCents: number;
      discountBps: number;
      ruleCode: string;
    }
  >;
}

interface HomeAvailabilitySnapshot {
  today: {
    status: 'available' | 'booked';
    start: string | null;
    label: string;
  };
  next: {
    status: 'available' | 'none';
    start: string | null;
    label: string;
  };
  calculator?: Record<string, Array<'am' | 'mid' | 'pm'>>;
  syncedAt: string;
}


interface CalculatorPricingVersionRow {
  id: number;
  version_key: string;
}

interface CalculatorPricingItemRow {
  family: string;
  group_code: string;
  item_code: string;
  price_cents: number;
  quote_required: number;
}

interface CalculatorPricingRuleRow {
  rule_code: string;
  value_type: string;
  value_int: number;
  min_quantity: number | null;
  max_quantity: number | null;
}

async function loadCalculatorPricing(
  db: D1Database,
): Promise<{
  version: string;
  multiTvRules: Array<{
    minQuantity: number;
    maxQuantity: number | null;
    percent: number;
  }>;
  base: {
    standard_tv: number;
    samsung_frame: number;
  };
  items: Record<string, number | 'quote'>;
  clientLiftRule: Record<'true' | 'false', number> | null;
} | null> {
  const version = await db
    .prepare(
      `
        SELECT id, version_key
        FROM pricing_versions
        WHERE status = 'published'
        ORDER BY published_at DESC, id DESC
        LIMIT 1
      `,
    )
    .first<CalculatorPricingVersionRow>();

  if (!version) {
    return null;
  }

  const [itemResult, ruleResult] = await Promise.all([
    db
      .prepare(
        `
          SELECT
            family,
            group_code,
            item_code,
            price_cents,
            quote_required
          FROM pricing_items
          WHERE version_id = ?
            AND active = 1
            AND family IN ('standard_tv', 'samsung_frame')
          ORDER BY family, group_code, sort_order, item_code
        `,
      )
      .bind(version.id)
      .all<CalculatorPricingItemRow>(),

    db
      .prepare(
        `
          SELECT
            rule_code,
            value_type,
            value_int,
            min_quantity,
            max_quantity
          FROM pricing_rules
          WHERE version_id = ?
            AND active = 1
            AND (
              rule_code = 'client_lift'
              OR rule_code LIKE 'multi_tv_%'
            )
          ORDER BY sort_order, rule_code
        `,
      )
      .bind(version.id)
      .all<CalculatorPricingRuleRow>(),
  ]);

  const items: Record<string, number | 'quote'> = {};

  for (const item of itemResult.results) {
    const key =
      `${item.family}.${item.group_code}.${item.item_code}`;

    items[key] = item.quote_required
      ? 'quote'
      : item.price_cents / 100;
  }

  const multiTvRules = ruleResult.results
    .filter(
      (rule) =>
        rule.rule_code.startsWith('multi_tv_') &&
        rule.value_type === 'basis_points' &&
        rule.value_int < 0 &&
        rule.min_quantity !== null &&
        rule.min_quantity >= 2,
    )
    .map((rule) => ({
      minQuantity: rule.min_quantity as number,
      maxQuantity: rule.max_quantity,
      percent: Math.max(0, -rule.value_int / 10000),
    }))
    .sort((a, b) => a.minQuantity - b.minQuantity);

  const clientLift = ruleResult.results.find(
    (rule) =>
      rule.rule_code === 'client_lift' &&
      rule.value_type === 'cents',
  );

  return {
    version: version.version_key,
    multiTvRules,
    base: {
      standard_tv: 0,
      samsung_frame: 0,
    },
    items,
    clientLiftRule: clientLift
      ? {
          true: clientLift.value_int / 100,
          false: 0,
        }
      : null,
  };
}

async function readJson<T>(
  kv: KVNamespace,
  key: string,
): Promise<T | null> {
  const value = await kv.get(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    console.error(`Invalid JSON in KV key: ${key}`);
    return null;
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control':
          status === 200
            ? 'public, max-age=30, s-maxage=30, stale-while-revalidate=120'
            : 'no-store',
      },
    },
  );
}


interface CalculatorLeadQuote {
  pricingVersion: string;
  multiTvPercent: number;
  quoteRequired: boolean;
  subtotal: number | null;
  total: number | null;
  tvs: Array<{
    family: 'standard_tv' | 'samsung_frame';
    selection: Record<string, string | string[]>;
    clientLift?: boolean;
  }>;
}

interface CalculatorLeadCustomer {
  name?: string;
  streetAddress?: string;
  address2?: string;
  city?: string;
  notes?: string;
}

interface CalculatorLeadPayload {
  quoteId?: string | null;
  phone?: string;
  sourcePage?: string;
  customer?: CalculatorLeadCustomer | null;
  quote?: CalculatorLeadQuote;
}

interface CalculatorBookingPayload {
  quoteId?: string | null;
  phone?: string;
  date?: string;
  windowCode?: string;
  customer?: (
    CalculatorLeadCustomer & {
      phone?: string;
      state?: string;
    }
  ) | null;
  quote?: {
    tvs?: CalculatorLeadQuote['tvs'];
  } | null;
}

interface PackageBookingPayload {
  requestId?: string;
  packageId?: string;
  date?: string;
  windowCode?: string;
  customer?: {
    name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    notes?: string;
  } | null;
}


const E164_US_PHONE =
  /^\+1[2-9]\d{2}[2-9]\d{6}$/;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DATE_ONLY =
  /^\d{4}-\d{2}-\d{2}$/;

function isValidBookingDate(
  value: string,
): boolean {
  if (!DATE_ONLY.test(value)) {
    return false;
  }

  const [year, month, day] =
    value.split('-').map(Number);

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
    ),
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  // Monday-Saturday only.
  return date.getUTCDay() !== 0;
}

function normalizeCustomerText(
  value: unknown,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('invalid_customer');
  }

  const normalized = value.trim();

  if (!normalized) return null;

  if (normalized.length > maxLength) {
    throw new Error('invalid_customer');
  }

  return normalized;
}

function validateCalculatorBooking(
  payload: CalculatorBookingPayload,
): {
  quoteId: string;
  phone: string;
  date: string;
  windowCode: 'am' | 'mid' | 'pm';
  customer: {
    name: string;
    phone: string;
    streetAddress: string;
    address2: string | null;
    city: string;
    state: 'GA';
    notes: string | null;
  };
  tvs: CalculatorLeadQuote['tvs'];
} {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error(
      'invalid_booking_request',
    );
  }

  if (
    typeof payload.quoteId !== 'string' ||
    !UUID_V4.test(payload.quoteId)
  ) {
    throw new Error('invalid_quote_id');
  }

  if (
    typeof payload.phone !== 'string' ||
    !E164_US_PHONE.test(payload.phone)
  ) {
    throw new Error('invalid_phone');
  }

  if (
    typeof payload.date !== 'string' ||
    !isValidBookingDate(payload.date)
  ) {
    throw new Error(
      'invalid_booking_date',
    );
  }

  if (
    payload.windowCode !== 'am' &&
    payload.windowCode !== 'mid' &&
    payload.windowCode !== 'pm'
  ) {
    throw new Error('invalid_window');
  }

  if (
    !payload.customer ||
    typeof payload.customer !== 'object' ||
    Array.isArray(payload.customer)
  ) {
    throw new Error('invalid_customer');
  }

  const name =
    normalizeCustomerText(
      payload.customer.name,
      100,
    );

  const streetAddress =
    normalizeCustomerText(
      payload.customer.streetAddress,
      140,
    );

  const address2 =
    normalizeCustomerText(
      payload.customer.address2,
      80,
    );

  const city =
    normalizeCustomerText(
      payload.customer.city,
      80,
    );

  const notes =
    normalizeCustomerText(
      payload.customer.notes,
      500,
    );

  if (
    !name ||
    !streetAddress ||
    !city
  ) {
    throw new Error('invalid_customer');
  }

  if (
    !payload.quote ||
    typeof payload.quote !== 'object' ||
    Array.isArray(payload.quote) ||
    !Array.isArray(payload.quote.tvs)
  ) {
    throw new Error('invalid_quote');
  }

  return {
    quoteId: payload.quoteId,
    phone: payload.phone,
    date: payload.date,
    windowCode: payload.windowCode,
    customer: {
      name,
      phone: payload.phone,
      streetAddress,
      address2,
      city,
      state: 'GA',
      notes,
    },
    tvs: payload.quote.tvs,
  };
}

function normalizePackagePhone(
  value: unknown,
): string {
  if (typeof value !== 'string') {
    throw new Error('invalid_phone');
  }

  let digits = value.replace(/\D/g, '');

  if (
    digits.length === 11 &&
    digits.startsWith('1')
  ) {
    digits = digits.slice(1);
  }

  if (!/^[2-9]\d{9}$/.test(digits)) {
    throw new Error('invalid_phone');
  }

  return `+1${digits}`;
}

function validatePackageBooking(
  payload: PackageBookingPayload,
): {
  requestId: string;
  packageId: string;
  phone: string;
  date: string;
  windowCode: 'am' | 'mid' | 'pm';
  customer: {
    name: string;
    phone: string;
    streetAddress: string;
    address2: string | null;
    city: string;
    state: 'GA';
    notes: string | null;
  };
} {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error(
      'invalid_booking_request',
    );
  }

  if (
    typeof payload.requestId !== 'string' ||
    !UUID_V4.test(payload.requestId)
  ) {
    throw new Error(
      'invalid_request_id',
    );
  }

  if (
    typeof payload.packageId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(
      payload.packageId,
    )
  ) {
    throw new Error(
      'invalid_package_id',
    );
  }

  if (
    !isAllowedPackageBookingId(
      payload.packageId,
    )
  ) {
    throw new Error(
      'package_not_found',
    );
  }

  if (
    typeof payload.date !== 'string' ||
    !isValidBookingDate(payload.date)
  ) {
    throw new Error(
      'invalid_booking_date',
    );
  }

  if (
    payload.windowCode !== 'am' &&
    payload.windowCode !== 'mid' &&
    payload.windowCode !== 'pm'
  ) {
    throw new Error('invalid_window');
  }

  if (
    !payload.customer ||
    typeof payload.customer !== 'object' ||
    Array.isArray(payload.customer)
  ) {
    throw new Error('invalid_customer');
  }

  const name =
    normalizeCustomerText(
      payload.customer.name,
      100,
    );

  const streetAddress =
    normalizeCustomerText(
      payload.customer.address1,
      140,
    );

  const address2 =
    normalizeCustomerText(
      payload.customer.address2,
      80,
    );

  const city =
    normalizeCustomerText(
      payload.customer.city,
      80,
    );

  const notes =
    normalizeCustomerText(
      payload.customer.notes,
      500,
    );

  if (
    !name ||
    !streetAddress ||
    !city ||
    payload.customer.state !== 'GA'
  ) {
    throw new Error('invalid_customer');
  }

  const phone =
    normalizePackagePhone(
      payload.customer.phone,
    );

  return {
    requestId: payload.requestId,
    packageId: payload.packageId,
    phone,
    date: payload.date,
    windowCode: payload.windowCode,
    customer: {
      name,
      phone,
      streetAddress,
      address2,
      city,
      state: 'GA',
      notes,
    },
  };
}

function validateCalculatorLead(
  payload: CalculatorLeadPayload,
): {
  quoteId: string;
  phone: string;
  sourcePage: string | null;
  quote: CalculatorLeadQuote;
  orderType: 'standard_tv' | 'samsung_frame' | 'mixed';
  subtotalCents: number | null;
  discountCents: number | null;
  totalCents: number | null;
  customer: {
    name: string | null;
    streetAddress: string | null;
    address2: string | null;
    city: string | null;
    state: 'GA';
    notes: string | null;
  } | null;
} {
  if (
    typeof payload.phone !== 'string' ||
    !E164_US_PHONE.test(payload.phone)
  ) {
    throw new Error('invalid_phone');
  }

  if (
    payload.quoteId !== undefined &&
    payload.quoteId !== null &&
    (
      typeof payload.quoteId !== 'string' ||
      !UUID_V4.test(payload.quoteId)
    )
  ) {
    throw new Error('invalid_quote_id');
  }

  const sourcePage =
    typeof payload.sourcePage === 'string' &&
    payload.sourcePage.startsWith('/') &&
    payload.sourcePage.length <= 512
      ? payload.sourcePage
      : null;

  let customer: {
    name: string | null;
    streetAddress: string | null;
    address2: string | null;
    city: string | null;
    state: 'GA';
    notes: string | null;
  } | null = null;

  if (payload.customer !== undefined && payload.customer !== null) {
    if (
      typeof payload.customer !== 'object' ||
      Array.isArray(payload.customer)
    ) {
      throw new Error('invalid_customer');
    }

    customer = {
      name: normalizeCustomerText(payload.customer.name, 100),
      streetAddress: normalizeCustomerText(
        payload.customer.streetAddress,
        140,
      ),
      address2: normalizeCustomerText(payload.customer.address2, 80),
      city: normalizeCustomerText(payload.customer.city, 80),
      state: 'GA',
      notes: normalizeCustomerText(payload.customer.notes, 500),
    };
  }

  const quote = payload.quote;

  if (
    !quote ||
    typeof quote !== 'object' ||
    typeof quote.pricingVersion !== 'string' ||
    !quote.pricingVersion ||
    quote.pricingVersion.length > 64 ||
    typeof quote.multiTvPercent !== 'number' ||
    !Number.isFinite(quote.multiTvPercent) ||
    quote.multiTvPercent < 0 ||
    quote.multiTvPercent > 1 ||
    typeof quote.quoteRequired !== 'boolean' ||
    !Array.isArray(quote.tvs) ||
    quote.tvs.length < 1 ||
    quote.tvs.length > 6
  ) {
    throw new Error('invalid_quote');
  }

  for (const tv of quote.tvs) {
    if (
      !tv ||
      (
        tv.family !== 'standard_tv' &&
        tv.family !== 'samsung_frame'
      ) ||
      !tv.selection ||
      typeof tv.selection !== 'object' ||
      Array.isArray(tv.selection)
    ) {
      throw new Error('invalid_quote');
    }
  }

  let subtotalCents: number | null = null;
  let totalCents: number | null = null;
  let discountCents: number | null = null;

  if (quote.quoteRequired) {
    if (
      quote.subtotal !== null ||
      quote.total !== null
    ) {
      throw new Error('invalid_quote_amounts');
    }
  } else {
    if (
      !Number.isInteger(quote.subtotal) ||
      !Number.isInteger(quote.total) ||
      (quote.subtotal as number) < 0 ||
      (quote.total as number) < 0 ||
      (quote.total as number) > (quote.subtotal as number)
    ) {
      throw new Error('invalid_quote_amounts');
    }

    subtotalCents = (quote.subtotal as number) * 100;
    totalCents = (quote.total as number) * 100;
    discountCents = subtotalCents - totalCents;
  }

  const families = new Set(
    quote.tvs.map((tv) => tv.family),
  );

  const orderType =
    families.size > 1
      ? 'mixed'
      : quote.tvs[0].family;

  return {
    quoteId: payload.quoteId ?? crypto.randomUUID(),
    phone: payload.phone,
    sourcePage,
    quote,
    orderType,
    subtotalCents,
    discountCents,
    totalCents,
    customer,
  };
}

async function upsertCalculatorLead(
  db: D1Database,
  payload: CalculatorLeadPayload,
): Promise<string> {
  const lead = validateCalculatorLead(payload);

  await db
    .prepare(
      `
        INSERT INTO calculator_leads (
          quote_id,
          created_at,
          updated_at,
          phone_e164,
          source_page,
          status,
          tv_count,
          order_type,
          configuration_json,
          subtotal_cents,
          multi_tv_percent,
          discount_cents,
          total_cents,
          pricing_version,
          customer_name,
          service_address,
          service_address2,
          service_city,
          service_state,
          customer_notes
        )
        VALUES (
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          ?,
          ?,
          'calculated',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
        ON CONFLICT(quote_id) DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP,
          phone_e164 = excluded.phone_e164,
          source_page = excluded.source_page,
          status = CASE
            WHEN calculator_leads.status = 'booked'
              THEN 'booked'
            WHEN calculator_leads.status = 'booking_started'
              THEN 'booking_started'
            ELSE 'calculated'
          END,
          tv_count = excluded.tv_count,
          order_type = excluded.order_type,
          configuration_json = excluded.configuration_json,
          subtotal_cents = excluded.subtotal_cents,
          multi_tv_percent = excluded.multi_tv_percent,
          discount_cents = excluded.discount_cents,
          total_cents = excluded.total_cents,
          pricing_version = excluded.pricing_version,
          customer_name = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.customer_name
            ELSE calculator_leads.customer_name
          END,
          service_address = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.service_address
            ELSE calculator_leads.service_address
          END,
          service_address2 = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.service_address2
            ELSE calculator_leads.service_address2
          END,
          service_city = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.service_city
            ELSE calculator_leads.service_city
          END,
          service_state = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.service_state
            ELSE calculator_leads.service_state
          END,
          customer_notes = CASE
            WHEN excluded.service_state IS NOT NULL
              THEN excluded.customer_notes
            ELSE calculator_leads.customer_notes
          END
      `,
    )
    .bind(
      lead.quoteId,
      lead.phone,
      lead.sourcePage,
      lead.quote.tvs.length,
      lead.orderType,
      JSON.stringify(lead.quote),
      lead.subtotalCents,
      lead.quote.multiTvPercent,
      lead.discountCents,
      lead.totalCents,
      lead.quote.pricingVersion,
      lead.customer?.name ?? null,
      lead.customer?.streetAddress ?? null,
      lead.customer?.address2 ?? null,
      lead.customer?.city ?? null,
      lead.customer?.state ?? null,
      lead.customer?.notes ?? null,
    )
    .run();

  return lead.quoteId;
}


type PublicPackage = {
  packageId: string;
  name: string;
  description: string;
  priceCents: number;
  pricingFamily: string;
  minQuantity: number | null;
  maxQuantity: number | null;
};

function isPublishedPackageQuantity(
  value: unknown,
): value is number | null {
  return (
    value === null ||
    (
      typeof value === 'number' &&
      Number.isInteger(value)
    )
  );
}

async function loadPublishedPackages(
  env: Env,
): Promise<{
  version: string;
  packages: PublicPackage[];
}> {
  const adminResponse =
    await env.NORTHLINE_ADMIN.fetch(
      new Request(
        'https://northline-admin/internal/published-packages',
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'x-northline-internal-token':
              env.INTERNAL_API_TOKEN,
          },
        },
      ),
    );

  const raw: unknown =
    await adminResponse.json()
      .catch(() => null);

  if (
    !adminResponse.ok ||
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw)
  ) {
    throw new Error(
      'published_packages_unavailable',
    );
  }

  const body =
    raw as Record<string, unknown>;

  if (
    body.ok !== true ||
    typeof body.version !== 'string' ||
    !Array.isArray(body.packages)
  ) {
    throw new Error(
      'invalid_published_packages_response',
    );
  }

  const packages: PublicPackage[] =
    body.packages.map((value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      ) {
        throw new Error(
          'invalid_published_package',
        );
      }

      const item =
        value as Record<string, unknown>;

      if (
        typeof item.packageId !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.description !== 'string' ||
        typeof item.priceCents !== 'number' ||
        !Number.isInteger(item.priceCents) ||
        item.priceCents < 0 ||
        typeof item.pricingFamily !== 'string' ||
        !isPublishedPackageQuantity(
          item.minQuantity,
        ) ||
        !isPublishedPackageQuantity(
          item.maxQuantity,
        )
      ) {
        throw new Error(
          'invalid_published_package',
        );
      }

      return {
        packageId: item.packageId,
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        pricingFamily: item.pricingFamily,
        minQuantity: item.minQuantity,
        maxQuantity: item.maxQuantity,
      };
    });

  return {
    version: body.version,
    packages,
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname === '/api/google-reviews' &&
      request.method === 'GET'
    ) {
      const placeId = 'ChIJESIhyxkTgCYRjAKLpYzJ69A';

      const googleUrl =
        'https:' +
        '//places.googleapis.com/v1/places/' +
        encodeURIComponent(placeId);

      const response = await fetch(googleUrl, {
        headers: {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'rating,userRatingCount,reviews',
        },
      });

      if (!response.ok) {
        console.error(
          'Google Places reviews request failed:',
          response.status,
        );

        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Reviews unavailable',
          }),
          {
            status: 502,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          },
        );
      }

      const data = await response.json() as {
        rating?: number;
        userRatingCount?: number;
        reviews?: Array<{
          rating?: number;
          text?: {
            text?: string;
          };
          authorAttribution?: {
            displayName?: string;
            uri?: string;
            photoUri?: string;
          };
          publishTime?: string;
          relativePublishTimeDescription?: string;
          googleMapsUri?: string;
        }>;
      };

      const reviews = (data.reviews ?? [])
        .slice(0, 3)
        .map((review) => ({
          rating: review.rating ?? null,
          text: review.text?.text ?? '',
          author: review.authorAttribution?.displayName ?? '',
          authorUri: review.authorAttribution?.uri ?? null,
          photoUri: review.authorAttribution?.photoUri ?? null,
          publishTime: review.publishTime ?? null,
          relativeTime:
            review.relativePublishTimeDescription ?? '',
          googleMapsUri: review.googleMapsUri ?? null,
        }));

      return new Response(
        JSON.stringify({
          ok: true,
          rating: data.rating ?? null,
          reviewCount: data.userRatingCount ?? null,
          reviews,
          attribution: 'Google Maps',
          ordering: 'Google relevance',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }



    if (
      url.pathname === '/api/calculator-lead' &&
      request.method === 'POST'
    ) {
      try {
        const contentLength =
          Number(request.headers.get('content-length') ?? 0);

        if (
          Number.isFinite(contentLength) &&
          contentLength > 65536
        ) {
          return jsonResponse(
            {
              ok: false,
              error: 'Request too large',
            },
            413,
          );
        }

        const payload =
          await request.json() as CalculatorLeadPayload;

        const quoteId =
          await upsertCalculatorLead(env.DB, payload);

        return new Response(
          JSON.stringify({ quoteId }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'invalid_request';

        if (
          message === 'invalid_phone' ||
          message === 'invalid_quote_id' ||
          message === 'invalid_quote' ||
          message === 'invalid_quote_amounts' ||
          message === 'invalid_customer'
        ) {
          return jsonResponse(
            {
              ok: false,
              error: message,
            },
            400,
          );
        }

        console.error(
          'Calculator lead persistence failed',
        );

        return jsonResponse(
          {
            ok: false,
            error: 'Lead could not be saved',
          },
          500,
        );
      }
    }

    if (
      url.pathname === '/api/packages' &&
      request.method === 'GET'
    ) {
      try {
        const published =
          await loadPublishedPackages(env);

        return jsonResponse({
          ok: true,
          version: published.version,
          packages: published.packages,
        });
      } catch (error) {
        console.error(
          'Published packages lookup failed:',
          error instanceof Error
            ? error.message
            : 'unknown_error',
        );

        return jsonResponse(
          {
            ok: false,
            error: 'Packages unavailable',
          },
          503,
        );
      }
    }

    if (
      url.pathname === '/api/package-booking' &&
      request.method === 'POST'
    ) {
      try {
        const contentLength =
          Number(
            request.headers.get(
              'content-length',
            ) ?? 0,
          );

        if (
          Number.isFinite(contentLength) &&
          contentLength > 65536
        ) {
          return jsonResponse(
            {
              ok: false,
              error: 'request_too_large',
            },
            413,
          );
        }

        const raw =
          await request.json() as
            PackageBookingPayload;

        const booking =
          validatePackageBooking(raw);

        const adminResponse =
          await env.NORTHLINE_ADMIN.fetch(
            new Request(
              'https://northline-admin/internal/package-booking',
              {
                method: 'POST',
                headers: {
                  'content-type':
                    'application/json',
                  'x-northline-internal-token':
                    env.INTERNAL_API_TOKEN,
                },
                body: JSON.stringify({
                  source: 'package',
                  requestId:
                    booking.requestId,
                  packageId:
                    booking.packageId,
                  phone:
                    booking.phone,
                  date:
                    booking.date,
                  windowCode:
                    booking.windowCode,
                  customer:
                    booking.customer,
                }),
              },
            ),
          );

        const adminBody =
          await adminResponse.text();

        return new Response(
          adminBody,
          {
            status: adminResponse.status,
            headers: {
              'content-type':
                'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'invalid_booking_request';

        if (message === 'package_not_found') {
          return jsonResponse(
            {
              ok: false,
              error: message,
            },
            404,
          );
        }

        if (
          message === 'invalid_booking_request' ||
          message === 'invalid_request_id' ||
          message === 'invalid_package_id' ||
          message === 'invalid_phone' ||
          message === 'invalid_booking_date' ||
          message === 'invalid_window' ||
          message === 'invalid_customer'
        ) {
          return jsonResponse(
            {
              ok: false,
              error: message,
            },
            400,
          );
        }

        console.error(
          'Package booking transport failed',
        );

        return jsonResponse(
          {
            ok: false,
            error: 'booking_request_failed',
          },
          500,
        );
      }
    }

    if (
      url.pathname === '/api/calculator-booking' &&
      request.method === 'POST'
    ) {
      try {
        const contentLength =
          Number(
            request.headers.get(
              'content-length',
            ) ?? 0,
          );

        if (
          Number.isFinite(contentLength) &&
          contentLength > 65536
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: 'request_too_large',
            }),
            {
              status: 413,
              headers: {
                'content-type':
                  'application/json; charset=utf-8',
                'cache-control':
                  'no-store',
              },
            },
          );
        }

        const raw =
          await request.json() as
            CalculatorBookingPayload;

        const booking =
          validateCalculatorBooking(raw);

        const existingLead =
          await env.DB
            .prepare(
              `
                SELECT phone_e164
                FROM calculator_leads
                WHERE quote_id = ?
                LIMIT 1
              `,
            )
            .bind(booking.quoteId)
            .first<{
              phone_e164: string;
            }>();

        if (
          !existingLead ||
          existingLead.phone_e164 !==
            booking.phone
        ) {
          throw new Error(
            'invalid_quote_id',
          );
        }

        /*
         * Monetary fields from the browser are ignored.
         * Rebuild the quote from current Published
         * pricing before anything reaches Admin.
         */
        const canonicalQuote =
          await canonicalRepriceCalculatorQuote(
            env.DB,
            booking.tvs,
          );

        const adminResponse =
          await env.NORTHLINE_ADMIN.fetch(
            new Request(
              'https://northline-admin/internal/calculator-booking',
              {
                method: 'POST',
                headers: {
                  'content-type':
                    'application/json',
                  'x-northline-internal-token':
                    env.INTERNAL_API_TOKEN,
                },
                body: JSON.stringify({
                  source: 'calculator',
                  quoteId:
                    booking.quoteId,
                  phone: booking.phone,
                  date: booking.date,
                  windowCode:
                    booking.windowCode,
                  customer:
                    booking.customer,
                  canonicalQuote,
                }),
              },
            ),
          );

        const adminBody =
          await adminResponse.text();

        if (!adminResponse.ok) {
          console.error(
            'Admin calculator booking transport failed:',
            adminResponse.status,
          );

          return new Response(
            JSON.stringify({
              ok: false,
              error:
                'booking_service_unavailable',
            }),
            {
              status: 502,
              headers: {
                'content-type':
                  'application/json; charset=utf-8',
                'cache-control':
                  'no-store',
              },
            },
          );
        }

        /*
         * Admin currently returns transport_only.
         * There is deliberately no bookingId yet.
         */
        return new Response(
          adminBody,
          {
            status: 200,
            headers: {
              'content-type':
                'application/json; charset=utf-8',
              'cache-control':
                'no-store',
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'invalid_booking_request';

        if (
          message ===
            'invalid_booking_request' ||
          message === 'invalid_quote_id' ||
          message === 'invalid_phone' ||
          message ===
            'invalid_booking_date' ||
          message === 'invalid_window' ||
          message === 'invalid_customer' ||
          message === 'invalid_quote' ||
          message === 'incomplete_quote' ||
          message ===
            'pricing_item_not_found'
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: message,
            }),
            {
              status: 400,
              headers: {
                'content-type':
                  'application/json; charset=utf-8',
                'cache-control':
                  'no-store',
              },
            },
          );
        }

        if (
          message ===
            'published_pricing_not_found' ||
          message ===
            'client_lift_rule_not_found'
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                'pricing_unavailable',
            }),
            {
              status: 503,
              headers: {
                'content-type':
                  'application/json; charset=utf-8',
                'cache-control':
                  'no-store',
              },
            },
          );
        }

        console.error(
          'Calculator booking transport failed',
        );

        return new Response(
          JSON.stringify({
            ok: false,
            error:
              'booking_request_failed',
          }),
          {
            status: 500,
            headers: {
              'content-type':
                'application/json; charset=utf-8',
              'cache-control':
                'no-store',
            },
          },
        );
      }
    }

    if (
      url.pathname === '/api/calculator-pricing' &&
      request.method === 'GET'
    ) {
      try {
        const pricing = await loadCalculatorPricing(env.DB);

        if (!pricing) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: 'Published pricing unavailable',
            }),
            {
              status: 503,
              headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              },
            },
          );
        }

        return new Response(
          JSON.stringify(pricing),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          },
        );
      } catch (error) {
        console.error(
          'Calculator pricing request failed:',
          error,
        );

        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Pricing unavailable',
          }),
          {
            status: 500,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          },
        );
      }
    }

    if (
      url.pathname === '/api/calculator-availability' &&
      request.method === 'GET'
    ) {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

      if (
        !from ||
        !to ||
        !dateOnly.test(from) ||
        !dateOnly.test(to) ||
        from > to
      ) {
        return jsonResponse(
          {
            ok: false,
            error: 'Invalid date range',
          },
          400,
        );
      }

      const availability =
        await readJson<HomeAvailabilitySnapshot>(
          env.HOME_STATE,
          'home:availability',
        );

      if (!availability?.calculator) {
        return jsonResponse(
          {
            ok: false,
            error: 'Calculator availability unavailable',
          },
          503,
        );
      }

      const result = Object.fromEntries(
        Object.entries(availability.calculator).filter(
          ([date]) => date >= from && date <= to,
        ),
      );

      return new Response(
        JSON.stringify(result),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }

    if (
      url.pathname === '/api/home-state' &&
      request.method === 'GET'
    ) {
      const [pricing, availability] = await Promise.all([
        readJson<HomePricingSnapshot>(
          env.HOME_STATE,
          'home:pricing',
        ),
        readJson<HomeAvailabilitySnapshot>(
          env.HOME_STATE,
          'home:availability',
        ),
      ]);

      if (!pricing || !availability) {
        return jsonResponse(
          {
            ok: false,
            error: 'Home state unavailable',
          },
          503,
        );
      }

      const multipleTv = Object.fromEntries(
        Object.entries(pricing.multipleTv).map(
          ([key, value]) => [
            key,
            {
              quantity: value.quantity,
              priceCents: value.priceCents,
            },
          ],
        ),
      );

      return jsonResponse({
        ok: true,
        pricing: {
          oneTv: pricing.oneTv,
          multipleTv,
        },
        availability: {
          today: availability.today,
          next: availability.next,
        },
      });
    }

    if (
      request.method === 'GET' &&
      url.pathname.startsWith(
        '/api/work/media/',
      )
    ) {
      return servePublicWorkMedia(
        request,
        env,
        url.pathname,
      );
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse(
        {
          ok: false,
          error: 'Not found',
        },
        404,
      );
    }


    if (
      request.method === 'GET' &&
      (
        url.pathname ===
          '/service-area' ||
        url.pathname ===
          '/service-area/' ||
        url.pathname ===
          '/service-area/index.html'
      )
    ) {
      return serveServiceArea(
        request,
        env,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
