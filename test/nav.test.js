import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/sim/map.js';
import { erode } from '../src/sim/nav.js';

const map = createMap();

test('a path exists from the blue fountain to the red fountain and stays on walkable ground', () => {
  const a = map.fountains[0];
  const b = map.fountains[1];
  const path = map.nav.findPath(a.x, a.y, b.x, b.y);
  assert.ok(path.length > 0, 'path should not be empty');
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - b.x, end.y - b.y) < 60, 'path should end near the goal');
  let prev = a;
  for (const p of path) {
    assert.ok(map.isNav(p.x, p.y), `waypoint ${p.x},${p.y} must be walkable`);
    assert.ok(map.nav.lineOfSight(prev.x, prev.y, p.x, p.y), 'consecutive waypoints must have line of sight');
    prev = p;
  }
});

test('paths through the jungle reach camps', () => {
  for (const camp of map.camps) {
    const from = map.fountains[camp.side];
    const path = map.nav.findPath(from.x, from.y, camp.x, camp.y);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - camp.x, end.y - camp.y) < 60, `camp ${camp.id} should be reachable`);
  }
});

test('nearestWalkable snaps points inside walls to open ground', () => {
  const p = map.nearestWalkable(60, 60, 40);
  assert.ok(p, 'should find a walkable point');
  assert.ok(map.isNav(p.x, p.y));
  const open = map.nearestWalkable(3000, 3000, 2);
  assert.deepEqual(open, { x: 3000, y: 3000 });
});

test('erode never adds walkable cells', () => {
  const eroded = erode(map.raw, map.cols, map.rows, 1);
  let rawCount = 0;
  let erodedCount = 0;
  for (let i = 0; i < map.raw.length; i++) {
    rawCount += map.raw[i];
    erodedCount += eroded[i];
    assert.ok(!(eroded[i] === 1 && map.raw[i] === 0));
  }
  assert.ok(erodedCount < rawCount);
});

test('line of sight is blocked by forest', () => {
  assert.equal(map.nav.lineOfSight(3000, 3000, 3200, 2800), true);
  assert.equal(map.nav.lineOfSight(500, 3000, 2500, 3000), false);
});
