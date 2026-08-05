# Daugiakriteris optimizavimas ir kelionės lapo apskaita

## 1. Priimtas projektavimo sprendimas

Optimizatorius nėra taisyklių rinkinys „sunkiausias pirmas“, „tolimiausias pirmas“
ar „mažiausiai kairių posūkių“. Tokios strategijos naudojamos tik kaip skirtingi
pradiniai kandidatai. Galutinis sprendimas parenkamas palyginus visą maršrutą.

Privalomi apribojimai tikrinami leksikografiškai prieš bet kokį pageidaujamų
kriterijų balą:

```text
1. Kandidatas pažeidžia hard constraint? → atmesti
2. Kandidatas įvykdomas?                → skaičiuoti soft kriterijų kainą
3. Keli įvykdomi kandidatai?            → mažesnis normalizuotas balas laimi
```

Tai neleidžia trumpesniam ar „lengvesniam“ maršrutui laimėti, jeigu jis pažeidžia
privalomą pristatymo langą, transporto priemonės ribą ar naudotojo užrakintą
seką.

## 2. Optimizavimo architektūra

```text
Mobilioji aplikacija (Expo + SQLite)
        │  OptimizationRequest be slaptų API raktų
        ▼
Saugus Optimization Gateway
        │
        ├── ConstraintCompiler
        ├── TravelCostProvider
        │     ├── laiko priklausoma atstumų / trukmių matrica
        │     ├── prognozuojamas eismas
        │     ├── truck kelio apribojimai
        │     └── manevrų metaduomenys
        ├── CandidateGenerator / Tour Solver
        ├── IndependentFeasibilityValidator
        ├── MultiCriteriaScoreEngine
        └── ExplanationEngine
                    │
                    ▼
      1 rekomenduojamas + iki 2 alternatyvų
                    │
                    ▼
     SQLite auditas ir offline maršruto vykdymas
```

### Kodėl reikalingas atskiras gateway

- komercinių kelių / eismo API raktai negali būti patikimai paslėpti mobilioje
  aplikacijoje;
- sudėtingesnis sprendiklis gali viršyti mobilios užklausos trukmę ir atmintį;
- tiekėją galima pakeisti neatnaujinant mobilios aplikacijos;
- vienoje vietoje versijuojami kriterijai ir saugomas pakartojamas auditas.

Tai nėra kelių vairuotojų ar įmonės administravimo backend. Jis yra siauras
vieno naudotojo optimizavimo tarpininkas. Pasirinktas maršrutas vis tiek
išsaugomas lokaliai ir vykdomas be interneto.

### Komponentų atsakomybės

`ConstraintCompiler`

- sujungia taškų, transporto priemonės, pradžios / pabaigos ir naudotojo
  apribojimus;
- atskiria hard ir soft;
- aptinka tiesioginius prieštaravimus dar prieš siunčiant sprendikliui.

`TravelCostProvider`

- grąžina ne vien statišką atstumą, bet kainą pagal planuojamą išvykimo laiką;
- atsižvelgia į eismą, truck profilį, kelio apribojimus ir manevrus;
- neparenka pristatymų sekos.

`CandidateGenerator`

- palygina near-to-far, far-to-near, žiedinio ir norimos pabaigos pradines
  strategijas;
- taiko local search / metaheuristiką arba išorinio Tour Planning API sprendiklį;
- generuoja daugiau kandidatų nei rodoma naudotojui.

`IndependentFeasibilityValidator`

- dar kartą tikrina hard constraints tiekėjo atsakyme;
- nepasitiki tuo, kad vien tiekėjas visada teisingai interpretavo vietines
  taisykles;
- neįvykdomam kandidatui neskiria skaitinio soft balo.

`MultiCriteriaScoreEngine`

- normalizuoja skirtingų matavimo vienetų komponentus;
- pritaiko versijuojamus svorius;
- išrenka rekomenduojamą, greičiausią ir svorio prioriteto variantus.

`ExplanationEngine`

- kuria paaiškinimus iš realių balo skirtumų ir aktyvių apribojimų;
- negeneruoja nepatikrintų teiginių;
- pavyzdžiui, „+3 km, bet –14 min.“ rodomas tik jei tai yra kandidatų skirtumas.

## 3. Privalomi ir pageidaujami kriterijai

### Hard constraints

- aiškiai privalomas pristatymo laiko langas;
- maksimalus payload ir maksimalus bendras transporto priemonės svoris;
- aukščio, pločio, ilgio, ašių ar kiti kelių apribojimai, kuriuos palaiko
  pasirinktas kelių tiekėjas;
- fiksuota pozicija;
- `deliver_before` / `deliver_after`;
- privaloma pradžia;
- pasirinkta privaloma pabaiga;
- jau atliktų pristatymų prefiksas dinaminio perskaičiavimo metu.

### Soft criteria

- važiavimo trukmė;
- kilometrai;
- vėlavimo rizika;
- laukimas iki kliento lango;
- tonkilometriai;
- sudėtingi manevrai;
- geografinio kryptingumo pažeidimai;
- nuokrypis nuo norimos pabaigos;
- `prefer_early` / `prefer_late`;
- asmeninės vietos pastabos, jei jos nepažymėtos kaip privalomos.

### Dviejų laiko režimų semantika

Kad reikalavimai nebūtų prieštaringi, atskiriami du dalykai:

- `deliveryTimeFrom/To` – dokumente rastas ar informacinis kliento laikas;
- `required_time_window` su `isHardConstraint=true` – naudotojo aiškiai
  patvirtintas privalomas langas.

„Atsižvelgti į pristatymo laikus“ informacinius langus pagal nutylėjimą paverčia
hard constraints. „Neatsižvelgti“ palieka juos informacinius, tačiau aiškiai
privalomų `required_time_window` nepanaikina. Jeigu produkto noras yra ignoruoti
net aiškiai privalomus langus, UI turi paprašyti atskiro patvirtinimo.

## 4. Bendro balo modelis

Konceptuali formulė:

```text
score =
  w_time        × normalized(drivingMinutes)
+ w_distance    × normalized(distanceKm)
+ w_late        × normalized(lateRiskMinutes)
+ w_wait        × normalized(waitingMinutes)
+ w_load        × normalized(loadDistanceTonneKm)
+ w_maneuver    × normalized(maneuverPenaltyPoints)
+ w_direction   × normalized(directionPenaltyPoints)
+ w_end         × normalized(endLocationPenaltyPoints)
+ w_manual      × normalized(manualPriorityPenaltyPoints)
```

Skirtingi vienetai negali būti tiesiog sudėti. Kiekvienas komponentas
normalizuojamas pagal tos užduoties bazinį kandidatą arba konfigūruotą skalę.
Kartu su rezultatu saugomi raw komponentai, skalės, svoriai ir
`criteriaVersion`.

Numatytasis santykinis prioritetas:

1. hard apribojimų įvykdymas;
2. darbo trukmė;
3. vėlavimo rizika;
4. tonkilometriai;
5. rankiniai prioritetai;
6. kryptingumas;
7. kilometrai;
8. laukimas ir manevrų kaina;
9. norima pabaigos vieta.

Tikslūs koeficientai nėra UI nustatymai. Jie konfigūruojami ir versijuojami
sprendiklyje, o produkto lange rodomi suprantami profiliai.

## 5. Krovinio vežimo rodiklis

Kiekvienai kelio atkarpai:

```text
legTonneKm = legDistanceKm × carriedLoadKg / 1000
routeTonneKm = Σ legTonneKm
```

Naudojamas svoris prieš pasiekiant tos atkarpos pabaigos tašką. Pristačius krovinį,
kitai atkarpai likęs svoris sumažėja.

Šis kriterijus nėra atskira rūšiavimo taisyklė. 800 kg taškas keliamas anksčiau
tik jei sutaupytas load-distance nepablogina hard apribojimų ir nepadidina kitų
kriterijų kainos neproporcingai.

## 6. Kryptingumas ir pabaigos vieta

Sprendiklis turi pradėti paiešką bent iš šių skirtingų seed:

- artimiausi → tolimiausi;
- tolimiausia zona → grįžimas;
- žiedinis;
- pabaiga sandėlyje;
- pabaiga namuose;
- pabaiga naudotojo vietoje.

Seed nėra garantuotas rezultatas. Visi kandidatai toliau gerinami ir lyginami.
Krypties bauda skiriama už bereikalingą grįžimą per jau pravažiuotą teritoriją,
o ne vien už geometrinį nuotolį nuo starto.

## 7. Eismas ir manevrai

Kelionės kaina skaičiuojama pagal numatomą įvažiavimo į atkarpą laiką. Statiška
viena matrica visai dienai nepakankama. Galimi metodai:

- tiekėjo time-dependent tour planning;
- iteracinė matrica: preliminari seka → ETA → atnaujintos atkarpų kainos →
  pakartotinis sprendimas;
- keli eismo scenarijai vėlavimo rizikai įvertinti.

Manevrai yra soft kaina:

- neapsaugotas kairysis posūkis;
- apsisukimas;
- sudėtingas persirikiavimas;
- kartojama kelio atkarpa;
- akligatvis;
- sudėtingas sunkiasvorės transporto priemonės įvažiavimas.

Normalus reguliuojamas kairysis posūkis neturi automatiškai sukelti didelės
baudos. Jei trumpesnis variantas sutaupo daug laiko, jis gali laimėti.

## 8. Aptarnavimo trukmė

`DeliveryStop.serviceDurationMinutes` pagal nutylėjimą yra 10 minučių ir gali
būti pakeistas į 5, 20 ar individualią reikšmę.

```text
total =
  driving
+ traffic delay (jau įtrauktas į time-dependent driving)
+ waiting
+ service
```

Planuotas atvykimas į kitą tašką skaičiuojamas nuo ankstesnio
`plannedDepartureAt`, ne nuo atvykimo. Ateities gavėjo istorijos pasiūlymas yra
soft rekomendacija, kol naudotojas jo nepatvirtino.

## 9. Alternatyvos ir paaiškinimai

Rodoma daugiausia:

1. Rekomenduojamas – geriausias bendras balansas.
2. Greičiausias – didesnis darbo trukmės svoris.
3. Svorio prioritetas – didesnis tonkilometrių svoris.

Kortelėje rodoma:

- bendra trukmė;
- kilometrai;
- tonkilometriai arba paprastas „krovinys vežamas trumpiau“ palyginimas;
- vėlavimo rizikos taškų skaičius;
- pabaigos vieta;
- skirtumas nuo rekomenduojamo.

Paaiškinimai yra trumpi ir faktiniai:

- „Taškas perkeltas anksčiau dėl privalomo pristatymo iki 10:00.“
- „800 kg krovinys vežamas 42 km trumpiau.“
- „Variantas 3 km ilgesnis, bet prognozuojamas 14 min. greitesnis.“
- „Pabaiga pasirinkta prie namų; išvengiamas 18 km grįžimas.“

## 10. Rankinis koregavimas

Kiekvienas drag, „pirmas“, „paskutinis“, užrakinimas ar precedence pakeitimas:

1. išsaugomas `manual_route_edits`;
2. perskaičiuojamos tik paveiktos atkarpos arba visas likęs planas;
3. parodomas delta: minutės, km, vėlavimo rizika ir perkelti taškai;
4. naudotojo tvarka lieka aktyvi net jei ji blogesnė;
5. automatinį variantą galima atkurti atskiru veiksmu.

Sistema niekada tyliai neperrašo rankinio pakeitimo nauju automatiniu rezultatu.

## 11. Dinaminis perskaičiavimas

Perskaičiavimo request apima:

- dabartinę vietą ir laiką;
- tik nebaigtus taškus;
- jau atliktus taškus kaip nekintamą prefiksą;
- naują tašką ar pabaigos vietą;
- aktyvius užrakinimus;
- ankstesnį pasirinktą rezultatą palyginimui.

Prieš pritaikant rodoma:

- laiko delta;
- km delta;
- perkelti taškai;
- nauja vėlavimo rizika;
- eismo duomenų laikas.

Nepavykęs taškas pagal nutylėjimą lieka nebaigtų aibėje. Naudotojas gali jį
palikti pakartotiniam bandymui, nukelti arba užbaigti maršrutą su nesėkme.

## 12. Asmeninės vietos žinios

`location_preferences` saugo:

- pageidaujamą privažiavimą;
- sudėtingą apsisukimą;
- galinį įvažiavimą;
- ilgesnį aptarnavimą;
- ribotas valandas;
- netinkamumą konkrečiai transporto priemonei.

Nauja pastaba yra soft. Hard ji tampa tik naudotojui aiškiai pasirinkus
„Privaloma“. Automatinis mokymasis ateityje turi siūlyti, o ne tyliai keisti
maršrutą.

## 13. Technologijos ir tiekėjo pasirinkimas

### Rekomenduojamas kelias

Pirmas techninis spike turi palyginti:

1. HERE Tour Planning + HERE Truck Routing – stiprus kandidatas dėl
   time-dependent traffic, truck matmenų / svorio apribojimų, atviros pabaigos ir
   dinaminio perplanavimo.
2. Google Route Optimization – palaiko time windows, capacity, soft costs,
   precedences ir eksperimentinę load-distance kainą; truck fizinių kelių
   apribojimų pilnumą reikia atskirai patikrinti.
3. OR-Tools servisą su pasirinkto kelių tiekėjo matrica – daugiausia kontrolės
   saviems kriterijams ir paaiškinimams, bet didžiausia kūrimo bei palaikymo kaina.

Vien Google Maps adresų / Routes matricos neužtenka, nes matrica pati nesprendžia
visų sekos, hard constraints ir daugiakriterio paaiškinimo užduočių.

Tiekėjas pasirenkamas tik atlikus Lietuvos bandomąjį duomenų rinkinį:

- ETA kokybė Vilniuje ir regionuose;
- truck apribojimų aprėptis;
- prognozuojamas eismas;
- manevrų duomenys;
- kainos ir kvotos;
- API licencijos leidimas saugoti auditui reikalingus rezultatus.

### Oficialūs šaltiniai

- OR-Tools dimensions ir VRPTW:
  https://developers.google.com/optimization/routing/dimensions
- Google Route Optimization time windows:
  https://developers.google.com/maps/documentation/route-optimization/concepts/time-windows
- Google load demands / limits:
  https://developers.google.com/maps/documentation/route-optimization/concepts/load-demands-limits
- Google ShipmentModel / eksperimentinė load-distance kaina:
  https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel
- HERE Tour Planning:
  https://docs.here.com/tour-planning/docs/introduction-tour-planning
- HERE truck routing:
  https://docs.here.com/routing/docs/routing-v8-truck-routing

## 14. Optimizavimo duomenų ir audito modelis

`RouteOptimizationResult` saugo:

- profilį ir krypties strategiją;
- generavimo bei eismo snapshot laiką;
- tiekėją ir kriterijų versiją;
- startą ir pabaigą;
- tvarką prieš ir po;
- laiką, km, service, waiting ir tonkilometrius;
- late stops;
- raw score komponentus ir svorius;
- paaiškinimus, perspėjimus ir rankinius pakeitimus;
- ar variantas pasirinktas;
- nuorodą į ankstesnį rezultatą dinaminio perskaičiavimo auditui.

`RouteOptimizationStop` saugo kiekvieno taško ETA, išvykimą, leg km / minutes,
laukimo ir aptarnavimo trukmę, likusį svorį bei manevrų kainą.

`RouteStopConstraint` saugo constraint tipą, related stop, reikšmę, prioritetą ir
hard / soft požymį.

Kiekvienas optimizavimas yra nekintamas snapshot. Naujas perskaičiavimas nesunaikina
ankstesnio.

## 15. Kelionės lapas

Vienas `TripSheet` priklauso vienai datai ir transporto priemonei, bet per
`trip_sheet_routes` gali apimti kelis tos dienos maršrutus.

Saugoma:

- pradžios / pabaigos vietos;
- transporto priemonė ir numeris per `Vehicle`;
- planuoti / faktiniai odometrai ir km;
- planuoti / faktiniai pradžios, pabaigos ir trukmės duomenys;
- planuotas / faktinis driving bei service laikas, kai patikimas;
- pristatytas svoris ir taškai;
- degalų pylimai;
- komentaras.

Faktinis atstumas:

```text
actualDistanceKm = endOdometer - startOdometer
distanceVarianceKm = actualDistanceKm - plannedDistanceKm
```

## 16. Du atskiri laiko KPI

Plano įvykdymas:

```text
schedulePerformance = plannedDuration / actualDuration × 100 %
```

Žalias rezultatas saugomas ir gali viršyti 100 %. Pagrindinis UI indikatorius
ribojamas iki 100 %, o šalia rodoma sutaupyta / prarasta minučių.

Produktyvus laikas:

```text
productiveTime = (driving + service) / totalCategorizedTime × 100 %
```

Kategorijos:

- driving;
- service;
- waiting;
- break;
- unplanned_idle;
- other.

Pirmajame MVP jos nėra automatiškai sekamos. `trip_time_entries` leidžia vėliau
įvesti rankiniu būdu, išvesti patikimus intervalus ar pridėti automatinį šaltinį.
KPI yra informacinis ir negali būti naudojamas skatinti greičio viršijimą ar
privalomų pertraukų trumpinimą.

## 17. Degalų apskaita

MVP `Vehicle.baseFuelNormLPer100Km` yra viena bazinė norma.

Norminis kiekis:

```text
normativeLiters = distanceKm × baseNormLPer100Km / 100
```

Tiksli faktinė norma skaičiuojama tik tarp dviejų pilno bako pylimų:

```text
actualLPer100Km =
  visi litrai po pradinio pilno pylimo iki kito pilno pylimo imtinai
  / odometro skirtumas
  × 100
```

Pradinio pilno pylimo litrai neįtraukiami, nes jie užpildo iki atskaitos taško.
Visi tarpiniai daliniai pylimai ir baigiamasis pilnas pylimas įtraukiami.

```text
savingLiters = normativeLiters - actualLiters
savingLPer100Km = baseNorm - actualLPer100Km
savingPercent = savingLiters / normativeLiters × 100
```

Be antro pilno bako:

- pylimai ir bendri litrai rodomi;
- intervalas žymimas „neužbaigtas“;
- tiksli faktinė norma, sutaupymas ir viršijimas nerodomi;
- preliminari reikšmė, jei vėliau pridėta, turi būti aiškiai pažymėta.

## 18. Testavimo matrica

| Nr. | Scenarijus | Esminis tikėtinas rezultatas |
|---:|---|---|
| 1 | Sunkiausias arčiausiai | Gali būti anksti, jei bendras balas gerėja |
| 2 | Sunkiausias toliausiai | Nekeliamas pirmas, jei lankas neproporcingas |
| 3 | Sunkiausias turi vėlyvą langą | Hard langas laimi prieš tonkilometrius |
| 4 | Lengvas turi ankstyvą langą | Lengvas planuojamas laiku |
| 5 | Pabaiga namuose | Pabaigos constraint įvykdomas |
| 6 | Pabaiga sandėlyje | Pabaigos constraint įvykdomas |
| 7 | Tolimiausias pirmas trumpina | Strategija gali laimėti |
| 8 | Tolimiausias pirmas ilgina | Strategija atmetama |
| 9 | Trumpesnis km, lėtesnis eisme | Greitesnis variantas gali būti ilgesnis |
| 10 | Ilgesnis aplenkia spūstį | Rodomas tikras laiko / km delta |
| 11 | Kairysis posūkis daug sutaupo | Soft bauda neužblokuoja |
| 12 | Kairysis posūkis mažai sutaupo | Saugesnis apvažiavimas gali laimėti |
| 13 | Rankinis reorder | Perskaičiuojama ir nepanaikinama |
| 14 | Užrakinta pozicija | Visi nauji planai ją išlaiko |
| 15 | Pristatymas failed | Perskaičiuojami tik likę |
| 16 | Naujas taškas vykstant | Atliktas prefiksas nekinta |
| 17 | Keli taškai tuo pačiu adresu | Išlieka atskiri stop / service laikai |
| 18 | Neįmanomas langas | Nėra melagingo „optimumo“, rodoma infeasible |
| 19 | Netelpa į darbo laiką | Rodomas konkretus hard konfliktas / warning |
| 20 | End odometer < start | Validacija atmeta |
| 21 | Pylimas nepilnas | Tiksli norma neskaičiuojama |
| 22 | Keli daliniai tarp pilnų | Visi tarpiniai litrai įtraukiami |
| 23 | Keli maršrutai vieną dieną | Vienas TripSheet susieja kelis Route |
| 24 | Faktinė trukmė trumpesnė | Raw KPI >100, UI 100 + sutaupytas laikas |
| 25 | Faktinė trukmė ilgesnė | KPI <100 ir neigiamas minučių skirtumas |

Papildomai būtini property-based testai:

- hard pažeidžiantis kandidatas niekada nelaimi;
- užrakintų taškų santykinė / absoliuti pozicija nekinta;
- completed stop prefiksas po replan nekinta;
- tonkilometrai niekada neigiami;
- rankinis variantas gali būti pasirinktas net su blogesniu soft balu;
- tas pats input snapshot ir kriterijų versija duoda pakartojamą auditą.

## 19. Įgyvendinimo seka

1. Vehicle, TripSheet, FuelEntry formos ir lokalus CRUD.
2. Constraint redaktorius bei rankinis planas kaip patikimas fallback.
3. Lietuvos tiekėjų spike su tais pačiais 25 testiniais maršrutais.
4. Gateway, provider adapteris ir nepriklausomas hard validatorius.
5. Daugiakriteris score, trys profiliai ir paaiškinimai.
6. Rankiniai užrakinimai, delta perspėjimai ir auditas.
7. Dinaminis likučio perskaičiavimas.
8. Kelionės lapo santrauka, du KPI ir full-to-full degalų intervalai.
9. Tik po sukauptų duomenų – asmeninių vietų pasiūlymai ir service-time mokymasis.

Sudėtingas krovinio 3D išdėstymas ir svoriu grįstas degalų prognozavimo modelis
lieka atskiri ateities moduliai.
