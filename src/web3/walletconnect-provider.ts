import { CHAIN_ID } from '@/config/blockchain.config';

/**
 * Lazy-loaded WalletConnect EIP-1193 provider factory.
 * Only imported when user selects WalletConnect — keeps main bundle small.
 */
export async function createWalletConnectProvider(): Promise<any> {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    throw new Error('WalletConnect Project ID not configured (VITE_WALLETCONNECT_PROJECT_ID)');
  }

  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  const provider = await EthereumProvider.init({
    projectId,
    chains: [CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: 'AdrianAdventure',
      description: 'Point-and-click adventure game on Base',
      url: window.location.origin,
      icons: [`${window.location.origin}/assets/sprites/game_badge.png`],
    },
  });

  await provider.enable();
  return provider;
}
