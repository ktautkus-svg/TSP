# Daily Use PWA v1 architektūra

## Aplinkos

| Aplinka | Frontend | Gateway | Paskirtis |
|---|---|---|---|
| Development | pagrindinis SDK 57, lokalus Expo | lokalus `:8787` | kūrimas ir testai |
| Expo Go pilotas | atskira SDK 54 telefono kopija | LAN | fizinė regresija su QR |
| Production PWA | pagrindinio SDK 57 web eksportas | tas pats Cloud Run origin po `/api` | kasdienis naudojimas be Expo Go ir kompiuterio |

SDK 54 kopija nėra production šaltinis ir nepatenka į Docker image.

## Vienas HTTPS origin

Cloud Run Node procesas aptarnauja:

- Expo SPA ir statinius failus;
- `/manifest.webmanifest` ir `/service-worker.js`;
- `/api/geocode`, `/api/matrix`, `/api/routes`, `/api/ocr`;
- `/api/device/check`;
- `/health`.

Nežinomi ne API keliai grąžina `index.html`, todėl tiesioginis dinaminio maršruto URL ar puslapio perkrovimas negrąžina 404. HTML, JavaScript, worker ir WASM atsakymai turi `Cross-Origin-Opener-Policy: same-origin` ir `Cross-Origin-Embedder-Policy: credentialless`.

## Service worker

- Navigacija: network-first, o dingus tinklui – lokaliai išsaugotas app shell.
- Versijuoti statiniai failai, SQLite WASM ir worker: cache-first.
- `/api/*`: network-only; POST atsakymai ir Gateway klaidos niekada necache'inami.
- Naudotojo duomenys: tik Expo SQLite / IndexedDB, ne service worker cache.
- Nauja versija pirmiausia įdiegiama kaip waiting worker. Aplikacija pasiūlo **Atnaujinti**, prieš reload atlieka SQLite checkpoint, o naujas worker išvalo senas savo cache versijas tik aktyvavimo metu.

## Duomenys, offline režimas ir backup

Po išsaugoto Route be interneto veikia Dashboard, krovimas, odometrai, pristatymo būsenos, failed modalas, undo, filtrai, užbaigimas, istorija ir JSON eksportas. Tinklo reikia naujam geokodavimui, realaus eismo planavimui ir rankiniam perskaičiavimui.

Nustatymuose rodomi SQLite schemos versija, paskutinis sėkmingas įrašymas, standalone režimas, service worker versija ir persistent storage būsena. Rankinis backup apima visas ilgalaikes produkto lenteles, išskyrus laikiną matricos cache. Atkūrimas tikrina formatą ir schemą, parodo santrauką ir vyksta viena transakcija; klaidos atveju rollback išsaugo ankstesnius duomenis.

Gateway raktas ir Google API raktai į backup nepatenka.

## Vieno įrenginio Gateway apsauga

Tai nėra kelių naudotojų autentifikacija. Vieno asmeninio įrenginio raktas saugomas Cloud Secret Manager kaip `GATEWAY_DEVICE_SECRET`. Jo nėra source kode, Docker image ar web bundle. Pirmą kartą naudotojas įveda raktą PWA nustatymuose; naršyklė jį saugo atskiroje IndexedDB nustatymų saugykloje.

Kiekviena API užklausa pasirašoma HMAC-SHA256 iš timestamp, vienkartinio nonce ir request body SHA-256. Serveris tikrina leistiną laiką, parašą, nonce pakartojimą ir endpoint rate limit. Cloud Run v1 apribotas iki vienos instancijos, kad in-memory nonce registras būtų nuoseklus. Serverio cache yra tik in-memory TTL optimizacija – Cloud Run failų sistema nelaikoma patvaria.

## Build ir deploy

- `npm run pwa:build` – TypeScript, Expo web eksportas, production serverio kompiliavimas, versijuotas service worker.
- `npm run pwa:serve` – lokalus production modelio serveris.
- `npm run pwa:test` – PWA, backup ir bundle saugumo patikros.
- `npm run cloud-run:deploy` – esamo Google projekto API, Secret Manager, source build, deploy ir `/health` patikra.
- `npm run cloud-run:setup-github` – vienkartinis GitHub Actions Workload Identity setup (be JSON rakto).
- `npm run cloud-run:status` – veikiančio serviso URL ir health.

Diegimo regionas pagal nutylėjimą – `europe-north1`. Scriptas nekuria naujo Google projekto ir nerodo paslapčių; vienkartinis įrenginio raktas išsaugomas tik ignoruojamame `.runtime-logs` kataloge.

## Custom domenas vėliau

Pirmas pilotas naudoja `run.app` HTTPS URL. Vėliau `logistika.sumis.lt` galima prijungti per Cloud Run domain mapping arba rekomenduojamą Google HTTPS load balancer, DNS nukreipus tik naują subdomeną. Veikiantis `sumis.lt` projektas ir jo `PUBLIC` katalogas šiame etape neliečiami.

## Fizinio iPhone ribos

Automatiniai testai negali patvirtinti „Add to Home Screen“, iOS saugyklos išlikimo po telefono perkrovimo, „Waze“ universal link ar grįžimo į standalone PWA. Šie punktai atliekami pagal `PWA_IPHONE_INSTALL.md`. Iki jų rezultatas gali būti daugiausia **READY FOR PWA SUPERVISED PILOT**.
