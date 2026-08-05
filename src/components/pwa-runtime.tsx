import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PWA_SERVICE_WORKER_VERSION_KEY } from '@/pwa/runtime';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export function PwaRuntime() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const refreshRequested = useRef(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    setOnline(navigator.onLine);
    const onlineListener = () => setOnline(true);
    const offlineListener = () => setOnline(false);
    const messageListener = (event: MessageEvent) => {
      if (event.data?.type === 'SW_VERSION' && typeof event.data.version === 'string') {
        window.localStorage.setItem(PWA_SERVICE_WORKER_VERSION_KEY, event.data.version);
      }
    };
    const controllerListener = () => {
      if (refreshRequested.current) window.location.reload();
    };
    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);
    navigator.serviceWorker.addEventListener('message', messageListener);
    navigator.serviceWorker.addEventListener('controllerchange', controllerListener);
    void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).then((current) => {
      registration.current = current;
      if (current.waiting) setUpdateReady(true);
      current.addEventListener('updatefound', () => {
        const installing = current.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
        });
      });
      navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' });
    }).catch((reason) => {
      if (__DEV__) console.warn('PWA_SERVICE_WORKER_REGISTRATION_FAILED', reason);
    });
    return () => {
      window.removeEventListener('online', onlineListener);
      window.removeEventListener('offline', offlineListener);
      navigator.serviceWorker.removeEventListener('message', messageListener);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerListener);
    };
  }, []);

  const refresh = async () => {
    try {
      await db.execAsync('PRAGMA wal_checkpoint(PASSIVE)');
      refreshRequested.current = true;
      if (registration.current?.waiting) {
        registration.current.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    } catch (reason) {
      if (__DEV__) console.warn('PWA_UPDATE_CHECKPOINT_FAILED', reason);
    }
  };

  if (Platform.OS !== 'web' || (online && !updateReady)) return null;
  return (
    <View style={styles.host} pointerEvents="box-none">
      {!online ? (
        <View style={styles.offline} accessibilityRole="alert" pointerEvents="none">
          <Text style={styles.offlineText}>Veikiama neprisijungus</Text>
        </View>
      ) : null}
      {updateReady ? (
        <View style={styles.update} accessibilityRole="alert" pointerEvents="box-none">
          <Text style={styles.updateText}>Yra nauja aplikacijos versija</Text>
          <Pressable onPress={() => { void refresh(); }} style={styles.button}>
            <Text style={styles.buttonText}>Atnaujinti</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  host: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: `max(${spacing.md}px, env(safe-area-inset-bottom))` as unknown as number, zIndex: 1000, gap: spacing.sm },
  offline: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 14, backgroundColor: '#FFF3CD', justifyContent: 'center' },
  offlineText: { color: '#6B4F00', fontWeight: '800', textAlign: 'center' },
  update: { padding: spacing.md, borderRadius: 16, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  updateText: { color: '#fff', fontWeight: '800', flex: 1 },
  button: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '800' },
});
