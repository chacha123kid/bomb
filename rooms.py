import random
import string

class Rooms:
    def __init__(self):
        self.rooms = {}
        self.word_history = set()

    def create_room(self):
        code = ''.join(random.choice(string.ascii_uppercase) for _ in range(4))
        self.rooms[code] = {"players": [], "current_letter": None}
        return code

    def room_exists(self, code):
        return code in self.rooms

    def add_player(self, code, username):
        self.rooms[code]["players"].append(username)

    def get_players(self, code):
        return self.rooms[code]["players"]

    def start_round(self, code):
        letter = random.choice(string.ascii_lowercase)
        self.rooms[code]["current_letter"] = letter
        return letter

    def validate_word(self, word, room):
        # Must include the bomb letter
        if self.rooms[room]["current_letter"] not in word:
            return False

        # Must not be repeated
        if word in self.word_history:
            return False

        self.word_history.add(word)
        return True