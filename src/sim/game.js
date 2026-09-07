// The simulation. Pure logic: no DOM, no rendering. Runs in the browser and in Node.
import { MAP_SIZE, TEAM, TIMING, GOLD, XP, SIGHT, TOWER, INHIBITOR, NEXUS, MINION, FOUNTAIN, enemyOf } from './constants.js';
import { createMap, structureRadius, LANE_NAMES } from './map.js';
import { makeRng } from './rng.js';
import { Champion, Minion, Structure, Monster, resetIds } from './entities.js';
import { CHAMPIONS, SUMMONER_SPELLS } from './champions.js';
import { ITEMS } from './items.js';
import { dealDamage, healUnit, tryStartAttack, cancelAttack, updateAttackWindup, isTargetable, grantGold, shareXp, hasPassive } from './combat.js';
import { cooldownMultiplier } from './stats.js';
import { closestOnPolyline, pointAlongPolyline, polylineLength } from './math.js';
import { updateBot, createBotState, buildRosters } from './ai.js';

const TEAM_COLORS = ['#3b82f6', '#ef4444'];

export const MONSTERS = {
  wolf_big: { name: 'Greater Wolf', hp: 1300, ad: 42, armor: 10, mr: 10, as: 0.7, range: 120, ms: 400, radius: 42, gold: 55, xp: 75, color: '#9ca3af' },
  wolf: { name: 'Wolf', hp: 380, ad: 16, armor: 5, mr: 5, as: 0.8, range: 100, ms: 420, radius: 26, gold: 14, xp: 22, color: '#a8a29e' },
  blue_sentinel: { name: 'Blue Sentinel', hp: 2000, ad: 58, armor: 15, mr: 15, as: 0.6, range: 150, ms: 350, radius: 55, gold: 90, xp: 115, buff: 'blue', color: '#60a5fa' },
  raptor_big: { name: 'Crimson Raptor', hp: 950, ad: 32, armor: 8, mr: 8, as: 0.9, range: 300, ms: 400, radius: 36, gold: 40, xp: 55, ranged: true, color: '#f97316' },
  raptor: { name: 'Raptor', hp: 260, ad: 12, armor: 0, mr: 0, as: 1.0, range: 250, ms: 420, radius: 22, gold: 12, xp: 16, ranged: true, color: '#fb923c' },
  red_brambleback: { name: 'Red Brambleback', hp: 2100, ad: 66, armor: 20, mr: 20, as: 0.55, range: 160, ms: 340, radius: 58, gold: 90, xp: 115, buff: 'red', color: '#f87171' },
  dragon: { name: 'Dragon', hp: 3600, ad: 135, armor: 25, mr: 35, as: 0.5, range: 420, ms: 330, radius: 76, gold: 30, xp: 220, ranged: true, buff: 'dragon', epic: true, color: '#fb7185' },
  baron: { name: 'Baron Nashor', hp: 7500, ad: 270, armor: 60, mr: 60, as: 0.45, range: 720, ms: 0, radius: 96, gold: 60, xp: 800, ranged: true, buff: 'baron', epic: true, immobile: true, color: '#a78bfa' },
};

const CAMP_COMPOSITION = {
  wolves: ['wolf_big', 'wolf', 'wolf'],
  blue: ['blue_sentinel'],
  raptors: ['raptor_big', 'raptor', 'raptor', 'raptor'],
  red: ['red_brambleback'],
  dragon: ['dragon'],
  baron: ['baron'],
};

const DEFAULT_OPTS = {
  seed: 1,
  difficulty: 'normal',
  teamSize: 5,
  playerChampion: 'aria',
  playerSpells: null,
  playerTeam: TEAM.BLUE,
  autoLevel: true,
  allBots: false,
  headless: false,
};

export class Game {
  constructor(opts = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
    resetIds();
    this.rng = makeRng(this.opts.seed);
    this.map = createMap();
    this.time = 0;
    this.tick = 0;
    this.units = [];
    this.unitMap = new Map();
    this.champions = [];
    this.minions = [];
    this.structures = [];
    this.monsters = [];
    this.projectiles = [];
    this.timers = [];
    this.fx = this.opts.headless ? { push() {}, splice() { return []; }, length: 0 } : [];
    this.events = [];
    this.eventSeq = 0;
    this.teamStats = [
      { kills: 0, towers: 0, inhibitors: 0, dragons: 0, barons: 0 },
      { kills: 0, towers: 0, inhibitors: 0, dragons: 0, barons: 0 },
    ];
    this.firstBlood = false;
    this.over = false;
    this.winner = null;
    this.waveCount = 0;
    this.nextWaveAt = TIMING.firstWave;
    this.camps = [];
    this.showDamageNumbers = !this.opts.headless;
    this.player = null;
    this.structIndex = [{}, {}];
    this.buildWorld();
  }

  // ------------------------------------------------------------ setup
  buildWorld() {
    for (const s of this.map.structures) this.createStructure(s);
    for (const c of this.map.camps) {
      this.camps.push({ id: c.id, name: c.name, side: c.side, x: c.x, y: c.y, monsters: [], respawnAt: TIMING.campSpawn, alive: false, epic: false, kills: 0 });
    }
    this.camps.push({ id: 'dragon', name: 'Dragon', side: -1, x: this.map.dragon.x, y: this.map.dragon.y, monsters: [], respawnAt: TIMING.dragonSpawn, alive: false, epic: true, kills: 0 });
    this.camps.push({ id: 'baron', name: 'Baron Nashor', side: -1, x: this.map.baron.x, y: this.map.baron.y, monsters: [], respawnAt: TIMING.baronSpawn, alive: false, epic: true, kills: 0 });

    const rosters = buildRosters(this, this.opts);
    for (const team of [TEAM.BLUE, TEAM.RED]) {
      const list = rosters[team];
      list.forEach((entry, i) => {
        const def = CHAMPIONS[entry.champId];
        const f = this.map.fountains[team];
        const angle = (i / Math.max(1, list.length)) * Math.PI * 2;
        const c = new Champion(this, {
          def, team, x: f.x + Math.cos(angle) * 90, y: f.y + Math.sin(angle) * 90,
          radius: def.radius, baseStats: def.base, isPlayer: !!entry.isPlayer, role: entry.role, spellIds: entry.spells,
        });
        c.facing = team === TEAM.BLUE ? -Math.PI / 4 : (Math.PI * 3) / 4;
        this.addUnit(c);
        this.champions.push(c);
        if (c.isPlayer) this.player = c;
        else c.bot = createBotState(this, c, entry.role);
      });
    }
    this.applyDifficulty();
  }

  applyDifficulty() {
    const d = this.opts.difficulty;
    const enemy = enemyOf(this.opts.playerTeam);
    for (const c of this.champions) {
      if (c.isPlayer || c.team !== enemy) continue;
      if (d === 'easy') c.addBuff({ id: 'handicap', name: 'Easy bots', mods: { dmgAmp: -0.15, hpPct: -0.1 }, hidden: true });
      else if (d === 'hard') c.addBuff({ id: 'handicap', name: 'Hard bots', mods: { dmgAmp: 0.12, hpPct: 0.12, armor: 8, mr: 8 }, hidden: true });
      c.ensureStats();
      c.hp = c.maxHp;
    }
  }

  createStructure(s) {
    let baseStats;
    let props = {};
    const radius = structureRadius(s.kind);
    if (s.kind === 'tower') {
      baseStats = { hp: TOWER.hp[s.tier], ad: TOWER.ad, armor: 40, mr: 40, as: 1 / TOWER.attackPeriod, range: TOWER.range, ms: 0 };
      props = { ranged: true, attackVisual: { kind: 'tower', color: TEAM_COLORS[s.team], size: 14, speed: TOWER.projectileSpeed, glow: true } };
    } else if (s.kind === 'inhibitor') {
      baseStats = { hp: INHIBITOR.hp, ad: 0, armor: 20, mr: 20, as: 0.5, range: 0, ms: 0 };
    } else if (s.kind === 'nexus') {
      baseStats = { hp: NEXUS.hp, ad: 0, armor: 20, mr: 20, as: 0.5, range: 0, ms: 0 };
    } else {
      baseStats = { hp: 100000, ad: FOUNTAIN.laserDamage, armor: 0, mr: 0, as: 1 / FOUNTAIN.laserPeriod, range: FOUNTAIN.laserRange, ms: 0 };
      props = { ranged: true, attackVisual: { kind: 'laser', color: TEAM_COLORS[s.team], size: 10, speed: 3000, glow: true }, sightRange: SIGHT.structure };
    }
    const st = new Structure(this, {
      team: s.team, x: s.x, y: s.y, radius: radius || 60, baseStats, stype: s.kind, lane: s.lane, tier: s.tier,
      name: s.kind === 'tower' ? 'Turret' : s.kind === 'inhibitor' ? 'Inhibitor' : s.kind === 'nexus' ? 'Nexus' : 'Fountain',
      sightRange: s.kind === 'tower' ? SIGHT.tower : SIGHT.structure, ...props,
    });
    st.aggro = null;
    this.addUnit(st);
    this.structures.push(st);
    const idx = this.structIndex[s.team];
    idx[`${s.kind}:${s.lane}:${s.tier}`] = idx[`${s.kind}:${s.lane}:${s.tier}`] || [];
    idx[`${s.kind}:${s.lane}:${s.tier}`].push(st);
    return st;
  }

  addUnit(u) {
    this.units.push(u);
    this.unitMap.set(u.id, u);
    u.spawnTime = this.time;
    return u;
  }

  unitById(id) {
    return this.unitMap.get(id) || null;
  }

  addProjectile(p) {
    this.projectiles.push(p);
    return p;
  }

  schedule(delay, fn) {
    this.timers.push({ at: this.time + delay, fn });
  }

  pushEvent(ev) {
    ev.seq = ++this.eventSeq;
    if (ev.t === undefined) ev.t = this.time;
    this.events.push(ev);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  // ------------------------------------------------------------ structure rules
  getStructures(team, kind, lane, tier) {
    return this.structIndex[team][`${kind}:${lane}:${tier}`] || [];
  }

  structureAlive(team, kind, lane, tier) {
    return this.getStructures(team, kind, lane, tier).some((s) => s.alive);
  }

  inhibitorsDown(team) {
    let n = 0;
    for (const lane of LANE_NAMES) if (!this.structureAlive(team, 'inhibitor', lane, 0)) n++;
    return n;
  }

  isStructureTargetable(s) {
    if (!s.alive) return false;
    if (s.stype === 'fountain') return false;
    if (s.stype === 'tower') {
      if (s.tier === 1) return true;
      if (s.tier <= 3) return !this.structureAlive(s.team, 'tower', s.lane, s.tier - 1);
      return this.inhibitorsDown(s.team) > 0;
    }
    if (s.stype === 'inhibitor') return !this.structureAlive(s.team, 'tower', s.lane, 3);
    if (s.stype === 'nexus') return !this.structureAlive(s.team, 'tower', 'nexus', 4);
    return false;
  }

  nexusOf(team) {
    return this.getStructures(team, 'nexus', 'nexus', 0)[0];
  }

  fountainOf(team) {
    return this.map.fountains[team];
  }

  onStructureDestroyed(s, killer, creditChamp) {
    const byTeam = enemyOf(s.team);
    if (s.stype === 'tower') {
      this.teamStats[byTeam].towers++;
      for (const c of this.champions) if (c.team === byTeam) grantGold(this, c, GOLD.towerTeam, 'tower');
      if (creditChamp) grantGold(this, creditChamp, GOLD.towerKiller, 'tower');
      shareXp(this, byTeam, s.x, s.y, XP.towerTeam);
      this.pushEvent({ type: 'tower', team: s.team, byTeam, lane: s.lane, tier: s.tier, x: s.x, y: s.y, killerName: creditChamp ? creditChamp.name : null });
    } else if (s.stype === 'inhibitor') {
      this.teamStats[byTeam].inhibitors++;
      s.respawnTimer = TIMING.inhibitorRespawn;
      for (const c of this.champions) if (c.team === byTeam) grantGold(this, c, GOLD.inhibitorTeam, 'inhibitor');
      this.pushEvent({ type: 'inhibitor', team: s.team, byTeam, lane: s.lane, x: s.x, y: s.y });
    } else if (s.stype === 'nexus') {
      this.endGame(byTeam);
    }
  }

  endGame(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.pushEvent({ type: 'gameover', winner });
  }

  // ------------------------------------------------------------ aggro
  onChampionAggro(src, tgt) {
    // Turrets protect their champions.
    for (const s of this.structures) {
      if (!s.alive || s.team !== tgt.team || s.stype !== 'tower') continue;
      if (s.edgeDistTo(src) <= s.stats.range) s.aggro = { id: src.id, until: this.time + 3 };
    }
    for (const m of this.minions) {
      if (!m.alive || m.team !== tgt.team) continue;
      if (m.distTo(tgt) > 600) continue;
      if (m.target && m.target.kind === 'champion') continue;
      if (m.edgeDistTo(src) <= MINION.acquireRange + 200) {
        m.target = src;
        m.targetUntil = this.time + 4;
      }
    }
  }

  onMonsterDamaged(monster, src) {
    if (!src || src.team === undefined || monster.resetting) return;
    const camp = monster.camp;
    for (const m of camp.monsters) {
      if (!m.alive || m.resetting) continue;
      if (!m.target || !m.target.alive) m.target = src;
    }
  }

  onMonsterKilled(monster, killer, creditChamp) {
    const camp = monster.camp;
    const def = monster.def;
    const team = creditChamp ? creditChamp.team : killer && killer.team !== undefined ? killer.team : null;
    if (team !== null) {
      if (def.epic) {
        for (const c of this.champions) if (c.team === team) grantGold(this, c, def.gold + (def.buff === 'baron' ? 240 : 70), def.buff);
        shareXp(this, team, monster.x, monster.y, def.xp);
        if (def.buff === 'dragon') {
          this.teamStats[team].dragons++;
          for (const c of this.champions) {
            if (c.team !== team) continue;
            c.addBuff({ id: 'dragon_stack', name: 'Dragon Slayer', mods: { adPct: 0.05, apPct: 0.05, msPct: 0.015 }, modsPerStack: true, maxStacks: 6, visual: null });
          }
          this.pushEvent({ type: 'epic', what: 'dragon', team, killerName: creditChamp ? creditChamp.name : null });
        } else if (def.buff === 'baron') {
          this.teamStats[team].barons++;
          for (const c of this.champions) {
            if (c.team !== team) continue;
            c.addBuff({ id: 'baron_buff', name: 'Hand of Baron', duration: 180, mods: { ad: 24, ap: 36, hpRegen: 3, manaRegen: 3 }, visual: 'baron' });
          }
          for (const m of this.minions) if (m.alive && m.team === team) this.empowerMinion(m);
          this.pushEvent({ type: 'epic', what: 'baron', team, killerName: creditChamp ? creditChamp.name : null });
        }
      } else {
        if (creditChamp) grantGold(this, creditChamp, def.gold, 'monster');
        shareXp(this, team, monster.x, monster.y, def.xp);
        if (creditChamp && creditChamp.alive) {
          if (def.buff === 'blue') creditChamp.addBuff({ id: 'blue_buff', name: 'Crest of Insight', duration: 120, mods: { manaRegen: 6, haste: 10 }, visual: 'blue' });
          if (def.buff === 'red') creditChamp.addBuff({ id: 'red_buff', name: 'Crest of Cinders', duration: 120, mods: { hpRegen: 3 }, visual: 'red' });
        }
      }
    }
    if (camp.monsters.every((m) => !m.alive)) {
      camp.alive = false;
      camp.kills++;
      camp.respawnAt = this.time + (camp.epic ? (camp.id === 'dragon' ? TIMING.dragonRespawn : TIMING.baronRespawn) : TIMING.campRespawn);
      camp.lastKillerTeam = team;
    }
  }

  empowerMinion(m) {
    m.addBuff({ id: 'baron_minion', name: 'Empowered', duration: 180, mods: { hpPct: 0.3, adPct: 0.3, armor: 12, mr: 12 }, visual: 'baron' });
    m.ensureStats();
  }

  // ------------------------------------------------------------ spawning
  spawnWave() {
    this.waveCount++;
    const steps = Math.floor(this.time / TIMING.minionScaleInterval);
    for (const team of [TEAM.BLUE, TEAM.RED]) {
      const enemy = enemyOf(team);
      const baron = this.champions.some((c) => c.team === team && c.getBuff('baron_buff'));
      for (const lane of LANE_NAMES) {
        const types = ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'];
        if (this.waveCount % TIMING.siegeEvery === 0) types.push('siege');
        if (!this.structureAlive(enemy, 'inhibitor', lane, 0)) types.unshift('super');
        if (this.inhibitorsDown(enemy) === 3) types.unshift('super');
        const wps = this.map.lanes[team][lane];
        types.forEach((type, i) => {
          const def = MINION[type];
          const p = pointAlongPolyline(wps, 260 + i * 42);
          const m = new Minion(this, {
            team, x: p.x + (this.rng() - 0.5) * 60, y: p.y + (this.rng() - 0.5) * 60, radius: def.radius, mtype: type, lane,
            name: type === 'super' ? 'Super Minion' : `${type[0].toUpperCase()}${type.slice(1)} Minion`,
            baseStats: {
              hp: def.hp + def.hpGrowth * steps, ad: def.ad + def.adGrowth * steps, armor: def.armor + Math.min(30, steps * 1.5), mr: def.mr + Math.min(30, steps * 1.5),
              as: type === 'super' ? 0.85 : 0.75, range: def.range, ms: def.ms,
            },
            gold: def.gold + Math.min(40, steps * 1.2), xp: def.xp + steps * 3, mass: type === 'super' ? 1.5 : 0.7,
            ranged: def.range > 200, waypoints: wps, wpIdx: 1, wave: this.waveCount,
            attackVisual: { kind: def.range > 200 ? 'bolt' : 'orb', color: team === TEAM.BLUE ? '#93c5fd' : '#fca5a5', size: 7, speed: MINION.projectileSpeed },
          });
          if (baron) this.empowerMinion(m);
          this.addUnit(m);
          this.minions.push(m);
        });
      }
    }
    if (this.waveCount === 1) this.pushEvent({ type: 'notice', text: 'Minions have spawned!' });
  }

  spawnCamp(camp) {
    camp.alive = true;
    camp.monsters = [];
    const types = CAMP_COMPOSITION[camp.id];
    types.forEach((type, i) => {
      const def = MONSTERS[type];
      const angle = (i / types.length) * Math.PI * 2;
      const off = i === 0 ? 0 : 70 + def.radius;
      const hpScale = def.epic ? 1 + camp.kills * 0.2 + Math.floor(this.time / 120) * 0.04 : 1 + Math.floor(this.time / 180) * 0.06;
      const mon = new Monster(this, {
        team: 2, x: camp.x + Math.cos(angle) * off, y: camp.y + Math.sin(angle) * off, radius: def.radius, mtype: type, name: def.name, def, camp,
        baseStats: { hp: def.hp * hpScale, ad: def.ad * (1 + Math.floor(this.time / 180) * 0.05), armor: def.armor, mr: def.mr, as: def.as, range: def.range, ms: def.ms },
        ranged: !!def.ranged, immobile: !!def.immobile, mass: def.epic ? 50 : 2,
        home: { x: camp.x + Math.cos(angle) * off, y: camp.y + Math.sin(angle) * off },
        attackVisual: { kind: def.buff === 'baron' ? 'void' : def.buff === 'dragon' ? 'fire' : 'orb', color: def.color, size: def.epic ? 18 : 8, speed: 1200 },
      });
      mon.visibleTo = [false, false];
      this.addUnit(mon);
      this.monsters.push(mon);
      camp.monsters.push(mon);
    });
  }

  respawnChampion(c) {
    const f = this.map.fountains[c.team];
    c.alive = true;
    c.x = f.x + (this.rng() - 0.5) * 120;
    c.y = f.y + (this.rng() - 0.5) * 120;
    c.statsDirty = true;
    c.ensureStats();
    c.hp = c.maxHp;
    c.mana = c.maxMana;
    c.order = null;
    c.target = null;
    c.path = null;
    c.recall = null;
    c.attackCd = 0;
    c.windup = null;
    c.respawnTimer = 0;
    this.pushEvent({ type: 'respawn', unit: c.id });
  }

  // ------------------------------------------------------------ orders & casting
  issueOrder(c, order) {
    if (!c.alive) return;
    if (c.recall) c.recall = null;
    if (order && (order.type === 'move' || order.type === 'attackMove')) cancelAttack(c);
    c.order = order;
  }

  stopUnit(c) {
    cancelAttack(c);
    c.order = null;
    c.moveTarget = null;
    c.path = null;
    if (c.recall) c.recall = null;
  }

  startRecall(c) {
    if (!c.alive || c.recall) return false;
    if (c.distToPoint(this.map.fountains[c.team].x, this.map.fountains[c.team].y) < 500) return false;
    cancelAttack(c);
    c.order = null;
    c.path = null;
    c.recall = { remaining: TIMING.recallDuration, total: TIMING.recallDuration };
    return true;
  }

  finishRecall(c) {
    const f = this.map.fountains[c.team];
    this.fx.push({ kind: 'burst', x: c.x, y: c.y, color: '#a5f3fc', dur: 0.6, count: 16 });
    c.x = f.x + (this.rng() - 0.5) * 120;
    c.y = f.y + (this.rng() - 0.5) * 120;
    c.recall = null;
    c.order = null;
    c.path = null;
    this.fx.push({ kind: 'burst', x: c.x, y: c.y, color: '#a5f3fc', dur: 0.6, count: 16 });
  }

  canLevel(c, key) {
    const ab = c.abilities[key];
    if (c.skillPoints <= 0 || ab.rank >= ab.maxRank) return false;
    if (key === 'R') return c.level >= 6 + 5 * ab.rank;
    return ab.rank < Math.ceil(c.level / 2);
  }

  levelUpAbility(c, key) {
    if (!this.canLevel(c, key)) return false;
    c.abilities[key].rank++;
    c.skillPoints--;
    return true;
  }

  autoLevel(c) {
    if (c.skillPoints <= 0) return;
    const order = c.def.skillOrder;
    const wanted = order[Math.min(order.length - 1, c.level - 1)];
    if (this.canLevel(c, wanted)) {
      this.levelUpAbility(c, wanted);
      return;
    }
    for (const key of order) {
      if (this.canLevel(c, key)) {
        this.levelUpAbility(c, key);
        return;
      }
    }
  }

  abilityCost(c, key) {
    const ab = c.abilities[key];
    const cost = ab.def.cost;
    return Array.isArray(cost) ? cost[Math.max(0, ab.rank - 1)] : cost || 0;
  }

  abilityCooldown(c, key) {
    const ab = c.abilities[key];
    const cd = ab.def.cooldown;
    const base = Array.isArray(cd) ? cd[Math.max(0, ab.rank - 1)] : cd;
    return base * cooldownMultiplier(c.ensureStats().haste);
  }

  validateUnitTarget(c, def, t) {
    if (!t || !t.alive) return 'notarget';
    const kind = def.targetKind || 'enemy';
    if (kind === 'enemy' || kind === 'enemyChampion') {
      if (t.team === c.team) return 'invalid';
      if (kind === 'enemyChampion' && t.kind !== 'champion') return 'invalid';
      if (!isTargetable(this, t, c.team)) return 'invalid';
      if (t.kind === 'structure') return 'invalid';
    } else if (kind === 'ally' || kind === 'allyChampion') {
      if (t.team !== c.team) return 'invalid';
      if (kind === 'allyChampion' && t.kind !== 'champion') return 'invalid';
    }
    if (c.distTo(t) - t.radius > def.range) return 'range';
    return null;
  }

  castAbility(c, key, aim = {}) {
    const ab = c.abilities[key];
    const def = ab.def;
    if (!c.alive) return { ok: false, reason: 'dead' };
    if (ab.rank <= 0) return { ok: false, reason: 'norank' };
    if (ab.cd > 0) return { ok: false, reason: 'cooldown' };
    if (!c.canCast()) return { ok: false, reason: 'cc' };
    if (c.castLock > 0) return { ok: false, reason: 'busy' };
    const cost = this.abilityCost(c, key);
    if (c.mana < cost) return { ok: false, reason: 'mana' };
    if (def.type === 'unit') {
      const err = this.validateUnitTarget(c, def, aim.target);
      if (err) return { ok: false, reason: err, target: aim.target };
    }
    if (aim.x === undefined && def.type !== 'self' && def.type !== 'unit') {
      aim = { x: c.x + Math.cos(c.facing) * 300, y: c.y + Math.sin(c.facing) * 300 };
    }
    if (def.type === 'unit' && aim.target) aim = { ...aim, x: aim.target.x, y: aim.target.y };
    cancelAttack(c);
    c.ensureStats();
    const ok = def.cast(this, c, aim, ab.rank) !== false;
    if (!ok) return { ok: false, reason: 'noeffect' };
    c.mana -= cost;
    ab.cd = this.abilityCooldown(c, key);
    const castTime = def.castTime !== undefined ? def.castTime : def.type === 'self' ? 0 : 0.2;
    if (castTime > c.castLock) c.castLock = castTime;
    if (c.def.hooks && c.def.hooks.abilityCast) c.def.hooks.abilityCast(this, c, key);
    if (c.spellbladeCd <= 0 && hasPassive(c, 'spellblade')) c.spellbladeReady = true;
    c.lastCombatTime = this.time;
    this.fx.push({ kind: 'cast', id: c.id, key, x: c.x, y: c.y, color: c.def.color, isPlayer: c.isPlayer });
    return { ok: true };
  }

  castSpell(c, idx, aim = {}) {
    const slot = c.spells[idx];
    if (!slot) return { ok: false, reason: 'none' };
    const def = SUMMONER_SPELLS[slot.id];
    if (!c.alive) return { ok: false, reason: 'dead' };
    if (slot.cd > 0) return { ok: false, reason: 'cooldown' };
    if (!c.alive || c.stunned || c.channeling) return { ok: false, reason: 'cc' };
    if (def.type === 'unit') {
      const err = this.validateUnitTarget(c, def, aim.target);
      if (err) return { ok: false, reason: err, target: aim.target };
    }
    if (aim.x === undefined && def.type !== 'self' && def.type !== 'unit') {
      aim = { x: c.x + Math.cos(c.facing) * 300, y: c.y + Math.sin(c.facing) * 300 };
    }
    const ok = def.cast(this, c, aim) !== false;
    if (!ok) return { ok: false, reason: 'noeffect' };
    slot.cd = def.cooldown;
    this.fx.push({ kind: 'cast', id: c.id, key: def.id, x: c.x, y: c.y, color: def.color, isPlayer: c.isPlayer });
    return { ok: true };
  }

  // ------------------------------------------------------------ shop
  nearShop(c) {
    if (!c.alive) return true;
    const f = this.map.fountains[c.team];
    return c.distToPoint(f.x, f.y) <= 900;
  }

  buyItem(c, itemId) {
    const def = ITEMS[itemId];
    if (!def) return { ok: false, reason: 'unknown' };
    if (!this.nearShop(c)) return { ok: false, reason: 'shop' };
    if (c.gold < def.cost) return { ok: false, reason: 'gold' };
    if (def.boots && c.items.some((s) => s && ITEMS[s.id].boots)) return { ok: false, reason: 'boots' };
    if (def.consumable) {
      const slot = c.items.find((s) => s && s.id === itemId);
      if (slot) {
        if (slot.count >= def.consumable.maxStack) return { ok: false, reason: 'stack' };
        slot.count++;
        c.gold -= def.cost;
        return { ok: true };
      }
    }
    const free = c.items.indexOf(null);
    if (free < 0) return { ok: false, reason: 'full' };
    c.items[free] = { id: itemId, count: 1 };
    c.gold -= def.cost;
    c.statsDirty = true;
    c.ensureStats();
    return { ok: true };
  }

  sellItem(c, slotIdx) {
    const slot = c.items[slotIdx];
    if (!slot) return { ok: false, reason: 'empty' };
    if (!this.nearShop(c)) return { ok: false, reason: 'shop' };
    const def = ITEMS[slot.id];
    c.gold += Math.round(def.cost * GOLD.sellRatio);
    if (slot.count > 1) slot.count--;
    else c.items[slotIdx] = null;
    c.statsDirty = true;
    c.ensureStats();
    return { ok: true };
  }

  useItem(c, slotIdx) {
    const slot = c.items[slotIdx];
    if (!slot || !c.alive) return { ok: false, reason: 'empty' };
    const def = ITEMS[slot.id];
    if (!def.consumable) return { ok: false, reason: 'passive' };
    if (c.getBuff('potion')) return { ok: false, reason: 'active' };
    const hot = def.consumable.healOverTime;
    const perTick = hot.amount / (hot.duration / 0.5);
    c.addBuff({ id: 'potion', name: 'Health Potion', duration: hot.duration, tickInterval: 0.5, visual: 'potion', onTick: (g, u) => healUnit(g, null, u, perTick, { silent: true }) });
    if (slot.count > 1) slot.count--;
    else c.items[slotIdx] = null;
    return { ok: true };
  }

  // ------------------------------------------------------------ main loop
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.tick++;
    this.runTimers();
    this.updateSpawns();
    this.updateVisibility();
    // Alternate the processing order every tick so neither team consistently acts first.
    const rev = (this.tick & 1) === 1;
    const champs = rev ? this.champions.slice().reverse() : this.champions;
    const minions = rev ? this.minions.slice().reverse() : this.minions;
    const structures = rev ? this.structures.slice().reverse() : this.structures;
    for (const c of champs) this.updateChampion(c, dt);
    for (const m of minions) if (m.alive) this.updateMinion(m, dt);
    for (const s of structures) this.updateStructure(s, dt);
    for (const m of this.monsters) if (m.alive) this.updateMonster(m, dt);
    this.updateMovement(dt);
    this.updateProjectiles(dt);
    for (const u of this.units) {
      if (!u.alive) continue;
      u.updateBuffs(dt);
      if (u.alive) this.updateRegen(u, dt);
    }
    this.cleanup();
    if (!this.over) {
      const bn = this.nexusOf(TEAM.BLUE);
      const rn = this.nexusOf(TEAM.RED);
      if (!bn.alive) this.endGame(TEAM.RED);
      else if (!rn.alive) this.endGame(TEAM.BLUE);
    }
  }

  runTimers() {
    if (this.timers.length === 0) return;
    const due = [];
    this.timers = this.timers.filter((t) => {
      if (t.at <= this.time) {
        due.push(t);
        return false;
      }
      return true;
    });
    for (const t of due) t.fn();
  }

  updateSpawns() {
    if (this.time >= this.nextWaveAt) {
      this.spawnWave();
      this.nextWaveAt += TIMING.waveInterval;
    }
    for (const camp of this.camps) {
      if (!camp.alive && this.time >= camp.respawnAt) this.spawnCamp(camp);
    }
  }

  updateVisibility() {
    const sources = [[], []];
    for (const u of this.units) {
      if (!u.alive || u.team > 1) continue;
      sources[u.team].push(u);
    }
    this.sightSources = sources;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.team <= 1) u.visibleTo[u.team] = true;
      for (const team of [0, 1]) {
        if (team === u.team) continue;
        if (u.kind === 'structure') {
          u.visibleTo[team] = true;
          continue;
        }
        if (u.stealthed) {
          u.visibleTo[team] = false;
          continue;
        }
        let vis = false;
        const src = sources[team];
        for (let i = 0; i < src.length; i++) {
          const s = src[i];
          const r = s.sightRange + u.radius;
          const dx = s.x - u.x;
          const dy = s.y - u.y;
          if (dx * dx + dy * dy <= r * r) {
            vis = true;
            break;
          }
        }
        u.visibleTo[team] = vis;
      }
    }
  }

  isVisibleTo(u, team) {
    return u.team === team || u.visibleTo[team];
  }

  updateRegen(u, dt) {
    const s = u.ensureStats();
    if (u.kind === 'structure') return;
    if (u.hp < s.maxHp) u.hp = Math.min(s.maxHp, u.hp + s.hpRegen * dt);
    if (u.mana < s.maxMana) u.mana = Math.min(s.maxMana, u.mana + s.manaRegen * dt);
    if (u.kind === 'champion') {
      const f = this.map.fountains[u.team];
      if (u.distToPoint(f.x, f.y) <= FOUNTAIN.healRadius) {
        u.hp = Math.min(s.maxHp, u.hp + s.maxHp * FOUNTAIN.healPct * dt);
        u.mana = Math.min(s.maxMana, u.mana + s.maxMana * FOUNTAIN.healPct * dt);
      }
      if (hasPassive(u, 'warmogs') && u.isOutOfCombat(this.time, 6)) u.hp = Math.min(s.maxHp, u.hp + s.maxHp * 0.03 * dt);
      if (hasPassive(u, 'sunfire')) {
        u.sunfireTimer = (u.sunfireTimer || 0) - dt;
        if (u.sunfireTimer <= 0) {
          u.sunfireTimer = 1;
          for (const e of this.units) {
            if (!e.alive || e.team === u.team || e.kind === 'structure' || e.team > 1 && e.resetting) continue;
            if (u.distTo(e) <= 325 + e.radius) dealDamage(this, u, e, 20 + 2 * u.level, 'magic', { dot: true });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ champions
  updateChampion(c, dt) {
    if (!c.alive) {
      c.respawnTimer -= dt;
      if (c.respawnTimer <= 0) this.respawnChampion(c);
      return;
    }
    c.gold += GOLD.passivePerSecond * dt * (c.bot && c.bot.goldMult ? c.bot.goldMult : 1);
    c.totalGold += GOLD.passivePerSecond * dt;
    for (const key of ['Q', 'W', 'E', 'R']) if (c.abilities[key].cd > 0) c.abilities[key].cd = Math.max(0, c.abilities[key].cd - dt);
    for (const s of c.spells) if (s.cd > 0) s.cd = Math.max(0, s.cd - dt);
    if (c.castLock > 0) c.castLock = Math.max(0, c.castLock - dt);
    if (c.spellbladeCd > 0) c.spellbladeCd -= dt;
    if (c.attackCd > 0) c.attackCd = Math.max(0, c.attackCd - dt);
    if (c.def.hooks && c.def.hooks.update) c.def.hooks.update(this, c, dt);
    if (c.bot || this.opts.autoLevel || this.opts.allBots) this.autoLevel(c);
    c.ensureStats();
    if (c.recall) {
      c.recall.remaining -= dt;
      if (c.recall.remaining <= 0) this.finishRecall(c);
      return;
    }
    if (c.bot) updateBot(this, c, dt);
    this.processOrder(c, dt);
    updateAttackWindup(this, c, dt);
  }

  acquireTarget(u, range, preferChampions = false) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || e.team > 1 && e.resetting) continue;
      if (e.kind === 'structure' && !this.isStructureTargetable(e)) continue;
      if (!isTargetable(this, e, u.team)) continue;
      const d = u.edgeDistTo(e);
      if (d > range) continue;
      let score = d;
      if (preferChampions && e.kind === 'champion') score -= 10000;
      if (e.kind === 'structure') score += 500;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  processOrder(c, dt) {
    const taunter = c.tauntedBy;
    if (taunter && taunter.alive) c.order = { type: 'attack', target: taunter, forced: true };
    const o = c.order;
    if (!o) {
      if (!c.windup && c.attackCd <= 0 && c.canAttack() && c.castLock <= 0) {
        const t = this.acquireTarget(c, c.stats.range, false);
        if (t) tryStartAttack(this, c, t);
      }
      c.moved = false;
      return;
    }
    if (c.castLock > 0) {
      c.moved = false;
      return;
    }
    switch (o.type) {
      case 'move': {
        if (c.windup) cancelAttack(c);
        const arrived = this.moveUnitToward(c, o.x, o.y, dt, 6);
        if (arrived) c.order = null;
        break;
      }
      case 'hold': {
        if (!c.windup && c.attackCd <= 0) {
          const t = this.acquireTarget(c, c.stats.range, true);
          if (t) tryStartAttack(this, c, t);
        }
        break;
      }
      case 'attack':
      case 'attackMove': {
        let t = o.target;
        if (o.type === 'attackMove' && (!t || !isTargetable(this, t, c.team))) {
          t = this.acquireTarget(c, c.stats.range + 250, true);
          o.target = t;
        }
        if (!t || !isTargetable(this, t, c.team)) {
          if (o.type === 'attackMove') {
            const arrived = this.moveUnitToward(c, o.x, o.y, dt, 6);
            if (arrived) c.order = null;
          } else c.order = null;
          break;
        }
        if (c.inAttackRange(t)) {
          if (!c.windup) tryStartAttack(this, c, t);
          c.moved = false;
        } else if (!c.windup) {
          this.moveUnitToward(c, t.x, t.y, dt, 0);
        }
        break;
      }
      case 'cast': {
        const ab = c.abilities[o.key];
        const t = o.target;
        const err = this.validateUnitTarget(c, ab.def, t);
        if (err && err !== 'range') {
          c.order = o.resume || null;
          break;
        }
        if (!err) {
          const res = this.castAbility(c, o.key, { target: t });
          if (res.ok || res.reason !== 'busy') c.order = o.resume || null;
        } else if (!c.windup) this.moveUnitToward(c, t.x, t.y, dt, 0);
        break;
      }
      case 'castSpell': {
        const def = SUMMONER_SPELLS[c.spells[o.idx].id];
        const t = o.target;
        const err = this.validateUnitTarget(c, def, t);
        if (err && err !== 'range') {
          c.order = o.resume || null;
          break;
        }
        if (!err) {
          this.castSpell(c, o.idx, { target: t });
          c.order = o.resume || null;
        } else if (!c.windup) this.moveUnitToward(c, t.x, t.y, dt, 0);
        break;
      }
      default:
        c.order = null;
    }
  }

  // ------------------------------------------------------------ minions
  updateMinion(m, dt) {
    if (m.attackCd > 0) m.attackCd = Math.max(0, m.attackCd - dt);
    const lane = m.waypoints;
    if (m.target) {
      const t = m.target;
      const onLane = closestOnPolyline(lane, m);
      if (!isTargetable(this, t, m.team) || (t.kind !== 'structure' && onLane.dist > MINION.leash) || (m.targetUntil && this.time > m.targetUntil && t.kind === 'champion' && !m.inAttackRange(t, 100))) {
        m.target = null;
        m.targetUntil = 0;
      }
    }
    m.acquireTimer -= dt;
    if (m.acquireTimer <= 0) {
      m.acquireTimer = 0.25 + this.rng() * 0.1;
      if (!m.target || (m.target.kind === 'structure' && !m.inAttackRange(m.target, 50))) {
        const t = this.acquireMinionTarget(m);
        if (t) m.target = t;
      }
    }
    if (m.target) {
      if (m.inAttackRange(m.target)) {
        if (!m.windup) tryStartAttack(this, m, m.target);
        m.moved = false;
      } else if (!m.windup) {
        this.moveUnitToward(m, m.target.x, m.target.y, dt, 0);
      }
    } else if (!m.windup) {
      const wp = lane[m.wpIdx];
      if (wp) {
        const arrived = this.moveUnitToward(m, wp.x, wp.y, dt, 80);
        if (arrived && m.wpIdx < lane.length - 1) m.wpIdx++;
      }
    }
    updateAttackWindup(this, m, dt);
  }

  acquireMinionTarget(m) {
    let best = null;
    let bestScore = -Infinity;
    const range = MINION.acquireRange + (m.ranged ? 100 : 0);
    for (const e of this.units) {
      if (!e.alive || e.team === m.team || e.team > 1) continue;
      if (!isTargetable(this, e, m.team)) continue;
      const d = m.edgeDistTo(e);
      if (d > range) continue;
      let pri;
      if (e.kind === 'minion') pri = 4;
      else if (e.kind === 'structure') pri = 3;
      else if (e.kind === 'champion') pri = 2;
      else continue;
      const score = pri * 1000 - d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ structures
  updateStructure(s, dt) {
    if (!s.alive) {
      if (s.stype === 'inhibitor') {
        s.respawnTimer -= dt;
        if (s.respawnTimer <= 0) {
          s.alive = true;
          s.statsDirty = true;
          s.ensureStats();
          s.hp = s.maxHp;
          this.pushEvent({ type: 'inhibitor_respawn', team: s.team, lane: s.lane });
        }
      }
      return;
    }
    if (s.stype !== 'tower' && s.stype !== 'fountain') return;
    if (s.attackCd > 0) s.attackCd = Math.max(0, s.attackCd - dt);
    const range = s.stats.range;
    if (s.target && (!isTargetable(this, s.target, s.team) || s.edgeDistTo(s.target) > range + 20 || s.target.team > 1)) s.target = null;
    if (s.aggro && this.time > s.aggro.until) s.aggro = null;
    if (s.aggro) {
      const a = this.unitById(s.aggro.id);
      if (a && a.alive && isTargetable(this, a, s.team) && s.edgeDistTo(a) <= range) s.target = a;
      else s.aggro = null;
    }
    if (!s.target) {
      let best = null;
      let bestScore = Infinity;
      for (const e of this.units) {
        if (!e.alive || e.team === s.team || e.team > 1) continue;
        if (e.kind === 'structure') continue;
        if (!isTargetable(this, e, s.team)) continue;
        const d = s.edgeDistTo(e);
        if (d > range) continue;
        const score = d + (e.kind === 'champion' ? 5000 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
      s.target = best;
    }
    if (s.target && !s.windup && s.attackCd <= 0) tryStartAttack(this, s, s.target);
    updateAttackWindup(this, s, dt);
  }

  // ------------------------------------------------------------ monsters
  updateMonster(m, dt) {
    if (m.attackCd > 0) m.attackCd = Math.max(0, m.attackCd - dt);
    const camp = m.camp;
    if (m.resetting) {
      const arrived = this.moveUnitToward(m, m.home.x, m.home.y, dt, 10);
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt);
      if (arrived) {
        m.resetting = false;
        m.hp = m.maxHp;
        m.target = null;
      }
      return;
    }
    if (m.target) {
      const t = m.target;
      const far = Math.hypot(t.x - camp.x, t.y - camp.y) > (m.def.epic ? 1100 : 900) || Math.hypot(m.x - camp.x, m.y - camp.y) > (m.def.epic ? 900 : 800);
      if (!t.alive || far || (t.kind === 'champion' && !t.visibleTo[2] && m.distTo(t) > 700)) {
        m.target = null;
        if (far) {
          m.resetting = true;
          m.recentDamagers.clear();
          return;
        }
      }
    }
    if (!m.target) {
      // retaliate against whoever is hurting the camp
      let best = null;
      let bestT = -Infinity;
      for (const [id, t] of m.recentDamagers) {
        if (this.time - t > 3) continue;
        const u = this.unitById(id);
        if (u && u.alive && t > bestT) {
          bestT = t;
          best = u;
        }
      }
      if (best) m.target = best;
    }
    if (m.target) {
      if (m.inAttackRange(m.target)) {
        if (!m.windup) tryStartAttack(this, m, m.target);
        m.moved = false;
      } else if (!m.windup && !m.immobile) this.moveUnitToward(m, m.target.x, m.target.y, dt, 0);
    } else if (Math.hypot(m.x - m.home.x, m.y - m.home.y) > 20) {
      this.moveUnitToward(m, m.home.x, m.home.y, dt, 10);
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.1 * dt);
    } else if (m.hp < m.maxHp && this.time - m.lastDamageTime > 5) {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.1 * dt);
    }
    updateAttackWindup(this, m, dt);
  }

  // ------------------------------------------------------------ movement
  // Moves the unit toward a goal using straight lines when possible and A* otherwise.
  // Returns true when the unit is within `arriveDist` of the goal.
  moveUnitToward(u, tx, ty, dt, arriveDist = 8) {
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d <= Math.max(arriveDist, 1)) {
      u.path = null;
      return true;
    }
    if (!u.canMove()) return false;
    const nav = this.map.nav;
    u.pathTimer -= dt;
    const goalChanged = !u.pathGoal || Math.hypot(u.pathGoal.x - tx, u.pathGoal.y - ty) > 40;
    if (!u.path || goalChanged || u.pathTimer <= 0) {
      u.pathGoal = { x: tx, y: ty };
      u.pathTimer = 0.6 + this.rng() * 0.2;
      if (nav.lineOfSight(u.x, u.y, tx, ty)) u.path = [{ x: tx, y: ty }];
      else {
        const p = nav.findPath(u.x, u.y, tx, ty);
        u.path = p.length ? p : [{ x: tx, y: ty }];
      }
      u.pathIdx = 0;
    }
    let remaining = u.stats.moveSpeed * dt;
    while (remaining > 0 && u.pathIdx < u.path.length) {
      const wp = u.path[u.pathIdx];
      const dx = wp.x - u.x;
      const dy = wp.y - u.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remaining) {
        u.x = wp.x;
        u.y = wp.y;
        remaining -= dist;
        u.pathIdx++;
      } else {
        u.x += (dx / dist) * remaining;
        u.y += (dy / dist) * remaining;
        u.facing = Math.atan2(dy, dx);
        remaining = 0;
      }
    }
    u.moved = true;
    if (u.pathIdx >= u.path.length) {
      u.path = null;
      return Math.hypot(tx - u.x, ty - u.y) <= Math.max(arriveDist, 1);
    }
    return false;
  }

  updateMovement(dt) {
    const alive = [];
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.prevX === undefined) {
        u.prevX = u.x;
        u.prevY = u.y;
      }
      if (u.dash) {
        const d = u.dash;
        const dx = d.tx - u.x;
        const dy = d.ty - u.y;
        const dist = Math.hypot(dx, dy);
        const step = d.speed * dt;
        if (dist <= step) {
          u.x = d.tx;
          u.y = d.ty;
          u.dash = null;
          if (d.onArrive) d.onArrive(this, u);
        } else {
          u.x += (dx / dist) * step;
          u.y += (dy / dist) * step;
        }
        u.moved = true;
      }
      if (!u.immobile) alive.push(u);
    }
    // soft unit separation
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      if (a.dash) continue;
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        if (b.dash) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const overlap = (minD - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        const total = a.mass + b.mass;
        const wa = b.mass / total;
        const wb = a.mass / total;
        a.x -= nx * overlap * wa;
        a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb;
        b.y += ny * overlap * wb;
      }
    }
    // structures are solid
    for (const u of alive) {
      for (const s of this.structures) {
        if (s.stype === 'fountain') continue;
        const dx = u.x - s.x;
        const dy = u.y - s.y;
        const minD = u.radius + s.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2) || 0.001;
        u.x = s.x + (dx / d) * minD;
        u.y = s.y + (dy / d) * minD;
      }
      // keep inside map and off walls
      u.x = Math.max(20, Math.min(MAP_SIZE - 20, u.x));
      u.y = Math.max(20, Math.min(MAP_SIZE - 20, u.y));
      if (!this.map.isWalkable(u.x, u.y)) {
        if (this.map.isWalkable(u.prevX, u.prevY) && !u.dash) {
          u.x = u.prevX;
          u.y = u.prevY;
        } else {
          const p = this.map.nearestWalkable(u.x, u.y, 10);
          if (p) {
            u.x = p.x;
            u.y = p.y;
          }
        }
      }
      u.vx = (u.x - u.prevX) / dt;
      u.vy = (u.y - u.prevY) / dt;
      u.prevX = u.x;
      u.prevY = u.y;
    }
  }

  // ------------------------------------------------------------ projectiles
  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      if (p.target) {
        const t = p.target;
        if (!t.alive) {
          p.alive = false;
          continue;
        }
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (d <= step + t.radius * 0.5) {
          p.alive = false;
          if (p.onHit) p.onHit(this, t, p);
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
          p.dx = dx / d;
          p.dy = dy / d;
        }
        continue;
      }
      const step = Math.min(p.speed * dt, p.maxDist - p.traveled);
      const sx = p.x;
      const sy = p.y;
      p.x += p.dx * step;
      p.y += p.dy * step;
      p.traveled += step;
      // sweep test against enemies along the segment, nearest along the path first
      const abx = p.x - sx;
      const aby = p.y - sy;
      const l2 = abx * abx + aby * aby;
      const hits = [];
      for (const u of this.units) {
        if (!u.alive || u.team === p.team || p.hitIds.has(u.id)) continue;
        if (u.team > 1 && u.resetting) continue;
        if (u.kind === 'structure' && !p.hitsStructures) continue;
        if (p.hitsChampionsOnly && u.kind !== 'champion') continue;
        if (u.untargetable) continue;
        if (p.filter && !p.filter(u)) continue;
        const r = p.hitRadius + u.radius;
        let t = 0;
        if (l2 > 0) t = Math.max(0, Math.min(1, ((u.x - sx) * abx + (u.y - sy) * aby) / l2));
        const cx = sx + abx * t;
        const cy = sy + aby * t;
        if ((u.x - cx) * (u.x - cx) + (u.y - cy) * (u.y - cy) > r * r) continue;
        hits.push({ u, t });
      }
      if (hits.length > 1) hits.sort((a, b) => a.t - b.t);
      for (const { u } of hits) {
        p.hitIds.add(u.id);
        p.hits++;
        if (p.onHit) p.onHit(this, u, p);
        if (p.hits >= p.maxHits) {
          p.alive = false;
          break;
        }
      }
      if (p.alive && p.traveled >= p.maxDist) {
        p.alive = false;
        if (p.onExpire) p.onExpire(this, p);
      }
    }
  }

  cleanup() {
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
    let removed = false;
    for (const u of this.units) {
      if (!u.alive && (u.kind === 'minion' || u.kind === 'monster')) {
        this.unitMap.delete(u.id);
        removed = true;
      }
    }
    if (removed) {
      this.units = this.units.filter((u) => u.alive || (u.kind !== 'minion' && u.kind !== 'monster'));
      this.minions = this.minions.filter((m) => m.alive);
      this.monsters = this.monsters.filter((m) => m.alive);
    }
  }

  // ------------------------------------------------------------ queries used by AI and UI
  laneProgress(team, lane, x, y) {
    const wps = this.map.lanes[team][lane];
    return closestOnPolyline(wps, { x, y }).along;
  }

  laneLength(lane) {
    return polylineLength(this.map.lanes[TEAM.BLUE][lane]);
  }

  lanePoint(team, lane, along) {
    return pointAlongPolyline(this.map.lanes[team][lane], along);
  }

  drainFx() {
    if (this.opts.headless) return [];
    const out = this.fx;
    this.fx = [];
    return out;
  }
}

export { TEAM_COLORS };
