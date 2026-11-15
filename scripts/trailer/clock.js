// A12 (tráiler): reloj controlado que se inyecta en la página ANTES de que arranque el juego.
//
// Dos modos:
//  - «libre» (por defecto): el reloj virtual sigue al real (menos un desfase). El juego carga y se prepara con la API de
//    QA (que usa setTimeout/Date.now) como siempre.
//  - «captura» (`__clock.capture()`): el tiempo SOLO avanza con `__clock.step()`, exactamente 1000/fps ms por paso.
//    requestAnimationFrame, performance.now, Date.now, setTimeout y setInterval van con ese reloj, así que el bucle de
//    Phaser, sus tweens, los temporizadores del ScriptEngine y los textos que se escriben letra a letra avanzan igual
//    por muy lenta que sea la captura de cada fotograma. Lo único que sigue al reloj real es lo que no pasa por aquí:
//    animaciones CSS de los paneles HTML y el final de un clip de audio (los subtítulos de cinemática esperan por la
//    duración del clip, que sí es virtual).
//  - `__clock.free()` vuelve al modo libre sin salto de tiempo.
//
// Además registra cada sonido que el juego pide a Phaser (`sound.add`/`sound.play`) con su instante virtual, para que
// el montaje ponga los clips reales con ffmpeg (`<plano>.audio.json`).
//
// Se usa como texto: `page.evaluateOnNewDocument(CLOCK_SRC)`.
export const CLOCK_SRC = String.raw`(() => {
  if (window.__clock) return;
  const origRAF = window.requestAnimationFrame.bind(window);
  const origCAF = window.cancelAnimationFrame.bind(window);
  const origST = window.setTimeout.bind(window);
  const origCT = window.clearTimeout.bind(window);
  const origSI = window.setInterval.bind(window);
  const origCI = window.clearInterval.bind(window);
  const origPerf = performance.now.bind(performance);
  const origDate = Date.now.bind(Date);
  const dateBase = origDate() - origPerf();
  let capture = false;
  let offset = 0;          // modo libre: virtual = real - offset
  let vt = origPerf();     // modo captura: tiempo virtual (ms, base performance.now)
  const now = () => (capture ? vt : origPerf() - offset);

  // rAF
  let rafSeq = 0;
  const rafPending = new Map(); // id virtual -> cb
  const rafReal = new Map();    // id virtual -> { rid: id real, cb } (modo libre)
  window.requestAnimationFrame = (cb) => {
    const id = ++rafSeq;
    if (capture) rafPending.set(id, cb);
    else rafReal.set(id, { cb, rid: origRAF(() => { rafReal.delete(id); cb(now()); }) });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafPending.delete(id);
    if (rafReal.has(id)) { origCAF(rafReal.get(id).rid); rafReal.delete(id); }
  };

  // Temporizadores
  let tSeq = 1e6;
  const timers = new Map(); // id -> { due, cb, args, every, real }
  const arm = (id) => {
    const t = timers.get(id);
    if (!t || capture) return;
    t.real = origST(() => {
      if (!timers.has(id)) return;
      if (t.every != null) { t.due = now() + t.every; arm(id); } else timers.delete(id);
      try { t.cb(...t.args); } catch (e) { console.error(e); }
    }, Math.max(0, t.due - now()));
  };
  const add = (cb, ms, args, every) => {
    const id = ++tSeq;
    const fn = typeof cb === 'function' ? cb : () => (0, eval)(String(cb));
    timers.set(id, { due: now() + Math.max(0, Number(ms) || 0), cb: fn, args, every, real: null });
    arm(id);
    return id;
  };
  const clear = (id) => { const t = timers.get(id); if (t && t.real != null) origCT(t.real); timers.delete(id); };
  window.setTimeout = (cb, ms, ...args) => add(cb, ms, args, null);
  window.setInterval = (cb, ms, ...args) => add(cb, ms, args, Math.max(1, Number(ms) || 0));
  window.clearTimeout = clear;
  window.clearInterval = clear;

  performance.now = () => now();
  Date.now = () => Math.round(dateBase + now());

  const runTimersUpTo = (limit) => {
    for (let guard = 0; guard < 10000; guard++) {
      let best = null;
      for (const [id, t] of timers) if (t.due <= limit && (!best || t.due < best[1].due)) best = [id, t];
      if (!best) return;
      const [id, t] = best;
      if (t.every != null) t.due += t.every; else timers.delete(id);
      try { t.cb(...t.args); } catch (e) { console.error(e); }
    }
  };

  // Registro de sonidos
  const audioLog = [];
  let audioT0 = 0;
  const hookSound = () => {
    const sm = window.__game && window.__game.sound;
    if (!sm || sm.__trailerHooked) return !!sm;
    sm.__trailerHooked = true;
    const wrap = (name) => {
      const orig = sm[name].bind(sm);
      sm[name] = (key, cfg) => {
        const r = orig(key, cfg);
        if (name === 'add' && r && typeof r.play === 'function' && !r.__tr) {
          r.__tr = true;
          const p = r.play.bind(r);
          r.play = (...a) => { audioLog.push({ key, t: now() - audioT0, volume: (cfg && cfg.volume) ?? null, loop: !!(cfg && cfg.loop) }); return p(...a); };
        } else if (name === 'play') {
          audioLog.push({ key, t: now() - audioT0, volume: (cfg && cfg.volume) ?? null, loop: !!(cfg && cfg.loop), direct: true });
        }
        return r;
      };
    };
    wrap('add'); wrap('play');
    return true;
  };

  window.__clock = {
    fps: 60,
    get capturing() { return capture; },
    now,
    capture(fps) {
      if (capture) return;
      hookSound();
      this.fps = fps || this.fps;
      vt = now();
      capture = true;
      // Los temporizadores reales pendientes pasan al reloj virtual; los rAF reales pendientes, a la cola virtual
      for (const t of timers.values()) if (t.real != null) { origCT(t.real); t.real = null; }
      for (const [id, r] of rafReal) { origCAF(r.rid); rafReal.delete(id); rafPending.set(id, r.cb); }
      audioLog.length = 0;
      audioT0 = vt;
    },
    /** Avanza un fotograma: temporizadores vencidos y luego los rAF pedidos (el bucle de Phaser). */
    step(n = 1) {
      const dt = 1000 / this.fps;
      for (let i = 0; i < n; i++) {
        vt += dt;
        runTimersUpTo(vt);
        const cbs = [...rafPending.values()];
        rafPending.clear();
        for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } }
      }
      return vt - audioT0;
    },
    free() {
      if (!capture) return;
      offset = origPerf() - vt;
      capture = false;
      for (const id of timers.keys()) arm(id);
      const cbs = [...rafPending.entries()];
      rafPending.clear();
      for (const [id, cb] of cbs) rafReal.set(id, { cb, rid: origRAF(() => { rafReal.delete(id); cb(now()); }) });
    },
    hookSound,
    audio: () => audioLog.slice(),
    /** Espera real (no la frena el modo captura) */
    realSleep: (ms) => new Promise((r) => origST(r, ms)),
  };
})();`;
