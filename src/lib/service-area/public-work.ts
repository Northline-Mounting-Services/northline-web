interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface ServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

interface ServiceAreaRuntime {
  ASSETS: AssetFetcher;
  NORTHLINE_ADMIN: ServiceFetcher;
  INTERNAL_API_TOKEN: string;
}

type PublicWorkItem = {
  city: string;
  area: string;
  image: string;
  description: string;
  ageLabel: string;
};

const PUBLIC_WORK_AREA_ORDER = [
  'North Fulton',
  'Perimeter / North DeKalb',
  'Cobb',
  'Cherokee / 575',
  'Forsyth / 400 North',
  'Gwinnett / 85',
  'Northeast',
] as const;

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPublicWorkItem(
  value: unknown,
): value is PublicWorkItem {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.city === 'string' &&
    typeof value.area === 'string' &&
    typeof value.image === 'string' &&
    value.image.startsWith(
      '/api/work/media/',
    ) &&
    typeof value.description === 'string' &&
    typeof value.ageLabel === 'string'
  );
}

async function loadPublicWork(
  env: ServiceAreaRuntime,
): Promise<PublicWorkItem[]> {
  const adminResponse =
    await env.NORTHLINE_ADMIN.fetch(
      new Request(
        'https://northline-admin/internal/public-work',
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
    !isObject(raw) ||
    raw.ok !== true ||
    !Array.isArray(raw.items) ||
    !raw.items.every(
      isPublicWorkItem,
    )
  ) {
    throw new Error(
      'public_work_unavailable',
    );
  }

  return raw.items;
}

function escapeHtml(
  value: string,
): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function workHeadingId(
  city: string,
  index: number,
): string {
  const slug =
    city
      .normalize('NFKD')
      .replace(
        /[\u0300-\u036f]/g,
        '',
      )
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        '-',
      )
      .replace(
        /^-+|-+$/g,
        '',
      );

  return `nl-work-${slug || 'city'}-${index}`;
}

function renderPublicWork(
  items: PublicWorkItem[],
): string {
  if (items.length === 0) {
    return '';
  }

  const grouped =
    new Map<
      string,
      PublicWorkItem[]
    >();

  for (const item of items) {
    const current =
      grouped.get(item.area) ?? [];

    current.push(item);
    grouped.set(
      item.area,
      current,
    );
  }

  const areas =
    [...grouped.keys()]
      .sort((left, right) => {
        const leftIndex =
          PUBLIC_WORK_AREA_ORDER
            .indexOf(
              left as
                typeof PUBLIC_WORK_AREA_ORDER[number],
            );

        const rightIndex =
          PUBLIC_WORK_AREA_ORDER
            .indexOf(
              right as
                typeof PUBLIC_WORK_AREA_ORDER[number],
            );

        if (
          leftIndex === -1 &&
          rightIndex === -1
        ) {
          return left.localeCompare(
            right,
          );
        }

        if (leftIndex === -1) {
          return 1;
        }

        if (rightIndex === -1) {
          return -1;
        }

        return leftIndex - rightIndex;
      });

  let itemIndex = 0;

  const areaHtml =
    areas.map((area, areaIndex) => {
      const cityItems =
        grouped.get(area) ?? [];

      const cityHtml =
        cityItems
          .sort((left, right) =>
            left.city.localeCompare(
              right.city,
            ),
          )
          .map((item) => {
            itemIndex += 1;

            const headingId =
              workHeadingId(
                item.city,
                itemIndex,
              );

            return `
<section
  class="nl-sa-work__city"
  aria-labelledby="${headingId}"
>
  <h4
    class="nl-sa-work__city-name"
    id="${headingId}"
  >${escapeHtml(item.city)}</h4>

  <div class="nl-sa-work__media">
    <img
      src="${escapeHtml(item.image)}"
      alt="TV mounting installation in ${escapeHtml(item.city)}, Georgia"
      loading="lazy"
      decoding="async"
    />
  </div>

  <p class="nl-sa-work__description">${escapeHtml(item.description)}</p>

  <p class="nl-sa-work__age">${escapeHtml(item.ageLabel)}</p>
</section>`;
          })
          .join('');

      return `
<section class="nl-sa-work__area">
  <h3 class="nl-sa-work__area-name">
    <span
      class="nl-sa-work__area-index"
      aria-hidden="true"
    >${String(areaIndex + 1).padStart(2, '0')}</span>
    <span>${escapeHtml(area)}</span>
  </h3>

  <div class="nl-sa-work__cities">
    ${cityHtml}
  </div>
</section>`;
    })
    .join('');

  return `
<section
  class="nl-sa-work"
  aria-labelledby="nl-sa-work-title"
>
  <h2
    class="nl-sa-work__title"
    id="nl-sa-work-title"
  >RECENT WORK BY AREA</h2>

  <div class="nl-sa-work__areas">
    ${areaHtml}
  </div>
</section>`;
}

export async function serveServiceArea(
  request: Request,
  env: ServiceAreaRuntime,
): Promise<Response> {
  const assetResponse =
    await env.ASSETS.fetch(request);

  if (!assetResponse.ok) {
    return assetResponse;
  }

  const contentType =
    assetResponse.headers.get(
      'content-type',
    ) ?? '';

  if (
    !contentType.includes(
      'text/html',
    )
  ) {
    return assetResponse;
  }

  let html =
    await assetResponse.clone().text();

  const slot =
    '<div data-public-work-slot></div>';

  if (!html.includes(slot)) {
    return assetResponse;
  }

  try {
    const items =
      await loadPublicWork(env);

    html = html.replace(
      slot,
      renderPublicWork(items),
    );
  } catch (error) {
    console.error(
      'Service Area Work lookup failed:',
      error instanceof Error
        ? error.message
        : 'unknown_error',
    );

    html = html.replace(
      slot,
      '',
    );
  }

  const headers =
    new Headers(
      assetResponse.headers,
    );

  headers.delete(
    'content-length',
  );
  headers.delete(
    'content-encoding',
  );
  headers.delete('etag');
  headers.set(
    'cache-control',
    'no-store',
  );

  return new Response(
    html,
    {
      status:
        assetResponse.status,
      statusText:
        assetResponse.statusText,
      headers,
    },
  );
}

export async function servePublicWorkMedia(
  request: Request,
  env: ServiceAreaRuntime,
  pathname: string,
): Promise<Response> {
  const prefix =
    '/api/work/media/';

  const encodedKey =
    pathname.slice(
      prefix.length,
    );

  if (!encodedKey) {
    return new Response(
      'Not found',
      { status: 404 },
    );
  }

  let decodedKey = '';

  try {
    decodedKey =
      decodeURIComponent(
        encodedKey,
      );
  } catch {
    return new Response(
      'Not found',
      { status: 404 },
    );
  }

  if (
    decodedKey.includes('..') ||
    !decodedKey.startsWith(
      'work/',
    )
  ) {
    return new Response(
      'Not found',
      { status: 404 },
    );
  }

  const adminResponse =
    await env.NORTHLINE_ADMIN.fetch(
      new Request(
        `https://northline-admin/api/work/media/${encodedKey}`,
        {
          method: 'GET',
          headers: {
            accept:
              request.headers.get(
                'accept',
              ) ?? '*/*',
          },
        },
      ),
    );

  if (!adminResponse.ok) {
    return new Response(
      null,
      {
        status:
          adminResponse.status,
        headers: {
          'cache-control':
            'no-store',
        },
      },
    );
  }

  const headers =
    new Headers();

  const contentType =
    adminResponse.headers.get(
      'content-type',
    );

  if (contentType) {
    headers.set(
      'content-type',
      contentType,
    );
  }

  headers.set(
    'cache-control',
    'public, max-age=3600',
  );

  return new Response(
    adminResponse.body,
    {
      status:
        adminResponse.status,
      headers,
    },
  );
}
