FROM node:20-bookworm-slim AS deps

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder

WORKDIR /app/frontend
ENV NODE_ENV=production

# NEXT_PUBLIC_* variables are inlined into the client bundle at build time,
# so the value must be present here, not just in the runtime environment.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY --from=deps /app/frontend/node_modules ./node_modules
COPY frontend/ ./

RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app/frontend
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/frontend/package.json ./package.json
COPY --from=builder /app/frontend/package-lock.json ./package-lock.json
COPY --from=builder /app/frontend/node_modules ./node_modules
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/next.config.mjs ./next.config.mjs

EXPOSE 3000

CMD ["npm", "run", "start"]
