// audio.js — every sound in the game is synthesised with WebAudio: no audio
// files, no samples. One master chain, a tiny noise buffer reused by every
// percussive sound, and per-weapon gunshot recipes so a pistol crack and a
// shotgun boom never sound alike.

let ctx = null, master = null, noiseBuf = null;
let engineOsc = null, engineGain = null, sirenOsc = null, sirenGain = null, sirenLfo = null;

export function audioInit() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
const now = () => (ctx ? ctx.currentTime : 0);

function env(gain, t0, a, peak, dec) {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + a);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + a + dec);
}
function tone(freq, type, dur, vol, slideTo = null, delay = 0) {
  if (!ctx) return;
  const t0 = now() + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  env(g, t0, 0.005, vol, dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.1);
}
function noise(dur, vol, freq, q = 1, type = 'bandpass', delay = 0) {
  if (!ctx) return;
  const t0 = now() + delay, src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t0, 0.004, vol, dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.1);
}

export const sfx = {
  shot(kind) {
    if (kind === 'PISTOL') { noise(0.11, 0.5, 1800, 0.7); tone(160, 'square', 0.07, 0.18, 60); }
    else if (kind === 'SMG') { noise(0.08, 0.4, 2100, 0.7); tone(190, 'square', 0.05, 0.14, 70); }
    else if (kind === 'PUMP SHOTGUN') { noise(0.3, 0.8, 700, 0.5); tone(110, 'square', 0.2, 0.3, 40); noise(0.12, 0.3, 2600, 0.8, 'bandpass', 0.02); }
    else if (kind === 'RIFLE') { noise(0.16, 0.6, 1300, 0.6); tone(130, 'sawtooth', 0.1, 0.2, 45); }
  },
  dryFire() { tone(1200, 'square', 0.03, 0.08); },
  swing() { noise(0.09, 0.12, 900, 1.2); },
  chop() { noise(0.07, 0.25, 2400, 1); tone(300, 'square', 0.05, 0.1, 120); },
  punchHit() { noise(0.08, 0.35, 300, 0.8, 'lowpass'); },
  hitMarker() { tone(1500, 'sine', 0.05, 0.12); },
  hurt() { tone(140, 'sawtooth', 0.15, 0.2, 70); },
  cash() { tone(880, 'sine', 0.09, 0.16); tone(1318, 'sine', 0.14, 0.16, null, 0.07); },
  buy() { tone(660, 'sine', 0.08, 0.15); tone(990, 'sine', 0.12, 0.15, null, 0.06); },
  denied() { tone(196, 'square', 0.14, 0.14); },
  door() { tone(220, 'triangle', 0.12, 0.14, 160); },
  splash() { noise(0.35, 0.3, 800, 0.4, 'lowpass'); },
  crash(big = false) { noise(big ? 0.5 : 0.25, big ? 0.7 : 0.4, 240, 0.4, 'lowpass'); tone(70, 'sine', 0.3, 0.3, 35); },
  explosion() { noise(0.9, 0.95, 120, 0.3, 'lowpass'); tone(55, 'sine', 0.8, 0.5, 24); noise(0.3, 0.4, 900, 0.5, 'bandpass', 0.05); },
  horn() { tone(370, 'square', 0.28, 0.12); tone(466, 'square', 0.28, 0.1); },
  phone() { tone(1046, 'sine', 0.12, 0.14); tone(1046, 'sine', 0.12, 0.14, null, 0.2); },
  mission() { tone(523, 'sine', 0.12, 0.16); tone(784, 'sine', 0.18, 0.16, null, 0.1); },
  fail() { tone(392, 'sine', 0.16, 0.16); tone(311, 'sine', 0.26, 0.16, null, 0.14); },
  heal() { tone(740, 'sine', 0.1, 0.12); tone(1108, 'sine', 0.16, 0.12, null, 0.08); },
  step() { noise(0.03, 0.05, 500, 0.6, 'lowpass'); },
  uiClick() { tone(700, 'sine', 0.04, 0.08); },
};

// continuous engine hum, pitch follows speed; call every frame while driving
export function engineSound(on, speedRatio = 0, isBoat = false) {
  if (!ctx) return;
  if (on && !engineOsc) {
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    engineGain = ctx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(f); f.connect(engineGain); engineGain.connect(master);
    engineOsc.start();
  }
  if (!engineOsc) return;
  const base = isBoat ? 55 : 65;
  engineOsc.frequency.setTargetAtTime(base + speedRatio * (isBoat ? 90 : 150), now(), 0.06);
  engineGain.gain.setTargetAtTime(on ? 0.05 + speedRatio * 0.05 : 0, now(), 0.09);
  if (!on && engineGain.gain.value < 0.002) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; }
}
// two-tone police siren while a chase is hot nearby
export function sirenSound(on) {
  if (!ctx) return;
  if (on && !sirenOsc) {
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 760;
    sirenLfo = ctx.createOscillator(); sirenLfo.frequency.value = 0.55;
    const lfoG = ctx.createGain(); lfoG.gain.value = 130;
    sirenLfo.connect(lfoG); lfoG.connect(sirenOsc.frequency);
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain); sirenGain.connect(master);
    sirenOsc.start(); sirenLfo.start();
  }
  if (!sirenOsc) return;
  sirenGain.gain.setTargetAtTime(on ? 0.028 : 0, now(), 0.2);
  if (!on && sirenGain.gain.value < 0.002) {
    try { sirenOsc.stop(); sirenLfo.stop(); } catch (e) {}
    sirenOsc = null;
  }
}
