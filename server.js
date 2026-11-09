'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HongguoServer } = require('./service/server.js');

const root = __dirname;
const appDir = path.resolve(root, 'app');
process.env.HONGGUO_DATA_DIR = process.env.HONGGUO_DATA_DIR || path.resolve(root, '.data');
process.env.HONGGUO_FFMPEG = process.env.HONGGUO_FFMPEG || 'ffmpeg';

// Initialize HongguoServer without requiring a token for web app
const apiService = new HongguoServer({ token: null });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const API_ROUTES = new Set([
  '/health',
  '/feed',
  '/search',
  '/series',
  '/play',
  '/progress',
  '/media',
  '/cover',
]);

const port = Number(process.env.APP_PORT || (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : 3000));
const host = '0.0.0.0';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // API endpoints
  if (API_ROUTES.has(url.pathname)) {
    return apiService.handle(req, res);
  }

  // Static files from app/
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.resolve(appDir, `.${pathname}`);

  // Guard against directory traversal
  if (!filePath.startsWith(appDir)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    const indexPath = path.resolve(appDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'cache-control': 'no-store' });
    return fs.createReadStream(indexPath).pipe(res);
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`[Hongguo Server] Running on http://${host}:${port}`);
});
