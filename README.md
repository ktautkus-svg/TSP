# TSP – Tikslus siuntų pristatymas

Vidinis projekto pavadinimo kodas remiasi anglišku „Traveling Salesman
Problem“ terminu. Naudotojui rodomas tik lietuviškas pavadinimas „Tikslus
siuntų pristatymas“.

Logistikos ir pristatymų aplikacija vienai įmonei: vairuotojas vykdo maršrutą
telefone, dispečeris ir administratorius planuoja, skiria ir seka darbą PWA.
Vietinė SQLite lieka darbo kopijos tiesos šaltiniu; darbuotojų paskyros ir
maršrutų sinchronizacija eina per Cloud Run.

## Paleidimas

Reikia Node.js ir Expo palaikomo iOS arba Android įrenginio / emuliatoriaus.

```bash
npm install
npm run start
```

Fizinio iPhone prižiūrimam pilotui vietiniame tinkle:

```powershell
npm run pilot:ios
```

Komanda pati aptinka dabartinį fizinio LAN IPv4, paleidžia gateway iš pagrindinio
SDK 57 projekto, o Expo Go QR – iš gretimos `logistikos-pristatymai-sdk54-test`
telefono kopijos. Ji parodo SDK, iPhone Safari health ir Expo URL, nekeičia
source failų, `.env` ar Windows Firewall taisyklių ir nespausdina API raktų.

Kitame terminale sustabdykite tik šio projekto pilotinius procesus:

```powershell
npm run pilot:stop
```

Patikros:

```bash
npm run typecheck
npm run lint
npm test
npm run validate:schema
npm run pwa:build
npm run pwa:test
```

Pull request'uose ir `push` į GitHub tas pats rinkinys paleidžiamas workflow
`.github/workflows/ci.yml`. Cloud Run deploy yra atskiras workflow ir
nepanaikina jau vykstančio produkcinio deploy.

Aktuali projekto būsena, kanoninio kodo ribos ir paskutinės patikros aprašytos
[`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). Produkcinė aplikacija yra pagrindiniame
`src/` medyje; `tsp-integration/` ir `tsp-premium-cockpit/` nėra pagrindinio build'o dalis.

`validate:schema` naudoja Node integruotą SQLite ir reikalauja Node 22.5 arba
naujesnės versijos. Mobilioji aplikacija nuo šio kūrimo įrankio nepriklauso.

## Realių providerio matricų laboratorija

```bash
npm run gateway:dev
npm run gateway:test
npm run benchmark:routing:synthetic
npm run benchmark:routing:real
npm run benchmark:routing:cache
```

Serverio aplinkos kintamųjų šablonas yra `.env.example`. API raktų negalima
vardinti `EXPO_PUBLIC_*` ar įtraukti į Expo konfigūraciją. Išsamiau:
[`docs/REAL_PROVIDER_COMPARISON.md`](docs/REAL_PROVIDER_COMPARISON.md).

## Svarbiausi dokumentai

- [Darbuotojų paskyros v1](docs/EMPLOYEE_ACCOUNTS_V1.md)
- [LOGISTICS_EXCEL_V1 importas](docs/EXCEL_IMPORT_V1.md)
- [Techninis projektas](docs/TECHNICAL_DESIGN.md)
- [Routing Engine v0.1](docs/ROUTING_ENGINE_V0_1.md)
- [Routing Engine įgyvendinimo ataskaita](docs/ROUTING_IMPLEMENTATION_REPORT.md)
- [Routing scoring](docs/ROUTING_SCORING.md)
- [Provider adapteriai](docs/ROUTING_PROVIDER_ADAPTERS.md)
- [Daugiakriteris optimizavimas ir kelionės lapai](docs/OPTIMIZATION_AND_TRIP_SHEETS.md)
- [Minimalus provider palyginimo eksperimentas](experiments/provider-comparison/README.md)
- [Sprendimas: Expo + SQLite](docs/adr/0001-expo-sqlite-local-first.md)
- [MVP darbų sąrašas](docs/MVP_BACKLOG.md)

## Dabartinė riba

Įgyvendinta:

- Expo SDK 57 / React Native / TypeScript ir produkcinė PWA (Cloud Run);
- Expo Router ekranai vairuotojui, dispečeriui ir administratoriui;
- vietinė SQLite su versijuotomis migracijomis (`SCHEMA_VERSION` 27);
- maršruto kūrimas, importas (nuotrauka, dokumentas, tekstas, rankinis, Excel),
  planavimas, alternatyvos, rankinis eiliškumas, krovimas ir pristatymas;
- OCR (Google Vision / mock), geokodavimas ir routing gateway su fail-closed
  `GATEWAY_REAL_PROVIDER_ARMED`;
- swipe pristatymo / krovimo veiksmai ir Waze / Apple Maps / Google Maps;
- kelionės lapai, degalai, dienos kilometrai kaip nuvažiuoti km, Excel eksportas;
- darbuotojų paskyros (`admin` / `dispatcher` / `driver`) ir maršrutų cloud sync;
- PWA JSON atsarginė kopija ir atkūrimas.

Dar neįgyvendinta arba tik iš dalies:

- fizinis iPhone priėmimo testas be priežiūros;
- Cloud Sync v2 likusios fazės (ne maršruto entitetai: vietos, nuostatos,
  atskiri kelionės lapai);
- keli istoriniame MVP sąraše likę punktai, pvz. dinaminis likusios maršruto
  dalies perskaičiavimas.

Aktuali būsena: [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). Istorinės
ataskaitos (`docs/*_REPORT.md`, `docs/MVP_BACKLOG.md`) paliekamos kaip buvo.
