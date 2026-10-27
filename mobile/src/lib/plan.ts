/**
 * Planning a walk: find the ways there, score each against recent incidents,
 * and then try to beat them.
 *
 * Valhalla (routing) hands back a couple of alternatives, but they are 
 * alternatives by distance, but hasn't factored in the incident data. We find 
 * the worst stretch on the best path, push a waypoint out to one side of it, 
 * and ask for a route through there instead. If it scores better, it 
 * earns its place in the list.
 */

import { LatLng, Point, degreesToRoute, metresBetween } from './geo';
import { Route, requestRoute, sidestepPoint, squareAround, valhallaRoutes } from './routing';
import { Crime, SafetyScore, calculateSafetyScore, crimeWeight } from './safety';
import { fetchCrimes, boundsAround } from './crime';

export type Candidate = {
  route: Route;
  coords: Point[];
  safety: SafetyScore;
  label?: string;
};

export type Plan = {
  candidates: Candidate[];
  crimes: Crime[];
  dataAvailable: boolean;
  referenceMs: number;
  windowDays: number;
};

type Hotspot = {
  lat: number;
  lng: number;
  /** Where along the path it sits, as an index into its coordinates. */
  index: number;
  weight: number;
};

// ~80 m cells: roughly one street corner and the frontage either side of it.
const CELL = 0.0007;
const AVOID_HALF_SIDE_M = 55;

/**
 * Where incidents pile up along a path, worst first.
 *
 * Incidents are bucketed on a grid and each cell is weighted the same way the
 * score is, so a hotspot is a place that actually contributes to the risk rather
 * than merely a place with a lot of paperwork. Cells at either end of the walk
 * are ignored: detouring around the doorway you are leaving from is no use, and
 * asking the router to avoid it can make the trip impossible.
 */
function findHotspots(
  coords: Point[],
  crimes: Crime[],
  hour: number,
  referenceMs: number,
  start: LatLng,
  end: LatLng,
  limit = 4,
): Hotspot[] {
  if (!coords.length || !crimes.length) return [];

  const step = Math.max(1, Math.floor(coords.length / 40));
  const cells = new Map<string, { lat: number; lng: number; weight: number }>();

  for (const crime of crimes) {
    let bestDistance = Infinity;
    for (let i = 0; i < coords.length; i += step) {
      const d = (coords[i][0] - crime.lat) ** 2 + (coords[i][1] - crime.lng) ** 2;
      if (d < bestDistance) bestDistance = d;
    }
    if (Math.sqrt(bestDistance) > 0.002) continue;

    const weight = crimeWeight(crime, hour, referenceMs);
    if (weight < 0.4) continue;

    const key = `${Math.round(crime.lat / CELL)},${Math.round(crime.lng / CELL)}`;
    const cell = cells.get(key) || { lat: 0, lng: 0, weight: 0 };
    cell.lat += crime.lat * weight;
    cell.lng += crime.lng * weight;
    cell.weight += weight;
    cells.set(key, cell);
  }

  const found: Hotspot[] = [];
  cells.forEach((cell) => {
    if (cell.weight < 5) return;
    const lat = cell.lat / cell.weight;
    const lng = cell.lng / cell.weight;

    if (
      metresBetween(lat, lng, start.latitude, start.longitude) < 150 ||
      metresBetween(lat, lng, end.latitude, end.longitude) < 150
    ) {
      return;
    }

    let index = 0;
    let nearest = Infinity;
    for (let i = 0; i < coords.length; i += step) {
      const d = (coords[i][0] - lat) ** 2 + (coords[i][1] - lng) ** 2;
      if (d < nearest) {
        nearest = d;
        index = i;
      }
    }
    found.push({ lat, lng, index, weight: cell.weight });
  });

  return found.sort((x, y) => y.weight - x.weight).slice(0, limit);
}

/** Routes that either go round the worst places or pass a point beside them. */
async function proposeAlternatives(
  base: Candidate,
  hotspots: Hotspot[],
  start: LatLng,
  end: LatLng,
): Promise<Route[]> {
  if (!hotspots.length) return [];

  const avoid = hotspots.map((h) => squareAround(h.lat, h.lng, AVOID_HALF_SIDE_M));
  const requests: Array<Promise<Route | null>> = [];

  // Steer the router off the worst one, two and three places in turn: each
  // asks for a different trade between detour and exposure.
  for (let n = 1; n <= Math.min(3, avoid.length); n++) {
    requests.push(requestRoute([start, end], { avoid: avoid.slice(0, n) }).catch(() => null));
  }

  // And pull the route to one side of the worst place, which finds streets the
  // exclusion box leaves the router no reason to prefer.
  const worst = hotspots[0];
  for (const metres of [200, 360]) {
    for (const side of [1, -1]) {
      const via = sidestepPoint(base.coords, worst.index, metres, side);
      if (via) requests.push(requestRoute([start, via, end]).catch(() => null));
    }
  }

  return (await Promise.all(requests)).filter((r): r is Route => r !== null);
}

/**
 * Look for walks that beat the best one we have, in up to two rounds: the
 * second takes whatever the first found and tries to improve on that.
 */
async function findQuieterWays(
  best: Candidate,
  baseline: Candidate[],
  crimes: Crime[],
  start: LatLng,
  end: LatLng,
  hour: number,
  referenceMs: number,
  windowDays: number,
): Promise<Candidate[]> {
  // A safer route nobody would walk is not a safer route.
  const shortest = Math.min(...baseline.map((c) => c.route.distance));
  const maxDistance = shortest * 1.4;

  const seen: Candidate[] = [...baseline];
  const accepted: Candidate[] = [];
  let current = best;

  for (let round = 0; round < 2; round++) {
    const hotspots = findHotspots(current.coords, crimes, hour, referenceMs, start, end);
    const routes = await proposeAlternatives(current, hotspots, start, end);

    const scored: Candidate[] = [];
    for (const route of routes) {
      if (route.distance > maxDistance) continue;

      const safety = calculateSafetyScore(crimes, route.coords, hour, referenceMs, windowDays);
      if (safety.density >= current.safety.density * 0.92) continue;

      // The router happily returns the same walk for different requests.
      const duplicate = seen.some(
        (c) =>
          Math.abs(c.route.distance - route.distance) < 20 &&
          Math.abs(c.safety.density - safety.density) < 0.02 * (c.safety.density || 1),
      );
      if (duplicate) continue;

      const candidate: Candidate = { route, coords: route.coords, safety };
      scored.push(candidate);
      seen.push(candidate);
    }

    if (!scored.length) break;
    scored.sort((a, b) => a.safety.density - b.safety.density);
    accepted.push(scored[0]);
    current = scored[0];
  }

  accepted.sort((a, b) => a.safety.density - b.safety.density);
  return accepted.slice(0, 2).map((c, i) => ({
    ...c,
    label: i === 0 ? 'Quieter way' : 'Quieter way 2',
  }));
}

export async function planWalk(
  start: LatLng,
  end: LatLng,
  hour: number,
): Promise<Plan> {
  const routes = (await valhallaRoutes([start, end], { alternates: 2 })).slice(0, 5);
  if (!routes.length) throw new Error('No walking route found between those points');

  /*
   * If the feed gives us nothing, say so. Inventing plausible incidents and
   * showing them as real is the one thing a safety app must never do.
   */
  let crimes: Crime[] = [];
  let referenceMs = Date.now();
  let windowDays = 30;
  let dataAvailable = true;
  try {
    const allCoords = routes.flatMap((r) => r.coords);
    const result = await fetchCrimes(boundsAround(allCoords));
    crimes = result.crimes;
    referenceMs = result.referenceMs;
    windowDays = result.windowDays;
    dataAvailable = crimes.length > 0;
  } catch {
    dataAvailable = false;
  }

  let candidates: Candidate[] = routes.map((route) => ({
    route,
    coords: route.coords,
    safety: calculateSafetyScore(crimes, route.coords, hour, referenceMs, windowDays),
  }));

  if (dataAvailable) {
    const best = candidates.reduce((a, b) =>
      b.safety.density < a.safety.density ? b : a,
    );
    try {
      candidates = candidates.concat(
        await findQuieterWays(best, candidates, crimes, start, end, hour, referenceMs, windowDays),
      );
    } catch {
      // A detour we could not compute is not a reason to lose the walk.
    }
  }

  return { candidates, crimes, dataAvailable, referenceMs, windowDays };
}

/** Which option is the safest, by risk per km rather than total. */
export function safestIndex(candidates: Candidate[]): number {
  let index = 0;
  let min = Infinity;
  candidates.forEach((c, i) => {
    if (c.safety.density < min) {
      min = c.safety.density;
      index = i;
    }
  });
  return index;
}

/** The quickest way there, which is what a plain map would give you. */
export function directIndex(candidates: Candidate[]): number {
  let index = 0;
  let min = Infinity;
  candidates.forEach((c, i) => {
    if (c.route.duration < min) {
      min = c.route.duration;
      index = i;
    }
  });
  return index;
}

/**
 * The best balance of safety and time. Risk per km alone would happily send
 * someone half a mile out of their way, so each extra 10% of distance has to
 * buy at least 15% less risk to be worth it.
 */
export function optimizedIndex(candidates: Candidate[]): number {
  const shortest = Math.min(...candidates.map((c) => c.route.distance));
  let index = 0;
  let min = Infinity;
  candidates.forEach((c, i) => {
    const extra = c.route.distance / shortest - 1;
    const cost = c.safety.density * (1 + 1.5 * extra);
    if (cost < min) {
      min = cost;
      index = i;
    }
  });
  return index;
}

export type RankedOption = { index: number; tags: string[] };

/**
 * The options in the order they are offered: Optimized, Safest and Direct
 * first - merged into one card when the same walk is all of them - then
 * anything else the planner found.
 */
export function rankOptions(candidates: Candidate[], scored: boolean): RankedOption[] {
  if (!candidates.length) return [];

  const direct = directIndex(candidates);
  const roles: Array<[string, number]> = scored
    ? [
        ['Optimized', optimizedIndex(candidates)],
        ['Safest', safestIndex(candidates)],
        ['Direct', direct],
      ]
    : [['Direct', direct]];

  const ranked: RankedOption[] = [];
  for (const [tag, index] of roles) {
    const existing = ranked.find((r) => r.index === index);
    if (existing) existing.tags.push(tag);
    else ranked.push({ index, tags: [tag] });
  }

  candidates.forEach((c, index) => {
    if (!ranked.some((r) => r.index === index)) {
      ranked.push({ index, tags: [c.label ?? 'Alternative'] });
    }
  });
  return ranked;
}

/*
 * In a dense part of the city every option can land in the same risk band,
 * which tells you nothing about which to take. What helps is the comparison:
 * this way is a fifth quieter than the direct one.
 */
export function comparisonNote(
  candidates: Candidate[],
  index: number,
): string | null {
  if (!candidates.length) return null;
  const direct = directIndex(candidates);
  if (index === direct) return null;

  const baseline = candidates[direct].safety.density;
  if (!baseline) return null;

  const change = (baseline - candidates[index].safety.density) / baseline;
  if (Math.abs(change) < 0.1) return null;

  const percent = Math.round(Math.abs(change) * 100);
  return change > 0
    ? `${percent}% less risk than the direct route`
    : `${percent}% more risk than the direct route`;
}

/** The incidents worth drawing: near the walk, most serious first. */
export function plottableCrimes(
  crimes: Crime[],
  coords: Point[],
  limit = 150,
): Crime[] {
  return crimes
    .filter((c) => degreesToRoute(c.lat, c.lng, coords) < 0.0025)
    .sort((a, b) => crimeWeight(b, 12) - crimeWeight(a, 12))
    .slice(0, limit);
}
