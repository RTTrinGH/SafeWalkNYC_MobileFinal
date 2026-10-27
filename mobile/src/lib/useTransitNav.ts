import { useEffect, useRef, useState } from 'react';

import { LatLng, metresBetween } from './geo';
import { DirectionStep, TransitLeg, TransitOption, walkDirections } from './transit';

export type NavEvent = 'near' | 'arrived';

/**
 * Guidance through a transit trip, one leg at a time.
 *
 * GPS is good on the street and useless underground, so the two kinds of leg
 * advance differently. Walking legs finish when you reach their end. Rides are
 * followed by the clock, using the live times already on the trip: you are
 * taken to be aboard once the train has left the platform, and to have arrived
 * once it reaches your stop or you are close enough to see it on the map.
 * Either can be moved on by hand, since a train that comes early or a signal
 * that never arrives should not trap anyone on a step.
 */
export function useTransitNav(
  option: TransitOption | null,
  position: LatLng | null,
  active: boolean,
  onEvent: (event: NavEvent) => void,
) {
  const [index, setIndex] = useState(0);
  const [onBoard, setOnBoard] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [steps, setSteps] = useState<DirectionStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const warned = useRef(-1);
  const finished = useRef(false);
  const event = useRef(onEvent);
  event.current = onEvent;

  const legs = option?.legs ?? [];
  const leg: TransitLeg | undefined = legs[index];
  const next: TransitLeg | undefined = legs[index + 1];
  const last = index >= legs.length - 1;

  // A fresh trip starts from the top.
  useEffect(() => {
    if (!active) return;
    setIndex(0);
    setOnBoard(false);
    setStepIndex(0);
    warned.current = -1;
    finished.current = false;
  }, [active, option?.id]);

  // The clock behind the countdowns.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 4000);
    return () => clearInterval(timer);
  }, [active]);

  // Street directions for the leg being walked.
  useEffect(() => {
    setSteps([]);
    setStepIndex(0);
    if (!active || !leg || leg.kind !== 'walk') return;
    let current = true;
    walkDirections(leg, next)
      .then((list) => current && setSteps(list))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, index, option?.id]);

  const advance = () => {
    if (last) {
      if (!finished.current) {
        finished.current = true;
        event.current('arrived');
      }
      return;
    }
    setIndex((i) => Math.min(i + 1, legs.length - 1));
    setOnBoard(false);
  };

  const back = () => {
    setIndex((i) => Math.max(0, i - 1));
    setOnBoard(false);
  };

  // Move along on their own: by position on foot, by the clock on a train.
  useEffect(() => {
    if (!active || !option || !leg) return;

    if (leg.kind === 'walk') {
      const close = position ? metresBetween(position.latitude, position.longitude, leg.to[0], leg.to[1]) : Infinity;
      const arrived = leg.toName === 'END' ? close < 25 : close < (leg.sameStation ? 25 : 45);
      // Underground there is no position, so a platform change simply runs out its time.
      const timedOut = leg.sameStation ? now > leg.end + 30_000 : now > leg.end + 4 * 60_000;
      if (arrived || timedOut) advance();

      // Which direction step is next.
      if (position && steps.length) {
        let reached = -1;
        steps.forEach((s, i) => {
          if (s.at && metresBetween(position.latitude, position.longitude, s.at[0], s.at[1]) < 28) reached = i;
        });
        if (reached >= 0) setStepIndex(Math.min(reached + 1, steps.length - 1));
      }
      return;
    }

    if (!onBoard) {
      // The train has left the platform: assume you are on it, unless it never came.
      if (now >= leg.start + 45_000 && !leg.cancelled) setOnBoard(true);
      return;
    }

    const near = position ? metresBetween(position.latitude, position.longitude, leg.to[0], leg.to[1]) < 80 : false;
    if (leg.end - now < 150_000 && warned.current !== index) {
      warned.current = index;
      event.current('near');
    }
    if (near || now > leg.end + 45_000) advance();
  }, [now, position, index, onBoard, active, steps]);

  const toLegEnd = leg && position ? metresBetween(position.latitude, position.longitude, leg.to[0], leg.to[1]) : null;

  return {
    index,
    leg,
    next,
    last,
    onBoard,
    now,
    steps,
    step: steps[Math.min(stepIndex, Math.max(0, steps.length - 1))] ?? null,
    toLegEnd,
    advance: () => {
      // A hand-moved ride step means "I am on it" before it means "I got off".
      if (leg?.kind === 'ride' && !onBoard) setOnBoard(true);
      else advance();
    },
    back,
    markBoarded: () => setOnBoard(true),
  };
}
