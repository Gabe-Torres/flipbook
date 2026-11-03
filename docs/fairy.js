/* Glowing fairy companion — an original drawing (canvas).
   pointer-events:none overlay; follows the mouse with a spring; idles, wanders, sparkles.
   Hidden on touch-only devices. Toggle: N key or Menu › Fairy. Saved in localStorage.
   Respects prefers-reduced-motion. */
(() => {
  'use strict';
  const KEY = 'flipbook.fairy';
  const load = () => { try { return Object.assign({ on: true, sound: false }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { on: true, sound: false }; } };
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
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 26) { flash = 1.4; burst(14); if (cfg.sound) twinkle(); }
  }, true);

  let ac = null;
  function twinkle() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const now = ac.currentTime + 0.02, master = ac.createGain(); master.gain.value = 0.06; master.connect(ac.destination);
      const notes = [[1760, 0], [2349, 0.07], [2093, 0.26], [2637, 0.33], [3136, 0.40]];
      for (const [f, dt] of notes) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(f, now + dt); o.frequency.exponentialRampToValueAtTime(f * 1.02, now + dt + 0.12);
        g.gain.setValueAtTime(0, now + dt); g.gain.linearRampToValueAtTime(1, now + dt + 0.008); g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.22);
        o.connect(g); g.connect(master); o.start(now + dt); o.stop(now + dt + 0.25);
      }
    } catch (e) {}
  }

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
    if (idle > 1.2 && !c) { const r = Math.min(1, (idle - 1.2) / 1.5) * 34;
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
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    for (const side of [-1, 1]) {
      wing(side, -0.5, 20, 9, flap, 0.42);
      wing(side, 0.6, 13, 6.5, flap * 0.9, 0.34);
    }
    ctx.restore();
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
  function start() { if (raf || !cfg.on || !supported() || document.hidden) return; cv.style.display = 'block'; last = 0; raf = requestAnimationFrame(step); }
  function stop(hide = true) { if (raf) cancelAnimationFrame(raf); raf = 0; if (hide) { cv.style.display = 'none'; sparks = []; } }
  function sync() { if (cfg.on && supported()) start(); else stop(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(false); else sync(); });
  (mqFine.addEventListener ? mqFine.addEventListener('change', sync) : mqFine.addListener(sync));

  window.Fairy = {
    get on() { return cfg.on; }, get sound() { return cfg.sound; }, get supported() { return supported(); }, get running() { return running(); },
    get pos() { return { x: Math.round(p.x), y: Math.round(p.y) }; },
    set(on) { cfg.on = !!on; save(); sync(); document.dispatchEvent(new CustomEvent('fairychange')); return cfg.on; },
    toggle() { return this.set(!cfg.on); },
    setSound(on) { cfg.sound = !!on; save(); if (on) twinkle(); document.dispatchEvent(new CustomEvent('fairychange')); }
  };
  sync();
})();
