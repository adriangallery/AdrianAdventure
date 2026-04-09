import { createPublicClient, createWalletClient, custom, http, type WalletClient, type Address } from 'viem';
import { CHAIN, CHAIN_ID, getRpcUrl } from '@/config/blockchain.config';

export interface WalletState {
  connected: boolean;
  address: Address | null;
  walletClient: WalletClient | null;
}

let state: WalletState = { connected: false, address: null, walletClient: null };
let onChangeCallbacks: Array<(s: WalletState) => void> = [];

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

/** Connect to injected wallet (MetaMask, Coinbase, Rabby, etc.) */
export async function connectWallet(): Promise<WalletState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ethereum = (window as any).ethereum;
  if (!ethereum) {
    throw new Error('No wallet detected. Install MetaMask or another wallet.');
  }

  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned');
  }

  const address = accounts[0] as Address;

  const walletClient = createWalletClient({
    chain: CHAIN,
    transport: custom(ethereum),
    account: address,
  });

  // Verify chain
  const chainId = await walletClient.getChainId();
  if (chainId !== CHAIN_ID) {
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch {
      throw new Error(`Please switch to Base network (chain ${CHAIN_ID})`);
    }
  }

  state = { connected: true, address, walletClient };
  notifyChange();

  // Listen for account/chain changes
  ethereum.on?.('accountsChanged', (accs: string[]) => {
    if (accs.length === 0) {
      disconnectWallet();
    } else {
      state = { ...state, address: accs[0] as Address };
      notifyChange();
    }
  });

  ethereum.on?.('chainChanged', () => {
    window.location.reload();
  });

  return state;
}

/** Disconnect wallet */
export function disconnectWallet(): void {
  state = { connected: false, address: null, walletClient: null };
  notifyChange();
}

/** Truncate address for display: 0x1234...abcd */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
