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
