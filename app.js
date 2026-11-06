/* =====================================================================
   Japanese study deck — N3 vocabulary + Business Japanese (keigo)
   ===================================================================== */

/* ---------- settings ---------- */
const SESSION = 20;                       // flashcards per session
const QUIZ_N = 10;                        // quiz questions per session
const INTERVALS = [0,1,3,7,14,30,60,120]; // flashcards: days until the next review, per level
const MASTER_BOX = 5;                     // flashcards: level 5+ (30-day gap) counts as mastered
const QINTERVALS = [0,1,3,7,14,30,60];    // quiz: days until a question comes back, per level
const QMASTER = 3;                        // quiz: right 3 times in a row (spaced out) counts as mastered

const today = () => { const d=new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset()*60000)/86400000); };
function esc(s){ return String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const range = n => Array.from({length:n},(_,i)=>i);

/* ---------- decks ---------- */
// Cards are tracked by "word|reading", quiz questions by id, so the lists can change safely.
function interleave(cards){ // mix categories so early sessions aren't all one topic
  const groups=new Map(); cards.forEach(c=>{ if(!groups.has(c.cat)) groups.set(c.cat,[]); groups.get(c.cat).push(c); });
  const lists=[...groups.values()], out=[];
  for(let i=0; out.length<cards.length; i++) lists.forEach(l=>{ if(i<l.length) out.push(l[i]); });
  return out;
}
function makeDeck(o){
  o.keys = o.cards.map(c=>c.w+"|"+(c.r||""));
  o.index = new Map(o.keys.map((k,i)=>[k,i]));
  o.quiz = o.quiz || [];
  o.qids = o.quiz.map(q=>q.id);
  o.qindex = new Map(o.qids.map((k,i)=>[k,i]));
  o.S = fresh(); o.docRef=null; o.saving=false; o.pending=false; o.timer=null;
  return o;
}
const DECKS = {
  n3: makeDeck({id:"n3", tab:"N3 語彙", heading:"N3 語彙", sub:"Daily deck", unit:"words", ls:"n3deck-v1", doc:"n3", ruby:true,
    legacy: window.N3_LEGACY_V1_KEYS || [],
    cards: (window.N3_WORDS||[]).map(w=>({w:w[0], r:w[1], m:w[2]}))}),
  biz: makeDeck({id:"biz", tab:"ビジネス敬語", heading:"ビジネス日本語", sub:"Keigo & business", unit:"cards", ls:"bizdeck-v1", doc:"biz",
    cards: interleave(window.BIZ_CARDS||[]), quiz: window.BIZ_QUIZ||[], guide: window.BIZ_GUIDE||"",
    quizTitle:"Keigo quiz", quizIntro:"Practise choosing the right keigo, putting business sentences together, and writing your own.", guideName:"keigo guide"}),
  inv: makeDeck({id:"inv", tab:"投資・金融", heading:"投資・プライベート市場", sub:"Investments & private markets", unit:"cards", ls:"invdeck-v1", doc:"inv",
    cards: interleave(window.INV_CARDS||[]), quiz: window.INV_QUIZ||[], guide: window.INV_GUIDE||"",
    quizTitle:"Investment quiz", quizIntro:"Practise private markets terminology and how to describe your own experience to recruiters.", guideName:"guide to talking about your background"})
};
const DECK_IDS = Object.keys(DECKS);
let D = DECKS.n3, mode = "cards";          // mode: cards | quiz | guide

function fresh(){ return {v:2, cards:{}, quiz:{}, dir:"jp", qFilter:"mix", streak:0, lastDay:null, doneDay:null, todayCount:0, qToday:0, sessions:0}; }
const okRec = v => Array.isArray(v) && v.length===4 && v.every(n=>Number.isFinite(n));

// Accepts anything saved by any version: N3 progress from the first version used list
// positions as keys, which are looked up in the frozen original word order.
function migrate(deck, st){
  st = Object.assign(fresh(), st || {});
  const cards = {}, src = (st.cards && typeof st.cards==="object") ? st.cards : {};
  for(const k in src){
    const v = src[k]; if(!okRec(v)) continue;
    const key = /^\d+$/.test(k) ? (deck.legacy||[])[+k] : k;
    if(!key) continue;
    const x = cards[key];
    if(!x || v[3]>x[3] || (v[3]===x[3] && v[0]>x[0])) cards[key] = v.slice();
  }
  const quiz = {}, qs = (st.quiz && typeof st.quiz==="object") ? st.quiz : {};
  for(const k in qs) if(okRec(qs[k])) quiz[k] = qs[k].slice();
  st.cards = cards; st.quiz = quiz; st.v = 2;
  return st;
}
function mergeRecs(a, b){
  const out = Object.assign({}, a);
  for(const k in b){ const x=out[k], y=b[k]; if(!x || y[3]>x[3] || (y[3]===x[3] && y[0]>x[0])) out[k]=y.slice(); }
  return out;
}
function mergeState(a, b){ // keep whichever record has more reviews for each card / question
  const out = Object.assign(fresh(), a);
  out.cards = mergeRecs(a.cards||{}, b.cards||{});
  out.quiz = mergeRecs(a.quiz||{}, b.quiz||{});
  if((b.doneDay||0)>(a.doneDay||0)){ out.doneDay=b.doneDay; out.streak=b.streak; }
  if(b.lastDay===a.lastDay){ out.todayCount=Math.max(a.todayCount||0,b.todayCount||0); out.qToday=Math.max(a.qToday||0,b.qToday||0); }
  else if((b.lastDay||0)>(a.lastDay||0)){ out.lastDay=b.lastDay; out.todayCount=b.todayCount||0; out.qToday=b.qToday||0; }
  out.sessions = Math.max(a.sessions||0, b.sessions||0);
  out.lastBackup = Math.max(a.lastBackup||0, b.lastBackup||0) || null;
  return out;
}

/* ---------- storage: Firebase (online, per Google account) + this browser ---------- */
// Signed in: each deck saves to Firestore at users/{uid}/deck/{n3|biz}, with a copy in this browser.
// Signed out: progress lives only in this browser.
let user = null;
const syncEl = document.getElementById("sync");
const acctEl = document.getElementById("acct");
function setSync(t, s){ syncEl.textContent = t; syncEl.dataset.s = s||""; }
const lsKey = deck => user ? deck.ls + ":" + user.uid : deck.ls;
function lsRead(deck, k){ try{ const r=localStorage.getItem(k||lsKey(deck)); return r?migrate(deck, JSON.parse(r)):null; }catch(e){ return null; } }
function lsWrite(deck){ try{ localStorage.setItem(lsKey(deck), JSON.stringify(deck.S)); }catch(e){} }
function save(deck){
  deck = deck || D;
  lsWrite(deck);
  if(!deck.docRef) return;
  clearTimeout(deck.timer);
  deck.timer = setTimeout(()=>flush(deck), 1200); // group quick answers into one write
}
async function flush(deck){
  deck.timer = null;
  if(!deck.docRef) return;
  if(deck.saving){ deck.pending = true; return; }
  deck.saving = true; setSync("Saving…");
  try{
    do{ deck.pending=false; await deck.docRef.set(JSON.parse(JSON.stringify(deck.S))); }while(deck.pending);
    setSync("Saved online");
  }catch(e){ setSync(navigator.onLine===false ? "Offline — saved on this device, will sync later" : "Couldn't save online — saved on this device", "err"); }
  deck.saving = false;
}
window.addEventListener("pagehide", ()=>DECK_IDS.forEach(id=>{ const d=DECKS[id]; if(d.timer){ clearTimeout(d.timer); flush(d); } }));
window.addEventListener("online", ()=>DECK_IDS.forEach(id=>{ if(DECKS[id].docRef) flush(DECKS[id]); }));

function renderAccount(){
  if(!window.FB_READY){ acctEl.innerHTML=""; return; }
  if(user){
    acctEl.innerHTML = `<span class="who">${esc(user.email||user.displayName||"Signed in")}</span><button class="ghost" id="signOut">Sign out</button>`;
    document.getElementById("signOut").onclick = ()=> firebase.auth().signOut();
  } else {
    acctEl.innerHTML = `<button class="primary small" id="signIn">Sign in with Google</button>`;
    document.getElementById("signIn").onclick = signIn;
  }
}
async function signIn(){
  const auth = firebase.auth(), provider = new firebase.auth.GoogleAuthProvider();
  try{ await auth.signInWithPopup(provider); }
  catch(e){
    if(e && (e.code==="auth/popup-blocked" || e.code==="auth/operation-not-supported-in-this-environment")) auth.signInWithRedirect(provider);
    else if(e && e.code!=="auth/popup-closed-by-user" && e.code!=="auth/cancelled-popup-request") setSync("Sign-in failed: "+(e.message||e.code), "err");
  }
}
async function pullRemote(deck){
  if(!deck.docRef) return true;
  try{
    const snap = await deck.docRef.get();
    if(snap.exists){
      const remote = migrate(deck, snap.data());
      const before = JSON.stringify(deck.S);
      deck.S = mergeState(deck.S, remote);
      lsWrite(deck);
      if(JSON.stringify(deck.S) !== JSON.stringify(remote)) save(deck);
      if(deck===D && !busy() && JSON.stringify(deck.S)!==before) render();
    } else if(Object.keys(deck.S.cards).length || Object.keys(deck.S.quiz).length) save(deck);
    return true;
  }catch(e){ return false; }
}
async function pullAll(){
  const ok = (await Promise.all(DECK_IDS.map(id=>pullRemote(DECKS[id])))).every(Boolean);
  setSync(ok ? "Synced" : "Couldn't reach the server — using this device's copy", ok ? "" : "err");
}
function boot(){
  DECK_IDS.forEach(id=>{ DECKS[id].S = lsRead(DECKS[id]) || fresh(); });
  applyRoute();
  if(!window.FB_READY){ setSync("Saving on this device only (online sync not set up)"); return; }
  setSync("Checking sign-in…");
  firebase.auth().onAuthStateChanged(async u => {
    if(u){
      const first = !user;
      user = u;
      DECK_IDS.forEach(id=>{
        const deck = DECKS[id];
        const guest = first ? lsRead(deck, deck.ls) : null;   // progress made while signed out
        deck.docRef = firebase.firestore().collection("users").doc(u.uid).collection("deck").doc(deck.doc);
        deck.S = lsRead(deck) || fresh();
        if(guest && (Object.keys(guest.cards).length || Object.keys(guest.quiz).length)){
          deck.S = mergeState(deck.S, guest); try{ localStorage.removeItem(deck.ls); }catch(e){}
        }
      });
      renderAccount(); if(!busy()) render();
      setSync("Syncing…");
      await pullAll();
    } else {
      user = null;
      DECK_IDS.forEach(id=>{ const deck=DECKS[id]; deck.docRef=null; deck.S = lsRead(deck) || fresh(); });
      renderAccount(); session = null; qs = null; render();
      setSync("Signed out — saving on this device only");
    }
  });
  // pick up reviews done on another device when you come back to this tab
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && !busy() && user) pullAll(); });
}

/* ---------- navigation (#n3, #biz, #biz-quiz, #biz-guide) ---------- */
const ROUTE_KEY = "jpdeck-route";
function applyRoute(){
  let h = (location.hash||"").replace("#","");
  if(!h){ try{ h = localStorage.getItem(ROUTE_KEY) || ""; }catch(e){} }
  const [id, m] = h.split("-");
  const deck = DECKS[id] || DECKS.n3;
  let md = m==="quiz" || m==="guide" ? m : "cards";
  if(md!=="cards" && !deck.quiz.length) md = "cards";
  if(deck!==D || md!==mode){ session = null; qs = null; }
  D = deck; mode = md;
  try{ localStorage.setItem(ROUTE_KEY, routeName()); }catch(e){}
  render();
  window.scrollTo(0,0);
}
const routeName = () => D.id + (mode==="cards" ? "" : "-"+mode);
function go(id, md){
  const name = id + (md && md!=="cards" ? "-"+md : "");
  if(location.hash.replace("#","")===name) applyRoute(); else location.hash = name;
}
window.addEventListener("hashchange", applyRoute);

function renderNav(){
  const tabs = DECK_IDS.map(id=>`<a href="#${id}" class="tab" lang="ja" ${DECKS[id]===D?'aria-current="page"':""}>${esc(DECKS[id].tab)}</a>`).join("");
  const modes = D.quiz.length ? `<div class="seg modes" role="group" aria-label="Section">
      ${[["cards","Flashcards"],["quiz","Quiz"],["guide","Guide"]].map(([m,l])=>`<button data-mode="${m}" aria-pressed="${mode===m}">${l}</button>`).join("")}
    </div>` : "";
  document.getElementById("nav").innerHTML = `<div class="tabs">${tabs}</div>${modes}`;
  document.querySelectorAll("#nav [data-mode]").forEach(b=>b.onclick=()=>go(D.id, b.dataset.mode));
  document.getElementById("title").innerHTML = `${esc(D.heading)}<small>${esc(D.sub)}</small>`;
}

/* ---------- flashcard scheduling ---------- */
function rollDay(){ const S=D.S, t=today(); if(S.lastDay!==t){ S.todayCount=0; S.qToday=0; S.lastDay=t; } }
function counts(deck){
  deck = deck || D;
  let m=0,r=0,l=0,due=0; const t=today(), S=deck.S;
  for(const k in S.cards){ if(!deck.index.has(k)) continue; const c=S.cards[k]; if(c[0]>=MASTER_BOX) m++; else if(c[0]>=3) r++; else l++; if(c[1]<=t) due++; }
  return {m,r,l,due,seen:m+r+l,total:deck.cards.length};
}
function buildSession(){
  const t=today(), S=D.S, due=[];
  for(const k in S.cards){ if(!D.index.has(k)) continue; const c=S.cards[k]; if(c[1]<=t) due.push([D.index.get(k), c[0], c[1]]); }
  due.sort((a,b)=> a[1]-b[1] || a[2]-b[2]); // missed (level 0) first, then oldest-due
  const ids = due.slice(0, SESSION).map(x=>x[0]);
  for(let i=0; ids.length<SESSION && i<D.cards.length; i++) if(!S.cards[D.keys[i]]) ids.push(i);
  return shuffle(ids);
}
function rate(id, grade){ // 0 again, 1 good, 2 easy
  const t=today(), key=D.keys[id], S=D.S; const c=S.cards[key] || [0,t,0,0];
  if(grade===0){ c[0]=0; c[1]=t; c[2]++; }
  else { c[0]=Math.min(INTERVALS.length-1, c[0]+grade); c[1]=t+INTERVALS[c[0]]; }
  c[3]++;
  S.cards[key]=c;
}

/* ---------- quiz scheduling ---------- */
const QTYPES = {mix:"Mixed", mc:"Choose the right form", order:"Build the sentence", write:"Write it yourself"};
function quizCounts(deck){
  deck = deck || D;
  let m=0,g=0,w=0,due=0; const t=today(), Q=deck.S.quiz;
  for(const id in Q){ if(!deck.qindex.has(id)) continue; const r=Q[id]; if(r[0]>=QMASTER) m++; else if(r[0]>=1) g++; else w++; if(r[1]<=t) due++; }
  return {m,g,w,due,seen:m+g+w,total:deck.quiz.length};
}
function buildQuiz(){
  const t=today(), Q=D.S.quiz, f=D.S.qFilter||"mix";
  const pool = range(D.quiz.length).filter(i=> f==="mix" || D.quiz[i].type===f);
  const due = pool.filter(i=>Q[D.qids[i]] && Q[D.qids[i]][1]<=t)
    .sort((a,b)=> Q[D.qids[a]][0]-Q[D.qids[b]][0] || Q[D.qids[a]][1]-Q[D.qids[b]][1]);
  let unseen = shuffle(pool.filter(i=>!Q[D.qids[i]]));
  if(f==="mix"){ // keep a mixed quiz mixed: about 6 choice, 2 building, 2 writing per 10
    const by={mc:[],order:[],write:[]}; unseen.forEach(i=>(by[D.quiz[i].type]||by.mc).push(i));
    const pattern=["mc","order","mc","write","mc","mc","order","mc","write","mc"], out=[];
    while(out.length<unseen.length) for(const t of pattern){ const l=by[t].length?by[t]:(by.mc.length?by.mc:by.order.length?by.order:by.write); if(l.length) out.push(l.shift()); }
    unseen = out;
  }
  let queue = due.slice(0, QUIZ_N);
  for(const i of unseen){ if(queue.length>=QUIZ_N) break; queue.push(i); }
  const early = new Set();
  if(queue.length<QUIZ_N){ // everything's done for now: extra practice with the ones coming up soonest
    const later = pool.filter(i=>Q[D.qids[i]] && Q[D.qids[i]][1]>t).sort((a,b)=>Q[D.qids[a]][1]-Q[D.qids[b]][1]);
    for(const i of later){ if(queue.length>=QUIZ_N) break; queue.push(i); early.add(i); }
  }
  return {queue: shuffle(queue), early};
}
function rateQ(i, ok, early){
  const t=today(), id=D.qids[i], Q=D.S.quiz; const r=Q[id] || [0,t,0,0];
  if(ok){ if(!early){ r[0]=Math.min(QINTERVALS.length-1, r[0]+1); r[1]=t+QINTERVALS[r[0]]; } }
  else { r[0]=0; r[1]=t; r[2]++; }
  r[3]++;
  Q[id]=r;
}

/* ---------- top-level render ---------- */
const view = document.getElementById("view");
const ledgerEl = document.getElementById("ledger");
let session = null; // flashcard session
let qs = null;      // quiz session
const busy = () => !!(session || qs);

function render(){
  renderNav();
  rollDay();
  if(mode==="guide"){ ledgerEl.hidden = true; renderGuide(); return; }
  ledgerEl.hidden = false;
  if(mode==="quiz"){ renderQuizLedger(); qs ? renderQuestion() : renderQuizHome(); }
  else { renderLedger(); session ? renderCard() : renderHome(); }
}
function streakNow(){ const S=D.S, t=today(); return (S.doneDay===t || S.doneDay===t-1) ? S.streak : 0; }
function ledgerHTML(o){
  const pct = o.total ? o.top/o.total*100 : 0;
  const seg = o.segs.map(s=>`<i style="width:${o.total? s.n/o.total*100 : 0}%;background:var(${s.c})"></i>`).join("");
  const legend = o.segs.concat([{l:o.restLabel, n:o.total-o.seen, c:"--new"}]).map(s=>`<span><i class="sw" style="background:var(${s.c})"></i>${s.l} <b>${s.n}</b></span>`).join("");
  return `<div class="ledger-top">
      <div><div class="lbl">Mastered</div><div class="big">${pct<10?pct.toFixed(1):Math.round(pct)}%<span> · ${o.top} ${o.unit}</span></div></div>
      <div style="text-align:right"><div class="lbl">${o.seenLabel}</div><div class="big">${o.seen}<span> / ${o.total}</span></div></div>
    </div>
    <div class="bar" role="img" aria-label="${o.segs.map(s=>s.n+" "+s.l.toLowerCase()).join(", ")}, ${o.total-o.seen} ${o.restLabel.toLowerCase()}">${seg}</div>
    <div class="legend">${legend}</div>
    <div class="stats">
      <div><span class="lbl">Due today</span><span class="v">${o.due}</span></div>
      <div><span class="lbl">${o.todayLabel}</span><span class="v">${o.today}</span></div>
      <div><span class="lbl">Day streak</span><span class="v">${streakNow()}</span></div>
    </div>`;
}
function renderLedger(){
  const c=counts();
  ledgerEl.innerHTML = ledgerHTML({top:c.m, unit:D.unit, seen:c.seen, total:c.total, seenLabel:D.unit==="words"?"Words seen":"Cards seen",
    segs:[{l:"Mastered",n:c.m,c:"--master"},{l:"Reviewing",n:c.r,c:"--review"},{l:"Learning",n:c.l,c:"--learn"}], restLabel:"New",
    due:c.due, today:D.S.todayCount, todayLabel:"Reviewed today"});
}
function renderQuizLedger(){
  const c=quizCounts();
  ledgerEl.innerHTML = ledgerHTML({top:c.m, unit:"questions", seen:c.seen, total:c.total, seenLabel:"Questions tried",
    segs:[{l:"Mastered",n:c.m,c:"--master"},{l:"Getting there",n:c.g,c:"--review"},{l:"Needs work",n:c.w,c:"--miss"}], restLabel:"Not tried",
    due:c.due, today:D.S.qToday||0, todayLabel:"Answered today"});
}
function markSessionDone(){
  const S=D.S, t=today();
  if(S.doneDay!==t){ S.streak = (S.doneDay===t-1 ? S.streak : 0) + 1; S.doneDay = t; }
  S.sessions++;
}

/* ---------- flashcards: home ---------- */
function renderHome(summary){
  const c=counts(), S=D.S;
  const dueN=Math.min(c.due,SESSION), newN=Math.max(0,Math.min(SESSION-dueN, c.total-c.seen));
  let top="";
  if(summary){
    const missed=summary.missed.map(i=>`<span lang="ja" title="${esc(D.cards[i].m)}">${esc(D.cards[i].w)}</span>`).join("");
    top = `<div class="done"><div class="stamp">済</div><div><h2>Session done — ${summary.ok} of ${summary.n} on the first try</h2>
      <div class="plan">${summary.missed.length? "These come back in your next session:" : "Clean run. Nothing carried over."}</div></div></div>
      ${summary.missed.length?`<div class="miss">${missed}</div>`:""}`;
  } else {
    top = `<h2>${c.seen? "Today's session" : "Start your first session"}</h2>`;
  }
  view.innerHTML = `<div class="home">${top}
    <div class="plan"><span>Next ${SESSION}: <b>${dueN}</b> to review · <b>${newN}</b> new</span></div>
    <div class="row">
      <button class="primary" id="go" ${dueN+newN?"":"disabled"}>${summary?`Start another ${SESSION}`:`Start ${SESSION} cards`}</button>
      <div class="seg" role="group" aria-label="Card direction">
        <button id="d-jp" aria-pressed="${S.dir==="jp"}">日本語 → English</button>
        <button id="d-en" aria-pressed="${S.dir==="en"}">English → 日本語</button>
      </div>
    </div>
    ${D.quiz.length && !summary ? `<p class="plan">Want to practise using these? Try the <a href="#${D.id}-quiz">quiz</a> or read the <a href="#${D.id}-guide">${esc(D.guideName||"guide")}</a>.</p>` : ""}
    ${backupHTML()}
    <div class="row" id="resetRow"><button class="ghost" id="reset">Reset flashcard progress</button></div>
  </div>`;
  wireBackup(()=>renderHome(summary));
  document.getElementById("go").onclick=start;
  document.getElementById("d-jp").onclick=()=>{S.dir="jp";save();renderHome(summary);};
  document.getElementById("d-en").onclick=()=>{S.dir="en";save();renderHome(summary);};
  wireReset("Erase every flashcard review in this section and start from zero?", ()=>{ D.S.cards={}; }, ()=>renderHome(summary));
}
function wireReset(question, doReset, back){
  document.getElementById("reset").onclick=()=>{
    document.getElementById("resetRow").innerHTML=`<span class="confirm">${esc(question)}
      <button class="ghost" id="rYes" style="color:var(--shu)">Yes, reset</button><button class="ghost" id="rNo">Cancel</button></span>`;
    document.getElementById("rYes").onclick=()=>{ doReset(); save(); render(); };
    document.getElementById("rNo").onclick=back;
  };
}

/* ---------- flashcards: session ---------- */
function start(){
  const q=buildSession(); if(!q.length) return;
  session={queue:q, pos:0, revealed:false, results:{}, n:q.length};
  render();
}
function sizeClass(s){ const n=[...s].length; return n>18 ? " xlong" : n>9 ? " long" : ""; }
function wordHTML(c, withReading){
  return withReading && c.r ? `<ruby>${esc(c.w)}<rt>${esc(c.r)}</rt></ruby>` : esc(c.w);
}
function extrasHTML(c){
  let h="";
  if(c.note) h+=`<div class="cnote" lang="ja">${esc(c.note)}</div>`;
  if(c.ex) h+=`<div class="cex"><div lang="ja">${esc(c.ex)}</div>${c.exEn?`<div class="exen">${esc(c.exEn)}</div>`:""}</div>`;
  return h;
}
function renderCard(){
  const s=session, id=s.queue[s.pos], c=D.cards[id], retry = s.pos>=s.n, S=D.S;
  const rec=S.cards[D.keys[id]], isNew=!rec;
  const dots=s.queue.slice(0,s.n).map((q,i)=>`<i class="${i===s.pos?"cur":(q in s.results?(s.results[q]?"ok":"no"):"")}"></i>`).join("");
  const useRuby = D.ruby && !sizeClass(c.w);
  let front, back="";
  if(S.dir==="jp"){
    front=`<div class="word${sizeClass(c.w)}" lang="ja">${wordHTML(c, s.revealed && useRuby)}</div>`;
    if(s.revealed) back=`<div class="back">${!useRuby && c.r?`<div class="reading" lang="ja">${esc(c.r)}</div>`:""}<div class="meaning">${esc(c.m)}</div>${extrasHTML(c)}</div>`;
  } else {
    front=`<div class="prompt-en">${esc(c.m)}</div>`;
    if(s.revealed) back=`<div class="back"><div class="word${sizeClass(c.w)} small" lang="ja">${wordHTML(c, useRuby)}</div>${!useRuby && c.r?`<div class="reading" lang="ja">${esc(c.r)}</div>`:""}${extrasHTML(c)}</div>`;
  }
  const tag = retry? `<span class="tag again">Retry</span>` : isNew? `<span class="tag">New</span>` : (rec[0]===0?`<span class="tag again">Missed before</span>`:`<span class="tag">Review</span>`);
  const cat = c.cat ? `<span class="tag right">${esc(c.cat)}</span>` : "";
  const box = rec?rec[0]:0;
  const gi = Math.min(INTERVALS.length-1,box+1), ei=Math.min(INTERVALS.length-1,box+2);
  const fmt=d=> d>=30? Math.round(d/30)+"mo" : d+"d";
  view.innerHTML = `<div class="sess">
    <div class="sbar"><span>${Math.min(s.pos+1,s.n)}/${s.n}${retry?" +retry":""}</span><div class="dots">${dots}</div>
      <button class="ghost" id="quit" title="End session">End</button></div>
    <div class="card" id="card" tabindex="0" role="button" aria-label="${s.revealed?"Card answer":"Reveal answer"}">${tag}${cat}${front}${back}
      ${s.revealed?"":`<div class="hint">Tap or press space to reveal</div>`}</div>
    <div class="btns">${s.revealed?
      `<button class="again" id="b0">Didn't know<small>again</small></button>
       <button class="good" id="b1">Knew it<small>${retry?"today":fmt(INTERVALS[gi])}</small></button>
       <button id="b2">Easy<small>${retry?"today":fmt(INTERVALS[ei])}</small></button>`
      :`<button class="primary" id="flip" style="grid-column:1/-1">Show answer</button>`}</div>
    <div class="keys"><kbd>Space</kbd> reveal · <kbd>1</kbd> didn't know · <kbd>2</kbd> knew it · <kbd>3</kbd> easy</div>
  </div>`;
  document.getElementById("card").onclick=()=>{ if(!s.revealed) flip(); };
  document.getElementById("quit").onclick=finish;
  if(s.revealed){ [0,1,2].forEach(g=>document.getElementById("b"+g).onclick=()=>answer(g)); }
  else document.getElementById("flip").onclick=flip;
}
function flip(){ session.revealed=true; renderCard(); }
function answer(g){
  const s=session, id=s.queue[s.pos], retry=s.pos>=s.n;
  if(!retry){
    rate(id,g); rollDay(); D.S.todayCount++;
    s.results[id]= g>0;
    if(g===0) s.queue.push(id); // once more at the end of this session
    save();
  }
  s.pos++; s.revealed=false;
  if(s.pos>=s.queue.length) finish(); else render();
}
function finish(){
  const s=session; session=null;
  const answered=Object.keys(s.results).length;
  if(answered){ markSessionDone(); save(); }
  renderLedger();
  if(!answered){ renderHome(); return; }
  const missed=Object.keys(s.results).filter(k=>!s.results[k]).map(Number);
  renderHome({n:answered, ok:answered-missed.length, missed});
}

/* ---------- quiz: home ---------- */
function renderQuizHome(summary){
  const c=quizCounts(), S=D.S, f=S.qFilter||"mix", t=today();
  const pool=range(D.quiz.length).filter(i=>f==="mix"||D.quiz[i].type===f);
  const dueN=pool.filter(i=>{const r=S.quiz[D.qids[i]]; return r && r[1]<=t;}).length;
  const newN=pool.filter(i=>!S.quiz[D.qids[i]]).length;
  let top="";
  if(summary){
    const missed=summary.missed.map(i=>{ const q=D.quiz[i]; return q.type==="write" ? `<li>${esc(q.en)}</li>` : `<li><span lang="ja">${esc(q.type==="order"?q.tiles.join(""):q.q.includes("＿＿")?q.q.replace("＿＿",q.opts[q.a]):q.opts[q.a])}</span></li>`; }).join("");
    top = `<div class="done"><div class="stamp">済</div><div><h2>Quiz done — ${summary.ok} of ${summary.n} right</h2>
      <div class="plan">${summary.missed.length? "You'll see these again in your next quiz:" : "All correct. Nice work."}</div></div></div>
      ${summary.missed.length?`<ul class="qmiss">${missed}</ul>`:""}`;
  } else top = `<h2>${esc(D.quizTitle||"Quiz")}</h2><p class="plan">${esc(D.quizIntro||"")} Questions you get wrong come back in your next quiz.</p>`;
  const counts = {mix:D.quiz.length}; D.quiz.forEach(q=>counts[q.type]=(counts[q.type]||0)+1);
  view.innerHTML = `<div class="home">${top}
    <div class="chips" role="group" aria-label="Question type">
      ${Object.keys(QTYPES).map(k=>`<button class="chip" data-f="${k}" aria-pressed="${f===k}">${QTYPES[k]} <small>${counts[k]||0}</small></button>`).join("")}
    </div>
    <div class="plan"><span>Next ${QUIZ_N}: <b>${Math.min(dueN,QUIZ_N)}</b> to retry or review · <b>${Math.min(newN, Math.max(0,QUIZ_N-dueN))}</b> new</span></div>
    <div class="row"><button class="primary" id="qgo" ${pool.length?"":"disabled"}>${summary?`Start another ${QUIZ_N}`:`Start ${QUIZ_N} questions`}</button></div>
    ${backupHTML()}
    <div class="row" id="resetRow"><button class="ghost" id="reset">Reset quiz progress</button></div>
  </div>`;
  document.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{ S.qFilter=b.dataset.f; save(); renderQuizHome(); });
  document.getElementById("qgo").onclick=startQuiz;
  wireBackup(()=>renderQuizHome(summary));
  wireReset("Erase all quiz results in this section?", ()=>{ D.S.quiz={}; }, ()=>renderQuizHome(summary));
}

/* ---------- quiz: session ---------- */
function startQuiz(){
  const b=buildQuiz(); if(!b.queue.length) return;
  qs={queue:b.queue, early:b.early, pos:0, n:b.queue.length, results:{}, ui:newUI(b.queue[0])};
  render();
}
function newUI(i){
  const q=D.quiz[i];
  if(q.type==="mc") return {done:false, order:shuffle(range(q.opts.length)), picked:null};
  if(q.type==="order") return {done:false, bank:shuffle(range(q.tiles.length)), chosen:[]};
  return {done:false, text:"", hints:false};
}
function renderQuestion(){
  const s=qs, i=s.queue[s.pos], q=D.quiz[i], u=s.ui, retry=s.pos>=s.n;
  const dots=s.queue.slice(0,s.n).map((x,k)=>`<i class="${k===s.pos?"cur":(x in s.results?(s.results[x]?"ok":"no"):"")}"></i>`).join("");
  let body="", actions="";
  if(q.type==="mc"){
    const sentence = u.done ? esc(q.q).replace("＿＿",`<mark class="fill">${esc(q.opts[q.a])}</mark>`) : esc(q.q).replace("＿＿",`<span class="blank">＿＿</span>`);
    body = `<p class="qen">${esc(q.en)}</p><p class="qjp" lang="ja">${sentence}</p>
      <div class="opts">${u.order.map((o,n)=>{
        let cls=""; if(u.done){ if(o===q.a) cls="right"; else if(o===u.picked) cls="wrong"; }
        return `<button class="opt ${cls}" data-o="${o}" ${u.done?"disabled":""} lang="ja"><kbd>${n+1}</kbd><span>${esc(q.opts[o])}</span></button>`;
      }).join("")}</div>`;
  } else if(q.type==="order"){
    const right = u.done && u.ok;
    body = `<p class="qprompt">${esc(q.en)}</p>
      <div class="line ${u.done?(right?"right":"wrong"):""}" aria-label="Your sentence">${u.chosen.length? u.chosen.map((t,n)=>`<button class="tile in" data-n="${n}" ${u.done?"disabled":""} lang="ja">${esc(q.tiles[t])}</button>`).join("") : `<span class="ph">Tap the pieces in order</span>`}</div>
      ${u.done? "" : `<div class="bank">${u.bank.map(t=>`<button class="tile" data-t="${t}" lang="ja">${esc(q.tiles[t])}</button>`).join("")}</div>`}`;
    if(!u.done) actions = `<div class="row"><button class="primary" id="check" ${u.bank.length?"disabled":""}>Check</button><button class="ghost" id="clear" ${u.chosen.length?"":"disabled"}>Clear</button></div>`;
  } else {
    body = `<p class="qprompt">${esc(q.en)}</p>
      ${u.hints||u.done? `<div class="hints" lang="ja">${q.hints.map(h=>`<span>${esc(h)}</span>`).join("")}</div>` : `<button class="ghost" id="hintBtn">Show hints</button>`}
      <label class="vh" for="wtext">Your answer</label>
      <textarea id="wtext" lang="ja" placeholder="Write your answer in Japanese…" ${u.done?"readonly":""}>${esc(u.text)}</textarea>`;
    if(!u.done) actions = `<div class="row"><button class="primary" id="reveal">Show model answer</button></div>`;
  }
  let result="";
  if(u.done){
    if(q.type==="write"){
      result = `<div class="result"><div class="lbl">Model answer${q.model.length>1?"s":""}</div>
        ${q.model.map(m=>`<p class="model" lang="ja">${esc(m)}</p>`).join("")}
        <div class="lbl">Check that yours has</div><ul class="points">${q.points.map(p=>`<li lang="ja">${esc(p)}</li>`).join("")}</ul>
        ${u.graded===undefined ? `<div class="btns two"><button class="again" id="g0">Needs more work</button><button class="good" id="g1">I got the key points</button></div>` : ""}</div>`;
    } else {
      const ok = u.ok;
      result = `<div class="result ${ok?"ok":"no"}"><div class="verdict">${ok?"Correct":"Not quite"}</div>
        ${q.type==="order"&&!ok?`<p class="model" lang="ja">${esc(q.tiles.join(""))}</p>`:""}
        <p class="why">${esc(q.why)}</p></div>`;
    }
    if(q.type!=="write" || u.graded!==undefined) actions = `<div class="row"><button class="primary" id="next">${s.pos+1>=s.queue.length?"See results":"Next question"}</button></div>`;
  }
  view.innerHTML = `<div class="sess">
    <div class="sbar"><span>${Math.min(s.pos+1,s.n)}/${s.n}${retry?" +retry":""}</span><div class="dots">${dots}</div>
      <button class="ghost" id="qquit" title="End quiz">End</button></div>
    <div class="qcard"><div class="qhead"><span class="tag ${retry?"again":""}">${retry?"Retry · ":""}${QTYPES[q.type]}</span><span class="tag right">${esc(q.cat)}</span></div>
      ${body}${result}</div>
    ${actions}
    <div class="keys">${q.type==="mc"?"<kbd>1</kbd>–<kbd>4</kbd> choose · ":""}<kbd>Enter</kbd> ${q.type==="write"?"(outside the text box) ":""}next</div>
  </div>`;
  wireQuestion(q, u);
}
function wireQuestion(q, u){
  const $=id=>document.getElementById(id);
  $("qquit").onclick=finishQuiz;
  if(q.type==="mc") document.querySelectorAll(".opt").forEach(b=>b.onclick=()=>pickOpt(+b.dataset.o));
  if(q.type==="order" && !u.done){
    document.querySelectorAll(".bank .tile").forEach(b=>b.onclick=()=>{ const t=+b.dataset.t; u.bank.splice(u.bank.indexOf(t),1); u.chosen.push(t); renderQuestion(); });
    document.querySelectorAll(".line .tile").forEach(b=>b.onclick=()=>{ const t=u.chosen.splice(+b.dataset.n,1)[0]; u.bank.push(t); renderQuestion(); });
    $("clear").onclick=()=>{ u.bank=u.bank.concat(u.chosen); u.chosen=[]; renderQuestion(); };
    $("check").onclick=checkOrder;
  }
  if(q.type==="write"){
    const ta=$("wtext"); if(ta && !u.done) ta.oninput=()=>{ u.text=ta.value; };
    if($("hintBtn")) $("hintBtn").onclick=()=>{ u.hints=true; renderQuestion(); };
    if($("reveal")) $("reveal").onclick=()=>{ u.done=true; renderQuestion(); };
    if($("g0")) $("g0").onclick=()=>gradeQ(false);
    if($("g1")) $("g1").onclick=()=>gradeQ(true);
  }
  if($("next")) { $("next").onclick=nextQ; $("next").focus({preventScroll:true}); }
}
function pickOpt(o){
  const u=qs.ui, q=D.quiz[qs.queue[qs.pos]]; if(u.done) return;
  u.picked=o; u.done=true; u.ok = o===q.a; gradeQ(u.ok);
}
function checkOrder(){
  const u=qs.ui, q=D.quiz[qs.queue[qs.pos]];
  const mine=u.chosen.map(t=>q.tiles[t]).join("");
  u.ok = [q.tiles].concat(q.alts||[]).some(a=>a.join("")===mine);
  u.done=true; gradeQ(u.ok);
}
function gradeQ(ok){
  const s=qs, i=s.queue[s.pos], retry=s.pos>=s.n;
  s.ui.graded = ok; s.ui.ok = ok;
  if(!retry){
    rateQ(i, ok, s.early.has(i)); rollDay(); D.S.qToday=(D.S.qToday||0)+1;
    s.results[i]=ok;
    if(!ok) s.queue.push(i); // once more at the end of this quiz
    save();
  }
  renderQuizLedger(); renderQuestion();
}
function nextQ(){
  const s=qs; s.pos++;
  if(s.pos>=s.queue.length){ finishQuiz(); return; }
  s.ui=newUI(s.queue[s.pos]); renderQuestion(); window.scrollTo(0, ledgerEl.offsetTop + ledgerEl.offsetHeight);
}
function finishQuiz(){
  const s=qs; qs=null;
  const answered=Object.keys(s.results).length;
  if(answered){ markSessionDone(); save(); }
  renderQuizLedger();
  if(!answered){ renderQuizHome(); return; }
  const missed=Object.keys(s.results).filter(k=>!s.results[k]).map(Number);
  renderQuizHome({n:answered, ok:answered-missed.length, missed});
}

/* ---------- guide ---------- */
function renderGuide(){
  view.innerHTML = `<article class="guide">${D.guide}
    <p class="plan">Ready to practise? <a href="#${D.id}-quiz">Take the quiz</a> or <a href="#${D.id}">study the flashcards</a>.</p></article>`;
}

/* ---------- backup: one .md file holds every section ---------- */
function dateStr(d){ d=d||new Date(); const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function backupAge(){
  const last=Math.max(...DECK_IDS.map(id=>DECKS[id].S.lastBackup||0));
  if(!last) return "You haven't saved one yet.";
  const d=today()-last;
  return d<=0? "Last saved today." : d===1? "Last saved yesterday." : `Last saved ${d} days ago.`;
}
function backupHTML(){
  return `<div class="backup">
      <h3>Back up your progress</h3>
      <p>Your progress saves online when you're signed in. You can also save a progress file (.md) with every section in it, and load it on any account or device. ${backupAge()}</p>
      <div class="row">
        <button id="exp">Save progress file</button>
        <button id="impBtn">Load progress file</button>
        <input type="file" id="impFile" class="vh" accept=".md,.txt,.json,text/markdown,text/plain">
        <button class="ghost" id="pasteBtn">or paste it</button>
      </div>
      <div id="bkArea"></div>
    </div>`;
}
const mdCell = s => String(s).replace(/\|/g,"\\|").replace(/\n/g," ");
function buildMarkdown(){
  const now=new Date(), t=today();
  let md=`# Japanese Study Deck — progress\n\nSaved ${dateStr(now)} ${now.toTimeString().slice(0,5)}\n\n`;
  for(const id of DECK_IDS){
    const deck=DECKS[id], S=deck.S, c=counts(deck);
    const reviews=Object.values(S.cards).reduce((n,x)=>n+x[3],0);
    const streak=(S.doneDay===t||S.doneDay===t-1)?S.streak:0;
    md+=`## ${deck.heading} — flashcards\n\n| | |\n|---|---|\n| Mastered (30+ day gap) | ${c.m} |\n| Reviewing | ${c.r} |\n| Learning | ${c.l} |\n| Not seen yet | ${c.total-c.seen} |\n| Seen | ${c.seen} / ${c.total} |\n| Total reviews | ${reviews} |\n| Day streak | ${streak} |\n| Due today | ${c.due} |\n\n`;
    const weak=Object.keys(S.cards).filter(k=>deck.index.has(k) && S.cards[k][2]>0 && S.cards[k][0]<MASTER_BOX).sort((a,b)=>S.cards[b][2]-S.cards[a][2]).slice(0,30);
    if(weak.length){
      md+=`### To work on\n\n| Japanese | Reading | Meaning | Missed |\n|---|---|---|---|\n`;
      for(const k of weak){ const w=deck.cards[deck.index.get(k)]; md+=`| ${mdCell(w.w)} | ${mdCell(w.r||"")} | ${mdCell(w.m)} | ${S.cards[k][2]} |\n`; }
      md+="\n";
    }
    if(deck.quiz.length){
      const q=quizCounts(deck);
      md+=`## ${deck.heading} — quiz\n\n| | |\n|---|---|\n| Mastered | ${q.m} |\n| Getting there | ${q.g} |\n| Needs work | ${q.w} |\n| Not tried | ${q.total-q.seen} |\n\n`;
      const qweak=Object.keys(S.quiz).filter(k=>deck.qindex.has(k) && S.quiz[k][0]===0).slice(0,20);
      if(qweak.length){
        md+=`### Questions to retry\n\n`;
        for(const k of qweak){ const x=deck.quiz[deck.qindex.get(k)]; md+=`- ${mdCell(x.en)}\n`; }
        md+="\n";
      }
    }
  }
  const data={app:"n3-deck", v:3, saved:now.toISOString(), decks:Object.fromEntries(DECK_IDS.map(id=>[id, DECKS[id].S]))};
  md+=`## How to restore\n\n1. Open your study deck site (signed in with any Google account, or signed out).\n2. Choose **Load progress file** and pick this file. You can also paste the whole file with **or paste it**.\n3. Check the preview, then choose **Restore**.\n\nDon't edit the data block below. The deck reads it to rebuild your schedule.\n\n## Data\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
  return md;
}
function parseBackup(text){
  const m=text.match(/```json\s*([\s\S]*?)```/);
  let obj; try{ obj=JSON.parse(m?m[1]:text.trim()); }catch(e){ throw new Error("Couldn't find the progress data in that file. Use a file saved by this deck, without edits to the Data section."); }
  if(!obj || obj.app!=="n3-deck") throw new Error("That file isn't a progress file from this deck.");
  const decks={};
  if(obj.decks && typeof obj.decks==="object"){
    for(const id of DECK_IDS) if(obj.decks[id]) decks[id]=migrate(DECKS[id], obj.decks[id]);
  } else if(obj.state && typeof obj.state.cards==="object"){ // older files only had N3
    if((obj.v||1)<2 && obj.words!==DECKS.n3.legacy.length) throw new Error(`That file was made for a ${obj.words}-word list that this deck can't match up.`);
    decks.n3=migrate(DECKS.n3, obj.state);
  }
  if(!Object.keys(decks).length) throw new Error("That file doesn't contain any progress.");
  return {saved:obj.saved, decks};
}
function wireBackup(back){
  const area=document.getElementById("bkArea");
  const say=(t,cls)=>{ area.innerHTML=`<div class="msg ${cls||""}">${esc(t)}</div>`; };
  document.getElementById("exp").onclick=()=>{
    const md=buildMarkdown(), name=`japanese-progress-${dateStr()}.md`;
    try{
      const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"})); a.download=name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      DECK_IDS.forEach(id=>{ DECKS[id].S.lastBackup=today(); save(DECKS[id]); }); back();
      document.getElementById("bkArea").innerHTML=`<div class="msg ok">Saved ${esc(name)} to your downloads.</div>`; return;
    }catch(e){}
    area.innerHTML=`<div class="msg">Saving files isn't available here. Copy this text into a file named <b>${esc(name)}</b>:</div>
      <textarea id="mdOut" readonly aria-label="Progress file text"></textarea><div class="row"><button id="cp">Copy text</button></div>`;
    const ta=document.getElementById("mdOut"); ta.value=md;
    document.getElementById("cp").onclick=async()=>{ try{ await navigator.clipboard.writeText(md); document.getElementById("cp").textContent="Copied"; }catch(e){ ta.focus(); ta.select(); } };
  };
  const fileIn=document.getElementById("impFile");
  document.getElementById("impBtn").onclick=()=>fileIn.click();
  fileIn.onchange=()=>{ const f=fileIn.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>showPreview(String(r.result)); r.onerror=()=>say("Couldn't read that file.","err"); r.readAsText(f); fileIn.value=""; };
  document.getElementById("pasteBtn").onclick=()=>{
    area.innerHTML=`<textarea id="pasteIn" aria-label="Paste progress file" placeholder="Paste the whole progress file here"></textarea><div class="row"><button id="pasteGo">Check file</button></div>`;
    document.getElementById("pasteGo").onclick=()=>showPreview(document.getElementById("pasteIn").value);
  };
  function showPreview(text){
    let b; try{ b=parseBackup(text); }catch(e){ say(e.message,"err"); return; }
    const lines=Object.keys(b.decks).map(id=>{
      const deck=DECKS[id], st=b.decks[id];
      const seen=Object.keys(st.cards).filter(k=>deck.index.has(k)).length;
      const qn=Object.keys(st.quiz).filter(k=>deck.qindex.has(k)).length;
      return `<li><b lang="ja">${esc(deck.heading)}</b>: ${seen} ${deck.unit} seen${deck.quiz.length?`, ${qn} quiz questions tried`:""}</li>`;
    }).join("");
    const hasAny=Object.keys(b.decks).some(id=>counts(DECKS[id]).seen || quizCounts(DECKS[id]).seen);
    area.innerHTML=`<div class="preview"><div>File saved <b>${esc((b.saved||"").slice(0,10)||"unknown date")}</b>:</div><ul>${lines}</ul>
      <div>${hasAny? "<b>Restore</b> combines the file with your current progress, keeping whichever record has more reviews for each card and question." : "Nothing is saved here yet, so the file will be restored as-is."}</div>
      <div class="row"><button class="primary" id="doImp">Restore</button>${hasAny?`<button id="doRep">Replace instead</button>`:""}<button class="ghost" id="noImp">Cancel</button></div></div>`;
    document.getElementById("doImp").onclick=()=>finishImport(b, true);
    if(hasAny) document.getElementById("doRep").onclick=()=>finishImport(b, false);
    document.getElementById("noImp").onclick=()=>{ area.innerHTML=""; };
  }
  function finishImport(b, merge){
    for(const id in b.decks){ const deck=DECKS[id]; deck.S = merge ? mergeState(deck.S, b.decks[id]) : Object.assign(b.decks[id], {dir:deck.S.dir}); save(deck); }
    render();
    document.getElementById("bkArea").innerHTML=`<div class="msg ok">Progress restored.</div>`;
  }
}

/* ---------- keyboard ---------- */
document.addEventListener("keydown",e=>{
  if(e.target.closest && e.target.closest("input,textarea")) return;
  if(session){
    if(e.key===" "||e.key==="Enter"){ if(!session.revealed){ e.preventDefault(); flip(); } }
    else if(session.revealed && ["1","2","3"].includes(e.key)) answer(+e.key-1);
  } else if(qs){
    const q=D.quiz[qs.queue[qs.pos]], u=qs.ui;
    if(q.type==="mc" && !u.done && /^[1-9]$/.test(e.key)){ const o=u.order[+e.key-1]; if(o!==undefined) pickOpt(o); }
    else if(e.key==="Enter" && document.getElementById("next")){ e.preventDefault(); nextQ(); }
  }
});

boot();
