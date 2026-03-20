from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, join_room, leave_room, emit
import string, random
from rooms import Rooms

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)
rooms = Rooms()

@app.route("/")
def home():
    return render_template("home.html")

@app.route("/create_room", methods=["POST"])
def create_room():
    username = request.form["username"]
    room_code = rooms.create_room()
    rooms.add_player(room_code, username)
    return redirect(url_for("room", room_code=room_code, username=username))

@app.route("/join_room", methods=["POST"])
def join_room_route():
    username = request.form["username"]
    room_code = request.form["room_code"].upper()

    if not rooms.room_exists(room_code):
        return "Room not found.", 404

    rooms.add_player(room_code, username)
    return redirect(url_for("room", room_code=room_code, username=username))

@app.route("/room/<room_code>/<username>")
def room(room_code, username):
    return render_template("room.html", room=room_code, username=username)

# SOCKET EVENTS
@socketio.on("join_room")
def handle_join(data):
    room = data["room"]
    username = data["username"]

    join_room(room)
    emit("player_joined", {"username": username, "players": rooms.get_players(room)}, to=room)

@socketio.on("start_game")
def start_game(data):
    room = data["room"]
    letter = rooms.start_round(room)
    emit("new_round", {"letter": letter}, to=room)

@socketio.on("submit_word")
def submit_word(data):
    room = data["room"]
    username = data["username"]
    word = data["word"].lower()

    if not rooms.validate_word(word, room):
        emit("word_result", {"valid": False, "username": username}, to=room)
    else:
        emit("word_result", {"valid": True, "username": username}, to=room)
        next_letter = rooms.start_round(room)
        emit("new_round", {"letter": next_letter}, to=room)

if __name__ == "__main__":
    socketio.run(app, debug=True)