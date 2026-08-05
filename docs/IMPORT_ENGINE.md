# Import Engine

## Laukai

Parseris ištraukia adresą, užsakymo numerį, svorį, pristatymo laiką, telefoną, gavėją ir pastabas. Kiekvienas laukas turi `value`, `confidence`, `evidence` ir `manuallyCorrected`.

Trūkstama reikšmė yra `null`, o ne tuščias nulis. Svoris tonomis konvertuojamas į kilogramus. Lietuvos telefonai normalizuojami į `+370`.

## Blokų skaidymas

- Tuščia eilutė yra stipriausia pristatymų riba.
- Jei tuščių eilučių nėra, nauja adreso eilutė pradeda naują bloką.
- Dokumento šablonas pateikia alternatyvias laukų etiketes. Pradiniai ID: `generic`, `dpd`, `dhl`, `raben`, `excel-export`.

## Adresų sprendimas

Vienas Google kandidatas parenkamas automatiškai. Keli kandidatai tik parodomi. Po rankinio adreso taisymo vartotojas spaudžia „Patikrinti pataisytus adresus“.

## Dublikatai

Prioritetas:

1. tas pats užsakymo numeris – siūloma jungti;
2. tas pats normalizuotas adresas – siūloma jungti;
3. Levenshtein panašumas `>= 0.82` – siūloma peržiūrėti.

v1 UI dublikatus pažymi, bet automatiškai nejungia.

## Auditas

SQLite schema v4 lentelėje `import_audits` saugoma:

- šaltinio metaduomenys ir išsaugoto originalo URI;
- preprocessing žingsniai;
- OCR tekstas ir blokai;
- parserio rezultatas;
- dublikatai;
- rankinių pataisymų struktūra;
- galutinio maršruto ID vieta;
- kokybės rodikliai ir datos.

Originalūs failai kopijuojami į `Paths.document/import-audit/<audit-id>/`.

## Routing Engine perdavimas

`deliveriesToRoutePoints` atsisako konvertuoti bet kurį pristatymą be patvirtinto adreso. UI mygtukas aktyvus tik tada, kai visi pristatymai turi `selectedAddress`. Routing Engine taisyklės ir skaičiavimo kodas šiame etape nebuvo keisti.
