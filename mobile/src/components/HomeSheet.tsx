import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';

import Icon, { placeIcon } from './Icon';
import { RouteBadge } from './TransitSheet';
import { surfaceStyle } from './ui';
import { formatDistance } from '../lib/format';
import { LatLng } from '../lib/geo';
import { Recent, SavedPlace } from '../lib/store';
import { NearbyStop, nearbyDepartures } from '../lib/transit';
import { Theme, numeric, radius } from '../theme';

type Props = {
  t: Theme;
  bottomInset: number;
  places: SavedPlace[];
  recents: Recent[];
  onSearch: () => void;
  onPlace: (name: string, point: LatLng) => void;
  onAddPlace: (slot: 'Home' | 'Work' | 'new') => void;
};

const REFRESH_MS = 45_000;

/** "now", "4 min" for a departure time. */
const until = (ms: number) => {
  const mins = Math.round((ms - Date.now()) / 60_000);
  return mins <= 0 ? 'now' : `${mins} min`;
};

/** Home first, then Work, then everything else in the order it was added. */
const rank = (name: string) => (/^home$/i.test(name) ? 0 : /^work$/i.test(name) ? 1 : 2);

/**
 * The first screen: where to, the places you go, and what is leaving near you.
 * It asks for location only when you ask for nearby transit, and says so.
 */
export default function HomeSheet({ t, bottomInset, places, recents, onSearch, onPlace, onAddPlace }: Props) {
  const { height } = useWindowDimensions();
  const [stops, setStops] = useState<NearbyStop[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'denied'>('idle');
  const [granted, setGranted] = useState(false);

  const load = useCallback(async () => {
    try {
      const fix =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      setStops(await nearbyDepartures(here));
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);

  // If location is already allowed, show nearby transit without asking again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => {
        if (status !== 'granted') return;
        setGranted(true);
        setState('loading');
        load();
        timer = setInterval(load, REFRESH_MS);
      })
      .catch(() => {});
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [load]);

  const enable = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setState('denied');
      return;
    }
    setGranted(true);
    setState('loading');
    load();
  };

  const home = places.find((p) => /^home$/i.test(p.name));
  const work = places.find((p) => /^work$/i.test(p.name));
  const others = places.filter((p) => p !== home && p !== work).sort((a, b) => rank(a.name) - rank(b.name));

  const shortcut = (key: string, icon: string, label: string, place?: SavedPlace, onEmpty?: () => void) => (
    <Pressable
      key={key}
      onPress={() => (place ? onPlace(place.name, place) : onEmpty?.())}
      accessibilityRole="button"
      accessibilityLabel={place ? `Go to ${label}` : `Set ${label}`}
      style={styles.shortcut}
    >
      <View
        style={[
          styles.shortcutIcon,
          place
            ? { backgroundColor: t.surfaceSunk }
            : { borderColor: t.ruleStrong, borderWidth: 1, borderStyle: 'dashed' },
        ]}
      >
        <Icon name={placeIcon(icon)} size={20} color={place ? t.ink : t.ink3} />
      </View>
      <Text style={{ color: place ? t.ink : t.ink3, fontSize: 12, fontWeight: '500' }} numberOfLines={1}>
        {place ? label : `Add ${label.toLowerCase()}`}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.sheet, surfaceStyle(t), { paddingBottom: bottomInset + 8, maxHeight: height * 0.62 }]}>
      <View style={[styles.handle, { backgroundColor: t.ruleStrong }]} />

      <Pressable
        onPress={onSearch}
        accessibilityRole="search"
        accessibilityLabel="Search for a destination"
        style={({ pressed }) => [styles.search, { backgroundColor: t.surfaceSunk, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name="search" size={20} color={t.ink2} />
        <Text style={{ color: t.ink2, fontSize: 17 }}>Where to?</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts}>
          {shortcut('home', 'home', 'Home', home, () => onAddPlace('Home'))}
          {shortcut('work', 'work', 'Work', work, () => onAddPlace('Work'))}
          {others.map((p) => shortcut(p.id, p.icon, p.name, p))}
          <Pressable onPress={() => onAddPlace('new')} style={styles.shortcut} accessibilityLabel="Add a place">
            <View style={[styles.shortcutIcon, { borderColor: t.ruleStrong, borderWidth: 1, borderStyle: 'dashed' }]}>
              <Icon name="plus" size={20} color={t.ink3} />
            </View>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '500' }}>Add</Text>
          </Pressable>
        </ScrollView>

        {recents.length > 0 && (
          <>
            <Text style={[styles.heading, { color: t.ink3 }]}>Recent</Text>
            {recents.slice(0, 3).map((r, i) => (
              <Pressable
                key={`${r.name}${i}`}
                onPress={() => onPlace(r.name, r)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.surfaceSunk }]}
                accessibilityRole="button"
              >
                <Icon name="clock" size={18} color={t.ink3} />
                <Text style={{ flex: 1, color: t.ink, fontSize: 15 }} numberOfLines={1}>
                  {r.name}
                </Text>
              </Pressable>
            ))}
          </>
        )}

        <Text style={[styles.heading, { color: t.ink3 }]}>Nearby transit</Text>
        {!granted && state !== 'denied' && (
          <Pressable onPress={enable} style={[styles.enable, { borderColor: t.ruleStrong }]} accessibilityRole="button">
            <Icon name="locate" size={18} color={t.ink} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>Show stops near me</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 1 }}>
                Uses your location on this phone to find stops and times.
              </Text>
            </View>
          </Pressable>
        )}
        {state === 'denied' && (
          <Text style={[styles.note, { color: t.ink3 }]}>Location is off. Allow it in Settings to see nearby stops.</Text>
        )}
        {state === 'loading' && !stops && <ActivityIndicator color={t.ink3} style={{ marginVertical: 16 }} />}
        {state === 'error' && !stops && (
          <Pressable onPress={load}>
            <Text style={[styles.note, { color: t.ink3 }]}>Could not load nearby stops. Tap to retry.</Text>
          </Pressable>
        )}
        {stops?.length === 0 && <Text style={[styles.note, { color: t.ink3 }]}>No stops found within a short walk.</Text>}
        {stops?.map((stop) => (
          <View key={stop.name + stop.lines[0]?.label} style={[styles.stop, { borderTopColor: t.rule }]}>
            <View style={styles.stopHead}>
              <Text style={{ flex: 1, color: t.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
                {stop.name}
              </Text>
              <Text style={[{ color: t.ink3, fontSize: 13 }, numeric]}>{formatDistance(stop.metres)}</Text>
            </View>
            {stop.lines.map((line, i) => (
              <View key={`${line.label}${line.headsign}${i}`} style={styles.line}>
                <RouteBadge leg={line} size={22} />
                <Text style={{ flex: 1, color: t.ink2, fontSize: 13 }} numberOfLines={1}>
                  {line.headsign}
                </Text>
                {line.times.some((x) => x.live) && <View style={[styles.liveDot, { backgroundColor: t.green }]} />}
                <Text style={[{ color: t.ink, fontSize: 13, fontWeight: '600' }, numeric]}>
                  {line.times.map((x) => until(x.at)).join(', ')}
                </Text>
              </View>
            ))}
          </View>
        ))}
        {!!stops?.length && (
          <Text style={[styles.note, { color: t.ink3 }]}>
            A green dot means the MTA is reporting that train live. Other times are scheduled.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
  },
  shortcuts: { gap: 18, paddingVertical: 14, paddingHorizontal: 2 },
  shortcut: { alignItems: 'center', gap: 6, width: 58 },
  shortcutIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6, letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  enable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  note: { fontSize: 13, lineHeight: 18, paddingVertical: 8 },
  stop: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 6 },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3, marginRight: -4 },
});
