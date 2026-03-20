const socket = io();

socket.emit("join_room", { room, username });

socket.on("player_joined", data => {
    const list = document.getElementById("players");
    list.innerHTML = data.players.map(p => `<li>${p}</li>`).join("");
});

function startGame() {
    socket.emit("start_game", { room });
}

socket.on("new_round", data => {
    document.getElementById("letter").textContent = "Letter: " + data.letter.toUpperCase();
});

function submitWord() {
    const word = document.getElementById("word").value;
    socket.emit("submit_word", { room, username, word });
    document.getElementById("word").value = "";
}

socket.on("word_result", data => {
    if (!data.valid) {
        alert(`${data.username}'s word is invalid!`);
    }
});