# TSP Design V3 audit

## Scope and method

This audit was completed before Design V3 implementation on `agent/codex-design-v3`, based on `origin/main` at `96f50ce`.

The audit combines:

- rendered inspection of the signed-in production PWA at phone (390 x 844), tablet (768 x 1024), and desktop (1440 x 900) widths;
- read-only inspection of an active real route, its dashboard and stop list, History, Settings, Dispatcher, and Admin;
- source inspection of Home, import/manual entry, planning review, route alternatives, active delivery, account/sync, and shared design primitives;
- inspection of the existing vector and raster TSP brand assets.

The active-route guard correctly redirected attempts to open stale import/planning screens. Those protected screens were not forced open or mutated; their hierarchy is assessed from source so the real route remains untouched.

## What already works

- The active delivery workflow exposes the essential actions: navigate, complete, and fail.
- Semantic action colors are broadly correct: blue for navigation, green for completion, red for failure, and amber/red for time-window risk.
- Driver controls meet practical touch-size expectations and the phone layout does not overflow at 390 px.
- Sync state is visible in the operational header and already distinguishes Synced, Syncing, Offline, Error, and Needs attention.
- Dispatcher and Admin already use wider desktop compositions with clear task grouping.
- The planning model already supports alternatives, manual control, and comparison data; Design V3 does not need a new workflow.
- Existing TSP source brand assets are available as both SVG lockups/mark and preserved raster originals.

## Problems found

### 1. Driver desktop and tablet composition

- The active-route interface remains approximately 430 px wide at 768 px and is pinned to a narrow column at 1440 px, leaving most of the desktop viewport unused.
- History is similarly capped at 430 px. On desktop it becomes a small dark column surrounded by empty space.
- The result reads as a phone emulator rather than a professional multi-device operations tool.

### 2. Operational priority on the active route

- The scenic road image and instrument cluster consume the strongest visual position and most of the first screen.
- The next stop, time window, arrival risk, and actions are operationally more important but appear below the decorative/summary instrumentation.
- On tablet, the extra width is not used to keep next-stop information and route metrics visible together.

### 3. Palette and surface character

- Light mode uses green-tinted neutrals for text, borders, and chrome.
- Dark mode makes the background, surfaces, cards, header, and controls variations of green-black. This reduces hierarchy and creates a muddy, monochrome character in History, Settings, Dispatcher, and Admin.
- Green is carrying brand, structure, primary action, success, active state, progress, and selection simultaneously.
- Blue is already useful for navigation and information but is underused as the route-planning accent.

### 4. Hierarchy and density

- Active stop cards use heavy typography and strong green markers for too many elements.
- History cards have similar weight and weak differentiation between primary route facts and secondary metadata.
- Settings and Admin structure is sound, but repeated equal-strength dark cards flatten section hierarchy.
- The update notification can cover the operational header on phone and appears more prominent than its task warrants.

### 5. Planning and comparison

- Import/manual entry, review, and alternatives contain the correct information but rely on the same green-forward emphasis system.
- Alternative selection and route/provider information need clearer blue informational treatment, with green reserved for confirmed/positive state.
- Comparison content should use stronger alignment and restrained emphasis rather than more colored containers.

### 6. Branding

- `assets/brand/tsp-mark.svg`, light/dark lockups, and the raster originals are all usable and must remain preserved.
- The compact wedge/route mark works at header size, but the brand system is almost entirely green/white and does not establish a separate operational ink/blue visual language.
- The production document title still uses the long tagline “Tikslus siuntų pristatymas”; the in-app compact header wisely uses only “TSP”.
- A refreshed mark can preserve the recognizable descending route motif while introducing ink/route-blue structure and retaining green as the destination/success accent.

## Design V3 direction

### Visual system

- Replace green-tinted neutrals with ink/charcoal text and cool slate borders/surfaces.
- Use off-white/cool-gray working canvases in light mode and neutral charcoal/slate surfaces in dark mode.
- Keep TSP green for brand punctuation, confirmed completion, success, and positive progress.
- Use route blue for primary route creation/planning/navigation and informational selection.
- Keep amber for attention and red only for failure, destructive, or critical states.
- Preserve the existing spacing, radius, type, and component-token discipline; extend shared tokens only where the role is reusable.

### Responsive composition

- Give driver screens a centered, bounded desktop workspace instead of a fixed phone canvas.
- At tablet/desktop widths, place active-route progress/metrics beside the next-stop action panel so the next action remains dominant.
- Keep the phone sequence single-column, but reduce the visual dominance of the road/instrument section.
- Allow History and shared driver content to use a practical tablet/desktop width while retaining readable line lengths.

### Screen priorities

1. Active route: next stop, time risk, and actions first; route metrics second.
2. Home: one unmistakable primary route action, restrained secondary navigation, clear active-route status.
3. Planning/alternatives: blue information/selection treatment and more scannable comparisons.
4. History/Settings: cool neutral surfaces and clearer metadata hierarchy.
5. Dispatcher/Admin: preserve current desktop composition and improve palette/hierarchy only.
6. Sync/account/update status: preserve all behavior and five sync states, expressed as subtle professional status UI.

## Implementation boundaries

Design V3 will not change route optimization, provider selection, routing/scoring, database ownership, Firestore collections, cloud conflict rules, sync triggers, persistence semantics, or the live operational workflow. Existing brand source assets will not be overwritten; any V3 variants will be added alongside them.

## Acceptance checks

- No horizontal overflow or inaccessible actions at 390, 768, and 1440 px.
- Active-route next action remains visible and dominant on phone.
- Driver screens use tablet/desktop space intentionally.
- Sync labels remain Synced, Syncing, Offline, Error, and Needs attention in their localized UI.
- Color is not the only status signal.
- TypeScript, product tests, PWA tests, relevant gateway tests, and production PWA build pass.
