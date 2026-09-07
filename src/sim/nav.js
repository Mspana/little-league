// Grid based navigation: A* with a binary heap, line-of-sight simplification,
// and helpers for snapping points to walkable ground.

class MinHeap {
  constructor(scores) {
    this.scores = scores;
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(i) {
    const items = this.items;
    items.push(i);
    let c = items.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.scores[items[p]] <= this.scores[items[c]]) break;
      [items[p], items[c]] = [items[c], items[p]];
      c = p;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let p = 0;
      const n = items.length;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < n && this.scores[items[l]] < this.scores[items[m]]) m = l;
        if (r < n && this.scores[items[r]] < this.scores[items[m]]) m = r;
        if (m === p) break;
        [items[p], items[m]] = [items[m], items[p]];
        p = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

export class NavGrid {
  constructor(cols, rows, cell, walkable) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.walk = walkable; // Uint8Array, 1 = walkable
    const n = cols * rows;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.state = new Uint8Array(n);
    this.gen = 0;
  }

  idx(cx, cy) {
    return cy * this.cols + cx;
  }

  cellX(x) {
    return Math.floor(x / this.cell);
  }
  cellY(y) {
    return Math.floor(y / this.cell);
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  isCellWalkable(cx, cy) {
    return this.inBounds(cx, cy) && this.walk[cy * this.cols + cx] === 1;
  }

  isWalkable(x, y) {
    return this.isCellWalkable(this.cellX(x), this.cellY(y));
  }

  cellCenter(cx, cy) {
    return { x: (cx + 0.5) * this.cell, y: (cy + 0.5) * this.cell };
  }

  // Nearest walkable world point to (x, y), searching in growing rings.
  nearestWalkable(x, y, maxRings = 12) {
    const cx = this.cellX(x);
    const cy = this.cellY(y);
    if (this.isCellWalkable(cx, cy)) return { x, y };
    let best = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxRings; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isCellWalkable(nx, ny)) continue;
          const c = this.cellCenter(nx, ny);
          const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Samples the segment on the grid; true when every sample lies on walkable ground.
  lineOfSight(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  // Returns an array of world points (excluding the start) leading to the target.
  // If the target is not walkable, the closest walkable cell is used instead.
  findPath(sx, sy, tx, ty, maxExpansions = 60000) {
    const start = this.nearestWalkable(sx, sy) || { x: sx, y: sy };
    const goal = this.nearestWalkable(tx, ty);
    if (!goal) return [];
    const scx = this.cellX(start.x);
    const scy = this.cellY(start.y);
    const gcx = this.cellX(goal.x);
    const gcy = this.cellY(goal.y);
    if (scx === gcx && scy === gcy) return [{ x: goal.x, y: goal.y }];
    if (this.lineOfSight(start.x, start.y, goal.x, goal.y)) return [{ x: goal.x, y: goal.y }];

    this.gen++;
    const gen = this.gen;
    const { cols, rows, g, f, parent, stamp, state, walk } = this;
    const heap = new MinHeap(f);
    const h = (cx, cy) => {
      const ddx = Math.abs(cx - gcx);
      const ddy = Math.abs(cy - gcy);
      return Math.max(ddx, ddy) + (SQRT2 - 1) * Math.min(ddx, ddy);
    };
    const si = scy * cols + scx;
    const gi = gcy * cols + gcx;
    stamp[si] = gen;
    g[si] = 0;
    f[si] = h(scx, scy);
    parent[si] = -1;
    state[si] = 1;
    heap.push(si);
    let expansions = 0;
    let found = false;
    let bestI = si;
    let bestH = f[si];
    while (heap.size > 0) {
      const ci = heap.pop();
      if (stamp[ci] === gen && state[ci] === 2) continue;
      state[ci] = 2;
      if (ci === gi) {
        found = true;
        break;
      }
      if (++expansions > maxExpansions) break;
      const cx = ci % cols;
      const cy = (ci - cx) / cols;
      const hc = f[ci] - g[ci];
      if (hc < bestH) {
        bestH = hc;
        bestI = ci;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (walk[ni] !== 1) continue;
          if (dx !== 0 && dy !== 0) {
            // no corner cutting
            if (walk[cy * cols + nx] !== 1 || walk[ny * cols + cx] !== 1) continue;
          }
          const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
          const ng = g[ci] + step;
          if (stamp[ni] !== gen) {
            stamp[ni] = gen;
            state[ni] = 0;
            g[ni] = Infinity;
          }
          if (state[ni] === 2) continue;
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(nx, ny);
            parent[ni] = ci;
            state[ni] = 1;
            heap.push(ni);
          }
        }
      }
    }
    const endI = found ? gi : bestI;
    const cells = [];
    for (let i = endI; i !== -1 && i !== si; i = parent[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => {
      const cx = i % cols;
      return this.cellCenter(cx, (i - cx) / cols);
    });
    if (found && pts.length > 0) pts[pts.length - 1] = { x: goal.x, y: goal.y };
    return this.simplify(start, pts);
  }

  simplify(start, pts) {
    if (pts.length <= 1) return pts;
    const out = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineOfSight(anchor.x, anchor.y, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

// Builds an eroded copy of a walkability grid: a cell stays walkable only if all
// neighbours within `radius` cells are walkable. Used to keep unit centres away from walls.
export function erode(walk, cols, rows, radius = 1) {
  const out = new Uint8Array(walk.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let ok = walk[y * cols + x] === 1;
      for (let dy = -radius; ok && dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || walk[ny * cols + nx] !== 1) {
            ok = false;
            break;
          }
        }
      }
      out[y * cols + x] = ok ? 1 : 0;
    }
  }
  return out;
}
