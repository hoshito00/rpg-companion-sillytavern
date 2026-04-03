/**
 * Light System Module  (Session 7)
 * Manages the Light resource: the currency spent to use Combat Skills.
 *
 * Light fully regenerates at the start of each Scene (round).
 * The default max is 3 but can be overridden per-encounter in the future.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const LIGHT_DEFAULT_MAX   = 3;
export const LIGHT_DEFAULT_REGEN = 3;  // full restore each scene

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh Light state object.
 * @param {number} [max=3]
 * @returns {{ current: number, max: number, regenPerScene: number }}
 */
export function initLight(max = LIGHT_DEFAULT_MAX) {
    return { current: max, max, regenPerScene: max };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the player has enough Light to afford a skill.
 * @param {{ current: number }} lightState
 * @param {number} cost
 * @returns {boolean}
 */
export function canAffordLight(lightState, cost) {
    return (lightState?.current ?? 0) >= cost;
}

/**
 * Spend Light for a skill.  Mutates lightState.
 * Returns false (and makes no change) if insufficient Light.
 * @param {{ current: number }} lightState
 * @param {number} cost
 * @returns {boolean}  true = success, false = insufficient
 */
export function spendLight(lightState, cost) {
    if (!canAffordLight(lightState, cost)) return false;
    lightState.current = Math.max(0, lightState.current - cost);
    return true;
}

/**
 * Restore Light to full at the start of a new Scene.  Mutates lightState.
 * @param {{ current: number, max: number, regenPerScene: number }} lightState
 */
export function regenLight(lightState) {
    lightState.current = lightState.max;
}

/**
 * Build the pip display string (filled/empty dots) for the HUD.
 * @param {{ current: number, max: number }} lightState
 * @returns {string}  e.g. "●●●○○" for 3/5
 */
export function lightPipsText(lightState) {
    const filled = Math.max(0, lightState.current);
    const empty  = Math.max(0, lightState.max - filled);
    return '●'.repeat(filled) + '○'.repeat(empty);
}
