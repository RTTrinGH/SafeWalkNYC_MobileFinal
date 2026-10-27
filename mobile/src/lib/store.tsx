/**
 * Settings and saved places, kept on the phone.
 *
 * Nothing here ever leaves the device: no account, no sync. An emergency
 * contact's number, and the places someone calls home and work, are exactly the
 * data that should stay put.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setUnits } from './format';

export type Appearance = 'system' | 'light' | 'dark';
export type Units = 'imperial' | 'metric';
export type DefaultDeparture = 'now' | 'night';

export type Settings = {
  /** Show the 911 button at all. */
  showEmergency: boolean;
  /** Require a press-and-hold before the confirmation appears. */
  holdToCall: boolean;
  /** Hold duration in milliseconds. */
  holdMs: number;
  contactName: string;
  contactPhone: string;
  showHavens: boolean;
  showIncidents: boolean;
  /** Show what other walkers have reported: blockages, traffic, events. */
  showReports: boolean;
  haptics: boolean;
  nightWarning: boolean;
  appearance: Appearance;
  units: Units;
  defaultDeparture: DefaultDeparture;
  /** Keep the map centred on the walker while navigating. */
  followWhileWalking: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  showEmergency: true,
  holdToCall: true,
  holdMs: 800,
  contactName: '',
  contactPhone: '',
  showHavens: true,
  showIncidents: true,
  showReports: true,
  haptics: true,
  nightWarning: true,
  appearance: 'system',
  units: 'imperial',
  defaultDeparture: 'now',
  followWhileWalking: true,
};

export type SavedPlace = {
  id: string;
  name: string;
  icon: string;
  address: string;
  latitude: number;
  longitude: number;
};

/** Home and Work are always offered, empty until set. Icons are names from components/Icon. */
export const PLACE_ICONS = [
  'home', 'work', 'school', 'gym', 'coffee', 'food', 'shop', 'health', 'heart', 'park', 'star', 'pin',
];

/** A place someone has recently routed to, offered again on the home screen. */
export type Recent = { name: string; latitude: number; longitude: number };

const MAX_RECENTS = 6;

const SETTINGS_KEY = 'safewalk.settings.v1';
const PLACES_KEY = 'safewalk.places.v1';
const RECENTS_KEY = 'safewalk.recents.v1';

type Store = {
  ready: boolean;
  settings: Settings;
  places: SavedPlace[];
  recents: Recent[];
  addRecent: (recent: Recent) => void;
  clearRecents: () => void;
  update: (patch: Partial<Settings>) => void;
  savePlace: (place: Omit<SavedPlace, 'id'> & { id?: string }) => void;
  removePlace: (id: string) => void;
  resetSettings: () => void;
  clearPlaces: () => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [recents, setRecents] = useState<Recent[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, p, r] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(PLACES_KEY),
          AsyncStorage.getItem(RECENTS_KEY),
        ]);
        // Merge over defaults so a setting added in a later version has a value.
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
        if (p) setPlaces(JSON.parse(p));
        if (r) setRecents(JSON.parse(r));
      } catch {
        // Unreadable storage should never stop the app opening.
      } finally {
        loaded.current = true;
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    setUnits(settings.units);
    if (loaded.current) AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(PLACES_KEY, JSON.stringify(places)).catch(() => {});
  }, [places]);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(recents)).catch(() => {});
  }, [recents]);

  const addRecent = useCallback((recent: Recent) => {
    setRecents((cur) =>
      [recent, ...cur.filter((r) => r.name !== recent.name)].slice(0, MAX_RECENTS),
    );
  }, []);

  const clearRecents = useCallback(() => setRecents([]), []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => ({ ...cur, ...patch }));
  }, []);

  const savePlace = useCallback((place: Omit<SavedPlace, 'id'> & { id?: string }) => {
    setPlaces((cur) => {
      const id = place.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const next = { ...place, id } as SavedPlace;
      return cur.some((p) => p.id === id) ? cur.map((p) => (p.id === id ? next : p)) : [...cur, next];
    });
  }, []);

  const removePlace = useCallback((id: string) => {
    setPlaces((cur) => cur.filter((p) => p.id !== id));
  }, []);

  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), []);
  const clearPlaces = useCallback(() => setPlaces([]), []);

  const value = useMemo(
    () => ({
      ready,
      settings,
      places,
      recents,
      addRecent,
      clearRecents,
      update,
      savePlace,
      removePlace,
      resetSettings,
      clearPlaces,
    }),
    [ready, settings, places, recents, addRecent, clearRecents, update, savePlace, removePlace, resetSettings, clearPlaces],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
