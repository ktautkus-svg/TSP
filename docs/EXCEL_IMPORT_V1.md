# LOGISTICS_EXCEL_V1

`LOGISTICS_EXCEL_V1` yra pirmasis versijuojamas, lokaliai vykdomas darbo maršruto `.xlsx` importo šablonas. Excel langeliai skaitomi tiesiogiai; OCR ir išorinis Excel konvertavimo serveris nenaudojami.

## Stulpelių susiejimas

| Reikšmė | Numatytasis stulpelis |
|---|---|
| Užsakymo numeris | A |
| Svoris kilogramais | B |
| Pristatymo laikas | C |
| Įmonė arba tiekėjo tekstas | D |
| Pristatymo adresas | E |
| Gavėjas | F |
| Maršruto kodas | G |

Susiejimas yra šablono konfigūracija, o ne domeno algoritmo konstanta. Kai antraštės ar numatytoji struktūra neatpažįstama patikimai, automatinis importas sustabdomas ir naudotojui parodomas stulpelių susiejimas.

Numatytasis geografinis kontekstas: `Šiauliai, Lietuva`.

## Tiekėjų prefiksai

Konfigūruojamas v1 sąrašas: `UAB Lambda LT`, `Lambda`, `UAB Galiasas`, `Galiasas`. Prefiksas šalinamas tik teksto pradžioje, neatsižvelgiant į raidžių dydį ir toleruojant tarpus bei kablelius. Originalūs D ir E langeliai visada išsaugomi.

## Duomenų modelis

- `DeliveryStop` yra vienas patvirtintas fizinis sustojimas, perduodamas Routing Engine.
- `ShipmentLine` yra viena originali Excel eilutė su lapo vardu, eilutės numeriu, užsakymo numeriu, tiksliu svoriu gramais, laiku, gavėju, maršruto kodu ir originalių langelių JSON.
- Vienas `DeliveryStop` gali turėti daug `ShipmentLine`; eilučių pirminiai ID nėra užsakymų numeriai.

## Grupavimas ir skaičiavimas

Pirminėje peržiūroje eilutės grupuojamos pagal normalizuotą adreso kandidatą. Galutinis grupavimas atliekamas tik po geokodavimo: vienodos patvirtintos koordinatės (5 skaitmenys po kablelio) reiškia vieną fizinį sustojimą. Gavėjo pavadinimas nėra grupavimo raktas.

Svoris saugomas sveikais gramais. Tuščias svoris yra `null`, ne nulis. Sustojimo svoris yra visų žinomų susietų eilučių gramų suma; nežinomų svorių skaičius rodomas atskirai.

Vienodi laiko langai paliekami. Persidengiančių langų rezultatas yra sankirta. Nesusikertantys langai pažymimi `TIME_WINDOW_CONFLICT` ir prieš maršruto kūrimą turi būti pataisyti.

## Auditas ir dublikatų apsauga

Importo sesija saugo failo SHA-256, lapą, eilutes, peržiūrą, rankinius pataisymus ir galutinį Route ID. Tas pats failo hash ir lapas neatidaromas kaip naujas importas tyliai: galima atkurti ankstesnę peržiūrą arba sąmoningai pradėti naujos darbo dienos importą.

Anonimizuotas testinis failas: `tests/fixtures/realaus-formato-logistikos-importas-v1.xlsx`.
