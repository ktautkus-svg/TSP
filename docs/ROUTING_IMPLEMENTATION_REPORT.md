# Routing Engine v0.1 įgyvendinimo ataskaita

## Rezultatas

Eksperimentinis trijų algoritmų skriptas pakeistas į bendrą, testuojamą
`RoutingEngine v0.1`. Produkcinė logika yra `src`, o
`experiments/provider-comparison` liko tik adapterių palyginimo laboratorija.

Įgyvendinta:

- bendras request, vehicle, stop, matrix, candidate ir result domeno modelis;
- atskiras hard apribojimų vertintojas ir diagnostinis neįvykdomas variantas;
- leksikografinis kritinių kriterijų rangas;
- 10 komponentų konfigūruojamas normalizuotas scoring;
- detalus t·km, ETA, laukimo, aptarnavimo, svorio ir manevrų skaičiavimas;
- deterministinė kryptingumo heuristika;
- 8 privalomos heuristikų šeimos, keli fiksuoti random seed ir bazinė seka;
- `swap`, `2-opt`, `relocate` vietinė paieška su ribomis ir statistika;
- kandidatų deduplikavimas su pilna `generatedBy` kilme;
- rekomendacija ir iki dviejų sekos požiūriu prasmingų alternatyvų;
- skaitiniais įrodymais paremti paaiškinimai;
- rankinės sekos vertinimas ir likusio maršruto perskaičiavimas;
- sintetinės linear/city/asymmetric matricos;
- HERE ir Google gateway adapteriai su timeout, abort, 429 ir validacija;
- memory ir SQLite matricų cache su TTL bei invalidacija;
- SQLite v3 optimizavimo, kandidatų, perskaičiavimų ir cache auditas;
- tikras variklio rezultatas alternatyvų UI ekrane;
- scenarijų benchmark su JSON, Markdown ir CSV.

## Pakeistų failų inventorius

### Projekto konfigūracija

- `README.md`
- `app.json`
- `package.json`
- `package-lock.json`
- `metro.config.js`
- `vitest.config.ts`

### Produkcinis routing domenas

- `src/domain/routing/models.ts`
- `src/domain/routing/defaults.ts`
- `src/domain/routing/errors.ts`
- `src/domain/routing/scenarios.ts`
- `src/domain/routing/constraints/constraint-evaluator.ts`
- `src/domain/routing/evaluation/candidate-evaluator.ts`
- `src/domain/routing/evaluation/directionality.ts`
- `src/domain/routing/evaluation/geo.ts`
- `src/domain/routing/evaluation/load-distance.ts`
- `src/domain/routing/heuristics/generators.ts`
- `src/domain/routing/heuristics/local-search.ts`
- `src/domain/routing/scoring/scoring.ts`

### Aplikacijos ir infrastruktūros sluoksniai

- `src/application/routing/routing-engine.ts`
- `src/application/routing/route-comparison.ts`
- `src/application/routing/manual-route-evaluator.ts`
- `src/application/routing/recalculate-route.ts`
- `src/application/ports/route-optimizer.ts`
- `src/application/ports/travel-cost-provider.ts`
- `src/infrastructure/routing/providers/synthetic-travel-cost-provider.ts`
- `src/infrastructure/routing/providers/gateway-travel-cost-provider.ts`
- `src/infrastructure/routing/cache/matrix-cache.ts`
- `src/infrastructure/routing/persistence/sqlite-routing-audit-repository.ts`
- `src/database/migrations.ts`
- `src/app/route/[id]/alternatives.tsx`

Pašalintas senas dubliuotas `src/application/services/optimization-score.ts`.

### Laboratorija, testai ir ataskaitos

- `experiments/provider-comparison/index.ts`
- `experiments/provider-comparison/optimizer.ts`
- `experiments/provider-comparison/providers.ts`
- `experiments/provider-comparison/scenario.ts`
- `experiments/provider-comparison/types.ts`
- `experiments/provider-comparison/run.ts`
- `experiments/provider-comparison/README.md`
- `experiments/provider-comparison/report.json`
- `scripts/benchmark-routing.ts`
- `scripts/validate-schema.mjs`
- `tests/unit/routing-engine.test.ts`
- `tests/unit/routing-providers.test.ts`
- `tests/unit/routing-scenarios.test.ts`
- `tests/unit/routing-schema.test.ts`
- `tests/unit/routing-score.test.ts`
- `reports/routing/benchmark.json`
- `reports/routing/benchmark.md`
- `reports/routing/benchmark.csv`

Seni demonstraciniai `optimization-score.test.ts` ir
`provider-comparison.test.ts` pakeisti bendro variklio testais.

### Dokumentacija

- `docs/ROUTING_ENGINE_V0_1.md`
- `docs/ROUTING_SCORING.md`
- `docs/ROUTING_PROVIDER_ADAPTERS.md`
- `docs/ROUTING_IMPLEMENTATION_REPORT.md`

## Algoritmai

Pradiniai generatoriai:

1. `nearest_neighbor`;
2. `farthest_first`;
3. `heaviest_first`;
4. `earliest_required_window_first`;
5. `end_location_guided`;
6. `directional_sweep`;
7. `cluster_then_route`;
8. `random_seeded:7`, `:42`, `:2026`;
9. papildomas `original_order`.

Po kiekvieno generatoriaus taikoma deterministinė vietinė paieška. Vienai
iteracijai tikrinama 30–300 kaimynų; papildomai veikia iteracijų ir absoliutus
laiko limitas. Kandidatai vertinami hard → critical rank → normalized score
tvarka.

## Scenarijai ir testai

- Bazinių deterministinių scenarijų: **50**.
- Su trimis matricos režimais ir penkiais našumo pjūviais: **165 paleidimai**.
- Vilniaus sintetinių darbo dienų: **5**.
- Perskaičiavimo scenarijų: **5**.
- Testai: **43**, visi praėjo.
- SQLite: schema v3, **20 lentelių**, v1 → v2 → v3 migracija patikrinta.

Testai apima sekos invariantus, nedingstančius taškus, startą/pabaigą, svorio
monotoniškumą ir nulį pabaigoje, neigiamų/NaN balų apsaugą, hard pirmenybę,
seed determinizmą, deduplikavimą, gateway klaidas, cache, t·km pavyzdžius,
rankinę korekciją, perskaičiavimą ir SQLite repository ribą.

## Benchmark rezultatai

Paskutinis sintetinis paleidimas:

- 1 504 kandidatų eilutės JSON ir CSV;
- skirtingas rekomenduojamas eiliškumas tarp matricos režimų: **19 iš 55**
  palygintų scenarijų;
- vidutinis local-search pagerėjimas: **19,41 %**;
- vidutinė vieno scenarijaus trukmė:
  - linear: **278,1 ms**;
  - city traffic: **261,5 ms**;
  - asymmetric: **254,2 ms**.

Heuristikų kilmė laimėjusiuose kandidatuose:

- `farthest_first`: 103;
- `nearest_neighbor`: 68;
- `cluster_then_route`: 24;
- `directional_sweep`: 23;
- `end_location_guided`: 16;
- `earliest_required_window_first`: 14;
- `heaviest_first`: 6;
- random seed ir original order taip pat laimėjo dalyje scenarijų.

`local_search` prisidėjo prie 152 laimėjusių kandidatų. Skaičiai nėra
ekskliuzyvūs, nes deduplikuotas kandidatas gali turėti kelių generatorių kilmę.

### Vilniaus scenarijai (`synthetic:city_traffic`)

| Scenarijus | Laikas | Km | t·km | Laimėjusi kilmė |
|---|---:|---:|---:|---|
| workday-1 | 189,9 min | 48,9 | 40,2 | farthest + earliest window + local |
| workday-2 | 308,4 min | 82,9 | 84,4 | directional sweep + local |
| workday-3 | 334,6 min | 87,4 | 123,9 | directional sweep + local |
| workday-4 | 431,3 min | 111,9 | 133,2 | nearest neighbor + local |
| workday-5 | 434,3 min | 101,2 | 235,2 | nearest + cluster + local |

Visos penkios dienos rado įvykdomą variantą.

### Našumo pjūvis (`synthetic:city_traffic`)

| Taškai | Skaičiavimas | Kandidatai |
|---:|---:|---:|
| 5 | 32 ms | 3 |
| 10 | 249 ms | 11 |
| 15 | 896 ms | 10 |
| 20 | 2 061 ms | 11 |
| 30 | 3 700 ms | 11 |

Atminties delta benchmark įrašyta, bet dėl JavaScript garbage collector
svyravimo ji nėra patikimas vieno paleidimo KPI. Pagal laiką iki 15–20 taškų
galima skaičiuoti lokaliai, geriausia neblokuojančiame worklet/worker. Nuo
20–30 taškų arba naudojant daugialaikes matricas rekomenduojamas gateway.

### Sąmoningai neįvykdomi scenarijai

- `over-capacity` – `MAX_PAYLOAD`;
- `two-conflicting-windows` – du `REQUIRED_TIME_WINDOW`;
- `impossible-window` – `REQUIRED_TIME_WINDOW`;
- `workday-overrun` – `WORKDAY_END`.

Jie grąžina diagnostinį kandidatą, ne klaidingą rekomendaciją.

## Providerių būsena

- Mock linear/city/asymmetric: realiai veikianti deterministinė sintetika.
- HERE: veikiantis gateway klientas; laboratorijoje `stub`, nes nėra endpoint/rakto.
- Google Routes: veikiantis gateway klientas; laboratorijoje `stub`.
- Memory ir SQLite cache: realiai veikia, cache atsakymas žymimas `cache`.
- Eksperimento stub rezultatai nėra pateikiami kaip realus HERE/Google palyginimas.

Prieš realų palyginimą būtina gateway aplinkoje sukonfigūruoti abu raktus,
suvienodinti transporto parametrus, užtikrinti kvotas, patikrinti licencijų
retention ir paleisti tuos pačius scenarijus keliais laiko pjūviais.

## Patikros

- `npm run typecheck` – praėjo.
- `npm test` – 43/43.
- `npm run validate:schema` – v3, 20 lentelių.
- `npx expo-doctor` – 20/20.
- `npm run experiment:routing` – praėjo, HERE/Google pažymėti stub.
- `npm run benchmark:routing` – 165 paleidimai.
- Android Expo export – praėjo, 2,9 MB Hermes bundle.
- Web Expo static export – praėjo, 13 statinių route ir SQLite WASM worker.

## Žinomos techninės skolos

1. V0.1 negarantuoja globalaus optimumo.
2. Reali daugialaikė eismo matrica ir turn-by-turn manevrai priklauso nuo gateway.
3. 20–30 taškų paiešką telefone reikia iškelti nuo pagrindinio JS UI thread.
4. In-app localhost peržiūros paviršius rodė tuščią drobę, nors HTTP, Web static
   export, WASM worker ir Android bundle praėjo; tikslinis Android ekranas dar
   turi būti patikrintas emuliatoriuje arba fiziniame įrenginyje.
5. `npm audit --omit=dev` rodo 11 moderate transitive Expo build-chain įspėjimų.
   Siūlomas automatinis `--force` fix pažemintų Expo iki 46, todėl netaikytas.
6. Realiam gateway dar reikia serverio autorizacijos, retry/jitter, observability
   ir tiekėjų kvotų valdymo.

## Rekomenduojamas kitas etapas

Sukurti mažą Optimization Gateway proof-of-data: vieną bendrą matricos endpoint,
HERE ir Google server-side adapterius, tuos pačius 5 Vilniaus scenarijus trimis
dienos laikais ir automatinį real/cache rezultatų įrašymą. Tik gavus realių
matricų signalą verta kalibruoti scoring svorius ar plėsti heuristikas.
