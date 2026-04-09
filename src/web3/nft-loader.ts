import { getAlchemyNftUrl, type NFTFilter, NFT_FILTERS } from '@/config/blockchain.config';

export interface GameNFT {
  contract: string;
  tokenId: string;
  name: string;
  image: string | null;
  standard: 'ERC721' | 'ERC1155';
  balance: number;
  filter: string; // which NFT_FILTER label matched
}

interface AlchemyNFT {
  contract: { address: string };
  tokenId: string;
  name?: string;
  image?: { cachedUrl?: string; thumbnailUrl?: string };
  balance?: string;
  tokenType?: string;
}

/**
 * Load all NFTs owned by an address from Alchemy, filtered by our known contracts.
 */
export async function loadNFTs(ownerAddress: string): Promise<GameNFT[]> {
  const baseUrl = getAlchemyNftUrl();
  if (!baseUrl) {
    console.warn('NFTLoader: No Alchemy API key set, skipping NFT load');
    return [];
  }

  const results: GameNFT[] = [];

  try {
    // Fetch ERC721s
    const erc721s = await fetchAlchemyNFTs(baseUrl, ownerAddress, 'ERC721');
    // Fetch ERC1155s
    const erc1155s = await fetchAlchemyNFTs(baseUrl, ownerAddress, 'ERC1155');

    const allNfts = [...erc721s, ...erc1155s];

    for (const nft of allNfts) {
      const matched = matchFilter(nft);
      if (matched) {
        results.push({
          contract: nft.contract.address.toLowerCase(),
          tokenId: nft.tokenId,
          name: nft.name || `#${nft.tokenId}`,
          image: nft.image?.thumbnailUrl || nft.image?.cachedUrl || null,
          standard: (nft.tokenType === 'ERC1155' ? 'ERC1155' : 'ERC721') as 'ERC721' | 'ERC1155',
          balance: parseInt(nft.balance || '1', 10),
          filter: matched.label,
        });
      }
    }
  } catch (err) {
    console.error('NFTLoader: Error loading NFTs', err);
  }

  return results;
}

async function fetchAlchemyNFTs(
  baseUrl: string,
  owner: string,
  tokenType: string,
): Promise<AlchemyNFT[]> {
  const all: AlchemyNFT[] = [];
  let pageKey: string | undefined;

  // Paginate (max 3 pages to avoid rate limits)
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      owner,
      withMetadata: 'true',
      pageSize: '100',
    });
    if (pageKey) params.set('pageKey', pageKey);

    const url = `${baseUrl}/getNFTsForOwner?${params}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const data = (await res.json()) as { ownedNfts: AlchemyNFT[]; pageKey?: string };
    // Filter by token type client-side since Alchemy v3 returns mixed
    const filtered = data.ownedNfts.filter((n) => (n.tokenType || '').toUpperCase() === tokenType);
    all.push(...filtered);

    pageKey = data.pageKey;
    if (!pageKey) break;
  }

  return all;
}

function matchFilter(nft: AlchemyNFT): NFTFilter | null {
  const addr = nft.contract.address.toLowerCase();
  const tokenId = parseInt(nft.tokenId, 10);

  for (const filter of NFT_FILTERS) {
    if (filter.contract.toLowerCase() !== addr) continue;
    if (filter.tokenIdRange) {
      if (tokenId >= filter.tokenIdRange.min && tokenId <= filter.tokenIdRange.max) {
        return filter;
      }
    } else {
      return filter; // No range filter = match all tokens from this contract
    }
  }
  return null;
}
