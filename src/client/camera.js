import { MAP_SIZE } from '../sim/constants.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.w = 1;
    this.h = 1;
    this.viewW = 1800;
    this.zoom = 1;
    this.locked = true;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.zoom = w / this.viewW;
    this.clamp();
  }

  setViewWidth(vw) {
    const cx = this.x + this.w / (2 * this.zoom);
    const cy = this.y + this.h / (2 * this.zoom);
    this.viewW = Math.max(1000, Math.min(3200, vw));
    this.zoom = this.w / this.viewW;
    this.centerOn(cx, cy);
  }

  centerOn(x, y) {
    this.x = x - this.w / (2 * this.zoom);
    this.y = y - this.h / (2 * this.zoom);
    this.clamp();
  }

  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  clamp() {
    const vw = this.w / this.zoom;
    const vh = this.h / this.zoom;
    const margin = 200;
    this.x = Math.max(-margin, Math.min(MAP_SIZE + margin - vw, this.x));
    this.y = Math.max(-margin, Math.min(MAP_SIZE + margin - vh, this.y));
  }

  worldToScreen(x, y) {
    return { x: (x - this.x) * this.zoom, y: (y - this.y) * this.zoom };
  }

  screenToWorld(sx, sy) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  get center() {
    return { x: this.x + this.w / (2 * this.zoom), y: this.y + this.h / (2 * this.zoom) };
  }
}
