# Use Node 20 Alpine
FROM node:20-alpine

# Install build dependencies for bcrypt (required for Alpine)
RUN apk add --no-cache make gcc g++ python3

WORKDIR /app

# Copy package files
COPY package*.json ./

# Use 'npm install' instead of 'npm ci' if you don't have a lockfile
RUN npm install --omit=dev

# Copy the source code
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]