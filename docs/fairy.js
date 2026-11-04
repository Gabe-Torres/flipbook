/* Cursor companions — original canvas drawings.
   pointer-events:none overlay; follows the mouse with a spring.
   Hidden on touch-only devices. N cycles Fairy, Glow, and Off. Saved in localStorage.
   Respects prefers-reduced-motion. */
(() => {
  'use strict';
  const KEY = 'flipbook.fairy';
  const CURSORS = ['fairy', 'glow', 'off'];
  const load = () => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    let cursor = raw.cursor;
    if (!CURSORS.includes(cursor)) cursor = raw.on === false ? 'off' : 'fairy';
    return { cursor, sound: !!raw.sound };
  };
  const cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  const mqFine = matchMedia('(any-pointer: fine)');
  const mqCalm = matchMedia('(prefers-reduced-motion: reduce)');
  const supported = () => mqFine.matches;
  const calm = () => mqCalm.matches;

  const cv = document.createElement('canvas');
  cv.id = 'fairy'; cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9999', display: 'none' });
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  addEventListener('resize', resize); resize();

  const p = { x: W * 0.7, y: H * 0.35 }, v = { x: 0, y: 0 };
  const mouse = { x: W * 0.7, y: H * 0.35, t: 0, inside: false, seen: false };
  let flash = 0, raf = 0, last = 0, t0 = performance.now(), sparks = [], hoverEl = null, fade = 0;
  const OFF = { x: 26, y: -24 };

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); mouse.inside = true;
    if (!mouse.seen) { mouse.seen = true; p.x = mouse.x + OFF.x + 40; p.y = mouse.y + OFF.y - 30; }
  }, { passive: true });
  document.addEventListener('mouseleave', () => { mouse.inside = false; });
  document.addEventListener('mouseenter', () => { mouse.inside = true; });

  const HOT = 'button, a, input, .result, .bmitem, .thumb, .recent, .offline-pill, .nav, .bookcard';
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest(HOT);
    if (el && el !== hoverEl) { flash = 1; if (!calm()) burst(6); }
    hoverEl = el;
  }, { passive: true });

  document.addEventListener('click', (e) => {
    if (!running()) return;
    const control = e.target.closest && e.target.closest('button, a, input, label, textarea, select');
    if (control) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 26) { flash = 1.4; burst(14); if (cfg.sound) playClick(); }
  }, true);

  let ac = null;
  let customBytes = null;
  let customName = '';
  let customType = '';
  let customUrl = '';
  let customAudio = null;
  let customBuffer = null;
  let customDecode = 0;
  let lastSound = '';
  let soundsStarted = 0;
  let lastPlayError = '';

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ac) ac = new AC();
    if (ac.state === 'suspended') {
      const pending = ac.resume();
      if (pending && pending.catch) pending.catch(() => {});
    }
    return ac;
  }

  // iOS Safari ignores Web Audio until a buffer starts inside a user gesture.
  function unlockAudio() {
    const ctx = ensureAudio();
    if (!ctx) return null;
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
    return ctx;
  }
  addEventListener('pointerdown', () => { unlockAudio(); }, { capture: true, passive: true });
  addEventListener('touchend', () => { unlockAudio(); }, { capture: true, passive: true });

  function tone(when, type, f0, f1, dur, peak) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, f0), when);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), when + dur * 0.75);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    soundsStarted++;
  }

  // Original two-burst chirp. Not taken from any game or recording.
  // First burst is a short "hey", then a higher rising "listen" with a small bell.
  function heyListen() {
    const now = ac.currentTime + 0.03;
    tone(now, 'triangle', 640, 920, 0.11, 0.16);
    tone(now + 0.08, 'sine', 1568, 1660, 0.16, 0.07);
    tone(now + 0.36, 'triangle', 1046, 1480, 0.12, 0.16);
    tone(now + 0.48, 'triangle', 1480, 2093, 0.14, 0.14);
    tone(now + 0.58, 'sine', 2637, 2794, 0.18, 0.05);
    tone(now + 0.66, 'sine', 3136, 3322, 0.2, 0.035);
  }

  function twinkle() {
    const now = ac.currentTime + 0.02;
    const notes = [[1760, 0], [2349, 0.07], [2093, 0.26], [2637, 0.33], [3136, 0.40]];
    for (const [freq, delay] of notes) tone(now + delay, 'sine', freq, freq * 1.02, 0.2, 0.07);
  }

  function forgetCustomUrl() {
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = '';
    customBuffer = null;
    customDecode = 0;
    if (customAudio) {
      customAudio.pause();
      customAudio.removeAttribute('src');
    }
  }

  function textAt(view, offset, length) {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
    return out;
  }

  // PCM wav files can play even when the browser has not started its audio device yet.
  function bufferFromWav(ctx, bytes) {
    if (!bytes || bytes.byteLength < 44) return null;
    const view = new DataView(bytes);
    if (textAt(view, 0, 4) !== 'RIFF' || textAt(view, 8, 4) !== 'WAVE') return null;
    let offset = 12;
    let format = 0, channels = 0, rate = 0, bits = 0, dataOffset = 0, dataSize = 0;
    while (offset + 8 <= bytes.byteLength) {
      const id = textAt(view, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (id === 'fmt ') {
        format = view.getUint16(start, true);
        channels = view.getUint16(start + 2, true);
        rate = view.getUint32(start + 4, true);
        bits = view.getUint16(start + 14, true);
      } else if (id === 'data') {
        dataOffset = start;
        dataSize = size;
        break;
      }
      offset = start + size + (size & 1);
    }
    if (format !== 1 || !rate || !dataSize || channels < 1 || channels > 2 || (bits !== 8 && bits !== 16)) return null;
    const width = bits / 8;
    const frames = Math.floor(dataSize / (channels * width));
    if (!frames || dataOffset + frames * channels * width > bytes.byteLength) return null;
    const buffer = ctx.createBuffer(channels, frames, rate);
    for (let c = 0; c < channels; c++) {
      const out = buffer.getChannelData(c);
      for (let i = 0; i < frames; i++) {
        const pos = dataOffset + (i * channels + c) * width;
        out[i] = bits === 8 ? (view.getUint8(pos) - 128) / 128 : view.getInt16(pos, true) / 32768;
      }
    }
    return buffer;
  }

  function playCustomBuffer() {
    if (!ac || !customBuffer) return false;
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    src.buffer = customBuffer;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start(0);
    soundsStarted++;
    return true;
  }

  function playCustomFile() {
    if (!customBytes || !customBytes.byteLength) return false;
    try {
      if (!customUrl) {
        const blob = new Blob([customBytes], { type: customType || 'audio/mpeg' });
        customUrl = URL.createObjectURL(blob);
      }
      if (!customAudio) {
        customAudio = new Audio();
        customAudio.setAttribute('playsinline', '');
        customAudio.setAttribute('webkit-playsinline', '');
        customAudio.preload = 'auto';
        customAudio.style.display = 'none';
        document.body.appendChild(customAudio);
      }
      if (customAudio.src !== customUrl) customAudio.src = customUrl;
      try { if (customAudio.currentTime) customAudio.currentTime = 0; } catch (e) {}
      const pending = customAudio.play();
      if (pending && pending.then) {
        pending.then(() => { soundsStarted++; }).catch((err) => {
          lastPlayError = err && err.message ? err.message : String(err);
        });
      } else soundsStarted++;
      return true;
    } catch (e) {
      return false;
    }
  }

  function primeCustomBuffer() {
    if (!customBytes || !customBytes.byteLength || customBuffer) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const wav = bufferFromWav(ctx, customBytes);
      if (wav) { customBuffer = wav; return; }
    } catch (e) {}
    const token = ++customDecode;
    const copy = customBytes.slice(0);
    Promise.resolve(ctx.decodeAudioData(copy)).then((buffer) => {
      if (token === customDecode && buffer) customBuffer = buffer;
    }).catch((err) => { lastPlayError = err && err.message ? err.message : String(err); });
  }

  function playClick() {
    try {
      unlockAudio();
      if (customBytes && customBytes.byteLength) {
        if (!customBuffer) primeCustomBuffer();
        if (playCustomBuffer() || playCustomFile()) {
          lastSound = 'custom';
          return 'custom';
        }
      }
      const ctx = ensureAudio();
      if (!ctx) return false;
      if (cfg.cursor === 'glow') { twinkle(); lastSound = 'glow'; return 'glow'; }
      heyListen();
      lastSound = 'fairy';
      return 'fairy';
    } catch (e) {
      return false;
    }
  }

  async function refreshCustom() {
    if (customBytes && customBytes.byteLength) return customName;
    if (!window.BookDB || !BookDB.getClickSound) return customName;
    try {
      const row = await BookDB.getClickSound();
      if (row && row.bytes && row.bytes.byteLength) {
        customBytes = row.bytes.slice(0);
        customType = row.type || '';
        customName = row.name || 'Custom sound';
        primeCustomBuffer();
      }
    } catch (e) {}
    return customName;
  }
  refreshCustom();

  function burst(n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 80;
      sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, age: 0, r: 1 + Math.random() * 1.6 }); }
    if (sparks.length > 160) sparks.splice(0, sparks.length - 160);
  }

  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    const t = (now - t0) / 1000, c = calm();
    const idle = (now - mouse.t) / 1000;
    let tx = mouse.x + OFF.x, ty = mouse.y + OFF.y;
    const wander = cfg.cursor === 'glow' ? 16 : 34;
    if (idle > 1.2 && !c && cfg.cursor === 'fairy') { const r = Math.min(1, (idle - 1.2) / 1.5) * wander;
      tx += Math.sin(t * 0.9) * r + Math.sin(t * 2.3) * r * 0.3; ty += Math.cos(t * 0.7) * r * 0.6 + Math.sin(t * 1.9) * r * 0.25; }
    const k = c ? 18 : 42, d = c ? 9 : 10.5;
    v.x += ((tx - p.x) * k - v.x * d) * dt; v.y += ((ty - p.y) * k - v.y * d) * dt;
    p.x += v.x * dt; p.y += v.y * dt;
    const speed = Math.hypot(v.x, v.y);
    if (!c && speed > 420 && sparks.length < 160) {
      const n = Math.min(3, speed / 500 | 0) + 1;
      for (let i = 0; i < n; i++) sparks.push({ x: p.x + (Math.random() - .5) * 6, y: p.y + (Math.random() - .5) * 6, vx: -v.x * 0.05 + (Math.random() - .5) * 30, vy: -v.y * 0.05 + (Math.random() - .5) * 30 + 10, life: 0.45 + Math.random() * 0.35, age: 0, r: 0.8 + Math.random() * 1.4 });
    }
    flash = Math.max(0, flash - dt * 2.2);
    fade += ((mouse.inside || !mouse.seen ? 1 : 0.35) - fade) * Math.min(1, dt * 4);
    draw(t, dt, c, speed);
  }

  function draw(t, dt, c, speed) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.age += dt; if (s.age >= s.life) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy = s.vy * 0.96 + 12 * dt;
      const a = (1 - s.age / s.life) * 0.8 * fade;
      ctx.fillStyle = `rgba(190,225,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
      if (s.r > 1.6) { ctx.fillRect(s.x - s.r * 2.2, s.y - 0.4, s.r * 4.4, 0.8); ctx.fillRect(s.x - 0.4, s.y - s.r * 2.2, 0.8, s.r * 4.4); }
    }
    const bob = c ? Math.sin(t * 1.2) * 1.5 : Math.sin(t * 2.4) * 3.5 + Math.sin(t * 5.1) * 1;
    const x = p.x, y = p.y + bob;
    const pulse = 0.85 + 0.15 * Math.sin(t * (c ? 1.5 : 3.2)) + flash * 0.9;
    const R = 34 * (0.9 + 0.1 * pulse) * (1 + flash * 0.5);
    ctx.globalCompositeOperation = 'source-over';
    let g = ctx.createRadialGradient(x, y, 0, x, y, R * 1.6);
    g.addColorStop(0, `rgba(150,205,255,${Math.min(0.85, 0.5 * fade * pulse)})`);
    g.addColorStop(0.3, `rgba(80,150,255,${0.28 * fade * pulse})`);
    g.addColorStop(1, 'rgba(40,90,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 1.6, 0, 7); ctx.fill();
    const flap = c ? 0.75 + 0.1 * Math.sin(t * 4) : 0.55 + 0.45 * Math.abs(Math.sin(t * (speed > 150 ? 34 : 22)));
    const tilt = Math.max(-0.45, Math.min(0.45, v.x / 1400));
    if (cfg.cursor === 'fairy') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      for (const side of [-1, 1]) {
        wing(side, -0.5, 20, 9, flap, 0.42);
        wing(side, 0.6, 13, 6.5, flap * 0.9, 0.34);
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0, x, y, 11);
    g.addColorStop(0, `rgba(255,255,255,${fade})`);
    g.addColorStop(0.45, `rgba(215,238,255,${0.95 * fade})`);
    g.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.95 * fade})`; ctx.beginPath(); ctx.arc(x, y, 4.2, 0, 7); ctx.fill();
    if (flash > 0.05) {
      ctx.strokeStyle = `rgba(220,240,255,${flash * 0.6 * fade})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 12 + (1 - Math.min(1, flash)) * 26, 0, 7); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function wing(side, ang, len, wid, flap, alpha) {
    ctx.save();
    ctx.scale(side, 1); ctx.rotate(ang);
    const rx = len * flap + 1.5;
    ctx.translate(4 + rx, 0);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, wid, 0, 0, 7);
    const g = ctx.createRadialGradient(-rx, 0, 0, -rx * 0.3, 0, rx * 1.6);
    g.addColorStop(0, `rgba(240,248,255,${alpha * 1.5 * fade})`); g.addColorStop(1, `rgba(120,180,255,${alpha * 0.45 * fade})`);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = `rgba(200,230,255,${alpha * 1.6 * fade})`; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.restore();
  }

  const running = () => !!raf;
  function start() { if (raf || cfg.cursor === 'off' || !supported() || document.hidden) return; cv.style.display = 'block'; last = 0; raf = requestAnimationFrame(step); }
  function stop(hide = true) { if (raf) cancelAnimationFrame(raf); raf = 0; if (hide) { cv.style.display = 'none'; sparks = []; } }
  function sync() { if (cfg.cursor !== 'off' && supported()) start(); else stop(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(false); else sync(); });
  (mqFine.addEventListener ? mqFine.addEventListener('change', sync) : mqFine.addListener(sync));

  const labels = { fairy: 'Fairy', glow: 'Glow', off: 'Normal cursor' };
  window.Fairy = {
    get cursor() { return cfg.cursor; },
    get on() { return cfg.cursor !== 'off'; },
    get sound() { return cfg.sound; },
    get customName() { return customName; },
    get lastSound() { return lastSound; },
    get soundsStarted() { return soundsStarted; },
    get lastPlayError() { return lastPlayError; },
    get audioState() { return ac ? ac.state : 'closed'; },
    get supported() { return supported(); },
    get running() { return running(); },
    get label() { return labels[cfg.cursor] || 'Cursor'; },
    get pos() { return { x: Math.round(p.x), y: Math.round(p.y) }; },
    setCursor(cursor) {
      cfg.cursor = CURSORS.includes(cursor) ? cursor : 'off';
      save(); sync();
      document.dispatchEvent(new CustomEvent('fairychange'));
      return cfg.cursor;
    },
    set(on) { return this.setCursor(on ? 'fairy' : 'off') !== 'off'; },
    cycle() {
      const i = CURSORS.indexOf(cfg.cursor);
      return this.setCursor(CURSORS[(i + 1) % CURSORS.length]);
    },
    toggle() { return this.cycle() !== 'off'; },
    setSound(on) { cfg.sound = !!on; save(); if (on) playClick(); document.dispatchEvent(new CustomEvent('fairychange')); },
    preview() { return playClick(); },
    unlock() { unlockAudio(); },
    refreshCustom,
    setCustom(bytes, name, type) {
      const nextName = name || '';
      const keepUrl = !!(customUrl && customName === nextName);
      if (!keepUrl) forgetCustomUrl();
      customBytes = bytes && bytes.byteLength ? bytes.slice(0) : null;
      customType = type || '';
      customName = nextName;
      customBuffer = null;
      customDecode = 0;
      lastSound = '';
      primeCustomBuffer();
    },
    clearCustom() { forgetCustomUrl(); customBytes = null; customType = ''; customName = ''; lastSound = ''; }
  };
  sync();
})();
