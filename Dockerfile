# Multi-Stage-Build: Stufe 1 baut Client (Vite) und Server (tsc), Stufe 2 ist ein
# schlankes Runtime-Image. Keine nativen Abhängigkeiten (node:sqlite statt
# better-sqlite3), daher reicht ein einfaches Alpine-Image ohne Build-Toolchain
# in der Runtime-Stufe.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/openapi.yaml ./server/openapi.yaml
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
