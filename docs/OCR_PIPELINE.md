# OCR Pipeline

## Etapai

1. Šaltinis normalizuojamas į `ImportDocument`.
2. Vaizdai konvertuojami į suspaustą JPEG, kad HEIC nereikėtų siųsti tiekėjui.
3. `ImagePreprocessingPipeline` paeiliui registruoja auto-rotate, edge detection, perspective, contrast ir denoise.
4. OCR provideris grąžina bendrą `OcrResult`.
5. Tekstas normalizuojamas NFKC, suvienodinami tarpai ir eilučių pabaigos.
6. Parseris išskiria pristatymų blokus ir laukus.
7. Adresai tikrinami per gateway geokodavimą.
8. Aptinkami užsakymo numerio, tikslaus ir panašaus adreso dublikatai.
9. Vartotojas pataiso žemo confidence laukus ir pasirenka dviprasmišką adresą.
10. Patvirtinti taškai perduodami Routing Engine.

## Vaizdo paruošimo capability modelis

Expo Go neturi dokumento kraštų/perspektyvos/denoise native API. Todėl pipeline nemeluoja: nepalaikomi žingsniai žymimi `delegated`, o Google Vision atlieka savo vidinį dokumentų paruošimą. Pilnam lokaliam preprocessing reikia native dokumentų skenerio adapterio (pvz., VisionKit/OpenCV) ir development build.

Keli galerijos vaizdai palaikomi kaip `pageUris` ir OCR atliekamas puslapis po puslapio. Kamera vienu veiksmu sukuria vieną puslapį; kelių nuotraukų kamera kitame UI leidime turi turėti „Pridėti puslapį“ srautą.

## Confidence ribos

- `>= 0.70` – žalia, vartotojas vis tiek gali redaguoti.
- `0.40–0.69` – geltona, rekomenduojama patikrinti.
- `< 0.40` – raudona, būtina patikrinti.

Bendras confidence: 25 % OCR + 30 % parseris + 30 % adresas + 15 % importo agregatas. Žemas bendras rodiklis niekada automatiškai neišmeta duomenų.

## Klaidos

- Tuščias OCR – importas sustabdomas peržiūroje.
- Nerastas adresas – `invalid`.
- Keli adresai – `ambiguous`; automatinis pasirinkimas draudžiamas.
- Providerio/network klaida – rodoma saugi gateway klaida.
- PDF virš 5 puslapių – sinchroninis Google kelias negarantuoja visų puslapių; production async kelias dar reikalingas.
