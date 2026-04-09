import { publicClient } from './wallet';
import { CONTRACTS, ERC721_ABI, ERC1155_ABI, ERC20_ABI } from '@/config/blockchain.config';
import type { Address } from 'viem';

// ─── Gating rule types ───────────────────────────────────────

export interface GatingRule {
  type: 'ERC721' | 'ERC1155' | 'ERC20' | 'ZERO_BALANCE';
  contract?: string;
  tokenId?: number;
  minBalance?: number | string; // string for ERC20 with decimals
  label?: string; // Human-readable name shown when gate fails
}

// ─── Cache (5-minute TTL) ────────────────────────────────────

const cache = new Map<string, { result: boolean; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function cacheKey(address: string, rule: GatingRule): string {
  return `${address}:${rule.type}:${rule.contract ?? ''}:${rule.tokenId ?? ''}:${rule.minBalance ?? ''}`;
}

function getCached(key: string): boolean | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

// ─── Check functions ─────────────────────────────────────────

/**
 * Check a single gating rule against an address. Uses cache.
 */
export async function checkGatingRule(address: Address, rule: GatingRule): Promise<boolean> {
  const key = cacheKey(address, rule);
  const cached = getCached(key);
  if (cached !== null) return cached;

  let result = false;

  try {
    switch (rule.type) {
      case 'ERC721': {
        const contract = (rule.contract ?? CONTRACTS.ADRIAN_ZERO) as Address;
        const balance = await publicClient.readContract({
          address: contract,
          abi: ERC721_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        result = balance >= BigInt(rule.minBalance ?? 1);
        break;
      }

      case 'ERC1155': {
        const contract = (rule.contract ?? CONTRACTS.ADRIAN_LAB) as Address;
        const balance = await publicClient.readContract({
          address: contract,
          abi: ERC1155_ABI,
          functionName: 'balanceOf',
          args: [address, BigInt(rule.tokenId ?? 0)],
        });
        result = balance >= BigInt(rule.minBalance ?? 1);
        break;
      }

      case 'ERC20': {
        const contract = (rule.contract ?? CONTRACTS.ZERO_DIAMOND) as Address;
        const balance = await publicClient.readContract({
          address: contract,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        // minBalance is in human-readable units, compare as BigInt with 18 decimals
        const minWei = BigInt(rule.minBalance ?? '0') * 10n ** 18n;
        result = balance >= minWei;
        break;
      }

      case 'ZERO_BALANCE': {
        // Shortcut: check $ZERO balance >= minBalance
        const balance = await publicClient.readContract({
          address: CONTRACTS.ZERO_DIAMOND as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        const minWei = BigInt(rule.minBalance ?? '1000') * 10n ** 18n;
        result = balance >= minWei;
        break;
      }
    }
  } catch (err) {
    console.error('Gating check failed:', rule, err);
    result = false;
  }

  cache.set(key, { result, ts: Date.now() });
  return result;
}

/**
 * Check multiple rules (AND — all must pass).
 */
export async function checkAllRules(address: Address, rules: GatingRule[]): Promise<boolean> {
  const results = await Promise.all(rules.map((r) => checkGatingRule(address, r)));
  return results.every(Boolean);
}

/**
 * Check multiple rules (OR — at least one must pass).
 */
export async function checkAnyRule(address: Address, rules: GatingRule[]): Promise<boolean> {
  const results = await Promise.all(rules.map((r) => checkGatingRule(address, r)));
  return results.some(Boolean);
}

/**
 * Synchronous cache reader for use in hot paths (e.g., update loop).
 * Returns cached result or null if not cached. Kicks off async check in background.
 */
export function checkGatingRuleCached(address: Address, rule: GatingRule): boolean | null {
  const key = cacheKey(address, rule);
  const cached = getCached(key);
  if (cached !== null) return cached;
  // Fire async check to populate cache for next frame
  checkGatingRule(address, rule).catch(() => {});
  return null;
}

/** Clear the gating cache */
export function clearGatingCache(): void {
  cache.clear();
}
