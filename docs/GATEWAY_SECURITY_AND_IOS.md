# Gateway saugumas ir iOS vietinis tinklas

## Development režimas

LAN kūrimui naudojama aiški konfigūracija:

- `GATEWAY_ENV=development`;
- `GATEWAY_AUTH_MODE=none`;
- `GATEWAY_HOST=0.0.0.0`, kai gateway turi pasiekti fizinis iPhone;
- `EXPO_PUBLIC_GATEWAY_URL=http://192.168.0.221:8787`.

Be kliento paslapties development režimas leidžiamas tik patikimame vietiniame
tinkle. Gateway vis tiek taiko užklausos kūno dydžio ribą, klientui skirtą rate
limit, timeout, tikslų leidžiamų endpointų sąrašą ir cache. Google raktai lieka
tik gateway proceso aplinkoje. Klaidose negrąžinamas Google atsakymo kūnas,
stack trace ar API raktas.

## Production režimas

LAN IP nėra production endpointas. Production turi naudoti HTTPS, konkretų CORS
origin ir serverio išduodamą trumpalaikę mobiliojo kliento autentifikaciją.
Dabartinė apsauga sąmoningai fail-closed: `GATEWAY_ENV=production` procesas
nepasileidžia be aiškiai įjungto `hmac` režimo ir serverio paslapties. Ilgalaikė
HMAC paslaptis negali būti dedama į Expo bundle, todėl dabartinis HMAC režimas
nėra galutinis viešos mobilios aplikacijos autentifikavimo sprendimas.

### Routing išlaidų apsauga

Realūs provideriai yra fail-closed: `GATEWAY_REAL_PROVIDER_ARMED=0` neleidžia
realios matrix, geocoding ar polyline užklausos net tada, kai API raktas yra
konfigūruotas. Cache hitai leidžiami, nes jie nesukuria išorinės užklausos.

Prieš įjungiant realų režimą būtina nustatyti:

- `GATEWAY_REAL_PROVIDER_ARMED=1` (įjungti realų providerį);
- `GATEWAY_DAILY_USAGE_UNITS` (dienos naudojimo vienetai);
- `GATEWAY_WEEKLY_USAGE_UNITS` (savaitės naudojimo vienetai);
- pasirinktinai `GATEWAY_DAILY_BUDGET_CENTS` (dienos biudžetas) ir `GATEWAY_WEEKLY_BUDGET_CENTS` (savaitės biudžetas);
- `GATEWAY_USAGE_DIRECTORY` development režimui; production naudoja Firestore atomic ledger.

Matrix vienetas yra billable elementų skaičius; geocoding ir polyline užklausa
skaičiuojama kaip vienas vienetas. Production usage ledger saugomas Firestore
dokumente `tsp_gateway_usage/global` transaction režimu, todėl Cloud Run restartas
nepradeda savaitės limito iš naujo.

Dabartinis Cloud Run deploy nustatytas taip:

- `GATEWAY_REAL_PROVIDER_ARMED=0`;
- `GATEWAY_DAILY_BUDGET_CENTS=500` (5 EUR per dieną);
- `GATEWAY_WEEKLY_BUDGET_CENTS=2000` (20 EUR per savaitę).

Įjungimas atliekamas pakeičiant tik `GATEWAY_REAL_PROVIDER_ARMED=0` į `1`, tačiau
prieš tai būtina rotuoti lokaliame `.env` atsidūrusius Google raktus ir atnaujinti
atitinkamus Cloud Secret Manager secret'us.

Kol režimas neįjungtas, `/api/geocode` kiekvienai neužcachintai užklausai grąžina
`503 REAL_PROVIDER_DISABLED` dar prieš kreipiantis į Google, todėl adresai lieka
`unconfirmed` ir maršruto suplanuoti neįmanoma. Tai nėra API rakto problema.

Deploy metu naudojamas `--set-env-vars` pakeičia visus serviso kintamuosius, todėl
Cloud Run konsolėje ranka įjungtas `GATEWAY_REAL_PROVIDER_ARMED=1` būtų tyliai
grąžintas į `0` per kitą deploy. Ilgalaikis jungiklis:

- GitHub Actions deploy – repository variable `GATEWAY_REAL_PROVIDER_ARMED=1`
  (Settings → Secrets and variables → Actions → Variables);
- lokalus `npm run cloud-run:deploy` – to paties pavadinimo aplinkos kintamasis.

Tie patys šaltiniai valdo `GATEWAY_DAILY_BUDGET_CENTS`, `GATEWAY_WEEKLY_BUDGET_CENTS`,
`GATEWAY_DAILY_USAGE_UNITS` ir `GATEWAY_WEEKLY_USAGE_UNITS`; nenurodžius, lieka
aukščiau išvardytos konservatyvios reikšmės.

## iPhone / Expo Go patikra

1. Kompiuterį ir iPhone prijungti prie to paties Wi-Fi; išjungti vien 4G/5G kelią.
2. iPhone nustatymuose leisti „Expo Go“ pasiekti vietinį tinklą.
3. Safari atidaryti `http://192.168.0.221:8787/health` ir patikrinti `status: ok`.
4. Kompiuteryje paleisti `npx expo start --lan --clear` ir QR kodą nuskenuoti per „Expo Go“.
5. Įklijuoti du adresus, geokoduoti, pasirinkti neaiškius rezultatus ir kiekvieną koordinatę patvirtinti.
6. Skaičiuoti maršrutą ir patikrinti Google duomenų/eismo būseną, polyline bei native SVG žemėlapį.
7. Patikrinti, kad konsolėje nėra `localhost:8787`, raw web SVG ar native render klaidų.

`NSLocalNetworkUsageDescription` ir `NSAllowsLocalNetworking` nustatyti atskiram
iOS build. `NSAllowsArbitraryLoads` nenaudojamas.

## Google Geocoding paruošimas

Gateway palaiko atskirą `GOOGLE_GEOCODING_API_KEY`; jei jo nėra, serverio pusėje
bandomas `GOOGLE_API_KEY`, tada Routes raktas. Rakto Google Cloud projekte turi
būti įjungta Geocoding API ir serveriui tinkami rakto apribojimai. `REQUEST_DENIED`
laikomas konfigūracijos blokatoriumi; klientas negali apeiti jo sintetinėmis
koordinatėmis.

## Cloud Run – realaus Google / HERE planavimo kintamieji

Produkcinis PWA (`logistikos-pristatymai`) skaito raktus tik iš Secret Manager
(per Cloud Run `--set-secrets`). Kliento bundle neturi API raktų; naršyklė
kviečia to paties origin `/api/matrix` (ir `/api/geocode`, `/api/routes`).

### Secret Manager (privaloma Routes/Matrix planavimui)

Prioritetas gateway viduje (pirmas ne-tuščias po trim/kabučių valymo):

1. `GOOGLE_ROUTES_API_KEY` — **rekomenduojama** Routes API raktui;
2. `GOOGLE_API_KEY` — bendras serverio raktas;
3. `GOOGLE_MAPS_API_KEY` — atsarginis aliasas.

Papildomai (nebūtina matrix, bet naudojama kitur):

- `GOOGLE_GEOCODING_API_KEY` — geokodavimas;
- `GOOGLE_VISION_API_KEY` — OCR;
- `HERE_API_KEY` — HERE matrix (jei naudojama);
- `GATEWAY_DEVICE_SECRET`, `TSP_INITIAL_ADMIN_PIN` — privalomi deploy metu.

### Env vars (ne secret)

Nustatoma deploy metu iš GitHub Actions Variables (ne konsolėje ranka ilgam):

| Kintamasis | Reikšmė realiam planavimui |
|---|---|
| `GATEWAY_REAL_PROVIDER_ARMED` | `1` |
| `GATEWAY_ENV` | `production` |
| `GATEWAY_AUTH_MODE` | `none` (PWA saugo `/api/*` employee sesija) |
| `GATEWAY_DAILY_BUDGET_CENTS` | pvz. `500` |
| `GATEWAY_WEEKLY_BUDGET_CENTS` | pvz. `2000` |
| `GATEWAY_DAILY_USAGE_UNITS` | pvz. `7290` |
| `GATEWAY_WEEKLY_USAGE_UNITS` | pvz. `36450` |

### Google Cloud projekto reikalavimai raktui

1. Įjungti **Routes API** (`routes.googleapis.com`) — be to Matrix/ComputeRoutes
   grąžina 403 ir ekrane matosi `PROVIDER_AUTH_FAILED`.
2. Įjungti **billing**.
3. Raktas turi būti **serverio** tipo: be HTTP referer / Android / iOS apribojimų
   (Cloud Run kviečia Google iš serverio, ne iš Safari).
4. Secret Manager reikšmėje **be kabučių** ir be tarpinių tarpų — tik pats `AIza…`
   raktas. Deploy nekurią naujų secret versijų kiekvieną push; atnaujinimas
   rankinis (`gcloud secrets versions add …`) arba `npm run cloud-run:deploy`
   kai `.env` reikšmė pasikeičia.

### Diagnostika be papildomų matrix kvietimų

`GET /health` grąžina tik boolean readiness (be raktų):

```json
{
  "status": "ok",
  "routing": {
    "realProviderArmed": true,
    "googleRoutesKeyConfigured": true,
    "googleRoutesKeyLooksValid": true,
    "hereKeyConfigured": false
  }
}
```

Jei `googleRoutesKeyConfigured=true`, bet planavimas vis tiek duoda
`PROVIDER_AUTH_FAILED`, problema yra rakto turinyje / Routes API / billing /
apribojimuose — ne gateway URL. Sintetinis kelias lieka kaip atsarginis
vairuotojo pasirinkimas; jis nedegina Google kvietimų.
