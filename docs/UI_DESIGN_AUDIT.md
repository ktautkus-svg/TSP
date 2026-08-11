# TSP UI design audit

Status: implementation in progress  
Baseline date: 2026-08-11

## Before

The frontend is functional and its automated baseline is healthy, but the visual language is fragmented. A repository scan of `src/app`, `src/components`, and `src/ui` found:

| Measure | Verified baseline |
| --- | ---: |
| Frontend TypeScript files inspected | 46 |
| Literal colour values | 202 |
| Literal font sizes | 23 |
| Literal font weights | 4 (`600`, `700`, `800`, `900`) |
| Literal border radii | 23 |
| Literal numeric spacing values | 21 |
| Style objects / style factories | 71 |

The counts include intentional specialised illustration colours, map rendering, and the instrument cluster. They therefore are not reduction targets on their own. They do confirm that ordinary operational UI still contains too many local visual decisions.

### Primary visual problems

- Green is used simultaneously for brand, navigation, primary actions, success, borders, text, and decoration. This weakens status meaning.
- Many screens define their own buttons, inputs, cards, labels, notices, and status treatments instead of sharing semantic components.
- Font sizes are relatively restrained, but weights are not: many screens rely on `800`–`900`, making secondary information compete with primary actions.
- Radius values range from 2 to 999 with many one-off values between 10 and 26.
- Route planning, active delivery, history, settings, and administration use noticeably different surface and control styles.
- Some dark-mode surfaces retain literal light colours rather than semantic theme roles.
- Operational blue, warning amber, and destructive red exist, but green still dominates actions that are not success or brand actions.
- Desktop layouts often remain widened mobile layouts rather than using purposeful density and columns.

## Branding audit

### Existing assets

| Asset | Format | Finding |
| --- | --- | --- |
| `assets/images/tsp-logo-mark.png` | Raster PNG | Full metallic wordmark plus tagline, tightly cropped to artwork. Recognisable at large sizes but too detailed for compact headers. |
| `assets/images/tsp-logo-v1.png` | Raster PNG | Same full lock-up centred inside a large transparent square. Excessive transparent padding makes CSS sizing unpredictable. |
| `assets/images/tsp-logo-v1-chroma.png` | Raster PNG | Magenta chroma working asset. Not suitable for production UI. |
| `assets/images/icon.png` and Expo defaults | Raster PNG | Still use Expo placeholder identity rather than TSP. |
| `assets/expo.icon/Assets/expo-symbol 2.svg` | SVG | Expo source asset, not TSP branding. |

### Branding findings

- The current metallic 3D treatment has glows, shadows, road markings, a parcel and a long tagline in one raster image. It loses clarity rapidly at mobile-header sizes.
- The two main PNG variants have opposite crop problems: one is very tight and one has large transparent padding.
- The tagline is unreadable at small sizes and forces the entire wordmark to be taller than the operational header needs.
- There is no clean vector TSP source, compact mark, light-background lock-up, or dark-background lock-up.
- Header identity and operational status colours are too tightly coupled through green.
- Current assets will be preserved. New brand variants will be added rather than destructively replacing the only sources.

### Branding direction

- Keep the recognisable TSP initials and the route idea.
- Introduce a clean vector mark suitable for 24–40 px use.
- Use a compact `TSP` lock-up without a forced tagline in operational headers.
- Keep a fuller lock-up available for login, launch, and presentation contexts.
- Provide light- and dark-surface variants through vector colour roles rather than duplicated raster effects.
- Do not derive the whole interface palette from the mark.

## Proposed design system

The existing `src/ui/tokens.ts` and theme provider remain the single design-system source. No parallel UI framework will be introduced.

### Semantic colour roles

- canvas, surface, elevated surface, and subtle surface;
- primary, secondary, and muted text;
- subtle and strong borders;
- brand and brand chrome;
- primary action;
- route/navigation/info blue;
- success green;
- attention/warning amber;
- danger red;
- disabled surface and text.

### Typography

- 400 for body copy;
- 500 for labels and secondary emphasis;
- 600 for controls and section headings;
- 700 for page headings and important totals;
- 800 reserved for the compact brand lock-up or exceptional numeric instrumentation;
- 900 removed from ordinary interface controls.

### Geometry

- spacing uses the existing five-step scale;
- radius uses small, medium, large, and pill only where semantically appropriate;
- shadows are restricted to overlays and truly elevated surfaces;
- touch targets remain at least 44 px and normally use the existing 48 px token.

## Implementation priorities

1. Complete semantic tokens and add small shared primitives for buttons, fields, surfaces, labels, badges, and notices.
2. Replace the raster header lock-up with a compact scalable TSP brand component while preserving source assets.
3. Align Home and route creation first.
4. Align route alternatives and active route/delivery around operational hierarchy.
5. Align history, settings, statistics, administration, and dispatcher screens.
6. Re-scan visual literals, verify representative responsive viewports, and record final metrics.

## Preserved boundaries

This work does not change route optimization, candidate scoring, route ordering, time-window constraints, Google/HERE providers, matrix behaviour, caching, SQLite semantics, persistence, or business rules.

## Verification baseline

- `npm run typecheck` — passed.
- `npm test` — 59 files, 564 tests passed.
- No lint command is defined in `package.json`.
- Web production build and browser viewport checks remain part of the implementation verification.

## Changed

To be updated after implementation.

## Design system

To be updated after implementation.

## Verification

To be updated after implementation.

## Remaining

To be updated after implementation.
