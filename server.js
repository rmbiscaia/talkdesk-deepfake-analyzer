// Talkdesk Deepfake Analyzer — Proxy Server
// Run: node server.js
// Serves the frontend on http://localhost:3000
// Proxies POST /validsoft/deepfake → ValidSoft Voice Verity API
// Auth: AWS Cognito OAuth2 client_credentials flow

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration — reads from .env file (no dependencies)
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const PORT = process.env.PORT || 3000;
const VALIDSOFT_API_URL = process.env.VALIDSOFT_API_URL || '';
const VALIDSOFT_AUTH_URL = process.env.VALIDSOFT_AUTH_URL || '';
const VALIDSOFT_CLIENT_ID = process.env.VALIDSOFT_CLIENT_ID || '';
const VALIDSOFT_CLIENT_SECRET = process.env.VALIDSOFT_CLIENT_SECRET || '';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// ValidSoft OAuth2 — AWS Cognito client_credentials
// ---------------------------------------------------------------------------

let tokenCache = { token: null, expiresAt: 0 };

function getValidSoftToken() {
  return new Promise((resolve, reject) => {
    // Return cached token if still valid (refresh 60s before expiry)
    if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
      console.log('[ValidSoft] Using cached token');
      return resolve(tokenCache.token);
    }

    console.log('[ValidSoft] Requesting new OAuth token from Cognito...');

    const credentials = Buffer.from(`${VALIDSOFT_CLIENT_ID}:${VALIDSOFT_CLIENT_SECRET}`).toString('base64');
    const postBody = 'grant_type=client_credentials';

    const authUrl = new URL(VALIDSOFT_AUTH_URL);
    const options = {
      hostname: authUrl.hostname,
      port: 443,
      path: authUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
        'Content-Length': Buffer.byteLength(postBody),
      },
    };

    const tokenReq = https.request(options, (tokenRes) => {
      let body = '';
      tokenRes.on('data', chunk => { body += chunk; });
      tokenRes.on('end', () => {
        if (tokenRes.statusCode !== 200) {
          console.error(`[ValidSoft] Token request failed: HTTP ${tokenRes.statusCode}`, body);
          return reject(new Error(`Token request failed: HTTP ${tokenRes.statusCode} — ${body}`));
        }

        try {
          const data = JSON.parse(body);
          tokenCache = {
            token: data.access_token,
            expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
          };
          console.log(`[ValidSoft] Token acquired (expires in ${data.expires_in || 3600}s)`);
          resolve(data.access_token);
        } catch (err) {
          reject(new Error('Failed to parse token response: ' + body));
        }
      });
    });

    tokenReq.on('error', (err) => {
      console.error('[ValidSoft] Token request error:', err.message);
      reject(err);
    });

    tokenReq.write(postBody);
    tokenReq.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── ValidSoft proxy: POST /validsoft/deepfake ──────────────────────────
  if (req.url === '/validsoft/deepfake' && req.method === 'POST') {
    if (!VALIDSOFT_API_URL || !VALIDSOFT_CLIENT_ID || !VALIDSOFT_CLIENT_SECRET) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'ValidSoft not configured',
        message: 'Set VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, and VALIDSOFT_CLIENT_SECRET in your .env file.'
      }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const token = await getValidSoftToken();
        const parsed = new URL(VALIDSOFT_API_URL);
        const options = {
          hostname: parsed.hostname,
          port: 443,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(body),
          },
        };

        console.log(`[ValidSoft] POST ${parsed.pathname} (${(Buffer.byteLength(body) / 1024 / 1024).toFixed(1)} MB)`);

        const proxyReq = https.request(options, (proxyRes) => {
          let responseBody = '';
          proxyRes.on('data', chunk => { responseBody += chunk; });
          proxyRes.on('end', () => {
            console.log(`[ValidSoft] <- ${proxyRes.statusCode} (${responseBody.length} bytes)`);

            // Invalidate token cache on 401
            if (proxyRes.statusCode === 401) {
              tokenCache = { token: null, expiresAt: 0 };
              console.warn('[ValidSoft] Token rejected — cache cleared');
            }

            res.writeHead(proxyRes.statusCode, {
              'Content-Type': proxyRes.headers['content-type'] || 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(responseBody);
          });
        });

        proxyReq.on('error', (err) => {
          console.error(`[ValidSoft] Proxy error: ${err.message}`);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ValidSoft proxy error', message: err.message }));
        });

        proxyReq.write(body);
        proxyReq.end();
      } catch (err) {
        console.error(`[ValidSoft] Auth error: ${err.message}`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ValidSoft authentication failed', message: err.message }));
      }
    });
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  const configured = VALIDSOFT_API_URL && VALIDSOFT_CLIENT_ID && VALIDSOFT_CLIENT_SECRET;
  console.log('');
  console.log('  Talkdesk Deepfake Analyzer');
  console.log('  ─────────────────────────');
  console.log(`  App:       http://localhost:${PORT}`);
  console.log(`  Proxy:     POST /validsoft/deepfake -> ValidSoft Voice Verity`);
  console.log(`  Auth:      AWS Cognito OAuth2 (client_credentials)`);
  console.log(`  Status:    ${configured ? 'configured' : 'NOT SET — add credentials to .env'}`);
  console.log('');
});
