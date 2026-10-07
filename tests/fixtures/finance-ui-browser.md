# FIRO finance UI browser harness

Tikri produkto ekranai (`wages`, `month-summary`, `trip-sheet`) su originaliais stiliais,
filtrais ir handleriais. Duomenys — in-memory sintetinė API (`setEmployeeApiTestTransport`).
Produkcijos tinklas / Firestore / kredencialai nenaudojami. Maršrutas veikia tik `__DEV__`.

## Paleidimas

Iš izoliuotos kopijos:

```powershell
cd C:\Users\Karolis\Desktop\logistikos-pristatymai\.worktrees\ateam-finance-2026-10-07
npm run web
```

URL (Expo default):

- `http://localhost:8081/finance/ui-fixture`

Jei Expo pasirenka kitą portą, naudokite konsolėje parodytą web URL + `/finance/ui-fixture`.

Reikia būti atrakintam LocalAccessGate (bet kuris rolės PIN pakanka `__DEV__` harness
išimčiai). Fixture pats pateikia admin `LocalAccessContext` ir sintetinę API.

## Viewport patikros (root naršyklė)

1. 1366×768
2. 1920×1080
3. 360×640 (arba panašus)
4. 390×844
5. 768×1024

Kiekviename: jokio nukirpimo veiksmų/sumų lentelėse; natūralus vertikalus slinkimas OK.

## Tabai ir scenarijai

### Atlygis (wages)

- Rankiniai priedai: +30 (su reisais), −12,5, 0+komentaras, tik komentaras be reiso, 2 reisai 2026-10-02.
- Atidaryti dieną → Taisyti / Išsaugoti (nedvigubina).
- Pašalinti rankinę sumą → Atšaukti / Pašalinti; „Kitas rašymas → klaida“ → error + retry.

### Mėnesio suvestinė

- Tuščių dienų filtras.
- Tik `accounting-*` eilutė turi šalinimą.
- Confirm / cancel / error / retry keičia tik pasirinktą mock įrašą; kuras lieka.

### Kelionės lapas

- Originali lentelė ir veiksmai be nukirpimo.
- Po month delete: pašalinto accounting įrašo nebėra, unrelated reisai lieka.

## Kontrolių juosta

- **Kitas rašymas → klaida** — arm'ina vieną 500 atsakymą.
- **Atstatyti store** — grąžina pradinį sintetinį rinkinį ir permontuoja ekraną.

Agentas be browser įrankių URL neatidaro — root tikrina actual UI.
