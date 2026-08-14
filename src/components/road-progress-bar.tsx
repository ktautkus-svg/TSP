import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import type { RouteWeatherScene } from '@/application/weather/route-weather';
import { fonts } from '@/ui/tokens';
import { stitchCockpitTheme } from '@/theme';

const scenes = {
  morning: require('../../assets/images/route-scenes/clear-morning.png'),
  midday: require('../../assets/images/route-scenes/clear-midday.png'),
  afternoon: require('../../assets/images/route-scenes/clear-afternoon.png'),
  evening: require('../../assets/images/route-scenes/clear-evening.png'),
  night: require('../../assets/images/route-scenes/clear-night.png'),
  rain: require('../../assets/images/route-scenes/rain.png'),
  snow: require('../../assets/images/route-scenes/snow.png'),
  fog: require('../../assets/images/route-scenes/fog.png'),
  storm: require('../../assets/images/route-scenes/storm.png'),
} satisfies Record<string, ImageSourcePropType>;

const cockpit = stitchCockpitTheme.colors;
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
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const animatedProgress = useRef(new Animated.Value(clamped)).current;
  const [displayedProgress, setDisplayedProgress] = useState(clamped);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sceneClock, setSceneClock] = useState(() => Date.now());

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
    const timer = setInterval(() => setSceneClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View
      accessibilityLabel={`Maršruto progresas ${Math.round(clamped * 100)} procentų`}
      style={styles.container}
      testID="route-road-progress">
      <View style={styles.scene}>
        <Image
          accessibilityLabel={roadSceneLabel(weatherScene)}
          resizeMode="cover"
          source={roadSceneSource(weatherScene, new Date(sceneClock))}
          style={styles.roadImage}
        />
        {completed ? (
          <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
            <Text style={styles.completedMessageText}>GERO POILSIO!</Text>
          </View>
        ) : null}
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

function roadSceneSource(scene: RouteWeatherScene | null | undefined, now: Date): ImageSourcePropType {
  if (scene?.condition === 'rain') return scenes.rain;
  if (scene?.condition === 'snow') return scenes.snow;
  if (scene?.condition === 'fog') return scenes.fog;
  if (scene?.condition === 'storm' || scene?.condition === 'cloudy') return scenes.storm;
  const hour = now.getHours();
  if (hour >= 5 && hour < 9) return scenes.morning;
  if (hour >= 9 && hour < 15) return scenes.midday;
  if (hour >= 15 && hour < 18) return scenes.afternoon;
  if (hour >= 18 && hour < 21) return scenes.evening;
  return scenes.night;
}

function roadSceneLabel(scene?: RouteWeatherScene | null): string {
  if (!scene) return 'Kelias dieną';
  const condition = scene.condition === 'clear' ? '' : `, ${scene.condition}`;
  return `Kelio vaizdas ${scene.timeOfDay}${condition}`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: cockpit.background,
  },
  scene: {
    width: '100%',
    height: 108,
    position: 'relative',
    overflow: 'hidden',
  },
  roadImage: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
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
    color: cockpit.onSurfaceVariant,
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 0.15,
  },
});
