# Routing Engine v0.1

## Tikslas ir būsena

`RoutingEngine` yra nuo React Native, HTTP ir SQLite nepriklausomas aplikacijos
servisas. Jis gauna bendrą `RouteOptimizationRequest`, kelių matricą per
`TravelCostProvider` ir grąžina vieną rekomendaciją, iki dviejų prasmingai
skirtingų alternatyvų arba diagnostinį neįvykdomą kandidatą.

Tai heuristinis v0.1 sprendiklis, ne matematinio optimalumo įrodymas. Jis
neperžiūri visų permutacijų ir negarantuoja globalaus optimumo.

## Pradinio eksperimento auditas

Ankstesnio `experiments/provider-comparison` stiprybės buvo aiški matricos
tiekėjo riba, deterministinis Mock, vienodas scenarijus trims tiekėjams ir
automatizuotas JSON paleidimas. Tačiau jo tipai dubliavo aplikacijos portus,
trijų primityvių algoritmų scoring maišė skirtingus matavimo vienetus, neturėjo
hard apribojimų, laiko planavimo, deduplikavimo, normalizavimo, audito ar
prasmingų alternatyvų. HERE ir Google stub skaičiai galėjo būti klaidingai
interpretuojami kaip realus tiekėjų kokybės palyginimas.

Dabar verslo logika perkelta į `src`. Eksperimentas liko tik paleidimo
laboratorija ir importuoja tą patį variklį, modelius bei adapterius. Realūs
tiekėjai visada jungiami per gateway; be gateway rezultatas žymimas `stub`.

## Sluoksniai

```text
src/domain/routing
  models.ts, defaults.ts
  constraints/
  evaluation/
  heuristics/
  scoring/
src/application/routing
  routing-engine.ts
  route-comparison.ts
  manual-route-evaluator.ts
  recalculate-route.ts
src/infrastructure/routing
  providers/
  cache/
  persistence/
experiments/provider-comparison
scripts/benchmark-routing.ts
```

- Domenas nežino apie UI, tinklą ar duomenų bazę.
- Aplikacijos sluoksnis orkestruoja kandidatų generavimą ir atranką.
- Infrastruktūra realizuoja sintetines bei gateway matricas, cache ir SQLite auditą.
- `src/domain/routing/models.ts` yra vienintelis routing kontraktų šaltinis.

## Sprendimo hierarchija

1. Patikrinama užklausos struktūra ir gaunama kvadratinė matrica.
2. Generuojami pradiniai kandidatai.
3. Akivaizdūs eiliškumo hard apribojimai pataisomi, kai tai įmanoma.
4. Kiekvienam kandidatui taikomi `swap`, `2-opt` ir `relocate` kaimynai.
5. Hard pažeidimai ir kritinis rangas lyginami leksikografiškai.
6. Tik įvykdomi ir kritiškai lygiaverčiai kandidatai lyginami normalizuotu balu.
7. Vienodos sekos deduplikuojamos, sujungiant `generatedBy`.
8. Atrenkama rekomendacija ir iki dviejų sekos požiūriu skirtingų alternatyvų.

## Kandidatų generatoriai

Įgyvendinti `nearest_neighbor`, `farthest_first`, `heaviest_first`,
`earliest_required_window_first`, `end_location_guided`, `directional_sweep`,
`cluster_then_route`, keli `random_seeded:<seed>` ir papildomas
`original_order` bazinis variantas. Visi generatoriai deterministiniai.
`heaviest_first` yra tik pradinis kandidatas, o ne absoliuti sprendimo taisyklė.

## Vietinė paieška ir apsaugos

Kiekvienas pradinis kandidatas gerinamas `swap`, `2-opt` ir `relocate`
operatoriais. Pakeitimas nepriimamas, jei pablogina įvykdomumą arba kritinį
rangą. Registruojamos pradinė seka, iteracijos, pradinis ir galutinis
objektyvas, pagerėjimo procentas bei sustojimo priežastis.

Yra iteracijų ir laiko limitai. Dideliems maršrutams nenaudojamas brute force.
Vienai iteracijai taikomas ir deterministinis 30–300 kaimynų vertinimo limitas,
kad rezultatas įprastomis sąlygomis nepriklausytų nuo procesoriaus greičio.
Sintetinis benchmark apima 5, 10, 15, 20 ir 30 taškų. Iki 20 taškų numatytas
lokalus skaičiavimas; nuo 20–30 taškų, ypač su laiko priklausomomis matricomis,
rekomenduojamas Optimization Gateway. Galutinė riba tikrinama tiksliniuose
telefonuose.

## Hard apribojimai

Tikrinami krovinio limitas, privalomi laiko langai, locked/first/last,
`deliver_before`, `deliver_after`, trūkstami ar dubliuoti taškai, nepasiekiamos
atkarpos, kelių apribojimų perspėjimai, startas, pabaiga ir darbo dienos riba.
Režime `ignore_time_windows` laikai lieka informacinio scoring dalis, bet nėra
hard apribojimas.

Kai įvykdomo varianto nėra, `recommended` yra `null`; grąžinamas tik
`diagnosticCandidate`, konfliktai ir konkretūs atlaisvinimo pasiūlymai.

## Kryptingumo heuristika

Rodiklis jungia progresą starto–pabaigos ašyje, didelius krypties pokyčius,
geometrinius atkarpų susikirtimus ir nutolimą nuo pabaigos paskutiniame
maršruto trečdalyje. Tai deterministinė heuristika, o ne absoliuti realaus
vairavimo kokybės tiesa.

## Perskaičiavimas ir rankinės korekcijos

`recalculateRemainingRoute` pašalina užbaigtus taškus, išlaiko jų ID audite ir
optimizuoja tik likutį nuo dabartinės vietos bei laiko. Grąžinamas laiko,
atstumo ir pasikeitusių taškų skirtumas.

`evaluateManualRoute` perskaičiuoja visas metrikas, hard pažeidimus ir grąžina
`minor`, `significant` arba `critical` poveikį. Naudotojo pasirinkimas
neatmetamas, o techniškai neįmanoma seka aiškiai pažymima.

## SQLite auditas

V3 migracija prideda `routing_engine_runs`, `routing_engine_candidates`,
`routing_recalculations` ir `routing_matrix_cache`. Saugomi request, scoring,
providerio režimas, matricos laikas, kandidatų sekos ir atkarpos, pažeidimai,
balai, paaiškinimai, perspėjimai ir local-search statistika. API raktai ir
pilni pirminiai tiekėjų atsakymai nesaugomi.

## Paleidimas

```bash
npm run typecheck
npm test
npm run validate:schema
npm run experiment:routing
npm run benchmark:routing
```

Scenarijų kataloge yra daugiau nei 25 deterministiniai edge cases, penkios
sintetinės Vilniaus darbo dienos ir atskiri 5/10/15/20/30 taškų našumo
paleidimai. CSV naudoja kablelį, UTF-8 ir vieną eilutę vienam kandidatui.

## Žinomi v0.1 ribojimai

- Nėra globalaus optimalumo garantijos.
- Sintetinis manevrų balas nėra reali turn-by-turn analizė.
- Realių kelių apribojimų kokybė priklausys nuo gateway tiekėjo.
- Matrica dabar fiksuojama planuojamo išvykimo pjūviu; daugialaikę matricą turi
  pateikti būsimas gateway.
- Realus HERE prieš Google palyginimas negalimas be abiejų gateway prisijungimų,
  vienodo profilio, kvotų ir pakartotinių kontrolinių paleidimų.
