import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import Icon, { IconName } from './Icon';
import { Theme, radius, shadow } from '../theme';

/** A round button that floats over the map. */
export function MapButton({
  t,
  icon,
  label,
  active,
  onPress,
}: {
  t: Theme;
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mapButton,
        { backgroundColor: active ? t.ink : t.surface, borderColor: t.rule, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Icon name={icon} size={20} color={active ? t.surface : t.ink} />
    </Pressable>
  );
}

/** A small square button for use inside a card. */
export function IconButton({
  t,
  icon,
  label,
  onPress,
}: {
  t: Theme;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: t.surfaceSunk }]}
    >
      <Icon name={icon} size={22} color={t.ink} />
    </Pressable>
  );
}

export function PrimaryButton({
  t,
  label,
  onPress,
  loading,
  disabled,
  style,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: t.blue, opacity: pressed || loading || disabled ? 0.7 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={t.onAccent} />
      ) : (
        <Text style={[styles.primaryText, { color: t.onAccent }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  t,
  label,
  onPress,
  style,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondary,
        { borderColor: t.ruleStrong, backgroundColor: pressed ? t.surfaceSunk : 'transparent' },
        style,
      ]}
    >
      <Text style={{ color: t.ink, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** Two or three choices in one quiet row. The chosen one is underlined in ink. */
export function Tabs<T extends string>({
  t,
  value,
  options,
  onChange,
}: {
  t: Theme;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={[styles.tabs, { backgroundColor: t.surfaceSunk }]}>
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.tab, on && { backgroundColor: t.surface, ...tabShadow }]}
          >
            <Text style={{ color: on ? t.ink : t.ink2, fontWeight: on ? '600' : '500', fontSize: 13 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

/** A floating surface: the base of every card and sheet. */
export const surfaceStyle = (t: Theme) => ({
  backgroundColor: t.surface,
  borderColor: t.rule,
  borderWidth: StyleSheet.hairlineWidth,
  ...shadow,
});

const styles = StyleSheet.create({
  mapButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  iconButton: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  tabs: { flexDirection: 'row', padding: 2, borderRadius: radius.md },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
});
