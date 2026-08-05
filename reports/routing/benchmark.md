# Routing Engine v0.1 benchmark

Sugeneruota: 2026-07-29T17:42:24.869Z

> Visi šio benchmark duomenys sintetiniai. Jie skirti algoritmo invariantams ir tiekėjo skirtumų pipeline tikrinti, ne HERE ar Google kokybei vertinti.

## Santrauka

- Bazinių scenarijų: 50
- Visų paleidimų: 165
- Scenarijų, kuriuose skirtingi sintetiniai tiekėjai parinko kitą seką: 19 iš 55
- Neįvykdomų paleidimų: 12

| Tiekėjas | Paleidimai | Įvykdomi | Vid. trukmė, ms | Vid. kandidatai | Vid. local-search pagerėjimas |
|---|---:|---:|---:|---:|---:|
| synthetic:linear | 55 | 51 | 278.108 | 9.291 | 24.847% |
| synthetic:city_traffic | 55 | 51 | 261.537 | 9.2 | 25.174% |
| synthetic:asymmetric | 55 | 51 | 254.173 | 8.855 | 8.195% |

## Heuristikų laimėjimai

- local_search: 152
- farthest_first: 103
- nearest_neighbor: 68
- cluster_then_route: 24
- directional_sweep: 23
- end_location_guided: 16
- earliest_required_window_first: 14
- original_order: 11
- random_seeded:42: 8
- heaviest_first: 6
- random_seeded:2026: 6
- random_seeded:7: 6

## Scenarijų signalai

- Svorio scenarijai: heavy-near/synthetic:linear: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-near/synthetic:city_traffic: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-near/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-far/synthetic:linear: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-far/synthetic:city_traffic: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-far/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-middle/synthetic:linear: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-middle/synthetic:city_traffic: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-middle/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; equal-heavy-loads/synthetic:linear: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; equal-heavy-loads/synthetic:city_traffic: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; equal-heavy-loads/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; weight-distance-conflict/synthetic:linear: stop-7→stop-5→stop-3→stop-8→stop-4→stop-1→stop-2→stop-6; weight-distance-conflict/synthetic:city_traffic: stop-7→stop-5→stop-3→stop-1→stop-2→stop-6→stop-4→stop-8; weight-distance-conflict/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-1→stop-6→stop-2→stop-4→stop-8; heavy-late-window/synthetic:linear: stop-7→stop-5→stop-3→stop-8→stop-4→stop-2→stop-6→stop-1; heavy-late-window/synthetic:city_traffic: stop-7→stop-2→stop-6→stop-4→stop-8→stop-3→stop-5→stop-1; heavy-late-window/synthetic:asymmetric: stop-7→stop-5→stop-3→stop-6→stop-4→stop-8→stop-2→stop-1
- Laiko langų scenarijai: heavy-late-window/synthetic:linear: įvykdomas; heavy-late-window/synthetic:city_traffic: įvykdomas; heavy-late-window/synthetic:asymmetric: įvykdomas; light-early-required/synthetic:linear: įvykdomas; light-early-required/synthetic:city_traffic: įvykdomas; light-early-required/synthetic:asymmetric: įvykdomas; two-conflicting-windows/synthetic:linear: neįvykdomas; two-conflicting-windows/synthetic:city_traffic: neįvykdomas; two-conflicting-windows/synthetic:asymmetric: neįvykdomas; informational-window/synthetic:linear: įvykdomas; informational-window/synthetic:city_traffic: įvykdomas; informational-window/synthetic:asymmetric: įvykdomas; impossible-window/synthetic:linear: neįvykdomas; impossible-window/synthetic:city_traffic: neįvykdomas; impossible-window/synthetic:asymmetric: neįvykdomas
- Neįvykdomi: over-capacity/synthetic:linear (MAX_PAYLOAD:-); over-capacity/synthetic:city_traffic (MAX_PAYLOAD:-); over-capacity/synthetic:asymmetric (MAX_PAYLOAD:-); two-conflicting-windows/synthetic:linear (REQUIRED_TIME_WINDOW:stop-8); two-conflicting-windows/synthetic:city_traffic (REQUIRED_TIME_WINDOW:stop-1, REQUIRED_TIME_WINDOW:stop-8); two-conflicting-windows/synthetic:asymmetric (REQUIRED_TIME_WINDOW:stop-1, REQUIRED_TIME_WINDOW:stop-8); impossible-window/synthetic:linear (REQUIRED_TIME_WINDOW:stop-8); impossible-window/synthetic:city_traffic (REQUIRED_TIME_WINDOW:stop-8); impossible-window/synthetic:asymmetric (REQUIRED_TIME_WINDOW:stop-8); workday-overrun/synthetic:linear (WORKDAY_END:-); workday-overrun/synthetic:city_traffic (WORKDAY_END:-); workday-overrun/synthetic:asymmetric (WORKDAY_END:-)

## Našumo scenarijai

| Scenarijus | Tiekėjas | Trukmė, ms | Kandidatai | Įvykdomas |
|---|---|---:|---:|---|
| performance-5 | synthetic:linear | 35.583 | 3 | taip |
| performance-5 | synthetic:city_traffic | 32.255 | 3 | taip |
| performance-5 | synthetic:asymmetric | 30.964 | 3 | taip |
| performance-10 | synthetic:linear | 263.966 | 11 | taip |
| performance-10 | synthetic:city_traffic | 249.373 | 11 | taip |
| performance-10 | synthetic:asymmetric | 285.802 | 11 | taip |
| performance-15 | synthetic:linear | 1280.299 | 10 | taip |
| performance-15 | synthetic:city_traffic | 896.093 | 10 | taip |
| performance-15 | synthetic:asymmetric | 944.869 | 11 | taip |
| performance-20 | synthetic:linear | 2205.287 | 11 | taip |
| performance-20 | synthetic:city_traffic | 2061.104 | 11 | taip |
| performance-20 | synthetic:asymmetric | 1966.236 | 11 | taip |
| performance-30 | synthetic:linear | 3868.761 | 11 | taip |
| performance-30 | synthetic:city_traffic | 3699.582 | 11 | taip |
| performance-30 | synthetic:asymmetric | 3172.778 | 11 | taip |

## Interpretavimo riba

Šis paleidimas patvirtina bendrą pipeline, deterministinius scenarijus, hard apribojimų auditą ir tai, kad skirtingos matricos gali pakeisti rekomendaciją. Jis **nepalygina realių HERE ir Google duomenų**, nes API raktai ir gateway šiame paleidime nenaudoti.
