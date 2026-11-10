FROM node:22-alpine

# Install ffmpeg for video stream processing and openssl for TLS certificate support
RUN apk add --no-cache ffmpeg openssl

WORKDIR /app

# Copy package descriptors and install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source code
COPY server.js ./
COPY app/ ./app/
COPY service/ ./service/
COPY scripts/ ./scripts/

# Create data directory for cached feeds, covers, and media
RUN mkdir -p /app/data /app/certs

ENV NODE_ENV=production \
    PORT=3000 \
    HONGGUO_DATA_DIR=/app/data \
    HONGGUO_FFMPEG=ffmpeg

EXPOSE 3000 443

VOLUME ["/app/data"]

CMD ["npm", "start"]
