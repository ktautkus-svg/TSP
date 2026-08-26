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
const ARC_LENGTH = 470;

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
          <Animated.View style={[styles.sceneLayer, { opacity: sceneOpacity }]}>
            <Animated.Image
              accessibilityLabel={roadSceneLabel(displayedSceneKey)}
              resizeMode="cover"
              source={sceneAssets[displayedSceneKey]}
              style={styles.sceneImage}
            />
          </Animated.View>
          <View pointerEvents="none" style={styles.windshieldTopShade} />
          <View pointerEvents="none" style={styles.windshieldPillarLeft} />
          <View pointerEvents="none" style={styles.windshieldPillarRight} />
          <View pointerEvents="none" style={styles.sceneBadge}>
            <Text style={styles.sceneBadgeText}>{sceneLabel(weatherScene, displayedSceneKey)}</Text>
          </View>
          <Svg pointerEvents="none" style={styles.cockpitCowl} viewBox="0 0 430 132">
            <Defs>
              <LinearGradient id="dashboardSurface" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={cockpit.metalMid} />
                <Stop offset="0.18" stopColor={cockpit.metalDark} />
                <Stop offset="1" stopColor={cockpit.primaryDark} />
              </LinearGradient>
              <LinearGradient id="steeringProgress" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={cockpit.primaryDark} />
                <Stop offset="0.6" stopColor={cockpit.primary} />
                <Stop offset="1" stopColor={cockpit.routeBright} />
              </LinearGradient>
            </Defs>
            <Path
              d="M 0 96 Q 215 30 430 96 L 430 132 L 0 132 Z"
              fill="url(#dashboardSurface)"
            />
            <Path
              d="M 18 94 Q 215 36 412 94"
              fill="none"
              stroke={cockpit.metalLight}
              strokeLinecap="round"
              strokeWidth={6}
            />
            <Path
              d="M 18 94 Q 215 36 412 94"
              fill="none"
              stroke="url(#steeringProgress)"
              strokeDasharray={`${Math.max(1, displayedProgress * ARC_LENGTH)} ${ARC_LENGTH}`}
              strokeLinecap="round"
              strokeWidth={4}
            />
          </Svg>
          <View pointerEvents="none" style={styles.progressReadout}>
            <Text style={styles.percent}>{Math.round(clamped * 100)}%</Text>
            {breakdown ? <Text numberOfLines={1} style={styles.breakdown}>
              Taškai {percent(breakdown.stopsFraction)} · Svoris {percent(breakdown.weightFraction)} · Kelias {percent(breakdown.distanceFraction)}
            </Text> : null}
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

function weatherLabel(condition: RouteWeatherScene['condition'] | undefined): string {
  return ({ clear: 'GIEDRA', cloudy: 'DEBESUOTA', fog: 'RŪKAS', rain: 'LIETUS', snow: 'SNIEGAS', storm: 'AUDRA' } as const)[condition ?? 'clear'];
}

function timeLabel(timeOfDay: RouteWeatherScene['timeOfDay'] | undefined): string {
  return ({ dawn: 'AUŠRA', day: 'DIENA', dusk: 'SAULĖLYDIS', night: 'NAKTIS' } as const)[timeOfDay ?? 'day'];
}

function percent(value: number): string {
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${Math.round(fraction * 100)}%`;
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
    backgroundColor: cockpit.metalDark,
  },
  windshieldArea: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 10,
    backgroundColor: cockpit.metalDark,
  },
  windshieldShell: {
    width: '100%',
    maxWidth: 720,
    aspectRatio: 1.95,
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: cockpit.metalDark,
  },
  sceneLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
    height: undefined,
  },
  sceneImage: { width: '100%', height: '100%' },
  // Some generated scene images carry a faint HUD/dashboard sliver right at
  // their own top edge (an artifact of the source art, not our layout) —
  // this needs to fully hide it, not just tint it, whatever the crop.
  windshieldTopShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: 18,
    backgroundColor: 'rgba(8, 13, 18, 0.92)',
  },
  windshieldPillarLeft: {
    position: 'absolute',
    top: 0,
    bottom: 30,
    left: -18,
    width: 24,
    backgroundColor: 'rgba(8, 13, 18, 0.78)',
    transform: [{ rotate: '-5deg' }],
  },
  windshieldPillarRight: {
    position: 'absolute',
    top: 0,
    right: -18,
    bottom: 30,
    width: 24,
    backgroundColor: 'rgba(8, 13, 18, 0.78)',
    transform: [{ rotate: '5deg' }],
  },
  cockpitCowl: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 132,
  },
  sceneBadge: { position: 'absolute', top: 14, left: 18, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(8, 13, 18, 0.62)' },
  sceneBadgeText: { color: cockpit.white, fontFamily: fonts.headingSemiBold, fontSize: 9, letterSpacing: 0.7 },
  progressReadout: {
    position: 'absolute',
    right: 44,
    bottom: 8,
    left: 44,
    alignItems: 'center',
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
  percent: {
    color: cockpit.white,
    fontFamily: fonts.headingExtraBold,
    fontSize: 17,
    lineHeight: 20,
  },
  breakdown: {
    maxWidth: '100%',
    color: cockpit.metalLight,
    fontFamily: fonts.headingSemiBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.15,
  },
});

