/**
 * Netlify serverless function: POST /api/ls/validate
 *
 * Proxies license-key validation requests to the Lemon Squeezy API,
 * bypassing any CORS restrictions that would block a direct browser fetch.
 *
 * The Lemon Squeezy /v1/licenses/validate endpoint does not require
 * a secret API key — it only needs the license_key in the POST body —
 * so this proxy is safe to deploy without any environment secrets.
 *
 * Route wired in netlify.toml:
 *   [[redirects]]
 *   from   = "/api/ls/validate"
 *   to     = "/.netlify/functions/ls-validate"
 *   status = 200
 */
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const LS_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

    try {
        const response = await fetch(LS_VALIDATE_URL, {
            method:  'POST',
            headers: {
                'Accept':       'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: event.body, // forward the raw form-encoded body as-is
        });

        const data = await response.json();

        return {
            statusCode: response.status,
            headers:    { 'Content-Type': 'application/json' },
            body:       JSON.stringify(data),
        };
    } catch (err) {
        return {
            statusCode: 502,
            body:       JSON.stringify({ error: 'Upstream request failed', message: err.message }),
        };
    }
};
