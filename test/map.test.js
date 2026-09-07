import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMap, mirror, LANE_NAMES } from '../src/sim/map.js';
import { MAP_SIZE, TEAM } from '../src/sim/constants.js';

const map = createMap();

test('the map is point-symmetric: every blue structure has a red twin', () => {
  const blue = map.structures.filter((s) => s.team === TEAM.BLUE);
  const red = map.structures.filter((s) => s.team === TEAM.RED);
  assert.equal(blue.length, red.length);
  for (const s of blue) {
    const m = mirror(s);
    const twin = red.find((r) => r.kind === s.kind && r.lane === s.lane && r.tier === s.tier && Math.abs(r.x - m.x) < 1 && Math.abs(r.y - m.y) < 1);
    assert.ok(twin, `missing mirrored ${s.kind} ${s.lane} ${s.tier}`);
  }
});

test('each team has 11 turrets, 3 inhibitors, a nexus and a fountain', () => {
  for (const team of [TEAM.BLUE, TEAM.RED]) {
    const mine = map.structures.filter((s) => s.team === team);
    assert.equal(mine.filter((s) => s.kind === 'tower').length, 11);
    assert.equal(mine.filter((s) => s.kind === 'inhibitor').length, 3);
    assert.equal(mine.filter((s) => s.kind === 'nexus').length, 1);
    assert.equal(mine.filter((s) => s.kind === 'fountain').length, 1);
  }
});

test('lanes are walkable along their whole length and structures can be approached', () => {
  for (const team of [TEAM.BLUE, TEAM.RED]) {
    for (const lane of LANE_NAMES) {
      const pts = map.lanes[team][lane];
      for (let i = 0; i < pts.length - 1; i++) {
        for (let t = 0.05; t < 1; t += 0.05) {
          const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
          const y = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
          const near = map.structures.some((s) => Math.hypot(s.x - x, s.y - y) < 120);
          if (!near) assert.ok(map.isWalkable(x, y), `${lane} lane point ${Math.round(x)},${Math.round(y)} should be walkable`);
        }
      }
    }
  }
  for (const s of map.structures) {
    if (s.kind === 'fountain') continue;
    let open = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) if (map.isNav(s.x + Math.cos(a) * 140, s.y + Math.sin(a) * 140)) open++;
    assert.ok(open >= 4, `${s.kind} ${s.lane} ${s.tier} must be approachable`);
  }
});

test('red lanes are the geometric mirror of blue lanes, traversed the other way', () => {
  for (const lane of LANE_NAMES) {
    const blue = map.lanes[TEAM.BLUE][lane];
    const red = map.lanes[TEAM.RED][lane];
    assert.deepEqual(red[0], blue[blue.length - 1]);
    assert.deepEqual(red[red.length - 1], blue[0]);
  }
});

test('jungle camps and epic pits sit on open ground inside the map', () => {
  for (const c of map.camps) {
    assert.ok(map.isNav(c.x, c.y), `${c.id} must be walkable`);
    assert.ok(c.x > 0 && c.y > 0 && c.x < MAP_SIZE && c.y < MAP_SIZE);
  }
  assert.ok(map.isNav(map.dragon.x, map.dragon.y));
  assert.ok(map.isNav(map.baron.x, map.baron.y));
  assert.deepEqual(map.baron, mirror(map.dragon));
});
