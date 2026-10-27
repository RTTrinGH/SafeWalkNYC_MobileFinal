/**
 * Live subway and bus data from the MTA's public GTFS-realtime feeds.
 *
 * The schedule comes from the routing service; this layer says where trains
 * actually are. For each train it finds the live forecast at the stops you
 * board and leave at, shifts the trip by the difference, and notices when a
 * delay means you will miss the next connection. It also reads the MTA's
 * service alerts, so a suspended line is shown against the trip that uses it.
 *
 * The feeds are open and need no key. If they cannot be reached, nothing here
 * throws: the trip simply stays on the published schedule and says so.
 */

import { fields, text } from './protobuf';

const BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/';
const BUS_UPDATES = 'https://gtfsrt.prod.obanyc.com/tripUpdates';
const TTL_MS = 20_000;
const TIMEOUT_MS = 12_000;

// ── Types ────────────────────────────────────────────────────────────────────

export type StopForecast = { arrival?: number; departure?: number };

export type TripForecast = {
  tripId: string;
  routeId: string;
  /** Epoch ms per GTFS stop id. */
  stops: Map<string, StopForecast>;
  canceled: boolean;
};

export type ServiceAlert = {
  id: string;
  routes: string[];
  header: string;
  /** The MTA's own category: "Delays", "Detour", "Planned - Part Suspended", "Station Notice" and so on. */
  type: string;
};

export type Feed = {
  at: number;
  /** When the MTA produced this snapshot, from the feed's own header. */
  issued: number;
  trips: TripForecast[];
  /** trip id (the part the MTA feeds share with the schedule) to forecast. */
  byTrip: Map<string, TripForecast>;
};

// ── Fetch and decode ─────────────────────────────────────────────────────────

async function download(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** A trip's identity as the realtime feeds write it: the last two underscore-separated parts. */
export function shortTripId(tripId: string): string {
  const parts = tripId.split('_');
  return parts.length > 2 ? parts.slice(-2).join('_') : tripId;
}

/** Compare routes across feeds: "MTA NYCT_M15+", "M15-SBS" and "M15" are all M15. */
export function routeKey(route: string): string {
  return route
    .split('_')
    .pop()!
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/SBS$/, '');
}

function parseTripUpdate(buf: Uint8Array): TripForecast | null {
  let tripId = '';
  let routeId = '';
  let canceled = false;
  const stops = new Map<string, StopForecast>();

  for (const f of fields(buf)) {
    if (f.n === 1 && f.b) {
      // TripDescriptor
      for (const d of fields(f.b)) {
        if (d.n === 1 && d.b) tripId = text(d.b);
        else if (d.n === 5 && d.b) routeId = text(d.b);
        else if (d.n === 4 && d.v === 3) canceled = true; // CANCELED
      }
    } else if (f.n === 2 && f.b) {
      // StopTimeUpdate
      let stopId = '';
      const forecast: StopForecast = {};
      for (const u of fields(f.b)) {
        if (u.n === 4 && u.b) stopId = text(u.b);
        else if ((u.n === 2 || u.n === 3) && u.b) {
          // StopTimeEvent: time is field 2, in epoch seconds.
          for (const e of fields(u.b)) {
            if (e.n === 2 && e.v > 0) {
              if (u.n === 2) forecast.arrival = e.v * 1000;
              else forecast.departure = e.v * 1000;
            }
          }
        }
      }
      if (stopId) stops.set(stopId, forecast);
    }
  }
  return tripId ? { tripId, routeId, stops, canceled } : null;
}

/** A snapshot older than this is not live, whatever it says. */
const STALE_MS = 5 * 60_000;

function parseFeed(buf: Uint8Array): Feed {
  const trips: TripForecast[] = [];
  let issued = 0;
  for (const entity of fields(buf)) {
    if (entity.n === 1 && entity.b) {
      // FeedHeader: field 3 is the time the snapshot was made, in epoch seconds.
      for (const h of fields(entity.b)) if (h.n === 3) issued = h.v * 1000;
      continue;
    }
    if (entity.n !== 2 || !entity.b) continue;
    for (const part of fields(entity.b)) {
      if (part.n === 3 && part.b) {
        const trip = parseTripUpdate(part.b);
        if (trip) trips.push(trip);
      }
    }
  }
  const byTrip = new Map<string, TripForecast>();
  for (const trip of trips) byTrip.set(shortTripId(trip.tripId), trip);
  if (issued && Date.now() - issued > STALE_MS) throw new Error('feed is stale');
  return { at: Date.now(), issued: issued || Date.now(), trips, byTrip };
}

/** Which of the MTA's subway feeds carries each line. */
function subwayFeedFor(route: string): string {
  const r = routeKey(route);
  if (/^[1-7S]/.test(r) || r === 'GS') return 'nyct%2Fgtfs';
  if (/^[ACEH]/.test(r) || r === 'FS') return 'nyct%2Fgtfs-ace';
  if (/^[BDFM]/.test(r)) return 'nyct%2Fgtfs-bdfm';
  if (r === 'G') return 'nyct%2Fgtfs-g';
  if (r === 'J' || r === 'Z') return 'nyct%2Fgtfs-jz';
  if (/^[NQRW]/.test(r)) return 'nyct%2Fgtfs-nqrw';
  if (r === 'L') return 'nyct%2Fgtfs-l';
  return 'nyct%2Fgtfs-si';
}

const cache = new Map<string, { at: number; feed: Promise<Feed> }>();

function feed(url: string): Promise<Feed> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.feed;
  const pending = download(url).then(parseFeed);
  cache.set(url, { at: Date.now(), feed: pending });
  // A failed download should not be remembered.
  pending.catch(() => cache.delete(url));
  return pending;
}

export const subwayFeed = (route: string) => feed(BASE + subwayFeedFor(route));
export const busFeed = () => feed(BUS_UPDATES);

// ── Alerts ───────────────────────────────────────────────────────────────────

function parseAlerts(buf: Uint8Array, now: number): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  for (const entity of fields(buf)) {
    if (entity.n !== 2 || !entity.b) continue;
    let id = '';
    let alertBytes: Uint8Array | undefined;
    for (const part of fields(entity.b)) {
      if (part.n === 1 && part.b) id = text(part.b);
      else if (part.n === 5 && part.b) alertBytes = part.b;
    }
    if (!alertBytes) continue;

    let active = true;
    let hasPeriod = false;
    let type = '';
    let header = '';
    const routes = new Set<string>();
    let stopOnly = true;

    for (const f of fields(alertBytes)) {
      if (f.n === 1 && f.b) {
        // active_period: times are epoch seconds, either end may be missing.
        let from = 0;
        let to = Infinity;
        for (const p of fields(f.b)) {
          if (p.n === 1) from = p.v * 1000;
          else if (p.n === 2) to = p.v * 1000;
        }
        if (!hasPeriod) active = false;
        hasPeriod = true;
        if (now >= from && now <= to) active = true;
      } else if (f.n === 5 && f.b) {
        for (const e of fields(f.b)) {
          if (e.n === 2 && e.b) {
            routes.add(routeKey(text(e.b)));
            stopOnly = false;
          }
        }
      } else if (f.n === 1001 && f.b) {
        // The MTA's extension: field 3 is its alert type.
        for (const m of fields(f.b)) if (m.n === 3 && m.b) type = text(m.b);
      } else if (f.n === 10 && f.b) {
        // header_text: a TranslatedString; take the first plain-text translation.
        for (const tr of fields(f.b)) {
          if (tr.n !== 1 || !tr.b || header) continue;
          for (const s of fields(tr.b)) if (s.n === 1 && s.b) header = text(s.b);
        }
      }
    }
    if (!active || stopOnly || !header) continue;
    alerts.push({ id, routes: [...routes], header: header.replace(/\s+/g, ' ').trim(), type });
  }
  return alerts;
}

let alertCache: { at: number; alerts: Promise<ServiceAlert[]> } | null = null;

/** Every alert in force right now across subway and bus; empty if the feeds cannot be read. */
export function currentAlerts(): Promise<ServiceAlert[]> {
  if (alertCache && Date.now() - alertCache.at < 60_000) return alertCache.alerts;
  const now = Date.now();
  const load = (name: string) =>
    download(BASE + name)
      .then((b) => parseAlerts(b, now))
      .catch(() => [] as ServiceAlert[]);
  const alerts = Promise.all([load('camsys%2Fsubway-alerts'), load('camsys%2Fbus-alerts')]).then(([a, b]) => [
    ...a,
    ...b,
  ]);
  alertCache = { at: now, alerts };
  return alerts;
}

/** Alerts that change how a trip runs, as opposed to notices about stations or lifts. */
export const isDisruptive = (a: ServiceAlert) =>
  /delay|detour|suspend|no service|reroute|express|local|skip|slow|service change|shuttle|reduced/i.test(a.type) &&
  !/station notice|elevator|escalator|accessib|information/i.test(a.type);

export function alertsForRoute(alerts: ServiceAlert[], route: string, limit = 2): ServiceAlert[] {
  const key = routeKey(route);
  const seen = new Set<string>();
  return alerts
    .filter((a) => a.routes.includes(key) && isDisruptive(a))
    .filter((a) => (seen.has(a.header) ? false : (seen.add(a.header), true)))
    .slice(0, limit);
}

// ── Looking up a train ───────────────────────────────────────────────────────

/** The id the MTA feeds use for a stop: "us-ny-MTA-NYCSubway_128S" becomes "128S". */
export const gtfsStopId = (id: string | undefined) => (id ? id.split('_').pop()!.replace(/^MTA_/, '') : '');

/**
 * Find the forecast for the train this trip boards. The trip id usually matches
 * exactly. If it does not, take the same line's train whose forecast at the
 * boarding stop is closest to the scheduled time, within a few minutes, so a
 * different train is never presented as this one.
 */
export function findForecast(
  data: Feed,
  tripId: string | undefined,
  route: string,
  boardStop: string,
  scheduledBoard: number,
): TripForecast | undefined {
  if (tripId) {
    const exact = data.byTrip.get(shortTripId(tripId));
    if (exact) return exact;
  }
  const key = routeKey(route);
  let best: TripForecast | undefined;
  let bestGap = 4 * 60_000;
  for (const trip of data.trips) {
    if (routeKey(trip.routeId) !== key) continue;
    const at = trip.stops.get(boardStop);
    const when = at?.departure ?? at?.arrival;
    if (!when) continue;
    const gap = Math.abs(when - scheduledBoard);
    if (gap < bestGap) {
      bestGap = gap;
      best = trip;
    }
  }
  return best;
}

/**
 * The next trains at a platform, read straight from the live feed rather than
 * inferred from the schedule. `stop` is the directional platform id ("120S"),
 * so every train listed is heading the way you want.
 */
export function liveDepartures(data: Feed, route: string, stop: string, from: number, count: number): number[] {
  const key = routeKey(route);
  const times: number[] = [];
  for (const trip of data.trips) {
    if (trip.canceled || routeKey(trip.routeId) !== key) continue;
    const at = trip.stops.get(stop);
    const when = at?.departure ?? at?.arrival;
    if (when && when >= from - 30_000) times.push(when);
  }
  return times.sort((a, b) => a - b).slice(0, count);
}
