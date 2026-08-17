import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { RouteWeatherScene } from '@/application/weather/route-weather';
import { fonts } from '@/ui/tokens';
import { cockpitColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';

const scenes = {
  sunrise: require('../../assets/images/route-scenes/windshield-sunrise.jpg'),
  dayClear: require('../../assets/images/route-scenes/windshield-day-clear.jpg'),
  dayOvercast: require('../../assets/images/route-scenes/windshield-day-overcast.jpg'),
  sunset: require('../../assets/images/route-scenes/windshield-sunset.jpg'),
  rain: require('../../assets/images/route-scenes/windshield-rain.jpg'),
  nightHighway: require('../../assets/images/route-scenes/windshield-night-highway.jpg'),
  nightTown: require('../../assets/images/route-scenes/windshield-night-town.jpg'),
  snow: require('../../assets/images/route-scenes/snow.png'),
  fog: require('../../assets/images/route-scenes/fog.png'),
  storm: require('../../assets/images/route-scenes/storm.png'),
} satisfies Record<string, ImageSourcePropType>;

type CockpitPalette = ReturnType<typeof cockpitColorsFor>;
const ARC_LENGTH = 470;

export interface RoadProgressBarProps {
  readonly fraction: number;
  readonly completed?: boolean;
  readonly weatherScene?: RouteWeatherScene | null;
  readonly breakdown?: {
    readonly stopsFraction: number;
    readonly weightFraction: number;
    readonly distanceFraction: number;
  };
}

export function RoadProgressBar({
  fraction,
  completed = false,
  weatherScene,
  breakdown,
}: RoadProgressBarProps) {
  const { scheme } = useTheme();
  const cockpit = cockpitColorsFor(scheme);
  const styles = useMemo(() => createStyles(cockpit), [cockpit]);
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const animatedProgress = useRef(new Animated.Value(clamped)).current;
  const [displayedProgress, setDisplayedProgress] = useState(clamped);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sceneClock, setSceneClock] = useState(() => Date.now());
  const [sceneIndex, setSceneIndex] = useState(0);
  const availableScenes = roadSceneKeys(weatherScene, new Date(sceneClock));
  const selectedSceneKey = availableScenes[sceneIndex % availableScenes.length];
  const [displayedSceneKey, setDisplayedSceneKey] = useState(selectedSceneKey);
  const sceneOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const listener = animatedProgress.addListener(({ value }) => setDisplayedProgress(value));
    return () => animatedProgress.removeListener(listener);
  }, [animatedProgress]);

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: clamped,
      duration: reduceMotion ? 0 : 500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, clamped, reduceMotion]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSceneClock(Date.now());
      setSceneIndex((current) => current + 1);
    }, 28_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedSceneKey === displayedSceneKey) return;
    if (reduceMotion) {
      setDisplayedSceneKey(selectedSceneKey);
      sceneOpacity.setValue(1);
      return;
    }

    Animated.timing(sceneOpacity, {
      toValue: 0,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setDisplayedSceneKey(selectedSceneKey);
      Animated.timing(sceneOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [displayedSceneKey, reduceMotion, sceneOpacity, selectedSceneKey]);

  return (
    <View
      accessibilityLabel={`Maršruto progresas ${Math.round(clamped * 100)} procentų`}
      style={styles.container}
      testID="route-road-progress">
      <View style={styles.windshieldArea}>
        <View style={styles.windshieldShell} testID="route-front-windshield">
          <Animated.Image
            accessibilityLabel={roadSceneLabel(displayedSceneKey)}
            resizeMode="cover"
            source={scenes[displayedSceneKey]}
            style={[styles.roadImage, { opacity: sceneOpacity }]}
          />
          <View pointerEvents="none" style={styles.dashboardEdge} />
          {completed ? (
            <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
              <Text style={styles.completedMessageText}>GERO POILSIO!</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.instrumentBridge}>
        <Svg pointerEvents="none" preserveAspectRatio="none" style={styles.arc} viewBox="0 0 430 62">
          <Defs>
            <LinearGradient id="steeringMetal" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={cockpit.white} />
              <Stop offset="0.38" stopColor={cockpit.metalMid} />
              <Stop offset="0.72" stopColor={cockpit.metalLight} />
              <Stop offset="1" stopColor={cockpit.metalDark} />
            </LinearGradient>
            <LinearGradient id="steeringProgress" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpit.primaryDark} />
              <Stop offset="0.6" stopColor={cockpit.primary} />
              <Stop offset="1" stopColor={cockpit.routeBright} />
            </LinearGradient>
          </Defs>
          <Path
            d="M 18 56 Q 215 -10 412 56"
            fill="none"
            stroke="url(#steeringMetal)"
            strokeLinecap="round"
            strokeWidth={12}
          />
          <Path
            d="M 18 56 Q 215 -10 412 56"
            fill="none"
            stroke="url(#steeringProgress)"
            strokeDasharray={`${Math.max(1, displayedProgress * ARC_LENGTH)} ${ARC_LENGTH}`}
            strokeLinecap="round"
            strokeWidth={8}
          />
        </Svg>
        <Text style={styles.percent}>{Math.round(clamped * 100)}%</Text>
        {breakdown ? <Text numberOfLines={1} style={styles.breakdown}>
          Taškai {percent(breakdown.stopsFraction)} · Svoris {percent(breakdown.weightFraction)} · Kelias {percent(breakdown.distanceFraction)}
        </Text> : null}
      </View>
    </View>
  );
}

function percent(value: number): string {
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${Math.round(fraction * 100)}%`;
}

type RoadSceneKey = keyof typeof scenes;

function roadSceneKeys(scene: RouteWeatherScene | null | undefined, now: Date): readonly RoadSceneKey[] {
  if (scene?.condition === 'rain') return ['rain', 'dayOvercast'];
  if (scene?.condition === 'snow') return ['snow', 'dayOvercast'];
  if (scene?.condition === 'fog') return ['fog', 'dayOvercast'];
  if (scene?.condition === 'storm') return ['storm', 'rain'];
  const hour = now.getHours();
  if (hour >= 5 && hour < 9) return ['sunrise', 'dayOvercast', 'dayClear'];
  if (hour >= 9 && hour < 15) return ['dayClear', 'dayOvercast'];
  if (hour >= 15 && hour < 18) return ['dayClear', 'dayOvercast', 'sunset'];
  if (hour >= 18 && hour < 21) return ['sunset', 'nightTown'];
  return ['nightHighway', 'nightTown'];
}

function roadSceneLabel(scene: RoadSceneKey): string {
  const labels: Record<RoadSceneKey, string> = {
    sunrise: 'Kelias saulei tekant',
    dayClear: 'Kelias giedrą dieną',
    dayOvercast: 'Kelias apsiniaukusią dieną',
    sunset: 'Kelias saulei leidžiantis',
    rain: 'Kelias lyjant',
    nightHighway: 'Greitkelis naktį',
    nightTown: 'Kelias per miestelį naktį',
    snow: 'Kelias sningant',
    fog: 'Kelias rūke',
    storm: 'Kelias audros metu',
  };
  return labels[scene];
}

const createStyles = (cockpit: CockpitPalette) => StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: cockpit.background,
  },
  windshieldArea: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: cockpit.surface,
  },
  windshieldShell: {
    width: '96%',
    maxWidth: 520,
    aspectRatio: 2.45,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: cockpit.metalDark,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: cockpit.background,
  },
  roadImage: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  dashboardEdge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 8,
    borderTopWidth: 1,
    borderTopColor: cockpit.metalMid,
    backgroundColor: cockpit.metalDark,
    opacity: 0.92,
  },
  completedMessage: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cockpit.primaryDark,
    opacity: 0.88,
  },
  completedMessageText: {
    color: cockpit.white,
    fontFamily: fonts.headingExtraBold,
    fontSize: 24,
    letterSpacing: 1.2,
  },
  instrumentBridge: {
    height: 68,
    position: 'relative',
    justifyContent: 'flex-end',
    backgroundColor: cockpit.surface,
  },
  arc: { position: 'absolute', left: 0, right: 0, top: 0, width: '100%', height: 62 },
  percent: {
    alignSelf: 'center',
    marginBottom: 0,
    color: cockpit.onSurface,
    fontFamily: fonts.headingExtraBold,
    fontSize: 16,
  },
  breakdown: {
    alignSelf: 'center',
    marginBottom: 2,
    color: cockpit.onSurface,
    fontFamily: fonts.headingSemiBold,
    fontSize: 10,
    letterSpacing: 0.15,
  },
});
