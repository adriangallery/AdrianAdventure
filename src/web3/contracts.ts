import type { Address } from 'viem';
import { publicClient, getWalletState } from './wallet';
import { CONTRACTS, DIAMOND_MINT_ABI, DIAMOND_ACHIEVEMENT_ABI } from '@/config/blockchain.config';

// ─── Mint result type ───────────────────────────────────────

export interface MintResult {
  status: 'success' | 'pending' | 'failed' | 'not-configured';
  txHash?: string;
  error?: string;
}

export interface MintParams {
  tokenId: number;
  amount?: number;
  value?: bigint;
}

/** Check if Diamond mint ABI is configured (not just an empty placeholder) */
export function isMintConfigured(): boolean {
  return DIAMOND_MINT_ABI.length > 0;
}

/** Check if achievement mint ABI is configured */
export function isAchievementMintConfigured(): boolean {
  return DIAMOND_ACHIEVEMENT_ABI.length > 0;
}

// ─── Mint (via Diamond ShopFacet or dedicated MintFacet) ─────

/**
 * Mint an in-game item as an on-chain token via the Diamond.
 * Returns MintResult with status.
 *
 * TODO: Wire to actual Diamond facet once we review:
 * - Which facet handles adventure mints (ShopFacet? A new AdventureFacet?)
 * - Function signature
 * - Payment: free / ETH / $ZERO
 */
export async function mintItem(params: MintParams): Promise<MintResult> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) {
    return { status: 'failed', error: 'Wallet not connected' };
  }

  if (!isMintConfigured()) {
    return { status: 'not-configured' };
  }

  try {
    // ShopFacet.purchaseItems — pay with $ZERO (payWith = 0)
    const txHash = await walletClient.writeContract({
      address: CONTRACTS.ZERO_DIAMOND as Address,
      abi: DIAMOND_MINT_ABI,
      functionName: 'purchaseItems',
      args: [
        [{ assetId: BigInt(params.tokenId), quantity: BigInt(params.amount ?? 1), useFree: false }],
        0, // PaymentToken.ZERO
      ],
      chain: undefined,
      account: address,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === 'success') {
      return { status: 'success', txHash };
    }
    return { status: 'failed', txHash, error: 'Transaction reverted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'failed', error: msg };
  }
}

// ─── Achievements (via Diamond or separate ERC1155) ──────────

/**
 * Mint an achievement token.
 *
 * TODO: Define achievement token IDs range and which contract/facet mints them.
 */
export async function mintAchievement(achievementId: number): Promise<MintResult> {
  const { walletClient, address } = getWalletState();
  if (!walletClient || !address) {
    return { status: 'failed', error: 'Wallet not connected' };
  }

  if (!isAchievementMintConfigured()) {
    return { status: 'not-configured' };
  }

  try {
    // Achievements are free-claim items via ShopFacet.purchaseItems with useFree: true
    const txHash = await walletClient.writeContract({
      address: CONTRACTS.ZERO_DIAMOND as Address,
      abi: DIAMOND_ACHIEVEMENT_ABI,
      functionName: 'purchaseItems',
      args: [
        [{ assetId: BigInt(achievementId), quantity: 1n, useFree: true }],
        0, // PaymentToken.ZERO
      ],
      chain: undefined,
      account: address,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === 'success') {
      return { status: 'success', txHash };
    }
    return { status: 'failed', txHash, error: 'Transaction reverted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'failed', error: msg };
  }
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
