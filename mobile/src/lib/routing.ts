/**
 * Walking routes
 * ----------------------------------------------------------------------------
 * This has to be a pedestrian router, and the public OSRM demo server is not
 * one: it answers /foot/, /bike/ and /driving/ with byte-identical geometry at
 * 28 km/h, because only the car profile is loaded.
 *
 * Valhalla routes pedestrians properly, walks at 5 km/h, and writes its own
 * instructions ("Turn right onto 6th Avenue"). Nudging it away from unnamed
 * sidewalk ways keeps those instructions worth reading - left to itself in New
 * York it produces "Turn right onto the walkway" ten times in a row.
 */

import { LatLng, METRES_PER_DEGREE, Point, metresBetween } from './geo';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

/**
 * If Valhalla is not answering, fall back to the same organisation's OSRM
 * pedestrian service. It is a real foot router (unlike the car-only demo
 * server), but it names no streets and has no way to avoid an area, so it is
 * the second choice.
 */
const OSRM_FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const WALK_METRES_PER_SECOND = 1.4;
const VALHALLA_TIMEOUT_MS = 7000;
const OUTAGE_MEMORY_MS = 2 * 60_000;

/** After a failure, go straight to the fallback for a while rather than wait on a dead server each time. */
let valhallaDownUntil = 0;

const PEDESTRIAN_COSTING = {
  walkway_factor: 1.6,
  sidewalk_factor: 1.4,
  driveway_factor: 3,
  alley_factor: 2.5,
};

export type Step = {
  distance: number; // metres
  duration: number; // seconds
  instruction: string;
  type: string;
  modifier: string;
  at: Point | null;
};

export type Route = {
  distance: number; // metres
  duration: number; // seconds
  coords: Point[];
  steps: Step[];
  label?: string;
};

/** Valhalla returns its geometry as a polyline at 1e-6 precision. */
export function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e6, lng / 1e6]);
  }
  return points;
}

// Valhalla numbers its maneuvers; the app speaks type/modifier, so translate
// once here.
const MANEUVERS: Record<number, [string, string]> = {
  1: ['depart', ''],
  2: ['depart', 'right'],
  3: ['depart', 'left'],
  4: ['arrive', ''],
  5: ['arrive', 'right'],
  6: ['arrive', 'left'],
  7: ['continue', ''],
  8: ['continue', ''],
  9: ['turn', 'slight right'],
  10: ['turn', 'right'],
  11: ['turn', 'sharp right'],
  12: ['turn', 'uturn'],
  13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'],
  15: ['turn', 'left'],
  16: ['turn', 'slight left'],
  17: ['continue', ''],
  22: ['continue', ''],
  23: ['turn', 'slight right'],
  24: ['turn', 'slight left'],
  25: ['merge', ''],
  26: ['continue', ''],
  27: ['continue', ''],
};

/**
 * A trip is one leg per "break" location. Read every leg, not just the first:
 * stopping at the first leg is how a route that was meant to pass a waypoint
 * ended up finishing at it.
 */
function normaliseTrip(trip: any, from: LatLng, to: LatLng): Route | null {
  const legs: any[] = trip?.legs || [];
  if (!legs.length) return null;

  const coords: Point[] = [];
  const steps: Step[] = [];

  for (const leg of legs) {
    const shape = decodePolyline6(leg.shape);
    // Each leg starts where the last one ended; don't repeat that point.
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? shape.slice(1) : shape));

    for (const m of leg.maneuvers || []) {
      const [type, modifier] = MANEUVERS[m.type] || ['continue', ''];
      // Only the final leg's arrival is the arrival.
      if (type === 'arrive' && leg !== legs[legs.length - 1]) continue;
      steps.push({
        distance: (m.length || 0) * 1000,
        duration: m.time || 0,
        instruction: m.instruction || '',
        type,
        modifier,
        at: coords[Math.min(offset + m.begin_shape_index, coords.length - 1)] || null,
      });
    }
  }
  if (!coords.length) return null;

  let distance = trip.summary.length * 1000;
  let duration = trip.summary.time;

  /*
   * The router snaps each end to the nearest walkable way, which for a building
   * or a pin dropped mid-block can be some way off. Join the line to the real
   * start and destination so it always visibly arrives.
   */
  const CONNECT_M = 6;
  const head = metresBetween(from.latitude, from.longitude, coords[0][0], coords[0][1]);
  if (head > CONNECT_M) {
    coords.unshift([from.latitude, from.longitude]);
    distance += head;
    duration += head / 1.4;
  }
  const last = coords[coords.length - 1];
  const tail = metresBetween(last[0], last[1], to.latitude, to.longitude);
  if (tail > CONNECT_M) {
    coords.push([to.latitude, to.longitude]);
    distance += tail;
    duration += tail / 1.4;
  }

  return { distance, duration, coords, steps };
}

export type RouteOptions = {
  alternates?: number;
  /** Rings of [lng, lat] the router must not walk through. */
  avoid?: number[][][];
};

/** A square of side 2*metres centred on a point, as a closed [lng, lat] ring. */
export function squareAround(lat: number, lng: number, metres: number): number[][] {
  const dLat = metres / METRES_PER_DEGREE;
  const dLng = metres / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

/** OSRM's maneuver types, in the words the rest of the app uses. */
function osrmStep(step: any, last: boolean): Step {
  const type: string = step.maneuver?.type || 'continue';
  const mod: string = step.maneuver?.modifier || '';
  const name: string = step.name || '';
  const onto = name ? ` onto ${name}` : '';
  let kind = 'continue';
  let modifier = '';
  let instruction = '';

  if (type === 'depart') {
    kind = 'depart';
    instruction = name ? `Start walking on ${name}.` : 'Start walking.';
  } else if (type === 'arrive') {
    kind = 'arrive';
    instruction = 'You have arrived at your destination.';
  } else if (mod === 'uturn') {
    kind = 'turn';
    modifier = 'uturn';
    instruction = 'Make a U-turn.';
  } else if (mod && mod !== 'straight') {
    kind = type === 'merge' ? 'merge' : 'turn';
    modifier = mod;
    const verb = mod.startsWith('slight') ? `Bear ${mod.replace('slight ', '')}` : `Turn ${mod}`;
    instruction = `${verb}${onto}.`;
  } else {
    instruction = name ? `Continue on ${name}.` : 'Continue straight.';
  }

  const at: Point | null = step.maneuver?.location ? [step.maneuver.location[1], step.maneuver.location[0]] : null;
  return {
    distance: step.distance || 0,
    duration: (step.distance || 0) / WALK_METRES_PER_SECOND,
    instruction,
    type: last && kind !== 'arrive' ? kind : kind,
    modifier,
    at,
  };
}

async function osrmFootRoutes(points: LatLng[]): Promise<Route[]> {
  const path = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const alternatives = points.length === 2 ? 'true' : 'false';
  const response = await fetch(
    `${OSRM_FOOT_URL}/${path}?overview=full&geometries=polyline6&steps=true&alternatives=${alternatives}`,
  );
  if (!response.ok) throw new Error(`Routing failed (${response.status})`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.length) return [];

  const from = points[0];
  const to = points[points.length - 1];
  return (data.routes as any[]).slice(0, 3).map((r) => {
    const coords = decodePolyline6(r.geometry);
    const legs: any[] = r.legs || [];
    const steps: Step[] = [];
    legs.forEach((leg, li) => {
      (leg.steps || []).forEach((st: any, si: number) => {
        // Only the last leg's arrival is the arrival.
        if (st.maneuver?.type === 'arrive' && li < legs.length - 1) return;
        steps.push(osrmStep(st, li === legs.length - 1 && si === leg.steps.length - 1));
      });
    });

    // This server walks slowly; time every route at the pace the rest of the app uses.
    let distance: number = r.distance;
    let duration = distance / WALK_METRES_PER_SECOND;
    const head = metresBetween(from.latitude, from.longitude, coords[0][0], coords[0][1]);
    if (head > 6) {
      coords.unshift([from.latitude, from.longitude]);
      distance += head;
      duration += head / WALK_METRES_PER_SECOND;
    }
    const end = coords[coords.length - 1];
    const tail = metresBetween(end[0], end[1], to.latitude, to.longitude);
    if (tail > 6) {
      coords.push([to.latitude, to.longitude]);
      distance += tail;
      duration += tail / WALK_METRES_PER_SECOND;
    }
    return { distance, duration, coords, steps };
  });
}

export async function valhallaRoutes(
  points: LatLng[],
  options: RouteOptions = {},
): Promise<Route[]> {
  // Valhalla is the first choice; if it is known to be down, or fails, use the fallback.
  if (Date.now() < valhallaDownUntil) return options.avoid?.length ? [] : osrmFootRoutes(points);
  try {
    return await valhallaRoutesPrimary(points, options);
  } catch (e) {
    valhallaDownUntil = Date.now() + OUTAGE_MEMORY_MS;
    // The fallback cannot steer around an area, so a detour request has no answer to give.
    if (options.avoid?.length) return [];
    return osrmFootRoutes(points);
  }
}

async function valhallaRoutesPrimary(
  points: LatLng[],
  options: RouteOptions = {},
): Promise<Route[]> {
  const body: any = {
    // Intermediate points are "through": the walk passes them without
    // splitting into separate legs.
    locations: points.map((p, i) => ({
      lat: p.latitude,
      lon: p.longitude,
      type: i === 0 || i === points.length - 1 ? 'break' : 'through',
    })),
    costing: 'pedestrian',
    costing_options: { pedestrian: PEDESTRIAN_COSTING },
    directions_options: { units: 'kilometers' },
  };
  if (options.alternates) body.alternates = options.alternates;
  if (options.avoid?.length) body.exclude_polygons = options.avoid;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALHALLA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Routing failed (${response.status})`);

  const data = await response.json();
  const trips = [data.trip]
    .concat((data.alternates || []).map((a: any) => a.trip))
    .filter(Boolean);

  const from = points[0];
  const to = points[points.length - 1];
  return trips
    .map((trip) => normaliseTrip(trip, from, to))
    .filter((r): r is Route => r !== null);
}

export async function requestRoute(
  points: LatLng[],
  options: RouteOptions = {},
): Promise<Route | null> {
  const routes = await valhallaRoutes(points, options);
  return routes.length ? routes[0] : null;
}

/**
 * A point roughly `metres` to one side of the path, square to it. Used to push
 * a detour away from a hotspot.
 */
export function sidestepPoint(
  coords: Point[],
  index: number,
  metres: number,
  side: number,
): LatLng | null {
  const a = coords[Math.max(0, index - 2)];
  const b = coords[Math.min(coords.length - 1, index + 2)];
  if (!a || !b) return null;

  const dLat = b[0] - a[0];
  const dLng = b[1] - a[1];
  const length = Math.hypot(dLat, dLng);
  if (!length) return null;

  const latMetres = metres / 111320;
  const lngMetres =
    metres / (111320 * Math.cos((coords[index][0] * Math.PI) / 180));

  return {
    latitude: coords[index][0] + side * (-dLng / length) * latMetres,
    longitude: coords[index][1] + side * (dLat / length) * lngMetres,
  };
}

/** Distance still to walk from a position to the end of the route. */
export function metresTo(from: LatLng, target: Point): number {
  return metresBetween(from.latitude, from.longitude, target[0], target[1]);
}
