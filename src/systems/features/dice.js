/**
 * Dice System Module
 * Handles dice rolling logic, display updates, and quick reply integration
 */

import {
    extensionSettings,
    pendingDiceRoll,
    setPendingDiceRoll
} from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';

// Path assumes dice.js is in src/features/ and diceLog.js is in src/systems/interaction/
import { logDiceRoll } from '../../systems/interaction/diceLog.js';

/**
 * Rolls the dice and displays result.
 */
export async function rollDice(diceModal) {
    if (!diceModal) return;

    const count = parseInt(String($('#rpg-dice-count').val())) || 1;
    const sides = parseInt(String($('#rpg-dice-sides').val())) || 20;
    const label = $('#rpg-dice-label').val() || 'Roll';

    diceModal.startRolling();

    // Small delay for visual impact
    await new Promise(resolve => setTimeout(resolve, 800));

    const rollCommand = `/roll ${count}d${sides}`;
    const rollResult = await executeRollCommand(rollCommand);

    const total = rollResult.total || 0;
    const rolls = rollResult.rolls || [];

    diceModal.finishRolling(total, `${count}d${sides}`);

    const rollData = {
        formula: `${count}d${sides}`,
        total:   total,
        rolls:   rolls,
        label:   label
    };

    setPendingDiceRoll(rollData);

    // ── Immediately update the Last Roll display (Bug fix S25) ───────────────
    // Previously lastDiceRoll was only written inside addDiceQuickReply(), which
    // required the user to click "Add to chat" — so the sidebar display never
    // updated from a plain roll or a combat-skill roll.  Now it updates the
    // moment a roll resolves, regardless of what the user does next.
    extensionSettings.lastDiceRoll = { ...rollData };
    saveSettings();
    updateDiceDisplay();
}

/**
 * Executes a roll command via SillyTavern's command system
 */
export async function executeRollCommand(command) {
    try {
        const result = await eval('Generate')({
            prompt: command,
            action: 'roll'
        });
        return result; 
    } catch (e) {
        const [count, sides] = command.replace('/roll ', '').split('d').map(Number);
        const rolls = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
            const r = Math.floor(Math.random() * sides) + 1;
            rolls.push(r);
            total += r;
        }
        return { total, rolls };
    }
}

/**
 * Updates the dice display in the sidebar.
 */
export function updateDiceDisplay() {
    const $display = $('#rpg-dice-display');
    if (!extensionSettings.showDiceDisplay) {
        $display.hide();
        return;
    } else {
        $display.show();
    }

    const lastRoll = extensionSettings.lastDiceRoll;
    const label = i18n.getTranslation('template.mainPanel.lastRoll') || 'Last Roll: ';
    
    if (lastRoll) {
        $('#rpg-last-roll-text').text(`${label}(${lastRoll.formula}): ${lastRoll.total}`);
    } else {
        $('#rpg-last-roll-text').text(label + 'None');
    }
}

/**
 * Commits the pending dice roll to the history log and clears the pending state.
 * The "append roll text to chat textarea" behaviour has been removed (Session 25)
 * because it fired on every roll and inserted unwanted text mid-message.
 *
 * lastDiceRoll and the sidebar display are already updated in rollDice(), so
 * this function only needs to persist the log entry and clear the pending roll.
 */
export function addDiceQuickReply() {
    if (!pendingDiceRoll || pendingDiceRoll.total === undefined) {
        console.warn('No pending dice roll to add.');
        return;
    }

    if (typeof logDiceRoll === 'function') {
        logDiceRoll(
            pendingDiceRoll.formula,
            pendingDiceRoll.total,
            pendingDiceRoll.rolls,
            pendingDiceRoll.label
        );
    }

    setPendingDiceRoll(null);
}

/**
 * Clears the last dice roll.
 */
export function clearDiceRoll() {
    extensionSettings.lastDiceRoll = null;
    saveSettings();
    updateDiceDisplay();
}
