# Routing provider adapteriai

## Bendra riba

`TravelCostProvider.getMatrix(MatrixRequest)` grąžina bendrą `TravelMatrix`.
Optimizatorius nežino, ar matrica atėjo iš sintetikos, cache, HERE ar Google.
Rezultatas žymimas `real`, `stub`, `synthetic` arba `cache`.

## Sintetinis tiekėjas

`SyntheticTravelCostProvider` turi tris deterministinius režimus:

- `linear` – Haversine atstumas ir pastovus greitis;
- `city_traffic` – deterministinis kelių koeficientas ir piko lėtinimas;
- `asymmetric` – krypties priklausomas A → B ir B → A laikas bei manevrų bauda.

Jis skirtas invariantams ir pipeline testuoti, o ne realių HERE ar Google
duomenų kokybei vertinti.

## HERE ir Google per Optimization Gateway

Mobilioji aplikacija siunčia bendrą request į valdomą gateway. Gateway saugo
API raktus ir suvienodina atsakymą. Kliento adapteriai:

- naudoja `AbortController` ir timeout;
- atskirai atpažįsta HTTP 429;
- tikrina HTTP statusą;
- validuoja matricos dydį ir kiekvieną celę;
- neįtraukia rakto į request, logus ar bundle;
- grąžina `ProviderRequestError` arba `InvalidMatrixError`.

Gateway atsakyme būtini provideris, execution mode, node IDs, kvadratinės
celės, gavimo ir išvykimo laikai, eismo režimas, versija bei perspėjimai.
Serveris papildomai turi taikyti autorizaciją, kvotas, saugų retry,
observability, slaptų laukų maskavimą ir tiekėjo licencijos retention taisykles.

## Matricos cache

Raktas apima kontrakto versiją, providerį, koordinates ir taškų ID, transporto
profilį, 15 minučių išvykimo intervalą ir eismo režimą. Pasenęs įrašas
negrąžinamas. `MemoryMatrixCache` naudojamas testams, `SQLiteMatrixCache` –
lokaliam persistavimui; abi palaiko vieno rakto ir visų įrašų invalidaciją.

Live eismo matricoms TTL turi būti trumpas. UI turi rodyti faktinį
`matrixFetchedAt`, net kai atsakymas atėjo iš cache.

## Realaus palyginimo kontrolinis sąrašas

1. HERE ir Google raktus laikyti tik gateway aplinkoje.
2. Naudoti tuos pačius taškus, laiką ir transporto profilį.
3. Patikrinti eismo ir sunkiojo transporto parametrų palaikymą.
4. Užtikrinti kvotas ir matricos dydžio limitus.
5. Paleisti kelis laiko pjūvius.
6. Ataskaitoje atskirti `real`, `cache`, `stub` ir `synthetic`.
