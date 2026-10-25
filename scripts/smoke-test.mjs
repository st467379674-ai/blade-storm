import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3119;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js', '--prod'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), BOTS: '0', MOBS: '0', HOST: '127.0.0.1' },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) return response.json();
    } catch {
      /* server still booting */
    }
    await sleep(100);
  }
  throw new Error('server did not boot');
}

function createClient(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const client = {
    name,
    ws,
    id: null,
    state: null,
    events: [],
    hits: [],
    errors: [],
    send(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    },
  };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'welcome') {
      client.id = msg.id;
      client.state = msg.snapshot;
    } else if (msg.type === 'state') {
      client.state = msg;
      client.events.push(...(msg.events ?? []));
      client.hits.push(...(msg.events ?? []).filter((e) => e.type === 'hit'));
    } else if (msg.type === 'error') {
      client.errors.push(msg.message);
    }
  });
  client.ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} join timed out`)), 5000);
    const check = setInterval(() => {
      if (client.id) {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
      if (client.errors.length) {
        clearTimeout(timeout);
        clearInterval(check);
        reject(new Error(client.errors.join(', ')));
      }
    }, 30);
  });
  ws.on('open', () => client.send({ type: 'join', name }));
  return client;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  void cleanup().finally(() => process.exit(1));
}

let cleanupPromise;
function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = new Promise((resolve) => {
    for (const client of clients) {
      try {
        client.ws.terminate();
      } catch {
        /* ignore */
      }
    }
    try {
      server.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    setTimeout(resolve, 400);
  });
  return cleanupPromise;
}
const clients = [];

try {
  const status = await waitForServer();
  console.log(`\n  smoke test · server ready (${status.arena})`);

  const a = createClient('测试刀客甲');
  const b = createClient('测试刀客乙');
  clients.push(a, b);
  await Promise.all([a.ready, b.ready]);
  console.log(`  ✓ two clients joined: ${a.id}, ${b.id}`);

  if (a.id === b.id) fail('duplicate player ids');

  const ids = new Set([a.id, b.id]);
  const deadline = Date.now() + 24000;
  let sawPlaying = false;
  let sawMovement = false;
  let firstA = null;
  let firstB = null;

  while (Date.now() < deadline) {
    const state = a.state;
    if (!state) {
      await sleep(30);
      continue;
    }
    if (state.match.phase === 'playing') sawPlaying = true;
    const meA = state.players.find((p) => p.id === a.id);
    const meB = state.players.find((p) => p.id === b.id);
    if (meA && meB) {
      if (!firstA) firstA = { x: meA.x, z: meA.z };
      if (!firstB) firstB = { x: meB.x, z: meB.z };
      if (Math.hypot(meA.x - firstA.x, meA.z - firstA.z) > 0.4) sawMovement = true;
      if (sawPlaying) {
        const dx = meB.x - meA.x;
        const dz = meB.z - meA.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 1.5) {
          a.send({ type: 'input', mx: dx / d, mz: dz / d, dash: false });
          b.send({ type: 'input', mx: -dx / d, mz: -dz / d, dash: false });
        } else {
          a.send({ type: 'input', mx: 0, mz: 0, dash: false });
          b.send({ type: 'input', mx: 0, mz: 0, dash: false });
        }
      }
    }
    if (a.hits.some((e) => ids.has(e.attackerId) && ids.has(e.targetId))) break;
    await sleep(33);
  }

  if (!sawPlaying) fail('match never entered playing phase');
  console.log('  ✓ match started');
  if (!sawMovement) fail('authoritative movement did not update');
  console.log('  ✓ server-authoritative movement is updating');
  const hit = a.hits.find((e) => ids.has(e.attackerId) && ids.has(e.targetId));
  if (!hit) fail('no player-vs-player blade hit registered in 24s');
  console.log(`  ✓ blade hit registered: ${hit.attackerId} -> ${hit.targetId} (${Math.round(hit.amount)} dmg)`);

  if (!(hit.amount > 0)) fail('hit event did not deal damage');

  const finalStatus = await (await fetch(`${base}/api/status`)).json();
  if (finalStatus.online !== 2) fail(`expected 2 online humans, got ${finalStatus.online}`);
  console.log('  ✓ status endpoint reports 2 online players');

  await sleep(250);
  if (a.errors.length || b.errors.length) fail('server returned protocol errors');
  console.log('\n  ✓ multiplayer smoke test passed\n');
  await cleanup();
  process.exit(0);
} catch (error) {
  fail(error.stack || error.message);
}
