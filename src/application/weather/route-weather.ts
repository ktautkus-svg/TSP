import type { SQLiteDatabase } from 'expo-sqlite';
import { devWarn } from '@/ui/dev-log';

export type RouteWeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';
export type RouteTimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export type RouteWeatherScene = {
  condition: RouteWeatherCondition;
  timeOfDay: RouteTimeOfDay;
  observedAt: string;
  latitude: number;
  longitude: number;
};

type OpenMeteoCurrent = {
  weather_code?: number;
  is_day?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
};

const CACHE_KEY = 'route_weather_snapshot_v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

export function routeTimeOfDay(date = new Date(), isDay?: number): RouteTimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 18 && hour < 21) return 'dusk';
  if (isDay === 0 || hour < 5 || hour >= 21) return 'night';
  return 'day';
}

export function routeWeatherCondition(current: OpenMeteoCurrent): RouteWeatherCondition {
  const code = current.weather_code ?? 0;
  if (code >= 95) return 'storm';
  if ((current.snowfall ?? 0) > 0 || (code >= 71 && code <= 86)) return 'snow';
  if ((current.rain ?? 0) > 0 || (current.showers ?? 0) > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 1 && code <= 3) return 'cloudy';
  return 'clear';
}

export function fallbackRouteWeatherScene(
  latitude: number,
  longitude: number,
  now = new Date(),
): RouteWeatherScene {
  return {
    condition: 'clear',
    timeOfDay: routeTimeOfDay(now),
    observedAt: now.toISOString(),
    latitude,
    longitude,
  };
}

export async function loadRouteWeatherScene(
  db: SQLiteDatabase,
  latitude: number,
  longitude: number,
  now = new Date(),
): Promise<RouteWeatherScene> {
  let cached: RouteWeatherScene | null = null;
  try {
    cached = await readCachedScene(db);
  } catch (error) {
    devWarn('ROUTE_WEATHER_CACHE_READ_FAILED', error);
  }
  const freshEnough = cached
    && now.getTime() - new Date(cached.observedAt).getTime() < CACHE_TTL_MS
    && Math.abs(cached.latitude - latitude) < 0.25
    && Math.abs(cached.longitude - longitude) < 0.25;
  if (cached && freshEnough) return { ...cached, timeOfDay: routeTimeOfDay(now), observedAt: now.toISOString() };

  try {
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'weather_code,is_day,rain,showers,snowfall',
      timezone: 'auto',
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`WEATHER_HTTP_${response.status}`);
    const payload = await response.json() as { current?: OpenMeteoCurrent };
    const current = payload.current ?? {};
    const scene: RouteWeatherScene = {
      condition: routeWeatherCondition(current),
      timeOfDay: routeTimeOfDay(now, current.is_day),
      observedAt: now.toISOString(),
      latitude,
      longitude,
    };
    await db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      CACHE_KEY,
      JSON.stringify(scene),
      scene.observedAt,
    );
    return scene;
  } catch (error) {
    devWarn('ROUTE_WEATHER_REFRESH_FAILED', error);
    if (cached) return { ...cached, timeOfDay: routeTimeOfDay(now), observedAt: now.toISOString() };
    return fallbackRouteWeatherScene(latitude, longitude, now);
  }
}

async function readCachedScene(db: SQLiteDatabase): Promise<RouteWeatherScene | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_preferences WHERE key = ?',
    CACHE_KEY,
  );
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as RouteWeatherScene;
    if (!parsed.observedAt || !Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
    return parsed;
  } catch {
    return null;
  }
}
