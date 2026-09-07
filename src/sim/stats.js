import { XP_PER_LEVEL, MAX_LEVEL } from './constants.js';
import { ITEMS } from './items.js';

// LoL-style per-level growth: more growth at higher levels.
export function growth(base, perLevel, level) {
  const n = level - 1;
  return base + perLevel * n * (0.7025 + 0.0175 * n);
}

export const MOD_KEYS = [
  'hp', 'hpRegen', 'mana', 'manaRegen', 'ad', 'ap', 'apPct', 'armor', 'mr', 'as', 'msFlat', 'msPct',
  'haste', 'lifesteal', 'crit', 'critDmg', 'armorPenFlat', 'armorPenPct', 'magicPenFlat', 'magicPenPct',
  'healPower', 'dmgReduction', 'attackDmgReduction', 'range', 'dmgAmp', 'adPct', 'hpPct', 'armorPct', 'mrPct',
];

export function emptyMods() {
  const m = {};
  for (const k of MOD_KEYS) m[k] = 0;
  return m;
}

export function addMods(into, mods, mult = 1) {
  if (!mods) return into;
  for (const k in mods) {
    if (k in into) into[k] += mods[k] * mult;
  }
  return into;
}

export function xpToNextLevel(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return XP_PER_LEVEL[level];
}

export function cooldownMultiplier(haste) {
  return 100 / (100 + Math.max(0, haste));
}

// Mitigates raw damage against the target's resistances, taking the source's penetration into account.
export function mitigate(amount, type, srcStats, tgtStats) {
  if (type === 'true' || amount <= 0) return Math.max(0, amount);
  let resist;
  if (type === 'physical') {
    resist = tgtStats.armor || 0;
    if (resist > 0 && srcStats) {
      resist = resist * (1 - (srcStats.armorPenPct || 0)) - (srcStats.armorPenFlat || 0);
      if (resist < 0) resist = 0;
    }
  } else {
    resist = tgtStats.mr || 0;
    if (resist > 0 && srcStats) {
      resist = resist * (1 - (srcStats.magicPenPct || 0)) - (srcStats.magicPenFlat || 0);
      if (resist < 0) resist = 0;
    }
  }
  const mult = resist >= 0 ? 100 / (100 + resist) : 2 - 100 / (100 - resist);
  return amount * mult;
}

// Computes the effective stats of any unit from its base stats, items and buffs.
export function computeStats(unit) {
  const base = unit.baseStats;
  const mods = emptyMods();
  let slow = 0;
  if (unit.items) {
    for (const slot of unit.items) {
      if (!slot) continue;
      const def = ITEMS[slot.id];
      if (def && def.stats) addMods(mods, def.stats);
    }
  }
  for (const b of unit.buffs) {
    if (b.mods) addMods(mods, b.mods, b.modsPerStack ? b.stacks : 1);
    if (b.slow > slow) slow = b.slow;
  }
  const lvl = unit.level || 1;
  const s = {};
  s.maxHp = Math.max(1, (growth(base.hp, base.hpGrowth || 0, lvl) + mods.hp) * (1 + mods.hpPct));
  s.hpRegen = growth(base.hpRegen || 0, base.hpRegenGrowth || 0, lvl) + mods.hpRegen;
  s.maxMana = Math.max(0, growth(base.mana || 0, base.manaGrowth || 0, lvl) + mods.mana);
  s.manaRegen = growth(base.manaRegen || 0, base.manaRegenGrowth || 0, lvl) + mods.manaRegen;
  const baseAd = growth(base.ad || 0, base.adGrowth || 0, lvl);
  s.baseAd = baseAd;
  s.bonusAd = mods.ad + baseAd * mods.adPct;
  s.ad = Math.max(0, baseAd + s.bonusAd);
  s.ap = Math.max(0, mods.ap * (1 + mods.apPct));
  s.armor = (growth(base.armor || 0, base.armorGrowth || 0, lvl) + mods.armor) * (1 + mods.armorPct);
  s.mr = (growth(base.mr || 0, base.mrGrowth || 0, lvl) + mods.mr) * (1 + mods.mrPct);
  const asGrowth = (base.asGrowth || 0) * (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1));
  s.attackSpeed = Math.min(2.5, Math.max(0.2, (base.as || 0.625) * (1 + asGrowth + mods.as)));
  s.range = Math.max(0, (base.range || 125) + mods.range);
  s.slow = Math.min(0.9, slow);
  const ms = (base.ms + mods.msFlat) * (1 + mods.msPct) * (1 - s.slow);
  s.moveSpeed = unit.immobile ? 0 : Math.max(60, Math.min(900, ms));
  s.haste = mods.haste;
  s.lifesteal = mods.lifesteal;
  s.crit = Math.min(1, mods.crit);
  s.critDmg = 1.75 + mods.critDmg;
  s.armorPenFlat = mods.armorPenFlat;
  s.armorPenPct = Math.min(0.9, mods.armorPenPct);
  s.magicPenFlat = mods.magicPenFlat;
  s.magicPenPct = Math.min(0.9, mods.magicPenPct);
  s.healPower = mods.healPower;
  s.dmgReduction = Math.min(0.8, mods.dmgReduction);
  s.attackDmgReduction = Math.min(0.8, mods.attackDmgReduction);
  s.dmgAmp = mods.dmgAmp;
  return s;
}
