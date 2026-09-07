// Mouse and keyboard controls, LoL style: right-click to move/attack, quick-cast abilities on the cursor.
import { isTargetable } from '../sim/combat.js';
import { SUMMONER_SPELLS } from '../sim/champions.js';

export class Input {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.mouse = { sx: 0, sy: 0, x: 0, y: 0, inside: true };
    this.attackMoveArmed = false;
    this.keys = new Set();
    this.bind();
  }

  get game() {
    return this.app.game;
  }
  get player() {
    return this.game ? this.game.player : null;
  }
  get camera() {
    return this.app.camera;
  }

  bind() {
    window.addEventListener('mousemove', (e) => {
      this.mouse.sx = e.clientX;
      this.mouse.sy = e.clientY;
      this.updateWorldCursor();
    });
    document.addEventListener('mouseleave', () => (this.mouse.inside = false));
    document.addEventListener('mouseenter', () => (this.mouse.inside = true));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
      if (this.game) e.preventDefault();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.game) return;
      this.app.sfx.resume();
      if (e.button === 2) this.rightClick();
      else if (e.button === 0) this.leftClick();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.setViewWidth(this.camera.viewW * (e.deltaY > 0 ? 1.1 : 0.9));
    }, { passive: false });
    const minimap = document.getElementById('minimap');
    minimap.addEventListener('contextmenu', (e) => e.preventDefault());
    minimap.addEventListener('mousedown', (e) => {
      if (!this.game) return;
      const rect = minimap.getBoundingClientRect();
      const k = this.game.map.size / rect.width;
      const wx = (e.clientX - rect.left) * k;
      const wy = (e.clientY - rect.top) * k;
      if (e.button === 2) {
        this.issueMove(wx, wy);
      } else {
        this.camera.locked = false;
        this.camera.centerOn(wx, wy);
      }
    });
    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === 'Tab') {
        this.app.hud.showScoreboard(false);
        e.preventDefault();
      }
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  updateWorldCursor() {
    const w = this.camera.screenToWorld(this.mouse.sx, this.mouse.sy);
    this.mouse.x = w.x;
    this.mouse.y = w.y;
  }

  unitUnderCursor(pred) {
    const game = this.game;
    const slack = 12 / this.camera.zoom;
    let best = null;
    let bestScore = Infinity;
    for (const u of game.units) {
      if (!u.alive) continue;
      if (u.team !== game.player.team && !u.visibleTo[game.player.team]) continue;
      if (pred && !pred(u)) continue;
      const d = Math.hypot(u.x - this.mouse.x, u.y - this.mouse.y) - u.radius;
      if (d > slack) continue;
      const score = d - (u.kind === 'champion' ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  nearestUnitToCursor(pred, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const u of this.game.units) {
      if (!u.alive || (pred && !pred(u))) continue;
      const d = Math.hypot(u.x - this.mouse.x, u.y - this.mouse.y) - u.radius;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  issueMove(x, y) {
    const p = this.player;
    if (!p || !p.alive) return;
    this.game.issueOrder(p, { type: 'move', x, y });
    this.app.renderer.addMarker(x, y, 'move');
  }

  rightClick() {
    const p = this.player;
    if (!p || !p.alive || this.app.paused) return;
    this.attackMoveArmed = false;
    this.canvas.classList.remove('attackmove');
    const game = this.game;
    const target = this.unitUnderCursor((u) => u.team !== p.team && isTargetable(game, u, p.team) && !(u.kind === 'monster' && u.resetting));
    if (target) {
      game.issueOrder(p, { type: 'attack', target });
      this.app.renderer.addMarker(target.x, target.y, 'attack');
    } else this.issueMove(this.mouse.x, this.mouse.y);
  }

  leftClick() {
    const p = this.player;
    if (!p || !p.alive || this.app.paused) return;
    if (this.attackMoveArmed) {
      this.attackMoveArmed = false;
      this.canvas.classList.remove('attackmove');
      this.game.issueOrder(p, { type: 'attackMove', x: this.mouse.x, y: this.mouse.y });
      this.app.renderer.addMarker(this.mouse.x, this.mouse.y, 'attack');
    }
  }

  validUnitTarget(def, u) {
    const p = this.player;
    const kind = def.targetKind || 'enemy';
    if (kind === 'enemy' || kind === 'enemyChampion') {
      if (u.team === p.team || u.kind === 'structure') return false;
      if (kind === 'enemyChampion' && u.kind !== 'champion') return false;
      return isTargetable(this.game, u, p.team);
    }
    if (kind === 'ally' || kind === 'allyChampion') return u.team === p.team && (kind !== 'allyChampion' || u.kind === 'champion');
    return true;
  }

  castAbility(key) {
    const p = this.player;
    const game = this.game;
    if (!p || !p.alive) return;
    const ab = p.abilities[key];
    const def = ab.def;
    if (ab.rank <= 0) {
      this.app.hud.flash('Ability not learned yet (Ctrl+' + key + ' to level)');
      this.app.sfx.play('error');
      return;
    }
    const aim = { x: this.mouse.x, y: this.mouse.y };
    if (def.type === 'unit') {
      let t = this.unitUnderCursor((u) => this.validUnitTarget(def, u));
      if (!t) t = this.nearestUnitToCursor((u) => this.validUnitTarget(def, u), 260);
      if (!t) {
        this.app.hud.flash('No valid target under the cursor');
        this.app.sfx.play('error');
        return;
      }
      aim.target = t;
    }
    const res = game.castAbility(p, key, aim);
    if (res.ok) return;
    if (res.reason === 'range' && res.target) {
      game.issueOrder(p, { type: 'cast', key, target: res.target, resume: p.order });
      return;
    }
    if (res.reason === 'mana') this.app.hud.flash('Not enough mana');
    else if (res.reason === 'cc') this.app.hud.flash("Can't cast right now");
    if (res.reason !== 'cooldown' && res.reason !== 'busy') this.app.sfx.play('error');
  }

  castSpell(idx) {
    const p = this.player;
    const game = this.game;
    if (!p || !p.alive) return;
    const slot = p.spells[idx];
    if (!slot) return;
    const def = SUMMONER_SPELLS[slot.id];
    const aim = { x: this.mouse.x, y: this.mouse.y };
    if (def.type === 'unit') {
      let t = this.unitUnderCursor((u) => this.validUnitTarget(def, u));
      if (!t) t = this.nearestUnitToCursor((u) => this.validUnitTarget(def, u), 260);
      if (!t) {
        this.app.hud.flash('No valid target under the cursor');
        this.app.sfx.play('error');
        return;
      }
      aim.target = t;
    }
    const res = game.castSpell(p, idx, aim);
    if (res.ok) return;
    if (res.reason === 'range' && res.target) game.issueOrder(p, { type: 'castSpell', idx, target: res.target, resume: p.order });
    else if (res.reason !== 'cooldown') this.app.sfx.play('error');
  }

  keydown(e) {
    if (!this.game) return;
    const key = e.key.toLowerCase();
    const hud = this.app.hud;
    if (e.key === 'Tab') {
      e.preventDefault();
      hud.showScoreboard(true);
      return;
    }
    if (e.key === 'Escape') {
      if (hud.shopOpen) hud.toggleShop(false);
      else if (this.attackMoveArmed) {
        this.attackMoveArmed = false;
        this.canvas.classList.remove('attackmove');
      } else hud.togglePause();
      return;
    }
    if (this.app.paused) return;
    if (e.repeat) {
      this.keys.add(key);
      return;
    }
    this.keys.add(key);
    const p = this.player;
    switch (key) {
      case 'q':
      case 'w':
      case 'e':
      case 'r': {
        const K = key.toUpperCase();
        if (e.ctrlKey || e.altKey) {
          e.preventDefault();
          if (p && this.game.levelUpAbility(p, K)) this.app.sfx.play('ui');
        } else this.castAbility(K);
        break;
      }
      case 'd':
        this.castSpell(0);
        break;
      case 'f':
        this.castSpell(1);
        break;
      case 'a':
        this.attackMoveArmed = !this.attackMoveArmed;
        this.canvas.classList.toggle('attackmove', this.attackMoveArmed);
        break;
      case 's':
        if (p) this.game.stopUnit(p);
        this.attackMoveArmed = false;
        this.canvas.classList.remove('attackmove');
        break;
      case 'h':
        if (p && p.alive) this.game.issueOrder(p, { type: 'hold' });
        break;
      case 'b':
        if (p && p.alive) {
          if (this.game.startRecall(p)) this.app.sfx.play('recall');
          else hud.flash(p.recall ? 'Already recalling' : "Can't recall here");
        }
        break;
      case 'p':
        hud.toggleShop();
        break;
      case 'y':
        this.camera.locked = !this.camera.locked;
        hud.flash(this.camera.locked ? 'Camera locked' : 'Camera unlocked (move the mouse to the screen edge to pan)');
        break;
      case ' ':
        e.preventDefault();
        if (p) this.camera.centerOn(p.x, p.y);
        break;
      case 'm':
        this.app.sfx.muted = !this.app.sfx.muted;
        hud.flash(this.app.sfx.muted ? 'Sound muted' : 'Sound on');
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6': {
        if (p) {
          const res = this.game.useItem(p, Number(key) - 1);
          if (res.ok) this.app.sfx.play('potion');
        }
        break;
      }
      default:
        break;
    }
  }

  update(dt) {
    const cam = this.camera;
    const p = this.player;
    if (this.keys.has(' ') && p) cam.centerOn(p.x, p.y);
    const speed = 1400 * dt / cam.zoom;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('arrowright')) dx += speed;
    if (this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('arrowdown')) dy += speed;
    if (!cam.locked && this.mouse.inside && document.hasFocus()) {
      const edge = 14;
      if (this.mouse.sx <= edge) dx -= speed;
      if (this.mouse.sx >= window.innerWidth - edge) dx += speed;
      if (this.mouse.sy <= edge) dy -= speed;
      if (this.mouse.sy >= window.innerHeight - edge) dy += speed;
    }
    if (dx || dy) {
      cam.locked = false;
      cam.pan(dx, dy);
    }
    this.updateWorldCursor();
  }
}
