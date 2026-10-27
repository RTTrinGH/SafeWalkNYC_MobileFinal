import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { PrimaryButton, SecondaryButton } from './ui';
import { KIND_ORDER, NOTE_MAX, REPORT_KINDS, ReportKind } from '../lib/reports';
import { Theme, radius } from '../theme';

type Props = {
  t: Theme;
  visible: boolean;
  /** Where the report will be placed, and how we know. */
  where: { label: string } | null;
  onClose: () => void;
  onSubmit: (kind: ReportKind, note: string) => Promise<void>;
};

export default function ReportModal({ t, visible, where, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKind(null);
      setNote('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const send = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(kind, note);
    } catch (e: any) {
      setError(e?.message?.startsWith('Please wait') ? e.message : 'Could not send. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.handle, { backgroundColor: t.ruleStrong }]} />
          <Text style={[styles.title, { color: t.ink }]}>Report something</Text>
          <Text style={[styles.sub, { color: t.ink2 }]}>
            {where ? `At ${where.label}. ` : ''}Others will see it for a few hours. No name is attached.
          </Text>

          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            <View style={styles.grid}>
              {KIND_ORDER.map((k) => {
                const info = REPORT_KINDS[k];
                const on = kind === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setKind(k)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.kind,
                      {
                        backgroundColor: t.surface,
                        borderColor: on ? t.ink : t.rule,
                      },
                    ]}
                  >
                    <Icon name={info.icon} size={22} color={on ? t.blue : t.ink2} />
                    <Text style={[styles.kindLabel, { color: t.ink }]}>{info.label}</Text>
                    <Text style={[styles.kindHint, { color: t.ink3 }]} numberOfLines={2}>
                      {info.hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <TextInput
            value={note}
            onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
            placeholder="Add a detail (optional)"
            placeholderTextColor={t.ink3}
            style={[styles.input, { color: t.ink, backgroundColor: t.surfaceSunk }]}
            maxLength={NOTE_MAX}
            returnKeyType="done"
          />

          {error && <Text style={[styles.error, { color: t.red }]}>{error}</Text>}

          <View style={styles.row}>
            <SecondaryButton t={t} label="Cancel" onPress={onClose} style={{ flex: 1 }} />
            <PrimaryButton
              t={t}
              label="Send report"
              onPress={send}
              loading={busy}
              disabled={!kind || !where}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '600' },
  sub: { fontSize: 14, lineHeight: 19, marginTop: 4, marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { width: '48.5%', padding: 12, borderRadius: radius.md, borderWidth: 1, gap: 4 },
  kindLabel: { fontSize: 15, fontWeight: '600' },
  kindHint: { fontSize: 12, lineHeight: 16 },
  input: { marginTop: 12, height: 44, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
  error: { marginTop: 8, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
