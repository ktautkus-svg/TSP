# Provider comparison laboratory

Laboratorija paleidžia tą patį `RoutingEngine`, kurį naudoja aplikacija. Čia
nėra atskiro optimizatoriaus ar dubliuoto domeno modelio.

```bash
npm run experiment:routing
```

Pagal nutylėjimą Mock naudoja `linear` sintetiką, HERE – `city_traffic` stub,
o Google Routes – `asymmetric` stub. Todėl reportas patikrina, ar skirtingos
matricos keičia tą patį pipeline, tačiau **nevertina realių HERE ir Google
paslaugų kokybės**.

Realiam paleidimui gateway aplinkoje nustatoma:

```text
ROUTING_REAL_CALLS=1
HERE_MATRIX_GATEWAY_URL=https://...
GOOGLE_MATRIX_GATEWAY_URL=https://...
```

API raktai turi likti gateway, ne šiame projekte ar mobiliajame bundle.
`executionMode` visada parodo duomenų kilmę.

Pilna scenarijų laboratorija paleidžiama `npm run benchmark:routing`. Ji
sukuria JSON, Markdown ir UTF-8 CSV (kablelio skirtukas, viena eilutė vienam
kandidatui) kataloge `reports/routing`.
