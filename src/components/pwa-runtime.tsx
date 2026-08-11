import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PWA_SERVICE_WORKER_VERSION_KEY } from '@/pwa/runtime';
import { radius, spacing, type } from '@/ui/tokens';
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
  host: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: `max(68px, env(safe-area-inset-bottom))` as unknown as number, zIndex: 1000, gap: spacing.sm, alignItems: 'center' },
  offline: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft, justifyContent: 'center' },
  offlineText: { ...type.secondaryStrong, color: colors.warning, textAlign: 'center' },
  update: { width: '100%', maxWidth: 420, padding: spacing.sm, paddingLeft: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, shadowColor: colors.text, shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  updateText: { ...type.secondaryStrong, color: colors.textInverse, flex: 1 },
  button: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.actionRoute, justifyContent: 'center' },
  buttonText: { ...type.secondaryStrong, color: colors.textInverse },
});
