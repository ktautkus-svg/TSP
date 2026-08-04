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
