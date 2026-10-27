/**
 * Safe havens: somewhere to walk into if something feels wrong. Precinct
 * houses, firehouses, emergency rooms and subway stations, all staffed at every
 * hour. The list ships with the app so it costs no request and cannot
 * rate-limit, and it works with no signal.
 */

import havenData from '../data/safeHavens.json';
import { degreesToRoute, metresBetween, Point } from './geo';

export type HavenKind = 'police' | 'hospital' | 'subway' | 'fire';

export type Haven = {
  t: HavenKind;
  n: string;
  y: number; // latitude
  x: number; // longitude
};

export const HAVEN_KINDS: Record<HavenKind, { label: string; letter: string }> = {
  police: { label: 'Police station', letter: 'P' },
  hospital: { label: 'Emergency room', letter: 'H' },
  subway: { label: 'Subway station', letter: 'S' },
  fire: { label: 'Fire station', letter: 'F' },
};

export const HAVENS: Haven[] = (havenData as any).havens as Haven[];

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Only the havens you are looking at. Putting all 1,300 markers on the map at
 * once is what makes it crawl, so render what is on screen. Zoomed out, only
 * the places you would actually cross town for stay on.
 */
export function havensInRegion(region: Region, limit = 120): Haven[] {
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  const north = region.latitude + halfLat;
  const south = region.latitude - halfLat;
  const east = region.longitude + halfLng;
  const west = region.longitude - halfLng;

  // A span wider than ~4km means we are looking at a chunk of the city, not a
  // street, so drop back to the places worth crossing town for.
  const priorityOnly = region.latitudeDelta > 0.04;

  const visible: Haven[] = [];
  for (const haven of HAVENS) {
    if (priorityOnly && haven.t !== 'police' && haven.t !== 'hospital') continue;
    if (haven.y < south || haven.y > north) continue;
    if (haven.x < west || haven.x > east) continue;
    visible.push(haven);
    if (visible.length >= limit) break;
  }
  return visible;
}

/** Havens sitting along a walk, for the corridor you will actually be in. */
export function havensNearRoute(route: Point[], limit = 80): Haven[] {
  if (!route.length) return [];
  const corridor = 0.004; // ~400m either side
  const found: Haven[] = [];
  for (const haven of HAVENS) {
    if (degreesToRoute(haven.y, haven.x, route) < corridor) {
      found.push(haven);
      if (found.length >= limit) break;
    }
  }
  return found;
}

export function nearestHaven(
  latitude: number,
  longitude: number,
): { haven: Haven; metres: number } | null {
  let best: Haven | null = null;
  let bestDistance = Infinity;

  for (const haven of HAVENS) {
    const d = metresBetween(latitude, longitude, haven.y, haven.x);
    if (d < bestDistance) {
      bestDistance = d;
      best = haven;
    }
  }

  return best ? { haven: best, metres: bestDistance } : null;
}
