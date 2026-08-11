import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { RouteWeatherScene } from '@/application/weather/route-weather';
import { cockpitColors, fonts } from '@/ui/tokens';

const roadScene = require('../../assets/images/route-windshield-premium-v2.png');

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
        <TimeOfDayOverlay timeOfDay={weatherScene?.timeOfDay ?? 'day'} />
        <WeatherOverlay condition={weatherScene?.condition ?? 'clear'} />
        <Svg pointerEvents="none" preserveAspectRatio="none" style={styles.glassOverlay} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="glassShade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#07121D" stopOpacity={0.04} />
              <Stop offset="0.58" stopColor="#07121D" stopOpacity={0.02} />
              <Stop offset="1" stopColor="#07121D" stopOpacity={0.58} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill="url(#glassShade)" />
        </Svg>
        {completed ? (
          <View pointerEvents="none" style={styles.completedMessage} testID="route-completed-windshield-message">
            <Text style={styles.completedMessageText}>MARŠRUTAS BAIGTAS</Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.progressHud}>
          <View style={styles.progressHeading}>
            <Text style={styles.progressLabel}>MARŠRUTO EIGA</Text>
            <Text style={styles.percent}>{Math.round(clamped * 100)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, displayedProgress * 100))}%` }]} />
          </View>
        </View>
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
// indigo, the road stays readable under headlights, and at night a moon gives
// the eye something to land on instead of a flat dark wash.
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
        <RadialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#F4F7FF" stopOpacity={0.55} />
          <Stop offset="0.45" stopColor="#D7E4FF" stopOpacity={0.22} />
          <Stop offset="1" stopColor="#9BB6FF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#sky)" />
      {timeOfDay === 'night' ? (
        <>
          <Circle cx="78" cy="22" r="14" fill="url(#moonGlow)" />
          <Circle cx="78" cy="22" r="6.2" fill="#F7FAFF" opacity={0.92} />
          <Circle cx="80.6" cy="20.2" r="5.4" fill="#0A1430" opacity={0.55} />
          <Circle cx="18" cy="16" r="0.7" fill="#FFFFFF" opacity={0.7} />
          <Circle cx="28" cy="28" r="0.55" fill="#FFFFFF" opacity={0.55} />
          <Circle cx="42" cy="14" r="0.6" fill="#FFFFFF" opacity={0.65} />
          <Circle cx="55" cy="24" r="0.45" fill="#FFFFFF" opacity={0.5} />
          <Circle cx="88" cy="38" r="0.5" fill="#FFFFFF" opacity={0.55} />
        </>
      ) : null}
      {headlights ? <Ellipse cx="50" cy="86" rx="44" ry="22" fill="url(#headlight)" /> : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: cockpitColors.canvas,
  },
  scene: {
    width: '100%',
    height: 146,
    position: 'relative',
    overflow: 'hidden',
  },
  roadImage: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  timeOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  glassOverlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  cloudOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(46, 61, 74, 0.22)' },
  fogOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(230, 235, 232, 0.44)' },
  weatherParticles: { position: 'absolute', inset: 0, overflow: 'hidden' },
  stormOverlay: { backgroundColor: 'rgba(16, 25, 36, 0.25)' },
  rainDrop: { position: 'absolute', width: 2, height: 18, borderRadius: 2, backgroundColor: 'rgba(210, 232, 255, 0.75)', transform: [{ rotate: '18deg' }] },
  snowFlake: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.92)', shadowColor: '#FFFFFF', shadowOpacity: 0.8, shadowRadius: 2 },
  completedMessage: { position: 'absolute', inset: 0, zIndex: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7, 15, 23, 0.5)' },
  completedMessageText: { color: cockpitColors.text, fontFamily: fonts.heading, fontSize: 20, letterSpacing: 1.8, textShadowColor: '#000000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 5 },
  progressHud: { position: 'absolute', left: 18, right: 18, bottom: 12, zIndex: 3, gap: 5 },
  progressHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { color: cockpitColors.textSecondary, fontFamily: fonts.headingSemiBold, fontSize: 9, letterSpacing: 1.2, textShadowColor: '#000000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  progressTrack: { height: 3, overflow: 'hidden', borderRadius: 2, backgroundColor: 'rgba(174, 187, 199, 0.26)' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: cockpitColors.routeBlue },
  percent: { color: cockpitColors.text, fontFamily: fonts.heading, fontSize: 14, letterSpacing: 0.4, textShadowColor: '#000000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
