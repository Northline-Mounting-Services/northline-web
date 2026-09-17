import type { D1Database } from '@cloudflare/workers-types';

import {
  INVENTORY,
  MAX_TVS,
  REQUIRED_GROUPS,
  clientLiftApplies,
} from '../../data/calculator-inventory.js';

export type CalculatorFamily =
  | 'standard_tv'
  | 'samsung_frame';

export type CalculatorOrderType =
  | CalculatorFamily
  | 'mixed';

export interface CanonicalQuoteTvInput {
  family: CalculatorFamily;
  selection: Record<string, string | string[]>;
  clientLift?: boolean;
}

interface PricingItemRow {
  family: CalculatorFamily;
  group_code: string;
  item_code: string;
  price_cents: number;
  quote_required: number;
}

interface PricingRuleRow {
  rule_code: string;
  value_type: string;
  value_int: number;
  min_quantity: number | null;
  max_quantity: number | null;
}

interface PricingVersionRow {
  id: number;
  version_key: string;
}

export interface CanonicalCalculatorQuote {
  pricingVersion: string;
  tvCount: number;
  orderType: CalculatorOrderType;
  configurationJson: string;
  quoteRequired: boolean;
  subtotalCents: number | null;
  multiTvPercent: number;
  discountCents: number | null;
  totalCents: number | null;
}

function validateTvShape(
  tv: CanonicalQuoteTvInput,
): void {
  if (
    !tv ||
    (tv.family !== 'standard_tv' &&
      tv.family !== 'samsung_frame') ||
    !tv.selection ||
    typeof tv.selection !== 'object' ||
    Array.isArray(tv.selection)
  ) {
    throw new Error('invalid_quote');
  }

  const familyDef = INVENTORY[tv.family];
  const groups = familyDef.groups as Record<
    string,
    {
      multi?: boolean;
      items: Array<{ itemCode: string }>;
    }
  >;

  for (const [groupCode, value] of Object.entries(
    tv.selection,
  )) {
    const group = groups[groupCode];

    if (!group) {
      throw new Error('invalid_quote');
    }

    const isMulti = group.multi === true;

    if (isMulti) {
      if (
        !Array.isArray(value) ||
        value.some(
          (itemCode) =>
            typeof itemCode !== 'string' ||
            !itemCode,
        )
      ) {
        throw new Error('invalid_quote');
      }

      if (
        new Set(value).size !== value.length
      ) {
        throw new Error('invalid_quote');
      }
    } else if (
      typeof value !== 'string' ||
      !value
    ) {
      throw new Error('invalid_quote');
    }

    const itemCodes = Array.isArray(value)
      ? value
      : [value];

    if (
      itemCodes.some(
        (itemCode) =>
          !group.items.some(
            (item) =>
              item.itemCode === itemCode,
          ),
      )
    ) {
      throw new Error('invalid_quote');
    }
  }

  for (const groupCode of REQUIRED_GROUPS[
    tv.family
  ]) {
    if (
      typeof tv.selection[groupCode] !==
        'string' ||
      !tv.selection[groupCode]
    ) {
      throw new Error('incomplete_quote');
    }
  }

  const liftApplies = clientLiftApplies(
    tv.family,
    tv.selection,
  );

  if (
    tv.clientLift !== undefined &&
    typeof tv.clientLift !== 'boolean'
  ) {
    throw new Error('invalid_quote');
  }

  if (
    liftApplies &&
    typeof tv.clientLift !== 'boolean'
  ) {
    throw new Error('incomplete_quote');
  }

  if (
    !liftApplies &&
    tv.clientLift !== undefined
  ) {
    throw new Error('invalid_quote');
  }
}

export async function canonicalRepriceCalculatorQuote(
  db: D1Database,
  tvs: CanonicalQuoteTvInput[],
): Promise<CanonicalCalculatorQuote> {
  if (
    !Array.isArray(tvs) ||
    tvs.length < 1 ||
    tvs.length > MAX_TVS
  ) {
    throw new Error('invalid_quote');
  }

  for (const tv of tvs) {
    validateTvShape(tv);
  }

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
    .first<PricingVersionRow>();

  if (!version) {
    throw new Error(
      'published_pricing_not_found',
    );
  }

  const [itemResult, ruleResult] =
    await Promise.all([
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
              AND family IN (
                'standard_tv',
                'samsung_frame'
              )
          `,
        )
        .bind(version.id)
        .all<PricingItemRow>(),
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
          `,
        )
        .bind(version.id)
        .all<PricingRuleRow>(),
    ]);

  const items = new Map<
    string,
    PricingItemRow
  >();

  for (const item of itemResult.results) {
    items.set(
      `${item.family}.${item.group_code}.${item.item_code}`,
      item,
    );
  }

  const clientLiftRule =
    ruleResult.results.find(
      (rule) =>
        rule.rule_code === 'client_lift' &&
        rule.value_type === 'cents',
    );

  let subtotalCents = 0;
  let quoteRequired = false;

  for (const tv of tvs) {
    for (const [groupCode, picked] of Object.entries(
      tv.selection,
    )) {
      const itemCodes = Array.isArray(picked)
        ? picked
        : [picked];

      for (const itemCode of itemCodes) {
        const item = items.get(
          `${tv.family}.${groupCode}.${itemCode}`,
        );

        if (!item) {
          throw new Error(
            'pricing_item_not_found',
          );
        }

        if (item.quote_required) {
          quoteRequired = true;
        } else {
          subtotalCents += item.price_cents;
        }
      }
    }

    const liftApplies = clientLiftApplies(
      tv.family,
      tv.selection,
    );

    if (liftApplies) {
      if (!clientLiftRule) {
        throw new Error(
          'client_lift_rule_not_found',
        );
      }

      if (tv.clientLift === true) {
        subtotalCents +=
          clientLiftRule.value_int;
      }
    }
  }

  const multiTvRule =
    ruleResult.results
      .filter(
        (rule) =>
          rule.rule_code.startsWith(
            'multi_tv_',
          ) &&
          rule.value_type ===
            'basis_points' &&
          rule.value_int < 0 &&
          rule.min_quantity !== null &&
          tvs.length >=
            rule.min_quantity &&
          (rule.max_quantity === null ||
            tvs.length <=
              rule.max_quantity),
      )
      .sort(
        (a, b) =>
          (a.min_quantity ?? 0) -
          (b.min_quantity ?? 0),
      )[0];

  const multiTvPercent = multiTvRule
    ? -multiTvRule.value_int / 10000
    : 0;

  const roundedSubtotalCents =
    Math.round(subtotalCents / 100) * 100;

  const roundedTotalCents =
    Math.round(
      (subtotalCents / 100) *
        (1 - multiTvPercent),
    ) * 100;

  const discountCents =
    roundedSubtotalCents -
    roundedTotalCents;

  const families = new Set(
    tvs.map((tv) => tv.family),
  );

  const orderType: CalculatorOrderType =
    families.size > 1
      ? 'mixed'
      : tvs[0].family;

  return {
    pricingVersion: version.version_key,
    tvCount: tvs.length,
    orderType,
    configurationJson: JSON.stringify(tvs),
    quoteRequired,
    subtotalCents: quoteRequired
      ? null
      : roundedSubtotalCents,
    multiTvPercent,
    discountCents: quoteRequired
      ? null
      : discountCents,
    totalCents: quoteRequired
      ? null
      : roundedTotalCents,
  };
}
