import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { cockpitColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import { fonts } from '@/ui/tokens';

type CockpitPalette = ReturnType<typeof cockpitColorsFor>;
/**
 * Length of the semicircular steering-rim path in the 400×240 viewBox.
 * Path: left 8-o'clock → top apex → right 4-o'clock (look-through wheel frame).
 */
const ARC_LENGTH = 520;
const SCENE_ROTATION_INTERVAL_MS = 30 * 60 * 1000;

/** Semicircular rim path — frames the instrument bay like looking through a wheel. */
const RIM_PATH = 'M 28 198 A 172 172 0 0 1 372 198';

const sceneAssets = {
  sunrise: require('../../assets/images/route-scenes/stitch-windshield-01.png'),
  dayClear: require('../../assets/images/route-scenes/stitch-windshield-02.png'),
  dayOvercast: require('../../assets/images/route-scenes/stitch-windshield-03.png'),
  sunset: require('../../assets/images/route-scenes/stitch-windshield-04.png'),
  rain: require('../../assets/images/route-scenes/stitch-windshield-05.png'),
  fog: require('../../assets/images/route-scenes/stitch-windshield-06.png'),
  storm: require('../../assets/images/route-scenes/stitch-windshield-07.png'),
  nightTown: require('../../assets/images/route-scenes/stitch-windshield-08.png'),
  nightHighway: require('../../assets/images/route-scenes/stitch-windshield-09.png'),
  snow: require('../../assets/images/route-scenes/stitch-windshield-10.png'),
  nightCity: require('../../assets/images/route-scenes/stitch-windshield-11.png'),
} satisfies Record<string, ImageSourcePropType>;

export interface RoadProgressBarProps {
  readonly fraction: number;
  readonly completed?: boolean;
  readonly compact?: boolean;
  readonly weatherScene?: RouteWeatherScene | null;
  /**
   * Instrument cluster (Svoris / Laikas / Rida / Taškai) rendered inside the
   * steering-rim opening — the product "nails" that must stay large and readable.
   */
  readonly children?: ReactNode;
}

export function RoadProgressBar({
  fraction,
  completed = false,
  compact = false,
  weatherScene,
  children,
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
  const progressStroke = Math.max(1, displayedProgress * ARC_LENGTH);

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
    // Matches the weather refresh cadence (route-weather.ts's 30-minute cache
    // TTL) so the photo doesn't cycle faster than the conditions it reflects.
    const timer = setInterval(() => {
      setSceneClock(Date.now());
      setSceneIndex((current) => current + 1);
    }, SCENE_ROTATION_INTERVAL_MS);
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
      {/* Upper view: road ahead through the wheel. */}
      <View style={[styles.windshieldArea, compact && styles.windshieldAreaCompact]}>
        <View style={[styles.windshieldShell, compact && styles.windshieldShellCompact]} testID="route-front-windshield">
          <Animated.View style={[styles.sceneLayer, { opacity: sceneOpacity }]}>
            <Animated.Image
              accessibilityLabel={roadSceneLabel(displayedSceneKey)}
              resizeMode="cover"
              source={sceneAssets[displayedSceneKey]}
              style={styles.sceneImage}
            />
          </Animated.View>
          <View pointerEvents="none" style={[styles.sceneBadge, compact && styles.sceneBadgeCompact]}>
            <Text style={styles.sceneBadgeText}>{sceneLabel(weatherScene, displayedSceneKey)}</Text>
          </View>
          {weatherScene && (weatherScene.temperatureC !== null || weatherScene.windSpeedKmh !== null || weatherScene.precipitationProbabilityPercent !== null) ? (
            <View pointerEvents="none" style={[styles.weatherBadge, compact && styles.weatherBadgeCompact]} testID="route-weather-readout">
              <Text style={styles.sceneBadgeText}>{weatherReadoutLabel(weatherScene)}</Text>
            </View>
          ) : null}
          {completed ? (
            <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
              <Text style={styles.completedMessageText}>GERO POILSIO!</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Instrument bay: look through the semicircular steering rim at the gauges. */}
      <View style={[styles.clusterBay, compact && styles.clusterBayCompact]} testID="route-instrument-cluster">
        <Svg
          pointerEvents="none"
          style={[styles.steeringRim, compact && styles.steeringRimCompact]}
          testID="route-steering-progress"
          viewBox="0 0 400 240">
          <Defs>
            <LinearGradient id="steeringProgress" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpit.primaryDark} />
              <Stop offset="0.55" stopColor={cockpit.primary} />
              <Stop offset="1" stopColor={cockpit.routeBright} />
            </LinearGradient>
            <LinearGradient id="binnacleShade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="rgba(17, 28, 45, 0)" />
              <Stop offset="0.45" stopColor="rgba(17, 28, 45, 0.08)" />
              <Stop offset="1" stopColor="rgba(17, 28, 45, 0.22)" />
            </LinearGradient>
          </Defs>
          {/* Soft shade only — never an opaque blue card over the gauges. */}
          <Path d="M 0 40 A 200 200 0 0 1 400 40 L 400 240 L 0 240 Z" fill="url(#binnacleShade)" />
          {/* Thick dark steering / binnacle rim — look-through-the-wheel frame. */}
          <Path
            d={RIM_PATH}
            fill="none"
            stroke="#1A2233"
            strokeLinecap="round"
            strokeOpacity={0.95}
            strokeWidth={28}
          />
          <Path
            d={RIM_PATH}
            fill="none"
            stroke={cockpit.metalDark}
            strokeLinecap="round"
            strokeOpacity={0.9}
            strokeWidth={20}
          />
          <Path
            d={RIM_PATH}
            fill="none"
            stroke={cockpit.metalMid}
            strokeLinecap="round"
            strokeOpacity={0.45}
            strokeWidth={12}
          />
          {/* Progress fills along the rim — the route "fuel" gauge on the wheel. */}
          <Path
            d={RIM_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.28)"
            strokeLinecap="round"
            strokeWidth={8}
          />
          <Path
            d={RIM_PATH}
            fill="none"
            stroke="url(#steeringProgress)"
            strokeDasharray={`${progressStroke} ${ARC_LENGTH}`}
            strokeLinecap="round"
            strokeWidth={7}
          />
        </Svg>
        <View pointerEvents="none" style={[styles.progressReadout, compact && styles.progressReadoutCompact]}>
          <Text style={[styles.percent, compact && styles.percentCompact]}>{Math.round(clamped * 100)}%</Text>
        </View>
        <View style={[styles.gaugeSlot, compact && styles.gaugeSlotCompact]}>
          {children}
        </View>
      </View>
    </View>
  );
}

function sceneLabel(scene: RouteWeatherScene | null | undefined, key: RoadSceneKey): string {
  if (scene) return `${weatherLabel(scene.condition)} · ${timeLabel(scene.timeOfDay)}`;
  return roadSceneLabel(key);
}

function weatherReadoutLabel(scene: RouteWeatherScene): string {
  const parts: string[] = [];
  if (scene.temperatureC !== null) parts.push(`${scene.temperatureC}°C`);
  if (scene.precipitationProbabilityPercent !== null) parts.push(`${scene.precipitationProbabilityPercent}% liet.`);
  if (scene.windSpeedKmh !== null) parts.push(`${scene.windSpeedKmh} km/h`);
  return parts.join(' · ');
}

function weatherLabel(condition: RouteWeatherScene['condition'] | undefined): string {
  return ({ clear: 'GIEDRA', cloudy: 'DEBESUOTA', fog: 'RŪKAS', rain: 'LIETUS', snow: 'SNIEGAS', storm: 'AUDRA' } as const)[condition ?? 'clear'];
}

function timeLabel(timeOfDay: RouteWeatherScene['timeOfDay'] | undefined): string {
  return ({ dawn: 'AUŠRA', day: 'DIENA', dusk: 'SAULĖLYDIS', night: 'NAKTIS' } as const)[timeOfDay ?? 'day'];
}

type RoadSceneKey = keyof typeof sceneAssets;

function roadSceneKeys(scene: RouteWeatherScene | null | undefined, now: Date): readonly RoadSceneKey[] {
  if (scene?.condition === 'rain') return ['rain', 'dayOvercast'];
  if (scene?.condition === 'snow') return ['snow', 'dayOvercast'];
  if (scene?.condition === 'fog') return ['fog', 'dayOvercast'];
  if (scene?.condition === 'storm') return ['storm', 'rain'];
  const hour = now.getHours();
  if (hour >= 5 && hour < 9) return ['sunrise', 'dayOvercast', 'dayClear'];
  if (hour >= 9 && hour < 15) return ['dayClear', 'dayOvercast'];
  if (hour >= 15 && hour < 18) return ['dayClear', 'dayOvercast', 'sunset'];
  if (hour >= 18 && hour < 21) return ['sunset', 'nightTown', 'nightCity'];
  return ['nightHighway', 'nightTown', 'nightCity'];
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
    nightCity: 'Miestas naktį',
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
    paddingTop: 6,
    paddingHorizontal: 8,
    backgroundColor: cockpit.background,
  },
  windshieldAreaCompact: { paddingTop: 4, paddingHorizontal: 6 },
  windshieldShell: {
    width: '100%',
    maxWidth: 720,
    aspectRatio: 2.35,
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: cockpit.outlineVariant,
    backgroundColor: cockpit.surfaceContainer,
  },
  // Shorter windshield so the instrument bay (gauges) can stay large.
  windshieldShellCompact: { aspectRatio: 2.55, maxHeight: 148 },
  sceneLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
    height: undefined,
  },
  sceneImage: { width: '100%', height: '100%', transform: [{ scale: 1.08 }] },
  sceneBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(8, 13, 18, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    zIndex: 3,
  },
  weatherBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(8, 13, 18, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    zIndex: 3,
  },
  sceneBadgeCompact: { top: 8, left: 8, paddingHorizontal: 10, paddingVertical: 6 },
  weatherBadgeCompact: { top: 8, right: 8, paddingHorizontal: 10, paddingVertical: 6 },
  sceneBadgeText: {
    color: cockpit.white,
    fontFamily: fonts.headingSemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  clusterBay: {
    width: '100%',
    position: 'relative',
    marginTop: -18,
    paddingTop: 28,
    paddingBottom: 4,
    paddingHorizontal: 8,
    backgroundColor: cockpit.background,
    minHeight: 168,
  },
  clusterBayCompact: {
    marginTop: -14,
    paddingTop: 22,
    paddingBottom: 2,
    paddingHorizontal: 6,
    minHeight: 148,
  },
  steeringRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: 168,
    zIndex: 1,
  },
  steeringRimCompact: { height: 148 },
  progressReadout: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  progressReadoutCompact: { top: 4 },
  gaugeSlot: {
    width: '100%',
    zIndex: 2,
    paddingTop: 18,
    paddingHorizontal: 4,
  },
  gaugeSlotCompact: { paddingTop: 12, paddingHorizontal: 2 },
  completedMessage: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cockpit.primaryDark,
    opacity: 0.88,
    zIndex: 4,
  },
  completedMessageText: {
    color: cockpit.white,
    fontFamily: fonts.headingExtraBold,
    fontSize: 24,
    letterSpacing: 1.2,
  },
  percent: {
    color: cockpit.white,
    fontFamily: fonts.headingExtraBold,
    fontSize: 18,
    lineHeight: 20,
    backgroundColor: 'rgba(17, 28, 45, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  percentCompact: { fontSize: 16, lineHeight: 18, paddingHorizontal: 9, paddingVertical: 2 },
});
