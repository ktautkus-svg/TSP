import { colors as appColors } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

/** Quality-control variant of the current red/blue TSP identity. */
export const qualityControlColors: ColorPalette = {
  ...appColors,
  background: '#FBF9F8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F0EEED',
  surfaceSubtle: '#F8F6F5',
  text: '#1B1C1C',
  textSecondary: '#49464D',
  textMuted: '#777680',
  textSubtle: '#96929B',
  border: '#DDD8D6',
  borderSubtle: '#EEEAE8',
  borderStrong: '#C7C5D0',
  primary: '#15174C',
  primaryDark: '#0D0F38',
  primarySoft: '#EDEDF7',
  info: '#1D4ED8',
  infoSoft: '#E9EEFF',
  actionRoute: '#1D4ED8',
  actionRoutePressed: '#153AA5',
  success: '#198754',
  accent: '#198754',
  accentSoft: '#E8F4ED',
  warning: '#A96000',
  warningSoft: '#FFF2DC',
  danger: '#BA1A1A',
  dangerSoft: '#FDECEA',
  brandNavy: '#15174C',
  brandWordmarkBlue: '#174A88',
  brandWordmarkGreen: '#A73835',
  brandWordmarkGreenLight: '#C8504C',
};

export const qualityBrandRed = '#A73835';
