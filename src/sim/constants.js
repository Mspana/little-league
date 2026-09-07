// Global tunables for the Little League simulation.
// All distances are in world units, all times in seconds.

export const MAP_SIZE = 6000;
export const CELL = 25;

export const TEAM = { BLUE: 0, RED: 1 };
export const TEAM_NAMES = ['Blue', 'Red'];
export const enemyOf = (team) => 1 - team;

export const TIMING = {
  firstWave: 30,
  waveInterval: 30,
  siegeEvery: 3,
  minionScaleInterval: 90,
  campSpawn: 75,
  campRespawn: 120,
  dragonSpawn: 240,
  dragonRespawn: 300,
  baronSpawn: 840,
  baronRespawn: 360,
  inhibitorRespawn: 300,
  recallDuration: 8,
  groupTime: 900,
  assistWindow: 10,
  outOfCombat: 6,
};

export const GOLD = {
  start: 500,
  passivePerSecond: 2.0,
  kill: 300,
  firstBloodBonus: 100,
  assistPool: 150,
  towerKiller: 150,
  towerTeam: 100,
  inhibitorTeam: 50,
  nexusTowerTeam: 50,
  sellRatio: 0.7,
};

export const XP = {
  kill: 120,
  killPerLevel: 25,
  towerTeam: 100,
  shareRadius: 1400,
};

// XP needed to go from level (index) to level (index + 1). Level 1 -> 2 needs 280.
export const XP_PER_LEVEL = [0, 280, 380, 480, 580, 680, 780, 880, 980, 1080, 1180, 1280, 1380, 1480, 1580, 1680, 1780, 1880];
export const MAX_LEVEL = 18;

export const SIGHT = {
  champion: 1100,
  minion: 800,
  tower: 1000,
  structure: 700,
  monster: 500,
};

export const RESPAWN = { base: 6, perLevel: 2, max: 45 };

export const FOUNTAIN = { healRadius: 450, healPct: 0.12, laserRange: 750, laserDamage: 1200, laserPeriod: 0.4 };

export const MINION = {
  acquireRange: 500,
  leash: 800,
  melee: { hp: 480, ad: 12, armor: 0, mr: 0, range: 110, ms: 325, gold: 21, xp: 60, radius: 24, hpGrowth: 24, adGrowth: 1.2 },
  caster: { hp: 300, ad: 24, armor: 0, mr: 0, range: 500, ms: 325, gold: 14, xp: 30, radius: 22, hpGrowth: 9, adGrowth: 1.6 },
  siege: { hp: 900, ad: 41, armor: 30, mr: 0, range: 300, ms: 325, gold: 60, xp: 92, radius: 30, hpGrowth: 40, adGrowth: 2.5 },
  super: { hp: 1600, ad: 65, armor: 30, mr: 30, range: 170, ms: 335, gold: 60, xp: 97, radius: 34, hpGrowth: 60, adGrowth: 3 },
  projectileSpeed: 1100,
};

export const TOWER = {
  hp: { 1: 3600, 2: 3400, 3: 3300, 4: 2800 },
  ad: 170,
  adPerMinute: 4,
  adMax: 300,
  attackPeriod: 1.2,
  range: 775,
  radius: 62,
  heatPerShot: 0.15,
  heatMax: 0.9,
  projectileSpeed: 1300,
};

export const INHIBITOR = { hp: 2600, radius: 72 };
export const NEXUS = { hp: 4200, radius: 100 };

export const ATTACK = { windupFraction: 0.28, minWindup: 0.12 };
