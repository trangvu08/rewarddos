// api/chat.js
// Vercel Serverless Function — proxy to Anthropic API
// Keeps the API key on the server. Never exposed to the browser.

// Simple in-memory rate limit (resets on cold start — good enough for friend-testing phase)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

export default async function handler(req, res) {
  // CORS — allow requests from your deployed domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Rate limiting by IP — protects against abuse on the public link
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng chờ một phút và thử lại.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing API key' });
    return;
  }

  try {
    const { system, messages, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Invalid request: messages array required' });
      return;
    }

    // Per-request debug logging — off by default. Set DEBUG_CHAT=1 in the
    // Vercel env to re-enable (logs full user input, so keep it off in prod).
    if (process.env.DEBUG_CHAT === '1') {
      console.error('Request body keys:', Object.keys(req.body));
      console.error('Messages count:', req.body.messages?.length);
      console.error('Last message:', JSON.stringify(req.body.messages?.slice(-1)));
    }

    // Keep first message (case context) + last 7 messages
    let trimmedMessages;
    if (messages.length <= 8) {
      trimmedMessages = messages;
    } else {
      trimmedMessages = [messages[0], ...messages.slice(-7)];
    }
    // Ensure array starts with user role
    if (trimmedMessages[0]?.role === 'assistant') {
      trimmedMessages = trimmedMessages.slice(1);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1000,
        system: [
          {
            type: 'text',
            text: system || '',
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: trimmedMessages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed;
      try { parsed = JSON.parse(errorText); } catch {}
      console.error('Anthropic 400:', response.status, parsed?.error?.type, parsed?.error?.message);
      console.error('Full error:', errorText);
      return res.status(response.status).json({
        error: 'Upstream API error',
        detail: parsed?.error || errorText
      });
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (err) {
    console.error('Anthropic error status:', err.status);
    console.error('Anthropic error message:', err.message);
    console.error('Anthropic error body:', JSON.stringify(err.error));
    return res.status(500).json({
      error: err.message,
      details: err.error,
      status: err.status
    });
  }
}
