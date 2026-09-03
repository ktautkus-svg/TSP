# August 2026 backfill payloads

Split per driver-day so GitHub MCP `push_files` / `create_or_update_file` stay under size limits.

Each `karolis-DD.json` / `aleksandras-DD.json` is a **single-day object** with `date`, `driver`, `vehicle`, `stops`, plus sheet metadata (`sheet`, `metaWeight`, `metaStops`, `metaRoutes`).

## Files

### Karolis Tautkus (MET630 unless noted)

| File | Date | Stops (array length) | metaStops | metaRoutes |
|------|------|----------------------|-----------|------------|
| `karolis-03.json` | 2026-08-03 | 37 | 24 | R17;R41;R42;R65 |
| `karolis-04.json` | 2026-08-04 | 10 | 8 | R36;R59;R71;R56;R73 |
| `karolis-05.json` | 2026-08-05 | 25 | 14 | - |
| `karolis-10.json` | 2026-08-10 | 28 | 19 | R56;R57;R54 |
| `karolis-11.json` | 2026-08-11 | 25 | 20 | - |
| `karolis-12.json` | 2026-08-12 | 11 | 10 | R54;R11;R15;R19 |

`karolis.json` on this branch was partial (days 12, 11, 10 only). Prefer the per-day files above.

### Aleksandras Arsenij

| File | Date | Vehicle | Stops (array length) | metaStops | metaRoutes |
|------|------|---------|----------------------|-----------|------------|
| `aleksandras-11.json` | 2026-08-11 | LRI741 | 4 | 2 | - |
| `aleksandras-14.json` | 2026-08-14 | NLL182 | 5 | 2 | R32 |
| `aleksandras-18.json` | 2026-08-18 | NLL182 | 5 | 2 | R32 |
| `aleksandras-19.json` | 2026-08-19 | MET630 | 14 | 12 | R14;R27;R28;R51 |
| `aleksandras-21.json` | 2026-08-21 | NLL182 | 2 | 2 | R32 |
| `aleksandras-25.json` | 2026-08-25 | NLL182 | 2 | 2 | R32 |

`aleksandras.json` remains the combined map if present.

### Stubs

`stubs.json` — three one-stop stub days (complete):

- 2026-08-09 Karolis Tautkus LRI740 R56 (1 stop)
- 2026-08-13 Aleksandras Arsenij NLL182 R56 (1 stop)
- 2026-08-16 Aleksandras Arsenij NLL182 R56 (1 stop; Karolis nedirbo)

Stub address (invented, documented): **Vilniaus g. 125, Šiauliai** — `UAB Lambda LT, Šiaulių ilgalaikio gydymo ir geriatrijos centras`. This is a stable R56 stop already present on Karolis 2026-08-04 Excel. Warehouse / Kretinga were not used because these days are coded R56.

Also includes `skip` and `existingUiRoute` in the same file.

### existingUiRoute

Already planned+assigned in UI; backfill should historically complete this instead of duplicating:

- **date:** 2026-08-03
- **routeId:** `route-1788407220642-xh5w5ldr`
- **driver:** Karolis Tautkus
- **vehicle:** MET630

Karolis 2026-08-03 (`karolis-03.json`) is the historical complete payload for that day.

### Skip (not backfilled as Excel routes)

- 2026-08-13 Karolis Tautkus — be reiso
- 2026-08-16 Karolis Tautkus — nedirbo
- 2026-08-25 Karolis Tautkus — M03;R02 atšaukta

## Boot flags

- `august-2026-excel-backfill-v1` — first materialization. Skips a day when the live fleet has no plate **and** the resolver cannot snapshot it.
- `august-2026-excel-backfill-v2` — after v1. Idempotent gap fill:
  - ensure unassigned fleet rows (or snapshot-only) for **LRI740** / **LRI741**;
  - create Aleksandras **2026-08-11 LRI741** from `aleksandras-11.json` if missing;
  - create Karolis **2026-08-09 LRI740** R56 1500 kg stub if missing (fleet create uses tank **100 L**, norm **15 L/100 km**; opening balance **13 L** on **2026-08-08**);
  - create Aleksandras **2026-08-19 MET630** R14;R27;R28;R51 from `aleksandras-19.json` if missing (same calendar day as Karolis NLL182 R54;R11);
  - if Karolis 08-19 R54;R11 is still on MET630, PATCH `vehicleId` to NLL182 through `updateTripSheet` (stops / punctuality untouched).

v2 does not call Google Distance Matrix and does not call `assignVehicle`.
