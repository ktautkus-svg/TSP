import type { colors as lightColors } from '@/ui/tokens';

export type ColorPalette = Record<keyof typeof lightColors, string>;
export type ResolvedScheme = 'light' | 'dark';

/** Mirrors the light palette's roles on neutral charcoal rather than green-black. */
export const darkColors: ColorPalette = {
  background: '#10161B',
  surface: '#182129',
  surfaceElevated: '#1C2730',
  surfaceMuted: '#22303A',
  surfaceSubtle: '#141C22',
  text: '#F0F4F7',
  textSecondary: '#C3CED6',
  textMuted: '#94A4B0',
  textSubtle: '#788995',
  textDisabled: '#6D7B85',
  textInverse: '#FFFFFF',
  border: '#2C3B46',
  borderSubtle: '#23313B',
  borderStrong: '#40515E',

  primary: '#48A876',
  primaryDark: '#123825',
  primarySoft: '#172B22',

  accent: '#55B784',
  accentSoft: '#172C23',
  accentStrong: '#83D2A5',
  success: '#55B784',

  warning: '#E0A44B',
  warningSoft: '#2B2417',
  danger: '#E4695E',
  dangerSoft: '#2C1B19',
  info: '#74B0D8',
  infoSoft: '#172936',

  actionPrimary: '#357DA8',
  actionPrimaryPressed: '#2A668B',
  actionRoute: '#3C87B4',
  actionRoutePressed: '#2F6E94',
  disabledSurface: '#29343C',
  disabledText: '#7B8993',

  brandNavy: '#101E26',
};
