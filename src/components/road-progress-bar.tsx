import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { RouteWeatherScene } from '@/application/weather/route-weather';

const roadScene = require('../../assets/images/route-windshield-day-v1.png');
const ARC_LENGTH = 470;

export function RoadProgressBar({
  fraction,
  completed = false,
  weatherScene,
}: {
  fraction: number;
  completed?: boolean;
  weatherScene?: RouteWeatherScene | null;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const animatedProgress = useRef(new Animated.Value(clamped)).current;
  const [displayedProgress, setDisplayedProgress] = useState(clamped);

  useEffect(() => {
    const listener = animatedProgress.addListener(({ value }) => setDisplayedProgress(value));
    return () => animatedProgress.removeListener(listener);
  }, [animatedProgress]);

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: clamped,
      duration: 800,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, clamped]);

  return (
    <View
      accessibilityLabel={`Maršruto progresas ${Math.round(clamped * 100)} procentų`}
      style={styles.container}
      testID="route-road-progress">
      <View style={styles.scene}>
        <Image resizeMode="cover" source={roadScene} style={styles.roadImage} />
        <View pointerEvents="none" style={[styles.timeOverlay, timeOverlayStyle(weatherScene?.timeOfDay)]} />
        <WeatherOverlay condition={weatherScene?.condition ?? 'clear'} />
        {completed ? (
          <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
            <Text style={styles.completedMessageText}>GERO POILSIO!</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.instrumentBridge}>
        <Svg pointerEvents="none" preserveAspectRatio="none" style={styles.arc} viewBox="0 0 430 62">
          <Path
            d="M 18 56 Q 215 -10 412 56"
            fill="none"
            stroke="#3C433E"
            strokeLinecap="round"
            strokeWidth={10}
          />
          <Path
            d="M 18 56 Q 215 -10 412 56"
            fill="none"
            stroke="#83D13D"
            strokeDasharray={`${Math.max(1, displayedProgress * ARC_LENGTH)} ${ARC_LENGTH}`}
            strokeLinecap="round"
            strokeWidth={10}
          />
        </Svg>
        <Text style={styles.percent}>{Math.round(clamped * 100)}%</Text>
      </View>
    </View>
  );
}

function WeatherOverlay({ condition }: { condition: RouteWeatherScene['condition'] }) {
  if (condition === 'clear') return null;
  if (condition === 'fog') return <View pointerEvents="none" style={styles.fogOverlay} />;
  if (condition === 'cloudy') return <View pointerEvents="none" style={styles.cloudOverlay} />;
  if (condition === 'rain' || condition === 'storm') {
    return (
      <View pointerEvents="none" style={[styles.weatherParticles, condition === 'storm' && styles.stormOverlay]}>
        {Array.from({ length: 18 }, (_, index) => (
          <View key={index} style={[styles.rainDrop, { left: `${(index * 17) % 100}%`, top: `${(index * 29) % 90}%` }]} />
        ))}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={styles.weatherParticles}>
      {Array.from({ length: 22 }, (_, index) => (
        <View key={index} style={[styles.snowFlake, { left: `${(index * 23) % 100}%`, top: `${(index * 31) % 92}%` }]} />
      ))}
    </View>
  );
}

function timeOverlayStyle(timeOfDay: RouteWeatherScene['timeOfDay'] | undefined) {
  if (timeOfDay === 'night') return styles.nightOverlay;
  if (timeOfDay === 'dusk') return styles.duskOverlay;
  if (timeOfDay === 'dawn') return styles.dawnOverlay;
  return styles.dayOverlay;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#090D0B',
  },
  scene: {
    width: '100%',
    height: 102,
    position: 'relative',
    overflow: 'hidden',
  },
  roadImage: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  timeOverlay: { position: 'absolute', inset: 0 },
  dayOverlay: { backgroundColor: 'transparent' },
  dawnOverlay: { backgroundColor: 'rgba(255, 157, 61, 0.24)' },
  duskOverlay: { backgroundColor: 'rgba(53, 29, 96, 0.48)' },
  nightOverlay: { backgroundColor: 'rgba(1, 10, 24, 0.74)' },
  cloudOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(75, 87, 94, 0.24)' },
  fogOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(230, 235, 232, 0.44)' },
  weatherParticles: { position: 'absolute', inset: 0, overflow: 'hidden' },
  stormOverlay: { backgroundColor: 'rgba(16, 25, 36, 0.25)' },
  rainDrop: { position: 'absolute', width: 2, height: 18, borderRadius: 2, backgroundColor: 'rgba(210, 232, 255, 0.75)', transform: [{ rotate: '18deg' }] },
  snowFlake: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.92)', shadowColor: '#FFFFFF', shadowOpacity: 0.8, shadowRadius: 2 },
  completedMessage: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3, 18, 10, 0.2)' },
  completedMessageText: { color: '#FFFFFF', fontFamily: 'Archivo_800ExtraBold', fontSize: 24, letterSpacing: 1.2, textShadowColor: '#000000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 5 },
  instrumentBridge: { height: 48, marginTop: -7, position: 'relative', justifyContent: 'flex-end', backgroundColor: '#090D0B' },
  arc: { position: 'absolute', left: 0, right: 0, top: 0, width: '100%', height: 62 },
  percent: { alignSelf: 'center', marginBottom: 1, color: '#FFFFFF', fontFamily: 'Archivo_800ExtraBold', fontSize: 16, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
