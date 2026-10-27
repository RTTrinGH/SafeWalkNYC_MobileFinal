import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import Icon from './Icon';
import PlaceField from './PlaceField';
import { IconButton, PrimaryButton, Tabs, surfaceStyle } from './ui';
import { Departure, departureDate, formatClock } from '../lib/format';
import { Place } from '../lib/geocode';
import { Theme } from '../theme';

type Props = {
  t: Theme;
  top: number;
  startText: string;
  endText: string;
  onStartText: (text: string) => void;
  onEndText: (text: string) => void;
  onPickStart: (place: Place) => void;
  onPickEnd: (place: Place) => void;
  onGps: () => void;
  onSwap: () => void;
  onBack: () => void;
  travel: 'walk' | 'transit';
  onTravel: (travel: 'walk' | 'transit') => void;
  departure: Departure;
  onDeparture: (departure: Departure) => void;
  pickingTime: boolean;
  onPickingTime: (open: boolean) => void;
  customDate: Date;
  onCustomDate: (date: Date) => void;
  loading: boolean;
  error: string | null;
  onFind: () => void;
  /** Shown instead of the Find button once there are results to hide behind. */
  onCollapse?: () => void;
};

/**
 * The planning card: where from, where to, how, and when. Everything beyond
 * the two places sits on one line each, and nothing else competes for room.
 */
export default function PlanCard(p: Props) {
  const { t } = p;
  const when =
    p.departure === 'now'
      ? 'now'
      : p.departure === 'night'
        ? 'tonight 10 PM'
        : formatClock(departureDate(p.departure));

  return (
    <View style={[styles.card, surfaceStyle(t), { top: p.top }]}>
      <View style={styles.head}>
        <IconButton t={t} icon="back" label="Back to home" onPress={p.onBack} />
        <View style={{ flex: 1 }} />
        <Tabs
          t={t}
          value={p.travel}
          options={[
            ['walk', 'Walk'],
            ['transit', 'Subway & bus'],
          ]}
          onChange={p.onTravel}
        />
      </View>

      <View style={styles.fields}>
        <View style={styles.connector} pointerEvents="none">
          <View style={[styles.dot, { borderColor: t.blue }]} />
          <View style={[styles.line, { backgroundColor: t.ruleStrong }]} />
          <View style={[styles.square, { backgroundColor: t.orange }]} />
        </View>
        <View style={{ flex: 1 }}>
          <PlaceField
            t={t}
            label="Start"
            value={p.startText}
            onChangeText={p.onStartText}
            onPick={p.onPickStart}
            trailing={
              <Pressable onPress={p.onGps} hitSlop={10} accessibilityLabel="Use my location">
                <Icon name="locate" size={18} color={t.blue} />
              </Pressable>
            }
          />
          <View style={{ height: 8 }} />
          <PlaceField t={t} label="Where to?" value={p.endText} onChangeText={p.onEndText} onPick={p.onPickEnd} />
        </View>
        <IconButton t={t} icon="swap" label="Swap start and destination" onPress={p.onSwap} />
      </View>

      <View style={styles.when}>
        <Icon name="clock" size={16} color={t.ink3} />
        <Text style={{ color: t.ink2, fontSize: 14 }}>Leave</Text>
        <Tabs
          t={t}
          value={p.pickingTime || typeof p.departure === 'object' ? 'pick' : p.departure}
          options={[
            ['now', 'Now'],
            ['night', 'Tonight'],
            ['pick', typeof p.departure === 'object' ? when : 'Pick time'],
          ]}
          onChange={(key) => {
            if (key === 'pick') p.onPickingTime(!p.pickingTime);
            else {
              p.onPickingTime(false);
              p.onDeparture(key as Departure);
            }
          }}
        />
      </View>

      {p.pickingTime && (
        <DateTimePicker
          value={p.customDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={t.dark ? 'dark' : 'light'}
          onChange={(_, date) => {
            if (!date) {
              p.onPickingTime(false);
              return;
            }
            p.onCustomDate(date);
            p.onDeparture({ hour: date.getHours(), minute: date.getMinutes() });
            if (Platform.OS !== 'ios') p.onPickingTime(false);
          }}
        />
      )}

      <PrimaryButton
        t={t}
        label={p.travel === 'transit' ? 'Find trips' : 'Find safest route'}
        onPress={p.onFind}
        loading={p.loading}
        style={{ marginTop: 14 }}
      />

      {!!p.error && <Text style={[styles.error, { color: t.red }]}>{p.error}</Text>}

      {p.onCollapse && (
        <Pressable onPress={p.onCollapse} style={styles.collapse} accessibilityRole="button">
          <Text style={{ color: t.blue, fontWeight: '600', fontSize: 13 }}>Hide search</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 16,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  fields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connector: { width: 14, alignItems: 'center', paddingVertical: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  line: { width: 2, flex: 1, marginVertical: 3, borderRadius: 1 },
  square: { width: 10, height: 10, borderRadius: 2 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  error: { marginTop: 10, fontSize: 13, fontWeight: '500' },
  collapse: { alignSelf: 'center', paddingTop: 12, paddingBottom: 2 },
});
