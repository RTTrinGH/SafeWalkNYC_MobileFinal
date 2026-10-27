/**
 * Geometry helpers. Distances come back in metres; anything comparing a point
 * against a route works in degrees, which is close enough over a few hundred
 * metres and a great deal cheaper than projecting every incident.
 */

export type LatLng = { latitude: number; longitude: number };
export type Point = [number, number]; // [lat, lng]

export function metresBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToSegment(
  px: number,
  py: number,
  a: Point,
  b: Point,
): number {
  const A = px - a[0];
  const B = py - a[1];
  const C = b[0] - a[0];
  const D = b[1] - a[1];

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  const param = lenSq !== 0 ? dot / lenSq : -1;

  let xx: number;
  let yy: number;
  if (param < 0) {
    [xx, yy] = a;
  } else if (param > 1) {
    [xx, yy] = b;
  } else {
    xx = a[0] + param * C;
    yy = a[1] + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest distance from a point to a path, in degrees. */
export function degreesToRoute(
  lat: number,
  lng: number,
  route: Point[],
): number {
  let min = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const d = distanceToSegment(lat, lng, route[i], route[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Length of a path in kilometres. */
export function routeLengthKm(route: Point[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += metresBetween(
      route[i][0],
      route[i][1],
      route[i + 1][0],
      route[i + 1][1],
    );
  }
  return total / 1000;
}

/** Roughly one degree of latitude, used to turn the degree figures back. */
export const METRES_PER_DEGREE = 111320;
