# Pre-built base image containing node:22-slim + ffmpeg + python3 + system tools.
# Built separately via Dockerfile.base / build-base.yml — never rebuilt during normal CI.
FROM ghcr.io/cnurmi/social-to-mealie-base:latest AS base

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile

FROM base AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY ./entrypoint.sh /app/entrypoint.sh
ENV NODE_ENV=development
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["/bin/sh","/app/entrypoint.sh"]
CMD ["node", "--run", "dev"]

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Cache mount preserves Turbopack/webpack module graph between builds.
# On a code-only change, Next.js recompiles only what changed.
RUN --mount=type=cache,target=/app/.next/cache \
    node --run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Empty default — yt-dlp is downloaded at runtime by entrypoint.sh.
# Override at build time (--build-arg YTDLP_VERSION=2024.12.13) to bake a specific version in.
ARG YTDLP_VERSION=
ENV YTDLP_VERSION=${YTDLP_VERSION}
ENV YTDLP_PATH=/app/.cache/yt-dlp

RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nextjs

# Copy standalone output with correct ownership inline — avoids a separate chown -R pass
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs ./entrypoint.sh /app/entrypoint.sh

# onnxruntime_binding.node uses RUNPATH=$ORIGIN/ to find libonnxruntime.so.1.
# Next.js standalone tracing does not copy .so files adjacent to .node binaries.
# Copy the three needed shared libraries into the same directory as the binding.
# libonnxruntime_providers_cuda.so (342MB) and _tensorrt.so are intentionally omitted.
COPY --chown=nextjs:nodejs --from=builder \
    /app/node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1 \
    ./node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1
COPY --chown=nextjs:nodejs --from=builder \
    /app/node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1.21.0 \
    ./node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1.21.0
COPY --chown=nextjs:nodejs --from=builder \
    /app/node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_shared.so \
    ./node_modules/.pnpm/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_shared.so

# Download yt-dlp at build time only if a version is explicitly provided
RUN if [ -n "$YTDLP_VERSION" ]; then \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
    else \
    YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"; \
    fi && \
    wget -q -O $YTDLP_PATH "$YTDLP_URL" && chmod +x $YTDLP_PATH && \
    chown nextjs:nodejs "$YTDLP_PATH" || true; \
    fi

RUN mkdir -p /app/.cache && chown nextjs:nodejs /app/.cache

USER nextjs

EXPOSE 3000

# Standalone output runs via server.js — does not require the `next` binary
ENTRYPOINT ["/bin/sh","/app/entrypoint.sh"]
CMD ["node", "server.js"]
