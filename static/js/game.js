'use strict';
const ROOM = window.ROOM_CODE;

/* ── State ─────────────────────────────────────── */
let myPid = null, myName = '', isHost = false, gs = null, sse = null;
let timerRaf = null, timerEnd = null, timerTotal = 15;
let lastTier = 0, totalWords = 0;

/* ── Helpers ──────────────────────────────────── */
const $   = id => document.getElementById(id);
const esc = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const COLORS = [
  ['#ff4757','#2d0a0e'],['#ffd32a','#2d2400'],['#2ed573','#082d14'],
  ['#1e90ff','#05162d'],['#ff6b81','#2d0615'],['#a29bfe','#100d2d'],
  ['#fd9644','#2d1500'],['#00cec9','#002d2c'],['#6c5ce7','#0d0b2d'],['#fdcb6e','#2d2000'],
];
const playerColor = p => COLORS[(p.color ?? 0) % COLORS.length];
const initLetter  = p => (p.name||'?')[0].toUpperCase();

const TIER_LABELS = { 1:'EASY', 2:'MEDIUM', 3:'HARD', 4:'INSANE' };
const TIER_COLORS = { 1:'var(--green)', 2:'#ffcc00', 3:'#ff6400', 4:'var(--accent)' };
const TIER_BOMB_MSGS = {
  2: ['🔥 HEATING UP!', '⚡ MEDIUM MODE'],
  3: ['💀 GETTING DANGEROUS', '🔥 HARD MODE'],
  4: ['☠️ INSANE MODE', '💣 GOOD LUCK'],
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function toast(msg, type='info', dur=3200) {
  const c=$('toastContainer'), el=document.createElement('div');
  el.className=`toast ${type}`; el.textContent=msg; c.appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),310); }, dur);
}
async function api(url, body) {
  try {
    const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return await r.json();
  } catch { return {ok:false,error:'Network error'}; }
}
function getPid() {
  let p = sessionStorage.getItem('wbPid');
  if (!p) { p = Date.now().toString(36)+Math.random().toString(36).slice(2); sessionStorage.setItem('wbPid',p); }
  return p;
}

/* ── Init ───────────────────────────────────────── */
window.addEventListener('load', ()=>{
  myPid = getPid();
  const saved = sessionStorage.getItem('wbName');
  if (saved) $('modalName').value = saved;
  $('nameModal').style.display = 'flex';
  $('modalJoinBtn').addEventListener('click', doJoin);
  $('modalName').addEventListener('keydown', e=>{ if(e.key==='Enter') doJoin(); });
});

async function doJoin() {
  const name = $('modalName').value.trim();
  if (!name) { shakeEl('modalName'); return; }
  myName=name; sessionStorage.setItem('wbName',name);
  $('nameModal').style.display='none';
  const res = await api('/api/join',{room_code:ROOM,name,player_id:myPid});
  if (!res.ok) { toast(res.error||'Failed to join','error'); $('nameModal').style.display='flex'; return; }
  gs=res.room; isHost=(gs.host===myPid);
  if (gs.state==='playing') { showScreen('screen-game'); renderSidebar(); updateTurn(gs.cur_pid,gs.fragment,gs.round,gs.limit,gs.tier); }
  else { renderLobby(); showScreen('screen-lobby'); }
  connectSSE(); setupListeners();
  window.addEventListener('beforeunload', ()=>navigator.sendBeacon('/api/leave',JSON.stringify({room_code:ROOM,player_id:myPid})));
}

/* ── SSE ────────────────────────────────────────── */
function connectSSE() {
  if (sse) sse.close();
  sse = new EventSource(`/api/events/${ROOM}/${myPid}_${Date.now()}`);
  sse.onmessage = e => handle(JSON.parse(e.data));
  sse.onerror   = ()=> setTimeout(connectSSE,1500);
}

/* ── Event handler ──────────────────────────────── */
function handle(ev) {
  const {type,data} = ev;

  if (type==='player_joined') {
    if (!gs) return;
    gs.players=data.players; gs.host=data.host; isHost=(gs.host===myPid);
    renderLobby();
    if (data.player.id!==myPid) toast(`${data.player.name} joined the lobby`,'info',2000);

  } else if (type==='player_left') {
    if (!gs) return;
    gs.players=data.players; gs.host=data.host; isHost=(gs.host===myPid);
    renderLobby(); toast(`${data.player_name} left`,'info',2000);

  } else if (type==='game_started') {
    gs=data.room; isHost=(gs.host===myPid); totalWords=0; lastTier=1;
    $('chipList').innerHTML='';
    showScreen('screen-game'); renderSidebar();
    updateTurn(gs.cur_pid,gs.fragment,gs.round,gs.limit,gs.tier);
    toast('💣 Game on!','info',2000);

  } else if (type==='new_turn') {
    const newTier = data.tier||1;
    // Check if tier increased — show dramatic transition
    if (newTier > lastTier && lastTier > 0) {
      showDiffTransition(newTier);
    }
    lastTier = newTier;
    gs.cur_pid=data.cur_pid; gs.fragment=data.fragment;
    gs.round=data.round;     gs.players=data.players;
    gs.limit=data.limit;     gs.tier=data.tier;
    renderSidebar();
    updateTurn(data.cur_pid,data.fragment,data.round,data.limit,data.tier);
    clearFeedback();
    $('wordInput').value='';

  } else if (type==='word_accepted') {
    if (gs) { gs.players=data.players; renderSidebar(); }
    addChip(data.word,data.fragment,true);
    totalWords++;
    if (data.player_id!==myPid) {
      const msg = data.bonus_streak
        ? `🔥 ${data.player_name}: ${data.word} (streak ×${data.streak}!)`
        : `${data.player_name}: ${data.word}`;
      toast(msg,'success',2000);
    }
    if (data.bonus_streak && data.player_id===myPid) {
      showStreakPopup(data.streak);
    }
    clearFeedback();

  } else if (type==='time_up') {
    stopTimer();
    if (gs) { gs.players=data.players; renderSidebar(); }
    toast(`💥 ${data.player_name} ran out of time! (${data.lives}❤ left)`,'error',3500);
    if (data.player_id===myPid) showFeedback("⏰ Time's up! −1 life",'err');

  } else if (type==='game_over') {
    stopTimer(); showGameOver(data);
  }
}

/* ── Lobby render ───────────────────────────────── */
function renderLobby() {
  const grid=$('lobbyGrid'); grid.innerHTML='';
  (gs?.players||[]).forEach(p=>{
    const[fg,bg]=playerColor(p); const you=p.id===myPid; const host=p.id===gs?.host;
    const div=document.createElement('div');
    div.className='player-card-lobby'+(you?' you':'')+(host?' is-host':'');
    div.innerHTML=`<div class="p-avatar" style="background:${bg};color:${fg}">${initLetter(p)}</div>
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-badges">
        ${you?'<span class="badge badge-you">YOU</span>':''}
        ${host?'<span class="badge badge-host">HOST</span>':''}
      </div>`;
    grid.appendChild(div);
  });
  const hc=$('hostCtrl'),gc=$('guestCtrl'),sb=$('startBtn'),st=$('lobbyStatus');
  const count=(gs?.players||[]).length;
  if (isHost) {
    hc.classList.remove('hidden'); gc.classList.add('hidden');
    sb.disabled=count<2;
    st.textContent=count<2?`Waiting for players… (${count}/2 minimum)`:`${count} players ready — start when set!`;
  } else {
    hc.classList.add('hidden'); gc.classList.remove('hidden');
  }
}

/* ── Sidebar render ─────────────────────────────── */
function renderSidebar() {
  const sb=$('sidebar'); sb.innerHTML='<div class="sidebar-label">PLAYERS</div>';
  (gs?.players||[]).forEach(p=>{
    const[fg,bg]=playerColor(p);
    const you=p.id===myPid, cur=p.id===gs?.cur_pid, elim=!p.active||p.lives<=0;
    const div=document.createElement('div');
    div.className='pcg'+(cur?' active':'')+(elim?' elim':'')+(you?' you':'');
    const lives=[0,1,2].map(i=>`<div class="life${i>=p.lives?' gone':''}"></div>`).join('');
    div.innerHTML=`<div class="pcg-row1">
        <div class="pcg-avatar" style="background:${bg};color:${fg}">${initLetter(p)}</div>
        <div class="pcg-name">${esc(p.name)}${you?'<span style="opacity:.4;font-size:.7em"> you</span>':''}</div>
      </div>
      <div class="pcg-lives">${lives}</div>
      <div class="pcg-meta">
        <span class="pcg-score">${p.score} pts</span>
        <span class="pcg-status ${elim?'out':cur?'typing':''}">${elim?'💀':cur?'✍️':''}</span>
      </div>`;
    sb.appendChild(div);
  });
}

/* ── Update turn ────────────────────────────────── */
function updateTurn(curPid,fragment,round,limit,tier) {
  const mine=curPid===myPid;
  const banner=$('turnBanner');
  const player=(gs?.players||[]).find(p=>p.id===curPid);
  const name=player?.name||'?';
  tier=tier||1;

  // Header badges
  $('roundNum').textContent=round||1;
  const diffBadge=$('diffBadge');
  diffBadge.textContent=TIER_LABELS[tier]||'EASY';
  diffBadge.className=`diff-badge diff-${tier}`;

  // Arena meta strip
  $('arenaRound').textContent=`ROUND ${round||1}`;
  const timerEl=$('arenaTimer');
  timerEl.textContent=`${limit}s`;
  timerEl.style.color=TIER_COLORS[tier];
  const diffEl=$('arenaDiff');
  diffEl.textContent=TIER_LABELS[tier];
  diffEl.style.color=TIER_COLORS[tier];

  // Turn banner
  if (mine) { banner.textContent='🎯 YOUR TURN — type a word!'; banner.classList.add('your-turn'); }
  else       { banner.innerHTML=`⏳ <strong>${esc(name)}</strong>'s turn`; banner.classList.remove('your-turn'); }

  // Fragment
  const fEl=$('bombFrag');
  fEl.style.animation='none'; void fEl.offsetHeight; fEl.style.animation='';
  fEl.textContent=fragment||'??';

  // Bomb shell tier colour class
  const shell=$('bombShell');
  shell.className=`bomb-shell tier-${tier}`;

  // Fuse spark visibility
  $('bombSpark').classList.toggle('hidden', !mine);

  // Input state
  const inp=$('wordInput'),sub=$('submitBtn');
  inp.disabled=!mine; sub.disabled=!mine;
  inp.classList.toggle('my-turn',mine);
  if (mine) { inp.focus(); } else { inp.value=''; }

  timerTotal=limit||15;
  startTimer(timerTotal,tier);
}

/* ── Timer ──────────────────────────────────────── */
const CIRCUM = 2*Math.PI*92; // r=92 → 578.1

function startTimer(secs,tier) {
  stopTimer();
  timerEnd=performance.now()+secs*1000; timerTotal=secs;
  tickTimer(tier||1);
}
function tickTimer(tier) {
  const now=performance.now(), left=Math.max(0,(timerEnd-now)/1000);
  const frac=left/timerTotal;
  $('timerCircle').style.strokeDashoffset=CIRCUM*(1-frac);
  $('timerSecs').textContent=Math.ceil(left);
  // Color gradient green→yellow→red, modulated by tier
  let col;
  if (tier>=4)     col = frac>.3 ? '#ff3a4e' : '#fff';   // insane: always red/white flash
  else if (frac>.5) col='#00e676';
  else if (frac>.25) col='#ffcc00';
  else               col='#ff3a4e';
  $('timerCircle').style.stroke=col;
  // Danger on last 3s
  const shell=$('bombShell');
  if (left<=3&&left>0) shell.classList.add('danger');
  else shell.classList.remove('danger');
  if (left>0) timerRaf=requestAnimationFrame(()=>tickTimer(tier));
}
function stopTimer() {
  if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf=null; }
  $('bombShell')?.classList.remove('danger');
}

/* ── Difficulty transition ──────────────────────── */
function showDiffTransition(tier) {
  const msgs = TIER_BOMB_MSGS[tier] || [];
  if (!msgs.length) return;
  const msg = msgs[Math.floor(Math.random()*msgs.length)];
  const overlay=document.createElement('div');
  overlay.className=`diff-flash tier-${tier}`;
  overlay.innerHTML=`<div class="diff-flash-inner">${msg}</div>`;
  document.body.appendChild(overlay);
  setTimeout(()=>overlay.remove(), 900);
}

/* ── Streak popup ───────────────────────────────── */
function showStreakPopup(streak) {
  const el=document.createElement('div');
  el.className='streak-popup';
  el.textContent=`🔥 ${streak}× STREAK!`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 900);
}

/* ── Listeners ──────────────────────────────────── */
function setupListeners() {
  $('startBtn').addEventListener('click', async()=>{
    const r=await api('/api/start',{room_code:ROOM,player_id:myPid});
    if (!r.ok) toast(r.error||'Could not start','error');
  });
  $('copyBtn').addEventListener('click', ()=>{
    navigator.clipboard.writeText(ROOM).then(()=>toast('Room code copied!','success',2000));
  });
  $('submitBtn').addEventListener('click',   submitWord);
  $('wordInput').addEventListener('keydown', e=>{ if(e.key==='Enter') submitWord(); });
  $('playAgainBtn').addEventListener('click', ()=>window.location.reload());
  $('homeBtn').addEventListener('click',      ()=>{ window.location.href='/'; });
}

async function submitWord() {
  const inp=$('wordInput'), word=inp.value.trim().toLowerCase();
  if (!word) return;
  inp.disabled=true; $('submitBtn').disabled=true;
  const r=await api('/api/submit_word',{room_code:ROOM,player_id:myPid,word});
  if (!r.ok) {
    showFeedback(r.error||'Invalid word','err');
    shakeEl('wordInput');
    inp.disabled=false; $('submitBtn').disabled=false; inp.focus();
  }
}

/* ── Word chips ─────────────────────────────────── */
function addChip(word,fragment,fresh) {
  const list=$('chipList'), chip=document.createElement('div');
  chip.className='chip'+(fresh?' fresh':'');
  const fl=(fragment||'').toLowerCase(), wl=word.toLowerCase(), idx=wl.indexOf(fl);
  if (idx>=0) chip.innerHTML=esc(word.slice(0,idx))+`<strong>${esc(word.slice(idx,idx+fl.length))}</strong>`+esc(word.slice(idx+fl.length));
  else chip.textContent=word;
  list.prepend(chip);
  while (list.children.length>40) list.removeChild(list.lastChild);
  if (fresh) setTimeout(()=>chip.classList.remove('fresh'),1800);
}

/* ── Feedback ───────────────────────────────────── */
function showFeedback(msg,cls){ const el=$('feedback'); el.textContent=msg; el.className=`input-feedback ${cls}`; }
function clearFeedback()      { const el=$('feedback'); el.textContent=''; el.className='input-feedback'; }
function shakeEl(id)          { const el=$(id); el.classList.add('shake'); setTimeout(()=>el.classList.remove('shake'),400); }

/* ── Game Over ──────────────────────────────────── */
function showGameOver(data) {
  stopTimer();
  $('goWinner').textContent=data.winner_name||'Nobody';
  $('goRounds').textContent=data.max_round||'?';
  $('goWords').textContent=totalWords;
  const sc=$('goScores'); sc.innerHTML='';
  (data.players||[]).sort((a,b)=>b.score-a.score).forEach(p=>{
    const d=document.createElement('div'); d.className='go-score-item';
    d.innerHTML=`<div class="go-score-name">${esc(p.name)}</div><div class="go-score-pts">${p.score} pts</div>`;
    sc.appendChild(d);
  });
  showScreen('screen-gameover');
}

/* ── Visibility sync ────────────────────────────── */
document.addEventListener('visibilitychange', ()=>{
  if (!document.hidden&&myPid) {
    fetch(`/api/sync/${ROOM}/${myPid}`).then(r=>r.json()).then(d=>{
      if (!d.ok||!d.room) return;
      gs=d.room; isHost=(gs.host===myPid);
      if      (gs.state==='lobby')   { renderLobby();   showScreen('screen-lobby'); }
      else if (gs.state==='playing') { renderSidebar(); showScreen('screen-game'); updateTurn(gs.cur_pid,gs.fragment,gs.round,gs.limit,gs.tier); }
    });
  }
});
