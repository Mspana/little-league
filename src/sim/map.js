// Summoner's-Rift-style map: three lanes, a river, two jungles, and bases in
// opposite corners. Terrain is defined as "carved" walkable shapes; everything
// that is not carved is solid forest.
import { MAP_SIZE, CELL, TEAM, TOWER, INHIBITOR, NEXUS } from './constants.js';
import { segmentDistance } from './math.js';
import { NavGrid, erode } from './nav.js';

const S = MAP_SIZE;
export const mirror = (p) => ({ x: S - p.x, y: S - p.y });

const LANES_BLUE = {
  top: [
    { x: 500, y: 5500 },
    { x: 500, y: 1300 },
    { x: 1300, y: 500 },
    { x: 5500, y: 500 },
  ],
  mid: [
    { x: 500, y: 5500 },
    { x: 5500, y: 500 },
  ],
  bot: [
    { x: 500, y: 5500 },
    { x: 4700, y: 5500 },
    { x: 5500, y: 4700 },
    { x: 5500, y: 500 },
  ],
};

const RIVER = [
  { x: 1000, y: 1000 },
  { x: 3000, y: 3000 },
  { x: 5000, y: 5000 },
];

// Blue-side jungle. Everything here is mirrored for red.
const CAMPS_BLUE = [
  { id: 'wolves', name: 'Wolves', x: 1600, y: 3600 },
  { id: 'blue', name: 'Blue Sentinel', x: 1150, y: 2600 },
  { id: 'raptors', name: 'Raptors', x: 2500, y: 4500 },
  { id: 'red', name: 'Red Brambleback', x: 3700, y: 4950 },
];
export const DRAGON_POS = { x: 3850, y: 4350 };
export const BARON_POS = mirror(DRAGON_POS);

const PATHS_BLUE = [
  [{ x: 600, y: 4400 }, { x: 1600, y: 3600 }],
  [{ x: 1600, y: 3600 }, { x: 1150, y: 2600 }],
  [{ x: 1150, y: 2600 }, { x: 600, y: 2400 }],
  [{ x: 1150, y: 2600 }, { x: 1900, y: 1900 }],
  [{ x: 1600, y: 3600 }, { x: 2200, y: 3800 }],
  [{ x: 1400, y: 5400 }, { x: 2500, y: 4500 }],
  [{ x: 2500, y: 4500 }, { x: 3700, y: 4950 }],
  [{ x: 3700, y: 4950 }, { x: 3700, y: 5350 }],
  [{ x: 2500, y: 4500 }, { x: 2300, y: 3700 }],
  [{ x: 3700, y: 4950 }, { x: 3850, y: 4350 }],
  [{ x: 3850, y: 4350 }, { x: 4150, y: 4150 }],
];

export const LANE_NAMES = ['top', 'mid', 'bot'];

function mirrorPoly(pts) {
  return pts.map(mirror);
}

function buildCarves() {
  const carves = [];
  for (const lane of LANE_NAMES) carves.push({ type: 'poly', pts: LANES_BLUE[lane], width: 400 });
  carves.push({ type: 'poly', pts: RIVER, width: 380 });
  const sided = [];
  sided.push({ type: 'rect', x0: 150, y0: 4550, x1: 1450, y1: 5850 });
  sided.push({ type: 'circle', x: 1400, y: 4600, r: 350 });
  for (const c of CAMPS_BLUE) sided.push({ type: 'circle', x: c.x, y: c.y, r: 260 });
  sided.push({ type: 'circle', x: DRAGON_POS.x, y: DRAGON_POS.y, r: 330 });
  for (const p of PATHS_BLUE) sided.push({ type: 'poly', pts: p, width: 250 });
  for (const s of sided) {
    carves.push(s);
    if (s.type === 'poly') carves.push({ type: 'poly', pts: mirrorPoly(s.pts), width: s.width });
    else if (s.type === 'circle') carves.push({ type: 'circle', x: S - s.x, y: S - s.y, r: s.r });
    else if (s.type === 'rect') carves.push({ type: 'rect', x0: S - s.x1, y0: S - s.y1, x1: S - s.x0, y1: S - s.y0 });
  }
  return carves;
}

function insideCarve(c, x, y) {
  if (c.type === 'circle') return (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= c.r * c.r;
  if (c.type === 'rect') return x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
  const hw = c.width / 2;
  const p = { x, y };
  for (let i = 0; i < c.pts.length - 1; i++) {
    if (segmentDistance(p, c.pts[i], c.pts[i + 1]) <= hw) return true;
  }
  return false;
}

function laneStructuresBlue() {
  // Positions were derived from distances along each lane from the nexus.
  return [
    { kind: 'tower', lane: 'top', tier: 1, x: 500, y: 1870 },
    { kind: 'tower', lane: 'top', tier: 2, x: 500, y: 3210 },
    { kind: 'tower', lane: 'top', tier: 3, x: 500, y: 4350 },
    { kind: 'inhibitor', lane: 'top', tier: 0, x: 500, y: 4650 },
    { kind: 'tower', lane: 'mid', tier: 1, x: 2500, y: 3500 },
    { kind: 'tower', lane: 'mid', tier: 2, x: 2000, y: 4000 },
    { kind: 'tower', lane: 'mid', tier: 3, x: 1400, y: 4600 },
    { kind: 'inhibitor', lane: 'mid', tier: 0, x: 1150, y: 4850 },
    { kind: 'tower', lane: 'bot', tier: 1, x: 4130, y: 5500 },
    { kind: 'tower', lane: 'bot', tier: 2, x: 2790, y: 5500 },
    { kind: 'tower', lane: 'bot', tier: 3, x: 1650, y: 5500 },
    { kind: 'inhibitor', lane: 'bot', tier: 0, x: 1350, y: 5500 },
    { kind: 'tower', lane: 'nexus', tier: 4, x: 973, y: 5337 },
    { kind: 'tower', lane: 'nexus', tier: 4, x: 663, y: 5027 },
    { kind: 'nexus', lane: 'nexus', tier: 0, x: 500, y: 5500 },
    { kind: 'fountain', lane: 'nexus', tier: 0, x: 250, y: 5750 },
  ];
}

export function structureRadius(kind) {
  if (kind === 'tower') return TOWER.radius;
  if (kind === 'inhibitor') return INHIBITOR.radius;
  if (kind === 'nexus') return NEXUS.radius;
  return 0;
}

export function createMap() {
  const cols = Math.ceil(S / CELL);
  const rows = cols;
  const carves = buildCarves();
  const raw = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y = (cy + 0.5) * CELL;
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * CELL;
      let ok = false;
      for (let i = 0; i < carves.length; i++) {
        if (insideCarve(carves[i], x, y)) {
          ok = true;
          break;
        }
      }
      raw[cy * cols + cx] = ok ? 1 : 0;
    }
  }

  const structures = [];
  for (const s of laneStructuresBlue()) {
    structures.push({ ...s, team: TEAM.BLUE });
    const m = mirror(s);
    structures.push({ ...s, team: TEAM.RED, x: m.x, y: m.y });
  }
  // Structures block movement (rubble stays after they fall).
  for (const s of structures) {
    const r = structureRadius(s.kind);
    if (r <= 0) continue;
    const pad = r + 8;
    const cx0 = Math.max(0, Math.floor((s.x - pad) / CELL));
    const cx1 = Math.min(cols - 1, Math.floor((s.x + pad) / CELL));
    const cy0 = Math.max(0, Math.floor((s.y - pad) / CELL));
    const cy1 = Math.min(rows - 1, Math.floor((s.y + pad) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const x = (cx + 0.5) * CELL;
        const y = (cy + 0.5) * CELL;
        if ((x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) <= pad * pad) raw[cy * cols + cx] = 0;
      }
    }
  }

  const navWalk = erode(raw, cols, rows, 1);
  const nav = new NavGrid(cols, rows, CELL, navWalk);

  const lanes = {
    [TEAM.BLUE]: LANES_BLUE,
    [TEAM.RED]: {
      top: mirrorPoly(LANES_BLUE.top),
      mid: mirrorPoly(LANES_BLUE.mid),
      bot: mirrorPoly(LANES_BLUE.bot),
    },
  };
  // Red's "top" lane must be geometrically the same lane as blue's top lane.
  // Mirroring blue's top lane gives the bot-lane geometry, so swap them.
  lanes[TEAM.RED] = {
    top: mirrorPoly(LANES_BLUE.bot),
    mid: mirrorPoly(LANES_BLUE.mid),
    bot: mirrorPoly(LANES_BLUE.top),
  };

  const camps = [];
  for (const c of CAMPS_BLUE) {
    camps.push({ ...c, side: TEAM.BLUE });
    const m = mirror(c);
    camps.push({ ...c, side: TEAM.RED, x: m.x, y: m.y });
  }

  const fountains = {
    [TEAM.BLUE]: { x: 250, y: 5750 },
    [TEAM.RED]: mirror({ x: 250, y: 5750 }),
  };
  const nexuses = {
    [TEAM.BLUE]: { x: 500, y: 5500 },
    [TEAM.RED]: mirror({ x: 500, y: 5500 }),
  };

  const isWalkable = (x, y) => {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    return raw[cy * cols + cx] === 1;
  };

  return {
    size: S,
    cell: CELL,
    cols,
    rows,
    raw,
    nav,
    carves,
    river: RIVER,
    lanes,
    structures,
    camps,
    dragon: DRAGON_POS,
    baron: BARON_POS,
    fountains,
    nexuses,
    isWalkable,
    isNav: (x, y) => nav.isWalkable(x, y),
    nearestWalkable: (x, y, rings) => nav.nearestWalkable(x, y, rings),
  };
}
