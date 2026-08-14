import { StatusBar } from 'expo-status-bar';
import { Link, Stack, usePathname, useRouter, type Href } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  useFonts,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';

import { PwaRuntime } from '@/components/pwa-runtime';
import { LocalAccessGate } from '@/components/local-access-gate';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { StackBrandTitle } from '@/components/stack-brand-title';
import { RouteCloudSyncProvider } from '@/application/sync/route-cloud-sync-context';
import { migrateDatabase } from '@/database/migrations';
import { ThemeProvider } from '@/ui/theme';
import { AlertHost } from '@/ui/alert';
import { colors, fonts, radius, type } from '@/ui/tokens';
import { useLocalAccess } from '@/application/auth/local-access-context';

function RoleAccessBoundary({ children }: { children: ReactNode }) {
  const { profile } = useLocalAccess();
  const pathname = usePathname();
  const router = useRouter();
  const adminOnly = pathname === '/admin'
    || pathname === '/dispatcher'
    || pathname.startsWith('/import')
    || pathname === '/route/new';
  const routePlanning = /\/route\/[^/]+\/(review|alternatives)$/.test(pathname);
  const driverCanPlan = Boolean(profile.permissions?.canCreateRoutes || profile.permissions?.canReorderAssignedRoute);
  const qualityAllowed = pathname === '/' || pathname === '/quality-control';
  const blocked = (profile.role === 'driver' && (adminOnly || (routePlanning && !driverCanPlan)))
    || (profile.role === 'quality' && !qualityAllowed);
  useEffect(() => {
    if (blocked) router.replace('/' as Href);
  }, [blocked, router]);
  return blocked ? null : children;
}

/** Shared by the two full-screen failure states below. */
const failureStyles = {
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background } as const,
  title: { ...type.pageTitle, fontSize: 21, color: colors.text, marginBottom: 12, textAlign: 'center' } as const,
  body: { ...type.body, color: colors.textMuted, textAlign: 'center', marginBottom: 24 } as const,
  button: { minHeight: 48, backgroundColor: colors.primary, paddingHorizontal: 24, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' } as const,
  buttonText: { ...type.button, color: colors.textInverse } as const,
};

void SplashScreen.preventAutoHideAsync().catch((reason) => {
  if (__DEV__) console.warn('SPLASH_PREVENT_HIDE_FAILED', reason);
});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={failureStyles.screen}>
      <Text style={failureStyles.title}>Įvyko netikėta klaida</Text>
      <Text style={failureStyles.body}>
        {error?.message || 'Nepavyko užkrauti aplikacijos duomenų arba nepasiekiama vietinė atmintis.'}
      </Text>
      <Pressable style={failureStyles.button} onPress={() => void retry()}>
        <Text style={failureStyles.buttonText}>Bandyti iš naujo</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [dbError, setDbError] = useState<Error | null>(null);
  const [fontsLoaded, fontsError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
  });

  useEffect(() => {
    if (!fontsLoaded && !fontsError) return;
    void SplashScreen.hideAsync().catch((reason) => {
      if (__DEV__) console.warn('SPLASH_HIDE_FAILED', reason);
    });
  }, [fontsLoaded, fontsError]);

  if (!fontsLoaded && !fontsError) {
    return null;
  }

  if (dbError) {
    return (
      <View style={failureStyles.screen}>
        <Text style={failureStyles.title}>Aplikacijos atmintis laikinai nepasiekiama</Text>
        <Text style={failureStyles.body}>
          {dbError.message || 'Nepavyko paruošti vietinės SQLite duomenų bazės. Tai gali nutikti naršyklės privačiame režime arba ribojant atmintį.'}
        </Text>
        <Pressable
          style={failureStyles.button}
          onPress={() => {
            if (typeof window !== 'undefined' && window.location?.reload) {
              window.location.reload();
            } else {
              setDbError(null);
            }
          }}>
          <Text style={failureStyles.buttonText}>Perkrauti puslapį</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SQLiteProvider
      databaseName="deliveries.db"
      onInit={migrateDatabase}
      onError={(error) => {
        if (__DEV__) console.warn('SQLite DB init error:', error);
        setDbError(error instanceof Error ? error : new Error('Vietinės bazės klaida: ' + String(error)));
      }}>
      <ThemeProvider>
        <LocalAccessGate>
          <RouteCloudSyncProvider>
            <AlertHost />
            <PwaRuntime />
            <StatusBar style="dark" />
            <RoleAccessBoundary>
            <Stack
              screenOptions={{
                headerShadowVisible: false,
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.brandNavy,
                headerTitle: ({ children }) => <StackBrandTitle title={children} />,
                contentStyle: { backgroundColor: colors.background },
                headerRight: () => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <CloudSyncStatus compact />
                    <Link href="/" replace asChild>
                      <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Text style={{ ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.brandNavy }}>Pradžia</Text>
                      </Pressable>
                    </Link>
                  </View>
                ),
              }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="route/new" options={{ title: 'Naujas maršrutas' }} />
              <Stack.Screen name="import/index" options={{ title: 'Dokumentų importas' }} />
              <Stack.Screen name="route/[id]/review" options={{ title: 'Patikra ir planavimas' }} />
              <Stack.Screen name="route/[id]/overview" options={{ title: 'Maršruto informacija' }} />
              <Stack.Screen name="route/[id]/alternatives" options={{ title: 'Maršruto variantai' }} />
              <Stack.Screen name="route/[id]/loading" options={{ title: 'Krovimasis' }} />
              <Stack.Screen name="route/[id]/delivery" options={{ title: 'Pristatymai' }} />
              <Stack.Screen name="route/[id]/result" options={{ title: 'Maršruto rezultatas' }} />
              <Stack.Screen name="history" options={{ title: 'Maršrutai' }} />
              <Stack.Screen name="history/[id]" options={{ title: 'Maršruto rezultatas' }} />
              <Stack.Screen name="settings/index" options={{ title: 'Nustatymai' }} />
              <Stack.Screen name="settings/locations" options={{ title: 'Numatytosios vietos' }} />
              <Stack.Screen name="statistics" options={{ title: 'Statistika' }} />
              <Stack.Screen name="trip-sheet" options={{ title: 'Kelionės lapas' }} />
              <Stack.Screen name="fuel" options={{ title: 'Degalai' }} />
              <Stack.Screen name="vehicle" options={{ title: 'Transporto priemonė' }} />
              <Stack.Screen name="admin" options={{ title: 'Administratoriaus panelė' }} />
              <Stack.Screen name="dispatcher" options={{ title: 'Dispečerio skydelis' }} />
              <Stack.Screen name="quality-control" options={{ title: 'Kokybės kontrolė' }} />
              <Stack.Screen name="execute-route" options={{ title: 'Vykdyti maršrutą' }} />
            </Stack>
            </RoleAccessBoundary>
          </RouteCloudSyncProvider>
        </LocalAccessGate>
      </ThemeProvider>
    </SQLiteProvider>
  );
}
