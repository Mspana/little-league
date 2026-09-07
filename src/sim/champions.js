// Champion roster: base stats, passives, four abilities each, bot hints and item builds.
import {
  enemiesNear, alliesNear, lowestHp, clampAim, aimDir, face, skillshot, fanSkillshots, damageArea,
  applySlow, applyStun, applyRoot, applySilence, applyTaunt, dash, blink, lineTargets, ringFx, coneFx, beamFx,
} from './abilities.js';
import { dealDamage, healUnit, isTargetable } from './combat.js';
import { Projectile } from './entities.js';

const R = (v) => Math.round(v);
const rankVal = (arr, rank) => arr[Math.max(0, Math.min(arr.length - 1, rank - 1))];

// Predicts where a moving target will be when a projectile of `speed` arrives.
export function leadPoint(from, target, speed) {
  const d = Math.hypot(target.x - from.x, target.y - from.y);
  const t = speed > 0 ? Math.min(1.2, d / speed) : 0;
  return { x: target.x + (target.vx || 0) * t, y: target.y + (target.vy || 0) * t, target };
}

function awayFrom(me, threat, distance) {
  const dx = me.x - threat.x;
  const dy = me.y - threat.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: me.x + (dx / d) * distance, y: me.y + (dy / d) * distance };
}

function enemyChampInRange(ctx, range) {
  for (const e of ctx.enemyChamps) if (ctx.me.distTo(e) - e.radius <= range) return e;
  return null;
}

function lowestEnemyChampInRange(ctx, range) {
  let best = null;
  for (const e of ctx.enemyChamps) {
    if (ctx.me.distTo(e) - e.radius > range) continue;
    if (!best || e.hp < best.hp) best = e;
  }
  return best;
}

function minionClusterPoint(game, me, range, radius, minCount) {
  const minions = enemiesNear(game, me.team, me.x, me.y, range, {}).filter((u) => u.kind === 'minion');
  let best = null;
  let bestCount = minCount - 1;
  for (const m of minions) {
    let count = 0;
    for (const o of minions) if (Math.hypot(o.x - m.x, o.y - m.y) <= radius) count++;
    if (count > bestCount) {
      bestCount = count;
      best = m;
    }
  }
  return best ? { x: best.x, y: best.y, target: best, count: bestCount } : null;
}

// ---------------------------------------------------------------- Aria
const aria = {
  id: 'aria', name: 'Aria', title: 'the Frost Archer', cls: 'Marksman', roles: ['adc', 'mid'],
  ranged: true, radius: 32, color: '#7dd3fc', icon: 'bow',
  attackVisual: { kind: 'arrow', color: '#bae6fd', size: 16, speed: 2000 },
  base: { hp: 570, hpGrowth: 95, hpRegen: 0.8, hpRegenGrowth: 0.1, mana: 280, manaGrowth: 35, manaRegen: 1.4, manaRegenGrowth: 0.12, ad: 60, adGrowth: 3, armor: 26, armorGrowth: 4.2, mr: 30, mrGrowth: 1.3, as: 0.66, asGrowth: 0.03, range: 600, ms: 325 },
  passive: { name: 'Frost Shot', desc: 'Basic attacks slow enemies by 20% for 1.5 seconds. Empowered by Ranger\'s Focus.' },
  defaultSpells: ['flash', 'heal'],
  skillOrder: ['W', 'Q', 'E', 'W', 'W', 'R', 'W', 'Q', 'W', 'Q', 'R', 'Q', 'Q', 'E', 'E', 'R', 'E', 'E'],
  build: ['dorans_blade', 'potion', 'potion', 'berserkers', 'bf_sword', 'infinity_edge', 'phantom_dancer', 'bloodthirster', 'last_whisper'],
  hooks: {
    attackHit(game, c, target, ctx) {
      applySlow(target, 'frost_shot', 0.2, 1.5, c);
      if (c.getBuff('rangers_focus')) ctx.damageMult *= 1.1;
    },
  },
  abilities: {
    Q: {
      name: "Ranger's Focus", type: 'self', maxRank: 5, cooldown: [18, 17, 16, 15, 14], cost: [50, 50, 50, 50, 50], range: 0,
      desc: (r) => `For 6 seconds, gain ${R(rankVal([25, 30, 35, 40, 45], r))}% attack speed and basic attacks deal 10% more damage.`,
      cast(game, c, aim, rank) {
        c.addBuff({ id: 'rangers_focus', name: "Ranger's Focus", duration: 6, mods: { as: rankVal([0.25, 0.3, 0.35, 0.4, 0.45], rank) }, visual: 'focus' });
        ringFx(game, c.x, c.y, 60, '#bae6fd', 0.4);
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.target && ctx.target.kind === 'champion' && c.inAttackRange(ctx.target, 100)) return {};
        if (ctx.target && ctx.target.kind === 'structure' && c.inAttackRange(ctx.target, 50) && ctx.manaPct > 0.5) return {};
        return null;
      },
    },
    W: {
      name: 'Volley', type: 'skillshot', maxRank: 5, cooldown: [12, 10, 8, 6, 4], cost: [50, 50, 50, 50, 50], range: 1200,
      desc: (r, c) => `Fires 7 arrows in a cone, each dealing ${R(rankVal([20, 35, 50, 65, 80], r) + (c ? c.stats.ad : 0))} physical damage (${rankVal([20, 35, 50, 65, 80], r)} + 100% AD) and slowing by 30%. Enemies can only be hit once.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([20, 35, 50, 65, 80], rank) + c.stats.ad;
        fanSkillshots(game, c, aim, 7, Math.PI * 0.28, {
          speed: 1500, range: 1200, width: 60, visual: { kind: 'arrow', color: '#e0f2fe', size: 14 },
          onHit: (g, u) => {
            dealDamage(g, c, u, dmg, 'physical', { ability: true });
            applySlow(u, 'volley_slow', 0.3, 1.5, c);
          },
        });
        coneFx(game, c.x, c.y, Math.atan2(aim.y - c.y, aim.x - c.x), Math.PI * 0.28, 300, '#bae6fd', 0.25);
        return true;
      },
      ai(game, c, ctx) {
        const e = enemyChampInRange(ctx, 1100);
        if (e) return leadPoint(c, e, 1500);
        if (ctx.manaPct > 0.6 && ctx.state !== 'retreat') {
          const cl = minionClusterPoint(game, c, 900, 250, 3);
          if (cl) return cl;
        }
        return null;
      },
    },
    E: {
      name: 'Hawk Step', type: 'point', maxRank: 5, cooldown: [20, 18, 16, 14, 12], cost: [60, 60, 60, 60, 60], range: 350,
      desc: () => 'Dash 350 units toward the cursor.',
      cast(game, c, aim) {
        const p = clampAim(c, aim, 350);
        dash(game, c, p.x, p.y, 1300, { color: '#bae6fd' });
        return true;
      },
      ai(game, c, ctx) {
        const e = ctx.nearestEnemyChamp;
        if (ctx.state === 'retreat' && e && c.distTo(e) < 550) return awayFrom(c, e, 350);
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && ctx.target.hpPct < 0.3 && !c.inAttackRange(ctx.target) && c.distTo(ctx.target) < 900) {
          const d = aimDir(c, ctx.target);
          return { x: c.x + d.x * 350, y: c.y + d.y * 350 };
        }
        return null;
      },
    },
    R: {
      name: 'Crystal Arrow', type: 'skillshot', maxRank: 3, cooldown: [100, 80, 60], cost: [100, 100, 100], range: 5000,
      desc: (r, c) => `Fires a giant arrow across the map. The first enemy champion hit takes ${R(rankVal([200, 400, 600], r) + (c ? c.stats.ap : 0))} magic damage (${rankVal([200, 400, 600], r)} + 100% AP) and is stunned for 1 to 3.5 seconds based on distance travelled. Nearby enemies are slowed by 50%.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([200, 400, 600], rank) + c.stats.ap;
        skillshot(game, c, aim, {
          speed: 1600, range: 5000, width: 130, championsOnly: true, visual: { kind: 'arrow', color: '#7dd3fc', size: 34, glow: true },
          onHit: (g, u, p) => {
            dealDamage(g, c, u, dmg, 'magic', { ability: true });
            applyStun(u, 'crystal_arrow', Math.max(1, Math.min(3.5, 1 + p.traveled / 1000)), c);
            for (const o of enemiesNear(g, c.team, u.x, u.y, 250, { ignoreVision: true })) if (o !== u) applySlow(o, 'crystal_slow', 0.5, 3, c);
            ringFx(g, u.x, u.y, 250, '#7dd3fc', 0.5);
          },
        });
        return true;
      },
      ai(game, c, ctx) {
        let best = null;
        for (const e of ctx.enemyChamps) {
          const d = c.distTo(e);
          if (d > 2200) continue;
          const want = e.hpPct < 0.5 || (ctx.state === 'fight' && ctx.enemyChamps.length >= 2 && d < 1200);
          if (want && (!best || e.hp < best.hp)) best = e;
        }
        return best ? leadPoint(c, best, 1600) : null;
      },
    },
  },
};

// ---------------------------------------------------------------- Garrick
const garrick = {
  id: 'garrick', name: 'Garrick', title: 'the Ironclad', cls: 'Fighter', roles: ['top', 'jungle'],
  ranged: false, radius: 35, color: '#fbbf24', icon: 'sword',
  base: { hp: 620, hpGrowth: 100, hpRegen: 1.6, hpRegenGrowth: 0.15, mana: 300, manaGrowth: 40, manaRegen: 1.5, manaRegenGrowth: 0.12, ad: 66, adGrowth: 4, armor: 36, armorGrowth: 4.5, mr: 32, mrGrowth: 2, as: 0.625, asGrowth: 0.025, range: 175, ms: 340 },
  passive: { name: 'Perseverance', desc: 'After 8 seconds without taking damage, regenerates 1.5% max health per second.' },
  defaultSpells: ['flash', 'ignite'],
  skillOrder: ['Q', 'E', 'W', 'E', 'E', 'R', 'E', 'Q', 'E', 'Q', 'R', 'Q', 'Q', 'W', 'W', 'R', 'W', 'W'],
  build: ['dorans_blade', 'potion', 'potion', 'steelcaps', 'pickaxe', 'trinity_force', 'black_cleaver', 'sunfire', 'spirit_visage', 'warmogs'],
  hooks: {
    update(game, c, dt) {
      if (game.time - c.lastDamageTime > 8 && c.hp < c.maxHp) healUnit(game, c, c, c.maxHp * 0.015 * dt, { silent: true });
    },
    attackHit(game, c, target, ctx) {
      const b = c.getBuff('decisive_strike');
      if (b) {
        ctx.bonusPhysical += b.data.bonus;
        applySilence(target, 'decisive_silence', 1.5, c);
        c.removeBuff('decisive_strike');
        game.fx.push({ kind: 'burst', x: target.x, y: target.y, color: '#fbbf24', dur: 0.35, count: 10 });
      }
    },
  },
  abilities: {
    Q: {
      name: 'Decisive Strike', type: 'self', maxRank: 5, cooldown: [12, 11, 10, 9, 8], cost: [30, 30, 30, 30, 30], range: 0,
      desc: (r, c) => `Removes slows and gain 30% move speed for 3 seconds. The next basic attack within 4.5 seconds deals ${R(rankVal([30, 60, 90, 120, 150], r) + (c ? c.stats.ad * 0.5 : 0))} bonus physical damage (${rankVal([30, 60, 90, 120, 150], r)} + 50% AD) and silences for 1.5 seconds.`,
      cast(game, c, aim, rank) {
        c.buffs = c.buffs.filter((b) => !(b.slow > 0));
        c.statsDirty = true;
        c.addBuff({ id: 'decisive_speed', name: 'Decisive Strike', duration: 3, mods: { msPct: 0.3 }, visual: 'haste' });
        c.addBuff({ id: 'decisive_strike', name: 'Decisive Strike', duration: 4.5, data: { bonus: rankVal([30, 60, 90, 120, 150], rank) + c.stats.ad * 0.5 }, visual: 'empowered' });
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && c.distTo(ctx.target) < 700) return {};
        if (ctx.state === 'retreat' && ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 500) return {};
        if ((ctx.state === 'lane' || ctx.state === 'push') && ctx.target && ctx.manaPct > 0.6 && c.inAttackRange(ctx.target, 150)) return {};
        return null;
      },
    },
    W: {
      name: 'Bulwark', type: 'self', maxRank: 5, cooldown: [20, 19, 18, 17, 16], cost: [40, 40, 40, 40, 40], range: 0,
      desc: (r, c) => `Gain a shield that absorbs ${R(rankVal([70, 110, 150, 190, 230], r) + (c ? c.maxHp * 0.08 : 0))} damage (${rankVal([70, 110, 150, 190, 230], r)} + 8% max health) for 4 seconds.`,
      cast(game, c, aim, rank) {
        c.addShield(rankVal([70, 110, 150, 190, 230], rank) + c.maxHp * 0.08, 4, 'bulwark');
        ringFx(game, c.x, c.y, c.radius + 20, '#fde68a', 0.5);
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.hpPct < 0.7 && (ctx.state === 'fight' || ctx.state === 'retreat') && game.time - c.lastDamageTime < 1.5) return {};
        return null;
      },
    },
    E: {
      name: 'Judgment', type: 'self', maxRank: 5, cooldown: [14, 13, 12, 11, 10], cost: [50, 50, 50, 50, 50], range: 0,
      desc: (r, c) => `Spin for 3 seconds, dealing ${R((rankVal([12, 18, 24, 30, 36], r) + (c ? c.stats.ad * 0.35 : 0)) * 9)} total physical damage to nearby enemies (${rankVal([12, 18, 24, 30, 36], r)} + 35% AD per tick). Cannot basic attack while spinning.`,
      cast(game, c, aim, rank) {
        const tick = rankVal([12, 18, 24, 30, 36], rank) + c.stats.ad * 0.35;
        c.windup = null;
        c.addBuff({
          id: 'judgment', name: 'Judgment', duration: 3, flags: { disarm: true }, visual: 'spin', tickInterval: 0.333,
          onTick: (g, u) => {
            damageArea(g, u, u.x, u.y, 320, tick, 'physical', {});
          },
        });
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.state === 'fight' && ctx.target && c.distTo(ctx.target) < 380) return {};
        if (ctx.state === 'retreat' && ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 350) return {};
        if (ctx.manaPct > 0.4 && (ctx.state === 'lane' || ctx.state === 'jungle' || ctx.state === 'push')) {
          const n = enemiesNear(game, c.team, c.x, c.y, 320, {}).length;
          if (n >= 3 || (ctx.state === 'jungle' && n >= 1)) return {};
        }
        return null;
      },
    },
    R: {
      name: 'Execution', type: 'unit', targetKind: 'enemyChampion', maxRank: 3, cooldown: [120, 100, 80], cost: [100, 100, 100], range: 400,
      desc: (r) => `Strike an enemy champion for ${rankVal([150, 300, 450], r)} plus ${R(rankVal([0.25, 0.3, 0.35], r) * 100)}% of their missing health as true damage.`,
      damage(c, target, rank) {
        return rankVal([150, 300, 450], rank) + rankVal([0.25, 0.3, 0.35], rank) * (target.maxHp - target.hp);
      },
      cast(game, c, aim, rank) {
        const t = aim.target;
        if (!t || t.kind !== 'champion' || !isTargetable(game, t, c.team)) return false;
        face(c, t);
        dealDamage(game, c, t, this.damage(c, t, rank), 'true', { ability: true });
        beamFx(game, c.x, c.y, t.x, t.y, '#fbbf24', 14, 0.3);
        game.fx.push({ kind: 'burst', x: t.x, y: t.y, color: '#f97316', dur: 0.5, count: 16 });
        return true;
      },
      ai(game, c, ctx) {
        for (const e of ctx.enemyChamps) {
          if (c.distTo(e) - e.radius > 400) continue;
          const dmg = this.damage(c, e, c.rank('R'));
          if (e.hp <= dmg * 1.05 || e.hpPct < 0.3) return { target: e };
        }
        return null;
      },
    },
  },
};

// ---------------------------------------------------------------- Lyra
const lyra = {
  id: 'lyra', name: 'Lyra', title: 'the Arcanist', cls: 'Mage', roles: ['mid', 'adc'],
  ranged: true, radius: 30, color: '#c084fc', icon: 'orb',
  attackVisual: { kind: 'orb', color: '#d8b4fe', size: 9, speed: 1600 },
  base: { hp: 560, hpGrowth: 88, hpRegen: 1.1, hpRegenGrowth: 0.1, mana: 480, manaGrowth: 45, manaRegen: 1.8, manaRegenGrowth: 0.15, ad: 55, adGrowth: 3, armor: 22, armorGrowth: 3.8, mr: 30, mrGrowth: 1.3, as: 0.625, asGrowth: 0.02, range: 550, ms: 330 },
  passive: { name: 'Arcane Surge', desc: 'After casting an ability, the next basic attack within 5 seconds deals 20 (+25% AP) bonus magic damage.' },
  defaultSpells: ['flash', 'ignite'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
  build: ['dorans_ring', 'potion', 'potion', 'sorcerers', 'blasting_wand', 'ludens', 'rabadons', 'void_staff', 'rylais', 'morellonomicon'],
  hooks: {
    abilityCast(game, c) {
      c.addBuff({ id: 'arcane_surge', name: 'Arcane Surge', duration: 5, visual: 'empowered' });
    },
    attackHit(game, c, target, ctx) {
      if (c.getBuff('arcane_surge')) {
        ctx.bonusMagic += 20 + 0.25 * c.stats.ap;
        c.removeBuff('arcane_surge');
      }
    },
  },
  abilities: {
    Q: {
      name: 'Arcane Bolt', type: 'skillshot', maxRank: 5, cooldown: [7, 6.5, 6, 5.5, 5], cost: [55, 60, 65, 70, 75], range: 1000,
      desc: (r, c) => `Fires a bolt that deals ${R(rankVal([70, 110, 150, 190, 230], r) + (c ? c.stats.ap * 0.7 : 0))} magic damage (${rankVal([70, 110, 150, 190, 230], r)} + 70% AP) to the first enemy hit.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([70, 110, 150, 190, 230], rank) + c.stats.ap * 0.7;
        skillshot(game, c, aim, {
          speed: 1500, range: 1000, width: 80, visual: { kind: 'bolt', color: '#c084fc', size: 14, glow: true },
          onHit: (g, u) => {
            dealDamage(g, c, u, dmg, 'magic', { ability: true });
            g.fx.push({ kind: 'burst', x: u.x, y: u.y, color: '#c084fc', dur: 0.3, count: 8 });
          },
        });
        return true;
      },
      ai(game, c, ctx) {
        const e = enemyChampInRange(ctx, 950);
        if (e) return leadPoint(c, e, 1500);
        if (ctx.manaPct > 0.5 && ctx.state !== 'retreat') {
          const m = ctx.target && ctx.target.kind === 'minion' && ctx.target.hp > c.stats.ad * 1.5 ? ctx.target : null;
          if (m && c.distTo(m) < 900) return { x: m.x, y: m.y, target: m };
        }
        return null;
      },
    },
    W: {
      name: 'Nova', type: 'point', maxRank: 5, cooldown: [12, 11, 10, 9, 8], cost: [70, 75, 80, 85, 90], range: 900,
      desc: (r, c) => `After a short delay, detonates an area dealing ${R(rankVal([80, 125, 170, 215, 260], r) + (c ? c.stats.ap * 0.65 : 0))} magic damage (${rankVal([80, 125, 170, 215, 260], r)} + 65% AP) and slowing enemies by 30% for 1.5 seconds.`,
      cast(game, c, aim, rank) {
        const p = clampAim(c, aim, 900);
        const dmg = rankVal([80, 125, 170, 215, 260], rank) + c.stats.ap * 0.65;
        face(c, p);
        game.fx.push({ kind: 'ring', x: p.x, y: p.y, r: 220, color: '#a855f7', dur: 0.6, telegraph: true });
        game.schedule(0.6, () => {
          if (!c.alive) return;
          damageArea(game, c, p.x, p.y, 220, dmg, 'magic', { onEach: (u) => applySlow(u, 'nova_slow', 0.3, 1.5, c) });
          game.fx.push({ kind: 'burst', x: p.x, y: p.y, color: '#c084fc', dur: 0.5, count: 18, r: 220 });
          ringFx(game, p.x, p.y, 220, '#e9d5ff', 0.35);
        });
        return true;
      },
      ai(game, c, ctx) {
        const e = enemyChampInRange(ctx, 880);
        if (e) return leadPoint(c, e, 380);
        if (ctx.manaPct > 0.65 && ctx.state !== 'retreat') {
          const cl = minionClusterPoint(game, c, 880, 220, 3);
          if (cl) return cl;
        }
        return null;
      },
    },
    E: {
      name: 'Blink', type: 'point', maxRank: 5, cooldown: [24, 21, 18, 15, 12], cost: [90, 90, 90, 90, 90], range: 425,
      desc: () => 'Teleport 425 units toward the cursor.',
      cast(game, c, aim) {
        const p = clampAim(c, aim, 425);
        blink(game, c, p.x, p.y, { color: '#c084fc' });
        return true;
      },
      ai(game, c, ctx) {
        const e = ctx.nearestEnemyChamp;
        if (ctx.state === 'retreat' && e && c.distTo(e) < 600) {
          const dir = ctx.retreatDir;
          return { x: c.x + dir.x * 425, y: c.y + dir.y * 425 };
        }
        return null;
      },
    },
    R: {
      name: 'Cataclysm', type: 'point', maxRank: 3, cooldown: [120, 100, 80], cost: [100, 100, 100], range: 700,
      desc: (r, c) => `Channel for 2.5 seconds, raining arcane fire on an area. Deals ${R(5 * (rankVal([50, 75, 100], r) + (c ? c.stats.ap * 0.18 : 0)))} total magic damage (${rankVal([50, 75, 100], r)} + 18% AP per half second) and slows enemies inside by 20%.`,
      cast(game, c, aim, rank) {
        const p = clampAim(c, aim, 700);
        const tick = rankVal([50, 75, 100], rank) + c.stats.ap * 0.18;
        face(c, p);
        c.windup = null;
        c.addBuff({
          id: 'cataclysm', name: 'Cataclysm', duration: 2.6, flags: { channel: true }, interruptible: true, tickInterval: 0.5, visual: 'channel',
          data: { x: p.x, y: p.y, r: 400 },
          onTick: (g, u) => {
            damageArea(g, u, p.x, p.y, 400, tick, 'magic', { onEach: (t) => applySlow(t, 'cataclysm_slow', 0.2, 0.6, u) });
            g.fx.push({ kind: 'burst', x: p.x + (g.rng() - 0.5) * 500, y: p.y + (g.rng() - 0.5) * 500, color: '#f0abfc', dur: 0.4, count: 8 });
          },
        });
        game.fx.push({ kind: 'zone', x: p.x, y: p.y, r: 400, color: '#a855f7', dur: 2.6 });
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.state !== 'fight') return null;
        const inRange = ctx.enemyChamps.filter((e) => c.distTo(e) <= 900);
        if (inRange.length === 0) return null;
        let best = null;
        let bestCount = 0;
        for (const e of inRange) {
          const count = inRange.filter((o) => Math.hypot(o.x - e.x, o.y - e.y) <= 350).length;
          if (count > bestCount) {
            bestCount = count;
            best = e;
          }
        }
        const melee = ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 300;
        if (best && (bestCount >= 2 || (best.hpPct < 0.5 && !melee))) return clampAim(c, best, 700);
        return null;
      },
    },
  },
};

// ---------------------------------------------------------------- Vex
const vex = {
  id: 'vex', name: 'Vex', title: 'the Shadow', cls: 'Assassin', roles: ['jungle', 'mid'],
  ranged: false, radius: 32, color: '#a3a3a3', icon: 'dagger',
  base: { hp: 590, hpGrowth: 95, hpRegen: 1.4, hpRegenGrowth: 0.12, mana: 320, manaGrowth: 37, manaRegen: 1.5, manaRegenGrowth: 0.13, ad: 68, adGrowth: 3.5, armor: 30, armorGrowth: 4.2, mr: 39, mrGrowth: 2, as: 0.65, asGrowth: 0.03, range: 125, ms: 345 },
  passive: { name: "Shadow's Edge", desc: 'Attacks and abilities deal 12% more damage to enemies below 40% health.' },
  defaultSpells: ['flash', 'ignite'],
  skillOrder: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E'],
  build: ['dorans_blade', 'potion', 'potion', 'ionian', 'long_sword', 'black_cleaver', 'bloodthirster', 'last_whisper', 'infinity_edge', 'spirit_visage'],
  hooks: {
    attackHit(game, c, target, ctx) {
      if (target.hpPct < 0.4) ctx.damageMult *= 1.12;
    },
  },
  abilities: {
    Q: {
      name: 'Cutthroat', type: 'unit', targetKind: 'enemy', maxRank: 5, cooldown: [10, 9, 8, 7, 6], cost: [50, 50, 50, 50, 50], range: 700,
      desc: (r, c) => `Leap behind the target and stab them for ${R(rankVal([60, 95, 130, 165, 200], r) + (c ? c.stats.ad * 0.6 : 0))} physical damage (${rankVal([60, 95, 130, 165, 200], r)} + 60% AD).`,
      cast(game, c, aim, rank) {
        const t = aim.target;
        if (!t || !isTargetable(game, t, c.team) || t.kind === 'structure') return false;
        const dmg = (rankVal([60, 95, 130, 165, 200], rank) + c.stats.ad * 0.6) * (t.hpPct < 0.4 ? 1.12 : 1);
        const d = aimDir(c, t);
        const land = { x: t.x + d.x * (t.radius + c.radius + 5), y: t.y + d.y * (t.radius + c.radius + 5) };
        dash(game, c, land.x, land.y, 1600, {
          color: '#a3a3a3',
          onArrive: (g) => {
            if (t.alive) {
              dealDamage(g, c, t, dmg, 'physical', { ability: true });
              g.fx.push({ kind: 'burst', x: t.x, y: t.y, color: '#e5e5e5', dur: 0.3, count: 8 });
              c.target = t;
            }
          },
        });
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && c.distTo(ctx.target) - ctx.target.radius <= 700 && !c.inAttackRange(ctx.target)) return { target: ctx.target };
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && ctx.target.hpPct < 0.35 && c.distTo(ctx.target) - ctx.target.radius <= 700) return { target: ctx.target };
        if (ctx.state === 'jungle' && ctx.target && ctx.target.kind === 'monster' && c.distTo(ctx.target) <= 700 && ctx.manaPct > 0.4) return { target: ctx.target };
        return null;
      },
    },
    W: {
      name: 'Fan of Blades', type: 'skillshot', maxRank: 5, cooldown: [9, 8, 7, 6, 5], cost: [60, 65, 70, 75, 80], range: 650,
      desc: (r, c) => `Throws three daggers in a cone, each dealing ${R(rankVal([65, 100, 135, 170, 205], r) + (c ? c.stats.ad * 0.8 : 0))} physical damage (${rankVal([65, 100, 135, 170, 205], r)} + 80% AD). Enemies can only be hit once.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([65, 100, 135, 170, 205], rank) + c.stats.ad * 0.8;
        fanSkillshots(game, c, aim, 3, Math.PI * 0.22, {
          speed: 1400, range: 650, width: 60, visual: { kind: 'dagger', color: '#e5e5e5', size: 14 },
          onHit: (g, u) => dealDamage(g, c, u, dmg * (u.hpPct < 0.4 ? 1.12 : 1), 'physical', { ability: true }),
        });
        coneFx(game, c.x, c.y, Math.atan2(aim.y - c.y, aim.x - c.x), Math.PI * 0.22, 250, '#d4d4d4', 0.2);
        return true;
      },
      ai(game, c, ctx) {
        const e = enemyChampInRange(ctx, 600);
        if (e) return leadPoint(c, e, 1400);
        if (ctx.manaPct > 0.5 && ctx.state !== 'retreat' && ctx.target && ctx.target.kind !== 'champion' && c.distTo(ctx.target) < 600) {
          if (ctx.state === 'jungle' || minionClusterPoint(game, c, 600, 200, 2)) return { x: ctx.target.x, y: ctx.target.y, target: ctx.target };
        }
        return null;
      },
    },
    E: {
      name: 'Shadow Step', type: 'self', maxRank: 5, cooldown: [22, 20, 18, 16, 14], cost: [70, 70, 70, 70, 70], range: 0,
      desc: () => 'Become invisible for 2.5 seconds and gain 30% move speed. Attacking or dealing damage breaks the stealth.',
      cast(game, c) {
        c.addBuff({ id: 'stealth', name: 'Shadow Step', duration: 2.5, flags: { stealth: true }, mods: { msPct: 0.3 }, visual: 'stealth' });
        game.fx.push({ kind: 'burst', x: c.x, y: c.y, color: '#525252', dur: 0.5, count: 12 });
        return true;
      },
      ai(game, c, ctx) {
        const e = ctx.nearestEnemyChamp;
        if (ctx.state === 'retreat' && e && c.distTo(e) < 700) return {};
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && c.distTo(ctx.target) > 500 && c.distTo(ctx.target) < 1000) return {};
        return null;
      },
    },
    R: {
      name: 'Deathmark', type: 'unit', targetKind: 'enemyChampion', maxRank: 3, cooldown: [100, 80, 60], cost: [100, 100, 100], range: 600,
      desc: (r, c) => `Marks an enemy champion. After 1 second the mark detonates for ${R(rankVal([180, 260, 340], r) + (c ? c.stats.ad : 0))} physical damage (${rankVal([180, 260, 340], r)} + 100% AD) plus 12% of their missing health.`,
      cast(game, c, aim, rank) {
        const t = aim.target;
        if (!t || t.kind !== 'champion' || !isTargetable(game, t, c.team)) return false;
        face(c, t);
        t.addBuff({ id: 'deathmark', name: 'Deathmark', duration: 1, harmful: true, source: c, visual: 'mark' });
        const base = rankVal([180, 260, 340], rank) + c.stats.ad;
        game.schedule(1, () => {
          if (!t.alive || !c.alive) return;
          const dmg = (base + 0.12 * (t.maxHp - t.hp)) * (t.hpPct < 0.4 ? 1.12 : 1);
          dealDamage(game, c, t, dmg, 'physical', { ability: true });
          game.fx.push({ kind: 'burst', x: t.x, y: t.y, color: '#ef4444', dur: 0.5, count: 18 });
          ringFx(game, t.x, t.y, 120, '#ef4444', 0.4);
        });
        return true;
      },
      ai(game, c, ctx) {
        for (const e of ctx.enemyChamps) {
          if (c.distTo(e) - e.radius > 600) continue;
          const base = rankVal([180, 260, 340], c.rank('R')) + c.stats.ad;
          if (e.hpPct < 0.5 || e.hp < base * 1.2) return { target: e };
        }
        return null;
      },
    },
  },
};

// ---------------------------------------------------------------- Bramble
const bramble = {
  id: 'bramble', name: 'Bramble', title: 'the Guardian', cls: 'Tank', roles: ['top', 'support', 'jungle'],
  ranged: false, radius: 38, color: '#4ade80', icon: 'tree',
  base: { hp: 650, hpGrowth: 105, hpRegen: 1.8, hpRegenGrowth: 0.15, mana: 310, manaGrowth: 40, manaRegen: 1.6, manaRegenGrowth: 0.13, ad: 62, adGrowth: 3.3, armor: 40, armorGrowth: 4.8, mr: 32, mrGrowth: 2.1, as: 0.62, asGrowth: 0.02, range: 175, ms: 335 },
  passive: { name: 'Rooted Stance', desc: 'Takes 10% reduced damage while standing still.' },
  defaultSpells: ['flash', 'ignite'],
  skillOrder: ['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'],
  build: ['dorans_shield', 'potion', 'potion', 'steelcaps', 'ruby_crystal', 'sunfire', 'thornmail', 'spirit_visage', 'warmogs', 'frozen_heart'],
  hooks: {
    modifyIncoming(game, c, src, amount) {
      return c.moved ? amount : amount * 0.9;
    },
  },
  abilities: {
    Q: {
      name: 'Grasping Roots', type: 'skillshot', maxRank: 5, cooldown: [14, 13, 12, 11, 10], cost: [60, 60, 60, 60, 60], range: 900,
      desc: (r, c) => `Sends out roots that deal ${R(rankVal([70, 115, 160, 205, 250], r) + (c ? c.stats.ap * 0.6 : 0))} magic damage (${rankVal([70, 115, 160, 205, 250], r)} + 60% AP) and root the first enemy hit for ${rankVal([1, 1.25, 1.5, 1.75, 2], r)} seconds.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([70, 115, 160, 205, 250], rank) + c.stats.ap * 0.6;
        const rootDur = rankVal([1, 1.25, 1.5, 1.75, 2], rank);
        skillshot(game, c, aim, {
          speed: 1300, range: 900, width: 70, visual: { kind: 'root', color: '#4ade80', size: 18 },
          onHit: (g, u) => {
            dealDamage(g, c, u, dmg, 'magic', { ability: true });
            applyRoot(u, 'grasping_roots', rootDur, c);
          },
        });
        return true;
      },
      ai(game, c, ctx) {
        const e = lowestEnemyChampInRange(ctx, 850);
        if (e && ctx.state !== 'retreat') return leadPoint(c, e, 1300);
        if (ctx.state === 'retreat' && ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 600) return leadPoint(c, ctx.nearestEnemyChamp, 1300);
        return null;
      },
    },
    W: {
      name: 'Fortify', type: 'self', maxRank: 5, cooldown: [18, 17, 16, 15, 14], cost: [60, 60, 60, 60, 60], range: 0,
      desc: (r, c) => `Gain a shield absorbing ${R(rankVal([100, 150, 200, 250, 300], r) + (c ? c.maxHp * 0.06 : 0))} damage (${rankVal([100, 150, 200, 250, 300], r)} + 6% max health) for 3 seconds and taunt nearby enemies for 1.25 seconds.`,
      cast(game, c, aim, rank) {
        c.addShield(rankVal([100, 150, 200, 250, 300], rank) + c.maxHp * 0.06, 3, 'fortify');
        for (const u of enemiesNear(game, c.team, c.x, c.y, 300, { ignoreVision: true })) if (u.kind !== 'structure') applyTaunt(u, 'fortify_taunt', 1.25, c);
        ringFx(game, c.x, c.y, 300, '#86efac', 0.45);
        return true;
      },
      ai(game, c, ctx) {
        const e = ctx.nearestEnemyChamp;
        if (e && c.distTo(e) < 300 && (ctx.state === 'fight' || ctx.state === 'retreat')) return {};
        if (ctx.hpPct < 0.5 && game.time - c.lastDamageTime < 1.5) return {};
        return null;
      },
    },
    E: {
      name: 'Bramble Aura', type: 'self', maxRank: 5, cooldown: [14, 13, 12, 11, 10], cost: [60, 60, 60, 60, 60], range: 0,
      desc: (r, c) => `For 5 seconds, thorns deal ${R(rankVal([20, 35, 50, 65, 80], r) + (c ? c.stats.ap * 0.3 : 0))} magic damage per second (${rankVal([20, 35, 50, 65, 80], r)} + 30% AP) to enemies within 350 units and slow them by 20%.`,
      cast(game, c, aim, rank) {
        const tick = rankVal([20, 35, 50, 65, 80], rank) + c.stats.ap * 0.3;
        c.addBuff({
          id: 'bramble_aura', name: 'Bramble Aura', duration: 5, visual: 'thorns', tickInterval: 1, data: { r: 350 },
          onTick: (g, u) => damageArea(g, u, u.x, u.y, 350, tick, 'magic', { onEach: (t) => applySlow(t, 'bramble_slow', 0.2, 1.1, u) }),
        });
        return true;
      },
      ai(game, c, ctx) {
        const e = ctx.nearestEnemyChamp;
        if (e && c.distTo(e) < 400 && ctx.state !== 'lane') return {};
        if (ctx.manaPct > 0.4 && (ctx.state === 'lane' || ctx.state === 'jungle' || ctx.state === 'push')) {
          const n = enemiesNear(game, c.team, c.x, c.y, 350, {}).length;
          if (n >= 3 || (ctx.state === 'jungle' && n >= 1)) return {};
        }
        return null;
      },
    },
    R: {
      name: 'Earthquake', type: 'self', maxRank: 3, cooldown: [110, 90, 70], cost: [100, 100, 100], range: 450,
      desc: (r, c) => `After a brief delay, slam the ground, knocking up enemies within 450 units for 1.5 seconds and dealing ${R(rankVal([150, 250, 350], r) + (c ? c.stats.ap * 0.7 : 0))} magic damage (${rankVal([150, 250, 350], r)} + 70% AP).`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([150, 250, 350], rank) + c.stats.ap * 0.7;
        c.castLock = Math.max(c.castLock, 0.5);
        game.fx.push({ kind: 'ring', x: c.x, y: c.y, r: 450, color: '#84cc16', dur: 0.5, telegraph: true });
        game.schedule(0.5, () => {
          if (!c.alive) return;
          damageArea(game, c, c.x, c.y, 450, dmg, 'magic', { onEach: (u) => applyStun(u, 'earthquake', 1.5, c, 'Knocked Up') });
          game.fx.push({ kind: 'shockwave', x: c.x, y: c.y, r: 450, color: '#a3e635', dur: 0.6 });
        });
        return true;
      },
      ai(game, c, ctx) {
        const near = ctx.enemyChamps.filter((e) => c.distTo(e) - e.radius <= 430);
        if (near.length >= 2) return {};
        if (near.length === 1 && ctx.state === 'fight' && (ctx.allyChamps.length >= 1 || near[0].hpPct < 0.5)) return {};
        return null;
      },
    },
  },
};

// ---------------------------------------------------------------- Seren
const seren = {
  id: 'seren', name: 'Seren', title: 'the Songweaver', cls: 'Support', roles: ['support', 'mid'],
  ranged: true, radius: 30, color: '#f9a8d4', icon: 'note',
  attackVisual: { kind: 'note', color: '#fbcfe8', size: 10, speed: 1500 },
  base: { hp: 550, hpGrowth: 85, hpRegen: 1.1, hpRegenGrowth: 0.1, mana: 520, manaGrowth: 50, manaRegen: 2.0, manaRegenGrowth: 0.18, ad: 50, adGrowth: 3, armor: 28, armorGrowth: 3.5, mr: 30, mrGrowth: 1.3, as: 0.64, asGrowth: 0.023, range: 550, ms: 325 },
  passive: { name: 'Power Chord', desc: 'Every third basic attack deals 15 (+20% AP) bonus magic damage and slows the target by 25% for 1 second.' },
  defaultSpells: ['flash', 'heal'],
  skillOrder: ['W', 'Q', 'E', 'W', 'W', 'R', 'W', 'Q', 'W', 'Q', 'R', 'Q', 'Q', 'E', 'E', 'R', 'E', 'E'],
  build: ['dorans_ring', 'potion', 'potion', 'ionian', 'kindlegem', 'ardent_censer', 'locket', 'spirit_visage', 'rabadons', 'rylais'],
  hooks: {
    attackHit(game, c, target, ctx) {
      c.passive.chord = (c.passive.chord || 0) + 1;
      if (c.passive.chord >= 3) {
        c.passive.chord = 0;
        ctx.bonusMagic += 15 + 0.2 * c.stats.ap;
        applySlow(target, 'power_chord', 0.25, 1, c);
        game.fx.push({ kind: 'burst', x: target.x, y: target.y, color: '#f9a8d4', dur: 0.3, count: 6 });
      }
    },
  },
  abilities: {
    Q: {
      name: 'Hymn of Valor', type: 'self', maxRank: 5, cooldown: [8, 8, 8, 8, 8], cost: [50, 55, 60, 65, 70], range: 800,
      desc: (r, c) => `Sends bolts at the two nearest enemies within 800 units (champions first), dealing ${R(rankVal([60, 95, 130, 165, 200], r) + (c ? c.stats.ap * 0.45 : 0))} magic damage (${rankVal([60, 95, 130, 165, 200], r)} + 45% AP) each.`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([60, 95, 130, 165, 200], rank) + c.stats.ap * 0.45;
        const list = enemiesNear(game, c.team, c.x, c.y, 800, {}).sort((a, b) => {
          const pa = a.kind === 'champion' ? 0 : 1;
          const pb = b.kind === 'champion' ? 0 : 1;
          return pa - pb || c.distTo(a) - c.distTo(b);
        });
        if (list.length === 0) return false;
        for (const t of list.slice(0, 2)) {
          game.addProjectile(new Projectile({
            x: c.x, y: c.y, team: c.team, source: c, target: t, speed: 1600, hitRadius: 10, spawnTime: game.time,
            visual: { kind: 'note', color: '#f9a8d4', size: 14, glow: true },
            onHit: (g, u) => dealDamage(g, c, u, dmg, 'magic', { ability: true }),
          }));
        }
        return true;
      },
      ai(game, c, ctx) {
        if (enemyChampInRange(ctx, 780)) return {};
        if (ctx.manaPct > 0.7 && ctx.state !== 'retreat' && ctx.allyChamps.length === 0 && enemiesNear(game, c.team, c.x, c.y, 780, {}).length > 0) return {};
        return null;
      },
    },
    W: {
      name: 'Aria of Perseverance', type: 'self', maxRank: 5, cooldown: [10, 10, 10, 10, 10], cost: [80, 85, 90, 95, 100], range: 1000,
      desc: (r, c) => `Heals yourself and the most wounded nearby ally champion for ${R(rankVal([45, 70, 95, 120, 145], r) + (c ? c.stats.ap * 0.3 : 0))} (${rankVal([45, 70, 95, 120, 145], r)} + 30% AP) and grants a ${R(rankVal([40, 60, 80, 100, 120], r) + (c ? c.stats.ap * 0.25 : 0))} shield for 3 seconds.`,
      cast(game, c, aim, rank) {
        const heal = rankVal([45, 70, 95, 120, 145], rank) + c.stats.ap * 0.3;
        const shield = rankVal([40, 60, 80, 100, 120], rank) + c.stats.ap * 0.25;
        healUnit(game, c, c, heal, { ability: true });
        c.addShield(shield, 3, 'aria_shield');
        const allies = alliesNear(game, c.team, c.x, c.y, 1000, { championsOnly: true }).filter((u) => u !== c);
        const ally = lowestHp(allies);
        if (ally) {
          healUnit(game, c, ally, heal, { ability: true });
          ally.addShield(shield * (1 + c.stats.healPower), 3, 'aria_shield');
          beamFx(game, c.x, c.y, ally.x, ally.y, '#86efac', 6, 0.35);
          ringFx(game, ally.x, ally.y, ally.radius + 15, '#86efac', 0.4);
        }
        ringFx(game, c.x, c.y, c.radius + 15, '#86efac', 0.4);
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.hpPct < 0.7 && game.time - c.lastDamageTime < 4) return {};
        for (const a of ctx.allyChamps) if (a.hpPct < 0.65 && c.distTo(a) <= 1000 && game.time - a.lastDamageTime < 4) return {};
        return null;
      },
    },
    E: {
      name: 'Song of Celerity', type: 'self', maxRank: 5, cooldown: [12, 12, 12, 12, 12], cost: [60, 60, 60, 60, 60], range: 600,
      desc: (r) => `Grants yourself and nearby allies ${rankVal([20, 22, 24, 26, 28], r)}% move speed for 3 seconds.`,
      cast(game, c, aim, rank) {
        const pct = rankVal([0.2, 0.22, 0.24, 0.26, 0.28], rank);
        for (const u of alliesNear(game, c.team, c.x, c.y, 600, { championsOnly: true })) u.addBuff({ id: 'celerity', name: 'Song of Celerity', duration: 3, mods: { msPct: pct }, visual: 'haste' });
        ringFx(game, c.x, c.y, 600, '#f9a8d4', 0.4);
        return true;
      },
      ai(game, c, ctx) {
        if (ctx.state === 'retreat' && ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 800) return {};
        if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && !c.inAttackRange(ctx.target)) return {};
        return null;
      },
    },
    R: {
      name: 'Crescendo', type: 'skillshot', maxRank: 3, cooldown: [140, 120, 100], cost: [100, 100, 100], range: 1000,
      desc: (r, c) => `Strums an irresistible chord in a line, stunning enemies for 1.5 seconds and dealing ${R(rankVal([150, 250, 350], r) + (c ? c.stats.ap * 0.5 : 0))} magic damage (${rankVal([150, 250, 350], r)} + 50% AP).`,
      cast(game, c, aim, rank) {
        const dmg = rankVal([150, 250, 350], rank) + c.stats.ap * 0.5;
        const dir = aimDir(c, aim);
        face(c, aim);
        for (const u of lineTargets(game, c.team, c.x, c.y, dir, 1000, 140, { ignoreVision: true })) {
          dealDamage(game, c, u, dmg, 'magic', { ability: true });
          applyStun(u, 'crescendo', 1.5, c);
        }
        beamFx(game, c.x, c.y, c.x + dir.x * 1000, c.y + dir.y * 1000, '#f9a8d4', 140, 0.45);
        return true;
      },
      ai(game, c, ctx) {
        const inRange = ctx.enemyChamps.filter((e) => c.distTo(e) <= 950);
        if (inRange.length === 0) return null;
        let best = null;
        let bestCount = 0;
        for (const e of inRange) {
          const dir = aimDir(c, e);
          const count = lineTargets(game, c.team, c.x, c.y, dir, 1000, 140, { championsOnly: true }).length;
          if (count > bestCount) {
            bestCount = count;
            best = e;
          }
        }
        if (best && (bestCount >= 2 || (ctx.state === 'fight' && best.hpPct < 0.45) || (ctx.state === 'retreat' && c.distTo(best) < 500))) return { x: best.x, y: best.y };
        return null;
      },
    },
  },
};

export const CHAMPIONS = { aria, garrick, lyra, vex, bramble, seren };
export const CHAMPION_LIST = [aria, garrick, lyra, vex, bramble, seren];

// ---------------------------------------------------------------- Summoner spells
export const SUMMONER_SPELLS = {
  flash: {
    id: 'flash', name: 'Flash', cooldown: 210, type: 'point', range: 400, color: '#fde68a',
    desc: 'Teleports your champion a short distance toward the cursor.',
    cast(game, c, aim) {
      const p = clampAim(c, aim, 400);
      blink(game, c, p.x, p.y, { color: '#fde68a' });
      return true;
    },
    ai(game, c, ctx) {
      const e = ctx.nearestEnemyChamp;
      if (ctx.state === 'retreat' && ctx.hpPct < 0.35 && e && c.distTo(e) < 450) {
        const d = ctx.retreatDir;
        return { x: c.x + d.x * 400, y: c.y + d.y * 400 };
      }
      if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && ctx.target.hpPct < 0.18 && ctx.hpPct > 0.4) {
        const gap = c.distTo(ctx.target) - ctx.target.radius - c.stats.range;
        if (gap > 100 && gap < 400) {
          const d = aimDir(c, ctx.target);
          return { x: c.x + d.x * 400, y: c.y + d.y * 400 };
        }
      }
      return null;
    },
  },
  heal: {
    id: 'heal', name: 'Heal', cooldown: 180, type: 'self', range: 800, color: '#4ade80',
    desc: 'Restores 90 (+15 per level) health to you and the nearest ally champion and grants 30% move speed for 1 second.',
    cast(game, c) {
      const amount = 90 + 15 * c.level;
      healUnit(game, c, c, amount);
      c.addBuff({ id: 'heal_speed', name: 'Heal', duration: 1, mods: { msPct: 0.3 }, visual: 'haste' });
      const allies = alliesNear(game, c.team, c.x, c.y, 800, { championsOnly: true }).filter((u) => u !== c);
      const ally = lowestHp(allies);
      if (ally) {
        healUnit(game, c, ally, amount);
        ally.addBuff({ id: 'heal_speed', name: 'Heal', duration: 1, mods: { msPct: 0.3 }, visual: 'haste' });
      }
      ringFx(game, c.x, c.y, c.radius + 30, '#4ade80', 0.5);
      return true;
    },
    ai(game, c, ctx) {
      if (ctx.hpPct < 0.35 && game.time - c.lastDamageTime < 2) return {};
      for (const a of ctx.allyChamps) if (a.hpPct < 0.25 && c.distTo(a) <= 800 && game.time - a.lastDamageTime < 2) return {};
      return null;
    },
  },
  ignite: {
    id: 'ignite', name: 'Ignite', cooldown: 150, type: 'unit', targetKind: 'enemyChampion', range: 600, color: '#f97316',
    desc: 'Ignites an enemy champion, dealing 70 (+20 per level) true damage over 5 seconds.',
    cast(game, c, aim) {
      const t = aim.target;
      if (!t || t.kind !== 'champion' || !isTargetable(game, t, c.team)) return false;
      const tick = (70 + 20 * c.level) / 5;
      t.addBuff({ id: 'ignite', name: 'Ignite', duration: 5, harmful: true, source: c, tickInterval: 1, visual: 'burn',
        onTick: (g, u, b) => dealDamage(g, b.source, u, tick, 'true', { dot: true }) });
      return true;
    },
    ai(game, c, ctx) {
      for (const e of ctx.enemyChamps) {
        if (c.distTo(e) - e.radius > 600) continue;
        if (e.hpPct < 0.3 || e.hp < (70 + 20 * c.level) * 1.5) return { target: e };
      }
      return null;
    },
  },
  ghost: {
    id: 'ghost', name: 'Ghost', cooldown: 180, type: 'self', range: 0, color: '#93c5fd',
    desc: 'Gain 28% move speed for 8 seconds.',
    cast(game, c) {
      c.addBuff({ id: 'ghost', name: 'Ghost', duration: 8, mods: { msPct: 0.28 }, visual: 'haste' });
      return true;
    },
    ai(game, c, ctx) {
      if (ctx.state === 'retreat' && ctx.nearestEnemyChamp && c.distTo(ctx.nearestEnemyChamp) < 800) return {};
      if (ctx.state === 'fight' && ctx.target && ctx.target.kind === 'champion' && !c.inAttackRange(ctx.target) && c.distTo(ctx.target) < 900) return {};
      return null;
    },
  },
  barrier: {
    id: 'barrier', name: 'Barrier', cooldown: 150, type: 'self', range: 0, color: '#fde047',
    desc: 'Shields you for 105 (+20 per level) damage for 2.5 seconds.',
    cast(game, c) {
      c.addShield(105 + 20 * c.level, 2.5, 'barrier');
      ringFx(game, c.x, c.y, c.radius + 20, '#fde047', 0.5);
      return true;
    },
    ai(game, c, ctx) {
      if (ctx.hpPct < 0.35 && game.time - c.lastDamageTime < 1.5) return {};
      return null;
    },
  },
};
export const SPELL_LIST = Object.values(SUMMONER_SPELLS);
