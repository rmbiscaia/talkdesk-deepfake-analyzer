// Vercel Serverless Function — ValidSoft Voice Verity API Proxy
// Handles Cognito OAuth2 client_credentials auth + request forwarding
// Env vars: VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, VALIDSOFT_CLIENT_SECRET

// Module-level token cache (persists across warm Lambda invocations)
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  // Return cached token if still valid (refresh 60s before expiry)
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const { VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, VALIDSOFT_CLIENT_SECRET } = process.env;

  if (!VALIDSOFT_AUTH_URL || !VALIDSOFT_CLIENT_ID || !VALIDSOFT_CLIENT_SECRET) {
    throw new Error('Missing auth credentials in environment variables');
  }

  const credentials = Buffer.from(`${VALIDSOFT_CLIENT_ID}:${VALIDSOFT_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(VALIDSOFT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token request failed: HTTP ${res.status} — ${text}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Proxy': 'deepfake-fn',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  const { VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, VALIDSOFT_CLIENT_SECRET } = process.env;

  if (!VALIDSOFT_API_URL || !VALIDSOFT_AUTH_URL || !VALIDSOFT_CLIENT_ID || !VALIDSOFT_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'ValidSoft not configured',
      message: 'Set VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, and VALIDSOFT_CLIENT_SECRET in Vercel environment variables.',
      configured: {
        VALIDSOFT_API_URL: !!VALIDSOFT_API_URL,
        VALIDSOFT_AUTH_URL: !!VALIDSOFT_AUTH_URL,
        VALIDSOFT_CLIENT_ID: !!VALIDSOFT_CLIENT_ID,
        VALIDSOFT_CLIENT_SECRET: !!VALIDSOFT_CLIENT_SECRET,
      },
    });
  }

  // Set CORS + proxy headers on all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Proxy', 'deepfake-fn');

  try {
    const body = JSON.stringify(req.body);
    const bodySizeKB = Math.round(body.length / 1024);
    console.log(`[deepfake-fn] Received ${bodySizeKB} KB body`);

    if (!body || body.length === 0 || body === 'null') {
      return res.status(400).json({
        error: 'Empty request body',
        message: 'No body received. The request may have been truncated.',
      });
    }

    const token = await getToken();
    console.log(`[deepfake-fn] Token acquired, forwarding to ValidSoft...`);

    const apiRes = await fetch(VALIDSOFT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body,
    });

    const responseBody = await apiRes.text();
    console.log(`[deepfake-fn] ValidSoft responded: ${apiRes.status} (${responseBody.length} bytes)`);

    // Invalidate token cache on 401
    if (apiRes.status === 401) {
      tokenCache = { token: null, expiresAt: 0 };
    }

    res.setHeader('Content-Type', apiRes.headers.get('content-type') || 'application/json');
    return res.status(apiRes.status).send(responseBody);
  } catch (err) {
    console.error(`[deepfake-fn] Error: ${err.message}`);
    return res.status(502).json({
      error: 'ValidSoft proxy error',
      message: err.message,
    });
  }
}
