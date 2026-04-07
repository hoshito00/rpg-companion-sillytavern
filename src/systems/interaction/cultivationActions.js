/**
 * Cultivation Actions Module  (Session 23)
 *
 * CRUD for the cultivation schema:
 *   - Spirit Roots  — nested inside cores (mindCore / bloodCore / energyCore)
 *   - Channels      — merged meridians + soul veins (type: 'meridian' | 'vein')
 *   - Techniques    — cultivation arts
 *   - Top-level cultivation fields (realm, pool, etc.)
 *
 * ⚠ OQ-13 still open: Spirit Root derivedFrom element chart / combination rules.
 * ⚠ OQ-15 still open: Realm lookup table — hardcoded vs GM-configurable.
 * ⚠ OQ-16 still open: Augment category migration default.
 * ⚠ OQ-17 still open: Hex side assignment UI (drag vs select).
 */

import { extensionSettings } from '../../core/state.js';
import { saveStatSheetData }  from '../../core/persistence.js';
import { generateUniqueId }   from '../statSheet/statSheetState.js';

// ============================================================================
// INTERNAL ACCESSORS
// ============================================================================

function _cult() {
    const ss = extensionSettings.statSheet;
    if (!ss.cultivation || typeof ss.cultivation !== 'object') {
        ss.cultivation = _emptyCultivation();
    }
    const c = ss.cultivation;
    // Lazily seed any missing top-level fields (safe on existing data)
    if (!c.cores || typeof c.cores !== 'object') {
        c.cores = _emptyCores();
    }
    for (const key of ['mindCore', 'bloodCore', 'energyCore']) {
        if (!c.cores[key]) c.cores[key] = { name: _defaultCoreName(key), spiritRoots: [] };
        if (!Array.isArray(c.cores[key].spiritRoots)) c.cores[key].spiritRoots = [];
    }
    if (!Array.isArray(c.channels))   c.channels   = [];
    if (!Array.isArray(c.techniques)) c.techniques = [];
    return c;
}

function _emptyCultivation() {
    return {
        primaryPath:        '',
        realm:              '',
        subStage:           0,
        currentPool:        0,
        threshold:          0,
        breakthroughChance: '',
        cultivationNotes:   '',
        cores:              _emptyCores(),
        channels:           [],
        techniques:         [],
    };
}

function _emptyCores() {
    return {
        mindCore:  { name: 'Mind Core',   spiritRoots: [] },
        bloodCore: { name: 'Blood Core',  spiritRoots: [] },
        energyCore:{ name: 'Energy Core', spiritRoots: [] },
    };
}

function _defaultCoreName(key) {
    return { mindCore: 'Mind Core', bloodCore: 'Blood Core', energyCore: 'Energy Core' }[key] || key;
}

/** Returns spirit roots for a specific core. */
function _coreRoots(coreKey) {
    return _cult().cores[coreKey]?.spiritRoots || [];
}

/** Returns all spirit roots across all three cores as a flat array (read-only). */
function _allRoots() {
    const c = _cult();
    return [
        ...(c.cores.mindCore?.spiritRoots  || []),
        ...(c.cores.bloodCore?.spiritRoots || []),
        ...(c.cores.energyCore?.spiritRoots|| []),
    ];
}

/** Finds a spirit root by id across all cores. Returns { root, coreKey } or null. */
function _findRoot(id) {
    for (const coreKey of ['mindCore', 'bloodCore', 'energyCore']) {
        const root = (_cult().cores[coreKey]?.spiritRoots || []).find(r => r.id === id);
        if (root) return { root, coreKey };
    }
    return null;
}

function _channels()  { return _cult().channels;   }
function _techniques(){ return _cult().techniques;  }

// ============================================================================
// CULTIVATION TOP-LEVEL FIELDS
// ============================================================================

/**
 * Update one or more top-level cultivation fields
 * (primaryPath, realm, subStage, currentPool, threshold, breakthroughChance, cultivationNotes).
 * @param {object} patch
 */
export function updateCultivation(patch) {
    const c = _cult();
    const allowed = ['primaryPath','realm','subStage','currentPool','threshold','breakthroughChance','cultivationNotes'];
    for (const key of allowed) {
        if (patch[key] !== undefined) c[key] = patch[key];
    }
    saveStatSheetData();
    return c;
}

/**
 * Rename a core slot.
 * @param {'mindCore'|'bloodCore'|'energyCore'} coreKey
 * @param {string} name
 */
export function renameCore(coreKey, name) {
    const c = _cult();
    if (!c.cores[coreKey]) return false;
    c.cores[coreKey].name = name;
    saveStatSheetData();
    return true;
}

// ============================================================================
// SPIRIT ROOTS
// ============================================================================

/**
 * Add a new Spirit Root to a core.
 * @param {object}  [overrides]
 * @param {'mindCore'|'bloodCore'|'energyCore'} [coreKey='energyCore']
 * @returns {object} the new root
 */
export function addSpiritRoot(overrides = {}, coreKey = 'energyCore') {
    const c = _cult();
    if (!c.cores[coreKey]) return null;
    const root = {
        id:             generateUniqueId(),
        name:           'New Spirit Root',
        element:        '',
        classification: 'pure',   // 'pure' | 'derivative'
        derivedFrom:    [],       // string[] — OQ-13
        quality:        5,        // 1–20
        purity:         5,        // 1–20
        hexSide:        null,     // 0–5 | null
        notes:          '',
        enabled:        true,
        ...overrides,
    };
    c.cores[coreKey].spiritRoots.push(root);
    saveStatSheetData();
    return root;
}

/**
 * Remove a Spirit Root by id (searches all cores).
 * Also nullifies technique links pointing to this root.
 * @param {string} id
 * @returns {boolean}
 */
export function removeSpiritRoot(id) {
    const found = _findRoot(id);
    if (!found) return false;
    const arr = _cult().cores[found.coreKey].spiritRoots;
    arr.splice(arr.findIndex(r => r.id === id), 1);
    for (const t of _techniques()) {
        if (t.linkedSpiritRootId === id) t.linkedSpiritRootId = '';
    }
    saveStatSheetData();
    return true;
}

/**
 * Update one or more fields on a Spirit Root.
 * @param {string} id
 * @param {object} patch
 * @returns {object|null}
 */
export function updateSpiritRoot(id, patch) {
    const found = _findRoot(id);
    if (!found) return null;
    Object.assign(found.root, patch);
    saveStatSheetData();
    return found.root;
}

/**
 * Move a Spirit Root from one core to another.
 * @param {string} id
 * @param {'mindCore'|'bloodCore'|'energyCore'} targetCoreKey
 * @returns {boolean}
 */
export function moveSpiritRoot(id, targetCoreKey) {
    const c     = _cult();
    const found = _findRoot(id);
    if (!found || found.coreKey === targetCoreKey) return false;
    const srcArr  = c.cores[found.coreKey].spiritRoots;
    const dstArr  = c.cores[targetCoreKey]?.spiritRoots;
    if (!dstArr) return false;
    srcArr.splice(srcArr.findIndex(r => r.id === id), 1);
    dstArr.push(found.root);
    saveStatSheetData();
    return true;
}

/**
 * Return a Spirit Root by id, or null (searches all cores).
 * @param {string} id
 * @returns {object|null}
 */
export function getSpiritRootById(id) {
    return _findRoot(id)?.root || null;
}

/**
 * Return all spirit roots across all cores as a flat array.
 * @returns {object[]}
 */
export function getAllRoots() {
    return _allRoots();
}

/**
 * Return spirit roots for a specific core.
 * @param {'mindCore'|'bloodCore'|'energyCore'} coreKey
 * @returns {object[]}
 */
export function getCoreRoots(coreKey) {
    return _coreRoots(coreKey);
}

// ============================================================================
// CHANNELS  (merged Meridians + Soul Veins)
// ============================================================================

const CHANNEL_STATUS_CYCLE = ['sealed', 'partial', 'open'];

/**
 * Add a new Channel (meridian or vein).
 * @param {object} [overrides]
 * @param {'meridian'|'vein'} [type='meridian']
 * @returns {object}
 */
export function addChannel(overrides = {}, type = 'meridian') {
    const channel = {
        id:              generateUniqueId(),
        name:            'New Channel',
        type,                              // 'meridian' | 'vein'
        element:         '',
        status:          'sealed',         // 'sealed' | 'partial' | 'open'
        unlockCondition: '',
        statBonuses:     [],
        notes:           '',
        ...overrides,
        type,   // type always wins over overrides spread
    };
    _cult().channels.push(channel);
    saveStatSheetData();
    return channel;
}

/**
 * Remove a Channel by id.
 * @param {string} id
 * @returns {boolean}
 */
export function removeChannel(id) {
    const channels = _channels();
    const idx = channels.findIndex(ch => ch.id === id);
    if (idx === -1) return false;
    channels.splice(idx, 1);
    saveStatSheetData();
    return true;
}

/**
 * Update one or more fields on a Channel.
 * @param {string} id
 * @param {object} patch
 * @returns {object|null}
 */
export function updateChannel(id, patch) {
    const ch = _channels().find(ch => ch.id === id);
    if (!ch) return null;
    Object.assign(ch, patch);
    saveStatSheetData();
    return ch;
}

/**
 * Cycle a Channel's status: sealed → partial → open → sealed.
 * @param {string} id
 * @returns {string|null} new status, or null if not found
 */
export function cycleChannelStatus(id) {
    const ch = _channels().find(ch => ch.id === id);
    if (!ch) return null;
    const idx = CHANNEL_STATUS_CYCLE.indexOf(ch.status);
    ch.status = CHANNEL_STATUS_CYCLE[(idx + 1) % CHANNEL_STATUS_CYCLE.length];
    saveStatSheetData();
    return ch.status;
}

/**
 * Add a stat bonus to a Channel.
 * @param {string} channelId
 * @returns {object|null}
 */
export function addChannelBonus(channelId) {
    const ch = _channels().find(ch => ch.id === channelId);
    if (!ch) return null;
    if (!Array.isArray(ch.statBonuses)) ch.statBonuses = [];
    const bonus = { id: generateUniqueId(), type: 'attribute', targetId: '', value: 1 };
    ch.statBonuses.push(bonus);
    saveStatSheetData();
    return bonus;
}

/**
 * Remove a stat bonus from a Channel.
 * @param {string} channelId
 * @param {string} bonusId
 * @returns {boolean}
 */
export function removeChannelBonus(channelId, bonusId) {
    const ch = _channels().find(ch => ch.id === channelId);
    if (!ch) return false;
    const idx = (ch.statBonuses || []).findIndex(b => b.id === bonusId);
    if (idx === -1) return false;
    ch.statBonuses.splice(idx, 1);
    saveStatSheetData();
    return true;
}

/**
 * Return a Channel by id, or null.
 * @param {string} id
 * @returns {object|null}
 */
export function getChannelById(id) {
    return _channels().find(ch => ch.id === id) || null;
}

// Backward-compat aliases (meridian terminology → channel calls)
export const addMeridian        = (ov) => addChannel(ov, 'meridian');
export const removeMeridian     = removeChannel;
export const updateMeridian     = updateChannel;
export const cycleMeridianStatus= cycleChannelStatus;
export const addMeridianBonus   = addChannelBonus;
export const removeMeridianBonus= removeChannelBonus;
export const getMeridianById    = getChannelById;

// ============================================================================
// CULTIVATION TECHNIQUES
// ============================================================================

/**
 * Add a new Cultivation Technique.
 * @param {object} [overrides]
 * @returns {object}
 */
export function addTechnique(overrides = {}) {
    const technique = {
        id:                 generateUniqueId(),
        name:               'New Technique',
        linkedSpiritRootId: '',
        element:            '',
        currentStage:       0,
        maxStages:          5,
        stagesConfig:       [],
        prerequisites:      '',
        notes:              '',
        enabled:            true,
        ...overrides,
    };
    _cult().techniques.push(technique);
    saveStatSheetData();
    return technique;
}

/**
 * Remove a Technique by id.
 * @param {string} id
 * @returns {boolean}
 */
export function removeTechnique(id) {
    const arr = _techniques();
    const idx = arr.findIndex(t => t.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    saveStatSheetData();
    return true;
}

/**
 * Update one or more fields on a Technique.
 * @param {string} id
 * @param {object} patch
 * @returns {object|null}
 */
export function updateTechnique(id, patch) {
    const t = _techniques().find(t => t.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    saveStatSheetData();
    return t;
}

/**
 * Advance a Technique's currentStage by 1, clamped to maxStages.
 */
export function advanceTechniqueStage(id) {
    const t = _techniques().find(t => t.id === id);
    if (!t) return null;
    t.currentStage = Math.min((t.currentStage || 0) + 1, t.maxStages || 0);
    saveStatSheetData();
    return { stage: t.currentStage, maxStages: t.maxStages };
}

/**
 * Regress a Technique's currentStage by 1, clamped to 0.
 */
export function regressTechniqueStage(id) {
    const t = _techniques().find(t => t.id === id);
    if (!t) return null;
    t.currentStage = Math.max(0, (t.currentStage || 0) - 1);
    saveStatSheetData();
    return { stage: t.currentStage, maxStages: t.maxStages };
}

/**
 * Add a stage config entry to a Technique.
 */
export function addTechniqueStage(techniqueId) {
    const t = _techniques().find(t => t.id === techniqueId);
    if (!t) return null;
    if (!Array.isArray(t.stagesConfig)) t.stagesConfig = [];
    const nextNum = t.stagesConfig.length + 1;
    const stage = {
        id:          generateUniqueId(),
        stage:       nextNum,
        name:        `Stage ${nextNum}`,
        description: '',
        statBonuses: [],
    };
    t.stagesConfig.push(stage);
    if (nextNum > (t.maxStages || 0)) t.maxStages = nextNum;
    saveStatSheetData();
    return stage;
}

/**
 * Remove a stage config entry from a Technique.
 */
export function removeTechniqueStage(techniqueId, stageId) {
    const t = _techniques().find(t => t.id === techniqueId);
    if (!t) return false;
    const idx = (t.stagesConfig || []).findIndex(s => s.id === stageId);
    if (idx === -1) return false;
    t.stagesConfig.splice(idx, 1);
    t.stagesConfig.forEach((s, i) => { s.stage = i + 1; });
    t.maxStages    = t.stagesConfig.length;
    t.currentStage = Math.min(t.currentStage || 0, t.maxStages);
    saveStatSheetData();
    return true;
}

/**
 * Add a stat bonus to a specific stage of a Technique.
 */
export function addStageBonus(techniqueId, stageId) {
    const t = _techniques().find(t => t.id === techniqueId);
    if (!t) return null;
    const stage = (t.stagesConfig || []).find(s => s.id === stageId);
    if (!stage) return null;
    if (!Array.isArray(stage.statBonuses)) stage.statBonuses = [];
    const bonus = { id: generateUniqueId(), type: 'attribute', targetId: '', value: 1 };
    stage.statBonuses.push(bonus);
    saveStatSheetData();
    return bonus;
}

/**
 * Remove a stat bonus from a specific stage.
 */
export function removeStageBonus(techniqueId, stageId, bonusId) {
    const t = _techniques().find(t => t.id === techniqueId);
    if (!t) return false;
    const stage = (t.stagesConfig || []).find(s => s.id === stageId);
    if (!stage) return false;
    const idx = (stage.statBonuses || []).findIndex(b => b.id === bonusId);
    if (idx === -1) return false;
    stage.statBonuses.splice(idx, 1);
    saveStatSheetData();
    return true;
}

/**
 * Return a Technique by id, or null.
 */
export function getTechniqueById(id) {
    return _techniques().find(t => t.id === id) || null;
}
