# OCR Architecture — Production v1

## Tikslas

Dokumentų importas yra atskiras bounded context. Jis neredaguoja `RoutingEngine`; į jį perduoda tik vartotojo patvirtintus ir geokoduotus `ConfirmedGeocodedPoint` objektus.

```text
Camera / Gallery / PDF / Clipboard
  -> ImportDocument
  -> ImagePreprocessingPipeline
  -> OcrProvider
  -> delivery-parser
  -> AddressLookupProvider
  -> duplicate-detector
  -> manual review
  -> route-import-mapper
  -> Routing Engine
```

## Sluoksniai

- `src/domain/import/` – nekintantys kontraktai, confidence ir dublikatų taisyklės.
- `src/application/import/` – pipeline orkestravimas, parseris, PDF ir route mapping.
- `src/infrastructure/import/` – Google gateway, native adapteriai, Expo failai ir SQLite auditas.
- `src/app/import/` – šaltinio pasirinkimas, confidence UI, pataisymai ir perdavimas į maršrutą.
- `gateway/providers/google-vision-adapter.ts` – serverio pusės Google Vision integracija; API raktas nekeliauja į aplikaciją.

## OCR adapterio kontraktas

Visi provideriai realizuoja `OcrProvider` ir grąžina `OcrResult`: providerį, versiją, visą tekstą, confidence, blokus, puslapių skaičių, trukmę ir warning'us.

| Provideris | Vaizdas | PDF | Offline | Dabartinė būsena |
|---|---:|---:|---:|---|
| MockOCRProvider | taip | taip | taip | pilnai veikia ir testuojamas |
| Google Vision | taip | iki 5 psl. sinchroniškai | ne | veikia per gateway, reikia įjungtos Vision API |
| Apple Vision | taip | ne | taip | adapteris paruoštas; reikia native runnerio ir development build |
| Tesseract | taip | taip | taip | adapteris paruoštas; reikia native/WASM runnerio |

Providerio nebuvimas visada grąžina aiškią `OcrUnavailableError`; fallback negali apsimesti tikru OCR.

## Saugumas

- Google raktas laikomas tik gateway `.env` (`GOOGLE_VISION_API_KEY` arba bendras serverio raktas).
- OCR endpoint turi bendrą rate limit, HMAC production režimą, MIME/base64 validaciją ir 12 MB numatytąją kūno ribą.
- Originalas kopijuojamas į aplikacijos dokumentų katalogą; SQLite saugoma audito metrika ir struktūrizuotas rezultatas.
- Nežinomi request laukai atmetami.

## Versijavimas

Providerio versija įrašoma į kiekvieną `OcrResult`. Parserio ir dokumento šablono versija kitame leidime turi būti įtraukta kaip atskiri audito laukai prieš kalibravimo migracijas.
