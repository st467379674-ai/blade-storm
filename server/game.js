const TAU = Math.PI * 2;

export const CONFIG = {
  arenaRadius: 40,
  matchDuration: 180,
  startCountdown: 3.5,
  restartDelay: 10,
  tickRate: 30,
  snapshotRate: 20,
  maxHumans: 10,
  botCount: 3,
  baseSpeed: 6.2,
  dashSpeed: 20,
  dashDuration: 0.18,
  dashCooldown: 2.7,
  baseHp: 100,
  maxHpCap: 224,
  baseBladeDamage: 11,
  hitCooldown: 0.42,
  poisonDps: 9,
  zoneShrinkStart: 45,
  zoneShrinkDuration: 130,
  finalZoneRadius: 8,
  startingBlades: 3,
  maxBlades: 12,
  maxBladeLevel: 6,
  bladeBreakCooldown: 1.35,
  maxPickups: 14,
  pickupIntervalMin: 2.4,
  pickupIntervalMax: 3.8,
  mobCount: 38,
  mobHp: 34,
  mobSpeed: 2.35,
  mobAggro: 9,
  mobDamage: 4,
  mobAttackCd: 1.55,
};

const COLORS = [
  '#5eead4',
  '#ff7a9e',
  '#ffd166',
  '#8b9cff',
  '#ff9f5a',
  '#a78bfa',
  '#6ee7b7',
  '#f472b6',
  '#38bdf8',
  '#facc15',
  '#fb7185',
];

const BOT_NAMES = ['无名', '阿七', '刀十三', '夜莺', '断水', '听风', '鸦九'];
const PICKUP_TYPES = ['upgrade', 'blade', 'haste', 'rage', 'shield'];
const PICKUP_WEIGHTS = { upgrade: 28, blade: 24, haste: 20, rage: 17, shield: 11 };

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => min + Math.random() * (max - min);
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const round = (v, digits = 2) => Number(v.toFixed(digits));

function randomPickupType() {
  let total = 0;
  for (const type of PICKUP_TYPES) total += PICKUP_WEIGHTS[type];
  let roll = Math.random() * total;
  for (const type of PICKUP_TYPES) {
    roll -= PICKUP_WEIGHTS[type];
    if (roll <= 0) return type;
  }
  return 'blade';
}

function pointSegmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSq = dx * dx + dz * dz;
  if (!lengthSq) return Math.hypot(px - x1, pz - z1);
  let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSq;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
}

function orientation(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function onSegment(ax, az, bx, bz, px, pz) {
  return (
    px >= Math.min(ax, bx) - 1e-6 &&
    px <= Math.max(ax, bx) + 1e-6 &&
    pz >= Math.min(az, bz) - 1e-6 &&
    pz <= Math.max(az, bz) + 1e-6
  );
}

function segmentsIntersect(a, b) {
  const o1 = orientation(a.x1, a.z1, a.x2, a.z2, b.x1, b.z1);
  const o2 = orientation(a.x1, a.z1, a.x2, a.z2, b.x2, b.z2);
  const o3 = orientation(b.x1, b.z1, b.x2, b.z2, a.x1, a.z1);
  const o4 = orientation(b.x1, b.z1, b.x2, b.z2, a.x2, a.z2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < 1e-9 && onSegment(a.x1, a.z1, a.x2, a.z2, b.x1, b.z1)) return true;
  if (Math.abs(o2) < 1e-9 && onSegment(a.x1, a.z1, a.x2, a.z2, b.x2, b.z2)) return true;
  if (Math.abs(o3) < 1e-9 && onSegment(b.x1, b.z1, b.x2, b.z2, a.x1, a.z1)) return true;
  if (Math.abs(o4) < 1e-9 && onSegment(b.x1, b.z1, b.x2, b.z2, a.x2, a.z2)) return true;
  return false;
}

function segmentDistance(a, b) {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(
    pointSegmentDistance(a.x1, a.z1, b.x1, b.z1, b.x2, b.z2),
    pointSegmentDistance(a.x2, a.z2, b.x1, b.z1, b.x2, b.z2),
    pointSegmentDistance(b.x1, b.z1, a.x1, a.z1, a.x2, a.z2),
    pointSegmentDistance(b.x2, b.z2, a.x1, a.z1, a.x2, a.z2),
  );
}

function shortestAngle(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 12);
}

function randomPointInCircle(radius) {
  const a = Math.random() * TAU;
  const r = Math.sqrt(Math.random()) * radius;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export class Game {
  constructor(options = {}) {
    this.players = new Map();
    this.pickups = [];
    this.mobs = [];
    this.mobId = 0;
    this.events = [];
    this.tick = 0;
    this.matchId = 0;
    this.phase = 'waiting';
    this.timeLeft = CONFIG.matchDuration;
    this.countdown = 0;
    this.restartIn = 0;
    this.safeRadius = CONFIG.arenaRadius;
    this.zone = { x: 0, z: 0 };
    this.zoneFocus = { x: 0, z: 0 };
    this.pickupTimer = 3;
    this.pickupId = 0;
    this.humanSeq = 0;
    this.botSeq = 0;
    this.colorSeq = 0;
    this.result = null;
    this.clashCooldowns = new Map();
    this.breakCooldowns = new Map();
    this.options = options;
    this.manualStart = options.manualStart === true;
    this.mobCount = Math.max(0, options.mobCount ?? CONFIG.mobCount);
    this.spawnBots(options.botCount ?? CONFIG.botCount);
  }

  humanCount() {
    let count = 0;
    for (const p of this.players.values()) if (!p.isBot) count++;
    return count;
  }

  botCount() {
    let count = 0;
    for (const p of this.players.values()) if (p.isBot) count++;
    return count;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  nextColor() {
    const color = COLORS[this.colorSeq % COLORS.length];
    this.colorSeq++;
    return color;
  }

  createPlayer({ id, name, isBot = false, color, botStyle = 0 }) {
    const spawn = this.findSpawn();
    const p = {
      id,
      name,
      isBot,
      color: color ?? this.nextColor(),
      botStyle,
      x: spawn.x,
      z: spawn.z,
      facing: rand(-Math.PI, Math.PI),
      hp: CONFIG.baseHp,
      maxHp: CONFIG.baseHp,
      kills: 0,
      deaths: 0,
      bladeAngle: Math.random() * TAU,
      bladeCount: CONFIG.startingBlades,
      bladeLevel: 1,
      bladeRadius: 2.25,
      bladeLength: 2.6,
      bladeSpeed: 3.9,
      dashCd: 0,
      dashTime: 0,
      dashDirX: 0,
      dashDirZ: -1,
      respawn: 0,
      invuln: 1.2,
      scale: 1,
      speed: CONFIG.baseSpeed,
      shieldHp: 0,
      bladeLossCd: 0,
      souls: 0,
      buffs: { haste: 0, rage: 0, shield: 0 },
      hitCd: new Map(),
      mobHitCd: new Map(),
      input: { mx: 0, mz: 0, dashQueued: false },
      roamTimer: 0,
      roamX: spawn.x,
      roamZ: spawn.z,
      lastAttacker: null,
    };
    this.recomputePower(p);
    this.players.set(id, p);
    return p;
  }

  addHuman(name) {
    if (this.humanCount() >= CONFIG.maxHumans) return null;
    const id = `h${++this.humanSeq}`;
    let finalName = cleanName(name) || `刀客${this.humanSeq}`;
    const used = new Set([...this.players.values()].map((p) => p.name));
    if (used.has(finalName)) finalName = `${finalName}·${this.humanSeq}`;
    const p = this.createPlayer({ id, name: finalName, isBot: false });
    this.emit('join', { playerId: id, name: finalName });
    if (!this.manualStart && this.phase === 'waiting') {
      this.startCountdown();
    } else if (this.phase === 'starting' || this.phase === 'playing') {
      this.spawnPickupNear('upgrade', p, 5);
      this.spawnMobsNear(p, 2);
    }
    return p;
  }

  removeHuman(id) {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    this.players.delete(id);
    this.emit('leave', { playerId: id, name: p.name });
    if (this.humanCount() === 0) {
      this.phase = 'waiting';
      this.countdown = 0;
      this.restartIn = 0;
      this.timeLeft = CONFIG.matchDuration;
      this.safeRadius = CONFIG.arenaRadius;
      this.zone = { x: 0, z: 0 };
      this.pickups = [];
      this.mobs = [];
      this.result = null;
      this.events = [];
    }
  }

  spawnBots(count) {
    for (let i = 0; i < count; i++) {
      const id = `b${++this.botSeq}`;
      this.createPlayer({
        id,
        name: BOT_NAMES[(i + 1) % BOT_NAMES.length],
        isBot: true,
        botStyle: rand(-1, 1),
      });
    }
  }

  findSpawn() {
    let best = { x: 0, z: 0 };
    let bestScore = -Infinity;
    const maxR = Math.max(2, Math.min(this.safeRadius - 1.6, 30));
    for (let i = 0; i < 16; i++) {
      const pt = randomPointInCircle(maxR);
      pt.x += this.zone.x;
      pt.z += this.zone.z;
      const arenaDist = Math.hypot(pt.x, pt.z);
      if (arenaDist > CONFIG.arenaRadius - 1.2) continue;
      let nearest = 99;
      for (const p of this.players.values()) {
        if (p.hp <= 0) continue;
        nearest = Math.min(nearest, dist(pt.x, pt.z, p.x, p.z));
      }
      const score = nearest + Math.random() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = pt;
      }
      if (nearest > 12) break;
    }
    return best;
  }

  recomputePower(p) {
    p.maxHp = Math.min(CONFIG.maxHpCap, CONFIG.baseHp + p.kills * 12);
    p.bladeRadius =
      2.25 + (p.bladeLevel - 1) * 0.24 + Math.min(0.5, p.kills * 0.022);
    p.bladeLength = 2.6 + (p.bladeLevel - 1) * 0.22;
    p.bladeSpeed = clamp(
      4.15 - (p.bladeRadius - 2.25) * 0.23 + p.bladeLevel * 0.025,
      2.8,
      5.2,
    );
    p.scale = 1 + Math.min(0.28, p.kills * 0.022 + (p.bladeLevel - 1) * 0.012);
    p.speed = (p.isBot ? 5.5 : CONFIG.baseSpeed) * (p.buffs.haste > 0 ? 1.34 : 1);
    if (p.hp > p.maxHp) p.hp = p.maxHp;
  }

  startCountdown() {
    this.matchId++;
    this.resetWorld();
    this.phase = 'starting';
    this.countdown = CONFIG.startCountdown;
    this.emit('roundCountdown', { seconds: this.countdown });
  }

  resetWorld() {
    this.timeLeft = CONFIG.matchDuration;
    this.safeRadius = CONFIG.arenaRadius;
    this.zone = { x: 0, z: 0 };
    const focusAngle = Math.random() * TAU;
    const focusRadius = rand(1.5, 4.4);
    this.zoneFocus = {
      x: Math.cos(focusAngle) * focusRadius,
      z: Math.sin(focusAngle) * focusRadius,
    };
    this.pickups = [];
    this.pickupTimer = 1.8;
    this.result = null;
    this.restartIn = 0;
    this.clashCooldowns.clear();
    this.breakCooldowns.clear();
    const usedNames = new Set();
    for (const p of this.players.values()) {
      if (!p.isBot) {
        const spawn = this.findSpawn();
        p.x = spawn.x;
        p.z = spawn.z;
      }
      p.hp = CONFIG.baseHp;
      p.maxHp = CONFIG.baseHp;
      p.kills = 0;
      p.deaths = 0;
      p.respawn = 0;
      p.invuln = 1.2;
      p.dashCd = 0;
      p.dashTime = 0;
      p.shieldHp = 0;
      p.bladeLossCd = 0;
      p.souls = 0;
      p.buffs = { haste: 0, rage: 0, shield: 0 };
      p.bladeAngle = Math.random() * TAU;
      p.bladeCount = CONFIG.startingBlades;
      p.bladeLevel = 1;
      p.hitCd.clear();
      p.mobHitCd.clear();
      p.lastAttacker = null;
      this.recomputePower(p);
      if (p.isBot) {
        const spawn = this.findSpawn();
        p.x = spawn.x;
        p.z = spawn.z;
      }
      if (usedNames.has(p.name)) p.name = `${p.name}Ⅱ`;
      usedNames.add(p.name);
    }
    this.spawnMobs();
    this.spawnInitialPickups();
    for (const p of this.players.values()) {
      if (!p.isBot) {
        this.spawnPickupNear('upgrade', p, 5.5, Math.random() < 0.2 ? 2 : 1);
      }
    }
  }

  spawnInitialPickups() {
    const opening = [
      ['upgrade', 1],
      ['blade', null],
      ['upgrade', 2],
      ['haste', null],
      ['rage', null],
      ['shield', null],
      ['blade', null],
      ['upgrade', 1],
      ['blade', null],
      ['haste', null],
    ];
    for (const [type, grade] of opening) {
      this.spawnPickup(type, { radius: 22, initial: true, grade });
    }
  }

  rollUpgradeGrade() {
    const hasHighGrade = this.pickups.some(
      (u) => u.type === 'upgrade' && (u.grade ?? 1) >= 2,
    );
    if (!hasHighGrade) return Math.random() < 0.22 ? 3 : 2;
    const elapsed = Math.max(0, CONFIG.matchDuration - this.timeLeft);
    const late = clamp(elapsed / CONFIG.matchDuration, 0, 1);
    const roll = Math.random();
    if (roll > 0.9 - late * 0.12) return 3;
    if (roll > 0.5 - late * 0.08) return 2;
    return 1;
  }

  pickupSpawnPoint(radius = null) {
    const spawnRadius = radius ?? Math.max(4, Math.min(this.safeRadius - 2, 34));
    for (let attempt = 0; attempt < 24; attempt++) {
      const pt = randomPointInCircle(spawnRadius);
      pt.x += this.zone.x;
      pt.z += this.zone.z;
      if (Math.hypot(pt.x, pt.z) > CONFIG.arenaRadius - 1.5) continue;
      if ([...this.players.values()].some((p) => dist(p.x, p.z, pt.x, pt.z) < 1.8)) continue;
      if (this.pickups.some((u) => dist(u.x, u.z, pt.x, pt.z) < 1.5)) continue;
      return pt;
    }
    return randomPointInCircle(Math.max(2, Math.min(this.safeRadius - 2, 12)));
  }

  spawnPickupNear(type, player, distance = 5, forcedGrade = null) {
    const radius = Math.min(distance, Math.max(2.2, this.safeRadius * 0.42));
    for (let attempt = 0; attempt < 12; attempt++) {
      const towardCenter = Math.atan2(this.zone.z - player.z, this.zone.x - player.x);
      const angle = towardCenter + rand(-1.1, 1.1);
      const r = radius * rand(0.7, 1);
      const x = player.x + Math.cos(angle) * r;
      const z = player.z + Math.sin(angle) * r;
      if (Math.hypot(x, z) > CONFIG.arenaRadius - 1.5) continue;
      if (this.pickups.some((u) => dist(u.x, u.z, x, z) < 1.2)) continue;
      const pickup = {
        id: `u${++this.pickupId}`,
        type,
        x: round(x, 2),
        z: round(z, 2),
        dropped: false,
      };
      if (type === 'upgrade') {
        pickup.grade = forcedGrade ?? (Math.random() < 0.2 ? 2 : 1);
      }
      this.pickups.push(pickup);
      return pickup;
    }
    return null;
  }

  spawnPickup(forcedType = null, options = {}) {
    if (this.pickups.length >= CONFIG.maxPickups && !options.dropped) return null;
    let type = forcedType;
    if (!type) {
      const hasUpgrade = this.pickups.some((u) => u.type === 'upgrade');
      type = !hasUpgrade && Math.random() < 0.8 ? 'upgrade' : randomPickupType();
    }
    const pt = this.pickupSpawnPoint(options.radius);
    const pickup = {
      id: `u${++this.pickupId}`,
      type,
      x: round(pt.x, 2),
      z: round(pt.z, 2),
      dropped: Boolean(options.dropped),
    };
    if (type === 'upgrade') {
      pickup.grade = options.grade ?? this.rollUpgradeGrade();
    }
    this.pickups.push(pickup);
    return pickup;
  }

  dropBladePickup(x, z, level = 1) {
    const r = Math.hypot(x, z);
    const limit = CONFIG.arenaRadius - 1.2;
    if (r > limit) {
      x = (x / r) * limit;
      z = (z / r) * limit;
    }
    const pickup = {
      id: `u${++this.pickupId}`,
      type: 'blade',
      x: round(x, 2),
      z: round(z, 2),
      level,
      dropped: true,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  grantKillGrowth(p) {
    const bladeStep = p.isBot ? 3 : 2;
    const levelStep = p.isBot ? 5 : 3;
    const bladeFloor = Math.min(
      CONFIG.maxBlades,
      CONFIG.startingBlades + Math.floor(p.kills / bladeStep),
    );
    const levelFloor = Math.min(
      CONFIG.maxBladeLevel,
      1 + Math.floor(p.kills / levelStep),
    );
    let changed = false;
    if (p.bladeCount < bladeFloor) {
      p.bladeCount = bladeFloor;
      changed = true;
    }
    if (p.bladeLevel < levelFloor) {
      p.bladeLevel = levelFloor;
      changed = true;
    }
    if (changed) this.recomputePower(p);
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || p.isBot || p.hp <= 0) return;
    let mx = Number(input.mx) || 0;
    let mz = Number(input.mz) || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    p.input.mx = mx;
    p.input.mz = mz;
    if (input.dash === true) p.input.dashQueued = true;
  }

  applyDamage(attacker, victim, amount, sourceX, sourceZ, kind = 'blade', sourceName = '毒雾') {
    if (victim.hp <= 0 || victim.invuln > 0) return;
    let remaining = amount;
    let absorbed = 0;
    if (victim.shieldHp > 0) {
      absorbed = Math.min(victim.shieldHp, remaining);
      victim.shieldHp -= absorbed;
      remaining -= absorbed;
      if (victim.shieldHp <= 0) {
        victim.shieldHp = 0;
        victim.buffs.shield = 0;
      }
    }
    if (remaining > 0) victim.hp -= remaining;
    const dx = victim.x - sourceX;
    const dz = victim.z - sourceZ;
    const d = Math.hypot(dx, dz) || 1;
    victim.x = clamp(victim.x + (dx / d) * 0.55, -CONFIG.arenaRadius + 0.6, CONFIG.arenaRadius - 0.6);
    victim.z = clamp(victim.z + (dz / d) * 0.55, -CONFIG.arenaRadius + 0.6, CONFIG.arenaRadius - 0.6);
    if (attacker) victim.lastAttacker = attacker.id;
    this.emit('hit', {
      x: round(victim.x),
      z: round(victim.z),
      dirX: round(dx / d, 3),
      dirZ: round(dz / d, 3),
      amount: round(remaining + absorbed),
      absorbed: round(absorbed),
      targetId: victim.id,
      attackerId: attacker?.id ?? null,
      attackerLevel: attacker?.bladeLevel ?? 1,
      kind,
    });

    if (victim.hp <= 0) this.killPlayer(victim, attacker, sourceName);
    else victim.invuln = Math.max(victim.invuln, 0.08);
  }

  killPlayer(victim, attacker, sourceName = '毒雾') {
    if (victim.hp > 0) victim.hp = 0;
    victim.deaths++;
    victim.respawn = 3.4;
    victim.dashTime = 0;
    victim.buffs = { haste: 0, rage: 0, shield: 0 };
    victim.shieldHp = 0;
    victim.hitCd.clear();
    if (attacker && attacker !== victim) {
      const beforeLevel = attacker.bladeLevel;
      const beforeBlades = attacker.bladeCount;
      attacker.kills++;
      this.grantKillGrowth(attacker);
      this.recomputePower(attacker);
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + 28);
      if (attacker.bladeLevel > beforeLevel || attacker.bladeCount > beforeBlades) {
        this.emit('powerUp', {
          playerId: attacker.id,
          name: attacker.name,
          bladeLevel: attacker.bladeLevel,
          bladeCount: attacker.bladeCount,
        });
      }
    }
    const killDx = attacker ? victim.x - attacker.x : 0;
    const killDz = attacker ? victim.z - attacker.z : 0;
    const killD = Math.hypot(killDx, killDz) || 1;
    this.emit('kill', {
      x: round(victim.x),
      z: round(victim.z),
      dirX: round(killDx / killD, 3),
      dirZ: round(killDz / killD, 3),
      killerId: attacker?.id ?? null,
      killerName: attacker?.name ?? sourceName,
      killerColor: attacker?.color ?? (sourceName === '刀傀' ? '#c084fc' : '#ff5c7a'),
      victimId: victim.id,
      victimName: victim.name,
      victimColor: victim.color,
      poison: !attacker && sourceName === '毒雾',
      source: attacker ? 'player' : sourceName === '刀傀' ? 'mob' : 'poison',
    });
  }

  respawnPlayer(p) {
    const spot = this.findSpawn();
    p.x = spot.x;
    p.z = spot.z;
    p.respawn = 0;
    p.hp = p.maxHp;
    p.invuln = 1.3;
    p.dashCd = 0;
    p.dashTime = 0;
    p.buffs = { haste: 0, rage: 0, shield: 0 };
    p.shieldHp = 0;
    p.bladeLossCd = 0;
    p.hitCd.clear();
    p.mobHitCd.clear();
    p.bladeAngle = Math.random() * TAU;
    this.emit('respawn', { playerId: p.id, x: round(p.x), z: round(p.z) });
  }

  createMob(x, z) {
    return {
      id: `m${++this.mobId}`,
      x,
      z,
      hp: CONFIG.mobHp,
      maxHp: CONFIG.mobHp,
      facing: rand(0, TAU),
      alive: true,
      respawn: 0,
      attackCd: 0,
      wanderAngle: rand(0, TAU),
      wanderTimer: rand(1.5, 4),
      radius: 0.42,
    };
  }

  findMobSpawn(minPlayerDistance = 10) {
    const reach = Math.max(3, Math.min(this.safeRadius - 2, CONFIG.arenaRadius - 3));
    for (let attempt = 0; attempt < 40; attempt++) {
      const pt = randomPointInCircle(reach);
      pt.x += this.zone.x;
      pt.z += this.zone.z;
      if (Math.hypot(pt.x, pt.z) > CONFIG.arenaRadius - 2) continue;
      let blocked = false;
      for (const p of this.players.values()) {
        if (p.hp > 0 && dist(pt.x, pt.z, p.x, p.z) < minPlayerDistance) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (this.mobs.some((m) => m.alive && dist(m.x, m.z, pt.x, pt.z) < 1.4)) continue;
      return pt;
    }
    return randomPointInCircle(Math.max(2, Math.min(this.safeRadius - 2, 12)));
  }

  spawnMobsNear(player, count) {
    for (let i = 0; i < count; i++) {
      let spawned = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const angle = rand(0, TAU);
        const reach = Math.min(11.5, Math.max(4, this.safeRadius * 0.55));
        const r = rand(Math.min(5.5, reach * 0.6), reach);
        const x = player.x + Math.cos(angle) * r;
        const z = player.z + Math.sin(angle) * r;
        if (Math.hypot(x, z) > CONFIG.arenaRadius - 2) continue;
        if (dist(x, z, this.zone.x, this.zone.z) > this.safeRadius - 1.4) continue;
        if (this.mobs.some((m) => m.alive && dist(m.x, m.z, x, z) < 1.4)) continue;
        this.mobs.push(this.createMob(x, z));
        spawned = true;
        break;
      }
      if (!spawned) {
        const pt = this.findMobSpawn(8);
        this.mobs.push(this.createMob(pt.x, pt.z));
      }
    }
  }

  spawnMobs() {
    this.mobs = [];
    const base = this.mobCount;
    for (let i = 0; i < base; i++) {
      const pt = this.findMobSpawn(11);
      this.mobs.push(this.createMob(pt.x, pt.z));
    }
    let extra = Math.min(24, this.humanCount() * 3);
    for (const p of this.players.values()) {
      if (p.isBot || extra <= 0) continue;
      const count = Math.min(3, extra);
      this.spawnMobsNear(p, count);
      extra -= count;
    }
  }

  respawnMob(mob) {
    const pt = this.findMobSpawn(10);
    mob.x = pt.x;
    mob.z = pt.z;
    mob.hp = mob.maxHp;
    mob.alive = true;
    mob.respawn = 0;
    mob.attackCd = 0;
    mob.wanderAngle = rand(0, TAU);
    mob.wanderTimer = rand(1.5, 4);
    mob.facing = rand(0, TAU);
  }

  updateMobs(dt) {
    for (const mob of this.mobs) {
      if (!mob.alive) {
        mob.respawn = Math.max(0, mob.respawn - dt);
        if (mob.respawn <= 0) this.respawnMob(mob);
        continue;
      }
      mob.attackCd = Math.max(0, mob.attackCd - dt);
      const zoneDist = dist(mob.x, mob.z, this.zone.x, this.zone.z);
      let target = null;
      let targetDist = Infinity;
      for (const p of this.players.values()) {
        if (p.hp <= 0) continue;
        const d = dist(mob.x, mob.z, p.x, p.z);
        if (d < CONFIG.mobAggro && d < targetDist) {
          target = p;
          targetDist = d;
        }
      }

      let directionX = Math.cos(mob.wanderAngle);
      let directionZ = Math.sin(mob.wanderAngle);
      let speed = CONFIG.mobSpeed * 0.55;

      if (zoneDist > this.safeRadius - 1.8 && !target) {
        directionX = this.zone.x - mob.x;
        directionZ = this.zone.z - mob.z;
        speed = CONFIG.mobSpeed * 1.25;
      } else if (target) {
        const dx = target.x - mob.x;
        const dz = target.z - mob.z;
        const radial = Math.hypot(dx, dz) || 1;
        if (targetDist < 1.8) {
          // Step back out of the blind spot inside the player's orbit.
          directionX = -dx;
          directionZ = -dz;
          speed = CONFIG.mobSpeed * 0.85;
        } else if (targetDist > 2.45) {
          directionX = dx;
          directionZ = dz;
          speed = CONFIG.mobSpeed * 1.15;
        } else {
          // Circle the blade ring while clawing at the player.
          const side = mob.id.charCodeAt(1) % 2 ? 1 : -1;
          directionX = (-dz / radial) * side;
          directionZ = (dx / radial) * side;
          speed = CONFIG.mobSpeed * 0.42;
        }
        if (targetDist < 2.3 && mob.attackCd <= 0) {
          mob.attackCd = CONFIG.mobAttackCd;
          this.applyDamage(null, target, CONFIG.mobDamage, mob.x, mob.z, 'mob', '刀傀');
        }
      } else {
        mob.wanderTimer -= dt;
        if (mob.wanderTimer <= 0) {
          mob.wanderAngle += rand(-1.6, 1.6);
          mob.wanderTimer = rand(2, 5);
          directionX = Math.cos(mob.wanderAngle);
          directionZ = Math.sin(mob.wanderAngle);
        }
        const nextX = mob.x + directionX * 2;
        const nextZ = mob.z + directionZ * 2;
        if (dist(nextX, nextZ, this.zone.x, this.zone.z) > this.safeRadius - 2) {
          directionX = this.zone.x - mob.x;
          directionZ = this.zone.z - mob.z;
        }
      }

      const length = Math.hypot(directionX, directionZ) || 1;
      const mx = directionX / length;
      const mz = directionZ / length;
      mob.x += mx * speed * dt;
      mob.z += mz * speed * dt;
      mob.facing = Math.atan2(mx, mz);
      const radius = Math.hypot(mob.x, mob.z);
      const limit = CONFIG.arenaRadius - 1.2;
      if (radius > limit) {
        mob.x = (mob.x / radius) * limit;
        mob.z = (mob.z / radius) * limit;
      }
    }
  }

  killMob(mob, attacker) {
    mob.alive = false;
    mob.hp = 0;
    mob.respawn = rand(5.5, 9.5);
    let bladeGained = false;
    let levelGained = false;
    if (attacker) {
      attacker.souls++;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + 6);
      if (attacker.souls % 4 === 0 && attacker.bladeCount < CONFIG.maxBlades) {
        attacker.bladeCount++;
        bladeGained = true;
      }
      if (attacker.souls % 8 === 0 && attacker.bladeLevel < CONFIG.maxBladeLevel) {
        attacker.bladeLevel++;
        levelGained = true;
      }
      if (bladeGained || levelGained) this.recomputePower(attacker);
      attacker.mobHitCd.delete(mob.id);
      this.emit('mobKill', {
        x: round(mob.x),
        z: round(mob.z),
        mobId: mob.id,
        playerId: attacker.id,
        playerName: attacker.name,
        color: attacker.color,
        souls: attacker.souls,
        soulProgress: attacker.souls % 4,
        bladeGained,
        levelGained,
        bladeCount: attacker.bladeCount,
        bladeLevel: attacker.bladeLevel,
      });
    } else {
      this.emit('mobKill', {
        x: round(mob.x),
        z: round(mob.z),
        mobId: mob.id,
        playerId: null,
      });
    }
  }

  resolveMobCombat(dt) {
    for (const attacker of this.players.values()) {
      if (attacker.hp <= 0) continue;
      for (const [mobId, cd] of attacker.mobHitCd) {
        const next = cd - dt;
        if (next <= 0) attacker.mobHitCd.delete(mobId);
        else attacker.mobHitCd.set(mobId, next);
      }
      for (const mob of this.mobs) {
        if (!mob.alive) continue;
        if (attacker.mobHitCd.has(mob.id)) continue;
        for (let i = 0; i < attacker.bladeCount; i++) {
          const blade = this.bladeSegment(attacker, i);
          if (
            pointSegmentDistance(mob.x, mob.z, blade.x1, blade.z1, blade.x2, blade.z2) <
            0.55
          ) {
            const damage =
              (9 + (attacker.bladeLevel - 1) * 2.5 + Math.min(5, attacker.kills * 0.2)) *
              (attacker.buffs.rage > 0 ? 1.5 : 1);
            mob.hp -= damage;
            attacker.mobHitCd.set(mob.id, 0.3);
            const mobDx = mob.x - attacker.x;
            const mobDz = mob.z - attacker.z;
            const mobD = Math.hypot(mobDx, mobDz) || 1;
            this.emit('mobHit', {
              x: round(mob.x),
              z: round(mob.z),
              dirX: round(mobDx / mobD, 3),
              dirZ: round(mobDz / mobD, 3),
              mobId: mob.id,
              playerId: attacker.id,
              damage: round(damage),
            });
            if (mob.hp <= 0) this.killMob(mob, attacker);
            break;
          }
        }
      }
    }
  }

  updateBots(dt) {
    for (const p of this.players.values()) {
      if (!p.isBot || p.hp <= 0) continue;
      p.input.mx = 0;
      p.input.mz = 0;
      const zoneDist = dist(p.x, p.z, this.zone.x, this.zone.z);
      let tx = p.x;
      let tz = p.z;
      let enemy = null;
      let pickup = null;
      let mode = 'roam';

      if (zoneDist > this.safeRadius - 1.4) {
        tx = this.zone.x;
        tz = this.zone.z;
        mode = 'zone';
      } else {
        let nearestPickup = null;
        let nearestPickupScore = 8.5;
        for (const u of this.pickups) {
          const d = dist(p.x, p.z, u.x, u.z);
          const priority =
            u.type === 'upgrade' ? 0.72 : u.type === 'blade' ? 0.88 : 1;
          const score = d * priority;
          if (d < 9 && score < nearestPickupScore) {
            nearestPickupScore = score;
            nearestPickup = u;
          }
        }
        const elapsed = CONFIG.matchDuration - this.timeLeft;
        const aggroRange = elapsed < 20 ? 0 : 15;
        let nearestEnemy = null;
        let nearestEnemyDist = Infinity;
        for (const q of this.players.values()) {
          if (q === p || q.hp <= 0) continue;
          const d = dist(p.x, p.z, q.x, q.z);
          if (d < aggroRange && d < nearestEnemyDist) {
            nearestEnemyDist = d;
            nearestEnemy = q;
          }
        }
        let nearestMob = null;
        let nearestMobDist = Infinity;
        for (const m of this.mobs) {
          if (!m.alive) continue;
          const d = dist(p.x, p.z, m.x, m.z);
          if (d < 10 && d < nearestMobDist) {
            nearestMobDist = d;
            nearestMob = m;
          }
        }
        if (
          nearestPickup &&
          (nearestEnemyDist > 4.5 ||
            dist(p.x, p.z, nearestPickup.x, nearestPickup.z) < 3)
        ) {
          pickup = nearestPickup;
          tx = pickup.x;
          tz = pickup.z;
          mode = 'pickup';
        } else if (nearestEnemy) {
          enemy = nearestEnemy;
          tx = enemy.x;
          tz = enemy.z;
          mode = 'hunt';
        } else if (nearestMob) {
          tx = nearestMob.x;
          tz = nearestMob.z;
          mode = 'farm';
        } else {
          p.roamTimer -= dt;
          if (p.roamTimer <= 0) {
            p.roamTimer = rand(4, 8);
            const angle = rand(0, TAU);
            const radius = rand(5, Math.max(8, Math.min(this.safeRadius - 5, 20)));
            p.roamX = this.zone.x + Math.cos(angle) * radius;
            p.roamZ = this.zone.z + Math.sin(angle) * radius;
          }
          tx = p.roamX;
          tz = p.roamZ;
          mode = 'roam';
        }
      }

      let mx = tx - p.x;
      let mz = tz - p.z;
      let d = Math.hypot(mx, mz) || 1;
      mx /= d;
      mz /= d;

      if (mode === 'hunt' && enemy) {
        const range = dist(p.x, p.z, enemy.x, enemy.z);
        if (range < 2.7) {
          const side = p.botStyle >= 0 ? 1 : -1;
          const keep = (range - 2.4) * 0.2;
          mx = -mz * side + mx * keep;
          mz = mx * side + mz * keep;
          const l = Math.hypot(mx, mz) || 1;
          mx = (mx / l) * 0.85;
          mz = (mz / l) * 0.85;
        } else if (range < 4.6 && p.dashCd <= 0 && Math.random() < dt * 0.9) {
          p.input.dashQueued = true;
        }
      }

      if (mode === 'zone') {
        if (zoneDist > 4 && p.dashCd <= 0 && Math.random() < dt * 1.4) p.input.dashQueued = true;
      }

      const edge = Math.hypot(p.x, p.z);
      if (edge > CONFIG.arenaRadius - 2) {
        mx += (-p.x / edge) * 0.85;
        mz += (-p.z / edge) * 0.85;
      }
      mx += Math.sin(this.tick * 0.03 + p.botStyle * 9) * 0.18;
      mz += Math.cos(this.tick * 0.027 + p.botStyle * 7) * 0.18;
      const l = Math.hypot(mx, mz) || 1;
      p.input.mx = mx / l;
      p.input.mz = mz / l;
    }
  }

  movePlayer(p, dt) {
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (p.input.dashQueued && p.dashCd <= 0) {
      p.input.dashQueued = false;
      let dx = p.input.mx;
      let dz = p.input.mz;
      if (!dx && !dz) {
        dx = Math.sin(p.facing);
        dz = Math.cos(p.facing);
      }
      const l = Math.hypot(dx, dz) || 1;
      p.dashDirX = dx / l;
      p.dashDirZ = dz / l;
      p.dashTime = CONFIG.dashDuration;
      p.dashCd = CONFIG.dashCooldown;
      p.invuln = Math.max(p.invuln, CONFIG.dashDuration + 0.06);
      this.emit('dash', { playerId: p.id, x: round(p.x), z: round(p.z) });
    }
    p.input.dashQueued = false;

    let vx;
    let vz;
    if (p.dashTime > 0) {
      vx = p.dashDirX * CONFIG.dashSpeed;
      vz = p.dashDirZ * CONFIG.dashSpeed;
    } else {
      vx = p.input.mx * p.speed;
      vz = p.input.mz * p.speed;
    }
    p.x += vx * dt;
    p.z += vz * dt;
    if (vx || vz) p.facing = Math.atan2(vx, vz);
    const r = Math.hypot(p.x, p.z);
    const maxRadius = CONFIG.arenaRadius - 0.68;
    if (r > maxRadius) {
      p.x = (p.x / r) * maxRadius;
      p.z = (p.z / r) * maxRadius;
    }
    p.bladeAngle = (p.bladeAngle + p.bladeSpeed * dt) % TAU;
  }

  resolvePlayerCollisions() {
    const alive = [...this.players.values()].filter((p) => p.hp > 0);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const minDist = 0.52 * a.scale + 0.52 * b.scale;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0 && d < minDist) {
          const push = (minDist - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }

  bladeOrbit(index, count) {
    const ring = index % 3;
    return {
      angleOffset: (ring - 1) * 0.045,
      radiusOffset: ring * 0.13,
    };
  }

  bladePosition(p, index) {
    const { angleOffset, radiusOffset } = this.bladeOrbit(index, p.bladeCount);
    const a = p.bladeAngle + (index * TAU) / p.bladeCount + angleOffset;
    const radius = p.bladeRadius + radiusOffset;
    return {
      x: p.x + Math.cos(a) * radius,
      z: p.z + Math.sin(a) * radius,
      angle: a,
      radius,
    };
  }

  bladeSegment(p, index) {
    const blade = this.bladePosition(p, index);
    const half = p.bladeLength * 0.45;
    const tx = -Math.sin(blade.angle);
    const tz = Math.cos(blade.angle);
    return {
      x1: blade.x - tx * half,
      z1: blade.z - tz * half,
      x2: blade.x + tx * half,
      z2: blade.z + tz * half,
      cx: blade.x,
      cz: blade.z,
      angle: blade.angle,
    };
  }

  tickCooldownMap(map, dt) {
    for (const [key, value] of map) {
      const next = value - dt;
      if (next <= 0) map.delete(key);
      else map.set(key, next);
    }
  }

  breakBlade(winner, loser, x, z) {
    loser.bladeLossCd = 2.1;
    let dropped = false;
    if (loser.bladeCount > 1) {
      loser.bladeCount = Math.max(1, loser.bladeCount - 1);
      this.dropBladePickup(
        x + rand(-0.55, 0.55),
        z + rand(-0.55, 0.55),
        loser.bladeLevel,
      );
      dropped = true;
    } else {
      const damage = 10 + winner.bladeLevel * 4;
      this.applyDamage(winner, loser, damage, winner.x, winner.z, 'clash');
    }
    const dx = loser.x - winner.x;
    const dz = loser.z - winner.z;
    const d = Math.hypot(dx, dz) || 1;
    loser.x = clamp(loser.x + (dx / d) * 0.6, -CONFIG.arenaRadius + 0.6, CONFIG.arenaRadius - 0.6);
    loser.z = clamp(loser.z + (dz / d) * 0.6, -CONFIG.arenaRadius + 0.6, CONFIG.arenaRadius - 0.6);
    this.emit('bladeBreak', {
      x: round(x),
      z: round(z),
      dirX: round(dx / d, 3),
      dirZ: round(dz / d, 3),
      attackerId: winner.id,
      attackerName: winner.name,
      attackerColor: winner.color,
      attackerLevel: winner.bladeLevel,
      victimId: loser.id,
      victimName: loser.name,
      victimColor: loser.color,
      victimLevel: loser.bladeLevel,
      remaining: loser.bladeCount,
      dropped,
    });
  }

  resolveBlades(dt) {
    const alive = [...this.players.values()].filter((p) => p.hp > 0);
    // Blade-to-blade collisions: equal tiers bounce, higher tiers strip a blade.
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if ((this.clashCooldowns.get(key) ?? 0) > 0) continue;
        let clash = null;
        for (let ai = 0; ai < a.bladeCount && !clash; ai++) {
          const sa = this.bladeSegment(a, ai);
          for (let bi = 0; bi < b.bladeCount; bi++) {
            const sb = this.bladeSegment(b, bi);
            if (segmentDistance(sa, sb) < 0.56) {
              clash = {
                x: (sa.cx + sb.cx) / 2,
                z: (sa.cz + sb.cz) / 2,
              };
              break;
            }
          }
        }
        if (!clash) continue;

        const levelDiff = a.bladeLevel - b.bladeLevel;
        const winner = levelDiff > 0 ? a : b;
        const loser = levelDiff > 0 ? b : a;
        const breakReady =
          levelDiff !== 0 &&
          (this.breakCooldowns.get(key) ?? 0) <= 0 &&
          loser.bladeLossCd <= 0;
        this.clashCooldowns.set(key, levelDiff === 0 ? 0.42 : 0.55);
        if (breakReady) {
          this.breakCooldowns.set(key, CONFIG.bladeBreakCooldown);
          this.breakBlade(winner, loser, clash.x, clash.z);
        } else {
          this.emit('clash', {
            x: round(clash.x),
            z: round(clash.z),
            a: a.id,
            b: b.id,
            aLevel: a.bladeLevel,
            bLevel: b.bladeLevel,
          });
        }
        a.bladeAngle += rand(-0.06, 0.06);
        b.bladeAngle += rand(-0.06, 0.06);
      }
    }
    this.tickCooldownMap(this.clashCooldowns, dt);
    this.tickCooldownMap(this.breakCooldowns, dt);

    for (const attacker of alive) {
      for (const [victimId, cd] of attacker.hitCd) {
        const next = cd - dt;
        if (next <= 0) attacker.hitCd.delete(victimId);
        else attacker.hitCd.set(victimId, next);
      }
      for (const victim of alive) {
        if (victim === attacker || victim.invuln > 0) continue;
        if (attacker.hitCd.has(victim.id)) continue;
        for (let i = 0; i < attacker.bladeCount; i++) {
          const blade = this.bladeSegment(attacker, i);
          const distance = pointSegmentDistance(
            victim.x,
            victim.z,
            blade.x1,
            blade.z1,
            blade.x2,
            blade.z2,
          );
          if (distance < 0.52 * victim.scale + 0.4) {
            let damage =
              (CONFIG.baseBladeDamage +
                (attacker.bladeLevel - 1) * 3.5 +
                Math.min(8, attacker.kills * 0.25)) *
              (attacker.buffs.rage > 0 ? 1.5 : 1);
            if (attacker.isBot && !victim.isBot) damage *= 0.6;
            attacker.hitCd.set(victim.id, CONFIG.hitCooldown);
            this.applyDamage(attacker, victim, damage, attacker.x, attacker.z, 'blade');
            break;
          }
        }
      }
    }
  }

  updatePickups(dt) {
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = rand(CONFIG.pickupIntervalMin, CONFIG.pickupIntervalMax);
      this.spawnPickup();
    }
    for (const p of this.players.values()) {
      if (p.hp <= 0) continue;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const u = this.pickups[i];
        if (dist(p.x, p.z, u.x, u.z) < 1.35 * p.scale) {
          this.pickups.splice(i, 1);
          let powerChanged = false;
          let bladeGained = false;
          let levelGained = false;
          if (u.type === 'upgrade') {
            const grade = u.grade ?? 1;
            const bladeAdd = grade >= 3 ? 2 : 1;
            const levelAdd = grade === 3 ? 2 : grade === 2 ? 1 : 0;
            const beforeBlades = p.bladeCount;
            const beforeLevel = p.bladeLevel;
            p.bladeCount = Math.min(CONFIG.maxBlades, p.bladeCount + bladeAdd);
            p.bladeLevel = Math.min(CONFIG.maxBladeLevel, p.bladeLevel + levelAdd);
            p.hp = Math.min(p.maxHp, p.hp + 8 + grade * 4);
            bladeGained = p.bladeCount > beforeBlades;
            levelGained = p.bladeLevel > beforeLevel;
            powerChanged = bladeGained || levelGained;
            this.pickupTimer = Math.min(this.pickupTimer, 1.1);
          } else if (u.type === 'blade') {
            const beforeBlades = p.bladeCount;
            p.bladeCount = Math.min(CONFIG.maxBlades, p.bladeCount + 1);
            bladeGained = p.bladeCount > beforeBlades;
            powerChanged = bladeGained;
          } else if (u.type === 'haste') {
            p.buffs.haste = 8;
          } else if (u.type === 'rage') {
            p.buffs.rage = 8;
          } else if (u.type === 'shield') {
            p.buffs.shield = 8;
            p.shieldHp = 40;
          }
          if (powerChanged) this.recomputePower(p);
          this.emit('pickup', {
            playerId: p.id,
            pickupType: u.type,
            grade: u.grade ?? null,
            bladeGained,
            levelGained,
            bladeLevel: p.bladeLevel,
            bladeCount: p.bladeCount,
            x: round(u.x),
            z: round(u.z),
          });
        }
      }
    }
  }

  updateBuffs(p, dt) {
    let changed = false;
    for (const key of ['haste', 'rage', 'shield']) {
      if (p.buffs[key] > 0) {
        p.buffs[key] = Math.max(0, p.buffs[key] - dt);
        changed = true;
      }
    }
    if (p.buffs.shield <= 0) p.shieldHp = 0;
    if (changed) this.recomputePower(p);
  }

  updateZone(dt) {
    const elapsed = CONFIG.matchDuration - this.timeLeft;
    const t = clamp((elapsed - CONFIG.zoneShrinkStart) / CONFIG.zoneShrinkDuration, 0, 1);
    this.zone.x = this.zoneFocus.x * t;
    this.zone.z = this.zoneFocus.z * t;
    this.safeRadius = CONFIG.arenaRadius + (CONFIG.finalZoneRadius - CONFIG.arenaRadius) * t;
    const poison = CONFIG.poisonDps + t * 4;
    for (const p of this.players.values()) {
      if (p.hp <= 0) continue;
      const d = dist(p.x, p.z, this.zone.x, this.zone.z);
      if (d > this.safeRadius + 0.15) {
        p.hp = Math.max(0, p.hp - poison * dt);
        if (p.hp <= 0) this.killPlayer(p, null);
      }
    }
  }

  endMatch() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.restartIn = CONFIG.restartDelay;
    const scores = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        isBot: p.isBot,
        color: p.color,
        bladeLevel: p.bladeLevel,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const winner = scores[0] ?? null;
    this.result = { winner, scores };
    this.emit('matchEnd', {
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? '无',
      kills: winner?.kills ?? 0,
      scores,
    });
  }

  update(dt) {
    dt = Math.min(dt, 0.06);
    this.tick++;
    if (this.phase === 'waiting') {
      this.pickups = [];
      this.mobs = [];
      return;
    }

    if (this.phase === 'starting') {
      this.countdown = Math.max(0, this.countdown - dt);
      for (const p of this.players.values()) {
        p.bladeAngle = (p.bladeAngle + p.bladeSpeed * dt) % TAU;
        p.invuln = Math.max(0, p.invuln - dt);
      }
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.emit('matchStart', { matchId: this.matchId });
      }
      return;
    }

    if (this.phase === 'ended') {
      this.restartIn = Math.max(0, this.restartIn - dt);
      for (const p of this.players.values()) {
        p.bladeAngle = (p.bladeAngle + p.bladeSpeed * dt) % TAU;
      }
      if (this.restartIn <= 0) {
        if (this.manualStart) {
          this.phase = 'waiting';
          this.result = null;
          this.countdown = 0;
          this.timeLeft = CONFIG.matchDuration;
          this.safeRadius = CONFIG.arenaRadius;
        } else if (this.humanCount() > 0) {
          this.startCountdown();
        } else {
          this.phase = 'waiting';
        }
      }
      return;
    }

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.updateZone(dt);
    this.updateBots(dt);

    for (const p of this.players.values()) {
      this.updateBuffs(p, dt);
      p.bladeLossCd = Math.max(0, p.bladeLossCd - dt);
      if (p.hp <= 0) {
        p.respawn = Math.max(0, p.respawn - dt);
        p.input.mx = 0;
        p.input.mz = 0;
        p.input.dashQueued = false;
        if (p.respawn <= 0) this.respawnPlayer(p);
      } else {
        this.movePlayer(p, dt);
      }
    }
    this.resolvePlayerCollisions();
    this.resolveBlades(dt);
    this.resolveMobCombat(dt);
    this.updateMobs(dt);
    this.updatePickups(dt);
    for (const p of this.players.values()) {
      if (p.hp <= 0 && p.respawn <= 0) this.respawnPlayer(p);
    }
    if (this.timeLeft <= 0) this.endMatch();
  }

  describePlayer(p) {
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      color: p.color,
      x: round(p.x),
      z: round(p.z),
      facing: round(p.facing, 3),
      hp: round(Math.max(0, p.hp), 1),
      maxHp: round(p.maxHp, 1),
      kills: p.kills,
      deaths: p.deaths,
      respawn: round(p.respawn, 2),
      invuln: round(p.invuln, 2),
      bladeAngle: round(p.bladeAngle, 3),
      bladeCount: p.bladeCount,
      bladeLevel: p.bladeLevel,
      bladeRadius: round(p.bladeRadius, 3),
      bladeLength: round(p.bladeLength, 3),
      bladeSpeed: round(p.bladeSpeed, 3),
      dashCd: round(p.dashCd, 2),
      speed: round(p.speed, 2),
      scale: round(p.scale, 3),
      shieldHp: round(p.shieldHp, 1),
      souls: p.souls,
      buffs: {
        haste: round(p.buffs.haste, 1),
        rage: round(p.buffs.rage, 1),
        shield: round(p.buffs.shield, 1),
      },
    };
  }

  takeSnapshot() {
    const snapshot = {
      tick: this.tick,
      match: {
        phase: this.phase,
        timeLeft: round(this.timeLeft, 2),
        countdown: round(this.countdown, 2),
        restartIn: round(this.restartIn, 2),
        safeRadius: round(this.safeRadius, 2),
        zoneX: round(this.zone.x, 2),
        zoneZ: round(this.zone.z, 2),
        humanCount: this.humanCount(),
        playerCount: this.players.size,
        result: this.result,
      },
      players: [...this.players.values()].map((p) => this.describePlayer(p)),
      mobs: this.mobs
        .filter((m) => m.alive)
        .map((m) => ({
          id: m.id,
          x: round(m.x),
          z: round(m.z),
          hp: round(Math.max(0, m.hp), 1),
          maxHp: m.maxHp,
          facing: round(m.facing, 2),
        })),
      pickups: this.pickups.map((u) => ({ ...u, x: round(u.x), z: round(u.z) })),
      events: this.events,
    };
    this.events = [];
    return snapshot;
  }
}

export { COLORS, PICKUP_TYPES };
