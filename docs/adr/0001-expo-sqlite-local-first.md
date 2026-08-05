# ADR-0001: Expo ir SQLite local-first architektūra

- Būsena: priimta
- Data: 2026-07-29

## Kontekstas

Aplikacija skirta vienam vairuotojui, turi veikti iOS ir Android telefonuose bei
planšetėse, negali prarasti vykdomo maršruto ir pagrindinėms operacijoms neturi
reikėti interneto. Serveris, paskyros ir kelių naudotojų sinchronizacija šiame
etape nereikalingi.

## Sprendimas

Naudoti:

- React Native su Expo SDK 57 ir TypeScript;
- Expo Router navigacijai;
- `expo-sqlite` kaip vienintelį patikimą domeno duomenų šaltinį;
- ploną repository sluoksnį ir aiškius aplikacijos paslaugų / integracijų portus;
- SQLite WAL režimą, svetimus raktus, migracijas ir transakcijas kiekvienam
  būseną keičiančiam veiksmui.

UI būsena (atidarytas filtras, modalas) gali būti React būsenoje, tačiau
maršrutas, taškai, swipe rezultatai, komentarai ir odometras visada pirmiausia
įrašomi į SQLite. Programą perkrovus aktyvus maršrutas atkuriamas pagal duomenų
bazę, o ne pagal paskutinį atidarytą ekraną.

## Pasekmės

Privalumai:

- viena kodo bazė iOS ir Android;
- greitas veikimas ir pilnas vykdymas be interneto;
- duomenys išlieka po proceso nutraukimo;
- nėra ankstyvo backend ar autentifikacijos sudėtingumo;
- vėliau galima pridėti eksportą arba sinchronizavimo adapterį.

Kompromisai:

- geokodavimui ir tikram maršruto optimizavimui vis tiek reikės interneto arba
  gerokai didesnio lokalaus žemėlapių sprendimo;
- duomenys pagal nutylėjimą gyvena viename įrenginyje, kol neįgyvendintas backup;
- SQLCipher reikalautų development / production build ir saugaus rakto valdymo,
  todėl nėra aktyvuojamas Expo Go prototipe.

## Atmestos alternatyvos

- Flutter: techniškai tinkamas ir našus, bet šiam produktui nesuteikia aiškaus
  pranašumo prieš Expo, o TypeScript / Expo ekosistemoje greitesnis MVP.
- Grynos iOS ir Android aplikacijos: geriausia platforminė kontrolė, bet dvi kodo
  bazės vieno naudotojo produktui yra neproporcinga kaina.
- PWA: paprastesnis diegimas, tačiau failų / kameros / išorinių navigacijos
  programėlių ir ilgalaikio lokalaus vykdymo patikimumas mobiliame darbo scenarijuje
  yra silpnesnis.
- Debesų DB kaip pirminis šaltinis: prieštarauja offline-first reikalavimui ir
  be reikalo įveda paskyras, tinklo klaidas bei konfliktus.

## Oficialios nuorodos

- Expo SQLite (SDK 57): https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
- Expo Router (SDK 57): https://docs.expo.dev/versions/v57.0.0/sdk/router/
- Expo local-first apžvalga: https://docs.expo.dev/guides/local-first/

## 2026-07-29 papildymas: optimizavimo gateway

Daugiakriteris optimizavimas nekeičia local-first sprendimo. SQLite lieka domeno
tiesos šaltinis, o jau išsaugotas maršrutas vykdomas be interneto.

Naujai eismo prognozei, truck kelių apribojimams ir sudėtingam sprendikliui
leidžiamas siauras Optimization Gateway:

- jis nelaiko bendros naudotojų ar įmonės duomenų bazės;
- jis apsaugo komercinių kelių / eismo tiekėjų API raktus;
- priima vieno planavimo problemos snapshot;
- grąžina rekomenduojamą ir iki dviejų alternatyvų;
- pasirinktas rezultatas, kriterijai ir auditas iškart išsaugomi vietinėje DB;
- neveikiant tinklui lieka rankinis planavimas ir ankstesnio plano vykdymas.

Tai nėra autentifikacijos ar sinchronizavimo backend. Jei ateityje atsiras backup
ar kelių įrenginių sinchronizavimas, tam reikės atskiro ADR.
