import { base } from 'viem/chains';

export const CHAIN = base;
export const CHAIN_ID = 8453;

/** Alchemy RPC — key injected via env var at build time */
export function getRpcUrl(): string {
  const key = import.meta.env.VITE_ALCHEMY_API_KEY;
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  // Fallback to public Base RPC (rate-limited but works for testing)
  return 'https://mainnet.base.org';
}

export function getAlchemyNftUrl(): string {
  const key = import.meta.env.VITE_ALCHEMY_API_KEY;
  if (!key) return '';
  return `https://base-mainnet.g.alchemy.com/nft/v3/${key}`;
}

// ─── Contracts ────────────────────────────────────────────────

export const CONTRACTS = {
  /** AdrianZERO — ERC721 NFT collection */
  ADRIAN_ZERO: '0x6e369bf0e4e0c106192d606fb6d85836d684da75' as const,

  /** AdrianLAB — ERC1155 multi-token (traits, floppies, serums, items) */
  ADRIAN_LAB: '0x90546848474fb3c9fda3fdad887969bb244e7e58' as const,

  /** $ZERO Diamond (EIP-2535) — token, staking, governance, shop, minting */
  ZERO_DIAMOND: '0x062EF009be3Fb978E6b8cD540Dc20f6960Db21aD' as const,
} as const;

// ─── Minimal ABIs (only what we need for reads) ──────────────

export const ERC721_ABI = [
  { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'ownerOf', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

export const ERC1155_ABI = [
  { inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export const ERC20_ABI = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
] as const;

// ─── Diamond facet ABIs (scaffolded — fill in when we review) ─

/**
 * TODO: Add real facet ABIs when reviewing Diamond integration.
 * These will cover: ShopFacet.mint(), AchievementFacet, SaveFacet, etc.
 */
export const DIAMOND_MINT_ABI = [
  // Placeholder — replace with actual ShopFacet or MintFacet ABI
  // { inputs: [...], name: 'mint', outputs: [...], stateMutability: 'payable', type: 'function' },
] as const;

export const DIAMOND_ACHIEVEMENT_ABI = [
  // Placeholder — replace with actual AchievementFacet ABI
] as const;

// ─── NFT filter config ───────────────────────────────────────

export interface NFTFilter {
  label: string;
  contract: string;
  standard: 'ERC721' | 'ERC1155';
  tokenIdRange?: { min: number; max: number };
}

export const NFT_FILTERS: NFTFilter[] = [
  { label: 'AdrianZERO', contract: CONTRACTS.ADRIAN_ZERO, standard: 'ERC721' },
  { label: 'Floppy Discs', contract: CONTRACTS.ADRIAN_LAB, standard: 'ERC1155', tokenIdRange: { min: 1, max: 999 } },
  { label: 'Traits', contract: CONTRACTS.ADRIAN_LAB, standard: 'ERC1155', tokenIdRange: { min: 1000, max: 9999 } },
  { label: 'Serums', contract: CONTRACTS.ADRIAN_LAB, standard: 'ERC1155', tokenIdRange: { min: 10000, max: 19999 } },
];
