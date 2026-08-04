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
