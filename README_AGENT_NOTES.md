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
