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

// ─── Read helpers ───────────────────────────────────────────

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
 * Get $ZERO token balance (compact human readable: 1.2K, 3.5M, etc.).
 */
export async function getZeroBalance(address: Address): Promise<string> {
  try {
    const balance = await publicClient.readContract({
      address: CONTRACTS.ZERO_DIAMOND as Address,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
    const num = Number(balance) / 1e18;
    if (num === 0) return '0';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    if (num >= 1) return num.toFixed(1);
    return num.toFixed(4);
  } catch (err) {
    console.error('getZeroBalance failed:', err);
    return '0';
  }
}

// ─── AdrianLAB Floppy Box check (token IDs 10000-10010) ─────

/**
 * Check if address owns any AdrianLAB ERC1155 token in range 10000-10010.
 * Returns true if they hold at least one.
 */
export async function hasFloppyBoxTokens(address: Address): Promise<boolean> {
  const FLOPPY_IDS = [10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010];
  try {
    // Check one at a time to avoid rate limiting
    for (const id of FLOPPY_IDS) {
      const balance = await publicClient.readContract({
        address: CONTRACTS.ADRIAN_LAB as Address,
        abi: ERC1155_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address, BigInt(id)],
      });
      if (balance > 0n) {
        console.log(`Floppy box token found: ID ${id}, balance ${balance}`);
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('Floppy box token check failed:', err);
    return false;
  }
}
