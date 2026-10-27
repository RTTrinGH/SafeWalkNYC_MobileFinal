/**
 * Safety model
 * ----------------------------------------------------------------------------
 * A direct port of the web app's scoring, unchanged in its numbers so the two
 * give the same answer for the same walk.
 *
 *   1. What kind of offence it was, because different crimes have different
 *      severities.
 *   2. Whether it happened on the street or behind a door. Nearly half of all
 *      reports are INSIDE a home or a shop, and those are not representative
 *      of whether a block is safe to walk down.
 *   3. What time of day it happened, matched against when you are going.
 *   4. How many people will be out at that hour, which helps turn a count
 *      of incidents into a risk to a person.
 */

import { degreesToRoute, routeLengthKm, Point } from './geo';

export type Crime = {
  lat: number;
  lng: number;
  offence: string;
  detail?: string;
  lawCat?: string;
  date?: string;
  time?: string;
  where?: string;
  premises?: string;
  completed?: string;
};

export type RiskLevel = 'low' | 'medium' | 'high';

export type SafetyScore = {
  score: RiskLevel;
  count: number;
  riskScore: number;
  density: number;
  safetyIndex: number;
  reason: string;
  categories: Record<string, number>;
};

// How much each offence bears on someone walking past: could this have
// happened to a pedestrian, and how badly would it have gone?
const OFFENCE_WEIGHTS: Array<[RegExp, number]> = [
  [/murder|homicide|shooting/, 10],
  [/rape|sex crime|sexual abuse|forcible touching|sex abuse/, 10],
  [/kidnapping|abduction/, 9],
  [/robbery/, 8],
  [/felony assault/, 8],
  [/assault|menacing|stalking|harassment/, 5],
  [/weapons|dangerous weapon/, 3.5],
  [/arson/, 3],
  [/burglary/, 1.5],
  [/larceny.*vehicle|vehicle.*larceny|auto stripping/, 0.2],
  [/grand larceny|petit larceny|theft/, 1.2],
  [/criminal mischief/, 0.6],
  [/drug|controlled substance|marijuana/, 0.8],
  [/trespass/, 0.5],
  [/fraud|forgery|identity theft|impersonation|embezzlement/, 0.1],
];

export function offenceWeight(description?: string): number {
  const text = (description || '').toLowerCase();
  for (const [pattern, weight] of OFFENCE_WEIGHTS) {
    if (pattern.test(text)) return weight;
  }
  return 1;
}

// Street level, or behind a door. This is the single largest correction:
// without it, busy shopping blocks look dangerous because of shoplifting, when
// they are usually the better place to walk after dark.
export function exposureWeight(crime: Crime): number {
  const where = (crime.where || '').toUpperCase();
  const premises = (crime.premises || '').toUpperCase();

  const outdoors =
    /STREET|PARK|PLAYGROUND|HIGHWAY|BRIDGE|TUNNEL|PARKING|GAS STATION|OPEN AREA|SUBWAY|TRANSIT|BUS|FERRY|MARINA/.test(
      premises,
    );

  if (/FRONT OF|OPPOSITE OF|OUTSIDE|REAR OF/.test(where)) {
    return outdoors ? 1.15 : 1;
  }
  if (/INSIDE/.test(where)) {
    // Inside a station or a park building is still somewhere you may be.
    return outdoors ? 0.6 : 0.25;
  }
  // Location not recorded: assume nothing either way.
  return outdoors ? 0.9 : 0.7;
}

export function severityWeight(lawCat?: string): number {
  const cat = (lawCat || '').toUpperCase();
  if (cat === 'FELONY') return 1.35;
  if (cat === 'VIOLATION') return 0.7;
  return 1;
}

// Hours wrap, so 23:00 and 01:00 are two apart, not twenty-two.
function hourGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 24;
  return Math.min(gap, 24 - gap);
}

function crimeHour(crime: Crime): number | null {
  const raw = crime.time;
  if (!raw) return null;
  const hour = parseInt(String(raw).slice(0, 2), 10);
  return Number.isFinite(hour) && hour >= 0 && hour < 24 ? hour : null;
}

/*
 * How many people are out walking, by hour, against the midday peak. The shape
 * is the standard one for a dense city: a deep trough around 3-5am, a sharp
 * morning climb, a broad midday and evening plateau.
 *
 * Without this the scores ran backwards. Counting incidents alone made 2am look
 * safer than 2pm almost everywhere, because most reports are daytime ones. But
 * a walker does not care how many things happened, they care about the chance
 * of one happening to them, and at 3am the same street holds a twentieth of the
 * people.
 */
const PEDESTRIAN_ACTIVITY = [
  0.2, 0.13, 0.09, 0.06, 0.06, 0.1, // midnight to 5am
  0.25, 0.5, 0.8, 0.85, 0.85, 0.95, // 6am to 11am
  1.0, 1.0, 0.95, 0.95, 0.95, 1.0, // noon to 5pm
  0.95, 0.8, 0.65, 0.5, 0.4, 0.3, // 6pm to 11pm
];

/*
 * Fewer people about means each incident represents more risk per head, and it
 * is darker. Raised to 0.75 rather than 1 because "safety in numbers" is real
 * but not linear, and capped at 4x so the small hours stay a strong signal
 * rather than an absurd one.
 */
export function lonelinessFactor(hour: number): number {
  const activity = PEDESTRIAN_ACTIVITY[hour];
  if (!activity) return 1;
  return Math.min(4, Math.pow(1 / activity, 0.75));
}

// An incident at the hour you will be out matters far more than the same
// incident at breakfast time.
function timeOfDayWeight(crime: Crime, travelHour: number): number {
  const hour = crimeHour(crime);
  if (hour === null) return 1;
  const gap = hourGap(hour, travelHour);
  if (gap <= 1) return 2.2;
  if (gap <= 2) return 1.8;
  if (gap <= 3) return 1.4;
  if (gap <= 4) return 1.1;
  return 0.6;
}

// Measured against the newest data in the feed rather than against today.
// The year-to-date dataset runs a quarter behind, so judging by wall-clock time
// makes every incident look stale and flattens the signal to nothing.
function recencyWeight(crime: Crime, referenceMs: number): number {
  if (!crime.date) return 1;
  const when = new Date(crime.date);
  if (isNaN(when.getTime())) return 1;
  const days = (referenceMs - when.getTime()) / 86400000;
  if (days <= 30) return 1.8;
  if (days <= 90) return 1.4;
  if (days <= 180) return 1.15;
  return 1;
}

function attemptWeight(crime: Crime): number {
  return /ATTEMPTED/i.test(crime.completed || '') ? 0.7 : 1;
}

// Plain-language grouping, used to explain a score rather than to set it.
export function crimeCategory(description?: string): string {
  const text = (description || '').toLowerCase();
  if (/rape|sex crime|sexual|forcible touching/.test(text)) return 'sex offences';
  if (/robbery/.test(text)) return 'robbery';
  if (/assault|menacing|harassment|stalking/.test(text)) return 'assault';
  if (/murder|homicide|shooting|weapons/.test(text)) return 'violence';
  if (/larceny|theft|burglary/.test(text)) return 'theft';
  return 'other';
}

/** The weight one incident carries for a walk at `hour`. */
export function crimeWeight(
  crime: Crime,
  hour: number,
  referenceMs: number = Date.now(),
): number {
  return (
    offenceWeight(crime.offence) *
    exposureWeight(crime) *
    severityWeight(crime.lawCat) *
    timeOfDayWeight(crime, hour) *
    recencyWeight(crime, referenceMs) *
    attemptWeight(crime)
  );
}

// ~120m either side of the path. At 200m the corridors of two parallel streets
// overlap so heavily that alternatives score almost the same, which defeats the
// point of comparing them.
export const ROUTE_BUFFER_DEGREES = 0.0012;

const CATEGORY_WORDS: Record<string, string> = {
  'sex offences': 'sex offences',
  robbery: 'robbery',
  assault: 'assault',
  violence: 'violent crime',
  theft: 'theft',
  other: 'minor offences',
};

/*
 * One short sentence a person can act on. It has to scale with the number:
 * naming the worst category regardless of how much of it there was made a quiet
 * street in Park Slope, with two reports in three months, read exactly like
 * Times Square.
 */
function describeSafety(
  categories: Record<string, number>,
  count: number,
  hour: number,
  riskLevel: RiskLevel,
): string {
  if (!count) return 'No recent incidents reported nearby';

  const ranked = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'No recent incidents reported nearby';

  const word = CATEGORY_WORDS[ranked[0][0]] || 'incidents';
  const atNight = hour >= 21 || hour < 5;
  const when = atNight ? 'around this hour' : 'at this time of day';

  // On a quiet route the reassurance and the scale are the useful part. Naming
  // the worst category there reads as a warning about nothing.
  if (riskLevel === 'low') {
    return `Quiet stretch, ${count} report${count === 1 ? '' : 's'} nearby`;
  }
  if (riskLevel === 'medium') {
    return `Some ${word} reported ${when}`;
  }
  return `Frequent ${word} reported ${when}`;
}

export function calculateSafetyScore(
  crimes: Crime[],
  route: Point[],
  travelHour: number,
  referenceMs: number = Date.now(),
  windowDays: number = 30,
): SafetyScore {
  if (!crimes.length || route.length < 2) {
    return {
      score: 'low',
      count: 0,
      riskScore: 0,
      density: 0,
      safetyIndex: 100,
      reason: 'No recent incidents reported nearby',
      categories: {},
    };
  }

  let total = 0;
  let count = 0;
  const categories: Record<string, number> = {};
  const lengthKm = routeLengthKm(route);

  for (const crime of crimes) {
    if (!Number.isFinite(crime.lat) || !Number.isFinite(crime.lng)) continue;

    const away = degreesToRoute(crime.lat, crime.lng, route);
    if (away > ROUTE_BUFFER_DEGREES) continue;

    const weight = crimeWeight(crime, travelHour, referenceMs);

    // Things that barely register for a walker should not pad the count
    // either, or every shopping street reads as busy with crime.
    if (weight < 0.4) continue;

    count++;
    const contribution = weight * Math.max(0.1, 1 - away / ROUTE_BUFFER_DEGREES);

    const category = crimeCategory(crime.offence);
    categories[category] = (categories[category] || 0) + contribution;
    total += contribution;
  }

  /*
   * Weighted risk per km per 30 days, then corrected for how alone you will be.
   * Dividing by the window keeps the number meaning the same thing however much
   * history was fetched - otherwise widening the window silently inflates every
   * score and the bands below stop matching reality.
   */
  const perKm = lengthKm > 0 ? total / lengthKm : total;
  const perMonth = perKm / (windowDays / 30);
  const density = perMonth * lonelinessFactor(travelHour);

  /*
   * Bands come from the spread of real walks, not from a guess. Two dozen ~1km
   * routes across all five boroughs, each scored at 2pm, 11pm and 2am, as
   * weighted risk per km per 30 days:
   *
   *   under 60    Park Slope 12 / 45, Riverdale 17 / 28, Williamsburg 21 / 62,
   *               Upper East Side 37 / 50, Astoria 57 / 134
   *   60 to 200   Bed-Stuy 68 / 191, Flatbush 78 / 119, Harlem 123 / 345,
   *               Flushing 113 / 181
   *   over 200    Midtown 213 / 645, Bushwick 213 / 478, Times Square 287 / 1007
   *
   * Which lands at roughly 46% low in daylight against 17% at 11pm and 13% at
   * 2am. Chelsea is the clearest case for why the hour has to count: 55 at two
   * in the afternoon and 256 at eleven at night, on the same pavement.
   */
  let score: RiskLevel;
  if (density >= 200) score = 'high';
  else if (density >= 60) score = 'medium';
  else score = 'low';

  return {
    score,
    count,
    riskScore: Math.round(total),
    density: Math.round(density * 10) / 10,
    safetyIndex: Math.round(100 / (1 + density / 110)),
    reason: describeSafety(categories, count, travelHour, score),
    categories,
  };
}
