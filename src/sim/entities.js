import { SIGHT, GOLD } from './constants.js';
import { computeStats } from './stats.js';

let NEXT_ID = 1;
export function resetIds() {
  NEXT_ID = 1;
}

export class Buff {
  constructor(props) {
    this.id = props.id;
    this.name = props.name || props.id;
    this.source = props.source || null;
    this.duration = props.duration ?? Infinity;
    this.remaining = this.duration;
    this.stacks = props.stacks || 1;
    this.maxStacks = props.maxStacks || 1;
    this.mods = props.mods || null;
    this.modsPerStack = !!props.modsPerStack;
    this.slow = props.slow || 0;
    this.flags = props.flags || null;
    this.tickInterval = props.tickInterval || 0;
    this.tickTimer = props.tickInterval || 0;
    this.onTick = props.onTick || null;
    this.onExpire = props.onExpire || null;
    this.visual = props.visual || null;
    this.data = props.data || {};
    this.hidden = !!props.hidden;
    this.harmful = !!props.harmful;
    this.interruptible = !!props.interruptible;
  }
}

export class Unit {
  constructor(game, props = {}) {
    this.id = NEXT_ID++;
    this.game = game;
    this.kind = 'unit';
    this.team = 0;
    this.name = 'Unit';
    this.x = 0;
    this.y = 0;
    this.radius = 30;
    this.facing = 0;
    this.alive = true;
    this.level = 1;
    this.baseStats = { hp: 100, ad: 10, armor: 0, mr: 0, as: 1, range: 100, ms: 300 };
    this.stats = null;
    this.statsDirty = true;
    this.hp = 0;
    this.mana = 0;
    this.buffs = [];
    this.shields = [];
    this.items = null;
    this.attackCd = 0;
    this.windup = null;
    this.target = null;
    this.moveTarget = null;
    this.path = null;
    this.pathIdx = 0;
    this.pathTimer = 0;
    this.dash = null;
    this.vx = 0;
    this.vy = 0;
    this.moved = false;
    this.sightRange = SIGHT.champion;
    this.recentDamagers = new Map();
    this.lastDamageTime = -Infinity;
    this.lastCombatTime = -Infinity;
    this.ranged = false;
    this.attackVisual = null;
    this.mass = 1;
    this.immobile = false;
    this.visibleTo = [true, true];
    this.spawnTime = 0;
    Object.assign(this, props);
    this.ensureStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  ensureStats() {
    if (!this.statsDirty && this.stats) return this.stats;
    const old = this.stats;
    this.stats = computeStats(this);
    if (old) {
      const dHp = this.stats.maxHp - old.maxHp;
      if (dHp > 0) this.hp += dHp;
      const dMana = this.stats.maxMana - old.maxMana;
      if (dMana > 0) this.mana += dMana;
      if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp;
      if (this.mana > this.stats.maxMana) this.mana = this.stats.maxMana;
    }
    this.statsDirty = false;
    return this.stats;
  }

  get maxHp() {
    return this.ensureStats().maxHp;
  }
  get maxMana() {
    return this.ensureStats().maxMana;
  }
  get hpPct() {
    return this.hp / this.maxHp;
  }

  isEnemy(u) {
    return u.team !== this.team;
  }

  distTo(u) {
    return Math.hypot(u.x - this.x, u.y - this.y);
  }
  distToPoint(x, y) {
    return Math.hypot(x - this.x, y - this.y);
  }
  edgeDistTo(u) {
    return Math.max(0, this.distTo(u) - this.radius - u.radius);
  }
  inAttackRange(u, slack = 0) {
    return this.edgeDistTo(u) <= this.ensureStats().range + slack;
  }

  hasFlag(flag) {
    for (const b of this.buffs) if (b.flags && b.flags[flag]) return true;
    return false;
  }
  get stunned() {
    return this.hasFlag('stun');
  }
  get rooted() {
    return this.hasFlag('root');
  }
  get silenced() {
    return this.hasFlag('silence');
  }
  get disarmed() {
    return this.hasFlag('disarm');
  }
  get stealthed() {
    return this.hasFlag('stealth');
  }
  get channeling() {
    return this.hasFlag('channel');
  }
  get untargetable() {
    return this.hasFlag('untargetable');
  }
  get invulnerable() {
    return this.hasFlag('invulnerable');
  }
  get tauntedBy() {
    for (const b of this.buffs) if (b.flags && b.flags.taunt) return b.source;
    return null;
  }

  canMove() {
    return this.alive && !this.immobile && !this.stunned && !this.rooted && !this.channeling && !this.dash;
  }
  canAttack() {
    return this.alive && !this.stunned && !this.disarmed && !this.channeling && !this.dash;
  }
  canCast() {
    return this.alive && !this.stunned && !this.silenced && !this.channeling && !this.dash;
  }

  getBuff(id) {
    for (const b of this.buffs) if (b.id === id) return b;
    return null;
  }

  addBuff(props) {
    const existing = this.getBuff(props.id);
    if (existing) {
      if (existing.maxStacks > 1 && existing.stacks < existing.maxStacks) existing.stacks++;
      existing.remaining = props.duration ?? existing.duration;
      existing.duration = existing.remaining;
      if (props.mods) existing.mods = props.mods;
      if (props.slow !== undefined) existing.slow = props.slow;
      if (props.source) existing.source = props.source;
      if (props.data) Object.assign(existing.data, props.data);
      this.statsDirty = true;
      return existing;
    }
    const b = new Buff(props);
    this.buffs.push(b);
    this.statsDirty = true;
    if (b.flags && b.flags.stun) this.onHardCC();
    return b;
  }

  removeBuff(id) {
    const i = this.buffs.findIndex((b) => b.id === id);
    if (i < 0) return false;
    const b = this.buffs[i];
    this.buffs.splice(i, 1);
    this.statsDirty = true;
    if (b.onExpire) b.onExpire(this.game, this, b);
    return true;
  }

  clearBuffs(keepPermanent = false) {
    const keep = keepPermanent ? this.buffs.filter((b) => b.duration === Infinity) : [];
    this.buffs = keep;
    this.shields = [];
    this.statsDirty = true;
  }

  onHardCC() {
    this.windup = null;
    if (this.channel) this.channel = null;
    if (this.recall) this.recall = null;
    for (const b of this.buffs) if (b.flags && b.flags.channel && b.interruptible) b.remaining = 0;
  }

  updateBuffs(dt) {
    // Iterate over a snapshot: ticks and expiries may kill the unit or add/remove buffs.
    const list = this.buffs.slice();
    let changed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (!this.alive) break;
      if (!this.buffs.includes(b)) continue;
      if (b.tickInterval > 0 && b.onTick) {
        b.tickTimer -= dt;
        while (b.tickTimer <= 0 && this.alive && this.buffs.includes(b)) {
          b.tickTimer += b.tickInterval;
          b.onTick(this.game, this, b);
        }
      }
      if (!this.alive || !this.buffs.includes(b)) continue;
      if (b.remaining !== Infinity) {
        b.remaining -= dt;
        if (b.remaining <= 0) {
          const idx = this.buffs.indexOf(b);
          if (idx >= 0) this.buffs.splice(idx, 1);
          changed = true;
          if (b.onExpire) b.onExpire(this.game, this, b);
        }
      }
    }
    for (let i = this.shields.length - 1; i >= 0; i--) {
      const s = this.shields[i];
      s.remaining -= dt;
      if (s.remaining <= 0 || s.amount <= 0) this.shields.splice(i, 1);
    }
    if (changed) this.statsDirty = true;
  }

  get shieldTotal() {
    let t = 0;
    for (const s of this.shields) t += s.amount;
    return t;
  }

  addShield(amount, duration, id = null) {
    if (id) {
      const existing = this.shields.find((s) => s.id === id);
      if (existing) {
        existing.amount = Math.max(existing.amount, amount);
        existing.remaining = duration;
        return existing;
      }
    }
    const s = { id, amount, remaining: duration };
    this.shields.push(s);
    return s;
  }

  absorbWithShields(amount) {
    let remaining = amount;
    for (const s of this.shields) {
      if (remaining <= 0) break;
      const used = Math.min(s.amount, remaining);
      s.amount -= used;
      remaining -= used;
    }
    this.shields = this.shields.filter((s) => s.amount > 0);
    return remaining;
  }

  isOutOfCombat(now, window = 6) {
    return now - this.lastCombatTime > window;
  }
}

export class Champion extends Unit {
  constructor(game, props) {
    super(game, { kind: 'champion', mass: 1, sightRange: SIGHT.champion, ...props });
    this.level = 1;
    this.xp = 0;
    this.gold = GOLD.start;
    this.totalGold = GOLD.start;
    this.skillPoints = 1;
    this.abilities = {};
    for (const key of ['Q', 'W', 'E', 'R']) {
      const def = this.def.abilities[key];
      this.abilities[key] = { key, def, rank: 0, cd: 0, maxRank: def.maxRank || (key === 'R' ? 3 : 5) };
    }
    this.spells = (props.spellIds || this.def.defaultSpells || ['flash', 'heal']).map((id) => ({ id, cd: 0 }));
    this.items = [null, null, null, null, null, null];
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.cs = 0;
    this.damageDealt = 0;
    this.isPlayer = !!props.isPlayer;
    this.bot = null;
    this.respawnTimer = 0;
    this.recall = null;
    this.order = null;
    this.castLock = 0;
    this.channel = null;
    this.passive = {};
    this.role = props.role || 'mid';
    this.attackVisual = this.def.attackVisual || null;
    this.ranged = this.def.ranged;
    this.spellbladeReady = false;
    this.spellbladeCd = 0;
    this.deathTime = -Infinity;
    this.name = this.def.name;
    this.statsDirty = true;
    this.ensureStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  rank(key) {
    return this.abilities[key].rank;
  }

  get isDead() {
    return !this.alive;
  }
}

export class Minion extends Unit {
  constructor(game, props) {
    super(game, { kind: 'minion', sightRange: SIGHT.minion, ...props });
    this.wpIdx = props.wpIdx ?? 0;
    this.leashHome = null;
    this.acquireTimer = 0;
  }
}

export class Structure extends Unit {
  constructor(game, props) {
    super(game, { kind: 'structure', immobile: true, mass: 1000, sightRange: SIGHT.tower, ...props });
    this.heatTarget = null;
    this.heatCount = 0;
    this.respawnTimer = 0;
  }
}

export class Monster extends Unit {
  constructor(game, props) {
    super(game, { kind: 'monster', sightRange: SIGHT.monster, ...props });
    this.aggroTimer = 0;
    this.resetting = false;
  }
}

export class Projectile {
  constructor(props) {
    this.id = NEXT_ID++;
    this.x = 0;
    this.y = 0;
    this.team = 0;
    this.source = null;
    this.target = null; // homing target
    this.dx = 0;
    this.dy = 0;
    this.speed = 1000;
    this.hitRadius = 30;
    this.maxDist = Infinity;
    this.traveled = 0;
    this.pierce = false;
    this.maxHits = 1;
    this.hits = 0;
    this.hitIds = new Set();
    this.onHit = null; // (game, unit, proj) -> void
    this.onExpire = null;
    this.filter = null; // (unit) -> bool
    this.alive = true;
    this.visual = { kind: 'orb', color: '#fff', size: 8 };
    this.hitsChampionsOnly = false;
    this.hitsStructures = false;
    this.height = 0;
    this.spawnTime = 0;
    Object.assign(this, props);
  }
}
