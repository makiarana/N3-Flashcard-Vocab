const WORDS = window.N3_WORDS;
const SESSION = 20;
const INTERVALS = [0,1,3,7,14,30,60,120]; // days per box
const MASTER_BOX = 5;                     // box 5+ = 30-day interval or longer
const LS = "n3deck-v1";

const today = () => { const d=new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset()*60000)/86400000); };
let S = fresh();
function fresh(){ return {v:1, cards:{}, dir:"jp", streak:0, lastDay:null, doneDay:null, todayCount:0, sessions:0}; }

/* ---------- storage: Firebase (online, per Google account) + localStorage on this device ---------- */
// Signed out: progress lives only in this browser.
// Signed in: progress is saved to Firestore at users/{uid}/deck/n3 and mirrored in this browser.
let docRef = null, user = null, saving = false, pending = false, saveTimer = null;
const syncEl = document.getElementById("sync");
const acctEl = document.getElementById("acct");
function setSync(t, s){ syncEl.textContent = t; syncEl.dataset.s = s||""; }
const lsKey = () => user ? LS + ":" + user.uid : LS;
function lsRead(k){ try{ const r=localStorage.getItem(k||lsKey()); return r?Object.assign(fresh(), JSON.parse(r)):null; }catch(e){ return null; } }
function lsWrite(){ try{ localStorage.setItem(lsKey(), JSON.stringify(S)); }catch(e){} }
function save(){
  lsWrite();
  if(!docRef) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 1200); // group quick answers into one write
}
async function flush(){
  if(!docRef) return;
  if(saving){ pending = true; return; }
  saving = true; setSync("Saving…");
  try{
    do{ pending=false; await docRef.set(JSON.parse(JSON.stringify(S))); }while(pending);
    setSync("Saved online");
  }catch(e){ setSync(navigator.onLine===false ? "Offline — saved on this device, will sync later" : "Couldn't save online — saved on this device", "err"); }
  saving = false;
}
window.addEventListener("pagehide", ()=>{ if(saveTimer){ clearTimeout(saveTimer); flush(); } });
window.addEventListener("online", ()=>{ if(docRef) flush(); });

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
async function pullRemote(){
  if(!docRef) return;
  try{
    const snap = await docRef.get();
    if(snap.exists){
      const remote = Object.assign(fresh(), snap.data());
      const before = JSON.stringify(S);
      S = mergeState(S, remote);
      lsWrite();
      if(JSON.stringify(S) !== JSON.stringify(remote)) save();
      if(!session && JSON.stringify(S)!==before) render();
    } else save();
    setSync("Synced");
  }catch(e){ setSync("Couldn't reach the server — using this device's copy", "err"); }
}
function boot(){
  S = lsRead() || fresh();
  render();
  if(!window.FB_READY){ setSync("Saving on this device only (online sync not set up)"); return; }
  setSync("Checking sign-in…");
  firebase.auth().onAuthStateChanged(async u => {
    if(u){
      const guest = user ? null : lsRead(LS);   // progress made while signed out
      user = u; docRef = firebase.firestore().collection("users").doc(u.uid).collection("deck").doc("n3");
      S = lsRead() || fresh();
      if(guest && Object.keys(guest.cards).length){ S = mergeState(S, guest); try{ localStorage.removeItem(LS); }catch(e){} }
      renderAccount(); if(!session) render();
      setSync("Syncing…");
      await pullRemote();
    } else {
      user = null; docRef = null;
      S = lsRead() || fresh();
      renderAccount(); session = null; render();
      setSync("Signed out — saving on this device only");
    }
  });
  // pick up reviews done on another device when you come back to this tab
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && !session) pullRemote(); });
}

/* ---------- scheduling ---------- */
function rollDay(){
  const t = today();
  if(S.lastDay !== t){ S.todayCount = 0; S.lastDay = t; }
}
function counts(){
  let m=0,r=0,l=0,due=0; const t=today();
  for(const k in S.cards){ const c=S.cards[k]; if(c[0]>=MASTER_BOX) m++; else if(c[0]>=3) r++; else l++; if(c[1]<=t) due++; }
  return {m,r,l,due,seen:m+r+l,total:WORDS.length};
}
function buildSession(){
  const t=today(), due=[];
  for(const k in S.cards){ const c=S.cards[k]; if(c[1]<=t) due.push([+k, c[0], c[1]]); }
  // missed cards (box 0) first, then oldest-due
  due.sort((a,b)=> a[1]-b[1] || a[2]-b[2]);
  const ids = due.slice(0, SESSION).map(x=>x[0]);
  for(let i=0; ids.length<SESSION && i<WORDS.length; i++) if(!S.cards[i]) ids.push(i);
  // shuffle lightly so order isn't predictable
  for(let i=ids.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [ids[i],ids[j]]=[ids[j],ids[i]]; }
  return ids;
}
function rate(id, grade){ // 0 again, 1 good, 2 easy
  const t=today(); const c=S.cards[id] || [0,t,0,0];
  if(grade===0){ c[0]=0; c[1]=t; c[2]++; }
  else { c[0]=Math.min(INTERVALS.length-1, c[0]+grade); c[1]=t+INTERVALS[c[0]]; }
  c[3]++;
  S.cards[id]=c;
}

/* ---------- views ---------- */
const view = document.getElementById("view");
let session = null; // {queue, pos, revealed, results:{id:bool}, firstPass:n, retry:Set}

function renderLedger(){
  const c=counts(), pct=c.total?c.m/c.total*100:0;
  document.getElementById("pct").innerHTML = (pct<10?pct.toFixed(1):Math.round(pct))+"%<span> · "+c.m+" words</span>";
  document.getElementById("seen").innerHTML = c.seen+"<span> / "+c.total+"</span>";
  const bar=document.getElementById("bar").children;
  bar[0].style.width=(c.m/c.total*100)+"%"; bar[1].style.width=(c.r/c.total*100)+"%"; bar[2].style.width=(c.l/c.total*100)+"%";
  document.getElementById("bar").setAttribute("aria-label", `${c.m} mastered, ${c.r} reviewing, ${c.l} learning, ${c.total-c.seen} new`);
  document.getElementById("legend").innerHTML =
    `<span><i class="sw" style="background:var(--master)"></i>Mastered <b>${c.m}</b></span>`+
    `<span><i class="sw" style="background:var(--review)"></i>Reviewing <b>${c.r}</b></span>`+
    `<span><i class="sw" style="background:var(--learn)"></i>Learning <b>${c.l}</b></span>`+
    `<span><i class="sw" style="background:var(--new)"></i>New <b>${c.total-c.seen}</b></span>`;
  rollDay();
  document.getElementById("due").textContent=c.due;
  document.getElementById("today").textContent=S.todayCount;
  const t=today(), alive = S.doneDay===t || S.doneDay===t-1;
  document.getElementById("streak").textContent = alive ? S.streak : 0;
}

function render(){ renderLedger(); session ? renderCard() : renderHome(); }

function esc(s){ return s.replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])); }

function renderHome(summary){
  const c=counts(), t=today();
  const dueN=Math.min(c.due,SESSION), newN=Math.max(0,Math.min(SESSION-dueN, c.total-c.seen));
  let top="";
  if(summary){
    const missed=summary.missed.map(i=>`<span title="${esc(WORDS[i][2])}">${esc(WORDS[i][0])}</span>`).join("");
    top = `<div class="done"><div class="stamp">済</div><div><h2>Session done — ${summary.ok} of ${summary.n} on the first try</h2>
      <div class="plan">${summary.missed.length? "These come back in your next session:" : "Clean run. Nothing carried over."}</div></div></div>
      ${summary.missed.length?`<div class="miss">${missed}</div>`:""}`;
  } else {
    top = `<h2>${c.seen? "Today's session" : "Start your first session"}</h2>`;
  }
  view.innerHTML = `<div class="home">${top}
    <div class="plan"><span>Next 20: <b>${dueN}</b> to review · <b>${newN}</b> new</span></div>
    <div class="row">
      <button class="primary" id="go" ${dueN+newN?"":"disabled"}>${summary?"Start another 20":"Start 20 cards"}</button>
      <div class="seg" role="group" aria-label="Card direction">
        <button id="d-jp" aria-pressed="${S.dir==="jp"}">日本語 → English</button>
        <button id="d-en" aria-pressed="${S.dir==="en"}">English → 日本語</button>
      </div>
    </div>
    <div class="backup">
      <h3>Back up your progress</h3>
      <p>Your progress already saves online when you're signed in. You can also save a progress file (.md) to your computer, and load it on any account or device to pick up where you left off. ${backupAge()}</p>
      <div class="row">
        <button id="exp">Save progress file</button>
        <button id="impBtn">Load progress file</button>
        <input type="file" id="impFile" class="vh" accept=".md,.txt,.json,text/markdown,text/plain">
        <button class="ghost" id="pasteBtn">or paste it</button>
      </div>
      <div id="bkArea"></div>
    </div>
    <div class="row" id="resetRow"><button class="ghost" id="reset">Reset all progress</button></div>
  </div>`;
  wireBackup(summary);
  document.getElementById("go").onclick=start;
  document.getElementById("d-jp").onclick=()=>{S.dir="jp";save();renderHome(summary);};
  document.getElementById("d-en").onclick=()=>{S.dir="en";save();renderHome(summary);};
  document.getElementById("reset").onclick=()=>{
    document.getElementById("resetRow").innerHTML=`<span class="confirm">Erase every review and start from zero?
      <button class="ghost" id="rYes" style="color:var(--shu)">Yes, reset</button><button class="ghost" id="rNo">Cancel</button></span>`;
    document.getElementById("rYes").onclick=()=>{S=fresh();save();render();};
    document.getElementById("rNo").onclick=()=>renderHome(summary);
  };
}

/* ---------- backup: export / import a .md progress file ---------- */
function dateStr(d){ d=d||new Date(); const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function backupAge(){
  if(!S.lastBackup) return "You haven't saved one yet.";
  const d=today()-S.lastBackup;
  return d<=0? "Last saved today." : d===1? "Last saved yesterday." : `Last saved ${d} days ago.`;
}
function mdCell(s){ return String(s).replace(/\|/g,"\\|"); }
function buildMarkdown(){
  const c=counts(), now=new Date();
  const weak=Object.keys(S.cards).map(Number).filter(i=>S.cards[i][2]>0 && S.cards[i][0]<MASTER_BOX)
    .sort((a,b)=>S.cards[b][2]-S.cards[a][2]).slice(0,40);
  const reviews=Object.values(S.cards).reduce((n,x)=>n+x[3],0);
  const t=today(), streak=(S.doneDay===t||S.doneDay===t-1)?S.streak:0;
  const data={app:"n3-deck",v:1,saved:now.toISOString(),words:WORDS.length,state:S};
  let md=`# N3 Vocabulary Deck — progress\n\nSaved ${dateStr(now)} ${now.toTimeString().slice(0,5)}\n\n`+
`| | |\n|---|---|\n| Mastered (30+ day gap) | ${c.m} |\n| Reviewing | ${c.r} |\n| Learning | ${c.l} |\n| Not seen yet | ${c.total-c.seen} |\n| Words seen | ${c.seen} / ${c.total} |\n| Total reviews | ${reviews} |\n| Day streak | ${streak} |\n| Due today | ${c.due} |\n\n`;
  if(weak.length){
    md+=`## Words to work on\n\nMost-missed words that aren't mastered yet.\n\n| Word | Reading | Meaning | Missed |\n|---|---|---|---|\n`;
    for(const i of weak){ const w=WORDS[i]; md+=`| ${mdCell(w[0])} | ${mdCell(w[1]||"")} | ${mdCell(w[2])} | ${S.cards[i][2]} |\n`; }
    md+="\n";
  }
  md+=`## How to restore\n\n1. Open your N3 Vocabulary Deck site (signed in with any Google account, or signed out).\n2. On the start screen, choose **Load progress file** and pick this file. You can also paste the whole file with **or paste it**.\n3. Check the preview, then choose **Restore**.\n\nDon't edit the data block below. The deck reads it to rebuild your schedule.\n\n## Data\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
  return md;
}
function parseBackup(text){
  const m=text.match(/```json\s*([\s\S]*?)```/);
  let obj; try{ obj=JSON.parse(m?m[1]:text.trim()); }catch(e){ throw new Error("Couldn't find the progress data in that file. Use a file saved by this deck, without edits to the Data section."); }
  if(!obj || obj.app!=="n3-deck" || !obj.state || typeof obj.state.cards!=="object") throw new Error("That file isn't an N3 deck progress file.");
  if(obj.words!==WORDS.length) throw new Error(`That file was made for a ${obj.words}-word list, but this deck has ${WORDS.length} words, so the cards wouldn't line up.`);
  const cards={};
  for(const k in obj.state.cards){ const v=obj.state.cards[k];
    if(Array.isArray(v) && v.length===4 && v.every(n=>Number.isFinite(n)) && +k>=0 && +k<WORDS.length) cards[k]=v; }
  return {saved:obj.saved, state:Object.assign(fresh(), obj.state, {cards})};
}
function mergeState(a,b){ // keep whichever record has more reviews for each card
  const out=Object.assign(fresh(), a, {cards:Object.assign({}, a.cards)});
  for(const k in b.cards){ const x=out.cards[k], y=b.cards[k];
    if(!x || y[3]>x[3] || (y[3]===x[3] && y[0]>x[0])) out.cards[k]=y.slice(); }
  if((b.doneDay||0)>(a.doneDay||0)){ out.doneDay=b.doneDay; out.streak=b.streak; }
  if(b.lastDay===a.lastDay) out.todayCount=Math.max(a.todayCount||0,b.todayCount||0);
  else if((b.lastDay||0)>(a.lastDay||0)){ out.lastDay=b.lastDay; out.todayCount=b.todayCount; }
  out.sessions=Math.max(a.sessions||0,b.sessions||0);
  out.lastBackup=Math.max(a.lastBackup||0,b.lastBackup||0)||null;
  return out;
}
function wireBackup(summary){
  const area=document.getElementById("bkArea");
  const say=(t,cls)=>{ area.innerHTML=`<div class="msg ${cls||""}">${esc(t)}</div>`; };
  document.getElementById("exp").onclick=async()=>{
    const md=buildMarkdown(), name=`n3-progress-${dateStr()}.md`;
    try{
      const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"})); a.download=name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
      S.lastBackup=today(); save(); renderHome(summary);
      document.getElementById("bkArea").innerHTML=`<div class="msg ok">Saved ${esc(name)} to your downloads.</div>`; return;
    }catch(e){}
    // fallback: show the file to copy
    area.innerHTML=`<div class="msg">Saving files isn't available here. Copy this text into a file named <b>${esc(name)}</b>:</div>
      <textarea id="mdOut" readonly aria-label="Progress file text"></textarea><div class="row"><button id="cp">Copy text</button></div>`;
    const ta=document.getElementById("mdOut"); ta.value=md;
    document.getElementById("cp").onclick=async()=>{ try{ await navigator.clipboard.writeText(md); S.lastBackup=today(); save(); document.getElementById("cp").textContent="Copied"; }catch(e){ ta.focus(); ta.select(); } };
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
    const n=Object.keys(b.state.cards).length, m=Object.values(b.state.cards).filter(x=>x[0]>=MASTER_BOX).length;
    const cur=Object.keys(S.cards).length;
    area.innerHTML=`<div class="preview"><div>File saved <b>${esc((b.saved||"").slice(0,10)||"unknown date")}</b>: <b>${n}</b> words seen, <b>${m}</b> mastered.</div>
      <div>${cur? `This deck already has ${cur} words seen. <b>Restore</b> combines both, keeping whichever record has more reviews for each word.` : "This deck is empty, so the file will be restored as-is."}</div>
      <div class="row"><button class="primary" id="doImp">Restore</button>${cur?`<button id="doRep">Replace instead</button>`:""}<button class="ghost" id="noImp">Cancel</button></div></div>`;
    document.getElementById("doImp").onclick=()=>finishImport(mergeState(S,b.state));
    if(cur) document.getElementById("doRep").onclick=()=>finishImport(Object.assign(b.state,{dir:S.dir}));
    document.getElementById("noImp").onclick=()=>{ area.innerHTML=""; };
  }
  function finishImport(st){
    S=st; save(); render();
    document.getElementById("bkArea").innerHTML=`<div class="msg ok">Progress restored: ${Object.keys(S.cards).length} words seen.</div>`;
  }
}

function start(){
  const q=buildSession(); if(!q.length) return;
  session={queue:q, pos:0, revealed:false, results:{}, n:q.length};
  render();
}

function wordHTML(w, withReading){
  return withReading && w[1] ? `<ruby>${esc(w[0])}<rt>${esc(w[1])}</rt></ruby>` : esc(w[0]);
}

function renderCard(){
  const s=session, id=s.queue[s.pos], w=WORDS[id], retry = s.pos>=s.n;
  const isNew=!S.cards[id];
  const dots=s.queue.slice(0,s.n).map((q,i)=>`<i class="${i===s.pos?"cur":(q in s.results?(s.results[q]?"ok":"no"):"")}"></i>`).join("");
  let front, back="";
  if(S.dir==="jp"){
    front=`<div class="word" lang="ja">${wordHTML(w, s.revealed)}</div>`;
    if(s.revealed) back=`<div class="back"><div class="meaning">${esc(w[2])}</div></div>`;
  } else {
    front=`<div class="prompt-en">${esc(w[2])}</div>`;
    if(s.revealed) back=`<div class="back"><div class="word" lang="ja" style="font-size:clamp(2rem,9vw,3rem)">${wordHTML(w,true)}</div></div>`;
  }
  const tag = retry? `<span class="tag again">Retry</span>` : isNew? `<span class="tag">New word</span>` : (S.cards[id][0]===0?`<span class="tag again">Missed before</span>`:`<span class="tag">Review</span>`);
  const box = S.cards[id]?S.cards[id][0]:0;
  const gi = Math.min(INTERVALS.length-1,box+1), ei=Math.min(INTERVALS.length-1,box+2);
  const fmt=d=> d>=30? Math.round(d/30)+"mo" : d+"d";
  view.innerHTML = `<div class="sess">
    <div class="sbar"><span>${Math.min(s.pos+1,s.n)}/${s.n}${retry?" +retry":""}</span><div class="dots">${dots}</div>
      <button class="ghost" id="quit" title="End session">End</button></div>
    <div class="card" id="card" tabindex="0" role="button" aria-label="${s.revealed?"Card answer":"Reveal answer"}">${tag}${front}${back}
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
    rate(id,g); rollDay(); S.todayCount++;
    s.results[id]= g>0;
    if(g===0) s.queue.push(id); // see it once more at the end of this session
    save();
  } else if(g===0){
    // still missed on retry: stays due today, shows up again next session
  }
  s.pos++; s.revealed=false;
  if(s.pos>=s.queue.length) finish(); else render();
}
function finish(){
  const s=session; session=null;
  const answered=Object.keys(s.results).length;
  if(answered){
    const t=today();
    if(S.doneDay!==t){ S.streak = (S.doneDay===t-1? S.streak:0)+1; S.doneDay=t; }
    S.sessions++; save();
  }
  renderLedger();
  if(!answered){ renderHome(); return; }
  const missed=Object.keys(s.results).filter(k=>!s.results[k]).map(Number);
  renderHome({n:answered, ok:answered-missed.length, missed});
}

document.addEventListener("keydown",e=>{
  if(!session || e.target.closest("input,textarea")) return;
  if(e.key===" "||e.key==="Enter"){ if(!session.revealed){ e.preventDefault(); flip(); } }
  else if(session.revealed && ["1","2","3"].includes(e.key)) answer(+e.key-1);
});

boot();
