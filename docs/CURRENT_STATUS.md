# TSP dabartinė projekto būsena

Atnaujinta: 2026-08-19

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

## 2026-08-19 rezultatai

- TypeScript: praėjo.
- ESLint: praėjo.
- SQLite schema: praėjo, schema v21, 32 lentelės.
- PWA testai ir bundle scan: praėjo, 8 testai.
- Pilnas Vitest paleidimas: praėjo, 87 failai ir 784 testai.

## Sinchronizacijos aprėptis

Esami testai tikrina:

- kelių įrenginių paskyros izoliaciją;
- serverio sesijos tapatybės naudojimą vietoje pasenusio kliento profilio;
- konfliktą, kai laimi naujesnė arba terminalinė serverio kopija;
- draudžiamą svetimo savininko maršruto įkėlimą;
- tombstone trynimus;
- atidėtų maršrutų pakartotinį pritaikymą;
- offline klaidos izoliaciją ir nepažeistus vietinius duomenis.

## Dar neatlikta lokaliai

Fizinis iPhone priėmimo testas nėra pakeičiamas automatiniu TypeScript ar PWA testu.
Prieš nesupervizuojamą naudojimą dar reikia patikrinti realų iPhone, Waze/Apple Maps,
Windows Firewall, vietinio gateway pasiekiamumą, safe-area, klaviatūrą ir grįžimą iš
navigacijos į aplikaciją.

Istorines projektines ataskaitas reikia skaityti kartu su šiuo dokumentu; jų ankstesni
testų skaičiai ir schemos versijos nebūtinai atspindi dabartinį kodą.
