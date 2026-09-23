/**
 * Schematic presentation topology only. Coordinates are SVG positions, not
 * GPS data and not a canonical service-coverage database.
 */
export const HUB = { name: 'Cumming', x: 500, y: 340 };

export const ROUTES = [
  {
    id: 'north-fulton',
    index: '01',
    label: 'North Fulton',
    cities: [
      { name: 'Alpharetta', x: 498, y: 446 },
      { name: 'Milton', x: 424, y: 408 },
      { name: 'Roswell', x: 486, y: 524 },
      { name: 'Johns Creek', x: 592, y: 482 },
      { name: 'Sandy Springs', x: 466, y: 612 },
    ],
    order: ['Milton', 'Alpharetta', 'Johns Creek', 'Roswell', 'Sandy Springs'],
  },
  {
    id: 'perimeter-dekalb',
    index: '02',
    label: 'Perimeter / North DeKalb',
    cities: [
      { name: 'Dunwoody', x: 556, y: 652 },
      { name: 'Peachtree Corners', x: 662, y: 592 },
      { name: 'Chamblee', x: 628, y: 692 },
      { name: 'Doraville', x: 692, y: 662 },
      { name: 'Brookhaven', x: 556, y: 724 },
    ],
    order: ['Peachtree Corners', 'Dunwoody', 'Doraville', 'Chamblee', 'Brookhaven'],
  },
  {
    id: 'cobb',
    index: '03',
    label: 'Cobb',
    cities: [
      { name: 'Marietta', x: 300, y: 542 },
      { name: 'Smyrna', x: 298, y: 632 },
      { name: 'Vinings', x: 358, y: 692 },
      { name: 'Kennesaw', x: 248, y: 470 },
      { name: 'Acworth', x: 198, y: 408 },
    ],
    order: ['Acworth', 'Kennesaw', 'Marietta', 'Smyrna', 'Vinings'],
  },
  {
    id: 'cherokee-575',
    index: '04',
    label: 'Cherokee / 575',
    cities: [
      { name: 'Woodstock', x: 322, y: 402 },
      { name: 'Holly Springs', x: 308, y: 330 },
      { name: 'Canton', x: 288, y: 258 },
      { name: 'Ball Ground', x: 318, y: 188 },
    ],
    order: ['Woodstock', 'Holly Springs', 'Canton', 'Ball Ground'],
  },
  {
    id: 'forsyth-400-north',
    index: '05',
    label: 'Forsyth / 400 North',
    cities: [
      { name: 'Cumming', x: 500, y: 340 },
      { name: 'Dawsonville', x: 468, y: 240 },
      { name: 'Dahlonega', x: 482, y: 152 },
      { name: 'Jasper', x: 366, y: 122 },
    ],
    order: ['Cumming', 'Dawsonville', 'Dahlonega', 'Jasper'],
  },
  {
    id: 'gwinnett-85',
    index: '06',
    label: 'Gwinnett / 85',
    cities: [
      { name: 'Suwanee', x: 646, y: 432 },
      { name: 'Duluth', x: 702, y: 492 },
      { name: 'Norcross', x: 722, y: 562 },
      { name: 'Lawrenceville', x: 792, y: 470 },
      { name: 'Snellville', x: 848, y: 562 },
      { name: 'Buford', x: 688, y: 352 },
    ],
    order: ['Buford', 'Suwanee', 'Duluth', 'Lawrenceville', 'Norcross', 'Snellville'],
  },
  {
    id: 'northeast',
    index: '07',
    label: 'Northeast',
    cities: [
      { name: 'Flowery Branch', x: 700, y: 282 },
      { name: 'Oakwood', x: 734, y: 232 },
      { name: 'Gainesville', x: 718, y: 168 },
      { name: 'Braselton', x: 822, y: 272 },
      { name: 'Hoschton', x: 846, y: 216 },
      { name: 'Winder', x: 878, y: 332 },
    ],
    order: ['Flowery Branch', 'Oakwood', 'Gainesville', 'Hoschton', 'Braselton', 'Winder'],
  },
];

export const CORRIDORS = [
  { label: 'GA-400', d: 'M500 96 L500 340 L494 470 L470 640' },
  { label: 'I-575', d: 'M318 160 L300 330 L330 470 L372 600' },
  { label: 'I-75', d: 'M196 372 L268 520 L344 700' },
  { label: 'I-85', d: 'M652 330 L724 500 L880 640' },
];

export function routePath(route) {
  const byName = new Map(route.cities.map((city) => [city.name, city]));
  const points = [HUB, ...route.order.map((name) => byName.get(name)).filter(Boolean)];
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}
