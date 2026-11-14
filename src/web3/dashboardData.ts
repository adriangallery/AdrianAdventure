// A3.10 (plan SCUMM): datos y textos del dashboard TraitLab del Mining Rig (upstairs). Lógica pura, sin viem, Phaser
// ni DOM (se prueba en Node). La carga on-chain está en src/web3/dashboard.ts y el panel en src/ui/DashboardPanel.ts.

/** Lo que el panel enseña. Cada lectura va por separado: si una falla, su campo es null y su nombre va en `errors`. */
export interface DashboardData {
  address: string;
  /** Saldo de $ZERO en wei (18 decimales); null = no se pudo leer */
  zeroWei: bigint | null;
  /** Número de AdrianZERO; null = no se pudo leer */
  adrianZeroCount: number | null;
  /** Número de AdrianPunks; null = no se pudo leer */
  punksCount: number | null;
  /** Algunos AdrianZERO y traits de AdrianLAB por nombre (Alchemy); null = no se pudo leer (o no hay clave de Alchemy) */
  tokens: { adrianZero: string[]; lab: string[]; labCount: number } | null;
  /** Lecturas que fallaron (`zero`, `adrianZero`, `punks`, `tokens`) */
  errors: string[];
  /** true si los datos vienen de `__qa.mockWeb3` */
  simulated: boolean;
}

/** URL de TraitLab: la web del ecosistema (no se inventan otras). */
export const TRAITLAB_URL = 'https://adrianzero.com';

/** Cuántos nombres de token se enseñan como mucho por lista */
export const MAX_TOKEN_NAMES = 6;

/**
 * A3.10: el dato útil que el rig le enseña al holder: el PIN del Ledger del sótano (cap. 3). Con `rig_dashboard_seen` el
 * árbol `ledger_pin` de basement ofrece «0301.» aunque Dex no sepa aún el cumpleaños de Gerald (atajo de un paso).
 */
export const RIG_PIN_TIP = 'Ledger PIN = Gerald\'s birthday, DDMM: 0301. Write it down. Gerald did.';

/** 0x1234…abcd */
export function shortAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{8,}$/.test(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** wei (18 decimales) → «12,345.67» (como mucho 2 decimales, sin ceros de cola) */
export function formatZero(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const cents = (abs % 10n ** 18n) / 10n ** 16n;
  const intText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = cents === 0n ? '' : `.${cents.toString().padStart(2, '0').replace(/0$/, '')}`;
  return `${neg ? '-' : ''}${intText}${dec}`;
}

/** Una línea del panel: etiqueta, valor y si es un aviso */
export interface DashboardRow { label: string; value: string; warn?: boolean }

/** Filas del panel a partir de los datos (orden fijo). Lo que falló sale con un aviso, lo demás se enseña igual. */
export function dashboardRows(d: DashboardData): DashboardRow[] {
  const rows: DashboardRow[] = [];
  rows.push({ label: 'WALLET', value: shortAddress(d.address) + (d.simulated ? ' (simulated)' : '') });
  rows.push(d.zeroWei === null
    ? { label: '$ZERO', value: 'RPC timed out. The rig shrugs.', warn: true }
    : { label: '$ZERO', value: formatZero(d.zeroWei) });
  rows.push(d.adrianZeroCount === null
    ? { label: 'AdrianZERO', value: 'unreadable', warn: true }
    : { label: 'AdrianZERO', value: String(d.adrianZeroCount) });
  if (d.punksCount !== null && d.punksCount > 0) rows.push({ label: 'AdrianPunks', value: String(d.punksCount) });
  if (d.tokens) {
    if (d.tokens.adrianZero.length) {
      rows.push({ label: 'ZEROs', value: listNames(d.tokens.adrianZero) });
    }
    rows.push({ label: 'Traits (LAB)', value: d.tokens.labCount ? `${d.tokens.labCount}: ${listNames(d.tokens.lab)}` : '0. Naked. Bold.' });
  } else {
    rows.push({ label: 'Traits (LAB)', value: 'index offline', warn: true });
  }
  return rows;
}

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_TOKEN_NAMES);
  const more = names.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` +${more} more` : '');
}

/** Línea de estado del pie: todo bien, parcial o sin red */
export function dashboardStatus(d: DashboardData): string {
  if (!d.errors.length) return 'SYNCED. Block-perfect. Probably.';
  if (d.errors.length >= 3) return 'NETWORK SULKING. Showing what the rig cached. Your $ZERO is fine. The Wi-Fi is not.';
  return `PARTIAL READ (${d.errors.join(', ')} failed). Showing the rest.`;
}

// ─── A9.13: Founder Mode (rig + Golden ZERO Token) con datos REALES del Diamond ──────────────────────────────────────
// Antes, una frase con cifras inventadas («FloorEngine: 847 sweeps. TraitLab: 12,459 traits minted…»). Ahora el rig
// enseña cifras globales leídas on-chain (no hace falta cartera: son vistas públicas). Lo que no se pudo leer sale como
// «—», nunca un número de relleno. Funciones verificadas con eth_call contra Base el 14-nov-2026 (docs/progreso/A9.13.md).

/** Cifras globales del ecosistema. null = no se pudo leer (red, corte de 8 s o la función no responde) */
export interface FounderStats {
  /** $ZERO en circulación: `totalSupply()` del Diamond (wei, 18 decimales) */
  zeroSupplyWei: bigint | null;
  /** Tope de $ZERO: `maxSupply()` del Diamond (wei) */
  zeroMaxSupplyWei: bigint | null;
  /** $ZERO quemado: `totalBurned()` del Diamond (wei) */
  zeroBurnedWei: bigint | null;
  /** $ZERO en staking: `totalStaked()` del Diamond (wei) */
  zeroStakedWei: bigint | null;
  /** AdrianZERO acuñados: `totalSupply()` del ERC721 */
  adrianZeroSupply: number | null;
  /** true si vienen de `__qa.mockWeb3` (solo ?qa=1) */
  simulated: boolean;
}

/** Lo que se enseña cuando un dato no se pudo leer: nada que parezca una cifra */
export const UNAVAILABLE = '—';

/** wei → «53,456,172» (unidades enteras, sin decimales: es un panel de un vistazo) */
export function formatZeroWhole(wei: bigint): string {
  const whole = (wei < 0n ? -wei : wei) / 10n ** 18n;
  return (wei < 0n ? '-' : '') + whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** part/total en % con 1 decimal («18.5 %»); null si no se puede calcular */
export function percentOf(part: bigint | null, total: bigint | null): string | null {
  if (part === null || total === null || total <= 0n) return null;
  const tenths = (part * 1000n) / total;
  return `${tenths / 10n}.${tenths % 10n} %`;
}

function zeroRow(label: string, wei: bigint | null, extra?: string | null): DashboardRow {
  if (wei === null) return { label, value: UNAVAILABLE, warn: true };
  return { label, value: formatZeroWhole(wei) + (extra ? ` (${extra})` : '') };
}

/** Filas del panel de Founder Mode (orden fijo). Cada dato fallido sale como «—» en amarillo. */
export function founderRows(s: FounderStats): DashboardRow[] {
  const rows: DashboardRow[] = [];
  rows.push(zeroRow('$ZERO supply', s.zeroSupplyWei));
  rows.push(zeroRow('$ZERO max', s.zeroMaxSupplyWei));
  rows.push(zeroRow('$ZERO burned', s.zeroBurnedWei, percentOf(s.zeroBurnedWei, s.zeroMaxSupplyWei) && `${percentOf(s.zeroBurnedWei, s.zeroMaxSupplyWei)} of max`));
  rows.push(zeroRow('$ZERO staked', s.zeroStakedWei, percentOf(s.zeroStakedWei, s.zeroSupplyWei) && `${percentOf(s.zeroStakedWei, s.zeroSupplyWei)} of supply`));
  rows.push(s.adrianZeroSupply === null
    ? { label: 'AdrianZERO minted', value: UNAVAILABLE, warn: true }
    : { label: 'AdrianZERO minted', value: s.adrianZeroSupply.toLocaleString('en-US') });
  if (s.simulated) rows.push({ label: 'SOURCE', value: 'simulated (QA)' });
  return rows;
}

/** Cuántas cifras de FounderStats no se pudieron leer */
export function founderMissing(s: FounderStats): number {
  return [s.zeroSupplyWei, s.zeroMaxSupplyWei, s.zeroBurnedWei, s.zeroStakedWei, s.adrianZeroSupply].filter((v) => v === null).length;
}

/** Pie del panel de Founder Mode: en vivo, parcial o sin red (texto de interfaz, sin voz) */
export function founderStatus(s: FounderStats): string {
  const missing = founderMissing(s);
  if (missing === 0) return 'LIVE FROM BASE. Read-only. Adrian left the lights on.';
  if (missing >= 5) return 'BASE UNREACHABLE. No numbers rather than made-up numbers. Try again later.';
  return `PARTIAL READ (${missing} of 5 unavailable). The rest is live.`;
}

/** Cifras de QA para `__qa.mockWeb3` (redondas a propósito y marcadas «simulated»): nunca salen sin ?qa=1 */
export function simulatedFounderStats(fail: boolean): FounderStats {
  if (fail) return { zeroSupplyWei: null, zeroMaxSupplyWei: null, zeroBurnedWei: null, zeroStakedWei: null, adrianZeroSupply: null, simulated: true };
  const e = 10n ** 18n;
  return { zeroSupplyWei: 50_000_000n * e, zeroMaxSupplyWei: 100_000_000n * e, zeroBurnedWei: 20_000_000n * e, zeroStakedWei: 5_000_000n * e, adrianZeroSupply: 1000, simulated: true };
}

/** Una lectura on-chain de una cifra (inyectable: en el juego, `publicClient.readContract`; en los tests, lo que sea) */
export type FounderReader = () => Promise<unknown>;
export interface FounderReaders { supply: FounderReader; max: FounderReader; burned: FounderReader; staked: FounderReader; adrianZeroSupply: FounderReader }

/** Corte por lectura (como el dashboard de A3.10) y vida de la caché de las cifras globales */
export const FOUNDER_TIMEOUT_MS = 8000;
export const FOUNDER_CACHE_MS = 5 * 60 * 1000;

/** Caché de la última lectura COMPLETA (un fallo parcial no se guarda: se reintenta la próxima vez) */
export interface FounderCache { at: number; stats: FounderStats | null }
export function newFounderCache(): FounderCache { return { at: 0, stats: null }; }

function cut<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Lee las 5 cifras en paralelo, cada una con su corte. La que falla, tarda o no devuelve un entero queda en null.
 * Nunca lanza. Pura (sin viem): src/web3/dashboard.ts le pasa las lecturas reales.
 */
export async function readFounderStats(
  readers: FounderReaders,
  cache: FounderCache,
  opts: { now?: number; timeoutMs?: number } = {},
): Promise<FounderStats> {
  const now = opts.now ?? Date.now();
  if (cache.stats && now - cache.at < FOUNDER_CACHE_MS) return cache.stats;
  const ms = opts.timeoutMs ?? FOUNDER_TIMEOUT_MS;
  const safe = (r: FounderReader) => cut(Promise.resolve().then(r), ms);
  const res = await Promise.allSettled([safe(readers.supply), safe(readers.max), safe(readers.burned), safe(readers.staked), safe(readers.adrianZeroSupply)]);
  const big = (r: PromiseSettledResult<unknown>): bigint | null => (r.status === 'fulfilled' && typeof r.value === 'bigint' && r.value >= 0n ? r.value : null);
  const az = big(res[4]);
  const stats: FounderStats = {
    zeroSupplyWei: big(res[0]),
    zeroMaxSupplyWei: big(res[1]),
    zeroBurnedWei: big(res[2]),
    zeroStakedWei: big(res[3]),
    adrianZeroSupply: az === null ? null : Number(az),
    simulated: false,
  };
  if (founderMissing(stats) === 0) { cache.at = now; cache.stats = stats; }
  return stats;
}
