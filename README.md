# 💣 WORD BOMB

Real-time multiplayer word game. 416,000+ word dictionary. No WebSocket dependencies — just Flask.

## Start

```bash
pip install flask
python app.py
```

Open **http://localhost:5000** — share the 4-letter room code with friends.

## Rules
- Each turn: type a word containing the **highlighted letters**
- 12 seconds per turn or you lose a ❤
- 3 lives — last player standing wins 👑
- Long words (7+ letters) earn bonus points
- All 416,000+ English words accepted

## Files
```
app.py              Flask server + game logic + SSE
wordlist_data.py    416k words, zlib compressed
templates/          HTML templates
static/css/         Styles
static/js/          Client JavaScript
```
