import { connectWallet } from '@/web3/wallet';
import { renderSummary, STATS_CSS, type StatsSummary } from './render';

/**
 * A9.17: página /stats (entrada aparte de Vite: nada de esto entra en el bundle del juego). Conecta la cartera con el
 * mismo código del juego (src/web3/wallet.ts), pide un nonce al save-server, firma el mensaje (solo firma, nunca
 * transacción), entra con POST /stats/login y guarda el token (12 h) en sessionStorage como Bearer.
 *
 * `?api=http://127.0.0.1:PUERTO` solo se acepta desde localhost/127.0.0.1 (demo y pruebas locales).
 */
const TOKEN_KEY = 'zeroadv_stats_token';

function apiBase(): string {
  const p = new URLSearchParams(location.search).get('api');
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (p && local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(p)) return p;
  return 'https://save.zerothetoken.com';
}
const API = apiBase();

const style = document.createElement('style');
style.textContent = STATS_CSS;
document.head.appendChild(style);
try {
  const font = new FontFace('Press Start 2P', 'url(/assets/fonts/PressStart2P-Regular.ttf)');
  void font.load().then((f) => document.fonts.add(f)).catch(() => {});
} catch { /* sin FontFace: monospace */ }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gate = $<HTMLElement>('gate');
const dash = $<HTMLElement>('dash');
const statusEl = $<HTMLParagraphElement>('status');
const btn = $<HTMLButtonElement>('connect');

function setStatus(text: string, err = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', err);
}

async function loadSummary(token: string): Promise<boolean> {
  const r = await fetch(`${API}/stats/summary`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' });
  if (r.status === 401) { sessionStorage.removeItem(TOKEN_KEY); return false; }
  if (!r.ok) throw new Error(`Server error ${r.status}`);
  const s = (await r.json()) as StatsSummary;
  dash.innerHTML = renderSummary(s);
  dash.hidden = false;
  gate.hidden = true;
  document.body.dataset.ready = '1';
  return true;
}

async function signIn(): Promise<void> {
  btn.disabled = true;
  try {
    setStatus('Connecting wallet…');
    const w = await connectWallet('injected');
    if (!w.walletClient || !w.address) throw new Error('No wallet');
    setStatus('Sign the message in your wallet…');
    const n = await fetch(`${API}/stats/nonce`, { cache: 'no-store', credentials: 'omit' });
    if (!n.ok) throw new Error(`Server error ${n.status}`);
    const { nonce, message } = (await n.json()) as { nonce: string; message: string };
    const signature = await w.walletClient.signMessage({ account: w.address, message });
    setStatus('Checking…');
    const l = await fetch(`${API}/stats/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ address: w.address, signature, nonce }),
    });
    if (l.status === 401) throw new Error('This wallet is not allowed to see the stats.');
    if (!l.ok) throw new Error(`Server error ${l.status}`);
    const { token } = (await l.json()) as { token: string };
    sessionStorage.setItem(TOKEN_KEY, token);
    setStatus('Loading…');
    if (!(await loadSummary(token))) throw new Error('Session rejected');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    document.body.dataset.error = '1';
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener('click', () => void signIn());
const saved = sessionStorage.getItem(TOKEN_KEY);
if (saved) void loadSummary(saved).catch(() => {});
