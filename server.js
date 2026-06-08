const net  = require('net');
const fs   = require('fs');
const path = require('path');

//  MIME TYPES
const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

//  LOGGER 

function logger(method, path, statusCode, ms) {
  const colors = {
    GET:    '\x1b[32m',
    POST:   '\x1b[34m',
    PUT:    '\x1b[33m',
    DELETE: '\x1b[31m',
  };
  const reset  = '\x1b[0m';
  const color  = colors[method] || '\x1b[37m';
  const status = statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';

  console.log(
    `${color}→ ${method.padEnd(7)}${reset}` +
    `${path.padEnd(25)}` +
    `${status}${statusCode}${reset}` +
    `  ${ms}ms`
  );
}

//  PARSER 

function parseRequest(rawData) {
  const text       = rawData.toString();
  const splitIndex = text.indexOf('\r\n\r\n');
  const headerSection = text.slice(0, splitIndex);
  const body          = text.slice(splitIndex + 4);

  const lines = headerSection.split('\r\n');
  const [method, fullPath] = lines[0].split(' ');
  const [urlPath, queryString] = fullPath.split('?');

  const query = {};
  if (queryString) {
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIndex = lines[i].indexOf(':');
    if (colonIndex > 0) {
      const key   = lines[i].slice(0, colonIndex).toLowerCase().trim();
      const value = lines[i].slice(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  let parsedBody = null;
  if (body && body.trim()) {
    try { parsedBody = JSON.parse(body); }
    catch { parsedBody = body; }
  }

  return { method, path: urlPath, query, headers, body: parsedBody };
}

//  RESPONSE 

function createResponse(socket, req, startTime) {
  let statusCode = 200;
  let statusText = 'OK';
  const headers  = {};

  const statusTexts = {
    200: 'OK', 201: 'Created', 400: 'Bad Request',
    403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests',
    500: 'Internal Server Error'
  };

  const res = {
    status(code) {
      statusCode = code;
      statusText = statusTexts[code] || 'Unknown';
      return res;
    },
    set(key, value) {
      headers[key] = value;
      return res;
    },
    json(data) {
      const body = JSON.stringify(data);
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
      let response = `HTTP/1.1 ${statusCode} ${statusText}\r\n`;
      for (const [k, v] of Object.entries(headers)) response += `${k}: ${v}\r\n`;
      response += '\r\n' + body;
      logger(req.method, req.path, statusCode, Date.now() - startTime);
      socket.end(response);
    },
    send(text) {
      headers['Content-Type']   = 'text/plain';
      headers['Content-Length'] = Buffer.byteLength(text);
      let response = `HTTP/1.1 ${statusCode} ${statusText}\r\n`;
      for (const [k, v] of Object.entries(headers)) response += `${k}: ${v}\r\n`;
      response += '\r\n' + text;
      logger(req.method, req.path, statusCode, Date.now() - startTime);
      socket.end(response);
    }
  };

  return res;
}

//  ROUTER 

function createApp() {
  const routes     = [];
  const middleware = [];
  let   staticDir  = null;

  //  Middleware support 
  // app.use(fn) registers a middleware function that runs before every route.
  // Each middleware receives (req, res, next) — calling next() passes control
  // to the following middleware or, once exhausted, to the route handler.
  // This mirrors how Express middleware works internally.
  function use(fn) {
    middleware.push(fn);
  }

  function runMiddleware(req, res, done) {
    let i = 0;
    function next() {
      if (i < middleware.length) {
        middleware[i++](req, res, next);
      } else {
        done();
      }
    }
    next();
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  function addRoute(method, routePath, handler) {
    const paramNames = [];
    const regexPath  = routePath.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method, regex: new RegExp(`^${regexPath}$`), paramNames, handler });
  }

  function match(method, reqPath) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = reqPath.match(route.regex);
      if (m) {
        const params = {};
        route.paramNames.forEach((name, i) => params[name] = m[i + 1]);
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  // ── Static file serving ───────────────────────────────────────────────────

  function tryStatic(req, socket, startTime) {
    if (!staticDir) return false;

    const filePath     = path.join(staticDir, req.path);
    const resolvedFile = path.resolve(filePath);
    const resolvedDir  = path.resolve(staticDir);

    if (!resolvedFile.startsWith(resolvedDir)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\nAccess denied');
      logger(req.method, req.path, 403, Date.now() - startTime);
      return true;
    }

    if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
      return false;
    }

    const ext      = path.extname(resolvedFile).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const size     = fs.statSync(resolvedFile).size;

    let responseHeaders  = `HTTP/1.1 200 OK\r\n`;
    responseHeaders     += `Content-Type: ${mimeType}\r\n`;
    responseHeaders     += `Content-Length: ${size}\r\n\r\n`;

    socket.write(responseHeaders);
    fs.createReadStream(resolvedFile).pipe(socket);
    logger(req.method, req.path, 200, Date.now() - startTime);
    return true;
  }

  //  TCP data buffering 
  // TCP can deliver data in multiple chunks. We buffer incoming bytes until
  // we have all headers plus the full body (based on Content-Length).
  // Without this, large POST bodies silently arrive incomplete.

  function handleSocket(socket) {
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText         = buffer.slice(0, headerEnd).toString();
      const contentLengthMatch = headerText.match(/content-length:\s*(\d+)/i);
      const contentLength      = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;
      const totalExpected      = headerEnd + 4 + contentLength;

      if (buffer.length < totalExpected) return;

      const startTime = Date.now();
      const req = parseRequest(buffer.slice(0, totalExpected));
      const res = createResponse(socket, req, startTime);
      buffer = buffer.slice(totalExpected);

      if (tryStatic(req, socket, startTime)) return;

      runMiddleware(req, res, () => {
        const matched = match(req.method, req.path);
        if (matched) {
          req.params = matched.params;
          matched.handler(req, res);
        } else {
          res.status(404).json({ error: 'Route not found' });
        }
      });
    });

    socket.on('error', (err) => console.error('Socket error:', err.message));
  }

  //  Public API 

  const app = {
    use,
    get:    (routePath, handler) => addRoute('GET',    routePath, handler),
    post:   (routePath, handler) => addRoute('POST',   routePath, handler),
    put:    (routePath, handler) => addRoute('PUT',    routePath, handler),
    delete: (routePath, handler) => addRoute('DELETE', routePath, handler),

    static(dir) { staticDir = dir; },

    listen(port, callback) {
      const server = net.createServer(handleSocket);
      server.listen(port, callback);
    }
  };

  return app;
}

//  YOUR APP 

const app = createApp();

app.static('./public');

// Middleware: add a custom header to every response
app.use((req, res, next) => {
  res.set('X-Powered-By', 'hw1-server');
  next();
});

// Middleware: simple rate limiter — max 100 requests per minute per IP
const requestCounts = {};
app.use((req, res, next) => {
  const ip  = req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  if (!requestCounts[ip]) requestCounts[ip] = { count: 0, resetAt: now + 60000 };
  if (now > requestCounts[ip].resetAt) requestCounts[ip] = { count: 0, resetAt: now + 60000 };
  requestCounts[ip].count++;
  if (requestCounts[ip].count > 100) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.get('/api/users/:id', (req, res) => {
  res.json({ id: req.params.id, name: 'User ' + req.params.id });
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  res.status(201).json({ id: Date.now(), name, email });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});