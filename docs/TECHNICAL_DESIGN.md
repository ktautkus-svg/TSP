# Asmeninės logistikos aplikacijos techninis projektas

## 1. Apimtis ir projektavimo principai

Produktas skirtas vienam asmeniniam vairuotojui viename įrenginyje. Nėra
registracijos, prisijungimo, klientų paskyrų, parašų, kelių vairuotojų ar įmonės
administravimo. Pirminė produkto vertė – patikimai susikurti maršrutą, pasikrauti,
vykdyti pristatymus, tęsti po programos uždarymo ir turėti tikslią istoriją.

Pagrindiniai invariantai:

1. SQLite yra vienintelis domeno duomenų tiesos šaltinis.
2. Kiekvienas būseną keičiantis veiksmas išsaugomas prieš UI parodant sėkmę.
3. Vienu metu leidžiamas vienas neužbaigtas maršrutas.
4. Swipe nieko netrina; jis tik kuria atsekamą būsenos įvykį.
5. Nepavykusio pristatymo komentaras niekada neišnyksta iš bandymų istorijos.
6. Vykdymui nereikia tinklo, jeigu maršrutas jau suplanuotas ir išsaugotas.
7. Išorinės paslaugos (OCR, geokodavimas, optimizavimas, backup) yra adapteriai,
   o ne domeno branduolio dalis.

## 2. Siūloma architektūra

Naudojama sluoksninė, local-first architektūra:

```text
Expo Router ekranai ir komponentai
                │
        aplikacijos scenarijai
                │
    domeno taisyklės ir būsenų mašinos
                │
      repository / transakcijų sluoksnis
                │
       expo-sqlite (vietinis šaltinis)

Išoriniai adapteriai:
OCR ─┐
Geokodavimas ─┼─> aplikacijos portai ─> išsaugotas rezultatas SQLite
Optimizavimas ─┤
Backup ────────┘
```

### 2.1 UI sluoksnis

Expo Router valdo ekranus ir giliąsias nuorodas. Ekranai neturi vykdyti SQL.
Jie kviečia naudojimo scenarijus ir rodo iš SQLite užkrautą projekciją.

React būsenoje laikoma tik laikina UI informacija:

- pasirinktas filtras;
- atidarytas dialogas;
- nepatvirtintas formos tekstas;
- animacijos eiga.

Maršruto būsena, taško būsena, komentaras, eiliškumas ir odometras nėra laikina
UI būsena.

### 2.2 Aplikacijos sluoksnis

Po vieną aiškią komandą kiekvienam veiksmui:

- `CreateDraftRoute`;
- `ImportStops`;
- `ReviewAndSaveStops`;
- `PlanRoute`;
- `ReorderStops`;
- `StartLoading`;
- `MarkStopLoaded`;
- `UndoLastAction`;
- `SetStartOdometer`;
- `StartRoute`;
- `MarkDelivered`;
- `MarkFailed`;
- `SetEndOdometer`;
- `CompleteRoute`.

Komanda validuoja domeno taisykles ir vienoje išskirtinėje
`withExclusiveTransactionAsync` DB transakcijoje keičia pagrindinę lentelę,
įrašo veiksmų žurnalą bei perskaičiuoja suvestines. Išskirtinė transakcija
pasirinkta sąmoningai, nes SDK 57 dokumentacija perspėja, kad paprasta async
transakcija gali netikėtai įtraukti už jos callback ribų tuo metu vykdomas
užklausas.

### 2.3 Domeno sluoksnis

Grynos TypeScript funkcijos:

- leidžiami būsenų perėjimai;
- odometro validacija;
- likusių taškų / kilogramų skaičiavimas;
- užbaigimo santrauka;
- pristatymo filtrų semantika.

Šis sluoksnis neturi React, Expo ar SQLite priklausomybių ir testuojamas greitais
unit testais.

### 2.4 Duomenų sluoksnis

`expo-sqlite`, WAL režimas, `foreign_keys=ON`, parametrizuotos užklausos ir
migracijos pagal `PRAGMA user_version`.

Rašymo transakcijos yra trumpos. Pavyzdžiui, sėkmingo swipe transakcija:

1. perskaito dabartinę taško būseną;
2. patikrina leidžiamą perėjimą;
3. įterpia `delivery_attempts`;
4. atnaujina `delivery_stops`;
5. perskaičiuoja maršruto likučius;
6. įterpia `action_journal` su prieš / po reikšmėmis;
7. commit;
8. tik tada UI parodo sėkmę ir „Atšaukti“.

## 3. Technologijų pasirinkimas

### Pagrindinis pasirinkimas

| Sritis | Technologija | Pagrindimas |
|---|---|---|
| Mobilioji aplikacija | React Native + Expo SDK 57 | Viena kodo bazė, iOS/Android, geras telefono ir planšetės palaikymas |
| Kalba | TypeScript strict | Būsenų ir duomenų kontraktų sauga |
| Navigacija | Expo Router | Failais pagrįsti ekranai, typed routes, deep-link pagrindas |
| Duomenys | `expo-sqlite` | Patvaru po perkrovimo, transakcijos, indeksai, offline |
| Gestai | `react-native-gesture-handler` | Swipe, tačiau visada lieka matomi mygtukai |
| Animacija | `react-native-reanimated` | Sklandi kortelių / undo animacija, jau suderinama su Expo |
| Testai | Vitest domenui, React Native Testing Library UI, Maestro E2E | Greiti unit testai ir realių mobilių scenarijų patikra |
| Build | EAS Build | Pasirašyti iOS / Android development ir production build |

Expo + SQLite yra tinkamiausias pasirinkimas šiai apimčiai. Jis nedaro serverio
privalomo, išlaiko vieną kodo bazę ir leidžia atomines būsenos transakcijas.

### Alternatyvos tik su aiškiu pranašumu

- Flutter verta rinktis, jei komanda jau stipriai dirba su Dart arba reikia labai
  individualaus, identiško abiejose platformose renderinimo.
- Grynas Swift / Kotlin pagrįstas tik tada, jei atsiranda gilios platforminės
  integracijos, kurių Expo moduliai negali patikimai suteikti.
- PWA nėra rekomenduojama pagrindiniam darbo įrankiui dėl silpnesnių garantijų
  naudojant kamerą, lokalius failus, background būseną ir navigacijos aplikacijas.

## 4. Ekranai ir navigacija

```text
Dashboard
├── Naujas maršrutas
│   ├── Įklijuoti tekstą
│   ├── Įvesti ranka
│   └── Nuotrauka / dokumentas [adapteris vėliau]
│       └── Atpažintų taškų patikra
│           └── Planavimo režimas
│               └── Tvarkos peržiūra / rankinis perrikiavimas
├── Krautis
│   └── Pradinis odometras (praleidžiamas)
├── Tęsti maršrutą
│   ├── Visi
│   ├── Liko nepristatyti [numatytasis]
│   ├── Sėkmingi
│   └── Nepavykę
│       ├── Atidaryti navigaciją
│       ├── Pristatyta
│       └── Nepavyko → privalomas komentaras
│   └── Užbaigimo santrauka → galutinis odometras
├── Istorija
│   └── Maršruto detalė
└── Statistika
    ├── Diena
    ├── Savaitė
    └── Mėnuo
```

### Dashboard taisyklės

Prieš maršrutą rodomi `totalWeightKg`, `totalStops`,
`estimatedDistanceKm` ir vienas pagrindinis mygtukas „Krautis“.

Vykstant maršrutui:

- `remainingStops = count(stop.deliveryStatus != delivered)`;
- `remainingWeightKg = sum(weightKg, kur deliveryStatus != delivered)`;
- progresas `((totalStops - remainingStops) / totalStops) * 100`;
- likę kilometrai yra preliminari reikšmė pagal likusių atkarpų sumą. Jei atkarpų
  duomenų nėra, rodoma „—“, o ne klaidinantis skaičius;
- pagrindinis mygtukas „Tęsti maršrutą“;
- jei nėra pradinio odometro, rodoma ryški, bet neblokuojanti juosta.

`failed` laikomas nepristatytu. Todėl jis lieka svarbiausiame filtre, svorio ir
taškų likučiuose net jei taškas jau buvo aplankytas.

### Krovimasis

DB užklausa rikiuoja `optimized_order DESC`. Jeigu planas dar neturi optimizuotos
tvarkos, naudojama `original_order DESC`. Swipe į dešinę ir matomas „Pakrauta“
mygtukas kviečia tą pačią komandą.

Pakrovus paskutinį tašką:

1. maršrutas tampa `loaded`;
2. rodomas pradinio odometro dialogas;
3. „Praleisti“ palieka `start_odometer=NULL`;
4. Dashboard primena, kol rodmuo įvestas arba maršrutas užbaigtas.

### Pristatymas ir navigacija

Adreso paspaudimas:

1. tikrina Waze URL schemą;
2. jei prieinama, atidaro Waze su koordinatėmis, o jų neturint – su užkoduotu adresu;
3. jei ne, naudoja Google Maps / Apple Maps arba sistemos geo nuorodą;
4. jei niekas neatsidaro, leidžia nukopijuoti adresą.

Navigacija nekeičia pristatymo būsenos.

Swipe į kairę pirmiausia atidaro privalomo komentaro dialogą. Duomenys rašomi tik
patvirtinus ne tuščią komentarą. Uždarius dialogą būsena lieka nepakitusi.

## 5. Duomenų bazės schema

Tikslus pradinis DDL yra `src/database/migrations.ts`.

### `routes`

| Laukas | Tipas | Pastaba |
|---|---|---|
| `id` | TEXT PK | UUID |
| `date` | TEXT | vietinė maršruto data `YYYY-MM-DD` |
| `status` | TEXT CHECK | `draft`, `planned`, `loading`, `loaded`, `in_progress`, `completed` |
| `planning_mode` | TEXT NULL | su / be laiko langų |
| `estimated_distance_km` | REAL NULL | planuota |
| `actual_distance_km` | REAL NULL | iš odometro |
| `total_weight_kg` | REAL | išvestinė cache reikšmė |
| `remaining_weight_kg` | REAL | išvestinė cache reikšmė |
| `total_stops` | INTEGER | išvestinė cache reikšmė |
| `remaining_stops` | INTEGER | ne `delivered` taškai |
| `start_odometer` | REAL NULL | praleidžiamas |
| `end_odometer` | REAL NULL | užbaigiant |
| `created_at`, `updated_at` | TEXT | ISO-8601 UTC |
| `started_at`, `completed_at` | TEXT NULL | techniniai laikai |

Dalinis unikalus indeksas leidžia tik vieną maršrutą, kurio būsena nėra
`completed`.

### `delivery_stops`

Atitinka reikalaujamus laukus. Pakrovimo ir pristatymo būsenos sąmoningai
atskirtos:

- `loading_status`: `pending` / `loaded`;
- `delivery_status`: `pending` / `delivered` / `failed`.

Tai pašalina dviprasmybę, kai taškas jau pakrautas, bet dar nepristatytas.
`original_order` nekinta. `optimized_order` saugo aktyvią suplanuotą / rankiniu
būdu pakeistą vykdymo tvarką.

### `import_sources`

Saugo importo tipą, originalų įklijuotą tekstą ar programos sandbox'e esančio
dokumento nuorodą. Atpažinti laukai rašomi į `delivery_stops`, bet originalas
išlieka auditui ir pakartotinei patikrai.

### Papildomos patikimumo lentelės

- `delivery_attempts`: kiekvienas sėkmingas ar nepavykęs bandymas. Nepavykusiam
  būtinas komentaras. Vėlesnė sėkmė seno komentaro neištrina.
- `action_journal`: prieš / po JSON, atšaukimo terminas ir `undone_at`.
- `route_order_snapshots`: originali, optimizuota ir rankinė taškų tvarkos
  versijos.

### Skaičiuojami rodikliai

`routes` suvestinės saugomos greitam Dashboard, tačiau bet kada gali būti
atkurtos iš `delivery_stops`. Po kiekvienos svarbios transakcijos:

```sql
total_stops = COUNT(*)
total_weight_kg = SUM(weight_kg)
remaining_stops = COUNT(*) WHERE delivery_status <> 'delivered'
remaining_weight_kg = SUM(weight_kg) WHERE delivery_status <> 'delivered'
```

Istorinė statistika skaičiuojama iš užbaigtų maršrutų ir taškų, o ne iš atskiro
lengvai išsiderinančio skaitiklio.

## 6. Būsenos ir perėjimai

### Route

```text
draft → planned → loading → loaded → in_progress → completed
          ↑          │        │
          └──────────┘        └→ loading (tik aiškiai grįžus taisyti pakrovimo)
```

Praktinės taisyklės:

- `draft → planned`: visi taškai patikrinti, pasirinktas režimas, išsaugota tvarka;
- `planned → loading`: paspausta „Krautis“;
- `loading → loaded`: visi taškai pakrauti;
- `loaded → in_progress`: patvirtinta pradėti maršrutą;
- `in_progress → completed`: parodyta santrauka, patvirtintas įspėjimas dėl
  nepristatytų taškų, odometras įvestas arba aiškiai praleistas.

Grįžtamieji perėjimai skirti tik korekcijai ir turi būti aiškus veiksmas, ne
atsitiktinis navigacijos „back“.

### Pakrovimo būsena

```text
pending ⇄ loaded
```

Atgal į `pending` grįžtama per „Atšaukti“ arba matomą koregavimo veiksmą.

### Pristatymo būsena

```text
pending → delivered
   │
   └→ failed → delivered
              ↘ failed (naujas bandymas ir komentaras)

delivered → pending (tik undo / korekcija)
failed → pending    (tik undo / korekcija)
```

`failed → delivered` leidžia kitą dieną sėkmingai užbaigti ankstesnį nepavykusį
tašką. Visi bandymai išlieka `delivery_attempts`.

### Programos atkūrimas

Paleidžiant:

1. atliekamos DB migracijos;
2. ieškomas vienintelis neužbaigtas maršrutas;
3. pagal jo būseną parenkamas Dashboard CTA;
4. skaičiai perskaitomi iš DB;
5. atidarius pristatymus numatytas filtras yra „Liko nepristatyti“.

Nereikia saugoti „dabartinio ekrano“ kaip verslo būsenos. Tai apsaugo nuo
neteisingo atkūrimo, jei programa buvo uždaryta modalo ar animacijos metu.

## 7. Pagrindiniai naudotojo scenarijai

### A. Įklijuotas tekstas

1. Dashboard → „Naujas maršrutas“.
2. „Įklijuoti tekstą“.
3. Originalas iškart susiejamas su draft maršrutu.
4. Parseris sukuria laukų kandidatus.
5. Naudotojas pataiso lentelę; adresas ir gavėjas negali likti be aiškaus
   patvirtinimo.
6. Pasirenka planavimą su arba be laikų.
7. Sistema geokoduoja / optimizuoja, rodo įspėjimus.
8. Naudotojas gali perrikiuoti.
9. Išsaugomi originalus ir aktyvus eiliškumai, atstumas, svoris, taškų skaičius.

### B. Rankinis maršrutas

1. Sukuriamas draft.
2. Pildoma viena trumpa taško forma, „Išsaugoti ir pridėti kitą“.
3. Bendra patikra ir planavimas toks pats kaip importuotam maršrutui.

### C. Krovimasis

1. Dashboard → „Krautis“.
2. Paskutinis pristatymas rodomas pirmas.
3. Swipe / mygtukas „Pakrauta“ iškart išsaugomas.
4. Klaidos atveju snackbar „Pakrauta · Atšaukti“ atkuria ankstesnę būseną.
5. Perkrovus programą jau pakrautos kortelės lieka pakrautos.
6. Pabaigoje odometras įvedamas arba praleidžiamas su priminimu.

### D. Pristatymas nepavyko ir tęsiamas kitą dieną

1. Taške swipe į kairę.
2. Įvedamas privalomas komentaras.
3. Viena transakcija išsaugo bandymą, būseną ir action journal.
4. Taškas lieka „Liko nepristatyti“.
5. Kitą dieną aktyvus maršrutas atkuriamas.
6. Sėkmingai pristačius būsena tampa `delivered`, bet vakarykštis komentaras
   matomas istorijos bandymuose.

### E. Užbaigimas su likusiais taškais

1. „Užbaigti maršrutą“.
2. Įvedamas galutinis odometras arba aiškiai praleidžiamas.
3. Rodoma pristatyta / nepristatyta kg, sėkmių / nesėkmių skaičius ir odometras.
4. Jei yra ne `delivered` taškų, rodomas konkretus skaičius ir antras patvirtinimas.
5. Patvirtinus maršrutas tampa `completed`; niekas netrinama.

## 8. Patikimumas, saugumas ir privatumas

- Jokio destructive swipe ir jokio fizinio pristatymo įrašų trynimo.
- Visos SQL užklausos su naudotojo duomenimis parametrizuotos.
- WAL pagerina atsparumą nutrūkus rašymui ir skaitymo / rašymo darbą.
- DB `CHECK`, `FOREIGN KEY`, `UNIQUE` ir daliniai indeksai saugo invariantus net
  esant programavimo klaidai.
- Kortelė optimistiškai animuojama tik po DB commit arba prireikus grąžinama.
- „Atšaukti“ įrašomas DB; tai nėra vien laikinas `setTimeout`.
- Dokumentai kopijuojami į programos privatų katalogą; laikina kameros nuoroda
  neturi būti vienintelis šaltinis.
- Telefono numeriai ir adresai yra asmens duomenys. Nesiųsti telemetrijai,
  crash-report payload ar trečiajai šaliai be aiškaus poreikio.
- Pirmas production etapas gali remtis OS įrenginio šifravimu. Jei grėsmės modelis
  reikalauja DB šifravimo, įjungti SQLCipher per Expo config plugin ir raktą laikyti
  SecureStore; tai reikalauja native build ir rakto atkūrimo strategijos.
- Backup / eksportas vėliau turi būti aiškus naudotojo veiksmas, versijuotas ir
  prieš importą validuojamas.

## 9. Rizikos ir neaiškios vietos

| Rizika / klausimas | Poveikis | Siūlomas sprendimas |
|---|---|---|
| Optimizavimo tiekėjas, kaina ir API limitai nepasirinkti | Negalima tiksliai suplanuoti atstumo | MVP adapteris; pradėti nuo rankinės / originalios tvarkos, tiekėją rinktis atskirai |
| Geokodavimas be interneto | Naujo maršruto negalima pilnai optimizuoti offline | Leisti išsaugoti adresus ir planuoti vėliau; vykdymas su jau išsaugotais duomenimis offline |
| Laiko langų optimizavimo semantika | „Optimalus“ gali būti neįmanomas | Rodyti įspėjimą, ne melagingą garantiją; aprašyti vėlavimus / konfliktus |
| OCR dokumentų formatų įvairovė | Klaidingi laukai | Visada privaloma patikros lentelė ir confidence žymėjimas |
| Waze / Maps URL schemos ir platformų skirtumai | Navigacija gali neatsidaryti | Capability check, keli fallback ir „Kopijuoti adresą“ |
| „Išvežioti kg“ statistikos prasmė | Gali reikšti pakrauta arba pristatyta | MVP rodyti aiškų „Pristatyta kg“; prieš statistiką patvirtinti terminą |
| „Aplankytas taškas“ | Pakartotiniai bandymai gali būti skaičiuojami dvigubai | Skaičiuoti unikalius taškus, turinčius bent vieną attempt; bandymų skaičių laikyti istorijoje |
| Logiško odometro skirtumo riba | 1000 km gali netikti | Konfigūruojama riba; viršijus įspėti ir reikalauti pakartotinio patvirtinimo, ne tyliai atmesti |
| Pradinis odometras praleistas | Faktinis km neapskaičiuojamas | Aiškus Dashboard priminimas; istorijoje rodyti „neįvesta“, nespėlioti |
| Vienas aktyvus maršrutas | Naujas maršrutas kitai dienai gali būti reikalingas | Reikalavimas sako vienas vairuotojas, bet ne aiškiai vienas aktyvus maršrutas; MVP saugiausia vienas, vėliau galima sušvelninti indeksą |
| Įrenginio praradimas | Vietiniai duomenys prarandami | Anksti po MVP pridėti šifruotą eksportą / OS backup strategiją |
| Didelis adresų skaičius | Swipe sąrašo našumas | Virtualizuotas `FlatList`, indeksai ir puslapinis istorijos skaitymas |
| SDK 57 transitive audit įspėjimai | `npm audit` šiuo metu rodo moderate Expo build įrankių grandinėje | Nenaudoti siūlomo priverstinio downgrade į SDK 46; sekti Expo pataisas ir atnaujinti tik suderinamą SDK 57 patch / kitą oficialų SDK |

## 10. MVP kūrimo etapai

### 0. Pamatai (šis etapas)

- Expo / TypeScript / Router;
- SQLite schema, migracija, domeno tipai;
- integracijų portai;
- ekranų karkasai, ADR ir testavimo planas.

Baigtumo kriterijus: `npm run typecheck` ir domeno testai praeina, DB sukuriama
švariame įrenginyje.

### 1. Draft ir rankinis / copy-paste įvedimas

- vieno aktyvaus draft kūrimas;
- originalaus teksto išsaugojimas;
- deterministinis eilučių skaidymas;
- taškų CRUD patikros lentelėje;
- svorio ir taškų suvestinė.

### 2. Planavimas ir tvarka

- planavimo režimo pasirinkimas;
- geokodavimo / optimizavimo adapteris arba aiškus rankinis fallback;
- originalus, optimizuotas ir rankinis eiliškumas;
- drag-to-reorder;
- preliminaraus atstumo išsaugojimas.

### 3. Krovimosi režimas

- atvirkštinis sąrašas;
- swipe ir matomas mygtukas;
- persistuojantis undo;
- pakrovimo progresas;
- pradinis odometras ir priminimas.

### 4. Pristatymo režimas

- filtrai, numatytasis „Liko nepristatyti“;
- Waze / Maps fallback;
- sėkmės / nesėkmės swipe ir mygtukai;
- privalomas nesėkmės komentaras;
- automatinis Dashboard atnaujinimas ir tęstinumas po perkrovimo.

### 5. Užbaigimas, istorija ir statistika

- galutinio odometro validacija;
- užbaigimo santrauka ir įspėjimas;
- istorijos sąrašas / detalė / bandymų komentarai;
- dienos, savaitės, mėnesio agregatai be perteklinių grafikų.

### 6. Dokumentų / nuotraukų importas

- camera / document picker;
- saugus failo nukopijavimas;
- OCR ir struktūrizavimo adapteris;
- confidence ir privaloma žmogaus patikra.

### 7. Stabilizavimas ir platinimas

- realių įrenginių E2E;
- crash recovery ir migracijų testai;
- privatumo patikra;
- development / production EAS build;
- atsarginio eksporto projektas.

Būsimas cargo layout optimizatorius nėra MVP etapas ir kuriamas atskiru moduliu
tik stabilizavus pagrindinį maršruto vykdymą.

## 11. Testavimo scenarijai

### Unit

1. Kiekvienas leidžiamas ir draudžiamas Route perėjimas.
2. `pending/failed/delivered` perėjimai ir undo.
3. Galutinis odometras mažesnis už pradinį.
4. Ne skaičius, neigiamas ir labai didelis odometro skirtumas.
5. Nulinis atstumas.
6. Progreso skaičiavimas su 0 taškų.
7. Failed taško kg ir taškas lieka likučiuose.
8. Vėliau delivered tapęs failed taškas iš likučių pašalinamas.
9. Filtras „Liko nepristatyti“ grąžina pending ir failed.
10. Krovimosi tvarka yra pristatymo tvarkos reverse.

### SQLite integraciniai

1. Švari DB migruoja į `user_version=1`.
2. Migracija pakartotinai vykdoma saugiai.
3. Foreign keys neleidžia orphan stop / attempt.
4. Negalima turėti dviejų aktyvių maršrutų.
5. Galima turėti neribotą užbaigtų maršrutų istoriją.
6. Viena swipe transakcija sukuria attempt, pakeičia stop, suvestinę ir journal.
7. Dirbtinė klaida transakcijos viduryje nepalieka dalinių duomenų.
8. Failed be komentaro atmetamas.
9. Undo tiksliai atkuria prieš tai buvusią būseną.
10. Antras attempt seno komentaro neištrina.
11. Optimized order unikalus maršruto ribose.
12. Route delete testinėje aplinkoje cascade pašalina priklausomus įrašus.

### UI / komponentų

1. Visi swipe veiksmai turi matomą mygtuko alternatyvą.
2. Minimali touch zona bent 48x48.
3. Nesėkmės dialogo negalima patvirtinti tuščio.
4. Uždarius nesėkmės dialogą būsena nekinta.
5. Undo snackbar skaitomas ekrano skaitytuvo.
6. Ilgi gavėjo, adreso ir pastabų tekstai nelaužo kortelės.
7. 320 px pločio telefonas ir plati planšetė.
8. Didelis sistemos šriftas.
9. Būsenos atskiriamos ne vien spalva.
10. Pagrindinis CTA pasiekiamas apatinėje saugioje zonoje.

### E2E realiame įrenginyje

1. Sukurti maršrutą → uždaryti programą per app switcher → tęsti.
2. Pažymėti kelis pakrautus → priverstinai nutraukti procesą → būsena išlieka.
3. Pristatymas failed su komentaru → kitą dieną atidaryti → taškas nepristatytų filtre.
4. Failed → delivered → istorijoje matomas senas komentaras ir galutinė sėkmė.
5. Swipe klaida → undo → perkrauti → atkurta būsena išlieka.
6. Išjungti internetą vykdomo maršruto metu; visi būsenų veiksmai veikia.
7. Waze įdiegtas / neįdiegtas / nėra koordinačių.
8. Praleisti pradinį odometrą; Dashboard rodo priminimą.
9. Įvesti nelogišką galutinį odometrą; užbaigimas neįvyksta be korekcijos /
   aiškaus patvirtinimo pagal pasirinktą politiką.
10. Užbaigti su nepristatytais; įspėjimas konkretus, istorijoje visi taškai lieka.
11. Android process death ir iOS cold launch.
12. Atnaujinti aplikaciją su esama ankstesnės schemos DB.

## 12. Siūloma katalogų struktūra

```text
logistikos-pristatymai/
├── app.json
├── package.json
├── docs/
│   ├── TECHNICAL_DESIGN.md
│   ├── MVP_BACKLOG.md
│   └── adr/
│       └── 0001-expo-sqlite-local-first.md
├── src/
│   ├── app/                         # Expo Router ekranai
│   │   ├── _layout.tsx
│   │   ├── index.tsx               # Dashboard
│   │   ├── history.tsx
│   │   ├── statistics.tsx
│   │   └── route/
│   │       ├── new.tsx
│   │       └── [id]/
│   │           ├── review.tsx
│   │           ├── loading.tsx
│   │           └── delivery.tsx
│   ├── application/
│   │   ├── ports/                   # OCR, route, cargo, backup sąsajos
│   │   ├── services/                # naudojimo scenarijai
│   │   └── queries/                 # Dashboard / istorijos projekcijos
│   ├── domain/
│   │   ├── route.ts
│   │   ├── transitions.ts
│   │   └── metrics.ts
│   ├── database/
│   │   ├── migrations.ts
│   │   └── repositories/
│   ├── integrations/
│   │   ├── import/
│   │   ├── navigation/
│   │   ├── optimization/
│   │   └── backup/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── route-import/
│   │   ├── route-planning/
│   │   ├── loading/
│   │   ├── delivery/
│   │   ├── history/
│   │   └── statistics/
│   ├── components/
│   └── ui/
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

`cargo-layout` ateityje turi būti atskiras feature / adapteris, priimantis
snapshot tipo įvestį ir grąžinantis išdėstymo planą. Jis neturi rašyti į Route ar
DeliveryStop lenteles tiesiogiai.

## 13. Sąmoningai neįtraukta

- registracija ir prisijungimas;
- klientų paskyros ir parašai;
- keli vairuotojai / įmonės administravimas;
- bendra greita paieška;
- automatinis atvykimo ar pristatymo laiko sekimas;
- gyvas sekimas serveryje;
- krovinio 3D išdėstymo realizacija.

Techniniai `created_at`, `loaded_at`, `delivered_at`, `failed_at`, `started_at` ir
`completed_at` laikai naudojami tik atkūrimui, istorijai ir statistikai.

## 14. Daugiakriteris optimizavimas ir kelionės lapai

Papildyti reikalavimai detalizuoti dokumente
[`OPTIMIZATION_AND_TRIP_SHEETS.md`](OPTIMIZATION_AND_TRIP_SHEETS.md).

Esminiai architektūros pakeitimai:

- optimizavimas nėra viena išorinio Maps API užklausa ar absoliučių heuristikų
  rinkinys;
- hard constraints validuojami prieš soft kriterijų balą;
- tonkilometriai skaičiuojami kiekvienai kelio atkarpai pagal tuo metu vežamą
  svorį;
- eismas ir manevrai ateina per keičiamą `TravelCostProvider`;
- pasirenkamas rezultatas, iki dviejų alternatyvų, kriterijų svoriai,
  paaiškinimai ir eismo snapshot saugomi audite;
- rankiniai pakeitimai ir jau atlikti pristatymai negali būti tyliai perrašomi;
- SQLite v2 prideda Vehicle, TripSheet, FuelEntry, optimizavimo rezultatų,
  constraints, manual edits, laiko kategorijų ir asmeninių vietų lenteles;
- plano įvykdymo ir produktyvaus laiko KPI yra atskiri;
- tikslios faktinės degalų sąnaudos skaičiuojamos tik full-to-full intervalu.
