#!/usr/bin/env node
// Headless bots-vs-bots simulation. Usage: node scripts/simulate.js [seed] [difficulty] [teamSize] [maxMinutes]
import { Game } from '../src/sim/game.js';
import { formatTime } from '../src/sim/math.js';

const seed = Number(process.argv[2] || 1);
const difficulty = process.argv[3] || 'normal';
const teamSize = Number(process.argv[4] || 5);
const maxMinutes = Number(process.argv[5] || 45);

const game = new Game({ seed, difficulty, teamSize, allBots: true, headless: true });
const dt = 1 / 30;
const started = Date.now();
let lastReport = 0;
while (!game.over && game.time < maxMinutes * 60) {
  game.update(dt);
  if (game.time - lastReport >= 120) {
    lastReport = game.time;
    const ts = game.teamStats;
    console.log(`${formatTime(game.time)}  kills ${ts[0].kills}-${ts[1].kills}  towers ${ts[0].towers}-${ts[1].towers}  inhibs ${ts[0].inhibitors}-${ts[1].inhibitors}  dragons ${ts[0].dragons}-${ts[1].dragons}  minions ${game.minions.length}  units ${game.units.length}`);
  }
}
console.log(`--- finished at ${formatTime(game.time)} in ${((Date.now() - started) / 1000).toFixed(1)}s real time; winner: ${game.winner === null ? 'none' : game.winner === 0 ? 'BLUE' : 'RED'}`);
for (const c of game.champions) {
  const items = c.items.filter(Boolean).map((s) => s.id + (s.count > 1 ? `x${s.count}` : '')).join(', ');
  console.log(`${c.team === 0 ? 'BLUE' : 'RED '} ${c.name.padEnd(8)} ${c.role.padEnd(8)} L${String(c.level).padStart(2)}  ${c.kills}/${c.deaths}/${c.assists}  cs ${String(c.cs).padStart(3)}  gold ${Math.round(c.totalGold)}  [${items}]`);
}
