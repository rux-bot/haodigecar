FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public/favicon.svg ./public/favicon.svg
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY public ./public
COPY data/vehicles.json ./data/vehicles.json
RUN mkdir -p /app/public/uploads && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/index.mjs"]
