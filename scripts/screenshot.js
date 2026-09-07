#!/usr/bin/env node
// Drives the game in headless Chromium and saves screenshots to ./shots.
// Requires Playwright (npm i -D playwright, or a global install) with Chromium available.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const PORT = 8123;
const out = process.argv[2] || 'shots';
fs.mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.js', String(PORT)], { stdio: 'ignore' });
await new Promise((resolve) => {
  const tryConnect = () => http.get(`http://localhost:${PORT}/`, () => resolve()).on('error', () => setTimeout(tryConnect, 150));
  tryConnect();
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const advance = (seconds) => page.evaluate((s) => {
  const g = window.app.game;
  for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60);
}, seconds);

await page.addInitScript(() => {
  import('/src/sim/combat.js').then((m) => (window.__dealDamage = m.dealDamage));
});
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#startBtn');
await shot('01-setup');
await page.click('#startBtn');
await page.waitForTimeout(800);
await shot('02-start');
// buy a starter item then walk out
await page.keyboard.press('p');
await page.waitForTimeout(300);
await shot('03-shop');
await page.click('.item-card[data-id="dorans_blade"]');
await page.keyboard.press('p');
await page.mouse.click(1100, 250, { button: 'right' });
await page.waitForTimeout(2500);
await shot('04-walking');
await advance(60);
await page.waitForTimeout(400);
await shot('05-one-minute');
await page.keyboard.down('Tab');
await page.waitForTimeout(300);
await shot('06-scoreboard');
await page.keyboard.up('Tab');
// --- interaction checks: the player fights a minion wave through real mouse/keyboard input
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  g.stopUnit(p);
  // stand in the mid lane on our side and wait for the enemy wave
  const spot = g.lanePoint(p.team, 'mid', 3250);
  p.x = spot.x;
  p.y = spot.y;
  window.app.camera.locked = true;
});
// wait (in simulated time) until an enemy minion walks into view
let target = null;
for (let i = 0; i < 24 && !target; i++) {
  await advance(5);
  await page.waitForTimeout(60);
  target = await page.evaluate(() => {
    const g = window.app.game;
    const p = g.player;
    let best = null;
    for (const m of g.minions) {
      if (m.team === p.team || !m.alive || !m.visibleTo[p.team]) continue;
      if (!best || m.distTo(p) < best.distTo(p)) best = m;
    }
    if (!best || best.distTo(p) > 650) return null;
    const s = window.app.camera.worldToScreen(best.x, best.y);
    return { id: best.id, x: s.x, y: s.y, hp: best.hp, dist: Math.round(best.distTo(p)) };
  });
}
check('an enemy minion is visible near the player', !!target, target ? `distance ${target.dist}` : 'none');
if (target) {
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForTimeout(100);
  const order = await page.evaluate(() => (window.app.game.player.order ? window.app.game.player.order.type : null));
  check('right-clicking an enemy issues an attack order', order === 'attack', `order=${order}`);
  await advance(6);
  const after = await page.evaluate((id) => {
    const g = window.app.game;
    const m = g.unitById(id);
    return { alive: !!(m && m.alive), hp: m ? m.hp : 0, cs: g.player.cs, gold: g.player.gold };
  }, target.id);
  check('the attacked minion took damage or died', !after.alive || after.hp < target.hp, `alive=${after.alive} hp=${Math.round(after.hp)} cs=${after.cs}`);
}
await shot('06b-fighting');
// abilities: W is learned first by Aria's skill order. Make sure the player is alive and healthy first.
const castResult = await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  if (!p.alive) g.respawnChampion(p);
  const spot = g.lanePoint(p.team, 'mid', 3000);
  p.x = spot.x;
  p.y = spot.y;
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.abilities.W.cd = 0;
  return { rank: p.abilities.W.rank, projectilesBefore: g.projectiles.filter((q) => q.source === p && !q.target).length };
});
await page.mouse.move(1200, 200);
await page.keyboard.press('w');
await page.waitForTimeout(50);
const afterCast = await page.evaluate(() => ({ projectiles: window.app.game.projectiles.filter((q) => q.source === window.app.game.player && !q.target).length, cd: window.app.game.player.abilities.W.cd }));
check('pressing W fires Volley toward the cursor', castResult.rank > 0 && afterCast.cd > 0 && afterCast.projectiles > castResult.projectilesBefore, `rank=${castResult.rank} projectiles=${afterCast.projectiles} cd=${afterCast.cd.toFixed(1)}`);
await page.waitForTimeout(400);
await shot('06c-volley');
// recall (from a quiet spot in our jungle)
await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  if (!p.alive) g.respawnChampion(p);
  p.x = 1600;
  p.y = 3600;
  p.hp = p.maxHp;
  g.stopUnit(p);
});
await page.keyboard.press('b');
await page.waitForTimeout(50);
const recalling = await page.evaluate(() => !!window.app.game.player.recall);
check('pressing B starts a recall', recalling);
await advance(9);
const home = await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  const f = g.map.fountains[p.team];
  return Math.round(p.distToPoint(f.x, f.y));
});
check('the recall brought the player to the fountain', home < 300 || home > 5000, `distance to fountain ${home}`);
// jump to a lane fight in the mid game
await advance(380);
await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  const mid = g.lanePoint(p.team, 'mid', 2600);
  p.x = mid.x;
  p.y = mid.y;
  g.stopUnit(p);
});
await page.waitForTimeout(400);
await page.keyboard.press('q');
await page.keyboard.press('w');
await page.waitForTimeout(600);
await shot('07-midgame');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('08-pause');
await page.keyboard.press('Escape');
// death overlay
await page.evaluate(() => {
  const g = window.app.game;
  const p = g.player;
  const enemy = g.champions.find((c) => c.team !== p.team);
  p.hp = 1;
  enemy.x = p.x + 100;
  enemy.y = p.y;
  g.updateVisibility();
  enemy.ensureStats();
  // let the enemy finish the player through the normal damage pipeline
  window.__dealDamage(g, enemy, p, 1e6, 'true', {});
});
await page.waitForTimeout(300);
await shot('09-death');
const deathShown = await page.evaluate(() => !document.getElementById('death').hidden && !window.app.game.player.alive);
check('the death overlay appears when the player dies', deathShown);
// end screen
await page.evaluate(() => window.app.game.endGame(0));
await page.waitForTimeout(400);
await shot('10-victory');
const endShown = await page.evaluate(() => !document.getElementById('end').hidden && document.querySelector('#end h1').textContent);
check('the end screen appears when the game ends', endShown === 'VICTORY', `title=${endShown}`);
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const g = window.app.game;
  return { time: g.time, kills: g.teamStats.map((t) => t.kills), towers: g.teamStats.map((t) => t.towers), player: { hp: g.player.hp, level: g.player.level, gold: g.player.gold, items: g.player.items.filter(Boolean).map((s) => s.id) }, units: g.units.length, fps: window.app.fps || null, renderMs: window.app.renderMs ? Number(window.app.renderMs.toFixed(1)) : null };
});
console.log(JSON.stringify(info, null, 2));
console.log(errors.length ? `Console problems:\n${errors.join('\n')}` : 'No console errors.');
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} interaction checks passed`);
await browser.close();
server.kill();
process.exit(errors.some((e) => e.startsWith('[pageerror]')) || failed.length ? 1 : 0);
