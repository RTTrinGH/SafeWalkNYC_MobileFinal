/**
 * Transit: subway and bus trips across the five boroughs.
 *
 * Trips are planned by Transitous, a free, community-run routing service built
 * on the MTA's published schedules, so there is no key to manage and nothing
 * personal is sent beyond the two points of the trip. That plan is the
 * schedule. Live running is layered on top of it (see realtime.ts): where the
 * MTA says a train is early or late, the trip is moved to match, a connection
 * you would now miss is flagged, and service alerts for the lines you ride are
 * attached to the trip.
 *
 * Each walk to or from a stop is also scored against recent incidents with the
 * same scorer the walking routes use, because the stretch from the platform to
 * the front door is where a transit trip is least predictable.
 */

import { LatLng, Point, metresBetween } from './geo';
import { Crime, RiskLevel, SafetyScore, calculateSafetyScore } from './safety';
import { boundsAround, fetchCrimes } from './crime';
import { requestRoute } from './routing';
import { bestEntrance, stationOf, stationsWithin } from './entrances';
import {
  ServiceAlert,
  alertsForRoute,
  busFeed,
  currentAlerts,
  findForecast,
  gtfsStopId,
  liveDepartures,
  subwayFeed,
  Feed,
} from './realtime';

const API = 'https://api.transitous.org/api/v5';
const TIMEOUT_MS = 20_000;
const WALK_SPEED = 1.4; // metres per second

export type TransitFilter = 'all' | 'subway' | 'bus';

export type TransitLeg = {
  kind: 'walk' | 'ride';
  /** SUBWAY, BUS, RAIL, TRAM and so on; WALK for walking legs. */
  mode: string;
  /** "A", "M15-SBS": what is painted on the vehicle. */
  label: string;
  longName: string;
  color: string;
  textColor: string;
  headsign: string;
  fromName: string;
  toName: string;
  fromStopId?: string;
  toStopId?: string;
  tripId?: string;
  from: Point;
  to: Point;
  /** A walk inside one station: a platform change, not a walk down a street. */
  sameStation: boolean;
  /** Times as shown: live where we have it, the schedule otherwise. */
  start: number;
  end: number;
  /** The published schedule. */
  plannedStart: number;
  plannedEnd: number;
  /** What the routing service returned, which already holds live bus predictions. */
  baseStart: number;
  baseEnd: number;
  minutes: number;
  metres: number;
  /** Stops after boarding, up to and including where you get off. */
  stops: number;
  /** True when the times come from live data. */
  live: boolean;
  /** Minutes behind the schedule; negative is early. */
  delay: number;
  cancelled: boolean;
  /** You would reach the stop after this vehicle has left it. */
  missed: boolean;
  alerts: ServiceAlert[];
  /** Which exit or entrance to use, for walks that begin or end at a subway station. */
  note?: string;
  coords: Point[];
  /** Walking legs only, filled in once incident data arrives. */
  risk?: SafetyScore;
  /** A real street route has been fetched for this walk, or we tried and kept the straight line. */
  routed?: boolean;
};

export type TransitOption = {
  id: string;
  /** The time the search was for; trip time is counted from here, waiting included. */
  searchAt: number;
  start: number;
  end: number;
  plannedEnd: number;
  /** Door to door from the search time, so a later-leaving trip is not flattered. */
  minutes: number;
  transfers: number;
  walkMetres: number;
  walkMinutes: number;
  legs: TransitLeg[];
  /** Minutes behind the schedule at arrival; negative is early. */
  delay: number;
  /** A delay or cancellation means a connection will not hold. */
  atRisk: boolean;
  /** Just walking, offered when it competes with the transit trips. */
  walkOnly?: boolean;
  /** Worst of its walking legs, once scored. */
  risk?: RiskLevel;
  /** Risk per km times km, summed over the walking legs: how much exposure the walking adds up to. */
  exposure?: number;
};

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The API's geometry is a polyline; precision is stated alongside it. */
function decode(encoded: string, precision: number): Point[] {
  const factor = Math.pow(10, precision);
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

async function get(path: string, params: Record<string, string | number>) {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/${path}?${query}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SafeWalkNYC/1.0 (mobile app)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const hex = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : fallback;

/** The MTA's own colours, for routes the feed leaves uncoloured. */
function fallbackColour(mode: string) {
  return mode === 'BUS' ? '#0039a6' : '#6d6e71';
}

const minutesBetween = (a: number, b: number) => Math.round((b - a) / 60_000);

function parseLeg(raw: any): TransitLeg {
  const walk = raw.mode === 'WALK';
  const geometry = raw.legGeometry;
  const coords: Point[] = geometry?.points ? decode(geometry.points, geometry.precision ?? 6) : [];
  const stops = Array.isArray(raw.intermediateStops) ? raw.intermediateStops.length + 1 : 0;

  const start = Date.parse(raw.startTime);
  const end = Date.parse(raw.endTime);
  const plannedStart = Date.parse(raw.scheduledStartTime ?? raw.startTime);
  const plannedEnd = Date.parse(raw.scheduledEndTime ?? raw.endTime);
  const from: Point = [raw.from?.lat ?? coords[0]?.[0] ?? 0, raw.from?.lon ?? coords[0]?.[1] ?? 0];
  const to: Point = [
    raw.to?.lat ?? coords[coords.length - 1]?.[0] ?? 0,
    raw.to?.lon ?? coords[coords.length - 1]?.[1] ?? 0,
  ];
  // Transfers between platforms often arrive with no distance and no path at all.
  const crow = metresBetween(from[0], from[1], to[0], to[1]);
  const metres = raw.distance || crow;
  const sameStation =
    walk &&
    !!raw.from?.stopId &&
    !!raw.to?.stopId &&
    ((!!raw.from.parentId && raw.from.parentId === raw.to.parentId) || metres <= 250);
  // A walk with no path is still drawn, as a straight line between its two ends.
  const drawn: Point[] = coords.length >= 2 ? coords : crow > 3 ? [from, to] : coords;

  return {
    kind: walk ? 'walk' : 'ride',
    mode: raw.mode,
    label: walk ? '' : String(raw.routeShortName || raw.displayName || raw.routeLongName || '?'),
    longName: raw.routeLongName || '',
    color: walk ? '#6d6e71' : hex(raw.routeColor, fallbackColour(raw.mode)),
    textColor: hex(raw.routeTextColor, '#ffffff'),
    headsign: raw.headsign || '',
    fromName: raw.from?.name || '',
    toName: raw.to?.name || '',
    fromStopId: raw.from?.stopId,
    toStopId: raw.to?.stopId,
    tripId: raw.tripId,
    from,
    to,
    sameStation,
    start,
    end,
    plannedStart,
    plannedEnd,
    baseStart: start,
    baseEnd: end,
    minutes: Math.max(1, Math.round((raw.duration || 0) / 60)),
    metres,
    stops,
    live: !walk && !!raw.realTime,
    delay: walk ? 0 : minutesBetween(plannedStart, start),
    cancelled: !!raw.cancelled || !!raw.from?.cancelled,
    missed: false,
    alerts: [],
    coords: drawn,
  };
}

function summarise(option: Omit<TransitOption, 'transfers' | 'walkMetres' | 'walkMinutes' | 'minutes' | 'delay'> & { transfers?: number }): TransitOption {
  const walks = option.legs.filter((l) => l.kind === 'walk');
  const rides = option.legs.filter((l) => l.kind === 'ride');
  return {
    ...option,
    minutes: Math.max(1, Math.round((option.end - option.searchAt) / 60_000)),
    transfers: option.transfers ?? Math.max(0, rides.length - 1),
    walkMetres: walks.reduce((sum, l) => sum + l.metres, 0),
    walkMinutes: walks.reduce((sum, l) => sum + l.minutes, 0),
    delay: minutesBetween(option.plannedEnd, option.end),
  };
}

function parseOption(raw: any, searchAt: number, walkOnly = false): TransitOption {
  // Sub-20-second walks are just moving between platforms.
  const legs = (raw.legs as any[])
    .filter((l) => l.mode !== 'WALK' || (l.duration ?? 0) >= 20 || walkOnly)
    .map(parseLeg);
  const last = legs[legs.length - 1];
  return summarise({
    id: walkOnly ? 'walk-only' : String(raw.id ?? `${raw.startTime}${raw.endTime}`),
    searchAt,
    start: legs[0].start,
    end: Date.parse(raw.endTime),
    plannedEnd: last.plannedEnd,
    transfers: walkOnly ? 0 : raw.transfers,
    legs,
    atRisk: false,
    walkOnly,
  });
}

// ── Planning ─────────────────────────────────────────────────────────────────

const MODES: Record<TransitFilter, string> = {
  all: 'TRANSIT',
  subway: 'SUBWAY',
  bus: 'BUS',
};

/** A place for the planner: a point, or a station by its id, which makes it arrive exactly there. */
type Place = LatLng | { station: string };
const placeParam = (p: Place) => ('station' in p ? `us-ny-MTA-NYCSubway_${p.station}` : `${p.latitude},${p.longitude}`);

async function planFromService(
  start: Place,
  end: Place,
  when: Date,
  filter: TransitFilter,
  count = 10,
): Promise<{ options: TransitOption[]; walk: any | null }> {
  const data = await get('plan', {
    fromPlace: placeParam(start),
    toPlace: placeParam(end),
    time: when.toISOString(),
    arriveBy: 'false',
    numItineraries: count,
    transitModes: MODES[filter],
    // The service's default cap on the first and last walk quietly drops the best trips:
    // a 5 minute walk to a one-seat train ride can be missing from the results entirely.
    maxPreTransitTime: 3600,
    maxPostTransitTime: 3600,
    // The service assumes a slow stroll. New Yorkers, and the rest of this app, assume about 5 km/h.
    pedestrianSpeed: WALK_SPEED,
  });

  const searchAt = when.getTime();
  const seen = new Set<string>();
  const options: TransitOption[] = [];
  for (const raw of data.itineraries ?? []) {
    const option = parseOption(raw, searchAt);
    if (!option.legs.some((l) => l.kind === 'ride')) continue; // a walk is not transit
    const signature = option.legs.map((l) => `${l.label}${l.start}`).join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    options.push(option);
  }

  return { options, walk: filter === 'all' ? (data.direct ?? [])[0] ?? null : null };
}

// ── Using the right exit, and trips the planner misses ───────────────────────

/** A walk leg built from a routed path, timed as given. */
function routedWalk(opts: {
  from: Point;
  to: Point;
  startMs: number;
  seconds: number;
  metres: number;
  coords: Point[];
  fromName: string;
  toName: string;
  note?: string;
}): TransitLeg {
  const endMs = opts.startMs + opts.seconds * 1000;
  return {
    kind: 'walk',
    mode: 'WALK',
    label: '',
    longName: '',
    color: '#6d6e71',
    textColor: '#ffffff',
    headsign: '',
    fromName: opts.fromName,
    toName: opts.toName,
    from: opts.from,
    to: opts.to,
    sameStation: false,
    start: opts.startMs,
    end: endMs,
    plannedStart: opts.startMs,
    plannedEnd: endMs,
    baseStart: opts.startMs,
    baseEnd: endMs,
    minutes: Math.max(1, Math.round(opts.seconds / 60)),
    metres: opts.metres,
    stops: 0,
    live: false,
    delay: 0,
    cancelled: false,
    missed: false,
    alerts: [],
    note: opts.note,
    coords: opts.coords,
    routed: true,
  };
}

/**
 * Walk to and from the subway by the exit that suits the trip. The planner
 * walks to the middle of a station; the real entrances can be blocks apart. At
 * each end that is a subway stop, swap the planner's walk for one to the best
 * real entrance, including the time spent underground getting there. Returns
 * null if the longer walk means you could no longer catch the first train.
 */
async function refineEnds(
  option: TransitOption,
  start: LatLng,
  end: LatLng,
  precise = false,
): Promise<TransitOption | null> {
  if (option.walkOnly) return option;
  let legs = [...option.legs];
  const firstRide = legs.findIndex((l) => l.kind === 'ride');
  let lastRide = -1;
  legs.forEach((l, i) => {
    if (l.kind === 'ride') lastRide = i;
  });
  if (firstRide < 0) return option;

  // Getting off.
  const last = legs[lastRide];
  if (last.mode === 'SUBWAY') {
    const choice = await bestEntrance(stationOf(last.toStopId), end, 'out', precise);
    if (choice) {
      const seconds = choice.insideSeconds + choice.route.duration;
      const walk = routedWalk({
        from: last.to,
        to: [end.latitude, end.longitude],
        startMs: last.baseEnd,
        seconds,
        metres: choice.route.distance,
        coords: [last.to, ...choice.route.coords],
        fromName: last.toName,
        toName: 'END',
        note: choice.side ? `Use the ${choice.side} exit` : 'Use the exit closest to your destination',
      });
      legs = [...legs.slice(0, lastRide + 1), { ...walk, plannedStart: last.plannedEnd, plannedEnd: last.plannedEnd + seconds * 1000 }];
    }
  }

  // Getting on.
  const first = legs[firstRide];
  if (first.mode === 'SUBWAY') {
    const choice = await bestEntrance(stationOf(first.fromStopId), start, 'in', precise);
    if (choice) {
      const seconds = choice.insideSeconds + choice.route.duration;
      const slack = firstRide > 0 ? Math.max(0, first.baseStart - legs[firstRide - 1].baseEnd) : 0;
      const startMs = first.baseStart - slack - seconds * 1000;
      if (startMs < option.searchAt - 30_000) return null; // the longer walk no longer catches this train
      const walk = routedWalk({
        from: [start.latitude, start.longitude],
        to: first.from,
        startMs,
        seconds,
        metres: choice.route.distance,
        coords: [...choice.route.coords, first.from],
        fromName: 'START',
        toName: first.fromName,
        note: choice.side ? `Use the ${choice.side} entrance` : 'Use the entrance closest to you',
      });
      legs = [walk, ...legs.slice(firstRide)];
    }
  }

  // A trip must reach both ends. Where no exit data exists, close the gap with an estimated walk.
  const lastLeg = legs[legs.length - 1];
  const gapEnd = metresBetween(lastLeg.to[0], lastLeg.to[1], end.latitude, end.longitude);
  if (lastLeg.kind === 'ride' && gapEnd > 60) {
    const metres = gapEnd * 1.25;
    const seconds = metres / WALK_SPEED;
    legs = [
      ...legs,
      {
        ...routedWalk({
          from: lastLeg.to,
          to: [end.latitude, end.longitude],
          startMs: lastLeg.baseEnd,
          seconds,
          metres,
          coords: [lastLeg.to, [end.latitude, end.longitude]],
          fromName: lastLeg.toName,
          toName: 'END',
        }),
        plannedStart: lastLeg.plannedEnd,
        plannedEnd: lastLeg.plannedEnd + seconds * 1000,
      },
    ];
  }
  const firstLeg = legs[0];
  const gapStart = metresBetween(firstLeg.from[0], firstLeg.from[1], start.latitude, start.longitude);
  if (firstLeg.kind === 'ride' && gapStart > 60) {
    const metres = gapStart * 1.25;
    const seconds = metres / WALK_SPEED;
    const startMs = firstLeg.baseStart - seconds * 1000;
    if (startMs < option.searchAt - 30_000) return null;
    legs = [
      routedWalk({
        from: [start.latitude, start.longitude],
        to: firstLeg.from,
        startMs,
        seconds,
        metres,
        coords: [[start.latitude, start.longitude], firstLeg.from],
        fromName: 'START',
        toName: firstLeg.fromName,
      }),
      ...legs,
    ];
  }

  const tail = legs[legs.length - 1];
  return summarise({
    ...option,
    legs,
    start: legs[0].start,
    end: tail.end,
    plannedEnd: tail.plannedEnd,
    transfers: option.transfers,
  });
}

const alightedAt = (options: TransitOption[]) =>
  new Set(options.map((o) => stationOf([...o.legs].reverse().find((l) => l.kind === 'ride')?.toStopId)));
const boardedAt = (options: TransitOption[]) =>
  new Set(options.map((o) => stationOf(o.legs.find((l) => l.kind === 'ride')?.fromStopId)));

const EXTRA_AT_DESTINATION = 3;
const EXTRA_AT_START = 1;
const POLISHED = 4;
const STATION_RADIUS_M = 1500;

/**
 * Make the planner's trips better and add the ones it missed.
 *
 * Every trip gets the best real exit and entrance. Beyond that, the service
 * cannot see some good trips, such as one train and then a walk, because its
 * choice of stations to walk to at either end is incomplete. So for the nearest
 * stations to each end, by their actual exits, we ask it for a trip to (or from)
 * that exact station, and add the walk ourselves.
 */
export async function improveTrips(
  start: LatLng,
  end: LatLng,
  when: Date,
  filter: TransitFilter,
  known: TransitOption[],
): Promise<TransitOption[]> {
  const searchAt = when.getTime();

  const refined = await Promise.all(
    known.map(async (o) => {
      try {
        return await refineEnds(o, start, end);
      } catch {
        return o;
      }
    }),
  );

  const extras: Promise<TransitOption[]>[] = [];

  // Stations near the destination that no trip uses yet.
  const used = alightedAt(known);
  for (const st of stationsWithin(end, STATION_RADIUS_M)
    .filter((st) => !used.has(st.id))
    .slice(0, EXTRA_AT_DESTINATION)) {
    extras.push(
      planFromService(start, { station: st.id }, when, filter, 2)
        .then(({ options }) => Promise.all(options.map((o) => refineEnds(o, start, end).catch(() => null))))
        .then((list) => list.filter((o): o is TransitOption => !!o))
        .catch(() => []),
    );
  }

  // Stations near the start that no trip uses yet.
  const boarded = boardedAt(known);
  for (const st of stationsWithin(start, STATION_RADIUS_M)
    .filter((st) => !boarded.has(st.id))
    .slice(0, EXTRA_AT_START)) {
    extras.push(
      (async () => {
        const entrance = await bestEntrance(st.id, start, 'in', false);
        if (!entrance) return [];
        const leaves = new Date(searchAt + (entrance.route.duration + entrance.insideSeconds) * 1000);
        const { options } = await planFromService({ station: st.id }, end, leaves, filter, 2);
        const done = await Promise.all(
          options.map((o) => {
            // These were searched from the station, so they begin when you reach it.
            return refineEnds({ ...o, searchAt }, start, end).catch(() => null);
          }),
        );
        return done.filter((o): o is TransitOption => !!o);
      })().catch(() => []),
    );
  }

  const added = (await Promise.all(extras)).flat().map((o) => ({ ...o, id: `via-${o.id}` }));
  const reaches = (o: TransitOption) => {
    const last = o.legs[o.legs.length - 1];
    const first = o.legs[0];
    return (
      metresBetween(last.to[0], last.to[1], end.latitude, end.longitude) <= 120 &&
      metresBetween(first.from[0], first.from[1], start.latitude, start.longitude) <= 120
    );
  };
  return [...refined.filter((o): o is TransitOption => !!o), ...added].filter((o) => o.walkOnly || reaches(o));
}

/** The same rides between the same stops, however found, are one option: keep whichever arrives first. */
function collapse(options: TransitOption[]): TransitOption[] {
  const best = new Map<string, TransitOption>();
  const extras: TransitOption[] = [];
  for (const o of options) {
    if (o.walkOnly) {
      extras.push(o);
      continue;
    }
    const key = o.legs
      .filter((l) => l.kind === 'ride')
      .map((l) => `${l.label}:${l.fromName}>${l.toName}`)
      .join('|');
    const have = best.get(key);
    if (!have || o.end < have.end) best.set(key, o);
  }
  return [...[...best.values()].sort((a, b) => a.end - b.end).slice(0, 14), ...extras].sort((a, b) => a.end - b.end);
}

/**
 * Spend real walking-route requests where they matter: on the handful of best
 * trips, replace the quick straight-line estimates for the walks to and from
 * the subway with routes on the actual streets.
 */
export async function polishTrips(start: LatLng, end: LatLng, options: TransitOption[]): Promise<TransitOption[]> {
  const top = options
    .filter((o) => !o.walkOnly && !o.atRisk)
    .sort((a, b) => a.end - b.end)
    .slice(0, POLISHED);
  const done = await Promise.all(top.map((o) => refineEnds(o, start, end, true).catch(() => null)));
  return done.filter((o): o is TransitOption => !!o);
}

/** Swap the improved trips in for the ones first shown, keeping the walk-only card. */
export function mergeTrips(current: TransitOption[], improved: TransitOption[]): TransitOption[] {
  return collapse([...improved, ...current.filter((o) => o.walkOnly)]);
}

export async function planTransit(
  start: LatLng,
  end: LatLng,
  when: Date,
  filter: TransitFilter,
): Promise<TransitOption[]> {
  const main = await planFromService(start, end, when, filter);
  const options = [...main.options];

  // When walking is a real alternative, say so rather than making transit look like the only way.
  const walk = main.walk;
  if (walk && walk.duration <= 45 * 60 && walk.legs?.length) {
    options.push(parseOption(walk, when.getTime(), true));
  }

  if (!options.some((o) => !o.walkOnly)) {
    throw new Error(
      filter === 'all'
        ? 'No transit trip found for that time. Try a different time, or walk.'
        : `No trip using only the ${filter} for that time. Try All, which can combine subway and bus.`,
    );
  }
  return collapse(options);
}

// ── Walks between stops ──────────────────────────────────────────────────────

/**
 * Walks between two different stops, such as a bus to a train a block away,
 * often arrive as a straight line or nothing. Route those on real streets so
 * the path is drawn and the distance is honest. Platform changes inside a
 * station are left alone: there is no street to follow.
 */
export async function routeTransferWalks(option: TransitOption): Promise<TransitOption> {
  const point = (p: Point): LatLng => ({ latitude: p[0], longitude: p[1] });
  const legs = await Promise.all(
    option.legs.map(async (leg) => {
      if (leg.kind !== 'walk' || leg.sameStation || leg.routed || leg.coords.length >= 4) return leg;
      try {
        const route = await requestRoute([point(leg.from), point(leg.to)]);
        if (route && route.coords.length > 1) {
          return { ...leg, coords: route.coords, metres: route.distance, routed: true };
        }
      } catch {
        // Keep the straight line.
      }
      return { ...leg, routed: true };
    }),
  );
  return { ...option, legs };
}

/** Copy routed walks into the current options without disturbing their live times. */
export function withRoutedWalks(current: TransitOption[], routed: TransitOption): TransitOption[] {
  return current.map((o) =>
    o.id !== routed.id
      ? o
      : {
          ...o,
          legs: o.legs.map((l, i) => {
            const r = routed.legs[i];
            return r?.routed && !l.routed ? { ...l, coords: r.coords, metres: r.metres, routed: true } : l;
          }),
        },
  );
}

// ── Live running ─────────────────────────────────────────────────────────────

export type LiveStatus = {
  /** When the data was fetched. */
  at: number;
  /** Subway forecasts were available. */
  subway: boolean;
  /** Service alerts were available. */
  alerts: boolean;
};

/**
 * Lay live running over the schedule. Always works from the scheduled and
 * as-planned times, never from a previous result, so it can be run again every
 * half minute without drift.
 *
 * Each ride is moved to its live forecast. Walking then starts when the
 * previous leg really ends, which is how a late first train pushes everything
 * after it back, and how a connection you would now miss is noticed.
 */
export async function applyLive(options: TransitOption[]): Promise<{ options: TransitOption[]; status: LiveStatus }> {
  const subwayRoutes = new Set<string>();
  let wantsBus = false;
  for (const o of options)
    for (const l of o.legs) {
      if (l.kind !== 'ride') continue;
      if (l.mode === 'SUBWAY') subwayRoutes.add(l.label);
      else if (l.mode === 'BUS') wantsBus = true;
    }

  const feeds = new Map<string, Feed>();
  let subwayOk = subwayRoutes.size === 0;
  await Promise.all(
    [...subwayRoutes].map(async (route) => {
      try {
        feeds.set(route, await subwayFeed(route));
        subwayOk = true;
      } catch {
        // The schedule stands in for any line we could not reach.
      }
    }),
  );
  let bus: Feed | null = null;
  if (wantsBus) bus = await busFeed().catch(() => null);

  let alerts: ServiceAlert[] = [];
  let alertsOk = true;
  try {
    alerts = await currentAlerts();
  } catch {
    alertsOk = false;
  }

  /** Where a ride really is: its live times if we have a forecast, otherwise as planned. */
  const forecastFor = (leg: TransitLeg) => {
    let start = leg.baseStart;
    let end = leg.baseEnd;
    let live = leg.live;
    let cancelled = leg.cancelled;
    const feed = leg.mode === 'SUBWAY' ? feeds.get(leg.label) : leg.mode === 'BUS' ? bus : null;
    if (feed) {
      const board = gtfsStopId(leg.fromStopId);
      const alight = gtfsStopId(leg.toStopId);
      const forecast = findForecast(feed, leg.tripId, leg.label, board, leg.plannedStart);
      if (forecast) {
        cancelled = cancelled || forecast.canceled;
        const boardAt = forecast.stops.get(board);
        const alightAt = forecast.stops.get(alight);
        const boardTime = boardAt?.departure ?? boardAt?.arrival;
        const alightTime = alightAt?.arrival ?? alightAt?.departure;
        if (boardTime) {
          start = boardTime;
          end = alightTime ?? boardTime + (leg.baseEnd - leg.baseStart);
          live = true;
        }
      }
    }
    return { start, end, live, cancelled };
  };

  const updated = options.map((option) => {
    const ahead = option.legs.map((l) => (l.kind === 'ride' ? forecastFor(l) : null));
    let cursor = option.legs[0].baseStart;
    let atRisk = false;

    const legs = option.legs.map((leg, index) => {
      if (leg.kind === 'walk') {
        const duration = leg.baseEnd - leg.baseStart;
        let start = index === 0 ? leg.baseStart : cursor;
        // Setting off: leave when the first vehicle needs you to, which is later if it is late
        // and earlier if it is early, but never before now.
        const first = index === 0 ? ahead[1] : null;
        if (first && option.legs[1]) {
          const slack = Math.max(0, option.legs[1].baseStart - leg.baseEnd);
          start = Math.max(option.searchAt, first.start - duration - slack);
        }
        cursor = start + duration;
        return { ...leg, start, end: cursor };
      }

      const { start, end, live, cancelled } = ahead[index]!;

      // You arrive at the stop at `cursor`. Leaving before that means this one is gone.
      const missed = index > 0 && cursor > start + 60_000;
      if (missed || cancelled) atRisk = true;
      cursor = end;

      return {
        ...leg,
        start,
        end,
        live,
        cancelled,
        missed,
        delay: minutesBetween(leg.plannedStart, start),
        alerts: alertsForRoute(alerts, leg.label),
      };
    });

    return summarise({
      ...option,
      legs,
      start: legs[0].start,
      end: cursor,
      atRisk,
      transfers: option.transfers,
    });
  });

  return { options: updated, status: { at: Date.now(), subway: subwayOk, alerts: alertsOk } };
}

/** Keep the incident scores already computed when a trip is refreshed with new times. */
export function keepScores(next: TransitOption[], previous: TransitOption[]): TransitOption[] {
  return next.map((option) => {
    const before = previous.find((p) => p.id === option.id);
    if (!before) return option;
    return {
      ...option,
      risk: before.risk,
      exposure: before.exposure,
      legs: option.legs.map((leg, i) => ({ ...leg, risk: before.legs[i]?.risk ?? leg.risk })),
    };
  });
}

/**
 * Score the walking legs against recent incidents. Returns new options and
 * leaves the originals alone, so the trips can be shown before this finishes.
 */
export async function scoreTransitWalks(options: TransitOption[]): Promise<TransitOption[]> {
  const walkCoords = options.flatMap((o) => o.legs.filter((l) => l.kind === 'walk').flatMap((l) => l.coords));
  if (walkCoords.length < 2) return options;

  let crimes: Crime[];
  let referenceMs: number;
  let windowDays: number;
  try {
    const result = await fetchCrimes(boundsAround(walkCoords));
    crimes = result.crimes;
    referenceMs = result.referenceMs;
    windowDays = result.windowDays;
  } catch {
    return options;
  }
  // No data is not the same as no risk, so say nothing rather than "low".
  if (!crimes.length) return options;

  return options.map((option) => {
    const legs = option.legs.map((leg) =>
      leg.kind === 'walk' && leg.coords.length > 1
        ? {
            ...leg,
            risk: calculateSafetyScore(crimes, leg.coords, new Date(leg.start).getHours(), referenceMs, windowDays),
          }
        : leg,
    );
    const worst = legs.reduce(
      (level, l) => (l.risk && RISK_ORDER.indexOf(l.risk.score) > RISK_ORDER.indexOf(level) ? l.risk.score : level),
      'low' as RiskLevel,
    );
    const scored = legs.some((l) => l.risk);
    const exposure = legs.reduce((sum, l) => sum + (l.risk ? l.risk.density * (l.metres / 1000) : 0), 0);
    return { ...option, legs, risk: scored ? worst : undefined, exposure: scored ? exposure : undefined };
  });
}

export type NextDeparture = { at: number; live: boolean; delay: number };

/** Move a scheduled stop time onto the live forecast for that train, if there is one. */
function liveTime(feed: Feed | null, tripId: string | undefined, route: string, stopId: string | undefined, planned: number) {
  if (!feed) return null;
  const stop = gtfsStopId(stopId);
  const forecast = findForecast(feed, tripId, route, stop, planned);
  if (!forecast) return null;
  const at = forecast.stops.get(stop);
  const when = at?.departure ?? at?.arrival;
  return when ? { at: when, canceled: forecast.canceled } : null;
}

/** The next few times this line leaves the stop you would board at, live where possible. */
export async function nextDepartures(leg: TransitLeg, after: Date, count = 4): Promise<NextDeparture[]> {
  if (!leg.fromStopId) return [];
  const feed = leg.mode === 'SUBWAY' ? await subwayFeed(leg.label).catch(() => null) : null;

  // Subway: read the trains straight off the MTA's live feed.
  if (feed) {
    const live = liveDepartures(feed, leg.label, gtfsStopId(leg.fromStopId), after.getTime(), count);
    if (live.length) {
      // Compare with the timetable only to say how late each one is.
      const scheduled = await get('stoptimes', { stopId: leg.fromStopId, n: 40, time: after.toISOString() }).catch(() => null);
      const plans = (scheduled?.stopTimes ?? [])
        .filter((x: any) => x.routeShortName === leg.label && x.headsign === leg.headsign)
        .map((x: any) => Date.parse(x.place?.scheduledDeparture ?? x.place?.departure));
      return live.map((at) => {
        const planned = plans.reduce((best: number, p: number) => (Math.abs(p - at) < Math.abs(best - at) ? p : best), Infinity);
        return { at, live: true, delay: Number.isFinite(planned) && Math.abs(planned - at) < 10 * 60_000 ? minutesBetween(planned, at) : 0 };
      });
    }
  }

  const data = await get('stoptimes', { stopId: leg.fromStopId, n: 40, time: after.toISOString() });

  const found: NextDeparture[] = [];
  for (const s of data.stopTimes ?? []) {
    if (s.routeShortName !== leg.label || s.headsign !== leg.headsign || s.cancelled || s.tripCancelled) continue;
    const planned = Date.parse(s.place?.scheduledDeparture ?? s.place?.departure);
    let at = Date.parse(s.place?.departure ?? s.place?.scheduledDeparture);
    if (!Number.isFinite(at)) continue;
    let live = !!s.realTime;
    const moved = liveTime(feed, s.tripId, leg.label, leg.fromStopId, planned);
    if (moved) {
      if (moved.canceled) continue;
      at = moved.at;
      live = true;
    }
    if (at < after.getTime() - 60_000) continue;
    found.push({ at, live, delay: minutesBetween(planned, at) });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, count);
}

// ── Walking directions inside a trip ─────────────────────────────────────────

export type DirectionStep = { text: string; metres: number; /** Where the turn is, for following along. */ at?: Point | null };

const directionCache = new Map<string, DirectionStep[]>();

/**
 * How to get from one stop to the next. A change of platform inside a station
 * has no street to name, so it says where to go. Anything else is a real walk
 * and gets the same turn-by-turn directions as a walking route.
 */
export async function walkDirections(leg: TransitLeg, next?: TransitLeg): Promise<DirectionStep[]> {
  const target = next && next.kind === 'ride' ? `${modeName(next.mode)} ${next.label}` : '';
  const toward = next?.headsign ? ` toward ${next.headsign}` : '';

  if (leg.sameStation) {
    return [
      {
        text: target
          ? `Change to the ${target}${toward}. Follow the signs to its platform.`
          : 'Walk through the station and follow the signs to the exit.',
        metres: leg.metres,
      },
    ];
  }

  const key = `${leg.from}|${leg.to}`;
  const cached = directionCache.get(key);
  if (cached) return cached;

  const point = (p: Point): LatLng => ({ latitude: p[0], longitude: p[1] });
  const route = await requestRoute([point(leg.from), point(leg.to)]);
  // Mid-trip, the router's "you have arrived" is not the end of the journey.
  const steps: DirectionStep[] = (route?.steps ?? [])
    .filter((s) => s.instruction && (!target || !/arrived at your destination|destination is on the/i.test(s.instruction)))
    .map((s) => ({ text: s.instruction, metres: s.distance, at: s.at }));
  if (target && steps.length) {
    steps.push({ text: `Enter ${leg.toName} and follow the signs to the ${target}${toward}.`, metres: 0 });
  }
  if (steps.length) directionCache.set(key, steps);
  return steps;
}

// ── Choosing between trips ───────────────────────────────────────────────────

export type RankedTrip = { index: number; tags: string[] };

/**
 * Which trips are worth showing, and why. Four ways to be the best one:
 *
 * - Fastest: arrives first, counting any wait before it leaves and any delay.
 * - Most direct: fewest transfers, then least time on foot.
 * - Safest: least exposure on the walks to and from the stops, once incident
 *   data has arrived. Time spent riding is not scored; only the walking is.
 * - Best balance: arrival time and walking exposure weighed together, with a
 *   small penalty for each transfer, since every change is a wait on a platform.
 *
 * A trip that would miss its connection or is cancelled is never recommended.
 * The balanced trip comes first. A trip can hold several tags.
 */
export function rankTransit(all: TransitOption[]): RankedTrip[] {
  if (!all.length) return [];

  // Work on the usable trips unless there are none.
  const usable = all.filter((o) => !o.atRisk);
  const options = usable.length ? usable : all;

  const quickest = Math.min(...options.map((o) => o.minutes));
  const scored = options.every((o) => o.exposure !== undefined);
  const worstExposure = scored ? Math.max(1, ...options.map((o) => o.exposure as number)) : 1;

  const cost = (o: TransitOption) =>
    o.minutes / quickest +
    (scored ? 0.6 * ((o.exposure as number) / worstExposure) : 0) +
    0.04 * o.transfers +
    0.004 * o.walkMinutes;

  const pick = (better: (a: TransitOption, b: TransitOption) => boolean) =>
    options.reduce((best, o) => (better(o, best) ? o : best), options[0]);

  const balanced = pick((a, b) => cost(a) < cost(b));
  const fastest = pick((a, b) => a.end < b.end || (a.end === b.end && a.walkMinutes < b.walkMinutes));
  const direct = pick(
    (a, b) =>
      a.transfers < b.transfers ||
      (a.transfers === b.transfers && (a.walkMinutes < b.walkMinutes || (a.walkMinutes === b.walkMinutes && a.minutes < b.minutes))),
  );
  const safest = scored
    ? pick(
        (a, b) =>
          (a.exposure as number) < (b.exposure as number) ||
          ((a.exposure as number) === (b.exposure as number) && a.minutes < b.minutes),
      )
    : null;

  const tags = new Map<TransitOption, string[]>();
  const add = (option: TransitOption | null, tag: string) => {
    if (option) tags.set(option, [...(tags.get(option) ?? []), tag]);
  };
  add(balanced, 'Best balance');
  add(safest, 'Safest');
  add(fastest, 'Fastest');
  add(direct, 'Most direct');

  const ranked: RankedTrip[] = [...tags.entries()].map(([option, list]) => ({
    index: all.indexOf(option),
    tags: list,
  }));

  // Always offer a few, filling with the next best on balance. Trips that would
  // not work come last, and only appear if there is nothing else to show.
  const rest = all
    .map((o, index) => ({ o, index }))
    .filter(({ index }) => !ranked.some((r) => r.index === index))
    .sort((a, b) => Number(a.o.atRisk) - Number(b.o.atRisk) || cost(a.o) - cost(b.o));
  for (const { index } of rest) {
    if (ranked.length >= 6) break;
    ranked.push({ index, tags: [] });
  }
  return ranked;
}

export function modeName(mode: string): string {
  switch (mode) {
    case 'SUBWAY':
      return 'Subway';
    case 'BUS':
      return 'Bus';
    case 'RAIL':
      return 'Rail';
    case 'TRAM':
      return 'Tram';
    default:
      return 'Transit';
  }
}

/** Leaves the app and opens the phone's own maps with transit directions. */
export function mapsTransitUrl(start: LatLng, end: LatLng, ios: boolean): string {
  return ios
    ? `http://maps.apple.com/?saddr=${start.latitude},${start.longitude}&daddr=${end.latitude},${end.longitude}&dirflg=r`
    : `https://www.google.com/maps/dir/?api=1&origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&travelmode=transit`;
}

// ── Around you ───────────────────────────────────────────────────────────────

export type NearbyLine = {
  mode: string;
  label: string;
  color: string;
  textColor: string;
  headsign: string;
  times: Array<{ at: number; live: boolean }>;
};

export type NearbyStop = {
  name: string;
  metres: number;
  lines: NearbyLine[];
};

/**
 * The stops within a short walk and what leaves them next, grouped by stop and
 * then by line and direction, with live times where the MTA provides them.
 * Subway stops come before bus stops at the same distance, since that is
 * usually what someone looking at this wants.
 */
export async function nearbyDepartures(here: LatLng, limit = 4): Promise<NearbyStop[]> {
  const data = await get('stoptimes', {
    center: `${here.latitude},${here.longitude}`,
    radius: 500,
    n: 80,
    time: new Date().toISOString(),
  });

  const feeds = new Map<string, Feed | null>();
  for (const route of new Set<string>((data.stopTimes ?? []).filter((s: any) => s.mode === 'SUBWAY').map((s: any) => String(s.routeShortName)))) {
    feeds.set(route, await subwayFeed(route).catch(() => null));
  }

  const stops = new Map<string, NearbyStop & { subway: boolean }>();
  for (const s of data.stopTimes ?? []) {
    if (s.cancelled || s.tripCancelled) continue;
    const place = s.place;
    const planned = Date.parse(place?.scheduledDeparture ?? place?.departure);
    let at = Date.parse(place?.departure ?? place?.scheduledDeparture);
    if (!place || !Number.isFinite(at)) continue;

    let live = !!s.realTime;
    if (s.mode === 'SUBWAY') {
      const moved = liveTime(feeds.get(String(s.routeShortName)) ?? null, s.tripId, String(s.routeShortName), place.stopId, planned);
      if (moved) {
        if (moved.canceled) continue;
        at = moved.at;
        live = true;
      }
    }
    if (at < Date.now() - 60_000) continue;

    const key = `${s.mode === 'SUBWAY' ? 'S' : 'B'}${place.name}`;
    let stop = stops.get(key);
    if (!stop) {
      stop = {
        name: place.name,
        metres: metresBetween(here.latitude, here.longitude, place.lat, place.lon),
        lines: [],
        subway: s.mode === 'SUBWAY',
      };
      stops.set(key, stop);
    }
    const label = String(s.routeShortName || s.displayName || '?');
    let line = stop.lines.find((l) => l.label === label && l.headsign === (s.headsign || ''));
    if (!line) {
      line = {
        mode: s.mode,
        label,
        color: hex(s.routeColor, fallbackColour(s.mode)),
        textColor: hex(s.routeTextColor, '#ffffff'),
        headsign: s.headsign || '',
        times: [],
      };
      stop.lines.push(line);
    }
    line.times.push({ at, live });
  }

  return [...stops.values()]
    .sort((a, b) => a.metres - b.metres + (a.subway === b.subway ? 0 : a.subway ? -80 : 80))
    .slice(0, limit)
    .map(({ subway, ...stop }) => ({
      ...stop,
      lines: stop.lines
        .map((l) => ({ ...l, times: l.times.sort((a, b) => a.at - b.at).slice(0, 3) }))
        .slice(0, 4),
    }));
}
