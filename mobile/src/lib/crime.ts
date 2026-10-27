/**
 * NYPD complaint data, straight from NYC Open Data.
 *
 * The web app can go through its own proxy for caching; a phone has no such
 * thing, so this talks to SODA directly and caches in memory instead.
 *
 * Two things about the window matter. It has to be a fixed width, or a busy
 * area silently returns only its most recent few weeks while a quiet one
 * returns the full window, and the two are no longer comparable. And it has to
 * be anchored to the newest data in the dataset rather than to today: the
 * year-to-date feed runs about a quarter behind, so "the last 90 days" measured
 * from now can land entirely in the gap and return nothing at all.
 */

import { Crime } from './safety';

const DATASET = 'https://data.cityofnewyork.us/resource/5uac-w243.json';
// Wide enough to be a stable sample, short enough that a dense bounding box
// never reaches the row cap below. Midtown over 90 days is ~7,900 incidents and
// would be truncated; over 45 it is ~4,000 and comes back whole.
export const WINDOW_DAYS = 45;
const ROW_LIMIT = 6000;

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type CrimeResult = {
  crimes: Crime[];
  /** Newest date present in the dataset; recency is judged against this. */
  referenceMs: number;
  /** Width of the window the incidents were drawn from, in days. */
  windowDays: number;
};

type CacheEntry = { at: number; result: CrimeResult };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 20;

let latestKnown: { at: number; date: string } | null = null;
const LATEST_TTL_MS = 6 * 60 * 60 * 1000;

function cacheKey(b: Bounds): string {
  // Round to ~100m so near-identical bounding boxes share an entry.
  return [b.north, b.south, b.east, b.west].map((n) => n.toFixed(3)).join(',');
}

/** The most recent complaint date the feed actually holds. */
async function latestDataDate(): Promise<string> {
  if (latestKnown && Date.now() - latestKnown.at < LATEST_TTL_MS) {
    return latestKnown.date;
  }

  const response = await fetch(`${DATASET}?${new URLSearchParams({
    $select: 'max(cmplnt_fr_dt)',
  })}`);
  if (!response.ok) throw new Error('Incident feed unreachable');

  const rows = await response.json();
  const raw = rows?.[0]?.max_cmplnt_fr_dt;
  const date = typeof raw === 'string' && raw.length >= 10
    ? raw.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  latestKnown = { at: Date.now(), date };
  return date;
}

export async function fetchCrimes(bounds: Bounds): Promise<CrimeResult> {
  const key = cacheKey(bounds);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const latest = await latestDataDate();
  const latestMs = new Date(`${latest}T00:00:00`).getTime();
  const since = new Date(latestMs - WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const params = new URLSearchParams({
    $select: [
      'ofns_desc',
      'pd_desc',
      'law_cat_cd',
      'cmplnt_fr_dt',
      'cmplnt_fr_tm',
      'latitude',
      'longitude',
      // Whether it happened on the street or behind a door, which decides how
      // much a walker should care about it at all.
      'loc_of_occur_desc',
      'prem_typ_desc',
      'crm_atpt_cptd_cd',
    ].join(','),
    $where:
      `latitude between ${bounds.south} and ${bounds.north}` +
      ` and longitude between ${bounds.west} and ${bounds.east}` +
      ` and cmplnt_fr_dt >= '${since}T00:00:00'`,
    $limit: String(ROW_LIMIT),
    $order: 'cmplnt_fr_dt DESC',
  });

  const response = await fetch(`${DATASET}?${params}`);
  if (!response.ok) {
    throw new Error(`Incident data unavailable (${response.status})`);
  }

  const raw = await response.json();
  const crimes: Crime[] = raw
    .map((c: any) => ({
      lat: parseFloat(c.latitude),
      lng: parseFloat(c.longitude),
      offence: c.ofns_desc || 'Unknown',
      detail: c.pd_desc || '',
      lawCat: c.law_cat_cd || '',
      date: c.cmplnt_fr_dt,
      time: c.cmplnt_fr_tm,
      where: c.loc_of_occur_desc || '',
      premises: c.prem_typ_desc || '',
      completed: c.crm_atpt_cptd_cd || '',
    }))
    .filter((c: Crime) => Number.isFinite(c.lat) && Number.isFinite(c.lng));

  const result: CrimeResult = { crimes, referenceMs: latestMs, windowDays: WINDOW_DAYS };
  cache.set(key, { at: Date.now(), result });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  return result;
}

/** A padded box around a path, which is what the feed is queried with. */
export function boundsAround(coords: [number, number][], pad = 0.008): Bounds {
  const lats = coords.map((c) => c[0]);
  const lngs = coords.map((c) => c[1]);
  return {
    north: Math.max(...lats) + pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lngs) + pad,
    west: Math.min(...lngs) - pad,
  };
}
