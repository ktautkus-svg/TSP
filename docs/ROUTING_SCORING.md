# Routing scoring

## Vertinimo tvarka

Hard apribojimų nepažeidžiantis kandidatas visada lenkia pažeidžiantį.
Neįvykdomų kandidatų kritinis rangas lyginamas tokia tvarka:

1. neaptarnauti privalomi taškai;
2. privalomų laiko langų pažeidimų skaičius;
3. bendras vėlavimas;
4. didžiausias vieno taško vėlavimas;
5. darbo dienos viršijimas;
6. kritiniai kelio ar transporto apribojimai.

Tik po to taikomas soft balas. Mažesnė reikšmė yra geresnė.

## Komponentai

| Komponentas | Svoris | Cap |
|---|---:|---:|
| Važiavimo laikas | 0.18 | 600 min |
| Bendras darbo laikas | 0.20 | 720 min |
| Atstumas | 0.11 | 500 km |
| Tonkilometrai | 0.13 | 1000 t·km |
| Laukimas | 0.07 | 180 min |
| Informacinio laiko neatitikimas | 0.06 | 240 min |
| Kryptingumas | 0.09 | 100 taškų |
| Pabaigos vietos patogumas | 0.05 | 100 km |
| Manevrai | 0.04 | 100 taškų |
| Naudotojo prioritetai | 0.07 | 100 taškų |

Svoriai ir cap ribos yra `RoutingScoringConfig` ir gali būti keičiami testuose.

## Normalizavimas

Kiekviena raw reikšmė ribojama `cap`, tada tarp to paleidimo įvykdomų kandidatų:

```text
normalized = (cappedValue - min) / (max - min)
score = Σ normalizedComponent × weight
```

Jei visi kandidatai turi vienodą komponentą, jo normalizuota reikšmė yra 0.
Neigiamos, `NaN` ar `Infinity` reikšmės atmetamos. Trūkstama matricos celė
tampa hard pažeidimu, o ne nuline „gera“ kaina. Vietinė paieška naudoja stabilų
cap-normalizuotą objektyvą, nes kandidatų min/max ribos dar nežinomos.

## Tonkilometrai

```text
t·km = (prieš atkarpą likęs krovinys kg / 1000) × atkarpos km
```

Pirma atkarpa veža visą krovinį. Pasiekus tašką jo svoris atimamas, todėl kita
atkarpa naudoja sumažintą svorį. Grįžimo po paskutinio iškrovimo t·km yra nulis.

## Tolerancijos

Numatytos konfigūruojamos reikšmės: 2 minutės, 1 km ir 0 minučių privalomam
laiko langui. Jos naudojamos tie-break sprendimams ir nepaverčia hard pažeidimo
įvykdomu, išskyrus aiškiai pakeistą laiko lango toleranciją.
