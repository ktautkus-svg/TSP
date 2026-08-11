import { Platform } from 'react-native';

/**
 * TSP design system.
 *
 * Colour rules this palette exists to enforce:
 * - one dark brand green (`primary`) carries brand and primary actions;
 * - one lighter green (`accent`) is the only other green, used for success and
 *   positive status — never as decoration;
 * - neutrals carry everything else: surfaces, borders, secondary text;
 * - amber means "check this", red means "this is wrong", blue means "this is
 *   information" — none of them are used just to add colour.
 *
 * If a screen needs a colour that is not here, that is a sign the screen is
 * decorating rather than communicating.
 */
export const colors = {
  // Neutrals
  background: '#F5F6F5',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F0F2F0',
  surfaceSubtle: '#F8F9F8',
  text: '#17251D',
  textSecondary: '#46534C',
  textMuted: '#65716A',
  textSubtle: '#8A948D',
  textDisabled: '#9CA59F',
  textInverse: '#FFFFFF',
  border: '#DCE2DD',
  borderSubtle: '#E9EDEA',
  borderStrong: '#C3CCC6',

  // Brand green — one dark, one deeper for headers/pressed, one soft wash.
  primary: '#0A5A31',
  primaryDark: '#07351E',
  primarySoft: '#E7F0EA',

  // Single accent green: success and positive status only.
  accent: '#1F7A46',
  accentSoft: '#E7F2E9',
  accentStrong: '#07351E',
  success: '#1F7A46',

  // Semantic — each has exactly one meaning.
  warning: '#9A6212',
  warningSoft: '#FDF3E2',
  danger: '#B4342A',
  dangerSoft: '#FCF0EE',
  info: '#2F5D8C',
  infoSoft: '#EDF2F8',

  // Interaction roles. These aliases make intent explicit at call sites and
  // allow the brand and operational actions to evolve independently later.
  actionPrimary: '#0A5A31',
  actionPrimaryPressed: '#073F24',
  actionRoute: '#2F5D8C',
  actionRoutePressed: '#244A70',
  disabledSurface: '#E7EAE8',
  disabledText: '#7D8881',

  /** Header/chrome surface. Kept as its own key because it is brand, not action. */
  brandNavy: '#07351E',
} as const;

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  heading: 'Archivo_700Bold',
  headingExtraBold: 'Archivo_800ExtraBold',
  headingSemiBold: 'Archivo_600SemiBold',
  bodyMedium: 'Archivo_500Medium',
  body: 'Archivo_400Regular',
} as const;

/**
 * Type scale. Weight is part of the step, so a screen picks a role rather than
 * inventing a size/weight pair — which is how everything ended up bold.
 */
export const type = {
  pageTitle: { fontSize: 26, fontFamily: fonts.heading, lineHeight: 32 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.headingSemiBold, lineHeight: 22 },
  cardTitle: { fontSize: 15, fontFamily: fonts.headingSemiBold, lineHeight: 20 },
  body: { fontSize: 15, fontFamily: fonts.body, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontFamily: fonts.bodyMedium, lineHeight: 21 },
  secondary: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18 },
  secondaryStrong: { fontSize: 13, fontFamily: fonts.bodyMedium, lineHeight: 18 },
  meta: { fontSize: 12, fontFamily: fonts.body, lineHeight: 16 },
  /** All-caps micro label above a value. */
  label: { fontSize: 11, fontFamily: fonts.headingSemiBold, lineHeight: 14, letterSpacing: 0.5 },
  /** Numeric readouts that should line up in columns. */
  readout: { fontSize: 20, fontFamily: fonts.heading, lineHeight: 25 },
  button: { fontSize: 15, fontFamily: fonts.headingSemiBold, lineHeight: 20 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
} as const;

/** Four steps, so one screen never mixes six different corner sizes. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const layout = {
  maxContentWidth: 900,
  minTouchTarget: 48,
} as const;
