FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
