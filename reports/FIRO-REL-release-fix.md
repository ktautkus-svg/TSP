# FIRO-REL-001 — release fix ataskaita

**Misija:** FIRO release: suderinti API testą ir quick-edit lint  
**Šaka:** `codex/firo-finance-release-2026-10-07`  
**HEAD bazė:** `c122541` ant produkcijos `c93570e`  
**Agentas:** Frankie (Cursor / A-Team)  
**Data:** 2026-10-08

## Changed

1. **`tests/unit/accounting-trip-delete-api.test.ts`**
   - Iš `ONE_SHOT_MIGRATIONS` pašalintas `applyKarolisSeptember2026PaperSync` (naujoje bazėje metodo nebėra).
   - `server` tipas `Server | undefined`; `afterAll` uždaro serverį tik jei jis sukurtas.
   - DELETE leidimų / izoliuojančių assertions nepalieisti.

2. **`src/app/finance/wages.tsx`**
   - `manualAmount` / `manualComment` skaitomi per `useRef`, effect deps lieka `[startEditing, onStartEditingConsumed]`.
   - Išvengta formos pakartotinio atidarymo po save+load ir redaguojamo teksto perrašymo.

3. **`tests/unit/finance-wage-quick-edit.test.tsx`**
   - Quick-edit shell naudoja tą patį ref pattern; `useEffect` turi deps.
   - Harness mockina `useRef` (plain-function render be React dispatcher).

## Preserved

- Finansų ekranų UX / API elgsena neperdaryta.
- DELETE permission / accounting-prefix / driver / date / kitų įrašų assertions.
- Lint rules / asserts / timeout / skip / harness perrašymas — ne.
- Git commit / push / deploy / gyvi finansai — ne.

## Verification

```
npx vitest run tests/unit/accounting-trip-delete-api.test.ts tests/unit/finance-wage-quick-edit.test.tsx
→ Test Files  2 passed (2)
→ Tests  16 passed (16)

npm test
→ Test Files  160 passed (160)
→ Tests  1425 passed (1425)

npm run typecheck
→ tsc --noEmit (exit 0)

npm run lint
→ eslint . (exit 0; 0 errors, 22 pre-existing warnings)
→ react-hooks/exhaustive-deps klaidų wages.tsx / finance-wage-quick-edit.test.tsx nebėra
```

## Diff (faktinis)

```
src/app/finance/wages.tsx                     | 14 +++++++++-----
tests/unit/accounting-trip-delete-api.test.ts | 12 +++++++-----
tests/unit/finance-wage-quick-edit.test.tsx   | 21 ++++++++++++++++-----
3 files changed, 32 insertions(+), 15 deletions(-)
```

## Remaining

Nėra. Commit / push uždrausti misijos ribose.
