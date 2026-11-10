'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { HongguoServer } = require('./service/server.js');

const root = __dirname;
const appDir = path.resolve(root, 'app');
const dataDir = path.resolve(process.env.HONGGUO_DATA_DIR || path.resolve(root, '.data'));
process.env.HONGGUO_DATA_DIR = dataDir;
try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (_) {}

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
const httpsPort = process.env.HTTPS_PORT ? Number(process.env.HTTPS_PORT) : null;
const host = '0.0.0.0';

function loadOrGenerateCertificates(certsDir) {
  if (process.env.DISABLE_HTTPS === 'true') {
    return null;
  }

  // 1. Inlined PEM from environment
  if (process.env.SSL_CERT && process.env.SSL_KEY) {
    return { cert: process.env.SSL_CERT, key: process.env.SSL_KEY };
  }

  // 2. Custom certificate file paths from environment
  const customCert = process.env.SSL_CERT_PATH;
  const customKey = process.env.SSL_KEY_PATH;
  if (customCert && customKey && fs.existsSync(customCert) && fs.existsSync(customKey)) {
    try {
      return {
        cert: fs.readFileSync(customCert),
        key: fs.readFileSync(customKey),
      };
    } catch (e) {
      console.warn('[Hongguo Server] Failed to read custom TLS files:', e.message);
    }
  }

  // 3. Known standard certificate directories
  const searchPairs = [
    { cert: path.resolve(root, 'certs', 'cert.pem'), key: path.resolve(root, 'certs', 'key.pem') },
    { cert: path.resolve(root, 'certs', 'fullchain.pem'), key: path.resolve(root, 'certs', 'privkey.pem') },
    { cert: path.resolve(certsDir, 'cert.pem'), key: path.resolve(certsDir, 'key.pem') },
  ];

  for (const pair of searchPairs) {
    if (fs.existsSync(pair.cert) && fs.existsSync(pair.key)) {
      try {
        return {
          cert: fs.readFileSync(pair.cert),
          key: fs.readFileSync(pair.key),
        };
      } catch (_) {}
    }
  }

  // 4. Auto-generate self-signed cert if none found and openssl is available
  try {
    fs.mkdirSync(certsDir, { recursive: true });
    const targetCert = path.resolve(certsDir, 'cert.pem');
    const targetKey = path.resolve(certsDir, 'key.pem');

    if (fs.existsSync(targetCert) && fs.existsSync(targetKey)) {
      return {
        cert: fs.readFileSync(targetCert),
        key: fs.readFileSync(targetKey),
      };
    }

    const res = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-keyout', targetKey,
      '-out', targetCert,
      '-days', '365',
      '-subj', '/CN=localhost/O=Hongguo/OU=Server',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0',
    ], { stdio: 'ignore' });

    if (res.status === 0 && fs.existsSync(targetCert) && fs.existsSync(targetKey)) {
      console.log(`[Hongguo Server] Auto-generated self-signed TLS certificate in ${certsDir}`);
      return {
        cert: fs.readFileSync(targetCert),
        key: fs.readFileSync(targetKey),
      };
    }
  } catch (err) {
    console.warn('[Hongguo Server] TLS auto-generation skipped:', err.message);
  }

  return null;
}

const tlsCredentials = loadOrGenerateCertificates(path.resolve(dataDir, 'certs'));

function requestHandler(req, res) {
  const isEncrypted = Boolean(req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https');
  const protocol = isEncrypted ? 'https' : 'http';
  const url = new URL(req.url, `${protocol}://${req.headers.host || 'localhost'}`);

  // Handle FORCE_HTTPS redirect if configured
  if (process.env.FORCE_HTTPS === 'true' && !isEncrypted && url.pathname !== '/health') {
    const hostHeader = (req.headers.host || 'localhost').replace(/:\d+$/, '');
    const redirectPort = httpsPort || (port === 80 || port === 3000 ? '' : `:${port}`);
    const targetHost = redirectPort ? `${hostHeader}:${redirectPort}` : hostHeader;
    res.writeHead(301, {
      Location: `https://${targetHost}${req.url}`,
      'content-type': 'text/plain',
    });
    return res.end(`Redirecting to https://${targetHost}${req.url}`);
  }

  // Security headers for HTTPS
  if (isEncrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');

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
}

const httpServer = http.createServer(requestHandler);
const httpsServer = tlsCredentials ? https.createServer(tlsCredentials, requestHandler) : null;

let mainServer;
if (httpsServer) {
  if (process.env.FORCE_HTTPS_ONLY === 'true') {
    mainServer = httpsServer;
  } else {
    // Multiplex HTTP and HTTPS on the primary port
    mainServer = net.createServer((socket) => {
      socket.once('data', (buffer) => {
        const isTls = buffer.length >= 2 && buffer[0] === 0x16 && buffer[1] === 0x03;
        const targetServer = isTls ? httpsServer : httpServer;
        socket.pause();
        socket.unshift(buffer);
        targetServer.emit('connection', socket);
        process.nextTick(() => {
          if (!socket.destroyed) {
            socket.resume();
          }
        });
      });
      socket.on('error', (err) => {
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
          console.warn('[Hongguo Server] Socket error:', err.message);
        }
      });
    });
  }
} else {
  mainServer = httpServer;
}

mainServer.listen(port, host, () => {
  if (httpsServer) {
    console.log(`[Hongguo Server] Running on http://${host}:${port} and https://${host}:${port} (TLS enabled)`);
  } else {
    console.log(`[Hongguo Server] Running on http://${host}:${port}`);
  }
});

// If a separate dedicated HTTPS_PORT is configured (e.g. 443), listen on it too
if (httpsPort && httpsPort !== port && httpsServer) {
  httpsServer.listen(httpsPort, host, () => {
    console.log(`[Hongguo Server] Dedicated HTTPS port listening on https://${host}:${httpsPort}`);
  });
}
