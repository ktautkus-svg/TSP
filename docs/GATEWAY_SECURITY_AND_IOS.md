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

- `GATEWAY_REAL_PROVIDER_ARMED=1`;
- `GATEWAY_DAILY_USAGE_UNITS`;
- `GATEWAY_WEEKLY_USAGE_UNITS`;
- pasirinktinai `GATEWAY_DAILY_BUDGET_CENTS` ir `GATEWAY_WEEKLY_BUDGET_CENTS`;
- `GATEWAY_USAGE_DIRECTORY` development režimui; production naudoja Firestore atomic ledger.

Matrix vienetas yra billable elementų skaičius; geocoding ir polyline užklausa
skaičiuojama kaip vienas vienetas. Production usage ledger saugomas Firestore
dokumente `tsp_gateway_usage/global` transaction režimu, todėl Cloud Run restartas
nepradeda savaitės limito iš naujo.

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
