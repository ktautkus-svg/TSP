import { Platform } from 'react-native';

export const colors = {
  background: '#F4F4EF',
  surface: '#FFFFFF',
  text: '#112019',
  textMuted: '#66736B',
  primary: '#0B4A2B',
  primarySoft: '#E6F0E9',
  success: '#177245',
  warning: '#A45C00',
  danger: '#B42318',
  info: '#1D6FE0',
  border: '#DDE3DE',
  // TSP delivery-screen palette, converted from the original mockup tokens.
  accent: '#0A5A31',
  accentSoft: '#E7F2E9',
  accentStrong: '#063A21',
  brandNavy: '#072D1B',
} as const;

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  heading: 'Archivo_700Bold',
  headingExtraBold: 'Archivo_800ExtraBold',
  headingSemiBold: 'Archivo_600SemiBold',
  body: 'Archivo_400Regular',
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
