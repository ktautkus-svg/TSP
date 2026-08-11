import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
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
  const [reduceMotion, setReduceMotion] = useState(false);

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

  return (
    <View
      accessibilityLabel={`Maršruto progresas ${Math.round(clamped * 100)} procentų`}
      style={styles.container}
      testID="route-road-progress">
      <View style={styles.scene}>
        <Image resizeMode="cover" source={roadScene} style={styles.roadImage} />
        <TimeOfDayOverlay timeOfDay={weatherScene?.timeOfDay ?? 'day'} />
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
  if (condition === 'cloudy') {
    return (
      <View pointerEvents="none" style={styles.cloudOverlay}>
        <View style={[styles.cloudBlob, { left: '8%', top: '18%', width: 72, height: 28 }]} />
        <View style={[styles.cloudBlob, { left: '42%', top: '10%', width: 88, height: 34 }]} />
        <View style={[styles.cloudBlob, { left: '68%', top: '28%', width: 64, height: 24 }]} />
      </View>
    );
  }
  if (condition === 'rain' || condition === 'storm') {
    return (
      <View pointerEvents="none" style={[styles.weatherParticles, condition === 'storm' && styles.stormOverlay]}>
        {Array.from({ length: 24 }, (_, index) => (
          <View key={index} style={[styles.rainDrop, { left: `${(index * 17) % 100}%`, top: `${(index * 29) % 90}%`, height: 12 + (index % 3) * 6 }]} />
        ))}
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={styles.weatherParticles}>
      {Array.from({ length: 26 }, (_, index) => (
        <View key={index} style={[styles.snowFlake, { left: `${(index * 23) % 100}%`, top: `${(index * 31) % 92}%`, width: 4 + (index % 3), height: 4 + (index % 3) }]} />
      ))}
    </View>
  );
}

// Through a windscreen the world never goes pitch black: the sky keeps a soft
// indigo and the road stays readable under headlights. Celestial decorations
// are intentionally omitted so the scene remains operational, not illustrative.
const SKY_GRADIENTS: Record<Exclude<RouteWeatherScene['timeOfDay'], 'day'>, { offset: number; color: string; opacity: number }[]> = {
  dawn: [
    { offset: 0, color: '#16265C', opacity: 0.55 },
    { offset: 0.4, color: '#6E5A93', opacity: 0.38 },
    { offset: 0.54, color: '#FFA85C', opacity: 0.42 },
    { offset: 0.68, color: '#8A5A48', opacity: 0.36 },
    { offset: 1, color: '#1B1622', opacity: 0.4 },
  ],
  dusk: [
    { offset: 0, color: '#0E1038', opacity: 0.58 },
    { offset: 0.36, color: '#3A2660', opacity: 0.42 },
    { offset: 0.52, color: '#D96B26', opacity: 0.38 },
    { offset: 0.66, color: '#5A2C33', opacity: 0.4 },
    { offset: 1, color: '#080A16', opacity: 0.48 },
  ],
  night: [
    { offset: 0, color: '#0A1430', opacity: 0.52 },
    { offset: 0.38, color: '#121C3A', opacity: 0.4 },
    { offset: 0.58, color: '#1A2748', opacity: 0.28 },
    { offset: 1, color: '#0B1020', opacity: 0.45 },
  ],
};

function TimeOfDayOverlay({ timeOfDay }: { timeOfDay: RouteWeatherScene['timeOfDay'] }) {
  if (timeOfDay === 'day') return null;
  const stops = SKY_GRADIENTS[timeOfDay];
  const headlights = timeOfDay === 'night' || timeOfDay === 'dusk';
  return (
    <Svg pointerEvents="none" style={styles.timeOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          {stops.map((stop) => (
            <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
          ))}
        </LinearGradient>
        <RadialGradient id="headlight" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFF2CC" stopOpacity={timeOfDay === 'night' ? 0.5 : 0.28} />
          <Stop offset="0.55" stopColor="#FFE8A8" stopOpacity={timeOfDay === 'night' ? 0.18 : 0.1} />
          <Stop offset="1" stopColor="#FFF2CC" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#sky)" />
      {headlights ? <Ellipse cx="50" cy="86" rx="44" ry="22" fill="url(#headlight)" /> : null}
    </Svg>
  );
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
  timeOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  cloudOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(75, 87, 94, 0.24)' },
  cloudBlob: { position: 'absolute', borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.28)' },
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
