// Bot brain: role assignment, perception, a small state machine and ability usage.
import { TEAM, TIMING, TOWER, enemyOf } from './constants.js';
import { CHAMPIONS, CHAMPION_LIST, SUMMONER_SPELLS } from './champions.js';
import { ITEMS } from './items.js';
import { LANE_NAMES } from './map.js';
import { isTargetable } from './combat.js';
import { mitigate } from './stats.js';
import { clamp } from './math.js';

const ROLE_SETS = {
  1: ['mid'],
  2: ['mid', 'bot'],
  3: ['top', 'mid', 'bot'],
  4: ['top', 'jungle', 'mid', 'bot'],
  5: ['top', 'jungle', 'mid', 'adc', 'support'],
};
const ROLE_LANE = { top: 'top', mid: 'mid', bot: 'bot', adc: 'bot', support: 'bot', jungle: null };
const DIFF = {
  easy: { reaction: 0.6, aggression: 1.4, goldMult: 0.85, lastHit: 0.45 },
  normal: { reaction: 0.3, aggression: 1.05, goldMult: 1, lastHit: 0.75 },
  hard: { reaction: 0.15, aggression: 0.85, goldMult: 1.15, lastHit: 0.95 },
};
const FALLBACK_BUILDS = {
  ad: ['bloodthirster', 'infinity_edge', 'last_whisper', 'phantom_dancer', 'black_cleaver', 'spirit_visage'],
  ap: ['rabadons', 'void_staff', 'ludens', 'rylais', 'morellonomicon', 'spirit_visage'],
  tank: ['warmogs', 'thornmail', 'spirit_visage', 'frozen_heart', 'sunfire', 'locket'],
};

function rolePreference(def, role, rng) {
  const wanted = role === 'bot' ? ['adc', 'mid', 'bot'] : [role];
  let best = 9;
  for (const w of wanted) {
    const i = def.roles.indexOf(w);
    if (i >= 0 && i < best) best = i;
  }
  return best + rng() * 0.5;
}

export function buildRosters(game, opts) {
  const size = clamp(opts.teamSize | 0, 1, 5);
  const roles = ROLE_SETS[size];
  const rosters = { [TEAM.BLUE]: [], [TEAM.RED]: [] };
  for (const team of [TEAM.BLUE, TEAM.RED]) {
    const used = new Set();
    let remaining = [...roles];
    if (team === opts.playerTeam && !opts.allBots) {
      const def = CHAMPIONS[opts.playerChampion] || CHAMPION_LIST[0];
      const candidates = def.roles.flatMap((r) => (r === 'adc' || r === 'support' ? [r, 'bot'] : [r]));
      let role = candidates.find((r) => remaining.includes(r));
      if (!role) role = remaining.includes('mid') ? 'mid' : remaining[0];
      rosters[team].push({ champId: def.id, role, isPlayer: true, spells: opts.playerSpells || def.defaultSpells });
      used.add(def.id);
      remaining = remaining.filter((r) => r !== role);
    }
    for (const role of remaining) {
      let bestDef = null;
      let bestScore = Infinity;
      for (const def of CHAMPION_LIST) {
        if (used.has(def.id)) continue;
        const score = rolePreference(def, role, game.rng);
        if (score < bestScore) {
          bestScore = score;
          bestDef = def;
        }
      }
      if (!bestDef) bestDef = CHAMPION_LIST[game.rng.int(CHAMPION_LIST.length)];
      used.add(bestDef.id);
      rosters[team].push({ champId: bestDef.id, role, isPlayer: false, spells: bestDef.defaultSpells });
    }
  }
  return rosters;
}

export function createBotState(game, c, role) {
  const diff = c.team === game.opts.playerTeam && !game.opts.allBots ? DIFF.normal : DIFF[game.opts.difficulty] || DIFF.normal;
  return {
    role, lane: ROLE_LANE[role] || null, state: 'lane', timer: game.rng() * 0.3,
    reaction: diff.reaction, aggression: diff.aggression, goldMult: diff.goldMult, lastHitSkill: diff.lastHit,
    buildIdx: 0, camp: null, lastShop: -999, stuckTimer: 0, lastX: c.x, lastY: c.y, target: null, defendTarget: null,
    retreatUntil: 0, lastFightCheck: 0, groupLane: null,
  };
}

function unitPower(u) {
  const s = u.ensureStats();
  const ehp = (u.hp + u.shieldTotal) * (1 + (s.armor + s.mr) / 200);
  const dps = s.ad * s.attackSpeed + s.ap * 0.6;
  return ehp * 0.3 + dps * 4 + (u.level || 1) * 20;
}

function perceive(game, c) {
  const b = c.bot;
  const enemyTeam = enemyOf(c.team);
  const enemyChamps = [];
  const allyChamps = [];
  for (const e of game.champions) {
    if (!e.alive || e === c) continue;
    if (e.team === c.team) {
      if (c.distTo(e) <= 1300) allyChamps.push(e);
    } else if (e.visibleTo[c.team] && c.distTo(e) <= 1700) enemyChamps.push(e);
  }
  enemyChamps.sort((p, q) => c.distTo(p) - c.distTo(q));
  const enemyMinionsNear = [];
  let allyMinionPower = 0;
  let enemyMinionPower = 0;
  for (const m of game.minions) {
    if (!m.alive) continue;
    const d = c.distTo(m);
    if (m.team === c.team) {
      if (d <= 900) allyMinionPower += 25;
    } else if (d <= 1000 && m.visibleTo[c.team]) {
      enemyMinionsNear.push(m);
      if (d <= 700) enemyMinionPower += 25;
    }
  }
  let underEnemyTower = null;
  let towerTargetsMe = false;
  let allyMinionsUnderTower = 0;
  let myTowerPower = 0;
  for (const s of game.structures) {
    if (!s.alive || s.stype !== 'tower') continue;
    if (s.team === enemyTeam) {
      if (s.edgeDistTo(c) <= s.stats.range + 60) {
        underEnemyTower = s;
        if (s.target === c) towerTargetsMe = true;
        for (const m of game.minions) if (m.alive && m.team === c.team && s.edgeDistTo(m) <= s.stats.range) allyMinionsUnderTower++;
      }
    } else if (s.distTo(c) <= 900) myTowerPower += 450 + game.time / 4;
  }
  let allyPower = unitPower(c) + allyMinionPower + myTowerPower;
  for (const a of allyChamps) if (c.distTo(a) <= 1000) allyPower += unitPower(a) * 0.9;
  let enemyPower = enemyMinionPower;
  for (const e of enemyChamps) if (c.distTo(e) <= 1100) enemyPower += unitPower(e);
  if (underEnemyTower && allyMinionsUnderTower < 2) enemyPower += 500 + game.time / 3;
  const f = game.map.fountains[c.team];
  const dxf = f.x - c.x;
  const dyf = f.y - c.y;
  const df = Math.hypot(dxf, dyf) || 1;
  return {
    me: c, state: b.state, hpPct: c.hpPct, manaPct: c.maxMana > 0 ? c.mana / c.maxMana : 1,
    enemyChamps, nearestEnemyChamp: enemyChamps[0] || null, allyChamps, enemyMinionsNear,
    allyPower, enemyPower, fightFavorable: enemyPower === 0 || allyPower >= enemyPower * b.aggression,
    underEnemyTower, towerTargetsMe, safeToDive: allyMinionsUnderTower >= 2,
    retreatDir: { x: dxf / df, y: dyf / df }, target: null, atBase: df < 700, distToFountain: df,
  };
}

function defaultState(b) {
  return b.role === 'jungle' ? 'jungle' : 'lane';
}

function nextBuildItem(c) {
  const b = c.bot;
  const build = c.def.build;
  while (b.buildIdx < build.length) {
    const id = build[b.buildIdx];
    const def = ITEMS[id];
    if (!def.consumable && c.items.some((s) => s && s.id === id)) {
      b.buildIdx++;
      continue;
    }
    return def;
  }
  const cls = c.def.cls;
  const list = cls === 'Mage' || cls === 'Support' ? FALLBACK_BUILDS.ap : cls === 'Tank' ? FALLBACK_BUILDS.tank : FALLBACK_BUILDS.ad;
  for (const id of list) if (!c.items.some((s) => s && s.id === id)) return ITEMS[id];
  return null;
}

function shop(game, c) {
  const b = c.bot;
  b.lastShop = game.time;
  for (let guard = 0; guard < 12; guard++) {
    const next = nextBuildItem(c);
    if (!next || c.gold < next.cost) break;
    const res = game.buyItem(c, next.id);
    if (res.ok) {
      if (b.buildIdx < c.def.build.length && c.def.build[b.buildIdx] === next.id) b.buildIdx++;
      continue;
    }
    if (res.reason === 'full') {
      // make room by selling the cheapest item
      let cheapest = -1;
      let cost = Infinity;
      c.items.forEach((s, i) => {
        if (s && !ITEMS[s.id].consumable && ITEMS[s.id].cost < cost) {
          cost = ITEMS[s.id].cost;
          cheapest = i;
        }
      });
      if (cheapest < 0 || cost >= next.cost) break;
      game.sellItem(c, cheapest);
      continue;
    }
    if (res.reason === 'stack' || res.reason === 'boots') {
      b.buildIdx++;
      continue;
    }
    break;
  }
  if (game.time < 1200) {
    const pots = c.items.find((s) => s && s.id === 'potion');
    const count = pots ? pots.count : 0;
    if (count < 2 && c.gold >= 50 && (c.items.indexOf(null) >= 0 || pots)) game.buyItem(c, 'potion');
  }
}

function findThreatenedStructure(game, c, ctx) {
  const b = c.bot;
  let best = null;
  let bestD = Infinity;
  for (const s of game.structures) {
    if (!s.alive || s.team !== c.team || s.stype === 'fountain') continue;
    if (game.time - s.lastDamageTime > 4) continue;
    const isBase = s.stype !== 'tower' || s.tier >= 3;
    const inMyLane = s.lane === b.lane;
    const d = c.distTo(s);
    const limit = isBase ? 5500 : inMyLane ? 4500 : b.role === 'jungle' ? 3500 : 0;
    if (d > limit) continue;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function pickFightTarget(game, c, ctx) {
  let best = null;
  let bestScore = -Infinity;
  for (const e of ctx.enemyChamps) {
    const d = c.distTo(e);
    if (d > 950) continue;
    let score = (1 - e.hpPct) * 100 - d / 50;
    if (c.inAttackRange(e, 50)) score += 30;
    if (e.recentDamagers.has(c.id)) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function decide(game, c, ctx) {
  const b = c.bot;
  const now = game.time;
  if (c.recall) {
    if (ctx.enemyChamps.some((e) => c.distTo(e) < 900)) c.recall = null;
    else {
      b.state = 'recall';
      return;
    }
  }
  if (b.state === 'recall') b.state = defaultState(b);
  const near = ctx.nearestEnemyChamp;
  const danger = near && c.distTo(near) < 950;
  const lowHp =
    ctx.hpPct < 0.33 ||
    (danger && !ctx.fightFavorable && ctx.hpPct < 0.6) ||
    (danger && near.hpPct > ctx.hpPct + 0.25 && ctx.hpPct < 0.45) ||
    (ctx.towerTargetsMe && !ctx.safeToDive && ctx.hpPct < 0.7);
  if (b.state === 'retreat') {
    const safe = !danger && !ctx.towerTargetsMe && (ctx.hpPct > 0.45 || ctx.atBase || now > b.retreatUntil);
    if (!safe && now < b.retreatUntil + 12) return;
    if (ctx.hpPct < 0.5 && !ctx.atBase && !danger) {
      if (game.startRecall(c)) {
        b.state = 'recall';
        return;
      }
    }
    b.state = defaultState(b);
  }
  if (lowHp) {
    b.state = 'retreat';
    b.retreatUntil = now + 3;
    return;
  }
  if (ctx.atBase) {
    shop(game, c);
    if (ctx.hpPct < 0.95 || ctx.manaPct < 0.9) {
      b.state = 'heal';
      return;
    }
    b.state = defaultState(b);
  } else if (b.state === 'heal') b.state = defaultState(b);

  if (!danger && !ctx.atBase && !ctx.towerTargetsMe && (b.state === 'lane' || b.state === 'jungle' || b.state === 'group')) {
    const next = nextBuildItem(c);
    const rich = next && c.gold >= next.cost && now - b.lastShop > 45;
    const lowRes = ctx.hpPct < 0.42 || ctx.manaPct < 0.12;
    const quiet = ctx.enemyMinionsNear.length === 0 || ctx.hpPct < 0.3;
    if ((rich && (lowRes || ctx.hpPct < 0.75 || now - b.lastShop > 150) && (quiet || now - b.lastShop > 240)) || (lowRes && quiet)) {
      if (game.startRecall(c)) {
        b.state = 'recall';
        return;
      }
    }
  }

  const threatened = findThreatenedStructure(game, c, ctx);
  if (threatened) {
    b.state = 'defend';
    b.defendTarget = threatened;
    return;
  }

  if (ctx.enemyChamps.length && ctx.fightFavorable) {
    const t = pickFightTarget(game, c, ctx);
    const healthy = ctx.hpPct >= 0.45 || (t && t.hpPct < ctx.hpPct);
    if (t && healthy && (!ctx.underEnemyTower || ctx.safeToDive || (t.hpPct < 0.25 && ctx.hpPct > 0.5))) {
      b.state = 'fight';
      b.target = t;
      return;
    }
  }
  if (b.state === 'fight' || b.state === 'defend') b.state = defaultState(b);

  const enemy = enemyOf(c.team);
  if (now > TIMING.groupTime || game.inhibitorsDown(enemy) > 0 || game.teamStats[c.team].towers - game.teamStats[enemy].towers >= 5) {
    b.state = 'group';
    return;
  }
  if (b.state === 'group') b.state = defaultState(b);
}

function orderMove(game, c, x, y) {
  const o = c.order;
  if (o && o.type === 'move' && Math.hypot(o.x - x, o.y - y) < 30) return;
  game.issueOrder(c, { type: 'move', x, y });
}

function orderAttack(game, c, t) {
  const o = c.order;
  if (o && o.type === 'attack' && o.target === t) return;
  game.issueOrder(c, { type: 'attack', target: t });
}

function orderWait(game, c) {
  if (c.order && c.order.type === 'wait') return;
  if (c.order && c.order.type === 'attack' && c.windup) return;
  game.issueOrder(c, { type: 'wait' });
}

function estimateHit(c, t) {
  return mitigate(c.stats.ad, 'physical', c.stats, t.ensureStats());
}

function useAbilities(game, c, ctx) {
  if (!c.canCast() || c.castLock > 0) return false;
  const order = c.def.aiOrder || ['R', 'Q', 'W', 'E'];
  for (const key of order) {
    const ab = c.abilities[key];
    if (ab.rank <= 0 || ab.cd > 0) continue;
    if (c.mana < game.abilityCost(c, key)) continue;
    if (!ab.def.ai) continue;
    const aim = ab.def.ai(game, c, ctx);
    if (!aim) continue;
    const res = game.castAbility(c, key, aim);
    if (res.ok) return true;
  }
  return false;
}

function useSpells(game, c, ctx) {
  c.spells.forEach((slot, idx) => {
    if (slot.cd > 0) return;
    const def = SUMMONER_SPELLS[slot.id];
    if (!def || !def.ai) return;
    const aim = def.ai(game, c, ctx);
    if (aim) game.castSpell(c, idx, aim);
  });
}

function usePotion(game, c, ctx) {
  if (ctx.hpPct > 0.6 || c.getBuff('potion') || ctx.atBase) return;
  const idx = c.items.findIndex((s) => s && s.id === 'potion');
  if (idx >= 0) game.useItem(c, idx);
}

function retreatPoint(game, c, ctx) {
  const f = game.map.fountains[c.team];
  if (ctx.hpPct < 0.2) return f;
  const myDist = ctx.distToFountain;
  let best = null;
  let bestScore = Infinity;
  for (const s of game.structures) {
    if (!s.alive || s.team !== c.team || (s.stype !== 'tower' && s.stype !== 'inhibitor')) continue;
    const dF = Math.hypot(s.x - f.x, s.y - f.y);
    if (dF > myDist - 150) continue;
    const score = c.distTo(s) + dF * 0.4;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best) return f;
  // stand slightly behind the tower (toward the fountain)
  const dx = f.x - best.x;
  const dy = f.y - best.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: best.x + (dx / d) * 160, y: best.y + (dy / d) * 160 };
}

function laneTargets(game, c, lane) {
  const team = c.team;
  const L = game.laneLength(lane);
  let allyFront = -1;
  let enemyFront = Infinity;
  for (const m of game.minions) {
    if (!m.alive || m.lane !== lane) continue;
    const along = game.laneProgress(team, lane, m.x, m.y);
    if (m.team === team) {
      if (along > allyFront) allyFront = along;
    } else if (m.visibleTo[team] && along < enemyFront) enemyFront = along;
  }
  let myTowerAlong = null;
  let enemyTower = null;
  let enemyTowerAlong = Infinity;
  for (const s of game.structures) {
    if (!s.alive || s.stype !== 'tower') continue;
    const inLane = s.lane === lane || s.lane === 'nexus';
    if (!inLane) continue;
    const along = game.laneProgress(team, lane, s.x, s.y);
    if (s.team === team) {
      if (s.lane === lane && (myTowerAlong === null || along > myTowerAlong)) myTowerAlong = along;
    } else if (along < enemyTowerAlong) {
      enemyTowerAlong = along;
      enemyTower = s;
    }
  }
  return { L, allyFront, enemyFront, myTowerAlong, enemyTower, enemyTowerAlong };
}

function laneAction(game, c, ctx, laneName) {
  const b = c.bot;
  const lane = laneName || b.lane || 'mid';
  const team = c.team;
  const info = laneTargets(game, c, lane);
  const { L, allyFront, enemyTower, enemyTowerAlong, myTowerAlong } = info;
  const myAlong = game.laneProgress(team, lane, c.x, c.y);

  let anchor;
  if (allyFront >= 0) anchor = allyFront - (c.ranged ? 230 : 60);
  else anchor = myTowerAlong !== null ? myTowerAlong + 200 : L * 0.35;
  if (allyFront < 0 && game.time < TIMING.firstWave + 40) anchor = Math.min(anchor, L * 0.4);
  const towerLimit = enemyTowerAlong - TOWER.range - 150;
  if (!ctx.safeToDive) anchor = Math.min(anchor, towerLimit);
  anchor = clamp(anchor, 500, L - 500);
  const dest = game.lanePoint(team, lane, anchor);

  // Attack targets
  const inRange = ctx.enemyMinionsNear.filter((m) => c.inAttackRange(m, 10));
  const enemyChampInRange = ctx.enemyChamps.find((e) => c.inAttackRange(e, 30) && !(ctx.underEnemyTower && !ctx.safeToDive));
  let target = null;
  let lastHit = null;
  let lowest = null;
  for (const m of inRange) {
    const dmg = estimateHit(c, m) * 1.05;
    if (m.hp <= dmg && (!lastHit || m.hp > lastHit.hp)) lastHit = m;
    if (!lowest || m.hp < lowest.hp) lowest = m;
  }
  if (lastHit && game.rng() < b.lastHitSkill + 0.25) target = lastHit;
  else if (enemyChampInRange && ctx.hpPct > 0.4 && (ctx.fightFavorable || c.ranged)) target = enemyChampInRange;
  else if (lowest) {
    const almost = lowest.hp < estimateHit(c, lowest) * 2.2;
    // wait for the last hit unless the wave is safe to push
    if (almost && ctx.enemyChamps.length > 0 && game.rng() < 0.6) target = null;
    else target = lowest;
  }
  if (!target && enemyTower && game.isStructureTargetable(enemyTower) && ctx.enemyMinionsNear.length === 0) {
    let allyUnder = 0;
    for (const m of game.minions) if (m.alive && m.team === team && enemyTower.edgeDistTo(m) <= enemyTower.stats.range) allyUnder++;
    const towerBusy = enemyTower.target && enemyTower.target !== c && enemyTower.target.kind === 'minion';
    if ((allyUnder >= 2 || towerBusy || ctx.allyChamps.length >= 2) && c.distTo(enemyTower) < 1100 && ctx.hpPct > 0.45) target = enemyTower;
  }
  ctx.target = target;
  if (target) orderAttack(game, c, target);
  else if (Math.hypot(dest.x - c.x, dest.y - c.y) > 70 || myAlong > anchor + 120) orderMove(game, c, dest.x, dest.y);
  else orderWait(game, c);
  useAbilities(game, c, ctx);
  usePotion(game, c, ctx);
}

function fightAction(game, c, ctx) {
  const b = c.bot;
  const t = b.target;
  if (!t || !t.alive || !isTargetable(game, t, c.team)) {
    b.state = defaultState(b);
    return laneAction(game, c, ctx, b.lane);
  }
  ctx.target = t;
  const threat = ctx.nearestEnemyChamp;
  const meleeThreat = c.ranged && threat && threat.stats.range < 300 && c.distTo(threat) < 330;
  if (meleeThreat && !c.windup && c.attackCd > 0.12) {
    const dir = ctx.retreatDir;
    const away = { x: c.x + dir.x * 180, y: c.y + dir.y * 180 };
    orderMove(game, c, away.x, away.y);
  } else orderAttack(game, c, t);
  useAbilities(game, c, ctx);
  useSpells(game, c, ctx);
  usePotion(game, c, ctx);
}

function defendAction(game, c, ctx) {
  const b = c.bot;
  const s = b.defendTarget;
  if (!s || !s.alive) {
    b.state = defaultState(b);
    return laneAction(game, c, ctx, b.lane);
  }
  let target = null;
  let bestD = Infinity;
  for (const e of game.units) {
    if (!e.alive || e.team === c.team || e.team > 1 || e.kind === 'structure') continue;
    if (!isTargetable(game, e, c.team)) continue;
    const d = e.distTo(s);
    if (d > 900) continue;
    const score = d - (e.kind === 'champion' && ctx.fightFavorable ? 400 : 0);
    if (score < bestD) {
      bestD = score;
      target = e;
    }
  }
  ctx.target = target;
  if (target && c.distTo(s) < 1100 && (ctx.fightFavorable || target.kind !== 'champion')) orderAttack(game, c, target);
  else {
    const f = game.map.fountains[c.team];
    const dx = f.x - s.x;
    const dy = f.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    orderMove(game, c, s.x + (dx / d) * 150, s.y + (dy / d) * 150);
  }
  useAbilities(game, c, ctx);
  useSpells(game, c, ctx);
  usePotion(game, c, ctx);
}

function findGank(game, c, ctx) {
  let best = null;
  let bestScore = -Infinity;
  for (const e of game.champions) {
    if (!e.alive || e.team === c.team || !e.visibleTo[c.team]) continue;
    const d = c.distTo(e);
    if (d > 3200) continue;
    // overextended: closer to our fountain than to theirs
    const f = game.map.fountains[c.team];
    const ef = game.map.fountains[e.team];
    const over = Math.hypot(e.x - ef.x, e.y - ef.y) - Math.hypot(e.x - f.x, e.y - f.y);
    if (over < 0) continue;
    const allies = game.champions.filter((a) => a.team === c.team && a.alive && a !== c && a.distTo(e) < 1200).length;
    const score = (1 - e.hpPct) * 100 + allies * 30 - d / 100;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function jungleAction(game, c, ctx) {
  const b = c.bot;
  let camp = b.camp && b.camp.alive ? b.camp : null;
  if (!camp) {
    const dragon = game.camps.find((k) => k.id === 'dragon');
    const baron = game.camps.find((k) => k.id === 'baron');
    const safe = (k) => enemiesNearPoint(game, c.team, k.x, k.y, 1400) === 0;
    if (baron.alive && c.level >= 12 && ctx.allyChamps.length >= 2 && ctx.hpPct > 0.6 && safe(baron)) camp = baron;
    else if (dragon.alive && c.level >= 6 && ctx.hpPct > 0.6 && (c.level >= 9 || ctx.allyChamps.length >= 1) && safe(dragon)) camp = dragon;
    if (!camp) {
      let bestD = Infinity;
      for (const k of game.camps) {
        if (!k.alive || k.side !== c.team) continue;
        const d = c.distToPoint(k.x, k.y);
        if (d < bestD) {
          bestD = d;
          camp = k;
        }
      }
    }
  }
  if (camp) {
    b.camp = camp;
    const mon = nearestCampMonster(c, camp);
    const bestD = mon ? c.distTo(mon) : Infinity;
    ctx.target = mon;
    if (mon && bestD < 1500) orderAttack(game, c, mon);
    else orderMove(game, c, camp.x, camp.y);
    useAbilities(game, c, ctx);
    usePotion(game, c, ctx);
    return;
  }
  b.camp = null;
  const gank = findGank(game, c, ctx);
  if (gank) {
    ctx.target = gank;
    orderMove(game, c, gank.x, gank.y);
    useAbilities(game, c, ctx);
    return;
  }
  // nothing to farm: help the lane whose wave is most pushed toward us
  let lane = 'mid';
  let worst = Infinity;
  for (const ln of LANE_NAMES) {
    const info = laneTargets(game, c, ln);
    const v = info.allyFront >= 0 ? info.allyFront : info.L;
    if (v < worst) {
      worst = v;
      lane = ln;
    }
  }
  laneAction(game, c, ctx, lane);
}

function enemiesNearPoint(game, team, x, y, r) {
  let n = 0;
  for (const e of game.champions) if (e.alive && e.team !== team && e.visibleTo[team] && Math.hypot(e.x - x, e.y - y) < r) n++;
  return n;
}

function nearestCampMonster(c, camp) {
  let mon = null;
  let bestD = Infinity;
  for (const m of camp.monsters) {
    if (!m.alive || m.resetting) continue;
    const d = c.distTo(m);
    if (d < bestD) {
      bestD = d;
      mon = m;
    }
  }
  return mon;
}

// Team objectives: once the team groups up, Baron (and Dragon) are taken together.
function objectiveAction(game, c, ctx) {
  const baron = game.camps.find((k) => k.id === 'baron');
  const dragon = game.camps.find((k) => k.id === 'dragon');
  const aliveAllies = game.champions.filter((a) => a.team === c.team && a.alive && a !== c).length;
  const consider = [];
  if (baron.alive && c.level >= 11 && aliveAllies >= 2 && ctx.hpPct > 0.5) consider.push({ camp: baron, need: 2 });
  if (dragon.alive && c.level >= 7 && aliveAllies >= 1 && ctx.hpPct > 0.5) consider.push({ camp: dragon, need: 1 });
  for (const { camp, need } of consider) {
    const enemiesAtPit = enemiesNearPoint(game, c.team, camp.x, camp.y, 1400);
    const alliesAtPit = game.champions.filter((a) => a.team === c.team && a.alive && a !== c && Math.hypot(a.x - camp.x, a.y - camp.y) < 1000).length;
    const myDist = c.distToPoint(camp.x, camp.y);
    // contest the pit only when the numbers are on our side
    if (enemiesAtPit > 0 && (enemiesAtPit > alliesAtPit + 1 || !ctx.fightFavorable)) continue;
    if (myDist > 3500 && alliesAtPit === 0) continue;
    const mon = nearestCampMonster(c, camp);
    if (!mon) continue;
    ctx.target = mon;
    if (alliesAtPit >= need && myDist < 1200) orderAttack(game, c, mon);
    else orderMove(game, c, camp.x, camp.y);
    useAbilities(game, c, ctx);
    usePotion(game, c, ctx);
    return true;
  }
  return false;
}

function groupAction(game, c, ctx) {
  const b = c.bot;
  const enemy = enemyOf(c.team);
  if (objectiveAction(game, c, ctx)) return;
  let lane = null;
  let best = -Infinity;
  for (const ln of LANE_NAMES) {
    const info = laneTargets(game, c, ln);
    let score = info.allyFront >= 0 ? info.allyFront : 0;
    if (!game.structureAlive(enemy, 'inhibitor', ln, 0)) score += 2000;
    if (ln === 'mid') score += 300;
    if (score > best) {
      best = score;
      lane = ln;
    }
  }
  b.groupLane = lane;
  laneAction(game, c, ctx, lane);
}

function healAction(game, c, ctx) {
  const f = game.map.fountains[c.team];
  if (c.distToPoint(f.x, f.y) > 250) orderMove(game, c, f.x, f.y);
  else orderWait(game, c);
}

function antiStuck(game, c, dt) {
  const b = c.bot;
  const moved = Math.hypot(c.x - b.lastX, c.y - b.lastY);
  b.lastX = c.x;
  b.lastY = c.y;
  if (c.order && c.order.type === 'move' && moved < 4 && c.canMove()) {
    b.stuckTimer += b.reaction;
    if (b.stuckTimer > 3) {
      b.stuckTimer = 0;
      c.path = null;
      const a = game.rng() * Math.PI * 2;
      const p = game.map.nearestWalkable(c.x + Math.cos(a) * 200, c.y + Math.sin(a) * 200, 6);
      if (p) game.issueOrder(c, { type: 'move', x: p.x, y: p.y });
    }
  } else b.stuckTimer = 0;
}

export function updateBot(game, c, dt) {
  const b = c.bot;
  b.timer -= dt;
  if (b.timer > 0) return;
  b.timer = b.reaction * (0.8 + game.rng() * 0.4);
  antiStuck(game, c, dt);
  const ctx = perceive(game, c);
  decide(game, c, ctx);
  ctx.state = b.state;
  switch (b.state) {
    case 'recall':
      return;
    case 'heal':
      return healAction(game, c, ctx);
    case 'retreat': {
      const p = retreatPoint(game, c, ctx);
      orderMove(game, c, p.x, p.y);
      useAbilities(game, c, ctx);
      useSpells(game, c, ctx);
      usePotion(game, c, ctx);
      return;
    }
    case 'defend':
      return defendAction(game, c, ctx);
    case 'fight':
      return fightAction(game, c, ctx);
    case 'jungle':
      return jungleAction(game, c, ctx);
    case 'group':
      return groupAction(game, c, ctx);
    default:
      if (game.time > TIMING.groupTime && objectiveAction(game, c, ctx)) return;
      return laneAction(game, c, ctx, b.lane);
  }
}

export { ROLE_SETS, ROLE_LANE, DIFF };
