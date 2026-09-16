import type {
  D1Database,
  KVNamespace,
} from '@cloudflare/workers-types';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  HOME_STATE: KVNamespace;
  DB: D1Database;
  GOOGLE_PLACES_API_KEY: string;
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

interface CalculatorLeadPayload {
  quoteId?: string | null;
  phone?: string;
  sourcePage?: string;
  quote?: CalculatorLeadQuote;
}

const E164_US_PHONE =
  /^\+1[2-9]\d{2}[2-9]\d{6}$/;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
          pricing_version
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
          pricing_version = excluded.pricing_version
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
    )
    .run();

  return lead.quoteId;
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
          message === 'invalid_quote_amounts'
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

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse(
        {
          ok: false,
          error: 'Not found',
        },
        404,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
