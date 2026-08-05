# MVP darbų sąrašas

Šis sąrašas paverčia techninį projektą į mažas, patikrinamas vertikalias dalis.

## P0 – būtina prieš realų naudojimą

- [ ] Draft maršrutas ir vieno aktyvaus maršruto apsauga
- [ ] Copy-paste importas, originalo išsaugojimas ir patikros lentelė
- [ ] Rankinis taško įvedimas ir redagavimas
- [ ] Planavimo režimas ir pradinės / aktyvios tvarkos išsaugojimas
- [ ] Vehicle profilis su bazinėmis truck ribomis ir degalų norma
- [ ] Hard / soft constraint redaktorius
- [ ] Time-dependent kelių duomenų tiekėjo spike Lietuvos maršrutams
- [ ] Nepriklausomas hard-constraint validatorius
- [ ] Rekomenduojamas, greičiausias ir svorio prioriteto variantai
- [ ] Tonkilometrių, eismo, laukimo, manevrų ir krypties score komponentai
- [ ] Paaiškinimai ir pilnas optimizavimo auditas
- [ ] Rankinis drag-to-reorder
- [ ] Pozicijos užrakinimas, pirmas / paskutinis ir before / after
- [ ] Rankinio pakeitimo laiko / km / rizikos delta
- [ ] Krovimosi reverse sąrašas, swipe, mygtukas ir DB undo
- [ ] Pradinis odometras, praleidimas ir Dashboard priminimas
- [ ] Pristatymo sąrašas ir visi keturi filtrai
- [ ] Delivered / failed veiksmai, privalomas komentaras ir DB undo
- [ ] Waze → Maps → copy-address fallback
- [ ] Dashboard su transakcijomis atnaujinamais likučiais
- [ ] Užbaigimo santrauka, perspėjimas ir galutinis odometras
- [ ] Istorijos sąrašas ir maršruto detalė
- [ ] Dienos / savaitės / mėnesio statistika
- [ ] Vienas TripSheet keliems tos dienos maršrutams
- [ ] FuelEntry ir full-to-full faktinių sąnaudų intervalas
- [ ] Plano įvykdymo ir produktyvaus laiko KPI kaip atskiri rodikliai
- [ ] Process-death, offline ir migracijų E2E testai

## P1 – po stabilaus rankinio MVP

- [ ] Kameros ir dokumento parinkimas
- [ ] Failo kopijavimas į privatų programos katalogą
- [ ] OCR / teksto struktūrizavimo adapteris
- [ ] Confidence žymos ir patikros UX
- [ ] Atsarginio eksporto / importo formatas
- [ ] Šifravimo grėsmės modelio sprendimas
- [ ] Dinaminis likusios maršruto dalies perskaičiavimas
- [ ] Asmeninių vietų žinių pasiūlymai (soft pagal nutylėjimą)
- [ ] Istorinių aptarnavimo trukmių pasiūlymai

## Definition of Done kiekvienai būsenos komandai

- viena SQLite transakcija;
- domeno perėjimo validacija;
- action journal įrašas;
- unit ir integracinis testas;
- UI sėkmę rodo tik po commit;
- procesą nutraukus bet kuriame taške nėra dalinių duomenų;
- swipe turi matomą mygtuko alternatyvą ir undo.
