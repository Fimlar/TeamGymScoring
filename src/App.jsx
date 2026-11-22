// ==========================================
// IMPORTY
// ==========================================
// useState = paměť komponenty (když se změní, obrazovka se překreslí)
// useEffect = kód, který se spustí po vykreslení (např. připojení k databázi)
// useMemo = zapamatuje si výsledek výpočtu, dokud se nezmění vstupní data
import React, { useState, useEffect, useMemo } from 'react';

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { signInAnonymously, getAuth } from 'firebase/auth';

import {
  Download, AlertTriangle, Bell, Check, X, KeyRound, Lock, Unlock, Printer, Save, Plus, Trash2, Wifi, WifiOff,
} from 'lucide-react';

// ==========================================
// 1. NASTAVENÍ
// ==========================================
// POZOR: Hesla jsou uložená přímo v kódu stránky, takže je technicky zdatný člověk umí přečíst.
// Chrání před omylem, ne před útočníkem. Skutečnou ochranu dat zajišťují pravidla ve Firebase.
const ADMIN_PASSWORD = '1234';
const JUDGE_PASSWORD = '0000';

// Údaje o závodě (používají se v hlavičce a v tiskové sestavě)
const COMPETITION = {
  name: 'Á Hop 2026',
  date: '21.11.2026',
  director: 'Gabriela Machová',
  headJudge: 'Filip Mach',
};

// Klíče k Firebase se načítají ze souboru .env.local (není v gitu).
// Vzor je v souboru .env.example – zkopírujte ho jako .env.local a doplňte hodnoty z Firebase konzole.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebase nastartujeme jen tehdy, když jsou vyplněné klíče (jinak by aplikace hned spadla)
const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;
const configRef = () => doc(db, 'config', 'startList');

const APPARATUS = ['Akrobacie', 'Trampolína'];

// Tailwind potřebuje celé názvy tříd napsané v kódu, proto je máme připravené tady
const APPARATUS_STYLE = {
  Akrobacie: { button: 'bg-indigo-600 hover:bg-indigo-700', text: 'text-indigo-700', soft: 'bg-indigo-50', border: 'border-indigo-200' },
  Trampolína: { button: 'bg-orange-600 hover:bg-orange-700', text: 'text-orange-700', soft: 'bg-orange-50', border: 'border-orange-200' },
};

// Výchozí rozdělení: 2 skupiny družstev, každá má panel na akrobacii a na trampolínu.
// Pokud v databázi zůstalo pořadí ze staré verze (orders), použije se pro Skupinu 1.
const makeDefaultPanels = (legacyOrders = {}) => [
  { id: 'p1', name: 'Skupina 1 – Akrobacie', apparatus: 'Akrobacie', order: legacyOrders.Akrobacie || [], eJudges: 4 },
  { id: 'p2', name: 'Skupina 1 – Trampolína', apparatus: 'Trampolína', order: legacyOrders['Trampolína'] || [], eJudges: 4 },
  { id: 'p3', name: 'Skupina 2 – Akrobacie', apparatus: 'Akrobacie', order: [], eJudges: 4 },
  { id: 'p4', name: 'Skupina 2 – Trampolína', apparatus: 'Trampolína', order: [], eJudges: 4 },
];

const EMPTY_FORM = { e1: '', e2: '', e3: '', e4: '', c1: '', c2: '', d1: '', d2: '', pen: '0' };
const SCORE_FIELDS = Object.keys(EMPTY_FORM);

// ==========================================
// 2. POMOCNÉ FUNKCE (Matematika a pravidla)
// ==========================================
const EPS = 1e-6;

// Převede vstup na číslo (prázdné nebo nesmyslné pole = 0, čárka se bere jako desetinná tečka)
const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Matematické zaokrouhlení na daný počet desetinných míst.
// Počítače mají s desetinnými čísly drobné nepřesnosti (0.1 + 0.2 = 0.30000000000000004),
// proto přičítáme malinkou rezervu, aby se např. 8.15 vždy zaokrouhlilo na 8.2.
const roundTo = (x, decimals) => {
  const f = 10 ** decimals;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-7)) / f;
};

const fmt3 = (x) => x.toFixed(3);

// Při 3 rozhodčích E: E4 = průměr E1–E3 zaokrouhlený matematicky na 1 desetinné místo
const computeE4 = (e1, e2, e3) => roundTo(roundTo((e1 + e2 + e3) / 3, 6), 1);

const normalizeEJudges = (v) => (Number(v) === 3 ? 3 : 4);

// Povolené tolerance pro E podle průměru prostředních známek
const getETolerances = (avg) => {
  if (avg >= 9.0) return { mid: 0.2, all: 0.6 };
  if (avg >= 8.0) return { mid: 0.3, all: 0.6 };
  if (avg >= 7.0) return { mid: 0.4, all: 1.0 };
  if (avg >= 6.0) return { mid: 0.5, all: 1.0 };
  return { mid: 0.6, all: 1.0 };
};

// C a D: průměr dvou známek. Pokud se liší o víc než 0.2, počítá se Base známka (průměr + známka 1) / 2
const pairScore = (first, second) => {
  const avg = (first + second) / 2;
  const valid = roundTo(Math.abs(first - second), 3) <= 0.2 + EPS;
  return { value: roundTo(valid ? avg : (avg + first) / 2, 3), valid };
};

// Hlavní výpočet známky na jednom nářadí.
// data = uložené známky (e1..e4, c1, c2, d1, d2, pen) + eJudges (3 nebo 4)
const calculateScore = (data) => {
  const eJudges = normalizeEJudges(data.eJudges);
  const e1 = toNum(data.e1), e2 = toNum(data.e2), e3 = toNum(data.e3);
  const e4 = eJudges === 3 ? computeE4(e1, e2, e3) : toNum(data.e4);
  const pen = toNum(data.pen);

  const c = pairScore(toNum(data.c1), toNum(data.c2));
  const d = pairScore(toNum(data.d1), toNum(data.d2));

  // E: seřadíme 4 známky, průměr prostředních dvou, kontrola tolerancí
  const s = [e1, e2, e3, e4].sort((a, b) => a - b);
  const eMidAvg = roundTo((s[1] + s[2]) / 2, 3);
  const eTols = getETolerances(eMidAvg);
  const eValid = roundTo(s[2] - s[1], 3) <= eTols.mid + EPS && roundTo(s[3] - s[0], 3) <= eTols.all + EPS;
  const e = roundTo(eValid ? eMidAvg : (eMidAvg + e1) / 2, 3);

  // Celkem sčítáme už zaokrouhlené dílčí známky, aby součet seděl s tím, co je vidět ve výsledcích
  const total = roundTo(c.value + d.value + e - pen, 3);

  return {
    c: fmt3(c.value), cValid: c.valid,
    d: fmt3(d.value), dValid: d.valid,
    e: fmt3(e), eValid, eTols,
    e4Value: e4, eJudges,
    pen: fmt3(pen),
    total: fmt3(total), totalNum: total,
  };
};

// Pořadí zadané jako "1, 3, 5" nebo po řádcích -> ['1', '3', '5']
const parseOrder = (str) => String(str || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

// ID dokumentu ve Firestore nesmí obsahovat lomítko
const sanitizeId = (s) => String(s).replace(/\//g, '-');

// Každý tým má na každém nářadí právě jednu známku -> pevné ID zabrání duplicitám,
// i kdyby stejný tým omylem hodnotily dva panely.
const scoreDocId = (apparatus, teamNumber) => sanitizeId(`${apparatus}_${teamNumber}`);
const scoreKey = (apparatus, teamNumber) => `${apparatus}|${teamNumber}`;

// Rychlé vyhledávání známky podle nářadí + čísla týmu.
// Pokud by ze staré verze existovaly duplicity, vezme se ta nejnovější.
const buildScoreMap = (scores) => {
  const map = new Map();
  scores.forEach((s) => {
    const key = scoreKey(s.apparatus, s.teamNumber);
    const prev = map.get(key);
    if (!prev || String(s.timestamp || '') > String(prev.timestamp || '')) map.set(key, s);
  });
  return map;
};

// Týmy, které panel hodnotí (podle pořadí). Bez nastaveného pořadí = všechny týmy.
const panelTeams = (panel, teams) => {
  if (!panel.order.length) return teams;
  return panel.order.map((n) => teams.find((t) => t.teamNumber === n)).filter(Boolean);
};

// Další tým v pořadí, který na nářadí panelu ještě nemá známku
const nextTeamForPanel = (panel, teams, scoreMap) =>
  panelTeams(panel, teams).find((t) => !scoreMap.has(scoreKey(panel.apparatus, t.teamNumber))) || null;

const panelProgress = (panel, teams, scoreMap) => {
  const list = panelTeams(panel, teams);
  const done = list.filter((t) => scoreMap.has(scoreKey(panel.apparatus, t.teamNumber))).length;
  return { done, total: list.length };
};

// Ochrana textu vkládaného do tiskového HTML (např. název týmu "A & B")
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Číslo s desetinnou čárkou (pro český Excel a tisk)
const cz = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

// Bezpečný přístup k paměti prohlížeče (v anonymním okně může selhat)
const storage = (kind) => ({
  get: (k) => { try { return window[kind].getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) window[kind].removeItem(k); else window[kind].setItem(k, v); } catch { /* nevadí */ } },
});
const local = storage('localStorage');
const session = storage('sessionStorage');

// Převod dat z databáze do jednotného tvaru (doplní chybějící hodnoty, sjednotí typy)
const normalizeConfig = (d = {}) => {
  const teams = (d.teams || []).map((t) => ({ ...t, teamNumber: String(t.teamNumber).trim() }));
  const rawPanels = d.panels && d.panels.length ? d.panels : makeDefaultPanels(d.orders);
  const panels = rawPanels.map((p) => ({
    ...p,
    order: (p.order || []).map((n) => String(n).trim()),
    eJudges: normalizeEJudges(p.eJudges),
  }));
  return {
    loaded: true, teams, panels, allowManual: !!d.allowManual, penalties: d.penalties || {},
    categoryRules: normalizeCategoryRules(d.categoryRules),
  };
};

// ==========================================
// LIMIT SOUČTU D (pravidla pro kategorie)
// ==========================================
// Pravidlo kategorie: { dMax: 12.5, action: 'penalty' | 'move', moveTo: 'Název jiné kategorie' }
//  - 'penalty' = o kolik tým limit překročí, tolik se mu přičte do PEN SJ
//  - 'move'    = tým se ve výsledcích přesune do kategorie moveTo
const D_ACTIONS = { penalty: 'Odečíst překročení v PEN SJ', move: 'Přesunout do jiné kategorie' };

const normalizeCategoryRules = (rules = {}) => {
  const out = {};
  Object.entries(rules || {}).forEach(([cat, r]) => {
    const dMax = toNum(r?.dMax);
    if (dMax <= 0) return;
    const action = r.action === 'move' ? 'move' : 'penalty';
    out[cat] = { dMax, action, moveTo: action === 'move' ? String(r.moveTo || '').trim() : '' };
  });
  return out;
};

// Vyhodnotí limit D pro jeden tým. akr/tra = výsledky calculateScore (nebo null, pokud ještě nezávodil).
// Vrací: součet D, o kolik je limit překročen, srážku do PEN SJ a kategorii, ve které se tým má zobrazit.
const evaluateDLimit = (category, akr, tra, rule) => {
  const dSum = roundTo(toNum(akr?.d) + toNum(tra?.d), 3);
  const result = { dSum, dMax: rule?.dMax ?? null, excess: 0, dPenalty: 0, category, movedFrom: null };
  if (!rule || (!akr && !tra)) return result;
  const excess = roundTo(dSum - rule.dMax, 3);
  if (excess <= EPS) return result;
  result.excess = excess;
  if (rule.action === 'move' && rule.moveTo && rule.moveTo !== category) {
    result.category = rule.moveTo;
    result.movedFrom = category;
  } else {
    result.dPenalty = excess;
  }
  return result;
};

// ==========================================
// 3. HLAVNÍ KOMPONENTA APLIKACE
// ==========================================
export default function GymnasticsScoringApp() {
  // Přihlášení si pamatujeme v rámci záložky, aby obnovení stránky (F5) rozhodčího neodhlásilo
  const [role, setRole] = useState(() => session.get('tg_role'));
  const [isUnlocked, setIsUnlocked] = useState(() => !!session.get('tg_role'));
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [scores, setScores] = useState([]);
  const [requests, setRequests] = useState([]);
  const [config, setConfig] = useState({ loaded: false, teams: [], panels: makeDefaultPanels(), allowManual: false, penalties: {} });

  // Připojení k databázi a "naslouchání" změnám. Funkce vrácená na konci vše odpojí,
  // aby nevznikaly zdvojené posluchače.
  useEffect(() => {
    if (!db) { setErrorMsg('Chybí Firebase klíče v kódu!'); return undefined; }

    let unsubscribers = [];
    let cancelled = false;
    const onError = (err) => setErrorMsg('Chyba DB: ' + err.message);

    signInAnonymously(auth).then(() => {
      if (cancelled) return;
      setIsConnected(true);
      unsubscribers = [
        onSnapshot(collection(db, 'scores'), (snap) => setScores(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError),
        onSnapshot(collection(db, 'requests'), (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError),
        onSnapshot(configRef(), (snap) => setConfig(normalizeConfig(snap.exists() ? snap.data() : {})), onError),
      ];
    }).catch((err) => setErrorMsg('Chyba DB: ' + err.message));

    return () => { cancelled = true; unsubscribers.forEach((u) => u()); };
  }, []);

  const scoreMap = useMemo(() => buildScoreMap(scores), [scores]);

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole);
    setIsUnlocked(false);
    setPinInput('');
    setPinError(false);
  };

  const handlePinSubmit = (e) => {
    e.preventDefault();
    const ok = (role === 'admin' && pinInput === ADMIN_PASSWORD) || (role === 'judge' && pinInput === JUDGE_PASSWORD);
    if (ok) {
      setIsUnlocked(true);
      session.set('tg_role', role);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  const logout = () => {
    setRole(null);
    setIsUnlocked(false);
    session.set('tg_role', null);
  };

  // KROK 1: VÝBĚR ROLE
  if (!role) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-6">{COMPETITION.name}</h1>
          {errorMsg && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{errorMsg}</div>}
          <div className="space-y-4">
            <button onClick={() => handleRoleSelect('judge')} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors">Rozhodčí (Zadávání)</button>
            <button onClick={() => handleRoleSelect('admin')} className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium shadow-sm transition-colors">Administrátor</button>
          </div>
        </div>
      </div>
    );
  }

  // KROK 2: ZADÁNÍ HESLA
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full">
          <div className="flex justify-center mb-4 text-slate-400"><KeyRound size={48} /></div>
          <h2 className="text-xl font-bold text-slate-800 text-center mb-6">Přístup: {role === 'admin' ? 'Administrátor' : 'Rozhodčí'}</h2>
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Zadejte heslo (PIN)</label>
              <input
                type="password"
                autoFocus
                value={pinInput}
                onChange={(e) => { setPinInput(e.target.value); setPinError(false); }}
                className={`w-full p-3 border rounded-lg text-center tracking-widest font-mono text-lg outline-none focus:ring-2 focus:ring-blue-500 ${pinError ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'}`}
              />
              {pinError && <p className="text-red-500 text-xs mt-2 text-center font-medium">Nesprávné heslo. Zkuste to znovu.</p>}
            </div>
            <button type="submit" className={`w-full py-3 text-white rounded-lg font-bold shadow-sm transition-colors ${role === 'admin' ? 'bg-slate-800 hover:bg-slate-900' : 'bg-blue-600 hover:bg-blue-700'}`}>Odemknout</button>
          </form>
          <button onClick={() => setRole(null)} className="w-full mt-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline text-center">Zpět na výběr role</button>
        </div>
      </div>
    );
  }

  // KROK 3: HLAVNÍ APLIKACE
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <h1 className="text-xl md:text-2xl font-bold text-slate-800">TeamGym – {role === 'admin' ? 'Administrace' : 'Rozhodčí'}</h1>
          <div className="flex items-center gap-4">
            <span className={`flex items-center gap-1 text-xs font-medium ${isConnected ? 'text-emerald-600' : 'text-red-500'}`}>
              {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />} {isConnected ? 'Připojeno' : 'Nepřipojeno'}
            </span>
            <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1"><Lock size={16} /> Odhlásit se</button>
          </div>
        </div>

        {errorMsg && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-6 text-sm">{errorMsg}</div>}

        {!config.loaded ? (
          <div className="bg-white p-8 rounded-xl shadow-sm text-center text-slate-500">Načítám data závodu…</div>
        ) : role === 'judge' ? (
          <JudgePanel teams={config.teams} panels={config.panels} scoreMap={scoreMap} allowManual={config.allowManual} requests={requests} />
        ) : (
          <AdminPanel config={config} scores={scores} scoreMap={scoreMap} requests={requests} />
        )}
      </div>
    </div>
  );
}

// ==========================================
// 4. ROZHRANÍ PRO ROZHODČÍHO
// ==========================================
function PanelPicker({ panels, teams, scoreMap, onPick }) {
  return (
    <div className="bg-white p-8 rounded-xl shadow-sm max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-6 text-center">Vyberte svůj panel</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {panels.map((p) => {
          const { done, total } = panelProgress(p, teams, scoreMap);
          return (
            <button key={p.id} onClick={() => onPick(p.id)} className={`w-full p-4 text-white rounded-xl text-left shadow-sm transition-colors ${APPARATUS_STYLE[p.apparatus]?.button || 'bg-slate-700'}`}>
              <span className="block font-bold text-lg">{p.name}</span>
              <span className="block text-sm opacity-90">{p.apparatus} • {done}/{total} hotovo{p.eJudges === 3 ? ' • 3 rozhodčí E' : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JudgePanel({ teams, panels, scoreMap, allowManual, requests }) {
  // Vybraný panel si notebook pamatuje i po zavření prohlížeče
  const [panelId, setPanelIdState] = useState(() => local.get('tg_panel') || '');
  const [manualTeam, setManualTeam] = useState(''); // tým vybraný ručně mimo pořadí

  const setPanelId = (id) => {
    setPanelIdState(id);
    setManualTeam('');
    local.set('tg_panel', id || null);
  };

  const panel = panels.find((p) => p.id === panelId);
  if (!panel) return <PanelPicker panels={panels} teams={teams} scoreMap={scoreMap} onPick={setPanelId} />;

  const apparatus = panel.apparatus;

  // Žádost o odemčení se vztahuje ke konkrétnímu panelu a týmu
  const request = manualTeam ? requests.find((r) => r.panelId === panel.id && r.teamNumber === manualTeam) : null;
  const isRequestApproved = request?.status === 'approved';
  const isRequestPending = request?.status === 'pending';
  const canEditManual = allowManual || isRequestApproved;

  const currentTeam = manualTeam
    ? teams.find((t) => t.teamNumber === manualTeam) || null
    : nextTeamForPanel(panel, teams, scoreMap);
  const existingScore = currentTeam ? scoreMap.get(scoreKey(apparatus, currentTeam.teamNumber)) || null : null;
  // Oprava staré známky se počítá tak, jak byla zadána; nová známka podle nastavení panelu
  const eJudges = existingScore ? normalizeEJudges(existingScore.eJudges) : panel.eJudges;
  const showForm = currentTeam && (!manualTeam || canEditManual);
  const { done, total } = panelProgress(panel, teams, scoreMap);

  const inOrder = panelTeams(panel, teams);
  const others = panel.order.length ? teams.filter((t) => !panel.order.includes(t.teamNumber)) : [];
  const optionLabel = (t) => `${scoreMap.has(scoreKey(apparatus, t.teamNumber)) ? '✓ ' : ''}${t.teamNumber} – ${t.teamName}`;

  const handleRequestPermission = async () => {
    if (!currentTeam) return;
    try {
      // Pevné ID = opakované kliknutí nevytvoří víc žádostí
      await setDoc(doc(db, 'requests', sanitizeId(`${panel.id}_${currentTeam.teamNumber}`)), {
        panelId: panel.id,
        panelName: panel.name,
        teamNumber: currentTeam.teamNumber,
        teamName: currentTeam.teamName,
        apparatus,
        status: 'pending',
        timestamp: new Date().toISOString(),
      });
    } catch (err) { alert('Chyba při odesílání žádosti: ' + err.message); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Tmavá hlavička s panelem, aktuálním týmem a ručním výběrem */}
      <div className="bg-slate-800 text-white p-6 rounded-xl">
        <div className="flex justify-between items-start mb-4 gap-4">
          <div>
            <span className="text-slate-300 text-sm font-medium uppercase tracking-wider">
              {panel.name} • {done}/{total} hotovo{currentTeam ? ` • ${currentTeam.category}` : ''}
            </span>
            {panel.eJudges === 3 && <span className="ml-2 text-xs bg-amber-400 text-amber-950 font-bold px-2 py-0.5 rounded">3 rozhodčí E</span>}
            {currentTeam
              ? <h2 className="text-2xl font-bold mt-1">{currentTeam.teamNumber} – {currentTeam.teamName}</h2>
              : <h2 className="text-xl font-bold mt-1 text-green-400">Vše hotovo</h2>}
          </div>
          <button onClick={() => setPanelId('')} className="text-slate-300 hover:text-white underline text-sm whitespace-nowrap">Změnit panel</button>
        </div>

        <div className="pt-4 border-t border-slate-700 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-300 whitespace-nowrap">Přeskočit / Oprava:</span>
          <select value={manualTeam} onChange={(e) => setManualTeam(e.target.value)} className="w-full bg-slate-700 text-white border-slate-600 rounded p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">-- Automatické pořadí --</option>
            <optgroup label={panel.order.length ? 'Týmy tohoto panelu' : 'Všechny týmy'}>
              {inOrder.map((t) => <option key={t.teamNumber} value={t.teamNumber}>{optionLabel(t)}</option>)}
            </optgroup>
            {others.length > 0 && (
              <optgroup label="Ostatní týmy">
                {others.map((t) => <option key={t.teamNumber} value={t.teamNumber}>{optionLabel(t)}</option>)}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* Tým vybraný ručně, ale bez oprávnění */}
      {manualTeam && !canEditManual && (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100 text-center space-y-4">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-2"><Lock size={32} /></div>
          <h3 className="text-lg font-bold text-slate-800">Tým uzamčen (mimo pořadí)</h3>
          <p className="text-slate-500 text-sm mb-4">Pro úpravu známek týmu <b>{manualTeam}</b> potřebujete souhlas od administrátora.</p>
          {isRequestPending ? (
            <div className="bg-blue-50 text-blue-700 p-4 rounded-lg border border-blue-100 flex items-center justify-center gap-2 font-medium">
              <div className="animate-spin h-4 w-4 border-2 border-blue-700 border-t-transparent rounded-full"></div>
              Žádost odeslána. Čekejte na schválení administrátorem...
            </div>
          ) : (
            <button onClick={handleRequestPermission} className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-xl font-bold shadow-sm flex items-center gap-2 mx-auto">
              <Bell size={18} /> Požádat administrátora o odemčení
            </button>
          )}
        </div>
      )}

      {/* "key" zajistí, že se formulář pro každý tým vytvoří nově (a nepřepíše se rozepsaná data,
          když jiný panel mezitím uloží svou známku) */}
      {showForm && (
        <ScoreForm
          key={`${panel.id}|${currentTeam.teamNumber}|${existingScore?.id || 'new'}|${eJudges}`}
          team={currentTeam}
          panel={panel}
          eJudges={eJudges}
          existingScore={existingScore}
          approvedRequest={isRequestApproved ? request : null}
          onSaved={() => setManualTeam('')}
        />
      )}
    </div>
  );
}

function ScoreInput({ label, value, onChange, labelClass = 'text-slate-500', inputClass = 'border-slate-200 bg-slate-50 focus:ring-blue-500', readOnly = false, required = true }) {
  return (
    <div>
      <label className={`block text-sm font-bold uppercase mb-1 ${labelClass}`}>{label}</label>
      <input
        type="number" step="0.05" min="0" max="10" inputMode="decimal"
        required={required} readOnly={readOnly} value={value} onChange={onChange}
        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 ${readOnly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''} ${inputClass}`}
      />
    </div>
  );
}

function ScoreForm({ team, panel, eJudges, existingScore, approvedRequest, onSaved }) {
  const [formData, setFormData] = useState(() => {
    if (!existingScore) return { ...EMPTY_FORM };
    const f = {};
    SCORE_FIELDS.forEach((k) => { f[k] = existingScore[k] ?? EMPTY_FORM[k]; });
    return f;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const live = calculateScore({ ...formData, eJudges });
  const filled = (...fields) => fields.every((f) => formData[f] !== '');
  const eFilled = eJudges === 3 ? filled('e1', 'e2', 'e3') : filled('e1', 'e2', 'e3', 'e4');
  const bind = (field) => ({ value: formData[field], onChange: (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value })) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const scoreData = {
        ...formData,
        e4: eJudges === 3 ? live.e4Value.toFixed(1) : formData.e4,
        eJudges,
        category: team.category,
        teamNumber: team.teamNumber,
        teamName: team.teamName,
        apparatus: panel.apparatus,
        panelId: panel.id,
        panelName: panel.name,
        timestamp: new Date().toISOString(),
      };
      const id = existingScore ? existingScore.id : scoreDocId(panel.apparatus, team.teamNumber);
      await setDoc(doc(db, 'scores', id), scoreData);

      // Jednorázové povolení se po uložení spotřebuje
      if (approvedRequest) await deleteDoc(doc(db, 'requests', approvedRequest.id));
      onSaved();
    } catch (err) {
      alert('Chyba při odesílání: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const banner = approvedRequest
    ? { cls: 'bg-emerald-100 text-emerald-800', text: 'JEDNORÁZOVÉ POVOLENÍ: Administrátor odemkl tento tým' }
    : existingScore
      ? { cls: 'bg-yellow-100 text-yellow-800', text: 'REŽIM OPRAVY: Přepisujete starou známku' }
      : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <form onSubmit={handleSubmit} className="flex-1 w-full bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {banner && <div className={`text-center text-sm font-bold py-1 px-4 ${banner.cls}`}>{banner.text}</div>}

        <div className="p-6 md:p-8 space-y-8">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">
              Provedení (E){eJudges === 3 && <span className="ml-2 text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded align-middle">3 rozhodčí – E4 se dopočítá</span>}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ScoreInput label="e1" labelClass="text-blue-600" {...bind('e1')} />
              <ScoreInput label="e2" {...bind('e2')} />
              <ScoreInput label="e3" {...bind('e3')} />
              {eJudges === 3
                ? <ScoreInput label="e4 (průměr)" readOnly required={false} value={filled('e1', 'e2', 'e3') ? live.e4Value.toFixed(1) : ''} onChange={() => {}} />
                : <ScoreInput label="e4" {...bind('e4')} />}
            </div>
            {!live.eValid && eFilled && (
              <p className="text-red-500 text-sm mt-2 flex items-center gap-1 font-medium bg-red-50 p-2 rounded"><AlertTriangle size={16} /> Známky E nejsou v toleranci ({live.eTols.mid} / {live.eTols.all}). Je počítána Base známka.</p>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">Kompozice (C)</h3>
              <div className="grid grid-cols-2 gap-4">
                <ScoreInput label="c1" {...bind('c1')} />
                <ScoreInput label="c2" {...bind('c2')} />
              </div>
              {!live.cValid && filled('c1', 'c2') && <p className="text-red-500 text-xs mt-2 bg-red-50 p-1 rounded">Známky C nejsou v toleranci. Je počítána Base známka.</p>}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-3 border-b pb-2">Obtížnost (D)</h3>
              <div className="grid grid-cols-2 gap-4">
                <ScoreInput label="d1" {...bind('d1')} />
                <ScoreInput label="d2" {...bind('d2')} />
              </div>
              {!live.dValid && filled('d1', 'd2') && <p className="text-red-500 text-xs mt-2 bg-red-50 p-1 rounded">Známky D nejsou v toleranci. Je počítána Base známka.</p>}
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-6 items-end pt-4">
            <div className="w-full md:w-1/3">
              <ScoreInput label="Penalizace (PEN)" labelClass="text-red-500" inputClass="border-red-200 bg-red-50 focus:ring-red-500" {...bind('pen')} />
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full md:w-2/3 py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-xl font-bold shadow-sm transition-colors">
              {isSubmitting ? 'Odesílám...' : existingScore ? 'Uložit opravu a dál' : 'Odeslat známky a dál'}
            </button>
          </div>
        </div>
      </form>

      {/* Živý náhled přepočtu */}
      <div className="w-full lg:w-80 bg-white rounded-xl shadow-sm border border-slate-100 p-6 lg:sticky lg:top-6">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Živý přepočet</h3>
        <div className="space-y-4">
          <LiveRow label="Kompozice (C)" value={live.c} bad={!live.cValid && filled('c1', 'c2')} />
          <LiveRow label="Obtížnost (D)" value={live.d} bad={!live.dValid && filled('d1', 'd2')} />
          <LiveRow label="Provedení (E)" value={live.e} bad={!live.eValid && eFilled} />
          <div className="flex justify-between items-center pb-2 border-b text-red-500">
            <span className="font-medium">Penalizace</span>
            <span className="font-bold">-{live.pen}</span>
          </div>
          <div className="pt-2 bg-slate-50 p-4 rounded-lg border">
            <span className="block text-sm text-slate-500 font-medium mb-1">Výsledná známka:</span>
            <span className="block text-4xl font-black text-slate-800 tracking-tight">{live.total}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveRow({ label, value, bad }) {
  return (
    <div className="flex justify-between items-center pb-2 border-b">
      <span className="font-medium text-slate-600">{label}</span>
      <span className={`font-bold ${bad ? 'text-red-500' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

// ==========================================
// ROZVRŽENÍ KATEGORIÍ NA TIŠTĚNÉ STRÁNKY
// ==========================================
// Cíl: celá tabulka kategorie na jedné stránce (pokud se vejde) a zbylé volné místo na stránce
// vyplnit jinou, ještě nevytištěnou kategorií, která se tam celá vejde.
//
// items[i] = změřené výšky kategorie v px:
//   height   – celý blok (nadpis + tabulka)
//   headH    – nadpis + hlavička tabulky
//   theadH   – hlavička tabulky (opakuje se na každé stránce, když se kategorie rozdělí)
//   rows     – výšky jednotlivých řádků (týmů)
//   minStart – nadpis + hlavička + 3 řádky (nejmenší rozumný začátek rozdělené kategorie)
// cap = výška, kterou má jedna stránka pro obsah; gap = mezera mezi kategoriemi.
// Vrací pořadí tisku: [{ index, newPage, split }].
// POZOR: funkce se vkládá jako text do tiskového okna, nesmí tedy používat nic mimo sebe.
function planPages(items, cap, gap) {
  // Kategorie větší než celá stránka se musí rozdělit; spočítáme, kolik místa zabere na poslední stránce
  const simulateSplit = (it, start) => {
    let used = start + it.headH;
    it.rows.forEach((h, r) => {
      if (used + h <= cap) used += h;
      else if (r === 0) used = it.headH + h; // nadpis se nikdy neodtrhne od první řádky
      else used = it.theadH + h; // nová stránka začíná zopakovanou hlavičkou tabulky
    });
    return used;
  };

  const queue = items.map((_, i) => i);
  const plan = [];
  let used = 0; // kolik místa je na aktuální stránce už obsazeno
  while (queue.length) {
    const before = used > 0 ? gap : 0;
    const free = cap - used - before;

    // 1) První kategorie v pořadí, která se do volného místa vejde celá
    let pos = queue.findIndex((i) => items[i].height <= free);
    if (pos >= 0) {
      const i = queue.splice(pos, 1)[0];
      plan.push({ index: i, newPage: used === 0 && plan.length > 0, split: false });
      used += before + items[i].height;
      continue;
    }

    // 2) Nic se nevejde celé: kategorie delší než stránka může začít tady a pokračovat dál
    pos = queue.findIndex((i) => items[i].height > cap);
    if (pos >= 0 && (used === 0 || items[queue[pos]].minStart <= free)) {
      const i = queue.splice(pos, 1)[0];
      plan.push({ index: i, newPage: used === 0 && plan.length > 0, split: true });
      used = simulateSplit(items[i], used + before);
      continue;
    }

    // 3) Jinak začneme novou stránku
    used = 0;
  }
  return plan;
}

// Běží v tiskovém okně: změří kategorie, rozvrhne je pomocí planPages a přeskládá je.
// POZOR: také se vkládá jako text, nesmí používat nic mimo sebe (planPages dostane jako parametr).
function arrangeCategories(plan) {
  const box = document.getElementById('categories');
  if (!box || box.children.length === 0) return;
  const blocks = Array.from(box.children);
  const h = (el) => el.getBoundingClientRect().height;
  const cssPx = (value) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:' + value;
    document.body.appendChild(probe);
    const px = h(probe);
    probe.remove();
    return px;
  };

  // A4 na šířku = 210 mm, okraje 2 × 10 mm → 190 mm; odečteme místo pro hlavičku, patičku a rezervu
  const cap = cssPx('190mm') - h(document.querySelector('.header-space')) - h(document.querySelector('.footer-space')) - 15;
  const gap = parseFloat(getComputedStyle(blocks[0]).marginBottom) || 0;

  const items = blocks.map((el) => {
    const table = el.querySelector('table');
    const thead = table.querySelector('thead');
    const rows = Array.from(table.querySelectorAll('tbody > tr')).map(h);
    const headH = table.getBoundingClientRect().top - el.getBoundingClientRect().top + h(thead);
    return { height: h(el), headH, theadH: h(thead), rows, minStart: headH + rows.slice(0, 3).reduce((a, b) => a + b, 0) };
  });

  plan(items, cap, gap).forEach((p) => {
    const el = blocks[p.index];
    el.style.breakBefore = p.newPage ? 'page' : 'auto';
    if (p.split) el.classList.add('split');
    box.appendChild(el); // přesune blok na konec → výsledné pořadí podle plánu
  });
}

// ==========================================
// TISKOVÁ SESTAVA VÝSLEDKŮ
// ==========================================
// Hlavička a patička jsou "position: fixed" – prohlížeč je při tisku zopakuje na každé stránce.
// Aby nepřekryly obsah, je celý obsah uvnitř pomocné tabulky, jejíž prázdný <thead>/<tfoot>
// (taky opakovaný na každé stránce) drží pro hlavičku a patičku volné místo.
const buildResultsPrintHtml = ({ categories, panels, final, baseUrl, printedAt }) => {
  const red = 'color: #ef4444;';
  const eCell = (s) => `<td style="${s && !s.eValid ? red + ' font-weight: bold;' : ''}">${cz(s?.e)}</td>`;
  const appCells = (s) => `<td>${cz(s?.c)}</td><td>${cz(s?.d)}</td>${eCell(s)}<td style="${red}">${cz(s?.pen)}</td><td class="total-col">${cz(s?.total)}</td>`;
  const time = printedAt.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const title = final ? 'Konečné výsledky' : `Průběžné výsledky – stav k ${time}`;

  const categoryHtml = categories.map(([category, list]) => `
    <div class="category-block">
      <div class="category-title">${escapeHtml(category)}</div>
      <table class="results">
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
          ${list.map((t) => `<tr>
            <td class="rank">${t.rank}</td>
            <td>${escapeHtml(t.teamNumber)}</td>
            <td class="team-name">${escapeHtml(t.teamName)}${t.dLimit.movedFrom ? `<br><span class="note">(přesunuto z kat. ${escapeHtml(t.dLimit.movedFrom)})</span>` : ''}</td>
            ${appCells(t.Akrobacie)}
            ${appCells(t.Trampolína)}
            <td style="${red}">${t.penSJ > 0 ? cz(fmt3(t.penSJ)) : ''}</td>
            <td class="final-total">${cz(t.finalTotal)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  // Poslední strana finálních výsledků: seznam rozhodčích E1 podle panelů
  const judgePanels = panels.filter((p) => p.e1Judge);
  const judgesHtml = final ? `
    <div class="judges-page">
      <div class="category-title">Rozhodčí E1</div>
      ${judgePanels.length ? `
        <table class="results judges">
          <thead><tr><th class="team-name">Panel</th><th style="width: 120px;">Nářadí</th><th class="team-name">Rozhodčí E1</th></tr></thead>
          <tbody>
            ${judgePanels.map((p) => `<tr><td class="team-name">${escapeHtml(p.name)}</td><td>${escapeHtml(p.apparatus)}</td><td class="team-name">${escapeHtml(p.e1Judge)}</td></tr>`).join('')}
          </tbody>
        </table>` : '<p>Rozhodčí E1 nebyli zadáni.</p>'}
    </div>` : '';

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>${escapeHtml(title)} – ${escapeHtml(COMPETITION.name)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

      .page-header { position: fixed; top: 0; left: 0; right: 0; height: 80px; background: white; display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; box-sizing: border-box; padding-bottom: 8px; }
      .page-header .left { display: flex; align-items: center; gap: 20px; }
      .page-header img { height: 60px; object-fit: contain; }
      .page-header h1 { margin: 0; font-size: 22px; color: #1e3a8a; text-transform: uppercase; }
      .page-header h2 { margin: 0; font-size: 14px; color: #64748b; font-weight: normal; }
      .page-header .doc-title { font-size: 16px; font-weight: bold; color: #1e3a8a; text-align: right; }
      .page-footer { position: fixed; bottom: 0; left: 0; right: 0; height: 30px; background: white; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; font-weight: bold; color: #1e3a8a; border-top: 1px solid #cbd5e1; box-sizing: border-box; padding-top: 6px; }
      .header-space { height: 95px; }
      .footer-space { height: 40px; }

      table.layout { width: 100%; border-collapse: collapse; }
      table.layout > thead > tr > td, table.layout > tfoot > tr > td, table.layout > tbody > tr > td { border: none; padding: 0; }

      @media screen { body { width: 277mm; margin: 0 auto; } } /* stejná šířka jako tištěná stránka, aby sedělo měření */
      .category-block { margin-bottom: 30px; break-inside: avoid; page-break-inside: avoid; }
      .category-block.split { break-inside: auto; page-break-inside: auto; }
      .category-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; }
      table.results { width: 100%; border-collapse: collapse; font-size: 11px; }
      table.results tr { break-inside: avoid; page-break-inside: avoid; }
      table.results th, table.results td { border: 1px solid #cbd5e1; padding: 5px 4px; text-align: center; }
      table.results th { background-color: #f1f5f9; font-weight: bold; color: #334155; }
      .apparatus-header { background-color: #e2e8f0 !important; letter-spacing: 0.5px; text-transform: uppercase; }
      .team-name { text-align: left !important; font-weight: bold; padding-left: 8px !important; font-size: 12px; }
      .note { font-weight: normal; font-size: 10px; color: #64748b; }
      .total-col { font-weight: bold; background-color: #f8fafc; }
      .final-total { font-weight: bold; background-color: #e0e7ff !important; font-size: 12px; color: #1e3a8a; }
      .rank { font-weight: bold; font-size: 14px; background-color: #1e3a8a; color: white; }
      .judges-page { break-before: page; page-break-before: always; }
      table.judges { font-size: 13px; max-width: 800px; }
      table.judges td { padding: 8px; }
    </style></head><body>
    <div class="page-header">
      <div class="left">
        <img src="${baseUrl}/logo-klub.png" alt="Logo klubu">
        <div><h1>${escapeHtml(COMPETITION.name)}</h1><h2>${escapeHtml(COMPETITION.date)}</h2></div>
      </div>
      <div class="left">
        <div class="doc-title">${escapeHtml(title)}</div>
        <img src="${baseUrl}/logo-praha.png" alt="Praha">
      </div>
    </div>
    <div class="page-footer">
      <div>Ředitelka závodu: ${escapeHtml(COMPETITION.director)}</div>
      <div>Hlavní rozhodčí: ${escapeHtml(COMPETITION.headJudge)}</div>
    </div>
    <table class="layout">
      <thead><tr><td><div class="header-space"></div></td></tr></thead>
      <tfoot><tr><td><div class="footer-space"></div></td></tr></tfoot>
      <tbody><tr><td><div id="categories">${categoryHtml}</div>${judgesHtml}</td></tr></tbody>
    </table>
    <script>
      window.onload = function () {
        try { (${arrangeCategories.toString()})(${planPages.toString()}); } catch (e) { console.error(e); }
        setTimeout(function () { window.print(); }, 500);
      };
    </script>
  </body></html>`;
};

// ==========================================
// 5. ROZHRANÍ PRO ADMINISTRÁTORA
// ==========================================
function AdminPanel({ config, scores, scoreMap, requests }) {
  const { teams, panels, allowManual, penalties, categoryRules } = config;
  const [activeTab, setActiveTab] = useState('results');
  const [hiddenCategories, setHiddenCategories] = useState({});

  // Výpočet výsledků: každý tým, obě nářadí, limit D, srážka SJ, pořadí v kategorii
  const groupedResults = useMemo(() => {
    const grouped = {};
    // Kategorie založíme v pořadí ze seznamu týmů, aby se nepřeházely kvůli přesunům
    teams.forEach((team) => { grouped[team.category] ||= []; });
    teams.forEach((team) => {
      const akrScore = scoreMap.get(scoreKey('Akrobacie', team.teamNumber));
      const traScore = scoreMap.get(scoreKey('Trampolína', team.teamNumber));
      const Akrobacie = akrScore ? calculateScore(akrScore) : null;
      const Trampolína = traScore ? calculateScore(traScore) : null;
      const dLimit = evaluateDLimit(team.category, Akrobacie, Trampolína, categoryRules[team.category]);
      const penSJManual = toNum(penalties[team.teamNumber]); // srážka zadaná ručně adminem
      const penSJ = roundTo(penSJManual + dLimit.dPenalty, 3); // + automatická srážka za překročení D
      const finalNum = roundTo((Akrobacie?.totalNum || 0) + (Trampolína?.totalNum || 0) - penSJ, 3);
      (grouped[dLimit.category] ||= []).push({
        ...team, Akrobacie, Trampolína, dLimit, penSJManual, penSJ, finalNum, finalTotal: fmt3(finalNum),
      });
    });
    Object.keys(grouped).forEach((cat) => { if (grouped[cat].length === 0) delete grouped[cat]; });
    Object.values(grouped).forEach((list) => {
      list.sort((a, b) => b.finalNum - a.finalNum);
      // Stejný součet = stejné pořadí (1., 2., 2., 4. …)
      list.forEach((r, i) => { r.rank = i > 0 && r.finalNum === list[i - 1].finalNum ? list[i - 1].rank : i + 1; });
    });
    return grouped;
  }, [teams, scoreMap, penalties, categoryRules]);

  const editPenSJ = async (teamNumber, currentPen) => {
    const val = prompt(`Zadejte ruční srážku hlavního rozhodčího (PEN SJ) pro tým ${teamNumber}.\n(Případná automatická srážka za překročení limitu D se přičte sama.)`, currentPen || 0);
    if (val === null) return;
    const numVal = Number(val.replace(',', '.'));
    if (Number.isNaN(numVal) || numVal < 0) { alert('Neplatné číslo.'); return; }
    try {
      // merge zapíše jen tento jeden tým a nepřepíše srážky ostatních
      await setDoc(configRef(), { penalties: { [teamNumber]: numVal } }, { merge: true });
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  const handleRequestAction = async (requestId, action) => {
    try {
      if (action === 'approve') await updateDoc(doc(db, 'requests', requestId), { status: 'approved' });
      else await deleteDoc(doc(db, 'requests', requestId));
    } catch (e) { alert('Chyba: ' + e.message); }
  };

  const toggleManual = async () => {
    try { await setDoc(configRef(), { allowManual: !allowManual }, { merge: true }); } catch (e) { alert('Chyba: ' + e.message); }
  };

  const toggleCategory = (cat) => setHiddenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  const visibleCategories = Object.entries(groupedResults).filter(([cat]) => !hiddenCategories[cat]);
  const pendingRequests = requests.filter((r) => r.status === 'pending');

  const exportAllCSV = () => {
    const q = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    let content = '﻿';
    visibleCategories.forEach(([cat, list]) => {
      content += `KATEGORIE:;${q(cat)}\n`;
      content += ['Pořadí', 'Číslo', 'Družstvo', 'Akr C', 'Akr D', 'Akr E', 'Akr PEN', 'Akr Celkem', 'Tra C', 'Tra D', 'Tra E', 'Tra PEN', 'Tra Celkem', 'PEN SJ', 'Výsledek'].join(';') + '\n';
      list.forEach((t) => {
        const a = t.Akrobacie, tr = t.Trampolína;
        content += [
          t.rank, t.teamNumber, q(t.teamName),
          cz(a?.c), cz(a?.d), cz(a?.e), cz(a?.pen), cz(a?.total),
          cz(tr?.c), cz(tr?.d), cz(tr?.e), cz(tr?.pen), cz(tr?.total),
          cz(fmt3(t.penSJ)), cz(t.finalTotal),
        ].join(';') + '\n';
      });
      content += '\n';
    });
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Vysledky_TeamGym.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const printResults = (final) => {
    if (visibleCategories.length === 0) { alert('Vyberte alespoň jednu kategorii k tisku.'); return; }

    if (final) {
      // Před finálním tiskem upozorníme na chybějící známky a nevyplněné rozhodčí E1
      const missing = visibleCategories.flatMap(([, list]) => list)
        .filter((t) => !t.Akrobacie || !t.Trampolína).map((t) => t.teamNumber);
      const problems = [];
      if (missing.length) problems.push(`Týmy bez kompletních známek: ${missing.join(', ')}`);
      if (!panels.some((p) => p.e1Judge)) problems.push('Nejsou vyplnění žádní rozhodčí E1 (Nastavení závodu → panely)');
      if (problems.length && !window.confirm(`${problems.join('\n')}\n\nPřesto vytisknout finální výsledky?`)) return;
    }

    const html = buildResultsPrintHtml({
      categories: visibleCategories, panels, final, baseUrl: window.location.origin, printedAt: new Date(),
    });
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      alert('Prohlížeč zablokoval vyskakovací okno. Povolte vyskakovací okna (pop-ups) pro tuto stránku.');
    }
  };

  const tabClass = (tab) => `px-4 py-2 font-medium text-sm rounded-lg transition-colors whitespace-nowrap ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200'}`;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      {pendingRequests.length > 0 && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-4">
          <h3 className="font-bold text-yellow-800 flex items-center gap-2 mb-3"><Bell size={18} /> Nové žádosti o odemčení týmů</h3>
          <div className="space-y-2">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex flex-wrap gap-2 justify-between items-center bg-white p-3 rounded shadow-sm border border-yellow-100">
                <div>
                  <span className="text-sm font-bold text-slate-700">{req.panelName || req.apparatus}</span>
                  <span className="text-sm text-slate-600 mx-2">chce upravit tým</span>
                  <span className="text-sm font-bold text-indigo-600">{req.teamNumber} ({req.teamName})</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRequestAction(req.id, 'reject')} className="px-3 py-1 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-700 rounded text-sm font-medium flex items-center gap-1 transition-colors"><X size={16} /> Zamítnout</button>
                  <button onClick={() => handleRequestAction(req.id, 'approve')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium flex items-center gap-1 shadow-sm transition-colors"><Check size={16} /> Povolit úpravu</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stav jednotlivých panelů */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b bg-white">
        {panels.map((p) => {
          const { done, total } = panelProgress(p, teams, scoreMap);
          const next = nextTeamForPanel(p, teams, scoreMap);
          const st = APPARATUS_STYLE[p.apparatus] || {};
          return (
            <div key={p.id} className={`p-3 rounded-lg border ${st.border} ${st.soft}`}>
              <div className={`text-sm font-bold ${st.text}`}>{p.name}{p.eJudges === 3 && <span className="ml-1 text-[10px] bg-amber-200 text-amber-900 px-1 rounded">3 E</span>}</div>
              <div className="text-xs text-slate-600 mt-1">{done}/{total} hotovo • {next ? `na řadě: ${next.teamNumber} – ${next.teamName}` : 'dokončeno'}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center px-6 py-3 bg-slate-50 border-b gap-4">
        <div className="flex gap-2 overflow-x-auto w-full">
          <button onClick={() => setActiveTab('results')} className={tabClass('results')}>Výsledky</button>
          <button onClick={() => setActiveTab('raw')} className={tabClass('raw')}>Editace dat</button>
          <button onClick={() => setActiveTab('config')} className={tabClass('config')}>Nastavení závodu</button>
        </div>
        <button onClick={toggleManual} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shadow-sm border ${allowManual ? 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
          {allowManual ? <Unlock size={14} /> : <Lock size={14} />}
          {allowManual ? 'GLOBÁLNÍ PŘESKAKOVÁNÍ POVOLENO' : 'GLOBÁLNÍ PŘESKAKOVÁNÍ UZAMČENO'}
        </button>
      </div>

      <div className="p-6">
        {activeTab === 'results' && (
          <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h2 className="text-xl font-bold text-slate-800">Průběžné výsledky</h2>
              <div className="flex flex-wrap gap-3">
                <button onClick={exportAllCSV} className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors"><Download size={16} /> Export (CSV)</button>
                <button onClick={() => printResults(false)} className="bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors"><Printer size={18} /> Tisk průběžných výsledků</button>
                <button onClick={() => printResults(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors"><Printer size={18} /> Tisk finálních výsledků</button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="block text-sm font-bold text-slate-700">Viditelné kategorie k tisku:</span>
                <div className="flex gap-2">
                  <button onClick={() => setHiddenCategories({})} className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1 rounded shadow-sm">Zobrazit vše</button>
                  <button onClick={() => setHiddenCategories(Object.fromEntries(Object.keys(groupedResults).map((c) => [c, true])))} className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1 rounded shadow-sm">Skrýt vše</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {Object.keys(groupedResults).map((cat) => (
                  <label key={cat} className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                    <input type="checkbox" checked={!hiddenCategories[cat]} onChange={() => toggleCategory(cat)} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-slate-600">{cat}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-12">
              {visibleCategories.map(([category, list]) => (
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
                          <th className="p-3 border-b border-r text-center">PEN SJ</th>
                          <th className="p-3 border-b text-center">Celkem</th>
                        </tr>
                        <tr className="bg-slate-100 text-[10px] text-slate-500">
                          <th className="border-b border-r"></th><th className="border-b border-r"></th><th className="border-b border-r"></th>
                          <th className="p-2 border-b">C</th><th className="p-2 border-b">D</th><th className="p-2 border-b">E</th><th className="p-2 border-b text-red-500">PEN</th><th className="p-2 border-b border-r font-bold">SUM</th>
                          <th className="p-2 border-b">C</th><th className="p-2 border-b">D</th><th className="p-2 border-b">E</th><th className="p-2 border-b text-red-500">PEN</th><th className="p-2 border-b border-r font-bold">SUM</th>
                          <th className="border-b border-r"></th><th className="border-b"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((t) => (
                          <tr key={t.teamNumber} className="border-b hover:bg-slate-50">
                            <td className="p-3 border-r font-bold text-center">{t.rank}.</td>
                            <td className="p-3 border-r text-slate-500">{t.teamNumber}</td>
                            <td className="p-3 border-r font-medium text-slate-800">
                              {t.teamName}
                              <DLimitInfo d={t.dLimit} />
                            </td>
                            <ApparatusCells s={t.Akrobacie} sumClass="bg-indigo-50/40" />
                            <ApparatusCells s={t.Trampolína} sumClass="bg-orange-50/40" />
                            <td
                              className="p-2 text-center text-red-600 font-bold bg-red-50/30 border-r cursor-pointer hover:bg-red-100 transition-colors"
                              onClick={() => editPenSJ(t.teamNumber, t.penSJManual)}
                              title="Kliknutím upravte ruční srážku SJ"
                            >
                              {t.penSJ > 0 ? fmt3(t.penSJ) : '-'}
                              {t.dLimit.dPenalty > 0 && <span className="block text-[10px] font-medium text-amber-700">vč. limitu D {fmt3(t.dLimit.dPenalty)}</span>}
                            </td>
                            <td className="p-3 text-center font-black text-lg text-slate-800 bg-slate-50">{t.finalTotal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'raw' && <RawScoresEditor scores={scores} />}
        {activeTab === 'config' && <StartListConfig teams={teams} panels={panels} categoryRules={categoryRules} />}
      </div>
    </div>
  );
}

// Malý řádek pod názvem týmu: součet D vůči limitu kategorie, případně informace o přesunu
function DLimitInfo({ d }) {
  if (d.dMax === null && !d.movedFrom) return null;
  const over = d.excess > 0;
  return (
    <span className={`block text-[11px] font-normal ${over ? 'text-amber-700' : 'text-slate-400'}`}>
      {d.movedFrom
        ? `Přesunuto z kat. ${d.movedFrom} – ΣD ${fmt3(d.dSum)} > ${fmt3(d.dMax)}`
        : `ΣD ${fmt3(d.dSum)} / limit ${fmt3(d.dMax)}${over ? ` – překročeno o ${fmt3(d.excess)}` : ''}`}
    </span>
  );
}

function ApparatusCells({ s, sumClass }) {
  return (
    <>
      <td className="p-2 text-center text-slate-500">{s?.c || '-'}</td>
      <td className="p-2 text-center text-slate-500">{s?.d || '-'}</td>
      <td className={`p-2 text-center ${s && !s.eValid ? 'text-red-500 font-bold bg-red-50' : 'text-slate-500'}`} title={s?.eJudges === 3 ? '3 rozhodčí E' : undefined}>
        {s?.e || '-'}{s?.eJudges === 3 && <sup className="text-amber-600 ml-0.5">3</sup>}
      </td>
      <td className="p-2 text-center text-red-500 font-medium">{s?.pen || '-'}</td>
      <td className={`p-2 text-center font-bold border-r ${sumClass}`}>{s?.total || '-'}</td>
    </>
  );
}

// ==========================================
// POHLED ADMINISTRÁTORA: Nastavení závodu
// ==========================================
function StartListConfig({ teams, panels, categoryRules }) {
  const [inputText, setInputText] = useState(() => teams.map((t) => `${t.category};${t.teamNumber};${t.teamName}`).join('\n'));
  const [draftPanels, setDraftPanels] = useState(() => panels.map((p) => ({ ...p, orderText: p.order.join(', ') })));
  // Rozpracovaná pravidla limitu D: { [kategorie]: { enabled, dMaxText, action, moveTo } }
  const [draftRules, setDraftRules] = useState(() => Object.fromEntries(Object.entries(categoryRules).map(([cat, r]) => [
    cat, { enabled: true, dMaxText: String(r.dMax).replace('.', ','), action: r.action, moveTo: r.moveTo },
  ])));
  const [isSaving, setIsSaving] = useState(false);

  const parsedTeams = useMemo(() => inputText
    .split('\n')
    .map((line) => line.split(';').map((s) => s.trim()))
    .map(([category, teamNumber, teamName]) => ({ category, teamNumber, teamName }))
    .filter((t) => t.category && t.teamNumber && t.teamName), [inputText]);

  const categories = useMemo(() => [...new Set(parsedTeams.map((t) => t.category))], [parsedTeams]);
  const ruleFor = (cat) => draftRules[cat] || { enabled: false, dMaxText: '', action: 'penalty', moveTo: '' };
  const updateRule = (cat, patch) => setDraftRules((prev) => ({ ...prev, [cat]: { ...ruleFor(cat), ...patch } }));

  // Z rozpracovaných pravidel vytvoří to, co se uloží (jen zapnutá pravidla existujících kategorií)
  const buildRules = () => {
    const out = {};
    const errors = [];
    categories.forEach((cat) => {
      const r = ruleFor(cat);
      if (!r.enabled) return;
      const dMax = toNum(r.dMaxText);
      if (dMax <= 0) { errors.push(`${cat}: zadejte platný limit D`); return; }
      if (r.action === 'move' && (!r.moveTo.trim() || r.moveTo.trim() === cat)) { errors.push(`${cat}: zadejte kategorii, do které se tým přesune`); return; }
      out[cat] = { dMax, action: r.action, moveTo: r.action === 'move' ? r.moveTo.trim() : '' };
    });
    return { rules: out, errors };
  };

  const updatePanel = (id, patch) => setDraftPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removePanel = (id) => {
    if (window.confirm('Opravdu odebrat tento panel? Již zadané známky zůstanou zachované.')) {
      setDraftPanels((prev) => prev.filter((p) => p.id !== id));
    }
  };
  const addPanel = () => setDraftPanels((prev) => [
    ...prev,
    { id: `p${Date.now()}`, name: `Panel ${prev.length + 1}`, apparatus: 'Akrobacie', eJudges: 4, orderText: '' },
  ]);

  // Kontrola nastavení: neexistující týmy, tým ve dvou panelech stejného nářadí, tým bez panelu
  const warnings = useMemo(() => {
    const list = [];
    const known = new Set(parsedTeams.map((t) => t.teamNumber));
    const dupNumbers = parsedTeams.map((t) => t.teamNumber).filter((n, i, arr) => arr.indexOf(n) !== i);
    if (dupNumbers.length) list.push(`Duplicitní čísla týmů: ${[...new Set(dupNumbers)].join(', ')}`);

    draftPanels.forEach((p) => {
      const unknown = parseOrder(p.orderText).filter((n) => !known.has(n));
      if (unknown.length) list.push(`${p.name}: týmy ${unknown.join(', ')} nejsou v seznamu týmů`);
    });

    APPARATUS.forEach((app) => {
      const appPanels = draftPanels.filter((p) => p.apparatus === app);
      if (appPanels.length === 0) { list.push(`Pro nářadí ${app} neexistuje žádný panel`); return; }
      const owner = {};
      appPanels.forEach((p) => parseOrder(p.orderText).forEach((n) => { (owner[n] ||= []).push(p.name); }));
      Object.entries(owner).filter(([, names]) => names.length > 1)
        .forEach(([n, names]) => list.push(`${app}: tým ${n} je ve více panelech (${names.join(', ')})`));
      if (appPanels.every((p) => parseOrder(p.orderText).length > 0)) {
        const missing = parsedTeams.filter((t) => !owner[t.teamNumber]).map((t) => t.teamNumber);
        if (missing.length) list.push(`${app}: týmy ${missing.join(', ')} nemají přiřazený žádný panel`);
      }
    });
    return list;
  }, [parsedTeams, draftPanels]);

  const save = async () => {
    if (parsedTeams.length === 0) { alert('Nenalezeny žádné týmy.'); return; }
    if (draftPanels.length === 0) { alert('Musí existovat alespoň jeden panel.'); return; }
    if (draftPanels.some((p) => !p.name.trim())) { alert('Každý panel musí mít název.'); return; }
    const { rules, errors } = buildRules();
    if (errors.length) { alert(`Opravte limity D:\n\n• ${errors.join('\n• ')}`); return; }
    if (warnings.length && !window.confirm(`Nastavení obsahuje upozornění:\n\n• ${warnings.join('\n• ')}\n\nPřesto uložit?`)) return;

    setIsSaving(true);
    try {
      const newPanels = draftPanels.map((p) => ({
        id: p.id, name: p.name.trim(), apparatus: p.apparatus, eJudges: normalizeEJudges(p.eJudges), order: parseOrder(p.orderText),
        e1Judge: String(p.e1Judge || '').trim(),
      }));
      await setDoc(configRef(), { teams: parsedTeams, panels: newPanels }, { merge: true });
      // updateDoc přepíše pravidla celá (setDoc s merge by smazaná pravidla v databázi nechal)
      await updateDoc(configRef(), { categoryRules: rules });
      alert('Uloženo!');
    } catch (e) { alert('Chyba: ' + e.message); }
    setIsSaving(false);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">1. Seznam týmů <span className="text-sm font-normal text-slate-500">({parsedTeams.length})</span></h2>
        <p className="text-xs text-slate-500 mb-2">Jeden tým na řádek ve tvaru <code>Kategorie;Číslo;Název</code></p>
        <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} className="w-full h-[400px] p-4 border rounded-lg bg-slate-50 text-sm font-mono" placeholder="Kategorie;Číslo;Název" />

        <h2 className="text-lg font-bold text-slate-800 mt-8 mb-2">3. Limit součtu D</h2>
        <p className="text-xs text-slate-500 mb-4">Součet D z akrobacie a trampolíny nesmí překročit limit. Zapněte jen u kategorií, kde je to potřeba.</p>
        <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="space-y-2">
          {categories.length === 0 && <p className="text-sm text-slate-400">Nejdřív zadejte týmy.</p>}
          {categories.map((cat) => {
            const r = ruleFor(cat);
            return (
              <div key={cat} className={`p-3 rounded-lg border ${r.enabled ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(cat, { enabled: e.target.checked })} className="w-4 h-4" />
                  {cat}
                </label>
                {r.enabled && (
                  <div className="flex flex-wrap gap-2 items-center mt-2 text-sm">
                    <span className="text-slate-600">Max. ΣD</span>
                    <input value={r.dMaxText} onChange={(e) => updateRule(cat, { dMaxText: e.target.value })} inputMode="decimal" className="w-20 p-1.5 border rounded bg-white text-center" placeholder="12,0" />
                    <select value={r.action} onChange={(e) => updateRule(cat, { action: e.target.value })} className="p-1.5 border rounded bg-white">
                      {Object.entries(D_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    {r.action === 'move' && (
                      <input value={r.moveTo} onChange={(e) => updateRule(cat, { moveTo: e.target.value })} list="category-list" className="flex-1 min-w-[140px] p-1.5 border rounded bg-white" placeholder="Cílová kategorie" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold text-slate-800">2. Panely rozhodčích a pořadí</h2>
          <button onClick={addPanel} className="text-sm bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1 rounded shadow-sm flex items-center gap-1"><Plus size={14} /> Přidat panel</button>
        </div>
        <p className="text-xs text-slate-500 mb-4">Každý panel hodnotí jedno nářadí a týmy ve svém pořadí (čísla oddělená čárkou). Panel bez pořadí hodnotí všechny týmy.</p>

        <div className="space-y-4 mb-6">
          {draftPanels.map((p) => {
            const st = APPARATUS_STYLE[p.apparatus] || {};
            return (
              <div key={p.id} className={`p-4 rounded-xl border ${st.border} ${st.soft}`}>
                <div className="flex flex-wrap gap-2 items-center mb-3">
                  <input value={p.name} onChange={(e) => updatePanel(p.id, { name: e.target.value })} className="flex-1 min-w-[160px] p-2 border rounded bg-white text-sm font-bold" placeholder="Název panelu" />
                  <select value={p.apparatus} onChange={(e) => updatePanel(p.id, { apparatus: e.target.value })} className="p-2 border rounded bg-white text-sm">
                    {APPARATUS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <button onClick={() => removePanel(p.id)} className="p-2 text-slate-400 hover:text-red-600" title="Odebrat panel"><Trash2 size={16} /></button>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 mb-3 cursor-pointer">
                  <input type="checkbox" checked={p.eJudges === 3} onChange={(e) => updatePanel(p.id, { eJudges: e.target.checked ? 3 : 4 })} className="w-4 h-4" />
                  Pouze 3 rozhodčí E <span className="text-xs text-slate-500">(E4 = průměr E1–E3 zaokrouhlený na 0,1)</span>
                </label>
                <input value={p.e1Judge || ''} onChange={(e) => updatePanel(p.id, { e1Judge: e.target.value })} className="w-full p-2 border rounded bg-white text-sm mb-3" placeholder="Rozhodčí E1 (více jmen oddělte čárkou)" />

                <textarea value={p.orderText} onChange={(e) => updatePanel(p.id, { orderText: e.target.value })} className="w-full h-16 p-2 border rounded bg-white text-sm font-mono" placeholder="Pořadí: 1, 3, 5..." />
              </div>
            );
          })}
        </div>

        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 mb-4 text-sm">
            <div className="font-bold flex items-center gap-1 mb-1"><AlertTriangle size={16} /> Upozornění</div>
            <ul className="list-disc ml-5 space-y-0.5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <button onClick={save} disabled={isSaving} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-6 py-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-sm transition-colors">
          <Save size={20} /> {isSaving ? 'Ukládám…' : 'Uložit nastavení závodu'}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// POHLED ADMINISTRÁTORA: Úprava surových dat
// ==========================================
function RawScoresEditor({ scores }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Nejnovější známka nahoře (podle času uložení; známky bez času jsou na konci)
  const sorted = useMemo(() => [...scores].sort((a, b) =>
    String(b.timestamp || '').localeCompare(String(a.timestamp || ''))), [scores]);

  const startEdit = (score) => {
    setEditingId(score.id);
    const f = { eJudges: normalizeEJudges(score.eJudges) };
    SCORE_FIELDS.forEach((k) => { f[k] = score[k] ?? EMPTY_FORM[k]; });
    setEditForm(f);
  };

  const saveEdit = async () => {
    try {
      const data = { ...editForm };
      if (data.eJudges === 3) data.e4 = computeE4(toNum(data.e1), toNum(data.e2), toNum(data.e3)).toFixed(1);
      await updateDoc(doc(db, 'scores', editingId), data);
      setEditingId(null);
    } catch (e) { alert('Chyba při ukládání: ' + e.message); }
  };

  const removeScore = async (s) => {
    if (!window.confirm(`Smazat známku týmu ${s.teamNumber} (${s.apparatus})? Tuto akci nelze vrátit.`)) return;
    try { await deleteDoc(doc(db, 'scores', s.id)); } catch (e) { alert('Chyba: ' + e.message); }
  };

  if (scores.length === 0) return <p className="text-slate-500">Zatím nejsou zadané žádné známky.</p>;

  return (
    <div className="overflow-x-auto border rounded-xl">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="bg-slate-800 text-white text-xs uppercase">
          <tr>
            <th className="p-3">Nářadí / panel</th><th className="p-3 border-r border-slate-700">Tým</th>
            <th className="p-3 text-center" colSpan="4">E1-E4</th>
            <th className="p-3 text-center border-l border-slate-700" colSpan="2">C1-C2</th>
            <th className="p-3 text-center border-l border-slate-700" colSpan="2">D1-D2</th>
            <th className="p-3 text-center border-l border-slate-700 text-red-400">PEN</th>
            <th className="p-3 text-center border-l border-slate-700">Celkem</th>
            <th className="p-3 text-center border-l border-slate-700">Akce</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const isEd = editingId === s.id;
            const eJudges = isEd ? editForm.eJudges : normalizeEJudges(s.eJudges);
            const result = calculateScore(isEd ? editForm : s);
            const cell = (field) => {
              if (field === 'e4' && eJudges === 3) return <span className="italic text-amber-700" title="Dopočteno z E1–E3">{result.e4Value.toFixed(1)}</span>;
              if (!isEd) return s[field];
              return <input type="number" step="0.05" className="w-16 border rounded p-1 text-center shadow-inner" value={editForm[field]} onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })} />;
            };
            return (
              <tr key={s.id} className="border-b hover:bg-slate-50">
                <td className="p-3 text-slate-600">
                  <div className="font-medium">{s.apparatus}</div>
                  <div className="text-xs text-slate-400">{s.panelName || '—'}{eJudges === 3 ? ' • 3 E' : ''}</div>
                </td>
                <td className="p-3 border-r border-slate-200">
                  <b>{s.teamNumber}</b> – {s.teamName}
                  {s.timestamp && <div className="text-xs text-slate-400">uloženo {new Date(s.timestamp).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>}
                </td>
                <td className="p-2 text-center">{cell('e1')}</td><td className="p-2 text-center">{cell('e2')}</td><td className="p-2 text-center">{cell('e3')}</td><td className="p-2 text-center">{cell('e4')}</td>
                <td className="p-2 text-center bg-slate-100/50 border-l">{cell('c1')}</td><td className="p-2 text-center bg-slate-100/50">{cell('c2')}</td>
                <td className="p-2 text-center border-l">{cell('d1')}</td><td className="p-2 text-center">{cell('d2')}</td>
                <td className="p-2 text-center text-red-500 font-bold border-l">{cell('pen')}</td>
                <td className="p-2 text-center font-bold border-l">{result.total}</td>
                <td className="p-3 text-center border-l whitespace-nowrap">
                  {isEd ? (
                    <div className="flex gap-1 justify-center">
                      <button onClick={saveEdit} className="px-3 py-1 bg-green-100 text-green-700 hover:bg-green-200 rounded font-bold transition-colors">Uložit</button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded transition-colors">Zrušit</button>
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-center">
                      <button onClick={() => startEdit(s)} className="px-3 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded font-medium transition-colors">Opravit</button>
                      <button onClick={() => removeScore(s)} className="p-1 text-slate-400 hover:text-red-600" title="Smazat známku"><Trash2 size={16} /></button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
