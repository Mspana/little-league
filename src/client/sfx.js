// Tiny synthesized sound effects with the Web Audio API. No assets required.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.35;
    this.last = new Map();
  }

  resume() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, type = 'sine', gain = 0.2, delay = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * this.volume, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, gain = 0.15, delay = 0, filterFreq = 1200) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * this.volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const minGap = name === 'attack' || name === 'hit' ? 40 : 80;
    if (now - (this.last.get(name) || 0) < minGap) return;
    this.last.set(name, now);
    switch (name) {
      case 'attack':
        this.noise(0.06, 0.12, 0, 2500);
        break;
      case 'hit':
        this.noise(0.08, 0.16, 0, 900);
        this.tone(180, 0.08, 'square', 0.05);
        break;
      case 'cast':
        this.tone(520, 0.12, 'triangle', 0.14, 0, 880);
        break;
      case 'ult':
        this.tone(220, 0.35, 'sawtooth', 0.14, 0, 660);
        this.tone(330, 0.35, 'triangle', 0.1, 0.05, 990);
        break;
      case 'kill':
        this.tone(660, 0.12, 'square', 0.12);
        this.tone(880, 0.12, 'square', 0.12, 0.1);
        this.tone(1320, 0.25, 'square', 0.12, 0.2);
        break;
      case 'death':
        this.tone(440, 0.5, 'sawtooth', 0.14, 0, 110);
        break;
      case 'tower':
        this.noise(0.5, 0.3, 0, 400);
        this.tone(110, 0.6, 'sawtooth', 0.16, 0, 55);
        break;
      case 'levelup':
        this.tone(523, 0.1, 'triangle', 0.12);
        this.tone(659, 0.1, 'triangle', 0.12, 0.09);
        this.tone(784, 0.1, 'triangle', 0.12, 0.18);
        this.tone(1046, 0.25, 'triangle', 0.12, 0.27);
        break;
      case 'gold':
        this.tone(1760, 0.05, 'sine', 0.06);
        break;
      case 'error':
        this.tone(140, 0.15, 'square', 0.08);
        break;
      case 'ui':
        this.tone(900, 0.05, 'sine', 0.08);
        break;
      case 'recall':
        this.tone(440, 0.6, 'sine', 0.1, 0, 880);
        break;
      case 'potion':
        this.tone(660, 0.1, 'sine', 0.08, 0, 990);
        break;
      case 'victory':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.14, i * 0.15));
        break;
      case 'defeat':
        [440, 415, 392, 370, 349].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.1, i * 0.2));
        break;
      case 'announce':
        this.tone(330, 0.2, 'triangle', 0.1);
        this.tone(440, 0.3, 'triangle', 0.1, 0.15);
        break;
      default:
        break;
    }
  }

  // Turns simulation effects into sounds, only for things near the player.
  ingest(fxList, game) {
    if (!this.ctx || this.muted || !game.player) return;
    const p = game.player;
    const near = (f) => Math.hypot(f.x - p.x, f.y - p.y) < 1000;
    for (const f of fxList) {
      switch (f.kind) {
        case 'cast':
          if (f.isPlayer) this.play(f.key === 'R' ? 'ult' : 'cast');
          else if (near(f)) this.play('cast');
          break;
        case 'attack':
          if (f.id === p.id) this.play('attack');
          break;
        case 'melee':
          if (f.from === p.id || near(f)) this.play('hit');
          break;
        case 'death':
          if (f.ukind === 'champion') this.play('death');
          else if (near(f)) this.play('hit');
          break;
        case 'levelup':
          if (f.id === p.id) this.play('levelup');
          break;
        default:
          break;
      }
    }
  }
}
