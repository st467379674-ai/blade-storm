import './style.css';
import { StormGame } from './game.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const startScreen = $('start-screen');
const endScreen = $('end-screen');
const disconnectScreen = $('disconnect-screen');
const hud = $('hud');
const joinForm = $('join-form');
const nicknameInput = $('nickname');
const joinBtn = $('join-btn');
const joinBtnText = joinBtn.querySelector('.join-btn-text');
const joinError = $('join-error');
const onlineLabel = $('online-label');
const onlineCount = $('online-count');
const arenaStatus = $('arena-status');
const arenaMeta = $('arena-meta');
const pingEl = $('ping');
const phaseLabel = $('phase-label');
const timerEl = $('timer');
const clockEl = document.querySelector('.match-clock');
const zoneProgress = $('zone-progress');
const humanCount = $('human-count');
const scoreList = $('score-list');
const selfName = $('self-name');
const hpText = $('hp-text');
const healthFill = $('health-fill');
const healthGhost = $('health-ghost');
const soulFill = $('soul-fill');
const soulCount = $('soul-count');
const dashFill = $('dash-fill');
const dashBtn = $('dash-btn');
const powerLabel = $('power-label');
const powerPips = $('power-pips');
const buffRow = $('buff-row');
const respawnCard = $('respawn-card');
const respawnCountdown = $('respawn-countdown');
const countdownBanner = $('countdown-banner');
const countdownNumber = $('countdown-number');
const zoneBanner = $('zone-banner');
const killFeed = $('kill-feed');
const toastEl = $('toast');
const damageFlash = $('damage-flash');
const poisonOverlay = $('poison-overlay');
const muteBtn = $('mute-btn');
const resultWinner = $('result-winner');
const resultKills = $('result-kills');
const resultScores = $('result-scores');
const restartCountdown = $('restart-countdown');
const disconnectReason = $('disconnect-reason');
const reconnectBtn = $('reconnect-btn');
const radar = $('radar');
const radarCtx = radar.getContext('2d');

const TIER_COLORS = ['#46ff9b', '#3ee8ff', '#7c8cff', '#c56dff', '#ff9f43', '#ff4d6d'];
const MAX_BLADES = 12;

const sound = new Sound();
const input = new Input();
let game;
try {
  game = new StormGame($('game-root'));
} catch (error) {
  console.error(error);
  joinError.textContent = '当前浏览器无法创建 3D 场景，请开启 WebGL 后重试。';
  joinBtn.disabled = true;
}

let net = null;
let selfId = null;
let joined = false;
let joining = false;
let latest = null;
let serverConfig = {
  matchDuration: 180,
  arenaRadius: 40,
  maxHumans: 10,
  maxBlades: MAX_BLADES,
  maxBladeLevel: 6,
  zoneShrinkStart: 45,
  zoneShrinkDuration: 130,
};
let connectionTimer = null;
let lastSend = 0;
let pendingDash = false;
let hudAccumulator = 0;
let radarAccumulator = 0;
let lastScoreSignature = '';
let lastBuffSignature = '';
let flashTimer = null;
let toastTimer = null;
let endVisible = false;
let lastFrame = performance.now();

try {
  const saved = localStorage.getItem('blade-storm-name');
  nicknameInput.value = saved || `刀客${Math.floor(100 + Math.random() * 900)}`;
} catch {
  nicknameInput.value = `刀客${Math.floor(100 + Math.random() * 900)}`;
}

for (let i = 0; i < MAX_BLADES; i++) {
  const pip = document.createElement('i');
  powerPips.appendChild(pip);
}

function formatClock(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function selfPlayer() {
  if (!latest) return null;
  return latest.players.find((p) => p.id === selfId) ?? null;
}

async function refreshStatus() {
  if (joined) return;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('status');
    const data = await response.json();
    const phaseText = {
      waiting: '等待挑战者',
      starting: '对决即将开始',
      playing: '台上激战',
      ended: '本场结算',
    }[data.phase] ?? '夜色沉沉';
    onlineLabel.textContent = data.online > 0 ? `${data.online} 名刀客在线` : '擂台待机 · 可单人挑战';
    onlineCount.textContent = data.online;
    arenaStatus.textContent = phaseText;
    arenaMeta.textContent = `${data.bots} 名陪练就位 · 最多 ${serverConfig.maxHumans} 人同场`;
    document.querySelectorAll('.status-dot').forEach((dot) => dot.classList.remove('offline'));
  } catch {
    onlineLabel.textContent = '擂台信号中断';
    onlineCount.textContent = '--';
    arenaStatus.textContent = '无法连接';
    arenaMeta.textContent = '请确认游戏服务器正在运行';
    document.querySelectorAll('.status-dot').forEach((dot) => dot.classList.add('offline'));
  }
}

function setJoinLoading(loading, text = '踏入刀阵') {
  joinBtn.disabled = loading;
  joinBtnText.textContent = loading ? '正在入场' : text;
}

function startJoin(event) {
  event?.preventDefault();
  if (joining || joined || !game) return;
  joining = true;
  sound.ensure();
  sound.ui();
  joinError.textContent = '';
  const name = nicknameInput.value.trim().slice(0, 12) || '无名刀客';
  try {
    localStorage.setItem('blade-storm-name', name);
  } catch {
    /* storage is optional */
  }
  setJoinLoading(true);

  net = new Net();
  net.onWelcome = (msg) => {
    clearTimeout(connectionTimer);
    connectionTimer = null;
    joining = false;
    joined = true;
    selfId = msg.id;
    serverConfig = { ...serverConfig, ...(msg.config ?? {}) };
    latest = msg.snapshot;
    game.setLocalId(selfId);
    game.setState(latest);
    game.handleEvents(msg.events ?? []);
    enterMatch();
  };
  net.onState = (snapshot) => {
    latest = snapshot;
    game.setState(snapshot);
    game.handleEvents(snapshot.events ?? []);
    handleEvents(snapshot.events ?? []);
    syncPhaseScreens();
  };
  net.onError = (message) => {
    if (joined) {
      showToast(message, 2200);
    } else {
      joining = false;
      clearTimeout(connectionTimer);
      connectionTimer = null;
      setJoinLoading(false);
      joinError.textContent = message;
      net?.close();
    }
  };
  net.onPing = (ms) => {
    pingEl.textContent = `${ms} ms`;
  };
  net.onClose = ({ manual }) => {
    clearTimeout(connectionTimer);
    connectionTimer = null;
    if (joined && !manual) {
      joined = false;
      input.setEnabled(false);
      input.setTouchActive(false);
      showDisconnect('与擂台的连接已断开。');
    } else if (!joined) {
      joining = false;
      setJoinLoading(false);
      if (!joinError.textContent) joinError.textContent = '未能进入擂台，请稍后重试';
    }
  };
  net.connect(name);

  connectionTimer = setTimeout(() => {
    if (joined) return;
    joining = false;
    setJoinLoading(false);
    joinError.textContent = '连接超时，请确认服务器已启动';
    net?.close();
  }, 9000);
}

function enterMatch() {
  if (!latest) return;
  const self = selfPlayer();
  if (self) selfName.textContent = self.name;
  startScreen.classList.add('leaving');
  setTimeout(() => startScreen.classList.add('hidden'), 520);
  hud.classList.add('visible');
  input.setEnabled(true);
  input.setTouchActive(true);
  document.body.classList.add('in-match');
  updateHud(true);
  drawRadar();
  syncPhaseScreens();
  sound.join();
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'hit') {
      const self = selfPlayer();
      if (e.targetId === selfId) {
        flashDamage(false);
        sound.hit(1);
      } else if (e.attackerId === selfId) {
        sound.hit(0.65);
      } else if (self && distance(self.x, self.z, e.x, e.z) < 7) {
        sound.hit(0.24);
      }
    } else if (e.type === 'clash') {
      const self = selfPlayer();
      if (self && distance(self.x, self.z, e.x, e.z) < 10) sound.clash();
    } else if (e.type === 'bladeBreak') {
      addBladeBreakFeed(e);
      const self = selfPlayer();
      if (e.victimId === selfId) {
        flashDamage(true);
        sound.bladeBreak();
        showToast(
          e.dropped ? '刀片被击落 · 捡回可恢复' : '最后一刀挡下冲击 · 受到反噬',
          1900,
        );
      } else if (e.attackerId === selfId) {
        sound.bladeBreak();
        showToast(`击落「${e.victimName}」的刀片`, 1400);
      } else if (self && distance(self.x, self.z, e.x, e.z) < 12) {
        sound.bladeBreak();
      }
    } else if (e.type === 'powerUp') {
      if (e.playerId === selfId) {
        showToast(`刃阶提升至 +${e.bladeLevel} · ${e.bladeCount} 刃`, 1600);
        sound.pickup();
      }
    } else if (e.type === 'kill') {
      addKillFeed(e);
      if (e.victimId === selfId) {
        flashDamage(true);
        sound.death();
        showToast(`你被「${e.killerName}」击倒`, 1800);
      } else if (e.killerId === selfId) {
        sound.kill();
        showToast('猎杀成功 · 刀势增长', 1300);
      } else {
        const self = selfPlayer();
        if (self && distance(self.x, self.z, e.x, e.z) < 10) sound.kill();
      }
    } else if (e.type === 'pickup') {
      if (e.playerId === selfId) {
        const gradeLabel = ['青锻 · 刀刃 +1', '蓝锻 · 刃阶 +1 / 刀刃 +1', '紫锻 · 刃阶 +2 / 刀刃 +2'];
        const label =
          e.pickupType === 'upgrade'
            ? gradeLabel[(e.grade ?? 1) - 1]
            : {
                blade: '刀片 · 刀刃 +1',
                haste: '疾风',
                rage: '锋锐',
                shield: '护体',
              }[e.pickupType] ?? '强化';
        showToast(`获得「${label}」`, 1500);
        sound.pickup();
      }
    } else if (e.type === 'mobHit') {
      if (e.playerId === selfId) sound.hit(0.22);
    } else if (e.type === 'mobKill') {
      if (e.playerId === selfId) {
        if (e.levelGained || e.bladeGained) {
          const gain = [e.levelGained ? '刃阶 +1' : '', e.bladeGained ? '刀刃 +1' : '']
            .filter(Boolean)
            .join(' / ');
          showToast(`刀魂突破 · ${gain}`, 1500);
          sound.pickup();
        } else {
          sound.hit(0.35);
        }
      }
    } else if (e.type === 'dash') {
      if (e.playerId === selfId) sound.dash();
    } else if (e.type === 'join') {
      if (e.playerId !== selfId) addSystemFeed(`「${e.name}」踏入擂台`);
    } else if (e.type === 'leave') {
      if (e.playerId !== selfId) addSystemFeed(`「${e.name}」离开擂台`);
    } else if (e.type === 'matchStart') {
      endScreen.classList.add('hidden');
      endVisible = false;
      showToast('对决开始 · 活下去', 1600);
    } else if (e.type === 'matchEnd') {
      showResult(e);
    }
  }
}

function flashDamage(strong) {
  damageFlash.classList.add('on');
  if (strong) damageFlash.style.opacity = '1';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    damageFlash.classList.remove('on');
    damageFlash.style.opacity = '';
  }, strong ? 260 : 110);
  if (navigator.vibrate && strong) navigator.vibrate(35);
}

function showToast(text, duration = 1600) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function addKillFeed(event) {
  const killer = document.createElement('span');
  killer.className = 'feed-name';
  killer.textContent = event.killerName;
  killer.style.color = event.killerColor;
  const mark = document.createElement('b');
  mark.textContent = event.poison ? '吞噬' : '猎杀';
  const victim = document.createElement('span');
  victim.className = 'feed-name';
  victim.textContent = event.victimName;
  victim.style.color = event.victimColor;
  const line = document.createElement('div');
  line.className = 'feed-line';
  line.append(killer, mark, victim);
  killFeed.appendChild(line);
  while (killFeed.children.length > 5) killFeed.removeChild(killFeed.firstChild);
  setTimeout(() => {
    line.classList.add('fade');
    setTimeout(() => line.remove(), 650);
  }, 5200);
}

function addBladeBreakFeed(event) {
  const attacker = document.createElement('span');
  attacker.className = 'feed-name';
  attacker.textContent = `${event.attackerName} +${event.attackerLevel}`;
  attacker.style.color = event.attackerColor;
  const mark = document.createElement('b');
  mark.textContent = event.dropped ? '击落' : '震退';
  const victim = document.createElement('span');
  victim.className = 'feed-name';
  victim.textContent = `${event.victimName} +${event.victimLevel}`;
  victim.style.color = event.victimColor;
  const detail = document.createElement('span');
  detail.className = 'feed-detail';
  detail.textContent = event.dropped ? `剩 ${event.remaining} 刃` : '最后一刃';
  const line = document.createElement('div');
  line.className = 'feed-line blade-break';
  line.append(attacker, mark, victim, detail);
  killFeed.appendChild(line);
  while (killFeed.children.length > 5) killFeed.removeChild(killFeed.firstChild);
  setTimeout(() => {
    line.classList.add('fade');
    setTimeout(() => line.remove(), 650);
  }, 5600);
}

function addSystemFeed(text) {
  const line = document.createElement('div');
  line.className = 'feed-line system';
  line.textContent = text;
  killFeed.appendChild(line);
  while (killFeed.children.length > 5) killFeed.removeChild(killFeed.firstChild);
  setTimeout(() => {
    line.classList.add('fade');
    setTimeout(() => line.remove(), 650);
  }, 4600);
}

function syncPhaseScreens() {
  if (!latest) return;
  const phase = latest.match.phase;
  if (phase === 'ended') {
    if (latest.match.result && !endVisible) {
      showResult({ ...latest.match.result, scores: latest.match.result.scores });
    }
  } else {
    endScreen.classList.add('hidden');
    endVisible = false;
  }
  if (phase === 'starting' || phase === 'playing') {
    respawnCard.classList.remove('show');
  }
}

function showResult(event) {
  if (!event) return;
  const scores = event.scores ?? latest?.match?.result?.scores ?? [];
  const winner = event.winner ?? scores[0] ?? null;
  const winnerName = event.winnerName ?? winner?.name ?? '无人';
  const winnerKills = event.kills ?? winner?.kills ?? 0;
  resultWinner.textContent = winnerName;
  resultKills.textContent = winnerKills;
  resultScores.innerHTML = '';
  scores.slice(0, 6).forEach((p, index) => {
    const li = document.createElement('li');
    if (p.id === selfId) li.classList.add('self');
    const rank = document.createElement('span');
    rank.textContent = String(index + 1).padStart(2, '0');
    const dot = document.createElement('span');
    dot.className = 'score-dot';
    dot.style.background = p.color;
    dot.style.color = p.color;
    const name = document.createElement('span');
    name.textContent = p.name + (p.isBot ? ' · AI' : '');
    if (p.bladeLevel) {
      const level = document.createElement('em');
      level.textContent = ` +${p.bladeLevel}`;
      level.style.color = TIER_COLORS[p.bladeLevel - 1] ?? TIER_COLORS[0];
      level.style.fontStyle = 'normal';
      name.appendChild(level);
    }
    const score = document.createElement('b');
    score.textContent = `${p.kills} / ${p.deaths}`;
    li.append(rank, dot, name, score);
    resultScores.appendChild(li);
  });
  endScreen.classList.remove('hidden');
  endVisible = true;
}

function showDisconnect(reason) {
  if (document.body.classList.contains('in-match')) {
    disconnectReason.textContent = reason || '连接已断开，请重新进入刀阵。';
    disconnectScreen.classList.remove('hidden');
  }
  input.setTouchActive(false);
}

function updateHud(force = false) {
  if (!latest) return;
  const self = selfPlayer();
  const match = latest.match;
  if (self) selfName.textContent = self.name;

  const phase = match.phase;
  phaseLabel.textContent = {
    waiting: '等待',
    starting: '备战',
    playing: '对决',
    ended: '终局',
  }[phase] ?? '对决';
  let clockValue = match.timeLeft;
  if (phase === 'starting') clockValue = match.countdown;
  if (phase === 'ended') clockValue = 0;
  timerEl.textContent = phase === 'waiting' ? '--:--' : formatClock(clockValue);
  clockEl.classList.toggle('danger', phase === 'playing' && match.timeLeft < 30);

  const elapsed = Math.max(0, serverConfig.matchDuration - match.timeLeft);
  const shrink = Math.max(
    0,
    Math.min(
      1,
      (elapsed - serverConfig.zoneShrinkStart) / serverConfig.zoneShrinkDuration,
    ),
  );
  zoneProgress.style.width = `${Math.round(shrink * 100)}%`;
  humanCount.textContent = match.humanCount ?? 0;

  const countdownVisible = phase === 'starting' && match.countdown > 0;
  countdownBanner.classList.toggle('show', countdownVisible);
  if (countdownVisible) countdownNumber.textContent = Math.max(1, Math.ceil(match.countdown));

  const sorted = [...latest.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const scoreSignature =
    sorted
      .map((p) => `${p.id}:${p.kills}:${p.deaths}:${p.hp <= 0}:${p.bladeLevel}:${p.bladeCount}`)
      .join('|') + `:${selfId}`;
  if (force || scoreSignature !== lastScoreSignature) {
    lastScoreSignature = scoreSignature;
    scoreList.innerHTML = '';
    sorted.forEach((p, index) => {
      const li = document.createElement('li');
      li.className = `score-row${p.id === selfId ? ' self' : ''}`;
      const rank = document.createElement('span');
      rank.className = 'score-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const dot = document.createElement('span');
      dot.className = 'score-dot';
      dot.style.background = p.color;
      dot.style.color = p.color;
      const name = document.createElement('span');
      name.className = 'score-name';
      name.textContent = p.isBot ? `${p.name} · AI` : p.name;
      const level = document.createElement('em');
      level.className = 'score-level';
      level.textContent = `+${p.bladeLevel ?? 1}`;
      level.style.color = TIER_COLORS[(p.bladeLevel ?? 1) - 1] ?? TIER_COLORS[0];
      name.appendChild(level);
      const kd = document.createElement('span');
      kd.className = 'score-kd';
      kd.innerHTML = `${p.kills}<small>/${p.deaths}</small>`;
      li.append(rank, dot, name, kd);
      scoreList.appendChild(li);
    });
  }

  if (self) {
    const ratio = Math.max(0, Math.min(1, self.hp / self.maxHp));
    healthFill.style.transform = `scaleX(${ratio})`;
    healthGhost.style.transform = `scaleX(${ratio})`;
    healthFill.classList.toggle('low', ratio < 0.3);
    hpText.textContent = `${Math.ceil(self.hp)} / ${Math.ceil(self.maxHp)}`;
    const soulProgress = (self.souls ?? 0) % 4;
    soulCount.textContent = `${soulProgress} / 4`;
    soulFill.style.width = `${(soulProgress / 4) * 100}%`;
    const dashReady = Math.max(0, Math.min(1, 1 - self.dashCd / 2.7));
    dashFill.style.transform = `scaleX(${dashReady})`;
    dashBtn?.classList.toggle('cooldown', dashReady < 0.98);

    const tierColor = TIER_COLORS[(self.bladeLevel ?? 1) - 1] ?? TIER_COLORS[0];
    powerLabel.textContent = `+${self.bladeLevel ?? 1} 阶 · ${self.bladeCount} 刃`;
    powerPips.style.setProperty('--tier-color', tierColor);
    [...powerPips.children].forEach((pip, index) => {
      pip.classList.toggle('on', index < self.bladeCount);
    });

    const buffs = [];
    for (const key of ['haste', 'rage', 'shield']) {
      if (self.buffs[key] > 0) buffs.push(`${key}:${Math.ceil(self.buffs[key])}`);
    }
    const buffSignature = buffs.join('|');
    if (buffSignature !== lastBuffSignature) {
      lastBuffSignature = buffSignature;
      buffRow.innerHTML = '';
      const meta = {
        haste: { label: '疾风', className: 'haste' },
        rage: { label: '锋锐', className: 'rage' },
        shield: { label: '护体', className: 'shield' },
      };
      for (const item of buffs) {
        const [key, seconds] = item.split(':');
        const chip = document.createElement('span');
        chip.className = `buff-chip ${meta[key].className}`;
        const dot = document.createElement('i');
        const text = document.createElement('em');
        text.textContent = meta[key].label;
        const time = document.createElement('span');
        time.textContent = `${seconds}s`;
        chip.append(dot, text, time);
        buffRow.appendChild(chip);
      }
    }

    const outside =
      phase === 'playing' &&
      distance(self.x, self.z, match.zoneX, match.zoneZ) > match.safeRadius;
    poisonOverlay.classList.toggle('active', outside);
    if (outside) {
      zoneBanner.querySelector('span:last-child').textContent = '你已进入毒雾 · 持续掉血';
      zoneBanner.classList.add('show');
    } else if (phase === 'playing' && shrink > 0 && shrink < 1 && match.timeLeft > serverConfig.matchDuration - 55) {
      zoneBanner.querySelector('span:last-child').textContent = `毒雾正在收缩 · 安全区半径 ${match.safeRadius.toFixed(1)}`;
      zoneBanner.classList.add('show');
    } else {
      zoneBanner.classList.remove('show');
    }

    const showRespawn = self.hp <= 0 && phase === 'playing';
    respawnCard.classList.toggle('show', showRespawn);
    if (showRespawn) respawnCountdown.textContent = Math.max(0, self.respawn).toFixed(1);
  } else {
    respawnCard.classList.remove('show');
    poisonOverlay.classList.remove('active');
    zoneBanner.classList.remove('show');
  }

  if (phase === 'ended' && match.result) {
    resultKills.textContent = match.result.winner?.kills ?? 0;
    restartCountdown.textContent = Math.ceil(match.restartIn);
    if (!endVisible) {
      showResult({ ...match.result, winner: match.result.winner, scores: match.result.scores });
    }
  } else if (phase !== 'ended') {
    endScreen.classList.add('hidden');
    endVisible = false;
  }
}

function drawRadar() {
  if (!latest) return;
  const w = radar.width;
  const h = radar.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = 140;
  const scale = radius / serverConfig.arenaRadius;
  const match = latest.match;
  radarCtx.clearRect(0, 0, w, h);
  radarCtx.save();
  radarCtx.translate(cx, cy);

  radarCtx.beginPath();
  radarCtx.arc(0, 0, radius, 0, Math.PI * 2);
  radarCtx.fillStyle = 'rgba(9, 28, 29, 0.58)';
  radarCtx.fill();
  radarCtx.strokeStyle = 'rgba(141, 224, 212, 0.28)';
  radarCtx.lineWidth = 2;
  radarCtx.stroke();

  for (let r = 40; r < radius; r += 44) {
    radarCtx.beginPath();
    radarCtx.arc(0, 0, r, 0, Math.PI * 2);
    radarCtx.strokeStyle = 'rgba(121, 206, 194, 0.08)';
    radarCtx.lineWidth = 1;
    radarCtx.stroke();
  }
  radarCtx.beginPath();
  radarCtx.moveTo(-radius, 0);
  radarCtx.lineTo(radius, 0);
  radarCtx.moveTo(0, -radius);
  radarCtx.lineTo(0, radius);
  radarCtx.strokeStyle = 'rgba(121, 206, 194, 0.06)';
  radarCtx.stroke();

  // Shade everything outside the safe circle.
  const sx = match.zoneX * scale;
  const sz = match.zoneZ * scale;
  const safe = match.safeRadius * scale;
  radarCtx.save();
  radarCtx.beginPath();
  radarCtx.rect(-radius, -radius, radius * 2, radius * 2);
  radarCtx.arc(sx, sz, safe, 0, Math.PI * 2, true);
  radarCtx.fillStyle = 'rgba(255, 57, 102, 0.15)';
  radarCtx.fill('evenodd');
  radarCtx.restore();
  radarCtx.beginPath();
  radarCtx.arc(sx, sz, safe, 0, Math.PI * 2);
  radarCtx.strokeStyle = 'rgba(255, 78, 112, 0.82)';
  radarCtx.lineWidth = 2;
  radarCtx.setLineDash([7, 5]);
  radarCtx.stroke();
  radarCtx.setLineDash([]);

  for (const u of latest.pickups) {
    const gradeColors = ['#46ff9b', '#3ee8ff', '#c56dff'];
    const color =
      u.type === 'upgrade'
        ? gradeColors[(u.grade ?? 1) - 1] ?? gradeColors[0]
        : u.type === 'blade'
          ? '#9dffcf'
          : u.type === 'haste'
            ? '#ffd166'
            : u.type === 'rage'
              ? '#ff5c7a'
              : '#64d2ff';
    radarCtx.beginPath();
    radarCtx.arc(u.x * scale, u.z * scale, u.type === 'upgrade' ? 4.8 : 4.2, 0, Math.PI * 2);
    radarCtx.fillStyle = color;
    radarCtx.globalAlpha = 0.9;
    radarCtx.fill();
    radarCtx.globalAlpha = 1;
  }

  const radarSelf = latest.players.find((p) => p.id === selfId);
  if (latest.mobs && radarSelf) {
    radarCtx.fillStyle = '#b06cff';
    for (const mob of latest.mobs) {
      if (distance(mob.x, mob.z, radarSelf.x, radarSelf.z) > 24) continue;
      radarCtx.globalAlpha = 0.5;
      radarCtx.beginPath();
      radarCtx.arc(mob.x * scale, mob.z * scale, 1.7, 0, Math.PI * 2);
      radarCtx.fill();
    }
    radarCtx.globalAlpha = 1;
  }

  const sorted = [...latest.players].sort((a, b) => (a.id === selfId ? 1 : b.id === selfId ? -1 : 0));
  for (const p of sorted) {
    if (p.hp <= 0) continue;
    const x = p.x * scale;
    const y = p.z * scale;
    if (p.id === selfId) {
      radarCtx.save();
      radarCtx.translate(x, y);
      radarCtx.rotate(Math.PI - p.facing);
      radarCtx.beginPath();
      radarCtx.moveTo(0, -8);
      radarCtx.lineTo(6, 6);
      radarCtx.lineTo(0, 3);
      radarCtx.lineTo(-6, 6);
      radarCtx.closePath();
      radarCtx.fillStyle = '#cffff6';
      radarCtx.shadowColor = '#5eead4';
      radarCtx.shadowBlur = 12;
      radarCtx.fill();
      radarCtx.restore();
      radarCtx.beginPath();
      radarCtx.arc(x, y, 12, 0, Math.PI * 2);
      radarCtx.strokeStyle = 'rgba(94, 234, 212, 0.34)';
      radarCtx.lineWidth = 1.5;
      radarCtx.stroke();
    } else {
      radarCtx.beginPath();
      radarCtx.arc(x, y, p.isBot ? 4.3 : 5.3, 0, Math.PI * 2);
      radarCtx.fillStyle = p.color;
      radarCtx.globalAlpha = p.isBot ? 0.62 : 0.95;
      radarCtx.shadowColor = p.color;
      radarCtx.shadowBlur = 8;
      radarCtx.fill();
      radarCtx.globalAlpha = 1;
      radarCtx.shadowBlur = 0;
    }
  }
  radarCtx.restore();
}

function toggleMute() {
  const muted = sound.toggleMuted();
  muteBtn.classList.toggle('muted', muted);
  muteBtn.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
  if (!muted) sound.ui();
}

joinForm.addEventListener('submit', startJoin);
muteBtn.addEventListener('click', toggleMute);
reconnectBtn.addEventListener('click', () => location.reload());
window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (event.code === 'KeyM' && tag !== 'INPUT' && (joined || !joining)) toggleMute();
});
window.addEventListener('beforeunload', () => net?.close());

if (sound.muted) muteBtn.classList.add('muted');

refreshStatus();
setInterval(refreshStatus, 6000);

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  if (!game) {
    requestAnimationFrame(frame);
    return;
  }

  if (joined && net) {
    const axes = input.getAxes();
    const dash = input.consumeDash();
    game.setInput(axes, dash);
    if (dash) pendingDash = true;
    if (now - lastSend >= 32) {
      net.sendInput(axes.x, axes.z, pendingDash);
      pendingDash = false;
      lastSend = now;
    }
  }

  game.update(dt);

  hudAccumulator += dt;
  if (joined && hudAccumulator > 0.08) {
    hudAccumulator = 0;
    updateHud();
  }
  radarAccumulator += dt;
  if (joined && radarAccumulator > 0.1) {
    radarAccumulator = 0;
    drawRadar();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
