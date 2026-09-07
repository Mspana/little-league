// Shop catalogue. Stats use the same keys as stats.js mods.
// Attack speed, crit, lifesteal, penetration percentages and movement percentage are fractions.

const item = (id, name, cost, cat, stats, extra = {}) => ({ id, name, cost, cat, stats, ...extra });

export const ITEM_LIST = [
  item('potion', 'Health Potion', 50, 'consumable', {}, {
    consumable: { maxStack: 5, healOverTime: { amount: 150, duration: 12 } },
    desc: 'Consume: restores 150 health over 12 seconds. Stacks up to 5.',
    icon: { bg: '#b0213a', glyph: 'potion' },
  }),
  item('dorans_blade', "Doran's Blade", 450, 'starter', { ad: 8, hp: 80, lifesteal: 0.03 }, { desc: 'A solid start for attackers.', icon: { bg: '#8a4b1f', glyph: 'sword' } }),
  item('dorans_ring', "Doran's Ring", 400, 'starter', { ap: 15, hp: 70, manaRegen: 1.5 }, { desc: 'A solid start for spellcasters.', icon: { bg: '#3d5aa8', glyph: 'ring' } }),
  item('dorans_shield', "Doran's Shield", 450, 'starter', { hp: 80, hpRegen: 1.5 }, { desc: 'A sturdy start for front-liners.', icon: { bg: '#4f6b3a', glyph: 'shield' } }),

  item('long_sword', 'Long Sword', 350, 'attack', { ad: 10 }, { icon: { bg: '#6d6d6d', glyph: 'sword' } }),
  item('dagger', 'Dagger', 300, 'attack', { as: 0.12 }, { icon: { bg: '#7d7d5a', glyph: 'dagger' } }),
  item('pickaxe', 'Pickaxe', 875, 'attack', { ad: 25 }, { icon: { bg: '#6f5a3a', glyph: 'sword' } }),
  item('bf_sword', 'B.F. Sword', 1300, 'attack', { ad: 40 }, { icon: { bg: '#8c2f2f', glyph: 'sword' } }),
  item('vampiric_scepter', 'Vampiric Scepter', 900, 'attack', { ad: 15, lifesteal: 0.07 }, { icon: { bg: '#7a1f3a', glyph: 'sword' } }),
  item('recurve_bow', 'Recurve Bow', 1000, 'attack', { as: 0.25 }, { icon: { bg: '#5a7d3a', glyph: 'bow' } }),
  item('infinity_edge', 'Infinity Edge', 3400, 'attack', { ad: 65, crit: 0.2, critDmg: 0.25 }, { desc: 'Critical strikes deal 200% damage.', icon: { bg: '#c9a227', glyph: 'sword' } }),
  item('bloodthirster', 'Bloodthirster', 3400, 'attack', { ad: 75, lifesteal: 0.15 }, { icon: { bg: '#9c1c2c', glyph: 'sword' } }),
  item('phantom_dancer', 'Phantom Dancer', 2600, 'attack', { as: 0.6, crit: 0.25, msPct: 0.07 }, { icon: { bg: '#7b9fd1', glyph: 'dagger' } }),
  item('last_whisper', "Lord Dominik's Regards", 3000, 'attack', { ad: 35, armorPenPct: 0.35 }, { desc: 'Ignores 35% of the target\'s armor.', icon: { bg: '#3c3c4a', glyph: 'bow' } }),
  item('trinity_force', 'Trinity Force', 3333, 'attack', { ad: 35, as: 0.3, hp: 300, haste: 20 }, {
    passive: 'spellblade', desc: 'Spellblade: after casting an ability, the next basic attack deals 150% base AD bonus physical damage (1.5s cooldown).',
    icon: { bg: '#b8862b', glyph: 'tri' },
  }),
  item('black_cleaver', 'Black Cleaver', 3100, 'attack', { ad: 45, hp: 350, haste: 20, armorPenPct: 0.15 }, { icon: { bg: '#3a2b2b', glyph: 'axe' } }),

  item('amplifying_tome', 'Amplifying Tome', 400, 'magic', { ap: 20 }, { icon: { bg: '#3a4d8a', glyph: 'book' } }),
  item('sapphire_crystal', 'Sapphire Crystal', 350, 'magic', { mana: 250 }, { icon: { bg: '#2e63b8', glyph: 'gem' } }),
  item('blasting_wand', 'Blasting Wand', 850, 'magic', { ap: 40 }, { icon: { bg: '#5b3a8a', glyph: 'wand' } }),
  item('needlessly_large_rod', 'Needlessly Large Rod', 1250, 'magic', { ap: 60 }, { icon: { bg: '#7a2f8a', glyph: 'wand' } }),
  item('rabadons', "Rabadon's Deathcap", 3600, 'magic', { ap: 120, apPct: 0.35 }, { desc: 'Increases ability power by 35%.', icon: { bg: '#8a1f6b', glyph: 'hat' } }),
  item('void_staff', 'Void Staff', 2800, 'magic', { ap: 65, magicPenPct: 0.4 }, { desc: 'Ignores 40% of the target\'s magic resist.', icon: { bg: '#4a2a6b', glyph: 'wand' } }),
  item('rylais', "Rylai's Crystal Scepter", 2600, 'magic', { ap: 75, hp: 350 }, { passive: 'rylais', desc: 'Ability damage slows enemies by 30% for 1 second.', icon: { bg: '#3b7fb8', glyph: 'gem' } }),
  item('morellonomicon', 'Morellonomicon', 2500, 'magic', { ap: 80, hp: 250, magicPenFlat: 15 }, { icon: { bg: '#2f5f4a', glyph: 'book' } }),
  item('nashors_tooth', "Nashor's Tooth", 3000, 'magic', { ap: 90, as: 0.5 }, { passive: 'nashors', desc: 'Basic attacks deal 15 (+20% AP) bonus magic damage.', icon: { bg: '#6b3f8a', glyph: 'tooth' } }),
  item('ludens', "Luden's Companion", 3200, 'magic', { ap: 90, mana: 600, haste: 20 }, { icon: { bg: '#2b4fa8', glyph: 'orb' } }),
  item('ardent_censer', 'Ardent Censer', 2300, 'magic', { ap: 60, haste: 10, healPower: 0.12, msPct: 0.07 }, { icon: { bg: '#b87f2b', glyph: 'orb' } }),

  item('cloth_armor', 'Cloth Armor', 300, 'defense', { armor: 15 }, { icon: { bg: '#7d6d4d', glyph: 'shield' } }),
  item('null_magic_mantle', 'Null-Magic Mantle', 450, 'defense', { mr: 25 }, { icon: { bg: '#4d5d8a', glyph: 'shield' } }),
  item('ruby_crystal', 'Ruby Crystal', 400, 'defense', { hp: 150 }, { icon: { bg: '#b02a2a', glyph: 'gem' } }),
  item('chain_vest', 'Chain Vest', 800, 'defense', { armor: 40 }, { icon: { bg: '#8a8a8a', glyph: 'shield' } }),
  item('negatron_cloak', 'Negatron Cloak', 900, 'defense', { mr: 50 }, { icon: { bg: '#3f4a8a', glyph: 'cloak' } }),
  item('giants_belt', "Giant's Belt", 900, 'defense', { hp: 350 }, { icon: { bg: '#8a5f2b', glyph: 'belt' } }),
  item('kindlegem', 'Kindlegem', 800, 'defense', { hp: 200, haste: 10 }, { icon: { bg: '#d16d2b', glyph: 'gem' } }),
  item('aegis', 'Aegis of the Legion', 1200, 'defense', { armor: 30, mr: 30 }, { icon: { bg: '#b8b8b8', glyph: 'shield' } }),
  item('thornmail', 'Thornmail', 2700, 'defense', { armor: 70, hp: 350 }, { passive: 'thornmail', desc: 'Reflects 25 (+10% armor) magic damage to attackers.', icon: { bg: '#5a3a2b', glyph: 'thorn' } }),
  item('sunfire', 'Sunfire Aegis', 2700, 'defense', { armor: 50, hp: 350 }, { passive: 'sunfire', desc: 'Burns nearby enemies for 20 (+2 per level) magic damage per second.', icon: { bg: '#c94a1f', glyph: 'sun' } }),
  item('spirit_visage', 'Spirit Visage', 2900, 'defense', { mr: 60, hp: 400, haste: 10, healPower: 0.25 }, { icon: { bg: '#2b8a7a', glyph: 'mask' } }),
  item('warmogs', "Warmog's Armor", 3000, 'defense', { hp: 800, hpRegen: 3 }, { passive: 'warmogs', desc: 'Regenerates 3% max health per second while out of combat.', icon: { bg: '#3a6b2b', glyph: 'heart' } }),
  item('frozen_heart', 'Frozen Heart', 2500, 'defense', { armor: 80, mana: 400, haste: 20 }, { icon: { bg: '#5aa0d1', glyph: 'heart' } }),
  item('locket', 'Locket of the Iron Solari', 2700, 'defense', { armor: 30, mr: 30, hp: 250, haste: 10 }, { icon: { bg: '#c9a83a', glyph: 'shield' } }),

  item('boots', 'Boots of Speed', 300, 'boots', { msFlat: 25 }, { boots: true, icon: { bg: '#6b5a3a', glyph: 'boot' } }),
  item('berserkers', "Berserker's Greaves", 1100, 'boots', { as: 0.35, msFlat: 45 }, { boots: true, icon: { bg: '#8a4a2b', glyph: 'boot' } }),
  item('sorcerers', "Sorcerer's Shoes", 1100, 'boots', { magicPenFlat: 18, msFlat: 45 }, { boots: true, icon: { bg: '#4a3a8a', glyph: 'boot' } }),
  item('steelcaps', 'Plated Steelcaps', 1100, 'boots', { armor: 20, msFlat: 45, attackDmgReduction: 0.12 }, { boots: true, desc: 'Reduces damage from basic attacks by 12%.', icon: { bg: '#6d6d6d', glyph: 'boot' } }),
  item('mercs', "Mercury's Treads", 1100, 'boots', { mr: 25, msFlat: 45, hp: 60 }, { boots: true, icon: { bg: '#5a7d8a', glyph: 'boot' } }),
  item('ionian', 'Ionian Boots of Lucidity', 950, 'boots', { haste: 15, msFlat: 45 }, { boots: true, icon: { bg: '#3a8a7d', glyph: 'boot' } }),
];

export const ITEMS = Object.fromEntries(ITEM_LIST.map((i) => [i.id, i]));
export const ITEM_CATEGORIES = ['starter', 'attack', 'magic', 'defense', 'boots', 'consumable'];

export const STAT_LABELS = {
  ad: ['Attack Damage', (v) => `+${v}`],
  ap: ['Ability Power', (v) => `+${v}`],
  apPct: ['Ability Power', (v) => `+${Math.round(v * 100)}%`],
  hp: ['Health', (v) => `+${v}`],
  mana: ['Mana', (v) => `+${v}`],
  armor: ['Armor', (v) => `+${v}`],
  mr: ['Magic Resist', (v) => `+${v}`],
  as: ['Attack Speed', (v) => `+${Math.round(v * 100)}%`],
  msFlat: ['Move Speed', (v) => `+${v}`],
  msPct: ['Move Speed', (v) => `+${Math.round(v * 100)}%`],
  haste: ['Ability Haste', (v) => `+${v}`],
  lifesteal: ['Life Steal', (v) => `+${Math.round(v * 100)}%`],
  crit: ['Critical Chance', (v) => `+${Math.round(v * 100)}%`],
  critDmg: ['Critical Damage', (v) => `+${Math.round(v * 100)}%`],
  hpRegen: ['Health Regen', (v) => `+${v}/s`],
  manaRegen: ['Mana Regen', (v) => `+${v}/s`],
  armorPenPct: ['Armor Penetration', (v) => `${Math.round(v * 100)}%`],
  magicPenFlat: ['Magic Penetration', (v) => `+${v}`],
  magicPenPct: ['Magic Penetration', (v) => `${Math.round(v * 100)}%`],
  healPower: ['Heal & Shield Power', (v) => `+${Math.round(v * 100)}%`],
  attackDmgReduction: ['Attack Damage Reduction', (v) => `${Math.round(v * 100)}%`],
};

export function describeItemStats(def) {
  const out = [];
  for (const k in def.stats) {
    const label = STAT_LABELS[k];
    if (label) out.push(`${label[1](def.stats[k])} ${label[0]}`);
  }
  return out;
}
