import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { RouteBadge } from './TransitSheet';
import { PrimaryButton, SecondaryButton, surfaceStyle } from './ui';
import { formatClock, formatDistance } from '../lib/format';
import { DirectionStep, TransitLeg, TransitOption, modeName } from '../lib/transit';
import { Theme, numeric, radius, shadow } from '../theme';

const clock = (ms: number) => formatClock(new Date(ms));

/** "now", "in 4 min". */
const until = (ms: number, now: number) => {
  const mins = Math.round((ms - now) / 60_000);
  return mins <= 0 ? 'now' : `in ${mins} min`;
};

type BannerProps = {
  t: Theme;
  top: number;
  leg: TransitLeg;
  next?: TransitLeg;
  onBoard: boolean;
  now: number;
  toLegEnd: number | null;
  step: DirectionStep | null;
};

/** What to do right now, in one glance. */
export function TransitNavBanner({ t, top, leg, next, onBoard, now, toLegEnd, step }: BannerProps) {
  let main = '';
  let sub = '';
  let warn = '';
  let urgent = false;

  if (leg.kind === 'walk') {
    const where = leg.toName === 'END' ? 'your destination' : leg.toName;
    main = step?.text || (leg.sameStation && next ? `Change to the ${modeName(next.mode)} ${next.label}.` : `Walk to ${where}.`);
    const left = toLegEnd !== null && Number.isFinite(toLegEnd) ? `${formatDistance(toLegEnd)} to ${where}` : `${leg.minutes} min to ${where}`;
    sub = leg.note ? `${left}. ${leg.note}.` : left;
  } else if (!onBoard) {
    main = `Board the ${leg.label}${leg.headsign ? ` toward ${leg.headsign}` : ''}`;
    sub = `${clock(leg.start)} at ${leg.fromName}, ${until(leg.start, now)}`;
    if (leg.live && leg.delay >= 2) sub += `. Running ${leg.delay} min late`;
  } else {
    const remaining = leg.end - now;
    urgent = remaining < 150_000;
    const stopsLeft = Math.max(1, Math.ceil((leg.stops * Math.max(0, remaining)) / Math.max(1, leg.end - leg.start)));
    main = urgent ? `Get off at ${leg.toName}` : `Ride to ${leg.toName}`;
    sub = urgent
      ? 'This is your stop. Get ready to leave the train.'
      : `${until(leg.end, now)}, ${stopsLeft} stop${stopsLeft === 1 ? '' : 's'} to go`;
  }

  if (leg.cancelled) warn = 'This trip has been cancelled.';
  else if (leg.missed) warn = 'You may miss this connection.';

  return (
    <View style={[styles.banner, { top, backgroundColor: urgent ? t.amber : t.ink }]}>
      <View style={styles.bannerIcon}>
        {leg.kind === 'ride' ? (
          <RouteBadge leg={leg} size={34} />
        ) : (
          <Icon name="walk" size={30} color={urgent ? t.onAccent : t.surface} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerMain, { color: urgent ? t.onAccent : t.surface }]} numberOfLines={3}>
          {main}
        </Text>
        <Text style={[styles.bannerSub, { color: urgent ? t.onAccent : t.surface }, numeric]} numberOfLines={3}>
          {sub}
        </Text>
        {!!warn && <Text style={[styles.bannerWarn, { color: urgent ? t.onAccent : t.red }]}>{warn}</Text>}
      </View>
    </View>
  );
}

type SheetProps = {
  t: Theme;
  bottomInset: number;
  option: TransitOption;
  index: number;
  now: number;
  last: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onEnd: () => void;
  onShare: () => void;
};

/** Where you are in the trip, and the controls. */
export function TransitNavSheet({ t, bottomInset, option, index, now, last, onPrevious, onNext, onEnd, onShare }: SheetProps) {
  const leg = option.legs[index];
  const minsLeft = Math.max(0, Math.round((option.end - now) / 60_000));
  const alert = leg?.alerts?.[0];

  return (
    <View style={[styles.sheet, surfaceStyle(t), { paddingBottom: bottomInset + 10 }]}>
      <View style={styles.summary}>
        <View>
          <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>Arrive</Text>
          <Text style={[styles.arrive, { color: t.ink }, numeric]}>{clock(option.end)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[{ color: t.ink2, fontSize: 15 }, numeric]}>{minsLeft} min left</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {option.legs.map((l, i) => {
          const done = i < index;
          const here = i === index;
          return (
            <View
              key={i}
              style={[
                styles.chip,
                { borderColor: here ? t.ink : t.rule, backgroundColor: t.surface, opacity: done ? 0.45 : 1, borderWidth: here ? 1.5 : 1 },
              ]}
            >
              {done ? (
                <Icon name="check" size={16} color={t.green} />
              ) : l.kind === 'ride' ? (
                <RouteBadge leg={l} size={22} />
              ) : (
                <Icon name="walk" size={18} color={t.ink2} />
              )}
              <Text style={[{ color: t.ink2, fontSize: 12 }, numeric]}>{l.kind === 'ride' ? clock(l.start) : `${l.minutes} min`}</Text>
            </View>
          );
        })}
      </ScrollView>

      {!!alert && (
        <View style={[styles.notice, { backgroundColor: t.amberTint }]}>
          <Icon name="alert" size={16} color={t.amber} />
          <Text style={{ color: t.ink, fontSize: 13, lineHeight: 18, flex: 1 }} numberOfLines={3}>
            {alert.header}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <SecondaryButton t={t} label="Back" onPress={onPrevious} style={{ height: 44, paddingHorizontal: 16 }} />
        <PrimaryButton t={t} label={last ? 'I have arrived' : 'Next step'} onPress={onNext} style={{ flex: 1, height: 44, marginTop: 0 }} />
      </View>
      <View style={styles.footer}>
        <Pressable onPress={onShare} hitSlop={8}>
          <Text style={{ color: t.blue, fontWeight: '600', fontSize: 14 }}>Share trip</Text>
        </Pressable>
        <Pressable onPress={onEnd} hitSlop={8}>
          <Text style={{ color: t.red, fontWeight: '600', fontSize: 14 }}>End trip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    ...shadow,
  },
  bannerIcon: { width: 40, alignItems: 'center' },
  bannerMain: { fontSize: 17, fontWeight: '600' },
  bannerSub: { fontSize: 14, marginTop: 3, opacity: 0.85 },
  bannerWarn: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  summary: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  arrive: { fontSize: 24, fontWeight: '600', letterSpacing: -0.4 },
  strip: { gap: 8, paddingBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: radius.md, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, paddingHorizontal: 4 },
});
