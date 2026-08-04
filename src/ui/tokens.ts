import { Platform } from 'react-native';

export const colors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  text: '#17202A',
  textMuted: '#697386',
  primary: '#176B5B',
  primarySoft: '#E6F2EF',
  success: '#1C7C54',
  warning: '#A45C00',
  danger: '#B42318',
  info: '#1D6FE0',
  border: '#DDE1E7',
} as const;

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
} as const;

export const layout = {
  maxContentWidth: 900,
  minTouchTarget: 48,
} as const;
