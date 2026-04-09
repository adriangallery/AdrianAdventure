import { createPublicClient, createWalletClient, custom, http, type WalletClient, type Address } from 'viem';
import { CHAIN, CHAIN_ID, getRpcUrl } from '@/config/blockchain.config';

export type WalletProviderType = 'injected' | 'walletconnect';

export interface WalletState {
  connected: boolean;
  address: Address | null;
  walletClient: WalletClient | null;
  providerType: WalletProviderType | null;
}

let state: WalletState = { connected: false, address: null, walletClient: null, providerType: null };
let onChangeCallbacks: Array<(s: WalletState) => void> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeProvider: any = null;

/** Public client — always available for reads (no wallet needed) */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(getRpcUrl()),
});

/** Get current wallet state */
export function getWalletState(): WalletState {
  return state;
}

/** Subscribe to wallet state changes */
export function onWalletChange(cb: (s: WalletState) => void): () => void {
  onChangeCallbacks.push(cb);
  return () => {
    onChangeCallbacks = onChangeCallbacks.filter((c) => c !== cb);
  };
}

function notifyChange(): void {
  for (const cb of onChangeCallbacks) cb(state);
}

/** Check if injected wallet (MetaMask, Coinbase, etc.) is available */
export function hasInjectedWallet(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).ethereum;
}

/** Check if WalletConnect is configured */
export function hasWalletConnectConfig(): boolean {
  return !!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
}

/** Connect wallet — supports injected or WalletConnect */
export async function connectWallet(
  providerType: WalletProviderType = 'injected',
): Promise<WalletState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let provider: any;

  if (providerType === 'walletconnect') {
    const { createWalletConnectProvider } = await import('./walletconnect-provider');
    provider = await createWalletConnectProvider();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider = (window as any).ethereum;
    if (!provider) {
      throw new Error('No wallet detected. Install MetaMask or another wallet.');
    }
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned');
    }
  }

  activeProvider = provider;

  // Get accounts (WalletConnect already enabled, injected already requested)
  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned');
  }

  const address = accounts[0] as Address;

  const walletClient = createWalletClient({
    chain: CHAIN,
    transport: custom(provider),
    account: address,
  });

  // Verify chain
  const chainId = await walletClient.getChainId();
  if (chainId !== CHAIN_ID) {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch {
      throw new Error(`Please switch to Base network (chain ${CHAIN_ID})`);
    }
  }

  state = { connected: true, address, walletClient, providerType };
  notifyChange();

  // Listen for account/chain changes
  provider.on?.('accountsChanged', (accs: string[]) => {
    if (accs.length === 0) {
      disconnectWallet();
    } else {
      state = { ...state, address: accs[0] as Address };
      notifyChange();
    }
  });

  provider.on?.('chainChanged', () => {
    window.location.reload();
  });

  // WalletConnect-specific: listen for session disconnect
  if (providerType === 'walletconnect') {
    provider.on?.('disconnect', () => {
      disconnectWallet();
    });
  }

  return state;
}

/** Disconnect wallet */
export function disconnectWallet(): void {
  // For WalletConnect, properly disconnect the session
  if (state.providerType === 'walletconnect' && activeProvider?.disconnect) {
    try { activeProvider.disconnect(); } catch { /* ignore */ }
  }
  activeProvider = null;
  state = { connected: false, address: null, walletClient: null, providerType: null };
  notifyChange();
}

/** Truncate address for display: 0x1234...abcd */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
