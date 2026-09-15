import type {
  KVNamespace,
} from '@cloudflare/workers-types';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  HOME_STATE: KVNamespace;
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
