# TSP darbuotojų paskyros v1

## Paskirtis

Ši versija skirta vienos įmonės prižiūrimam pilotui. Darbuotojų tapatybės,
vaidmenys, sesijos ir maršrutų paskyrimai saugomi serverio „Firestore“ duomenų
bazėje. Maršruto darbo kopija po paskyrimo parsisiunčiama į vairuotojo įrenginio
SQLite ir gali būti vykdoma be interneto.

## Vaidmenys

- `admin` – kuria ir išjungia darbuotojus, keičia PIN, paskiria maršrutus.
- `dispatcher` – paruoštas dispečerio vaidmuo; v1 administravimo teisės jam
  nesuteikiamos automatiškai.
- `driver` – prisijungia, parsisiunčia jam paskirtą maršrutą ir vykdo jį telefone.

## Pirmas paleidimas

Kai serveryje dar nėra nė vieno darbuotojo, PWA rodo pirmo administratoriaus
aktyvavimą. Įvedami vardas, prisijungimo vardas ir 6–8 skaitmenų PIN.
Aktyvavimas papildomai apsaugotas esamu Gateway įrenginio raktu. Jei telefone
raktas dar neišsaugotas, forma paprašo jį vieną kartą įklijuoti.

## Saugumas

- PIN serveryje nesaugomas atviru tekstu: naudojamas PBKDF2-SHA-256 su atskira
  atsitiktine druska ir 210 000 iteracijų.
- Sesijos raktas saugomas `HttpOnly`, `Secure`, `SameSite=Strict` slapuke ir nėra
  prieinamas aplikacijos JavaScript ar SQLite.
- Serveryje saugoma tik sesijos rakto maiša; sesija galioja 30 dienų.
- Išjungus darbuotoją arba pakeitus PIN, jo sesijos atšaukiamos.
- Prisijungimui taikomas 10 bandymų per 15 minučių limitas vienam IP.
- Administravimo API tikrina aktyvią sesiją ir `admin` vaidmenį.

## Maršruto paskyrimas ir darbas be interneto

Administratorius administravimo ekrane pasirenka vairuotoją ir paskiria
aktyvų vietinį maršrutą. Serveris vienam vairuotojui neleidžia turėti daugiau
nei vieno neužbaigto paskyrimo. Vairuotojo PWA po prisijungimo parsisiunčia
maršruto momentinę kopiją ir idempotentiškai įrašo ją į SQLite. Darbo dienos
veiksmai vyksta vietinėje DB; atsiradus internetui būsenos santrauka perduodama
serveriui.

## Istorinis maršruto užbaigimas

`POST /api/admin/assignments/:id/complete` gali kviesti tik administratorius
arba dispečeris.

- Tuščia užklausa (įprastas tos pačios dienos kelias) `completed_at` žymi
  dabar ir nepristatytų taškų nekeičia. Kelionės lapo data lieka
  `tripSheetWorkDate`: Lietuvos kalendorinė `started_at` diena, jei jos nėra —
  `completed_at`, kitu atveju planinė `route.date`.
- Neprivalomas JSON leidžia istoriškai pradėti ir užbaigti importuotą
  priskyrimą, nenaudojant „Pradėti krovimą“ (kitaip data taptų šiandiena):

```json
{
  "startedAt": "2026-08-03T06:00:00.000+03:00",
  "completedAt": "2026-08-03T16:30:00.000+03:00",
  "markAllDelivered": true
}
```

Laikai turi patekti į reikiamą Lietuvos darbo dieną. `markAllDelivered`
pažymi likusius taškus pristatytais be GPS ir be maršrutizavimo API.
Pristatymo langai paliekami; `delivered_at` dedamas į langą tą dieną
(arba į planuotą atvykimo laiką), kad punktualumas liktų laiku.

`PUT /api/assignments/:id/progress` jau išsaugo snapshot'e esančius
`started_at` / `completed_at`. Tai nėra istorinio užbaigimo API: tam
skirtas complete su laiko laukais. Complete be laukų vis tiek perrašo
`completed_at` į dabartinį laiką.

## Duomenų modelis

Serveris naudoja kolekcijas:

- `tsp_users`;
- `tsp_usernames`;
- `tsp_sessions`;
- `tsp_assignments`.

Vietinė SQLite schema v13 turi `route_sync_state`, kuris susieja serverio
paskyrimą, vietinį maršrutą, darbuotoją, reviziją ir sinchronizavimo būseną.
Esamos Route ir DeliveryStop lentelės bei jų duomenys neperrašomi.

## Žinomos v1 ribos

- Tai dar nėra kelių įmonių ar savitarnos registracijos sistema.
- Nėra el. pašto slaptažodžio atkūrimo; PIN atstato administratorius.
- Maršruto darbo eiga pirmiausia yra local-first. v1 į serverį siunčiama
  progreso santrauka, o ne kiekvieno veiksmo realaus laiko srautas.
- Prieš kasdienį naudojimą būtinas realus testas bent su vienu administratoriaus
  ir vienu vairuotojo iPhone.

## Priėmimo scenarijus

1. Pirmame įrenginyje aktyvuoti administratorių.
2. Administravimo ekrane sukurti vairuotoją ir jo 6–8 skaitmenų PIN.
3. Paruošti maršrutą ir paskirti jį vairuotojui.
4. Kitame įrenginyje prisijungti vairuotojo vardu ir PIN.
5. Patikrinti, kad paskirtas maršrutas atsirado, veikia be interneto ir po
   prisijungimo prie interneto jo progresas pasiekia serverį.

