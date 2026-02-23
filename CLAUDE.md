# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

Fork of [GerardPolloRebozado/social-to-mealie](https://github.com/GerardPolloRebozado/social-to-mealie).
Extracts recipes from social media URLs (via yt-dlp + Whisper transcription) and imports them into Mealie.

Custom additions in this fork:

- MiniMax as a selectable text provider (via `TEXT_PROVIDER=minimax`)
- Groq as a selectable text provider (via `TEXT_PROVIDER=groq`)

## Tech Stack

- Next.js 16, TypeScript, Vercel AI SDK (`ai` v5)
- `@ai-sdk/openai` for OpenAI-compatible providers (OpenAI, MiniMax)
- `@ai-sdk/groq` for Groq (native provider, avoids json_object fallback issues)
- `@huggingface/transformers` for local Whisper transcription
- Node.js ≥ 18 required (WSL default is v12 — use `nvm use 22`)

## Dev Workflow (fast iteration)

Production deploys take ~10 min via GitHub Actions CI. For rapid testing on mediasrv, use the dev compose which mounts source and uses Next.js HMR:

```bash
# --- First-time setup on mediasrv ---
# Find the network mealie is on (update compose.dev.yml name: if different)
docker inspect mealie | grep -A2 '"Networks"'

# Build dev image (once, or after package.json changes)
docker compose -f /home/cnurmi/repo/social-to-mealie/docs/compose.dev.yml build
docker compose -f /home/cnurmi/repo/social-to-mealie/docs/compose.dev.yml up -d

# Dev server available at http://mediasrv:4001

# --- Everyday dev cycle (src/ code changes only, ~10 seconds) ---
git push origin main          # from local machine
ssh mediasrv "cd /home/cnurmi/repo/social-to-mealie && git pull"
# Next.js HMR detects file changes and reloads automatically

# --- After package.json changes ---
ssh mediasrv "cd /home/cnurmi/repo/social-to-mealie && git pull && docker compose -f docs/compose.dev.yml build && docker compose -f docs/compose.dev.yml up -d"
```

Key files: `Dockerfile` (`dev` stage), `docs/compose.dev.yml`

## AI Provider Configuration

### Groq (active in production)

```env
TEXT_PROVIDER=groq
TEXT_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=<key>   # or Docker secret: groq_api_key
```

Groq uses `@ai-sdk/groq` (native provider). This avoids the json_object fallback bug where `ai@5` retries via `@ai-sdk/openai` and the LLM drops required fields like `name`/`description`.
Free tier available at [console.groq.com](https://console.groq.com). Budget alternative: `llama-3.1-8b-instant`.

### MiniMax (supported, not in production)

```env
TEXT_PROVIDER=minimax
TEXT_MODEL=MiniMax-M2
MINIMAX_API_KEY=<key>   # or Docker secret: minimax_api_key
```

MiniMax uses OpenAI-compatible API at `https://api.minimax.io/v1` via `@ai-sdk/openai`.
Note: `sk-cp-` (coding plan) keys do NOT work — only PAYG `sk-api-` keys work.
The community package `vercel-minimax-ai-provider` was tried and dropped — incompatible format.

### OpenAI (default)

```env
TEXT_PROVIDER=openai   # or omit — this is the default
OPENAI_URL=https://api.openai.com/v1
OPENAI_API_KEY=<key>
TEXT_MODEL=gpt-4o-mini
```

## Deployment (mediasrv)

This repo is deployed on `mediasrv` via the homeserver Docker Compose stack.

**Image registry:** `ghcr.io/cnurmi/social-to-mealie:latest`
**Compose file:** `/home/cnurmi/docker/compose/mediasrv/social-to-mealie.yml`
**URL:** `https://recipes.nurhome.xyz`

### Deploy workflow

Push to `main` triggers GitHub Actions (`.github/workflows/build-registry.yml`) to build
the Docker image and push it to `registry.nurhome.xyz`. Mediasrv then just pulls and restarts
— no local build required.

```bash
# 1. Make, commit, and push changes locally — this triggers the CI build
git push origin main

# 2. Wait for GitHub Actions to finish (~3-5 min first time, faster with GHA cache)
#    Check: https://github.com/cnurmi/social-to-mealie/actions

# 3. On mediasrv — pull new image and restart (seconds)
cd /home/cnurmi/docker
docker compose -f docker-compose-mediasrv.yml pull social-to-mealie
docker compose -f docker-compose-mediasrv.yml up -d social-to-mealie
```

### GitHub Actions setup (one-time)

Add these as repository secrets at `Settings > Secrets > Actions`:

- `REGISTRY_USERNAME` — login for `registry.nurhome.xyz`
- `REGISTRY_PASSWORD` — password for `registry.nurhome.xyz`

### Secrets

Two Docker secrets are required on mediasrv:

- `/home/cnurmi/docker/secrets/groq_api_key` — Groq API key
- `/home/cnurmi/docker/secrets/mealie_api_key` — Mealie API token

**Permissions must be 644** (not 600). The container runs as `nextjs` (non-root) and bind-mounted
secret files must be world-readable.

```bash
chmod 644 /home/cnurmi/docker/secrets/groq_api_key
chmod 644 /home/cnurmi/docker/secrets/mealie_api_key
```

## Key Files

- `src/lib/ai.ts` — provider selection, transcription, recipe generation
- `src/lib/constants.ts` — reads all env vars
- `src/lib/types.ts` — `envTypes` type definition
- `entrypoint.sh` — loads Docker secret files into env vars at container start
- `example.env` — all supported env vars with documentation

## Local Development

```bash
# Requires Node 18+ — on WSL use nvm:
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

npm install
npm run dev
```
