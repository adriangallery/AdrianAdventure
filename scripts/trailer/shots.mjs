// A12 (tráiler): lista de planos. Cada plano:
//   name      «nn-nombre» (el mp4 sale como /var/tmp/adv-trailer/clips/<name>.mp4)
//   beat      fila de la tabla del guion (docs/progreso/A12.md) a la que pertenece
//   scene     escena del juego (?qa=1&scene=…); sin escena = portada (MenuScene)
//   dur       ms útiles del plano (el arnés graba además 1 s delante y 1 s detrás)
//   setup     (page) => preparación en tiempo real con la API de QA (flags, inventario, posición, interfaz)
//   timeline  [[ms, fn, arg]…]: acciones dentro de la página en tiempo virtual (0 = comienzo del plano útil)
//   web3      true si el plano enseña cartera/$ZERO (para el corte sin web3 de Steam)
//   vertical  true = viewport móvil 390×844 ×2,77 (1080×2337) para el corte 9:16
//
// Las acciones de la línea de tiempo no esperan: lanzan un script del juego (window.__tr.run), tocan para pasar un
// texto (__tr.tap), andan (__tr.walk), etc. Todo con frases y pantallas que ya existen en el juego.

/** Flags para que ninguna intro de capítulo salte encima del plano */
const QUIET = {
  premise_shown: true, chapter_1_intro_shown: true, chapter_2_intro_shown: true, chapter_3_intro_shown: true,
  chapter_4_intro_shown: true, chapter_5_intro_shown: true, epilogue_intro_shown: true,
};

/** Preparación común: deja la escena libre, pone flags/objetos, coloca a Dex y oculta el panel de verbos. */
export function prep({ flags = {}, items = [], at = null, chrome = false, costume = null, quiet = true } = {}) {
  return async (page) => {
    await page.evaluate(() => window.__qa.dismissAll());
    const all = { ...(quiet ? QUIET : {}), ...flags };
    const ops = [
      ...Object.entries(all).map(([flag, value]) => ({ op: 'setFlag', flag, value })),
      ...items.map((id) => ({ op: 'addItem', id, name: id })),
      ...(costume ? [{ op: 'setCostume', prefix: costume }] : []),
    ];
    if (ops.length) await page.evaluate((o) => window.__qa.runScript(o), ops);
    if (at) await page.evaluate(([x, y]) => window.__tr.teleport(x, y), at);
    await page.evaluate(() => window.__qa.dismissAll());
    if (!chrome) await page.evaluate(() => window.__tr.chrome(true));
    await page.evaluate(() => window.__clock.realSleep(600));
  };
}

// Acciones de la línea de tiempo (se serializan a la página: nada de variables de fuera)
const run = (ops) => [(o) => window.__tr.run(o), ops];
const tap = () => [() => window.__tr.tap()];
const walk = (x, y) => [(p) => window.__tr.walk(p[0], p[1]), [x, y]];
const say = (text, speaker) => run([{ op: 'say', text, ...(speaker ? { speaker } : {}) }]);
const at = (ms, action) => [ms, ...action];
/** Lanza el script real de un verbo sobre un hotspot de la escena (el mismo que con el ratón, sin andar hasta él) */
const verb = (hotspotId, v) => [(a) => {
  const gs = window.__tr.gs();
  const h = gs.sceneDataLoader.getSceneData().regions.hotspots.find((x) => x.id === a[0]);
  const ops = h?.scripts?.[a[1]];
  if (ops) window.__tr.run(ops); else console.error(`[tr] sin script ${a[1]} en ${a[0]}`);
}, [hotspotId, v]];

export { verb };
export const SHOTS = [
  // ── 1 · CRT del sótano ──
  {
    name: '01-crt-escaped', beat: 1, scene: 'basement', dur: 5000,
    note: 'línea real del combo disquete+CRT (basement/scene.json)',
    setup: prep({ at: [50, 88] }),
    timeline: [at(0, run([{ op: 'say', screen: 'crt', display: 'PATIENT ZERO — STATUS: ESCAPED', text: 'At the bottom, in red: PATIENT ZERO — STATUS: ESCAPED' }]))],
  },
  // ── 3 · outside: la intro de verdad (paneo + mensaje de Adrian) ──
  {
    name: '03-outside-intro', beat: 3, scene: 'outside', dur: 11000,
    note: 'cinemática de entrada de outside en partida nueva (paneo 5 s + «Find Patient Zero. Bring them home.»)',
    setup: async (page) => { await page.evaluate(() => window.__tr.chrome(true)); },
  },
  // ── 5 · Dex ──
  {
    name: '05a-dex-acera', beat: 5, scene: 'outside', dur: 5000,
    setup: prep({ at: [12, 97.5] }),
    timeline: [at(0, walk(62, 97.5))],
  },
  {
    name: '05b-dex-idle', beat: 5, scene: 'outside', dur: 7000,
    note: 'idle con manía (A4.1: tras unos segundos quieto)',
    setup: prep({ at: [55, 97] }),
  },
  {
    name: '05c-dooris-87', beat: 5, scene: 'outside', dur: 11000,
    note: 'DOORIS: hello → factors → «Voice match: 87%…» (toques a 3,2 s y 7 s)',
    setup: prep({ at: [38.2, 91.5] }),
    timeline: [
      at(0, run([{ op: 'dialogue', npcId: 'dooris', treeId: 'dooris_auth' }])),
      at(3600, tap()), at(7600, tap()),
    ],
  },
  // ── 7 · el laboratorio ──
  {
    name: '07a-lobby-penny', beat: 7, scene: 'lobby', dur: 4000,
    setup: prep({ at: [36, 95], flags: { penny_met: true } }),
    timeline: [at(0, say('You have a very... refundable face.', 'Penny'))],
  },
  {
    name: '07b-upstairs-rig', beat: 7, scene: 'upstairs', dur: 3000,
    setup: prep({ at: [30, 97] }),
  },
  {
    name: '07c-rig-dashboard', beat: 7, scene: 'upstairs', dur: 4000, web3: true,
    note: 'panel del Mining Rig (cartera de prueba de QA)',
    setup: async (page) => {
      await prep({ at: [18, 97] })(page);
      await page.evaluate(() => window.__qa.fakeWallet('0x6e369bf0e4e0c106192d606fb6d85836d684da75', true));
    },
    timeline: [at(0, run([{ op: 'showDashboard' }]))],
  },
  {
    name: '07d-cajon', beat: 7, scene: 'upstairs', dur: 3000,
    setup: prep({ at: [55, 97] }),
    timeline: [at(0, walk(61.4, 97)), at(1200, verb('hs_desk_drawer', 'LOOK'))],
  },
  {
    name: '07e-sotano', beat: 7, scene: 'basement', dur: 3000,
    setup: prep({ at: [25, 92] }),
    timeline: [at(0, walk(45, 90))],
  },
  {
    name: '07f-server-room', beat: 7, scene: 'server_room', dur: 3000,
    setup: prep({ at: [25, 96] }),
    timeline: [at(0, walk(45, 96))],
  },
  // ── 9 · sube la tensión ──
  {
    name: '09a-pzbot-terminal', beat: 9, scene: 'server_room', dur: 3500,
    setup: prep({ at: [52, 96] }),
    timeline: [at(0, run([{ op: 'say', screen: 'terminal', speaker: 'PZ-BOT', text: 'ACCESS DENIED. OWNER ONLY. OR ALPHA. DO YOU HAVE ALPHA?' }]))],
  },
  {
    name: '09b-chad-fud', beat: 9, scene: 'recovery_pool', dur: 5000,
    note: 'réplica real de Chad y el panel de elecciones con sus respuestas reales (nodo i1 de chad_fud)',
    setup: prep({ at: [52, 95] }),
    timeline: [
      at(0, say('Your bags are so heavy, the lifeguard filed a complaint.', 'Chad')),
      at(2600, [() => {
        const cp = window.__tr.ui().getChoicePanel();
        void cp.show([
          'A broken clock is right twice a day. You\'re on a streak of zero.',
          'Still more detail than your exit plan.',
          'At least mine float. Yours sank in a kiddie pool.',
          'Then today they\'ll hear you lose.',
          'Uh... no they\'re not?',
        ].map((text) => ({ text, enabled: true })));
      }]),
    ],
  },
  {
    name: '09c-montana', beat: 9, scene: 'mountain', dur: 3000,
    setup: prep({}),
  },
  {
    name: '09d-clinica-fuera', beat: 9, scene: 'clinic_exterior', dur: 3000,
    setup: prep({ at: [20, 97] }),
    timeline: [at(0, walk(45, 97))],
  },
  {
    name: '09e-nurse-gwei', beat: 9, scene: 'clinic_exterior', dur: 4000,
    setup: prep({ at: [47, 92] }),
    timeline: [at(0, run([{ op: 'dialogue', npcId: 'gwei_intake', treeId: 'gwei_intake' }]))],
  },
  {
    name: '09f-dr-satoshi', beat: 9, scene: 'clinic_interior', dur: 4000,
    setup: prep({ at: [68, 97] }),
    timeline: [at(0, run([{ op: 'dialogue', npcId: 'npc_dr_satoshi', treeId: 'dr_satoshi_intro' }]))],
  },
  {
    name: '09g-veleta', beat: 9, scene: 'rooftop', dur: 3000,
    setup: prep({ at: [72, 80] }),
    timeline: [at(500, run([{ op: 'setFlag', flag: 'vane_pushed', value: true }]))],
  },
  {
    name: '09h-dex-mono', beat: 9, scene: 'recovery_pool', dur: 3000,
    setup: prep({ at: [25, 97], costume: 'ape' }),
    timeline: [at(0, walk(45, 97))],
  },
  // ── 10 · Gerald ──
  {
    name: '10-gerald', beat: 10, scene: 'recovery_pool', dur: 2500,
    setup: prep({ at: [46, 95] }),
  },
  // ── 11 · clímax: planos muy cortos (el premontaje coge 0,6-0,7 s de cada uno) ──
  { name: '11a-coger', beat: 11, scene: 'outside', dur: 2000, setup: prep({ at: [57, 92] }), timeline: [at(0, verb('hs_mailbox', 'OPEN'))] },
  { name: '11b-puerta', beat: 11, scene: 'lobby', dur: 2000, setup: prep({ at: [80, 96] }), timeline: [at(0, verb('hs_frontdoor', 'OPEN'))] },
  { name: '11c-escotilla', beat: 11, scene: 'upstairs', dur: 2000, setup: prep({ at: [31, 97] }), timeline: [at(0, verb('hs_roof_hatch', 'OPEN'))] },
  {
    name: '11d-pantalla', beat: 11, scene: 'basement', dur: 2000, setup: prep({ at: [50, 88] }),
    timeline: [at(0, run([{ op: 'say', screen: 'crt', display: 'PATIENT ROSTER\nChronic Airdrop Dependency\nAcute Rug Pull Trauma\nTerminal FOMO', text: 'A patient roster. Chronic Airdrop Dependency... Acute Rug Pull Trauma... Terminal FOMO...' }]))],
  },
  { name: '11e-correr', beat: 11, scene: 'outside', dur: 1500, setup: prep({ at: [70, 97.5] }), timeline: [at(0, walk(30, 97.5))] },
  { name: '11f-transicion', beat: 11, scene: 'basement', dur: 2000, setup: prep({ at: [14, 90] }), timeline: [at(0, verb('hs_stairs', 'USE'))] },
  { name: '11g-coger2', beat: 11, scene: 'server_room', dur: 2000, setup: prep({ at: [40, 97] }), timeline: [at(0, verb('hs_raised_floor', 'PICK'))] },
  { name: '11h-puerta2', beat: 11, scene: 'rooftop', dur: 2000, setup: prep({ at: [87.5, 97] }), timeline: [at(0, verb('hs_roof_door', 'OPEN'))] },
  { name: '11i-cinematica', beat: 11, scene: 'rooftop', dur: 2000, setup: prep({ at: [38, 80] }), timeline: [at(0, verb('hs_lobbyhatch', 'USE'))] },
  { name: '11j-correr2', beat: 11, scene: 'upstairs', dur: 1500, setup: prep({ at: [20, 97] }), timeline: [at(0, walk(60, 97))] },
  { name: '11k-destello', beat: 11, scene: 'memelab', dur: 1500, setup: prep({ at: [30, 96] }) },
  // ── 13 · el Lambo ──
  {
    name: '13-lambo', beat: 13, scene: 'lobby', dur: 8000,
    note: 'cinemática lambo_seen entera (pzbot_crashed puesto en el lobby y paso a outside)',
    setup: prep({ flags: { pzbot_crashed: true } }),
    timeline: [at(-900, [() => window.__tr.goto('outside', { x: 72, y: 97.9 })])],
  },
  // ── 14 · portada ──
  {
    name: '14-titulo', beat: 14, scene: null, dur: 5000,
    setup: async (page) => { await page.evaluate(() => window.__clock.realSleep(1500)); },
  },
  // ── corte vertical 9:16 (viewport móvil de verdad) ──
];

// Verticales: mismos planos, viewport 390×844 ×2,77 → 1080×2337 (se recorta a 1080×1920 en el montaje)
for (const base of ['01-crt-escaped', '05a-dex-acera', '05c-dooris-87', '09b-chad-fud', '11c-escotilla', '13-lambo', '14-titulo']) {
  const s = SHOTS.find((x) => x.name === base);
  SHOTS.push({ ...s, name: `v${base}`, vertical: true });
}
