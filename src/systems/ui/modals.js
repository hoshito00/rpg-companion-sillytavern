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

        // "Clear History" — wipe the persistent log and refresh display
        document.getElementById('rpg-dice-clear-log')
            ?.addEventListener('click', () => {
                clearDiceLog();
                this._renderLog();
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

// ── SkillDeckModal ────────────────────────────────────────────────────────────

/**
 * Combat Skill Deck popup.
 *
 * Shows the player's equipped combat skill cards with dice chips and a
 * per-card Roll button.  Rolling stamps a <roll_result> block into the
 * chat textarea ready to send — no encounter required.
 *
 * HTML anchor: #rpg-skill-deck-popup  (added to template.html)
 * Trigger button: #rpg-skill-deck-btn (appended to #rpg-plot-buttons)
 */
export class SkillDeckModal {
    constructor() {
        /** @type {HTMLElement|null} */
        this.modal = document.getElementById('rpg-skill-deck-popup');
        this._attachListeners();
    }

    _attachListeners() {
        // Close button
        document.getElementById('rpg-skill-deck-close')
            ?.addEventListener('click', () => this.close());

        // Escape key
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.modal?.classList.contains('is-open')) {
                this.close();
            }
        });

        // Click outside the panel to dismiss (deferred so the open-click doesn't count)
        document.addEventListener('click', e => {
            if (!this.modal?.classList.contains('is-open')) return;
            if (!this.modal.contains(e.target) && !e.target.closest('#rpg-skill-deck-btn')) {
                this.close();
            }
        });

        // Roll button clicks (delegated — cards are rendered dynamically)
        this.modal?.addEventListener('click', e => {
            const btn = e.target.closest('.sdc-roll-btn');
            if (!btn) return;
            const skillId = btn.dataset.skillId;
            this._rollSkill(skillId);
        });
    }

    open() {
        if (!this.modal) return;
        this._renderDeck();
        this.modal.style.display = 'block';

        // Position above the trigger button using its actual location
        const btn  = document.getElementById('rpg-skill-deck-btn');
        if (btn) {
            const rect    = btn.getBoundingClientRect();
            const popW    = Math.min(420, window.innerWidth - 24);
            // Centre the popup over the button, clamped to viewport edges
            let   left    = rect.left + rect.width / 2 - popW / 2;
            left          = Math.max(12, Math.min(left, window.innerWidth - popW - 12));
            const bottom  = window.innerHeight - rect.top + 8;
            this.modal.style.left   = `${left}px`;
            this.modal.style.bottom = `${bottom}px`;
            this.modal.style.width  = `${popW}px`;
            // Remove the centering transform now that left is set explicitly
            this.modal.style.transform = 'translateY(14px)';
        }

        // Force reflow so the CSS transition fires from the start state
        void this.modal.offsetHeight;
        this.modal.classList.add('is-open');
    }

    close() {
        if (!this.modal) return;
        this.modal.classList.remove('is-open');
        // Wait for the CSS transition to finish before hiding
        setTimeout(() => {
            if (this.modal && !this.modal.classList.contains('is-open')) {
                this.modal.style.display = 'none';
            }
        }, 260);
    }

    // ── Deck rendering ────────────────────────────────────────────────────────

    _renderDeck() {
        const body = this.modal?.querySelector('#rpg-skill-deck-body');
        if (!body) return;

        const ss       = extensionSettings?.statSheet;
        const equipped = (ss?.combatSkills ?? []).filter(s => s.equipped);

        if (!equipped.length) {
            body.innerHTML = `
                <div class="sdc-empty">
                    <i class="fa-solid fa-layer-group"></i>
                    <p>No combat skills equipped.</p>
                    <p class="sdc-empty-hint">Open the Stat Sheet → Combat Skills tab to equip skills.</p>
                </div>`;
            return;
        }

        body.innerHTML = equipped.map(skill => this._buildCard(skill)).join('');
    }

    _buildCard(skill) {
        const isEGO    = skill.isEGO ?? false;
        const tierKey  = (skill.egoTier ?? 'ZAYIN').toLowerCase();
        const cost     = skill.cost ?? 0;

        const egoBadge = isEGO
            ? `<span class="sdc-ego-badge sdc-ego-${tierKey}">${skill.egoTier}</span>`
            : '';

        const pips = '💡'.repeat(Math.min(cost, 6));

        const diceChips = (skill.dice ?? []).map(d => {
            const cls = _sdcDieClass(d.diceType);
            const mod = _sdcModStr(d.modifier?.flatValue ?? d.basePower ?? 0);
            return `<span class="cs-die-chip ${cls}">${_esc(d.diceType || '?')} d${d.sides || 6}${mod}</span>`;
        }).join('');

        const notes = skill.notes
            ? `<div class="sdc-card-notes">${_esc(skill.notes)}</div>`
            : '';

        return `
            <div class="sdc-card${isEGO ? ' sdc-card-ego' : ''}">
                <div class="sdc-card-header">
                    <div class="sdc-card-title">
                        ${egoBadge}
                        <span class="sdc-card-name">${_esc(skill.name)}</span>
                    </div>
                    <span class="sdc-card-cost" title="Light cost">${pips || '—'}</span>
                </div>
                ${diceChips ? `<div class="sdc-card-dice">${diceChips}</div>` : ''}
                ${notes}
                <button class="sdc-roll-btn" data-skill-id="${_esc(skill.id)}"
                        title="Roll all dice for this skill">
                    <i class="fa-solid fa-dice" aria-hidden="true"></i> Roll
                </button>
            </div>`;
    }

    // ── Roll logic ────────────────────────────────────────────────────────────

    _rollSkill(skillId) {
        const ss    = extensionSettings?.statSheet;
        const skill = (ss?.combatSkills ?? []).find(s => s.id === skillId);
        if (!skill?.dice?.length) return;

        const results = skill.dice.map(die => {
            const mod    = _sdcResolveMod(die.modifier, ss);
            const raw    = Math.floor(Math.random() * (die.sides || 6)) + 1;
            const total  = raw + mod;
            return { die, raw, total, mod };
        });

        // ── Log as one grouped entry ──────────────────────────────────────────
        const groupFormula = results.map(r => {
            const ms = _sdcModStr(r.mod);
            return `1d${r.die.sides}${ms}`;
        }).join(' / ');
        const groupTotal = results.reduce((s, r) => s + r.total, 0);
        logDiceRoll(groupFormula, groupTotal, results.map(r => r.raw), skill.name);

        // ── Build <roll_result> block for the textarea ────────────────────────
        const playerName = extensionSettings?.characterName || 'Player';
        const dieLines   = results.map(r => {
            const ms  = _sdcModStr(r.mod);
            const isCrit = r.raw === r.die.sides;
            const isFail = r.raw === 1;
            const flag   = isCrit ? ' ✨ CRIT' : isFail ? ' 💀 FAIL' : '';
            return `  ${r.die.diceType} 1d${r.die.sides}${ms}: [${r.raw}]${ms ? ` ${ms.startsWith('+') ? '' : ''}= ${r.total}` : ''} ${flag}`;
        }).join('\n');

        const rollResultBlock =
`<roll_result><small>
\`\`\`md
${playerName} uses "${skill.name}"!

${results.map(r => `[${r.raw}]`).join(' / ')} → ${groupFormula}
${dieLines}

TOTAL: ${groupTotal}
\`\`\`
</small></roll_result>`;

        // Stamp into the chat textarea
        const $ta = $('#send_textarea');
        if ($ta.length) {
            const cur = String($ta.val() || '');
            const sep = cur.length && !cur.endsWith('\n') ? '\n' : '';
            $ta.val(cur + sep + rollResultBlock).trigger('input');
        }

        this.close();
    }
}

/**
 * Instantiate SkillDeckModal, inject the trigger button into #rpg-plot-buttons,
 * and return the instance.
 * @returns {SkillDeckModal}
 */
export function setupSkillDeckModal() {
    const modal = new SkillDeckModal();

    // Append deck button to the plot-buttons bar (created by setupPlotButtons)
    const $bar = $('#rpg-plot-buttons');
    if ($bar.length && !$bar.find('#rpg-skill-deck-btn').length) {
        $bar.prepend(`
            <button id="rpg-skill-deck-btn"
                    class="rpg-plot-btn rpg-skill-deck-trigger"
                    title="View Combat Skill Deck">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                Skill Deck
            </button>
        `);
    }

    $(document).on('click', '#rpg-skill-deck-btn', () => {
        if (modal.modal?.classList.contains('is-open')) {
            modal.close();
        } else {
            modal.open();
        }
    });

    return modal;
}

// ── Skill Deck helpers (module-private) ───────────────────────────────────────

/** Map diceType → CSS die-chip colour class (mirrors combatSkillsTab._dieClass). */
function _sdcDieClass(diceType) {
    if (!diceType) return 'cs-dt-offensive';
    const dt = diceType.toLowerCase();
    if (dt === 'slash' || dt === 'pierce' || dt === 'blunt') return 'cs-dt-offensive';
    if (dt.startsWith('counter-slash') || dt.startsWith('counter-pierce') || dt.startsWith('counter-blunt'))
        return 'cs-dt-counter';
    return 'cs-dt-defensive';
}

/** Format a modifier for display: '', '+3', '-2'. */
function _sdcModStr(mod) {
    if (!mod || mod === 0) return '';
    return mod > 0 ? `+${mod}` : `${mod}`;
}

/**
 * Best-effort modifier resolution for out-of-encounter rolls.
 * Handles flat, attribute (numeric only), and falls back to flatValue.
 * @param {{ type: string, flatValue: number, targetId: string, multiplier: number }} modifier
 * @param {object} ss  extensionSettings.statSheet
 * @returns {number}
 */
function _sdcResolveMod(modifier, ss) {
    if (!modifier) return 0;
    if (modifier.type === 'flat' || !modifier.type) {
        return Math.round((modifier.flatValue ?? 0) * (modifier.multiplier ?? 1));
    }
    if (modifier.type === 'attribute' && modifier.targetId && ss?.attributes) {
        const attr = ss.attributes.find(a => a.id === modifier.targetId && a.enabled);
        if (attr) {
            const base = typeof attr.value === 'number' ? attr.value : 0;
            const raw  = base * (modifier.multiplier ?? 1);
            return modifier.roundDown ? Math.floor(raw) : Math.round(raw);
        }
    }
    // Fallback for skill/ST/subskill types — use flatValue
    return Math.round((modifier.flatValue ?? 0) * (modifier.multiplier ?? 1));
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
