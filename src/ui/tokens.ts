import { Platform } from 'react-native';

/**
 * TSP design system.
 *
 * Colour rules this palette exists to enforce:
 * - ink and cool slate carry structure, surfaces, borders, and text;
 * - route blue carries planning, navigation, and primary operational actions;
 * - green is reserved for brand punctuation, success, and positive progress;
 * - amber means "check this", red means "this is wrong", blue means "this is
 *   information" — none of them are used just to add colour.
 *
 * If a screen needs a colour that is not here, that is a sign the screen is
 * decorating rather than communicating.
 */
export const colors = {
  // Neutrals
  background: '#F3F6F8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EAF0F4',
  surfaceSubtle: '#F7F9FB',
  text: '#17232D',
  textSecondary: '#41515E',
  textMuted: '#657582',
  textSubtle: '#8996A0',
  textDisabled: '#9AA6AF',
  textInverse: '#FFFFFF',
  border: '#D7E0E7',
  borderSubtle: '#E7EDF1',
  borderStrong: '#BCC9D2',

  // Brand green — punctuation and identity, not universal interface chrome.
  primary: '#187447',
  primaryDark: '#0E4E31',
  primarySoft: '#E8F3ED',

  // Accent green: success and positive status only.
  accent: '#218052',
  accentSoft: '#E6F3EB',
  accentStrong: '#115B39',
  success: '#218052',

  // Semantic — each has exactly one meaning.
  warning: '#9A6110',
  warningSoft: '#FFF4DE',
  danger: '#B63B32',
  dangerSoft: '#FCF0EE',
  info: '#276C98',
  infoSoft: '#EAF3F9',

  // Interaction roles. These aliases make intent explicit at call sites and
  // allow the brand and operational actions to evolve independently later.
  actionPrimary: '#1F5F86',
  actionPrimaryPressed: '#174A69',
  actionRoute: '#176F9F',
  actionRoutePressed: '#115778',
  disabledSurface: '#E3E9ED',
  disabledText: '#7D8B95',

  /** Header/chrome surface. Kept as its own key because it is brand, not action. */
  brandNavy: '#142832',
} as const;

/**
 * Active-route instrument palette.
 *
 * This is deliberately separate from the application theme: the driver
 * dashboard is a focused cockpit surface, while route planning, settings and
 * stop management remain bright working areas. Blue communicates movement and
 * navigation; green is kept for successful delivery states only.
 */
export const cockpitColors = {
  canvas: '#080D13',
  panel: '#0E1620',
  panelElevated: '#141F2B',
  panelSoft: '#1A2734',
  glass: '#101A24',
  metal: '#758595',
  metalSoft: '#344351',
  border: '#2A3947',
  text: '#F7FAFC',
  textSecondary: '#AEBBC7',
  textMuted: '#7F8E9B',
  routeBlue: '#4DA3D5',
  routeBlueStrong: '#2379AA',
  routeBlueSoft: '#17344A',
  success: '#2F7D58',
  danger: '#B54A45',
  warning: '#D9A34A',
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
  maxOperationalWidth: 1180,
  minTouchTarget: 48,
} as const;
