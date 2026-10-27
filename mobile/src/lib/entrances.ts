/**
 * Where you actually go in and out of a subway station.
 *
 * A station is not one point. The 96 St stop on the 1 has exits several blocks
 * apart, and which one you take can change a walk by ten minutes. The routing
 * service treats a station as a single dot, so this adds the MTA's published
 * list of every entrance and exit (data.ny.gov, "MTA Subway Entrances and
 * Exits") and picks the best one for where you are going.
 */

import entranceData from '../data/entrances.json';
import { LatLng, Point, metresBetween } from './geo';
import { Route, requestRoute } from './routing';

type Entrance = [number, number, number]; // lat, lng, flags (1 entry, 2 exit, 4 elevator only)

type Station = { n: string; r: string; e: Entrance[] };

const STATIONS = (entranceData as any).stations as Record<string, Station>;

const ENTRY = 1;
const EXIT = 2;
const ELEVATOR_ONLY = 4;

/** The id the MTA uses for the whole station: "120S" and "120N" are platforms of "120". */
export const stationOf = (stopId: string | undefined): string => {
  if (!stopId) return '';
  const id = stopId.split('_').pop()!;
  return STATIONS[id] ? id : id.replace(/[NS]$/, '');
};

export const hasEntrances = (station: string) => !!STATIONS[station];

export const stationName = (station: string) => STATIONS[station]?.n ?? '';

export type EntranceChoice = {
  at: Point;
  /** Seconds from the platform to street level, or the reverse. */
  insideSeconds: number;
  /** Walk between the entrance and the other end of the trip. */
  route: Route;
  /** "north", "south" and so on: which end of the station this is, if it is not in the middle. */
  side: string;
};

const centre = (station: Station): Point => {
  const e = station.e;
  return [e.reduce((s, x) => s + x[0], 0) / e.length, e.reduce((s, x) => s + x[1], 0) / e.length];
};

const cardinal = (from: Point, to: Point): string => {
  const dy = (to[0] - from[0]) * 111320;
  const dx = (to[1] - from[1]) * 84300;
  if (Math.hypot(dx, dy) < 70) return '';
  return Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'north' : 'south') : dx > 0 ? 'east' : 'west';
};

/**
 * A few seconds of stairs and mezzanine at either end, plus the distance from the
 * middle of the station to this entrance, which is how far down the platform
 * you are likely to be walking underground.
 */
const insideSeconds = (centreAt: Point, entrance: Point) =>
  45 + metresBetween(centreAt[0], centreAt[1], entrance[0], entrance[1]) / 0.9;

/** The public walking router throttles bursts, so queue requests and give each a deadline. */
const MAX_AT_ONCE = 3;
const DEADLINE_MS = 7000;
let running = 0;
const waiting: Array<() => void> = [];

async function routed(from: LatLng, to: LatLng): Promise<Route | null> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((resume) => waiting.push(resume));
  running++;
  try {
    return await Promise.race([
      requestRoute([from, to]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DEADLINE_MS)),
    ]);
  } catch {
    return null;
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A walk estimated from the straight line, for when the router cannot be reached. */
function estimated(from: LatLng, to: LatLng): Route {
  const crow = metresBetween(from.latitude, from.longitude, to.latitude, to.longitude);
  const metres = crow * 1.25; // streets are not straight
  return {
    distance: metres,
    duration: metres / 1.4,
    coords: [
      [from.latitude, from.longitude],
      [to.latitude, to.longitude],
    ],
    steps: [],
  };
}

const cache = new Map<string, Promise<EntranceChoice | null>>();

/**
 * The best way in or out of `station` for a trip whose other end is `other`:
 * the entrance that minimises the walk plus the time underground. The nearest
 * few are really routed on the street network; the rest are ranked by distance.
 */
export function bestEntrance(
  station: string,
  other: LatLng,
  direction: 'in' | 'out',
  precise = true,
): Promise<EntranceChoice | null> {
  const info = STATIONS[station];
  if (!info) return Promise.resolve(null);
  const key = `${station}|${direction}|${precise ? 'p' : 'e'}|${other.latitude.toFixed(5)},${other.longitude.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const run = (async () => {
    const need = direction === 'in' ? ENTRY : EXIT;
    let pool = info.e.filter((x) => x[2] & need);
    // Lift-only entrances are a last resort.
    const stairs = pool.filter((x) => !(x[2] & ELEVATOR_ONLY));
    if (stairs.length) pool = stairs;
    if (!pool.length) return null;

    const mid = centre(info);

    // Quick pass: rank every entrance by straight-line estimate and answer at once.
    if (!precise) {
      let pick: EntranceChoice | null = null;
      let pickTotal = Infinity;
      for (const x of pool) {
        const here: LatLng = { latitude: x[0], longitude: x[1] };
        const route = estimated(...(direction === 'out' ? ([here, other] as const) : ([other, here] as const)));
        const inside = insideSeconds(mid, [x[0], x[1]]);
        if (route.duration + inside < pickTotal) {
          pickTotal = route.duration + inside;
          pick = { at: [x[0], x[1]], insideSeconds: inside, route, side: cardinal(mid, [x[0], x[1]]) };
        }
      }
      return pick;
    }

    const nearest = pool
      .map((x) => ({ x, d: metresBetween(x[0], x[1], other.latitude, other.longitude) }))
      .sort((a, b) => a.d - b.d)
      .filter((c, i, all) => i === 0 || (i === 1 && c.d < all[0].d * 1.3 + 40));

    let best: EntranceChoice | null = null;
    let bestTotal = Infinity;
    await Promise.all(
      nearest.map(async ({ x }) => {
        const here: LatLng = { latitude: x[0], longitude: x[1] };
        const real = await routed(...(direction === 'out' ? ([here, other] as const) : ([other, here] as const)));
        // Keep the estimate if the router did not answer, rather than lose the walk.
        const route = real ?? estimated(...(direction === 'out' ? ([here, other] as const) : ([other, here] as const)));
        const inside = insideSeconds(mid, [x[0], x[1]]);
        // A real route is preferred over an estimate that merely looks shorter.
        const total = route.duration + inside + (real ? 0 : 20);
        if (total < bestTotal) {
          bestTotal = total;
          best = { at: [x[0], x[1]], insideSeconds: inside, route, side: cardinal(mid, [x[0], x[1]]) };
        }
      }),
    );
    return best;
  })();

  cache.set(key, run);
  run.then((r) => r ?? cache.delete(key)).catch(() => cache.delete(key));
  return run;
}

/** Stations whose exits are within `metres` of a point, nearest first. */
export function stationsWithin(point: LatLng, metres: number): Array<{ id: string; name: string; metres: number }> {
  const found: Array<{ id: string; name: string; metres: number }> = [];
  for (const [id, st] of Object.entries(STATIONS)) {
    let nearest = Infinity;
    for (const x of st.e) {
      if (!(x[2] & EXIT) && !(x[2] & ENTRY)) continue;
      nearest = Math.min(nearest, metresBetween(x[0], x[1], point.latitude, point.longitude));
    }
    if (nearest <= metres) found.push({ id, name: st.n, metres: nearest });
  }
  return found.sort((a, b) => a.metres - b.metres);
}
