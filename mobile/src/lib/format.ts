/**
 * Times and distances, phrased the way a walker reads them.
 */

export type Departure = 'now' | 'night' | { hour: number; minute: number };

export function departureDate(choice: Departure): Date {
  const now = new Date();
  if (choice === 'now') return now;

  const when = new Date(now);
  if (choice === 'night') {
    when.setHours(22, 0, 0, 0);
    if (when < now) when.setDate(when.getDate() + 1);
    return when;
  }

  when.setHours(choice.hour, choice.minute, 0, 0);
  // A time already past today means you mean tomorrow.
  if (when < now) when.setDate(when.getDate() + 1);
  return when;
}

export function departureHour(choice: Departure): number {
  return departureDate(choice).getHours();
}

export function formatClock(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function arrivalTime(choice: Departure, minutes: number): string {
  return formatClock(new Date(departureDate(choice).getTime() + minutes * 60000));
}

/** 5 km/h, for distances that never went through the router. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round((metres / 1000 / 5) * 60));
}

/** The router already accounts for crossings and steps, so prefer its figure. */
export function routeMinutes(route: { duration: number; distance: number }): number {
  if (Number.isFinite(route.duration) && route.duration > 0) {
    return Math.max(1, Math.round(route.duration / 60));
  }
  return walkMinutes(route.distance);
}

let units: 'imperial' | 'metric' = 'imperial';

/** Set from the settings; every distance on screen follows it. */
export function setUnits(next: 'imperial' | 'metric') {
  units = next;
}

export function formatDistance(metres: number): string {
  if (units === 'metric') {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
  }
  if (metres >= 1609) return `${(metres / 1609.34).toFixed(1)} mi`;
  return `${Math.round(metres * 3.28084)} ft`;
}

/** The long-distance form: miles, or kilometres. */
export function formatMiles(metres: number): string {
  return units === 'metric'
    ? `${(metres / 1000).toFixed(1)} km`
    : `${(metres / 1609.34).toFixed(1)} mi`;
}

export function isAfterDark(hour: number): boolean {
  return hour >= 20 || hour < 6;
}
