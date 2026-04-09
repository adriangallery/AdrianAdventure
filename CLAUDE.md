# AdrianAdventure

Point-and-click adventure game (Monkey Island style) with full Web3 integration on Base.

## Stack
- Phaser 3 (game framework)
- Vite (bundler)
- TypeScript (strict mode)
- viem (Web3 — wallet, contract reads/writes)
- Alchemy API (NFT loading)

## Blockchain
- Chain: Base mainnet (chainId 8453)
- AdrianZERO (ERC721): `0x6e369bf0e4e0c106192d606fb6d85836d684da75`
- AdrianLAB (ERC1155): `0x90546848474fb3c9fda3fdad887969bb244e7e58`
- $ZERO (Diamond EIP-2535): `0x542b2B96E9c944260722a86C2ee76166A8e3D0A0`

## Scene System
- Scenes defined as JSON in `assets/scenes/<sceneId>/scene.json`
- Each scene has: `background.png`, `walkmask.png`, `scene.json`
- Walkmask colors: blue (#0000FF) = walkable, yellow (#FFFF00) = hotspot, magenta (#FF00FF) = trigger

## UI Principles
- **MOBILE-FIRST always** — scene must be clearly visible
- VerbWheel: radial menu on hotspot tap (not a fixed bar)
- InventoryDrawer: slide-up from bottom, collapsed by default
- DialogueBox: compact, semi-transparent, bottom 25% max
- No UI element should permanently obstruct the scene

## Commands
- `npm run dev` — start dev server on port 3000
- `npm run build` — production build to dist/
- `npm run preview` — preview production build

## Rules
- Never commit .env or API keys
- Keep scenes declarative (JSON) — game logic in ScriptEngine opcodes
- Test on mobile viewport first
