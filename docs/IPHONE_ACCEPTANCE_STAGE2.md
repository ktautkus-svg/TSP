# iPhone piloto priėmimo testai – Stage 2.1

Šis dokumentas skirtas fiziniam iPhone bandymui. Automatinės patikros nepakeičia Waze, Apple Maps, iOS leidimų, klaviatūros ir realaus grįžimo į aplikaciją patikros.

Ekrano nuotrauką darykite tik nesėkmės atveju. Prie nesėkmės nukopijuokite visą klaidos tekstą ir pažymėkite, ar ji pasikartojo pakartojus veiksmą vieną kartą.

## Ryšio diagnostika prieš testą

1. Kompiuteryje projekto kataloge paleiskite `npm run pilot:ios`.
2. Terminale raskite dabartinius `iPhone Safari` ir `Expo URL` adresus. Nenaudokite vakar dienos IP.
3. Kompiuteryje gateway eilutė turi baigtis `/health`; ją atidarius turi būti `"status":"ok"`.
4. iPhone prijunkite prie to paties Wi-Fi kaip kompiuterį. Mobilų VPN ir Private Relay bandymo metu išjunkite.
5. iPhone Safari atidarykite terminale parodytą `http://<LAN_IP>:8787/health`. Turi būti `status: ok`.
6. iOS Settings → Expo Go patikrinkite, kad Local Network leidimas įjungtas.
7. Expo Go nuskenuokite terminalo QR kodą arba atidarykite terminale parodytą `exp://<LAN_IP>:8081`.
8. Jei Safari nepasiekia health, patikrinkite Windows tinklo profilį ir leiskite Node privačiame Windows Firewall tinkle. Skriptas Firewall taisyklių nekeičia.

| Patikra | Laukiamas rezultatas | PASS / FAIL | Klaidos tekstas | Pasikartoja? |
|---|---|---|---|---|
| Gateway kompiuteryje | `status: ok` |  |  |  |
| Gateway iPhone Safari | `status: ok` |  |  |  |
| Expo URL | Aplikacija atsidaro Expo Go |  |  |  |
| Local Network leidimas | Įjungtas |  |  |  |
| Dabartinis LAN IP | Sutampa su `pilot:ios` išvestimi |  |  |  |

## A. Trumpas smoke testas (3 vietos)

Naudokite pradžią Šiauliuose, du pristatymo taškus Šiauliuose ir atskirą pabaigą Šiauliuose.

| # | Veiksmas | Laukiamas rezultatas | PASS / FAIL | Klaidos tekstas | Pasikartoja? |
|---:|---|---|---|---|---|
| 1 | Atidaryti aplikaciją per Expo Go | Matomas Dashboard, nėra Network Error ar native/SVG klaidos |  |  |  |
| 2 | Nustatymuose išsaugoti sandėlį ir namus Šiauliuose | Abi vietos išlieka grįžus į ekraną |  |  |  |
| 3 | Importuoti du Šiaulių pristatymo adresus | Sukuriamos dvi redaguojamos kortelės |  |  |  |
| 4 | Geokoduoti ir patvirtinti adresus | Abu adresai patvirtinti realiais Google duomenimis |  |  |  |
| 5 | Pasirinkti pradžią ir pabaigą, optimizuoti | Rodomas realus maršrutas; pradžia ir pabaiga nepakeistos testiniu adresu |  |  |  |
| 6 | Pasirinkti variantą ir spausti „Išsaugoti ir krautis“ | Atidaromas krovimosi ekranas |  |  |  |
| 7 | Vieną tašką pažymėti swipe į dešinę | Taškas tampa pakrautas, progresas pasikeičia |  |  |  |
| 8 | Kitą tašką pažymėti matomu „Pakrauta“ mygtuku | Abu taškai pakrauti; swipe turi mygtuko alternatyvą |  |  |  |
| 9 | Įvesti pradinį odometrą skaitine klaviatūra | Klaviatūra neuždengia patvirtinimo mygtuko, reikšmė išsaugoma |  |  |  |
| 10 | Pradėti maršrutą | Dashboard ir vykdymas rodo `in_progress` |  |  |  |
| 11 | Paspausti pirmo taško navigaciją | Pirmiausia bandomas Waze; jei jo nėra, atsidaro Apple Maps |  |  |  |
| 12 | Grįžti iš navigacijos į aplikaciją | Maršrutas ir taškų būsenos išlikusios |  |  |  |
| 13 | Uždaryti aplikaciją, paleisti iš naujo | Rodomas „Tęsti maršrutą“, pakrovimas ir odometras išlikę |  |  |  |

## B. Pilnas 9 Šiaulių taškų priėmimo testas

| # | Spaudžiamas veiksmas | Laukiamas rezultatas | PASS / FAIL | Klaidos tekstas | Pasikartoja? |
|---:|---|---|---|---|---|
| 1 | Nustatyti sandėlį ir namus Šiauliuose | Išsaugotos dvi skirtingos vietos |  |  |  |
| 2 | Dokumentų importe įklijuoti 9 Šiaulių taškų sąrašą | Matomos 9 pristatymų kortelės |  |  |  |
| 3 | Spausti „Geokoduoti adresus“ ir patvirtinti probleminius | Visi 9 adresai patvirtinti arba aiškiai pataisyti |  |  |  |
| 4 | Tęsti į maršruto planavimą | Matomi pasirinkti sandėlis ir namai |  |  |  |
| 5 | Spausti „Skaičiuoti maršrutą“ | Rodomi Google realūs duomenys, eismas ir įvykdomas variantas |  |  |  |
| 6 | Pasirinkti variantą ir „Išsaugoti ir krautis“ | Route būsena `loading`, matomi 9 taškai atvirkštine krovimo tvarka |  |  |  |
| 7 | Pakrauti 3 taškus | Progresas 3/9, svorio ir nežinomo svorio skaičiai teisingi |  |  |  |
| 8 | Pilnai uždaryti Expo Go ir vėl atidaryti projektą | Dashboard siūlo tęsti krovimą, 3 taškai tebėra pakrauti |  |  |  |
| 9 | Pakrauti likusius 6 taškus | Route būsena `loaded`, progresas 9/9 |  |  |  |
| 10 | Įvesti pradinį odometrą ir išsaugoti | Reikšmė rodoma krovimo bei Dashboard ekranuose |  |  |  |
| 11 | Spausti „Pradėti maršrutą“ | Atidaromas vykdymas, būsena `in_progress` |  |  |  |
| 12 | Tris taškus pažymėti „Pristatyta“ | Progresas ir likučiai pasikeičia, veiksmai nesidubliuoja |  |  |  |
| 13 | Vienam taškui spausti „Nepavyko“ | Atidaromas slenkamas komentaro modalas |  |  |  |
| 14 | Pasirinkti priežastį, įrašyti komentarą ir išsaugoti | Failed būsena bei komentaras matomi; tuščias komentaras neleidžiamas |  |  |  |
| 15 | Spausti „Atšaukti veiksmą“ | Ankstesnė būsena grąžinama, audito įrašas išlieka |  |  |  |
| 16 | Vėl pažymėti failed su komentaru, uždaryti ir atidaryti aplikaciją | Failed komentaras, pristatymai, odometras ir seka išlikę |  |  |  |
| 17 | Atjungti kompiuterio gateway / internetą ir atidaryti aktyvų maršrutą | Išsaugotas maršrutas naudojamas; taškus galima žymėti vietoje |  |  |  |
| 18 | Įjungti ryšį, pristatyti visus likusius taškus | Likutis 0, progresas 100 % |  |  |  |
| 19 | Spausti „Užbaigti maršrutą“, įvesti galutinį odometrą | Rodoma santrauka; faktinis atstumas yra odometrų skirtumas |  |  |  |
| 20 | Patvirtinti užbaigimą | Route būsena `completed`, pakartotinis paspaudimas nedubliuoja |  |  |  |
| 21 | Atidaryti istorijos detalę ir grįžti į Dashboard | Istorijoje tos pačios pradžios/pabaigos vietos, būsenos, komentarai ir km; Dashboard neturi aktyvaus maršruto |  |  |  |
| 22 | Istorijoje spausti „Eksportuoti piloto diagnostiką“ | iOS Share lape pateikiama JSON ataskaita be API raktų ir paslapčių |  |  |  |

## Techninė telefono UI patikra

| Kriterijus | PASS / FAIL | Pastaba |
|---|---|---|
| Pagrindiniai mygtukai virš safe area |  |  |
| Swipe visur turi matomą mygtuko alternatyvą |  |  |
| Odometrui rodoma skaitinė klaviatūra |  |  |
| Klaviatūra neuždengia odometro ir failed patvirtinimo |  |  |
| Failed modalas slenkamas mažame ekrane |  |  |
| Ilgi lietuviški adresai neišeina iš kortelės |  |  |
| Paspaudimo zonos bent apie 44 pt |  |  |
| Planšetėje kortelės ir modalai nesusigadina |  |  |

Baigus sustabdykite tik šio projekto procesus komanda `npm run pilot:stop`.
