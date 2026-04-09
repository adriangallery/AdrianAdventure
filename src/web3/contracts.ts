import type { Address } from 'viem';
import { publicClient, getWalletState } from './wallet';
import { CONTRACTS } from '@/config/blockchain.config';

/**
 * Contract interaction helpers for the $ZERO Diamond.
 *
 * SCAFFOLDED — the actual facet ABIs and function names need to be filled in
 * once we review which Diamond facets handle adventure game mints/achievements.
 *
 * The pattern is ready: read via publicClient, write via walletClient.
 */

// ─── Mint (via Diamond ShopFacet or dedicated MintFacet) ─────

export interface MintParams {
  tokenId: number;
  amount?: number;
  value?: bigint;
}

/**
 * Mint an in-game item as an on-chain token via the Diamond.
 * Returns tx hash on success, null on failure.
 *
 * TODO: Wire to actual Diamond facet once we review:
 * - Which facet handles adventure mints (ShopFacet? A new AdventureFacet?)
 * - Function signature
 * - Payment: free / ETH / $ZERO
 */
export async function mintItem(_params: MintParams): Promise<string | null> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) {
    throw new Error('Wallet not connected');
  }

  // TODO: Replace with actual Diamond facet call when ABI is ready
  console.warn('contracts.mintItem: Diamond mint ABI not configured yet — skipping');
  return null;
}

// ─── Achievements (via Diamond or separate ERC1155) ──────────

/**
 * Mint an achievement token.
 *
 * TODO: Define achievement token IDs range and which contract/facet mints them.
 */
export async function mintAchievement(_achievementId: number): Promise<string | null> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) {
    throw new Error('Wallet not connected');
  }

  // TODO: Replace with actual facet call
  console.warn('contracts.mintAchievement: Achievement ABI not configured yet — skipping');
  return null;
}

// ─── Read helpers (these work now) ───────────────────────────

const ERC1155_BALANCE_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Check if address owns a specific AdrianLAB ERC1155 token.
 */
export async function hasLabToken(address: Address, tokenId: number): Promise<boolean> {
  try {
    const balance = await publicClient.readContract({
      address: CONTRACTS.ADRIAN_LAB as Address,
      abi: ERC1155_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address, BigInt(tokenId)],
    });
    return balance > 0n;
  } catch {
    return false;
  }
}

/**
 * Get $ZERO token balance (human readable).
 */
export async function getZeroBalance(address: Address): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: CONTRACTS.ZERO_DIAMOND as Address,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
    const formatted = Number(balance) / 1e18;
    return formatted.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } catch {
    return '0';
  }
}
