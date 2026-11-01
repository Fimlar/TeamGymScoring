// ==========================================
// IMPORTY (Načtení potřebných nástrojů a knihoven)
// ==========================================
// React nám umožňuje vytvářet uživatelské rozhraní. 
// useState = paměť komponenty (když se změní, obrazovka se překreslí)
// useEffect = funkce, která se spustí sama při načtení stránky nebo změně určitých dat
import React, { useState, useEffect } from 'react';

// Importy z Firebase (nástroje pro komunikaci s databází od Googlu)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { signInAnonymously, getAuth } from 'firebase/auth';

// Importy ikon z knihovny lucide-react (pro hezčí vzhled tlačítek)
import { Edit2, Download, CheckCircle, ChevronRight, AlertCircle, Save, Lock, Unlock, AlertTriangle, Bell, Check, X, KeyRound, Printer} from 'lucide-react';

// ==========================================
// 1. NASTAVENÍ A HESLA
// ==========================================
// ZDE SI NASTAVTE VAŠE TAJNÁ HESLA PRO PŘÍSTUP
const ADMIN_PASSWORD = "1234";
const JUDGE_PASSWORD = "0000";

// SEM VLOŽTE VÁŠ KLÍČ Z FIREBASE KONZOLE!
// Tento objekt říká naší aplikaci, s jakou konkrétní databází na internetu má komunikovat.
const firebaseConfig = {

};

// "Nastartování" Firebase pomocí našich klíčů
const app = initializeApp(firebaseConfig);
const db = getFirestore(app); // db = naše databáze (Firestore)
const auth = getAuth(app);    // auth = ověřování uživatelů (přihlášení)

// ==========================================
// 2. POMOCNÉ FUNKCE (Matematika a pravidla)
// ==========================================

// Funkce, která určuje povolené tolerance pro E známku na základě výsledné průměrné známky.
// Vrací objekt s tolerancí pro prostřední 2 známky (mid) a tolerancí pro všechny 4 (all).
const getETolerances = (avg) => {
  if (avg >= 9.00) return { mid: 0.2, all: 0.6 }; 
  if (avg >= 8.00) return { mid: 0.3, all: 0.6 }; 
  if (avg >= 7.00) return { mid: 0.4, all: 1.0 }; 
  if (avg >= 6.00) return { mid: 0.5, all: 1.0 }; 
  return { mid: 0.6, all: 1.0 }; 
};

// Hlavní funkce pro výpočet živých známek (Live Score).
// Přijímá data z formuláře (formData) a vrací spočítané hodnoty včetně informace, zda byly uplatněny "Base" známky.
const calculateLiveScore = (formData) => {
  // Pomocná funkce převede text na číslo (nebo 0, pokud je pole prázdné)
  const num = (v) => Number(v) || 0;
  
  // Načtení všech známek do proměnných
  const c1 = num(formData.c1), c2 = num(formData.c2);
  const d1 = num(formData.d1), d2 = num(formData.d2);
  const e1 = num(formData.e1), e2 = num(formData.e2), e3 = num(formData.e3), e4 = num(formData.e4);
  const pen = num(formData.pen);

  // --- VÝPOČET C ZNÁMKY (Kompozice) ---
  const cAvg = (c1 + c2) / 2; // Obyčejný průměr
  const cValid = Math.abs(c1 - c2) <= 0.201; // Math.abs udělá absolutní hodnotu (rozdíl bez mínusu). Tolerance je 0.2
  // Pokud je to validní, vezme průměr. Pokud ne, vezme (průměr + C1) / 2 (tzv. Base známka)
  const cFinal = cValid ? cAvg : (cAvg + c1) / 2; 

  // --- VÝPOČET D ZNÁMKY (Obtížnost) ---
  const dAvg = (d1 + d2) / 2;
  const dValid = Math.abs(d1 - d2) <= 0.201;
  const dFinal = dValid ? dAvg : (dAvg + d1) / 2; 

  // --- VÝPOČET E ZNÁMKY (Provedení) ---
  // Vytvoříme pole čtyř E známek a seřadíme je od nejmenší po největší
  const sortedE = [e1, e2, e3, e4].sort((a, b) => a - b);
  const eMidAvg = (sortedE[1] + sortedE[2]) / 2; // Průměr dvou prostředních (index 1 a 2)
  const eMidDiff = Math.abs(sortedE[2] - sortedE[1]); // Rozdíl prostředních
  const eAllDiff = Math.abs(sortedE[3] - sortedE[0]); // Rozdíl největší (index 3) a nejmenší (index 0)
  
  // Získáme tolerance z naší funkce výše
  const eTols = getETolerances(eMidAvg);
  // Je známka validní? Oba rozdíly musí být menší nebo rovny povolené toleranci
  const eValid = eMidDiff <= eTols.mid + 0.001 && eAllDiff <= eTols.all + 0.001;
  // Pokud je validní, použijeme prostřední průměr, jinak Base známku s využitím E1
  const eFinal = eValid ? eMidAvg : (eMidAvg + e1) / 2; 

  // Celkový součet
  const total = cFinal + dFinal + eFinal - pen;

  // Funkce vrátí balíček (objekt) se všemi výsledky. toFixed(3) zajistí 3 desetinná místa.
  return {
    c: cFinal.toFixed(3), cValid,
    d: dFinal.toFixed(3), dValid,
    e: eFinal.toFixed(3), eValid, eTols,
    pen: pen.toFixed(3),
    total: total.toFixed(3)
  };
};

// ==========================================
// 3. HLAVNÍ KOMPONENTA APLIKACE
// ==========================================
export default function GymnasticsScoringApp() {
  // Zde definujeme "paměť" (state) naší hlavní aplikace.
  // const [nazev_promenne, funkce_pro_zmenu] = useState(vychozi_hodnota);
  const [role, setRole] = useState(null); // Kdo to právě používá? ('admin' nebo 'judge')
  const [isUnlocked, setIsUnlocked] = useState(false); // Nová paměť: Je aktuální role odemčena heslem?
  // Paměť pro přihlašovací formulář
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const [isConnected, setIsConnected] = useState(false); // Jsme připojeni k Firebase?
  const [scores, setScores] = useState([]); // Všechny uložené známky
  const [startList, setStartList] = useState([]); // Seznam týmů
  const [orders, setOrders] = useState({ Akrobacie: [], Trampolína: [] }); // Pořadí závodů
  const [allowManual, setAllowManual] = useState(false); // Globální povolení oprav (Admin toggle)
  const [requests, setRequests] = useState([]); // Žádosti od rozhodčích o odemčení
  const [errorMsg, setErrorMsg] = useState(''); // Chybová hláška (pokud chybí klíče apod.)
  const [teamPenalties, setTeamPenalties] = useState({});

  // useEffect se provede jen jednou, hned jak se stránka načte (protože má na konci prázdné pole [])
  useEffect(() => {
    // Kontrola, jestli jste nezapomněli vložit klíče z Firebase
    if (!firebaseConfig.apiKey) { setErrorMsg('Chybí Firebase klíče v kódu!'); return; }
    
    // Přihlášení do databáze v anonymním režimu
    signInAnonymously(auth).then(() => {
      setIsConnected(true);
      
      // onSnapshot je "naslouchač". Neustále kouká do databáze a když se tam něco změní, hned nám pošle nová data.
      // 1. Nasloucháme změnám ve známkách (tabulka 'scores')
      onSnapshot(collection(db, 'scores'), (snap) => setScores(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      // 2. Nasloucháme žádostem od rozhodčích (tabulka 'requests')
      onSnapshot(collection(db, 'requests'), (snap) => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      // 3. Nasloucháme změnám v nastavení (tabulka 'config', konkrétně dokument 'startList')
      onSnapshot(doc(db, 'config', 'startList'), (docSnap) => {
        if (docSnap.exists()) {
          const d = docSnap.data();
          setStartList(d.teams || []); // Uložíme týmy, nebo prázdné pole, pokud neexistují
          setOrders(d.orders || { Akrobacie: [], Trampolína: [] });
          setAllowManual(d.allowManual || false);
          setTeamPenalties(d.penalties || {});
        }
      });
    }).catch(err => setErrorMsg('Chyba DB: ' + err.message));
  }, []); // <-- Toto prázdné pole říká: "Spusť to jen při startu aplikace"

  // --- FUNKCE PRO PŘIHLAŠOVÁNÍ ---
  // Když uživatel klikne na výběr role (ale ještě nezadal heslo)
  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole);
    setIsUnlocked(false); // Zamkneme přístup
    setPinInput('');      // Vymažeme staré heslo z políčka
    setPinError(false);   // Zrušíme případnou červenou chybu
  };

  // Když uživatel klikne na tlačítko "Odemknout"
  const handlePinSubmit = (e) => {
    e.preventDefault();
    // Zkontrolujeme, jakou roli chce a jestli heslo sedí
    if (role === 'admin' && pinInput === ADMIN_PASSWORD) {
      setIsUnlocked(true);
    } else if (role === 'judge' && pinInput === JUDGE_PASSWORD) {
      setIsUnlocked(true);
    } else {
      // Pokud nesedí, ukážeme chybu a heslo vymažeme
      setPinError(true);
      setPinInput('');
    }
  };

  // KROK 1: VÝBĚR ROLE (Pokud nemá žádnou roli)
  if (!role) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-6">Á Hop 2026</h1>
          {errorMsg && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{errorMsg}</div>}
          <div className="space-y-4">
            <button onClick={() => handleRoleSelect('judge')} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors">Rozhodčí (Zadávání)</button>
            <button onClick={() => handleRoleSelect('admin')} className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium shadow-sm transition-colors">Administrátor</button>
          </div>
        </div>
      </div>
    );
  }

  // KROK 2: ZADÁNÍ HESLA (Má roli, ale ještě není odemčena)
  if (role && !isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full">
          <div className="flex justify-center mb-4 text-slate-400">
            <KeyRound size={48} />
          </div>
          <h2 className="text-xl font-bold text-slate-800 text-center mb-6">
            Přístup: {role === 'admin' ? 'Administrátor' : 'Rozhodčí'}
          </h2>
          
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Zadejte heslo (PIN)</label>
              {/* input type="password" skryje text pod tečky */}
              <input 
                type="password" 
                autoFocus
                value={pinInput} 
                onChange={(e) => { setPinInput(e.target.value); setPinError(false); }} 
                className={`w-full p-3 border rounded-lg text-center tracking-widest font-mono text-lg outline-none focus:ring-2 focus:ring-blue-500 ${pinError ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'}`}
              />
              {pinError && <p className="text-red-500 text-xs mt-2 text-center font-medium">Nesprávné heslo. Zkuste to znovu.</p>}
            </div>
            
            <button type="submit" className={`w-full py-3 text-white rounded-lg font-bold shadow-sm transition-colors ${role === 'admin' ? 'bg-slate-800 hover:bg-slate-900' : 'bg-blue-600 hover:bg-blue-700'}`}>
              Odemknout
            </button>
          </form>

          <button onClick={() => setRole(null)} className="w-full mt-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline text-center">
            Zpět na výběr role
          </button>
        </div>
      </div>
    );
  }

  // KROK 3: HLAVNÍ APLIKACE (Má roli a je odemčena heslem)
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <h1 className="text-xl md:text-2xl font-bold text-slate-800">TeamGym - {role === 'admin' ? 'Administrace' : 'Rozhodčí'}</h1>
          <button onClick={() => { setRole(null); setIsUnlocked(false); }} className="text-sm text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1">
            <Lock size={16}/> Odhlásit se
          </button>
        </div>
        
        {role === 'judge' ? 
          <JudgePanel startList={startList} orders={orders} scores={scores} allowManual={allowManual} requests={requests} /> : 
          <AdminPanel startList={startList} orders={orders} scores={scores} allowManual={allowManual} requests={requests} teamPenalties={teamPenalties} />
        }
      </div>
    </div>
  );
}

// ==========================================
// 4. ROZHRANÍ PRO ROZHODČÍHO
// ==========================================
function JudgePanel({ startList, orders, scores, allowManual, requests }) {
  // Paměť specifická jen pro tento počítač rozhodčího
  const [apparatus, setApparatus] = useState(''); // Jaké vybral nářadí
  const [formData, setFormData] = useState({ e1:'', e2:'', e3:'', e4:'', c1:'', c2:'', d1:'', d2:'', pen:'0' }); // Data z políček
  const [isSubmitting, setIsSubmitting] = useState(false); // Slouží k zablokování tlačítka během odesílání
  const [manualTeamSelect, setManualTeamSelect] = useState(''); // Číslo týmu vybrané v roletce (pokud chce přeskočit pořadí)
  const [editingScoreId, setEditingScoreId] = useState(null); // Pokud upravuje starou známku, zde je její ID z databáze

  // 1. Nejdříve určíme, zda má rozhodčí schválenou žádost pro vybraný tým
  // Zkusíme najít v 'requests' žádost, která sedí na jeho nářadí a vybraný tým, a zkontrolujeme její status
  const currentRequest = requests.find(r => r.teamNumber === manualTeamSelect && r.apparatus === apparatus);
  const isRequestApproved = currentRequest && currentRequest.status === 'approved';
  const isRequestPending = currentRequest && currentRequest.status === 'pending';
  
  // Může rozhodčí upravovat ručně vybraný tým? Ano, pokud to admin povolil globálně, NEBO pokud má schválenou žádost
  const canEditManual = allowManual || isRequestApproved;

  // 2. Logika pro výběr aktuálního týmu k hodnocení
  let currentTeam = null;
  
  if (manualTeamSelect) {
    // A. Rozhodčí vybral tým v roletce. Nastavíme currentTeam, i když ho možná zatím nemá právo hodnotit.
    currentTeam = startList.find(t => t.teamNumber === manualTeamSelect);
  } else if (apparatus) {
    // B. Jedeme automaticky podle pořadí
    const apparatusOrder = orders[apparatus] || [];
    for (let tNum of apparatusOrder) {
      // Hledáme první tým z předepsaného pořadí, který ještě nemá v databázi (scores) známku pro toto nářadí
      if (!scores.some(s => s.teamNumber === String(tNum).trim() && s.apparatus === apparatus)) {
        currentTeam = startList.find(t => t.teamNumber === String(tNum).trim());
        if (currentTeam) break; // Zastaví hledání, našli jsme ho
      }
    }
    // Záloha: Kdyby pořadí nebylo vyplněné v nastavení, vezme jakýkoliv další tým ze startovky
    if (!currentTeam) {
      currentTeam = startList.find(team => !scores.some(s => s.teamNumber === team.teamNumber && s.apparatus === apparatus));
    }
  }

  // 3. Spustí se vždy, když se změní 'currentTeam'. Zkontroluje, zda tým náhodou už nemá známku (pro případ oprav).
  useEffect(() => {
    if (currentTeam && apparatus) {
      const existingScore = scores.find(s => s.teamNumber === currentTeam.teamNumber && s.apparatus === apparatus);
      if (existingScore) {
        setFormData(existingScore); // Vyplní políčka starou známkou
        setEditingScoreId(existingScore.id); // Zapamatuje si, že upravujeme
      } else {
        // Pokud známku nemá, formulář se vynuluje pro čistý zápis
        setFormData({ e1:'', e2:'', e3:'', e4:'', c1:'', c2:'', d1:'', d2:'', pen:'0' });
        setEditingScoreId(null);
      }
    }
  }, [currentTeam, apparatus, scores]); // Zde říkáme useEffectu, jaké proměnné má sledovat

  // Zavoláme výpočet, aby se ukázaly aktuální známky bokem na obrazovce
  const liveScore = calculateLiveScore(formData);

  // Funkce, která se spustí po kliknutí na tlačítko "Odeslat známky"
  const handleSubmit = async (e) => {
    e.preventDefault(); // Zabrání klasickému probliknutí (obnovení) webové stránky
    if (!currentTeam) return;
    
    // Potvrzovací okno. Pokud jsou nějaké známky mimo toleranci, přidá varovný text.
    /*
    const confirmMsg = (!liveScore.cValid || !liveScore.dValid || !liveScore.eValid) 
      ? `POZOR: Některé známky jsou mimo toleranci a byla použita BASE známka.\n\nCelková známka bude: ${liveScore.total}\n\nChcete přesto odeslat?`
      : `Celková známka: ${liveScore.total}\nOdeslat známky?`;

    // window.confirm je to systémové vyskakovací okno (OK/Zrušit). Pokud dá Zrušit, funkce tu skončí (return).
    if (!window.confirm(confirmMsg)) return;*/

    setIsSubmitting(true);
    try {
      // Připravíme si balíček dat pro odeslání do Firebase
      const scoreData = {
        ...formData, // všechny známky
        category: currentTeam.category,
        teamNumber: currentTeam.teamNumber,
        teamName: currentTeam.teamName,
        apparatus: apparatus,
        timestamp: new Date().toISOString()
      };

      // Máme editingScoreId? Pokud ano, přepisujeme (updateDoc). Pokud ne, přidáváme novou známku (addDoc).
      if (editingScoreId) await updateDoc(doc(db, 'scores', editingScoreId), scoreData);
      else await addDoc(collection(db, 'scores'), scoreData);
      
      // ÚKLID PO ULOŽENÍ: Pokud měl rozhodčí schválenou žádost pro tento tým, po uložení se automaticky smaže, aby mu právo nezůstalo navždy.
      if (isRequestApproved) {
        await deleteDoc(doc(db, 'requests', currentRequest.id));
      }

      setManualTeamSelect(''); // Vynulujeme roletku, systém skočí na další automatický tým
    } catch (err) { alert('Chyba při odesílání: ' + err.message); }
    setIsSubmitting(false); // Odemkne tlačítko
  };

  // Funkce pro vytvoření nové žádosti pro admina
  const handleRequestPermission = async () => {
    if (!currentTeam) return;
    try {
      // Zapíšeme žádost do tabulky 'requests'
      await addDoc(collection(db, 'requests'), {
        teamNumber: currentTeam.teamNumber,
        teamName: currentTeam.teamName,
        apparatus: apparatus,
        status: 'pending', // pending = čekající
        timestamp: new Date().toISOString()
      });
    } catch (err) { alert('Chyba při odesílání žádosti: ' + err.message); }
  };

  // Pokud rozhodčí ještě nemá vybrané nářadí, ukážeme mu velká tlačítka pro výběr
  if (!apparatus) {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm text-center max-w-lg mx-auto">
        <h2 className="text-xl font-bold mb-6">Vyberte nářadí</h2>
        <div className="space-y-4">
          <button onClick={() => setApparatus('Akrobacie')} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold">Akrobacie</button>
          <button onClick={() => setApparatus('Trampolína')} className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold">Trampolína</button>
        </div>
      </div>
    );
  }

  // Rozhodneme, zda zobrazit samotný formulář
  // Formulář se ukáže pokud nevybral nic ručně (jede automaticky) NEBO pokud vybral ručně a má povolení
  const showForm = currentTeam && (!manualTeamSelect || canEditManual);

  return (
    <div className="max-w-4xl mx-auto flex flex-col lg:flex-row gap-6 items-start">
      {/* LEVÁ ČÁST - Zadávání */}
      <div className="flex-1 w-full">
        {/* Tmavá hlavička s aktuálním týmem a roletkou */}
        <div className="bg-slate-800 text-white p-6 rounded-t-xl">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-slate-300 text-sm font-medium uppercase tracking-wider">{apparatus} {currentTeam ? `• ${currentTeam.category}` : ''}</span>
              {currentTeam ? <h2 className="text-2xl font-bold mt-1">{currentTeam.teamNumber} - {currentTeam.teamName}</h2> : <h2 className="text-xl font-bold mt-1 text-green-400">Vše hotovo</h2>}
            </div>
            <button onClick={() => setApparatus('')} className="text-slate-300 hover:text-white underline text-sm">Změnit nářadí</button>
          </div>
          
          <div className="pt-4 border-t border-slate-700 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300 whitespace-nowrap">Přeskočit / Oprava:</span>
            <select value={manualTeamSelect} onChange={(e) => setManualTeamSelect(e.target.value)} className="w-full bg-slate-700 text-white border-slate-600 rounded p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Automatické pořadí --</option>
              {startList.map(t => <option key={t.teamNumber} value={t.teamNumber}>{t.teamNumber} - {t.teamName}</option>)}
            </select>
          </div>
        </div>
        
        {/* Sekce žádostí (Zobrazí se, pokud si rozhodčí vybral tým manuálně a NEMÁ oprávnění) */}
        {manualTeamSelect && !canEditManual && (
          <div className="bg-white p-8 rounded-b-xl shadow-sm border border-slate-100 border-t-0 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-2"><Lock size={32}/></div>
            <h3 className="text-lg font-bold text-slate-800">Tým uzamčen (mimo pořadí)</h3>
            <p className="text-slate-500 text-sm mb-4">Pro úpravu známek týmu <b>{manualTeamSelect}</b> potřebujete souhlas od administrátora.</p>
            
            {/* Má už podanou čekající žádost? */}
            {isRequestPending ? (
              <div className="bg-blue-50 text-blue-700 p-4 rounded-lg border border-blue-100 flex items-center justify-center gap-2 font-medium">
                <div className="animate-spin h-4 w-4 border-2 border-blue-700 border-t-transparent rounded-full"></div>
                Žádost odeslána. Čekejte na schválení administrátorem...
              </div>
            ) : (
              <button onClick={handleRequestPermission} className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-xl font-bold shadow-sm flex items-center gap-2 mx-auto">
                <Bell size={18}/> Požádat administrátora o odemčení
              </button>
            )}
          </div>
        )}

        {/* Samotný formulář na známky (Zobrazí se jen pokud prošel povolením) */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-b-xl shadow-sm border border-slate-100 border-t-0 space-y-8 relative">
            
            {/* Informační proužky, pokud opravuje existující, nebo dostal jednorázové povolení */}
            {editingScoreId && (
              <div className="absolute top-0 left-0 right-0 bg-yellow-100 text-yellow-800 text-center text-sm font-bold py-1 px-4 rounded-b-lg">
                REŽIM OPRAVY: Přepisujete starou známku
              </div>
            )}
            {isRequestApproved && (
              <div className="absolute top-0 left-0 right-0 bg-emerald-100 text-emerald-800 text-center text-sm font-bold py-1 px-4 rounded-b-lg">
                JEDNORÁZOVÉ POVOLENÍ: Administrátor odemkl tento tým
              </div>
            )}

            <div className={editingScoreId || isRequestApproved ? "pt-6" : ""}>
              <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">Provedení (E)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {['e1', 'e2', 'e3', 'e4'].map((f) => (
                  <div key={f}>
                    <label className={`block text-sm font-bold uppercase mb-1 ${f==='e1'?'text-blue-600':'text-slate-500'}`}>{f}</label>
                    <input type="number" step="0.05" required value={formData[f]} onChange={(e) => setFormData({...formData, [f]: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>
              {/* Varování při toleranci (zobrazí se, až když jsou vyplněná data, proto kontrolujeme formData.e4) */}
              {!liveScore.eValid && formData.e4 && (
                <p className="text-red-500 text-sm mt-2 flex items-center gap-1 font-medium bg-red-50 p-2 rounded"><AlertTriangle size={16}/> Známky E nejsou v toleranci ({liveScore.eTols.mid} / {liveScore.eTols.all}). Je počítána Base známka.</p>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">Kompozice (C)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {['c1', 'c2'].map((f) => (
                    <div key={f}>
                      <label className="block text-sm font-bold text-slate-500 uppercase mb-1">{f}</label>
                      <input type="number" step="0.05" required value={formData[f]} onChange={(e) => setFormData({...formData, [f]: e.target.value})} className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
                {!liveScore.cValid && formData.c2 && <p className="text-red-500 text-xs mt-2 bg-red-50 p-1 rounded">Známky C nejsou v toleranci. Je počítána Base známka.</p>}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">Obtížnost (D)</h3>
                <div className="grid grid-cols-2 gap-4">
                  {['d1', 'd2'].map((f) => (
                    <div key={f}>
                      <label className="block text-sm font-bold text-slate-500 uppercase mb-1">{f}</label>
                      <input type="number" step="0.05" required value={formData[f]} onChange={(e) => setFormData({...formData, [f]: e.target.value})} className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
                {!liveScore.dValid && formData.d2 && <p className="text-red-500 text-xs mt-2 bg-red-50 p-1 rounded">Známky D nejsou v toleranci. Je počítána Base známka.</p>}
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 items-end pt-4">
              <div className="w-full md:w-1/3">
                <label className="block text-sm font-bold text-red-500 uppercase mb-1">Penalizace (PEN)</label>
                <input type="number" step="0.05" required value={formData.pen} onChange={(e) => setFormData({...formData, pen: e.target.value})} className="w-full p-3 border border-red-200 rounded-lg bg-red-50 focus:ring-2 focus:ring-red-500" />
              </div>
              <button type="submit" disabled={isSubmitting} className="w-full md:w-2/3 py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-xl font-bold shadow-sm transition-colors">
                {isSubmitting ? 'Odesílám...' : (editingScoreId ? 'Uložit opravu a dál' : 'Odeslat známky a dál')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* PRAVÁ ČÁST - Živý náhled přepočtu */}
      {/* Sticky znamená, že pravý sloupec "plave" se stránkou, když se scrolluje dolů */}
      {currentTeam && (
        <div className="w-full lg:w-80 bg-white rounded-xl shadow-sm border border-slate-100 p-6 lg:sticky lg:top-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Živý přepočet</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-medium text-slate-600">Kompozice (C)</span>
              <span className={`font-bold ${!liveScore.cValid && formData.c2 ? 'text-red-500' : 'text-slate-800'}`}>{liveScore.c}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-medium text-slate-600">Obtížnost (D)</span>
              <span className={`font-bold ${!liveScore.dValid && formData.d2 ? 'text-red-500' : 'text-slate-800'}`}>{liveScore.d}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="font-medium text-slate-600">Provedení (E)</span>
              <span className={`font-bold ${!liveScore.eValid && formData.e4 ? 'text-red-500' : 'text-slate-800'}`}>{liveScore.e}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b text-red-500">
              <span className="font-medium">Penalizace</span>
              <span className="font-bold">-{liveScore.pen}</span>
            </div>
            <div className="pt-2 bg-slate-50 p-4 rounded-lg border">
              <span className="block text-sm text-slate-500 font-medium mb-1">Výsledná známka:</span>
              <span className="block text-4xl font-black text-slate-800 tracking-tight">{liveScore.total}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 5. ROZHRANÍ PRO ADMINISTRÁTORA
// ==========================================
function AdminPanel({ startList, orders, scores, allowManual, requests, teamPenalties }) {
  const [activeTab, setActiveTab] = useState('results'); 
  // Paměť pro skryté kategorie (které nechceme vidět ani tisknout)
  const [hiddenCategories, setHiddenCategories] = useState({});
  
  // NOVÁ FUNKCE PRO ÚPRAVU PEN SJ
  const editPenSJ = async (teamNumber, currentPen) => {
    // Vyskakovací okno pro zadání čísla
    const val = prompt(`Zadejte srážku hlavního rozhodčího (PEN SJ) pro tým ${teamNumber}:`, currentPen || 0);
    if (val !== null) {
      const numVal = Number(val.replace(',', '.')); // Vymění případnou čárku za tečku
      if (!isNaN(numVal)) {
        const newPenalties = { ...teamPenalties, [teamNumber]: numVal };
        await setDoc(doc(db, 'config', 'startList'), { penalties: newPenalties }, { merge: true });
      } else {
        alert('Neplatné číslo.');
      }
    }
  };

  const handleRequestAction = async (requestId, action) => {
    try {
      if (action === 'approve') {
        await updateDoc(doc(db, 'requests', requestId), { status: 'approved' });
      } else {
        await deleteDoc(doc(db, 'requests', requestId));
      }
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  const toggleManual = async () => {
    await setDoc(doc(db, 'config', 'startList'), { allowManual: !allowManual }, { merge: true });
  };

  const toggleCategory = (cat) => {
    setHiddenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');

  const resultsByTeam = {};
  startList.forEach(team => {
    // Zde nově dosazujeme penSJ z naší databáze (teamPenalties)
    resultsByTeam[team.teamNumber] = { ...team, Akrobacie: null, Trampolína: null, penSJ: teamPenalties[team.teamNumber] || 0 };
  });
  
  scores.forEach(score => {
    if (resultsByTeam[score.teamNumber]) {
      resultsByTeam[score.teamNumber][score.apparatus] = calculateLiveScore(score);
    }
  });

  const finalResults = Object.values(resultsByTeam).map(team => {
    const aTotal = team.Akrobacie ? Number(team.Akrobacie.total) : 0;
    const tTotal = team.Trampolína ? Number(team.Trampolína.total) : 0;
    return { ...team, finalTotal: (aTotal + tTotal - team.penSJ).toFixed(3) };
  }).sort((a, b) => b.finalTotal - a.finalTotal);

  const groupedResults = finalResults.reduce((acc, team) => {
    if (!acc[team.category]) acc[team.category] = [];
    acc[team.category].push(team);
    return acc;
  }, {});

  const exportAllCSV = () => {
    let content = "\uFEFF"; 
    Object.entries(groupedResults).forEach(([cat, teams]) => {
      if (hiddenCategories[cat]) return; // Skryté kategorie vynecháme i v Excelu
      content += `KATEGORIE:;${cat}\n`;
      const headers = ['Pořadí', 'Cislo', 'Druzstvo', 'Akr C', 'Akr D', 'Akr E', 'Akr PEN', 'Akr Celkem', 'Tra C', 'Tra D', 'Tra E', 'Tra PEN', 'Tra Celkem', 'PEN SJ', 'Vysledek'];
      content += headers.join(';') + '\n';
      
      const rows = teams.map((t, idx) => [
        idx + 1, t.teamNumber, t.teamName,
        t.Akrobacie?.c || '', t.Akrobacie?.d || '', t.Akrobacie?.e || '', t.Akrobacie?.pen || '', t.Akrobacie?.total || '',
        t.Trampolína?.c || '', t.Trampolína?.d || '', t.Trampolína?.e || '', t.Trampolína?.pen || '', t.Trampolína?.total || '',
        t.penSJ.toFixed(3), t.finalTotal
      ]);
      content += rows.map(r => r.join(';')).join('\n');
      content += '\n\n'; 
    });

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Vysledky_TeamGym.csv";
    link.click();
  };

  // --- UPRAVENÁ FUNKCE PRO ÚSPORNÝ TISK S LOGY A PEVNOU PATIČKOU ---
  const exportToPDF = () => {
    const categoriesToPrint = Object.entries(groupedResults).filter(([cat]) => !hiddenCategories[cat]);
    if (categoriesToPrint.length === 0) return alert("Vyberte alespoň jednu kategorii k tisku.");

    const baseUrl = window.location.origin;

    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Výsledky Á Hop 2026</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; margin: 0; padding: 15px; }
          
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 20px; }
          .header-left, .header-right { display: flex; align-items: center; gap: 20px; }
          .header h1 { margin: 0; font-size: 24px; color: #1e3a8a; text-transform: uppercase; }
          .header h2 { margin: 0; font-size: 16px; color: #64748b; font-weight: normal; }
          
          /* OPRAVA STRÁNKOVÁNÍ */
          .category-block { margin-bottom: 35px; } /* Záměrně smazáno page-break-inside: avoid; */
          .category-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; page-break-after: avoid; } /* Zabrání osiřelému nadpisu na konci stránky bez tabulky */
          
          table { width: 100%; border-collapse: collapse; font-size: 11px; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; } /* Zabrání rozseknutí řádku s jedním týmem napůl */
          thead { display: table-header-group; } /* Zaručí zopakování hlavičky tabulky na nové stránce */
          
          th, td { border: 1px solid #cbd5e1; padding: 5px 4px; text-align: center; }
          th { background-color: #f1f5f9; font-weight: bold; color: #334155; }
          .apparatus-header { background-color: #e2e8f0; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
          .team-name { text-align: left; font-weight: bold; padding-left: 8px; font-size: 12px; }
          .total-col { font-weight: bold; background-color: #f8fafc; }
          .final-total { font-weight: bold; background-color: #e0e7ff; font-size: 12px; color: #1e3a8a; }
          .rank { font-weight: bold; font-size: 14px; background-color: #1e3a8a; color: white; }
          
          /* FIXNÍ PATIČKA NA SPODKU STRÁNKY */
          .print-footer { 
            position: fixed; 
            bottom: 0; 
            left: 0; 
            width: 100%; 
            display: flex; 
            justify-content: space-between;
            font-size: 12px; 
            font-weight: bold; 
            color: #1e3a8a; 
            background-color: white;
            padding: 10px 15px;
            box-sizing: border-box;
            height: 40px; /* NOVÉ: Pevná výška */
            z-index: 1000;
          }
          
          /* NOVÉ: Nárazník, který drží místo v tabulce */
          .footer-space {
            height: 40px;
          }
          
          tfoot { display: table-footer-group; }
          
          @media print {
            @page { size: A4 landscape; margin: 10mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; } /* Zrušen padding-bottom */
          }
        </style>
      </head>
      <body>
        <!-- FIXNÍ PATIČKA -->
        <div class="print-footer">
          <div>Ředitelka závodu: Gabriela Machová</div>
          <div>Hlavní rozhodčí: Filip Mach</div>
        </div>

        <div class="header">
          <div class="header-left">
            <img src="${baseUrl}/logo-klub.png" alt="Logo klubu" style="height: 60px; object-fit: contain;">
            <div>
              <h1>Á Hop 2026</h1>
              <h2>21.11.2026</h2>
            </div>
          </div>
          <div class="header-right">
            <img src="${baseUrl}/logo-praha.png" alt="Praha" style="height: 60px; object-fit: contain;">
          </div>
        </div>
    `;

    categoriesToPrint.forEach(([category, teams]) => {
      htmlContent += `
        <div class="category-block">
          <div class="category-title">${category}</div>
          <table>
            <thead>
              <tr>
                <th rowspan="2" style="width: 25px;">Poř.</th>
                <th rowspan="2" style="width: 30px;">Č.</th>
                <th rowspan="2" class="team-name" style="width: 250px;">Družstvo</th>
                <th colspan="5" class="apparatus-header">Akrobacie</th>
                <th colspan="5" class="apparatus-header">Trampolína</th>
                <th rowspan="2" style="width: 40px;">PEN<br>SJ</th>
                <th rowspan="2" class="final-total" style="width: 60px;">Výsledek</th>
              </tr>
              <tr>
                <th>C</th><th>D</th><th>E</th><th>PEN</th><th class="total-col">Celkem</th>
                <th>C</th><th>D</th><th>E</th><th>PEN</th><th class="total-col">Celkem</th>
              </tr>
            </thead>
            <tbody>
      `;

      teams.forEach((t, idx) => {
        const fmt = (val) => val && val !== '-' ? String(val).replace('.', ',') : '';
        
        htmlContent += `
              <tr>
                <td class="rank">${idx + 1}</td>
                <td>${t.teamNumber}</td>
                <td class="team-name">${t.teamName}</td>
                
                <td>${fmt(t.Akrobacie?.c)}</td>
                <td>${fmt(t.Akrobacie?.d)}</td>
                <td style="${!t.Akrobacie?.eValid && t.Akrobacie?.e ? 'color: #ef4444; font-weight: bold;' : ''}">${fmt(t.Akrobacie?.e)}</td>
                <td style="color: #ef4444;">${fmt(t.Akrobacie?.pen)}</td>
                <td class="total-col">${fmt(t.Akrobacie?.total)}</td>
                
                <td>${fmt(t.Trampolína?.c)}</td>
                <td>${fmt(t.Trampolína?.d)}</td>
                <td style="${!t.Trampolína?.eValid && t.Trampolína?.e ? 'color: #ef4444; font-weight: bold;' : ''}">${fmt(t.Trampolína?.e)}</td>
                <td style="color: #ef4444;">${fmt(t.Trampolína?.pen)}</td>
                <td class="total-col">${fmt(t.Trampolína?.total)}</td>
                
                <td style="color: #ef4444;">${fmt(t.penSJ)}</td>
                <td class="final-total">${fmt(t.finalTotal)}</td>
              </tr>
        `;
      });

      htmlContent += `
            </tbody>
            <!-- NOVÉ: Neviditelný nárazník na spodek tabulky. Colspan=15 odpovídá počtu vašich sloupců -->
            <tfoot>
              <tr>
                <td colspan="15" style="border: none; padding: 0;">
                  <div class="footer-space">&nbsp;</div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    });

    htmlContent += `
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 500); 
          }
        </script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    } else {
      alert("Prohlížeč zablokoval vyskakovací okno. Povolte vyskakovací okna (pop-ups) pro tuto stránku.");
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      
      {pendingRequests.length > 0 && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-4">
          <h3 className="font-bold text-yellow-800 flex items-center gap-2 mb-3"><Bell size={18}/> Nové žádosti o odemčení týmů</h3>
          <div className="space-y-2">
            {pendingRequests.map(req => (
              <div key={req.id} className="flex justify-between items-center bg-white p-3 rounded shadow-sm border border-yellow-100">
                <div>
                  <span className="text-sm font-bold text-slate-700">{req.apparatus}</span>
                  <span className="text-sm text-slate-600 mx-2">chce upravit tým</span>
                  <span className="text-sm font-bold text-indigo-600">{req.teamNumber} ({req.teamName})</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRequestAction(req.id, 'reject')} className="px-3 py-1 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-700 rounded text-sm font-medium flex items-center gap-1 transition-colors"><X size={16}/> Zamítnout</button>
                  <button onClick={() => handleRequestAction(req.id, 'approve')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium flex items-center gap-1 shadow-sm transition-colors"><Check size={16}/> Povolit úpravu</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center px-6 py-3 bg-slate-50 border-b gap-4">
        <div className="flex gap-2 overflow-x-auto w-full">
          <button onClick={() => setActiveTab('results')} className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'results' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200'}`}>Výsledky</button>
          <button onClick={() => setActiveTab('raw')} className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'raw' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200'}`}>Editace dat</button>
          <button onClick={() => setActiveTab('config')} className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'config' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200'}`}>Nastavení závodu</button>
        </div>
        
        <button onClick={toggleManual} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shadow-sm border ${allowManual ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
          {allowManual ? <Unlock size={14}/> : <Lock size={14}/>}
          {allowManual ? 'GLOBÁLNÍ PŘESKAKOVÁNÍ POVOLENO' : 'GLOBÁLNÍ PŘESKAKOVÁNÍ UZAMČENO'}
        </button>
      </div>

      <div className="p-6">
        {activeTab === 'results' && (
          <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h2 className="text-xl font-bold text-slate-800">Průběžné výsledky</h2>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportAllCSV} className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors">
                  <Download size={16}/> Export (CSV)
                </button>
                <button onClick={exportToPDF} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors">
                  <Printer size={18}/> Vytisknout zobrazené do PDF
                </button>
              </div>
            </div>

            {/* NOVÝ BLOK PRO VÝBĚR KATEGORIÍ */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="block text-sm font-bold text-slate-700">Viditelné kategorie k tisku:</span>
                <div className="flex gap-2">
                  <button onClick={() => setHiddenCategories({})} className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1 rounded shadow-sm">Zobrazit vše</button>
                  <button onClick={() => {
                    const allHidden = {};
                    Object.keys(groupedResults).forEach(cat => allHidden[cat] = true);
                    setHiddenCategories(allHidden);
                  }} className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1 rounded shadow-sm">Skrýt vše</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {Object.keys(groupedResults).map(cat => (
                  <label key={cat} className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={!hiddenCategories[cat]} 
                      onChange={() => toggleCategory(cat)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-600">{cat}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="space-y-12">
              {Object.entries(groupedResults).map(([category, teams]) => {
                // Pokud je kategorie zaškrtnutá jako skrytá, úplně ji na obrazovce (i v tisku) ignorujeme
                if (hiddenCategories[category]) return null;
                
                return (
                  <div key={category} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <h3 className="text-lg font-bold text-white bg-slate-800 p-4">{category}</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
                          <tr>
                            <th className="p-3 border-b border-r">Pořadí</th>
                            <th className="p-3 border-b border-r">Č.</th>
                            <th className="p-3 border-b border-r min-w-[200px]">Družstvo</th>
                            <th colSpan="5" className="p-3 border-b border-r text-center bg-indigo-50/50">Akrobacie</th>
                            <th colSpan="5" className="p-3 border-b border-r text-center bg-orange-50/50">Trampolína</th>
                            <th className="p-3 border-b border-r text-center">PEN SJ</th> {/* NOVÝ ŘÁDEK */}
                            <th className="p-3 border-b text-center">Celkem</th>
                          </tr>
                          <tr className="bg-slate-100 text-[10px] text-slate-500">
                            <th className="border-b border-r"></th><th className="border-b border-r"></th><th className="border-b border-r"></th>
                            <th className="p-2 border-b">C</th><th className="p-2 border-b">D</th><th className="p-2 border-b">E</th><th className="p-2 border-b text-red-500">PEN</th><th className="p-2 border-b border-r font-bold">SUM</th>
                            <th className="p-2 border-b">C</th><th className="p-2 border-b">D</th><th className="p-2 border-b">E</th><th className="p-2 border-b text-red-500">PEN</th><th className="p-2 border-b border-r font-bold">SUM</th>
                            <th className="border-b"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {teams.map((t, idx) => (
                            <tr key={t.teamNumber} className="border-b hover:bg-slate-50">
                              <td className="p-3 border-r font-bold text-center">{idx + 1}.</td>
                              <td className="p-3 border-r text-slate-500">{t.teamNumber}</td>
                              <td className="p-3 border-r font-medium text-slate-800">{t.teamName}</td>
                              
                              <td className="p-2 text-center text-slate-500">{t.Akrobacie?.c || '-'}</td>
                              <td className="p-2 text-center text-slate-500">{t.Akrobacie?.d || '-'}</td>
                              <td className={`p-2 text-center ${!t.Akrobacie?.eValid && t.Akrobacie?.e ? 'text-red-500 font-bold bg-red-50' : 'text-slate-500'}`}>{t.Akrobacie?.e || '-'}</td>
                              <td className="p-2 text-center text-red-500 font-medium">{t.Akrobacie?.pen || '-'}</td>
                              <td className="p-2 text-center font-bold bg-indigo-50/40 border-r">{t.Akrobacie?.total || '-'}</td>
                              
                              <td className="p-2 text-center text-slate-500">{t.Trampolína?.c || '-'}</td>
                              <td className="p-2 text-center text-slate-500">{t.Trampolína?.d || '-'}</td>
                              <td className={`p-2 text-center ${!t.Trampolína?.eValid && t.Trampolína?.e ? 'text-red-500 font-bold bg-red-50' : 'text-slate-500'}`}>{t.Trampolína?.e || '-'}</td>
                              <td className="p-2 text-center text-red-500 font-medium">{t.Trampolína?.pen || '-'}</td>
                              <td className="p-2 text-center font-bold bg-orange-50/40 border-r">{t.Trampolína?.total || '-'}</td>
                              {/* NOVÝ KLIKACÍ SLOUPEC PEN SJ */}
                              <td 
                                className="p-2 text-center text-red-600 font-bold bg-red-50/30 border-r cursor-pointer hover:bg-red-100 transition-colors"
                                onClick={() => editPenSJ(t.teamNumber, t.penSJ)}
                                title="Kliknutím upravte srážku SJ"
                              >
                                {t.penSJ > 0 ? t.penSJ.toFixed(3) : '-'}
                              </td>
                              <td className="p-3 text-center font-black text-lg text-slate-800 bg-slate-50">{t.finalTotal}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'raw' && <RawScoresEditor scores={scores} />}
        {activeTab === 'config' && <StartListConfig currentList={startList} currentOrders={orders} />}
      </div>
    </div>
  );
}

// ==========================================
// POHLED ADMINISTRÁTORA: Nastavení listin
// ==========================================
function StartListConfig({ currentList, currentOrders }) {
  // Převedeme naše uložené pole týmů z Firebase zpět na text, který se ukáže v textovém poli (\n je nový řádek)
  const [inputText, setInputText] = useState(currentList.map(t => `${t.category};${t.teamNumber};${t.teamName}`).join('\n'));
  const [orderAkr, setOrderAkr] = useState(currentOrders.Akrobacie ? currentOrders.Akrobacie.join(', ') : '');
  const [orderTra, setOrderTra] = useState(currentOrders.Trampolína ? currentOrders.Trampolína.join(', ') : '');

  // Spustí se po stisknutí tlačítka pro uložení
  const parseAndSave = async () => {
    // 1. Zpracování velkého pole (týmy)
    const lines = inputText.split('\n').filter(l => l.trim() !== ''); // Rozsekáme na řádky a zahodíme prázdné
    const newTeams = lines.map(line => {
      const parts = line.split(';'); // Každý řádek rozsekneme podle středníku
      return { category: parts[0]?.trim(), teamNumber: parts[1]?.trim(), teamName: parts[2]?.trim() };
    }).filter(t => t.category && t.teamNumber && t.teamName); // Propustíme jen ty, kde nic nechybí

    // 2. Zpracování malých polí (pořadí - rozsekáme podle čárek nebo mezer)
    const parseOrder = (str) => str.split(/[, \n]+/).map(s => s.trim()).filter(s => s !== '');
    const newOrders = { Akrobacie: parseOrder(orderAkr), Trampolína: parseOrder(orderTra) };

    if (newTeams.length === 0) return alert('Nenalezeny žádné týmy.');
    try {
      await setDoc(doc(db, 'config', 'startList'), { teams: newTeams, orders: newOrders }, { merge: true });
      alert(`Uloženo!`);
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  return (
    <div className="max-w-4xl grid md:grid-cols-2 gap-8">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">1. Seznam týmů</h2>
        <textarea value={inputText} onChange={e => setInputText(e.target.value)} className="w-full h-[400px] p-4 border rounded-lg bg-slate-50 text-sm font-mono" placeholder="Kategorie;Číslo;Název" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">2. Pořadí</h2>
        <label className="block text-sm font-bold text-indigo-700 mb-1">Akrobacie</label>
        <textarea value={orderAkr} onChange={e => setOrderAkr(e.target.value)} className="w-full h-24 p-3 border rounded-lg mb-4 text-sm font-mono" placeholder="1, 3, 5..." />
        <label className="block text-sm font-bold text-orange-700 mb-1">Trampolína</label>
        <textarea value={orderTra} onChange={e => setOrderTra(e.target.value)} className="w-full h-24 p-3 border rounded-lg mb-6 text-sm font-mono" placeholder="2, 4, 6..." />
        <button onClick={parseAndSave} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-sm transition-colors"><Save size={20}/> Uložit nastavení závodu</button>
      </div>
    </div>
  );
}

// ==========================================
// POHLED ADMINISTRÁTORA: Úprava Surových dat
// ==========================================
function RawScoresEditor({ scores }) {
  const [editingId, setEditingId] = useState(null); // ID známky, na kterou admin klikl (upravuje ji)
  const [editForm, setEditForm] = useState({}); // Políčka pro úpravu

  const startEdit = (score) => { setEditingId(score.id); setEditForm(score); };
  const saveEdit = async () => {
    try {
      await updateDoc(doc(db, 'scores', editingId), editForm);
      setEditingId(null); // Ukončí režim úprav
    } catch (e) { alert('Chyba při ukládání: ' + e.message); }
  };

  return (
    <div className="overflow-x-auto border rounded-xl">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="bg-slate-800 text-white text-xs uppercase">
          <tr>
            <th className="p-3">Nářadí</th><th className="p-3 border-r border-slate-700">Tým</th>
            <th className="p-3 text-center" colSpan="4">E1-E4</th>
            <th className="p-3 text-center border-l border-slate-700" colSpan="2">C1-C2</th>
            <th className="p-3 text-center border-l border-slate-700" colSpan="2">D1-D2</th>
            <th className="p-3 text-center border-l border-slate-700 text-red-400">PEN</th>
            <th className="p-3 text-center border-l border-slate-700">Akce</th>
          </tr>
        </thead>
        <tbody>
          {/* Projedeme všechny známky a vytvoříme řádky */}
          {scores.map(s => {
            const isEd = editingId === s.id; // Upravujeme právě tenhle řádek?
            // Malá funkce - vygeneruje buď běžný text, nebo textové pole, pokud zrovna upravujeme
            const v = (field) => isEd ? <input type="number" step="0.05" className="w-16 border rounded p-1 text-center shadow-inner" value={editForm[field]} onChange={e => setEditForm({...editForm, [field]: e.target.value})} /> : s[field];
            return (
              <tr key={s.id} className="border-b hover:bg-slate-50">
                <td className="p-3 font-medium text-slate-600">{s.apparatus}</td><td className="p-3 border-r border-slate-200"><b>{s.teamNumber}</b> - {s.teamName}</td>
                <td className="p-2 text-center">{v('e1')}</td><td className="p-2 text-center">{v('e2')}</td><td className="p-2 text-center">{v('e3')}</td><td className="p-2 text-center">{v('e4')}</td>
                <td className="p-2 text-center bg-slate-100/50 border-l">{v('c1')}</td><td className="p-2 text-center bg-slate-100/50">{v('c2')}</td>
                <td className="p-2 text-center border-l">{v('d1')}</td><td className="p-2 text-center">{v('d2')}</td>
                <td className="p-2 text-center text-red-500 font-bold border-l">{v('pen')}</td>
                <td className="p-3 text-center border-l">
                  {isEd ? 
                    <button onClick={saveEdit} className="px-3 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded font-bold transition-colors">Uložit</button> : 
                    <button onClick={() => startEdit(s)} className="px-3 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded font-medium transition-colors">Opravit</button>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}