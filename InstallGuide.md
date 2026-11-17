# Kompletní průvodce spuštěním aplikace TeamGym

Tento návod popisuje, jak zprovoznit aplikaci na hlavním počítači (Admin) a jak k ní následně připojit ostatní počítače v hale (Rozhodčí).

---

## ČÁST 1: Příprava hlavního počítače (Admin)

Vzhledem k tomu, že máte na novém počítači jen VS Code, musíme nejdříve doinstalovat běhové prostředí pro JavaScript.

### Krok 1: Instalace Node.js
1. Běžte na stránku **nodejs.org**.
2. Stáhněte a nainstalujte verzi označenou jako **LTS** (Recommended for most users).
3. Instalaci proklikejte stylem "Další, Další" (nic neměňte).

### Krok 2: Otevření VS Code a příprava Terminálu
1. Otevřete **VS Code** a přes horní menu `Terminal -> New Terminal` si dole otevřete příkazový řádek.
2. *DŮLEŽITÉ:* Aby Windows neblokoval spouštění skriptů, zadejte do terminálu tento příkaz a stiskněte Enter:
   ```bash
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
   *(Pokud se vás zeptá na potvrzení, napište `A` nebo `Y` a dejte Enter).*

### Krok 3: Stažení knihoven
Ve VS Code otevřete složku **TeamGymScoring** (tento repozitář) a v terminálu zadejte:
```bash
npm install
```
Projekt už obsahuje vše potřebné (Vite, React, Tailwind, Firebase, ikony), nic dalšího vytvářet nemusíte.

### Krok 4: Vložení Firebase klíčů
Ve složce projektu zkopírujte soubor **`.env.example`** jako **`.env.local`** a doplňte do něj klíče z Firebase (Nastavení projektu → General → Your apps). Soubor `.env.local` se do gitu neukládá.

---

## ČÁST 2: Spuštění aplikace a propojení počítačů

Kód máme připravený, nyní musíme aplikaci zapnout tak, aby byla viditelná i pro ostatní počítače v hale.

### Krok 1: Spuštění serveru
V terminálu ve VS Code (ujistěte se, že jste ve složce `TeamGymScoring`) zadejte tento příkaz:
```bash
npm run dev -- --host
```
*Parametr `--host` je kritický, bez něj se ostatní počítače nepřipojí!*

### Krok 2: Windows Firewall (Nejdůležitější krok)
Jakmile příkaz spustíte poprvé, pravděpodobně na vás vyskočí systémová tabulka Windows Firewall s dotazem, zda chcete povolit komunikaci pro Node.js.
* Musíte zaškrtnout **OBĚ POLÍČKA** (Privátní sítě i Veřejné sítě) a kliknout na **Povolit přístup**.
* Pokud to neuděláte, ostatním počítačům bude načítání stránky hlásit chybu.

### Krok 3: Zjištění adresy
V terminálu se po spuštění objeví několik řádků. Najděte ten, který začíná slovem **Network**. Bude vypadat nějak takto:
`Network: http://192.168.1.28:5173/`
*(Toto je IP adresa vašeho hlavního počítače a port).*

Admin si na hlavním počítači otevře prohlížeč, klikne v terminálu na adresu (nebo ji přepíše) a přihlásí se jako Administrátor s PINem **1234**.

---

## ČÁST 3: Jak se připojí Rozhodčí

Ostatní počítače (rozhodčí) **nepotřebují instalovat vůbec nic** (žádné VS Code, žádné Node.js). 

1. Ujistěte se, že jsou všechny počítače **připojené na stejnou Wi-Fi síť** (stejný router).
2. Na počítači rozhodčího otevřete běžný webový prohlížeč (Chrome, Edge, Firefox).
3. Do horního řádku pro webovou adresu zadejte přesně tu adresu, kterou vypsal terminál hlavního počítače v kroku výše (např. `http://192.168.1.28:5173`).
4. Zobrazí se úvodní obrazovka TeamGym.
5. Rozhodčí zvolí "Rozhodčí" a zadá PIN: **0000**.
6. Stránka si sama začne brát data z Firebase a vše je připraveno k závodu!