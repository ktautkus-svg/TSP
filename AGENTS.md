# AGENTS.md — TSP Logistics App

## 1. Project mission

TSP is a personal logistics and delivery application designed primarily for real-world use by a driver.

The application helps with:

- delivery route creation;
- address import and manual entry;
- delivery time windows;
- cargo weights;
- route optimization;
- route alternatives;
- manual stop reordering;
- navigation/routing;
- loading and delivery workflow;
- trip statistics;
- fuel and trip-sheet related data.

This is an operational tool, not a demo, SaaS template, or visual showcase.

Primary priorities are:

1. reliability;
2. usability during real work;
3. clear information hierarchy;
4. routing correctness;
5. speed of interaction;
6. visual consistency.

---

# 2. Product context

The primary user is a driver using the application during actual delivery work.

Primary devices:

- phone;
- tablet;
- desktop/web for planning and development.

Mobile and tablet usability are especially important.

Do not design workflows assuming the user is sitting at a desktop computer.

The application is primarily for personal use.

Do not introduce unnecessary:

- authentication;
- user management;
- roles;
- signatures;
- enterprise administration;
- onboarding systems;

unless explicitly requested.

---

# 3. Core delivery workflow

The application supports route creation from:

1. photo / document extraction;
2. pasted addresses;
3. manual entry.

Important delivery data includes:

- address;
- delivery order;
- delivery time window;
- cargo weight;
- route status;
- navigation information.

Where applicable, delivery time windows may be used either:

- as planning constraints;
- or informationally without blocking route generation.

Do not silently change the meaning of this behaviour.

---

# 4. Routing and optimization

Routing is one of the most important parts of TSP.

Do not simplify route optimization into nearest-neighbour or shortest-distance-only logic.

The optimization system may consider:

- travel time;
- distance;
- traffic;
- cargo weight;
- tonne-kilometres;
- delivery time windows;
- directionality;
- avoiding undesirable manoeuvres such as left turns;
- heavy cargo being delivered earlier where reasonable;
- farthest-first / directional route concepts;
- manually adjusted stop order;
- route alternatives.

The application may use routing providers such as:

- Google Routes / Route Matrix;
- HERE;
- synthetic/mock providers for testing.

Never modify provider behaviour, scoring weights, optimization rules, matrices, cache behaviour, or hard constraints as part of a UI-only task.

If a design task appears to require such a change, stop and explain why before modifying routing logic.

---

# 5. Manual route control

The user must retain control over generated routes.

Preserve functionality for:

- manual stop reordering;
- alternative route selection;
- reversing or adjusting route order where supported;
- viewing reasons or differences between alternatives.

AI-generated or algorithm-generated ordering must never make manual control impossible.

---

# 6. Existing architecture

Respect the existing project architecture.

Prefer extending existing:

- components;
- services;
- types;
- repositories;
- adapters;
- design tokens;
- hooks;
- utilities;

instead of introducing parallel implementations.

Before creating a new abstraction, search the repository for an existing one.

Do not create:

- duplicate routing clients;
- duplicate design systems;
- duplicate status mappings;
- duplicate colour constants;
- duplicate data models;

when an existing implementation can be extended.

---

# 7. UI / UX mission

TSP should look like:

> A professional logistics operations tool used every day.

It should NOT look like:

- a children's application;
- a generic AI-generated SaaS dashboard;
- a startup landing page;
- a component-library demo;
- a monochrome green application;
- a collection of unrelated colourful cards.

Professional does not mean boring.

The interface may use multiple colours, but colours must have purpose.

---

# 8. TSP colour philosophy

TSP green is a brand colour.

It is NOT the universal interface colour.

Do not make the application:

> green + white + more green.

Green should primarily represent:

- brand identity;
- primary actions where appropriate;
- success;
- completed states;
- active positive states.

Use additional semantic colours where useful.

Suggested semantic roles:

### Neutral / charcoal

Use for:

- primary text;
- navigation;
- high-emphasis headings;
- strong interface structure.

### White / off-white

Use for:

- primary surfaces;
- cards;
- clean working areas.

### Cool gray / slate

Use for:

- secondary surfaces;
- borders;
- metadata;
- disabled states;
- secondary information.

### TSP green

Use for:

- brand accents;
- primary CTA where appropriate;
- success;
- completed delivery states.

Do not use it simply because an element needs colour.

### Blue

Suitable for:

- routing;
- GPS;
- navigation;
- informational states;
- map-related actions.

### Amber / orange

Suitable for:

- time-window attention;
- waiting;
- warnings;
- approaching deadlines;
- situations requiring attention but not failure.

### Red

Use only for:

- errors;
- destructive actions;
- failed delivery;
- critical conditions.

Do not use red decoratively.

## TSP branding is not locked

The existing TSP logo, logo composition, tagline, spacing, crop, proportions and placement may be improved.

Do not treat the current logo asset as a fixed visual reference that the entire application must imitate.

Current branding issues may include:

- awkward cropping;
- weak spacing around the logo;
- poor proportions between the TSP mark and supporting text;
- the current tagline "Tikslus siuntų pristatymas" is not considered final and may be removed, rewritten, or replaced;
- excessive dependence on green;
- logo variants that do not work well at small header sizes;
- insufficient separation between brand identity and operational UI.

During the design audit, inspect all existing TSP logo/brand assets in the repository.

Create a branding section in the audit covering:

- existing logo files and variants;
- SVG vs raster assets;
- cropping / transparent padding problems;
- readability at mobile/header sizes;
- proportions;
- colour usage;
- tagline usage;
- consistency across screens.

You ARE allowed to improve the TSP brand identity as part of this task.

However:

1. Preserve the original logo assets before replacing anything.
2. Do not destructively overwrite the only source asset.
3. Prefer clean SVG/vector assets where the existing source allows it.
4. Create appropriate variants if useful, for example:
   - full logo;
   - compact logo;
   - mark-only version;
   - dark-background version;
   - light-background version.
5. The logo does NOT have to use only green.
6. The UI colour palette does NOT need to be derived entirely from the logo.
7. Do not force the tagline into the header if it harms readability.
8. A small mobile/header logo must remain recognizable without tiny unreadable text.
9. Fix bad crop, padding and alignment rather than compensating for them with CSS hacks.
10. Keep the identity recognizably TSP unless there is a strong reason for a larger change.

You may propose and implement a better tagline or remove the tagline from the main UI entirely.

If replacing the wording, prefer something short, professional and connected to route planning / delivery operations rather than a generic corporate slogan.

Do not spend the entire task designing a logo. Branding improvement is one part of the overall TSP professionalization.

---

# 9. Design token discipline

The project previously accumulated excessive visual variation.

Do not reintroduce design-system sprawl.

All commonly reused design values should come from central tokens whenever practical.

Avoid introducing arbitrary:

- hex colours;
- font sizes;
- font weights;
- border radii;
- shadows;
- spacing values.

Before adding a new value:

1. inspect existing tokens;
2. determine whether an existing semantic value fits;
3. only add a new token when there is a clear reusable reason.

Never add a new colour merely because an existing colour is "close but not perfect."

---

# 10. Typography

Typography must create hierarchy.

Recommended weight usage:

- 400 — normal body text;
- 500 — labels and secondary emphasis;
- 600 — controls and section headings;
- 700 — major headings and important totals.

Avoid 800–900 except for rare branding needs.

Do not make most of the interface bold.

Rule:

> If everything is emphasized, nothing is emphasized.

Use a restrained typography scale.

Do not introduce arbitrary font sizes for individual components.

---

# 11. Border radius

Use a small consistent radius system.

Prefer approximately three semantic levels:

- small — inputs / compact controls;
- medium — buttons;
- large — cards / major containers.

Do not introduce a unique border-radius for individual components without a strong reason.

Avoid excessive pill-shaped UI.

Status chips may use pill shapes when semantically appropriate.

---

# 12. Cards and surfaces

Do not wrap every piece of information in a card.

Cards should group related information.

Use hierarchy through:

- spacing;
- typography;
- background contrast;
- borders;
- alignment;

before adding more containers.

Avoid:

- cards inside cards inside cards;
- excessive borders;
- excessive shadows;
- every section having a different background colour.

---

# 13. Buttons and actions

Every screen should have a clear action hierarchy.

### Primary

The main action on the screen.

Examples:

- New route;
- Start route;
- Confirm delivery.

It should be visually dominant.

### Secondary

Important but non-primary action.

Use neutral styling or restrained accent styling.

### Tertiary

Navigation or low-priority actions.

Do not make tertiary actions compete with the primary CTA.

### Destructive

Use red only when the action is genuinely destructive.

Do not make all buttons colourful.

---

# 14. Operational information hierarchy

For route/delivery screens, prioritize information approximately as follows:

1. next required action;
2. next delivery;
3. address;
4. delivery time/window;
5. route status;
6. cargo weight;
7. navigation;
8. secondary metadata.

Do not give secondary information stronger visual emphasis than operationally important information.

---

# 15. Mobile usability

Design mobile-first where appropriate.

Important controls must:

- be easy to tap;
- have adequate touch targets;
- not sit too close together;
- remain readable outdoors and in a vehicle;
- avoid tiny metadata;
- avoid excessive scrolling for primary actions.

As a general target, interactive touch controls should be around 44×44 px or larger where practical.

Primary actions should be easy to reach.

---

# 16. Tablet and desktop

Do not simply stretch the mobile interface across a desktop viewport.

Use sensible:

- maximum content widths;
- columns;
- information density;
- whitespace.

Tablet layouts should take advantage of additional width without becoming visually sparse.

---

# 17. Responsive behaviour

Any UI change must be checked at minimum on:

- mobile;
- tablet;
- desktop.

Look for:

- horizontal overflow;
- clipped text;
- overlapping controls;
- inaccessible actions;
- excessive whitespace;
- cards wider than useful;
- broken navigation;
- wrapping problems.

Do not fix one viewport by breaking another.

---

# 18. Accessibility and contrast

Maintain strong readability.

Avoid:

- low-contrast gray text;
- pale text on coloured surfaces;
- status information encoded only through colour.

Where relevant, combine colour with:

- labels;
- icons;
- text;
- shape.

Prefer WCAG-compatible contrast.

---

# 19. Icons

Icons should communicate functionality.

Do not introduce decorative icons merely to make the screen look busy.

Use a consistent icon family where possible.

Do not mix unrelated icon styles.

---

# 20. Gradients and effects

Avoid decorative gradients unless explicitly requested.

Avoid:

- glassmorphism;
- neon effects;
- excessive shadows;
- glowing buttons;
- decorative background blobs;
- unnecessary animations.

Subtle interaction feedback is welcome.

Visual effects must support usability.

---

# 21. UI redesign workflow

For significant UI work, do NOT immediately rewrite the screen.

First:

1. inspect the existing component;
2. inspect nearby related screens;
3. inspect existing design tokens;
4. identify current hierarchy;
5. identify inconsistencies;
6. identify what is already good;
7. determine the smallest coherent improvement.

Then implement.

Rule:

> Do not redesign for the sake of redesigning.

Preserve good existing structure.

---

# 22. UI-only task boundary

If the task is described as:

- design;
- UI;
- styling;
- visual cleanup;
- colour cleanup;
- typography;
- responsive layout;

then do NOT modify unrelated:

- routing logic;
- optimization logic;
- databases;
- API contracts;
- provider implementations;
- calculations;
- persistence behaviour;
- business rules.

If such a modification becomes necessary, explain it before making the change.

---

# 23. Data and persistence

Respect the existing SQLite schema and migration system.

Do not:

- delete data;
- reset databases;
- modify schemas unnecessarily;
- change persisted semantics;

for cosmetic work.

Any schema change must be deliberate, documented, and tested.

---

# 24. External APIs

Be careful with:

- Google APIs;
- HERE APIs;
- geocoding;
- route matrices;
- traffic information.

Do not expose API keys.

Never commit:

- API secrets;
- private tokens;
- credentials;
- signing secrets;
- .env contents containing secrets.

Preserve existing environment-variable patterns.

---

# 25. Routing API cost awareness

Avoid unnecessary real provider calls during development and testing.

Prefer existing:

- cache;
- mock;
- synthetic;
- cache-only;

modes when appropriate.

Do not create loops that repeatedly call billable routing APIs.

---

# 26. Testing expectations

Before considering a change complete, run relevant checks.

At minimum, when available:

- type checking;
- unit tests;
- relevant integration tests.

Current project commands should be discovered from package configuration rather than guessed.

Known project checks may include commands such as:

- `npm run typecheck`
- `npm test`

But always inspect the repository first and use the project's actual commands.

For UI work also verify the affected screens manually or with browser/E2E tooling where available.

---

# 27. Test failures

Do not ignore failing tests.

If a test already failed before the current change, clearly distinguish:

- pre-existing failure;
- newly introduced failure.

Never claim tests pass unless they were actually run successfully.

---

# 28. Build and runtime errors

Never hide:

- TypeScript errors;
- console errors;
- unhandled promises;
- broken imports;
- runtime warnings caused by the change.

Fix the cause rather than suppressing the symptom.

---

# 29. Changes and diffs

Prefer small, coherent modifications.

Before finishing:

1. inspect the diff;
2. remove accidental changes;
3. remove debug output;
4. remove temporary code;
5. verify no secrets were added.

Do not modify unrelated files merely because formatting tools touched them unless necessary.

---

# 30. Git discipline

Prefer one logical concern per commit.

Examples:

- design tokens;
- shared button cleanup;
- home screen redesign;
- route card redesign;
- responsive fixes.

Avoid massive commits combining:

- UI redesign;
- routing changes;
- database changes;
- refactoring;
- dependency upgrades.

Do not rewrite history or perform destructive Git operations unless explicitly requested.

---

# 31. Refactoring

Do not refactor working code merely because another architecture looks cleaner.

Refactor when it:

- removes real duplication;
- reduces complexity;
- fixes an actual problem;
- enables the requested feature safely.

Large architectural rewrites require explicit justification.

---

# 32. Dependencies

Do not add a dependency if the existing project can reasonably solve the problem without it.

Before installing a package:

1. inspect existing dependencies;
2. explain why the new dependency is needed;
3. prefer maintained and established libraries.

Never add a UI framework just to redesign one screen.

---

# 33. Comments and documentation

Comment decisions that are not obvious.

Do not clutter simple code with comments describing what the code already says.

Document important:

- routing assumptions;
- optimization constraints;
- unusual provider behaviour;
- design-system exceptions.

---

# 34. Completion report

After completing a meaningful task, report concisely:

### Changed
What was implemented.

### Preserved
What important functionality was intentionally left untouched.

### Verification
What tests/checks were run and their results.

### Remaining
Any known issue or follow-up item.

Do not claim completion when verification is still pending.

---

# 35. Critical principle

TSP is already a functioning real-world application.

Treat it as a product that must be improved safely, not as a blank canvas.

A successful change should make the user think:

> "This is clearer, faster and more professional."

Not:

> "Where did the application I was using go?"

---

# 36. Default behaviour when uncertain

When uncertain between:

A. making a clever large change;

and

B. making a smaller safe change that preserves existing behaviour;

prefer B.

When a requirement is genuinely ambiguous and the decision could significantly alter product behaviour, ask before implementing it.

For minor implementation details that do not affect user behaviour, use reasonable engineering judgement and continue.
