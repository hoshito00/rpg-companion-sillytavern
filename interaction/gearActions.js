/**
 * Gear Actions Module  (Session 14)
 *
 * Add / remove / equip / unequip logic for the Gear tab.
 * Stat bonus resolution for buildPlayerSnap().
 * All functions mutate extensionSettings.statSheet.gear in-place
 * and call saveStatSheetData() to persist.
 */

import { extensionSettings } from '../../core/state.js';
import { saveStatSheetData }  from '../../core/persistence.js';
import { generateUniqueId }   from '../statSheet/statSheetState.js';

// ── Schema helpers ────────────────────────────────────────────────────────────

/**
 * Return the gear array, initialising it if missing.
 * @returns {object[]}
 */
function _gear() {
    const ss = extensionSettings.statSheet;
    if (!Array.isArray(ss.gear)) ss.gear = [];
    return ss.gear;
}

/**
 * Return a gear item by id, or null.
 * @param {string} id
 * @returns {object|null}
 */
export function getGearItemById(id) {
    return _gear().find(g => g.id === id) || null;
}

/**
 * Return all currently equipped gear items.
 * @returns {object[]}
 */
export function getEquippedGear() {
    return _gear().filter(g => g.equipped !== false);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Add a new blank gear item to the given slot.
 * Respects slot capacity — returns null if full.
 *
 * @param {string} slotId
 * @param {object} [overrides]  — optional field overrides (name, rarityTier, etc.)
 * @returns {object|null}  the new item, or null if slot is full
 */
export function addGearItem(slotId, overrides = {}) {
    const ss   = extensionSettings.statSheet;
    const slot = (ss.gearSlots || []).find(s => s.id === slotId);
    if (!slot) return null;

    const occupied = _gear().filter(g => g.slotId === slotId && g.equipped !== false).length;
    if (occupied >= (slot.capacity || 2)) return null;

    const item = {
        id:                  generateUniqueId(),
        slotId,
        name:                overrides.name            ?? 'New Item',
        linkedInventoryName: overrides.linkedInventoryName ?? null,
        equipped:            overrides.equipped         ?? true,
        rarityTier:          overrides.rarityTier       ?? 'common',
        shortDesc:           overrides.shortDesc        ?? '',
        notes:               overrides.notes            ?? '',
        statBonuses:         overrides.statBonuses      ?? [],
        combatSkillLinks:    overrides.combatSkillLinks ?? [],
        ...overrides
    };

    _gear().push(item);
    saveStatSheetData();
    return item;
}

/**
 * Remove a gear item by id.
 * @param {string} id
 * @returns {boolean}  true if removed
 */
export function removeGearItem(id) {
    const gear = _gear();
    const idx  = gear.findIndex(g => g.id === id);
    if (idx === -1) return false;
    gear.splice(idx, 1);
    saveStatSheetData();
    return true;
}

// ── Equip / Unequip ───────────────────────────────────────────────────────────

/**
 * Equip a gear item.
 * Checks slot capacity (counts currently equipped items in the same slot).
 *
 * @param {string} id
 * @returns {{ success: boolean, reason?: string }}
 */
export function equipGearItem(id) {
    const item = getGearItemById(id);
    if (!item) return { success: false, reason: 'Item not found' };
    if (item.equipped !== false) return { success: true }; // already equipped

    const ss   = extensionSettings.statSheet;
    const slot = (ss.gearSlots || []).find(s => s.id === item.slotId);
    const cap  = slot?.capacity ?? 2;
    const used = _gear().filter(g => g.slotId === item.slotId && g.equipped !== false).length;

    if (used >= cap) {
        return { success: false, reason: `Slot "${slot?.name || item.slotId}" is at capacity (${cap})` };
    }

    item.equipped = true;
    saveStatSheetData();
    return { success: true };
}

/**
 * Unequip a gear item.
 * @param {string} id
 * @returns {boolean}
 */
export function unequipGearItem(id) {
    const item = getGearItemById(id);
    if (!item) return false;
    item.equipped = false;
    saveStatSheetData();
    return true;
}

/**
 * Toggle equipped state.
 * @param {string} id
 * @returns {{ success: boolean, equipped: boolean, reason?: string }}
 */
export function toggleGearEquipped(id) {
    const item = getGearItemById(id);
    if (!item) return { success: false, equipped: false, reason: 'Item not found' };

    if (item.equipped !== false) {
        unequipGearItem(id);
        return { success: true, equipped: false };
    } else {
        const result = equipGearItem(id);
        return { success: result.success, equipped: result.success, reason: result.reason };
    }
}

// ── Stat Bonus Resolution ─────────────────────────────────────────────────────

/**
 * Resolve all active (equipped) gear stat bonuses into a flat lookup.
 * Returns an object keyed by targetId with cumulative bonus values.
 *
 * Used by buildPlayerSnap() in statSheetBridge.js to include gear
 * contributions without re-implementing the full bonus chain.
 *
 * @returns {{ [targetId: string]: number }}
 */
export function resolveEquippedGearBonuses() {
    const totals = {};
    for (const item of getEquippedGear()) {
        for (const sb of (item.statBonuses || [])) {
            if (!sb.targetId || sb.type === 'affinity') continue; // affinities handled separately
            totals[sb.targetId] = (totals[sb.targetId] || 0) + (sb.value || 0);
        }
    }
    return totals;
}

/**
 * Resolve affinity modifiers from equipped gear.
 * Returns the same shape as statSheet.affinities.modifiers so the caller
 * can merge them into the pre-computed modifier table.
 *
 * { Slash: { damage: number, stagger: number }, Blunt: {...}, Pierce: {...} }
 *
 * @returns {object}
 */
export function resolveEquippedGearAffinities() {
    const result = {
        Slash:  { damage: 0, stagger: 0 },
        Blunt:  { damage: 0, stagger: 0 },
        Pierce: { damage: 0, stagger: 0 },
    };
    for (const item of getEquippedGear()) {
        for (const sb of (item.statBonuses || [])) {
            if (sb.type !== 'affinity') continue;
            const [dmgType, pool] = (sb.targetId || '').split('.');
            if (result[dmgType] && pool) {
                result[dmgType][pool] = (result[dmgType][pool] || 0) + (sb.value || 0);
            }
        }
    }
    return result;
}

/**
 * Get a summary string of active gear for display or AI context.
 * Returns lines like:  "Iron Sword (Weapon) — ATK+5"
 *
 * @returns {string[]}
 */
export function getEquippedGearSummary() {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss.attributes || []).filter(a => a.enabled);
    const lines = [];

    for (const item of getEquippedGear()) {
        const slot     = (ss.gearSlots || []).find(s => s.id === item.slotId);
        const slotName = slot?.name || item.slotId;
        const bonuses  = (item.statBonuses || [])
            .filter(sb => sb.type !== 'affinity')
            .map(sb => {
                const attr  = attrs.find(a => a.id === sb.targetId);
                const label = attr?.name ?? sb.targetId;
                const sign  = (sb.value || 0) >= 0 ? '+' : '';
                return `${label}${sign}${sb.value}`;
            });
        const bonusStr = bonuses.length ? ` — ${bonuses.join(', ')}` : '';
        lines.push(`${item.name} (${slotName})${bonusStr}`);
    }

    return lines;
}
