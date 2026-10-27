import React, { useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Theme, radius } from '../theme';

type Props = {
  t: Theme;
  holdToCall: boolean;
  holdMs: number;
  haptics: boolean;
};

/**
 * Calls 911, but never by accident: a pocket brush or a stray tap does nothing.
 * Press and hold and the button fills; when it is full a confirmation appears,
 * and only that confirmation places the call.
 */
export default function EmergencyButton({ t, holdToCall, holdMs, haptics }: Props) {
  const fill = useRef(new Animated.Value(0)).current;
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buzz = (kind: 'tick' | 'warn') => {
    if (!haptics) return;
    (kind === 'tick'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    ).catch(() => {});
  };

  const confirm = () => {
    buzz('warn');
    Alert.alert('Call 911?', 'This will call emergency services.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  const reset = () => {
    fill.stopAnimation();
    Animated.timing(fill, { toValue: 0, duration: 160, useNativeDriver: false }).start();
  };

  const showHint = () => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 1800);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Call 911"
      accessibilityHint={holdToCall ? 'Press and hold to call' : 'Double tap to call'}
      delayLongPress={holdMs}
      onPressIn={() => {
        if (!holdToCall) return;
        buzz('tick');
        Animated.timing(fill, {
          toValue: 1,
          duration: holdMs,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      }}
      onPressOut={() => {
        if (holdToCall) reset();
      }}
      onLongPress={() => {
        if (!holdToCall) return;
        reset();
        confirm();
      }}
      onPress={() => {
        // A quick tap on a held button only reminds you how it works.
        if (holdToCall) showHint();
        else confirm();
      }}
      style={[styles.button, { backgroundColor: t.redTint }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          {
            backgroundColor: t.red,
            width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
      <Text style={[styles.label, { color: t.red }]}>{hint ? 'Hold to call' : '911'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.35 },
  label: { fontWeight: '700' },
});
