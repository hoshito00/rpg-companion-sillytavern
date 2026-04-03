/**
 * Dice Log Module (Session 14)
 * Handles the history of all dice rolls, persisting them to extensionSettings.
 */

import { extensionSettings } from '../../core/state.js';
import { saveStatSheetData } from '../../core/persistence.js';

const MAX_LOG_SIZE = 50;

/**
 * Ensures the diceLog array exists in settings.
 * @returns {Array}
 */
function _getLog() {
    if (!extensionSettings.statSheet) extensionSettings.statSheet = {};
    if (!Array.isArray(extensionSettings.statSheet.diceLog)) {
        extensionSettings.statSheet.diceLog = [];
    }
    return extensionSettings.statSheet.diceLog;
}

/**
 * Add a dice roll to the persistent log.
 * @param {string} formula - e.g., "2d6+4"
 * @param {number} total - The final result
 * @param {Array<number>} rolls - Individual die results
 * @param {string} [label] - Optional context (e.g., "Attack Roll")
 */
export function logDiceRoll(formula, total, rolls, label = 'Roll') {
    const log = _getLog();
    
    const entry = {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        label,
        formula,
        total,
        rolls: Array.isArray(rolls) ? rolls : [],
    };

    log.unshift(entry); // Add to start so newest is index 0

    // Trim log to max size
    if (log.length > MAX_LOG_SIZE) {
        extensionSettings.statSheet.diceLog = log.slice(0, MAX_LOG_SIZE);
    }

    saveStatSheetData();
    return entry;
}

/**
 * Returns the full dice history.
 */
export function getDiceLog() {
    return _getLog();
}

/**
 * Returns the most recent N rolls.
 */
export function getRecentRolls(count = 10) {
    return _getLog().slice(0, count);
}

/**
 * Clears the history.
 */
export function clearDiceLog() {
    if (extensionSettings.statSheet) {
        extensionSettings.statSheet.diceLog = [];
        saveStatSheetData();
    }
}

/**
 * Formats a log entry for display.
 * @param {Object} entry 
 */
export function formatLogEntry(entry) {
    if (!entry) return '';
    const diceStr = entry.rolls.length > 0 ? `[${entry.rolls.join(', ')}]` : '';
    return `${entry.label}: ${entry.formula} ${diceStr} = ${entry.total}`;
}
