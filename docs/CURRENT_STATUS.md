# TSP dabartinė projekto būsena

Atnaujinta: 2026-09-01

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

Lokaliai ir GitHub Actions CI (`.github/workflows/ci.yml`, `pull_request` ir `push`):

```text
npm run typecheck
npm run lint
npm test
npm run validate:schema
npm run pwa:build
npm run pwa:test
```

CI naudoja Node 24, kaip ir `Dockerfile`. Produkcinis Cloud Run deploy yra atskiras
workflow (`.github/workflows/cloud-run.yml`): jis vis dar paleidžia tą patį kokybės
rinkinį prieš revision, bet `cancel-in-progress` yra išjungtas, kad naujas push į
`main` nenutrauktų jau vykstančio produkcinio deploy. Secret Manager versijos
kiekvieno auto-deploy metu nebekuriamos — naudojamos esamos paslaptys.

PWA patikra papildomai skenuoja produkcinį bundle ir neleidžia jame palikti
konfigūruotų kūrimo URL, privačių IP adresų, testinių adresų ar paslapčių.

## Schema

SQLite schema v27, 37 lentelės (`npm run validate:schema`).

## Kas iš tikrųjų veikia

- **Kelionės lapai** — dienos lapai, degalai, norma, Excel eksportas
  (`src/app/trip-sheet.tsx`, serverio `/api/admin/trip-sheets`).
- **Odometras kaip km** — dienos ridą galima įvesti kaip nuvažiuotus kilometrus,
  ne tik absoliutų odometro skaičių; sąraše rodoma `km per dieną`.
- **Excel** — LOGISTICS_EXCEL_V1 importas ir kelionės lapų `.xlsx` eksportas.
- **Darbuotojų paskyros** — `admin` / `dispatcher` / `driver`, PIN, sesijos,
  maršrutų paskyrimas (`docs/EMPLOYEE_ACCOUNTS_V1.md`).
- **Cloud sync** — maršrutų momentinės kopijos tarp įrenginių (v1 / Phase 0).
  Cloud Sync v2 1–5 fazės (vietos, nuostatos, atskiri ne maršruto entitetai)
  lieka plane, ne produkcijoje (`docs/CLOUD_SYNC_V2_PLAN.md`).

## 2026-09-01 patikros

- TypeScript: praėjo.
- ESLint: praėjo.
- SQLite schema: praėjo, schema v27, 37 lentelės.
- Vitest: praėjo, 116 failai ir 1022 testai.
- PWA build ir `pwa:test`: praėjo (bundle scan: 70 failai, 0 uždraustų URL / IP / paslapčių).

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

Cloud Run servisas šiame pakeitime lieka `--allow-unauthenticated` (produkto
sprendimas, ne CI užduotis).

## Dar neatlikta lokaliai

Fizinis iPhone priėmimo testas nėra pakeičiamas automatiniu TypeScript ar PWA testu.
Prieš nesupervizuojamą naudojimą dar reikia patikrinti realų iPhone, Waze/Apple Maps,
Windows Firewall, vietinio gateway pasiekiamumą, safe-area, klaviatūrą ir grįžimą iš
navigacijos į aplikaciją.

Istorines projektines ataskaitas reikia skaityti kartu su šiuo dokumentu; jų ankstesni
skaičiai ir schema versijos gali būti pasenę.
