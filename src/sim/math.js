export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
export const distXY = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const len = (v) => Math.hypot(v.x, v.y);
export const angleBetween = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

export function norm(v) {
  const l = Math.hypot(v.x, v.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function dirTo(a, b) {
  return norm({ x: b.x - a.x, y: b.y - a.y });
}

export function moveTowards(p, target, maxStep) {
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxStep || d < 1e-9) return { x: target.x, y: target.y, arrived: true };
  return { x: p.x + (dx / d) * maxStep, y: p.y + (dy / d) * maxStep, arrived: false };
}

export function pointAlong(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function pointAtDistance(from, dir, d) {
  return { x: from.x + dir.x * d, y: from.y + dir.y * d };
}

// Distance from point p to segment ab.
export function segmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = 0;
  if (l2 > 0) t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

// Closest point on polyline to p, returning { point, segIndex, t, dist, along }.
export function closestOnPolyline(pts, p) {
  let best = null;
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const segLen = Math.sqrt(l2);
    let t = 0;
    if (l2 > 0) t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (!best || d < best.dist) best = { point: { x: cx, y: cy }, segIndex: i, t, dist: d, along: along + segLen * t };
    along += segLen;
  }
  return best;
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += dist(pts[i], pts[i + 1]);
  return l;
}

// Point at a given distance along a polyline (clamped to the ends).
export function pointAlongPolyline(pts, d) {
  if (d <= 0) return { ...pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (d <= l) return pointAlong(pts[i], pts[i + 1], l > 0 ? d / l : 0);
    d -= l;
  }
  return { ...pts[pts.length - 1] };
}

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
