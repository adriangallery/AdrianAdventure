// A3.10 (plan SCUMM): estado web3 SIMULADO para QA. Lógica pura, sin viem ni Phaser (se prueba en Node).
//
// Solo lo activa `__qa.mockWeb3(...)` (src/qa/QaApi.ts), que únicamente se instala con `?qa=1` (src/main.ts). Mientras
// está activo, `checkGatingRule` (src/web3/gating.ts) y el dashboard del Mining Rig (src/web3/dashboard.ts) leen de aquí y
// NO tocan la red. Sin llamar a `setWeb3Mock`, `getWeb3Mock()` es `undefined` y todo va on-chain como siempre.

import type { GatingRule } from './gating';

/** Contratos que el mock reconoce (minúsculas). Los mismos de src/config/blockchain.config.ts y de los scene.json. */
export const MOCK_CONTRACTS = {
  ADRIAN_ZERO: '0x6e369bf0e4e0c106192d606fb6d85836d684da75',
  ADRIAN_LAB: '0x90546848474fb3c9fda3fdad887969bb244e7e58',
  ADRIAN_PUNKS: '0x79be8acdd339c7b92918fcc3fd3875b5aaad7566',
} as const;

export interface Web3MockToken { id: string; name: string; balance: number }

export interface Web3Mock {
  /** Dirección simulada (no firma nada) */
  address: string;
  /** Saldo de $ZERO en unidades (no wei), como texto: '5000' */
  zero: string;
  /** Ids de AdrianZERO */
  adrianZero: Web3MockToken[];
  /** Traits / tokens de AdrianLAB (ERC1155) */
  lab: Web3MockToken[];
  /** Número de AdrianPunks */
  punks: number;
  /** true = las lecturas «fallan» (para probar el estado de error del panel) */
  fail: boolean;
}

/** Lo que acepta `__qa.mockWeb3(...)` */
export interface Web3MockInput {
  address?: string;
  zero?: string | number;
  adrianZero?: Array<string | number | { id: string | number; name?: string }>;
  lab?: Array<string | number | { id: string | number; name?: string; balance?: number }>;
  punks?: number;
  fail?: boolean;
}

export const MOCK_ADDRESS = '0x00000000000000000000000000000000000a3100';

/** undefined = sin simular (red real); null = simulado SIN cartera; objeto = simulado con esta cartera */
let current: Web3Mock | null | undefined;

function tokens(list: Web3MockInput['adrianZero'] | Web3MockInput['lab'], prefix: string): Web3MockToken[] {
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    if (typeof t === 'object' && t !== null) {
      const id = String(t.id);
      const balance = 'balance' in t && typeof t.balance === 'number' && t.balance > 0 ? Math.floor(t.balance) : 1;
      return { id, name: typeof t.name === 'string' && t.name ? t.name : `${prefix} #${id}`, balance };
    }
    return { id: String(t), name: `${prefix} #${String(t)}`, balance: 1 };
  });
}

/** Valida y completa la entrada de `__qa.mockWeb3`. `null` = sin cartera. Lanza si `zero` no es un número entero ≥ 0. */
export function normalizeWeb3Mock(input: Web3MockInput | null): Web3Mock | null {
  if (input === null) return null;
  const zero = String(input.zero ?? '0').trim();
  if (!/^\d+$/.test(zero)) throw new Error(`mockWeb3: zero «${zero}» no es un entero ≥ 0 (unidades, no wei)`);
  return {
    address: typeof input.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(input.address) ? input.address : MOCK_ADDRESS,
    zero,
    adrianZero: tokens(input.adrianZero, 'AdrianZERO'),
    lab: tokens(input.lab, 'Trait'),
    punks: typeof input.punks === 'number' && input.punks > 0 ? Math.floor(input.punks) : 0,
    fail: input.fail === true,
  };
}

/** Activa (objeto o null) o quita (`undefined`) la simulación. Solo la API de QA lo llama. */
export function setWeb3Mock(mock: Web3Mock | null | undefined): void {
  current = mock;
}

/** undefined = red real; null = simulado sin cartera; objeto = cartera simulada */
export function getWeb3Mock(): Web3Mock | null | undefined {
  return current;
}

/** Saldo que el mock tiene para un contrato ERC721 (AdrianZERO, AdrianPunks; otro = 0) */
function erc721Balance(mock: Web3Mock, contract: string | undefined): number {
  const c = (contract ?? MOCK_CONTRACTS.ADRIAN_ZERO).toLowerCase();
  if (c === MOCK_CONTRACTS.ADRIAN_ZERO) return mock.adrianZero.length;
  if (c === MOCK_CONTRACTS.ADRIAN_PUNKS) return mock.punks;
  return 0;
}

/** ¿Cumple la regla la cartera simulada? (misma semántica que `checkGatingRule`; `null` = sin cartera = false) */
export function mockGateResult(rule: GatingRule | undefined | null, mock: Web3Mock | null): boolean {
  if (!mock || !rule || mock.fail) return false;
  switch (rule.type) {
    case 'ERC721':
      return erc721Balance(mock, rule.contract) >= Number(rule.minBalance ?? 1);
    case 'ERC1155': {
      const id = String(rule.tokenId ?? 0);
      const bal = mock.lab.filter((t) => t.id === id).reduce((n, t) => n + t.balance, 0);
      return bal >= Number(rule.minBalance ?? 1);
    }
    case 'ERC20':
    case 'ZERO_BALANCE': {
      const min = BigInt(String(rule.minBalance ?? (rule.type === 'ZERO_BALANCE' ? '1000' : '0')));
      return BigInt(mock.zero) >= min;
    }
    default:
      return false;
  }
}
