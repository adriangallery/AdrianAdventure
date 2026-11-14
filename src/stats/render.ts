/**
 * A9.17: pintado de la página /stats (HTML + barras CSS, sin librerías). Recibe el JSON de GET /stats/summary.
 * Paleta del juego (src/config/theme.ts: amarillo #f8e848, lila #8878a8, cian #48d8e8, fondo #08080f).
 */
export interface StatsSummary {
  range: { from: string | null; to: string | null; days: number };
  uniques: { today: number; week: number; daily: Array<{ day: string; uniques: number; newGames: number; continues: number }> };
  games: { new: number; continue: number };
  funnel: Array<{ chapter: number; start: number; complete: number }>;
  chapterTime: Array<{ chapter: number; n: number; p25: number | null; median: number | null; p75: number | null }>;
  finish: { started: number; completed: number; rate: number | null };
  platform: { mobile: number; desktop: number };
  browser: Record<string, number>;
  wallet: { with: number; without: number };
  quitScenes: Array<{ scene: string; n: number }>;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const mins = (s: number | null): string => (s === null ? '—' : `${Math.round(s / 60)}m`);

function bar(label: string, value: number, max: number, text: string, color = 'var(--y)'): string {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return `<div class="row"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill" style="width:${w}%;background:${color}"></span></span><span class="val">${esc(text)}</span></div>`;
}

function split(title: string, a: [string, number], b: [string, number]): string {
  const total = a[1] + b[1];
  const wa = total > 0 ? (a[1] / total) * 100 : 50;
  return `<div class="card"><h2>${esc(title)}</h2>
    <div class="split"><span style="width:${wa}%;background:var(--y)"></span><span style="width:${100 - wa}%;background:var(--c)"></span></div>
    <p class="legend"><b class="y">■</b> ${esc(a[0])} ${a[1]} (${pct(a[1], total)}) &nbsp; <b class="c">■</b> ${esc(b[0])} ${b[1]} (${pct(b[1], total)})</p></div>`;
}

export function renderSummary(s: StatsSummary): string {
  const kpi = (n: string, l: string) => `<div class="kpi"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
  const daily = s.uniques.daily.slice(-14);
  const dMax = Math.max(1, ...daily.map((d) => d.uniques));
  const fMax = Math.max(1, ...s.funnel.map((f) => f.start));
  const tMax = Math.max(1, ...s.chapterTime.map((t) => t.p75 ?? 0));
  const qMax = Math.max(1, ...s.quitScenes.map((q) => q.n));
  const parts: string[] = [];
  parts.push(`<div class="kpis">${kpi(String(s.uniques.today), 'players today')}${kpi(String(s.uniques.week), 'players 7 days')}${kpi(s.finish.rate === null ? '—' : `${s.finish.rate}%`, 'reach the end')}</div>`);
  parts.push(`<div class="card"><h2>Unique players / day</h2>${daily.length ? daily.map((d) => bar(d.day.slice(5), d.uniques, dMax, String(d.uniques))).join('') : '<p class="empty">No data yet</p>'}</div>`);
  parts.push(split('New vs continued games', ['New', s.games.new], ['Continue', s.games.continue]));
  parts.push(`<div class="card"><h2>Chapter funnel</h2><p class="legend"><b class="y">■</b> start <b class="c">■</b> complete</p>${s.funnel.map((f) =>
    bar(`Ch${f.chapter} in`, f.start, fMax, String(f.start)) + bar(`Ch${f.chapter} out`, f.complete, fMax, `${f.complete} ${pct(f.complete, f.start)}`, 'var(--c)')).join('')}</div>`);
  parts.push(`<div class="card"><h2>Time per chapter</h2><p class="legend">median · p25–p75 (minutes)</p>${s.chapterTime.map((t) => {
    if (t.median === null) return `<div class="row"><span class="lbl">Ch${t.chapter}</span><span class="track"></span><span class="val">—</span></div>`;
    const l = ((t.p25 ?? 0) / tMax) * 100;
    const w = Math.max(1, (((t.p75 ?? 0) - (t.p25 ?? 0)) / tMax) * 100);
    const m = (t.median / tMax) * 100;
    return `<div class="row"><span class="lbl">Ch${t.chapter}</span><span class="track"><span class="iqr" style="left:${l}%;width:${w}%"></span><span class="med" style="left:${m}%"></span></span><span class="val">${mins(t.median)} ${mins(t.p25)}–${mins(t.p75)} n${t.n}</span></div>`;
  }).join('')}</div>`);
  parts.push(`<div class="card"><h2>Reach the end</h2>${bar('Started', s.finish.started, Math.max(1, s.finish.started), String(s.finish.started))}${bar('Finished', s.finish.completed, Math.max(1, s.finish.started), `${s.finish.completed} ${s.finish.rate === null ? '' : `${s.finish.rate}%`}`, 'var(--c)')}</div>`);
  parts.push(split('Mobile vs desktop', ['Mobile', s.platform.mobile], ['Desktop', s.platform.desktop]));
  parts.push(split('With vs without wallet', ['Wallet', s.wallet.with], ['No wallet', s.wallet.without]));
  parts.push(`<div class="card"><h2>Where players quit</h2>${s.quitScenes.length ? s.quitScenes.map((q) => bar(q.scene, q.n, qMax, String(q.n), 'var(--p)')).join('') : '<p class="empty">No data yet</p>'}</div>`);
  const bMax = Math.max(1, ...Object.values(s.browser));
  parts.push(`<div class="card"><h2>Browsers</h2>${Object.entries(s.browser).map(([b, n]) => bar(b, n, bMax, String(n), 'var(--p)')).join('')}</div>`);
  parts.push(`<p class="foot">${esc(s.range.from ?? '')} → ${esc(s.range.to ?? '')} · ${s.range.days} days · anonymous, no IPs, no addresses</p>`);
  return parts.join('');
}

export const STATS_CSS = `
:root{--bg:#08080f;--panel:#10101a;--line:#2a2a40;--y:#f8e848;--c:#48d8e8;--p:#8878a8;--t:#f0e8d8}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--t);font-family:'Press Start 2P',monospace;-webkit-text-size-adjust:100%}
#dash[hidden],#gate[hidden]{display:none!important}
#app{max-width:760px;margin:0 auto;padding:16px 12px 40px}
.top h1{font-size:18px;color:var(--y);margin:8px 0 6px;letter-spacing:1px}
.sub{font-size:9px;color:var(--p);margin:0 0 16px}
.card{background:var(--panel);border:2px solid var(--line);padding:12px;margin:0 0 12px;image-rendering:pixelated}
.card p{font-size:10px;line-height:1.7;margin:0 0 10px}
h2{font-size:11px;color:var(--y);margin:0 0 10px;line-height:1.5}
button{font-family:inherit;font-size:12px;color:var(--bg);background:var(--y);border:0;box-shadow:0 4px 0 #a89820;padding:14px 16px;min-height:48px;width:100%;cursor:pointer}
button:active{transform:translateY(2px);box-shadow:0 2px 0 #a89820}
button:disabled{opacity:.6}
.status{color:var(--c);min-height:1.7em}
.status.err{color:#f86848}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 12px}
.kpi{background:var(--panel);border:2px solid var(--line);padding:10px 6px;text-align:center}
.kpi b{display:block;font-size:16px;color:var(--y);margin-bottom:8px}
.kpi span{font-size:8px;color:var(--p);line-height:1.5}
.row{display:grid;grid-template-columns:76px 1fr auto;gap:8px;align-items:center;margin:0 0 8px;font-size:9px}
.lbl{color:var(--t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.val{color:var(--t);white-space:nowrap;font-size:8px}
.track{position:relative;height:12px;background:#000;border:1px solid var(--line)}
.fill{position:absolute;left:0;top:0;bottom:0}
.iqr{position:absolute;top:2px;bottom:2px;background:var(--c);opacity:.6}
.med{position:absolute;top:-2px;bottom:-2px;width:3px;background:var(--y);margin-left:-1px}
.split{display:flex;height:16px;border:1px solid var(--line);margin:0 0 10px}
.split span{display:block;height:100%}
.legend{font-size:8px!important;color:var(--p)}
.legend .y{color:var(--y)}.legend .c{color:var(--c)}
.empty{color:var(--p)}
.foot{font-size:8px;color:var(--p);line-height:1.7;text-align:center}
@media (min-width:700px){#dash{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}#dash .kpis,#dash .foot{grid-column:1/-1}.row{grid-template-columns:90px 1fr auto}}
`;
