import { Game } from '../sim/game.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Setup } from './setup.js';
import { Sfx } from './sfx.js';

const canvas = document.getElementById('game');
const app = {
  game: null,
  camera: new Camera(),
  renderer: null,
  hud: null,
  input: null,
  sfx: new Sfx(),
  paused: false,
  options: null,
  restart() {
    if (this.options) startGame(this.options);
  },
  quitToSetup() {
    this.game = null;
    this.renderer = null;
    this.hud.hideAll();
    this.hud.hide();
    setup.show();
  },
};
window.app = app;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  app.camera.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

const setup = new Setup(document.getElementById('setup'), (options) => startGame(options));
app.hud = new Hud(document.getElementById('hud'), app);
app.input = new Input(canvas, app);
setup.show();

function startGame(options) {
  app.options = options;
  app.sfx.resume();
  const seed = (Date.now() % 1000000) + 1;
  app.game = new Game({
    seed,
    difficulty: options.difficulty,
    teamSize: options.teamSize,
    playerChampion: options.champion,
    playerSpells: [options.spellD, options.spellF],
    autoLevel: options.autoLevel,
    headless: false,
  });
  app.game.showDamageNumbers = options.damageNumbers;
  app.renderer = new Renderer(canvas, app.game, app.camera, { playerTeam: app.game.player.team, fog: options.fog });
  app.paused = false;
  app.camera.locked = true;
  app.camera.centerOn(app.game.player.x, app.game.player.y);
  setup.hide();
  app.hud.show();
  app.hud.togglePause(false);
}

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let fpsAcc = 0;
let fpsCount = 0;
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += dtReal;
  fpsCount++;
  if (fpsAcc >= 1) {
    app.fps = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
  }
  const game = app.game;
  if (game) {
    if (!app.paused && !game.over) {
      acc += dtReal;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        game.update(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps >= 6) acc = 0;
    }
    app.input.update(dtReal);
    if (app.camera.locked && game.player) app.camera.centerOn(game.player.x, game.player.y);
    const fx = game.drainFx();
    app.sfx.ingest(fx, game);
    app.renderer.ingest(fx);
    const t0 = performance.now();
    app.renderer.render(app.paused ? 0 : dtReal);
    app.renderMs = (app.renderMs || 0) * 0.9 + (performance.now() - t0) * 0.1;
    const mm = document.getElementById('minimap');
    app.renderer.drawMinimap(mm.getContext('2d'), mm.width);
    app.hud.update(dtReal);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
