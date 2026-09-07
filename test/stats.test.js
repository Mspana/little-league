import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mitigate, growth, computeStats, cooldownMultiplier, xpToNextLevel } from '../src/sim/stats.js';
import { CHAMPIONS } from '../src/sim/champions.js';
import { ITEMS } from '../src/sim/items.js';

test('armor and magic resist reduce damage with the 100/(100+resist) formula', () => {
  assert.equal(mitigate(100, 'physical', null, { armor: 100, mr: 0 }), 50);
  assert.equal(mitigate(100, 'magic', null, { armor: 0, mr: 300 }), 25);
  assert.equal(mitigate(100, 'true', null, { armor: 1000, mr: 1000 }), 100);
});

test('penetration lowers effective resistances but never below zero', () => {
  const src = { armorPenPct: 0.35, armorPenFlat: 10, magicPenFlat: 18, magicPenPct: 0 };
  const tgt = { armor: 100, mr: 10 };
  assert.ok(Math.abs(mitigate(100, 'physical', src, tgt) - 100 * (100 / 155)) < 1e-9);
  assert.equal(mitigate(100, 'magic', src, tgt), 100);
});

test('stat growth follows the per-level curve', () => {
  assert.equal(growth(100, 10, 1), 100);
  assert.ok(growth(100, 10, 18) > 100 + 10 * 16);
  assert.ok(growth(100, 10, 18) < 100 + 10 * 17 * 1.1);
});

test('items and levels feed into computed champion stats', () => {
  const def = CHAMPIONS.aria;
  const base = { baseStats: def.base, level: 1, items: [null, null, null, null, null, null], buffs: [] };
  const s1 = computeStats(base);
  assert.equal(Math.round(s1.maxHp), def.base.hp);
  assert.equal(s1.moveSpeed, def.base.ms);
  const s2 = computeStats({ ...base, level: 18 });
  assert.ok(s2.maxHp > s1.maxHp && s2.ad > s1.ad && s2.attackSpeed > s1.attackSpeed);
  const withItems = computeStats({ ...base, items: [{ id: 'boots', count: 1 }, { id: 'infinity_edge', count: 1 }, { id: 'rabadons', count: 1 }, null, null, null] });
  assert.equal(withItems.moveSpeed, def.base.ms + ITEMS.boots.stats.msFlat);
  assert.equal(withItems.ad, s1.ad + 65);
  assert.ok(Math.abs(withItems.ap - 120 * 1.35) < 1e-9);
  assert.equal(withItems.crit, 0.2);
  assert.equal(withItems.critDmg, 2);
});

test('slows use the strongest value and buffs can stack their modifiers', () => {
  const def = CHAMPIONS.garrick;
  const unit = { baseStats: def.base, level: 5, items: null, buffs: [{ slow: 0.3 }, { slow: 0.5 }, { mods: { ad: 10 }, modsPerStack: true, stacks: 3 }] };
  const s = computeStats(unit);
  assert.equal(s.slow, 0.5);
  assert.equal(Math.round(s.moveSpeed), Math.round(def.base.ms * 0.5));
  assert.equal(Math.round(s.bonusAd), 30);
});

test('ability haste and xp tables behave', () => {
  assert.equal(cooldownMultiplier(100), 0.5);
  assert.equal(cooldownMultiplier(0), 1);
  assert.equal(xpToNextLevel(1), 280);
  assert.equal(xpToNextLevel(18), Infinity);
});
