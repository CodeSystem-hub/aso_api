const http = require('http');
const https = require('https');
const { URL } = require('url');

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function isAllowedTarget(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'https:') return false;
    const host = (u.hostname || '').toLowerCase();
    if (host.endsWith('.rm.cloudtotvs.com.br')) return true;
    return false;
  } catch {
    return false;
  }
}

async function handler(req, res) {
  const origin = req.headers.origin || '*';

  if (req.method === 'OPTIONS') {
    send(
      res,
      204,
      {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
        'Access-Control-Max-Age': '86400'
      },
      ''
    );
    return;
  }

  const reqUrl = new URL(req.url, 'http://localhost');
  if (reqUrl.pathname !== '/proxy') {
    send(
      res,
      404,
      {
        'Access-Control-Allow-Origin': origin,
        'Content-Type': 'application/json'
      },
      JSON.stringify({ error: 'Not found. Use /proxy?target=https%3A%2F%2F...' })
    );
    return;
  }

  const target = reqUrl.searchParams.get('target') || '';
  if (!target) {
    send(
      res,
      400,
      {
        'Access-Control-Allow-Origin': origin,
        'Content-Type': 'application/json'
      },
      JSON.stringify({ error: 'Missing target query param' })
    );
    return;
  }

  if (!isAllowedTarget(target)) {
    send(
      res,
      400,
      {
        'Access-Control-Allow-Origin': origin,
        'Content-Type': 'application/json'
      },
      JSON.stringify({ error: 'Target not allowed' })
    );
    return;
  }

  try {
    const headers = {
      Accept: req.headers.accept || 'application/json'
    };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      send(
        res,
        405,
        {
          'Access-Control-Allow-Origin': origin,
          'Content-Type': 'application/json'
        },
        JSON.stringify({ error: 'Method not allowed' })
      );
      return;
    }

    const bodyBuffer = await new Promise((resolve, reject) => {
      if (method === 'GET') return resolve(Buffer.alloc(0));
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    const urlObj = new URL(target);
    const upstreamResponse = await new Promise((resolve, reject) => {
      const r = https.request(
        urlObj,
        {
          method,
          headers
        },
        resolve
      );
      r.on('error', reject);
      if (method === 'POST') r.write(bodyBuffer);
      r.end();
    });

    const chunks = [];
    await new Promise((resolve, reject) => {
      upstreamResponse.on('data', (chunk) => chunks.push(chunk));
      upstreamResponse.on('end', resolve);
      upstreamResponse.on('error', reject);
    });

    const contentType = upstreamResponse.headers['content-type'] || 'application/octet-stream';
    const status = upstreamResponse.statusCode || 502;

    send(
      res,
      status,
      { 'Access-Control-Allow-Origin': origin, 'Content-Type': contentType },
      Buffer.concat(chunks)
    );
  } catch {
    send(
      res,
      502,
      {
        'Access-Control-Allow-Origin': origin,
        'Content-Type': 'application/json'
      },
      JSON.stringify({ error: 'Upstream fetch failed' })
    );
  }
}

const port = Number(process.env.PORT || 8787);
http.createServer((req, res) => {
  handler(req, res).catch(() => {
    send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Internal error' }));
  });
}).listen(port);
