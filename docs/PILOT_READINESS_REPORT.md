# Pilot Readiness Report – Stage 2.1

> Istorinė piloto ataskaita. Dabartinę schemos, testų ir projekto medžio būseną žr.
> [CURRENT_STATUS.md](CURRENT_STATUS.md).

Data: 2026-08-03  
Sprendimas: **READY FOR SUPERVISED PILOT**

Fizinis iPhone priėmimo testas dar neatliktas, todėl ši versija negali būti laikoma paruošta savarankiškam kasdieniam naudojimui.

## 1. Pilnas Web E2E po paskutinės endpoint pataisos

Galutinis 21 žingsnio scenarijus paleistas iš naujo per anksčiau nenaudotą `http://localhost:8093` origin. Tai sukūrė visiškai švarią naršyklės SQLite duomenų bazę ir neleido panaudoti ankstesnio bandymo būsenos.

Scenarijus: **PASS**.

| Etapas | Faktinis rezultatas |
|---|---|
| Numatytosios vietos | Sandėlis ir namai išsaugoti atskirai SQLite |
| Importas | 9 Šiaulių taškai, 540 kg žinomo svorio, 4 taškai su nežinomu svoriu |
| Adresai | 9 pristatymai, pradžia ir pabaiga patvirtinti realiu Google geokodavimu |
| Optimizavimas | Google realūs duomenys, eismas įvertintas, įvykdomas variantas |
| Krovimas | 3/9 išsaugota, puslapis perkrautas, atkurta 3/9, vėliau 9/9 |
| Odometras | pradinis 1000,5 km, galutinis 1027,8 km, faktinis 27,3 km |
| Vykdymas | 3 pristatymai, failed su komentaru, undo, failed pakartojimas, reload |
| Offline | gateway išjungtas; likę 6 pristatymai ir Route užbaigimas veikė iš SQLite |
| Istorija | pradžia, pabaiga, 9 taškai, odometrai, failed komentaras ir auditas atkurti |
| Dashboard | po užbaigimo rodė „Aktyvaus maršruto nėra“ |

Per paruošiamąjį švarų paleidimą aptikta, kad aktyvaus failed taško kortelė rodė priežastį, bet nerodė laisvo komentaro. Atvaizdavimas pataisytas, pridėtas regresinis testas ir visas scenarijus pradėtas iš naujo. Galutiniame paleidime komentaras buvo matomas prieš ir po reload.

## 2. Naudota pradžia ir pabaiga

- Pradžia: `Pramonės g. 8, 78149 Šiauliai, Lietuva`.
- Pabaiga: `Konferencijos Salė, Tilžės g. 109, 77159 Šiauliai, Lietuva`.
- Abi vietos išliko Route, po reload ir istorijos detalėje.
- Produkciniame source ir galutiniuose bundle nerasta `Kirtimų g. 47`.

## 3. Faktinis suplanuotas maršrutas

- Planuotas atstumas: **24,3 km**.
- Važiavimo laikas: **54 min**.
- Bendras rekomenduoto varianto darbo laikas: **144 min**.
- Seka: Pramonės g. 15 → Dubijos g. 27 → Stoties g. 9C → Architektų g. 77 → Gegužių g. 30 → Gardino g. 2 → Tilžės g. 225 → Dvaro g. 144A → Vilniaus g. 128 → namai Tilžės g. 109.

Google rezultatas priklauso nuo bandymo laiko ir eismo, todėl vėlesniame bandyme kilometrai ar minutės gali nežymiai skirtis.

## 4. Automatinės ir produkcinės patikros

| Patikra | Rezultatas |
|---|---|
| TypeScript | PASS |
| Visi testai | 32 failai, 345 testai – PASS |
| Gateway testai | 10 failų, 40 testų – PASS |
| SQLite schema | v6, 22 lentelės – PASS |
| Migracija v5 → v6 | PASS, aktyvus Route išsaugomas |
| `expo-doctor` | 20/20 – PASS |
| `expo install --check` | priklausomybės aktualios |
| iOS produkcinis eksportas | 1 350 modulių, 3,2 MB – PASS |
| Android produkcinis eksportas | 1 479 moduliai, 3,5 MB – PASS |
| Serverio raktai bundle | 0 |
| Google rakto prefiksai bundle | 0 |
| Fiksuoti privatūs IP saugiuose production bundle | 0 |
| Testinis Kirtimų adresas bundle | 0 |
| Fiksuotas privatus IP produkciniame source | 0 |

Saugūs produkciniai eksportai atlikti su išjungtu vietinio `.env` įkėlimu. Vietinis `.env` turi konkretaus kompiuterio LAN URL, todėl jo negalima naudoti produkciniam build. Pilotui URL nustato `pilot:ios` tik proceso aplinkoje.

## 5. Pradžios ir pabaigos kombinacijos

Integraciniais testais patikrintos visos kombinacijos:

- sandėlis → sandėlis;
- sandėlis → namai;
- dabartinė vieta → namai;
- kita vieta → sandėlis;
- sandėlis → paskutinis pristatymo taškas;
- kita vieta → kita vieta.

Kiekvienu atveju patikrintos routing užklausos koordinatės, Route projekcija po naujos repository instancijos ir istorijos projekcija. Testinis adresas pasirinkimo nepakeitė.

## 6. Process-death rezultatas

| Būsena prieš atkūrimą | Rezultatas po naujos repository / reload |
|---|---|
| Dalinai pakrautas Route | Pakrovimo būsenos ir progresas išliko |
| Odometras įvestas, Route dar nepradėtas | Odometras ir `loaded` būsena išliko |
| Route `in_progress` | Aktyvus Route atkurtas |
| Failed su komentaru | Priežastis, komentaras ir timestamp išliko |
| Galiojantis undo | Veiksmo žurnalas ir undo ID išliko |
| Pasirinkta seka | `activeOrder` išliko |
| Pradžios ir pabaigos vietos | Abi vietos išliko |
| Užbaigtas Route | Nebuvo grąžintas kaip aktyvus; atsirado istorijoje |

Automatinis testas papildomai užblokavo `fetch` ir patvirtino, kad vietiniai pristatymo veiksmai nepriklauso nuo gateway.

## 7. Offline rezultatas

Pilno Web E2E metu po failed atkūrimo gateway procesas buvo fiziškai sustabdytas. Be gateway:

- aktyvus Route atsidarė;
- taškų seka ir visi ankstesni duomenys liko;
- 6 likę taškai buvo pažymėti pristatytais;
- likučiai perskaičiuoti;
- įvestas galutinis odometras;
- Route užbaigtas ir perskaitytas istorijoje.

Offline režimu negalima geokoduoti, gauti naujos matricos, polyline ar perskaičiuoti sekos. Jau išsaugota darbo diena dėl to neprarandama.

## 8. `pilot:ios` ir `pilot:stop`

Realus start/stop bandymas: **PASS**.

Fiziniam Expo Go bandymui komanda paleidžia SDK 54 telefono kopiją iš
`C:\Users\Karolis\Desktop\logistikos-pristatymai-sdk54-test`, o gateway – iš
pagrindinio SDK 57 projekto. Prieš generuodama QR komanda patikrina SDK major
versiją ir sustoja, jeigu ji neatitinka fizinio iPhone Expo Go palaikomos versijos.

Bandymo metu automatiškai aptikta:

- LAN adapteris ir IPv4: `172.20.10.5` (tik bandymo metu, source neįrašyta);
- gateway health: `http://172.20.10.5:8787/health` → `status: ok`;
- Expo URL: `exp://172.20.10.5:8081`;
- gateway klausė 8787 porto;
- Metro klausė 8081 porto;
- `pilot:stop` sustabdė tik state faile užregistruotus Expo ir gateway procesus;
- abu portai po sustabdymo buvo laisvi, state failas pašalintas.

Skriptas aptinka užimtus portus, nerastą LAN adapterį, nepasileidusį gateway ir nepasileidusį Metro. Windows Firewall taisyklių automatiškai nekeičia. API raktų nespausdina.

## 9. Rate-limit ankstesnės klaidos analizė

Dabartinės 60 s slankaus lango ribos vienam klientui/IP:

- bendras storm limitas: 800 užklausų/min;
- `/v1/geocode`: 600/min;
- `/v1/matrix`: 30/min;
- `/v1/polyline`: 30/min;
- `/v1/ocr/google`: 20/min.

Ribos šiame etape nepakeistos, nes 9 taškų normalus workflow su OCR, 11 geokodavimų, matrica, polyline ir vienu perskaičiavimu jas praeina, o apsauga nuo užklausų audros išlieka.

Iš seno vien tik UI teksto neįmanoma patikimai nustatyti, kuris endpointas grąžino ankstesnį 429. Tai galėjo būti geocoding, matrix, polyline arba OCR, ypač jei dar veikė senas gateway procesas ar sena bendra konfigūracija. Masinio importo metu labiausiai tikėtinas geocoding endpointas, bet tai yra išvada, ne išsaugotas faktas.

Dabar 429 atsakymas:

- turi `details.endpoint`;
- turi `Retry-After: 60`;
- UI klaidoje parodo endpointą ir saugų laukimo laiką;
- po nurodyto laiko veiksmą galima saugiai pakartoti.

Tai patikrinta realiai paleidus gateway su vienos užklausos diagnostine riba ir gavus antrą 429 atsakymą. Produkcinės/pilotinės ribos bandymo metu nebuvo sumažintos.

## 10. Piloto diagnostinis eksportas

Development arba pilot režime aktyvaus Route Dashboard ir užbaigto Route istorijos detalė turi veiksmą `Eksportuoti piloto diagnostiką`.

Eksportas pateikia:

- Route ID ir būseną;
- pradžią ir pabaigą;
- odometrus;
- taškų seką;
- loading ir delivery būsenas;
- failed priežastis bei komentarus;
- auditą ir pagrindinius timestamp;
- aplikacijos ir SQLite schemos versijas.

Jautrių laukų pavadinimai (`apiKey`, `secret`, `authorization`, `signature`, `token`, `headers`) rekursyviai užtušuojami. Eksportas nekuria bendros backup sistemos.

## 11. Telefono UI techninė patikra

Automatiškai ir per source auditą patvirtinta:

- visi swipe veiksmai turi matomą mygtuko alternatyvą;
- svarbiausi mygtukai turi 44–56 pt minimalų aukštį;
- odometro laukai naudoja `decimal-pad`;
- kortelių veiksmai persikelia į kelias eilutes;
- turinys slenkamas ir turi apatinį tarpą;
- bendras ekranų karkasas naudoja iOS safe area, `KeyboardAvoidingView` ir automatinius klaviatūros inset;
- turinio plotis planšetėje ribojamas bendru `maxContentWidth`.

Tik fiziniame iPhone dar galima galutinai patikrinti realią klaviatūrą, safe-area, swipe pojūtį, Waze/Apple Maps ir grįžimą į aplikaciją.

## 12. Fizinio iPhone likusios patikros

Neatlikta ir neapsimetama atlikus:

- SDK 54 telefono kopijos atidarymas konkrečiame Expo Go telefone;
- iOS Local Network leidimo eiga;
- gateway pasiekiamumas per konkretaus darbo tinklo Firewall;
- tikras Waze atidarymas;
- Apple Maps fallback;
- grįžimas iš navigacijos į aplikaciją;
- swipe ir klaviatūra mažame realiame ekrane;
- 3 vietų smoke testas;
- visas 9 taškų priėmimo testas.

Tikslūs žingsniai ir PASS / FAIL lentelės pateiktos `docs/IPHONE_ACCEPTANCE_STAGE2.md`.

## 13. Žinomos rizikos

1. Vietinis tinklas ir Windows Firewall gali blokuoti iPhone, nors gateway veikia kompiuteryje.
2. Pilotinis QR yra SDK 54; telefone turi būti App Store Expo Go versija, palaikanti SDK 54.
3. Realus Waze/Apple Maps elgesys automatiškai Web aplinkoje nepatikrinamas.
4. Piloto metu nereikia perkurti ar išvalyti aplikacijos duomenų – tai sunaikintų vietinę SQLite būseną.
5. Produkcinį build būtina konfigūruoti su tikru nuotoliniu gateway URL; vietinio `.env` LAN URL į produkcinį bundle dėti negalima.

## 14. Veiksmai klaidos atveju

1. Nešalinkite Expo Go ir nevalykite aplikacijos duomenų.
2. Padarykite vieną klaidos ekrano nuotrauką ir nukopijuokite visą tekstą.
3. Patikrinkite `health` URL iPhone Safari.
4. Uždarykite ir vėl atidarykite aplikaciją; Route turi atsikurti iš SQLite.
5. Dashboard pasirinkite `Eksportuoti piloto diagnostiką` ir išsaugokite ataskaitą.
6. Jei gateway nepasiekiamas, tęskite jau išsaugotą seką; neprašykite perskaičiavimo.
7. Kompiuteryje procesus sustabdykite `npm run pilot:stop`; SQLite duomenų tai netrina.

## 15. Galutinė išvada

**READY FOR SUPERVISED PILOT.**

Web, SQLite, process-death, offline, start/stop, rate-limit ir produkcinės regresijos praėjo. Vieną tikrą darbo dieną galima bandyti tik prižiūrint ir prieš ją atlikus trumpą fizinio iPhone smoke testą. Iki sėkmingo fizinio iPhone priėmimo negalima rinktis `READY FOR UNSUPERVISED DAILY USE`.
