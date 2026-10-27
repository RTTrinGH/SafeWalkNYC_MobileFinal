/**
 * A restrained palette: cool neutrals, near-black ink, and one blue that always
 * means "your route". Colour appears only where it carries information, which
 * is risk (green / amber / red) and the lines of the transit system itself.
 *
 * Type is the platform's own face throughout. Figures line up with tabular
 * numerals rather than a monospace face.
 */

export type Theme = typeof lightTheme;

export const lightTheme = {
  dark: false,

  paper: '#f4f5f6',
  surface: '#ffffff',
  surfaceSunk: '#eff0f2',

  ink: '#101418',
  ink2: '#4a525c',
  ink3: '#868d97',

  rule: '#e4e6e9',
  ruleStrong: '#cfd3d8',

  blue: '#1b55d6',
  blueDeep: '#1444ae',
  blueTint: '#e9effc',
  orange: '#d9541e',

  green: '#17803f',
  greenTint: '#e6f3ea',
  amber: '#a76a00',
  amberTint: '#fbf0dc',
  red: '#c8342b',
  redTint: '#fbe9e7',

  teal: '#0f7f86',
  tealTint: '#e1f1f2',

  onAccent: '#ffffff',
};

export const darkTheme: Theme = {
  dark: true,

  paper: '#0c0e11',
  surface: '#15181d',
  surfaceSunk: '#1d2127',

  ink: '#eceff3',
  ink2: '#b0b7c1',
  ink3: '#7d8590',

  rule: '#262a31',
  ruleStrong: '#363b44',

  blue: '#6b97ff',
  blueDeep: '#8fb0ff',
  blueTint: '#18233d',
  orange: '#ff8a5c',

  green: '#4cc283',
  greenTint: '#122a1d',
  amber: '#e2b050',
  amberTint: '#2c2412',
  red: '#ff7b70',
  redTint: '#33201e',

  teal: '#4cc4cc',
  tealTint: '#102d30',

  onAccent: '#0c0e11',
};

/** Kept so existing styles that name a font family fall back to the system face. */
export const mono = undefined as unknown as string;

/** Spread into a text style so columns of figures line up. */
export const numeric = { fontVariant: ['tabular-nums' as const] };

export const radius = { sm: 8, md: 10, lg: 14, pill: 999 };

/** One restrained shadow, used on floating surfaces only. */
export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 3 },
  elevation: 5,
};

export const riskColours = (t: Theme) => ({
  low: { fg: t.green, bg: t.greenTint, label: 'Low risk' },
  medium: { fg: t.amber, bg: t.amberTint, label: 'Medium risk' },
  high: { fg: t.red, bg: t.redTint, label: 'High risk' },
});

/**
 * Google Maps styling for Android, so the basemap recedes and the route is the
 * loudest thing on it. Apple Maps follows the system appearance on its own.
 */
export const mapStyleLight = [
  { elementType: 'geometry', stylers: [{ color: '#eef0f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#868d97' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e2eadf' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e3e6ea' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfdbe4' }] },
];

export const mapStyleDark = [
  { elementType: 'geometry', stylers: [{ color: '#171a20' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7d8590' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1115' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1a2620' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#242932' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2f3540' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#10161f' }] },
];
