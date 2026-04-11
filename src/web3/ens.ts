import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_CACHE_KEY = 'ens-cache';
const ENS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface EnsCacheEntry {
  name: string | null;
  ts: number;
}

function readCache(): Record<string, EnsCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(ENS_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function getCached(address: string): string | null | undefined {
  const entry = readCache()[address.toLowerCase()];
  if (!entry || Date.now() - entry.ts > ENS_CACHE_TTL) return undefined;
  return entry.name;
}

function setCached(address: string, name: string | null) {
  const cache = readCache();
  cache[address.toLowerCase()] = { name, ts: Date.now() };
  localStorage.setItem(ENS_CACHE_KEY, JSON.stringify(cache));
}

function getEthRpcUrl(): string {
  const key = import.meta.env.VITE_ALCHEMY_ENS_KEY || import.meta.env.VITE_ALCHEMY_API_KEY;
  if (key) return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
  return 'https://eth.llamarpc.com';
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(getEthRpcUrl(), { retryCount: 1, retryDelay: 500 }),
});

/** Resolve a single address to ENS name (cached, async) */
export async function resolveEns(address: string): Promise<string | null> {
  const cached = getCached(address);
  if (cached !== undefined) return cached;

  try {
    const name = await client.getEnsName({ address: address as `0x${string}` });
    setCached(address, name);
    return name;
  } catch {
    setCached(address, null);
    return null;
  }
}

/** Resolve multiple addresses in parallel */
export async function resolveEnsMany(addresses: string[]): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const toResolve: string[] = [];

  for (const addr of addresses) {
    const cached = getCached(addr);
    if (cached !== undefined) {
      results[addr.toLowerCase()] = cached;
    } else {
      toResolve.push(addr);
    }
  }

  if (toResolve.length > 0) {
    const promises = toResolve.map(async (addr) => {
      const name = await resolveEns(addr);
      results[addr.toLowerCase()] = name;
    });
    await Promise.allSettled(promises);
  }

  return results;
}
