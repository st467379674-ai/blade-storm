import assert from 'node:assert/strict';
import { Game, CONFIG } from '../server/game.js';

function freshGame() {
  const game = new Game({ botCount: 0 });
  const a = game.addHuman('测试甲');
  const b = game.addHuman('测试乙');
  game.phase = 'playing';
  game.timeLeft = CONFIG.matchDuration;
  return { game, a, b };
}

function stageClash(game, a, b, levelA, levelB, countA = 3, countB = 3) {
  for (const [p, level, count] of [
    [a, levelA, countA],
    [b, levelB, countB],
  ]) {
    p.x = 0;
    p.z = 0;
    p.hp = 100;
    p.invuln = 0;
    p.bladeAngle = 0;
    p.bladeCount = count;
    p.bladeLevel = level;
    p.bladeRadius = 2.25;
    p.bladeLength = 2.6;
    p.bladeLossCd = 0;
    game.recomputePower(p);
  }
  game.clashCooldowns.clear();
  game.breakCooldowns.clear();
  game.events = [];
}

function placePickup(game, player, type, grade = null) {
  game.pickups = [];
  player.x = 0;
  player.z = 0;
  player.invuln = 0;
  const pickup = { id: `test_${type}_${grade ?? 0}`, type, x: 0, z: 0 };
  if (grade !== null) pickup.grade = grade;
  game.pickups.push(pickup);
  game.updatePickups(1 / 30);
}

console.log('\n  logic test · blade storm');

assert.equal(CONFIG.arenaRadius, 40, 'arena radius');
assert.ok(CONFIG.mobCount >= 30, 'mob population configured');
console.log('  ✓ battlefield is 80m across with a monster population');

// Opening supply must contain upgrades, blades and mobs.
{
  const { game } = freshGame();
  const types = game.pickups.map((u) => u.type);
  assert.ok(game.pickups.length >= 10, 'initial pickup count');
  assert.ok(types.includes('upgrade'), 'initial upgrade pickup');
  assert.ok(
    game.pickups.some((u) => u.type === 'upgrade' && (u.grade ?? 1) >= 2),
    'initial high-grade growth item',
  );
  assert.ok(types.includes('blade'), 'initial blade pickup');
  assert.ok(game.mobs.length >= CONFIG.mobCount, 'initial mobs');
  assert.ok(
    game.mobs.every((m) => Math.hypot(m.x, m.z) <= CONFIG.arenaRadius),
    'mobs inside arena',
  );
  console.log(
    `  ✓ opening supply: ${game.pickups.length} pickups, ${game.mobs.length} knife spirits`,
  );
}

// High tier knocks one blade loose; equal tier only clashes.
{
  const { game, a, b } = freshGame();
  stageClash(game, a, b, 2, 1);
  game.resolveBlades(1 / 30);
  const breakEvent = game.events.find((e) => e.type === 'bladeBreak');
  assert.ok(breakEvent, 'bladeBreak event');
  assert.equal(a.bladeCount, 3, 'winner keeps blades');
  assert.equal(b.bladeCount, 2, 'loser loses a blade');
  const dropped = game.pickups.find((u) => u.dropped && u.type === 'blade');
  assert.ok(dropped, 'dropped blade pickup exists');
  assert.equal(dropped.level, 1, 'dropped pickup keeps blade level');
  console.log('  ✓ high tier breaks one blade and drops it as a pickup');

  const before = b.bladeCount;
  game.pickups = [dropped];
  b.x = dropped.x;
  b.z = dropped.z;
  b.invuln = 10;
  game.updatePickups(1 / 30);
  assert.equal(b.bladeCount, before + 1, 'loser can recover the dropped blade');
  console.log('  ✓ dropped blade can be picked back up');

  const equal = freshGame();
  stageClash(equal.game, equal.a, equal.b, 2, 2);
  equal.game.resolveBlades(1 / 30);
  assert.equal(equal.game.events.some((e) => e.type === 'bladeBreak'), false, 'equal tier does not break');
  assert.equal(equal.a.bladeCount, 3, 'equal tier a unchanged');
  assert.equal(equal.b.bladeCount, 3, 'equal tier b unchanged');
  console.log('  ✓ equal tier blades only bounce');
}

// The last blade cannot be removed; it bursts for damage instead.
{
  const { game, a, b } = freshGame();
  stageClash(game, a, b, 3, 1, 3, 1);
  game.resolveBlades(1 / 30);
  const breakEvent = game.events.find((e) => e.type === 'bladeBreak');
  assert.ok(breakEvent, 'last blade collision event');
  assert.equal(breakEvent.dropped, false, 'last blade is not dropped');
  assert.equal(b.bladeCount, 1, 'last blade stays');
  assert.ok(b.hp < 100, 'last blade collision deals damage');
  console.log('  ✓ last blade is protected and takes clash damage');
}

// Grade 1/2/3 growth pickups scale in strength and color class.
{
  const { game, a } = freshGame();

  a.bladeLevel = 1;
  a.bladeCount = 3;
  placePickup(game, a, 'upgrade', 1);
  assert.equal(a.bladeLevel, 1, 'green does not add tier');
  assert.equal(a.bladeCount, 4, 'green adds a blade');

  a.bladeLevel = 1;
  a.bladeCount = 3;
  placePickup(game, a, 'upgrade', 2);
  assert.equal(a.bladeLevel, 2, 'blue adds a tier');
  assert.equal(a.bladeCount, 4, 'blue adds a blade');

  a.bladeLevel = 1;
  a.bladeCount = 3;
  placePickup(game, a, 'upgrade', 3);
  assert.equal(a.bladeLevel, 3, 'purple adds two tiers');
  assert.equal(a.bladeCount, 5, 'purple adds two blades');

  a.bladeLevel = CONFIG.maxBladeLevel;
  a.bladeCount = CONFIG.maxBlades;
  placePickup(game, a, 'upgrade', 3);
  assert.equal(a.bladeLevel, CONFIG.maxBladeLevel, 'level cap');
  assert.equal(a.bladeCount, CONFIG.maxBlades, 'blade cap');
  console.log('  ✓ green/blue/purple growth items are three distinct power classes');
}

// Knife spirits award souls and auto-grow blades / tiers.
{
  const { game, a } = freshGame();
  a.souls = 3;
  a.bladeCount = 3;
  a.bladeLevel = 1;
  let mob = game.mobs.find((m) => m.alive);
  game.killMob(mob, a);
  assert.equal(a.souls, 4, 'soul gain');
  assert.equal(a.bladeCount, 4, '4 souls grant a blade');
  assert.equal(a.bladeLevel, 1, '4 souls do not grant a tier');

  a.souls = 7;
  a.bladeLevel = 1;
  mob = game.mobs.find((m) => m.alive);
  game.killMob(mob, a);
  assert.equal(a.souls, 8, 'soul total');
  assert.equal(a.bladeLevel, 2, '8 souls grant a tier');
  assert.ok(mob.alive === false, 'mob dies');
  assert.ok(mob.respawn > 0, 'mob schedules respawn');
  console.log('  ✓ killing knife spirits grants souls, blades and tiers');
}

// Orbiting blades can cut knife spirits and award souls.
{
  const { game, a } = freshGame();
  const mob = game.mobs.find((m) => m.alive);
  game.mobs = [mob];
  a.x = 0;
  a.z = 0;
  a.bladeAngle = 0;
  a.bladeCount = 3;
  a.bladeRadius = 2.25;
  a.bladeLength = 2.6;
  a.mobHitCd.clear();
  mob.x = 2.25;
  mob.z = 0;
  mob.hp = 34;
  game.resolveMobCombat(1 / 30);
  assert.ok(mob.hp < 34, 'blade damages mob');
  a.mobHitCd.clear();
  mob.hp = 1;
  game.resolveMobCombat(1 / 30);
  assert.equal(mob.alive, false, 'mob dies');
  assert.equal(a.souls, 1, 'mob awards a soul');
  console.log('  ✓ orbiting blades cut knife spirits and award souls');
}

// Supplies regenerate quickly.
{
  const { game } = freshGame();
  for (let i = 0; i < 30 * 22; i++) game.updatePickups(1 / 30);
  assert.ok(game.pickups.length >= CONFIG.maxPickups - 1, 'pickup field refills');
  assert.ok(game.pickups.some((u) => u.type === 'upgrade'), 'upgrade is available');
  console.log(`  ✓ supply refills to ${game.pickups.length} pickups in 22s with an upgrade available`);
}

console.log('\n  ✓ blade logic tests passed\n');
