# HERE ir Google realių matricų laboratorija

## Paskirtis ir riba

Ši dalis nekeičia `Routing Engine v0.1`, jo heuristikų ar scoring. Ji pakeičia tik
`TravelMatrix` šaltinį ir tą pačią užklausą paleidžia per tą patį vidinį
optimizatorių. Sintetiniai modeliai lieka regresijai ir pipeline patikrai, bet jų
rezultatai niekada nevadinami HERE ar Google rezultatais.

## Architektūra

```text
Expo aplikacija / benchmark
        │ normalizuota užklausa + HMAC
        ▼
Node TypeScript Optimization Gateway
  ├─ schema, koordinačių ir dydžio validacija
  ├─ rate limit + timeout + saugus auditas
  ├─ trumpalaikis failinis matricos cache
  ├─ HERE Matrix v8 adapteris
  └─ Google Routes Compute Route Matrix adapteris
        │
        ▼
normalizuota TravelMatrix → nepakitęs Routing Engine v0.1
```

Gateway naudoja Node integruotą HTTP serverį. Tai mažiausias sprendimas be naujų
runtime priklausomybių, lengvai paleidžiamas lokaliai ir perkeliamas į vieno
proceso serverį ar serverless handlerį. API raktai skaitomi tik `gateway/`
proceso aplinkoje. Repo faile saugomas tik tuščias `.env.example`.

POST `/v1/matrix` priima tik `GatewayMatrixRequest` laukus. Savavališki URL,
providerio parametrai ir nežinomi laukai atmetami. Maksimumas – 15 pristatymo
taškų (17 matricos vietų, 289 elementai). Užklausa pasirašoma:

```text
signature = HMAC-SHA256(GATEWAY_APP_SECRET, timestamp + "." + rawJsonBody)
```

Naudojamos antraštės `x-routing-timestamp` ir `x-routing-signature`; leidžiamas
penkių minučių nuokrypis. Asmeninei programėlei tai apsaugo nuo atsitiktinio
viešo proxy naudojimo, bet į mobilų bundle įdėta pastovi paslaptis nėra
nepažeidžiama. Diegiant viešai ją reikia išduoti per OS secure storage /
device-attestation arba riboti gateway tinklo lygiu.

## Providerių semantika

HERE adapteris kviečia `POST https://matrix.router.hereapi.com/v8/matrix`,
naudoja `regionDefinition: autoCircle`, `routingMode: fast`, planuojamą išvykimo
laiką ir `truck` transporto priemonės matmenis, kai jie pateikti. HERE error code
`3` paliekamas pasiekiamas su aiškiu apribojimo perspėjimu; kiti klaidos kodai
normalizuojami kaip nepasiekiamos poros.

Google adapteris kviečia
`POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`,
naudoja `TRAFFIC_AWARE` bei `departureTime` ir įvertina kiekvieno OD elemento
`status` ir `condition`. `TRAFFIC_AWARE_OPTIMAL` sąmoningai nenaudojamas, nes jo
100 elementų limitas netinka iki 17 vietų matricai. Google šiame API/adapteryje
nedeklaruojami truck matmenų ir kelių apribojimų duomenys.

Abu matricos API nepateikia tarpusavyje palyginamos manevrų metrikos. Todėl
`maneuverPenalty` lieka neutrali 0, o metaduomenyse `maneuverMetadataSupported`
yra `false`; ataskaita šio kriterijaus nevertina.

Oficialios specifikacijos:

- [HERE Matrix Routing API – pradžia](https://docs.here.com/routing/docs/get-started-matrix)
- [HERE Matrix traffic](https://docs.here.com/routing/docs/matrix-traffic)
- [HERE truck routing](https://docs.here.com/routing/docs/routing-v8-truck-routing)
- [Google Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Google Routes API konfigūracijos kompromisai](https://developers.google.com/maps/documentation/routes/config_trade_offs)
- [Google Routes naudojimas ir billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)

## Cache ir režimai

Cache rakte yra provideris, tiksli taškų tvarka ir koordinatės, transporto
priemonės parametrai, išvykimo laikas, traffic režimas ir adapterio versija.
Gyvo eismo numatytasis TTL – 15 min.; eismo nenaudojančio įrašo – 24 val.

- `real`: naudoja šviežią cache, kitu atveju kviečia providerį.
- `refresh`: apeina cache skaitymą ir priverstinai kviečia providerį.
- `cache-only`: niekada nekviečia providerio; pasenęs ar neegzistuojantis įrašas
  yra aiški klaida.
- `synthetic`: naudoja du aiškiai pažymėtus vietinius modelius ir negali būti
  pagrindas providerio pasirinkimui.

Kiekvieno realaus kvietimo apskaita apima elementų skaičių, cache hit/miss,
išorinių užklausų skaičių ir kainą tik tada, kai ji pateikta per aplinkos
konfigūraciją. Piniginė kaina nehardcodinama.

## Paleidimas

PowerShell pavyzdys:

```powershell
$env:HERE_API_KEY='...'
$env:GOOGLE_ROUTES_API_KEY='...'
$env:GATEWAY_APP_SECRET='...'
npm run gateway:dev
```

Benchmark:

```powershell
npm run benchmark:routing:synthetic
npm run benchmark:routing:real
npm run benchmark:routing:cache
npm run benchmark:routing:refresh
```

`real` ir `refresh` be abiejų raktų sustoja prieš tinklo užklausas. Testai
niekada nevykdo mokamų API užklausų. Ataskaitos rašomos į
`reports/provider-comparison/comparison-<mode>.{json,csv,md}`.

Laboratorijoje yra 8 anoniminiai Vilniaus scenarijai po 6–8 pristatymo taškus ir
keturi 2026-08-03 darbo dienos laikai: 07:30, 10:30, 15:30 ir 19:00
`Europe/Vilnius` (UTC+03:00). Jei benchmark vykdomas po šios datos, datą reikia
perkelti į providerio leidžiamą ateities intervalą; istorinis eismas nėra
automatiškai apsimetamas gyvu.

## Atkūrimas ir saugumas

Providerio nesėkmė nekeičia jau išsaugoto maršruto: gateway grąžina klaidą, o
aplikacijos orkestratorius gali aiškiai pasirinkti cache ar sintetinį šaltinį.
Fallback matrica išsaugo savo `executionMode`, o UI rodo „realūs“, „talpyklos“
ar „sintetiniai“ duomenys ir ar eismas buvo įvertintas.

Logai saugo tik matrix ID, providerį, režimą, trukmę, elementų skaičių, pilnumą
ir saugų klaidos kodą. API raktai, užklausos kūnas bei koordinatės
nespausdinami.

