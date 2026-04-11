/**
 * Stat Sheet State Module  (v3)
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveStatSheetData } from '../../core/persistence.js';
import { resolveEquippedGearAffinities, resolveEquippedGearBonuses } from '../interaction/gearActions.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** All valid ranks in ascending order. */
export const RANKS = [
    'FFF', 'FF', 'F',
    'E',   'EE', 'EEE',
    'D',   'DD', 'DDD',
    'C',   'CC', 'CCC',
    'B',   'BB', 'BBB',
    'A',   'AA', 'AAA',
    'S',   'SS', 'SSS',
    'EX'
];

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize or migrate the stat sheet on extension startup.
 */
export function initializeStatSheet() {
    console.log('[StatSheet] Initializing...');
    if (!extensionSettings.statSheet) {
        extensionSettings.statSheet = _createDefaultStatSheet();
        saveSettings();
    } else {
        _migrate();
    }
    console.log('[StatSheet] Ready.');
}

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Safe, idempotent migration from any previous version to the current schema.
 * Each branch is guarded — safe to run on every load.
 */
function _migrate() {
    const ss = extensionSettings.statSheet;
    let dirty = false;

    // ── Display mode ──────────────────────────────────────────────────────────
    // attributeDisplayMode is the old authoritative field — always wins on import
    if (ss.attributeDisplayMode) {
        ss.mode = ss.attributeDisplayMode;
        delete ss.attributeDisplayMode;
        dirty = true;
    }
    if (!ss.mode) { ss.mode = 'numeric'; dirty = true; }

    // ── Editor settings ───────────────────────────────────────────────────────
    if (!ss.editorSettings) {
        ss.editorSettings = _defaultEditorSettings();
        dirty = true;
    } else {
        const es     = ss.editorSettings;
        const defs   = _defaultEditorSettings();
        // Add any fields that were introduced after v1
        const fields = [
            'expCostNormalMultiplier',
            'expCostExpensiveMultiplier',
            'attrValueDivisor',
            'gradeValueMap',
            'gradeDiceMap',
            'useSkillExpCostTable',
            'skillExpCostTable',
            'useJobExpCostTable',
            'jobExpCostTable'
        ];
        for (const f of fields) {
            if (es[f] == null) { es[f] = defs[f]; dirty = true; }
        }
    }

    // ── Level ─────────────────────────────────────────────────────────────────
    if (typeof ss.level === 'number') {
        const old = ss.level;
        ss.level  = { ..._defaultLevel(), current: old, exp: ss.exp || 0, showLevel: ss.showLevel !== false };
        dirty = true;
    }
    if (!ss.level || typeof ss.level !== 'object') { ss.level = _defaultLevel(); dirty = true; }

    // ── Saving throws: migrate old sources[] / flatModifier to terms[] ────────
    if (!ss.savingThrows) {
        ss.savingThrows = _defaultSavingThrows();
        dirty = true;
    } else {
        for (const st of ss.savingThrows) {
            if (Array.isArray(st.terms)) continue;
            st.terms = [];
            for (const src of (st.sources || [])) {
                const mult = (parseFloat(src.multiplier) || 1) / (parseFloat(src.divisor) || 1);
                st.terms.push({ id: generateUniqueId(), type: 'attribute', attrId: src.attrId, multiplier: mult });
                if (src.bonus) st.terms.push({ id: generateUniqueId(), type: 'flat', value: src.bonus, label: `${src.attrId} bonus` });
            }
            if (st.flatModifier) st.terms.push({ id: generateUniqueId(), type: 'flat', value: st.flatModifier, label: 'Flat Bonus' });
            for (const k of ['sources', 'flatModifier', 'value', 'rank', 'rankValue', 'customValue']) delete st[k];
            dirty = true;
        }
    }

    // ── Attributes / skills ───────────────────────────────────────────────────
    if (!ss.attributes) {
        ss.attributes = [];
        dirty = true;
    } else {
        for (const attr of ss.attributes) {
            if (!attr.hasOwnProperty('threshold')) { attr.threshold = 0;     dirty = true; }
            if (!attr.hasOwnProperty('collapsed'))  { attr.collapsed = false; dirty = true; }
            if (attr.hasOwnProperty('customValue')) { delete attr.customValue; dirty = true; }
            for (const skill of (attr.skills || [])) {
                if (!Array.isArray(skill.subSkills)) { skill.subSkills = []; dirty = true; }
                if (!skill.expCost)                  { skill.expCost = 'normal'; dirty = true; }
            }
        }
    }

    // ── Collections ───────────────────────────────────────────────────────────
    for (const key of ['jobs', 'feats', 'augments']) {
        if (!ss[key]) { ss[key] = []; dirty = true; }
    }

    // combatPages → combatSkills rename
    if (ss.combatPages && !ss.combatSkills) { ss.combatSkills = ss.combatPages; delete ss.combatPages; dirty = true; }
    if (!ss.combatSkills) { ss.combatSkills = []; dirty = true; }

    // ── Affinities ────────────────────────────────────────────────────────────
    if (!ss.affinities) {
        ss.affinities = _defaultAffinities();
        dirty = true;
    } else {
        // Backfill fields added after initial shipping
        if (ss.affinities.enabled === undefined)    { ss.affinities.enabled    = false; dirty = true; }
        if (ss.affinities.slotAttrId === undefined) { ss.affinities.slotAttrId = '';    dirty = true; }
        if (!ss.affinities.weakness) {
            ss.affinities.weakness = { type: 'Slash', pool: 'damage' };
            dirty = true;
        }
        if (!ss.affinities.modifiers) {
            ss.affinities.modifiers = { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } };
            dirty = true;
        } else {
            for (const dmgType of ['Slash', 'Blunt', 'Pierce']) {
                if (!ss.affinities.modifiers[dmgType]) {
                    ss.affinities.modifiers[dmgType] = { damage: 0, stagger: 0 };
                    dirty = true;
                }
            }
        }

        // ── Session 9: migrate assignments array → counter object ─────────────
        if (Array.isArray(ss.affinities.assignments)) {
            const obj = { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } };
            for (const slot of ss.affinities.assignments) {
                if (obj[slot.type] && slot.pool in obj[slot.type]) {
                    obj[slot.type][slot.pool]++;
                }
            }
            ss.affinities.assignments = obj;
            dirty = true;
        } else if (!ss.affinities.assignments || typeof ss.affinities.assignments !== 'object') {
            ss.affinities.assignments = { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } };
            dirty = true;
        } else {
            // Ensure all 3×2 cells exist (future-proof backfill)
            for (const t of ['Slash', 'Blunt', 'Pierce']) {
                if (!ss.affinities.assignments[t]) { ss.affinities.assignments[t] = { damage: 0, stagger: 0 }; dirty = true; }
                else {
                    if (ss.affinities.assignments[t].damage  == null) { ss.affinities.assignments[t].damage  = 0; dirty = true; }
                    if (ss.affinities.assignments[t].stagger == null) { ss.affinities.assignments[t].stagger = 0; dirty = true; }
                }
            }
        }
    } // end affinities else (dynamic attribute/skill modifiers) ────────
    // Old dice had a flat `basePower` number. Migrate to a modifier config object.
    for (const skill of (ss.combatSkills || [])) {
        for (const die of (skill.dice || [])) {
            if (!die.modifier) {
                die.modifier = {
                    type:       'flat',
                    flatValue:  die.basePower ?? 0,
                    targetId:   '',
                    multiplier: 1,
                    roundDown:  false,
                };
                dirty = true;
            }
        }
    }

    // ── Tag object migration (Session 11) ─────────────────────────────────────
    // Die tags and skill tags were plain strings. Migrate to { text, rank } objects.
    // limitUses stays as a number — it is not a module slot.
    const _DIE_TAG_KEYS_MIG   = ['onHit','onClashWin','onClashLose','onCrit','onCheck','onEvade'];
    const _SKILL_TAG_KEYS_MIG = ['onUse','afterUse','onKill','onStagger','eminence','exhaust','proactive','reactive'];
    for (const skill of (ss.combatSkills || [])) {
        for (const die of (skill.dice || [])) {
            for (const key of _DIE_TAG_KEYS_MIG) {
                if (typeof die[key] === 'string') {
                    die[key] = { text: die[key], rank: 1 };
                    dirty = true;
                }
            }
        }
        for (const key of _SKILL_TAG_KEYS_MIG) {
            if (typeof skill[key] === 'string') {
                skill[key] = { text: skill[key], rank: 1 };
                dirty = true;
            }
        }
        // Remove the old separate modules array — replaced by tag-slot system
        if (Object.prototype.hasOwnProperty.call(skill, 'modules')) {
            delete skill.modules;
            dirty = true;
        }
    }

    // ── Structural defaults ───────────────────────────────────────────────────
    if (!ss.anatomicalDiagram) { ss.anatomicalDiagram = { enabled: true, highlightedParts: [] }; dirty = true; }
    if (!ss.maxEquippedPages)  { ss.maxEquippedPages = 9; dirty = true; }
    if (!ss.maxEGOPerTier)     { ss.maxEGOPerTier    = 1; dirty = true; }

    // ── Module pool (Session 10) ──────────────────────────────────────────────
    if (!ss.modulesPool) {
        ss.modulesPool = { intAttributeId: '', manualBonus: { r1: 0, r2: 0, r3: 0 }, uniqueSkillAsBaseId: '' };
        dirty = true;
    } else {
        if (!ss.modulesPool.manualBonus) { ss.modulesPool.manualBonus = { r1: 0, r2: 0, r3: 0 }; dirty = true; }
        if (ss.modulesPool.intAttributeId    == null) { ss.modulesPool.intAttributeId    = '';  dirty = true; }
        if (ss.modulesPool.uniqueSkillAsBaseId == null) { ss.modulesPool.uniqueSkillAsBaseId = ''; dirty = true; }
    }

    // ── Prompt includes (Session 8) ───────────────────────────────────────────
    if (!ss.promptIncludes) {
        ss.promptIncludes = _defaultPromptIncludes();
        dirty = true;
    } else {
        const pi   = ss.promptIncludes;
        const defs = _defaultPromptIncludes();
        for (const key of Object.keys(defs)) {
            if (pi[key] == null) { pi[key] = defs[key]; dirty = true; }
        }
    }

    // ── Feats: prerequisites ──────────────────────────────────────────────────
    for (const feat of (ss.feats || [])) {
        if (!Array.isArray(feat.prerequisites)) { feat.prerequisites = []; dirty = true; }
    }

    // ── Session 9: speedDice + spriteUrl ─────────────────────────────────────
    if (!ss.speedDice || typeof ss.speedDice !== 'object') {
        ss.speedDice = _defaultSpeedDice();
        dirty = true;
    } else {
        if (ss.speedDice.enabled  == null) { ss.speedDice.enabled  = false; dirty = true; }
        if (ss.speedDice.count    == null) { ss.speedDice.count    = 1;     dirty = true; }
        if (ss.speedDice.sides    == null) { ss.speedDice.sides    = 6;     dirty = true; }
        if (ss.speedDice.modifier == null) { ss.speedDice.modifier = 0;     dirty = true; }
    }
    if (ss.spriteUrl == null) { ss.spriteUrl = ''; dirty = true; }

    // ── Jobs: milestone type normalisation ────────────────────────────────────
    // Old milestones had no 'type' — default them to 'attribute'.
    for (const job of (ss.jobs || [])) {
        for (const ms of (job.attributeMilestones || [])) {
            if (!ms.type) { ms.type = 'attribute'; dirty = true; }
            if (!ms.id)   { ms.id   = generateUniqueId();        dirty = true; }
            // Session 10: ensure module milestone fields exist when type is 'module'
            if (ms.type === 'module') {
                if (ms.moduleRank    == null) { ms.moduleRank    = 1;    dirty = true; }
                if (ms.moduleIsInnate == null){ ms.moduleIsInnate = true; dirty = true; }
            }
        }
    }

    // ── Jobs v2: new fields ───────────────────────────────────────────────────
    for (const job of ss.jobs) {
        if (!job.expCost)                   { job.expCost             = 'normal'; dirty = true; }
        if (!job.treeTypes)                 { job.treeTypes           = [];       dirty = true; }
        if (job.pointGrantsPerLevel == null){ job.pointGrantsPerLevel = 1;        dirty = true; }
        if (job.unspentPoints      == null) { job.unspentPoints       = 0;        dirty = true; }
        if (!job.attributeMilestones)       { job.attributeMilestones = [];       dirty = true; }
        if (!job.associatedFeatIds)         { job.associatedFeatIds   = [];       dirty = true; }
        if (!job.treeTypeAttributeMap)      { job.treeTypeAttributeMap = {};      dirty = true; }

        // ── Bootstrap unspentPoints for jobs that were configured in Master Mode ──
        // The previous Master Mode level +/- handler never granted Specialty Points,
        // so any job with level > 0 and unspentPoints = 0 may be missing its points.
        // We do a one-time bootstrap: compute totalGranted − totalSpent, where
        // totalSpent = sum of all sub-skill levels under this job's tree type skills.
        // The _pointsBootstrapped flag prevents this from running more than once.
        if (!job._pointsBootstrapped) {
            if ((job.level || 0) > 0) {
                const totalGranted = (job.level || 0) * (job.pointGrantsPerLevel || 1);
                let totalSpent = 0;
                const attrMap = job.treeTypeAttributeMap || {};
                for (const [treeName, attrId] of Object.entries(attrMap)) {
                    const attr  = (ss.attributes || []).find(a => a.id === attrId);
                    const skill = (attr?.skills  || []).find(
                        s => s.name.toLowerCase() === treeName.toLowerCase()
                    );
                    if (skill) {
                        totalSpent += (skill.subSkills || [])
                            .filter(s => s.enabled)
                            .reduce((sum, s) => sum + (s.level || 0), 0);
                    }
                }
                // Only bootstrap if current unspentPoints looks wrong (= 0 but level > 0)
                if (job.unspentPoints === 0) {
                    job.unspentPoints = Math.max(0, totalGranted - totalSpent);
                }
            }
            job._pointsBootstrapped = true;
            dirty = true;
        }
    }

    if (dirty) {
        console.log('[StatSheet] Migration applied.');
        saveSettings();
    }
}

// ============================================================================
// DEFAULT DATA FACTORIES
// ============================================================================

function _defaultEditorSettings() {
    return {
        attributeMaxValue:          999,
        skillMaxValue:              null,
        alphabeticModeCap:          'EX',
        allowCustomAttributes:      true,
        allowCustomSkills:          true,
        allowCustomSavingThrows:    true,
        expCostNormalMultiplier:    2,
        expCostExpensiveMultiplier: 3,

        // Divisor used to compute the second component of the alphabetic attribute modifier.
        // e.g. attrValueDivisor: 100 → rankValue 250 → floor(250/100) = +2
        attrValueDivisor: 100,

        // Maps each letter grade to its base numeric value.
        // Used for the grade component of attribute rolls and for alphabetic skill rolls.
        gradeValueMap: {
            'FFF': -2,  'FF': -1,   'F':  0,
            'E':   1,  'EE': 3,   'EEE': 4,
            'D':   5,  'DD': 6,   'DDD': 7,
            'C':   8,  'CC': 9,   'CCC': 10,
            'B':   12, 'BB': 14,  'BBB': 16,
            'A':   20, 'AA': 24,  'AAA': 28,
            'S':   35, 'SS': 45,  'SSS': 60,
            'EX':  80
        },

        // Maps each letter grade to the number of sides on its roll die.
        // The roll popover auto-selects this die based on the attribute's current rank.
        gradeDiceMap: {
            'FFF':-20,   'FF': -10,   'F':   0,
            'E':   10,  'EE': 12,  'EEE': 15,
            'D':   20,  'DD': 25,  'DDD': 30,
            'C':   40,  'CC': 45,  'CCC': 50,
            'B':   60,  'BB': 65,  'BBB': 70,
            'A':   80,  'AA': 85,  'AAA': 90,
            'S':   100, 'SS': 120, 'SSS': 150,
            'EX':  200
        },

        // When true, calculateUpgradeCost() uses skillExpCostTable instead of the
        // (level+1)*multiplier formula. Works for both numeric and alphabetic skills.
        useSkillExpCostTable: false,

        // Tier rows, matched top-to-bottom by current level (or rank index for alphabetic).
        // The last row acts as a catch-all for anything beyond its minLevel.
        skillExpCostTable: [
            { id: 'sect1', label: 'Beginner (Lv 1–5)',   minLevel: 0,  maxLevel: 4,    normalCost: 10,  expensiveCost: 15  },
            { id: 'sect2', label: 'Novice (Lv 6–10)',    minLevel: 5,  maxLevel: 9,    normalCost: 25,  expensiveCost: 40  },
            { id: 'sect3', label: 'Adept (Lv 11–20)',    minLevel: 10, maxLevel: 19,   normalCost: 60,  expensiveCost: 100 },
            { id: 'sect4', label: 'Expert (Lv 21+)',     minLevel: 20, maxLevel: 9999, normalCost: 150, expensiveCost: 250 }
        ],

        // When true, calculateJobLevelCost() uses jobExpCostTable instead of the
        // calculateUpgradeCost formula. Max 10 rows (one per job level 0–9).
        useJobExpCostTable: false,

        jobExpCostTable: [
            { id: 'jt1', label: 'Lv 1–3',  minLevel: 0, maxLevel: 2, normalCost: 20,  expensiveCost: 30  },
            { id: 'jt2', label: 'Lv 4–6',  minLevel: 3, maxLevel: 5, normalCost: 60,  expensiveCost: 90  },
            { id: 'jt3', label: 'Lv 7–9',  minLevel: 6, maxLevel: 8, normalCost: 150, expensiveCost: 225 },
            { id: 'jt4', label: 'Lv 10',   minLevel: 9, maxLevel: 9, normalCost: 400, expensiveCost: 600 }
        ]
    };
}

function _defaultLevel() {
    return {
        current:         1,
        autoCalculate:   false,
        calculationMode: 'manual',
        exp:             0,
        expCurve:        'linear',
        expPerLevel:     1000,
        customCurve:     [],
        showLevel:       true,
        showExp:         true
    };
}

function _defaultSavingThrows() {
    return [
        { id: 'fortitude', name: 'Fortitude', terms: [{ id: 'fort_con', type: 'attribute', attrId: 'con', multiplier: 1 }], enabled: true },
        { id: 'reflex',    name: 'Reflex',    terms: [{ id: 'ref_dex',  type: 'attribute', attrId: 'dex', multiplier: 1 }], enabled: true },
        { id: 'will',      name: 'Will',      terms: [{ id: 'will_wis', type: 'attribute', attrId: 'wis', multiplier: 1 }], enabled: true }
    ];
}

function _defaultPromptIncludes() {
    return {
        attributes:   true,
        savingThrows: true,
        jobsFeats:    true,
        combatSkills: true,
        augments:     false,   // off by default — augments tab is still WIP
    };
}

function _defaultAffinities() {
    return {
        enabled:     false,
        weakness:    { type: 'Slash', pool: 'damage' },
        modifiers:   { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } },
        assignments: { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } },
        slotAttrId:  ''   // ID of the attribute that grants −1 slots (1 per point past 1st)
    };
}

function _defaultSpeedDice() {
    return { enabled: false, count: 1, sides: 6, modifier: 0 };
}

function _createDefaultStatSheet() {
    return {
        enabled: false,
        mode:    'numeric',

        attributes: [
            { id: 'str', name: 'STR', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
            { id: 'dex', name: 'DEX', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
            { id: 'con', name: 'CON', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
            { id: 'int', name: 'INT', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
            { id: 'wis', name: 'WIS', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
            { id: 'cha', name: 'CHA', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] }
        ],

        savingThrows:     _defaultSavingThrows(),
        level:            _defaultLevel(),
        jobs:             [],
        feats:            [],
        augments:         [],
        anatomicalDiagram: { enabled: true, highlightedParts: [] },
        combatSkills:     [],
        maxEquippedPages: 9,
        maxEGOPerTier:    1,
        editorSettings:   _defaultEditorSettings(),
        promptIncludes:   _defaultPromptIncludes(),
        affinities:       _defaultAffinities(),
        modulesPool:      { intAttributeId: '', manualBonus: { r1: 0, r2: 0, r3: 0 }, uniqueSkillAsBaseId: '' },
        speedDice:        _defaultSpeedDice(),
        spriteUrl:        ''
    };
}

// ============================================================================
// INTERNAL UTILITIES
// ============================================================================

/** Returns the rank one step above or below, clamped to the RANKS array. */
function _stepRank(currentRank, delta) {
    const idx = RANKS.indexOf(currentRank);
    const i   = idx === -1 ? RANKS.indexOf('C') : idx;
    return RANKS[Math.max(0, Math.min(RANKS.length - 1, i + delta))];
}

// ============================================================================
// PUBLIC UTILITY
// ============================================================================

/** Returns a fresh default affinities block. */
export function defaultAffinities() { return _defaultAffinities(); }

/** Generate a unique ID string. */
export function generateUniqueId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Toggle global display mode (numeric ↔ alphabetic). */
export function toggleDisplayMode() {
    const ss = extensionSettings.statSheet;
    ss.mode  = ss.mode === 'numeric' ? 'alphabetic' : 'numeric';
    saveStatSheetData();
}

// ============================================================================
// ATTRIBUTE HELPERS
// ============================================================================

export function getAttributeById(id) {
    return extensionSettings.statSheet.attributes.find(a => a.id === id) || null;
}

export function addAttribute(attribute) {
    extensionSettings.statSheet.attributes.push(attribute);
    saveStatSheetData();
}

export function removeAttribute(id) {
    extensionSettings.statSheet.attributes =
        extensionSettings.statSheet.attributes.filter(a => a.id !== id);
    saveStatSheetData();
}

export function updateAttributeValue(id, delta) {
    const attr = getAttributeById(id);
    if (!attr) return;

    const mode = extensionSettings.statSheet.mode;
    if (mode === 'numeric') {
        const max  = extensionSettings.statSheet.editorSettings?.attributeMaxValue || 999;
        attr.value     = Math.max(1, Math.min(max, attr.value + delta));
        attr.rankValue = attr.value;
    } else {
        attr.rank = _stepRank(attr.rank || 'C', delta);
    }

    saveStatSheetData();
}

// ============================================================================
// SKILL HELPERS
// ============================================================================

export function getSkillById(attributeId, skillId) {
    return getAttributeById(attributeId)?.skills.find(s => s.id === skillId) || null;
}

export function addSkill(attributeId, skill) {
    const attr = getAttributeById(attributeId);
    if (!attr) return;
    attr.skills.push(skill);
    saveStatSheetData();
}

export function removeSkill(attributeId, skillId) {
    const attr = getAttributeById(attributeId);
    if (!attr) return;
    attr.skills = attr.skills.filter(s => s.id !== skillId);
    saveStatSheetData();
}

export function updateSkillLevel(attributeId, skillId, delta) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill) return;

    if (skill.mode === 'alphabetic') {
        skill.rank = _stepRank(skill.rank || 'C', delta);
    } else {
        const max  = extensionSettings.statSheet.editorSettings?.skillMaxValue;
        skill.level = Math.max(1, skill.level + delta);
        if (max != null) skill.level = Math.min(max, skill.level);
    }

    saveStatSheetData();
}

// ============================================================================
// SUB-SKILL HELPERS
// ============================================================================

/**
 * Effective level of a skill for display and roll purposes.
 *   - Alphabetic:              gradeValue(rank)  [handled in attributesTab]
 *   - Numeric with sub-skills: sum of enabled sub-skill levels
 *   - Numeric without:         skill.level
 */
export function getSkillEffectiveLevel(attributeId, skillId) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill) return 0;
    if (skill.mode === 'alphabetic') return skill.rankValue || 0;
    const subs = (skill.subSkills || []).filter(s => s.enabled);
    return subs.length > 0
        ? subs.reduce((sum, s) => sum + (s.level || 0), 0)
        : (skill.level || 0);
}

/** True if a numeric skill has at least one enabled sub-skill. */
export function skillHasSubSkills(attributeId, skillId) {
    const skill = getSkillById(attributeId, skillId);
    return !!(skill && skill.mode === 'numeric' && (skill.subSkills || []).some(s => s.enabled));
}

export function addSubSkill(attributeId, skillId, subSkill) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric') return;
    if (!Array.isArray(skill.subSkills)) skill.subSkills = [];
    skill.subSkills.push(subSkill);
    saveStatSheetData();
}

export function removeSubSkill(attributeId, skillId, subSkillId) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill) return;
    skill.subSkills = (skill.subSkills || []).filter(s => s.id !== subSkillId);
    saveStatSheetData();
}

/**
 * Update a sub-skill's level.
 * @param {boolean} direct — if true, delta is treated as the new absolute value
 */
export function updateSubSkillLevel(attributeId, skillId, subSkillId, delta, direct = false) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill) return;
    const sub = (skill.subSkills || []).find(s => s.id === subSkillId);
    if (!sub) return;
    sub.level = direct
        ? Math.max(0, delta)
        : Math.max(0, (sub.level || 0) + delta);
    saveStatSheetData();
}

// ============================================================================
// EXP COST HELPERS
// ============================================================================

/**
 * EXP cost to raise a skill or job from currentLevel to currentLevel + 1.
 *
 * When useSkillExpCostTable is enabled the cost is looked up from the
 * configured tier table (matched top-to-bottom; last row is the catch-all).
 * Otherwise falls back to the original formula: (currentLevel + 1) × multiplier.
 *
 * For alphabetic skills pass the rank's index in RANKS as currentLevel.
 */
export function calculateUpgradeCost(currentLevel, expCost) {
    const es  = extensionSettings.statSheet.editorSettings;
    const lvl = currentLevel || 0;

    // ── Tier table lookup ─────────────────────────────────────────────────────
    if (es?.useSkillExpCostTable && Array.isArray(es.skillExpCostTable) && es.skillExpCostTable.length > 0) {
        const tier = es.skillExpCostTable.find(
            t => lvl >= (t.minLevel ?? 0) && lvl <= (t.maxLevel ?? 9999)
        ) || es.skillExpCostTable[es.skillExpCostTable.length - 1];   // catch-all

        return expCost === 'expensive'
            ? (tier.expensiveCost ?? tier.normalCost ?? 1)
            : (tier.normalCost   ?? 1);
    }

    // ── Original formula ──────────────────────────────────────────────────────
    const mult = expCost === 'expensive'
        ? (es?.expCostExpensiveMultiplier || 3)
        : (es?.expCostNormalMultiplier    || 2);
    return (lvl + 1) * mult;
}

/**
 * Spend EXP to raise a numeric skill without sub-skills.
 * Returns true on success, false if insufficient EXP or ineligible.
 */
export function spendExpOnSkill(attributeId, skillId) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric' || skillHasSubSkills(attributeId, skillId)) return false;

    const cost = calculateUpgradeCost(skill.level || 0, skill.expCost || 'normal');
    if ((extensionSettings.statSheet.level.exp || 0) < cost) return false;

    extensionSettings.statSheet.level.exp -= cost;
    skill.level = (skill.level || 0) + 1;
    saveStatSheetData();
    return true;
}

/**
 * Spend EXP to advance an alphabetic skill's rank by one step.
 * Uses the rank's index in RANKS as "currentLevel" for cost lookup,
 * so the tier table (if active) applies the same way as numeric skills.
 * Returns { success, reason?, newRank? }
 */
export function spendExpOnAlphaSkill(attributeId, skillId) {
    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'alphabetic') {
        return { success: false, reason: 'Not an alphabetic skill' };
    }

    const rankIdx = RANKS.indexOf(skill.rank || 'C');
    if (rankIdx < 0 || rankIdx >= RANKS.length - 1) {
        return { success: false, reason: 'Already at max rank (EX)' };
    }

    const cost = calculateUpgradeCost(rankIdx, skill.expCost || 'normal');
    if ((extensionSettings.statSheet.level.exp || 0) < cost) {
        return { success: false, reason: `Insufficient EXP (need ${cost})` };
    }

    extensionSettings.statSheet.level.exp -= cost;
    skill.rank = RANKS[rankIdx + 1];
    saveStatSheetData();
    return { success: true, newRank: skill.rank };
}

// ============================================================================
// SAVING THROW HELPERS
// ============================================================================

export function getSavingThrowById(id) {
    return extensionSettings.statSheet.savingThrows?.find(s => s.id === id) || null;
}

/**
 * Calculate the total value of a saving throw.
 * Uses the same attribute modifier logic as getAttrModifier() in attributesTab:
 *   numeric:    attr.value
 *   alphabetic: gradeValue(rank) + floor(rankValue ÷ divisor)
 */
export function calculateSavingThrowValue(st) {
    if (!st.terms?.length) return 0;

    const ss      = extensionSettings.statSheet;
    const mode    = ss.mode;
    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap || {};
    const divisor = es?.attrValueDivisor || 100;
    let total     = 0;

    for (const term of st.terms) {
        if (term.type === 'attribute') {
            const attr = ss.attributes.find(a => a.id === term.attrId && a.enabled);
            if (!attr) continue;
            const attrMod = mode === 'numeric'
                ? (attr.value || 0)
                : (gvm[attr.rank] || 0) + Math.floor((attr.rankValue || 0) / divisor);
            total += attrMod * (parseFloat(term.multiplier) || 0);
        } else if (term.type === 'flat') {
            total += parseFloat(term.value) || 0;
        } else if (term.type === 'level') {
            const lvl = ss.level?.current || 1;
            total += lvl * (parseFloat(term.multiplier) || 1);
        }
    }

    return Math.floor(total);
}

export function buildSavingThrowFormula(st) {
    if (!st.terms?.length) return '(no terms)';

    const attrs = extensionSettings.statSheet.attributes;
    const parts = st.terms.map(term => {
        if (term.type === 'attribute') {
            const name = attrs.find(a => a.id === term.attrId)?.name || '(removed)';
            const mult = parseFloat(term.multiplier) || 0;
            return mult === 1 ? name : `${name} × ${mult}`;
        }
        if (term.type === 'flat') {
            return `${parseFloat(term.value) || 0} (${term.label || 'Flat'})`;
        }
        if (term.type === 'level') {
            const mult = parseFloat(term.multiplier) || 1;
            return mult === 1 ? 'Level' : `Level × ${mult}`;
        }
        return null;
    }).filter(Boolean);

    return `${parts.join(' + ')} = ${calculateSavingThrowValue(st)}`;
}

export function addSavingThrowAttributeTerm(stId, attrId) {
    const st = getSavingThrowById(stId);
    if (!st) return;
    if (st.terms.some(t => t.type === 'attribute' && t.attrId === attrId)) return;
    st.terms.push({ id: generateUniqueId(), type: 'attribute', attrId, multiplier: 1 });
    saveStatSheetData();
}

export function addSavingThrowFlatTerm(stId) {
    const st = getSavingThrowById(stId);
    if (!st) return;
    st.terms.push({ id: generateUniqueId(), type: 'flat', value: 0, label: 'Flat Bonus' });
    saveStatSheetData();
}

export function addSavingThrowLevelTerm(stId) {
    const st = getSavingThrowById(stId);
    if (!st) return;
    if (st.terms.some(t => t.type === 'level')) return; // only one level term allowed
    st.terms.push({ id: generateUniqueId(), type: 'level', multiplier: 1 });
    saveStatSheetData();
}

export function removeSavingThrowTerm(stId, termId) {
    const st = getSavingThrowById(stId);
    if (!st) return;
    st.terms = st.terms.filter(t => t.id !== termId);
    saveStatSheetData();
}

export function updateSavingThrowTermMultiplier(stId, termId, multiplier) {
    const st   = getSavingThrowById(stId);
    const term = st?.terms.find(t => t.id === termId);
    if (term) { term.multiplier = multiplier; saveStatSheetData(); }
}

export function updateSavingThrowFlatTermValue(stId, termId, value) {
    const st   = getSavingThrowById(stId);
    const term = st?.terms.find(t => t.id === termId);
    if (term) { term.value = value; saveStatSheetData(); }
}

export function updateSavingThrowFlatTermLabel(stId, termId, label) {
    const st   = getSavingThrowById(stId);
    const term = st?.terms.find(t => t.id === termId);
    if (term) { term.label = label; saveStatSheetData(); }
}

// ============================================================================
// JOB HELPERS
// ============================================================================

export function getJobById(id) {
    return extensionSettings.statSheet.jobs.find(j => j.id === id) || null;
}

export function addJob(job) {
    extensionSettings.statSheet.jobs.push(job);
    saveStatSheetData();
}

export function removeJob(id) {
    extensionSettings.statSheet.jobs =
        extensionSettings.statSheet.jobs.filter(j => j.id !== id);
    saveStatSheetData();
}

/** Returns all jobs with unspent sub-skill points (used by UI notification banner). */
export function getJobsWithUnspentPoints() {
    return extensionSettings.statSheet.jobs.filter(j => (j.unspentPoints || 0) > 0);
}

/**
 * Attempt to level up a job by spending from the shared EXP pool.
 * On success: deducts EXP, increments level, awards points, fires attribute milestones.
 * @returns {{ success: boolean, reason?: string, newLevel?: number, pointsAwarded?: number, milestonesHit?: Array }}
 */
export function levelUpJob(jobId) {
    const job = getJobById(jobId);
    if (!job)                      return { success: false, reason: 'Job not found' };
    if ((job.level || 0) >= 10)    return { success: false, reason: 'Max level (10) reached' };

    const cost = calculateJobLevelCost(jobId);
    if ((extensionSettings.statSheet.level.exp || 0) < cost) {
        return { success: false, reason: `Insufficient EXP (need ${cost})` };
    }

    extensionSettings.statSheet.level.exp -= cost;
    job.level = (job.level || 0) + 1;

    const pointsGranted  = job.pointGrantsPerLevel || 1;
    job.unspentPoints    = (job.unspentPoints || 0) + pointsGranted;

    const milestonesHit = [];
    for (const milestone of (job.attributeMilestones || [])) {
        if (milestone.level !== job.level) continue;
        const type = milestone.type || 'attribute';

        if (type === 'attribute') {
            const attr = getAttributeById(milestone.attrId);
            if (!attr) continue;
            const max  = extensionSettings.statSheet.editorSettings?.attributeMaxValue || 999;
            attr.value     = Math.min(max, (attr.value || 0) + (milestone.amount || 1));
            attr.rankValue = attr.value;
            milestonesHit.push({ type: 'attribute', attrName: attr.name, amount: milestone.amount });

        } else if (type === 'feat') {
            const feat = extensionSettings.statSheet.feats?.find(f => f.id === milestone.featId);
            if (!feat) continue;
            feat.enabled = true;
            milestonesHit.push({ type: 'feat', featName: feat.name });

        } else if (type === 'subskill') {
            const attr  = getAttributeById(milestone.attrId);
            const skill = attr?.skills?.find(s => s.id === milestone.skillId);
            const sub   = skill?.subSkills?.find(s => s.id === milestone.subSkillId);
            if (!sub) continue;
            sub.level = (sub.level || 0) + (milestone.amount || 1);
            milestonesHit.push({ type: 'subskill', subSkillName: sub.name, amount: milestone.amount });

        } else if (type === 'module') {
            const cSkill = extensionSettings.statSheet.combatSkills?.find(s => s.id === milestone.skillId);
            if (!cSkill) continue;
            if (!Array.isArray(cSkill.modules)) cSkill.modules = [];
            cSkill.modules.push({
                id:       generateUniqueId(),
                rank:     milestone.moduleRank || 1,
                name:     '',
                isInnate: milestone.moduleIsInnate !== false,
                notes:    '',
            });
            milestonesHit.push({
                type:      'module',
                skillName: cSkill.name,
                rank:      milestone.moduleRank || 1,
                isInnate:  milestone.moduleIsInnate !== false,
            });
        }
    }

    saveStatSheetData();
    return { success: true, newLevel: job.level, pointsAwarded: pointsGranted, milestonesHit };
}

/**
 * Spend one unspent job point to create a brand-new sub-skill on a numeric skill.
 * The sub-skill starts at level 1.
 * @returns {{ success: boolean, reason?: string, subSkillId?: string }}
 */
export function createSubSkillWithJobPoint(jobId, attributeId, skillId, name) {
    const job = getJobById(jobId);
    if (!job)                         return { success: false, reason: 'Job not found' };
    if ((job.unspentPoints || 0) < 1) return { success: false, reason: 'No unspent points' };

    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric') return { success: false, reason: 'Invalid skill' };

    const newSub = {
        id:      generateUniqueId(),
        name:    (name || 'New Sub-skill').trim(),
        level:   1,
        enabled: true
    };

    if (!Array.isArray(skill.subSkills)) skill.subSkills = [];
    skill.subSkills.push(newSub);
    job.unspentPoints -= 1;
    saveStatSheetData();
    return { success: true, subSkillId: newSub.id };
}

/**
 * Spend one unspent job point to raise a numeric sub-skill by 1.
 * @returns {{ success: boolean, reason?: string }}
 */
export function spendJobPointOnSubSkill(jobId, attributeId, skillId, subSkillId) {
    const job = getJobById(jobId);
    if (!job)                         return { success: false, reason: 'Job not found' };
    if ((job.unspentPoints || 0) < 1) return { success: false, reason: 'No unspent points' };

    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric') return { success: false, reason: 'Invalid skill' };

    const sub = (skill.subSkills || []).find(s => s.id === subSkillId && s.enabled);
    if (!sub) return { success: false, reason: 'Sub-skill not found' };

    job.unspentPoints -= 1;
    sub.level = (sub.level || 0) + 1;
    saveStatSheetData();
    return { success: true };
}

/**
 * Refund one point from a sub-skill back to the job's unspent pool.
 * Decreases the sub-skill level by 1 (minimum 0) and returns the point.
 * @returns {{ success: boolean, reason?: string }}
 */
export function refundJobPointFromSubSkill(jobId, attributeId, skillId, subSkillId) {
    const job = getJobById(jobId);
    if (!job) return { success: false, reason: 'Job not found' };

    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric') return { success: false, reason: 'Invalid skill' };

    const sub = (skill.subSkills || []).find(s => s.id === subSkillId && s.enabled);
    if (!sub) return { success: false, reason: 'Sub-skill not found' };
    if ((sub.level || 0) <= 0) return { success: false, reason: 'Sub-skill already at 0' };

    sub.level -= 1;
    job.unspentPoints = (job.unspentPoints || 0) + 1;
    saveStatSheetData();
    return { success: true };
}

/**
 * Refund one point from a parent skill back to the job's unspent pool.
 * Decreases the skill level by 1 (minimum 0) and returns the point.
 * @returns {{ success: boolean, reason?: string }}
 */
export function refundJobPointFromSkill(jobId, attributeId, skillId) {
    const job = getJobById(jobId);
    if (!job) return { success: false, reason: 'Job not found' };

    const skill = getSkillById(attributeId, skillId);
    if (!skill || skill.mode !== 'numeric') return { success: false, reason: 'Invalid skill' };
    if ((skill.level || 0) <= 0) return { success: false, reason: 'Skill already at 0' };

    skill.level -= 1;
    job.unspentPoints = (job.unspentPoints || 0) + 1;
    saveStatSheetData();
    return { success: true };
}

// ============================================================================
// FEAT HELPERS
// ============================================================================

export function addFeat(feat) {
    extensionSettings.statSheet.feats.push(feat);
    saveStatSheetData();
}

export function removeFeat(id) {
    extensionSettings.statSheet.feats =
        extensionSettings.statSheet.feats.filter(f => f.id !== id);
    saveStatSheetData();
}

// ============================================================================
// JOB LEVEL COST (Session 4.5)
// ============================================================================

/**
 * Calculate the EXP cost to level up a job.
 * Uses jobExpCostTable when enabled; falls back to calculateUpgradeCost.
 * @param {string} jobId
 * @returns {number}
 */
export function calculateJobLevelCost(jobId) {
    const job = getJobById(jobId);
    if (!job) return 0;
    const es           = extensionSettings.statSheet.editorSettings;
    const currentLevel = job.level || 0;
    const expCost      = job.expCost || 'normal';

    if (es.useJobExpCostTable && Array.isArray(es.jobExpCostTable) && es.jobExpCostTable.length) {
        const row = es.jobExpCostTable.find(r => currentLevel >= r.minLevel && currentLevel <= r.maxLevel)
                 || es.jobExpCostTable[es.jobExpCostTable.length - 1];
        return expCost === 'expensive' ? (row.expensiveCost || 0) : (row.normalCost || 0);
    }

    return calculateUpgradeCost(currentLevel, expCost);
}

// ============================================================================
// AUGMENT HELPERS
// ============================================================================

export function addAugment(augment) {
    extensionSettings.statSheet.augments.push(augment);
    const highlighted = extensionSettings.statSheet.anatomicalDiagram.highlightedParts;
    if (augment.bodyPart && !highlighted.includes(augment.bodyPart)) {
        highlighted.push(augment.bodyPart);
    }
    saveStatSheetData();
}

export function removeAugment(id) {
    const ss      = extensionSettings.statSheet;
    const augment = ss.augments.find(a => a.id === id);
    const part    = augment?.bodyPart;

    ss.augments = ss.augments.filter(a => a.id !== id);

    if (part && !ss.augments.some(a => a.bodyPart === part)) {
        ss.anatomicalDiagram.highlightedParts =
            ss.anatomicalDiagram.highlightedParts.filter(p => p !== part);
    }

    saveStatSheetData();
}

export function getAugmentsByBodyPart(bodyPartId) {
    return extensionSettings.statSheet.augments.filter(a => a.bodyPart === bodyPartId);
}

// ============================================================================
// COMBAT SKILL HELPERS
// ============================================================================

export function addCombatSkill(page) {
    extensionSettings.statSheet.combatSkills.push(page);
    saveStatSheetData();
}

export function removeCombatSkill(id) {
    extensionSettings.statSheet.combatSkills =
        extensionSettings.statSheet.combatSkills.filter(p => p.id !== id);
    saveStatSheetData();
}

export function equipCombatSkill(id) {
    const ss   = extensionSettings.statSheet;
    const page = ss.combatSkills.find(p => p.id === id);
    if (!page) return false;
    if (page.isEGO) return _equipEGO(id);

    if (getEquippedSkills().length >= ss.maxEquippedPages) {
        console.warn('[StatSheet] Cannot equip: deck limit reached');
        return false;
    }
    page.equipped = true;
    saveStatSheetData();
    return true;
}

function _equipEGO(id) {
    const ss   = extensionSettings.statSheet;
    const page = ss.combatSkills.find(p => p.id === id);
    if (!page?.isEGO) return false;

    const tierConflict = ss.combatSkills.some(
        p => p.isEGO && p.equipped && p.egoTier === page.egoTier && p.id !== id
    );
    if (tierConflict) { console.warn('[StatSheet] Cannot equip E.G.O: tier limit'); return false; }
    if (getEquippedSkills().length >= ss.maxEquippedPages) { console.warn('[StatSheet] Deck limit'); return false; }

    page.equipped = true;
    saveStatSheetData();
    return true;
}

export function unequipCombatSkill(id) {
    const page = extensionSettings.statSheet.combatSkills.find(p => p.id === id);
    if (!page) return;
    page.equipped = false;
    saveStatSheetData();
}

export function getEquippedSkills() {
    return extensionSettings.statSheet.combatSkills.filter(p => p.equipped);
}

export function duplicateCombatSkill(id) {
    const page = extensionSettings.statSheet.combatSkills.find(p => p.id === id);
    if (!page) return null;
    const copy = { ...page, id: generateUniqueId(), name: `${page.name} (Copy)`, equipped: false };
    extensionSettings.statSheet.combatSkills.push(copy);
    saveStatSheetData();
    return copy.id;
}

// ============================================================================
// COMBAT SNAP / DICE BRIDGE  (Session 12)
// ============================================================================

/**
 * Resolve a die modifier object to a plain numeric value using live stat-sheet
 * data. Mirrors the logic in statSheetPrompt._resolveMod.
 * @param {object|undefined} mod
 * @param {object}           ss   — extensionSettings.statSheet
 * @returns {number}
 */
function _resolveModValue(mod, ss) {
    if (!mod || mod.type === 'flat') return mod?.flatValue ?? 0;

    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    if (mod.type === 'attribute') {
        const attr = (ss.attributes || []).find(a => a.id === mod.targetId && a.enabled);
        if (!attr) return 0;
        const raw     = ss.mode === 'numeric'
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
            // Was: multiplier * skillRaw   (attribute contribution silently dropped)
            // Now: attrMod + multiplier * skillRaw  (mirrors _resolveModLive)
            // This divergence caused live combat dice to be lower than what the
            // stat sheet display showed, because the parent attribute value was
            // ignored at resolution time even though it was included in the UI.
            const attrMod  = ss.mode === 'numeric'
                ? (attr.value ?? 0)
                : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
            const skillRaw = sk.mode === 'alphabetic'
                ? (gvm[sk.rank ?? 'C'] ?? 0) + Math.floor((sk.rankValue ?? 0) / divisor)
                : (sk.level ?? 0);
            const applied  = attrMod + (mod.multiplier ?? 1) * skillRaw;
            return mod.roundDown ? Math.floor(applied) : applied;
        }
        return 0;
    }

    if (mod.type === 'saving_throw') {
        const st = (ss.savingThrows || []).find(s => s.id === mod.targetId && s.enabled);
        if (!st) return 0;
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

    if (mod.type === 'subskill') {
        for (const attr of (ss.attributes || [])) {
            if (!attr.enabled) continue;
            for (const sk of (attr.skills || [])) {
                if (!sk.enabled) continue;
                const sub = (sk.subSkills || []).find(s => s.id === mod.targetId && s.enabled);
                if (!sub) continue;
                const attrMod = ss.mode === 'numeric'
                    ? (attr.value ?? 0)
                    : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
                const subVal  = sub.level ?? 0;
                const scaled  = (mod.multiplier ?? 1) * subVal;
                const total   = attrMod + (mod.roundDown ? Math.floor(scaled) : scaled);
                return total;
            }
        }
        return 0;
    }

    return 0;
}

// ============================================================================
// CONDITION BAR MAX RESOLUTION  (Tier 3)
// ============================================================================

/**
 * Resolve the effective maximum value for a condition bar (customStat).
 *
 * Supports four scale sources:
 *   'attribute'   — existing behaviour, keyed by scaleWithAttribute or scaleId
 *   'skill'       — skill.level (numeric) or gradeValue (alphabetic)
 *   'subskill'    — subSkill.level
 *   'savingThrow' — calculateSavingThrowValue()
 *
 * Falls back to stat.maxValue if the stat sheet is disabled or the target
 * is not found / not enabled.
 *
 * Schema fields read from stat:
 *   maxValue        {number}  — base max (fallback)
 *   scaleSource     {string}  — 'attribute'|'skill'|'subskill'|'savingThrow'
 *   scaleId         {string}  — target ID (skill/subskill/ST); for 'attribute'
 *                               falls back to legacy scaleWithAttribute
 *   scaleWithAttribute {string} — legacy attribute ID (kept for backwards compat)
 *   scaleMultiplier {number}  — applied to the resolved value (default 1)
 *   scaleBonus      {number}  — flat added after multiply (default 0)
 *
 * @param {object} stat  — a customStat config object from trackerConfig
 * @returns {number}
 */
export function resolveBarMax(stat) {
    const baseMax = stat.maxValue || 100;
    const ss      = extensionSettings.statSheet;

    // Determine which source type to use (default: attribute for backwards compat)
    const source = stat.scaleSource
        || (stat.scaleWithAttribute ? 'attribute' : null);

    if (!source || !ss?.enabled) return baseMax;

    const multiplier = parseFloat(stat.scaleMultiplier) || 1;
    const bonus      = parseFloat(stat.scaleBonus)      || 0;
    const es         = ss.editorSettings;
    const gvm        = es?.gradeValueMap    || {};
    const divisor    = es?.attrValueDivisor || 100;

    let scaleValue = 0;

    if (source === 'attribute') {
        const attrId = stat.scaleId || stat.scaleWithAttribute;
        const attr   = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
        if (!attr) return baseMax;
        scaleValue = ss.mode === 'numeric'
            ? (attr.value ?? 0)
            : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);

    } else if (source === 'skill') {
        for (const attr of (ss.attributes || [])) {
            if (!attr.enabled) continue;
            const sk = (attr.skills || []).find(s => s.id === stat.scaleId && s.enabled);
            if (!sk) continue;
            scaleValue = sk.mode === 'alphabetic'
                ? (gvm[sk.rank ?? 'C'] ?? 0) + Math.floor((sk.rankValue ?? 0) / divisor)
                : (sk.level ?? 0);
            break;
        }

    } else if (source === 'subskill') {
        outer: for (const attr of (ss.attributes || [])) {
            if (!attr.enabled) continue;
            for (const sk of (attr.skills || [])) {
                if (!sk.enabled) continue;
                const sub = (sk.subSkills || []).find(s => s.id === stat.scaleId && s.enabled);
                if (!sub) continue;
                scaleValue = sub.level ?? 0;
                break outer;
            }
        }

    } else if (source === 'savingThrow') {
        const st = (ss.savingThrows || []).find(s => s.id === stat.scaleId && s.enabled);
        if (st) scaleValue = calculateSavingThrowValue(st);
    }

    return Math.max(1, Math.floor(scaleValue * multiplier) + bonus);
}

/**
 * Resolve the player's speed dice modifier from the speedDice config.
 *
 * ss.speedDice.attrId was always stored but never read at runtime — the
 * modifier stayed as whatever flat number was saved, ignoring the attribute
 * link entirely.  This function performs the same gvm + rankValue / divisor
 * derivation used everywhere else in the codebase (alphabetic mode) or reads
 * attr.value directly (numeric mode), then adds any flat modifier bonus on top.
 *
 * Returns a plain number suitable as speedSpec.modifier.
 *
 * @returns {number}
 */
export function resolveSpeedDiceModifier() {
    const ss = extensionSettings.statSheet;
    const sd = ss?.speedDice;
    if (!sd?.enabled) return sd?.modifier ?? 0;

    // No attribute linked — use the stored flat value
    if (!sd.attrId) return sd.modifier ?? 0;

    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    const attr = (ss.attributes || []).find(a => a.id === sd.attrId && a.enabled);
    if (!attr) return sd.modifier ?? 0;

    const attrVal = ss.mode === 'numeric'
        ? (attr.value ?? 0)
        : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);

    // attrVal is the derived stat total; sd.modifier is an optional flat bonus on top
    return attrVal + (sd.modifier ?? 0);
}

/**
 * Build a lightweight snapshot of the player suitable for use in resolveClash.
 *
 * HP is read from extensionSettings.userStats.health (the tracker bar).
 * Stagger is not persisted as a tracker bar; it lives in the encounter engine
 * state and will be overwritten immediately by the caller if a prior engine
 * state exists (see encounterUI's merge step after buildPlayerSnap).
 *
 * @param {{ isStaggered?: boolean }} [opts]
 * @returns {{ hp, maxHp, staggerResist, maxStaggerResist, affinities, isStaggered, savedDice }}
 */
export function buildPlayerSnap({ isStaggered = false } = {}) {
    const us       = extensionSettings.userStats ?? {};
    const hpStat   = extensionSettings.trackerConfig?.userStats?.customStats
                         ?.find(s => s.id === 'health');
    const maxHp    = hpStat?.maxValue ?? 100;

    // Include gear stat bonuses in HP calculation
    const gearBonuses = resolveEquippedGearBonuses();
    const hpStatId    = hpStat?.id || 'health';
    const gearHpBonus = gearBonuses[hpStatId] ?? 0;
    const maxHpWithGear = Math.max(1, maxHp + gearHpBonus);
    const hp       = Math.max(0, Math.min(maxHpWithGear, us.health ?? maxHpWithGear));

    // Stagger defaults — overridden by encounter engine if a prior state exists.
    const maxStaggerResist = 20;
    const staggerResist    = maxStaggerResist;

    // Merge pre-computed stat sheet affinity modifiers + equipped gear affinity bonuses
    const ssAff      = extensionSettings.statSheet?.affinities?.modifiers ?? {};
    const gearAff    = resolveEquippedGearAffinities();
    const affinities = {};
    for (const dmgType of ['Slash', 'Blunt', 'Pierce']) {
        affinities[dmgType] = {
            damage:  (ssAff[dmgType]?.damage  ?? 0) + (gearAff[dmgType]?.damage  ?? 0),
            stagger: (ssAff[dmgType]?.stagger ?? 0) + (gearAff[dmgType]?.stagger ?? 0),
        };
    }

    return {
        hp,
        maxHp: maxHpWithGear,
        staggerResist,
        maxStaggerResist,
        affinities,
        isStaggered,
        savedDice: [],
    };
}

/**
 * Resolve a combat skill's dice into the flat spec objects expected by
 * resolveClash. The modifier object on each die is evaluated against live
 * stat-sheet data and collapsed to a plain number.
 *
 * @param {string} skillId
 * @returns {{ diceType: string, sides: number, modifier: number, multiplier: number, roundDown: boolean }[]}
 */
export function resolvePlayerDiceForSkillId(skillId) {
    const ss    = extensionSettings.statSheet;
    const skill = ss?.combatSkills?.find(s => s.id === skillId);
    if (!skill || !Array.isArray(skill.dice)) return [];

    return skill.dice.map(die => ({
        diceType:  die.diceType,
        sides:     die.sides,
        modifier:  _resolveModValue(die.modifier ?? { type: 'flat', flatValue: die.basePower ?? 0 }, ss),
        multiplier: die.multiplier ?? 1,
        roundDown:  die.roundDown  ?? false,
    }));
}

/**
 * Write the net HP and stagger-resist changes from a combat round back to
 * the player's persistent state.
 *
 * HP is written to extensionSettings.userStats.health and persisted via
 * saveSettings(). Stagger is managed entirely by the encounter engine and is
 * not written here.
 *
 * @param {number} hpDelta      — negative = damage taken, positive = healing
 * @param {number} staggerDelta — negative = stagger damage taken (unused here)
 */
export function writePlayerDeltas(hpDelta, staggerDelta) {
    const us     = extensionSettings.userStats;
    if (!us) return;

    const hpStat = extensionSettings.trackerConfig?.userStats?.customStats
                       ?.find(s => s.id === 'health');
    const maxHp  = hpStat?.maxValue ?? 100;

    us.health = Math.max(0, Math.min(maxHp, (us.health ?? maxHp) + hpDelta));
    saveSettings();
}

// ============================================================================
// ROLL CALCULATION
// ============================================================================

/**
 * Calculate the full roll modifier for an attribute + optional skill.
 *
 * Attribute modifier:
 *   numeric:    attr.value
 *   alphabetic: gradeValue(attr.rank) + floor(attr.rankValue ÷ attrValueDivisor)
 *
 * Skill modifier (added on top):
 *   numeric:    getSkillEffectiveLevel()   → skill.level or sub-skill sum
 *   alphabetic: gradeValue(skill.rank)     → grade base only
 *
 * @param {string} attributeId
 * @param {string} [skillId]
 * @returns {number}
 */
export function calculateRoll(attributeId, skillId) {
    const attr = getAttributeById(attributeId);
    if (!attr) return 0;

    const ss      = extensionSettings.statSheet;
    const mode    = ss.mode;
    const es      = ss.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    const attrMod = mode === 'numeric'
        ? (attr.value || 0)
        : (gvm[attr.rank] || 0) + Math.floor((attr.rankValue || 0) / divisor);

    if (!skillId) return attrMod;

    const skill = getSkillById(attributeId, skillId);
    if (!skill) return attrMod;

    const skillMod = skill.mode === 'alphabetic'
        ? (gvm[skill.rank] || 0)
        : getSkillEffectiveLevel(attributeId, skillId);

    return attrMod + skillMod;
}

// ============================================================================
// FEAT PREREQUISITES
// ============================================================================

/**
 * Check whether a feat's prerequisites are all met.
 * Returns { met: boolean, unmet: string[] } where unmet is a list of
 * human-readable strings describing what's missing.
 *
 * Prerequisite types:
 *   characterLevel — ss.level.current >= value
 *   attribute      — attr.value (or gradeValue) >= value
 *   jobLevel       — job.level >= value
 *   feat           — target feat is enabled
 */
export function checkFeatPrerequisites(featId) {
    const ss   = extensionSettings.statSheet;
    const feat = ss.feats?.find(f => f.id === featId);
    if (!feat || !Array.isArray(feat.prerequisites) || feat.prerequisites.length === 0) {
        return { met: true, unmet: [] };
    }

    const unmet = [];

    for (const req of feat.prerequisites) {
        if (req.type === 'characterLevel') {
            const current = ss.level?.current || 0;
            if (current < (req.value || 1)) {
                unmet.push(`Character Level ${req.value} (currently ${current})`);
            }

        } else if (req.type === 'attribute') {
            const attr = ss.attributes?.find(a => a.id === req.attrId && a.enabled);
            if (!attr) { unmet.push(`Attribute not found`); continue; }
            const mode    = ss.mode;
            const es      = ss.editorSettings;
            const current = mode === 'numeric'
                ? (attr.value || 0)
                : ((es?.gradeValueMap?.[attr.rank] || 0) + Math.floor((attr.rankValue || 0) / (es?.attrValueDivisor || 100)));
            if (current < (req.value || 0)) {
                unmet.push(`${attr.name} ≥ ${req.value} (currently ${current})`);
            }

        } else if (req.type === 'jobLevel') {
            const job = ss.jobs?.find(j => j.id === req.jobId);
            if (!job) { unmet.push(`Required job not found`); continue; }
            if ((job.level || 0) < (req.value || 1)) {
                unmet.push(`${job.name} Level ${req.value} (currently ${job.level || 0})`);
            }

        } else if (req.type === 'feat') {
            const reqFeat = ss.feats?.find(f => f.id === req.featId);
            if (!reqFeat || reqFeat.enabled === false) {
                unmet.push(`Feat: ${reqFeat?.name || '(unknown)'}`);
            }
        }
    }

    return { met: unmet.length === 0, unmet };
}
