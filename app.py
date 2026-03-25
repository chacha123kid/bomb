import os, random, string, time, threading, json, sys
sys.path.insert(0, os.path.dirname(__file__))
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from wordlist_data import WORD_LIST

app = Flask(__name__)
app.config['SECRET_KEY'] = 'wordbomb-2024'

print(f"[WordBomb] Loaded {len(WORD_LIST):,} words")

# ── Difficulty tiers ────────────────────────────────────────────────────────────
FRAGMENTS = {
    1: ['in','an','re','on','at','is','or','ing','it','to','he','us','me','as',
        'am','be','ate','ess','ee','ent','oo','ion','ine','ous','ist','ble','per','do','so','no'],
    2: ['all','ness','ite','ill','pre','ell','ize','con','able','pro','the','ove',
        'ism','ive','ish','one','ting','dis','ation','ise','ay','int','ome','ide',
        'out','ful','age','are','ake','eal','and','oke','oom','ool','ork','ort',
        'ost','ock','ace','ice','oad','arc','ard','arm','ast','ect','end','ert','ew'],
    3: ['une','own','een','ence','sion','old','air','ular','hing','ape','ule',
        'ink','ank','uck','ook','oon','ping','uff','ction','ology','eer','ound',
        'ude','ump','inge','ible','atch','edge','idge','unge','etch','itch',
        'otch','utch','ange','ight','ough','tain','rain','eight','eigh','awn','isk','url','irk'],
    4: ['augh','ymph','quil','unct','zzle','rypt','warf','wick','olph','artz',
        'ution','aught','ought','arium','orium','stion','cion','onk','idge','utch',
        'otch','etch','urge','ust','yst'],
}

def get_tier(round_num):
    if round_num <= 3:  return 1
    if round_num <= 8:  return 2
    if round_num <= 16: return 3
    return 4

def get_time_limit(round_num):
    tier  = get_tier(round_num)
    base  = {1: 15, 2: 13, 3: 11, 4: 9}[tier]
    return max(5, round(base - round_num * 0.2, 1))

def pick_fragment(round_num, recent):
    pool = [f for f in FRAGMENTS[get_tier(round_num)] if f not in recent] or FRAGMENTS[get_tier(round_num)]
    return random.choice(pool).upper()

# ── SSE bus ─────────────────────────────────────────────────────────────────────
# Each subscriber gets a threading.Event + message queue.
# push() deposits a message and signals the event — zero sleep needed.
class SubChannel:
    def __init__(self):
        self.queue  = []
        self.event  = threading.Event()
        self.closed = False

    def put(self, msg):
        self.queue.append(msg)
        self.event.set()

    def drain(self):
        msgs, self.queue[:] = self.queue[:], []
        self.event.clear()
        return msgs

sse_channels = {}   # room_code -> {sub_id: SubChannel}
sse_lock      = threading.Lock()

def push(room_code, etype, data):
    msg = json.dumps({"type": etype, "data": data})
    with sse_lock:
        for ch in list(sse_channels.get(room_code, {}).values()):
            ch.put(msg)

# ── Room storage ────────────────────────────────────────────────────────────────
rooms      = {}
rooms_lock = threading.Lock()

def gen_code():
    while True:
        c = ''.join(random.choices(string.ascii_uppercase, k=4))
        if c not in rooms:
            return c

class Room:
    def __init__(self, code):
        self.code         = code
        self.players      = {}
        self.state        = 'lobby'
        self.fragment     = ''
        self.cur_pid      = None
        self.used         = set()
        self.round        = 0
        self.limit        = 15
        self.host         = None
        self.cancel       = threading.Event()
        self.recent_frags = []
        self.max_rounds   = 0

    def add(self, pid, name):
        color_idx = len(self.players) % 10
        self.players[pid] = {
            'id': pid, 'name': name, 'lives': 3,
            'score': 0, 'active': True, 'color': color_idx, 'streak': 0,
        }
        if not self.host:
            self.host = pid

    def remove(self, pid):
        self.players.pop(pid, None)
        if self.host == pid:
            rem = list(self.players)
            self.host = rem[0] if rem else None

    def alive(self):
        return [p for p, d in self.players.items() if d['active'] and d['lives'] > 0]

    def nxt(self):
        a = self.alive()
        if not a: return None
        if self.cur_pid not in a: return a[0]
        return a[(a.index(self.cur_pid) + 1) % len(a)]

    def to_dict(self):
        return {
            'code': self.code, 'state': self.state,
            'players': list(self.players.values()),
            'fragment': self.fragment, 'cur_pid': self.cur_pid,
            'round': self.round, 'host': self.host, 'limit': self.limit,
            'tier': get_tier(max(self.round, 1)),
            'used_count': len(self.used),
        }

def do_advance(code):
    r = rooms.get(code)
    if not r: return
    r.cancel.set()
    r.cancel       = threading.Event()
    r.cur_pid      = r.nxt()
    r.round       += 1
    r.max_rounds   = max(r.max_rounds, r.round)
    r.limit        = get_time_limit(r.round)
    r.fragment     = pick_fragment(r.round, r.recent_frags)
    r.recent_frags = (r.recent_frags + [r.fragment.lower()])[-4:]
    push(code, 'new_turn', {
        'cur_pid': r.cur_pid, 'fragment': r.fragment,
        'round': r.round, 'limit': r.limit,
        'tier': get_tier(r.round), 'players': list(r.players.values()),
    })
    _start_timer(code, r.cur_pid, r.cancel, r.limit)

def _start_timer(code, pid, cancel, limit):
    def _run():
        if cancel.wait(timeout=limit):
            return
        with rooms_lock:
            r = rooms.get(code)
            if not r or r.state != 'playing' or r.cur_pid != pid:
                return
            p = r.players.get(pid)
            if not p: return
            p['lives']  -= 1
            p['streak']  = 0
            if p['lives'] <= 0:
                p['active'] = False
                p['lives']  = 0
        push(code, 'time_up', {
            'player_id': pid,
            'player_name': r.players.get(pid, {}).get('name', '?'),
            'lives': r.players.get(pid, {}).get('lives', 0),
            'players': list(r.players.values()),
        })
        a = r.alive()
        if len(a) <= 1: do_end(code, a[0] if a else None)
        else:           do_advance(code)
    threading.Thread(target=_run, daemon=True).start()

def do_end(code, wid):
    r = rooms.get(code)
    if not r: return
    r.state = 'ended'
    r.cancel.set()
    wn = r.players.get(wid, {}).get('name', 'Nobody') if wid else 'Nobody'
    push(code, 'game_over', {
        'winner_id': wid, 'winner_name': wn,
        'players': list(r.players.values()),
        'max_round': r.max_rounds,
    })

def player_disconnect(code, pid):
    """Called when a player's SSE connection drops or they explicitly leave."""
    with rooms_lock:
        r = rooms.get(code)
        if not r or pid not in r.players:
            return
        name = r.players[pid]['name']
        r.remove(pid)
        if not r.players:
            del rooms[code]
            return
    push(code, 'player_left', {
        'player_id': pid, 'player_name': name,
        'players': list(r.players.values()), 'host': r.host,
    })
    if r.state == 'playing':
        a = r.alive()
        if len(a) <= 1: do_end(code, a[0] if a else None)
        elif r.cur_pid == pid: do_advance(code)

# ── Routes ──────────────────────────────────────────────────────────────────────
@app.route('/')
def index(): return render_template('index.html')

@app.route('/room/<code>')
def room_page(code):
    code = code.upper()
    if code not in rooms:
        return render_template('index.html', error=f'Room {code} not found.')
    return render_template('game.html', room_code=code)

@app.route('/api/create_room', methods=['POST'])
def create_room():
    with rooms_lock:
        code = gen_code()
        rooms[code] = Room(code)
    return jsonify({'code': code})

@app.route('/api/check_room/<code>')
def check_room(code):
    code = code.upper()
    r    = rooms.get(code)
    return jsonify({'exists': r is not None, 'state': r.state if r else None,
                    'player_count': len(r.players) if r else 0})

@app.route('/api/join', methods=['POST'])
def join():
    d    = request.json
    code = (d.get('room_code') or '').upper()
    name = (d.get('name') or 'Anon').strip()[:20]
    pid  = d.get('player_id', '')
    with rooms_lock:
        r = rooms.get(code)
        if not r:
            return jsonify({'ok': False, 'error': 'Room not found'}), 404
        if r.state == 'playing':
            return jsonify({'ok': False, 'error': 'Game already in progress'}), 400
        if pid not in r.players:
            r.add(pid, name)
    push(code, 'player_joined', {
        'player': r.players[pid], 'players': list(r.players.values()), 'host': r.host,
    })
    return jsonify({'ok': True, 'room': r.to_dict(), 'player_id': pid})

@app.route('/api/leave', methods=['POST'])
def leave():
    d    = request.json
    code = (d.get('room_code') or '').upper()
    pid  = d.get('player_id', '')
    player_disconnect(code, pid)
    return jsonify({'ok': True})

@app.route('/api/start', methods=['POST'])
def start():
    d    = request.json
    code = (d.get('room_code') or '').upper()
    pid  = d.get('player_id', '')
    with rooms_lock:
        r = rooms.get(code)
        if not r:
            return jsonify({'ok': False, 'error': 'Room not found'}), 404
        if r.host != pid:
            return jsonify({'ok': False, 'error': 'Only the host can start'}), 403
        if len(r.players) < 2:
            return jsonify({'ok': False, 'error': 'Need at least 2 players'}), 400
        r.state = 'playing'; r.used = set(); r.round = 0; r.recent_frags = []
        for p in r.players.values():
            p['lives'] = 3; p['score'] = 0; p['active'] = True; p['streak'] = 0
        r.cur_pid  = random.choice(r.alive())
        r.round    = 1
        r.limit    = get_time_limit(1)
        r.fragment = pick_fragment(1, [])
        r.recent_frags = [r.fragment.lower()]
        r.cancel   = threading.Event()
    push(code, 'game_started', {'room': r.to_dict()})
    _start_timer(code, r.cur_pid, r.cancel, r.limit)
    return jsonify({'ok': True})

@app.route('/api/submit_word', methods=['POST'])
def submit_word():
    d    = request.json
    code = (d.get('room_code') or '').upper()
    pid  = d.get('player_id', '')
    word = (d.get('word') or '').strip().lower()
    with rooms_lock:
        r = rooms.get(code)
        if not r or r.state != 'playing':
            return jsonify({'ok': False, 'error': 'Game not active'})
        if r.cur_pid != pid:
            return jsonify({'ok': False, 'error': "Not your turn!"})
        frag = r.fragment.lower()
        if len(word) < 2:
            return jsonify({'ok': False, 'error': 'Word must be at least 2 letters'})
        if frag not in word:
            return jsonify({'ok': False, 'error': f'Word must contain "{r.fragment}"'})
        if word in r.used:
            return jsonify({'ok': False, 'error': 'That word was already used!'})
        if word not in WORD_LIST:
            return jsonify({'ok': False, 'error': 'Not a valid English word'})
        r.used.add(word)
        p           = r.players[pid]
        bonus_long  = 3 if len(word) >= 8 else (2 if len(word) >= 6 else 0)
        bonus_tier  = get_tier(r.round) - 1
        p['score'] += len(word) + bonus_long + bonus_tier
        p['streak'] += 1
        bonus_streak = p['streak'] >= 3
    push(code, 'word_accepted', {
        'player_id': pid, 'player_name': r.players[pid]['name'],
        'word': word, 'fragment': r.fragment,
        'score': r.players[pid]['score'], 'streak': r.players[pid]['streak'],
        'bonus_streak': bonus_streak, 'players': list(r.players.values()),
    })
    do_advance(code)
    return jsonify({'ok': True})

@app.route('/api/sync/<code>/<pid>')
def sync(code, pid):
    code = code.upper()
    r    = rooms.get(code)
    if not r: return jsonify({'ok': False})
    return jsonify({'ok': True, 'room': r.to_dict(), 'player_id': pid})

# ── SSE — event-driven, no sleep ────────────────────────────────────────────────
@app.route('/api/events/<room_code>/<pid>/<sub_id>')
def sse_stream(room_code, pid, sub_id):
    room_code = room_code.upper()
    ch        = SubChannel()

    with sse_lock:
        if room_code not in sse_channels:
            sse_channels[room_code] = {}
        sse_channels[room_code][sub_id] = ch

    def generate():
        try:
            yield 'data: {"type":"connected"}\n\n'
            while not ch.closed:
                # Block until a message arrives OR 25s keepalive timeout
                ch.event.wait(timeout=25)
                if ch.closed:
                    break
                msgs = ch.drain()
                for m in msgs:
                    yield f'data: {m}\n\n'
                if not msgs:
                    # keepalive comment — prevents Render's proxy from closing idle connections
                    yield ': ping\n\n'
        except GeneratorExit:
            pass
        finally:
            ch.closed = True
            with sse_lock:
                sse_channels.get(room_code, {}).pop(sub_id, None)
            # Treat SSE disconnect as player leaving
            player_disconnect(room_code, pid)

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={
            'Cache-Control':     'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection':        'keep-alive',
        }
    )

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
