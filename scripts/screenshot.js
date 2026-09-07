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
// jump to a lane fight in the mid game
await advance(420);
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
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const g = window.app.game;
  return { time: g.time, kills: g.teamStats.map((t) => t.kills), towers: g.teamStats.map((t) => t.towers), player: { hp: g.player.hp, level: g.player.level, gold: g.player.gold, items: g.player.items.filter(Boolean).map((s) => s.id) }, units: g.units.length, fps: window.app.fps || null, renderMs: window.app.renderMs ? Number(window.app.renderMs.toFixed(1)) : null };
});
console.log(JSON.stringify(info, null, 2));
console.log(errors.length ? `Console problems:\n${errors.join('\n')}` : 'No console errors.');
await browser.close();
server.kill();
process.exit(errors.some((e) => e.startsWith('[pageerror]')) ? 1 : 0);
