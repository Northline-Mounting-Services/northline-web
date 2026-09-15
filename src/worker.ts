import type {
  KVNamespace,
} from '@cloudflare/workers-types';

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  HOME_STATE: KVNamespace;
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
