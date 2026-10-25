import { Game, CONFIG } from './game.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

class Room {
  constructor(code, options) {
    this.code = code;
    this.createdAt = Date.now();
    this.clients = new Map();
    this.hostId = null;
    this.game = new Game({
      botCount: options.botCount,
      mobCount: options.mobCount,
      manualStart: true,
    });
  }

  info() {
    return {
      code: this.code,
      hostId: this.hostId,
      maxHumans: CONFIG.maxHumans,
      botCount: this.game.botCount(),
    };
  }

  humanCount() {
    return this.game.humanCount();
  }

  addHuman(name, ws) {
    const player = this.game.addHuman(name);
    if (!player) return null;
    this.clients.set(player.id, ws);
    if (!this.hostId || !this.clients.has(this.hostId)) this.hostId = player.id;
    return player;
  }

  removeHuman(playerId) {
    const player = this.game.players.get(playerId);
    if (!player || player.isBot) return false;
    this.clients.delete(playerId);
    this.game.removeHuman(playerId);
    if (this.hostId === playerId) {
      this.hostId = [...this.clients.keys()].find((id) => {
        const next = this.game.players.get(id);
        return next && !next.isBot;
      }) ?? null;
    }
    return true;
  }
}

export class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.botCount = Math.max(0, options.botCount ?? CONFIG.botCount);
    this.mobCount = Math.max(0, options.mobCount ?? CONFIG.mobCount);
  }

  makeUniqueCode() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const code = makeCode();
      if (!this.rooms.has(code)) return code;
    }
    return `${makeCode()}${Date.now().toString(36).slice(-2).toUpperCase()}`.slice(0, CODE_LENGTH);
  }

  createRoom(name, ws) {
    if (this.rooms.size >= 80) {
      return { error: '当前房间数量过多，请稍后再试' };
    }
    const code = this.makeUniqueCode();
    const room = new Room(code, {
      botCount: this.botCount,
      mobCount: this.mobCount,
    });
    const player = room.addHuman(name, ws);
    if (!player) return { error: '无法创建房间' };
    this.rooms.set(code, room);
    return { room, player };
  }

  joinRoom(rawCode, name, ws) {
    const code = normalizeRoomCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return { error: '房间不存在，检查房间码是否输入正确' };
    if (room.humanCount() >= CONFIG.maxHumans) {
      return { error: '这个房间已经满员了' };
    }
    const player = room.addHuman(name, ws);
    if (!player) return { error: '无法加入房间' };
    return { room, player };
  }

  quickJoin(name, ws) {
    const open = [...this.rooms.values()]
      .filter((room) => room.humanCount() < CONFIG.maxHumans)
      .sort((a, b) => b.humanCount() - a.humanCount())[0];
    if (open) return this.joinRoom(open.code, name, ws);
    return this.createRoom(name, ws);
  }

  get(code) {
    return this.rooms.get(normalizeRoomCode(code)) ?? null;
  }

  start(ws) {
    const room = this.get(ws.roomCode);
    if (!room) return { error: '房间已关闭' };
    if (room.hostId !== ws.playerId) return { error: '只有房主可以开始对局' };
    if (room.game.phase !== 'waiting') return { error: '对局已经开始' };
    room.game.startCountdown();
    return { ok: true };
  }

  leave(ws) {
    const room = this.get(ws.roomCode);
    if (!room) {
      ws.roomCode = null;
      ws.playerId = null;
      return;
    }
    if (ws.playerId) room.removeHuman(ws.playerId);
    ws.roomCode = null;
    ws.playerId = null;
    if (room.humanCount() === 0) this.rooms.delete(room.code);
  }

  tick(dt) {
    for (const room of this.rooms.values()) room.game.update(dt);
  }

  broadcastSnapshots() {
    for (const room of this.rooms.values()) {
      if (room.clients.size === 0) continue;
      const snapshot = room.game.takeSnapshot();
      snapshot.room = room.info();
      const payload = JSON.stringify({ type: 'state', ...snapshot });
      for (const ws of room.clients.values()) {
        if (ws.readyState === 1) ws.send(payload);
      }
    }
  }

  status() {
    let online = 0;
    let bots = 0;
    let players = 0;
    let activeRooms = 0;
    let timeLeft = 0;
    const phases = new Set();
    for (const room of this.rooms.values()) {
      activeRooms++;
      online += room.game.humanCount();
      bots += room.game.botCount();
      players += room.game.players.size;
      phases.add(room.game.phase);
      if (room.game.phase === 'playing') timeLeft = Math.max(timeLeft, room.game.timeLeft);
    }
    const phase = phases.has('playing')
      ? 'playing'
      : phases.has('starting')
        ? 'starting'
        : phases.has('ended')
          ? 'ended'
          : 'waiting';
    return {
      online,
      bots,
      players,
      rooms: activeRooms,
      phase,
      timeLeft: timeLeft || 180,
    };
  }
}
