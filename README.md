# Mano pristatymai

Asmeninė, vienam vairuotojui skirta logistikos aplikacija. Dabartinė pilotinė
versija leidžia importuoti ir suplanuoti maršrutą, krautis, vykdyti pristatymus,
atkurti būseną iš SQLite, užbaigti Route ir peržiūrėti istoriją.

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
npm test
npm run validate:schema
npm run experiment:routing
npm run benchmark:routing
```

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

- Expo SDK 57 / React Native / TypeScript projekto bazė;
- Expo Router ekranų struktūra;
- vietinė SQLite duomenų bazė su versijuotomis migracijomis;
- `Route`, `DeliveryStop`, `ImportSource`, pristatymo bandymų ir atšaukimo žurnalo schema;
- `Vehicle`, `TripSheet`, `FuelEntry`, optimizavimo rezultatų, apribojimų ir audito schema;
- domeno būsenos, jų perėjimų apsaugos ir odometro validavimo funkcija;
- tonkilometrių, daugiakriterio balo, laiko KPI ir pilno bako degalų skaičiavimai;
- būsimo OCR, maršruto optimizavimo ir krovinio išdėstymo adapterių kontraktai;
- bazinis, viena ranka valdomas ir planšetei prisitaikantis UI karkasas.

Dar neįgyvendinta:

- pilnas maršruto kūrimas, redagavimas ir vykdymas;
- OCR, geokodavimas ir optimizavimo tiekėjas;
- swipe gestai, navigacijos programėlių atidarymas ir eksportas / atsarginės kopijos.

Tai yra numatyta etapais techniniame projekte ir MVP darbų sąraše.
