// Lightweight sound effects using the Web Audio API. No external audio
// files are needed - every sound is a synthesized tone or short sequence
// of tones. Browsers block audio until a user gesture happens, so
// Sound.unlock() is called on the first click anywhere on the page.
(() => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;

  function ensureCtx() {
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, { duration = 0.15, type = "sine", delay = 0, peak = 0.18 } = {}) {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = c.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  const Sound = {
    unlock() { ensureCtx(); },

    join() {
      tone(660, { duration: 0.09, type: "sine" });
      tone(880, { duration: 0.13, type: "sine", delay: 0.07 });
    },

    gameStart() {
      tone(523.25, { duration: 0.13, type: "triangle" });
      tone(659.25, { duration: 0.13, type: "triangle", delay: 0.1 });
      tone(783.99, { duration: 0.2, type: "triangle", delay: 0.2 });
    },

    vote() {
      tone(500, { duration: 0.05, type: "square", peak: 0.1, delay: 0 });
      tone(700, { duration: 0.07, type: "square", peak: 0.1, delay: 0.04 });
    },

    tick() {
      tone(880, { duration: 0.08, type: "square", peak: 0.14 });
    },

    win() {
      tone(523.25, { duration: 0.13, type: "triangle" });
      tone(659.25, { duration: 0.13, type: "triangle", delay: 0.12 });
      tone(783.99, { duration: 0.13, type: "triangle", delay: 0.24 });
      tone(1046.5, { duration: 0.3, type: "triangle", delay: 0.36 });
    },

    lose() {
      tone(392, { duration: 0.2, type: "sawtooth", peak: 0.13 });
      tone(311.13, { duration: 0.35, type: "sawtooth", peak: 0.13, delay: 0.16 });
    },
  };

  window.Sound = Sound;
  document.addEventListener("click", () => Sound.unlock(), { once: true });
})();
