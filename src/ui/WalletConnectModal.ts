import QRCode from 'qrcode';
import { FONT } from '@/config/theme';

/**
 * Custom WalletConnect QR modal — replaces the broken AppKit modal.
 * Shows QR code + wallet deep links in a retro game style.
 */

interface WCModalControls {
  close: () => void;
}

/** Wallet deep link builders — uri must be encoded */
const WALLETS = [
  { name: 'MetaMask', scheme: (uri: string) => `metamask://wc?uri=${uri}`, color: '#E8821E' },
  { name: 'Rainbow', scheme: (uri: string) => `rainbow://wc?uri=${uri}`, color: '#001E59' },
  { name: 'Trust', scheme: (uri: string) => `trust://wc?uri=${uri}`, color: '#3375BB' },
  { name: 'Coinbase', scheme: (uri: string) => `cbwallet://wc?uri=${uri}`, color: '#0052FF' },
];

export function showWCModal(wcUri: string, onCancel: () => void): WCModalControls {
  const encoded = encodeURIComponent(wcUri);

  const overlay = document.createElement('div');
  overlay.id = 'wc-qr-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(6,6,12,0.9);
    display: flex; align-items: center; justify-content: center;
    font-family: '${FONT.FAMILY}', monospace;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1a1a2e; border: 2px solid #5b3a8c;
    border-radius: 8px; padding: 20px; text-align: center;
    max-width: 340px; width: 90%;
  `;

  // Title
  const title = document.createElement('div');
  title.textContent = 'Scan with Wallet';
  title.style.cssText = 'color: #f8e848; font-size: 11px; margin-bottom: 16px;';
  modal.appendChild(title);

  // QR Code canvas
  const qrWrap = document.createElement('div');
  qrWrap.style.cssText = `
    background: #fff; border-radius: 8px; padding: 12px;
    display: inline-block; margin-bottom: 16px;
  `;
  const canvas = document.createElement('canvas');
  QRCode.toCanvas(canvas, wcUri, {
    width: 240,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
  qrWrap.appendChild(canvas);
  modal.appendChild(qrWrap);

  // Copy URI button
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Link';
  copyBtn.style.cssText = `
    display: block; width: 100%; padding: 10px 16px; margin-bottom: 12px;
    background: #2a2a4e; border: 1px solid #5b3a8c; border-radius: 6px;
    color: #e8d5f5; font-family: '${FONT.FAMILY}', monospace; font-size: 9px;
    cursor: pointer; transition: background 0.2s;
  `;
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(wcUri).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
    });
  };
  modal.appendChild(copyBtn);

  // Wallet deep links (mobile)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    const linksWrap = document.createElement('div');
    linksWrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 12px;';

    for (const w of WALLETS) {
      const btn = document.createElement('a');
      btn.href = w.scheme(encoded);
      btn.textContent = w.name;
      btn.style.cssText = `
        padding: 8px 12px; border-radius: 6px; font-size: 8px;
        background: ${w.color}; color: #fff; text-decoration: none;
        font-family: '${FONT.FAMILY}', monospace;
      `;
      linksWrap.appendChild(btn);
    }
    modal.appendChild(linksWrap);
  }

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    display: block; width: 100%; padding: 8px 16px;
    background: transparent; border: 1px solid #444; border-radius: 6px;
    color: #888; font-family: '${FONT.FAMILY}', monospace; font-size: 8px;
    cursor: pointer;
  `;

  const cleanup = () => { overlay.remove(); };

  cancelBtn.onclick = () => { cleanup(); onCancel(); };
  modal.appendChild(cancelBtn);

  // Close on backdrop click
  overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); onCancel(); } };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return { close: cleanup };
}
