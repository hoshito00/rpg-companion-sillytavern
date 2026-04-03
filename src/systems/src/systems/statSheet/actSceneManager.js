/**
 * Act / Scene Manager  (Session 12 rev)
 * Tracks the current round of combat as a simple Scene counter.
 *
 * A Scene = one round of combat.
 * There is no Act grouping and no Scene cap — the counter increments freely
 * until the encounter ends.
 */

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh Scene state object.
 * @returns {{ scene: number }}
 */
export function initActScene() {
    return { scene: 1 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Advance to the next Scene. No cap, no Act rollover.
 * Mutates the actScene state stored in currentEncounter.
 * @param {{ scene: number }} actSceneState
 */
export function advanceScene(actSceneState) {
    actSceneState.scene += 1;
}

/**
 * Build the compact HUD label, e.g. "Round 4".
 * @param {{ scene: number }} actSceneState
 * @returns {string}
 */
export function getActSceneLabel(actSceneState) {
    return `Round ${actSceneState.scene}`;
}

/**
 * Legacy no-op — Act end concept removed.
 * Kept so any stray callers don't throw.
 * @returns {boolean}
 */
export function isActEnd(_actSceneState) {
    return false;
}
