/* home.js */
const $ = id => document.getElementById(id);

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Prefill name from session
const saved = sessionStorage.getItem('wbName');
if (saved) { $('createName').value = saved; $('joinName').value = saved; }

// Room code uppercase
$('roomCode').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g,'');
});

// Create
$('createBtn').addEventListener('click', async () => {
  const name = $('createName').value.trim();
  if (!name) { shake('createName'); return; }
  const btn = $('createBtn');
  btn.disabled = true; btn.textContent = 'CREATING…';
  try {
    const r = await fetch('/api/create_room', { method:'POST' });
    const { code } = await r.json();
    sessionStorage.setItem('wbName', name);
    window.location.href = `/room/${code}`;
  } catch {
    btn.disabled = false; btn.innerHTML = '<span>💣</span> CREATE GAME';
    toast('Failed to create room', 'error');
  }
});

// Join
$('joinBtn').addEventListener('click', async () => {
  const name = $('joinName').value.trim();
  const code = $('roomCode').value.trim().toUpperCase();
  if (!name) { shake('joinName'); return; }
  if (code.length !== 4) { shake('roomCode'); return; }
  const btn = $('joinBtn');
  btn.disabled = true; btn.textContent = 'CHECKING…';
  try {
    const r = await fetch(`/api/check_room/${code}`);
    const d = await r.json();
    if (!d.exists) {
      btn.disabled = false; btn.innerHTML = '<span>🚀</span> JOIN GAME';
      shake('roomCode'); toast('Room not found!', 'error'); return;
    }
    if (d.state === 'playing') {
      btn.disabled = false; btn.innerHTML = '<span>🚀</span> JOIN GAME';
      toast('Game already in progress!', 'error'); return;
    }
    sessionStorage.setItem('wbName', name);
    window.location.href = `/room/${code}`;
  } catch {
    btn.disabled = false; btn.innerHTML = '<span>🚀</span> JOIN GAME';
    toast('Network error', 'error');
  }
});

// Enter keys
$('createName').addEventListener('keydown', e => e.key==='Enter' && $('createBtn').click());
$('joinName').addEventListener('keydown',   e => e.key==='Enter' && $('joinBtn').click());
$('roomCode').addEventListener('keydown',   e => e.key==='Enter' && $('joinBtn').click());

function shake(id) {
  const el = $(id); el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400); el.focus();
}
function toast(msg, type='info') {
  const c = $('toastContainer'), el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg; c.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3000);
}
