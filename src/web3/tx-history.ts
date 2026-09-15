import { getRpcUrl } from '@/config/blockchain.config';
import { resolveEns } from '@/web3/ens';

/** Una transferencia del historial del jugador, lista para pintarla en el monitor del treatment_room. */
export interface PatientTransfer {
  hash: string;
  direction: 'IN' | 'OUT';
  asset: string;
  value: number | null;
  category: string;
  blockNum: number;
  timestamp: string | null;
}

interface AlchemyTransfer {
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
}

const FETCH_TIMEOUT_MS = 5000;
/** API pública de Blockscout para Base (CORS abierto, sin clave): se usa si el build no trae Alchemy */
const BLOCKSCOUT_API = 'https://base.blockscout.com/api/v2';
const CATEGORIES = ['external', 'erc20', 'erc721', 'erc1155'];

async function fetchTransfers(rpcUrl: string, side: 'fromAddress' | 'toAddress', address: string, limit: number): Promise<AlchemyTransfer[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers',
        params: [{
          fromBlock: '0x0', toBlock: 'latest', [side]: address, category: CATEGORIES,
          order: 'desc', withMetadata: true, excludeZeroValue: false, maxCount: `0x${limit.toString(16)}`,
        }],
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json() as { result?: { transfers?: AlchemyTransfer[] }; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'rpc error');
    return json.result?.transfers ?? [];
  } finally {
    clearTimeout(timer);
  }
}

interface BlockscoutTx {
  hash: string;
  timestamp: string | null;
  block_number: number;
  value: string;
  method: string | null;
  from: { hash: string } | null;
  to: { hash: string } | null;
}

interface BlockscoutTokenTransfer {
  transaction_hash: string;
  timestamp: string | null;
  block_number: number;
  from: { hash: string } | null;
  to: { hash: string } | null;
  token: { symbol: string | null; type: string; decimals: string | null } | null;
  total: { value?: string; decimals?: string | null } | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function units(raw: string | undefined, decimals: string | number | null | undefined): number | null {
  if (!raw) return null;
  const d = Number(decimals ?? 0);
  const n = Number(raw) / 10 ** d;
  return Number.isFinite(n) ? n : null;
}

/** Transacciones + transferencias de tokens desde Blockscout, en el mismo formato que Alchemy. */
async function loadFromBlockscout(address: string, limit: number): Promise<PatientTransfer[]> {
  const me = address.toLowerCase();
  const [txs, transfers] = await Promise.all([
    fetchJson<{ items?: BlockscoutTx[] }>(`${BLOCKSCOUT_API}/addresses/${address}/transactions`),
    fetchJson<{ items?: BlockscoutTokenTransfer[] }>(`${BLOCKSCOUT_API}/addresses/${address}/token-transfers`),
  ]);
  const fromTxs = (txs.items ?? []).slice(0, limit * 2).map((t): PatientTransfer => {
    const eth = units(t.value, 18);
    return {
      hash: t.hash,
      direction: t.from?.hash.toLowerCase() === me ? 'OUT' : 'IN',
      // Una llamada sin ETH se enseña por su método (claim, approve, swap…)
      asset: eth ? 'ETH' : `${t.method ?? 'call'}()`,
      value: eth || null,
      category: eth ? 'external' : 'call',
      blockNum: t.block_number,
      timestamp: t.timestamp,
    };
  });
  const fromTransfers = (transfers.items ?? []).slice(0, limit * 2).map((t): PatientTransfer => {
    const fungible = t.token?.type === 'ERC-20';
    return {
      hash: t.transaction_hash,
      direction: t.from?.hash.toLowerCase() === me ? 'OUT' : 'IN',
      asset: t.token?.symbol ?? (fungible ? '?' : 'NFT'),
      value: fungible ? units(t.total?.value, t.total?.decimals ?? t.token?.decimals) : null,
      category: fungible ? 'erc20' : 'erc721',
      blockNum: t.block_number,
      timestamp: t.timestamp,
    };
  });
  // Una tx que movió tokens ya sale como transferencia: no repetir su llamada sin valor
  const tokenTxs = new Set(fromTransfers.map((t) => t.hash));
  return [...fromTransfers, ...fromTxs.filter((t) => !(t.category === 'call' && tokenTxs.has(t.hash)))]
    .sort((a, b) => b.blockNum - a.blockNum)
    .slice(0, limit);
}

/**
 * Últimas transferencias reales (entrantes y salientes) de la wallet en Base.
 * Con clave de Alchemy usa alchemy_getAssetTransfers; sin ella (o si falla) Blockscout.
 * Devuelve null si ninguna fuente responde: el monitor lo cuenta como «registros ilegibles»,
 * nunca se inventan transacciones.
 */
export async function loadPatientHistory(address: string, limit = 6): Promise<PatientTransfer[] | null> {
  const rpcUrl = getRpcUrl();
  if (rpcUrl.includes('alchemy.com')) {
    const viaAlchemy = await loadFromAlchemy(rpcUrl, address, limit);
    if (viaAlchemy) return viaAlchemy;
  }
  try {
    return await loadFromBlockscout(address, limit);
  } catch (err) {
    console.warn('tx-history: Blockscout no respondió', err);
    return null;
  }
}

async function loadFromAlchemy(rpcUrl: string, address: string, limit: number): Promise<PatientTransfer[] | null> {
  try {
    const [outs, ins] = await Promise.all([
      fetchTransfers(rpcUrl, 'fromAddress', address, limit),
      fetchTransfers(rpcUrl, 'toAddress', address, limit),
    ]);
    const me = address.toLowerCase();
    return [...outs, ...ins]
      .map((t): PatientTransfer => ({
        hash: t.hash,
        direction: t.from.toLowerCase() === me ? 'OUT' : 'IN',
        asset: t.asset ?? (t.category === 'erc721' || t.category === 'erc1155' ? 'NFT' : '?'),
        value: t.value,
        category: t.category,
        blockNum: parseInt(t.blockNum, 16),
        timestamp: t.metadata?.blockTimestamp ?? null,
      }))
      .sort((a, b) => b.blockNum - a.blockNum)
      .slice(0, limit);
  } catch (err) {
    console.warn('tx-history: Alchemy no respondió, pruebo Blockscout', err);
    return null;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatValue(t: PatientTransfer): string {
  if (t.value === null || t.category === 'erc721' || t.category === 'erc1155' || t.category === 'call') return t.asset;
  const v = t.value >= 1000 ? Math.round(t.value).toLocaleString('en-US')
    : t.value >= 1 ? t.value.toFixed(2)
    : t.value.toPrecision(2);
  return `${v} ${t.asset}`;
}

/** Líneas del expediente que escribe el monitor. Puro: se puede probar sin red. */
export function buildPatientFileLines(address: string | null, ensName: string | null, history: PatientTransfer[] | null): string[] {
  if (!address) {
    return [
      '> PATIENT FILE #0',
      '> NO WALLET CONNECTED.',
      '> RECORDS SEALED... BUT THE PATTERN IS FAMILIAR.',
      '> DIAGNOSIS: PATIENT ZERO',
    ];
  }
  const lines = [`> PATIENT FILE: ${ensName ?? shortAddress(address)}`];
  if (history === null) {
    lines.push('> RECORDS UNREADABLE. THE NODE IS SILENT.');
  } else if (history.length === 0) {
    lines.push('> NO TRANSACTIONS ON BASE. A CLEAN SLATE?', '> NOBODY STAYS CLEAN FOR LONG.');
  } else {
    lines.push('> LAST TRANSACTIONS ON BASE:');
    for (const t of history) {
      const date = t.timestamp ? t.timestamp.slice(0, 10) : '----------';
      lines.push(`  ${date} ${t.direction === 'OUT' ? 'OUT' : 'IN '} ${formatValue(t)}`);
    }
  }
  lines.push('> DIAGNOSIS: PATIENT ZERO');
  return lines;
}

/** Datos del monitor para la wallet conectada (o null): ENS y transferencias en paralelo. */
export async function loadPatientFile(address: string | null): Promise<string[]> {
  if (!address) return buildPatientFileLines(null, null, null);
  const [ensName, history] = await Promise.all([
    resolveEns(address).catch(() => null),
    loadPatientHistory(address),
  ]);
  return buildPatientFileLines(address, ensName, history);
}
