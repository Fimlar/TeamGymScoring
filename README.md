# TeamGymScoring

Webová aplikace pro zadávání a tisk výsledků TeamGymového závodu (React + Vite + Firebase).

## Spuštění
1. Nainstalujte Node.js (LTS) – viz [InstallGuide.md](InstallGuide.md).
2. Zkopírujte `.env.example` jako `.env.local` a doplňte do něj klíče z Firebase (soubor se do gitu neukládá).
3. V této složce spusťte:
   ```bash
   npm install
   npm run dev -- --host
   ```
4. Rozhodčí se připojí na adresu `Network: http://…:5173` vypsanou v terminálu.

Loga pro tisk jsou ve složce `public/`.
Pokud zakládáte nový Firebase projekt: přidejte webovou aplikaci, databázi Firestore (test mode) a anonymní přihlášení (Authentication → Anonymous).

## Panely rozhodčích
- V *Nastavení závodu* si admin nadefinuje panely (výchozí: Skupina 1/2 × Akrobacie/Trampolína). Každý panel má své nářadí a pořadí týmů.
- Zaškrtnutím „Pouze 3 rozhodčí E" se u panelu E4 dopočítá jako průměr E1–E3 zaokrouhlený na 0,1.
- Rozhodčí si po přihlášení vybere svůj panel; notebook si volbu pamatuje.
- Známky mají pevné ID `Nářadí_ČísloTýmu`, takže jeden tým nemůže mít na jednom nářadí dvě známky.

## Limit součtu D
- V *Nastavení závodu → 3. Limit součtu D* lze u vybraných kategorií zapnout maximální součet D (akrobacie + trampolína).
- Při překročení se podle nastavení buď rozdíl automaticky přičte do PEN SJ, nebo se tým ve výsledcích přesune do zvolené kategorie.
