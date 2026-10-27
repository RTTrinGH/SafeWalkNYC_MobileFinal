/**
 * Address search, via Nominatim.
 *
 * Nominatim hands back the whole postal hierarchy - "Times Square, West 42nd
 * Street, Theater District, Manhattan, New York County, City of New York, New
 * York, 10036, United States" - which is unreadable in a dropdown and absurd
 * sitting in a text field. It also returns an authoritative `name`, which is
 * what a place is actually called, so use that rather than trying to
 * reconstruct one from the address parts.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Nominatim asks that clients identify themselves.
const HEADERS = { 'User-Agent': 'SafeWalkNYC/1.0 (mobile)' };

// Roughly the five boroughs.
const VIEWBOX = '-74.3,40.45,-73.68,40.93';

export type Place = {
  primary: string;
  secondary: string;
  latitude: number;
  longitude: number;
};

function isAdministrative(part: string): boolean {
  return /community (board|district)|county|^city of /i.test(part);
}

export function shortPlaceName(item: any): { primary: string; secondary: string } {
  const a = item.address || {};

  const street =
    a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road;
  const primary =
    (item.name || '').trim() ||
    street ||
    (item.display_name || '').split(',')[0].trim();

  /*
   * Neighbourhood then borough: enough to tell two "Main Street" results apart
   * without reciting the county, the postcode and the country. city_district is
   * deliberately skipped - in New York it comes back as "Manhattan Community
   * Board 5", an administrative unit nobody navigates by.
   */
  const secondary = [
    street && street !== primary ? street : null,
    a.neighbourhood || a.quarter,
    a.suburb || a.borough || a.town,
  ]
    .filter(Boolean)
    .filter((part: string) => !isAdministrative(part) && part !== primary)
    .filter((part: string, i: number, all: string[]) => all.indexOf(part) === i)
    .slice(0, 2)
    .join(', ');

  return { primary: String(primary), secondary };
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const params = new URLSearchParams({
    q: `${query}, NYC`,
    format: 'json',
    limit: '6',
    bounded: '1',
    viewbox: VIEWBOX,
    addressdetails: '1',
  });

  const response = await fetch(`${NOMINATIM}/search?${params}`, {
    signal,
    headers: HEADERS,
  });
  if (!response.ok) throw new Error('Address search failed');

  const results = await response.json();
  const seen = new Set<string>();

  return results
    .filter((r: any) => r.display_name)
    .map((r: any) => {
      const name = shortPlaceName(r);
      return {
        ...name,
        latitude: Number(r.lat),
        longitude: Number(r.lon),
      };
    })
    .filter((p: Place) => {
      // Nominatim returns a station, its platform and its stop as three
      // separate hits at the same corner. Keep the first, which ranks highest.
      const key = [
        p.primary.toLowerCase(),
        p.latitude.toFixed(3),
        p.longitude.toFixed(3),
      ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Turn a fix from the GPS into something readable. */
export async function describeLocation(
  latitude: number,
  longitude: number,
): Promise<string> {
  const params = new URLSearchParams({
    format: 'json',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '18',
    addressdetails: '1',
  });

  const response = await fetch(`${NOMINATIM}/reverse?${params}`, {
    headers: HEADERS,
  });
  if (!response.ok) return 'My location';

  const place = await response.json();
  const name = shortPlaceName(place);
  return name.secondary ? `${name.primary}, ${name.secondary}` : name.primary;
}
