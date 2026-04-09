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

// ─── Diamond facet ABIs ─────────────────────────────────────

/**
 * ShopFacet — purchaseItems for minting game items via AdrianLAB ERC1155.
 * PaymentToken enum: 0 = ZERO, 1 = ADRIAN
 * PurchaseRequest: { assetId, quantity, useFree }
 */
export const DIAMOND_MINT_ABI = [
  {
    type: 'function',
    name: 'purchaseItems',
    inputs: [
      {
        name: 'requests',
        type: 'tuple[]',
        components: [
          { name: 'assetId', type: 'uint256' },
          { name: 'quantity', type: 'uint256' },
          { name: 'useFree', type: 'bool' },
        ],
      },
      { name: 'payWith', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getShopItemView',
    inputs: [
      { name: 'assetId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'assetId', type: 'uint256' },
          { name: 'priceZero', type: 'uint256' },
          { name: 'priceAdrian', type: 'uint256' },
          { name: 'quantityAvailable', type: 'uint128' },
          { name: 'sold', type: 'uint128' },
          { name: 'startTime', type: 'uint48' },
          { name: 'endTime', type: 'uint48' },
          { name: 'active', type: 'bool' },
          { name: 'maxPerWallet', type: 'uint32' },
          { name: 'hasAllowlist', type: 'bool' },
          { name: 'freePerWallet', type: 'uint32' },
          { name: 'freeUsedByUser', type: 'uint256' },
          { name: 'freeRemaining', type: 'uint256' },
          { name: 'isAllowlisted', type: 'bool' },
          { name: 'userPurchases', type: 'uint256' },
          { name: 'effectiveBurnBps', type: 'uint16' },
          { name: 'revenueRecipient', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

/**
 * Achievement minting also uses ShopFacet.purchaseItems with useFree: true.
 * Same ABI — achievements are free-claim ERC1155 tokens configured in the shop.
 */
export const DIAMOND_ACHIEVEMENT_ABI = DIAMOND_MINT_ABI;

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
