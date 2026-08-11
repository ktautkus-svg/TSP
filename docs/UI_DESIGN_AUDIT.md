# TSP UI design audit

Status: completed

Baseline date: 2026-08-11

Completion date: 2026-08-11

## Executive summary

The application now uses one semantic visual language across route creation, active work, history, settings, administration, and the dispatcher workspace. The redesign deliberately preserves route optimization, route ordering, time-window logic, providers, caching, SQLite semantics, persistence, and all other business behaviour.

The result is not a generic UI framework laid over TSP. It is a small project-native design system: semantic tokens, a focused set of primitives, scalable TSP branding, consistent operational status colours, and responsive screen compositions. The specialised route map, road scene, and instrument cluster remain visually distinctive, while the ordinary controls around them now follow the same rules as the rest of the product.

## Before and after

A repository scan of TypeScript UI files under `src/app`, `src/components`, and `src/ui` produced the following comparable counts:

| Measure | Before | After | Result |
| --- | ---: | ---: | --- |
| Frontend TypeScript files inspected | 46 | 48 | Shared primitives and brand components added |
| Unique literal colour values | 202 | 143 | 59 fewer (29% reduction) |
| Unique literal font sizes | 23 | 21 | Reduced while adding explicit semantic type roles |
| Unique literal font weights | 4 | 3 | `900` removed from ordinary UI |
| Unique literal border radii | 23 | 17 | One-off geometry reduced |
| Unique numeric spacing values | 21 | 19 | More screens use the shared scale |

These counts intentionally include specialised gauge, map, route-illustration, and SVG colours. They are not expected to reach zero. The important change is that ordinary cards, buttons, notices, fields, navigation, and text hierarchy no longer introduce independent visual rules on every screen.

## Original findings

- Green was simultaneously serving as brand, navigation, primary action, success, border, text, and decoration.
- Many screens defined their own buttons, inputs, cards, labels, notices, and status treatments.
- Heavy `800`-`900` typography made secondary information compete with actions and totals.
- Radius values ranged from 2 to 999, with many one-off intermediate values.
- Planning, delivery, history, settings, administration, and dispatcher screens looked like separate products.
- Some dark-mode surfaces retained literal light colours instead of semantic theme roles.
- Desktop layouts were often widened mobile layouts rather than purposeful workspaces.

## Branding audit

### Existing assets preserved

| Asset | Format | Finding |
| --- | --- | --- |
| `assets/images/tsp-logo-mark.png` | Raster PNG | Detailed metallic wordmark; recognisable at large sizes but too detailed for compact headers. |
| `assets/images/tsp-logo-v1.png` | Raster PNG | Full lock-up with excessive transparent padding. |
| `assets/images/tsp-logo-v1-chroma.png` | Raster PNG | Chroma working asset; unsuitable for production UI. |
| `assets/images/icon.png` and Expo defaults | Raster PNG | Legacy/default app identity. |
| `assets/expo.icon/Assets/expo-symbol 2.svg` | SVG | Expo source asset, not TSP branding. |

No original branding asset was overwritten or deleted.

### New scalable variants

- `assets/brand/tsp-mark.svg` - compact mark for small headers and icon-sized use;
- `assets/brand/tsp-lockup-dark.svg` - lock-up for dark surfaces;
- `assets/brand/tsp-lockup-light.svg` - lock-up for light surfaces;
- `TspBrand` and `BrandHeader` - reusable components that apply the right spacing and scale without crop compensation.

The operational header no longer depends on tiny unreadable tagline text. The expanded lock-up uses the short line `Maršrutai ir pristatymai`, while the compact variant remains recognisable without supporting copy. Brand green is now separated from info blue, success green, warning amber, and danger red.

## Implemented design system

### Semantic tokens

`src/ui/tokens.ts` and `src/ui/theme-palette.ts` now define:

- canvas, surface, elevated, inset, and subtle surfaces;
- primary, secondary, muted, inverse, and disabled text;
- subtle and strong borders;
- brand, primary action, information, success, warning, and danger roles;
- semantic typography roles and line heights;
- shared spacing, radius, elevation, and touch-target rules;
- corresponding light and dark palette roles.

### Shared primitives

`src/components/ui-primitives.tsx` provides:

- `AppButton` with primary, secondary, quiet, info, and danger treatments;
- `AppCard` for standard surfaces and selectable states;
- `AppTextField` with consistent label, help, and error hierarchy;
- `StatusBadge` for compact semantic state communication;
- `SectionHeader` for page and section hierarchy;
- `InlineNotice` for info, success, warning, and error messages.

All controls preserve at least a 44 px touch target; the shared default is 48-52 px.

## Screen groups aligned

### Entry and route creation

- login gate and app header use scalable TSP brand assets;
- Home uses a clearer primary task hierarchy and restrained operational summaries;
- import, new route, and review screens share cards, fields, actions, notices, and spacing;
- start/end location, date, priority, and validation states use consistent semantic roles.

### Planning and active work

- route alternatives distinguish selected, recommended, secondary, warning, and destructive states;
- loading and delivery retain their domain-specific visuals but use shared operational controls;
- route result, filters, notices, actions, and stop cards follow the same hierarchy;
- informational blue is distinct from successful completion green;
- delivery, failure, and warning states remain legible without relying on green alone.

### Secondary and management screens

- history list and detail;
- settings and saved locations;
- statistics;
- administration;
- dispatcher workspace;
- trip sheet and vehicle screens.

These screens now share surface hierarchy, form geometry, typography, spacing, action treatments, and responsive constraints instead of defining independent visual languages.

## Responsive and accessibility review

The production PWA entry state was inspected in a real browser at 320x568, 390x844, 768x1024, and 1440x900.

| Viewport | Horizontal overflow | Form control height | Result |
| --- | ---: | ---: | --- |
| 320x568 | none (`scrollWidth = 320`) | 52 px | Pass |
| 390x844 | none (`scrollWidth = 390`) | 52 px | Pass |
| 768x1024 | none (`scrollWidth = 768`) | 52 px | Pass |
| 1440x900 | none (`scrollWidth = 1440`) | 52 px | Pass |

The protected screens could not be manually opened without transmitting or inventing employee credentials. Their responsive and state regressions are covered by the product test suite and the successful production export. The browser inspection also verified that a stale service worker can briefly show the previous schema support message; closing the stale tab activates the current PWA build and correctly opens schema v14 without changing or deleting data.

## Verification

- `npm run typecheck` - passed.
- `npm test` - 59 files, 564 tests passed.
- `npm run validate:schema` - passed; SQLite schema v14, 29 tables.
- `npm run gateway:test` - 10 files, 52 tests passed.
- `npm run pwa:build` - passed; 49 production files, service-worker version `pwa-20a5cbe3888f`.
- `npm run pwa:test` - 2 files, 8 tests passed.
- Production bundle scan - 0 configured development URLs, private IPs, test addresses, API keys, or device secrets.
- Browser console during the checked entry flow - no errors or warnings.
- No lint script is defined in `package.json`.

The web export reports only existing Leaflet CSS resource warnings and a Babel deprecation warning; neither blocks the build or runtime.

## Commits

1. `9c9f517` - flexible TSP branding guidelines;
2. `0f8d553` - visual and branding audit;
3. `e693ca9` - semantic tokens, primitives, and scalable branding;
4. `0298416` - route creation and Dashboard hierarchy;
5. `31d0735` - route planning and active-work semantics;
6. `1f4136a` - secondary screens and dispatcher workspace;
7. final verification and audit completion - recorded in the following documentation commit.

## Preserved boundaries

No route optimization, candidate scoring, route ordering, time-window constraint, Google/HERE provider, matrix behaviour, caching rule, SQLite schema, persistence rule, API contract, or other business rule was changed by this design-system work. No UI framework or production dependency was added.

## Remaining visual debt

- The instrument cluster, route map, and road illustration still contain intentional local colour and geometry values. Consolidating these into illustration-specific tokens would be a separate, lower-priority task.
- The build's Leaflet CSS references should be reviewed if map assets are later self-hosted differently.
- A real outdoor iPhone review remains valuable for sunlight contrast, Dynamic Island/safe-area behaviour, and one-handed operation.
- Dark mode should receive the same final physical-device review; its semantic palette is implemented and automated regressions pass, but it was not manually inspected behind employee authentication in this run.

## Conclusion

The TSP interface is now substantially more coherent and maintainable. Branding is scalable, operational colours have distinct meaning, common controls share one implementation, and the major workflows follow the same hierarchy across mobile and desktop. The remaining debt is concentrated in specialised visualisations and physical-device polish rather than ordinary UI fragmentation.
