// A3.10 (plan SCUMM): carga los datos del dashboard del Mining Rig. SOLO lecturas (publicClient.readContract y la API
// de NFT de Alchemy); nada de escrituras ni firmas. Con `__qa.mockWeb3` (solo ?qa=1) lee del mock y no toca la red.
import type { Address } from 'viem';
import { CONTRACTS, ERC20_ABI, ERC721_ABI } from '@/config/blockchain.config';
import { publicClient } from './wallet';
import { loadNFTs } from './nft-loader';
import { getWeb3Mock, MOCK_CONTRACTS } from './web3Mock';
import { gateAddress } from './gating';
import type { DashboardData } from './dashboardData';

/** Cada lectura se corta a los 8 s: el panel no se queda cargando para siempre */
const READ_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

/** Datos del dashboard para la cartera del jugador (o la simulada). null = no hay cartera. Nunca lanza. */
export async function loadDashboard(): Promise<DashboardData | null> {
  const mock = getWeb3Mock();
  if (mock !== undefined) {
    if (!mock) return null;
    if (mock.fail) {
      return { address: mock.address, zeroWei: null, adrianZeroCount: null, punksCount: null, tokens: null, errors: ['zero', 'adrianZero', 'tokens'], simulated: true };
    }
    return {
      address: mock.address,
      zeroWei: BigInt(mock.zero) * 10n ** 18n,
      adrianZeroCount: mock.adrianZero.length,
      punksCount: mock.punks,
      tokens: {
        adrianZero: mock.adrianZero.map((t) => t.name),
        lab: mock.lab.map((t) => (t.balance > 1 ? `${t.name} x${t.balance}` : t.name)),
        labCount: mock.lab.reduce((n, t) => n + t.balance, 0),
      },
      errors: [],
      simulated: true,
    };
  }
  const address = gateAddress();
  if (!address) return null;
  const owner = address as Address;
  const errors: string[] = [];
  const [zero, az, punks, nfts] = await Promise.allSettled([
    withTimeout(publicClient.readContract({ address: CONTRACTS.ZERO_DIAMOND as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] })),
    withTimeout(publicClient.readContract({ address: CONTRACTS.ADRIAN_ZERO as Address, abi: ERC721_ABI, functionName: 'balanceOf', args: [owner] })),
    withTimeout(publicClient.readContract({ address: MOCK_CONTRACTS.ADRIAN_PUNKS as Address, abi: ERC721_ABI, functionName: 'balanceOf', args: [owner] })),
    withTimeout(loadNFTs(address)),
  ]);
  if (zero.status === 'rejected') errors.push('zero');
  if (az.status === 'rejected') errors.push('adrianZero');
  if (nfts.status === 'rejected') errors.push('tokens');
  let tokens: DashboardData['tokens'] = null;
  if (nfts.status === 'fulfilled' && nfts.value.length) {
    const zeroAddr = CONTRACTS.ADRIAN_ZERO.toLowerCase();
    const labAddr = CONTRACTS.ADRIAN_LAB.toLowerCase();
    const zs = nfts.value.filter((n) => n.contract === zeroAddr);
    const labs = nfts.value.filter((n) => n.contract === labAddr);
    tokens = {
      adrianZero: zs.map((n) => n.name),
      lab: labs.map((n) => (n.balance > 1 ? `${n.name} x${n.balance}` : n.name)),
      labCount: labs.reduce((s, n) => s + n.balance, 0),
    };
  } else if (nfts.status === 'fulfilled') {
    // Sin clave de Alchemy o sin tokens de los contratos conocidos: lista vacía, no es un error
    tokens = { adrianZero: [], lab: [], labCount: 0 };
  }
  return {
    address,
    zeroWei: zero.status === 'fulfilled' ? (zero.value as bigint) : null,
    adrianZeroCount: az.status === 'fulfilled' ? Number(az.value as bigint) : null,
    punksCount: punks.status === 'fulfilled' ? Number(punks.value as bigint) : null,
    tokens,
    errors,
    simulated: false,
  };
}
