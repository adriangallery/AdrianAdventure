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

/**
 * Últimas transferencias reales (entrantes y salientes) de la wallet en Base.
 * Devuelve null si no hay nodo con alchemy_getAssetTransfers o la consulta falla: el monitor
 * lo cuenta como «registros ilegibles», nunca se inventan transacciones.
 */
export async function loadPatientHistory(address: string, limit = 6): Promise<PatientTransfer[] | null> {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl.includes('alchemy.com')) return null;
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
    console.warn('tx-history: no se pudo leer el historial', err);
    return null;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatValue(t: PatientTransfer): string {
  if (t.value === null || t.category === 'erc721' || t.category === 'erc1155') return t.asset;
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
