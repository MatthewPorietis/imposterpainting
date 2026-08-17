const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const COUNTDOWN_SECONDS = 5;
const REVEAL_AUTO_RETURN_SECONDS = 20;

// ---------- word list ----------
const DEFAULT_WORDS = [
  "banana", "guitar", "octopus", "volcano", "umbrella",
  "robot", "castle", "penguin", "rainbow", "sandwich",
];

function loadWords() {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, "..", "assets", "words", "words.txt"),
      "utf8"
    );
    const words = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return words.length > 0 ? words : DEFAULT_WORDS;
  } catch (e) {
    return DEFAULT_WORDS;
  }
}

// ---------- app setup ----------
const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/assets", express.static(path.join(__dirname, "..", "assets")));

const server = http.createServer(app);
const io = new Server(server);

// ---------- room state ----------
/** @type {Map<string, Room>} */
const rooms = new Map();

function generateCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
  } while (rooms.has(code));
  return code;
}

function makeRoom(code, hostId) {
  return {
    code,
    hostId,
    players: new Map(), // socketId -> { id, name, pic }
    settings: { drawTime: 60, guessTime: 30 },
    state: "lobby", // lobby | drawing | voting | countdown | reveal
    word: null,
    imposterId: null,
    votes: new Map(), // voterId -> targetId
    phaseTimer: null,
    revealTimer: null,
  };
}

function publicPlayers(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    pic: p.pic,
    isHost: p.id === room.hostId,
  }));
}

function broadcastLobby(room) {
  io.to(room.code).emit("lobby-update", {
    code: room.code,
    players: publicPlayers(room),
    settings: room.settings,
    hostId: room.hostId,
  });
}

function clearPhaseTimer(room) {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
}

function clearRevealTimer(room) {
  if (room.revealTimer) {
    clearTimeout(room.revealTimer);
    room.revealTimer = null;
  }
}

function startDrawingPhase(room) {
  room.state = "drawing";
  room.votes = new Map();

  const words = loadWords();
  const word = words[Math.floor(Math.random() * words.length)];
  room.word = word;

  const playerIds = Array.from(room.players.keys());
  room.imposterId = playerIds[Math.floor(Math.random() * playerIds.length)];

  const duration = room.settings.drawTime;
  const endsAt = Date.now() + duration * 1000;

  for (const p of room.players.values()) {
    io.to(p.id).emit("game-start", {
      players: publicPlayers(room),
      word: p.id === room.imposterId ? null : room.word,
      isImposter: p.id === room.imposterId,
      duration,
      endsAt,
    });
  }

  clearPhaseTimer(room);
  room.phaseTimer = setTimeout(() => startVotingPhase(room), duration * 1000);
}

function startVotingPhase(room) {
  room.state = "voting";
  room.votes = new Map();
  const duration = room.settings.guessTime;
  const endsAt = Date.now() + duration * 1000;

  io.to(room.code).emit("phase-change", { phase: "voting", duration, endsAt });

  clearPhaseTimer(room);
  room.phaseTimer = setTimeout(() => startCountdown(room), duration * 1000);
}

function startCountdown(room) {
  room.state = "countdown";
  clearPhaseTimer(room);
  const endsAt = Date.now() + COUNTDOWN_SECONDS * 1000;
  io.to(room.code).emit("phase-change", {
    phase: "countdown",
    duration: COUNTDOWN_SECONDS,
    endsAt,
  });
  room.phaseTimer = setTimeout(() => revealResult(room), COUNTDOWN_SECONDS * 1000);
}

function revealResult(room) {
  room.state = "reveal";
  clearPhaseTimer(room);

  const tally = {};
  for (const p of room.players.keys()) tally[p] = 0;
  for (const targetId of room.votes.values()) {
    if (tally[targetId] !== undefined) tally[targetId]++;
  }

  let maxVotes = -1;
  for (const id of Object.keys(tally)) {
    if (tally[id] > maxVotes) maxVotes = tally[id];
  }
  const imposterVotes = tally[room.imposterId] || 0;
  const imposterCaught = maxVotes > 0 && imposterVotes === maxVotes;

  io.to(room.code).emit("reveal-result", {
    imposterId: room.imposterId,
    word: room.word,
    votes: tally,
    voteMap: Object.fromEntries(room.votes),
    imposterCaught,
  });

  clearRevealTimer(room);
  room.revealTimer = setTimeout(() => returnToLobby(room), REVEAL_AUTO_RETURN_SECONDS * 1000);
}

function returnToLobby(room) {
  clearPhaseTimer(room);
  clearRevealTimer(room);
  room.state = "lobby";
  room.word = null;
  room.imposterId = null;
  room.votes = new Map();
  io.to(room.code).emit("back-to-lobby");
  broadcastLobby(room);
}

// ---------- socket handlers ----------
io.on("connection", (socket) => {
  socket.on("host-game", ({ name, pic }) => {
    const code = generateCode();
    const room = makeRoom(code, socket.id);
    room.players.set(socket.id, { id: socket.id, name: sanitizeName(name), pic: pic || null });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("hosted", { code });
    broadcastLobby(room);
  });

  socket.on("join-game", ({ code, name, pic }) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("error-msg", { message: "Room not found." });
    if (room.state !== "lobby") return socket.emit("error-msg", { message: "That game has already started." });
    if (room.players.size >= MAX_PLAYERS) return socket.emit("error-msg", { message: "Room is full." });

    room.players.set(socket.id, { id: socket.id, name: sanitizeName(name), pic: pic || null });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("joined", { code });
    broadcastLobby(room);
  });

  socket.on("update-settings", ({ drawTime, guessTime }) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    if (Number.isFinite(drawTime)) room.settings.drawTime = clamp(drawTime, 15, 300);
    if (Number.isFinite(guessTime)) room.settings.guessTime = clamp(guessTime, 10, 180);
    broadcastLobby(room);
  });

  socket.on("start-game", () => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size !== MAX_PLAYERS) {
      return socket.emit("error-msg", { message: `Need exactly ${MAX_PLAYERS} players to start.` });
    }
    if (room.state !== "lobby") return;
    startDrawingPhase(room);
  });

  socket.on("draw-stroke", (stroke) => {
    const room = getRoom(socket);
    if (!room || room.state !== "drawing") return;
    socket.to(room.code).emit("peer-stroke", { ...stroke, playerId: socket.id });
  });

  socket.on("cast-vote", ({ targetId }) => {
    const room = getRoom(socket);
    if (!room || room.state !== "voting") return;
    if (room.votes.has(socket.id)) return; // no changing votes
    if (!room.players.has(targetId)) return;
    room.votes.set(socket.id, targetId);

    io.to(room.code).emit("player-voted", {
      voterId: socket.id,
      votedCount: room.votes.size,
      totalPlayers: room.players.size,
    });

    if (room.votes.size >= room.players.size) {
      startCountdown(room);
    }
  });

  socket.on("return-to-lobby", () => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== "reveal") return;
    returnToLobby(room);
  });

  socket.on("leave-room", () => handleLeave(socket));
  socket.on("disconnect", () => handleLeave(socket));
});

function handleLeave(socket) {
  const room = getRoom(socket);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(room.code);

  if (room.players.size === 0) {
    clearPhaseTimer(room);
    clearRevealTimer(room);
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = Array.from(room.players.keys())[0];
  }

  // If a game was in progress and someone leaves, bail back to lobby
  // to avoid a stuck/unwinnable round.
  if (room.state !== "lobby") {
    returnToLobby(room);
  } else {
    broadcastLobby(room);
  }
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitizeName(name) {
  const n = (name || "").toString().trim().slice(0, 16);
  return n.length > 0 ? n : "Player";
}

server.listen(PORT, () => {
  console.log(`Imposter drawing game server running on port ${PORT}`);
});
