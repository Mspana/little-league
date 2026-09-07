import { GOLD, XP, RESPAWN, TIMING, ATTACK, TOWER, MAX_LEVEL } from './constants.js';
import { mitigate, xpToNextLevel } from './stats.js';
import { ITEMS } from './items.js';
import { Projectile } from './entities.js';

export function hasPassive(unit, id) {
  if (!unit.items) return false;
  for (const s of unit.items) if (s && ITEMS[s.id] && ITEMS[s.id].passive === id) return true;
  return false;
}

export function isTargetable(game, unit, byTeam) {
  if (!unit || !unit.alive) return false;
  if (unit.untargetable) return false;
  if (unit.kind === 'structure' && !game.isStructureTargetable(unit)) return false;
  if (byTeam !== undefined && unit.team !== byTeam && !unit.visibleTo[byTeam]) return false;
  return true;
}

export function damageColor(type) {
  return type === 'physical' ? '#ffb347' : type === 'magic' ? '#c084fc' : '#f8fafc';
}

// Central damage pipeline. Returns the post-mitigation damage actually removed from health.
export function dealDamage(game, src, tgt, rawAmount, type, opts = {}) {
  if (!tgt || !tgt.alive || !(rawAmount > 0)) return 0;
  if (tgt.invulnerable) return 0;
  if (tgt.kind === 'structure') {
    if (!game.isStructureTargetable(tgt)) return 0;
    if (opts.ability && !opts.canHitStructures) return 0;
  }
  const srcStats = src ? src.ensureStats() : null;
  const tgtStats = tgt.ensureStats();
  let amount = rawAmount;
  if (srcStats && srcStats.dmgAmp) amount *= 1 + srcStats.dmgAmp;
  amount = mitigate(amount, type, srcStats, tgtStats);
  if (tgtStats.dmgReduction) amount *= 1 - tgtStats.dmgReduction;
  if (opts.attack && tgtStats.attackDmgReduction) amount *= 1 - tgtStats.attackDmgReduction;
  if (tgt.def && tgt.def.hooks && tgt.def.hooks.modifyIncoming) amount = tgt.def.hooks.modifyIncoming(game, tgt, src, amount, type, opts);
  amount = tgt.absorbWithShields(amount);
  const before = tgt.hp;
  tgt.hp -= amount;
  const dealt = before - Math.max(0, tgt.hp);

  const now = game.time;
  tgt.lastDamageTime = now;
  tgt.lastCombatTime = now;
  if (src) {
    src.lastCombatTime = now;
    if (src.kind === 'champion') {
      tgt.recentDamagers.set(src.id, now);
      if (tgt.kind === 'champion') src.damageDealt += dealt;
      if (src.stealthed && !opts.keepStealth) src.removeBuff('stealth');
    }
    if (src.kind === 'champion' && tgt.kind === 'champion') game.onChampionAggro(src, tgt);
    if (opts.attack && srcStats && srcStats.lifesteal > 0 && tgt.kind !== 'structure') {
      healUnit(game, src, src, dealt * srcStats.lifesteal, { silent: true });
    }
  }
  if (tgt.recall) {
    tgt.recall = null;
    if (tgt.isPlayer) game.pushEvent({ type: 'notice', text: 'Recall interrupted' });
  }
  if (tgt.kind === 'monster') game.onMonsterDamaged(tgt, src);
  if (tgt.kind === 'champion' && tgt.def.hooks && tgt.def.hooks.damaged) tgt.def.hooks.damaged(game, tgt, src, dealt, type, opts);

  if (dealt > 0 && game.showDamageNumbers && ((src && src.isPlayer) || tgt.isPlayer)) {
    game.fx.push({
      kind: 'text', x: tgt.x + (game.rng() - 0.5) * 30, y: tgt.y - tgt.radius - 10,
      text: String(Math.round(dealt)), color: damageColor(type), dur: 0.9, rise: 45,
      size: opts.crit ? 20 : src && src.isPlayer ? 15 : 12, bold: !!opts.crit,
    });
  }
  if (opts.attack && !opts.reflected && src && src.alive && src.kind !== 'structure' && hasPassive(tgt, 'thornmail')) {
    dealDamage(game, tgt, src, 25 + 0.1 * tgtStats.armor, 'magic', { reflected: true });
  }
  if (opts.ability && src && hasPassive(src, 'rylais') && tgt.kind !== 'structure') {
    tgt.addBuff({ id: 'rylais_slow', name: 'Chilled', duration: 1, slow: 0.3, harmful: true });
  }
  if (tgt.hp <= 0) killUnit(game, tgt, src);
  return dealt;
}

export function healUnit(game, src, tgt, amount, opts = {}) {
  if (!tgt || !tgt.alive || !(amount > 0)) return 0;
  if (src && src !== tgt && src.stats) amount *= 1 + src.ensureStats().healPower;
  else if (src && src === tgt && src.stats && opts.ability) amount *= 1 + src.ensureStats().healPower;
  const before = tgt.hp;
  tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
  const healed = tgt.hp - before;
  if (healed > 1 && !opts.silent && tgt.kind === 'champion' && game.showDamageNumbers && tgt.isPlayer) {
    game.fx.push({ kind: 'text', x: tgt.x, y: tgt.y - tgt.radius - 10, text: `+${Math.round(healed)}`, color: '#4ade80', dur: 0.9, rise: 40, size: 13 });
  }
  return healed;
}

export function restoreMana(tgt, amount) {
  if (!tgt.alive) return;
  tgt.mana = Math.min(tgt.maxMana, tgt.mana + amount);
}

export function attackPeriod(unit) {
  return 1 / unit.ensureStats().attackSpeed;
}

export function tryStartAttack(game, unit, target) {
  if (!unit.canAttack() || unit.attackCd > 0 || unit.windup) return false;
  if (unit.castLock > 0) return false;
  if (!isTargetable(game, target, unit.team)) return false;
  if (!unit.inAttackRange(target)) return false;
  const period = attackPeriod(unit);
  const windup = Math.max(ATTACK.minWindup, period * ATTACK.windupFraction);
  unit.windup = { target, remaining: windup, total: windup };
  unit.attackCd = period;
  unit.facing = Math.atan2(target.y - unit.y, target.x - unit.x);
  return true;
}

export function cancelAttack(unit) {
  if (unit.windup) {
    unit.windup = null;
    unit.attackCd = 0;
  }
}

export function updateAttackWindup(game, unit, dt) {
  const w = unit.windup;
  if (!w) return;
  if (!w.target.alive || !unit.canAttack()) {
    unit.windup = null;
    unit.attackCd = 0;
    return;
  }
  w.remaining -= dt;
  if (w.remaining <= 0) {
    unit.windup = null;
    finishAttack(game, unit, w.target);
  }
}

export function finishAttack(game, unit, target) {
  if (!isTargetable(game, target, unit.team)) return;
  if (unit.ranged) {
    const vis = unit.attackVisual || { kind: 'orb', color: '#e5e7eb', size: 6, speed: 1500 };
    game.addProjectile(new Projectile({
      x: unit.x, y: unit.y, team: unit.team, source: unit, target, speed: vis.speed || 1500,
      hitRadius: 10, visual: vis, spawnTime: game.time,
      onHit: (g, u) => applyAttackHit(g, unit, u),
    }));
    game.fx.push({ kind: 'attack', x: unit.x, y: unit.y, id: unit.id });
  } else {
    applyAttackHit(game, unit, target);
    game.fx.push({ kind: 'melee', x: target.x, y: target.y, from: unit.id, r: target.radius });
  }
}

export function applyAttackHit(game, unit, target, extra = {}) {
  if (!target.alive || !unit.alive) return 0;
  const s = unit.ensureStats();
  let dmg = s.ad * (extra.mult || 1);
  let crit = false;
  if (unit.kind === 'champion' && s.crit > 0 && game.rng() < s.crit) {
    dmg *= s.critDmg;
    crit = true;
  }
  const ctx = { bonusPhysical: 0, bonusMagic: 0, bonusTrue: 0, crit, damageMult: 1, target };
  if (unit.kind === 'structure') {
    if (target.kind === 'champion') {
      if (unit.heatTarget === target.id) unit.heatCount++;
      else {
        unit.heatTarget = target.id;
        unit.heatCount = 0;
      }
      ctx.damageMult *= 1 + Math.min(TOWER.heatMax, unit.heatCount * TOWER.heatPerShot);
    } else {
      unit.heatTarget = null;
      unit.heatCount = 0;
    }
  }
  if (unit.kind === 'champion') {
    if (unit.def.hooks && unit.def.hooks.attackHit) unit.def.hooks.attackHit(game, unit, target, ctx);
    if (hasPassive(unit, 'nashors')) ctx.bonusMagic += 15 + 0.2 * s.ap;
    if (unit.spellbladeReady && hasPassive(unit, 'spellblade')) {
      ctx.bonusPhysical += 1.5 * s.baseAd;
      unit.spellbladeReady = false;
      unit.spellbladeCd = 1.5;
      game.fx.push({ kind: 'burst', x: target.x, y: target.y, color: '#fbbf24', dur: 0.35, count: 8 });
    }
    if (unit.getBuff('red_buff') && target.kind !== 'structure') {
      target.addBuff({ id: 'red_burn', name: 'Crest of Cinders', duration: 3, slow: 0.1, harmful: true, source: unit, tickInterval: 1,
        onTick: (g, t, b) => dealDamage(g, b.source, t, 8 + 2 * (b.source.level || 1), 'true', { dot: true }) });
    }
    if (unit.getBuff('baron_buff') && target.kind === 'structure') ctx.damageMult *= 1.2;
  }
  dmg *= ctx.damageMult;
  const dealt = dealDamage(game, unit, target, dmg + ctx.bonusPhysical, 'physical', { attack: true, crit, ...extra.opts });
  if (ctx.bonusMagic > 0 && target.alive) dealDamage(game, unit, target, ctx.bonusMagic, 'magic', { attack: true, onHit: true });
  if (ctx.bonusTrue > 0 && target.alive) dealDamage(game, unit, target, ctx.bonusTrue, 'true', { attack: true, onHit: true });
  if (crit) game.fx.push({ kind: 'burst', x: target.x, y: target.y, color: '#fde047', dur: 0.3, count: 6 });
  if (unit.kind === 'champion' && unit.def.hooks && unit.def.hooks.afterAttack) unit.def.hooks.afterAttack(game, unit, target, ctx);
  return dealt;
}

export function respawnTime(level, time) {
  const t = RESPAWN.base + RESPAWN.perLevel * level + Math.max(0, (time - 900) / 60) * 1.5;
  return Math.min(RESPAWN.max, t);
}

export function grantGold(game, champ, amount, reason = 'other') {
  if (!champ || amount <= 0) return;
  champ.gold += amount;
  champ.totalGold += amount;
  if (champ.isPlayer && reason !== 'passive' && game.showDamageNumbers) {
    game.fx.push({ kind: 'text', x: champ.x, y: champ.y - champ.radius - 30, text: `+${Math.round(amount)}g`, color: '#fbbf24', dur: 1.1, rise: 35, size: 13 });
  }
}

export function grantXp(game, champ, amount) {
  if (!champ || amount <= 0 || champ.level >= MAX_LEVEL) return;
  champ.xp += amount;
  while (champ.level < MAX_LEVEL && champ.xp >= xpToNextLevel(champ.level)) {
    champ.xp -= xpToNextLevel(champ.level);
    champ.level++;
    champ.skillPoints++;
    champ.statsDirty = true;
    champ.ensureStats();
    game.pushEvent({ type: 'levelup', unit: champ.id, level: champ.level });
    game.fx.push({ kind: 'levelup', x: champ.x, y: champ.y, id: champ.id, dur: 1.2 });
    if (champ.def.hooks && champ.def.hooks.levelUp) champ.def.hooks.levelUp(game, champ);
  }
  if (champ.level >= MAX_LEVEL) champ.xp = 0;
}

export function shareXp(game, team, x, y, amount, exclude = null) {
  const near = [];
  for (const c of game.champions) {
    if (c.team !== team || !c.alive || c === exclude) continue;
    if (Math.hypot(c.x - x, c.y - y) <= XP.shareRadius) near.push(c);
  }
  if (near.length === 0) return;
  const share = near.length === 1 ? 1 : near.length === 2 ? 0.65 : 0.5;
  for (const c of near) grantXp(game, c, amount * share);
}

export function killUnit(game, unit, killer) {
  if (!unit.alive) return;
  unit.alive = false;
  unit.hp = 0;
  unit.windup = null;
  unit.target = null;
  unit.dash = null;
  unit.moveTarget = null;
  unit.path = null;
  const now = game.time;
  let creditChamp = killer && killer.kind === 'champion' && killer.team !== unit.team ? killer : null;
  if (!creditChamp) {
    let bestT = -Infinity;
    for (const [id, t] of unit.recentDamagers) {
      if (now - t > TIMING.assistWindow) continue;
      const c = game.unitById(id);
      if (c && c.kind === 'champion' && c.team !== unit.team && t > bestT) {
        bestT = t;
        creditChamp = c;
      }
    }
  }
  switch (unit.kind) {
    case 'minion': {
      if (killer && killer.kind === 'champion' && killer.team !== unit.team) {
        grantGold(game, killer, unit.gold, 'cs');
        killer.cs++;
      }
      shareXp(game, 1 - unit.team, unit.x, unit.y, unit.xp);
      break;
    }
    case 'monster':
      game.onMonsterKilled(unit, killer, creditChamp);
      break;
    case 'champion':
      championDeath(game, unit, creditChamp, killer);
      break;
    case 'structure':
      game.onStructureDestroyed(unit, killer, creditChamp);
      break;
    default:
      break;
  }
  unit.clearBuffs();
  unit.recentDamagers.clear();
  game.fx.push({ kind: 'death', x: unit.x, y: unit.y, r: unit.radius, team: unit.team, ukind: unit.kind, dur: 0.8 });
}

function championDeath(game, victim, creditChamp, killer) {
  const now = game.time;
  victim.deaths++;
  victim.deathTime = now;
  victim.respawnTimer = respawnTime(victim.level, now);
  victim.order = null;
  victim.recall = null;
  victim.channel = null;
  victim.castLock = 0;
  victim.killStreak = 0;
  const assisters = [];
  for (const [id, t] of victim.recentDamagers) {
    if (now - t > TIMING.assistWindow) continue;
    const c = game.unitById(id);
    if (c && c.kind === 'champion' && c.team !== victim.team && c !== creditChamp) assisters.push(c);
  }
  let killGold = GOLD.kill;
  let firstBlood = false;
  if (!game.firstBlood && creditChamp) {
    game.firstBlood = true;
    firstBlood = true;
    killGold += GOLD.firstBloodBonus;
  }
  const xp = XP.kill + XP.killPerLevel * victim.level;
  if (creditChamp) {
    creditChamp.kills++;
    creditChamp.killStreak = (creditChamp.killStreak || 0) + 1;
    grantGold(game, creditChamp, killGold, 'kill');
    grantXp(game, creditChamp, xp);
    game.teamStats[creditChamp.team].kills++;
  }
  for (const a of assisters) {
    a.assists++;
    grantGold(game, a, Math.round(GOLD.assistPool / assisters.length), 'assist');
    grantXp(game, a, Math.round(xp * 0.5));
  }
  let killerName = 'the environment';
  if (creditChamp) killerName = creditChamp.name;
  else if (killer && killer.kind === 'structure') killerName = 'a turret';
  else if (killer && killer.kind === 'minion') killerName = 'minions';
  else if (killer && killer.kind === 'monster') killerName = killer.name;
  game.pushEvent({
    type: 'kill', firstBlood,
    killerId: creditChamp ? creditChamp.id : null, killerName, killerTeam: creditChamp ? creditChamp.team : 1 - victim.team,
    victimId: victim.id, victimName: victim.name, victimTeam: victim.team, victimIsPlayer: victim.isPlayer,
    killerIsPlayer: !!(creditChamp && creditChamp.isPlayer), assists: assisters.map((a) => a.name),
  });
}
