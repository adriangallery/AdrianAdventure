import { CHAIN_ID, getRpcUrl } from '@/config/blockchain.config';

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
    optionalChains: [1], // Ethereum mainnet as fallback
    showQrModal: true,
    optionalMethods: [
      'eth_sendTransaction',
      'eth_sign',
      'personal_sign',
      'eth_signTypedData',
      'eth_signTypedData_v4',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
    ],
    optionalEvents: [
      'chainChanged',
      'accountsChanged',
    ],
    rpcMap: {
      [CHAIN_ID]: getRpcUrl(),
      1: 'https://eth.llamarpc.com',
    },
    metadata: {
      name: 'ZEROadventure II',
      description: 'Point-and-click adventure game on Base',
      url: window.location.origin,
      icons: [`${window.location.origin}/assets/sprites/game_badge.png`],
    },
  });

  await provider.enable();
  return provider;
}
