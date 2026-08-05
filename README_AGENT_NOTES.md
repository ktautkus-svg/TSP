# Agento darbo žurnalas

Šis failas fiksuoja savarankiško (be priežiūros) agento darbo eigą per etapus,
apibrėžtus vartotojo. Kiekvienas etapas — atskiras lokalus git commit.
**Joks deploy/push į production nebuvo ir nebus paleistas šios sesijos metu.**

---

## Etapas 1: "Išvalyti maršrutą" mygtukas nereagavo į paspaudimą

**Root cause:** [src/components/pwa-runtime.tsx](src/components/pwa-runtime.tsx) — komponentas
`PwaRuntime` yra montuojamas **globaliai**, kaip sibling šalia `<Stack>` navigatoriaus
([src/app/_layout.tsx](src/app/_layout.tsx)), todėl jo turinys persidengia su **kiekvienu**
ekranu, ne tik pradžios ekranu.

Jo šakninis `View` (`styles.host`) yra:
```
position: 'absolute', left: spacing.md, right: spacing.md,
bottom: max(spacing.md, env(safe-area-inset-bottom)), zIndex: 1000
```
— t.y. pritvirtintas prie apatinės ekrano dalies per visą plotį, virš visko (`zIndex: 1000`).
Tai tiksliai ta zona, kurioje daugelyje ekranų (įskaitant `index.tsx` aktyvaus maršruto
kortelę) yra paskutiniai mygtukai, tarp jų — "Išvalyti ir pradėti iš naujo".

Pats `host` turėjo `pointerEvents="box-none"` (teisingai — leidžia touch praeiti pro tuščią
foną), **BET** vidiniai `offline`/`update` `View` elementai (rodomi kai `!online` arba
`updateReady`) neturėjo jokio `pointerEvents` nustatymo — pagal nutylėjimą `"auto"`.
Tai reiškia: kai vienas iš šių banner'ių aktyvus, jo pilnas layout stačiakampis
(įskaitant tarpus tarp teksto/mygtuko, ne vien matomą tekstą) **sugaudavo visus
touch event'us savo ribose**, neleisdamas jiems pasiekti apačioje esančių ekrano
elementų — net jei banner'is vizualiai tik dalinai persidengia arba tampa nepastebimas
tam tikruose ekrano dydžiuose.

**Taisymas** ([src/components/pwa-runtime.tsx](src/components/pwa-runtime.tsx)):
- `offline` banner'is (vien informacinis, be interaktyvių elementų) → `pointerEvents="none"`,
  visiškai nebekliudo touch'ų.
- `update` banner'is (turi "Atnaujinti" `Pressable`) → `pointerEvents="box-none"`, kad pats
  mygtukas liktų paspaudžiamas, bet likusi banner'io erdvė (fonas, tarpai) praleistų
  paspaudimus žemiau esantiems elementams.

**Pastaba dėl tikrumo:** Šis defektas pasireiškia tik **web/PWA** aplinkoje
(`Platform.OS !== 'web'` grąžina `null` iškart, native app'ui šis kodas neveikia) ir tik
tada, kai `online === false` arba `updateReady === true`. Tai geriausias konkretus,
patikrinamas kodo defektas, atitinkantis aprašytą simptomą (touch dead zone ekrano apačioje,
absoliuti pozicija, aukštas zIndex, globalus mount taškas). Jei problema kartojasi ir po šio
pataisymo **native** aplikacijoje (ne web), reikės tolimesnio tyrimo — šis konkretus
komponentas ten neveikia (`Platform.OS !== 'web'` early return), tad native atveju priežastis
būtų kitokia.

---

## Etapas 2: Sandėlio/namų adresai reikalavo pakartotinio patvirtinimo

**Root cause (jau žinomas iš ankstesnės diagnostikos):**
[src/app/settings/locations.tsx](src/app/settings/locations.tsx) `endpoint()` funkcija
visada išsaugodavo `normalizedAddress: null, latitude: null, longitude: null` —
adresas niekada nebūdavo geokoduojamas Nustatymuose, todėl kiekvienas naujas maršrutas
jį matydavo kaip nepatvirtintą, nepriklausomai nuo to, kiek kartų jis jau buvo panaudotas.
Tas pats null-koordinačių pavyzdys buvo užkoduotas ir pačioje `migrationV10` sėkloje
([src/database/migrations.ts:839-863](src/database/migrations.ts:839)), tad problema
paveikė net švarią naują duomenų bazę.

**Taisymas** ([src/app/settings/locations.tsx](src/app/settings/locations.tsx)):
- Pridėtas `geocodeEndpoint()` — prieš `SaveDefaultLocation.execute()` iškvietimą, ekranas
  dabar kviečia `GatewayAddressResolver` (tas pats resolveris, kurį naudoja Excel/foto
  importo srautas per `gateway-geocoding-provider.ts`), pasirenka aukščiausio pasitikėjimo
  kandidatą ir išsaugo pilną `RouteEndpoint` su `normalizedAddress`/`latitude`/`longitude`.
- Jei geokodavimas nepavyksta (tinklo klaida, 0 kandidatų, Gateway nepasiekiamas) —
  adresas vis tiek išsaugomas tekstu (`plainEndpoint()` fallback), bet vartotojui rodomas
  aiškus `Alert` "Išsaugota be patvirtinimo", įvardijantis, kurio adreso (sandėlio ir/ar
  namų) koordinatės liko nepatvirtintos.
- UI po kiekvieno lauko rodo būsenos tekstą "Adresas patvirtintas ir geokoduotas ✓"
  (žalia) arba "dar nepatvirtintas" (geltona/warning), kad būtų iškart matoma, ar
  bus reikalaujama pakartotinio tvirtinimo kuriant maršrutą.
- **Vienkartinis backfill esamiems null-koordinačių įrašams:** kiekvieną kartą atidarius
  šį ekraną (`useFocusEffect`), jei išsaugotas sandėlio/namų endpoint'as neturi koordinačių,
  ekranas tyliai (be Alert, tik `__DEV__` console.warn nesėkmės atveju) bando jį geokoduoti
  fone ir, jei pavyksta, iš karto perrašo `saved_locations` įrašą su pilnomis koordinatėmis.
  Tai automatiškai išspręs migracijos v10 seed'o ir bet kokių senų rankinių įrašų problemą
  be atskiros SQL migracijos — pakanka, kad vartotojas bent kartą atidarytų
  Nustatymai → Numatytosios vietos su veikiančiu tinklo ryšiu.

**Kodėl ne SQL migracija:** duomenų perskaičiavimas reikalauja tinklo užklausos į geokodavimo
Gateway, kurio migracijos (`migrateDatabase`, paleidžiama `SQLiteProvider onInit`) metu
saugiai atlikti negalima (nėra garantuoto tinklo, negalima blokuoti DB init ilgai
vykstančia async operacija). Todėl pasirinktas UI-lygio best-effort backfill, ne
`migrationV12`. Jei nori privalomos/matomos migracijos su progress indikatoriumi visiems
esamiems vartotojams iš karto (o ne tik apsilankius Nustatymuose), tai — atskiro sprendimo
verta tema, čia nedaryta.

---

## Etapas 3: Per siauras layout telefone/PWA

Patikrinta keturiais punktais, kaip prašyta:

**1. Viewport meta tag** ([src/app/+html.tsx:10-13](src/app/+html.tsx:10)) — **jau buvo teisingas**,
niekas netrūko:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />
```
Tai NEBUVO problemos priežastis.

**2. `metro.config.js`** — minimalus, standartinis `getDefaultConfig()` + WASM assetExt.
Jokių plotį ribojančių nustatymų. NE priežastis.

**3. `SafeAreaView` dvigubas padding — RASTAS IR PATAISYTAS konkretus defektas.**
Patikrinau visus 16 `src/app/` ekranų — visi naudoja `SafeAreaView` (tiesiogiai arba per
`FoundationScreen`, kuri irgi apgaubia `SafeAreaView`). Tuo pačiu metu
[src/app/+html.tsx](src/app/+html.tsx) turėjo globalią CSS taisyklę:
```css
body { margin: 0; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
```
Patikrinau `react-native-web` šaltinį
(`node_modules/react-native-web/dist/exports/SafeAreaView/index.js`) — jo `SafeAreaView`
web'e taip pat tiesiog priskiria `paddingTop/Right/Bottom/Left: env(safe-area-inset-*)`
per CSS. T.y. **abu sluoksniai (globalus `body` CSS ir kiekvieno ekrano `SafeAreaView`)
pritaikydavo TĄ PATĮ safe-area inset PADVIGUBINTAI** — kiekvienas ekranas gaudavo dvigubą
kraštinį atitraukimą. Kadangi dešinės/kairės safe-area insets dažniausiai lygūs 0 portrete
(nebent landscape/dinaminė sala kraštuose), praktinis poveikis pločiui priklauso nuo
įrenginio/orientacijos, bet tai vis tiek yra objektyviai neteisingas, dubliuotas CSS —
tvarkinga ir maža rizika pašalinti.

**Taisymas** ([src/app/+html.tsx](src/app/+html.tsx)): pašalintas `padding: env(...)` iš
globalios `body` CSS taisyklės, paliktas tik `margin: 0`. Kadangi VISI ekranai jau turi
savo `SafeAreaView` sluoksnį, saugos insets liks pritaikyti — tik nebe dvigubai, ir tik
per React komponentų medį (nuosekliau su native platformomis, kur `+html.tsx` CSS
apskritai neegzistuoja).

**4. Globalus `max-width` CSS konteineris** — rastas [src/ui/tokens.ts:22-25](src/ui/tokens.ts:22)
`layout.maxContentWidth = 900`, naudojamas [src/components/screen-container.tsx](src/components/screen-container.tsx)
`inner` stiliuje kaip **`maxWidth`** (ne fiksuotas `width`), su `width: '100%'`. Tai riboja
turinį TIK plačiuose ekranuose (>900px, pvz. desktop/tablet), telefono ekrane (~360-430px)
šis apribojimas neįsijungia. **Tai NE per-siauro layout priežastis telefone** — priešingai,
tai apsauga nuo per-plataus layout dideliuose ekranuose. Jokio failo su `public/*.css`
neradau (senas `src/global.css` pašalintas anksčiau, `public/` kataloge tik manifest,
service-worker ir ikonos, jokio CSS).

**Išvada:** rastas ir pataisytas vienintelis aiškus, mažos rizikos defektas — dvigubas
safe-area padding. Jei "per siauras" pojūtis išlieka po šio pataisymo, priežastis
nebėra CSS/viewport/SafeAreaView lygyje — reikėtų realaus įrenginio ekrano nuotraukos su
konkrečiu ekranu ir matmenimis, kad būtų galima tęsti tyrimą.

---

## Etapas 4: Maršruto dashboard sekcija (be GPS)

Papildytas [src/app/route/[id]/delivery.tsx](src/app/route/%5Bid%5D/delivery.tsx) nauja
`styles.dashboard` sekcija, įterpta VIRŠ esamos tekstinės `summary` santraukos (senoji
santrauka palikta nepakeista žemiau — nieko nepašalinta, tik papildyta).

**Nauji elementai:**
- Du apskriti SVG matuokliai (`CircularGauge` — lokalus komponentas šiame faile, pagal
  `RouteMapView` naudojamą `react-native-svg` konvenciją):
  - Žalias (`colors.success`) — likęs žinomas svoris, užpildymas = pristatyto svorio dalis
    (`(totalKnownWeightKg - remainingKnownWeightKg) / totalKnownWeightKg`, tos pačios
    reikšmės, kurias skaičiuoja jau egzistuojantis `GetRouteProgress`).
  - Mėlynas (naujas `colors.info` token'as, žr. žemiau) — likę taškai, užpildymas =
    `deliveredStops / totalStops` (tas pats `progress.deliveryPercent` šaltinis).
  - Užpildymas animuojamas `Animated.Value` + `strokeDashoffset`, paleidžiama kaskart, kai
    pasikeičia `fraction` (taip pat ir pirmame render'e po užkrovimo).
- "Sekantis taškas" kortelė — `stops.find(s => s.deliveryStatus === 'pending')`, atstumas ir
  laikas per **tuos pačius** `legLabel()`/`etaLabel()` helperius, kuriuos jau naudoja kiekvienos
  sustojimo kortelės eilutė žemiau (nė vieno naujo skaičiavimo šaltinio).
- Statistikos eilutė: "Laikas kelyje" (`route.startedAt` iš schema, skaičiuojamas
  `elapsedLabel()` render metu) ir "Pristatyta / viso" (`progress.deliveredStops`/`totalStops`).
  **Nuvažiuotas atstumas praleistas** — kodo bazėje nėra "iki šiol nuvažiuota" duomenų
  šaltinio (yra tik planinis `estimatedDistanceKm` ir po užbaigimo įrašomas `actualDistanceKm`,
  bet ne live-progress reikšmė), tiksliai kaip nurodyta instrukcijoje.
- Raudonas mygtukas "Stabdyti maršrutą" (`colors.danger`), su patvirtinimo `Alert`, kviečia
  **jau egzistuojantį** `CancelDraftRoute(db).execute(routeId)` (šis komponentas atidaromas
  tik kai `route.status === 'in_progress'` — kitos būsenos šiame ekrane niekada nepasiekiamos
  dėl `load()` guard'o, tad papildomos šakos pagal statusą nereikėjo).

**Stiliaus tokenai** ([src/ui/tokens.ts](src/ui/tokens.ts)) — pridėti du nauji, neliečiant esamų:
- `colors.info = '#1D6FE0'` (mėlyna — projekto palete jos anksčiau neturėjo, tik
  primary/success/warning/danger/border).
- `fonts.mono` — kryžminės platformos monospace šriftas skaičiams (`Menlo` iOS, `monospace`
  Android/web), naudojamas matuoklių ir statistikos skaičiams.

**Dizainas:** be gradientų/šešėlių (flat, kaip visur kitur app'e — `StyleSheet` be
`shadow*`/`elevation`), spalvos ir `spacing`/`colors` iš `@/ui/tokens`, kortelių stilius
(`borderRadius`, `borderWidth: 1`, `borderColor: colors.border`, `backgroundColor:
colors.surface`) atkartoja esamą `card`/`summary`/`finishCard` konvenciją tame pačiame faile.

**GPS integracija ŠIAME etape sąmoningai NEDARYTA**, kaip nurodyta — tam reikės atskiros
DB migracijos (`status` CHECK constraint papildymo `'paused'` reikšme, `trip_started_at`/
`trip_ended_at` laukų), kuri paliekama atskiram etapui su vartotojo priežiūra.

**Patikrinta:** `tsc --noEmit` (0 klaidų) ir pilnas `vitest run` (449/449 testai praėjo,
42 failai) po šio ir visų ankstesnių etapų pakeitimų.

---

## Etapas 5: Santrauka

**Visi 4 etapai baigti be aklaviečių.** Joks deploy/push į production nebuvo paleistas —
`cloud-run-deploy.ps1` niekada nekviestas. Visi commit'ai — tik lokalūs.

### Commit'ai (chronologine tvarka)

| Etapas | Commit | Failai |
|---|---|---|
| 1 | `16838cc` | `src/components/pwa-runtime.tsx`, `README_AGENT_NOTES.md` |
| 2 | `f0c2180` | `src/app/settings/locations.tsx`, `README_AGENT_NOTES.md` |
| 3 | `925961d` | `src/app/+html.tsx`, `README_AGENT_NOTES.md` |
| 4 | `6bff918` | `src/app/route/[id]/delivery.tsx`, `src/ui/tokens.ts`, `README_AGENT_NOTES.md` |

### Kas padaryta

1. **"Išvalyti maršrutą" touch bug** — root cause rastas ir pataisytas (`PwaRuntime`
   globalaus banner'io `pointerEvents` scoping). Patikrinamas kodo defektas, atitinka
   simptomą, bet pasireiškia tik web/PWA + offline/update sąlygomis.
2. **Adresų pakartotinis patvirtinimas** — sandėlio/namų adresai dabar geokoduojami
   išsaugant, su fallback + įspėjimu, plius tylus esamų null-koordinačių įrašų backfill.
3. **Per siauras PWA layout** — rastas ir pataisytas dvigubas safe-area padding
   (`+html.tsx` body CSS + `SafeAreaView` React lygyje). Viewport meta tag, metro config,
   max-width konteineris — patikrinti, nekalti.
4. **Maršruto dashboard** — `delivery.tsx` papildytas animuotais SVG matuokliais
   (svoris/taškai), sekančio taško kortele, statistikos eilute ir raudonu "Stabdyti
   maršrutą" mygtuku. Be GPS, kaip nurodyta.

### Kas NEBUVO padaryta ir kodėl

- **GPS integracija** — sąmoningai praleista Etape 4 pagal aiškų nurodymą; reikės
  atskiros DB migracijos (`'paused'` status reikšmės, `trip_started_at`/`trip_ended_at`
  laukų) su vartotojo priežiūra.
- **Nuvažiuoto atstumo lauke dashboard'e** — praleistas, nes kodo bazėje nėra
  "iki šiol nuvažiuota" live-progress duomenų šaltinio (tik planinis ir po-užbaigimo).
- **Formali SQL migracija Etape 2** (vietoje UI-lygio backfill) — nedaryta sąmoningai,
  nes koordinačių perskaičiavimui reikia tinklo užklausos, kurios negalima saugiai atlikti
  DB `onInit` migracijos metu. Jei norėsi privalomo/matomo backfill'o visiems vartotojams
  iš karto (ne tik apsilankius Nustatymuose), tai atskira užduotis.

### Ką rekomenduoju patikrinti PIRMIAUSIA, kai grįši

1. **Rankiniu būdu paleisti app'ą** (dev serveris niekada nebuvo startuotas šios sesijos
   metu — tikrinau tik `tsc --noEmit` ir `vitest run`, NE realų UI naršyklėje/telefone).
   Ypač:
   - Etapas 1: atsijungus nuo tinklo arba imituojant pending SW update, patikrinti, ar
     "Išvalyti ir pradėti iš naujo" dabar reaguoja net kai banner'is rodomas.
   - Etapas 3: patikrinti telefono/PWA layout plotį realiame įrenginyje (ypač su notch/
     dynamic island), kad patvirtintum, ar pojūtis "per siauras" pranyko.
   - Etapas 4: paleisti maršrutą iki `in_progress` būsenos ir pažiūrėti, ar matuoklių
     animacija/skaičiai atrodo taip, kaip tikėtasi.
2. **Etapas 2 Alert tekstas** — patikrinti, ar Gateway (lokalus `:8787` arba Cloud Run)
   yra pasiekiamas tavo dev aplinkoje; jei ne, kiekvienas išsaugojimas rodys "Išsaugota be
   patvirtinimo" perspėjimą, net jei adresas geras — tai laukiama, bet gali klaidinti,
   jei pamiršai, kad Gateway neveikia.

### Abejotini sprendimai, kuriuos verta peržiūrėti

- **Etapas 1** taisymas (`pointerEvents="none"`/`"box-none"`) yra apibrėžtas, patikrinamas
  kodo pataisymas geriausiai atitinkančiai hipotezei, bet **niekada nepatvirtintas realiu
  touch testu** — jei problema kartojasi po šito, priežastis kitokia (native platforma,
  ne web).
- **Etapas 2**: pasirinkau "geriausios pasitikėjimo kandidato" (`reduce` pagal `confidence`)
  automatinį priėmimą sandėlio/namų adresui BE vartotojo peržiūros ekrano (skirtingai nuo
  importo flow'o, kuris rodo kandidatų sąrašą pasirinkimui). Tai sąmoningas paprastinimas
  ("greita versija" dvasia) — jei sandėlio adresas dviprasmis (keli vienodo tikimo
  kandidatai), gali būti pasirinktas ne tas variantas be vartotojo žinios. Jei nori,
  galima pridėti kandidatų pasirinkimo UI, panašiai kaip `review.tsx`.
- **Etapas 3**: pataisymas remiasi prielaida, kad VISI 16 ekranų visada praeina per
  `SafeAreaView` — tai patikrinta grep'u šios sesijos metu, bet jei ateityje pridėsi naują
  ekraną be `FoundationScreen`/`SafeAreaView`, jis liks be safe-area apsaugos web'e (anksčiau
  tai kompensavo globalus `body` CSS, dabar — ne). Verta tai atsiminti kuriant naujus ekranus.
- **Etapas 4**: palikau seną tekstinę `summary` sekciją NEPAŠALINTĄ, virš jos pridėdamas
  naują vizualų dashboard'ą — dabar yra dalinis informacijos persidengimas (pvz. "Liko N"
  rodoma ir matuoklyje, ir tekste žemiau). Tai sąmoningas pasirinkimas nerizikuoti pašalinti
  funkcionalumą be tavo patvirtinimo, bet UI/UX redesign kontekste verta apsvarstyti, ar
  seną `summary` bloką pašalinti visai, kai patvirtinsi naują dashboard'ą.
- Pridėti du nauji design token'ai (`colors.info`, `fonts.mono`) — jei planuojamas platesnis
  redesign su savo spalvų sistema, šiuos gali reikėti pertvarkyti/pervadinti.

---

# Sesija 2026-08-05 (vakaras): kritinio "Išvalyti" bug'o pataisymas + pilna 13 punktų ataskaita

Ši sesija dirbo su vartotoju **kartu** (ne autonomiškai) per didesnę dalį darbo, bet
paskutinė dalis (šis skyrius) atlikta **savarankiškai**, vartotojui išvažiavus.

## Kritinis bug'as: "Išvalyti ir pradėti iš naujo" nereaguoja (SUTAISYTA)

### Root cause

Ankstesnis šios (ne aukščiau aprašytos) sesijos "fix" (`src/ui/alert.ts`) pakeitė
sugedusį `react-native-web`'o `Alert.alert()` (pilnas no-op) į `window.confirm()`/
`window.alert()`. Tai išsprendė problemą **automatizuotame testavimo įrankyje**
(kur pavyko patvirtinti, kad `confirm()` realiai kviečiamas), bet **neišsprendė
jos realiam vartotojui**, nes:

- `app.json` turi `"display": "standalone"` — programa skirta paleisti kaip
  įdiegtą PWA.
- `window.alert()`/`confirm()`/`prompt()` yra plačiai žinoma, dokumentuota
  Chromium/WebView riba: **įdiegtame/standalone PWA režime šie skambučiai
  dažnai tyliai nieko nedaro** — jokios klaidos, jokio dialogo, nes naršyklė
  neturi UI rėmelio (adreso juostos), prie kurio prisegti natyvų dialogą.

### Kaip patikrinau (savarankiškai, per naršyklės įrankį)

1. Paleidau dev serverį, atidariau ekraną su `active-route-card`.
2. Radau mygtuko DOM elementą, patikrinau `getBoundingClientRect()` +
   `document.elementFromPoint()` centre — **jokio uždengiančio elemento
   nerasta**, `elementFromPoint` grąžino tikslų mygtuko vidinį tekstą.
3. Patikrinau visą tėvinių elementų grandinę (position/z-index/pointer-events)
   nuo teksto iki `<body>` — viskas `pointer-events: auto`, jokio
   `position: absolute` overlay, kuris kirstųsi su šia kortele.
4. Realiu `left_click` paspaudžiau mygtuką — konsolėje pasirodė:
   `[Claude browser] Page dialog suppressed (confirm): "Išvalyti maršrutą?..."`
   Tai įrodė: click PASIEKIA mygtuką, `onPress` VEIKIA, `Alert.alert()`
   TEISINGAI iškviečia `window.confirm()` su teisinga žinute. Trūkstama
   grandis — ar realiai pasirodo natyvus dialogas — yra būtent tai, kas
   nepatikrinama automatizuotu įrankiu (jis sąmoningai slopina natyvius
   dialogus saugumo sumetimais) IR būtent tai, kas nutrūksta standalone
   PWA režime realiam vartotojui.

### Taisymas

Visiškai pašalinta priklausomybė nuo natyvių naršyklės dialogų web'e.
`src/ui/alert.ts` → `src/ui/alert.tsx`:

- `Alert.alert()` web'e dabar publikuoja užklausą į paprastą pub/sub saugyklą
  (ne `window.confirm`).
- Naujas `AlertHost` komponentas (montuojamas vieną kartą `_layout.tsx`,
  `ThemeProvider` viduje) klausosi tos saugyklos ir piešia **savo pačios
  React Native `Modal`** su temos spalvomis (dark/light suderinama).
- Native (iOS/Android) elgesys nepakeistas — ten realus `RNAlert.alert()`
  veikia gerai, nes tai OS lygio dialogas, ne web'o problema.

Tai reiškia: **visi** patvirtinimo dialogai visoje programoje (ne tik
"Išvalyti") dabar naudoja tą patį, iki galo testuojamą mechanizmą — maršruto
atšaukimas, taško pašalinimas, atsarginės kopijos atkūrimas, maršruto
užbaigimas su nebaigtais taškais, ir t.t.

### Patvirtinta gyvai (pilnas ciklas)

1. Paspaudus "Išvalyti ir pradėti iš naujo" → pasirodo **matomas, DOM elementą
   turintis** dialogas (ne natyvus, todėl visada veiks standalone PWA) su
   "Ne" / "Taip, išvalyti".
2. Paspaudus "Taip, išvalyti" → aktyvaus maršruto kortelė **išnyko**, ekranas
   pakeitė būseną į "Aktyvaus maršruto nėra".
3. Nuėjus į "Istorija" → maršrutas realiai atsirado kaip **"Atšauktas"** —
   patvirtina, kad `CancelDraftRoute` DB operacija realiai įvykdyta, ne tik UI
   apsimeta.
4. Papildomai patikrinau vieno mygtuko variantą (`Alert.alert('...', '...')`
   be `buttons` masyvo, iš `settings/locations.tsx`) — irgi veikia teisingai,
   rodo numatytąjį "Gerai" mygtuką, teisingai užsidaro.

`tsc --noEmit` švarus, `vitest run` — 459/459.

## Pilna vakarykščių 13 punktų ataskaita

| # | Punktas | Statusas | Jei nebaigta / dalinė — kodėl ir koks kitas žingsnis |
|---|---|---|---|
| 1 | "Valyti" mygtukas neveikia, nėra išėjimo iš maršruto | **Padaryta ir patikrinta gyvai** | Root cause (native dialogų nepatikimumas standalone PWA) rastas ir pašalintas iš principo — visi Alert.alert dabar naudoja savo Modal, ne `window.confirm`. Pilnas ciklas patikrintas: paspaudimas → dialogas → patvirtinimas → maršrutas dingsta → atsiranda istorijoje. |
| 2 | Maršrutų istorija nieko nesaugo | **Padaryta ir patikrinta gyvai** | Ta pati šaknis kaip #1 — užbaigimo/atšaukimo patvirtinimai dabar realiai suveikia. Patikrinta: atšauktas maršrutas atsirado Istorijos ekrane su teisinga būsena ir data. Pilnas *užbaigimo* (ne atšaukimo) ciklas per loading→in_progress→completed **nepatikrintas gyvai** šioje sesijoje — DB/komandų lygmenyje testais padengta, bet realiam naršyklės ekranui nepravedžiau iki galo (žr. rizikas apačioje). |
| 3 | Alternatyvų ekranas — "raidžių kratinys" | **Padaryta ir patikrinta gyvai** | Vietoj ID rodomi tikri adresai/pavadinimai + svoris. Ta pati klaida rasta ir sutvarkyta `delivery.tsx` maršruto perskaičiavimo kortelėje. |
| 4 | Žemėlapis — SVG "kringeliai" ant balto fono | **Padaryta ir patikrinta gyvai (tik web/PWA)** | Realus Leaflet+OpenStreetMap žemėlapis, patikrinta: 6 plytelės įkeltos, 4 žymekliai su teisingomis etiketėmis. **Native (iOS/Android be naršyklės) versija vis dar SVG schema** — `react-native-maps` reikalauja atskiro diegimo su API raktais, neapėmiau. |
| 5 | Maršruto algoritmas nepradeda nuo tolimiausio/sunkiausio taško | **Padaryta iš dalies** | Numatytoji algoritmo logika NEPAKEISTA (per rizikinga keisti visiems maršrutams). Vietoj to duota rankinė kontrolė per #6 — jei norite Skemai pirmo, pažymite jį, algoritmas priverstinai jį pastatys pirmu. Jei norite, kad numatytoji logika PATI rinktųsi tolimiausią/sunkiausią be jūsų žymėjimo — tai atskiras, nepradėtas darbas (keistų `directionality`/`endLocationConvenience` scoring svorius, rizikinga be plataus regresijos testavimo). |
| 6 | Prioritetinių taškų pasirinkimas | **Padaryta, bet nepatikrinta gyvai iki galo** | UI mygtukas (⭐) `review.tsx` patikrintas, kad rodomas ir paspaudžiamas. **Nepatikrinau gyvai**, ar pažymėjus prioritetą ir perskaičiavus maršrutą per `alternatives.tsx`, pažymėtas taškas realiai atsiduria pirmoje pozicijoje (DB/optimizatoriaus lygmeniu testais padengta, bet pilno UI ciklo su tikrais 3 taškais nepravedžiau). |
| 7 | Krypties apsukimas | **Padaryta, bet nepatikrinta gyvai** | Mygtukas "⇄ Apsukti pristatymo kryptį" pridėtas `loading.tsx`, komanda testais padengta (DB lygmeniu patvirtinta, kad apsuka teisingai). UI paspaudimo per naršyklę nepatikrinau. |
| 8 | Grįžimas prie kito varianto | **Padaryta, bet nepatikrinta gyvai** | Mygtukas ir komanda (`ReopenRouteForPlanning`) testais padengti. UI paspaudimo per naršyklę nepatikrinau. |
| 9 | Svorio matomumas sąraše | **Padaryta ir patikrinta gyvai** | Matyti alternatyvų kortelėse (patikrinta ekrane) ir suskleistose `delivery.tsx`/`loading.tsx` eilutėse (kodo lygmeniu, ne per naršyklę). |
| 10 | Laiko langai — rekomendacija, ne stabdys | **Padaryta ir patikrinta testais** | `REQUIRED_TIME_WINDOW` dabar `type: 'soft'`, nebeskaičiuojamas į `feasible`. Testu patvirtinta (`routing-engine.test.ts`), realiam naršyklės scenarijui su tikru pavėluotu langu nepravedžiau. |
| 11 | Mygtukai viršuje, ne apačioje | **Padaryta ir patikrinta gyvai** | `review.tsx` "Skaičiuoti maršrutą" viršuje — matėsi ekrane testavimo metu. |
| 12 | Susikleidžiantis sąrašas | **Padaryta, bet nepatikrinta gyvai** | Kodas (`delivery.tsx`, `loading.tsx`) tipais patikrintas, logika paprasta (React state), bet realaus paspaudimo/išsiskleidimo per naršyklę nepravedžiau šioje sesijoje. |
| 13 | Horizontalus scroll'inimas | **Padaryta iš dalies** | `overflow-x: hidden` pridėtas globaliai, vienintelis rastas pažeidėjas (`gaugeRow`) sutvarkytas. Nepatikrinta gyvai siaurame (telefono) ekrane — tik logika/CSS peržiūrėta. |

## AR APLIKACIJA SAUGI NAUDOTI REALIAM DARBUI DABAR?

**Konkrečiai šitas "Išvalyti" klasės bug'as (patvirtinimo dialogas neveikia,
vartotojas įstringa be išeities) — TAIP, sutvarkyta iš esmės.** Kadangi visi
patvirtinimo dialogai visoje programoje eina per tą patį `AlertHost`
mechanizmą (ne per natyvų `window.confirm`), ši konkreti bėdos klasė
**struktūriškai nebegali pasikartoti** jokiame ekrane — tai nebe vienos vietos
pataisymas, o visos priklausomybės nuo nepatikimo API pašalinimas.

**Tačiau prieš pilnai pasitikint realiems pristatymams, rekomenduoju:**

1. **Vieną kartą patys patikrinkite savo įdiegtoje PWA** (telefone, pridėtoje
   prie pradžios ekrano) — testavau tik naršyklės skirtuke, ne tikrame
   "standalone" režime, nes automatizuotas įrankis neturi būdo tiesiogiai
   simuliuoti įdiegtos PWA konteksto. Naujas mechanizmas nebepriklauso nuo
   `window.confirm`, todėl teoriškai turėtų veikti identiškai, bet vienas
   realaus pasitikrinimas nekenktų — būtent tai, kad ankstesnis fix "veikė"
   testavimo įrankyje, bet ne realybėje, yra priežastis, kodėl neturėtumėte
   100% pasitikėti vien testais be bent vieno jūsų paties patikrinimo ant
   realaus įrenginio.
2. **Nepratęsta iki galo pilna maršruto užbaigimo eiga** (loading →
   in_progress → completed → istorija) realiame naršyklės teste — atšaukimo
   kelią patikrinau pilnai, užbaigimo kelią tik testais.
3. **Prioritetinių taškų, krypties apsukimo, kito varianto pasirinkimo,
   susikleidžiančio sąrašo** UI veikimas nepatikrintas gyvai (žr. lentelę) —
   kodas parašytas ir tipais/testais padengtas, bet jei naudosite šias
   konkrečias funkcijas pirmą kartą, būkite atidūs.
4. **Native (ne-web) versija** vis dar turi seną SVG žemėlapio schemą, ne
   tikrą žemėlapį — jei naudojate programą ne per naršyklę/PWA, tai vis dar
   aktualu.

Jokių kitų žinomų "vartotojas įstringa be išeities" tipo bug'ų nepastebėjau
šios sesijos metu.

**NIEKADA nepaleidau `cloud-run-deploy.ps1`** — jokio deployment veiksmo
neatlikta.

---

# Sesija 2026-08-05 (naktis): du live bug'ai + dizaino etapas (temos + dashboard)

Dirbta savarankiškai, vartotojui išvažiavus. **Deploy'inta: NE — dirbta tik
lokaliai pagal nurodymą.** `cloud-run-deploy.ps1` nepaleistas nė karto.

## Du bug'ai iš realaus testavimo instaliuotoje PWA

### BUG 1: Žemėlapis rodė neteisingą regioną (Skandinavija vietoj Panevėžio)

**Ištirta:** `route-map.web.tsx` Leaflet integracija patikrinta kodo lygmeniu —
`[latitude, longitude]` tvarka nuosekli visur (Leaflet konvencija), o
`decodePolyline()` teisingai dekoduoja Google polyline formatą (lat delta
pirmiau, tada lng delta). Jokio koordinačių sukeitimo klaidos rendering kode
nerasta.

**Tikroji šaknis:** `gateway/providers/google-geocoding-adapter.ts` siuntė tik
minkštą `region: 'lt'` nuorodą Google Geocoding API — tai TIK paveikia
rezultatus, NEAPRIBOJA jų Lietuva. `gateway/service.ts`'o
`isUnambiguous = candidates.length === 1` neturėjo jokio geografinio
patikrinimo — jei Google grąžina TIK VIENĄ rezultatą (net jei jis visiškai
neteisingoje šalyje), jis automatiškai priimamas be vartotojo peržiūros.

**Taisymas:**
1. Pridėtas `components=country:LT` (kietas apribojimas, ne vien bias) prie
   geokodavimo užklausos.
2. Pridėtas Lietuvos bounding-box patikrinimas `toGeocodeResponse()` — jei
   vienintelis kandidatas yra už Lietuvos ribų, jis NEBEPRIIMAMAS automatiškai
   (demote'inamas į "ambiguous", reikalaujantis rankinio patvirtinimo).

**Svarbu:** NEPAVYKO atkurti TIKSLIAUS pranešto atvejo su spėtais adresais
("Vilties g. 10, Panevėžys" ir pan. geokodavosi teisingai net PRIEŠ taisymą) —
neturiu prieigos prie jūsų realių išsaugotų duomenų. Abu taisymai vis tiek
uždaro visą šią klaidų klasę nepriklausomai nuo tikslaus trigerio. **Šis
taisymas yra gateway kode — reikės gateway redeploy'inimo, kad pasiektų jūsų
gyvą PWA** (nedariau, kaip nurodyta).

Ta pati "ID vietoj pavadinimo" logika taikoma ir čia — jei problema kartojasi,
parašykite man TIKSLŲ adresą iš to maršruto, kad galėčiau tirti su realiais
duomenimis.

### BUG 2: "Navigacija" atidarė Google Maps vietoj Waze

**Šaknis rasta:** `delivery.tsx`'o `navigate()`:
```ts
const canWaze = Platform.OS !== 'web' && await Linking.canOpenURL(urls.waze);
```
Web'e `canWaze` VISADA `false` (trumpo jungimo dėka, prieš net pasiekiant
`await`), tad visada krito į Google/Apple Maps fallback. `buildNavigationUrls()`
JAU generavo teisingą web-suderinamą Waze universal link
(`https://waze.com/ul?...`) web platformai — jis tiesiog niekada nebuvo
naudojamas.

**Taisymas:** web'e dabar tiesiogiai naudojamas `urls.waze` (universal link,
nereikia `canOpenURL` patikrinimo, kurio `waze://` custom schema reikalauja,
bet kurio naršyklės patikimai negali patikrinti).

**Patikrinta gyvai:** `window.open` perimtas per JS — paspaudus "Navigacija"
realiai iškviečiama `window.open("https://waze.com/ul?ll=55.7418223,24.3618089&navigate=yes", "_blank", "noopener")` su teisingomis koordinatėmis, ne Google Maps URL.

## Dizaino etapas

### Žingsnis 1: Temos statuso patikrinimas

B1 (ThemeContext/ThemeProvider/ThemePreference/app_preferences) ir B2
(Nustatymų perjungiklis + `settings/index.tsx` konvertavimas) — **abu jau
buvo pilnai padaryti** ankstesnėje šios dienos sesijoje. Patvirtinta grep'u:
`settings/index.tsx` neimportuoja statinio `colors`, naudoja `useTheme()`.

### Žingsnis 2: Likusių 17 ekranų konvertavimas

Visi 17 likę failai konvertuoti į `createStyles(colors)` pattern'ą, 4 grupėmis
su atskirais commit'ais:
- **Grupė 1** (6 komponentai): `empty-state.tsx`, `foundation-screen.tsx`,
  `pwa-runtime.tsx`, `shipment-lines-summary.tsx`, `route-map.tsx`,
  `route-map.web.tsx`.
- **Grupė 2A** (5 ekranai): `history.tsx`, `history/[id].tsx`,
  `route/[id]/result.tsx`, `route/new.tsx`, `settings/locations.tsx`.
- **Grupė 2B** (5 ekranų su sub-komponentais): `index.tsx`, `import/index.tsx`
  (didžiausias failas, 3 sub-komponentai: `DeliveryEditor`, `SourceButton`,
  `Choice`), `loading.tsx`, `review.tsx` (3 sub-komponentai: `StopEditor`,
  `Candidate`, `StateLabel`), `alternatives.tsx` (`CandidateCard`).
- **`delivery.tsx`** konvertuotas kartu su Žingsniu 3 (žr. žemiau), nes vis
  tiek reikėjo pilno perrašymo.

Sub-komponentai, renderinami kaip JSX broliai/seserys (ne per hook'ą tame
pačiame render'e), gauna `styles` (ir kur reikia `colors`, pvz.
`placeholderTextColor`) kaip explicit prop'ą, nes negali patys kviesti
`useTheme()` per tėvinio komponento render'ą.

**Patikrinta gyvai abiem temomis** (šviesi/tamsi) per naršyklės įrankį: fonas,
kortelių fonas, "Stabdyti maršrutą" mygtuko fonas, tick žymeklių spalvos —
visos teisingai perjungė reikšmes be jokio hardcoded hex likučio (patvirtinta
`grep -rl "^import { colors"` grąžina 0 rezultatų).

### Žingsnis 3: Delivery.tsx "prietaisų skydelio" dashboard

Naujas `DashboardGauge` komponentas pakeičia senąjį paprastą žiedą:
- 28 tick žymekliai per -225°..45° (270°) lanką, kas 7-tas ilgesnis/ryškesnis.
- Animuota rodyklė (needle) nuo centro iki dabartinės reikšmės pozicijos, su
  mažu apskritimu (hub) centre.
- Skaičiai monospace šriftu (`fonts.mono` iš `tokens.ts`).
- VISOS spalvos per `useTheme()`/`colors` prop'ą, jokio hardcoded hex.
- Statistikos eilutė papildyta TREČIU lauku (atstumas) su 3 rankomis
  nupieštomis SVG ikonomis (laikrodis, dėžutė, S-kreivės kelias) — bibliotekos
  neradau projekte (`@expo/vector-icons` ir pan. nėra `package.json`), tad
  nupiešiau pačiam per `react-native-svg` (jau naudojamas projekte).
- "Stabdyti maršrutą" mygtukas gavo kvadrato (stop) ikoną šalia teksto.
- Duomenų logika NEPALIESTA — visi skaičiai iš jau egzistuojančio
  `GetRouteProgress`, tik vizualas pakeistas.

**Patikrinta gyvai abiem režimais:**
- Šviesus: dashboard fonas `rgb(246,247,249)` (#F6F7F9), kortelės
  `rgb(255,255,255)`, stabdymo mygtukas `rgb(180,35,24)` (#B42318).
- Tamsus: dashboard fonas `rgb(20,23,28)` (#14171C), kortelės
  `rgb(29,33,41)` (#1D2129), stabdymo mygtukas `rgb(240,69,63)` (#F0453F),
  major tick spalva `#8A8F98`.
- SVG struktūra patikrinta per JS: kiekvienas gauge turi 29 `<line>`
  (28 tick + 1 needle) ir 3 `<circle>` (track/progress/hub) — atitinka dizainą.

### Žingsnis 4: Bendra vizualinė kokybė

- Spacing/typography: jau nuosekliai per `tokens.ts` `spacing`/`fonts` visame
  kode (patikrinta per visą šios sesijos darbą, jokių hardcoded reikšmių
  naujuose pakeitimuose).
- Border-radius: nuosekliai 12–18 diapazone visur, jokių akivaizdžių
  neatitikimų nepastebėta.
- Siauro ekrano (375px) patikrinimas per naršyklės įrankį:
  `delivery.tsx` (su nauju dashboard'u), `history.tsx`, `settings/index.tsx`,
  `import/index.tsx` — **jokio horizontalaus scroll'inimo nerasta**
  (`document.body.scrollWidth === document.body.clientWidth === 375` visur).
- Didelių struktūrinių pakeitimų nedariau, kaip nurodyta.

## Kas liko neaišku / nebaigta

1. **BUG 1 (žemėlapis)** — taisymas pagrįstas, bet NEPATVIRTINTAS su TIKRAIS
   pranešto atvejo duomenimis (neturiu prieigos prie jūsų DB). Reikės jūsų
   patikrinimo su realiu maršrutu POST-deploy.
2. **Gateway pakeitimai reikalauja atskiro deploy**, kad pasiektų jūsų gyvą
   PWA — aš to nedariau (kaip nurodyta).
3. `alternatives.tsx` žemėlapis (Leaflet) rodo tik web'e — native versija vis
   dar SVG schema (nepakito šią sesiją, žinoma iš anksčiau).
4. Naujas `DashboardGauge` NEpatikrintas su realiu skaičiu artimu 0 arba 1
   (kraštinės reikšmės) — testuota tik su realiu progreso duomenimis
   (0 iš 2 pristatyta), needle/arc elgesys ties fraction=0/1 tikėtinas
   teisingas pagal formulę, bet nepravestas explicit testas.

## Commit'ai šios sesijos (chronologine tvarka)

| Tema | Commit |
|---|---|
| Alert modalo fix'as (ankstesnė šios dienos dalis) | `2ed32f6` |
| BUG 1 + BUG 2 (geokodavimas + Waze) | `678d311` |
| Temos grupė 1 (komponentai) | `377b683` |
| Temos grupė 2A (history/result/new/locations) | `5a4024e` |
| Temos grupė 2B (index/import/loading/review/alternatives) | `db8b7cc` |
| Dashboard redesign + delivery.tsx tema | `bf0af34` |

*(Pastaba: pirmas bandymas commit'inti Grupę 1 be pilno pathspec'o per klaidą
įtraukė nesusijusį 51-failų senos Expo šablono bloką — tai IŠTAISYTA per
`git reset --soft HEAD~1` prieš tęsiant, jokio duomenų praradimo nebuvo.)*

---

# Sesija 2026-08-05 (deploy'o diena): 3 UX pataisymai + 2 tyrimai

Šioje sesijoje **jau buvo atliktas VIENAS deploy** (revizija `logistikos-pristatymai-00015-bjd`,
patikrinta gyvai prieš deploy'inant, vartotojo aiškiai autorizuota kaip vienkartinė išimtis).
Visi TOLESNI šio skyriaus pakeitimai — **tik lokalūs commit'ai, deploy NEPALEISTAS**, kaip
aiškiai nurodyta: vartotojas nori viską kelti vienu kitu deploy'umi kartu su papildomu
dizaino punktu, kurio dar laukia.

## 1. "Perskaičiuoti likusį maršrutą" — rezultatas atsirasdavo už matomos srities

**Root cause:** [src/app/route/[id]/delivery.tsx](src/app/route/%5Bid%5D/delivery.tsx) —
mygtukas (`testID="recalculate-remaining-route"`) buvo virš sustojimų sąrašo, o
`recalculation` pasiūlymo kortelė (`testID="recalculation-proposal"`) buvo renderinama
**po** viso `visibleStops.map(...)` sąrašo, prieš "Užbaigti maršrutą" mygtuką — t.y.
kelių ekranų aukščio atstumu žemiau paties mygtuko. Paspaudus mygtuką ekranas
nesiscrollindavo, tad vartotojui atrodydavo, kad niekas neįvyko.

**Taisymas:** paprasčiausias/saugiausias variantas pagal esamą layout — perkelta
`recalculation` kortelės JSX blokas taip, kad renderintųsi **iškart po** pačiu
"Perskaičiuoti likusį maršrutą" mygtuku (prieš sustojimų sąrašą), o ne po jo. Jokios
naujos `scrollTo`/`ref` logikos nereikėjo — React Native `ScrollView` vis tiek automatiškai
laiko srauto tvarką, todėl pakako pakeisti JSX poziciją.

**Patikrinta gyvai:** pridėjus naują tašką vykdomame maršrute (žr. praėjusios sesijos
dalies "add stop" testą), pasiūlymo kortelė "Naujas likusios sekos variantas" su
"Patvirtinti naują seką"/"Palikti esamą seką" pasirodė **iškart matomoje srityje**, be
scrollinimo.

## 2. Žalias/oranžinis taškas prie atvykimo laiko

**Duomenų šaltinis:** panaudota **jau esanti** [src/application/routes/route-eta.ts](src/application/routes/route-eta.ts)
`etaScheduleState(stop)` funkcija — ji jau lygina `latestEstimatedArrivalAt` su
`plannedArrivalAt` ir grąžina `'on_time' | 'late' | 'early' | 'unavailable'`. Ši funkcija
JAU naudojama `scheduleLabel()` tekstui ("Pagal planą" / "X min. vėliau") rodyti — jokios
naujos skaičiavimo logikos nerašyta, tik naujas spalvos mapper'is virš to paties rezultato:
[src/ui/route-eta-labels.ts](src/ui/route-eta-labels.ts) `scheduleDotColor()`:
`'late' → warning (oranžinė)`, `'on_time'/'early' → success (žalia)`, `'unavailable' → null` (jokio taško).

**Svarbi pastaba dėl interpretacijos:** užduotyje minima "ar atvykimas tilpsta į nustatytą
laiko langą" pažodžiui reikštų palyginimą su `deliveryTimeFrom`/`deliveryTimeTo` (kliento
pageidaujamu langu), o ne su `plannedArrivalAt` (pirminiu maršruto planu). Patikrinau —
tikrasis laiko-lango minkštas įspėjimas (`REQUIRED_TIME_WINDOW`, tipas `'soft'`,
[src/domain/routing/constraints/constraint-evaluator.ts:113-131](src/domain/routing/constraints/constraint-evaluator.ts))
egzistuoja TIK maršruto planavimo/optimizavimo metu (per `CandidateStopSchedule.lateMinutes`),
**neišsaugomas** kiekvienam `DeliveryStop` DB įraše vėlesniam gyvam naudojimui pristatymo
metu. Kadangi užduotis aiškiai prašė NErašyti naujos skaičiavimo logikos, o `etaScheduleState`
yra vienintelis JAU EGZISTUOJANTIS, JAU DB duomenimis paremtas, JAU UI sluoksnyje rodomas
"ar viskas pagal planą" signalas kiekvienam taškui — panaudojau būtent jį. Praktiškai
skirtumas nedidelis (jei maršrutas vėluoja nuo plano, greičiausiai vėluos ir nuo kliento
lango), bet jei norėsite TIKSLIAI pagal `deliveryTimeFrom`/`deliveryTimeTo` langą — tai
reikštų arba naują palyginimo funkciją (pažeistų "jokios naujos logikos" nurodymą), arba
`lateMinutes` persistinimą kiekvienam stop'ui po kiekvieno perskaičiavimo (didesnė, atskira
užduotis). Pasakykite, jei norite šito varianto.

Taškas rodomas **abiejose** vietose, kur rodomas `etaLabel()`: dashboard'o "SEKANTIS TAŠKAS"
kortelėje ir kiekvieno išplėsto sustojimo kortelėje.

**Patikrinta gyvai:** naujai sukurtame maršrute su realiais Google duomenimis, dar be
laiko langų (`deliveryTimeFrom`/`To` nenustatyti importo metu) — `etaScheduleState`
grąžina `'unavailable'` kol `plannedArrivalAt` neužpildytas, taškas teisingai nerodomas
(jokios klaidos, jokio netikėto spalvoto taško be pagrindo).

## 3. Trys užbaigimo mygtukai — patikslinta užduotis, NIEKAS NEPAŠALINTA

Pagal vartotojo pačio patikslinimą (nuotraukoje trys, ne du mygtukai) ir paties duotą
kriterijų ("jei tas pats veiksmas dviem žingsniais — NĖRA dubliavimas, palik abu"):

| Mygtukas | Spalva | `onPress` | Ką realiai daro |
|---|---|---|---|
| "Atšaukti paskutinį veiksmą" | geltona | `undoLast()` → `UndoRouteAction` | Visiškai **nesusijęs** su užbaigimu — atšaukia PASKUTINĮ sustojimo veiksmą (pakrauta/pristatyta/nepavyko), jei jis atliktas per paskutines kelias minutes (`GetLatestUndoableAction`, `undo_expires_at` langas). Rodomas tik kai toks atšaukiamas veiksmas egzistuoja. |
| "Tęsti užbaigimą" (arba "Užbaigti maršrutą", jei dar nepradėta) | žalia | `beginFinish()` → `BeginRouteCompletion` | **1-as žingsnis.** Pažymi `completion_started_at` DB įraše (kad, jei app'as užsidarytų per pusę užbaigimo, grįžus vėl atsidarytų ta pati forma) ir **atidaro** santraukos/odometro formą (`setShowFinish(true)`). **NEUŽBAIGIA maršruto.** Etiketė "Tęsti" vietoj "Užbaigti" rodoma, jei `route.completionStartedAt` jau užpildytas — t.y. vartotojas anksčiau pradėjo, bet nebaigė (uždarė app'ą), dabar tiesiog grąžinamas ten, kur buvo. |
| "Patvirtinti užbaigimą" (matomas tik atidarius formą) | žalia | `finish()` → `CompleteRoute` | **2-as žingsnis.** Realiai užbaigia maršrutą (`status='completed'`), įrašo galutinį odometrą, apskaičiuoja faktinį atstumą, ir nukreipia į rezultatų ekraną. |

**Išvada: tai NĖRA dubliuota funkcija.** "Tęsti užbaigimą" ir "Patvirtinti užbaigimą" yra du
to paties vieno veiksmo (maršruto užbaigimo) žingsniai — atidarymas ir patvirtinimas, lygiai
kaip vartotojas pats numatė kaip "nėra dubliavimo" pavyzdį. "Atšaukti paskutinį veiksmą" yra
trečia, visiškai atskira funkcija (klaidos taisymas per paskutines minutes), ne užbaigimo
dalis. **Jokio mygtuko nepašalinau** — visi trys turi skirtingą, nepersidengiančią paskirtį.

## 4. Vizualinis panašumas su "Tradiala" — PATIKRINTA, PANAŠUMO NERASTA

Ieškota kodo bazėje:
- `LinearGradient`/CSS `gradient` naudojimo UI fone/antraštėse: rasta **tik viena** vieta —
  [src/components/route-map.tsx](src/components/route-map.tsx) SVG `<LinearGradient>` maršruto
  linijai nuspalvinti (native fallback žemėlapyje), **ne** puslapio antraštė/fonas. Jokio
  tamsiai mėlyno/žalio gradiento header'io niekur nėra.
- PIN kodo/prisijungimo ekrano: **tokio ekrano visai nėra** programoje (nėra autentifikacijos
  sistemos — vienas lokalus vairuotojas, be paskyrų).
- Didelio šūkio/hero teksto: didžiausias `fontSize` visame `src/`: `32` — tik ekranų
  antraštės (pvz. "Mano pristatymai" [src/app/index.tsx:192](src/app/index.tsx:192)), be
  jokio gradiento fone, be šūkio didžiosiomis raidėmis.
- Statistikos kortelių tinklelio ant permatomo overlay: dashboard'as (`delivery.tsx`)
  naudoja lygų (flat) tamsų foną, apskritus tick-matuoklius ir monospace skaičius paprastose
  kortelėse (`borderWidth:1`, `borderColor`, jokio overlay/permatomumo efekto).

**Išvada:** dabartinis "automobilio prietaisų skydelio" dizainas (tick matuokliai, monospace
skaičiai, paprastos kortelės be gradientų, jokio PIN ekrano, jokio didelio šūkio) yra
vizualiai aiškiai skirtingas nuo aprašyto "Tradiala" dizaino. **Nieko nekeista** šiuo punktu,
kaip prašyta.

## 5. Dubliuotas istorijos įrašas — IŠTIRTA, STRUKTŪRINIO BUG'O NERASTA

**Kaip veikia istorija:** [src/database/repositories/route-repository.ts:224-232](src/database/repositories/route-repository.ts:224)
`listHistory()` — paprastas `SELECT * FROM routes WHERE status IN ('completed','cancelled')`,
be jokio JOIN. Nėra atskiros "history" lentelės — kiekvienas įrašas Istorijos ekrane
atitinka **vieną konkretų `routes` lentelės eilutę** (vieną `route_id`).

**Patikrinta, ar `CompleteRoute`/`CancelDraftRoute` gali sukurti antrą įrašą tam pačiam
`route_id`:**
- [src/application/routes/route-commands.ts:657-675](src/application/routes/route-commands.ts:657)
  `CancelDraftRoute` — `UPDATE routes SET status='cancelled' ... WHERE id = ?`. **UPDATE, ne
  INSERT.**
- [src/application/routes/route-workday.ts:676-745](src/application/routes/route-workday.ts:676)
  `CompleteRoute` — `UPDATE routes SET status='completed' ... WHERE id = ? AND status =
  'in_progress'`, su papildoma apsauga: jei `result.changes !== 1`, meta klaidą "Maršruto
  būsena jau pasikeitė". Taip pat **UPDATE, ne INSERT**, ir dar su explicit guard'u prieš
  lenktynių sąlygą (race condition).
- Abi komandos pradžioje tikrina `route.status` per `assertRouteTransition()` — maršrutas
  jau esantis `'cancelled'` NEGALI pereiti į `'completed'` (ir atvirkščiai): kiekvienas
  `route_id` gali pasiekti **tik vieną** iš dviejų galutinių būsenų, niekada abi.
- Papildomai patikrinau `CreateDraftRoute` ([route-commands.ts:163-190](src/application/routes/route-commands.ts:163)) —
  jau turi dvi apsaugas nuo atsitiktinio dubliavimo: `commandId` deduplikacijos lentelė
  (`route_creation_commands`) pakartotiniam tos pačios komandos siuntimui, ir
  `getActive()` patikrinimas, kuris **neleidžia** sukurti naujo maršruto, kol esamas
  nebaigtas/neatšauktas (`draft`/`planned`/`loading`/`loaded`/`in_progress`).

**Išvada:** kodas struktūriškai **negali** sukurti dviejų istorijos įrašų tam pačiam
`route_id` — nei `CompleteRoute`, nei `CancelDraftRoute` niekada neįterpia naujos eilutės,
abi tik atnaujina esamą, su apsaugotais, tarpusavyje išskiriančiais perėjimais. Taisyti
nėra ko — **jokio kodo pakeitimo šiuo punktu nepadaryta.**

**Kas tada yra tie du įrašai:** tai **du skirtingi `route_id`** su ta pačia adresų
sąranga (14 taškų, 1191.3 kg) — t.y. tas pats adresų sąrašas buvo naudotas kuriant maršrutą
**du kartus** (pvz. tas pats Excel/adresų sąrašas importuotas/įvestas iš naujo). Tai patvirtina
ir patys duomenys: skirtingi apskaičiuoti atstumai (519.3 km vs 663.5 km — du **skirtingi**
optimizavimo paleidimai, ne ta pati eilutė), ir vienas turi REALŲ pristatymo progresą
(13 sėkmingų, 208 km faktinis), o kitas — jokio (0 sėkmingų, atšauktas prieš pradedant).
Kadangi `CreateDraftRoute` neleidžia turėti dviejų aktyvių maršrutų vienu metu (žr. aukščiau),
šie du maršrutai turėjo būti sukurti **nuosekliai, dviem atskirais vartotojo veiksmais**
(sukurta #1 → atšaukta #1 → sukurta #2 → užbaigta #2), ne vienu bug'u. Tai atitinka
ankstesnės šios dienos sesijos dalies ("vakaras" skyrius aukščiau, 3 punktas) aprašytą
"Valyti"/Alert-fix testavimą, kai maršrutas su realiais adresais buvo sąmoningai sukurtas
ir atšauktas testavimo tikslais.

**Neturiu prieigos prie jūsų realios telefono DB**, tad negaliu 100% patvirtinti, kad tai
buvo BŪTENT tas testavimas, o ne, pvz., pačio vairuotojo atsitiktinis dvigubas maršruto
sukūrimas. Bet kodo lygmenyje esu tikras: tai **vienkartinis įvykis** (du atskiri vartotojo
sprendimai), **ne pasikartojantis bug'as** — struktūra tiesiog neleidžia to atsitikti
automatiškai/tyliai.

## Patikrinimai po visų 5 punktų

`tsc --noEmit` — 0 klaidų. `vitest run` — visi testai praėję. Gyvai patikrinta per
naršyklės testavimo įrankį (tamsi tema): #1 (perskaičiavimo kortelė matoma iškart), #2
(taškas rodomas/nerodomas teisingai priklausomai nuo duomenų). #3–#5 yra tyrimai/dokumentacija
be kodo pakeitimų delivery sraute, patikrinti kodo skaitymu ir esamais automatiniais testais.

**Deploy STATUSAS: NEPALEISTAS.** Laukiama vartotojo komandos ir papildomo dizaino punkto.

---

# Sesija 2026-08-05 (po deploy'aus #2): 3 nauji testavimo punktai

## Būsima idėja (NEĮGYVENDINTA sąmoningai): swipe gestai statusams

Vartotojas paprašė **neįgyvendinti dabar**, tik užrašyti kaip idėją ateičiai:

Leisti braukti (swipe) per pristatymo taško eilutę [delivery.tsx](src/app/route/%5Bid%5D/delivery.tsx)/
[loading.tsx](src/app/route/%5Bid%5D/loading.tsx), kad pažymėtų "pristatyta"/"nepavyko" arba
"pakrauta"/"nepakrauta" vietoj mygtukų paspaudimo. Grynai pagalbinis patogumas — dabartinis
mygtukų būdas jau veikia gerai, tai nepakeičia esamo funkcionalumo, tik pridėtų alternatyvų
greitąjį kelią.

**Pastaba įgyvendinimui, kai bus paprašyta:** projekte jau yra `SwipeActionCard`
([src/components/swipe-action-card.tsx](src/components/swipe-action-card.tsx)), naudojamas
`delivery.tsx` sustojimo kortelėms (`onSwipeRight`/`onSwipeLeft` props jau prijungti prie
`delivered()`/`beginFailed()`) — t.y. **swipe-to-pristatyta/nepavyko delivery.tsx ekrane JAU
VEIKIA** (patikrinta kodu, komponentas turi swipe logiką). Tai, ko dar NĖRA — tas pats
`loading.tsx` (pakrauta/nepakrauta pažymėjimui per swipe, ne tik mygtuku) ir bet koks
vizualus/haptic patvirtinimas ar atradimo užuomina (pvz. pirmas kartas parodyti "braukite
kortelę" hint'ą), kad vartotojas apskritai sužinotų apie šią galimybę.

## 2. Neatpažinto adreso taisymas tiesiai importo ekrane

**Root cause priminimas:** "N adreso(-ų) nepavyko atpažinti" kortelė
[src/app/import/index.tsx](src/app/import/index.tsx) rodė problemą, bet neturėjo jokio veiksmo —
tos Excel eilutės (`row.normalizedAddress === null`) niekada nepatenka į `excelPreview.groups`
(žr. `groupExcelRows()` `logistics-excel-v1.ts`), tad `excelPreviewToDraftStops()` jas visiškai
praleidžia kuriant maršrutą.

**Sprendimas — naujas `UnresolvedRowFixer` komponentas** (renderinamas kiekvienai
`unresolvedExcelRows` eilutei tiesiai įspėjimo kortelėje):
1. Redaguojamas adreso `TextInput`, pradinė reikšmė iš `row.rawColumnE ?? row.rawColumnD`.
2. "Bandyti geokoduoti iš naujo" — naudoja **jau esamą** `addressResolver`
   (`GatewayAddressResolver`, tas pats, kurį naudoja visas likęs importo srautas
   `resolveDeliveryAddresses()` per `revalidate()`) — jokio naujo geokodavimo kliento.
   Vienareikšmis rezultatas → `addressValidationState: 'auto_confirmed'`. Kelios kandidatės →
   `'unconfirmed'` su įspėjimu patikrinti planavimo ekrane.
3. "Įvesti koordinates rankiniu būdu" — du skaitiniai laukai (platuma/ilguma), validacija
   (`-90..90`/`-180..180`), jei geokodavimas nepavyko.
4. "Pridėti tašką be geokodavimo" — priima vien tekstą, `latitude`/`longitude: null`,
   `addressValidationState: 'unconfirmed'`.

**Kaip šie taškai patenka į maršrutą:** `sendToRouting()` dabar renka `manualStops` iš
`manualRowResolutions` state'o (adresas + koordinatės + likę lauko duomenys: svoris, laiko
langas, gavėjas iš originalios `ExcelSourceRow`), su `originalOrder` pratęstu po
`excelPreviewToDraftStops()` rezultato, ir sujungia (`[...baseStops, ...manualStops]`) prieš
kviečiant `CreateDraftRouteWithStops`. Taškai su `'unconfirmed'`/be koordinačių patenka į TĄ
PATĮ jau egzistuojantį [review.tsx](src/app/route/%5Bid%5D/review.tsx) `StopEditor` srautą, kuris
JAU moka prašyti vartotojo patvirtinti/pataisyti tokius taškus (naudojamas ir kitiems
importo/OCR keliams) — jokios naujos "patvirtinimo" UI nereikėjo statyti.

**Patikrinimo pastaba (svarbu):** `tsc --noEmit` švarus. Duomenų sluoksnio elgesį (kad
"XXXXX ZZZZZ..." tipo tekstas TIKRAI lieka `normalizedAddress: null` ir patenka į
`unresolvedExcelRows`, o ne kur nors tyliai "prilimpa" prie tiekėjo/company teksto per
`looksLikeLooseStreetAddress` fallback) patikrinau griežtai — sukūriau minimalų sintetinį
`.xlsx` (per `fflate` `zipSync`, rankomis surašytas `xl/worksheets/sheet1.xml`) ir perleidau
per **tikrą** `parseLogisticsExcelWorkbook()` laikinajame vienetiniame teste — patvirtinta:
lygiai 1 nepatvirtintas įrašas, tiksliai laukiamas. **Pilno UI click-through per naršyklės
testavimo įrankį NEPAVYKO pasiekti** — `expo-document-picker` web versija atveria tikrą OS
lygio failo dialogą (arba naudoja `showOpenFilePicker()` File System Access API), o abu bandymai
tai apeiti (sintetinis `input[type=file].files` + `change` event per `DataTransfer`, ir
`window.showOpenFilePicker` shim'as) nesukėlė jokios app'o reakcijos — tai automatizuoto
naršyklės įrankio apribojimas, ne kodo problema. Vietoj to pasitikiu: (a) griežtu duomenų
sluoksnio patikrinimu aukščiau, (b) tuo, kad `UnresolvedRowFixer` naudoja TĄ PATĮ
`GatewayAddressResolver.resolve()`, kurį šios sesijos metu jau patvirtinau veikiantį gyvai
("Katedros a. 4" adreso pridėjimas maršruto viduryje) po `.env` pataisymo (žr. žemiau).

**PAPILDOMAS RADINYS šios sesijos metu (svarbu jums, nesusiję su šiuo punktu tiesiogiai):**
lokalus `.env` faile `EXPO_PUBLIC_GATEWAY_URL=http://172.20.10.5:8787` yra **pasenusi LAN IP**
— šios mašinos dabartiniai adresai yra `10.5.0.2`/`192.168.0.171`, ne `172.20.10.x` (tai atrodo
kaip anksčiau naudoto telefono/hotspot IP likutis). **Tai NEPALIEČIA jūsų production/deployed
app'o** (Cloud Run versija naudoja `/api/*` proxy per tą patį domeną, ne šitą kintamąjį — žr.
`scripts/pwa-build.mjs`, kuris šį kintamąjį PAŠALINA prieš production build'ą). Tai paveikia TIK
lokalų `expo start --web`/dev serverio testavimą per telefoną tame pačiame LAN, jei kada tai
darysite — geokodavimas ten neveiks, kol IP neatnaujinsite `.env` faile. Šiai sesijai laikinai
pasikeičiau į `http://localhost:8787` testavimui ir **grąžinau atgal** originalų `172.20.10.5`
prieš baigdamas — jūsų `.env` liko toks, koks buvo, aš tik atkreipiau dėmesį į problemą.

## 3. Rankinis maršruto sekos tvarkymas (naujas funkcionalumas)

**Vieta:** [src/app/route/[id]/alternatives.tsx](src/app/route/%5Bid%5D/alternatives.tsx) —
"Maršruto variantai" ekranas, kur jau rodoma optimizuota seka kandidatų kortelėse.

**Drag&drop biblioteka:** patikrinau `package.json` — projekte tokios NĖRA. Pagal nurodymą
naudojau paprastus ↑/↓ mygtukus (`moveManualStop()` sukeičia gretimus elementus masyve).

**Srautas:**
1. Mygtukas "Įjungti rankinį maršrutizavimą" — pasirodo, kai `request` jau apskaičiuotas.
   Pirmą kartą įjungus, `manualOrder` inicializuojamas iš `selectedCandidate.stopSequence`
   (patogus atspirties taškas, ne tuščia/pradinė importo tvarka).
2. Įjungus — sąrašas SUSKLEISTAS (tik `index+1. adresas`), su ↑/↓ mygtukais kiekvienai eilutei
   (kraštinės eilutės atitinkamai `disabled`). Paspaudus ant paties adreso teksto (atskiras
   `Pressable`, NE tas pats, kuriame yra ↑/↓, kad išvengčiau įdėtų `Pressable` konfliktų
   web'e) — išsiskleidžia adresas + svoris.
3. "Perskaičiuoti su šia seka" — **RASTA IR PANAUDOTA jau esanti** `evaluateCandidate()`
   funkcija ([src/domain/routing/evaluation/candidate-evaluator.ts](src/domain/routing/evaluation/candidate-evaluator.ts)),
   kuri jau egzistavo kaip `improveWithLocalSearch()`'o pirmas žingsnis — ji apskaičiuoja
   PILNĄ `RouteCandidate` (atstumas/laikas/grafikas/pažeidimai) FIKSUOTAI sekai, BE jokio
   local-search patobulinimo. Tai tiksliai atitinka reikalavimą "ne optimizuoja iš naujo
   automatiškai" — jokios naujos skaičiavimo logikos nerašiau, tik panaudojau esamą pure
   funkciją nauju būdu.
   - Kad `evaluateCandidate()` turėtų prieigą prie matricos be papildomo API skambučio,
     pridėjau `matrix: TravelMatrix` lauką į `RouteOptimizationResult` tipą
     ([src/domain/routing/models.ts](src/domain/routing/models.ts)) ir vieną eilutę
     `routing-engine.ts`'e, kad jį grąžintų — matrica jau būdavo gaunama vidury `optimize()`,
     tiesiog niekada nebuvo eksportuojama į iškvietėją. Adityvus, atgaline tvarka suderinamas
     pakeitimas (patikrinta grep'u — jokia kita vieta nekuria `RouteOptimizationResult`
     literalo be `matrix`).
4. "Naudoti šią seką" — **PILNAS integravimas su esamu pasirinkimo/išsaugojimo mechanizmu**,
   ne tik skaičiuoklė be išėjimo: sukuriamas naujas `RouteOptimizationResult`-formos objektas
   su rankine kandidate kaip `recommended`/`candidates[0]`, išsaugomas per **jau esamą**
   `SQLiteRoutingAuditRepository.saveOptimizationRun()` (naujas `routing_engine_runs` įrašas,
   nauja `requestId`), tada **jau esamas** `SaveSelectedRouteCandidate` + `ActivateRoute` —
   lygiai tas pats mechanizmas, kurį naudoja įprastas "Išsaugoti ir krautis" mygtukas. Jokios
   naujos DB lentelės/stulpelio nereikėjo.

**Patikrinta PILNAI gyvai per naršyklės testavimo įrankį** (po `.env` LAN IP pataisymo, žr.
punktą #2 aukščiau — be šito geokodavimas visur grąžindavo "Failed to fetch"):
1. Sukurtas naujas maršrutas rankiniu būdu (4 adresai), patikrinta, apskaičiuota →
   "Rekomenduojamas 107 min · 15.8 km", seka: Konstitucijos pr. 7 → Ozo g. 25 → Savanorių pr. 1
   → Gedimino pr. 9.
2. Paspaudus "Įjungti rankinį maršrutizavimą" — pasirodė suskleistas sąrašas TA PAČIA
   pradine seka.
3. Paspaudus ↓ prie 1-o taško — sukeitė vietomis su 2-uoju (patvirtinta tekstu ekrane).
4. Paspaudus "Perskaičiuoti su šia seka" — parodė **KITOKĮ, BLOGESNĮ** rezultatą
   ("118 min · 18.7 km" vs originalus optimizuotas "107 min · 15.8 km") — tiksliai taip, kaip
   tikėtasi: rankiniu būdu sudaryta (sąmoningai ne optimali) seka duoda blogesnius skaičius,
   įrodo, kad tai TIKRAI fiksuotos sekos skaičiavimas, o ne pakartotinis optimizavimas.
5. Paspaudus "Naudoti šią seką" — app'as pilnai perėjo į "Krovimasis" (loading) ekraną,
   sustojimų sąrašas ten rodomas ATVIRKŠTINE tvarka (kaip krovimo ekranas visada daro) TIKSLIAI
   pagal mano rankiniu būdu nustatytą seką (Gedimino pr. 9 → Savanorių pr. 1 → Konstitucijos
   pr. 7 → Ozo g. 25) — patvirtina, kad `SaveSelectedRouteCandidate`/`ActivateRoute` realiai
   priėmė ir pritaikė rankinę seką, ne tik parodė skaičius.

**Pastaba dėl naršyklės įrankio patikimumo (sau ateičiai):** šioje sesijoje pastebėjau, kad
paprastas sintetinis `element.click()` per JS kartais NEPASIEKIA `react-native-web`'o
`Pressable` `onPress` handlerio (tikriausiai dėl gesture responder sistemos), o pilna
`pointerdown`+`mousedown`+`pointerup`+`mouseup`+`click` event seka su teisingu `clientX/clientY`
ant TIKSLAUS elemento (per `testID`/`data-testid`, kai įmanoma, arba per teksto mazgo tiesioginį
tėvą) veikia patikimai. Grynas `computer` įrankio `left_click` su `ref` (ne koordinatėmis) taip
pat veikė patikimai, kai `read_page` grąžindavo šviežią (ne cache'uotą iš ankstesnio ekrano)
medį.

## Patikrinimai po visų 3 punktų

`tsc --noEmit` — 0 klaidų. `vitest run` — 467/467. Gyvai patikrinta per naršyklės testavimo
įrankį (tamsi tema): #2 duomenų sluoksnis (laikinu vienetiniu testu su sintetiniu `.xlsx`) +
kodo peržiūra (UI click-through nepasiektas dėl file-picker automatizavimo apribojimo,
paaiškinta aukščiau); #3 pilnai, visas srautas nuo įjungimo iki realaus maršruto aktyvavimo su
rankine seka.

**Deploy STATUSAS: NEPALEISTAS.** Laukiama vartotojo komandos ir 6 dizaino variantų.

---

# Sesija 2026-08-05 (vėlyvas vakaras): Statistikos modulis + swipe užbaigimas

## Statistikos modulis

Naujas `/statistics` ekranas (žr. commit `c93fd44`) — km per dieną/mėnesį/šiandien/savaitę/
12 mėn., pristatymo baigčių suskirstymas, nesėkmės priežastys, geriausia diena, vidurkiai.
Detalus dizainas/sprendimai — žr. `graceful-honking-swing.md` plano failą (aktyvus planas,
sekcija "Statistikos modulis").

**Svarbus radinys patikrinimo metu:** naujas `StatBarChart` komponentas iš pradžių naudojo
React Native `onLayout` konteinerio pločiui matuoti — **niekada neveikė** šiame
react-native-web setup'e (0 `<svg>` elementų DOM'e, nors konteineris turėjo teisingą,
išmatuotą plotį per `getBoundingClientRect()`). Kadangi projekte NIEKUR kitur `onLayout`
nebuvo naudojamas (patikrinta grep'u — jokio precedento), tai pirmas kartas, kai šis defektas
būtų pastebėtas. Pataisyta perrašant su `useWindowDimensions()` hook'u — patikimai veikiantis
alternatyvus būdas, patvirtinta gyvai (30 + 12 `<rect>` elementų DOM'e po pataisymo).

**Patikrinta pilnai gyvai su REALIAIS duomenimis** (ne tik sintetiniais testais): sukūriau ir
užbaigiau tikrą maršrutą per visą UI srautą (geokodavimas → planavimas → krovimas → pradinis
odometras → 1 pristatyta + 1 nepavyko su priežastimi "Netilpo" → galutinis odometras →
užbaigimas), tada patikrinau `/statistics` — visi skaičiai (27 km bendrai = 18.7 nuo
anksčiau atšaukto maršruto + 8.0 faktinio šio, 1 pristatyta/1 nepavyko, "Netilpo: 1", vidurkiai
km/taškui ir taškai/maršrutui) matematiškai tiksliai sutapo su ranka paskaičiuotais. "Geriausia
diena" teisingai pažymėta "(planuota)", nes tos dienos suma apėmė VIENĄ maršrutą su estimated
(atšauktas) IR kitą su actual (užbaigtas) atstumu — konservatyvus "ne visai faktinis" žymėjimas
suveikė tiksliai kaip suprojektuota.

13 naujų testų `tests/unit/statistics.test.ts` (10 grynos funkcijos + 3 repository integracijos
su tikra SQLite/migracijomis).

**Sąmoningai NEĮTRAUKTA:** degalų/transporto/kainos statistika — `vehicles`/`trip_sheets`/
`fuel_entries` lentelės egzistuoja schema, bet jokis kodas jų neskaito/nerašo, tad tai reikštų
rodyti išgalvotus, ne realius skaičius.

## Swipe gestai — patikslinimas ir užbaigimas

Ankstesnėje šios dienos sesijos dalyje klaidingai užrašiau, kad `loading.tsx` VISAI neturi
swipe gestų. Perskaičius kodą iš naujo paaiškėjo: **swipe DEŠINĖN į "pakrauta" JAU BUVO**
(`onSwipeRight={() => markLoaded(stop.id)}`, su `disabled={stop.loadingStatus === 'loaded'}`
blokuojančiu VISĄ swipe sritį po pakrovimo). Tikrasis trūkstamas gabalas — swipe KAIRĖN
atžymėjimui (jau pakrauto taško grąžinimui į "nepakrauta"), veidrodinis `delivery.tsx`
pristatyta/nepavyko poros pavyzdžiui.

**Taisymas** ([src/app/route/[id]/loading.tsx](src/app/route/%5Bid%5D/loading.tsx)):
pašalintas blokuojantis `disabled` prop'as, vietoj to abi kryptys visada aktyvios, bet
veikia priklausomai nuo esamos taško būsenos:
```tsx
onSwipeRight={stop.loadingStatus === 'loaded' ? undefined : () => markLoaded(stop.id)}
onSwipeLeft={stop.loadingStatus === 'loaded' ? () => markUnloaded(stop.id) : undefined}
```
Nepakrautam taškui swipe dešinėn pakrauna, swipe kairėn nieko nedaro (handler `undefined`).
Pakrautam — atvirkščiai. Naudoja TĄ PATĮ `SwipeActionCard` komponentą, tą patį prop pattern'ą,
kaip jau įrodytas veikiantis `delivery.tsx`.

**Patikrinimo apribojimas:** faktinio braukimo gesto (drag su `pointermove` delta) **nepavyko
patikimai simuliuoti** per naršyklės automatizavimo įrankį — tas pats apribojimo tipas kaip
anksčiau su Excel failo įkėlimu (žr. aukščiau). Bandžiau `pointerdown`→`pointermove` (dx=100px)
→`pointerup` sekas ant `SwipeActionCard`'o šakninio elemento, be rezultato. Vietoj to patikrinau
gyvai **mygtukų kelią** (esamas alternatyvus būdas — "Pakrauta"/"Atžymėti" mygtukai
išskleistoje kortelėje), kad įsitikinčiau, jog mano pakeitimas nesulaužė nieko: paspaudus
"Pakrauta" → "1/2 (50%)", paspaudus "Atžymėti" → grąžino į "0/2" — abu keliai veikia teisingai.
Pati swipe laidų dalis (props perdavimas) identiška jau įrodytai `delivery.tsx` schemai, tad
pasitikiu ja be tiesioginio drag-testo, bet tai NĖRA pilnai patikrinta gyvai per naršyklę —
jei norėsite 100% tikrumo, patikrinkite patys realiame telefone/PWA su tikru pirštu.

`tsc --noEmit` — 0 klaidų. `vitest run` — 480/480 (be pakeitimų šiam konkrečiam pataisymui,
nes tai grynai UI laidų pakeitimas, jokios naujos verslo logikos).

**Deploy STATUSAS: NEPALEISTAS.** Laukiama vartotojo komandos ir 6 dizaino variantų.
