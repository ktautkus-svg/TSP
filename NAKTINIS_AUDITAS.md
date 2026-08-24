# NAKTINIS AUDITAS – TSP logistinės sistemos būklė

Data: 2026-08-24
Sistemos auditas: server, gateway, aplikacija, duomenų schema ir sinchronizacijos mechanizmas.

## 1. Patikrinimo rezultatai

Vykdžiau šias komandas šakniniame projekte:

1. npm run typecheck
2. npm run lint
3. npm test

### Rezultatai

| Komanda | Statusas | Rezultatas |
|---|---|---|
| npm run typecheck | ✓ Praėjo | Exit code 0, nėra TypeScript klaidų |
| npm run lint | ✓ Praėjo | Exit code 0, nėra ESLint klaidų |
| npm test | ✓ Praėjo | Exit code 0, 107 failai, 951 testai praejo |

### Reikšmė

Šiuo metu projekto aktyvioje darbo kopijoje nėra realių kompiliavimo, lint ar testų klaidų. Projektas yra stabilus pagal šiuos tris patikrinimus. Dėl to šio audito etape yra svarbu diferencijuoti esamą būklę nuo istorinių ar laikinių problemų, kurios kartais pasitaikė atliekant refactor ar netinkamos migracijos metu.

---

## 2. Visas rastas klaidų / problemų sąrašas

### 2.1. Dabartinis statusas: klaidų nėra

Esant dabartiniam kodo būklei, negalima nustatyti:

- TypeScript kompiliavimo klaidų
- ESLint klaidų
- Falling unit/integration testų

All checks passed in the verified run.

### 2.2. Istorinės / architektūrinės problemos, kurios gali sugrįžti

Nors šiuo metu rezultatų nėra, projekto struktūra ir logika vis dar turi keletą rizikos zonų, kurias būtina stebėti ir taisyti sistemingai. Šios zonos yra svarbios, nes šiuo metu jos nėra “sukėlę klaidų”, bet jų raida gali sukelti vėlesnes regresijas:

- servero validacijų logika nėra centralizuota;
- app-level ir server-level validacijos kartojasi ir skiriasi semantika;
- sinchronizacijos tarp įrenginių logika yra sudėtinga ir jautri konfidencialumui / konfliktų valdymui;
- ownership / employee identity / cursor rules yra kritinės ir reikalauja nuolatinio priežiūros;
- route sync mechanizmas turi daug “transportinių” sąlygų, kurias lengva sulaužyti net ir nedidelėmis permutacijomis.

---

## 3. Architektūrinė analizė: server / gateway / app / schema

### 3.1. Serverinis sluoksnis

Serverinė dalis, ypač failas [server/employee-auth-store.ts](server/employee-auth-store.ts), yra didelė ir daugiafunkcinė. Ji atlieka:

- darbuotojų autentifikaciją ir autorizaciją;
- route assignment logiką;
- trip sheet, fuel entry ir odo metrus;
- route ownership / data access patterns;
- vehicle status, finansų ir audit logiką.

Savybės:

- Didelė atsakomybė viename objekte; šis failas atrodo kaip centralinė “operational data layer” vieta.
- Logika apima duomenų formavimą, validavimą ir privalomų sanskritų taisykles.
- Šalia serverio jos turi būti aiškesnės domain constraints ir validation contracts.

Rizika:

- Kai validacija pasiskirsto tarp serverio ir app-layer, lengva pasimesti modelio taisyklėse.
- Refactor metu galima palikti eksporto/importo nelygumą, kaip kad būta istorinių validacijos trūkumo atvejų.

### 3.2. Gateway sluoksnis

[Katalogas gateway](gateway) yra skirtas providerų ir serverio komunikacijai. Čia dominuoja:

- rate limits;
- task/usage control;
- security layer;
- provider adapters;
- caching logic.

Geriausios dalys:

- gateway logika atrodo atskirta nuo app UX ir turi aiškią atsakomybę;
- yra apsaugos sluoksniai, kurie saugo nuo netikėtų providerio kvietimų ir šališkos integracijos.

Rizika:

- Kai gateway ir app domain logika tampa per daug įaugę į vieną srautą, sunkėja testavimas ir modelio konsistencija.
- Provider adapteriai yra jautrūs brangiam kalendorių / API kvietimų limitukams; šiuo atveju negalima leisti UI darbuoti į “real provider calls” be apsaugos.

### 3.3. Aplikacijos sluoksnis

[Aplikacijos medžio dalis src](src) turi daug komponentų, domain services ir UI. Čia yra aiškus UI + domain + service skaidymas, tačiau:

- sinchronizacijos logika ir route lifecycle logika persipina su UI sekliomis sąveikomis;
- kelių įrenginių koordinavimas nėra toks paprastas, kad jį būtų galima laikyti “UI funkcija”;
- application layer turi prižiūrėti genuine route state correctness, ne tik atvaizdavimo logiką.

### 3.4. Duomenų schema ir migracijos

[src/database/migrations.ts](src/database/migrations.ts) demonstravo, kad projektas turi aiškų migracijų modelį. Tai geras požymis. Tačiau svarbu išlaikyti griežtą taisyklę:

- migracijos turi būti add-only ir saugios;
- schema turėtų atspindėti domain invariants; niekada neturi būti “viskas leidžiama” režimas;
- sinchronizacijos statusai ir route ownership kontrolė turi būti tautiškai nuosekli.

---

## 4. Gilaus analizė: route-cloud-sync.ts konfliktų logika

### 4.1. Kodėl ši logika yra sudėtinga

Failas [src/application/sync/route-cloud-sync.ts](src/application/sync/route-cloud-sync.ts) sprendžia 4 pagrindinius režimus:

1. local push (upload)
2. remote pull (download)
3. conflict resolution
4. deferred route retry / tombstone handling

Tai yra svarbus mechanizmas, nes TSP veikia keliuose įrenginiuose vienam vartotojui ir turi išlaikyti route correctness bei local data integrity. Kiekviename sync cikle turi būti nuosekli logika, kitaip gali atsitikti:

- teisėtai vykdomo maršruto pakeitimas turi būti prarastas;
- lokalus “darbo” route gali būti perrašytas remote terminal statusu;
- completed/cancelled route gali būti ignoruota arba netinkamai nurašyta;
- aktyvus maršrutas gali būti pakeistas ne toje sekoje.

### 4.2. Teigiami aspektai

- `WORKING_STATUSES = ['loading', 'loaded', 'in_progress']` aiškiai apibrėžia, kurie statusai yra “fizinio darbo” būsena.
- `applyPulledRoute()` atskiria:
  - tombstones;
  - stale local copy;
  - active local route protective deferral;
  - route apply errors;
  - completed/cancelled history merges.
- `deferRoute()` palaiko `route_sync_deferrals`, todėl snapshotas neperduodamas “iš karto” nenukrenta. Tai yra geras saugos modelis.
- `setSyncCursor()` per account yra protingas dizainas: kiekvienas darbuotojas turi savo cursorį, ne bendrą universalų.

### 4.3. Konfliktų logika: ką ji darytų teisingai

Pagrindinė idea yra tokia:

- Jei lokali kopija yra naujesnė nei serveris, local wins.
- Jei route fiziškai yra aktyvus ir darbai vyksta lokaliai, remote terminal snapshotas yra atidedamas / ignoruojamas.
- Jei neyra aktyvus local work, konfliktų atveju server snapshotas gali būti priimtas kaip valid latest version.
- Jei route negali būti pritaikyta dabar, ji nenuimama iš srauto; ji įrašoma į deferrals ir pakartotinai bandoma.

Tai yra teisinga strategija ir ji gerai modeliuoja “latest-write-wins + protect live work” taisyklę.

### 4.4. Ką reikia stebėti

Nepaisant geros priežiūros, logika vis dar yra jautri:

- statusų sąrašų dabar ir vėliau gali skirtis nuo realaus work flow;
- jei `updated_at` laiko žymes nėra absoliučiai nuoseklios, konfliktai gali būti neteisingai interpretavami;
- captured route status transition logic priklauso nuo to, kaip app ir background taskai keičia route statusą;
- duomenų konfliktai yra ypač delikatesni, kai vienas įrenginys skelbia `completed`, kitas – `in_progress` tuo pačiu metu.

### 4.5. Svarbiausias išvada

[route-cloud-sync.ts](src/application/sync/route-cloud-sync.ts) yra stipri, tačiau subtili sinchronizacijos sistema. Ji turi būti traktuojama kaip “kritinė infrastruktūra”, ne kaip UI helper. Kiekvienas pakeitimas čia turi būti vertinamas kaip produkcijos rizikos didinimas.

---

## 5. Gilaus analizė: employee-auth-store.ts validacijų trūkumai ir rizikas

### 5.1. Esami validacijos helperiai

Failas [server/employee-auth-store.ts](server/employee-auth-store.ts) turi local validation helpers:

- validateFuelLiters
- validateOdometer
- isoDateOrThrow
- validateLiters
- validatePricePerLiter

Tai yra teigiama: validacija dabar yra lokalizuota ir nepalieka “neaiškių” netikėtų skaičių ar datų.

### 5.2. Problema: validacija išskaidyta

Šio failo validacijos logika išsibarstė tarp:

- server validation helpers;
- app-level validation utils;
- route workday domain checks;
- legacy service checks.

Tai sukuria dvi problemas:

1. Neaiškus vienas “source of truth” valdīmas.
2. Kitas inžinierius gali pataisyti vieną sluoksnį, o kitas – kitą, sukurdami painiavos ir regresijos.

### 5.3. Konkreti rizika

Kitaip tariant, validacijos taisyklės yra nepakankamai centralizuotos. Pavyzdžiui:

- odometer validation gali būti per griežta arba per laisva priklausomai nuo konteksto;
- fuel amount / price rules turi būti taikomos vienodai app-wide;
- date parsing ne visada yra apibrėžta su timezone/ISO/locale tikslais;
- validatorių pavadinimai fizinėje vietoje gali virsti “mart tipo” abstrakcija, kurioje skaičių / data / route semantics išsisklaido.

### 5.4. Geriausia praktika šiai sričiai

- sukurti vieną shared validation module;
- apibrėžti domain contractus tipo lygmeniu;
- naudoti tą patį validatorių rinkinį serverio ir app layer sąveikai;
- nepalikti “hidden duplicates” tarp failų ar katalogų.

---

## 6. Kopijuoto / pasikartojančio kodo rizika

Projekte pastebėta, kad tarp serverio, app services ir route workday logikos yra pasikartojančios taisyklės. Tai padidina:

- priežiūros išlaidas;
- regresijos riziką;
- lėtėjimą; 
- netikėtų konfliktų skaičių refactor metu.

Konkrečiai, reikėtų įvesti vadinamąjį shared validation layer:

- validateOdometer
- validateFuelAmount
- validateFuelPrice
- normalizeIsoDate
- validateRouteStatusTransition

Toks slėgis žymiai sumažintų klaidų tikimybę.

---

## 7. Sintetinė rizikos įvertinimo santrauka

| Sritis | Įvertinimas | Pastaba |
|---|---|---|
| TypeScript | Gerai | Dabartinis patikrinimas praėjo |
| Lint | Gerai | Dabartinis patikrinimas praėjo |
| Testai | Gerai | 951/951 praėjo |
| Multi-device sync | Vidutinė/aukšta rizika | Svarbi dėl kritinio route state lifecyle |
| Validation centralization | Vidutinė rizika | Reikia shared module |
| Ownership / employee identity | Vidutinė/aukšta rizika | Kritiška duomenų saugai |
| Route conflict rules | Aukšta rizika | Netinkamai valdomas latest-write-wins modelis gali sukelti duomenų praradimą |

---

## 8. Ryto planas: kryptimis ir prioritetai

### Prioritetas 1 – stabilizuoti “source of truth”

1. Apibrėžti vieną shared validation layer.
2. Perkelti odometer, fuel, date ir status validation logic į bendrą module.
3. Ištrinti ar nebetraukti dvigubų validatorių.
4. Užtikrinti, kad serverio ir app validacijas naudojasi ta pati sąsaja.

### Prioritetas 2 – padidinti sinchronizacijos saugumą

1. Peržiūrėti konfliktų srautą [src/application/sync/route-cloud-sync.ts](src/application/sync/route-cloud-sync.ts).
2. Patvirtinti latest-write-wins ir work protection flow.
3. Priežiūrėti `route_sync_deferrals` ir `sync_cursors` sistemą.
4. Ištestuoti multi-device scenarijus: 
   - Device A active route
   - Device B completed stop
   - conflict on completed/cancelled route
   - tombstone propagation

### Prioritetas 3 – išvalyti architektūrą

1. Sutvarkyti app/server boundary projektavimą.
2. Atskirti domain logic nuo transport / infra logic.
3. Sumažinti failų “godų” dydį ir atsakomybės perkrovą.
4. Padaryti aiškius contractus tarp route lifecycle, sync layer ir persistence.

### Prioritetas 4 – įvesti verifikuojamą QA ir CI barjerą

1. Minimalus gate: typecheck + lint + test.
2. Privaloma route sync regression test suite.
3. Privalomas multi-device testų rinkinys prieš merge.
4. Kiekvienas refactor į route sync turi būti akivaizdžiai dokumentuotas.

---

## 9. Išvada

Projekto dabartinė kodų bazė yra stabilus ir patikrintas pagal TypeScript, ESLint ir Vitest. Tačiau tai yra “užbaigta stabilumo” etapo išvada, o ne “architektūrinio pasitikėjimo” išvada.

Patys svarbiausi rizikos punktai yra:

- sinchronizacija tarp įrenginių,
- route ownership / cursor logic,
- validacijos centralizacijos trūkumas,
- server/application boundary netvarka.

Tai yra ta zonos, kuriose projektas turi būti prižiūrimas labai atsargiai, nes net maži pakeitimai čia gali sukelti duomenų praradimą arba netinkamą active route statusų evoliuciją.

---

## 10. Finalinė rekomendacija

Rytoj dėmesys turi būti skiriamas ne “ui cleanup” ar kosmetikai, o šiems trim bankams:

1. shared validation layer
2. route sync conflict safety
3. clear boundary and ownership rules

Tik šie darbai sustiprins projektą ir išlaikys jį produkcijos paruošimo lygiu.
