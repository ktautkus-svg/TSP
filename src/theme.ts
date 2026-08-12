import { colors, fonts, layout, radius, spacing, type } from '@/ui/tokens';

/** Tokens extracted from the approved light Stitch cockpit direction. */
export const stitchCockpitTheme = {
  source: {
    projectId: '4254015951552755895',
    referenceScreenId: '0327c9e0a94a4b11b66737ae0f5a1b9b',
    approvedCompositionScreenId: '0615aa8699504079b4e6ea9eb212d042',
  },
  colors: {
    background: '#F9F9FF',
    surface: '#FFFFFF',
    surfaceMuted: '#F0F3FF',
    surfaceContainer: '#E7EEFF',
    surfaceContainerHigh: '#DEE8FF',
    surfaceContainerHighest: '#D8E3FB',
    surfaceDim: '#CFDAF2',
    onSurface: '#111C2D',
    onSurfaceVariant: '#434655',
    outline: '#737686',
    outlineVariant: '#C3C6D7',
    primary: '#2563EB',
    primarySoft: '#DBE1FF',
    primaryDim: '#B4C5FF',
    primaryDark: '#003EA8',
    secondary: '#046D40',
    secondarySoft: '#9DF5BD',
    tertiary: '#784B00',
    error: '#BA1A1A',
    errorSoft: '#FFDAD6',
    white: '#FFFFFF',
    shadow: '#111C2D',
    metalLight: '#F8FAFC',
    metalMid: '#A8B2C0',
    metalDark: '#344054',
    routeBright: '#38BDF8',
  },
  spacing: { base: 4, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, gutter: 16, marginMobile: 16 },
  radius: { default: 2, lg: 4, xl: 8, roundFour: 16 },
  typography: {
    label: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
    body: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
    bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
    headline: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  },
} as const;

/**
 * Screen-specific tokens extracted from the two approved Stitch frames.
 * They deliberately do not replace the application's operational palette:
 * the login is a brand moment, while the driver "Dabar" screen uses the
 * brighter route colours approved for fast scanning in daylight.
 */
export const stitchTheme = {
  login: {
    background: '#FBF9F8',
    surface: '#FFFFFF',
    text: '#1B1C1C',
    muted: '#777680',
    border: '#C7C5D0',
    primary: '#15174C',
    primaryPressed: '#2B2D62',
    accent: '#A73835',
    error: '#BA1A1A',
  },
  driverNow: {
    background: '#F7F9FC',
    surface: '#FFFFFF',
    text: '#182230',
    muted: '#737687',
    border: '#C3C6D8',
    routeBlue: '#155EEF',
    routeBluePressed: '#0047C1',
    routeBlueSoft: '#E7EAFF',
    progress: '#00C853',
    progressSoft: '#E8F8ED',
    warning: '#F59E0B',
  },
} as const;

export { colors, fonts, layout, radius, spacing, type };
