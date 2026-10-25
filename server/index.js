import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, CONFIG } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LOCAL_TMP = path.join(ROOT, '.tmp');
fs.mkdirSync(LOCAL_TMP, { recursive: true });
process.env.TEMP = LOCAL_TMP;
process.env.TMP = LOCAL_TMP;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const BOT_COUNT = process.env.BOTS === undefined ? CONFIG.botCount : Math.max(0, Number(process.env.BOTS) || 0);
const MOB_COUNT = process.env.MOBS === undefined ? CONFIG.mobCount : Math.max(0, Number(process.env.MOBS) || 0);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

const game = new Game({ botCount: BOT_COUNT, mobCount: MOB_COUNT });

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.resolve(DIST, `.${pathname}`);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Build not found. Run: npm run build');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const gzip =
    COMPRESSIBLE.has(ext) && /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
  const immutable = pathname.startsWith('/assets/');
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : ext === '.html'
        ? 'no-cache'
        : 'public, max-age=86400',
    Vary: 'Accept-Encoding',
  };
  if (gzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  if (gzip) stream.pipe(zlib.createGzip({ level: 9 })).pipe(res);
  else stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        online: game.humanCount(),
        bots: game.botCount(),
        phase: game.phase,
        timeLeft: Math.ceil(game.timeLeft),
        arena: '夜刃擂台',
      }),
    );
    return;
  }
  if (PROD) {
    serveStatic(req, res);
    return;
  }
  if (!vite) {
    res.writeHead(503);
    res.end('Vite is starting');
    return;
  }
  vite.middlewares(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
});

let vite = null;
if (!PROD) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: true,
    },
    appType: 'spa',
  });
  vite.watcher?.on('error', (error) => {
    console.warn('[vite watcher]', error?.message ?? error);
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return;
  }
  if (pathname !== '/ws') return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.playerId = null;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: '消息格式错误' });
      return;
    }
    if (msg.type === 'join') {
      if (ws.playerId) return;
      const player = game.addHuman(msg.name);
      if (!player) {
        send(ws, { type: 'error', message: '擂台已满，请稍后再试' });
        return;
      }
      ws.playerId = player.id;
      send(ws, {
        type: 'welcome',
        id: player.id,
        config: {
          arenaRadius: CONFIG.arenaRadius,
          matchDuration: CONFIG.matchDuration,
          maxHumans: CONFIG.maxHumans,
          maxBlades: CONFIG.maxBlades,
          maxBladeLevel: CONFIG.maxBladeLevel,
          zoneShrinkStart: CONFIG.zoneShrinkStart,
          zoneShrinkDuration: CONFIG.zoneShrinkDuration,
        },
        snapshot: game.takeSnapshot(),
      });
      return;
    }
    if (!ws.playerId) {
      send(ws, { type: 'error', message: '请先加入擂台' });
      return;
    }
    if (msg.type === 'input') {
      game.setInput(ws.playerId, msg);
      return;
    }
    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t, serverTime: Date.now() });
    }
  });

  ws.on('close', () => {
    if (ws.playerId) game.removeHuman(ws.playerId);
    ws.playerId = null;
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref?.();

let last = performance.now();
let accumulator = 0;
const step = 1 / CONFIG.tickRate;
const snapshotStep = 1 / CONFIG.snapshotRate;
let snapshotTimer = 0;

function loop(now = performance.now()) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += dt;
  snapshotTimer += dt;
  let steps = 0;
  while (accumulator >= step && steps < 4) {
    game.update(step);
    accumulator -= step;
    steps++;
  }
  if (snapshotTimer >= snapshotStep) {
    snapshotTimer = 0;
    if (wss.clients.size > 0) {
      const snapshot = game.takeSnapshot();
      const payload = JSON.stringify({ type: 'state', ...snapshot });
      for (const ws of wss.clients) {
        if (ws.readyState === 1 && ws.playerId) ws.send(payload);
      }
    }
  }
  setTimeout(() => loop(performance.now()), 8);
}
loop(performance.now());

server.listen(PORT, HOST, () => {
  const mode = PROD ? 'production' : 'development';
  console.log(`\n  ⚔  转刀风暴 · BLADE STORM`);
  console.log(`      ${mode}  http://localhost:${PORT}`);
  console.log(`      联机 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`      Bots: ${BOT_COUNT} · Knife spirits: ${MOB_COUNT} · Max humans: ${CONFIG.maxHumans}\n`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
