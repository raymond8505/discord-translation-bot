# Stage 1: Install all dependencies (build needs devDependencies)
FROM node:24.16.0-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# No .git in the image; .husky/install.mjs turns the postinstall into a no-op.
ENV HUSKY=0
RUN corepack enable
# .yarnrc.yml carries nodeLinker: node-modules so the multi-stage COPY below
# gets a real node_modules/ dir rather than Yarn 4's default PnP layout.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .husky/install.mjs ./.husky/install.mjs
RUN yarn install --immutable

# Stage 2: Compile TypeScript
FROM node:24.16.0-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
# yarn.lock and .yarnrc.yml must be present or `yarn build` re-resolves the project.
COPY package.json yarn.lock .yarnrc.yml tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# Stage 3: Production dependencies only
FROM node:24.16.0-slim AS prod-deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV HUSKY=0
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .husky/install.mjs ./.husky/install.mjs
RUN yarn workspaces focus --production

# Stage 4: Runner
FROM node:24.16.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# package.json must sit beside dist/ so Node reads "type": "module".
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node

# The bot touches this file every 30s while its gateway session is up (src/health.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const s=require('fs').statSync('/tmp/discord-translation-bot.healthy');process.exit(Date.now()-s.mtimeMs<90000?0:1)"

CMD ["node", "dist/index.js"]
