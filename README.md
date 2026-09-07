# Little League

A small, self-contained MOBA in the spirit of League of Legends that runs in the browser.
Three lanes, a river, two jungles with camps, Dragon and Baron, turrets, inhibitors, a nexus,
six champions with full Q/W/E/R kits and passives, summoner spells, a shop with 45 items,
fog of war, and bot teammates and opponents with three difficulty levels.

No build step and no dependencies: plain ES modules, Canvas 2D and a DOM HUD.

## Play

```bash
npm start          # serves the game at http://localhost:8080/
```

Any static file server works (for example `python3 -m http.server 8080`); the page uses ES
modules, so it has to be served over HTTP rather than opened as a `file://` URL.

Pick a champion, a difficulty and a team size (1v1, 3v3 or 5v5) and press **PLAY**.
Destroy the enemy nexus to win.

## Controls

| Input | Action |
| --- | --- |
| Right click | Move, or attack the enemy under the cursor |
| `A` then left click | Attack-move |
| `S` / `H` | Stop / hold position |
| `Q` `W` `E` `R` | Cast abilities at the cursor (quick cast) |
| `Ctrl`+`Q`/`W`/`E`/`R` (or click the `+`) | Level up an ability |
| `D` `F` | Summoner spells |
| `1`–`6` | Use an item (health potions) |
| `B` | Recall to base |
| `P` | Open the shop (at your fountain, or while dead) |
| `Tab` | Scoreboard |
| `Y` | Toggle camera lock, `Space` centers on your champion |
| Mouse wheel / arrow keys / screen edges | Zoom and pan the camera |
| `Esc` | Pause menu |
| `M` | Mute |

## Champions

| Champion | Role | Kit |
| --- | --- | --- |
| **Aria**, the Frost Archer | Marksman | Slowing attacks, Ranger's Focus, Volley, Hawk Step, global Crystal Arrow |
| **Garrick**, the Ironclad | Fighter | Perseverance regen, Decisive Strike, Bulwark, Judgment spin, Execution |
| **Lyra**, the Arcanist | Mage | Arcane Bolt, Nova, Blink, channelled Cataclysm |
| **Vex**, the Shadow | Assassin | Cutthroat leap, Fan of Blades, Shadow Step stealth, Deathmark |
| **Bramble**, the Guardian | Tank | Grasping Roots, Fortify taunt, Bramble Aura, Earthquake knock-up |
| **Seren**, the Songweaver | Support | Hymn of Valor, Aria of Perseverance heal, Song of Celerity, Crescendo stun |

## How the game works

- Minion waves spawn every 30 seconds in all three lanes (siege minions every third wave,
  super minions when an inhibitor is down). Last-hitting grants gold; nearby kills grant
  shared experience up to level 18.
- Turrets must be taken in order (outer, inner, inhibitor turret, inhibitor, nexus turrets,
  nexus) and focus champions who attack allied champions.
- Jungle camps (Blue Sentinel, Wolves, Raptors, Red Brambleback) spawn at 1:15 and respawn
  two minutes after being cleared. Dragon grants permanent team stacks, Baron grants a strong
  temporary buff and empowered minions.
- Bots lane, jungle, last hit, poke, retreat, recall, shop from a champion-specific build,
  defend structures, group up late and fight when the numbers favour them. Enemy bots on
  *Easy* deal less damage and react slowly; on *Hard* they are stronger and quicker.

## Development

```bash
npm test               # unit tests plus a full headless bots-vs-bots match
npm run simulate       # watch a headless match: node scripts/simulate.js [seed] [difficulty] [teamSize] [maxMinutes]
npm run screenshot     # drive the game in headless Chromium and save screenshots (needs Playwright)
```

The simulation (`src/sim`) has no DOM dependencies and runs in Node; the client
(`src/client`) renders it. Everything that affects gameplay lives in the simulation, so
balance changes are covered by the headless tests.

```
src/sim/constants.js   tunables (timings, gold, turret and minion numbers)
src/sim/map.js         lanes, river, jungle carves, structure and camp positions
src/sim/nav.js         grid A* with line-of-sight smoothing
src/sim/champions.js   the six champion kits and summoner spells
src/sim/items.js       shop catalogue
src/sim/combat.js      damage, attacks, kills, gold and experience
src/sim/ai.js          bot decision making
src/sim/game.js        the world and its update loop
src/client/render.js   terrain, units, effects, fog of war, minimap
src/client/hud.js      bars, abilities, shop, scoreboard, menus
```
