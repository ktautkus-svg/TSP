# Daily Use PWA v1 – readiness ataskaita

Data: 2026-08-03

## Būsena

**NOT READY** viešam PWA adresui, nes Cloud Run dar nepaskelbtas. Vienintelis deployment blokatorius: įdiegtame `gcloud` nėra prijungtos Google paskyros ir nepasirinktas esamas projektas.

Po `gcloud init` paruošta komanda gali sukurti Secret Manager versijas, suteikti pasirinkto Cloud Run runtime account tik `secretAccessor` teises, atlikti source build, deploy, `/health` patikrą ir parodyti `run.app` URL. Iki fizinio iPhone sąrašo rezultatas negalės būti aukštesnis nei **READY FOR PWA SUPERVISED PILOT**.

## Paruošta

- Pagrindinis Expo SDK 57 eksportuojamas kaip `single` SPA.
- Vienas production Node procesas aptarnauja frontend, manifestą, service worker, `/api/*` ir `/health`.
- Tiesioginiai Dashboard, importo, istorijos, route ir nustatymų URL lokaliai grąžina `200`, ne `404`.
- SQLite WASM ir worker įtraukti į versijuotą offline app-shell cache.
- COOP `same-origin` ir COEP `credentialless` patikrinti HTML bei statiniams failams.
- `/api/*` service worker necache'ina.
- Gateway apsaugotas device HMAC, timestamp, nonce replay kontrole, endpoint rate limit ir Cloud Run Secret Manager modeliu.
- Production Gateway cache yra in-memory TTL, failų sistema nelaikoma patvaria.
- Nustatymuose įgyvendinta SQLite/PWA diagnostika, įrenginio prijungimas, pilnas JSON backup ir atominis restore.
- PWA navigacijai web režime naudojamas Waze HTTPS universal link; Apple/Google fallback logika išsaugota.
- `Mail → Save to Files → PWA → Importuoti Excel` naudoja esamą browser file picker importą. Failas `2026.08.03 Vilnius.xlsx` kompiuteryje nerastas, todėl konkretus failas nebuvo fiziškai pakartotinai importuotas.

## Patikros

| Patikra | Rezultatas |
|---|---|
| TypeScript | PASS |
| Visi produkto testai | PASS – 42 failai, 449 testai |
| Gateway testai | PASS – 10 failų, 50 testų |
| SQLite schema | PASS – v11, 28 lentelės |
| Expo Doctor | PASS – 20/20 |
| Expo install check | PASS |
| PWA/backup testai | PASS – 2 failai, 7 testai |
| Expo production web export | PASS – SQLite WASM + worker įtraukti |
| Production bundle scan | PASS – 0 konfigūruotų URL, privačių IP, testinio adreso ir paslapčių |
| Vietinis production `/health` | PASS – `status: ok` |
| SPA dynamic URL reload | PASS – visi nurodyti keliai HTTP 200 |
| COOP / COEP | PASS |
| Nepasirašyta Gateway užklausa | PASS – 401 |
| Teisingas device HMAC | PASS – 200 |
| Pakartotas nonce | PASS – 401 |
| Offline app shell | PASS – Dashboard matomas sustabdžius vietinį serverį |
| Service worker update | PASS – parodytas pasiūlymas, atnaujinta versija, SQLite schema liko v11 |
| Backup eksportas UI | PASS – sukurtas JSON ir parodytas patvirtinimas |
| Backup restore / rollback | PASS automatiniuose SQLite testuose |
| Docker build / local run | BLOCKED – šiame kompiuteryje nėra Docker runtime |
| Cloud Run deploy | BLOCKED – būtinas `gcloud init` |
| Cloud Run `/health` | NOT RUN – servisas dar nepaskelbtas |
| Production Cloud URL E2E | NOT RUN – servisas dar nepaskelbtas |
| iPhone Add to Home Screen | NOT RUN – turi atlikti naudotojas |

## Duomenų sauga ir rollback

- Google ir Gateway paslaptys neįtraukiamos į frontend, backup ar Docker build context.
- `.env`, realūs Excel, SQLite DB, testai, ataskaitos, SDK 54 kopija ir git istorija neįtraukiami į runtime image.
- PWA atnaujinimas nepakeičia SQLite schemos ar duomenų; cache versijos keičiamos atskirai.
- Prieš pirmą realią darbo dieną naudotojas turi parsisiųsti backup iš Nustatymų.
- Nesėkmingo restore atveju SQLite transakcija rollback'ina visą operaciją.
- Cloud Run revision nesėkmės atveju galima nukreipti srautą į ankstesnę revision; telefono SQLite lieka įrenginyje ir nuo revision nepriklauso.

## Likę veiksmai

1. Naudotojas vieną kartą paleidžia `gcloud init`, prisijungia ir pasirenka jau naudojamą Google projektą.
2. Pakartojama `npm run cloud-run:deploy`.
3. Atliekamas `PWA_IPHONE_INSTALL.md` sąrašas su gautu HTTPS URL.
4. Fiziškai patikrinami Excel iš „Files“, Waze, grįžimas į PWA, saugykla po iPhone restart ir aktyvus Route be interneto.

Custom domenas `logistika.sumis.lt` atidėtas po `run.app` piloto; esamas `sumis.lt` projektas nepakeistas.
