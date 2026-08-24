# TSP dabartinė projekto būsena

Atnaujinta: 2026-08-24

## Kanoninis kodas

Produkcinei Expo/PWA aplikacijai naudojamas pagrindinis `src/` medis ir šakniniai
`server/`, `gateway/`, `tests/` bei `scripts/` katalogai.

`tsp-integration/` ir `tsp-premium-cockpit/` yra neprodukcinės, neįtrauktos į
pagrindinį TypeScript kompiliavimą kopijos / eksperimentiniai variantai. Jų pakeitimai
turi būti perkeliami į `src/` tik po atskiro sprendimo, kad nesusidarytų dvi
nesuderinamos aplikacijos.

Šie katalogai ir `.cursor/` lokaliai paliekami diske, bet ignoruojami Git. Jie nėra
produkcinio build'o dalis.

Šakninis `index.html` yra atskiras savarankiškas skaičiuotuvo demonstracinis failas.
Jis nėra Expo Router aplikacijos įėjimo taškas.

Priekinio stiklo release assetai yra `assets/images/route-scenes/stitch-windshield-01.png`
iki `stitch-windshield-11.png`. Originalios Stitch žaliavos `Foto glass/` ir `1/` yra
lokalios ir ignoruojamos Git.

## Patikros

Pagrindinės lokaliai vykdomos patikros:

```text
npm run typecheck
npm run lint
npm test
npm run validate:schema
npm run pwa:test
```

PWA patikra papildomai skenuoja produkcinį bundle ir neleidžia jame palikti
konfigūruotų kūrimo URL, privačių IP adresų, testinių adresų ar paslapčių.

## Schema

SQLite schema v25, 36 lentelės (`npm run validate:schema`).

## 2026-08-24 patikros

- TypeScript: praėjo.
- ESLint: praėjo.
- SQLite schema: praėjo, schema v25, 36 lentelės.
- Vitest: praėjo, 102 failai ir 909 testai.

## 2026-08-24 pataisymai prieš deploy

- Debesų sinchronizacija neperrašo vietinio `loading|loaded|in_progress` maršruto
  tyliai; konfliktas paliekamas ir rodomas vairuotojui.
- OCR eina per usage guard; synthetic routing neįsijungia tyliai.
- Rate limit raktas naudoja `x-tsp-rate-limit-key` (sesija arba `x-forwarded-for`).
- Nauji PIN 6–8 skaitmenys; produkcijoje nėra numatytojo `12345`.
  `TSP_INITIAL_ADMIN_PIN` reikalingas tik pirmai administratoriaus paskyrai.
- Vairuotojo pradžia yra `/` (Dabar), ne `/history`.
- Pristatymo ekranas naudoja temą, kitą adresą rodo pirmą, metrikos `IKI KM` / `IKI MIN`.

## Routing API sauga

Realūs provideriai pagal nutylėjimą yra išjungti (`GATEWAY_REAL_PROVIDER_ARMED=0`).
Gateway prieš realų providerio call tikrina dienos ir savaitės usage limitus, o
cache hitai limito nenaudoja. Production matrix, geocode ir polyline cache naudoja
failinį sluoksnį, o routing UI vienai operacijai renkasi tik vieną mokamą providerį.
Synthetic fallback naudojamas tik jei vairuotojas patvirtina, arba
`EXPO_PUBLIC_ALLOW_SYNTHETIC_FALLBACK=1` vietiniam darbui.

Prieš įjungiant realų API reikia patikrinti providerio billing kainas, nustatyti
`GATEWAY_DAILY_BUDGET_CENTS`, `GATEWAY_WEEKLY_BUDGET_CENTS` ir perkelti usage ledger
į tikrai persistent atomic saugyklą, jei Cloud Run restartai turi išlikti savaitės
limite.

## Dar neatlikta lokaliai

Fizinis iPhone priėmimo testas nėra pakeičiamas automatiniu TypeScript ar PWA testu.
Prieš nesupervizuojamą naudojimą dar reikia patikrinti realų iPhone, Waze/Apple Maps,
Windows Firewall, vietinio gateway pasiekiamumą, safe-area, klaviatūrą ir grįžimą iš
navigacijos į aplikaciją.

Istorines projektines ataskaitas reikia skaityti kartu su šiuo dokumentu; jų ankstesni
skaičiai ir schema versijos gali būti pasenę.
