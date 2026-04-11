/**
 * Stat Sheet Prompt Module  (Session 8 — revised)
 *
 * Serialises the stat sheet state into a compact, token-efficient text block.
 * Respects ss.promptIncludes — each section can be toggled independently.
 *
 * Exports:
 * buildStatSheetBlock(userName)           → <stat_sheet> block
 * buildEncounterStatSheetBlock(userName)  → same + live Sanity/Light/Act·Scene
 */

import { extensionSettings }                        from '../../core/state.js';
import { calculateSanityLevel, getSanityLevelInfo } from '../statSheet/sanitySystem.js';
import { lightPipsText }                            from '../statSheet/lightSystem.js';
import { getActSceneLabel }                         from '../statSheet/actSceneManager.js';
import { currentEncounter }                         from '../features/encounterState.js';

// ── Die / tag formatting ──────────────────────────────────────────────────────

/**
 * Resolve the numeric value of a die modifier given live stat-sheet data.
 * Returns null if the referenced attribute/skill cannot be found.
 */
function _resolveMod(mod, ss) {
    if (!mod || mod.type === 'flat') return mod?.flatValue ?? 0;

    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    if (mod.type === 'attribute') {
        const attr = (ss.attributes || []).find(a => a.id === mod.targetId && a.enabled);
        if (!attr) return null;
        const raw = ss.mode === 'numeric'
            ? (attr.value ?? 0)
            : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
        const applied = (mod.multiplier ?? 1) * raw;
        return mod.roundDown ? Math.floor(applied) : applied;
    }

    if (mod.type === 'skill') {
        for (const attr of (ss.attributes || [])) {
            if (!attr.enabled) continue;
            const sk = (attr.skills || []).find(s => s.id === mod.targetId && s.enabled);
            if (!sk) continue;
            // ── Bug fix S25 ───────────────────────────────────────────────────
            // Same divergence as statSheetBridge._resolveModValue: was missing
            // attrMod, so prompt showed skill-linked dice values without their
            // parent attribute contribution.
            const attrMod  = ss.mode === 'numeric'
                ? (attr.value ?? 0)
                : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
            const skillRaw = sk.mode === 'alphabetic'
                ? (gvm[sk.rank ?? 'C'] ?? 0) + Math.floor((sk.rankValue ?? 0) / divisor)
                : (sk.level ?? 0);
            const applied  = attrMod + (mod.multiplier ?? 1) * skillRaw;
            return mod.roundDown ? Math.floor(applied) : applied;
        }
        return null;
    }

    if (mod.type === 'saving_throw') {
        const st = (ss.savingThrows || []).find(s => s.id === mod.targetId && s.enabled);
        if (!st) return null;
        // Compute the saving throw total inline (mirrors calculateSavingThrowValue)
        let total = 0;
        for (const term of (st.terms || [])) {
            if (term.type === 'attribute') {
                const attr = (ss.attributes || []).find(a => a.id === term.attrId && a.enabled);
                if (attr) {
                    const av = ss.mode === 'numeric'
                        ? (attr.value || 0)
                        : (gvm[attr.rank] || 0) + Math.floor((attr.rankValue || 0) / divisor);
                    total += av * (term.multiplier || 1);
                }
            } else if (term.type === 'flat') {
                total += term.value || 0;
            }
        }
        const applied = (mod.multiplier ?? 1) * Math.round(total);
        return mod.roundDown ? Math.floor(applied) : applied;
    }

    return null;
}

/**
 * Format a die as a string for the prompt, resolving dynamic modifiers live.
 * e.g. "Slash 1d12+18"  or  "Blunt 1d8+8" (when STR=8, multiplier=1)
 */
function _die(die, ss) {
    const base = `${die.diceType} 1d${die.sides}`;
    const mod  = die.modifier;

    // Legacy path — no modifier object
    if (!mod) {
        const v = die.basePower ?? 0;
        return v ? `${base}+${v}` : base;
    }

    if (mod.type === 'flat') {
        const v = mod.flatValue ?? 0;
        return v ? `${base}+${v}` : base;
    }

    // Dynamic — resolve live value
    const resolved = _resolveMod(mod, ss);
    if (resolved == null) return base;
    const display  = Number.isInteger(resolved) ? resolved : parseFloat(resolved.toFixed(2));
    const sign     = display >= 0 ? '+' : '';
    return `${base}${sign}${display}`;
}

const _DIE_TAG_KEYS = {
    onHit: 'Hit', onClashWin: 'Win', onClashLose: 'Lose',
    onCrit: 'Crit', onCheck: 'Check', onEvade: 'Evade',
};
const _SKILL_TAG_KEYS = {
    onUse: 'On Use', afterUse: 'After Use', onKill: 'On Kill',
    onStagger: 'On Stagger', eminence: 'Eminence', limitUses: 'Limit',
    exhaust: 'Exhaust', proactive: 'Proactive', reactive: 'Reactive',
};

function _dieTags(die) {
    const parts = Object.entries(_DIE_TAG_KEYS)
        .filter(([k]) => die[k] != null && die[k] !== '')
        .map(([k, label]) => {
            const raw  = die[k];
            const text = typeof raw === 'object' ? (raw?.text ?? '') : String(raw);
            const rank = (raw && typeof raw === 'object' && raw.rank) ? `R${raw.rank}:` : '';
            return text ? `${label}: ${rank}${text}` : null;
        })
        .filter(Boolean);
    return parts.length ? `[${parts.join(', ')}]` : '';
}

function _skillTags(skill) {
    const parts = Object.entries(_SKILL_TAG_KEYS)
        .filter(([k]) => skill[k] != null && skill[k] !== '')
        .map(([k, label]) => {
            const raw  = skill[k];
            // limitUses is a plain number
            if (k === 'limitUses') return `${label}: ${typeof raw === 'number' ? raw : (raw?.text ?? '')}`;
            const text = typeof raw === 'object' ? (raw?.text ?? '') : String(raw);
            const rank = (raw && typeof raw === 'object' && raw.rank) ? `R${raw.rank}:` : '';
            return text ? `${label}: ${rank}${text}` : null;
        })
        .filter(Boolean);
    return parts.length ? `[${parts.join(', ')}]` : '';
}

// ── Section builders ──────────────────────────────────────────────────────────

function _levelLine(ss) {
    const lvl   = ss.level;
    const parts = [];
    if (lvl?.showLevel !== false) parts.push(`Level ${lvl?.current ?? 1}`);
    if (lvl?.showExp   !== false && (lvl?.exp ?? 0) > 0) parts.push(`EXP ${lvl.exp}`);
    return parts.join(' | ');
}

/**
 * Attributes section — mirrors the Kiba sheet style.
 *
 * Numeric mode (no sub-skills):
 * ATTRIBUTES: STR 18 | DEX 17 | INT 18   ← single inline row
 *
 * Numeric mode (with skills):
 * ATTRIBUTES:
 * STR 18
 * Athletics 12
 * Climbing 8
 *
 * Alphabetic mode — shows rank + rankValue on same token (STRENGTH B480):
 * STRENGTH B480
 * Athletics A
 * Judo A
 * Tai Chi S
 */
function _attributesSection(ss) {
    const mode   = ss.mode;
    const active = (ss.attributes || []).filter(a => a.enabled);
    if (!active.length) return null;

    /** Format a single attribute value token. */
    function _attrVal(attr) {
        if (mode === 'numeric') return String(attr.value ?? 0);
        // Alphabetic: show rank + rankValue together e.g. "B480"
        const rank = attr.rank ?? 'C';
        const rv   = attr.rankValue ?? 0;
        return rv > 0 ? `${rank}${rv}` : rank;
    }

    /** Format a single skill value token. */
    function _skillVal(skill) {
        if (skill.mode === 'alphabetic') {
            const rank = skill.rank ?? 'C';
            const rv   = skill.rankValue ?? 0;
            return rv > 0 ? `${rank}${rv}` : rank;
        }
        return String(skill.level ?? 0);
    }

    const hasAnySkills = active.some(a => (a.skills || []).some(s => s.enabled));

    // No skills at all → compact single line
    if (!hasAnySkills) {
        const inline = active.map(a => `${a.name} ${_attrVal(a)}`).join(' | ');
        return `ATTRIBUTES: ${inline}`;
    }

    const lines = [];
    for (const attr of active) {
        lines.push(`${attr.name} ${_attrVal(attr)}`);

        const enabledSkills = (attr.skills || []).filter(s => s.enabled);
        for (const skill of enabledSkills) {
            lines.push(`  ${skill.name} ${_skillVal(skill)}`);

            const subs = (skill.subSkills || []).filter(s => s.enabled);
            for (const sub of subs) {
                const sv = sub.mode === 'alphabetic'
                    ? (sub.rankValue > 0 ? `${sub.rank ?? 'C'}${sub.rankValue}` : (sub.rank ?? 'C'))
                    : String(sub.level ?? 0);
                lines.push(`    └ ${sub.name} ${sv}`);
            }
        }
    }
    return lines.join('\n');
}

/**
 * SAVES: Fortitude 8 | Reflex 9 | Will 7
 */
function _savesSection(ss) {
    const enabled = (ss.savingThrows || []).filter(st => st.enabled);
    if (!enabled.length) return null;

    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    const parts = enabled.map(st => {
        let total = 0;
        for (const term of (st.terms || [])) {
            if (term.type === 'attribute') {
                const attr = (ss.attributes || []).find(a => a.id === term.attrId && a.enabled);
                if (attr) {
                    const av = ss.mode === 'numeric'
                        ? (attr.value || 0)
                        : (gvm[attr.rank] || 0) + Math.floor((attr.rankValue || 0) / divisor);
                    total += av * (term.multiplier || 1);
                }
            } else if (term.type === 'flat') {
                total += term.value || 0;
            }
        }
        return `${st.name} ${Math.round(total)}`;
    });
    return `SAVES: ${parts.join(' | ')}`;
}

/**
 * JOBS: Magus Lv4 [combat]  |  Hunter Lv2
 * FEATS: Fleet (+5 Speed), Combat Climber
 */
function _jobsFeatsSection(ss) {
    const lines = [];
    const activeJobs = (ss.jobs || []).filter(j => j.enabled !== false);
    if (activeJobs.length) {
        const parts = activeJobs.map(j => {
            const trees   = j.treeTypes?.length ? ` [${j.treeTypes.join(', ')}]` : '';
            const unspent = j.unspentPoints > 0  ? ` (${j.unspentPoints} pts)` : '';
            return `${j.name} Lv${j.level ?? 0}${trees}${unspent}`;
        });
        lines.push(`JOBS: ${parts.join('  |  ')}`);
    }
    const activeFeats = (ss.feats || []).filter(f => f.enabled !== false);
    if (activeFeats.length) {
        const parts = activeFeats.map(f => {
            const desc = f.description ? ` (${f.description})` : '';
            return `${f.name}${desc}`;
        });
        lines.push(`FEATS: ${parts.join(', ')}`);
    }
    return lines.length ? lines.join('\n') : null;
}

/**
 * DECK (3/9):
 * 1. Lash (0L) — Blunt 1d12+6, Pierce 1d4+1
 * 2. Sever (1L) — Slash 1d8+3 [Hit: Bleed 2]
 * EGO:
 * ZAYIN Pale Tide (5 SP) — Blunt 1d20+8
 */
function _combatSkillsSection(ss) {
    const deck = (ss.combatSkills || []).filter(s => s.equipped && !s.isEGO);
    const ego  = (ss.combatSkills || []).filter(s => s.equipped &&  s.isEGO);
    if (!deck.length && !ego.length) return null;

    const lines = [];

    if (deck.length) {
        lines.push(`DECK (${deck.length}/${ss.maxEquippedPages ?? 9}):`);
        deck.forEach((skill, i) => {
            const costStr = skill.cost > 0 ? ` (${skill.cost}L)` : '';
            let row = `  ${i + 1}. ${skill.name}${costStr}`;
            if (skill.dice?.length) {
                const diceStr = skill.dice.map(d => {
                    const t = _dieTags(d);
                    return t ? `${_die(d, ss)} ${t}` : _die(d, ss);
                }).join(', ');
                row += ` — ${diceStr}`;
            }
            const st = _skillTags(skill);
            if (st) row += ` ${st}`;
            if (skill.notes?.trim()) row += ` | ${skill.notes.trim()}`;
            lines.push(row);
        });
    }

    if (ego.length) {
        lines.push(`EGO:`);
        ego.forEach(skill => {
            const sp  = skill.egoSanityCost ? ` (${skill.egoSanityCost} SP)` : '';
            let row = `  ${skill.egoTier} ${skill.name}${sp}`;
            if (skill.dice?.length) {
                const diceStr = skill.dice.map(d => {
                    const t = _dieTags(d);
                    return t ? `${_die(d, ss)} ${t}` : _die(d, ss);
                }).join(', ');
                row += ` — ${diceStr}`;
            }
            const st = _skillTags(skill);
            if (st) row += ` ${st}`;
            lines.push(row);
        });
    }

    return lines.length ? lines.join('\n') : null; // <-- FIXED: Added missing return statement
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the full stat sheet prompt block.
 * Returns '' when the stat sheet is disabled.
 *
 * @param {string} userName
 * @returns {string}
 */
export function buildStatSheetBlock(userName) {
    const ss = extensionSettings.statSheet;
    if (!ss?.enabled) return '';

    const inc          = ss.promptIncludes ?? {};
    const showAttrs    = inc.attributes    !== false;
    const showSaves    = inc.savingThrows  !== false;
    const showJF       = inc.jobsFeats     !== false;
    const showCombat   = inc.combatSkills  !== false;
    const showAugments = inc.augments      === true;   // off by default

    const sections = [];
    const hdr = _levelLine(ss);
    sections.push(`${userName}'s Character Sheet${hdr ? ` — ${hdr}` : ''}`);

    if (showAttrs)  { const s = _attributesSection(ss); if (s) sections.push(s); }
    if (showSaves)  { const s = _savesSection(ss);       if (s) sections.push(s); }
    if (showJF)     { const s = _jobsFeatsSection(ss);   if (s) sections.push(s); }
    if (showCombat) { const s = _combatSkillsSection(ss);if (s) sections.push(s); }

    if (showAugments && (ss.augments || []).length) {
        const augLines = ss.augments
            .filter(a => a.bodyPart)
            .map(a => `  ${a.bodyPart}: ${a.name}${a.effects ? ` — ${a.effects}` : ''}`);
        if (augLines.length) sections.push(`AUGMENTS:\n${augLines.join('\n')}`);
    }

    return `<stat_sheet>\n${sections.join('\n')}\n</stat_sheet>`;
}

/**
 * Build the stat sheet block with live encounter state appended.
 * Falls back to the plain block when no encounter is active.
 *
 * @param {string} userName
 * @returns {string}
 */
export function buildEncounterStatSheetBlock(userName) {
    const base = buildStatSheetBlock(userName);
    if (!base || !currentEncounter?.active) return base;

    const sanity  = currentEncounter.sanity ?? 0;
    const lvlNum  = calculateSanityLevel(sanity);
    const lvlInfo = getSanityLevelInfo(lvlNum);
    const light   = currentEncounter.light;
    const as      = currentEncounter.actScene;

    const encParts = [];
    if (light) encParts.push(`Light ${lightPipsText(light)} (${light.current}/${light.max})`);

    // Morale
    const morale     = currentEncounter.morale ?? 0;
    const moraleSign = morale >= 0 ? '+' : '';
    // Derive tier label inline (mirrors getMoraleTier from clashEngine — no import needed here)
    const moraleTier = morale >= 75 ? 5 : morale >= 60 ? 4 : morale >= 45 ? 3 :
                       morale >= 30 ? 2 : morale >= 15 ? 1 : morale > -15 ? 0 :
                       morale > -30 ? -1 : morale > -45 ? -2 : -3;
    const tierSign   = moraleTier >= 0 ? '+' : '';
    encParts.push(`Morale ${moraleSign}${morale} (Tier ${tierSign}${moraleTier})`);

    // Sanity (E.G.O corrosion state)
    const sign    = sanity >= 0 ? '+' : '';
    const lvlSign = lvlNum >= 0 ? '+' : '';
    encParts.push(`Sanity ${sign}${sanity} ${lvlInfo?.name ?? ''} Lv${lvlSign}${lvlNum}`);
    if (sanity <= -45) encParts.push('EGO CORROSION ACTIVE');
    if (as) encParts.push(getActSceneLabel(as));

    return base.replace('</stat_sheet>', `ENCOUNTER: ${encParts.join(' | ')}\n</stat_sheet>`);
}
