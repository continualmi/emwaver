# EMWaver unified web app (Next.js + Node runtime).
# NEXT_PUBLIC_* env vars are still compiled into the client bundle at build time.

FROM node:20-slim AS deps
WORKDIR /workspace/emwaver/web
COPY web/package.json web/package-lock.json ./
COPY continual-core /workspace/continual-core
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /workspace/emwaver/web
COPY --from=deps /workspace/emwaver/web/node_modules ./node_modules
COPY web/ ./
COPY continual-core /workspace/continual-core

# Build-time env (baked into Next build)
ARG NEXT_PUBLIC_EMWAVER_BACKEND_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

ENV NEXT_PUBLIC_EMWAVER_BACKEND_URL=$NEXT_PUBLIC_EMWAVER_BACKEND_URL \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime: Next build output + custom server sources.
COPY --from=builder /workspace/emwaver/web/public ./public
COPY --from=builder /workspace/emwaver/web/.next ./.next
COPY --from=builder /workspace/emwaver/web/node_modules ./node_modules
COPY --from=builder /workspace/emwaver/web/package.json ./package.json
COPY --from=builder /workspace/emwaver/web/server.ts ./server.ts
COPY --from=builder /workspace/emwaver/web/src/server ./src/server

EXPOSE 3000
ENV PORT=3000
CMD ["npm", "run", "start"]
