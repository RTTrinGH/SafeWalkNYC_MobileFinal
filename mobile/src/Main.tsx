import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EmergencyButton from './components/EmergencyButton';
import HomeSheet from './components/HomeSheet';
import Icon from './components/Icon';
import ManeuverIcon from './components/ManeuverIcon';
import PlanCard from './components/PlanCard';
import ReportModal from './components/ReportModal';
import SettingsModal from './components/SettingsModal';
import TransitSheet from './components/TransitSheet';
import { TransitNavBanner, TransitNavSheet } from './components/TransitNav';
import { IconButton, MapButton, PrimaryButton, SecondaryButton, surfaceStyle } from './components/ui';
import { describeLocation, Place } from './lib/geocode';
import { useStore } from './lib/store';
import { LatLng, metresBetween } from './lib/geo';
import {
  Departure,
  arrivalTime,
  departureDate,
  departureHour,
  formatClock,
  formatDistance,
  formatMiles,
  isAfterDark,
  routeMinutes,
} from './lib/format';
import { HAVEN_KINDS, Region, havensInRegion, havensNearRoute, nearestHaven } from './lib/havens';
import {
  LiveStatus,
  TransitFilter,
  TransitOption,
  applyLive,
  improveTrips,
  keepScores,
  mapsTransitUrl,
  mergeTrips,
  modeName,
  polishTrips,
  routeTransferWalks,
  planTransit,
  rankTransit,
  scoreTransitWalks,
  withRoutedWalks,
} from './lib/transit';
import { REPORT_KINDS, Report, ReportKind, ago, reportsEnabled, useReports } from './lib/reports';
import { NavEvent, useTransitNav } from './lib/useTransitNav';
import { Plan, comparisonNote, optimizedIndex, planWalk, plottableCrimes, rankOptions } from './lib/plan';
import {
  Theme,
  darkTheme,
  lightTheme,
  mapStyleDark,
  mapStyleLight,
  numeric,
  radius,
  riskColours,
} from './theme';

const NYC: Region = {
  latitude: 40.7484,
  longitude: -73.9857,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

type Mode = 'home' | 'plan' | 'results' | 'transit' | 'transitNav' | 'navigating';

/** Call just before a state change to have the layout glide to its new shape. */
const animate = () =>
  LayoutAnimation.configureNext(LayoutAnimation.create(240, 'easeInEaseOut', 'opacity'));

const toLatLng = (coords: [number, number][]) =>
  coords.map(([latitude, longitude]) => ({ latitude, longitude }));

export default function Main() {
  const { settings, places, recents, addRecent, update } = useStore();
  const systemScheme = useColorScheme();
  const dark = settings.appearance === 'system' ? systemScheme === 'dark' : settings.appearance === 'dark';
  const t = dark ? darkTheme : lightTheme;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const followRef = useRef(settings.followWhileWalking);
  followRef.current = settings.followWhileWalking;

  const haptic = useCallback(
    (kind: 'Success' | 'Error' | 'Medium' | 'Select') => {
      if (!settings.haptics) return;
      const run =
        kind === 'Success'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          : kind === 'Error'
            ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
            : kind === 'Medium'
              ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              : Haptics.selectionAsync();
      run.catch(() => {});
    },
    [settings.haptics],
  );
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);

  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [departure, setDeparture] = useState<Departure>(settings.defaultDeparture);
  const [customDate, setCustomDate] = useState(new Date());
  const [pickingTime, setPickingTime] = useState(false);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('home');
  // The search card folds into a one-line bar once routes are found, and the
  // bottom sheet starts as just the route options, so the map stays visible.
  const [topOpen, setTopOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [travel, setTravel] = useState<'walk' | 'transit'>('walk');
  const [transit, setTransit] = useState<TransitOption[] | null>(null);
  const [tSelId, setTSelId] = useState('');
  const tPicked = useRef(false);
  const [navId, setNavId] = useState('');
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [addSlot, setAddSlot] = useState<'Home' | 'Work' | 'new' | null>(null);
  const [tFilter, setTFilter] = useState<TransitFilter>('all');
  const [tLoading, setTLoading] = useState(false);

  const [position, setPosition] = useState<LatLng | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [region, setRegion] = useState<Region>(NYC);
  const showHavens = settings.showHavens;
  const { reports, submit: submitReport, remove: removeReport } = useReports(settings.showReports);
  const [reportAt, setReportAt] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const candidate = plan?.candidates[selected] ?? null;
  const transitRef = useRef<TransitOption[] | null>(null);
  const searchToken = useRef(0);
  transitRef.current = transit;
  const rankedTrips = useMemo(() => rankTransit(transit ?? []), [transit]);
  const tOption = transit?.find((o) => o.id === tSelId) ?? transit?.[rankedTrips[0]?.index ?? 0] ?? null;
  const navOption = transit?.find((o) => o.id === navId) ?? null;

  const onNavEvent = (event: NavEvent) => {
    if (event === 'near') {
      haptic('Medium');
    } else {
      stopWatching();
      haptic('Success');
      Alert.alert('You have arrived', endText, [{ text: 'Done', onPress: goHome }]);
    }
  };
  const nav = useTransitNav(navOption, position, mode === 'transitNav', onNavEvent);

  // Give the chosen trip real street paths for any walk between stops that came without one.
  useEffect(() => {
    if (mode !== 'transit' || !tOption || tOption.legs.every((l) => l.kind !== 'walk' || l.sameStation || l.routed || l.coords.length >= 4)) return;
    let current = true;
    routeTransferWalks(tOption)
      .then((routed) => {
        if (current) setTransit((cur) => (cur ? withRoutedWalks(cur, routed) : cur));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [mode, tOption?.id, transit]);

  const hour = departureHour(departure);

  const crimesShown = useMemo(
    () => (settings.showIncidents && plan && candidate ? plottableCrimes(plan.crimes, candidate.coords) : []),
    [plan, candidate, settings.showIncidents],
  );
  const havens = useMemo(() => {
    if (!showHavens) return [];
    return candidate && (mode === 'results' || mode === 'navigating')
      ? havensNearRoute(candidate.coords)
      : havensInRegion(region);
  }, [showHavens, candidate, mode, region]);

  const reportsShown = useMemo(() => {
    if (!settings.showReports) return [];
    const halfLat = region.latitudeDelta / 2;
    const halfLng = region.longitudeDelta / 2;
    return reports
      .filter(
        (r) =>
          Math.abs(r.lat - region.latitude) <= halfLat && Math.abs(r.lng - region.longitude) <= halfLng,
      )
      .slice(0, 100);
  }, [reports, region, settings.showReports]);

  const stopWatching = useCallback(() => {
    watcher.current?.remove();
    watcher.current = null;
  }, []);
  useEffect(() => stopWatching, [stopWatching]);

  const requestPermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location is off',
        'SafeWalk NYC needs your location to start from where you are and to guide you. You can turn it on in Settings.',
        [{ text: 'Not now' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
      );
      return false;
    }
    return true;
  }, []);

  const useMyLocation = useCallback(async () => {
    if (!(await requestPermission())) return;
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = fix.coords;
      setStart({ latitude, longitude });
      setStartText('My location');
      setPlan(null);
      map.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        400,
      );
      describeLocation(latitude, longitude)
        .then((name) => setStartText((cur) => (cur === 'My location' ? name : cur)))
        .catch(() => {});
    } catch {
      setError('Could not get your location. Try again outside or type an address.');
    }
  }, [requestPermission]);

  /** Report from where you are standing; failing that, the middle of the map. */
  const openReport = useCallback(async () => {
    if (!reportsEnabled) {
      Alert.alert('Reporting is not set up', 'Add the Firebase keys from .env.example to turn on community reports.');
      return;
    }
    let at = { lat: region.latitude, lng: region.longitude, label: 'the centre of the map' };
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        at = { lat: fix.coords.latitude, lng: fix.coords.longitude, label: 'your location' };
      }
    } catch {
      // Keep the map centre.
    }
    setReportAt(at);
    setReportOpen(true);
  }, [region]);

  const sendReport = async (kind: ReportKind, note: string) => {
    if (!reportAt) return;
    await submitReport(kind, reportAt.lat, reportAt.lng, note);
    haptic('Success');
    setReportOpen(false);
    Alert.alert('Thanks', 'Your report is on the map for other walkers.');
  };

  const manageReport = (r: Report) => {
    if (!r.mine) return;
    Alert.alert(REPORT_KINDS[r.kind].label, 'Remove your report?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeReport(r.id).catch(() => Alert.alert('Could not remove it', 'Try again in a moment.')),
      },
    ]);
  };

  const fit = useCallback((coords: [number, number][]) => {
    map.current?.fitToCoordinates(toLatLng(coords), {
      edgePadding: { top: 150, right: 50, bottom: 320, left: 50 },
      animated: true,
    });
  }, []);

  const findRoutes = async () => {
    if (!start || !end) {
      setError('Choose a start and a destination from the suggestions.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await planWalk(start, end, hour);
      setPlan(result);
      setSelected(result.dataAvailable ? optimizedIndex(result.candidates) : 0);
      animate();
      setMode('results');
      setTopOpen(false);
      setSheetOpen(false);
      haptic('Success');
      addRecent({ name: endText, latitude: end.latitude, longitude: end.longitude });
      fit(result.candidates.flatMap((c) => c.coords));
    } catch (e: any) {
      setError(e?.message || 'Could not plan that walk.');
      haptic('Error');
    } finally {
      setLoading(false);
    }
  };

  /** Lay the MTA's live running over the trips; safe to call again and again. */
  const refreshLive = useCallback(async (base?: TransitOption[]) => {
    const source = base ?? transitRef.current;
    if (!source?.length) return;
    const token = searchToken.current;
    setLiveBusy(true);
    try {
      const { options, status } = await applyLive(source);
      if (token !== searchToken.current) return; // a newer search has replaced these trips
      setTransit((cur) => (cur ? keepScores(options, cur) : cur));
      setLiveStatus(status);
    } catch {
      // The schedule stays on screen; the status line says live data is missing.
    } finally {
      setLiveBusy(false);
    }
  }, []);

  // While trips are on screen, keep them current.
  useEffect(() => {
    if (mode !== 'transit' && mode !== 'transitNav') return;
    const timer = setInterval(() => refreshLive(), 30_000);
    return () => clearInterval(timer);
  }, [mode, refreshLive]);

  // Until someone picks a trip by hand, follow whichever is best as live and safety data arrive.
  useEffect(() => {
    if (mode !== 'transit' || !transit || tPicked.current) return;
    const best = transit[rankTransit(transit)[0]?.index ?? 0];
    if (best && best.id !== tSelId) setTSelId(best.id);
  }, [mode, transit, tSelId]);

  const findTransit = async (filter: TransitFilter = tFilter, fromFilter = false) => {
    if (!start || !end) {
      setError('Choose a start and a destination from the suggestions.');
      return;
    }
    setError(null);
    setTLoading(true);
    try {
      const found = await planTransit(start, end, departureDate(departure), filter);
      const first = found[rankTransit(found)[0]?.index ?? 0];
      tPicked.current = false;
      const token = ++searchToken.current;
      setLiveStatus(null);
      setPlan(null);
      setTransit(found);
      setTFilter(filter);
      setTSelId(first.id);
      animate();
      setMode('transit');
      setTopOpen(false);
      haptic('Success');
      addRecent({ name: endText, latitude: end.latitude, longitude: end.longitude });
      fit(first.legs.flatMap((l) => l.coords));
      // The trips show first. Live times and walking safety then arrive and re-rank them.
      refreshLive(found);
      scoreTransitWalks(found)
        .then((scored) => token === searchToken.current && setTransit((cur) => (cur ? keepScores(cur, scored) : cur)))
        .catch(() => {});

      // The planner misses some trips, such as one train and then a walk. Look for those too.
      if (filter !== 'bus') {
        improveTrips(start, end, departureDate(departure), filter, found)
          .then(async (improved) => {
            if (!improved.length || token !== searchToken.current) return;
            const merged = mergeTrips(transitRef.current ?? found, improved);
            setTransit(merged);
            const { options: live } = await applyLive(merged);
            if (token !== searchToken.current) return;
            setTransit((cur) => (cur ? keepScores(live, cur) : cur));
            scoreTransitWalks(live)
              .then((scored) => token === searchToken.current && setTransit((cur) => (cur ? keepScores(cur, scored) : cur)))
              .catch(() => {});

            // Then put real street routes on the walks of the best few.
            const polished = await polishTrips(start, end, live);
            if (!polished.length || token !== searchToken.current) return;
            const next = live.map((o) => polished.find((p) => p.id === o.id) ?? o);
            setTransit((cur) => (cur ? keepScores(next, cur) : cur));
            refreshLive(next);
            scoreTransitWalks(next)
              .then((scored) => token === searchToken.current && setTransit((cur) => (cur ? keepScores(cur, scored) : cur)))
              .catch(() => {});
          })
          .catch(() => {});
      }
    } catch (e: any) {
      const message =
        e?.name === 'AbortError' ? 'Transit is taking too long. Try again.' : e?.message || 'Could not plan that trip.';
      if (fromFilter) Alert.alert('No trips', message);
      else setError(message);
      haptic('Error');
    } finally {
      setTLoading(false);
    }
  };

  const chooseTrip = (id: string) => {
    tPicked.current = true;
    setTSelId(id);
    const option = transit?.find((o) => o.id === id);
    if (option) fit(option.legs.flatMap((l) => l.coords));
  };

  const tripMessage = () => {
    if (!tOption) return '';
    if (tOption.walkOnly) {
      return `I'm walking to ${endText}. Arriving about ${formatClock(new Date(tOption.end))} (${tOption.minutes} min).`;
    }
    const rides = tOption.legs
      .filter((l) => l.kind === 'ride')
      .map((l) => `${modeName(l.mode)} ${l.label}`)
      .join(' then ');
    return `I'm heading to ${endText} by ${rides}. Leaving ${formatClock(new Date(tOption.start))}, arriving about ${formatClock(new Date(tOption.end))} (${tOption.minutes} min).`;
  };

  const shareTrip = async () => {
    try {
      await Share.share({ message: tripMessage() });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  };

  /** Quietly start from where you are, if location is already allowed. */
  const prefillStart = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const fix =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      setStart((cur) => cur ?? here);
      setStartText((cur) => cur || 'My location');
    } catch {
      // The start field is simply left for the person to fill in.
    }
  };

  const openSearch = () => {
    haptic('Select');
    animate();
    setError(null);
    setTopOpen(true);
    setMode('plan');
    prefillStart();
  };

  const goToPlace = (name: string, point: LatLng) => {
    haptic('Select');
    animate();
    setError(null);
    setPlan(null);
    setTransit(null);
    setEnd({ latitude: point.latitude, longitude: point.longitude });
    setEndText(name);
    setTopOpen(true);
    setMode('plan');
    prefillStart();
  };

  /** Guide the selected transit trip, leg by leg, from here to the destination. */
  const startTransitTrip = async () => {
    if (!tOption || !(await requestPermission())) return;
    tPicked.current = true;
    setNavId(tOption.id);
    animate();
    setMode('transitNav');
    haptic('Medium');
    stopWatching();
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
      (fix) => {
        const here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        setPosition(here);
        if (followRef.current) {
          map.current?.animateCamera({ center: here, zoom: 17 }, { duration: 500 });
        }
      },
    );
  };

  const endTransitTrip = () => {
    stopWatching();
    animate();
    setMode('transit');
  };

  /** Leave planning altogether and return to the home screen. */
  const goHome = () => {
    animate();
    stopWatching();
    setPlan(null);
    setTransit(null);
    setStart(null);
    setStartText('');
    setEnd(null);
    setEndText('');
    setError(null);
    setPickingTime(false);
    setTopOpen(true);
    setMode('home');
  };

  const swapPlaces = () => {
    const s0 = start;
    const st = startText;
    setStart(end);
    setStartText(endText);
    setEnd(s0);
    setEndText(st);
    setPlan(null);
    setTransit(null);
    if (mode !== 'plan') setMode('plan');
  };

  const locateMe = async () => {
    if (!(await requestPermission())) return;
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      map.current?.animateToRegion(
        {
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        },
        400,
      );
    } catch {
      Alert.alert('Could not find you', 'Try again outside or with a clearer view of the sky.');
    }
  };

  const edit = useCallback(() => {
    animate();
    setTopOpen(true);
    stopWatching();
    setMode('plan');
    setPlan(null);
    setTransit(null);
  }, [stopWatching]);

  const startNavigation = async () => {
    if (!candidate || !(await requestPermission())) return;
    setStepIndex(0);
    animate();
    setSheetOpen(false);
    setMode('navigating');
    haptic('Medium');
    stopWatching();
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
      (fix) => {
        const here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        setPosition(here);
        if (followRef.current) {
          map.current?.animateCamera({ center: here, zoom: 18 }, { duration: 500 });
        }
      },
    );
  };

  const steps = candidate?.route.steps ?? [];

  // Move on to whichever manoeuvre we are closest to, never going backwards.
  useEffect(() => {
    if (mode !== 'navigating' || !position || !steps.length) return;
    let best = stepIndex;
    let bestD = Infinity;
    steps.forEach((s, i) => {
      if (i < stepIndex || !s.at) return;
      const d = metresBetween(position.latitude, position.longitude, s.at[0], s.at[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // Within 25 m of a manoeuvre means we are on to the one after it.
    const next = bestD < 25 ? Math.min(best + 1, steps.length - 1) : best;
    if (next !== stepIndex) {
      setStepIndex(next);
      haptic('Select');
    }
  }, [position, mode, steps, stepIndex, haptic]);

  const remaining = useMemo(() => {
    if (mode !== 'navigating' || !position || !candidate) return null;
    const last = candidate.coords[candidate.coords.length - 1];
    return metresBetween(position.latitude, position.longitude, last[0], last[1]);
  }, [mode, position, candidate]);

  useEffect(() => {
    if (mode === 'navigating' && remaining !== null && remaining < 20) {
      stopWatching();
      haptic('Success');
      Alert.alert('You have arrived', endText, [{ text: 'Done', onPress: edit }]);
    }
  }, [remaining, mode, stopWatching, edit, endText]);

  const walkMessage = () => {
    if (!candidate) return '';
    const minutes = routeMinutes(candidate.route);
    const eta = arrivalTime(departure, minutes);
    const here = position ?? start;
    const where = here
      ? `\nMy location: https://maps.apple.com/?ll=${here.latitude},${here.longitude}`
      : '';
    return `I'm walking to ${endText}. Expected arrival ${eta} (${minutes} min, ${formatMiles(candidate.route.distance)}).${where}`;
  };

  const shareWalk = async () => {
    if (!candidate) return;
    try {
      await Share.share({ message: walkMessage() });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  };

  const textContact = () => {
    const phone = settings.contactPhone.replace(/[^\d+]/g, '');
    if (!phone) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(walkMessage())}`);
  };

  const callContact = () => {
    const phone = settings.contactPhone.replace(/[^\d+]/g, '');
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  const findHelp = () => {
    const from = position ?? start;
    if (!from) {
      Alert.alert('Where are you?', 'Turn on location to find the nearest safe place.');
      return;
    }
    const near = nearestHaven(from.latitude, from.longitude);
    if (!near) return;
    Alert.alert(
      near.haven.n,
      `${HAVEN_KINDS[near.haven.t].label}, ${formatDistance(near.metres)} away. Open walking directions in Maps?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Directions',
          onPress: () =>
            Linking.openURL(`http://maps.apple.com/?daddr=${near.haven.y},${near.haven.x}&dirflg=w`),
        },
      ],
    );
  };

  const risk = candidate ? riskColours(t)[candidate.safety.score] : null;
  const note = plan && candidate ? comparisonNote(plan.candidates, selected) : null;
  const afterDark = isAfterDark(hour);
  const options = useMemo(
    () => (plan ? rankOptions(plan.candidates, plan.dataAvailable) : []),
    [plan],
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.paper }]}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />

      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={NYC}
        customMapStyle={Platform.OS === 'android' ? (t.dark ? mapStyleDark : mapStyleLight) : undefined}
        showsUserLocation
        showsCompass={false}
        onRegionChangeComplete={setRegion}
        userInterfaceStyle={t.dark ? 'dark' : 'light'}
      >
        {plan?.candidates.map((c, i) =>
          i === selected ? null : (
            <Polyline
              key={`alt${i}`}
              coordinates={toLatLng(c.coords)}
              strokeColor={t.ink3}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
              tappable
              onPress={() => setSelected(i)}
            />
          ),
        )}
        {candidate && (
          <>
            {/* A pale edge keeps the route a solid line over any road or other route. */}
            <Polyline
              key={`edge${selected}`}
              coordinates={toLatLng(candidate.coords)}
              strokeColor={t.surface}
              strokeWidth={11}
              lineCap="round"
              lineJoin="round"
              zIndex={2}
            />
            <Polyline
              key={`route${selected}`}
              coordinates={toLatLng(candidate.coords)}
              strokeColor={t.blue}
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              zIndex={3}
            />
          </>
        )}
        {(mode === 'transit' || mode === 'transitNav') &&
          tOption?.legs.map((leg, i) =>
            leg.coords.length > 1 ? (
              <React.Fragment key={`tl${tOption.id}-${i}`}>
                <Polyline
                  coordinates={toLatLng(leg.coords)}
                  strokeColor={t.surface}
                  strokeWidth={leg.kind === 'walk' ? 8 : 11}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={2}
                />
                <Polyline
                  coordinates={toLatLng(leg.coords)}
                  strokeColor={leg.kind === 'walk' ? t.blue : leg.color}
                  strokeWidth={leg.kind === 'walk' ? 4 : 7}
                  lineDashPattern={leg.kind === 'walk' ? [1, 8] : undefined}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={3}
                />
              </React.Fragment>
            ) : null,
          )}
        {(mode === 'transit' || mode === 'transitNav') &&
          tOption?.legs.map((leg, i) =>
            leg.kind === 'ride' && leg.coords.length > 1
              ? [leg.coords[0], leg.coords[leg.coords.length - 1]].map((point, k) => (
                  <Marker
                    key={`tm${tOption.id}-${i}-${k}`}
                    coordinate={{ latitude: point[0], longitude: point[1] }}
                    title={k === 0 ? `Board ${modeName(leg.mode)} ${leg.label}` : `Get off ${modeName(leg.mode)} ${leg.label}`}
                    description={k === 0 ? leg.fromName : leg.toName}
                    tracksViewChanges={false}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={[styles.stop, { backgroundColor: leg.color, borderColor: t.surface }]} />
                  </Marker>
                ))
              : null,
          )}
        {crimesShown.map((c, i) => (
          <Circle
            key={`c${i}`}
            center={{ latitude: c.lat, longitude: c.lng }}
            radius={14}
            fillColor={`${t.red}88`}
            strokeColor={t.red}
            strokeWidth={1}
          />
        ))}
        {havens.map((h) => (
          <Marker
            key={`${h.n}${h.y}${h.x}`}
            coordinate={{ latitude: h.y, longitude: h.x }}
            title={h.n}
            description={HAVEN_KINDS[h.t].label}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.haven, { backgroundColor: t.teal, borderColor: t.surface }]}>
              <Text style={styles.havenLetter}>{HAVEN_KINDS[h.t].letter}</Text>
            </View>
          </Marker>
        ))}
        {reportsShown.map((r) => (
          <Marker
            key={r.id}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            title={`${REPORT_KINDS[r.kind].label} · ${ago(r.createdAt)}`}
            description={r.note || (r.mine ? 'Your report. Tap to remove.' : undefined)}
            onCalloutPress={() => manageReport(r)}
            tracksViewChanges={false}
          >
            <View style={[styles.report, { backgroundColor: t.surface, borderColor: t.amber }]}>
              <Icon name={REPORT_KINDS[r.kind].icon} size={15} color={t.amber} />
            </View>
          </Marker>
        ))}
        {start && (mode === 'results' || mode === 'transit' || mode === 'navigating') && (
          <Marker coordinate={start} title="Start" pinColor={t.blue} />
        )}
        {end && mode !== 'home' && <Marker coordinate={end} title="Destination" pinColor={t.orange} />}
      </MapView>

      {(mode === 'results' || mode === 'transit') && !topOpen ? (
        <View style={[styles.compact, surfaceStyle(t), { top: insets.top + 8 }]}>
          <IconButton t={t} icon="back" label="Back to home" onPress={goHome} />
          <Pressable
            onPress={() => {
              animate();
              setTopOpen(true);
            }}
            style={styles.compactBody}
            accessibilityRole="button"
            accessibilityLabel="Edit search"
          >
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
              {startText || 'Start'}
            </Text>
            <Icon name="chevron" size={14} color={t.ink3} />
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {endText || 'Destination'}
            </Text>
          </Pressable>
        </View>
      ) : mode === 'plan' || mode === 'results' || mode === 'transit' ? (
        <PlanCard
          t={t}
          top={insets.top + 8}
          startText={startText}
          endText={endText}
          onStartText={(x) => {
            setStartText(x);
            setStart(null);
          }}
          onEndText={(x) => {
            setEndText(x);
            setEnd(null);
          }}
          onPickStart={(p: Place) => {
            setStart({ latitude: p.latitude, longitude: p.longitude });
            setPlan(null);
            setTransit(null);
            setMode('plan');
          }}
          onPickEnd={(p: Place) => {
            setEnd({ latitude: p.latitude, longitude: p.longitude });
            setPlan(null);
            setTransit(null);
            setMode('plan');
          }}
          onGps={useMyLocation}
          onSwap={swapPlaces}
          onBack={goHome}
          travel={travel}
          onTravel={(next) => {
            setTravel(next);
            if (mode !== 'plan') {
              setPlan(null);
              setTransit(null);
              setMode('plan');
            }
          }}
          departure={departure}
          onDeparture={(d) => {
            setDeparture(d);
            setPlan(null);
            setTransit(null);
            if (mode !== 'plan') setMode('plan');
          }}
          pickingTime={pickingTime}
          onPickingTime={setPickingTime}
          customDate={customDate}
          onCustomDate={setCustomDate}
          loading={loading || tLoading}
          error={error}
          onFind={() => (travel === 'transit' ? findTransit() : findRoutes())}
          onCollapse={
            mode === 'plan'
              ? undefined
              : () => {
                  animate();
                  setTopOpen(false);
                }
          }
        />
      ) : mode === 'navigating' && !!steps[stepIndex] ? (
        <View style={[styles.nav, { top: insets.top + 8, backgroundColor: t.ink }]}>
          <ManeuverIcon
            type={steps[stepIndex].type}
            modifier={steps[stepIndex].modifier}
            size={36}
            color={t.surface}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.navText, { color: t.surface }]} numberOfLines={3}>
              {steps[stepIndex].instruction}
            </Text>
            {!!steps[stepIndex].distance && (
              <Text style={[styles.navSub, { color: t.surface }, numeric]}>
                {formatDistance(steps[stepIndex].distance)}
              </Text>
            )}
          </View>
        </View>
      ) : mode === 'transitNav' && nav.leg ? (
        <TransitNavBanner
          t={t}
          top={insets.top + 8}
          leg={nav.leg}
          next={nav.next}
          onBoard={nav.onBoard}
          now={nav.now}
          toLegEnd={nav.toLegEnd}
          step={nav.step}
        />
      ) : null}

      {(mode === 'home' || ((mode === 'results' || mode === 'transit' || mode === 'navigating' || mode === 'transitNav') && !topOpen)) && (
        <View
          style={[
            styles.fabs,
            { top: insets.top + (mode === 'home' ? 12 : mode === 'navigating' ? 118 : mode === 'transitNav' ? 150 : 72) },
          ]}
          pointerEvents="box-none"
        >
          <MapButton t={t} icon="settings" label="Settings" onPress={() => setSettingsOpen(true)} />
          <MapButton
            t={t}
            icon="shield"
            label="Show or hide safe places"
            active={showHavens}
            onPress={() => update({ showHavens: !settings.showHavens })}
          />
          <MapButton t={t} icon="alert" label="Report a blockage, traffic or event" onPress={openReport} />
          {mode === 'home' && <MapButton t={t} icon="locate" label="Show my location" onPress={locateMe} />}
        </View>
      )}

      {mode === 'home' && (
        <HomeSheet
          t={t}
          bottomInset={insets.bottom}
          places={places}
          recents={recents}
          onSearch={openSearch}
          onPlace={goToPlace}
          onAddPlace={(slot) => {
            setAddSlot(slot);
            setSettingsOpen(true);
          }}
        />
      )}

      {mode === 'transit' && transit && tOption && (
        <TransitSheet
          t={t}
          bottomInset={insets.bottom}
          options={transit}
          ranked={rankedTrips}
          selectedId={tOption?.id ?? ''}
          onSelect={chooseTrip}
          filter={tFilter}
          onFilter={(f) => findTransit(f, true)}
          loading={tLoading}
          status={liveStatus}
          refreshing={liveBusy}
          onRefresh={() => refreshLive()}
          onReplan={() => findTransit(tFilter)}
          onShare={shareTrip}
          onStart={startTransitTrip}
          onOpenMaps={() => {
            if (start && end) Linking.openURL(mapsTransitUrl(start, end, Platform.OS === 'ios'));
          }}
        />
      )}

      {mode === 'transitNav' && navOption && nav.leg && (
        <TransitNavSheet
          t={t}
          bottomInset={insets.bottom}
          option={navOption}
          index={nav.index}
          now={nav.now}
          last={nav.last}
          onPrevious={nav.back}
          onNext={nav.advance}
          onEnd={endTransitTrip}
          onShare={shareTrip}
        />
      )}

      {(mode === 'results' || mode === 'navigating') && plan && candidate && risk && (
        <View style={[styles.sheet, surfaceStyle(t), { paddingBottom: insets.bottom + 10 }]}>
          <Pressable
            onPress={() => {
              animate();
              setSheetOpen((v) => !v);
            }}
            hitSlop={14}
            style={styles.handleArea}
            accessibilityRole="button"
            accessibilityLabel={sheetOpen ? 'Collapse details' : 'Show details'}
          >
            <View style={[styles.handle, { backgroundColor: t.ruleStrong }]} />
          </Pressable>

          {mode === 'results' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
              {options.map(({ index: i, tags }) => {
                const c = plan.candidates[i];
                const r = riskColours(t)[c.safety.score];
                const active = i === selected;
                return (
                  <Pressable
                    key={i}
                    onPress={() => setSelected(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.option,
                      { borderColor: active ? t.ink : t.rule, borderWidth: active ? 1.5 : 1, backgroundColor: t.surface },
                    ]}
                  >
                    <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                      {tags.join(' · ')}
                    </Text>
                    <View style={styles.timeRow}>
                      <Text style={[styles.minutes, { color: t.ink }, numeric]}>{routeMinutes(c.route)}</Text>
                      <Text style={{ color: t.ink2, fontSize: 14, marginBottom: 3 }}> min</Text>
                    </View>
                    <Text style={[{ color: t.ink2, fontSize: 13 }, numeric]}>
                      {formatMiles(c.route.distance)} · arrive {arrivalTime(departure, routeMinutes(c.route))}
                    </Text>
                    <View style={styles.riskRow}>
                      <View style={[styles.riskDot, { backgroundColor: r.fg }]} />
                      <Text style={{ color: t.ink2, fontSize: 12 }}>{r.label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {mode === 'navigating' && (
            <View style={styles.summary}>
              <Text style={[styles.minutes, { color: t.ink }, numeric]}>
                {remaining !== null ? formatDistance(remaining) : `${routeMinutes(candidate.route)} min`}
              </Text>
              <Text style={{ color: t.ink2, fontSize: 14 }}>to go</Text>
              <View style={{ flex: 1 }} />
              <View style={styles.riskRow}>
                <View style={[styles.riskDot, { backgroundColor: risk.fg }]} />
                <Text style={{ color: t.ink2, fontSize: 13 }}>{risk.label}</Text>
              </View>
            </View>
          )}

          {sheetOpen && (
            <>
              <Text style={[styles.reason, { color: t.ink2 }]}>{candidate.safety.reason}</Text>
              {!!note && <Text style={[styles.reason, { color: t.green, fontWeight: '600' }]}>{note}</Text>}
              {afterDark && settings.nightWarning && mode === 'results' && (
                <Text style={[styles.reason, { color: t.amber }]}>
                  It will be dark. Keep to lit, busy streets and share your walk.
                </Text>
              )}
              {!plan.dataAvailable && (
                <Text style={[styles.reason, { color: t.amber }]}>
                  Incident data could not be loaded, so these routes are not safety-scored.
                </Text>
              )}

              {mode === 'results' && (
                <ScrollView style={styles.steps} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {candidate.route.steps.map((s, i) => (
                    <View key={i} style={styles.step}>
                      <ManeuverIcon type={s.type} modifier={s.modifier} size={20} color={t.ink2} />
                      <Text style={{ flex: 1, color: t.ink, fontSize: 14 }}>{s.instruction}</Text>
                      {!!s.distance && (
                        <Text style={[{ color: t.ink3, fontSize: 12 }, numeric]}>{formatDistance(s.distance)}</Text>
                      )}
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {(sheetOpen || mode === 'navigating') && (
            <>
              <View style={styles.actions}>
                <SecondaryButton t={t} label="Share" onPress={shareWalk} style={styles.half} />
                <SecondaryButton t={t} label="Nearest safe place" onPress={findHelp} style={styles.half} />
              </View>
              <View style={styles.actions}>
                {!!settings.contactPhone && (
                  <>
                    <SecondaryButton
                      t={t}
                      label={`Text ${settings.contactName || 'contact'}`}
                      onPress={textContact}
                      style={styles.half}
                    />
                    <SecondaryButton t={t} label="Call" onPress={callContact} style={styles.half} />
                  </>
                )}
                {settings.showEmergency && (
                  <EmergencyButton
                    t={t}
                    holdToCall={settings.holdToCall}
                    holdMs={settings.holdMs}
                    haptics={settings.haptics}
                  />
                )}
              </View>
            </>
          )}

          <View style={styles.actions}>
            <SecondaryButton
              t={t}
              label={mode === 'navigating' ? 'End walk' : 'Edit'}
              onPress={edit}
              style={{ flex: 1 }}
            />
            {mode === 'results' && (
              <PrimaryButton t={t} label="Start walking" onPress={startNavigation} style={{ flex: 2 }} />
            )}
          </View>
        </View>
      )}

      <SettingsModal
        t={t}
        visible={settingsOpen}
        startWith={addSlot}
        onClose={() => {
          setSettingsOpen(false);
          setAddSlot(null);
        }}
      />
      <ReportModal
        t={t}
        visible={reportOpen}
        where={reportAt}
        onClose={() => setReportOpen(false)}
        onSubmit={sendReport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  compact: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: 14,
  },
  compactBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingRight: 8 },
  nav: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
  },
  navText: { fontSize: 17, fontWeight: '600' },
  navSub: { fontSize: 14, marginTop: 2, opacity: 0.8 },
  fabs: { position: 'absolute', right: 14, gap: 10 },
  haven: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  havenLetter: { color: '#fff', fontSize: 10, fontWeight: '700' },
  report: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
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
  options: { gap: 10, paddingBottom: 6 },
  option: { width: 176, padding: 12, borderRadius: 14, gap: 3 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end' },
  minutes: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  summary: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingBottom: 4 },
  reason: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  steps: { maxHeight: 130, marginTop: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  half: { flex: 1, height: 44 },
});
