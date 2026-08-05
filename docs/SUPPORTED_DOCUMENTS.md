# Supported Documents

| Šaltinis | Palaikymas | Ribos |
|---|---|---|
| Kameros JPEG | veikia | vienas kadras; keliems puslapiams naudoti galeriją |
| Galerijos vaizdai | veikia | iki 10 pasirinkimų UI; siunčiami nuosekliai |
| PNG/WebP | veikia | UI prieš OCR konvertuoja į JPEG |
| HEIC/HEIF | veikia per konvertavimą | originalas išsaugomas, OCR kopija – JPEG |
| Vieno puslapio PDF | veikia per Google Vision | turi būti įjungta Vision API |
| 2–5 puslapių PDF | veikia per sinchroninį Google `files:annotate` | tinklo ir 12 MB request riba |
| 6+ puslapių PDF | dalinis | reikia Google asyncBatchAnnotate + GCS arba lokalaus rasterizerio |
| Įklijuotas tekstas | veikia offline | parseris ir geokodavimas; adresų patikrai reikia gateway |
| DPD/DHL/Raben | šablonų registras paruoštas | konkrečių realių dokumentų kalibravimas dar neatliktas |
| Vidinis Excel eksportas | teksto šablonas paruoštas | XLSX failo skaitytuvas neįtrauktas |

## Realiam diegimui būtina

1. Įjungti Google Cloud Vision API ir riboti serverio raktą pagal API/IP.
2. Production gateway įjungti HMAC ir TLS/reverse proxy.
3. 6+ puslapių PDF pasirinkti GCS asinchroninį arba native rasterizavimo kelią.
4. Su realiais kiekvieno kliento dokumentais kalibruoti šablonus ir confidence.
5. Development build prijungti VisionKit/OpenCV preprocessing bei pasirinktinai Apple Vision/Tesseract.
