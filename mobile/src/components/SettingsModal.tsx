import React, { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon, { PLACE_ICON_NAMES, placeIcon } from './Icon';
import PlaceField from './PlaceField';
import { PrimaryButton } from './ui';
import { describeLocation } from '../lib/geocode';
import {
  PLACE_ICONS,
  SavedPlace,
  Settings,
  useStore,
} from '../lib/store';
import { Theme, radius } from '../theme';

type Props = {
  t: Theme;
  visible: boolean;
  /** Open straight into the editor for this slot, from the home screen. */
  startWith?: 'Home' | 'Work' | 'new' | null;
  onClose: () => void;
};

type Draft = {
  id?: string;
  name: string;
  icon: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

const BLANK: Draft = { name: '', icon: 'pin', address: '', latitude: null, longitude: null };

export default function SettingsModal({ t, visible, startWith, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { settings, places, update, savePlace, removePlace, resetSettings, clearPlaces, clearRecents } = useStore();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (startWith === 'Home') setDraft({ ...BLANK, name: 'Home', icon: 'home' });
    else if (startWith === 'Work') setDraft({ ...BLANK, name: 'Work', icon: 'work' });
    else if (startWith === 'new') setDraft({ ...BLANK });
  }, [visible, startWith]);

  const home = places.find((p) => p.name.toLowerCase() === 'home');
  const work = places.find((p) => p.name.toLowerCase() === 'work');
  const others = places.filter((p) => p !== home && p !== work);

  const edit = (p: SavedPlace) =>
    setDraft({
      id: p.id,
      name: p.name,
      icon: p.icon,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
    });

  const confirmRemove = (p: SavedPlace) =>
    Alert.alert(`Remove ${p.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePlace(p.id) },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: t.paper }]}>
        <View style={[styles.header, { borderBottomColor: t.rule }]}>
          <Text style={[styles.title, { color: t.ink }]}>{draft ? (draft.id ? 'Edit place' : 'New place') : 'Settings'}</Text>
          <Pressable
            onPress={() => (draft ? setDraft(null) : onClose())}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={{ color: t.blue, fontWeight: '600', fontSize: 16 }}>{draft ? 'Cancel' : 'Done'}</Text>
          </Pressable>
        </View>

        {draft ? (
          <PlaceEditor
            t={t}
            draft={draft}
            setDraft={setDraft}
            onSave={() => {
              if (!draft.name.trim()) return Alert.alert('Give it a name', 'For example "Gym" or "Mom\'s".');
              if (draft.latitude === null || draft.longitude === null) {
                return Alert.alert('Choose an address', 'Pick one of the suggestions so we know where it is.');
              }
              savePlace({
                id: draft.id,
                name: draft.name.trim(),
                icon: draft.icon,
                address: draft.address,
                latitude: draft.latitude,
                longitude: draft.longitude,
              });
              setDraft(null);
            }}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Heading t={t}>Saved places</Heading>
            <Card t={t}>
              <PlaceRow
                t={t}
                icon="home"
                label="Home"
                place={home}
                onAdd={() => setDraft({ ...BLANK, name: 'Home', icon: 'home' })}
                onEdit={edit}
                onRemove={confirmRemove}
              />
              <PlaceRow
                t={t}
                icon="work"
                label="Work"
                place={work}
                onAdd={() => setDraft({ ...BLANK, name: 'Work', icon: 'work' })}
                onEdit={edit}
                onRemove={confirmRemove}
              />
              {others.map((p) => (
                <PlaceRow
                  key={p.id}
                  t={t}
                  icon={p.icon}
                  label={p.name}
                  place={p}
                  onAdd={() => {}}
                  onEdit={edit}
                  onRemove={confirmRemove}
                />
              ))}
              <Pressable
                onPress={() => setDraft({ ...BLANK })}
                style={[styles.addRow, { borderTopColor: t.rule }]}
                accessibilityRole="button"
              >
                <Icon name="plus" size={16} color={t.blue} />
                <Text style={{ color: t.blue, fontWeight: '600' }}>Add a place</Text>
              </Pressable>
            </Card>
            <Hint t={t}>Saved places appear on the home screen. Tap one to plan a trip there.</Hint>

            <Heading t={t}>Emergency</Heading>
            <Card t={t}>
              <ToggleRow
                t={t}
                label="Show 911 button"
                detail="Turn off to remove it from the walking panel."
                value={settings.showEmergency}
                onChange={(v) => update({ showEmergency: v })}
              />
              <ToggleRow
                t={t}
                label="Hold to call 911"
                detail="Press and hold before the confirmation appears, so it can never be tapped by accident."
                value={settings.holdToCall}
                disabled={!settings.showEmergency}
                onChange={(v) => update({ holdToCall: v })}
              />
              <Segmented
                t={t}
                label="Hold time"
                disabled={!settings.showEmergency || !settings.holdToCall}
                value={String(settings.holdMs)}
                options={[
                  ['500', 'Short'],
                  ['800', 'Medium'],
                  ['1200', 'Long'],
                ]}
                onChange={(v) => update({ holdMs: Number(v) })}
              />
            </Card>

            <Heading t={t}>Emergency contact</Heading>
            <Card t={t}>
              <Field
                t={t}
                label="Name"
                value={settings.contactName}
                placeholder="Someone who should know you're out"
                onChangeText={(v) => update({ contactName: v })}
              />
              <Field
                t={t}
                label="Phone"
                value={settings.contactPhone}
                placeholder="(555) 123-4567"
                keyboardType="phone-pad"
                onChangeText={(v) => update({ contactPhone: v })}
              />
            </Card>
            <Hint t={t}>
              With a contact set, "Text" sends them your walk and location in one tap, and "Call" rings them.
            </Hint>

            <Heading t={t}>Map</Heading>
            <Card t={t}>
              <ToggleRow
                t={t}
                label="Safe places"
                detail="Police, ERs, subway and fire stations."
                value={settings.showHavens}
                onChange={(v) => update({ showHavens: v })}
              />
              <ToggleRow
                t={t}
                label="Recent incidents"
                detail="Red dots near your route."
                value={settings.showIncidents}
                onChange={(v) => update({ showIncidents: v })}
              />
              <ToggleRow
                t={t}
                label="Community reports"
                detail="Blockages, traffic and events reported by other walkers."
                value={settings.showReports}
                onChange={(v) => update({ showReports: v })}
              />
              <ToggleRow
                t={t}
                label="Follow me while walking"
                detail="Keep the map centered on you."
                value={settings.followWhileWalking}
                onChange={(v) => update({ followWhileWalking: v })}
              />
            </Card>

            <Heading t={t}>Planning</Heading>
            <Card t={t}>
              <Segmented
                t={t}
                label="Leave"
                value={settings.defaultDeparture}
                options={[
                  ['now', 'Now'],
                  ['night', 'Tonight 10 PM'],
                ]}
                onChange={(v) => update({ defaultDeparture: v as Settings['defaultDeparture'] })}
              />
              <ToggleRow
                t={t}
                label="Warn me after dark"
                detail="A reminder when a walk falls between 8 PM and 6 AM."
                value={settings.nightWarning}
                onChange={(v) => update({ nightWarning: v })}
              />
            </Card>

            <Heading t={t}>General</Heading>
            <Card t={t}>
              <Segmented
                t={t}
                label="Appearance"
                value={settings.appearance}
                options={[
                  ['system', 'Auto'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={(v) => update({ appearance: v as Settings['appearance'] })}
              />
              <Segmented
                t={t}
                label="Units"
                value={settings.units}
                options={[
                  ['imperial', 'Miles'],
                  ['metric', 'Kilometers'],
                ]}
                onChange={(v) => update({ units: v as Settings['units'] })}
              />
              <ToggleRow
                t={t}
                label="Haptic feedback"
                detail="Small taps for turns and button presses."
                value={settings.haptics}
                onChange={(v) => update({ haptics: v })}
              />
            </Card>

            <Heading t={t}>Data</Heading>
            <Card t={t}>
              <ActionRow
                t={t}
                label="Delete all saved places"
                onPress={() =>
                  Alert.alert('Delete all saved places?', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: clearPlaces },
                  ])
                }
              />
              <ActionRow
                t={t}
                label="Clear recent destinations"
                onPress={() =>
                  Alert.alert('Clear recent destinations?', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: clearRecents },
                  ])
                }
              />
              <ActionRow
                t={t}
                label="Reset settings"
                onPress={() =>
                  Alert.alert('Reset all settings?', 'Saved places are kept.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reset', style: 'destructive', onPress: resetSettings },
                  ])
                }
              />
            </Card>
            <Hint t={t}>
              Everything on this screen is stored only on this phone. Risk scores come from public NYPD complaint data
              and are a guide, not a guarantee.
            </Hint>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function PlaceEditor({
  t,
  draft,
  setDraft,
  onSave,
}: {
  t: Theme;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const useHere = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Location is off', 'Allow location in Settings to use this.');
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = fix.coords;
      const address = await describeLocation(latitude, longitude).catch(() => 'My location');
      setDraft({ ...draft, address, latitude, longitude });
    } catch {
      Alert.alert('Could not get your location');
    }
  };

  return (
    <View style={styles.fill}>
      {keyboardUp && (
        <Pressable
          onPress={Keyboard.dismiss}
          style={[styles.keyboardBar, { backgroundColor: t.surface, borderBottomColor: t.rule }]}
          accessibilityRole="button"
          accessibilityLabel="Hide keyboard"
        >
          <Text style={{ color: t.blue, fontWeight: '700' }}>Hide keyboard</Text>
        </Pressable>
      )}
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <Heading t={t}>Name</Heading>
      <Card t={t}>
        <Field
          t={t}
          label=""
          value={draft.name}
          placeholder="Gym, Mom's, School…"
          onChangeText={(name) => setDraft({ ...draft, name })}
        />
      </Card>

      <Heading t={t}>Icon</Heading>
      <View style={styles.icons}>
        {PLACE_ICON_NAMES.map((icon) => {
          const active = draft.icon === icon;
          return (
            <Pressable
              key={icon}
              onPress={() => setDraft({ ...draft, icon })}
              style={[
                styles.iconCell,
                {
                  backgroundColor: t.surface,
                  borderColor: active ? t.ink : t.rule,
                },
              ]}
              accessibilityLabel={`Icon ${icon}`}
            >
              <Icon name={icon} size={22} color={active ? t.blue : t.ink2} />
            </Pressable>
          );
        })}
      </View>

      <Heading t={t}>Address</Heading>
      <PlaceField
        t={t}
        label="Search for an address"
        dot={t.orange}
        includeSaved={false}
        persistResults
        value={draft.address}
        onChangeText={(address) => setDraft({ ...draft, address, latitude: null, longitude: null })}
        onPick={(p) =>
          setDraft({
            ...draft,
            address: p.secondary ? `${p.primary}, ${p.secondary}` : p.primary,
            latitude: p.latitude,
            longitude: p.longitude,
          })
        }
      />
      <Pressable onPress={useHere} style={styles.hereButton} accessibilityRole="button">
        <Text style={{ color: t.blue, fontWeight: '600' }}>Use my current location</Text>
      </Pressable>
      {draft.latitude !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Icon name="check" size={16} color={t.green} />
          <Text style={{ color: t.green, fontWeight: '500', fontSize: 13 }}>Location set</Text>
        </View>
      )}

      <PrimaryButton t={t} label="Save place" onPress={onSave} style={{ marginTop: 28 }} />
    </ScrollView>
    </View>
  );
}

/* ----- small building blocks ------------------------------------------- */

function Heading({ t, children }: { t: Theme; children: string }) {
  return <Text style={[styles.heading, { color: t.ink3 }]}>{children.toUpperCase()}</Text>;
}

function Hint({ t, children }: { t: Theme; children: string }) {
  return <Text style={[styles.hint, { color: t.ink3 }]}>{children}</Text>;
}

function Card({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.rule }]}>{children}</View>
  );
}

function ToggleRow({
  t,
  label,
  detail,
  value,
  onChange,
  disabled,
}: {
  t: Theme;
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, { borderTopColor: t.rule, opacity: disabled ? 0.45 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
        {!!detail && <Text style={[styles.detail, { color: t.ink3 }]}>{detail}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.blue, false: t.ruleStrong }}
      />
    </View>
  );
}

function Segmented({
  t,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  t: Theme;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, styles.segRow, { borderTopColor: t.rule, opacity: disabled ? 0.45 : 1 }]}>
      <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
      <View style={[styles.seg, { backgroundColor: t.surfaceSunk }]}>
        {options.map(([key, text]) => {
          const active = key === value;
          return (
            <Pressable
              key={key}
              disabled={disabled}
              onPress={() => onChange(key)}
              style={[styles.segItem, active && { backgroundColor: t.surface }]}
            >
              <Text style={{ color: active ? t.ink : t.ink2, fontWeight: active ? '600' : '500', fontSize: 13 }}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Field({
  t,
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType,
}: {
  t: Theme;
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'phone-pad';
}) {
  return (
    <View style={[styles.row, { borderTopColor: t.rule }]}>
      {!!label && <Text style={[styles.label, { color: t.ink, width: 64 }]}>{label}</Text>}
      <TextInput
        style={[styles.input, { color: t.ink }]}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={t.ink3}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCorrect={false}
      />
    </View>
  );
}

function ActionRow({ t, label, onPress }: { t: Theme; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.row, { borderTopColor: t.rule }]} accessibilityRole="button">
      <Text style={[styles.label, { color: t.red }]}>{label}</Text>
    </Pressable>
  );
}

function PlaceRow({
  t,
  icon,
  label,
  place,
  onAdd,
  onEdit,
  onRemove,
}: {
  t: Theme;
  icon: string;
  label: string;
  place?: SavedPlace;
  onAdd: () => void;
  onEdit: (p: SavedPlace) => void;
  onRemove: (p: SavedPlace) => void;
}) {
  return (
    <Pressable
      onPress={() => (place ? onEdit(place) : onAdd())}
      style={[styles.row, { borderTopColor: t.rule }]}
      accessibilityRole="button"
    >
      <View style={{ width: 28, alignItems: 'center' }}>
        <Icon name={placeIcon(place?.icon ?? icon)} size={20} color={t.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
        <Text style={[styles.detail, { color: place ? t.ink3 : t.blue }]} numberOfLines={1}>
          {place ? place.address : `Set ${label.toLowerCase()}`}
        </Text>
      </View>
      {place && (
        <Pressable onPress={() => onRemove(place)} hitSlop={12} accessibilityLabel={`Remove ${label}`}>
          <Text style={{ color: t.red, fontWeight: '600' }}>Remove</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: '600' },
  heading: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 8, marginHorizontal: 4 },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  segRow: { justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '500' },
  detail: { fontSize: 13, marginTop: 2, lineHeight: 17 },
  input: { flex: 1, fontSize: 16, paddingVertical: 6 },
  seg: { flexDirection: 'row', borderRadius: radius.sm, padding: 2 },
  segItem: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm - 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconCell: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardBar: {
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hereButton: { marginTop: 12, paddingVertical: 4 },
  save: {
    marginTop: 28,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
