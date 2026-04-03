/**
 * Sanity System Module  (Session 7)
 * Tracks Sanity Points, Sanity Level, and E.G.O Corrosion.
 *
 * Sanity range : −45  (floor / corrosion trigger)  to  +75  (ceiling)
 * Level range  : −3  (Panicked)  to  +5  (Ecstatic)
 * Points per level : 15
 */

// ── Lookup table ─────────────────────────────────────────────────────────────

export const SANITY_LEVELS = [
    { level:  5, min:  75, max:  Infinity, name: 'Ecstatic',  color: '#ffd700' },
    { level:  4, min:  60, max:  74,       name: 'Joyful',    color: '#4ade80' },
    { level:  3, min:  45, max:  59,       name: 'Happy',     color: '#4ade80' },
    { level:  2, min:  30, max:  44,       name: 'Content',   color: '#60a5fa' },
    { level:  1, min:  15, max:  29,       name: 'Pleased',   color: '#60a5fa' },
    { level:  0, min:   0, max:  14,       name: 'Neutral',   color: '#9da5b0' },
    { level: -1, min: -15, max:  -1,       name: 'Uneasy',    color: '#fb923c' },
    { level: -2, min: -30, max: -16,       name: 'Anxious',   color: '#f87171' },
    { level: -3, min: -45, max: -31,       name: 'Panicked',  color: '#e94560' },
];

// ── Constants ─────────────────────────────────────────────────────────────────

export const SANITY_MIN = -45;
export const SANITY_MAX = 75;

/** Sanity change on clash win (player action succeeds) */
export const SANITY_CLASH_WIN  =  3;
/** Sanity change on clash loss (player takes damage) */
export const SANITY_CLASH_LOSE = -3;
/** Sanity change on killing an enemy */
export const SANITY_KILL       = 12;

/** Sanity costs for using each E.G.O tier */
export const EGO_SANITY_COSTS = {
    ZAYIN:  5,
    TETH:  10,
    HE:    20,
    WAW:   25,
    ALEPH: 30,
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Clamp a sanity value to the valid range.
 * @param {number} value
 * @returns {number}
 */
export function clampSanity(value) {
    return Math.max(SANITY_MIN, Math.min(SANITY_MAX, value));
}

/**
 * Calculate the Sanity Level (−3 to +5) from raw sanity points.
 * @param {number} sanity  Raw sanity value.
 * @returns {number}       Sanity Level integer.
 */
export function calculateSanityLevel(sanity) {
    const s = clampSanity(sanity);
    for (const entry of SANITY_LEVELS) {
        if (s >= entry.min && s <= entry.max) return entry.level;
    }
    return 0;
}

/**
 * Get the full info object for a given Sanity Level.
 * @param {number} level  Sanity Level (−3 to +5).
 * @returns {{ level, min, max, name, color }}
 */
export function getSanityLevelInfo(level) {
    return SANITY_LEVELS.find(e => e.level === level)
        ?? SANITY_LEVELS.find(e => e.level === 0);
}

/**
 * Build a short display string like "+12 (Pleased Lv+1)".
 * @param {number} sanity
 * @returns {string}
 */
export function sanityDisplayText(sanity) {
    const lvl  = calculateSanityLevel(sanity);
    const info = getSanityLevelInfo(lvl);
    const sign = sanity >= 0 ? '+' : '';
    return `${sign}${sanity}  ${info.name} Lv${lvl >= 0 ? '+' : ''}${lvl}`;
}
