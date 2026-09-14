# AdrianAdventure (ZEROadventure II) — static web build for the mini/Dokku.
#
# Phaser 3 + Vite SPA. Two-stage: node builds the static bundle (tsc && vite
# build && cp assets), nginx serves it. VITE_* vars are baked at build time
# (Vite convention, same trap as Next's NEXT_PUBLIC_*) so they must arrive as
# --build-arg from `dokku config` (docker-options build), never a committed
# .env. All three are optional at runtime: missing VITE_ALCHEMY_API_KEY falls
# back to the public Base RPC, missing VITE_WALLETCONNECT_PROJECT_ID just
# disables the WalletConnect option (injected wallet still works), missing
# VITE_ALCHEMY_ENS_KEY falls back to VITE_ALCHEMY_API_KEY (src/web3/ens.ts).
#
# electron/, capacitor.config.ts, save-server/, audiobook/, trailer/, scripts/,
# steam-build/ are NOT part of the web build — excluded via .dockerignore.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY assets ./assets
COPY public ./public

ARG VITE_ALCHEMY_API_KEY
ENV VITE_ALCHEMY_API_KEY=$VITE_ALCHEMY_API_KEY
ARG VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_ALCHEMY_ENS_KEY
ENV VITE_ALCHEMY_ENS_KEY=$VITE_ALCHEMY_ENS_KEY

# same build script as package.json ("tsc && vite build && cp -r assets dist/")
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
