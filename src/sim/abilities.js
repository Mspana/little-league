// Reusable building blocks for champion abilities and summoner spells.
import { Projectile } from './entities.js';
import { dealDamage, isTargetable } from './combat.js';
import { clamp } from './math.js';

export function unitsNear(game, x, y, r, pred) {
  const out = [];
  const r2 = r * r;
  for (const u of game.units) {
    if (!u.alive) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    if (dx * dx + dy * dy <= r2 && (!pred || pred(u))) out.push(u);
  }
  return out;
}

// Enemies of `team` inside a circle. By default structures are excluded and only visible/targetable units count.
export function enemiesNear(game, team, x, y, r, opts = {}) {
  return unitsNear(game, x, y, r, (u) => {
    if (u.team === team) return false;
    if (u.kind === 'structure' && !opts.structures) return false;
    if (opts.championsOnly && u.kind !== 'champion') return false;
    if (!isTargetable(game, u, opts.ignoreVision ? undefined : team)) return false;
    if (opts.edge && Math.hypot(u.x - x, u.y - y) - u.radius > r) return false;
    return true;
  });
}

export function alliesNear(game, team, x, y, r, opts = {}) {
  return unitsNear(game, x, y, r, (u) => u.team === team && (opts.championsOnly ? u.kind === 'champion' : u.kind !== 'structure'));
}

export function nearest(list, x, y) {
  let best = null;
  let bd = Infinity;
  for (const u of list) {
    const d = Math.hypot(u.x - x, u.y - y);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

export function lowestHp(list) {
  let best = null;
  for (const u of list) if (!best || u.hpPct < best.hpPct) best = u;
  return best;
}

// Clamp an aim point to a maximum range from the caster.
export function clampAim(caster, aim, range) {
  const dx = aim.x - caster.x;
  const dy = aim.y - caster.y;
  const d = Math.hypot(dx, dy);
  if (d <= range || d < 1e-6) return { x: aim.x, y: aim.y };
  return { x: caster.x + (dx / d) * range, y: caster.y + (dy / d) * range };
}

export function aimDir(caster, aim) {
  const dx = aim.x - caster.x;
  const dy = aim.y - caster.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
  return { x: dx / d, y: dy / d };
}

export function face(caster, aim) {
  if (aim && (aim.x !== caster.x || aim.y !== caster.y)) caster.facing = Math.atan2(aim.y - caster.y, aim.x - caster.x);
}

export function skillshot(game, caster, aim, props) {
  const dir = aimDir(caster, aim);
  face(caster, aim);
  const p = new Projectile({
    x: caster.x + dir.x * (props.startOffset || 0),
    y: caster.y + dir.y * (props.startOffset || 0),
    team: caster.team,
    source: caster,
    dx: dir.x,
    dy: dir.y,
    speed: props.speed || 1400,
    maxDist: props.range || 1000,
    hitRadius: props.width ? props.width / 2 : 40,
    pierce: !!props.pierce,
    maxHits: props.maxHits || (props.pierce ? Infinity : 1),
    hitsChampionsOnly: !!props.championsOnly,
    visual: props.visual || { kind: 'orb', color: '#fff', size: 10 },
    onHit: props.onHit,
    onExpire: props.onExpire,
    filter: props.filter || null,
    spawnTime: game.time,
  });
  game.addProjectile(p);
  return p;
}

export function fanSkillshots(game, caster, aim, count, spreadRad, props) {
  const base = Math.atan2(aim.y - caster.y, aim.x - caster.x);
  const hitOnce = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const a = base + t * spreadRad;
    const target = { x: caster.x + Math.cos(a) * 100, y: caster.y + Math.sin(a) * 100 };
    out.push(skillshot(game, caster, target, {
      ...props,
      filter: (u) => !hitOnce.has(u.id) && (!props.filter || props.filter(u)),
      onHit: (g, u, p) => {
        hitOnce.add(u.id);
        props.onHit(g, u, p);
      },
    }));
  }
  return out;
}

export function damageArea(game, src, x, y, r, amount, type, opts = {}) {
  const targets = enemiesNear(game, src.team, x, y, r, { ignoreVision: true, championsOnly: !!opts.championsOnly, structures: !!opts.structures });
  for (const u of targets) {
    dealDamage(game, src, u, amount, type, { ability: true, ...opts });
    if (opts.onEach) opts.onEach(u);
  }
  return targets;
}

export function applySlow(unit, id, pct, duration, source) {
  if (!unit.alive || unit.kind === 'structure') return;
  unit.addBuff({ id, name: 'Slowed', duration, slow: pct, harmful: true, source, visual: 'slow' });
}

export function applyStun(unit, id, duration, source, name = 'Stunned') {
  if (!unit.alive || unit.kind === 'structure') return;
  unit.addBuff({ id, name, duration, flags: { stun: true }, harmful: true, source, visual: 'stun' });
}

export function applyRoot(unit, id, duration, source) {
  if (!unit.alive || unit.kind === 'structure') return;
  unit.addBuff({ id, name: 'Rooted', duration, flags: { root: true }, harmful: true, source, visual: 'root' });
}

export function applySilence(unit, id, duration, source) {
  if (!unit.alive || unit.kind === 'structure') return;
  unit.addBuff({ id, name: 'Silenced', duration, flags: { silence: true }, harmful: true, source, visual: 'silence' });
}

export function applyTaunt(unit, id, duration, source) {
  if (!unit.alive || unit.kind === 'structure') return;
  unit.addBuff({ id, name: 'Taunted', duration, flags: { taunt: true }, harmful: true, source, visual: 'taunt' });
  unit.windup = null;
}

// Dash: the game moves the unit each frame toward (tx, ty); walls stop it.
export function dash(game, unit, tx, ty, speed, opts = {}) {
  const end = clampToWalkable(game, unit.x, unit.y, tx, ty);
  unit.dash = { tx: end.x, ty: end.y, speed, onArrive: opts.onArrive || null, passThrough: true };
  unit.windup = null;
  unit.moveTarget = null;
  unit.path = null;
  face(unit, end);
  game.fx.push({ kind: 'trail', x1: unit.x, y1: unit.y, x2: end.x, y2: end.y, color: opts.color || '#ffffff', dur: 0.35, width: unit.radius * 1.2 });
  return end;
}

export function blink(game, unit, tx, ty, opts = {}) {
  let end = { x: tx, y: ty };
  if (!game.map.isNav(end.x, end.y)) {
    const near = game.map.nearestWalkable(end.x, end.y, 8);
    end = near || clampToWalkable(game, unit.x, unit.y, tx, ty);
  }
  game.fx.push({ kind: 'burst', x: unit.x, y: unit.y, color: opts.color || '#fde68a', dur: 0.4, count: 10 });
  unit.x = end.x;
  unit.y = end.y;
  unit.windup = null;
  unit.moveTarget = null;
  unit.path = null;
  game.fx.push({ kind: 'burst', x: unit.x, y: unit.y, color: opts.color || '#fde68a', dur: 0.4, count: 10 });
  return end;
}

// Walks from (sx, sy) toward (tx, ty) and returns the furthest walkable point on that segment.
export function clampToWalkable(game, sx, sy, tx, ty) {
  const d = Math.hypot(tx - sx, ty - sy);
  const steps = Math.max(1, Math.ceil(d / 12));
  let last = { x: sx, y: sy };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = sx + (tx - sx) * t;
    const y = sy + (ty - sy) * t;
    if (!game.map.isNav(x, y)) break;
    last = { x, y };
  }
  return last;
}

export function coneTargets(game, team, x, y, angle, spread, length, opts = {}) {
  const list = enemiesNear(game, team, x, y, length, opts);
  return list.filter((u) => {
    const a = Math.atan2(u.y - y, u.x - x);
    let d = a - angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) <= spread / 2 + Math.atan2(u.radius, Math.max(1, Math.hypot(u.x - x, u.y - y)));
  });
}

export function lineTargets(game, team, x, y, dir, length, width, opts = {}) {
  const list = enemiesNear(game, team, x, y, length + 100, opts);
  return list.filter((u) => {
    const px = u.x - x;
    const py = u.y - y;
    const along = px * dir.x + py * dir.y;
    if (along < -u.radius || along > length + u.radius) return false;
    const perp = Math.abs(px * dir.y - py * dir.x);
    return perp <= width / 2 + u.radius;
  });
}

export function fx(game, obj) {
  game.fx.push(obj);
}

export function ringFx(game, x, y, r, color, dur = 0.5) {
  game.fx.push({ kind: 'ring', x, y, r, color, dur });
}

export function coneFx(game, x, y, angle, spread, length, color, dur = 0.4) {
  game.fx.push({ kind: 'cone', x, y, angle, spread, len: length, color, dur });
}

export function beamFx(game, x1, y1, x2, y2, color, width = 8, dur = 0.3) {
  game.fx.push({ kind: 'line', x1, y1, x2, y2, color, width, dur });
}

export function scaleAP(base, ap, ratio) {
  return base + ap * ratio;
}

export { clamp };
