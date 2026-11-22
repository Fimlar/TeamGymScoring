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

## Tisk výsledků (verze 2.1)
- **Tisk průběžných výsledků** – v hlavičce je čas, ke kterému výsledky platí.
- **Tisk finálních výsledků** – nadpis „Konečné výsledky", na poslední straně seznam rozhodčích E1. Před tiskem upozorní na týmy bez kompletních známek.
- Hlavička (loga, název, datum) i patička (ředitelka závodu, hlavní rozhodčí) jsou na každé tištěné straně.
- Rozhodčí E1 se zadávají u jednotlivých panelů v *Nastavení závodu* (více jmen oddělte čárkou).
- V *Editaci dat* je nejnovější známka nahoře a u každé je vidět čas uložení.

## Rozvržení tisku (verze 2.2)
- Tabulka kategorie se tiskne celá na jednu stránku, pokud se tam vejde.
- Volné místo na stránce se vyplní další ještě nevytištěnou kategorií, která se tam vejde celá – pořadí kategorií v tisku se proto může lišit od pořadí na obrazovce.
- Kategorie delší než jedna stránka se rozdělí (hlavička tabulky se na další stránce zopakuje).
