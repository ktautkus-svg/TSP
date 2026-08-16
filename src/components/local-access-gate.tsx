import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import Svg, { Circle, Path } from 'react-native-svg';

import { LocalAccessService } from '@/application/auth/local-access';
import { LocalAccessContext, type LocalAccessContextValue } from '@/application/auth/local-access-context';
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
import { stitchColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';

type LoginPalette = ReturnType<typeof stitchColorsFor>['login'];

type GateMode = 'bootstrap' | 'login';

export interface LocalAccessGateProps {
  readonly children: ReactNode;
}

export function LocalAccessGate({ children }: LocalAccessGateProps) {
  const db = useSQLiteContext();
  const { colors, scheme } = useTheme();
  const login = stitchColorsFor(scheme).login;
  const styles = useMemo(() => createStyles(colors, login), [colors, login]);
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
  const [pinVisible, setPinVisible] = useState(false);
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

  const logout = useCallback(async () => {
    await logoutEmployee();
    setUnlocked(false);
    setProfile(null);
    setOnline(false);
    setUsername('');
    setDisplayName('');
    setPin('');
    setConfirmPin('');
  }, []);

  /**
   * Memoised so the provider does not hand a fresh object to every consumer on
   * each render of the gate: this context wraps the whole application, so an
   * unstable value re-renders every screen.
   */
  const accessValue = useMemo<LocalAccessContextValue | null>(
    () => (profile ? { username: profile.username, profile, online, logout } : null),
    [logout, online, profile],
  );

  if (loading) return <View style={styles.screen}><ActivityIndicator color={colors.accent} size="large" /></View>;
  if (!unlocked || !profile) {
    const bootstrap = mode === 'bootstrap';
    return (
      <View style={[styles.screen, !bootstrap && styles.loginScreen, bootstrap && styles.bootstrapScreen]} testID={bootstrap ? 'employee-bootstrap-screen' : 'employee-login-screen'}>
        <View style={[styles.brand, !bootstrap && styles.loginBrand]}>
          <TspBrand hero inverse={bootstrap} />
        </View>
        <View style={[styles.card, !bootstrap && styles.loginCard, bootstrap && styles.bootstrapCard]}>
          {bootstrap ? <Text style={styles.title}>Aktyvuoti administratorių</Text> : null}
          {bootstrap ? <Text style={styles.helper}>Aktyvuokite administratoriaus paskyrą „Sensejus“. Pradinį 4–8 skaitmenų PIN vėliau galėsite pakeisti nustatymuose.</Text> : null}
          {bootstrap ? <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Vardas ir pavardė"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            testID="employee-display-name"
          /> : null}
          <View style={styles.field}>
            <Text style={styles.label}>PRISIJUNGIMO VARDAS</Text>
            <View style={!bootstrap ? styles.loginInputShell : undefined}>
              {!bootstrap ? <LoginFieldIcon kind="person" palette={login} /> : null}
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={bootstrap ? 'Vartotojo vardas' : 'Vardas'}
                placeholderTextColor={bootstrap ? colors.textSubtle : login.muted}
                style={[styles.input, !bootstrap && styles.loginInput]}
                testID="login-username"
              />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>PIN KODAS</Text>
            <View style={!bootstrap ? styles.loginInputShell : undefined}>
              {!bootstrap ? <LoginFieldIcon kind="pin" palette={login} /> : null}
              <TextInput
                value={pin}
                onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 8))}
                keyboardType="number-pad"
                secureTextEntry={!pinVisible}
                placeholder="••••"
                placeholderTextColor={bootstrap ? colors.textSubtle : login.muted}
                style={[styles.input, !bootstrap && styles.loginInput]}
                testID="login-pin"
              />
              {!bootstrap ? <Pressable
                accessibilityLabel={pinVisible ? 'Slėpti PIN kodą' : 'Rodyti PIN kodą'}
                accessibilityRole="button"
                onPress={() => setPinVisible((visible) => !visible)}
                style={styles.eyeButton}>
                <LoginFieldIcon kind={pinVisible ? 'eye' : 'eyeOff'} palette={login} />
              </Pressable> : null}
            </View>
          </View>
          {bootstrap ? <TextInput
            value={confirmPin}
            onChangeText={(value) => setConfirmPin(value.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="Pakartokite PIN"
            placeholderTextColor={colors.textSubtle}
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
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
              testID="gateway-device-key"
            />
          </> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={() => void submit()} style={[styles.button, !bootstrap && styles.loginButton, busy && styles.disabled]} testID="login-submit">
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={[styles.buttonText, !bootstrap && styles.loginButtonText]}>{bootstrap ? 'Aktyvuoti ir tęsti' : 'PRISIJUNGTI →'}</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <LocalAccessContext.Provider value={accessValue}>
      {children}
    </LocalAccessContext.Provider>
  );
}

export interface LoginFieldIconProps {
  readonly kind: 'person' | 'pin' | 'eye' | 'eyeOff';
  readonly palette: LoginPalette;
}

function LoginFieldIcon({ kind, palette }: LoginFieldIconProps) {
  const color = palette.muted;
  return <Svg accessibilityLabel="" height={22} viewBox="0 0 24 24" width={22}>
    {kind === 'person' ? <><Circle cx={12} cy={8} fill="none" r={3.5} stroke={color} strokeWidth={1.8} /><Path d="M5 20c.8-4.5 3.2-6.7 7-6.7s6.2 2.2 7 6.7Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /></> : null}
    {kind === 'pin' ? <><Circle cx={7} cy={6} fill={color} r={1.5} /><Circle cx={12} cy={6} fill={color} r={1.5} /><Circle cx={17} cy={6} fill={color} r={1.5} /><Circle cx={7} cy={11} fill={color} r={1.5} /><Circle cx={12} cy={11} fill={color} r={1.5} /><Circle cx={17} cy={11} fill={color} r={1.5} /><Circle cx={7} cy={16} fill={color} r={1.5} /><Circle cx={12} cy={16} fill={color} r={1.5} /><Circle cx={7} cy={21} fill={color} r={1.5} /></> : null}
    {kind === 'eye' ? <><Path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" fill="none" stroke={color} strokeWidth={1.7} /><Circle cx={12} cy={12} fill="none" r={2.5} stroke={color} strokeWidth={1.7} /></> : null}
    {kind === 'eyeOff' ? <><Path d="M3 4.5 21 19.5M6.4 7.3C4 8.7 2.5 12 2.5 12s3.2 5 9.5 5c1.3 0 2.5-.2 3.5-.6M10 7.2c.6-.1 1.3-.2 2-.2 6.3 0 9.5 5 9.5 5s-1.2 1.9-3.5 3.3" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.7} /></> : null}
  </Svg>;
}

const createStyles = (colors: ColorPalette, login: LoginPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.xl },
  loginScreen: { backgroundColor: login.background, gap: 44 },
  bootstrapScreen: { backgroundColor: colors.brandNavy },
  brand: { alignItems: 'center', gap: 2 },
  loginBrand: { marginBottom: spacing.sm },
  card: { width: '100%', maxWidth: 420, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.md },
  loginCard: { maxWidth: 438, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 0, backgroundColor: login.background, gap: spacing.lg },
  bootstrapCard: { padding: spacing.lg },
  title: { ...type.pageTitle, fontSize: 22, lineHeight: 27, color: colors.text },
  helper: { ...type.body, color: colors.textMuted },
  field: { gap: spacing.sm },
  label: { ...type.label, color: login.text },
  loginInputShell: { minHeight: 56, borderWidth: 1, borderColor: login.border, borderRadius: 4, backgroundColor: login.surface, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surface, fontSize: 16, fontFamily: fonts.body },
  loginInput: { flex: 1, minWidth: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', color: login.text, paddingLeft: spacing.sm },
  eyeButton: { minWidth: 48, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  loginButton: { minHeight: 56, borderRadius: 4, borderBottomWidth: 3, borderBottomColor: login.accent, backgroundColor: login.primary },
  buttonText: { ...type.button, fontSize: 16, color: colors.textInverse },
  loginButtonText: { fontSize: 17, letterSpacing: 0.2 },
  error: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: login.error },
  disabled: { opacity: 0.55 },
});
