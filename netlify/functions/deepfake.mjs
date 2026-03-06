// Netlify Serverless Function — ValidSoft Voice Verity API Proxy
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

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed', method: req.method }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, VALIDSOFT_CLIENT_SECRET } = process.env;

  if (!VALIDSOFT_API_URL || !VALIDSOFT_AUTH_URL || !VALIDSOFT_CLIENT_ID || !VALIDSOFT_CLIENT_SECRET) {
    return new Response(JSON.stringify({
      error: 'ValidSoft not configured',
      message: 'Set VALIDSOFT_API_URL, VALIDSOFT_AUTH_URL, VALIDSOFT_CLIENT_ID, and VALIDSOFT_CLIENT_SECRET in Netlify environment variables.',
      configured: {
        VALIDSOFT_API_URL: !!VALIDSOFT_API_URL,
        VALIDSOFT_AUTH_URL: !!VALIDSOFT_AUTH_URL,
        VALIDSOFT_CLIENT_ID: !!VALIDSOFT_CLIENT_ID,
        VALIDSOFT_CLIENT_SECRET: !!VALIDSOFT_CLIENT_SECRET,
      },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'X-Proxy': 'deepfake-fn',  // proves response came from our function, not Netlify infra
  };

  try {
    const body = await req.text();
    const bodySizeKB = Math.round(body.length / 1024);
    console.log(`[deepfake-fn] Received ${bodySizeKB} KB body`);

    if (!body || body.length === 0) {
      return new Response(JSON.stringify({
        error: 'Empty request body',
        message: 'No body received. The request may have been truncated by Netlify (6 MB limit).',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
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

    return new Response(responseBody, {
      status: apiRes.status,
      headers: {
        'Content-Type': apiRes.headers.get('content-type') || 'application/json',
        ...CORS,
      },
    });
  } catch (err) {
    console.error(`[deepfake-fn] Error: ${err.message}`);
    return new Response(JSON.stringify({
      error: 'ValidSoft proxy error',
      message: err.message,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
};

export const config = {
  path: '/validsoft/deepfake',
};
