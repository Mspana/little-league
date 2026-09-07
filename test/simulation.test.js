import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { MAP_SIZE } from '../src/sim/constants.js';

function playOut(opts, maxMinutes, dt) {
  const game = new Game({ headless: true, allBots: true, ...opts });
  let steps = 0;
  while (!game.over && game.time < maxMinutes * 60) {
    game.update(dt);
    if (++steps % 600 === 0) {
      for (const u of game.units) {
        if (!u.alive) continue;
        assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y), `${u.name} has a finite position`);
        assert.ok(u.x >= 0 && u.y >= 0 && u.x <= MAP_SIZE && u.y <= MAP_SIZE, `${u.name} stays on the map`);
        assert.ok(Number.isFinite(u.hp), `${u.name} has finite health`);
      }
      assert.ok(game.units.length < 500, 'unit count stays bounded');
    }
  }
  return game;
}

test('a full 5v5 bot match ends with a destroyed nexus', { timeout: 240000 }, () => {
  const game = playOut({ seed: 1, difficulty: 'normal', teamSize: 5 }, 45, 1 / 20);
  assert.ok(game.over, `game should finish within 45 minutes (time ${Math.round(game.time / 60)}m)`);
  assert.ok(game.winner === 0 || game.winner === 1);
  assert.ok(!game.nexusOf(1 - game.winner).alive);
  assert.ok(game.teamStats[0].kills + game.teamStats[1].kills > 5, 'champions fought');
  assert.ok(game.teamStats[game.winner].towers >= 5, 'winner took turrets');
  for (const c of game.champions) {
    assert.ok(c.level >= 6, `${c.name} should have levelled up`);
    assert.ok(c.items.filter(Boolean).length >= 2, `${c.name} should have bought items`);
  }
});

test('a 3v3 bot match on hard difficulty runs without errors', { timeout: 240000 }, () => {
  const game = playOut({ seed: 5, difficulty: 'hard', teamSize: 3 }, 20, 1 / 20);
  assert.ok(game.time >= 20 * 60 - 1 || game.over);
  assert.ok(game.teamStats[0].kills + game.teamStats[1].kills > 0);
});
