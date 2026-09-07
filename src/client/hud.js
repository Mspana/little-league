// DOM heads-up display: bars, abilities, items, shop, scoreboard, kill feed, pause and end screens.
import { ITEMS, ITEM_LIST, ITEM_CATEGORIES, describeItemStats } from '../sim/items.js';
import { SUMMONER_SPELLS } from '../sim/champions.js';
import { formatTime } from '../sim/math.js';
import { xpToNextLevel } from '../sim/stats.js';
import { drawChampionIcon } from './render.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['Q', 'W', 'E', 'R'];
const CAT_LABELS = { recommended: 'Recommended', starter: 'Starter', attack: 'Attack', magic: 'Magic', defense: 'Defense', boots: 'Boots', consumable: 'Consumables', all: 'All' };
const GLYPH_LETTER = { sword: 'S', dagger: 'D', bow: 'B', book: 'T', wand: 'W', gem: 'G', shield: 'A', ring: 'R', potion: 'P', boot: 'B', hat: 'H', orb: 'O', tooth: 'N', cloak: 'C', belt: 'B', thorn: 'T', sun: 'S', mask: 'V', heart: 'W', tri: 'T', axe: 'A' };

function itemIconHtml(def, extra = '') {
  return `<div class="item-icon" style="background:${def.icon ? def.icon.bg : '#555'}">${def.icon ? GLYPH_LETTER[def.icon.glyph] || '?' : '?'}${extra}</div>`;
}

export class Hud {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.lastSeq = 0;
    this.shopOpen = false;
    this.shopTab = 'recommended';
    this.scoreboardOpen = false;
    this.pauseOpen = false;
    this.announceUntil = 0;
    this.noticeUntil = 0;
    this.scoreTimer = 0;
    this.buildAbilityBar();
    this.buildItems();
    $('shopBtn').addEventListener('click', () => this.toggleShop());
    $('minimap').addEventListener('mousemove', (e) => e.stopPropagation());
    this.tooltipEl = $('tooltip');
    this.endShown = false;
  }

  get game() {
    return this.app.game;
  }
  get player() {
    return this.game ? this.game.player : null;
  }

  show() {
    this.root.hidden = false;
    this.lastSeq = 0;
    this.endShown = false;
    this.hideAll();
    const p = this.player;
    const pc = $('portraitCanvas');
    const ctx = pc.getContext('2d');
    ctx.clearRect(0, 0, pc.width, pc.height);
    drawChampionIcon(ctx, p.def, 36, 36, 32, p.team);
    this.abilityEls.forEach((el, i) => {
      el.querySelector('.aname').textContent = p.def.abilities[KEYS[i]].name;
      el.style.background = `linear-gradient(160deg, ${p.def.color}55, #0f172a 70%)`;
    });
    this.spellEls.forEach((el, i) => {
      const def = SUMMONER_SPELLS[p.spells[i].id];
      el.querySelector('.key').textContent = i === 0 ? 'D' : 'F';
      el.querySelector('.aname').textContent = def.name;
      el.style.background = `linear-gradient(160deg, ${def.color}66, #0f172a 70%)`;
    });
    $('hint').innerHTML = `<kbd>Right click</kbd> move / attack &nbsp; <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> abilities at cursor &nbsp; <kbd>D</kbd><kbd>F</kbd> spells<br><kbd>A</kbd> attack-move &nbsp; <kbd>B</kbd> recall &nbsp; <kbd>P</kbd> shop &nbsp; <kbd>Tab</kbd> score &nbsp; <kbd>Y</kbd> camera lock &nbsp; <kbd>Esc</kbd> menu`;
    this.flash('Welcome to the Rift. Buy items (P), then head to lane!');
  }

  hide() {
    this.root.hidden = true;
  }

  hideAll() {
    this.shopOpen = false;
    this.scoreboardOpen = false;
    this.pauseOpen = false;
    this.app.paused = false;
    $('shop').hidden = true;
    $('scoreboard').hidden = true;
    $('pause').hidden = true;
    $('end').hidden = true;
    $('death').hidden = true;
    this.tooltipEl.hidden = true;
  }

  // ------------------------------------------------------------ construction
  buildAbilityBar() {
    const bar = $('abilities');
    bar.innerHTML = '';
    this.abilityEls = KEYS.map((key) => {
      const el = document.createElement('div');
      el.className = 'ability';
      el.innerHTML = `<div class="lvl">+</div><div class="key">${key}</div><div class="aname"></div><div class="cd"></div><div class="ranks">${'<i></i>'.repeat(key === 'R' ? 3 : 5)}</div>`;
      el.addEventListener('click', (e) => {
        const p = this.player;
        if (!p) return;
        if (this.game.canLevel(p, key)) {
          this.game.levelUpAbility(p, key);
          this.app.sfx.play('ui');
        } else this.app.input.castAbility(key);
        e.stopPropagation();
      });
      el.addEventListener('mouseenter', () => this.showAbilityTooltip(key, el));
      el.addEventListener('mouseleave', () => this.hideTooltip());
      bar.appendChild(el);
      return el;
    });
    this.spellEls = [0, 1].map((i) => {
      const el = document.createElement('div');
      el.className = 'ability spell';
      el.innerHTML = `<div class="key"></div><div class="aname"></div><div class="cd"></div>`;
      el.addEventListener('click', () => this.app.input.castSpell(i));
      el.addEventListener('mouseenter', () => this.showSpellTooltip(i, el));
      el.addEventListener('mouseleave', () => this.hideTooltip());
      bar.appendChild(el);
      return el;
    });
  }

  buildItems() {
    const grid = $('items');
    grid.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="num">${i + 1}</span><span class="glyph"></span><span class="count"></span>`;
      el.addEventListener('click', () => this.game && this.game.useItem(this.player, i).ok && this.app.sfx.play('potion'));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.game) return;
        const res = this.game.sellItem(this.player, i);
        if (res.ok) this.app.sfx.play('gold');
        else if (res.reason === 'shop') this.flash('You can only sell near your shop');
        this.renderShop();
      });
      el.addEventListener('mouseenter', () => this.showItemTooltip(i, el));
      el.addEventListener('mouseleave', () => this.hideTooltip());
      grid.appendChild(el);
      this.slotEls.push(el);
    }
  }

  // ------------------------------------------------------------ tooltips
  showTooltip(html, anchor) {
    const t = this.tooltipEl;
    t.innerHTML = html;
    t.hidden = false;
    const r = anchor.getBoundingClientRect();
    t.style.left = `${Math.max(8, Math.min(window.innerWidth - 320, r.left + r.width / 2 - 150))}px`;
    t.style.top = `${Math.max(8, r.top - t.offsetHeight - 12)}px`;
  }

  hideTooltip() {
    this.tooltipEl.hidden = true;
  }

  showAbilityTooltip(key, el) {
    const p = this.player;
    if (!p) return;
    const ab = p.abilities[key];
    const def = ab.def;
    const rank = Math.max(1, ab.rank);
    const cd = Array.isArray(def.cooldown) ? def.cooldown[rank - 1] : def.cooldown;
    const cost = Array.isArray(def.cost) ? def.cost[rank - 1] : def.cost;
    this.showTooltip(`<b>${def.name}</b> <span class="dim">[${key}] rank ${ab.rank}/${ab.maxRank}</span><br>${def.desc(rank, p)}<br><span class="dim">Cooldown ${cd}s · Cost ${cost} mana${def.range ? ` · Range ${def.range}` : ''}</span>${this.game.canLevel(p, key) ? '<br><b>Click or Ctrl+' + key + ' to level up</b>' : ''}`, el);
  }

  showSpellTooltip(i, el) {
    const p = this.player;
    if (!p) return;
    const def = SUMMONER_SPELLS[p.spells[i].id];
    this.showTooltip(`<b>${def.name}</b> <span class="dim">[${i === 0 ? 'D' : 'F'}]</span><br>${def.desc}<br><span class="dim">Cooldown ${def.cooldown}s</span>`, el);
  }

  showItemTooltip(i, el) {
    const p = this.player;
    if (!p || !p.items[i]) return;
    this.showTooltip(this.itemTooltipHtml(ITEMS[p.items[i].id]) + '<br><span class="dim">Right-click to sell (70%)' + (ITEMS[p.items[i].id].consumable ? ` · press ${i + 1} to use` : '') + '</span>', el);
  }

  itemTooltipHtml(def) {
    const stats = describeItemStats(def).join('<br>');
    return `<b>${def.name}</b> <span style="color:#fbbf24">${def.cost}g</span><br>${stats}${def.desc ? `<br><i>${def.desc}</i>` : ''}`;
  }

  flash(text) {
    const el = $('notice');
    el.textContent = text;
    el.classList.add('show');
    this.noticeUntil = performance.now() + 2600;
  }

  announce(text, cls = 'gold') {
    const el = $('announce');
    el.textContent = text;
    el.className = `show ${cls}`;
    this.announceUntil = performance.now() + 3200;
  }

  // ------------------------------------------------------------ per-frame update
  update(dt) {
    const game = this.game;
    const p = this.player;
    if (!game || !p) return;
    const now = performance.now();
    if (this.noticeUntil && now > this.noticeUntil) {
      $('notice').classList.remove('show');
      this.noticeUntil = 0;
    }
    if (this.announceUntil && now > this.announceUntil) {
      $('announce').classList.remove('show');
      this.announceUntil = 0;
    }
    $('clock').textContent = formatTime(game.time);
    $('scoreBlue').textContent = game.teamStats[0].kills;
    $('scoreRed').textContent = game.teamStats[1].kills;
    const ts = game.teamStats;
    $('objectives').textContent = `Turrets ${ts[0].towers} – ${ts[1].towers}   Dragons ${ts[0].dragons} – ${ts[1].dragons}   Barons ${ts[0].barons} – ${ts[1].barons}${this.app.fps ? `   ${this.app.fps} fps` : ''}`;

    // bars
    const s = p.ensureStats();
    const hpEl = this.root.querySelector('.bar.hp');
    hpEl.querySelector('.fill').style.width = `${(100 * p.hp) / s.maxHp}%`;
    const shield = p.shieldTotal;
    const shieldEl = hpEl.querySelector('.shield');
    shieldEl.style.left = `${(100 * p.hp) / s.maxHp}%`;
    shieldEl.style.width = `${Math.min(100 - (100 * p.hp) / s.maxHp, (100 * shield) / s.maxHp)}%`;
    hpEl.querySelector('.text').textContent = `${Math.round(p.hp)} / ${Math.round(s.maxHp)}${shield > 0 ? ` (+${Math.round(shield)})` : ''}  +${s.hpRegen.toFixed(1)}/s`;
    const manaEl = this.root.querySelector('.bar.mana');
    manaEl.querySelector('.fill').style.width = `${s.maxMana > 0 ? (100 * p.mana) / s.maxMana : 0}%`;
    manaEl.querySelector('.text').textContent = `${Math.round(p.mana)} / ${Math.round(s.maxMana)}`;
    $('levelBadge').textContent = p.level;
    $('portrait').classList.toggle('dead', !p.alive);
    const xpEl = $('xpbar');
    const need = xpToNextLevel(p.level);
    xpEl.querySelector('.fill').style.width = `${need === Infinity ? 100 : (100 * p.xp) / need}%`;
    xpEl.title = need === Infinity ? 'Max level' : `XP ${Math.round(p.xp)} / ${need}`;

    // abilities
    KEYS.forEach((key, i) => {
      const el = this.abilityEls[i];
      const ab = p.abilities[key];
      el.classList.toggle('norank', ab.rank <= 0);
      el.classList.toggle('oncd', ab.cd > 0);
      el.classList.toggle('nomana', ab.rank > 0 && p.mana < game.abilityCost(p, key));
      el.classList.toggle('canlevel', game.canLevel(p, key));
      el.querySelector('.cd').textContent = ab.cd > 0 ? (ab.cd >= 10 ? Math.ceil(ab.cd) : ab.cd.toFixed(1)) : '';
      const pips = el.querySelectorAll('.ranks i');
      pips.forEach((pip, r) => pip.classList.toggle('on', r < ab.rank));
    });
    this.spellEls.forEach((el, i) => {
      const slot = p.spells[i];
      el.classList.toggle('oncd', slot.cd > 0);
      el.querySelector('.cd').textContent = slot.cd > 0 ? Math.ceil(slot.cd) : '';
    });

    // slower-changing panels are refreshed ten times per second
    this.slowTimer = (this.slowTimer || 0) - dt;
    if (this.slowTimer > 0) {
      this.processEvents();
      this.finishUpdate(dt);
      return;
    }
    this.slowTimer = 0.1;
    // items & gold
    this.slotEls.forEach((el, i) => {
      const slot = p.items[i];
      const glyph = el.querySelector('.glyph');
      const count = el.querySelector('.count');
      if (!slot) {
        glyph.textContent = '';
        el.style.background = '#0f172a';
        el.title = '';
        count.textContent = '';
        return;
      }
      const def = ITEMS[slot.id];
      glyph.textContent = def.icon ? GLYPH_LETTER[def.icon.glyph] || '?' : '?';
      el.style.background = def.icon ? def.icon.bg : '#555';
      count.textContent = slot.count > 1 ? `x${slot.count}` : '';
    });
    $('gold').textContent = Math.floor(p.gold);
    $('shopBtn').style.opacity = game.nearShop(p) ? 1 : 0.5;

    // stats
    $('stats').innerHTML = `<span>AD</span><b>${Math.round(s.ad)}</b><span>AP</span><b>${Math.round(s.ap)}</b><span>Armor</span><b>${Math.round(s.armor)}</b><span>MR</span><b>${Math.round(s.mr)}</b><span>AS</span><b>${s.attackSpeed.toFixed(2)}</b><span>MS</span><b>${Math.round(s.moveSpeed)}</b>${s.crit > 0 ? `<span>Crit</span><b>${Math.round(s.crit * 100)}%</b>` : ''}${s.lifesteal > 0 ? `<span>LS</span><b>${Math.round(s.lifesteal * 100)}%</b>` : ''}`;

    // buffs
    const buffs = p.buffs.filter((b) => !b.hidden);
    $('buffbar').innerHTML = buffs.map((b) => `<span class="buff${b.harmful ? ' bad' : ''}">${b.name}${b.stacks > 1 ? ` x${b.stacks}` : ''}${b.remaining !== Infinity ? ` ${Math.ceil(b.remaining)}s` : ''}</span>`).join('');

    // death overlay
    const death = $('death');
    if (!p.alive) {
      death.hidden = false;
      death.innerHTML = `You have been slain<small>Respawning in ${Math.ceil(p.respawnTimer)}s — you can still shop (P)</small>`;
    } else death.hidden = true;

    this.processEvents();
    this.finishUpdate(dt);
  }

  finishUpdate(dt) {
    const game = this.game;
    if (this.scoreboardOpen) {
      this.scoreTimer -= dt;
      if (this.scoreTimer <= 0) {
        this.scoreTimer = 0.5;
        this.renderScoreboard();
      }
    }
    if (this.shopOpen) {
      this.shopTimer = (this.shopTimer || 0) - dt;
      if (this.shopTimer <= 0) {
        this.shopTimer = 0.5;
        this.renderShop(true);
      }
    }
    if (game.over && !this.endShown) this.showEnd();
  }

  processEvents() {
    const game = this.game;
    const p = this.player;
    for (const ev of game.events) {
      if (ev.seq <= this.lastSeq) continue;
      this.lastSeq = ev.seq;
      switch (ev.type) {
        case 'kill': {
          const k = `<span class="${ev.killerTeam === 0 ? 'b' : 'r'}">${ev.killerName}</span>`;
          const v = `<span class="${ev.victimTeam === 0 ? 'b' : 'r'}">${ev.victimName}</span>`;
          this.feed(`${k} killed ${v}${ev.assists.length ? ` <span class="dim">(+${ev.assists.join(', ')})</span>` : ''}`);
          if (ev.killerIsPlayer) {
            this.announce(ev.firstBlood ? 'FIRST BLOOD!' : 'You killed ' + ev.victimName, 'gold');
            this.app.sfx.play('kill');
          } else if (ev.victimIsPlayer) {
            // the death overlay already says it
          } else if (ev.firstBlood) {
            this.announce('FIRST BLOOD', ev.killerTeam === p.team ? 'blue' : 'red');
            this.app.sfx.play('announce');
          } else if (ev.victimTeam === p.team) {
            this.announce('An ally has been slain', 'red');
          } else {
            this.announce('An enemy has been slain', 'blue');
          }
          break;
        }
        case 'tower':
          this.feed(`<span class="${ev.byTeam === 0 ? 'b' : 'r'}">${ev.killerName || (ev.byTeam === 0 ? 'Blue' : 'Red')}</span> destroyed a <span class="${ev.team === 0 ? 'b' : 'r'}">${ev.lane} turret</span>`);
          this.announce(ev.byTeam === p.team ? 'Enemy turret destroyed!' : 'Your turret has been destroyed', ev.byTeam === p.team ? 'blue' : 'red');
          this.app.sfx.play('tower');
          break;
        case 'inhibitor':
          this.feed(`<span class="${ev.team === 0 ? 'b' : 'r'}">${ev.lane} inhibitor</span> destroyed`);
          this.announce(ev.byTeam === p.team ? 'Enemy inhibitor destroyed! Super minions incoming' : 'Your inhibitor has been destroyed!', ev.byTeam === p.team ? 'blue' : 'red');
          this.app.sfx.play('tower');
          break;
        case 'inhibitor_respawn':
          if (ev.team === p.team) this.flash(`Your ${ev.lane} inhibitor has respawned`);
          break;
        case 'epic':
          this.feed(`<span class="${ev.team === 0 ? 'b' : 'r'}">${ev.killerName || (ev.team === 0 ? 'Blue' : 'Red')}</span> slew the ${ev.what === 'dragon' ? 'Dragon' : 'Baron'}`);
          this.announce(`${ev.team === p.team ? 'Your team' : 'The enemy'} killed the ${ev.what === 'dragon' ? 'Dragon' : 'Baron Nashor'}`, ev.team === p.team ? 'blue' : 'red');
          this.app.sfx.play('announce');
          break;
        case 'notice':
          this.flash(ev.text);
          break;
        case 'levelup':
          if (ev.unit === p.id && !this.game.opts.autoLevel) this.flash(`Level ${ev.level}! Press Ctrl+Q/W/E/R or click + to learn an ability`);
          break;
        case 'gameover':
          break;
        default:
          break;
      }
    }
  }

  feed(html) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = html;
    const feed = $('killfeed');
    feed.appendChild(el);
    while (feed.children.length > 6) feed.removeChild(feed.firstChild);
    setTimeout(() => el.remove(), 6000);
  }

  // ------------------------------------------------------------ scoreboard
  showScoreboard(open) {
    this.scoreboardOpen = open;
    $('scoreboard').hidden = !open;
    if (open) this.renderScoreboard();
  }

  renderScoreboard() {
    const game = this.game;
    const rows = (team) => game.champions.filter((c) => c.team === team).map((c) => {
      const items = c.items.filter(Boolean).map((s) => `<span class="mini" style="background:${ITEMS[s.id].icon.bg}" title="${ITEMS[s.id].name}">${GLYPH_LETTER[ITEMS[s.id].icon.glyph] || ''}</span>`).join('');
      return `<tr class="${team === 0 ? 'blue' : 'red'}${c.isPlayer ? ' me' : ''}"><td>${c.name}${c.isPlayer ? ' (you)' : ''}</td><td>${c.role}</td><td>${c.level}</td><td>${c.kills} / ${c.deaths} / ${c.assists}</td><td>${c.cs}</td><td>${Math.round(c.totalGold)}</td><td>${Math.round(c.damageDealt)}</td><td>${items}</td></tr>`;
    }).join('');
    const head = '<tr><th>Champion</th><th>Role</th><th>Lvl</th><th>K / D / A</th><th>CS</th><th>Gold</th><th>Dmg to champs</th><th>Items</th></tr>';
    $('scoreboard').innerHTML = `<h2>Scoreboard — ${formatTime(game.time)}</h2><div class="teamhead" style="color:#93c5fd">BLUE TEAM — ${game.teamStats[0].kills} kills, ${game.teamStats[0].towers} turrets</div><table>${head}${rows(0)}</table><div class="teamhead" style="color:#fca5a5">RED TEAM — ${game.teamStats[1].kills} kills, ${game.teamStats[1].towers} turrets</div><table>${head}${rows(1)}</table>`;
  }

  // ------------------------------------------------------------ shop
  toggleShop(force) {
    const open = force === undefined ? !this.shopOpen : force;
    if (open && !this.game.nearShop(this.player)) {
      this.flash('You must be near your fountain to shop (press B to recall)');
      this.app.sfx.play('error');
      return;
    }
    this.shopOpen = open;
    $('shop').hidden = !open;
    if (open) this.renderShop();
  }

  shopItems(tab) {
    if (tab === 'recommended') return this.player.def.build.filter((id, i, arr) => arr.indexOf(id) === i).map((id) => ITEMS[id]);
    if (tab === 'all') return ITEM_LIST;
    return ITEM_LIST.filter((i) => i.cat === tab);
  }

  renderShop(refreshOnly = false) {
    const p = this.player;
    const game = this.game;
    const shop = $('shop');
    if (!refreshOnly || !shop.querySelector('.grid')) {
      const tabs = ['recommended', ...ITEM_CATEGORIES, 'all'].map((t) => `<button data-tab="${t}" class="${t === this.shopTab ? 'active' : ''}">${CAT_LABELS[t]}</button>`).join('');
      shop.innerHTML = `<div class="head"><h2>Shop — <span style="color:#fbbf24">${Math.floor(p.gold)}g</span></h2><button class="closeBtn">Close (P)</button></div><div class="tabs">${tabs}</div><div class="grid"></div><div class="msg"></div><div class="foot"><div>Your items (right-click to sell): <span class="owned"></span></div><div class="dim">Click an item to buy it. Boots are unique.</div></div>`;
      shop.querySelector('.closeBtn').addEventListener('click', () => this.toggleShop(false));
      shop.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
        this.shopTab = b.dataset.tab;
        this.renderShop();
      }));
    }
    shop.querySelector('.head h2').innerHTML = `Shop — <span style="color:#fbbf24">${Math.floor(p.gold)}g</span>`;
    const grid = shop.querySelector('.grid');
    const items = this.shopItems(this.shopTab);
    const html = items.map((def) => `<div class="item-card${p.gold < def.cost ? ' cant' : ''}" data-id="${def.id}">${itemIconHtml(def)}<div><div class="iname">${def.name}</div><div class="icost">${def.cost}g</div></div></div>`).join('');
    if (grid.dataset.tab !== this.shopTab || grid.dataset.count !== String(items.length)) {
      grid.innerHTML = html;
      grid.dataset.tab = this.shopTab;
      grid.dataset.count = String(items.length);
      grid.querySelectorAll('.item-card').forEach((card) => {
        card.addEventListener('click', () => {
          const res = game.buyItem(p, card.dataset.id);
          const msg = shop.querySelector('.msg');
          if (res.ok) {
            this.app.sfx.play('gold');
            msg.textContent = '';
          } else {
            const reasons = { gold: 'Not enough gold', full: 'Inventory is full', boots: 'You already own boots', stack: 'Cannot carry more of that', shop: 'Too far from the shop' };
            msg.textContent = reasons[res.reason] || 'Cannot buy that';
            this.app.sfx.play('error');
          }
          this.renderShop(true);
        });
        card.addEventListener('mouseenter', () => this.showTooltip(this.itemTooltipHtml(ITEMS[card.dataset.id]), card));
        card.addEventListener('mouseleave', () => this.hideTooltip());
      });
    } else {
      grid.querySelectorAll('.item-card').forEach((card) => card.classList.toggle('cant', p.gold < ITEMS[card.dataset.id].cost));
    }
    const owned = shop.querySelector('.owned');
    owned.innerHTML = p.items.map((s, i) => (s ? `<span class="slot" data-i="${i}" style="display:inline-flex;width:30px;height:30px;font-size:12px;background:${ITEMS[s.id].icon.bg}" title="${ITEMS[s.id].name}">${GLYPH_LETTER[ITEMS[s.id].icon.glyph] || ''}${s.count > 1 ? `<span class="count">x${s.count}</span>` : ''}</span>` : `<span class="slot" style="display:inline-flex;width:30px;height:30px;opacity:0.4"></span>`)).join('');
    owned.querySelectorAll('.slot[data-i]').forEach((el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        game.sellItem(p, Number(el.dataset.i));
        this.app.sfx.play('gold');
        this.renderShop(true);
      });
    });
  }

  // ------------------------------------------------------------ pause / end
  togglePause(force) {
    const open = force === undefined ? !this.pauseOpen : force;
    this.pauseOpen = open;
    this.app.paused = open;
    const el = $('pause');
    el.hidden = !open;
    if (!open) return;
    el.innerHTML = `<h2>Paused</h2><button id="resumeBtn">Resume</button><button id="lockBtn">Camera: ${this.app.camera.locked ? 'locked (Y to unlock)' : 'free (Y to lock)'}</button><button id="restartBtn">Restart match</button><button id="quitBtn">Change champion / settings</button>
      <div class="ctl"><div><kbd>RMB</kbd> move / attack</div><div><kbd>A</kbd>+<kbd>LMB</kbd> attack-move</div><div><kbd>S</kbd> stop</div><div><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> abilities</div><div><kbd>Ctrl</kbd>+key level up</div><div><kbd>D</kbd><kbd>F</kbd> summoner spells</div><div><kbd>1-6</kbd> use item</div><div><kbd>B</kbd> recall</div><div><kbd>P</kbd> shop</div><div><kbd>Tab</kbd> scoreboard</div><div><kbd>Space</kbd> center camera</div><div><kbd>Y</kbd> camera lock</div><div><kbd>Wheel</kbd> zoom</div><div><kbd>M</kbd> mute</div></div>`;
    $('resumeBtn').addEventListener('click', () => this.togglePause(false));
    $('lockBtn').addEventListener('click', () => {
      this.app.camera.locked = !this.app.camera.locked;
      this.togglePause(true);
    });
    $('restartBtn').addEventListener('click', () => this.app.restart());
    $('quitBtn').addEventListener('click', () => this.app.quitToSetup());
  }

  showEnd() {
    this.endShown = true;
    const game = this.game;
    const p = this.player;
    const won = game.winner === p.team;
    this.app.sfx.play(won ? 'victory' : 'defeat');
    const rows = game.champions.map((c) => `<tr class="${c.team === 0 ? 'blue' : 'red'}"><td>${c.name}${c.isPlayer ? ' (you)' : ''}</td><td>${c.level}</td><td>${c.kills}/${c.deaths}/${c.assists}</td><td>${c.cs}</td><td>${Math.round(c.totalGold)}</td></tr>`).join('');
    const el = $('end');
    el.hidden = false;
    el.innerHTML = `<h1 class="${won ? 'win' : 'lose'}">${won ? 'VICTORY' : 'DEFEAT'}</h1><div class="sub">${won ? 'The enemy nexus has been destroyed' : 'Your nexus has been destroyed'} — ${formatTime(game.time)}</div><table><tr><th>Champion</th><th>Lvl</th><th>K/D/A</th><th>CS</th><th>Gold</th></tr>${rows}</table><button id="againBtn">Play again</button><button id="setupBtn">Change champion</button>`;
    $('againBtn').addEventListener('click', () => this.app.restart());
    $('setupBtn').addEventListener('click', () => this.app.quitToSetup());
  }
}
