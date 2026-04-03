/**
 * Modal Management Module  (Rewrite — Session 15)
 *
 * Manages three modals:
 *   • DiceModal     — dice roller with persistent roll log (diceLog integration)
 *   • SettingsModal — extension settings popup (#rpg-settings-popup)
 *   • WelcomeModal  — first-run v3 welcome screen (#rpg-welcome-modal)
 *
 * Deploy path: src/systems/ui/modals.js
 */

import { extensionSettings, getPendingDiceRoll, setPendingDiceRoll } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';
import {
    rollDice       as _rollDice,
    updateDiceDisplay as _updateDiceDisplay,
    addDiceQuickReply as _addDiceQuickReply,
    clearDiceRoll  as _clearDiceRoll,
} from '../features/dice.js';
import { logDiceRoll, getRecentRolls, clearDiceLog } from '../interaction/diceLog.js';

// ── Re-exports (index.js imports these directly from this module) ─────────────

export { _updateDiceDisplay  as updateDiceDisplay  };
export { _addDiceQuickReply  as addDiceQuickReply  };

// ── Module-level singleton for SettingsModal ──────────────────────────────────

/** @type {SettingsModal|null} */
let _settingsModalInstance = null;

/**
 * Returns the SettingsModal singleton.
 * Safe to call before setupSettingsPopup() — returns null if not yet created.
 * index.js calls this inside event handlers that fire after init, so null
 * will never be reached in normal operation.
 * @returns {SettingsModal|null}
 */
export function getSettingsModal() {
    return _settingsModalInstance;
}

// ── WelcomeModal ──────────────────────────────────────────────────────────────

/**
 * First-run welcome modal for v3.0.
 * Shown once per version bump, then suppressed via extensionSettings.lastVersionRun.
 */
class WelcomeModal {
    constructor() {
        /** @type {HTMLElement|null} */
        this.modal = document.getElementById('rpg-welcome-modal');
        this._attachListeners();
    }

    _attachListeners() {
        // X button in header
        document.getElementById('rpg-welcome-close')
            ?.addEventListener('click', () => this.close());

        // "Got it!" button in footer
        document.getElementById('rpg-welcome-got-it')
            ?.addEventListener('click', () => this.close());

        // Clicking the backdrop also closes
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    open() {
        if (!this.modal) return;
        this.modal.style.display = 'flex';
        this.modal.classList.add('is-open');
    }

    close() {
        if (!this.modal) return;
        this.modal.classList.remove('is-open');
        setTimeout(() => {
            if (this.modal) this.modal.style.display = 'none';
        }, 200);
    }
}

/**
 * Show the v3.0 welcome modal on first launch after an update.
 * Called during extension init — safe to call multiple times.
 */
export function showWelcomeModalIfNeeded() {
    const CURRENT_VERSION = '3.0.0';
    if (extensionSettings.lastVersionRun !== CURRENT_VERSION) {
        const welcome = new WelcomeModal();
        welcome.open();
        extensionSettings.lastVersionRun = CURRENT_VERSION;
        saveSettings();
    }
}

// ── DiceModal ─────────────────────────────────────────────────────────────────

/**
 * Dice roller modal with persistent roll log.
 *
 * Integrates with:
 *   • dice.js  — rolling logic and display updates
 *   • diceLog.js — persistent per-chat roll history
 */
export class DiceModal {
    constructor() {
        /** @type {HTMLElement|null} */
        this.modal = document.getElementById('rpg-dice-popup');
        this._attachListeners();
    }

    _attachListeners() {
        // Close button
        document.getElementById('rpg-dice-popup-close')
            ?.addEventListener('click', () => this.close());

        // Roll button
        document.getElementById('rpg-dice-roll-btn')
            ?.addEventListener('click', () => _rollDice(this));

        // "Save Roll" — write the pending roll into the persistent log
        document.getElementById('rpg-dice-save-btn')
            ?.addEventListener('click', () => {
                const pending = getPendingDiceRoll();
                if (!pending) return;
                logDiceRoll(
                    pending.formula,
                    pending.total,
                    pending.rolls ?? [],
                    pending.label  ?? 'Manual Roll'
                );
                this._renderLog();
                toastr.success('Roll saved to log');
            });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal?.classList.contains('is-open')) {
                this.close();
            }
        });

        // Clicking backdrop closes
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    open() {
        if (!this.modal) return;
        this.modal.style.display = 'flex';
        this.modal.classList.add('is-open');
        this._renderLog();
        _updateDiceDisplay();
    }

    close() {
        if (!this.modal) return;
        this.modal.classList.remove('is-open');
        setTimeout(() => {
            if (this.modal) this.modal.style.display = 'none';
        }, 200);
    }

    // Called by dice.js → rollDice() at the start of an animation
    startRolling() {
        const $anim   = $('#rpg-dice-animation');
        const $result = $('#rpg-dice-result');
        $anim.removeAttr('hidden');
        $result.attr('hidden', true);
        $('#rpg-dice-roll-btn').prop('disabled', true);
    }

    // Called by dice.js → rollDice() when the roll resolves
    finishRolling(total, formula) {
        const $anim   = $('#rpg-dice-animation');
        const $result = $('#rpg-dice-result');
        $anim.attr('hidden', true);
        $result.removeAttr('hidden');
        $('#rpg-dice-result-value').text(total);
        $('#rpg-dice-roll-btn').prop('disabled', false);
    }

    // ── Log rendering ─────────────────────────────────────────────────────────

    /**
     * Re-render the roll history list if the template provides a container for it.
     * Silently no-ops if the element is absent — the log is still written to diceLog.js.
     */
    _renderLog() {
        const $log = $('#rpg-dice-history-list');
        if (!$log.length) return;

        const rolls = getRecentRolls(20);

        if (rolls.length === 0) {
            $log.html('<div class="dice-log-empty">No recent rolls</div>');
            return;
        }

        const html = rolls.map(entry => `
            <div class="dice-log-item">
                <div class="dice-log-meta">
                    <span class="dice-log-label">${_esc(entry.label)}</span>
                    <span class="dice-log-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="dice-log-details">
                    <span class="dice-log-formula">${_esc(entry.formula)}</span>
                    <span class="dice-log-total">${entry.total}</span>
                </div>
            </div>
        `).join('');

        $log.html(html);
    }

    // Public alias so any callers using the old name still work
    updateLogDisplay() { this._renderLog(); }
}

// ── SettingsModal ─────────────────────────────────────────────────────────────

/**
 * Manages the #rpg-settings-popup panel.
 *
 * Responsibilities:
 *   • Open / close the popup
 *   • Sync all checkbox / select / input controls to extensionSettings on open
 *   • Expose .popup for updateSettingsPopupTheme() in theme.js
 *
 * All heavy event wiring (theme changes, toggles, etc.) lives in index.js
 * and fires independently — SettingsModal does not duplicate that logic.
 */
export class SettingsModal {
    constructor() {
        /** @type {HTMLElement|null} The root popup element. */
        this.popup = document.getElementById('rpg-settings-popup');
        this._attachListeners();
    }

    _attachListeners() {
        // Open button in the main panel
        $(document).on('click', '#rpg-open-settings', () => this.open());

        // Close button inside the popup
        $(document).on('click', '#rpg-close-settings', () => this.close());

        // Clicking the backdrop closes
        $(document).on('click', '#rpg-settings-popup', (e) => {
            if ($(e.target).is('#rpg-settings-popup')) this.close();
        });

        // Escape key
        $(document).on('keydown', (e) => {
            if (e.key === 'Escape' && this.popup?.classList.contains('is-open')) {
                this.close();
            }
        });
    }

    open() {
        if (!this.popup) return;
        this._syncToUI();
        this.popup.style.display = 'flex';
        this.popup.classList.add('is-open');
    }

    close() {
        if (!this.popup) return;
        this.popup.classList.remove('is-open');
        setTimeout(() => {
            if (this.popup) this.popup.style.display = 'none';
        }, 200);
    }

    // ── UI sync ───────────────────────────────────────────────────────────────

    /**
     * Push current extensionSettings values into every control in the popup
     * so they always reflect reality when the panel opens.
     */
    _syncToUI() {
        const s = extensionSettings;
        if (!s) return;

        // Theme
        _setVal('#rpg-theme-select',           s.theme                  ?? 'default');

        // Custom colours
        _setVal('#rpg-custom-bg',              s.customColors?.bg        ?? '#1a1a2e');
        _setVal('#rpg-custom-bg-opacity',      s.customColors?.bgOpacity ?? 100);
        _setText('#rpg-custom-bg-opacity-value', (s.customColors?.bgOpacity ?? 100) + '%');

        _setVal('#rpg-custom-accent',          s.customColors?.accent        ?? '#16213e');
        _setVal('#rpg-custom-accent-opacity',  s.customColors?.accentOpacity ?? 100);
        _setText('#rpg-custom-accent-opacity-value', (s.customColors?.accentOpacity ?? 100) + '%');

        _setVal('#rpg-custom-text',            s.customColors?.text        ?? '#eaeaea');
        _setVal('#rpg-custom-text-opacity',    s.customColors?.textOpacity ?? 100);
        _setText('#rpg-custom-text-opacity-value', (s.customColors?.textOpacity ?? 100) + '%');

        _setVal('#rpg-custom-highlight',       s.customColors?.highlight        ?? '#e94560');
        _setVal('#rpg-custom-highlight-opacity', s.customColors?.highlightOpacity ?? 100);
        _setText('#rpg-custom-highlight-opacity-value', (s.customColors?.highlightOpacity ?? 100) + '%');

        // Stat bar colours
        _setVal('#rpg-stat-bar-color-low',          s.statBarColorLow       ?? '#cc3333');
        _setVal('#rpg-stat-bar-color-low-opacity',  s.statBarColorLowOpacity  ?? 100);
        _setText('#rpg-stat-bar-color-low-opacity-value', (s.statBarColorLowOpacity ?? 100) + '%');

        _setVal('#rpg-stat-bar-color-high',         s.statBarColorHigh      ?? '#33cc66');
        _setVal('#rpg-stat-bar-color-high-opacity', s.statBarColorHighOpacity ?? 100);
        _setText('#rpg-stat-bar-color-high-opacity-value', (s.statBarColorHighOpacity ?? 100) + '%');

        // Panel position
        _setVal('#rpg-position-select', s.panelPosition ?? 'right');

        // Display toggles
        _setChecked('#rpg-toggle-user-stats',          s.showUserStats          ?? true);
        _setChecked('#rpg-toggle-info-box',            s.showInfoBox            ?? true);
        _setChecked('#rpg-toggle-thoughts',            s.showThoughts           ?? true);
        _setChecked('#rpg-toggle-inventory',           s.showInventory          ?? true);
        _setChecked('#rpg-toggle-quests',              s.showQuests             ?? true);
        _setChecked('#rpg-toggle-music-player',        s.showMusicPlayer        ?? false);
        _setChecked('#rpg-toggle-show-narrator-mode',  s.showNarratorMode       ?? false);
        _setChecked('#rpg-toggle-show-auto-avatars',   s.showAutoAvatars        ?? false);
        _setChecked('#rpg-toggle-randomized-plot',     s.showRandomizedPlot     ?? true);
        _setChecked('#rpg-toggle-natural-plot',        s.showNaturalPlot        ?? true);
        _setChecked('#rpg-toggle-encounters',          s.showEncounters         ?? true);
        _setChecked('#rpg-toggle-dice-display',        s.showDiceDisplay        ?? true);

        // Mobile FAB widgets
        _setChecked('#rpg-toggle-fab-widgets-enabled', s.fabWidgets?.enabled    ?? false);
        _setChecked('#rpg-toggle-fab-weather-icon',    s.fabWidgets?.weatherIcon ?? false);
        _setChecked('#rpg-toggle-fab-weather-desc',    s.fabWidgets?.weatherDesc ?? false);
        _setChecked('#rpg-toggle-fab-clock',           s.fabWidgets?.clock       ?? false);
        _setChecked('#rpg-toggle-fab-date',            s.fabWidgets?.date        ?? false);
        _setChecked('#rpg-toggle-fab-location',        s.fabWidgets?.location    ?? false);
        _setChecked('#rpg-toggle-fab-stats',           s.fabWidgets?.stats       ?? false);
        _setChecked('#rpg-toggle-fab-attributes',      s.fabWidgets?.attributes  ?? false);

        // Show / hide custom colour block based on current theme
        if (s.theme === 'custom') {
            $('#rpg-custom-colors').show();
        } else {
            $('#rpg-custom-colors').hide();
        }
    }
}

// ── Setup helpers (called by index.js during init) ────────────────────────────

/**
 * Create the DiceModal and wire the open button.
 * @returns {DiceModal}
 */
export function setupDiceRoller() {
    const diceModal = new DiceModal();

    // #rpg-dice-display is the "Last Roll" bar — clicking it opens the popup
    $(document).on('click', '#rpg-dice-display', () => diceModal.open());

    return diceModal;
}

/**
 * Create the SettingsModal singleton and store it for getSettingsModal().
 * @returns {SettingsModal}
 */
export function setupSettingsPopup() {
    _settingsModalInstance = new SettingsModal();
    return _settingsModalInstance;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Set an input/select value safely. */
function _setVal(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.value = value;
}

/** Set a checkbox checked state safely. */
function _setChecked(selector, checked) {
    const el = document.querySelector(selector);
    if (el) el.checked = Boolean(checked);
}

/** Set text content safely. */
function _setText(selector, text) {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
}

/** Minimal HTML escape for log entry strings. */
function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
