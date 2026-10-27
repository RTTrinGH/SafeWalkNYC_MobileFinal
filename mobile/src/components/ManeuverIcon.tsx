/**
 * Rounded arrows drawn to match the maneuver, so a glance is enough. The same
 * shapes the web app uses.
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';

const PATHS: Record<string, string> = {
  straight: 'M12 20V5M12 5l-5 5M12 5l5 5',
  left: 'M6 18h6a5 5 0 0 0 5-5V8M17 8l-4 4M17 8l4 4',
  right: 'M18 18h-6a5 5 0 0 1-5-5V8M7 8l4 4M7 8l-4 4',
  slightLeft: 'M8 20v-6a5 5 0 0 1 5-5h4M17 9l-4-4M17 9l-4 4',
  slightRight: 'M16 20v-6a5 5 0 0 0-5-5H7M7 9l4-4M7 9l4 4',
  uturn: 'M7 20V11a5 5 0 0 1 10 0v3M17 14l-3-3M17 14l3-3',
  arrive: 'M7 21V4h10l-2.5 4L17 12H7',
};

export function maneuverShape(type: string, modifier: string): string {
  if (/arrive/.test(type)) return 'arrive';
  if (/uturn/.test(modifier)) return 'uturn';
  if (/slight left/.test(modifier)) return 'slightLeft';
  if (/slight right/.test(modifier)) return 'slightRight';
  if (/left/.test(modifier)) return 'left';
  if (/right/.test(modifier)) return 'right';
  return 'straight';
}

type Props = {
  type: string;
  modifier: string;
  size?: number;
  color: string;
};

export default function ManeuverIcon({ type, modifier, size = 24, color }: Props) {
  const shape = maneuverShape(type, modifier);
  const arriving = shape === 'arrive';

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={PATHS[shape]}
        fill={arriving ? color : 'none'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
