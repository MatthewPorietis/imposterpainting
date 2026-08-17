(() => {
  const socket = io();

  // ---------- constants ----------
  const COLORS = [
    "#000000", "#ffffff", "#ff5a5f", "#ffd166", "#f4a261",
    "#4ade80", "#2a9d8f", "#4ea8ff", "#7c5cff", "#c084fc",
    "#ff70a6", "#8d5524",
  ];
  const PLACEHOLDER_AVATARS = ["🦊", "🐙", "🐸", "🦉", "🐼", "🦁", "🐯", "🐨", "🦄", "🐢"];
  const CANVAS_SIZE = 600; // internal drawing resolution (square)

  // ---------- state ----------
  let mode = null; // 'host' | 'join'
  let myId = null;
  let myName = "";
  let myPic = null; // { type:'img', src } or { type:'emoji', char }
  let roomCode = null;
  let isHost = false;
  let players = []; // [{id,name,pic,isHost}]
  let settings = { drawTime: 60, guessTime: 30 };
  let currentTool = "pencil";
  let currentColor = COLORS[0];
  let currentThickness = 6;
  let isImposter = false;
  let myVoteCast = false;
  let phaseTimeoutHandle = null;

  const canvases = {}; // playerId -> { canvas, ctx, drawing:bool, last:{x,y} }

  // ---------- screen helpers ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  }

  // ---------- avatar rendering ----------
  function avatarInner(pic) {
    if (pic && pic.type === "img") {
      const img = document.createElement("img");
      img.src = pic.src;
      return img;
    }
    const span = document.createElement("span");
    span.textContent = (pic && pic.char) || "🙂";
    return span;
  }

  function buildAvatarEl(pic, className) {
    const el = document.createElement("div");
    el.className = className;
    el.appendChild(avatarInner(pic));
    return el;
  }

  // ---------- avatar picker (name screen) ----------
  function loadAvatarManifest() {
    fetch("/assets/profile-pics/manifest.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => renderAvatarGrid(Array.isArray(list) ? list : []))
      .catch(() => renderAvatarGrid([]));
  }

  function renderAvatarGrid(imageFiles) {
    const grid = document.getElementById("avatar-grid");
    grid.innerHTML = "";
    const options = imageFiles.length > 0
      ? imageFiles.map((f) => ({ type: "img", src: `/assets/profile-pics/${f}` }))
      : PLACEHOLDER_AVATARS.map((c) => ({ type: "emoji", char: c }));

    options.forEach((opt, i) => {
      const btn = document.createElement("div");
      btn.className = "avatar-choice";
      btn.appendChild(avatarInner(opt));
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".avatar-choice").forEach((c) => c.classList.remove("selected"));
        btn.classList.add("selected");
        myPic = opt;
      });
      grid.appendChild(btn);
      if (i === 0) { btn.classList.add("selected"); myPic = opt; }
    });
  }

  // ---------- color palette ----------
  function renderPalette() {
    const wrap = document.getElementById("color-palette");
    wrap.innerHTML = "";
    COLORS.forEach((c, i) => {
      const sw = document.createElement("div");
      sw.className = "color-swatch" + (i === 0 ? " selected" : "");
      sw.style.background = c;
      sw.addEventListener("click", () => {
        currentColor = c;
        currentTool = "pencil";
        document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
        sw.classList.add("selected");
        document.getElementById("tool-pencil").classList.add("active");
        document.getElementById("tool-eraser").classList.remove("active");
      });
      wrap.appendChild(sw);
    });
  }

  document.getElementById("tool-pencil").addEventListener("click", () => {
    currentTool = "pencil";
    document.getElementById("tool-pencil").classList.add("active");
    document.getElementById("tool-eraser").classList.remove("active");
  });
  document.getElementById("tool-eraser").addEventListener("click", () => {
    currentTool = "eraser";
    document.getElementById("tool-eraser").classList.add("active");
    document.getElementById("tool-pencil").classList.remove("active");
  });
  document.getElementById("thickness").addEventListener("input", (e) => {
    currentThickness = parseInt(e.target.value, 10);
  });

  // ---------- menu screen ----------
  document.getElementById("btn-host").addEventListener("click", () => {
    mode = "host";
    document.getElementById("name-heading").textContent = "Host a game";
    document.getElementById("join-code-field").classList.add("hidden");
    document.getElementById("name-error").classList.add("hidden");
    loadAvatarManifest();
    showScreen("screen-name");
  });

  document.getElementById("btn-join").addEventListener("click", () => {
    mode = "join";
    document.getElementById("name-heading").textContent = "Join a game";
    document.getElementById("join-code-field").classList.remove("hidden");
    document.getElementById("name-error").classList.add("hidden");
    loadAvatarManifest();
    showScreen("screen-name");
  });

  document.getElementById("name-back").addEventListener("click", () => showScreen("screen-menu"));

  document.getElementById("btn-continue").addEventListener("click", () => {
    const name = document.getElementById("input-name").value.trim();
    const errEl = document.getElementById("name-error");
    if (!name) { errEl.textContent = "Enter a name first."; errEl.classList.remove("hidden"); return; }

    myName = name;
    const picPayload = myPic && myPic.type === "img" ? { type: "img", src: myPic.src } : { type: "emoji", char: (myPic && myPic.char) || "🙂" };

    if (mode === "host") {
      socket.emit("host-game", { name: myName, pic: picPayload });
    } else {
      const code = document.getElementById("input-code").value.trim().toUpperCase();
      if (code.length !== 5) { errEl.textContent = "Enter the 5-letter lobby code."; errEl.classList.remove("hidden"); return; }
      socket.emit("join-game", { code, name: myName, pic: picPayload });
    }
  });

  // ---------- socket: connection / errors ----------
  socket.on("connect", () => { myId = socket.id; });

  socket.on("error-msg", ({ message }) => {
    const errEl = document.getElementById("name-error");
    errEl.textContent = message;
    errEl.classList.remove("hidden");
  });

  socket.on("hosted", ({ code }) => { roomCode = code; });
  socket.on("joined", ({ code }) => { roomCode = code; });

  // ---------- lobby ----------
  let knownPlayerIds = [];
  socket.on("lobby-update", (data) => {
    roomCode = data.code;
    players = data.players;
    settings = data.settings;
    isHost = data.hostId === myId;

    const newIds = players.map((p) => p.id);
    const newcomers = newIds.filter((id) => !knownPlayerIds.includes(id));
    if (knownPlayerIds.length > 0 && newcomers.length > 0) Sound.join();
    knownPlayerIds = newIds;

    document.getElementById("lobby-code").textContent = roomCode;
    document.getElementById("player-count").textContent = `(${players.length}/4)`;

    const list = document.getElementById("lobby-player-list");
    list.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const p = players[i];
      const row = document.createElement("div");
      if (p) {
        row.className = "lobby-player-row";
        row.appendChild(buildAvatarEl(p.pic, "avatar-sm"));
        const nameEl = document.createElement("span");
        nameEl.className = "p-name";
        nameEl.textContent = p.name + (p.id === myId ? " (you)" : "");
        row.appendChild(nameEl);
        if (p.isHost) {
          const badge = document.createElement("span");
          badge.className = "host-badge";
          badge.textContent = "HOST";
          row.appendChild(badge);
        }
      } else {
        row.className = "lobby-player-row empty";
        row.textContent = "Waiting for player\u2026";
      }
      list.appendChild(row);
    }

    document.getElementById("setting-draw").value = settings.drawTime;
    document.getElementById("setting-draw-val").textContent = settings.drawTime + "s";
    document.getElementById("setting-guess").value = settings.guessTime;
    document.getElementById("setting-guess-val").textContent = settings.guessTime + "s";
    document.getElementById("setting-draw").disabled = !isHost;
    document.getElementById("setting-guess").disabled = !isHost;
    document.getElementById("settings-locked-note").classList.toggle("hidden", isHost);

    const startBtn = document.getElementById("btn-start");
    startBtn.classList.toggle("hidden", !isHost);
    startBtn.disabled = players.length < 3;

    let statusText;
    if (players.length < 3) {
      const need = 3 - players.length;
      statusText = `Waiting for ${need} more player${need === 1 ? "" : "s"} (need at least 3)\u2026`;
    } else if (players.length === 4) {
      statusText = isHost ? "Room is full \u2014 start whenever you're ready." : "Room is full. Waiting for the host to start\u2026";
    } else {
      statusText = isHost
        ? "Ready to start with 3, or wait for a 4th player."
        : "Ready to start. Waiting for the host\u2026";
    }
    document.getElementById("lobby-status").textContent = statusText;

    showScreen("screen-lobby");
  });

  let settingsDebounce = null;
  function pushSettings() {
    if (!isHost) return;
    clearTimeout(settingsDebounce);
    settingsDebounce = setTimeout(() => {
      socket.emit("update-settings", {
        drawTime: parseInt(document.getElementById("setting-draw").value, 10),
        guessTime: parseInt(document.getElementById("setting-guess").value, 10),
      });
    }, 150);
  }
  document.getElementById("setting-draw").addEventListener("input", (e) => {
    document.getElementById("setting-draw-val").textContent = e.target.value + "s";
    pushSettings();
  });
  document.getElementById("setting-guess").addEventListener("input", (e) => {
    document.getElementById("setting-guess-val").textContent = e.target.value + "s";
    pushSettings();
  });

  document.getElementById("btn-start").addEventListener("click", () => socket.emit("start-game"));
  document.getElementById("btn-leave-lobby").addEventListener("click", () => {
    socket.emit("leave-room");
    roomCode = null;
    showScreen("screen-menu");
  });

  // ---------- game: canvases ----------
  function buildCanvasGrid() {
    const grid = document.getElementById("canvas-grid");
    grid.innerHTML = "";
    Object.keys(canvases).forEach((k) => delete canvases[k]);

    players.forEach((p) => {
      const panel = document.createElement("div");
      panel.className = "canvas-panel" + (p.id === myId ? " self" : "");
      panel.id = `panel-${p.id}`;

      const header = document.createElement("div");
      header.className = "panel-header";
      const avatar = buildAvatarEl(p.pic, "avatar-sm vote-target");
      avatar.dataset.playerId = p.id;
      const nameEl = document.createElement("span");
      nameEl.className = "p-name";
      nameEl.textContent = p.name + (p.id === myId ? " (you)" : "");
      const votedBadge = document.createElement("span");
      votedBadge.className = "voted-badge hidden";
      votedBadge.textContent = "VOTED";
      votedBadge.id = `voted-badge-${p.id}`;

      header.appendChild(avatar);
      header.appendChild(nameEl);
      header.appendChild(votedBadge);
      panel.appendChild(header);

      const canvas = document.createElement("canvas");
      canvas.className = "draw-canvas";
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      panel.appendChild(canvas);

      grid.appendChild(panel);

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      canvases[p.id] = { canvas, ctx, drawing: false, last: null };

      avatar.addEventListener("click", () => onAvatarClick(p.id));
    });

    attachDrawHandlers();
  }

  function attachDrawHandlers() {
    const mine = canvases[myId];
    if (!mine) return;
    const { canvas } = mine;

    const getPos = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      const x = ((clientX - rect.left) / rect.width);
      const y = ((clientY - rect.top) / rect.height);
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    };

    const start = (evt) => {
      if (gameState !== "drawing") return;
      evt.preventDefault();
      mine.drawing = true;
      mine.last = getPos(evt);
    };
    const move = (evt) => {
      if (!mine.drawing || gameState !== "drawing") return;
      evt.preventDefault();
      const pos = getPos(evt);
      drawSegment(myId, mine.last, pos, currentColor, currentThickness, currentTool);
      socket.emit("draw-stroke", {
        x0: mine.last.x, y0: mine.last.y, x1: pos.x, y1: pos.y,
        color: currentColor, size: currentThickness, tool: currentTool,
      });
      mine.last = pos;
    };
    const end = () => { mine.drawing = false; mine.last = null; };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }

  function drawSegment(playerId, from, to, color, size, tool) {
    const entry = canvases[playerId];
    if (!entry) return;
    const { ctx, canvas } = entry;
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = tool === "eraser" ? size * 2 : size;
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }

  socket.on("peer-stroke", (s) => {
    const entry = canvases[s.playerId];
    if (!entry) return;
    drawSegment(s.playerId, { x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }, s.color, s.size, s.tool);
  });

  // ---------- game: phases ----------
  let gameState = "lobby"; // drawing | voting | countdown | reveal

  socket.on("game-start", (data) => {
    players = data.players;
    isImposter = data.isImposter;
    myVoteCast = false;
    gameState = "drawing";

    buildCanvasGrid();

    document.getElementById("phase-label").textContent = "DRAW THE WORD";
    const wordEl = document.getElementById("word-display");
    if (isImposter) {
      wordEl.textContent = "You're the IMPOSTER \u2014 fake it!";
      wordEl.classList.add("imposter");
    } else {
      wordEl.textContent = data.word;
      wordEl.classList.remove("imposter");
    }
    document.getElementById("vote-instructions").classList.remove("hidden");
    document.getElementById("toolbar").classList.remove("hidden");
    setVotable(true);

    showScreen("screen-game");
    startTimer(data.endsAt, data.duration);
    Sound.gameStart();
  });

  socket.on("phase-change", (data) => {
    gameState = data.phase;
    if (data.phase === "voting") {
      document.getElementById("phase-label").textContent = "FIND THE IMPOSTER";
      const wordEl = document.getElementById("word-display");
      wordEl.textContent = data.word;
      wordEl.classList.remove("imposter");
      document.getElementById("vote-instructions").classList.remove("hidden");
      document.getElementById("toolbar").classList.add("hidden");
      setVotable(true);
      startTimer(data.endsAt, data.duration);
    } else if (data.phase === "countdown") {
      setVotable(false);
      showScreen("screen-countdown");
      runCountdown(data.duration);
    }
  });

  function setVotable(on) {
    document.querySelectorAll(".vote-target").forEach((el) => {
      el.classList.toggle("votable", on && !myVoteCast);
      el.classList.toggle("locked", myVoteCast);
    });
  }

  function onAvatarClick(targetId) {
    if ((gameState !== "drawing" && gameState !== "voting") || myVoteCast) return;
    myVoteCast = true;
    socket.emit("cast-vote", { targetId });
    const el = document.querySelector(`.vote-target[data-player-id="${targetId}"]`);
    if (el) el.classList.add("my-vote");
    setVotable(false);
  }

  socket.on("player-voted", ({ voterId, votedCount, totalPlayers }) => {
    const badge = document.getElementById(`voted-badge-${voterId}`);
    if (badge) badge.classList.remove("hidden");
    document.getElementById("phase-label").textContent = `${votedCount}/${totalPlayers} voted`;
    Sound.vote();
  });

  function runCountdown(seconds) {
    let n = seconds;
    const el = document.getElementById("countdown-num");
    el.textContent = n;
    Sound.tick();
    clearInterval(window.__countdownInterval);
    window.__countdownInterval = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(window.__countdownInterval); return; }
      el.textContent = n;
      Sound.tick();
    }, 1000);
  }

  socket.on("reveal-result", (data) => {
    gameState = "reveal";
    clearInterval(window.__countdownInterval);

    const imposter = players.find((p) => p.id === data.imposterId);
    const verdictEl = document.getElementById("reveal-verdict");
    if (data.imposterCaught) {
      verdictEl.textContent = "\ud83d\udd75\ufe0f The faithful win!";
      verdictEl.className = "reveal-verdict caught";
      Sound.win();
    } else {
      verdictEl.textContent = "\ud83c\udfad The imposter got away with it!";
      verdictEl.className = "reveal-verdict escaped";
      Sound.lose();
    }

    document.getElementById("reveal-avatar").innerHTML = "";
    if (imposter) document.getElementById("reveal-avatar").appendChild(avatarInner(imposter.pic));
    document.getElementById("reveal-name").textContent = imposter ? imposter.name + (imposter.id === myId ? " (you)" : "") : "Unknown";
    document.getElementById("reveal-word").textContent = data.word;

    const votesWrap = document.getElementById("reveal-votes");
    votesWrap.innerHTML = "";
    players
      .slice()
      .sort((a, b) => (data.votes[b.id] || 0) - (data.votes[a.id] || 0))
      .forEach((p) => {
        const row = document.createElement("div");
        row.className = "reveal-vote-row";
        row.appendChild(buildAvatarEl(p.pic, "avatar-sm"));
        const nameEl = document.createElement("span");
        nameEl.className = "p-name";
        nameEl.textContent = p.name + (p.id === data.imposterId ? " \ud83c\udfad" : "");
        const count = document.createElement("span");
        count.className = "vote-count";
        const v = data.votes[p.id] || 0;
        count.textContent = `${v} vote${v === 1 ? "" : "s"}`;
        row.appendChild(nameEl);
        row.appendChild(count);
        votesWrap.appendChild(row);
      });

    document.getElementById("btn-back-to-lobby").classList.toggle("hidden", !isHost);
    document.getElementById("reveal-wait-note").classList.toggle("hidden", isHost);

    showScreen("screen-reveal");
  });

  document.getElementById("btn-back-to-lobby").addEventListener("click", () => {
    socket.emit("return-to-lobby");
  });

  socket.on("back-to-lobby", () => {
    gameState = "lobby";
    myVoteCast = false;
    isImposter = false;
    clearTimeout(phaseTimeoutHandle);
    showScreen("screen-lobby");
  });

  // ---------- timer ring ----------
  function startTimer(endsAt, duration) {
    clearTimeout(phaseTimeoutHandle);
    const ring = document.getElementById("timer-ring");
    const numEl = document.getElementById("timer-num");
    let warned10 = false;

    function tick() {
      const remainingMs = endsAt - Date.now();
      const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
      numEl.textContent = remaining;
      ring.classList.toggle("low", remaining <= 10);
      if (remaining <= 10 && !warned10) {
        warned10 = true;
        Sound.tick();
      }
      if (remainingMs > 0) {
        phaseTimeoutHandle = setTimeout(tick, 250);
      }
    }
    tick();
  }

  // ---------- init ----------
  renderPalette();
  showScreen("screen-menu");
})();
