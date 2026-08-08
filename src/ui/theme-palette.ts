import type { colors as lightColors } from '@/ui/tokens';

export type ColorPalette = Record<keyof typeof lightColors, string>;
export type ResolvedScheme = 'light' | 'dark';

export const darkColors: ColorPalette = {
  background: '#14171C',
  surface: '#1D2129',
  text: '#F2F3F5',
  textMuted: '#8A8F98',
  primary: '#2ED191',
  primarySoft: '#16302A',
  success: '#2ED191',
  warning: '#F2A93C',
  danger: '#F0453F',
  info: '#4FA3F7',
  border: '#2A2F3A',
  accent: '#46b250',
  accentSoft: '#18361a',
  accentStrong: '#2f9f3d',
  brandNavy: '#003306',
};
