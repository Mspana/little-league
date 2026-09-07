// Champion select and match options.
import { CHAMPION_LIST, SPELL_LIST } from '../sim/champions.js';
import { drawChampionIcon } from './render.js';

const STORAGE_KEY = 'little-league-setup';

export class Setup {
  constructor(root, onStart) {
    this.root = root;
    this.onStart = onStart;
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      saved = {};
    }
    this.options = {
      champion: saved.champion || 'aria',
      difficulty: saved.difficulty || 'normal',
      teamSize: saved.teamSize || 5,
      spellD: saved.spellD || 'flash',
      spellF: saved.spellF || 'heal',
      autoLevel: saved.autoLevel !== undefined ? saved.autoLevel : true,
      damageNumbers: saved.damageNumbers !== undefined ? saved.damageNumbers : true,
      fog: saved.fog !== undefined ? saved.fog : true,
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.options));
    } catch (e) {
      /* ignore */
    }
  }

  show() {
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this.root.hidden = true;
  }

  render() {
    const o = this.options;
    const spellOptions = (sel) => SPELL_LIST.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${s.name}</option>`).join('');
    this.root.innerHTML = `
      <h1>LITTLE LEAGUE</h1>
      <div class="subtitle">A small MOBA in the spirit of League of Legends. Pick a champion, destroy the enemy nexus.</div>
      <div class="champ-grid">${CHAMPION_LIST.map((c) => `
        <div class="champ-card ${c.id === o.champion ? 'selected' : ''}" data-id="${c.id}">
          <canvas width="64" height="64"></canvas>
          <div class="name">${c.name}</div>
          <div class="title">${c.title}</div>
          <span class="cls">${c.cls} · ${c.ranged ? 'Ranged' : 'Melee'}</span>
          <div class="abil">
            <div><b>P</b> ${c.passive.name}</div>
            ${['Q', 'W', 'E', 'R'].map((k) => `<div><b>${k}</b> ${c.abilities[k].name}</div>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      <div class="setup-row">
        <div class="setup-box"><h3>Difficulty</h3><div class="seg" data-opt="difficulty">${['easy', 'normal', 'hard'].map((d) => `<button data-v="${d}" class="${o.difficulty === d ? 'active' : ''}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
        <div class="setup-box"><h3>Team size</h3><div class="seg" data-opt="teamSize">${[1, 3, 5].map((n) => `<button data-v="${n}" class="${o.teamSize === n ? 'active' : ''}">${n} v ${n}</button>`).join('')}</div></div>
        <div class="setup-box"><h3>Summoner spells</h3>
          <label>D: <select id="spellD">${spellOptions(o.spellD)}</select></label>
          <label>F: <select id="spellF">${spellOptions(o.spellF)}</select></label>
        </div>
        <div class="setup-box"><h3>Options</h3>
          <label><input type="checkbox" id="optAuto" ${o.autoLevel ? 'checked' : ''}> Auto-level abilities</label>
          <label><input type="checkbox" id="optDmg" ${o.damageNumbers ? 'checked' : ''}> Damage numbers</label>
          <label><input type="checkbox" id="optFog" ${o.fog ? 'checked' : ''}> Fog of war</label>
        </div>
        <div class="setup-box"><h3>Selected champion</h3><div class="ability-preview" id="preview"></div></div>
        <div class="setup-box"><h3>Controls</h3><div class="controls-box">
          <div><kbd>RMB</kbd> move / attack</div><div><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> cast at cursor</div><div><kbd>Ctrl</kbd>+key level up</div><div><kbd>D</kbd><kbd>F</kbd> summoner spells</div><div><kbd>A</kbd>+<kbd>LMB</kbd> attack-move</div><div><kbd>S</kbd> stop</div><div><kbd>B</kbd> recall</div><div><kbd>P</kbd> shop (at fountain)</div><div><kbd>1</kbd>-<kbd>6</kbd> use item</div><div><kbd>Tab</kbd> scoreboard</div><div><kbd>Y</kbd> camera lock</div><div><kbd>Space</kbd> center camera</div><div><kbd>Esc</kbd> pause menu</div><div><kbd>M</kbd> mute</div>
        </div></div>
      </div>
      <button id="startBtn">PLAY</button>`;
    this.root.querySelectorAll('.champ-card').forEach((card) => {
      const def = CHAMPION_LIST.find((c) => c.id === card.dataset.id);
      const ctx = card.querySelector('canvas').getContext('2d');
      drawChampionIcon(ctx, def, 32, 32, 29, 0);
      card.addEventListener('click', () => {
        o.champion = def.id;
        o.spellD = def.defaultSpells[0];
        o.spellF = def.defaultSpells[1];
        this.render();
      });
    });
    this.root.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const key = seg.dataset.opt;
        o[key] = key === 'teamSize' ? Number(b.dataset.v) : b.dataset.v;
        this.render();
      }));
    });
    this.root.querySelector('#spellD').addEventListener('change', (e) => (o.spellD = e.target.value));
    this.root.querySelector('#spellF').addEventListener('change', (e) => (o.spellF = e.target.value));
    this.root.querySelector('#optAuto').addEventListener('change', (e) => (o.autoLevel = e.target.checked));
    this.root.querySelector('#optDmg').addEventListener('change', (e) => (o.damageNumbers = e.target.checked));
    this.root.querySelector('#optFog').addEventListener('change', (e) => (o.fog = e.target.checked));
    const def = CHAMPION_LIST.find((c) => c.id === o.champion);
    this.root.querySelector('#preview').innerHTML = `<b>${def.name}</b>, ${def.title} — ${def.cls}<br><b>Passive – ${def.passive.name}:</b> ${def.passive.desc}<br>${['Q', 'W', 'E', 'R'].map((k) => `<b>${k} – ${def.abilities[k].name}:</b> ${def.abilities[k].desc(1, null)}`).join('<br>')}`;
    this.root.querySelector('#startBtn').addEventListener('click', () => {
      if (o.spellD === o.spellF) {
        o.spellF = o.spellD === 'flash' ? 'heal' : 'flash';
      }
      this.save();
      this.onStart({ ...o });
    });
  }
}
