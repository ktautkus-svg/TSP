import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import Svg, { Path } from 'react-native-svg';

import { LocalAccessService } from '@/application/auth/local-access';
import { LocalAccessContext } from '@/application/auth/local-access-context';
import {
  bootstrapEmployeeAdmin,
  EmployeeClientError,
  employeeServerInitialized,
  getEmployeeSession,
  loginEmployee,
  logoutEmployee,
  type EmployeeProfile,
} from '@/infrastructure/auth/employee-session';
import { pullAssignedRoutes } from '@/application/auth/route-assignment-sync';
import { saveGatewayDeviceSecret } from '@/infrastructure/gateway/device-auth';

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
    const [configuration, initialized, cachedSession] = await Promise.all([
      service.getConfiguration(),
      employeeServerInitialized(),
      getEmployeeSession(),
    ]);
    setConfigured(configuration.configured);
    setUsername(cachedSession?.profile.username ?? configuration.username ?? '');
    setDisplayName(cachedSession?.profile.displayName ?? '');
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
    setPin('');
    setConfirmPin('');
  };

  if (loading) return <View style={styles.screen}><ActivityIndicator color="#87C442" size="large" /></View>;
  if (!unlocked || !profile) {
    const bootstrap = mode === 'bootstrap';
    return (
      <View style={styles.screen} testID={bootstrap ? 'employee-bootstrap-screen' : 'employee-login-screen'}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Svg accessibilityLabel="TSP – Tikslus siuntų pristatymas" width={54} height={38} viewBox="0 0 48 34">
              <Path d="M2 4h39L34 11H9Z" fill="#FFFFFF" />
              <Path d="M9 13h25l-7 7H16Z" fill="#FFFFFF" />
              <Path d="M16 22h12l-6 7Z" fill="#86C440" />
            </Svg>
            <View>
              <Text style={styles.brandName}>TSP</Text>
              <Text style={styles.brandSubtitle}>TIKSLUS SIUNTŲ PRISTATYMAS</Text>
            </View>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>{bootstrap ? 'Aktyvuoti administratorių' : 'Darbuotojo prisijungimas'}</Text>
          <Text style={styles.helper}>{bootstrap
            ? 'Sukurkite pirmą serverio administratorių. PIN turi turėti 6–8 skaitmenis.'
            : 'Prisijunkite darbdavio suteiktu vardu ir PIN. Aktyvus maršrutas vėliau veiks ir be interneto.'}</Text>
          {bootstrap ? <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Vardas ir pavardė"
            placeholderTextColor="#708078"
            style={styles.input}
            testID="employee-display-name"
          /> : null}
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Prisijungimo vardas"
            placeholderTextColor="#708078"
            style={styles.input}
            testID="login-username"
          />
          <TextInput
            value={pin}
            onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="6–8 skaitmenų PIN"
            placeholderTextColor="#708078"
            style={styles.input}
            testID="login-pin"
          />
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
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{bootstrap ? 'Aktyvuoti ir tęsti' : 'Prisijungti'}</Text>}
          </Pressable>
        </View>
        {!bootstrap ? <Text style={styles.deviceNote}>Prisijungimas saugomas šiame įrenginyje. Darbo duomenys lieka SQLite.</Text> : null}
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
  screen: { flex: 1, backgroundColor: '#0E1216', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 },
  brand: { alignItems: 'center', gap: 2 },
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { color: '#FFFFFF', fontSize: 32, lineHeight: 34, fontWeight: '900' },
  brandSubtitle: { color: '#DDE9E1', fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.7 },
  card: { width: '100%', maxWidth: 420, padding: 22, borderRadius: 22, backgroundColor: '#FFFFFF', gap: 14 },
  title: { color: '#102019', fontSize: 25, fontWeight: '900' },
  helper: { color: '#5D6B64', lineHeight: 21 },
  input: { minHeight: 54, borderWidth: 1, borderColor: '#CAD2CD', borderRadius: 14, paddingHorizontal: 16, color: '#102019', backgroundColor: '#FFFFFF', fontSize: 17 },
  button: { minHeight: 56, borderRadius: 15, backgroundColor: '#075B36', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  error: { color: '#B42318', fontWeight: '700', lineHeight: 20 },
  disabled: { opacity: 0.55 },
  deviceNote: { color: '#9AA59F', textAlign: 'center', fontSize: 13 },
});
