/**
 * Northline calculator inventory — the single identifier vocabulary.
 *
 * Pricing identity is family + groupCode + itemCode, e.g.
 *   { family: 'standard_tv', groupCode: 'mount', itemCode: 'customer_mount' }
 *
 * These codes ARE the Northline Admin / published-pricing codes. There is no
 * mapping table and no second vocabulary. Nothing in this file is a price.
 *
 * Client lift assistance is pricing CONTEXT, serialized as `clientLift`
 * (boolean). It has no groupCode and no itemCode — see CLIENT_LIFT below.
 */

export const FAMILIES = [
  { family: 'standard_tv', label: 'Standard TV', note: 'Any brand or size, mounted to your wall.' },
  { family: 'samsung_frame', label: 'Samsung Frame', note: 'Frame-specific fit, One Connect handling, bezel work.' }
];

/** Pricing context, not a pricing item. Standard TV only, sizes over 65"
 *  that are automatically priced. Over 90" is a custom-quote size. */
export const CLIENT_LIFT = {
  label: 'Client lift assistance',
  hint: 'someone at home can help lift',
  appliesToFamily: 'standard_tv',
  appliesWhenTvSize: ['66_77', '78_90'],
  options: [
    { value: true, label: 'Yes' },
    { value: false, label: 'No' }
  ]
};

export const INVENTORY = {
  standard_tv: {
    label: 'Standard TV',
    /* `clientLift: true` marks where the conditional context control renders.
       It is not a group and carries no codes. */
    sections: [
      { id: 'tv_mount', title: 'TV & mount', hint: 'TV size, mount, lift assistance', groups: ['tv_size', 'mount'], clientLift: true },
      { id: 'wall_location', title: 'Wall & location', hint: 'What we drill into, where it hangs', groups: ['wall', 'location'] },
      { id: 'wires', title: 'Wires', hint: 'Wire finish and cable add-ons', groups: ['wire', 'cable'] },
      { id: 'extras', title: 'Extras', hint: 'Optional add-ons', groups: ['addons'] }
    ],
    groups: {
      tv_size: {
        label: 'TV size',
        items: [
          { itemCode: 'up_to_50', label: 'Up to 50"' },
          { itemCode: '51_65', label: '51–65"' },
          { itemCode: '66_77', label: '66–77"' },
          { itemCode: '78_90', label: '78–90"' },
          { itemCode: 'over_90', label: 'Over 90"' }
        ]
      },
      mount: {
        label: 'Mount options',
        items: [
          { itemCode: 'customer_mount', label: 'I already have the mount' },
          { itemCode: 'fixed', label: 'Fixed mount' },
          { itemCode: 'tilting', label: 'Tilting mount' },
          { itemCode: 'dual_arm', label: 'Dual-arm heavy-duty full-motion mount' },
          { itemCode: 'mantelmount', label: 'MantelMount / pull-down fireplace mount' }
        ]
      },
      wall: {
        label: 'Wall type',
        items: [
          { itemCode: 'drywall', label: 'Drywall / wood studs' },
          { itemCode: 'lath_plaster', label: 'Lath and plaster' },
          { itemCode: 'metal_studs', label: 'Metal studs' },
          { itemCode: 'masonry', label: 'Brick / concrete / cinderblock' },
          { itemCode: 'stone_tile', label: 'Natural stone / marble / porcelain tile' }
        ]
      },
      location: {
        label: 'Installation location',
        items: [
          { itemCode: 'regular_wall', label: 'Regular wall' },
          { itemCode: 'fireplace', label: 'Over fireplace' },
          { itemCode: 'high_wall', label: 'High wall over 10 ft' },
          { itemCode: 'outdoor', label: 'Outdoor covered-patio TV mounting' },
          { itemCode: 'ceiling', label: 'Ceiling mount installation' }
        ]
      },
      wire: {
        label: 'Wire finish',
        items: [
          { itemCode: 'visible', label: 'Wires visible' },
          { itemCode: 'cord_cover', label: 'Cord cover' },
          { itemCode: 'low_voltage', label: 'In-wall low-voltage cable pass-through' },
          { itemCode: 'power_bridge', label: 'In-wall power bridge kit setup' }
        ]
      },
      cable: {
        label: 'Optional cable add-ons',
        hint: 'optional · choose any',
        multi: true,
        items: [
          { itemCode: 'hdmi_12ft', label: 'HDMI 2.1 4K/8K cable, 12 ft' },
          { itemCode: 'in_wall_rated', label: 'In-wall-rated HDMI / optical / data cable' }
        ]
      },
      addons: {
        label: 'Other add-ons',
        hint: 'optional · choose any',
        multi: true,
        items: [
          { itemCode: 'soundbar', label: 'Soundbar mounting' },
          { itemCode: 'surround_51', label: 'Surround sound 5.1 speaker positioning' },
          { itemCode: 'subwoofer', label: 'Subwoofer placement / basic audio setup' },
          { itemCode: 'media_shelf', label: 'Media shelf or gaming console wall mount' },
          { itemCode: 'device_concealment', label: 'Apple TV / Roku / small box concealment behind TV' },
          { itemCode: 'led', label: 'LED ambient backlighting installation' }
        ]
      }
    }
  },

  samsung_frame: {
    label: 'Samsung Frame',
    sections: [
      { id: 'screen_wall', title: 'Screen & wall', hint: 'Screen size, wall surface', groups: ['screen_size', 'wall'] },
      { id: 'one_connect_location', title: 'One Connect & location', hint: 'Box handling, where it hangs', groups: ['one_connect', 'location'] },
      { id: 'extras', title: 'Extras', hint: 'Bezel and other add-ons', groups: ['addons'] }
    ],
    groups: {
      screen_size: {
        label: 'Screen size',
        items: [
          { itemCode: '32_43', label: '32–43"' },
          { itemCode: '50_55', label: '50–55"' },
          { itemCode: '65', label: '65"' },
          { itemCode: '75', label: '75"' },
          { itemCode: '85', label: '85"' },
          { itemCode: '98', label: '98"' }
        ]
      },
      wall: {
        label: 'Wall surface',
        items: [
          { itemCode: 'drywall', label: 'Drywall / wood studs' },
          { itemCode: 'lath_plaster', label: 'Lath and plaster' },
          { itemCode: 'metal_studs', label: 'Metal studs' },
          { itemCode: 'masonry', label: 'Brick / concrete / cinderblock' },
          { itemCode: 'stone_tile', label: 'Natural stone / marble / porcelain tile' }
        ]
      },
      one_connect: {
        label: 'One Connect / box handling',
        items: [
          { itemCode: 'wireless', label: 'Frame Pro / Wireless One Connect — no in-wall box routing' },
          { itemCode: 'pass_through', label: 'In-wall cable pass-through' },
          { itemCode: 'recessed_box', label: 'Flush-wall recessed box with approved media enclosure' }
        ]
      },
      location: {
        label: 'Installation location',
        items: [
          { itemCode: 'standard', label: 'Standard wall' },
          { itemCode: 'fireplace', label: 'Above fireplace' },
          { itemCode: 'high_wall', label: 'High wall over 10 ft' },
          { itemCode: 'stair_wall', label: 'Stair wall / difficult access' },
          { itemCode: 'niche', label: 'Built-in niche / recessed wall area' }
        ]
      },
      addons: {
        label: 'Add-ons',
        hint: 'optional · choose any',
        multi: true,
        items: [
          { itemCode: 'standard_bezel', label: 'Standard Samsung bezel installation' },
          { itemCode: 'custom_bezel', label: 'Custom bezel installation' },
          { itemCode: 'soundbar', label: 'Soundbar mounting' },
          { itemCode: 'device_concealment', label: 'Apple TV / Roku / small device concealment' }
        ]
      }
    }
  }
};

/** Required single-select groups. `cable` and `addons` are optional multi-select
 *  and may legitimately be empty — there is no "None" pricing item. */
export const REQUIRED_GROUPS = {
  standard_tv: ['tv_size', 'mount', 'wall', 'location', 'wire'],
  samsung_frame: ['screen_size', 'wall', 'one_connect', 'location']
};

/** Exactly three arrival windows, Monday–Saturday, Eastern Time. */
export const ARRIVAL_WINDOWS = [
  { windowCode: 'am', label: '8–11 AM' },
  { windowCode: 'mid', label: '11 AM–2 PM' },
  { windowCode: 'pm', label: '2–5 PM' }
];

export const MAX_TVS = 6;
export const SMS_RECIPIENT = '+14704709331';
export const BOOKING_SUCCESS_URL = '/paul';

export function clientLiftApplies(family, selection) {
  if (family !== CLIENT_LIFT.appliesToFamily) return false;
  return CLIENT_LIFT.appliesWhenTvSize.includes(selection.tv_size);
}

export function itemLabel(family, groupCode, itemCode) {
  const group = INVENTORY[family].groups[groupCode];
  const item = group && group.items.find((i) => i.itemCode === itemCode);
  return item ? item.label : '';
}
