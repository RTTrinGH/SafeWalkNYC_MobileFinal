import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Place, searchPlaces } from '../lib/geocode';
import { useStore } from '../lib/store';
import Icon, { placeIcon } from './Icon';
import { Theme, radius } from '../theme';

type Props = {
  t: Theme;
  label: string;
  /** Retained for callers that still pass a marker colour; the card draws its own. */
  dot?: string;
  value: string;
  onChangeText: (text: string) => void;
  onPick: (place: Place) => void;
  onFocus?: () => void;
  trailing?: React.ReactNode;
  /** Offer saved places (Home, Work, …) ahead of address results. */
  includeSaved?: boolean;
  /** Keep suggestions on screen after the keyboard is dismissed. */
  persistResults?: boolean;
};

type Suggestion = Place & { icon?: string; saved?: boolean };

/**
 * A text field that suggests places as you type, after a short pause. Saved
 * places come first and match instantly, on any part of their name, so typing
 * "ho" puts Home at the top before the network has answered.
 */
export default function PlaceField({
  t,
  label,
  value,
  onChangeText,
  onPick,
  onFocus,
  trailing,
  includeSaved = true,
  persistResults = false,
}: Props) {
  const { places } = useStore();
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picked = useRef<string | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();

    const q = value.trim();
    if (q.length < 3 || q === picked.current) {
      setResults([]);
      setBusy(false);
      return;
    }
    // Losing focus stops new searches but, if asked, leaves what is showing.
    if (!focused) {
      setBusy(false);
      if (!persistResults) setResults([]);
      return;
    }

    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      try {
        setResults(await searchPlaces(q, controller.signal));
      } catch (e: any) {
        if (e?.name !== 'AbortError') setResults([]);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 350);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, focused, persistResults]);

  const saved: Suggestion[] = useMemo(() => {
    if (!includeSaved || !focused) return [];
    const q = value.trim().toLowerCase();
    if (q && q === picked.current?.toLowerCase()) return [];
    return places
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
      // Names that start with what was typed beat names that merely contain it.
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)),
      )
      .map((p) => ({
        primary: p.name,
        secondary: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        icon: p.icon,
        saved: true,
      }));
  }, [includeSaved, focused, value, places]);

  const suggestions: Suggestion[] = [...saved, ...results];
  const showList = (focused || persistResults) && suggestions.length > 0;

  return (
    <View>
      <View
        style={[
          styles.row,
          { backgroundColor: t.surfaceSunk, borderColor: focused ? t.ink : 'transparent' },
        ]}
      >
        <TextInput
          style={[styles.input, { color: t.ink }]}
          value={value}
          placeholder={label}
          placeholderTextColor={t.ink3}
          onChangeText={(text) => {
            picked.current = null;
            onChangeText(text);
          }}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={label}
          clearButtonMode="while-editing"
        />
        {busy ? <ActivityIndicator size="small" color={t.ink3} /> : trailing}
      </View>

      {showList && (
        <View style={[styles.list, { backgroundColor: t.surface, borderColor: t.rule }]}>
          {suggestions.map((place, i) => (
            <Pressable
              key={`${place.saved ? 's' : 'r'}${place.primary}${place.latitude}${i}`}
              style={({ pressed }) => [
                styles.item,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.rule },
                pressed && { backgroundColor: t.surfaceSunk },
              ]}
              onPress={() => {
                // A saved place reads as its name; an address as the whole of it.
                const text = place.saved
                  ? place.primary
                  : place.secondary
                    ? `${place.primary}, ${place.secondary}`
                    : place.primary;
                picked.current = text;
                setResults([]);
                onChangeText(text);
                onPick(place);
              }}
            >
              {place.saved ? (
                <View style={styles.icon}>
                  <Icon name={placeIcon(place.icon ?? '')} size={18} color={t.ink2} />
                </View>
              ) : (
                <View style={styles.icon}>
                  <Icon name="pin" size={18} color={t.ink3} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.primary, { color: t.ink }]} numberOfLines={1}>
                  {place.primary}
                </Text>
                {!!place.secondary && (
                  <Text style={[styles.secondary, { color: t.ink3 }]} numberOfLines={1}>
                    {place.secondary}
                  </Text>
                )}
              </View>
              {place.saved && <Text style={[styles.tag, { color: t.ink3 }]}>Saved</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  list: {
    marginTop: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  icon: { width: 24, alignItems: 'center' },
  primary: { fontSize: 15, fontWeight: '500' },
  secondary: { fontSize: 13, marginTop: 1 },
  tag: { fontSize: 12, fontWeight: '500' },
});
