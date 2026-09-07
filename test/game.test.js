import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { TEAM, TIMING, GOLD } from '../src/sim/constants.js';
import { dealDamage, killUnit, grantXp } from '../src/sim/combat.js';
import { Minion } from '../src/sim/entities.js';

const DT = 1 / 30;
function run(game, seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) game.update(DT);
}
function newGame(opts = {}) {
  return new Game({ seed: 7, headless: true, playerChampion: 'aria', teamSize: 5, ...opts });
}
// Parks every bot at its fountain so tests are not disturbed by their decisions.
function freezeBots(game) {
  for (const c of game.champions) {
    if (c.bot) c.bot.timer = 1e9;
    c.order = null;
  }
}

test('rosters: the player leads blue, every role is filled once, mirror matches are allowed', () => {
  const game = newGame();
  const blue = game.champions.filter((c) => c.team === TEAM.BLUE);
  const red = game.champions.filter((c) => c.team === TEAM.RED);
  assert.equal(blue.length, 5);
  assert.equal(red.length, 5);
  assert.ok(game.player && game.player.def.id === 'aria' && game.player.team === TEAM.BLUE);
  assert.deepEqual(new Set(blue.map((c) => c.role)), new Set(['top', 'jungle', 'mid', 'adc', 'support']));
  assert.equal(new Set(blue.map((c) => c.def.id)).size, 5, 'no duplicate champions within a team');
  const small = newGame({ teamSize: 1 });
  assert.equal(small.champions.length, 2);
  assert.equal(small.player.role, 'mid');
});

test('minion waves spawn on schedule and march toward the enemy base', () => {
  const game = newGame();
  freezeBots(game);
  run(game, TIMING.firstWave - 1);
  assert.equal(game.minions.length, 0);
  run(game, 2);
  assert.equal(game.minions.length, 36, 'six minions per lane per team');
  const m = game.minions.find((x) => x.team === TEAM.BLUE && x.lane === 'mid');
  const redNexus = game.nexusOf(TEAM.RED);
  const before = m.distTo(redNexus);
  run(game, 5);
  assert.ok(m.distTo(redNexus) < before - 1000, 'minion should walk down the lane');
  run(game, TIMING.waveInterval * 2);
  assert.ok(game.minions.some((x) => x.mtype === 'siege'), 'every third wave has a siege minion');
});

test('opposing waves fight and minion kills award gold and shared experience', () => {
  const game = newGame();
  freezeBots(game);
  const p = game.player;
  run(game, 60);
  const mid = game.lanePoint(TEAM.BLUE, 'mid', 2500);
  p.x = mid.x;
  p.y = mid.y;
  const goldBefore = p.gold;
  const xpBefore = p.xp + p.level * 10000;
  run(game, 40);
  assert.ok(p.xp + p.level * 10000 > xpBefore, 'standing near dying enemy minions grants experience');
  assert.ok(game.minions.length < 36 * 3, 'waves should be killing each other');
  const enemy = game.minions.find((m) => m.team === TEAM.RED && m.distTo(p) < 1200);
  if (enemy) {
    killUnit(game, enemy, p);
    assert.ok(p.gold > goldBefore + GOLD.passivePerSecond * 40, 'last hit gold');
    assert.equal(p.cs, 1);
  }
});

test('turret protection order: inner turrets are invulnerable until the outer one falls', () => {
  const game = newGame();
  const t1 = game.getStructures(TEAM.RED, 'tower', 'mid', 1)[0];
  const t2 = game.getStructures(TEAM.RED, 'tower', 'mid', 2)[0];
  const t3 = game.getStructures(TEAM.RED, 'tower', 'mid', 3)[0];
  const inhib = game.getStructures(TEAM.RED, 'inhibitor', 'mid', 0)[0];
  const nexusTowers = game.getStructures(TEAM.RED, 'tower', 'nexus', 4);
  const nexus = game.nexusOf(TEAM.RED);
  assert.ok(game.isStructureTargetable(t1));
  assert.ok(!game.isStructureTargetable(t2));
  assert.equal(dealDamage(game, game.player, t2, 500, 'physical', { attack: true }), 0);
  killUnit(game, t1, game.player);
  assert.ok(game.isStructureTargetable(t2));
  assert.ok(!game.isStructureTargetable(inhib));
  killUnit(game, t2, game.player);
  killUnit(game, t3, game.player);
  assert.ok(game.isStructureTargetable(inhib));
  assert.ok(!game.isStructureTargetable(nexusTowers[0]));
  killUnit(game, inhib, game.player);
  assert.ok(game.isStructureTargetable(nexusTowers[0]));
  assert.ok(!game.isStructureTargetable(nexus));
  killUnit(game, nexusTowers[0], game.player);
  killUnit(game, nexusTowers[1], game.player);
  assert.ok(game.isStructureTargetable(nexus));
  assert.equal(game.teamStats[TEAM.BLUE].towers, 5);
  assert.ok(game.player.gold > GOLD.start + 5 * (GOLD.towerTeam + GOLD.towerKiller) - 1);
});

test('destroying an inhibitor spawns super minions and it respawns later', () => {
  const game = newGame();
  freezeBots(game);
  const inhib = game.getStructures(TEAM.RED, 'inhibitor', 'top', 0)[0];
  for (const tier of [1, 2, 3]) killUnit(game, game.getStructures(TEAM.RED, 'tower', 'top', tier)[0], game.player);
  killUnit(game, inhib, game.player);
  assert.ok(!inhib.alive);
  assert.equal(game.teamStats[TEAM.BLUE].inhibitors, 1);
  run(game, TIMING.firstWave + 2);
  const supers = game.minions.filter((m) => m.mtype === 'super');
  assert.equal(supers.length, 1);
  assert.equal(supers[0].team, TEAM.BLUE);
  assert.equal(supers[0].lane, 'top');
  run(game, TIMING.inhibitorRespawn);
  assert.ok(inhib.alive, 'inhibitor respawns');
  assert.equal(inhib.hp, inhib.maxHp);
});

test('the game ends when a nexus is destroyed', () => {
  const game = newGame();
  const nexus = game.nexusOf(TEAM.RED);
  for (const s of game.structures) if (s.team === TEAM.RED && s.stype !== 'nexus' && s.stype !== 'fountain') killUnit(game, s, game.player);
  assert.ok(game.isStructureTargetable(nexus));
  dealDamage(game, game.player, nexus, 1e6, 'true', { attack: true });
  assert.ok(game.over);
  assert.equal(game.winner, TEAM.BLUE);
  assert.ok(game.events.some((e) => e.type === 'gameover' && e.winner === TEAM.BLUE));
});

test('champion kills grant gold, experience, assists and a respawn timer', () => {
  const game = newGame();
  freezeBots(game);
  const killer = game.player;
  const helper = game.champions.find((c) => c.team === TEAM.BLUE && c !== killer);
  const victim = game.champions.find((c) => c.team === TEAM.RED);
  run(game, 1);
  dealDamage(game, helper, victim, 50, 'true', {});
  const gold = killer.gold;
  dealDamage(game, killer, victim, 1e5, 'true', {});
  assert.ok(!victim.alive);
  assert.equal(killer.kills, 1);
  assert.equal(victim.deaths, 1);
  assert.equal(helper.assists, 1);
  assert.equal(Math.round(killer.gold - gold), GOLD.kill + GOLD.firstBloodBonus);
  assert.equal(game.teamStats[TEAM.BLUE].kills, 1);
  assert.ok(victim.respawnTimer > 0);
  const ev = game.events.find((e) => e.type === 'kill');
  assert.ok(ev && ev.firstBlood && ev.killerName === killer.name && ev.seq > 0);
  run(game, victim.respawnTimer + 0.5);
  assert.ok(victim.alive);
  assert.equal(victim.hp, victim.maxHp);
  const f = game.map.fountains[TEAM.RED];
  assert.ok(victim.distToPoint(f.x, f.y) < 200, 'respawns at the fountain');
});

test('experience levels champions and unlocks ability ranks in the right order', () => {
  const game = newGame({ autoLevel: false });
  const p = game.player;
  assert.equal(p.level, 1);
  assert.equal(p.skillPoints, 1);
  assert.ok(!game.canLevel(p, 'R'));
  assert.ok(game.levelUpAbility(p, 'W'));
  assert.equal(p.abilities.W.rank, 1);
  assert.ok(!game.canLevel(p, 'Q'), 'no skill points left');
  grantXp(game, p, 280);
  assert.equal(p.level, 2);
  assert.ok(!game.canLevel(p, 'W'), 'rank 2 requires level 3');
  assert.ok(game.canLevel(p, 'Q'));
  while (p.level < 6) grantXp(game, p, 2000);
  assert.ok(game.canLevel(p, 'R'));
  assert.ok(game.levelUpAbility(p, 'R'));
  assert.ok(!game.canLevel(p, 'R'), 'second ult rank needs level 11');
});

test('casting abilities costs mana, starts cooldowns and produces projectiles', () => {
  const game = newGame({ autoLevel: false });
  const p = game.player;
  game.levelUpAbility(p, 'W');
  const mana = p.mana;
  const res = game.castAbility(p, 'W', { x: p.x + 500, y: p.y - 500 });
  assert.ok(res.ok);
  assert.equal(game.projectiles.length, 7, 'Volley fires seven arrows');
  assert.equal(p.mana, mana - 50);
  assert.ok(p.abilities.W.cd > 0);
  assert.equal(game.castAbility(p, 'W', { x: p.x + 500, y: p.y }).reason, 'cooldown');
  assert.equal(game.castAbility(p, 'Q', {}).reason, 'norank');
  run(game, 1);
  assert.equal(game.projectiles.length, 0, 'arrows expire');
});

test('unit-targeted abilities report range problems and skillshots hit enemies', () => {
  const game = newGame({ autoLevel: false, playerChampion: 'garrick' });
  freezeBots(game);
  const p = game.player;
  while (p.level < 6) grantXp(game, p, 2000);
  game.levelUpAbility(p, 'R');
  const enemy = game.champions.find((c) => c.team === TEAM.RED);
  const far = game.castAbility(p, 'R', { target: enemy });
  assert.equal(far.reason, 'range');
  enemy.x = p.x + 300;
  enemy.y = p.y;
  game.updateVisibility();
  const hp = enemy.hp;
  const ok = game.castAbility(p, 'R', { target: enemy });
  assert.ok(ok.ok);
  assert.ok(enemy.hp < hp);

  const mage = newGame({ autoLevel: false, playerChampion: 'lyra' });
  freezeBots(mage);
  const l = mage.player;
  mage.levelUpAbility(l, 'Q');
  const target = mage.champions.find((c) => c.team === TEAM.RED);
  target.x = l.x + 600;
  target.y = l.y;
  mage.updateVisibility();
  const before = target.hp;
  assert.ok(mage.castAbility(l, 'Q', { x: target.x, y: target.y }).ok);
  run(mage, 1);
  assert.ok(target.hp < before, 'Arcane Bolt should hit the enemy in its path');
});

test('shop rules: proximity, gold, unique boots, stacking potions, selling and drinking', () => {
  const game = newGame();
  const p = game.player;
  assert.equal(game.buyItem(p, 'boots').ok, true);
  assert.equal(game.buyItem(p, 'berserkers').reason, 'gold');
  p.gold = 5000;
  assert.equal(game.buyItem(p, 'berserkers').reason, 'boots');
  assert.equal(game.buyItem(p, 'potion').ok, true);
  assert.equal(game.buyItem(p, 'potion').ok, true);
  assert.equal(p.items.filter(Boolean).length, 2);
  assert.equal(p.items.find((s) => s.id === 'potion').count, 2);
  const gold = p.gold;
  assert.equal(game.sellItem(p, 0).ok, true);
  assert.equal(Math.round(p.gold - gold), Math.round(300 * GOLD.sellRatio));
  p.hp = 100;
  const idx = p.items.findIndex((s) => s && s.id === 'potion');
  assert.equal(game.useItem(p, idx).ok, true);
  assert.equal(game.useItem(p, idx).reason, 'active');
  run(game, 3);
  assert.ok(p.hp > 100 + 30, 'potion heals over time');
  p.x = 3000;
  p.y = 3000;
  assert.equal(game.buyItem(p, 'long_sword').reason, 'shop');
});

test('recall channels for eight seconds, teleports home and is interrupted by damage', () => {
  const game = newGame();
  freezeBots(game);
  const p = game.player;
  assert.equal(game.startRecall(p), false, 'cannot recall at the fountain');
  // the wolves camp: far from the fountain, out of every enemy turret's range
  p.x = 1600;
  p.y = 3600;
  assert.equal(game.startRecall(p), true);
  run(game, TIMING.recallDuration + 0.2);
  const f = game.map.fountains[TEAM.BLUE];
  assert.ok(p.distToPoint(f.x, f.y) < 200);
  p.x = 1600;
  p.y = 3600;
  game.startRecall(p);
  run(game, 2);
  dealDamage(game, null, p, 10, 'true', {});
  assert.equal(p.recall, null, 'damage interrupts the recall');
});

test('fog of war: enemies are only visible near allied units, stealth hides completely', () => {
  const game = newGame();
  freezeBots(game);
  const p = game.player;
  const enemy = game.champions.find((c) => c.team === TEAM.RED);
  game.updateVisibility();
  assert.equal(enemy.visibleTo[TEAM.BLUE], false);
  enemy.x = p.x + 500;
  enemy.y = p.y;
  game.updateVisibility();
  assert.equal(enemy.visibleTo[TEAM.BLUE], true);
  enemy.addBuff({ id: 'stealth', duration: 5, flags: { stealth: true } });
  game.updateVisibility();
  assert.equal(enemy.visibleTo[TEAM.BLUE], false);
  const tower = game.getStructures(TEAM.RED, 'tower', 'mid', 1)[0];
  assert.equal(tower.visibleTo[TEAM.BLUE], true, 'structures are always visible');
});

test('turrets shoot minions in range and switch to champions who attack allied champions', () => {
  const game = newGame();
  freezeBots(game);
  const tower = game.getStructures(TEAM.RED, 'tower', 'mid', 1)[0];
  const minion = new Minion(game, {
    team: TEAM.BLUE, x: tower.x - 400, y: tower.y + 400, radius: 24, mtype: 'melee', lane: 'mid', name: 'Test Minion',
    baseStats: { hp: 2000, ad: 1, armor: 0, mr: 0, as: 0.1, range: 110, ms: 0 }, gold: 0, xp: 0, waypoints: game.map.lanes[TEAM.BLUE].mid, wpIdx: 1,
  });
  minion.immobile = true;
  game.addUnit(minion);
  game.minions.push(minion);
  run(game, 3);
  assert.ok(minion.hp < minion.maxHp, 'turret damaged the minion');
  const p = game.player;
  const redChamp = game.champions.find((c) => c.team === TEAM.RED);
  p.x = tower.x - 450;
  p.y = tower.y + 450;
  redChamp.x = tower.x - 300;
  redChamp.y = tower.y + 300;
  game.updateVisibility();
  dealDamage(game, p, redChamp, 10, 'true', {});
  assert.ok(tower.aggro && tower.aggro.id === p.id, 'turret aggro switches to the attacker');
  run(game, 2);
  assert.ok(p.hp < p.maxHp, 'turret shot the player');
});

test('jungle camps spawn, grant buffs to their killer and respawn', () => {
  const game = newGame();
  freezeBots(game);
  run(game, TIMING.campSpawn + 1);
  const camp = game.camps.find((c) => c.id === 'blue' && c.side === TEAM.BLUE);
  assert.ok(camp.alive && camp.monsters.length === 1);
  const p = game.player;
  const gold = p.gold;
  killUnit(game, camp.monsters[0], p);
  assert.ok(p.getBuff('blue_buff'), 'killer gets the blue buff');
  assert.ok(p.gold > gold);
  assert.ok(!camp.alive);
  assert.ok(camp.respawnAt > game.time);
  run(game, TIMING.campRespawn + 1);
  assert.ok(camp.alive, 'camp respawned');
  assert.ok(game.camps.find((c) => c.id === 'dragon').alive === (game.time >= TIMING.dragonSpawn));
});

test('orders: move, attack and attack-move drive the champion', () => {
  const game = newGame();
  freezeBots(game);
  const p = game.player;
  const start = { x: p.x, y: p.y };
  game.issueOrder(p, { type: 'move', x: p.x + 400, y: p.y - 400 });
  run(game, 2);
  assert.ok(Math.hypot(p.x - start.x, p.y - start.y) > 300);
  assert.equal(p.order, null, 'move order completes on arrival');
  const enemy = game.champions.find((c) => c.team === TEAM.RED);
  enemy.x = p.x + 900;
  enemy.y = p.y;
  enemy.bot.timer = 1e9;
  game.updateVisibility();
  game.issueOrder(p, { type: 'attack', target: enemy });
  run(game, 3);
  assert.ok(enemy.hp < enemy.maxHp, 'attack order walks into range and shoots');
});

test('skillshots hit the closest enemy along their path first', () => {
  const game = newGame({ autoLevel: false, playerChampion: 'lyra' });
  freezeBots(game);
  const p = game.player;
  game.levelUpAbility(p, 'Q');
  const reds = game.champions.filter((c) => c.team === TEAM.RED);
  // in the river, away from every turret and fountain; the later-created champion is the closer one
  p.x = 1900;
  p.y = 1900;
  const near = reds[3];
  const far = reds[0];
  near.x = 2200;
  near.y = 2200;
  far.x = 2500;
  far.y = 2500;
  game.updateVisibility();
  const nearHp = near.hp;
  const farHp = far.hp;
  assert.ok(game.castAbility(p, 'Q', { x: 2800, y: 2800 }).ok);
  // step in large increments so both units fall inside a single sweep segment
  for (let i = 0; i < 4; i++) game.update(0.5);
  assert.ok(near.hp < nearHp, 'the nearer champion is hit');
  assert.equal(far.hp, farHp, 'the bolt stops at the first target');
});
