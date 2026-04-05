/**
 * parseStatTags.js — SotC Stat Mutation Tag Parser
 *
 * Parses stat-mutation tags emitted by the AI in any message.
 * Zero side effects — callers are responsible for applying results.
 *
 * ── Tag formats ───────────────────────────────────────────────────────────────
 *
 * attr_advance  (self-closing)
 *   id  — the target attribute's ID string (e.g. "str", "per")
 *          Must match extensionSettings.statSheet.attributes[n].id exactly.
 *          Only processed in alphabetic mode; silently skipped in numeric.
 *
 * Example:
 *   <attr_advance id="str"/>
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { parseStatTags } from './parseStatTags.js';
 *
 *   const { attrAdvances, hasTags } = parseStatTags(rawAiResponse);
 *   for (const { attrId } of attrAdvances) {
 *       const result = advanceAttributeGrade(attrId);
 *       if (!result.success) console.warn('[StatTags]', result.reason);
 *   }
 */

// ── Types (JSDoc only) ────────────────────────────────────────────────────────

/**
 * @typedef {object} ParsedAttrAdvance
 * @property {string} attrId  — target attribute ID
 * @property {string} raw     — original tag text (for debugging)
 */

/**
 * @typedef {object} StatTagResult
 * @property {ParsedAttrAdvance[]} attrAdvances — all parsed <attr_advance /> tags
 * @property {boolean}             hasTags       — true if at least one tag found
 */

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse all SotC stat mutation tags from a raw AI response string.
 *
 * Strips <think>/<thinking> blocks before scanning.
 * Does NOT mutate any state.
 *
 * @param {string} rawResponse
 * @returns {StatTagResult}
 */

export function parseStatTags(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') {
        return { attrAdvances: [], hasTags: false };
    }

    // Strip thinking blocks (mirrors parseCombatTags.js behaviour)
    const cleaned = rawResponse
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    const attrAdvances = [];

    // Match <attr_advance id="attrId"/> or <attr_advance id='attrId'/>
    const re = /<attr_advance\s+id=["']([^"']+)["']\s*\/>/gi;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
        const attrId = m[1].trim();
        if (attrId) {
            attrAdvances.push({ attrId, raw: m[0] });
        }
    }

    return {
        attrAdvances,
        hasTags: attrAdvances.length > 0,
    };
}

/**
 * Quick check: does a response string contain any stat mutation tags?
 *
 * @param {string} text
 * @returns {boolean}
 */
export function responseHasStatTags(text) {
    return /<attr_advance\s/i.test(text);
}
