/**
 * parseCombatTags.js — SotC Combat Tag Parser  (Rev 4 spec)
 *
 * Parses machine-readable combat tags emitted by the AI at the end of each
 * round response.  Does NOT mutate any shared state — callers feed results
 * to encounterState helpers.
 *
 * ── Tag formats (Rev 4) ───────────────────────────────────────────────────────
 *
 * enemy_action  (self-closing, one tag per die)
 *   skill      — display name of the enemy skill
 *   die_index  — position within the skill, starting at 1
 *   dice       — NdS+B roll notation: "1d10+2" | "2d12+0" | "1d8-1"
 *   type       — Slash | Pierce | Blunt | Block | Evade
 *   speed      — NdS+B for die_index=1 (e.g. "1d6+1"); literal "0" for all others
 *   target     — always "player" in v1
 *
 * enemy_init  (self-closing, one tag per enemy on first appearance)
 *   name           — must match combatStats enemy name exactly
 *   hp             — current HP
 *   stagger        — stagger resist pool
 *   aff_slash_dmg  — slash damage affinity (negative=resist, positive=weak, 0=neutral)
 *   aff_slash_stg  — slash stagger affinity
 *   aff_blunt_dmg  — blunt damage affinity
 *   aff_blunt_stg  — blunt stagger affinity
 *   aff_pierce_dmg — pierce damage affinity
 *   aff_pierce_stg — pierce stagger affinity
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { parseCombatTags, initToUpsertArgs } from './parseCombatTags.js';
 *
 *   const { enemyInits, enemyActions, tagBlock, errors } =
 *       parseCombatTags(rawAiResponse);
 *
 *   if (errors.length) console.warn('[Combat Parser]', errors);
 *
 *   for (const init of enemyInits) {
 *       upsertCombatant(init.name, initToUpsertArgs(init));
 *   }
 *
 *   // enemy_action tags carry no enemy name (Rev 4 design — engine matches by
 *   // skill name within the current round context).  Associate with enemies via
 *   // groupEnemyActions() or your own round-state logic before queuing.
 *   for (const act of enemyActions) {
 *       queueEnemyDie(resolvedEnemyName, act.skill, act.dice);
 *   }
 */

// ── Types (JSDoc only — zero runtime overhead) ────────────────────────────────

/**
 * Parsed dice notation from an NdS+B string.
 * @typedef {object} DiceSpec
 * @property {number} count    — number of dice (N)
 * @property {number} sides    — die size (S)
 * @property {number} modifier — flat bonus/penalty (B, may be negative)
 */

/**
 * @typedef {object} ParsedEnemyInit
 * @property {string} name
 * @property {number} hp
 * @property {number} stagger     — stagger resist pool (Rev 4: single value; maxStagger = hp at init time)
 * @property {{ Slash: AffinityPair, Blunt: AffinityPair, Pierce: AffinityPair }} affinities
 * @property {string} raw         — original tag text (for debugging)
 */

/**
 * @typedef {{ damage: number, stagger: number }} AffinityPair
 */

/**
 * @typedef {object} ParsedEnemyAction
 * @property {string}        skill      — enemy skill display name
 * @property {number}        dieIndex   — 1-based position within this skill
 * @property {DiceSpec}      dice       — parsed roll notation
 * @property {string}        type       — Slash | Pierce | Blunt | Block | Evade
 * @property {DiceSpec|null} speed      — parsed speed notation; null when die_index > 1 or speed="0"
 * @property {string}        target     — always "player" in v1
 * @property {string}        raw        — original tag text
 */

/**
 * @typedef {object} CombatTagResult
 * @property {ParsedEnemyInit[]}   enemyInits    — parsed <enemy_init /> blocks
 * @property {ParsedEnemyAction[]} enemyActions  — parsed <enemy_action /> tags
 * @property {string}              tagBlock      — raw text from first tag onwards
 * @property {string[]}            errors        — non-fatal parse warnings
 * @property {boolean}             hasTags       — true if any tags were found
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['Slash', 'Pierce', 'Blunt', 'Block', 'Evade']);

/** Affinity attribute map: attr suffix → { type, pool } */
const AFF_ATTRS = {
    aff_slash_dmg:  { type: 'Slash',  pool: 'damage'  },
    aff_slash_stg:  { type: 'Slash',  pool: 'stagger' },
    aff_blunt_dmg:  { type: 'Blunt',  pool: 'damage'  },
    aff_blunt_stg:  { type: 'Blunt',  pool: 'stagger' },
    aff_pierce_dmg: { type: 'Pierce', pool: 'damage'  },
    aff_pierce_stg: { type: 'Pierce', pool: 'stagger' },
};

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Parse an XML-like attribute string into a key → value map.
 * Handles single and double quotes.
 *
 * @param {string} attrString
 * @returns {Object.<string, string>}
 */
function parseAttributes(attrString) {
    const result = {};
    const re = /(\w[\w-]*)=["']([^"']*)["']/g;
    let m;
    while ((m = re.exec(attrString)) !== null) {
        result[m[1]] = m[2];
    }
    return result;
}

/**
 * Parse a plain unsigned integer string.
 * @param {string|undefined} s
 * @returns {number}  NaN on failure
 */
function parseIntAttr(s) {
    if (s === undefined || s === null) return NaN;
    return parseInt(s, 10);
}

/**
 * Parse a signed integer string ("+2", "-1", "0") → number.
 * @param {string|undefined} s
 * @returns {number}  NaN on failure
 */
function parseSignedInt(s) {
    if (s === undefined || s === null) return NaN;
    return parseInt(s.replace(/^\+/, ''), 10);
}

/**
 * Parse an NdS+B dice notation string into a DiceSpec.
 * Accepts "1d10+2", "2d12-1", "1d8+0", "1d6".
 * Returns null for the literal string "0" (used by speed on secondary dice).
 *
 * @param {string|undefined} s
 * @returns {DiceSpec|null}  null if the value is "0" or absent; undefined-like on bad format
 */
function parseDiceNotation(s) {
    if (!s) return null;
    const trimmed = s.trim();
    if (trimmed === '0') return null;

    // Match NdS, NdS+B, NdS-B
    const m = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(trimmed);
    if (!m) return null;

    return {
        count:    parseInt(m[1], 10),
        sides:    parseInt(m[2], 10),
        modifier: m[3] ? parseInt(m[3], 10) : 0,
    };
}

// ── enemy_action parser ───────────────────────────────────────────────────────

/**
 * Extract all <enemy_action .../> self-closing tags from a string.
 *
 * Rev 4 note: tags carry NO enemy name.  The engine associates actions with
 * enemies by skill name within the current round context.
 *
 * @param {string}   text
 * @param {string[]} errors — mutable; warnings pushed here
 * @returns {ParsedEnemyAction[]}
 */
function parseEnemyActions(text, errors) {
    const results = [];
    const re = /<enemy_action\s([^>]*?)\/>/gs;
    let m;

    while ((m = re.exec(text)) !== null) {
        const raw   = m[0];
        const attrs = parseAttributes(m[1]);

        const skill    = attrs.skill?.trim();
        const dieIndex = parseIntAttr(attrs.die_index);
        const type     = attrs.type?.trim();
        const target   = attrs.target?.trim() || 'player';

        // ── dice ─────────────────────────────────────────────────────────────
        const dice = parseDiceNotation(attrs.dice);

        // ── speed — required only for die_index 1, must be "0" for others ───
        const speed = parseDiceNotation(attrs.speed);
        // "0" or absent on secondary dice is valid; non-"0" on secondary is a
        // soft warning but not a discard (AI may be imprecise).

        // ── Validation ────────────────────────────────────────────────────────
        if (!skill) {
            errors.push(`enemy_action missing 'skill': ${raw}`);
            continue;
        }
        if (isNaN(dieIndex) || dieIndex < 1) {
            errors.push(`enemy_action skill="${skill}" has invalid die_index "${attrs.die_index}": ${raw}`);
            continue;
        }
        if (!VALID_TYPES.has(type)) {
            errors.push(`enemy_action skill="${skill}" has invalid type "${type}": ${raw}`);
            continue;
        }
        if (!dice) {
            errors.push(`enemy_action skill="${skill}" has unparseable dice "${attrs.dice}": ${raw}`);
            continue;
        }
        if (dieIndex === 1 && attrs.speed === undefined) {
            errors.push(`enemy_action skill="${skill}" die_index=1 is missing 'speed' — defaulting to null`);
        }
        if (dieIndex > 1 && attrs.speed && attrs.speed.trim() !== '0') {
            errors.push(`enemy_action skill="${skill}" die_index=${dieIndex} has non-zero speed "${attrs.speed}" — expected "0"`);
        }

        results.push({ skill, dieIndex, dice, type, speed, target, raw });
    }

    return results;
}

// ── enemy_init parser ─────────────────────────────────────────────────────────

/**
 * Extract all <enemy_init .../> self-closing tags from a string.
 *
 * Rev 4: flat attributes only — no child tags.  Six aff_* attributes required.
 * maxHp and maxStaggerResist are not in the tag; callers should initialise
 * both to the values here on first appearance (see initToUpsertArgs).
 *
 * @param {string}   text
 * @param {string[]} errors
 * @returns {ParsedEnemyInit[]}
 */
function parseEnemyInits(text, errors) {
    const results = [];

    // Self-closing only in Rev 4
    const re = /<enemy_init\s([^>]*?)\/>/gs;
    let m;

    while ((m = re.exec(text)) !== null) {
        const raw   = m[0];
        const attrs = parseAttributes(m[1]);

        const name    = attrs.name?.trim();
        const hp      = parseIntAttr(attrs.hp);
        const stagger = parseIntAttr(attrs.stagger);

        // ── Validate core ─────────────────────────────────────────────────────
        if (!name) {
            errors.push(`enemy_init missing 'name': ${raw.substring(0, 80)}…`);
            continue;
        }
        if (isNaN(hp)) {
            errors.push(`enemy_init "${name}" has invalid hp "${attrs.hp}"`);
            continue;
        }
        if (isNaN(stagger)) {
            errors.push(`enemy_init "${name}" has invalid stagger "${attrs.stagger}" — defaulting to 20`);
        }

        // ── Parse affinities from flat aff_* attributes ───────────────────────
        const affinities = {
            Slash:  { damage: 0, stagger: 0 },
            Blunt:  { damage: 0, stagger: 0 },
            Pierce: { damage: 0, stagger: 0 },
        };

        for (const [attr, { type, pool }] of Object.entries(AFF_ATTRS)) {
            if (attrs[attr] !== undefined) {
                const val = parseSignedInt(attrs[attr]);
                if (isNaN(val)) {
                    errors.push(`enemy_init "${name}" has non-numeric ${attr} "${attrs[attr]}" — defaulting to 0`);
                } else {
                    affinities[type][pool] = val;
                }
            } else {
                // All six are required; warn but don't discard
                errors.push(`enemy_init "${name}" missing required attribute "${attr}" — defaulting to 0`);
            }
        }

        results.push({
            name,
            hp,
            stagger: isNaN(stagger) ? 20 : stagger,
            affinities,
            raw,
        });
    }

    return results;
}

// ── Tag block extractor ───────────────────────────────────────────────────────

/**
 * Return the portion of the response that starts at the first combat tag.
 * Useful for stripping the machine-readable section from the display text.
 *
 * @param {string} text
 * @returns {string}
 */
function extractTagBlock(text) {
    const positions = [
        text.indexOf('<enemy_action'),
        text.indexOf('<enemy_init'),
    ].filter(p => p !== -1);

    if (positions.length === 0) return '';
    return text.slice(Math.min(...positions));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse all SotC Rev 4 combat tags from a raw AI response string.
 *
 * Strips <think>/<thinking> blocks before scanning.
 * Does NOT mutate any state.
 *
 * @param {string} rawResponse
 * @returns {CombatTagResult}
 */
export function parseCombatTags(rawResponse) {
    const errors = [];

    if (!rawResponse || typeof rawResponse !== 'string') {
        return {
            enemyInits:   [],
            enemyActions: [],
            tagBlock:     '',
            errors:       ['empty or non-string response'],
            hasTags:      false,
        };
    }

    // Strip thinking blocks (mirrors parser.js behaviour)
    const cleaned = rawResponse
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    const tagBlock    = extractTagBlock(cleaned);
    const enemyInits  = parseEnemyInits(cleaned, errors);
    const enemyActions = parseEnemyActions(cleaned, errors);

    return {
        enemyInits,
        enemyActions,
        tagBlock,
        errors,
        hasTags: enemyInits.length > 0 || enemyActions.length > 0,
    };
}

// ── encounterState adapter ────────────────────────────────────────────────────

/**
 * Convert a ParsedEnemyInit into the argument shape expected by
 * encounterState.upsertCombatant().
 *
 * Rev 4 provides a single `stagger` value; upsertCombatant expects both
 * staggerResist and maxStaggerResist.  On first appearance these are equal.
 * Similarly, maxHp is inferred from hp.
 *
 * @param {ParsedEnemyInit} init
 * @returns {object}  safe to spread into upsertCombatant(init.name, …)
 */
export function initToUpsertArgs(init) {
    return {
        hp:               init.hp,
        maxHp:            init.hp,          // no maxHp in Rev 4 tag; infer at init time
        staggerResist:    init.stagger,
        maxStaggerResist: init.stagger,     // ditto
        affinities:       init.affinities,  // already { Slash/Blunt/Pierce: { damage, stagger } }
    };
}

// ── Group / format helpers ────────────────────────────────────────────────────

/**
 * Group parsed enemy actions by skill name → array of ParsedEnemyAction,
 * sorted by dieIndex.
 *
 * Rev 4: actions carry no enemy name.  This grouping is useful for building
 * a per-skill view before associating with a specific enemy.
 *
 * @param {ParsedEnemyAction[]} actions
 * @returns {{ [skillName: string]: ParsedEnemyAction[] }}
 */
export function groupEnemyActions(actions) {
    const grouped = {};
    for (const act of actions) {
        if (!grouped[act.skill]) grouped[act.skill] = [];
        grouped[act.skill].push(act);
    }
    // Ensure dice within each skill are sorted by dieIndex
    for (const skill of Object.keys(grouped)) {
        grouped[skill].sort((a, b) => a.dieIndex - b.dieIndex);
    }
    return grouped;
}

/**
 * Format a dice spec as a human-readable string: "1d10+2 (Blunt)".
 *
 * @param {DiceSpec} dice
 * @param {string}   type
 * @returns {string}
 */
function _formatDice(dice, type) {
    const mod = dice.modifier === 0 ? '+0'
              : dice.modifier  > 0 ? `+${dice.modifier}`
              : `${dice.modifier}`;
    return `${dice.count}d${dice.sides}${mod} (${type})`;
}

/**
 * Format grouped actions as one human-readable line per skill.
 * Example: "Stone Fist: 1d10+2 (Blunt)"
 *
 * @param {{ [skillName: string]: ParsedEnemyAction[] }} grouped
 * @returns {string[]}
 */
export function formatGroupedActionsForLog(grouped) {
    const lines = [];
    for (const [skillName, acts] of Object.entries(grouped)) {
        const diceStr = acts.map(a => _formatDice(a.dice, a.type)).join(' + ');
        lines.push(`${skillName}: ${diceStr}`);
    }
    return lines;
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Quick check: does a response string contain at least one combat tag?
 *
 * @param {string} text
 * @returns {boolean}
 */
export function responseHasCombatTags(text) {
    return /<enemy_action\s/i.test(text) || /<enemy_init\s/i.test(text);
}

// ── Error class ───────────────────────────────────────────────────────────────

/**
 * Thrown by callers (not this module) when a response has no tags
 * and combat cannot proceed without them.
 */
export class CombatTagParseError extends Error {
    constructor(message, rawResponse = '') {
        super(message);
        this.name         = 'CombatTagParseError';
        this.rawResponse  = rawResponse;
    }
}
