import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { PrimaryButton, SecondaryButton, Tabs, surfaceStyle } from './ui';
import { formatClock, formatDistance, formatMiles } from '../lib/format';
import {
  DirectionStep,
  LiveStatus,
  NextDeparture,
  RankedTrip,
  TransitFilter,
  TransitLeg,
  TransitOption,
  modeName,
  nextDepartures,
  walkDirections,
} from '../lib/transit';
import { Theme, numeric, radius, riskColours } from '../theme';

type Props = {
  t: Theme;
  bottomInset: number;
  options: TransitOption[];
  ranked: RankedTrip[];
  selectedId: string;
  onSelect: (id: string) => void;
  filter: TransitFilter;
  onFilter: (filter: TransitFilter) => void;
  loading: boolean;
  status: LiveStatus | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** Plan again from now, when a delay has broken a connection. */
  onReplan: () => void;
  onOpenMaps: () => void;
  onShare: () => void;
  /** Begin guided navigation through the selected trip. */
  onStart: () => void;
};

type Line = { label: string; color: string; textColor: string; mode: string };

/** The coloured disc or tile that stands for a line, as on the street signs. */
export function RouteBadge({ leg, size = 24 }: { leg: Line; size?: number }) {
  const round = leg.mode === 'SUBWAY';
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: leg.color,
          height: size,
          minWidth: size,
          borderRadius: round ? size / 2 : 5,
        },
      ]}
    >
      <Text style={{ color: leg.textColor, fontWeight: '700', fontSize: size * 0.5 }} numberOfLines={1}>
        {leg.label}
      </Text>
    </View>
  );
}

const clock = (ms: number) => formatClock(new Date(ms));

/** How much of this trip is being tracked live, in words. */
function liveCount(option: TransitOption | undefined) {
  const rides = option?.legs.filter((l) => l.kind === 'ride') ?? [];
  if (!rides.length) return 'Live times';
  const tracked = rides.filter((l) => l.live).length;
  return tracked === rides.length
    ? `Live from the MTA: ${tracked === 1 ? 'the ride is' : `all ${tracked} rides are`} tracked`
    : tracked === 0
      ? 'Not tracked live, showing the timetable'
      : `Live from the MTA: ${tracked} of ${rides.length} rides tracked`;
}

/** "On time", "3 min late", with the colour that goes with it. */
function runningState(t: Theme, delay: number, live: boolean, cancelled: boolean) {
  if (cancelled) return { text: 'Cancelled', colour: t.red };
  if (!live) return { text: 'Scheduled', colour: t.ink3 };
  if (Math.abs(delay) < 1) return { text: 'On time', colour: t.green };
  if (delay < 0) return { text: `${-delay} min early`, colour: t.green };
  return { text: `${delay} min late`, colour: delay >= 5 ? t.red : t.amber };
}

export default function TransitSheet({
  t,
  bottomInset,
  options,
  ranked,
  selectedId,
  onSelect,
  filter,
  onFilter,
  loading,
  status,
  refreshing,
  onRefresh,
  onReplan,
  onOpenMaps,
  onShare,
  onStart,
}: Props) {
  const [open, setOpen] = useState(false);
  const option = options.find((o) => o.id === selectedId) ?? options[0];
  const colours = riskColours(t);

  return (
    <View style={[styles.sheet, surfaceStyle(t), { paddingBottom: bottomInset + 10 }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={14}
        style={styles.handleArea}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse trip details' : 'Show trip details'}
      >
        <View style={[styles.handle, { backgroundColor: t.ruleStrong }]} />
      </Pressable>

      <View style={styles.head}>
        <Tabs
          t={t}
          value={filter}
          options={[
            ['all', 'All'],
            ['subway', 'Subway'],
            ['bus', 'Bus'],
          ]}
          onChange={onFilter}
        />
        {loading && <ActivityIndicator color={t.ink3} />}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={10}>
          <Text style={{ color: t.blue, fontSize: 14, fontWeight: '600' }}>{open ? 'Less' : 'Details'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
        {ranked.map(({ index, tags }) => {
          const o = options[index];
          const active = o.id === option.id;
          const rides = o.legs.filter((l) => l.kind === 'ride');
          const r = o.risk ? colours[o.risk] : null;
          const live = rides.some((l) => l.live);
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.option,
                { borderColor: active ? t.ink : t.rule, backgroundColor: t.surface, borderWidth: active ? 1.5 : 1 },
              ]}
            >
              <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                {o.walkOnly ? ['Walk only', ...tags].join(' · ') : tags.length ? tags.join(' · ') : 'Option'}
              </Text>
              <View style={styles.timeRow}>
                <Text style={[styles.minutes, { color: t.ink }, numeric]}>{o.minutes}</Text>
                <Text style={{ color: t.ink2, fontSize: 14, marginBottom: 3 }}> min</Text>
              </View>
              <Text style={[{ color: t.ink2, fontSize: 13 }, numeric]}>
                {o.walkOnly ? 'Arrive' : `Leave ${clock(o.start)}, arrive`} {clock(o.end)}
              </Text>
              <View style={styles.badges}>
                {o.walkOnly ? (
                  <Icon name="walk" size={20} color={t.ink2} />
                ) : (
                  rides.map((l, k) => <RouteBadge key={k} leg={l} size={22} />)
                )}
              </View>
              <Text style={{ color: t.ink3, fontSize: 12 }}>
                {o.walkOnly
                  ? formatMiles(o.walkMetres)
                  : `${o.transfers === 0 ? 'Direct' : `${o.transfers} transfer${o.transfers === 1 ? '' : 's'}`} · ${o.walkMinutes} min walking`}
              </Text>
              {o.atRisk ? (
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: t.red }]} />
                  <Text style={{ color: t.red, fontSize: 12, fontWeight: '600' }}>Connection at risk</Text>
                </View>
              ) : o.delay >= 2 ? (
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: o.delay >= 5 ? t.red : t.amber }]} />
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{o.delay} min behind schedule</Text>
                </View>
              ) : live ? (
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: t.green }]} />
                  <Text style={{ color: t.ink2, fontSize: 12 }}>Live, on time</Text>
                </View>
              ) : null}
              {r && (
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: r.fg }]} />
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{r.label} walks</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable onPress={onRefresh} style={styles.statusRow} accessibilityRole="button" accessibilityLabel="Refresh live times">
        <View style={[styles.riskDot, { backgroundColor: status?.subway ? t.green : t.ink3 }]} />
        <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>
          {refreshing
            ? 'Updating live times'
            : status
              ? status.subway
                ? `${liveCount(option)}, updated ${clock(status.at)}`
                : 'Live subway data is unavailable. Showing the schedule.'
              : 'Checking live times'}
        </Text>
      </Pressable>

      {!!option && (
        <PrimaryButton
          t={t}
          label={option.walkOnly ? 'Start walking' : 'Start trip'}
          onPress={onStart}
          disabled={option.legs.some((l) => l.cancelled)}
          style={{ marginTop: 4, marginBottom: 4 }}
        />
      )}

      {open && option && (
        <>
          <ScrollView style={styles.legs} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {option.legs.map((leg, i) => (
              <LegRow
                key={i}
                t={t}
                leg={leg}
                next={option.legs[i + 1]}
                transfer={leg.kind === 'walk' && i > 0 && i < option.legs.length - 1}
                last={i === option.legs.length - 1}
                onReplan={onReplan}
              />
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <SecondaryButton t={t} label="Share" onPress={onShare} style={{ flex: 1, height: 44 }} />
            <SecondaryButton t={t} label="Open in Maps" onPress={onOpenMaps} style={{ flex: 1, height: 44 }} />
          </View>
        </>
      )}
    </View>
  );
}

function LegRow({
  t,
  leg,
  next,
  transfer,
  last,
  onReplan,
}: {
  t: Theme;
  leg: TransitLeg;
  next?: TransitLeg;
  transfer: boolean;
  last: boolean;
  onReplan: () => void;
}) {
  const [times, setTimes] = useState<NextDeparture[] | 'loading' | 'none' | null>(null);
  const [steps, setSteps] = useState<DirectionStep[] | 'loading' | 'none' | null>(null);
  const colours = riskColours(t);
  const rail = last ? 'transparent' : t.rule;

  if (leg.kind === 'walk') {
    const r = leg.risk ? colours[leg.risk.score] : null;
    const where = leg.toName && leg.toName !== 'END' ? leg.toName : 'your destination';
    const toggle = async () => {
      if (steps !== null && steps !== 'none') {
        setSteps(null);
        return;
      }
      setSteps('loading');
      try {
        const list = await walkDirections(leg, next);
        setSteps(list.length ? list : 'none');
      } catch {
        setSteps('none');
      }
    };
    return (
      <View style={styles.leg}>
        <View style={styles.railCol}>
          <Icon name="walk" size={20} color={t.ink2} />
          <View style={[styles.rail, { backgroundColor: rail }]} />
        </View>
        <View style={{ flex: 1, paddingBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: '500' }}>
            {transfer ? (leg.sameStation ? 'Change platforms' : 'Transfer') : 'Walk'}, {leg.minutes} min
            {leg.sameStation ? '' : ` to ${where}`}
          </Text>
          <Text style={[{ color: t.ink3, fontSize: 13 }, numeric]}>
            {leg.sameStation ? clock(leg.start) : `${formatMiles(leg.metres)} · ${clock(leg.start)}`}
          </Text>
          {r && leg.risk && !leg.sameStation && (
            <View style={styles.riskRow}>
              <View style={[styles.riskDot, { backgroundColor: r.fg }]} />
              <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }}>
                {r.label}. {leg.risk.reason}
              </Text>
            </View>
          )}
          <Pressable onPress={toggle} hitSlop={8}>
            <Text style={{ color: t.blue, fontWeight: '600', fontSize: 14, marginTop: 6 }}>
              {Array.isArray(steps) ? 'Hide directions' : 'Directions'}
            </Text>
          </Pressable>
          {steps === 'loading' && <ActivityIndicator color={t.ink3} style={{ alignSelf: 'flex-start', marginTop: 6 }} />}
          {steps === 'none' && <Text style={{ color: t.ink3, fontSize: 13, marginTop: 6 }}>Directions are not available.</Text>}
          {Array.isArray(steps) &&
            steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={[styles.stepDot, { backgroundColor: t.ruleStrong }]} />
                <Text style={{ color: t.ink, fontSize: 14, flex: 1 }}>{s.text}</Text>
                {s.metres > 0 && <Text style={[{ color: t.ink3, fontSize: 12 }, numeric]}>{formatDistance(s.metres)}</Text>}
              </View>
            ))}
        </View>
      </View>
    );
  }

  const state = runningState(t, leg.delay, leg.live, leg.cancelled);
  const load = async () => {
    setTimes('loading');
    try {
      const list = await nextDepartures(leg, new Date(Math.max(Date.now(), leg.plannedStart - 60_000)));
      setTimes(list.length ? list : 'none');
    } catch {
      setTimes('none');
    }
  };

  return (
    <View style={styles.leg}>
      <View style={styles.railCol}>
        <RouteBadge leg={leg} size={26} />
        <View style={[styles.rail, { backgroundColor: rail }]} />
      </View>
      <View style={{ flex: 1, paddingBottom: 14 }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>
          {modeName(leg.mode)} {leg.label}
          {leg.headsign ? ` toward ${leg.headsign}` : ''}
        </Text>

        <View style={styles.riskRow}>
          <View style={[styles.riskDot, { backgroundColor: state.colour }]} />
          <Text style={{ color: state.colour, fontSize: 13, fontWeight: '600' }}>{state.text}</Text>
          {leg.live && Math.abs(leg.delay) >= 1 && !leg.cancelled && (
            <Text style={[{ color: t.ink3, fontSize: 12 }, numeric]}>scheduled {clock(leg.plannedStart)}</Text>
          )}
        </View>

        <Text style={[{ color: t.ink2, fontSize: 14, marginTop: 4 }, numeric]}>
          {clock(leg.start)} board at {leg.fromName}
          {leg.live && leg.start > Date.now() ? `, in ${Math.max(0, Math.round((leg.start - Date.now()) / 60_000))} min` : ''}
        </Text>
        <Text style={[{ color: t.ink2, fontSize: 14 }, numeric]}>
          {clock(leg.end)} get off at {leg.toName}
        </Text>
        <Text style={[{ color: t.ink3, fontSize: 13, marginTop: 2 }, numeric]}>
          {Math.max(1, Math.round((leg.end - leg.start) / 60_000))} min · {leg.stops} stop{leg.stops === 1 ? '' : 's'}
        </Text>

        {(leg.missed || leg.cancelled) && (
          <View style={[styles.notice, { backgroundColor: t.redTint, flexDirection: 'column', gap: 4 }]}>
            <Text style={{ color: t.red, fontSize: 13, lineHeight: 18 }}>
              {leg.cancelled
                ? 'This trip has been cancelled.'
                : `You would reach ${leg.fromName} after this has left.`}
            </Text>
            <Pressable onPress={onReplan} hitSlop={8}>
              <Text style={{ color: t.red, fontSize: 13, fontWeight: '700' }}>Find a new trip</Text>
            </Pressable>
          </View>
        )}

        {leg.alerts.map((a) => (
          <View key={a.id} style={[styles.notice, { backgroundColor: t.amberTint }]}>
            <Icon name="alert" size={16} color={t.amber} />
            <Text style={{ color: t.ink, fontSize: 13, lineHeight: 18, flex: 1 }} numberOfLines={4}>
              {a.header}
            </Text>
          </View>
        ))}

        {times === null && !!leg.fromStopId && (
          <Pressable onPress={load} hitSlop={8}>
            <Text style={{ color: t.blue, fontWeight: '600', fontSize: 14, marginTop: 6 }}>Next departures</Text>
          </Pressable>
        )}
        {times === 'loading' && <ActivityIndicator color={t.ink3} style={{ alignSelf: 'flex-start', marginTop: 6 }} />}
        {times === 'none' && <Text style={{ color: t.ink3, fontSize: 13, marginTop: 6 }}>No more departures found.</Text>}
        {Array.isArray(times) && (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text style={{ color: t.ink3, fontSize: 12 }}>Next departures</Text>
            <Text style={[{ color: t.ink, fontSize: 14 }, numeric]}>
              {times.map((d, i) => (
                <Text key={d.at} style={{ color: d.live ? t.ink : t.ink2 }}>
                  {i > 0 ? ', ' : ''}
                  {clock(d.at)}
                  {d.live && d.delay >= 2 ? ` (+${d.delay})` : ''}
                </Text>
              ))}
            </Text>
            <Text style={{ color: t.ink3, fontSize: 12 }}>
              {times.every((d) => d.live)
                ? 'Live from the MTA'
                : times.some((d) => d.live)
                  ? 'Live from the MTA where tracked, otherwise scheduled'
                  : 'Scheduled'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 4,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleArea: { alignItems: 'center', paddingTop: 6, paddingBottom: 10 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  options: { gap: 10, paddingBottom: 6 },
  option: { width: 200, padding: 12, borderRadius: radius.lg, gap: 3 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end' },
  minutes: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 },
  badge: { paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  legs: { maxHeight: 280, marginTop: 4 },
  leg: { flexDirection: 'row', gap: 12 },
  railCol: { width: 28, alignItems: 'center', gap: 4 },
  rail: { flex: 1, width: 2, borderRadius: 1, minHeight: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: radius.md, marginTop: 8 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 8 },
  stepDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
