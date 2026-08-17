# Whodunit Doodle

A real-time, 4-player "spot the imposter" drawing game for the browser.
No database, no accounts, no persistence - everything lives in memory on
the server while a game is running.

## How it plays

- 4 players join a lobby using a 5-letter code.
- The host sets drawing time and guessing time, then starts the game.
- 3 players get a secret word. The 4th (the imposter) gets nothing and
  has to fake it.
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
