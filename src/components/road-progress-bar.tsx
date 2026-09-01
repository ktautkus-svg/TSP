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
import { cockpitColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import { fonts } from '@/ui/tokens';

type CockpitPalette = ReturnType<typeof cockpitColorsFor>;
/** Approximate length of the dashboard half-arc path in the 430-wide viewBox. */
const ARC_LENGTH = 470;
const SCENE_ROTATION_INTERVAL_MS = 30 * 60 * 1000;

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
}

export function RoadProgressBar({
  fraction,
  completed = false,
  compact = false,
  weatherScene,
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
          {/* Dashboard half-arc along the cowl — instrument-cluster progress without an opaque blue card. */}
          <Svg
            pointerEvents="none"
            style={[styles.cockpitCowl, compact && styles.cockpitCowlCompact]}
            testID="route-steering-progress"
            viewBox="0 0 430 100">
            <Defs>
              <LinearGradient id="steeringProgress" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={cockpit.primaryDark} />
                <Stop offset="0.55" stopColor={cockpit.primary} />
                <Stop offset="1" stopColor={cockpit.routeBright} />
              </LinearGradient>
              {/* Soft dark wash under the arc so the % stays readable on bright snow. */}
              <LinearGradient id="arcReadability" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="rgba(8, 13, 18, 0)" />
                <Stop offset="0.35" stopColor="rgba(8, 13, 18, 0.18)" />
                <Stop offset="1" stopColor="rgba(8, 13, 18, 0.42)" />
              </LinearGradient>
            </Defs>
            <Path d="M 0 48 Q 215 8 430 48 L 430 100 L 0 100 Z" fill="url(#arcReadability)" />
            <Path
              d="M 28 62 Q 215 18 402 62"
              fill="none"
              stroke={cockpit.metalLight}
              strokeLinecap="round"
              strokeOpacity={0.55}
              strokeWidth={8}
            />
            <Path
              d="M 28 62 Q 215 18 402 62"
              fill="none"
              stroke="url(#steeringProgress)"
              strokeDasharray={`${progressStroke} ${ARC_LENGTH}`}
              strokeLinecap="round"
              strokeWidth={5}
            />
          </Svg>
          <View pointerEvents="none" style={[styles.progressReadout, compact && styles.progressReadoutCompact]}>
            <Text style={[styles.percent, compact && styles.percentCompact]}>{Math.round(clamped * 100)}%</Text>
          </View>
          {completed ? (
            <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
              <Text style={styles.completedMessageText}>GERO POILSIO!</Text>
            </View>
          ) : null}
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
    // Match the page surface — metalDark here produced black letterbox fringes.
    backgroundColor: cockpit.background,
  },
  windshieldArea: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 6,
    paddingHorizontal: 8,
    backgroundColor: cockpit.background,
  },
  windshieldAreaCompact: { paddingTop: 5, paddingHorizontal: 6 },
  windshieldShell: {
    width: '100%',
    maxWidth: 720,
    aspectRatio: 1.95,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cockpit.outlineVariant,
    backgroundColor: cockpit.surfaceContainer,
  },
  // Taller hero on phones so the road scene + weather chips read as the focus.
  windshieldShellCompact: { aspectRatio: 2.05, maxHeight: 214 },
  sceneLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
    height: undefined,
  },
  // Slight overscale hides any residual edge pixels without inventing black bars.
  sceneImage: { width: '100%', height: '100%', transform: [{ scale: 1.08 }] },
  cockpitCowl: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 100,
  },
  cockpitCowlCompact: { height: 86 },
  sceneBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(8, 13, 18, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  weatherBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(8, 13, 18, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
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
  progressReadout: {
    position: 'absolute',
    right: 40,
    bottom: 10,
    left: 40,
    alignItems: 'center',
  },
  progressReadoutCompact: { right: 28, bottom: 6, left: 28 },
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
  percent: {
    color: cockpit.white,
    fontFamily: fonts.headingExtraBold,
    fontSize: 22,
    lineHeight: 24,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  percentCompact: { fontSize: 20, lineHeight: 22 },
});
