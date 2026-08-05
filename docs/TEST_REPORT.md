# OCR / Import Engine Test Report

Data: 2026-08-03

## Automatiniai testai

- Production parser: 50 parametrizuotų laukų ištraukimo atvejų.
- MockOCRProvider: 50 bendro kontrakto ir kelių puslapių atvejų.
- Adresų sprendimas: 30 `invalid` / `valid` / `ambiguous` atvejų.
- Dublikatai: 20 užsakymo, tikslaus ir panašaus adreso atvejų.
- PDF: 20 atvejų, apimančių 1–10 puslapių Mock pipeline.
- Copy/paste: 20 dviejų pristatymų blokų atvejų.
- Google Vision gateway: request validacija, vaizdas, PDF ir trūkstamo rakto klaida.
- Esami Routing Engine ir gateway testai išlaikomi.

## Benchmark

Šaltinis: `reports/OCR_BENCHMARK.json`. Windows x64, Node v24.18.0, šiltas procesas.

| Scenarijus | Trukmė | RSS po | Rezultatas |
|---|---:|---:|---:|
| 1 Mock PDF puslapis | 2,01 ms | 83,14 MB | 12 blokų |
| 5 Mock PDF puslapiai | 0,12 ms | 83,14 MB | 60 blokų |
| 10 Mock PDF puslapių | 0,16 ms | 83,15 MB | 120 blokų |
| 100 pristatymų parseris | 14,57 ms | 84,18 MB | 100 pristatymų |
| 200 pristatymų parseris | 7,89 ms | 84,59 MB | 200 pristatymų |

Mažesnė 200 atvejo trukmė yra JIT/šiltėjimo efektas; tai nėra teiginys apie superlinijinį našumą. Benchmarkas nematuoja Google tinklo/OCR tiekėjo latency ir turi būti kartojamas fiziniame telefone su realiais 1/5/10 puslapių failais.

## Reali tiekėjo ir UI patikra

- Vietinis Google Vision gateway pasiektas realia HTTP užklausa. Gateway saugiai grąžino `PROVIDER_AUTH_FAILED`, nes Google Vision atsakė HTTP 403. Tai reiškia, kad dabartiniam Google projektui dar reikia įjungti Vision API arba leisti ją esamo rakto apribojimuose; klaida nėra maskuojama kaip tuščias OCR rezultatas.
- SDK 54 web peržiūroje patikrintas visas copy/paste kelias: du adresų blokai atpažinti kaip du pristatymai, apskaičiuota 82 % importo kokybė, parodyti atskirų laukų confidence ir raudonos / geltonos būsenos. Naršyklės konsolėje klaidų neužfiksuota.
- Nuotraukos ir PDF pasirinkimo mygtukai vizualiai patikrinti, tačiau realus Google OCR negali būti laikomas priėmimo testu, kol neišspręsta HTTP 403 konfigūracija.

## Išvada

Parserio, adapterių kontrakto, adresų ir dublikatų branduolys tinkamas integraciniam naudojimui. Visas modulis dar nėra besąlygiškai production-ready, kol nepatikrinti realūs dokumentai, fizinio telefono atmintis, Vision API limitai ir 6+ puslapių PDF kelias.
