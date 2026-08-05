import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { colors as lightColors } from '@/ui/tokens';
import { darkColors, type ColorPalette, type ResolvedScheme } from '@/ui/theme-palette';
import { ThemePreference, type ThemeMode } from '@/application/settings/theme-preference';

export { darkColors };
export type { ColorPalette, ResolvedScheme };

type ThemeContextValue = {
  colors: ColorPalette;
  scheme: ResolvedScheme;
  preference: ThemeMode;
  setPreference: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemeMode>('system');

  useEffect(() => {
    let cancelled = false;
    void new ThemePreference(db).get().then((stored) => {
      if (!cancelled) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const scheme: ResolvedScheme = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
  const palette = scheme === 'dark' ? darkColors : lightColors;

  function setPreference(mode: ThemeMode) {
    setPreferenceState(mode);
    void new ThemePreference(db).save(mode);
  }

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: palette, scheme, preference, setPreference }),
    [palette, scheme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme turi būti naudojamas ThemeProvider viduje.');
  return ctx;
}
