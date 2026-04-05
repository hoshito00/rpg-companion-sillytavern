/**
 * Encounter State Module
 * Manages combat encounter state and history.
 *
 * Session 7 additions:
 *   - light        { current, max, regenPerScene }
 *   - sanity       { current }
 *   - sanityLevel  number  (−3 to +5)
 *   - corrosion    { active, turnsInCorrosion }
 *   - scene
 *   - selectedSkill  id of the combat skill used this round
 *   - playerActions  cached from last AI response
 */

import { LIGHT_DEFAULT_MAX } from '../statSheet/lightSystem.js';

// ── Default factory ───────────────────────────────────────────────────────────

/**
 * Create a fresh SotC engine state sub-object.
 * Stored under currentEncounter.engineState.
 *
 * CombatantEngineState (per combatant, keyed by name):
 * {
 *   name, hp, maxHp,
 *   staggerResist, maxStaggerResist,
 *   isStaggered, staggeredAtRound,
 *   affinities: { [diceType]: { damage: number, stagger: number } },
 *   savedDice:  { die, storedRoll, roundSaved }[]
 * }
 */
export function _defaultEngineState() {
    return {
        roundNumber      : 0,
        initiativeQueue  : [],   // [ 'PlayerName', 'EnemyName', ... ]
        initiativeRolls  : {},   // { [name]: number }
        combatants       : {},   // { [name]: CombatantEngineState }
        pendingEnemyDice : {},   // { [enemyName]: { [skillName]: DieSpec[] } }
        roundClashLog    : [],   // { playerName, enemyName, skillName, enemySkill, report }[]
    };
}

function _defaultEncounter() {
    return {
        active: false,
        initialized: false,
        combatHistory: [],
        combatStats: null,
        preEncounterContext: [],
        encounterStartMessage: '',
        encounterLog: [],
        playerActions: null,

        // ── Session 7 fields ──────────────────────────────────────────────────
        light: { current: LIGHT_DEFAULT_MAX, max: LIGHT_DEFAULT_MAX, regenPerScene: LIGHT_DEFAULT_MAX },
        sanity: { current: 0 },
        sanityLevel: 0,
        corrosion: { active: false, turnsInCorrosion: 0 },
        scene: 1,
        selectedSkill: null,   // id of the combat skill chosen this round

        // ── Morale (replaces per-die sanity from clash wins/losses) ───────────
        morale: 0,

        // ── SotC engine state (Rev 3) ─────────────────────────────────────────
        engineState: _defaultEngineState(),
    };
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Current encounter state.
 */
export let currentEncounter = _defaultEncounter();

/**
 * Per-chat encounter log storage.
 */
export let encounterLogs = {};

// ── Setters ───────────────────────────────────────────────────────────────────

/**
 * Replace the entire encounter state.
 * @param {object} encounter
 */
export function setCurrentEncounter(encounter) {
    currentEncounter = encounter;
}

/**
 * Merge partial updates into the current encounter state.
 * @param {object} updates
 */
export function updateCurrentEncounter(updates) {
    Object.assign(currentEncounter, updates);
}

/**
 * Reset the encounter to its default (empty) state.
 * Called when the encounter modal is closed.
 */
export function resetEncounter() {
    currentEncounter = _defaultEncounter();
}

// ── Log helpers ───────────────────────────────────────────────────────────────

/**
 * Push a message into combat history.
 * @param {'user'|'assistant'|'system'} role
 * @param {string} content
 */
export function addCombatMessage(role, content) {
    currentEncounter.combatHistory.push({ role, content });
}

/**
 * Push an entry into the encounter action log (used for end-of-combat summary).
 * @param {string} action
 * @param {string} result
 */
export function addEncounterLogEntry(action, result) {
    currentEncounter.encounterLog.push({
        timestamp: Date.now(),
        action,
        result,
    });
}

// ── Persistent log (per chat) ─────────────────────────────────────────────────

/**
 * Save a completed encounter log under a chatId.
 * @param {string} chatId
 * @param {{ log: Array, summary: string, result: string }} logData
 */
export function saveEncounterLog(chatId, logData) {
    if (!encounterLogs[chatId]) encounterLogs[chatId] = [];
    encounterLogs[chatId].push({
        timestamp: new Date(),
        log:       logData.log     || [],
        summary:   logData.summary || '',
        result:    logData.result  || 'unknown',
    });
}

/**
 * @param {string} chatId
 * @returns {Array}
 */
export function getEncounterLogs(chatId) {
    return encounterLogs[chatId] || [];
}

/**
 * @param {string} chatId
 */
export function clearEncounterLogs(chatId) {
    delete encounterLogs[chatId];
}

/**
 * @param {string} chatId
 * @returns {string}  JSON
 */
export function exportEncounterLogs(chatId) {
    return JSON.stringify(getEncounterLogs(chatId), null, 2);
}

// ── SotC Engine State helpers (Rev 3) ─────────────────────────────────────────

/**
 * Clear transient per-round data without touching HP / stagger / affinities.
 * Call at the start of each new round, before queuing new enemy dice.
 */
export function resetEngineRoundState() {
    const es = currentEncounter.engineState;
    if (!es) return;
    es.initiativeQueue  = [];
    es.initiativeRolls  = {};
    es.pendingEnemyDice = {};
    es.roundClashLog    = [];
}

/**
 * Register or update a combatant in engineState.combatants.
 * Safe to call multiple times — merges over the existing entry.
 *
 * @param {string} name
 * @param {object} data  — partial CombatantEngineState
 */
export function upsertCombatant(name, data) {
    const es = currentEncounter.engineState;
    if (!es) return;

    if (!es.combatants[name]) {
        es.combatants[name] = {
            name,
            hp               : data.hp               ?? 100,
            maxHp            : data.maxHp             ?? data.hp ?? 100,
            staggerResist    : data.staggerResist     ?? 20,
            maxStaggerResist : data.maxStaggerResist  ?? data.staggerResist ?? 20,
            isStaggered      : false,
            staggeredAtRound : null,
            affinities       : data.affinities        ?? {},
            savedDice        : [],
            morale           : 0,
        };
    } else {
        Object.assign(es.combatants[name], data);
    }
}

/**
 * Return a live (mutable) reference to a combatant's engine state, or null.
 * @param {string} name
 * @returns {object|null}
 */
export function getCombatantState(name) {
    return currentEncounter.engineState?.combatants[name] ?? null;
}

/**
 * Add a parsed die spec from an <enemy_action> tag to the pending queue.
 * Multiple calls for the same enemy+skill accumulate (multi-die skills).
 *
 * @param {string} enemyName
 * @param {string} skillName
 * @param {{ diceType: string, sides: number, modifier: number }} dieSpec
 */
export function queueEnemyDie(enemyName, skillName, dieSpec) {
    const es = currentEncounter.engineState;
    if (!es) return;
    if (!es.pendingEnemyDice[enemyName])            es.pendingEnemyDice[enemyName] = {};
    if (!es.pendingEnemyDice[enemyName][skillName]) es.pendingEnemyDice[enemyName][skillName] = [];
    es.pendingEnemyDice[enemyName][skillName].push(dieSpec);
}

/**
 * Retrieve and clear all pending dice for a specific enemy skill.
 * @param {string} enemyName
 * @param {string} skillName
 * @returns {{ diceType: string, sides: number, modifier: number }[]}
 */
export function consumeEnemyDice(enemyName, skillName) {
    const es = currentEncounter.engineState;
    if (!es?.pendingEnemyDice[enemyName]?.[skillName]) return [];
    const dice = es.pendingEnemyDice[enemyName][skillName];
    delete es.pendingEnemyDice[enemyName][skillName];
    if (Object.keys(es.pendingEnemyDice[enemyName]).length === 0) {
        delete es.pendingEnemyDice[enemyName];
    }
    return dice;
}

/**
 * Return all pending enemy dice as a flat list.
 * @returns {{ enemyName: string, skillName: string, dice: object[] }[]}
 */
export function getAllPendingEnemyDice() {
    const es = currentEncounter.engineState;
    if (!es) return [];
    const result = [];
    for (const [enemyName, skills] of Object.entries(es.pendingEnemyDice)) {
        for (const [skillName, dice] of Object.entries(skills)) {
            result.push({ enemyName, skillName, dice: [...dice] });
        }
    }
    return result;
}

/**
 * Record a completed clash report into the round log.
 * @param {string} playerName
 * @param {string} enemyName
 * @param {string} skillName   — player skill name
 * @param {string} enemySkill  — enemy skill name
 * @param {object} report      — ClashReport from clashEngine.js
 */
export function logClash(playerName, enemyName, skillName, enemySkill, report) {
    const es = currentEncounter.engineState;
    if (!es) return;
    es.roundClashLog.push({ playerName, enemyName, skillName, enemySkill, report });
}

/**
 * Expire all saved dice for a combatant (call at round start).
 * @param {string} combatantName
 */
export function expireSavedDice(combatantName) {
    const state = getCombatantState(combatantName);
    if (state) state.savedDice = [];
}

/**
 * Sync HP values from combatStats (AI JSON) into engine state.
 * Only updates HP — stagger and affinities are engine-managed.
 * @param {object} combatStats
 */
export function syncHpFromCombatStats(combatStats) {
    const es = currentEncounter.engineState;
    if (!es || !combatStats) return;
    for (const member of (combatStats.party ?? [])) {
        if (es.combatants[member.name]) {
            es.combatants[member.name].hp    = member.hp;
            es.combatants[member.name].maxHp = member.maxHp;
        }
    }
    for (const enemy of (combatStats.enemies ?? [])) {
        if (es.combatants[enemy.name]) {
            es.combatants[enemy.name].hp    = enemy.hp;
            es.combatants[enemy.name].maxHp = enemy.maxHp;
        }
    }
}
