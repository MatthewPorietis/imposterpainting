# Whodunit Doodle

A real-time, 4-player "spot the imposter" drawing game for the browser.
No database, no accounts, no persistence - everything lives in memory on
the server while a game is running.

## How it plays

- 4 players join a lobby using a 5-letter code.
- The host sets drawing time, guessing time, and optionally turns on
  **Similar Mode** (see below), then starts the game.
- 3 players get a secret word. The 4th (the imposter) normally gets
  nothing and has to fake it - or, in Similar Mode, gets a related-but-
  different word instead, so they can draw *something* plausible.
- All 4 players draw at the same time, live, and everyone can watch all
  4 canvases fill in in real time.
- When drawing time runs out, everyone has the guessing window to click
  on the face of whoever they think is the imposter. Votes are final -
  no changing your mind, and you can vote for yourself.
- When everyone has voted (or time runs out), there's a 5-second
  countdown before the imposter is revealed. If the imposter got the
  most votes, the faithful win. Otherwise, the imposter wins.
- Everyone lands back in the lobby, ready to go again.

## Running it

```
cd server
npm install
npm start
```

Then open `http://localhost:3000` in a browser. To play with others on
the same network, share `http://<your-computer's-local-IP>:3000`
instead of localhost. To play over the internet, deploy the `server`
folder (it also serves the `public` and `assets` folders) to any host
that supports Node + WebSockets - Render, Railway, and Fly.io all have
free tiers that work well for this.

## Similar Mode

When enabled, the imposter doesn't get nothing - they get a *related*
word instead, so they can improvise a drawing that's plausible instead
of guessing blind. The **Similarity** setting controls how close:

- **High** - a very close, easily-confused word (true word `apple` ->
  imposter might get `banana`, `orange`, or `apple juice`)
- **Medium** - loosely related, same general context (`apple` ->
  `candy`, `basketball`, `grocery store`)
- **Low** - basically unrelated, picked from a totally different topic

There's also a **Blind Imposter** setting: when it's on, the imposter
isn't told they're the imposter. They just see a word - their similar
word - the same way everyone else sees theirs, with no red "IMPOSTER"
banner or hint that anything's different. They genuinely believe
they've got the real word, right up until the true word gets revealed
at the start of voting - at which point they may suddenly realize
their drawing doesn't match. This setting only does anything while
Similar Mode is on, since without a word to hand them there's nothing
to convincingly pretend with.

Similar Mode draws from its own curated list -
`assets/words/similar-word-bank.json` - rather than `words.txt`,
because it needs to know which words are related to each other, not
just a flat list. Each entry looks like:

```json
{ "word": "apple", "high": ["banana", "orange", "apple juice", "pear"], "medium": ["candy", "basketball", "juice box", "grocery store"] }
```

To add more words to Similar Mode, add more entries in that same
shape - a main `word`, a `high` list (close/easily-confused), and a
`medium` list (loosely related). "Low" similarity doesn't need its own
list - it's generated automatically by picking a random word from a
*different* entry in the bank. When Similar Mode is off, the game goes
back to using `words.txt` as normal, and the imposter gets nothing.

## Adding your own content later

- **Words**: edit `assets/words/words.txt` - one word per line, lines
  starting with `#` are ignored. If the file is empty the game falls
  back to a small built-in word list, so it's playable right away.
- **Profile pictures**: drop image files into `assets/profile-pics/`
  and list their filenames in `assets/profile-pics/manifest.json` (see
  the README.txt in that folder for the exact format). Until you do,
  players pick from a set of built-in emoji avatars.

## Project structure

```
imposter-game/
  server/            Node + Express + Socket.IO server (all game logic)
    index.js
    package.json
  public/            Everything served to the browser
    index.html
    css/style.css
    js/game.js
  assets/
    words/words.txt            <- fill in your word list here
    profile-pics/               <- drop images here + edit manifest.json
```

## Notes on how it works

- Rooms, players, scores, drawings, and votes all live in a single
  in-memory object on the server (`rooms` in `server/index.js`). Nothing
  is written to disk, so restarting the server clears all active games -
  by design, since you said no backend database was needed.
- Drawing sync is just short line-segment events broadcast over
  WebSockets (via Socket.IO) to everyone else in the room - no
  client-side prediction or interpolation, since a little bit of
  latency was fine.
- All phase timing (draw timer, vote timer, 5-second reveal countdown)
  is driven by the server, so it can't be manipulated by a client and
  stays in sync even if someone's connection lags briefly.
