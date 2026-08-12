import type { colors as lightColors } from '@/ui/tokens';

export type ColorPalette = Record<keyof typeof lightColors, string>;
export type ResolvedScheme = 'light' | 'dark';

/** Mirrors the light palette's roles; greens are lifted for contrast on dark. */
export const darkColors: ColorPalette = {
  background: '#101512',
  surface: '#18201B',
  surfaceElevated: '#1D2620',
  surfaceMuted: '#1F2822',
  surfaceSubtle: '#151C18',
  text: '#EDF1EE',
  textSecondary: '#C7D0CA',
  textMuted: '#9AA69E',
  textSubtle: '#7A857E',
  textDisabled: '#6F7972',
  textInverse: '#FFFFFF',
  border: '#2C3830',
  borderSubtle: '#253029',
  borderStrong: '#3D4A42',

  primary: '#3E9E68',
  primaryDark: '#0E2E1D',
  primarySoft: '#16291E',

  accent: '#4FB07A',
  accentSoft: '#16291E',
  accentStrong: '#7CC79A',
  success: '#4FB07A',

  warning: '#E0A44B',
  warningSoft: '#2A2317',
  danger: '#E4695E',
  dangerSoft: '#2C1B19',
  info: '#6FA3D6',
  infoSoft: '#182430',

  actionPrimary: '#3E9E68',
  actionPrimaryPressed: '#2D7D50',
  actionRoute: '#6FA3D6',
  actionRoutePressed: '#5689BB',
  disabledSurface: '#2A332D',
  disabledText: '#7F8A83',

  brandNavy: '#0E2E1D',
  brandWordmarkBlue: '#6FA3D6',
  brandWordmarkGreen: '#4FB07A',
  brandWordmarkGreenLight: '#7CC79A',
};
