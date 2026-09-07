// Canvas renderer: terrain, structures, units, projectiles, effects, fog of war and minimap.
import { MAP_SIZE } from '../sim/constants.js';
import { TEAM_COLORS } from '../sim/game.js';
import { makeRng } from '../sim/rng.js';
import { formatTime } from '../sim/math.js';

const TAU = Math.PI * 2;
const TEAM_LIGHT = ['#93c5fd', '#fca5a5'];

function circle(ctx, x, y, r, fill, stroke, lw) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw || 2;
    ctx.stroke();
  }
}

function polygon(ctx, x, y, r, n, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Draws a champion class glyph centred on (x, y).
export function drawGlyph(ctx, icon, x, y, s, color = '#fff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (icon) {
    case 'bow':
      ctx.beginPath();
      ctx.arc(-s * 0.15, 0, s * 0.85, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.15 + Math.cos(-Math.PI * 0.42) * s * 0.85, Math.sin(-Math.PI * 0.42) * s * 0.85);
      ctx.lineTo(-s * 0.15 + Math.cos(Math.PI * 0.42) * s * 0.85, Math.sin(Math.PI * 0.42) * s * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, 0);
      ctx.lineTo(s * 0.9, 0);
      ctx.stroke();
      break;
    case 'sword':
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, s * 0.6);
      ctx.lineTo(s * 0.7, -s * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, -s * 0.05);
      ctx.lineTo(-s * 0.05, s * 0.55);
      ctx.stroke();
      break;
    case 'orb':
      circle(ctx, 0, 0, s * 0.5, color);
      ctx.globalAlpha = 0.5;
      circle(ctx, 0, 0, s * 0.85, null, color, s * 0.1);
      ctx.globalAlpha = 1;
      break;
    case 'dagger':
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.9);
      ctx.lineTo(s * 0.35, s * 0.3);
      ctx.lineTo(0, s * 0.15);
      ctx.lineTo(-s * 0.35, s * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, s * 0.45);
      ctx.lineTo(s * 0.45, s * 0.45);
      ctx.stroke();
      break;
    case 'tree':
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.9);
      ctx.lineTo(s * 0.7, s * 0.35);
      ctx.lineTo(-s * 0.7, s * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-s * 0.15, s * 0.3, s * 0.3, s * 0.5);
      break;
    case 'note':
      ctx.font = `bold ${Math.round(s * 1.9)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', 0, s * 0.05);
      break;
    default:
      circle(ctx, 0, 0, s * 0.5, color);
  }
  ctx.restore();
}

export function drawChampionIcon(ctx, def, x, y, r, team = 0) {
  circle(ctx, x, y, r, def.color, TEAM_COLORS[team] || '#fff', Math.max(2, r * 0.12));
  drawGlyph(ctx, def.icon, x, y, r * 0.55, 'rgba(255,255,255,0.95)');
}

export class Renderer {
  constructor(canvas, game, camera, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.camera = camera;
    this.playerTeam = opts.playerTeam ?? 0;
    this.effects = [];
    this.particles = [];
    this.texts = [];
    this.markers = [];
    this.time = 0;
    this.fog = document.createElement('canvas');
    this.fogEnabled = opts.fog !== false;
    this.terrain = this.prerenderTerrain();
    this.minimapBase = this.prerenderMinimap(220);
    this.hoverUnit = null;
  }

  // ------------------------------------------------------------ terrain
  prerenderTerrain() {
    const scale = 0.5;
    const size = Math.round(MAP_SIZE * scale);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const map = this.game.map;
    ctx.fillStyle = '#16301a';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokePoly = (pts, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    };
    // grass floor for jungle paths and clearings, stone for bases, dirt lanes, water river
    for (const s of map.carves) {
      if (s.type === 'circle') circle(ctx, s.x, s.y, s.r, '#3b5a2b');
      else if (s.type === 'poly' && s.width <= 260) strokePoly(s.pts, s.width, '#3b5a2b');
    }
    for (const s of map.carves) {
      if (s.type === 'poly' && s.width === 400) strokePoly(s.pts, s.width, '#5b4a35');
    }
    for (const s of map.carves) {
      if (s.type === 'poly' && s.width === 400) strokePoly(s.pts, s.width - 120, '#6b5940');
    }
    for (const s of map.carves) {
      if (s.type === 'poly' && s.width === 380) strokePoly(s.pts, s.width, '#2b5f86');
    }
    for (const s of map.carves) {
      if (s.type === 'poly' && s.width === 380) strokePoly(s.pts, s.width - 160, '#3a78a6');
    }
    for (const s of map.carves) {
      if (s.type === 'rect') {
        ctx.fillStyle = '#4b4b58';
        ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
        ctx.fillStyle = '#585866';
        ctx.fillRect(s.x0 + 60, s.y0 + 60, s.x1 - s.x0 - 120, s.y1 - s.y0 - 120);
      }
    }
    // texture noise
    const rng = makeRng(7);
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 40000; i++) {
      const x = rng() * MAP_SIZE;
      const y = rng() * MAP_SIZE;
      ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(x, y, 6 + rng() * 14, 6 + rng() * 14);
    }
    ctx.globalAlpha = 1;
    // trees along the forest edges and scattered inside
    const { cols, rows, raw, cell } = map;
    const walkAt = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && raw[cy * cols + cx] === 1;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (raw[cy * cols + cx] === 1) continue;
        let edge = false;
        for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) if (walkAt(cx + dx, cy + dy)) { edge = true; break; }
        if (!edge && (cx + cy) % 3 !== 0) continue;
        if (!edge && rng() < 0.55) continue;
        const x = (cx + 0.5) * cell + (rng() - 0.5) * 18;
        const y = (cy + 0.5) * cell + (rng() - 0.5) * 18;
        const r = 16 + rng() * 14;
        circle(ctx, x + 4, y + 6, r, 'rgba(0,0,0,0.35)');
        circle(ctx, x, y, r, rng() < 0.5 ? '#245a2a' : '#2e6b32');
        circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.45, 'rgba(120, 200, 110, 0.35)');
      }
    }
    // river sparkle
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 400; i++) {
      const t = rng();
      const p = { x: 1000 + t * 4000 + (rng() - 0.5) * 220, y: 1000 + t * 4000 + (rng() - 0.5) * 220 };
      ctx.fillStyle = '#bfe3ff';
      ctx.fillRect(p.x, p.y, 10 + rng() * 30, 3);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return c;
  }

  prerenderMinimap(size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const map = this.game.map;
    ctx.fillStyle = '#0c1a0e';
    ctx.fillRect(0, 0, size, size);
    const k = size / MAP_SIZE;
    ctx.save();
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokePoly = (pts, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    };
    for (const s of map.carves) {
      if (s.type === 'circle') circle(ctx, s.x, s.y, s.r, '#33512a');
      else if (s.type === 'poly' && s.width <= 260) strokePoly(s.pts, s.width, '#33512a');
    }
    for (const s of map.carves) if (s.type === 'poly' && s.width === 400) strokePoly(s.pts, s.width, '#6b5940');
    for (const s of map.carves) if (s.type === 'poly' && s.width === 380) strokePoly(s.pts, s.width, '#3a78a6');
    for (const s of map.carves) if (s.type === 'rect') { ctx.fillStyle = '#585866'; ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0); }
    ctx.restore();
    return c;
  }

  // ------------------------------------------------------------ helpers
  isVisible(u) {
    return u.team === this.playerTeam || u.visibleTo[this.playerTeam];
  }

  relation(u) {
    if (u.isPlayer) return 'self';
    if (u.team === this.playerTeam) return 'ally';
    if (u.team > 1) return 'neutral';
    return 'enemy';
  }

  barColor(u) {
    const r = this.relation(u);
    if (r === 'self') return '#4ade80';
    if (r === 'ally') return '#60a5fa';
    if (r === 'neutral') return '#d8b4fe';
    return '#ef4444';
  }

  addMarker(x, y, kind) {
    this.markers.push({ x, y, kind, t: 0 });
  }

  // ------------------------------------------------------------ frame
  render(dt) {
    const { ctx, game } = this;
    this.time += dt;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    this.applyWorld();
    this.drawTerrain();
    this.drawCamps();
    this.drawMarkers(dt);
    this.drawPlayerRanges();
    for (const s of game.structures) this.drawStructure(s);
    const units = [];
    for (const u of game.units) {
      if (!u.alive || u.kind === 'structure') continue;
      if (!this.isVisible(u)) continue;
      units.push(u);
    }
    units.sort((a, b) => a.y - b.y);
    for (const u of units) this.drawUnit(u);
    for (const p of game.projectiles) if (p.alive) this.drawProjectile(p);
    this.updateEffects(dt);
    this.drawEffects();
    for (const s of game.structures) this.drawStructureBar(s);
    for (const u of units) this.drawUnitBar(u);
    if (this.fogEnabled) this.drawFog();
    this.drawTexts(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawTerrain() {
    const { ctx, camera } = this;
    const scale = this.terrain.width / MAP_SIZE;
    const vw = camera.w / camera.zoom;
    const vh = camera.h / camera.zoom;
    const x0 = Math.max(0, Math.floor(camera.x));
    const y0 = Math.max(0, Math.floor(camera.y));
    const x1 = Math.min(MAP_SIZE, Math.ceil(camera.x + vw));
    const y1 = Math.min(MAP_SIZE, Math.ceil(camera.y + vh));
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(this.terrain, x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale, x0, y0, x1 - x0, y1 - y0);
  }

  applyWorld() {
    const { ctx, camera } = this;
    ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);
  }

  onScreen(x, y, r) {
    const c = this.camera;
    const vw = c.w / c.zoom;
    const vh = c.h / c.zoom;
    return x + r >= c.x && x - r <= c.x + vw && y + r >= c.y && y - r <= c.y + vh;
  }

  drawCamps() {
    const { ctx, game } = this;
    for (const camp of game.camps) {
      if (!this.onScreen(camp.x, camp.y, 300)) continue;
      ctx.save();
      ctx.setLineDash([12, 12]);
      circle(ctx, camp.x, camp.y, camp.epic ? 300 : 230, camp.epic ? 'rgba(120, 60, 160, 0.12)' : 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.15)', 3);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(camp.name, camp.x, camp.y - (camp.epic ? 250 : 180));
      if (!camp.alive) {
        ctx.fillStyle = '#fde68a';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(formatTime(camp.respawnAt - game.time), camp.x, camp.y + 10);
      }
      ctx.restore();
    }
  }

  drawMarkers(dt) {
    const { ctx } = this;
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      if (m.t > 0.5) {
        this.markers.splice(i, 1);
        continue;
      }
      const k = m.t / 0.5;
      ctx.globalAlpha = 1 - k;
      circle(ctx, m.x, m.y, 12 + k * 30, null, m.kind === 'attack' ? '#f87171' : '#4ade80', 4);
      ctx.globalAlpha = 1;
    }
  }

  drawPlayerRanges() {
    const { ctx, game } = this;
    const p = game.player;
    if (!p || !p.alive) return;
    for (const s of game.structures) {
      if (!s.alive || s.team === p.team || s.stype !== 'tower') continue;
      if (!game.isStructureTargetable(s) && s.tier !== 1) continue;
      const d = s.distTo(p);
      if (d > s.stats.range + 500) continue;
      ctx.save();
      ctx.setLineDash([20, 16]);
      ctx.globalAlpha = d <= s.stats.range + s.radius + p.radius ? 0.55 : 0.25;
      circle(ctx, s.x, s.y, s.stats.range + s.radius, 'rgba(239,68,68,0.04)', '#ef4444', 3);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ structures
  drawStructure(s) {
    const { ctx, game } = this;
    if (!this.onScreen(s.x, s.y, 200)) return;
    const tc = TEAM_COLORS[s.team];
    const light = TEAM_LIGHT[s.team];
    if (s.stype === 'fountain') {
      circle(ctx, s.x, s.y, 150, 'rgba(255,255,255,0.05)', tc, 6);
      circle(ctx, s.x, s.y, 90, null, light, 3);
      ctx.fillStyle = light;
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SHOP', s.x, s.y + 10);
      return;
    }
    if (!s.alive) {
      circle(ctx, s.x, s.y, s.radius * 0.9, '#3a3a40');
      circle(ctx, s.x - s.radius * 0.3, s.y - s.radius * 0.2, s.radius * 0.35, '#55555e');
      circle(ctx, s.x + s.radius * 0.35, s.y + s.radius * 0.25, s.radius * 0.28, '#55555e');
      if (s.stype === 'inhibitor') {
        ctx.fillStyle = '#e5e7eb';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(formatTime(s.respawnTimer), s.x, s.y + 10);
      }
      return;
    }
    if (s.stype === 'tower') {
      circle(ctx, s.x + 6, s.y + 10, s.radius + 4, 'rgba(0,0,0,0.35)');
      polygon(ctx, s.x, s.y, s.radius + 4, 8, Math.PI / 8);
      ctx.fillStyle = '#6b7280';
      ctx.fill();
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 4;
      ctx.stroke();
      polygon(ctx, s.x, s.y, s.radius * 0.7, 8, Math.PI / 8);
      ctx.fillStyle = '#9ca3af';
      ctx.fill();
      const pulse = 0.85 + 0.15 * Math.sin(this.time * 4 + s.id);
      ctx.save();
      ctx.globalAlpha = 0.35 * pulse;
      circle(ctx, s.x, s.y - 8, s.radius * 0.7, tc);
      ctx.restore();
      polygon(ctx, s.x, s.y - 8, s.radius * 0.42, 4, 0);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.strokeStyle = tc;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (!game.isStructureTargetable(s)) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        circle(ctx, s.x, s.y, s.radius + 14, null, '#e5e7eb', 3);
        ctx.restore();
      }
    } else if (s.stype === 'inhibitor') {
      circle(ctx, s.x, s.y, s.radius + 6, '#4b5563', '#1f2937', 4);
      ctx.save();
      ctx.globalAlpha = 0.35;
      circle(ctx, s.x, s.y, s.radius * 0.95, tc);
      ctx.restore();
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(this.time * 0.8);
      polygon(ctx, 0, 0, s.radius * 0.7, 4, 0);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.strokeStyle = tc;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    } else if (s.stype === 'nexus') {
      circle(ctx, s.x, s.y, s.radius + 14, '#4b5563', '#1f2937', 6);
      circle(ctx, s.x, s.y, s.radius, '#374151');
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.1 * Math.sin(this.time * 3);
      circle(ctx, s.x, s.y, s.radius * 1.25, tc);
      ctx.restore();
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(this.time * 0.5);
      polygon(ctx, 0, 0, s.radius * 0.85, 6, 0);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.strokeStyle = tc;
      ctx.lineWidth = 6;
      ctx.stroke();
      polygon(ctx, 0, 0, s.radius * 0.45, 6, 0);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
    }
  }

  drawStructureBar(s) {
    if (!s.alive || s.stype === 'fountain') return;
    if (!this.onScreen(s.x, s.y, 200)) return;
    const { ctx, game } = this;
    if (s.hp >= s.maxHp && !(s.stype === 'tower' && s.target)) return;
    const w = s.stype === 'nexus' ? 160 : 110;
    const h = 10;
    const x = s.x - w / 2;
    const y = s.y - s.radius - 34;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = s.team === this.playerTeam ? '#60a5fa' : '#ef4444';
    ctx.fillRect(x, y, (w * s.hp) / s.maxHp, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / 8, y);
      ctx.lineTo(x + (w * i) / 8, y + h);
      ctx.stroke();
    }
    if (!game.isStructureTargetable(s)) {
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('INVULNERABLE', s.x, y - 6);
    }
  }

  // ------------------------------------------------------------ units
  drawUnit(u) {
    if (!this.onScreen(u.x, u.y, 120)) return;
    const { ctx } = this;
    const r = u.radius;
    circle(ctx, u.x + 3, u.y + r * 0.6, r * 0.9, 'rgba(0,0,0,0.3)');
    if (u.kind === 'champion') this.drawChampion(u);
    else if (u.kind === 'minion') this.drawMinion(u);
    else if (u.kind === 'monster') this.drawMonster(u);
  }

  drawChampion(u) {
    const { ctx } = this;
    const r = u.radius;
    const def = u.def;
    const rel = this.relation(u);
    ctx.save();
    if (u.stealthed) ctx.globalAlpha = 0.45;
    // dash trail / haste lines
    const haste = u.getBuff('decisive_speed') || u.getBuff('celerity') || u.getBuff('ghost') || u.getBuff('heal_speed');
    if (haste && u.moved) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = u.facing + Math.PI + (i - 1) * 0.35;
        ctx.beginPath();
        ctx.moveTo(u.x + Math.cos(a) * (r + 4), u.y + Math.sin(a) * (r + 4));
        ctx.lineTo(u.x + Math.cos(a) * (r + 30), u.y + Math.sin(a) * (r + 30));
        ctx.stroke();
      }
    }
    if (u.getBuff('bramble_aura')) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(this.time * 6);
      circle(ctx, u.x, u.y, 350, 'rgba(74, 222, 128, 0.15)', '#4ade80', 6);
      ctx.restore();
    }
    if (u.getBuff('judgment')) {
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(this.time * 14);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        ctx.rotate(TAU / 3);
        ctx.beginPath();
        ctx.moveTo(r * 0.5, 0);
        ctx.lineTo(r + 70, 0);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.2;
      circle(ctx, u.x, u.y, 320, '#fbbf24');
      ctx.restore();
    }
    const cata = u.getBuff('cataclysm');
    if (cata) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.7)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(cata.data.x, cata.data.y);
      ctx.stroke();
      ctx.restore();
    }
    // body
    const ring = rel === 'enemy' ? TEAM_COLORS[u.team] : rel === 'self' ? '#4ade80' : TEAM_COLORS[u.team];
    circle(ctx, u.x, u.y, r, def.color, ring, 5);
    if (rel === 'self') circle(ctx, u.x, u.y, r + 5, null, 'rgba(74, 222, 128, 0.5)', 2);
    drawGlyph(ctx, def.icon, u.x, u.y, r * 0.55, 'rgba(255,255,255,0.95)');
    // facing wedge
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(u.x + Math.cos(u.facing) * (r + 9), u.y + Math.sin(u.facing) * (r + 9));
    ctx.lineTo(u.x + Math.cos(u.facing + 0.5) * (r - 2), u.y + Math.sin(u.facing + 0.5) * (r - 2));
    ctx.lineTo(u.x + Math.cos(u.facing - 0.5) * (r - 2), u.y + Math.sin(u.facing - 0.5) * (r - 2));
    ctx.closePath();
    ctx.fill();
    // status
    if (u.shieldTotal > 0) circle(ctx, u.x, u.y, r + 9, null, 'rgba(226, 232, 240, 0.85)', 4);
    if (u.getBuff('rangers_focus')) circle(ctx, u.x, u.y, r + 13, null, 'rgba(186, 230, 253, 0.8)', 2);
    if (u.getBuff('decisive_strike') || u.getBuff('arcane_surge')) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.time * 10);
      circle(ctx, u.x, u.y, r + 3, null, '#fde68a', 3);
      ctx.restore();
    }
    if (u.getBuff('blue_buff')) circle(ctx, u.x, u.y, r + 16, null, 'rgba(96, 165, 250, 0.6)', 3);
    if (u.getBuff('red_buff')) circle(ctx, u.x, u.y, r + 19, null, 'rgba(248, 113, 113, 0.6)', 3);
    if (u.getBuff('baron_buff')) circle(ctx, u.x, u.y, r + 22, null, 'rgba(167, 139, 250, 0.7)', 3);
    if (u.getBuff('deathmark')) {
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      circle(ctx, u.x, u.y, r + 12 + 6 * Math.sin(this.time * 12), null, '#ef4444', 4);
      ctx.restore();
    }
    if (u.getBuff('ignite') || u.getBuff('red_burn')) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + i * 2.1;
        circle(ctx, u.x + Math.cos(a) * r * 0.6, u.y - r * 0.4 + Math.sin(a * 1.7) * 8, 6, 'rgba(249, 115, 22, 0.8)');
      }
    }
    if (u.stunned) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 6 + (i * TAU) / 3;
        circle(ctx, u.x + Math.cos(a) * r * 0.8, u.y - r - 12 + Math.sin(a) * 6, 5, '#fde047');
      }
    } else if (u.rooted) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const a = (i * TAU) / 4 + 0.4;
        ctx.beginPath();
        ctx.moveTo(u.x + Math.cos(a) * (r + 2), u.y + Math.sin(a) * (r + 2));
        ctx.lineTo(u.x + Math.cos(a + 0.5) * (r + 18), u.y + Math.sin(a + 0.5) * (r + 18));
        ctx.stroke();
      }
    } else if (u.silenced) {
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', u.x, u.y - r - 8);
    }
    if (u.stats.slow > 0 && !u.stunned && !u.rooted) circle(ctx, u.x, u.y, r + 2, null, 'rgba(147, 197, 253, 0.6)', 3);
    if (u.recall) {
      const k = 1 - u.recall.remaining / u.recall.total;
      ctx.save();
      ctx.strokeStyle = '#a5f3fc';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(u.x, u.y, r + 24, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 6; i++) {
        const a = this.time * 3 + (i * TAU) / 6;
        circle(ctx, u.x + Math.cos(a) * (r + 24), u.y + Math.sin(a) * (r + 24), 5, '#a5f3fc');
      }
      ctx.restore();
    }
    if (u.windup && u.windup.target) {
      const k = 1 - u.windup.remaining / u.windup.total;
      if (!u.ranged) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(u.x + Math.cos(u.facing) * r, u.y + Math.sin(u.facing) * r);
        ctx.lineTo(u.x + Math.cos(u.facing) * (r + 20 + k * 40), u.y + Math.sin(u.facing) * (r + 20 + k * 40));
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawMinion(u) {
    const { ctx } = this;
    const r = u.radius;
    const rel = this.relation(u);
    const fill = rel === 'enemy' ? '#b91c1c' : '#1d4ed8';
    const light = rel === 'enemy' ? '#fca5a5' : '#93c5fd';
    const emp = u.getBuff('baron_minion');
    if (u.mtype === 'melee') {
      circle(ctx, u.x, u.y, r, fill, light, 3);
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(u.x + Math.cos(u.facing) * (r + 8), u.y + Math.sin(u.facing) * (r + 8));
      ctx.lineTo(u.x + Math.cos(u.facing + 2.2) * r * 0.6, u.y + Math.sin(u.facing + 2.2) * r * 0.6);
      ctx.lineTo(u.x + Math.cos(u.facing - 2.2) * r * 0.6, u.y + Math.sin(u.facing - 2.2) * r * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (u.mtype === 'caster') {
      circle(ctx, u.x, u.y, r, fill, light, 3);
      circle(ctx, u.x, u.y, r * 0.4, light);
    } else if (u.mtype === 'siege') {
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.facing);
      ctx.fillStyle = fill;
      ctx.strokeStyle = light;
      ctx.lineWidth = 3;
      ctx.fillRect(-r, -r * 0.8, r * 2, r * 1.6);
      ctx.strokeRect(-r, -r * 0.8, r * 2, r * 1.6);
      circle(ctx, -r * 0.5, r * 0.8, r * 0.35, '#111', light, 2);
      circle(ctx, r * 0.5, r * 0.8, r * 0.35, '#111', light, 2);
      circle(ctx, -r * 0.5, -r * 0.8, r * 0.35, '#111', light, 2);
      circle(ctx, r * 0.5, -r * 0.8, r * 0.35, '#111', light, 2);
      ctx.restore();
    } else {
      polygon(ctx, u.x, u.y, r + 4, 6, this.time * 0.5);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = light;
      ctx.lineWidth = 4;
      ctx.stroke();
      circle(ctx, u.x, u.y, r * 0.45, light);
    }
    if (emp) circle(ctx, u.x, u.y, r + 8, null, 'rgba(167, 139, 250, 0.7)', 3);
  }

  drawMonster(u) {
    const { ctx } = this;
    const r = u.radius;
    const color = u.def.color || '#9ca3af';
    if (u.def.epic) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      circle(ctx, u.x, u.y, r * 1.35, color);
      ctx.restore();
      polygon(ctx, u.x, u.y, r, 7, this.time * 0.4);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 5;
      ctx.stroke();
      circle(ctx, u.x - r * 0.3, u.y - r * 0.2, r * 0.12, '#fff');
      circle(ctx, u.x + r * 0.3, u.y - r * 0.2, r * 0.12, '#fff');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.name, u.x, u.y + r + 26);
    } else {
      circle(ctx, u.x, u.y, r, color, '#1f2937', 3);
      circle(ctx, u.x + Math.cos(u.facing - 0.5) * r * 0.5, u.y + Math.sin(u.facing - 0.5) * r * 0.5, r * 0.14, '#111');
      circle(ctx, u.x + Math.cos(u.facing + 0.5) * r * 0.5, u.y + Math.sin(u.facing + 0.5) * r * 0.5, r * 0.14, '#111');
      if (u.def.buff === 'blue' || u.def.buff === 'red') circle(ctx, u.x, u.y, r + 10, null, u.def.buff === 'blue' ? 'rgba(96,165,250,0.7)' : 'rgba(248,113,113,0.7)', 4);
    }
  }

  drawUnitBar(u) {
    if (!this.onScreen(u.x, u.y, 120)) return;
    const { ctx } = this;
    if (u.kind === 'champion') {
      const w = 92;
      const h = 11;
      const x = u.x - w / 2 + 8;
      const y = u.y - u.radius - 28;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x - 18, y - 2, w + 20, h + 12);
      // level box
      ctx.fillStyle = '#111827';
      ctx.fillRect(x - 17, y - 1, 15, h + 10);
      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(u.level), x - 9.5, y + (h + 8) / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(x, y, w, h);
      const frac = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = this.barColor(u);
      ctx.fillRect(x, y, w * frac, h);
      const shield = u.shieldTotal;
      if (shield > 0) {
        const sw = Math.min(w - w * frac, (w * shield) / u.maxHp);
        ctx.fillStyle = 'rgba(226,232,240,0.9)';
        ctx.fillRect(x + w * frac, y, sw, h);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      const ticks = Math.floor(u.maxHp / 250);
      for (let i = 1; i <= ticks; i++) {
        const tx = x + (w * (i * 250)) / u.maxHp;
        if (tx >= x + w) break;
        ctx.beginPath();
        ctx.moveTo(tx, y);
        ctx.lineTo(tx, y + (i % 4 === 0 ? h : h * 0.5));
        ctx.stroke();
      }
      if (u.maxMana > 0) {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(x, y + h + 1, w, 4);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(x, y + h + 1, (w * u.mana) / u.maxMana, 4);
      }
      ctx.fillStyle = u.isPlayer ? '#bbf7d0' : '#e5e7eb';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(u.name + (u.isPlayer ? ' (you)' : ''), u.x, y - 6);
    } else if (u.kind === 'minion') {
      const w = 46;
      const h = 5;
      const x = u.x - w / 2;
      const y = u.y - u.radius - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = this.barColor(u);
      ctx.fillRect(x, y, (w * u.hp) / u.maxHp, h);
    } else {
      const w = u.def.epic ? 140 : 64;
      const h = u.def.epic ? 10 : 6;
      const x = u.x - w / 2;
      const y = u.y - u.radius - 16;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = this.barColor(u);
      ctx.fillRect(x, y, (w * u.hp) / u.maxHp, h);
    }
  }

  // ------------------------------------------------------------ projectiles
  drawProjectile(p) {
    if (!this.onScreen(p.x, p.y, 60)) return;
    const { ctx } = this;
    const v = p.visual || { kind: 'orb', color: '#fff', size: 8 };
    const ang = Math.atan2(p.dy, p.dx);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (v.glow) {
      ctx.globalAlpha = 0.35;
      circle(ctx, 0, 0, v.size * 1.6, v.color);
      ctx.globalAlpha = 1;
    }
    switch (v.kind) {
      case 'arrow':
        ctx.rotate(ang);
        ctx.strokeStyle = v.color;
        ctx.lineWidth = Math.max(2, v.size * 0.18);
        ctx.beginPath();
        ctx.moveTo(-v.size, 0);
        ctx.lineTo(v.size, 0);
        ctx.stroke();
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.moveTo(v.size + 6, 0);
        ctx.lineTo(v.size - 6, -v.size * 0.35);
        ctx.lineTo(v.size - 6, v.size * 0.35);
        ctx.closePath();
        ctx.fill();
        break;
      case 'bolt':
        ctx.rotate(ang);
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, v.size * 1.4, v.size * 0.6, 0, 0, TAU);
        ctx.fill();
        break;
      case 'dagger':
        ctx.rotate(ang + this.time * 20);
        ctx.fillStyle = v.color;
        ctx.beginPath();
        ctx.moveTo(v.size, 0);
        ctx.lineTo(-v.size * 0.6, -v.size * 0.4);
        ctx.lineTo(-v.size * 0.6, v.size * 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      case 'root':
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = ang + Math.PI + (i - 1.5) * 0.5;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * v.size * 1.6, Math.sin(a) * v.size * 1.6);
        }
        ctx.stroke();
        circle(ctx, 0, 0, v.size * 0.6, v.color);
        break;
      case 'note':
        ctx.fillStyle = v.color;
        ctx.font = `bold ${v.size * 2.4}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', 0, 0);
        break;
      case 'tower':
        circle(ctx, 0, 0, v.size, v.color);
        ctx.globalAlpha = 0.5;
        circle(ctx, -p.dx * 18, -p.dy * 18, v.size * 0.7, v.color);
        circle(ctx, -p.dx * 34, -p.dy * 34, v.size * 0.4, v.color);
        break;
      case 'laser':
        ctx.rotate(ang);
        ctx.fillStyle = v.color;
        ctx.fillRect(-40, -4, 80, 8);
        break;
      case 'fire':
        circle(ctx, 0, 0, v.size, '#fb923c');
        circle(ctx, 0, 0, v.size * 0.5, '#fde68a');
        break;
      case 'void':
        circle(ctx, 0, 0, v.size, '#7c3aed');
        circle(ctx, 0, 0, v.size * 0.5, '#e9d5ff');
        break;
      default:
        circle(ctx, 0, 0, v.size, v.color);
        circle(ctx, 0, 0, v.size * 0.45, '#fff');
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ effects
  ingest(fxList) {
    for (const f of fxList) {
      switch (f.kind) {
        case 'text':
          this.texts.push({ ...f, t: 0 });
          break;
        case 'burst': {
          const n = f.count || 8;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const sp = 120 + Math.random() * 260;
            this.particles.push({ x: f.x + (f.r ? (Math.random() - 0.5) * f.r : 0), y: f.y + (f.r ? (Math.random() - 0.5) * f.r : 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: f.dur || 0.4, color: f.color, size: 4 + Math.random() * 5 });
          }
          break;
        }
        case 'death':
          this.effects.push({ ...f, t: 0, dur: f.dur || 0.8 });
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * TAU;
            const sp = 60 + Math.random() * 160;
            this.particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: 0.7, color: f.team === 0 ? '#93c5fd' : f.team === 1 ? '#fca5a5' : '#d8b4fe', size: 5 });
          }
          break;
        case 'cast':
        case 'attack':
        case 'melee':
          if (f.kind === 'melee') this.effects.push({ ...f, t: 0, dur: 0.15 });
          break;
        default:
          this.effects.push({ ...f, t: 0, dur: f.dur || 0.4 });
      }
    }
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      if (e.t >= e.dur) this.effects.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      if (p.t >= p.dur) this.particles.splice(i, 1);
    }
  }

  drawEffects() {
    const { ctx } = this;
    for (const e of this.effects) {
      const k = e.t / e.dur;
      ctx.save();
      switch (e.kind) {
        case 'ring':
          if (e.telegraph) {
            ctx.setLineDash([14, 10]);
            ctx.globalAlpha = 0.7;
            circle(ctx, e.x, e.y, e.r, 'rgba(255,255,255,0.08)', e.color, 4);
            circle(ctx, e.x, e.y, e.r * k, null, e.color, 3);
          } else {
            ctx.globalAlpha = 1 - k;
            circle(ctx, e.x, e.y, e.r * (0.6 + 0.4 * k), null, e.color, 6);
          }
          break;
        case 'shockwave':
          ctx.globalAlpha = 1 - k;
          circle(ctx, e.x, e.y, e.r * k, `rgba(163, 230, 53, ${0.25 * (1 - k)})`, e.color, 10);
          break;
        case 'zone':
          ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 12);
          circle(ctx, e.x, e.y, e.r, 'rgba(168, 85, 247, 0.25)', e.color, 5);
          break;
        case 'cone':
          ctx.globalAlpha = (1 - k) * 0.6;
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.arc(e.x, e.y, e.len, e.angle - e.spread / 2, e.angle + e.spread / 2);
          ctx.closePath();
          ctx.fill();
          break;
        case 'line':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = e.width || 8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
          break;
        case 'trail':
          ctx.globalAlpha = (1 - k) * 0.6;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = e.width || 20;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x2, e.y2);
          ctx.stroke();
          break;
        case 'death':
          ctx.globalAlpha = 1 - k;
          circle(ctx, e.x, e.y, e.r * (1 + k * 0.8), null, '#fff', 3);
          break;
        case 'levelup':
          ctx.globalAlpha = 1 - k;
          circle(ctx, e.x, e.y - k * 40, 40 + k * 30, null, '#fde68a', 5);
          break;
        case 'melee':
          ctx.globalAlpha = 1 - k;
          circle(ctx, e.x, e.y, (e.r || 20) * 0.8, null, '#fff', 4);
          break;
        default:
          break;
      }
      ctx.restore();
    }
    for (const p of this.particles) {
      const k = p.t / p.dur;
      ctx.globalAlpha = 1 - k;
      circle(ctx, p.x, p.y, p.size * (1 - k * 0.5), p.color);
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(dt) {
    const { ctx, camera } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      if (t.t >= t.dur) {
        this.texts.splice(i, 1);
        continue;
      }
      const k = t.t / t.dur;
      const p = camera.worldToScreen(t.x, t.y - (t.rise || 40) * k);
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `${t.bold ? 'bold ' : ''}${Math.round((t.size || 13) * Math.max(0.8, camera.zoom))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    this.applyWorld();
  }

  // ------------------------------------------------------------ fog of war
  drawFog() {
    const { ctx, camera, game } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const k = 0.5; // fog is computed at half resolution and scaled up
    const fw = Math.max(1, Math.round(w * k));
    const fh = Math.max(1, Math.round(h * k));
    if (this.fog.width !== fw || this.fog.height !== fh) {
      this.fog.width = fw;
      this.fog.height = fh;
    }
    const f = this.fog.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    f.fillStyle = 'rgba(3, 8, 16, 0.62)';
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    const sources = game.sightSources ? game.sightSources[this.playerTeam] : [];
    for (const s of sources) {
      const r = s.sightRange * camera.zoom * k;
      const p = camera.worldToScreen(s.x, s.y);
      const px = p.x * k;
      const py = p.y * k;
      if (px + r < 0 || py + r < 0 || px - r > fw || py - r > fh) continue;
      const g = f.createRadialGradient(px, py, r * 0.75, px, py, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.beginPath();
      f.arc(px, py, r, 0, TAU);
      f.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fog, 0, 0, fw, fh, 0, 0, w, h);
    this.applyWorld();
  }

  // ------------------------------------------------------------ minimap
  drawMinimap(mctx, size) {
    const { game, camera } = this;
    const k = size / MAP_SIZE;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(this.minimapBase, 0, 0, size, size);
    for (const s of game.structures) {
      if (s.stype === 'fountain') continue;
      const x = s.x * k;
      const y = s.y * k;
      const sz = s.stype === 'nexus' ? 9 : s.stype === 'inhibitor' ? 7 : 6;
      mctx.fillStyle = s.alive ? TEAM_COLORS[s.team] : '#374151';
      mctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      mctx.strokeStyle = '#000';
      mctx.lineWidth = 1;
      mctx.strokeRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    for (const m of game.minions) {
      if (!m.alive || !this.isVisible(m)) continue;
      mctx.fillStyle = m.team === this.playerTeam ? '#93c5fd' : '#fca5a5';
      mctx.fillRect(m.x * k - 1, m.y * k - 1, 2, 2);
    }
    for (const camp of game.camps) {
      if (!camp.alive) continue;
      const vis = camp.monsters.some((m) => m.alive && this.isVisible(m));
      mctx.fillStyle = camp.epic ? (camp.id === 'dragon' ? '#fb7185' : '#a78bfa') : vis ? '#fde68a' : 'rgba(253, 230, 138, 0.5)';
      circle(mctx, camp.x * k, camp.y * k, camp.epic ? 4 : 2.5, mctx.fillStyle);
    }
    for (const c of game.champions) {
      if (!c.alive || !this.isVisible(c)) continue;
      const x = c.x * k;
      const y = c.y * k;
      const rel = this.relation(c);
      circle(mctx, x, y, rel === 'self' ? 5 : 4, rel === 'self' ? '#4ade80' : rel === 'ally' ? '#3b82f6' : '#ef4444', '#fff', 1.5);
    }
    // camera rectangle
    const vw = camera.w / camera.zoom;
    const vh = camera.h / camera.zoom;
    mctx.strokeStyle = 'rgba(255,255,255,0.8)';
    mctx.lineWidth = 1;
    mctx.strokeRect(camera.x * k, camera.y * k, vw * k, vh * k);
  }
}
