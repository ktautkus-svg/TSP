import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { LocalAccessService } from '@/application/auth/local-access';
import { LocalAccessContext } from '@/application/auth/local-access-context';
import {
  bootstrapEmployeeAdmin,
  EmployeeClientError,
  employeeServerInitialized,
  getEmployeeSession,
  loginEmployee,
  logoutEmployee,
  refreshEmployeeSession,
  type EmployeeProfile,
} from '@/infrastructure/auth/employee-session';
import { pullAssignedRoutes } from '@/application/auth/route-assignment-sync';
import { saveGatewayDeviceSecret } from '@/infrastructure/gateway/device-auth';
import { TspBrand } from '@/components/tsp-brand';
import { colors, fonts, radius, spacing, type } from '@/ui/tokens';

type GateMode = 'bootstrap' | 'login';

export function LocalAccessGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const service = useMemo(() => new LocalAccessService(db), [db]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<GateMode>('login');
  const [unlocked, setUnlocked] = useState(false);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [online, setOnline] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [deviceKey, setDeviceKey] = useState('');
  const [needsDeviceKey, setNeedsDeviceKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [configuration, initialized, storedSession] = await Promise.all([
      service.getConfiguration(),
      employeeServerInitialized(),
      getEmployeeSession(),
    ]);
    let cachedSession = storedSession;
    if (storedSession && initialized !== null) {
      try { cachedSession = await refreshEmployeeSession(); } catch { /* Offline or expired server session: keep the explicit local session. */ }
    }
    setConfigured(configuration.configured);
    setUsername(cachedSession?.profile.username ?? configuration.username ?? (initialized === false ? 'sensejus' : ''));
    setDisplayName(cachedSession?.profile.displayName ?? (initialized === false ? 'Sensejus' : ''));
    setProfile(cachedSession?.profile ?? null);
    setUnlocked(Boolean(cachedSession));
    setOnline(Boolean(cachedSession && initialized !== null));
    setMode(initialized === false && !cachedSession ? 'bootstrap' : 'login');
    if (initialized === null && !configuration.configured) {
      setError('Pirmam prisijungimui reikia interneto ryšio.');
    }
    setLoading(false);
    if (cachedSession) {
      void pullAssignedRoutes(db, cachedSession.profile).catch((reason) => {
        if (__DEV__) console.warn('ASSIGNMENT_PULL_FAILED', reason);
      });
    }
  }, [db, service]);

  useEffect(() => { void refresh().catch((reason) => {
    setError(reason instanceof Error ? reason.message : 'Prisijungimo būsenos atkurti nepavyko.');
    setLoading(false);
  }); }, [refresh]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (pin !== confirmPin && mode === 'bootstrap') throw new Error('Pakartotas PIN nesutampa.');
      let session;
      if (mode === 'bootstrap') {
        if (deviceKey.trim()) await saveGatewayDeviceSecret(deviceKey);
        session = await bootstrapEmployeeAdmin({ username, displayName: displayName || username, pin });
        await service.syncServerCredentials(session.profile.username, pin);
        setOnline(true);
      } else {
        try {
          session = await loginEmployee(username, pin);
          await service.syncServerCredentials(session.profile.username, pin);
          setOnline(true);
        } catch (reason) {
          if (reason instanceof EmployeeClientError) throw reason;
          const cached = await getEmployeeSession();
          if (!configured || !cached || !await service.verify(username, pin)) throw reason;
          session = cached;
          setOnline(false);
        }
      }
      setProfile(session.profile);
      setUsername(session.profile.username);
      setPin('');
      setConfirmPin('');
      setDeviceKey('');
      setNeedsDeviceKey(false);
      setUnlocked(true);
      void pullAssignedRoutes(db, session.profile).catch((reason) => {
        if (__DEV__) console.warn('ASSIGNMENT_PULL_FAILED', reason);
      });
    } catch (reason) {
      if (reason instanceof EmployeeClientError && reason.code === 'DEVICE_KEY_REQUIRED') {
        setNeedsDeviceKey(true);
      }
      setError(reason instanceof Error ? reason.message : 'Prisijungti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await logoutEmployee();
    setUnlocked(false);
    setProfile(null);
    setOnline(false);
    setUsername('');
    setDisplayName('');
    setPin('');
    setConfirmPin('');
  };

  if (loading) return <View style={styles.screen}><ActivityIndicator color={colors.accent} size="large" /></View>;
  if (!unlocked || !profile) {
    const bootstrap = mode === 'bootstrap';
    return (
      <View style={[styles.screen, bootstrap && styles.bootstrapScreen]} testID={bootstrap ? 'employee-bootstrap-screen' : 'employee-login-screen'}>
        <View style={styles.brand}>
          <TspBrand hero inverse={bootstrap} />
        </View>
        <View style={[styles.card, bootstrap && styles.bootstrapCard]}>
          <Text style={[styles.title, !bootstrap && styles.loginTitle]}>{bootstrap ? 'Aktyvuoti administratorių' : 'Prisijungti'}</Text>
          {bootstrap ? <Text style={styles.helper}>Aktyvuokite administratoriaus paskyrą „Sensejus“. Pradinį 4–8 skaitmenų PIN vėliau galėsite pakeisti nustatymuose.</Text> : null}
          {bootstrap ? <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Vardas ir pavardė"
            placeholderTextColor="#708078"
            style={styles.input}
            testID="employee-display-name"
          /> : null}
          <View style={styles.field}>
            <Text style={styles.label}>PRISIJUNGIMO VARDAS</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Vartotojo vardas"
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
              testID="login-username"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>PIN KODAS</Text>
            <TextInput
              value={pin}
              onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 8))}
              keyboardType="number-pad"
              secureTextEntry
              placeholder="•••••"
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
              testID="login-pin"
            />
          </View>
          {bootstrap ? <TextInput
            value={confirmPin}
            onChangeText={(value) => setConfirmPin(value.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="Pakartokite PIN"
            placeholderTextColor="#708078"
            style={styles.input}
            testID="login-pin-confirm"
          /> : null}
          {bootstrap && needsDeviceKey ? <>
            <Text style={styles.helper}>Šiam įrenginiui dar reikia vienkartinio aktyvavimo rakto. Įklijuokite administratoriaus pateiktą raktą.</Text>
            <TextInput
              value={deviceKey}
              onChangeText={setDeviceKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="Įrenginio aktyvavimo raktas"
              placeholderTextColor="#708078"
              style={styles.input}
              testID="gateway-device-key"
            />
          </> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={() => void submit()} style={[styles.button, busy && styles.disabled]} testID="login-submit">
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buttonText}>{bootstrap ? 'Aktyvuoti ir tęsti' : 'Prisijungti'}</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <LocalAccessContext.Provider value={{
      username: profile.username,
      profile,
      online,
      logout,
    }}>
      {children}
    </LocalAccessContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.xl },
  bootstrapScreen: { backgroundColor: colors.brandNavy },
  brand: { alignItems: 'center', gap: 2 },
  card: { width: '100%', maxWidth: 420, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.md },
  bootstrapCard: { padding: spacing.lg },
  title: { ...type.pageTitle, fontSize: 22, lineHeight: 27, color: colors.text },
  loginTitle: { textAlign: 'center', marginBottom: spacing.sm },
  helper: { ...type.body, color: colors.textMuted },
  field: { gap: spacing.sm },
  label: { ...type.label, color: colors.textSecondary },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surface, fontSize: 16, fontFamily: fonts.body },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, fontSize: 16, color: colors.textInverse },
  error: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.danger },
  disabled: { opacity: 0.55 },
});
