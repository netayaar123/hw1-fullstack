hw1-fullstack — HTTP Server from Scratch

A lightweight HTTP/1.1 server framework built using only Node.js's net module — no http, http2, or third-party libraries.

Getting Started

git clone https://github.com/netayaar123/hw1-fullstack.git
cd hw1-fullstack
node server.js
The server starts on http://localhost:3000.

Design Philosophy

The API is modeled after Express, keeping the familiar req/res pattern that developers already know. Each layer is a separate, self-contained function:

TCP → Buffering → Parsing → Middleware → Routing → Response

This separation makes each piece easy to understand and modify in isolation. The decision to mirror Express's API was deliberate: the goal was to make it feel familiar enough that a developer who knows Express can read and use this code immediately, while the internals remain fully transparent.

Why middleware?

Express's killer feature isn't routing — it's the middleware chain. By implementing app.use() with a next() callback, the same pattern that powers authentication, logging, and body parsing in real-world Express apps works here too. It shows that middleware is just a linked list of functions, not magic.

Why buffer TCP chunks?

The net module delivers raw TCP data, which can arrive in multiple partial chunks for large requests. Buffering until Content-Length bytes are received is the correct behavior — without it, POST requests with large bodies silently break. Most tutorial implementations skip this; this one doesn't.

Why a rate limiter as built-in middleware?

It demonstrates the middleware system doing something real and useful. Rate limiting is a cross-cutting concern — it needs to run on every request without touching any route handler — which is exactly what middleware is designed for.

API

Middleware

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});
Route Handlers

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  res.status(201).json({ id: Date.now(), name, email });
});
URL Parameters

app.get('/api/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});
// GET /api/users/42  →  { id: '42' }
Static File Serving

app.static('./public');
// GET /index.html → serves public/index.html
Response Methods

res.json({ data: 'value' });
res.send('plain text');
res.status(404).json({ error: 'not found' });
res.set('X-Custom', 'value');
How It Works

TCP Layer — net opens a socket and buffers raw bytes until the full request arrives
HTTP Parsing — splits raw text into method, path, headers, and body
Middleware Chain — runs registered app.use() functions in order before the route
Router — matches the request against registered routes using regex
Response Builder — formats a valid HTTP/1.1 response and writes it to the socket
Static Files — streams files from disk with the correct MIME type
Project Structure

hw1-fullstack/
├── server.js
├── public/
│   └── index.html
├── package.json
└── README.md
