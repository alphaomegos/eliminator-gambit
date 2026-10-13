// Sound effects (synthesised with WebAudio, no files) and visual effects.

const MUTE_KEY = "eg.muted";
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* ignore */
}

export const isMuted = () => muted;
export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function audio() {
  if (muted) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One oscillator note with a quick attack and exponential release. */
function tone(ac, { freq, to = freq, type = "sine", start = 0, dur = 0.15, gain = 0.2 }) {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(ac, { start = 0, dur = 0.5, gain = 0.35, cutoff = 900 }) {
  const t0 = ac.currentTime + start;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, t0);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
}

export const sound = {
  pick() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 720, to: 360, type: "triangle", dur: 0.12, gain: 0.25 });
  },
  boom() {
    const ac = audio();
    if (!ac) return;
    noise(ac, { dur: 0.7, gain: 0.5, cutoff: 700 });
    tone(ac, { freq: 110, to: 35, type: "sine", dur: 0.7, gain: 0.5 });
  },
  tie() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 659, dur: 0.25, gain: 0.18 });
    tone(ac, { freq: 988, start: 0.12, dur: 0.4, gain: 0.18 });
  },
  fanfare() {
    const ac = audio();
    if (!ac) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(ac, { freq: f, type: "square", start: i * 0.13, dur: 0.22, gain: 0.08 }));
    tone(ac, { freq: 1047, type: "triangle", start: 0.52, dur: 0.6, gain: 0.15 });
  },
  undo() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 300, to: 750, type: "sine", dur: 0.18, gain: 0.15 });
  },
  tick() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 1200, type: "square", dur: 0.04, gain: 0.05 });
  },
  buzzer() {
    const ac = audio();
    if (!ac) return;
    tone(ac, { freq: 180, type: "sawtooth", dur: 0.6, gain: 0.15 });
  },
};

// ---------- visuals ----------

/** Restarts a CSS animation class on an element. */
export function flash(el, cls, ms = 900) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation can replay
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** Floating “+1” / “−4” above a team box. */
export function floatPoints(box, points) {
  if (!box) return;
  const tag = document.createElement("span");
  tag.className = `floatPoints ${points < 0 ? "neg" : "pos"}`;
  tag.textContent = points > 0 ? `+${points}` : `−${Math.abs(points)}`;
  box.append(tag);
  setTimeout(() => tag.remove(), 1300);
}

export function shake() {
  if (reducedMotion()) return;
  flash(document.body, "shake", 600);
  flash(document.getElementById("fxFlash"), "on", 700);
}

const CONFETTI_COLORS = ["#39d98a", "#ff4d6d", "#ffc65c", "#5cc8ff", "#c38bff", "#e9e9ee"];
export function confetti(count = 90) {
  if (reducedMotion()) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 240}px`);
    p.style.setProperty("--spin", `${(Math.random() - 0.5) * 1440}deg`);
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4500);
}
