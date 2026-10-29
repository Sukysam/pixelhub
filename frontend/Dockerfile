FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production

# NEXT_PUBLIC_* variables are inlined into the client bundle at build time,
# so the value must be present here, not just in the runtime environment.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

# Bind to the port Sevalla provides at runtime (PORT), falling back to 3000 locally.
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -p \"${PORT:-3000}\" -H 0.0.0.0"]
