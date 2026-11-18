FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 8080

CMD ["node", "dist/index.js"]
