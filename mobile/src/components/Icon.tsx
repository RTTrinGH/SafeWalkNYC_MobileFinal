import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * One consistent set of line icons, drawn on a 24px grid with a 1.75 stroke, so
 * the interface carries no emoji and every glyph weighs the same.
 */
export type IconName =
  | 'search'
  | 'back'
  | 'close'
  | 'chevron'
  | 'settings'
  | 'locate'
  | 'walk'
  | 'subway'
  | 'bus'
  | 'home'
  | 'work'
  | 'school'
  | 'gym'
  | 'coffee'
  | 'food'
  | 'shop'
  | 'health'
  | 'heart'
  | 'park'
  | 'star'
  | 'pin'
  | 'clock'
  | 'swap'
  | 'shield'
  | 'alert'
  | 'plus'
  | 'block'
  | 'traffic'
  | 'people'
  | 'bulb'
  | 'share'
  | 'check';

type Props = { name: IconName; size?: number; color: string; strokeWidth?: number };

export default function Icon({ name, size = 20, color, strokeWidth = 1.75 }: Props) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {draw(name, common, color)}
    </Svg>
  );
}

function draw(name: IconName, c: any, color: string) {
  switch (name) {
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} {...c} />
          <Path d="M16 16l4.5 4.5" {...c} />
        </>
      );
    case 'back':
      return <Path d="M15 5l-7 7 7 7" {...c} />;
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" {...c} />;
    case 'chevron':
      return <Path d="M9 5l7 7-7 7" {...c} />;
    case 'settings':
      return (
        <>
          <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...c} />
          <Circle cx={15} cy={7} r={2} {...c} />
          <Circle cx={9} cy={17} r={2} {...c} />
        </>
      );
    case 'locate':
      return (
        <>
          <Circle cx={12} cy={12} r={3.5} {...c} />
          <Path d="M12 3v3M12 18v3M3 12h3M18 12h3" {...c} />
        </>
      );
    case 'walk':
      return (
        <>
          <Circle cx={13} cy={4.5} r={1.8} {...c} />
          <Path d="M10.5 21l1.6-6.5-2.1-2.3 1.2-4.2 3.3 1.5 2.3 3M8 11l2.2-3.6M12.1 14.5l2.4 2.3 1 4.2" {...c} />
        </>
      );
    case 'subway':
      return (
        <>
          <Rect x={5} y={3.5} width={14} height={13} rx={3} {...c} />
          <Path d="M5 11h14M8 20l2-3.5M16 20l-2-3.5" {...c} />
          <Circle cx={8.7} cy={13.7} r={0.6} fill={color} stroke="none" />
          <Circle cx={15.3} cy={13.7} r={0.6} fill={color} stroke="none" />
        </>
      );
    case 'bus':
      return (
        <>
          <Rect x={4.5} y={3.5} width={15} height={14} rx={3} {...c} />
          <Path d="M4.5 11h15M7.5 20.5v-3M16.5 20.5v-3" {...c} />
          <Circle cx={8.3} cy={14.2} r={0.6} fill={color} stroke="none" />
          <Circle cx={15.7} cy={14.2} r={0.6} fill={color} stroke="none" />
        </>
      );
    case 'home':
      return <Path d="M4 11l8-6.5 8 6.5M6 9.5V20h4.5v-5h3v5H18V9.5" {...c} />;
    case 'work':
      return (
        <>
          <Rect x={3.5} y={7.5} width={17} height={12} rx={2} {...c} />
          <Path d="M9 7.5V6a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 6v1.5M3.5 13h17" {...c} />
        </>
      );
    case 'school':
      return <Path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5zM6.5 11.5V16c0 1 2.5 2.5 5.5 2.5s5.5-1.5 5.5-2.5v-4.5" {...c} />;
    case 'gym':
      return <Path d="M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11" {...c} />;
    case 'coffee':
      return <Path d="M5 9h11v5a4 4 0 01-4 4H9a4 4 0 01-4-4V9zM16 10h1.5a2 2 0 010 4H16M8 4.5v2M12 4.5v2" {...c} />;
    case 'food':
      return <Path d="M7 3.5v7M5 3.5v4a2 2 0 004 0v-4M7 10.5V20.5M16.5 20.5V3.5c-2 1.5-3 4-3 7h3" {...c} />;
    case 'shop':
      return <Path d="M5 8h14l-1 12H6L5 8zM9 8V6.5a3 3 0 016 0V8" {...c} />;
    case 'health':
      return <Path d="M12 5v14M5 12h14" {...c} />;
    case 'heart':
      return <Path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0112 7.6 4.2 4.2 0 0119.5 10c0 5.4-7.5 10-7.5 10z" {...c} />;
    case 'park':
      return <Path d="M12 20v-6M12 3.5c3.5 2.5 5.2 5 5.2 7.2A5.2 5.2 0 0112 15.9a5.2 5.2 0 01-5.2-5.2c0-2.2 1.7-4.7 5.2-7.2z" {...c} />;
    case 'star':
      return <Path d="M12 4l2.5 5.1 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.3 8 13.8 4 9.9l5.5-.8L12 4z" {...c} />;
    case 'pin':
      return (
        <>
          <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z" {...c} />
          <Circle cx={12} cy={10} r={2.3} {...c} />
        </>
      );
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={8} {...c} />
          <Path d="M12 7.5V12l3 2" {...c} />
        </>
      );
    case 'swap':
      return <Path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" {...c} />;
    case 'shield':
      return <Path d="M12 3.5l7 2.5v5.5c0 4.2-2.8 7.6-7 9-4.2-1.4-7-4.8-7-9V6l7-2.5z" {...c} />;
    case 'alert':
      return (
        <>
          <Path d="M12 4.5l9 15.5H3L12 4.5z" {...c} />
          <Path d="M12 10v4.5" {...c} />
          <Circle cx={12} cy={17.2} r={0.7} fill={color} stroke="none" />
        </>
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...c} />;
    case 'block':
      return (
        <>
          <Circle cx={12} cy={12} r={8} {...c} />
          <Path d="M6.3 6.3l11.4 11.4" {...c} />
        </>
      );
    case 'traffic':
      return (
        <>
          <Rect x={8} y={3.5} width={8} height={17} rx={3} {...c} />
          <Circle cx={12} cy={8} r={1} fill={color} stroke="none" />
          <Circle cx={12} cy={12} r={1} fill={color} stroke="none" />
          <Circle cx={12} cy={16} r={1} fill={color} stroke="none" />
        </>
      );
    case 'people':
      return (
        <>
          <Circle cx={9} cy={8.5} r={3} {...c} />
          <Path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5M16 5.8a3 3 0 010 5.4M18 14.4c1.7.6 2.7 2 3 4.1" {...c} />
        </>
      );
    case 'bulb':
      return <Path d="M9.5 17.5h5M10 20.5h4M12 3.5a5.5 5.5 0 00-3.2 10c.5.4.7 1 .7 1.6V17h5v-1.9c0-.6.2-1.2.7-1.6a5.5 5.5 0 00-3.2-10z" {...c} />;
    case 'share':
      return <Path d="M12 15V4M8 7.5L12 4l4 3.5M6 11v8h12v-8" {...c} />;
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7.5" {...c} />;
  }
}

/** Saved places can be given any of these. */
export const PLACE_ICON_NAMES: IconName[] = [
  'home', 'work', 'school', 'gym', 'coffee', 'food', 'shop', 'health', 'heart', 'park', 'star', 'pin',
];

/** Places saved before icons were drawn kept an emoji; show those as a plain pin. */
export function placeIcon(stored: string): IconName {
  return (PLACE_ICON_NAMES as string[]).includes(stored) ? (stored as IconName) : 'pin';
}
