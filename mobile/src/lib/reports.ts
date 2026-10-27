/**
 * Community reports: blockages, traffic, events and the like, shared between
 * everyone using the app.
 *
 * Storage is Firebase Firestore over its REST API, with anonymous sign-in, so
 * there is no account and no SDK to bundle. A report carries only a kind, a
 * place, an optional short note and times. Nothing identifies the person beyond
 * an anonymous id that lets them take their own report back down. Reports
 * expire on their own, so the map never fills with stale hazards.
 *
 * Configure with EXPO_PUBLIC_FIREBASE_API_KEY and EXPO_PUBLIC_FIREBASE_PROJECT_ID
 * (see .env.example). Without them the feature stays off and the rest of the
 * app is unaffected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IconName } from '../components/Icon';

export type ReportKind = 'blockage' | 'traffic' | 'event' | 'lighting' | 'unsafe' | 'other';

export const REPORT_KINDS: Record<ReportKind, { label: string; icon: IconName; hint: string; hours: number }> = {
  blockage: { label: 'Blockage', icon: 'block', hint: 'Sidewalk or crossing closed, construction', hours: 6 },
  traffic: { label: 'Traffic', icon: 'traffic', hint: 'Heavy traffic, hard to cross', hours: 2 },
  event: { label: 'Event', icon: 'people', hint: 'Crowd, parade, street fair', hours: 6 },
  lighting: { label: 'Poor lighting', icon: 'bulb', hint: 'Dark stretch, light out', hours: 72 },
  unsafe: { label: 'Unsafe', icon: 'alert', hint: 'Suspicious activity, feels unsafe', hours: 3 },
  other: { label: 'Other', icon: 'pin', hint: 'Anything else worth knowing', hours: 3 },
};

export const KIND_ORDER: ReportKind[] = ['blockage', 'traffic', 'event', 'lighting', 'unsafe', 'other'];

export const NOTE_MAX = 140;

export type Report = {
  id: string;
  kind: ReportKind;
  lat: number;
  lng: number;
  note: string;
  createdAt: number;
  expiresAt: number;
  mine: boolean;
};

const API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const PROJECT = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

export const reportsEnabled = Boolean(API_KEY && PROJECT);

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH_KEY = 'safewalk.auth.v1';
const REFRESH_MS = 60_000;
const MIN_GAP_MS = 30_000;

// ── Anonymous sign-in ────────────────────────────────────────────────────────

type Session = { idToken: string; refreshToken: string; uid: string; expiresAt: number };

let cached: Session | null = null;

async function post(url: string, body: unknown, token?: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function signUp(): Promise<Session> {
  const r = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    returnSecureToken: true,
  });
  return {
    idToken: r.idToken,
    refreshToken: r.refreshToken,
    uid: r.localId,
    expiresAt: Date.now() + Number(r.expiresIn) * 1000,
  };
}

async function refresh(old: Session): Promise<Session> {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(old.refreshToken)}`,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = await res.json();
  return {
    idToken: r.id_token,
    refreshToken: r.refresh_token,
    uid: r.user_id,
    expiresAt: Date.now() + Number(r.expires_in) * 1000,
  };
}

async function session(): Promise<Session> {
  if (!cached) {
    try {
      const saved = await AsyncStorage.getItem(AUTH_KEY);
      if (saved) cached = JSON.parse(saved);
    } catch {
      // Fall through and sign in afresh.
    }
  }
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached;

  let next: Session;
  try {
    next = cached ? await refresh(cached) : await signUp();
  } catch {
    next = await signUp();
  }
  cached = next;
  AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next)).catch(() => {});
  return next;
}

// ── Firestore ────────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString();

function parse(doc: any, uid: string): Report | null {
  try {
    const f = doc.fields;
    const kind = f.kind.stringValue as ReportKind;
    if (!REPORT_KINDS[kind]) return null;
    return {
      id: String(doc.name).split('/').pop() as string,
      kind,
      lat: Number(f.lat.doubleValue ?? f.lat.integerValue),
      lng: Number(f.lng.doubleValue ?? f.lng.integerValue),
      note: f.note?.stringValue ?? '',
      createdAt: Date.parse(f.createdAt.timestampValue),
      expiresAt: Date.parse(f.expiresAt.timestampValue),
      mine: f.uid?.stringValue === uid,
    };
  } catch {
    return null;
  }
}

/** Every report that has not yet expired. */
export async function fetchReports(): Promise<Report[]> {
  const s = await session();
  const rows = await post(
    `${DOCS}:runQuery`,
    {
      structuredQuery: {
        from: [{ collectionId: 'reports' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'expiresAt' },
            op: 'GREATER_THAN',
            value: { timestampValue: iso(Date.now()) },
          },
        },
        orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'DESCENDING' }],
        limit: 500,
      },
    },
    s.idToken,
  );
  return (rows as any[]).map((r) => (r.document ? parse(r.document, s.uid) : null)).filter((r): r is Report => !!r);
}

export async function sendReport(kind: ReportKind, lat: number, lng: number, note: string): Promise<void> {
  const s = await session();
  const now = Date.now();
  const fields: Record<string, unknown> = {
    kind: { stringValue: kind },
    lat: { doubleValue: lat },
    lng: { doubleValue: lng },
    createdAt: { timestampValue: iso(now) },
    expiresAt: { timestampValue: iso(now + REPORT_KINDS[kind].hours * 3_600_000) },
    uid: { stringValue: s.uid },
  };
  const trimmed = note.trim().slice(0, NOTE_MAX);
  if (trimmed) fields.note = { stringValue: trimmed };
  await post(`${DOCS}/reports`, { fields }, s.idToken);
}

export async function deleteReport(id: string): Promise<void> {
  const s = await session();
  const res = await fetch(`${DOCS}/reports/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${s.idToken}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useReports(active: boolean) {
  const [reports, setReports] = useState<Report[]>([]);
  const lastSent = useRef(0);

  const reload = useCallback(async () => {
    if (!reportsEnabled) return;
    try {
      setReports(await fetchReports());
    } catch {
      // Offline or misconfigured: keep showing what we last had.
    }
  }, []);

  useEffect(() => {
    if (!active || !reportsEnabled) return;
    reload();
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, reload]);

  const submit = useCallback(
    async (kind: ReportKind, lat: number, lng: number, note: string) => {
      if (Date.now() - lastSent.current < MIN_GAP_MS) {
        throw new Error('Please wait a moment before sending another report.');
      }
      await sendReport(kind, lat, lng, note);
      lastSent.current = Date.now();
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteReport(id);
      setReports((cur) => cur.filter((r) => r.id !== id));
    },
    [],
  );

  return { reports, submit, remove, reload };
}

/** "12 min ago" style label for a marker. */
export function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
}
