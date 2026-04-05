/**
 * Encounter UI Module
 * Manages the combat encounter modal window and interactions.
 *
 * Session 7 additions:
 *   - Light / Sanity / Act-Scene HUD bar
 *   - Equipped Combat Skills from the Stat Sheet shown as action buttons
 *   - Sanity updates derived from round outcomes (kills, damage taken, clash wins)
 *   - E.G.O Corrosion visual state
 */

import { getContext } from '../../../../../../extensions.js';
import { chat, saveChatDebounced, characters, this_chid, user_avatar } from '../../../../../../../script.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { selected_group, getGroupMembers, groups } from '../../../../../../group-chats.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';
import { getSafeThumbnailUrl } from '../../utils/avatars.js';
import {
    currentEncounter,
    updateCurrentEncounter,
    resetEncounter,
    addCombatMessage,
    addEncounterLogEntry,
    saveEncounterLog
} from '../features/encounterState.js';
import {
    buildEncounterInitPrompt,
    buildCombatActionPrompt,
    buildCombatSummaryPrompt,
    parseEncounterJSON
} from '../generation/encounterPrompts.js';

// ── Session 7 imports ─────────────────────────────────────────────────────────
import {
    SANITY_MIN,
    SANITY_CLASH_WIN,
    SANITY_CLASH_LOSE,
    SANITY_KILL,
    EGO_SANITY_COSTS,
    clampSanity,
    calculateSanityLevel,
    getSanityLevelInfo,
} from '../statSheet/sanitySystem.js';

import {
    canAffordLight,
    spendLight,
    regenLight,
    lightPipsText,
} from '../statSheet/lightSystem.js';
import {
    getActSceneLabel,
    advanceScene,
} from '../statSheet/actSceneManager.js';
import { getEquippedSkills } from '../statSheet/statSheetState.js';

// ── Phase 4 imports ───────────────────────────────────────────────────────────
import {
    parseCombatTags,
    initToUpsertArgs,
    groupEnemyActions,
} from '../generation/parseCombatTags.js';

import {
    resolveClash,
    applyClashReport,
    buildInitiativeQueue,
    getMoraleTier,
    clampMorale,
    moraleGainOnKill,
    moraleLossOnAllyDeath,
} from '../features/clashEngine.js';

import {
    buildPlayerSnap,
    resolvePlayerDiceForSkillId,
    writePlayerDeltas,
} from '../statSheet/statSheetBridge.js';

import {
    resetEngineRoundState,
    expireSavedDice,
    upsertCombatant,
    getCombatantState,
    logClash,
} from '../features/encounterState.js';

import { logDiceRoll } from '../interaction/diceLog.js';

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a die type string to the correct CSS colour class.
 * @param {string} diceType
 * @returns {string}
 */
function _getDieColorClass(diceType) {
    if (!diceType) return 'cs-dt-offensive';
    const dt = diceType.toLowerCase();
    if (dt === 'slash' || dt === 'pierce' || dt === 'blunt') return 'cs-dt-offensive';
    if (dt.startsWith('counter-slash') || dt.startsWith('counter-pierce') || dt.startsWith('counter-blunt')) return 'cs-dt-counter';
    return 'cs-dt-defensive'; // Block, Evade, Counter-Block, Counter-Evade
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * EncounterModal class — manages the combat encounter UI.
 */
export class EncounterModal {
    constructor() {
        this.modal = null;
        this.isInitializing = false;
        this.isProcessing = false;
        this.lastRequest = null;
    }

    // ── Open / Initialize ─────────────────────────────────────────────────────

    async open() {
        if (this.isInitializing) return;
        const configured = await this.showNarrativeConfigModal();
        if (!configured) return;
        await this.initialize();
    }

    async initialize() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!this.modal) this.createModal();

            this.showLoadingState('Initializing combat encounter...');
            this.modal.classList.add('is-open');

            const initPrompt = await buildEncounterInitPrompt();
            this.lastRequest = { type: 'init', prompt: initPrompt };

            const response = await safeGenerateRaw({ prompt: initPrompt, quietToLoud: false });

            if (!response) {
                this.showErrorWithRegenerate('No response received from AI. The model may be unavailable.');
                return;
            }

            const combatData = parseEncounterJSON(response);

            if (!combatData || !combatData.party || !combatData.enemies) {
                this.showErrorWithRegenerate('Invalid JSON format detected. The AI returned malformed data. Ensure the Max Response Length is set to at least 2048 tokens, otherwise the model might run out of tokens and produce unfinished structures.');
                return;
            }

            updateCurrentEncounter({
                active: true,
                initialized: true,
                combatStats: combatData,
            });

            addCombatMessage('system', 'Combat initialized');
            addCombatMessage('assistant', JSON.stringify(combatData));

            if (combatData.styleNotes) {
                this.applyEnvironmentStyling(combatData.styleNotes);
            }

            this.renderCombatUI(combatData);

        } catch (error) {
            console.error('[RPG Companion] Error initializing encounter:', error);
            this.showErrorWithRegenerate(`Failed to initialize combat: ${error.message}`);
        } finally {
            this.isInitializing = false;
        }
    }

    // ── Narrative config modal ────────────────────────────────────────────────

    async showNarrativeConfigModal() {
        return new Promise((resolve) => {
            const combatDefaults  = extensionSettings.encounterSettings?.combatNarrative  || {};
            const summaryDefaults = extensionSettings.encounterSettings?.summaryNarrative || {};

            const configHTML = `
                <div id="rpg-narrative-config-modal" class="rpg-encounter-modal" data-theme="${extensionSettings.theme || 'default'}">
                    <div class="rpg-encounter-overlay"></div>
                    <div class="rpg-encounter-container" style="max-width: 600px;">
                        <div class="rpg-encounter-header">
                            <h2><i class="fa-solid fa-book-open"></i> Configure Combat Narrative</h2>
                        </div>
                        <div class="rpg-encounter-content" style="padding: 24px;">
                            <div class="rpg-narrative-config-section">
                                <label class="label_text" style="margin-bottom: 16px; display: block; font-weight: 600;">
                                    <i class="fa-solid fa-swords"></i> Combat Narrative Style
                                </label>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-combat-tense" style="min-width: 100px;">Tense:</label>
                                    <select id="config-combat-tense" class="rpg-select" style="flex: 1;">
                                        <option value="present" ${combatDefaults.tense === 'present' ? 'selected' : ''}>Present</option>
                                        <option value="past"    ${combatDefaults.tense === 'past'    ? 'selected' : ''}>Past</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-combat-person" style="min-width: 100px;">Person:</label>
                                    <select id="config-combat-person" class="rpg-select" style="flex: 1;">
                                        <option value="first"  ${combatDefaults.person === 'first'  ? 'selected' : ''}>First Person</option>
                                        <option value="second" ${combatDefaults.person === 'second' ? 'selected' : ''}>Second Person</option>
                                        <option value="third"  ${combatDefaults.person === 'third'  ? 'selected' : ''}>Third Person</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-combat-narration" style="min-width: 100px;">Narration:</label>
                                    <select id="config-combat-narration" class="rpg-select" style="flex: 1;">
                                        <option value="omniscient" ${combatDefaults.narration === 'omniscient' ? 'selected' : ''}>Omniscient</option>
                                        <option value="limited"    ${combatDefaults.narration === 'limited'    ? 'selected' : ''}>Limited</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-combat-pov" style="min-width: 100px;">Point of View:</label>
                                    <input type="text" id="config-combat-pov" class="text_pole" placeholder="narrator" value="${combatDefaults.pov || ''}" style="flex: 1;" />
                                </div>
                            </div>

                            <div class="rpg-narrative-config-section" style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--rpg-border, rgba(255,255,255,0.1));">
                                <label class="label_text" style="margin-bottom: 16px; display: block; font-weight: 600;">
                                    <i class="fa-solid fa-scroll"></i> Combat Summary Style
                                </label>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-summary-tense" style="min-width: 100px;">Tense:</label>
                                    <select id="config-summary-tense" class="rpg-select" style="flex: 1;">
                                        <option value="present" ${summaryDefaults.tense === 'present' ? 'selected' : ''}>Present</option>
                                        <option value="past"    ${summaryDefaults.tense === 'past'    ? 'selected' : ''}>Past</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-summary-person" style="min-width: 100px;">Person:</label>
                                    <select id="config-summary-person" class="rpg-select" style="flex: 1;">
                                        <option value="first"  ${summaryDefaults.person === 'first'  ? 'selected' : ''}>First Person</option>
                                        <option value="second" ${summaryDefaults.person === 'second' ? 'selected' : ''}>Second Person</option>
                                        <option value="third"  ${summaryDefaults.person === 'third'  ? 'selected' : ''}>Third Person</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-summary-narration" style="min-width: 100px;">Narration:</label>
                                    <select id="config-summary-narration" class="rpg-select" style="flex: 1;">
                                        <option value="omniscient" ${summaryDefaults.narration === 'omniscient' ? 'selected' : ''}>Omniscient</option>
                                        <option value="limited"    ${summaryDefaults.narration === 'limited'    ? 'selected' : ''}>Limited</option>
                                    </select>
                                </div>

                                <div class="rpg-setting-row" style="margin-bottom: 12px;">
                                    <label for="config-summary-pov" style="min-width: 100px;">Point of View:</label>
                                    <input type="text" id="config-summary-pov" class="text_pole" placeholder="narrator" value="${summaryDefaults.pov || ''}" style="flex: 1;" />
                                </div>
                            </div>

                            <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--rpg-border, rgba(255,255,255,0.1));">
                                <label class="checkbox_label" style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" id="config-remember" ${extensionSettings.encounterSettings?.narrativeConfigured ? 'checked' : ''} style="margin: 0;" />
                                    <span style="color: var(--rpg-text, #eaeaea);">Remember these settings for future encounters</span>
                                </label>
                            </div>

                            <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
                                <button id="config-cancel"  class="rpg-btn rpg-btn-secondary" style="padding: 12px 24px;">
                                    <i class="fa-solid fa-times"></i> Cancel
                                </button>
                                <button id="config-proceed" class="rpg-btn rpg-btn-primary" style="padding: 12px 24px;">
                                    <i class="fa-solid fa-play"></i> Proceed
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', configHTML);
            const configModal = document.getElementById('rpg-narrative-config-modal');
            setTimeout(() => configModal.classList.add('is-open'), 10);

            configModal.querySelector('#config-proceed').addEventListener('click', () => {
                const combatNarrative = {
                    tense:     configModal.querySelector('#config-combat-tense').value,
                    person:    configModal.querySelector('#config-combat-person').value,
                    narration: configModal.querySelector('#config-combat-narration').value,
                    pov:       configModal.querySelector('#config-combat-pov').value.trim() || 'narrator',
                };
                const summaryNarrative = {
                    tense:     configModal.querySelector('#config-summary-tense').value,
                    person:    configModal.querySelector('#config-summary-person').value,
                    narration: configModal.querySelector('#config-summary-narration').value,
                    pov:       configModal.querySelector('#config-summary-pov').value.trim() || 'narrator',
                };
                const remember = configModal.querySelector('#config-remember').checked;

                if (!extensionSettings.encounterSettings) extensionSettings.encounterSettings = {};
                extensionSettings.encounterSettings.combatNarrative  = combatNarrative;
                extensionSettings.encounterSettings.summaryNarrative = summaryNarrative;
                extensionSettings.encounterSettings.narrativeConfigured = remember;
                saveSettings();

                configModal.remove();
                resolve(true);
            });

            configModal.querySelector('#config-cancel').addEventListener('click', () => {
                configModal.remove();
                resolve(false);
            });

            configModal.querySelector('.rpg-encounter-overlay').addEventListener('click', () => {
                configModal.remove();
                resolve(false);
            });
        });
    }

    // ── Create modal DOM ──────────────────────────────────────────────────────

    createModal() {
        const modalHTML = `
            <div id="rpg-encounter-modal" class="rpg-encounter-modal" data-theme="${extensionSettings.theme || 'default'}" data-environment="default" data-atmosphere="default">
                <div class="rpg-encounter-overlay"></div>
                <div class="rpg-encounter-container">
                    <div class="rpg-encounter-header">
                        <h2><i class="fa-solid fa-swords"></i> Combat Encounter</h2>
                        <div class="rpg-encounter-header-buttons">
                            <button id="rpg-encounter-conclude" class="rpg-encounter-conclude-btn" title="Conclude encounter early">
                                <i class="fa-solid fa-flag-checkered"></i> Conclude Encounter
                            </button>
                            <button id="rpg-encounter-close" class="rpg-encounter-close-btn" title="Close (ends combat)">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                    </div>
                    <div class="rpg-encounter-content">
                        <div id="rpg-encounter-loading" class="rpg-encounter-loading">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <p>Initializing combat...</p>
                        </div>
                        <div id="rpg-encounter-main" class="rpg-encounter-main" style="display: none;">
                            <!-- Combat UI rendered here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('rpg-encounter-modal');

        this.modal.querySelector('#rpg-encounter-conclude').addEventListener('click', () => {
            if (confirm('Conclude this encounter early and generate a summary?')) {
                this.concludeEncounter();
            }
        });

        this.modal.querySelector('#rpg-encounter-close').addEventListener('click', () => {
            if (confirm('Are you sure you want to end this combat encounter?')) {
                this.close();
            }
        });

        this.modal.querySelector('.rpg-encounter-overlay').addEventListener('click', () => {
            if (confirm('Are you sure you want to end this combat encounter?')) {
                this.close();
            }
        });
    }

    // ── Render combat UI ──────────────────────────────────────────────────────

    renderCombatUI(combatData) {
        const mainContent    = this.modal.querySelector('#rpg-encounter-main');
        const loadingContent = this.modal.querySelector('#rpg-encounter-loading');

        loadingContent.style.display = 'none';
        mainContent.style.display   = 'block';

        mainContent.innerHTML = `
            <div class="rpg-encounter-battlefield">

                <!-- ── Session 7: HUD bar ────────────────────────────────────── -->
                <div id="rpg-encounter-hud" class="rpg-encounter-hud">
                    ${this.renderHUDHTML()}
                </div>

                <!-- Environment -->
                <div class="rpg-encounter-environment">
                    <p><i class="fa-solid fa-mountain"></i> ${combatData.environment || 'Battle Arena'}</p>
                </div>

                <!-- Enemies -->
                <div class="rpg-encounter-section">
                    <h3><i class="fa-solid fa-skull"></i> Enemies</h3>
                    <div class="rpg-encounter-enemies">
                        ${this.renderEnemies(combatData.enemies)}
                    </div>
                </div>

                <!-- Party -->
                <div class="rpg-encounter-section">
                    <h3><i class="fa-solid fa-users"></i> Party</h3>
                    <div class="rpg-encounter-party">
                        ${this.renderParty(combatData.party)}
                    </div>
                </div>

                <!-- Combat Log -->
                <div class="rpg-encounter-log-section">
                    <h3><i class="fa-solid fa-scroll"></i> Combat Log</h3>
                    <div id="rpg-encounter-log" class="rpg-encounter-log">
                        <div class="rpg-encounter-log-entry"><em>Combat begins!</em></div>
                    </div>
                </div>

                <!-- Player Controls -->
                ${this.renderPlayerControls(combatData.party, currentEncounter.playerActions)}

            </div>
        `;

        this.attachControlListeners(combatData.party);
    }

    // ── HUD ───────────────────────────────────────────────────────────────────

    /**
     * Build the inner HTML for the Light / Sanity / Act·Scene HUD bar.
     * @returns {string}
     */
    renderHUDHTML() {
        const light    = currentEncounter.light;
        const morale   = currentEncounter.morale ?? 0;
        const moraleTier = getMoraleTier(morale);
        const sanity   = currentEncounter.sanity.current;
        const lvl      = currentEncounter.sanityLevel;
        const info     = getSanityLevelInfo(lvl);
        const corrosion = currentEncounter.corrosion.active;
        const pips     = lightPipsText(light);
        const actLabel = getActSceneLabel(currentEncounter);
        const moraleSign = morale >= 0 ? '+' : '';
        const tierSign   = moraleTier >= 0 ? '+' : '';

        // Morale colour: positive = warm green, negative = red, neutral = grey
        const moraleColor = moraleTier > 0 ? '#4caf50' : moraleTier < 0 ? '#e94560' : '#9da5b0';

        return `
            <div class="rpg-hud-segment rpg-hud-light">
                <span class="rpg-hud-icon">💡</span>
                <span class="rpg-hud-label">Light</span>
                <span class="rpg-hud-pips">${pips}</span>
                <span class="rpg-hud-value">${light.current}/${light.max}</span>
            </div>
            <div class="rpg-hud-divider">│</div>
            <div class="rpg-hud-segment rpg-hud-morale">
                <span class="rpg-hud-icon">⚔</span>
                <span class="rpg-hud-label">Morale</span>
                <span class="rpg-hud-value" style="color:${moraleColor}">${moraleSign}${morale}</span>
                <span class="rpg-hud-sublabel" style="color:${moraleColor}">Tier ${tierSign}${moraleTier}</span>
            </div>
            <div class="rpg-hud-divider">│</div>
            <div class="rpg-hud-segment rpg-hud-sanity ${corrosion ? 'rpg-hud-corrosion-active' : ''}">
                <span class="rpg-hud-icon">🧠</span>
                <span class="rpg-hud-label">Sanity</span>
                <span class="rpg-hud-value" style="color:${info?.color || '#9da5b0'}">${sanity >= 0 ? '+' : ''}${sanity}</span>
                ${corrosion ? '<span class="rpg-corrosion-tag">⚠ EGO CORROSION</span>' : ''}
            </div>
            <div class="rpg-hud-divider">│</div>
            <div class="rpg-hud-segment rpg-hud-scene">
                <span class="rpg-hud-icon">🎭</span>
                <span class="rpg-hud-value">${actLabel}</span>
            </div>
        `;
    }

    /**
     * Re-render the HUD bar in-place (no full DOM rebuild).
     */
    updateHUD() {
        const hudEl = this.modal?.querySelector('#rpg-encounter-hud');
        if (!hudEl) return;
        hudEl.innerHTML = this.renderHUDHTML();

        // Apply / remove corrosion border on the modal itself
        if (currentEncounter.corrosion.active) {
            this.modal.classList.add('rpg-modal-corrosion');
        } else {
            this.modal.classList.remove('rpg-modal-corrosion');
        }
    }

    // ── Enemy / Party cards ───────────────────────────────────────────────────

    renderEnemies(enemies) {
        return enemies.map((enemy, index) => {
            const hpPercent = (enemy.hp / enemy.maxHp) * 100;
            const isDead    = enemy.hp <= 0;
            const avatarUrl = this.getCharacterAvatar(enemy.name);
            const sprite    = enemy.sprite || '👹';
            const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjY2NjYyIgb3BhY2l0eT0iMC4zIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiBmb250LXNpemU9IjQwIj4/PC90ZXh0Pjwvc3ZnPg==';

            return `
                <div class="rpg-encounter-card ${isDead ? 'rpg-encounter-dead' : ''}" data-enemy-index="${index}">
                    <div class="rpg-encounter-card-sprite">
                        ${avatarUrl ? `<img src="${avatarUrl}" alt="${enemy.name}" onerror="this.parentElement.innerHTML='${sprite}';this.onerror=null;">` : sprite}
                    </div>
                    <div class="rpg-encounter-card-info">
                        <h4>${enemy.name}</h4>
                        <div class="rpg-encounter-hp-bar">
                            <div class="rpg-encounter-hp-fill" style="width:${hpPercent}%"></div>
                            <span class="rpg-encounter-hp-text">${enemy.hp}/${enemy.maxHp} HP</span>
                        </div>
                        ${enemy.statuses?.length ? `<div class="rpg-encounter-statuses">${enemy.statuses.map(s => `<span class="rpg-encounter-status" title="${s.name}">${s.emoji}</span>`).join('')}</div>` : ''}
                        ${enemy.description ? `<p class="rpg-encounter-description">${enemy.description}</p>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderParty(party) {
        const fallbackSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjY2NjYyIgb3BhY2l0eT0iMC4zIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiBmb250LXNpemU9IjQwIj4/PC90ZXh0Pjwvc3ZnPg==';

        return party.map((member, index) => {
            const hpPercent = (member.hp / member.maxHp) * 100;
            const isDead    = member.hp <= 0;
            let avatarUrl   = '';

            if (member.isPlayer && user_avatar) {
                avatarUrl = getSafeThumbnailUrl('persona', user_avatar);
            } else {
                avatarUrl = this.getCharacterAvatar(member.name);
            }

            return `
                <div class="rpg-encounter-card ${isDead ? 'rpg-encounter-dead' : ''}" data-party-index="${index}">
                    <div class="rpg-encounter-card-avatar">
                        <img src="${avatarUrl || fallbackSvg}" alt="${member.name}" onerror="this.src='${fallbackSvg}'">
                    </div>
                    <div class="rpg-encounter-card-info">
                        <h4>${member.name} ${member.isPlayer ? '(You)' : ''}</h4>
                        <div class="rpg-encounter-hp-bar">
                            <div class="rpg-encounter-hp-fill rpg-encounter-hp-party" style="width:${hpPercent}%"></div>
                            <span class="rpg-encounter-hp-text">${member.hp}/${member.maxHp} HP</span>
                        </div>
                        ${member.statuses?.length ? `<div class="rpg-encounter-statuses">${member.statuses.map(s => `<span class="rpg-encounter-status" title="${s.name}">${s.emoji}</span>`).join('')}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    getCharacterAvatar(name) {
        if (extensionSettings.npcAvatars?.[name]) return extensionSettings.npcAvatars[name];

        if (selected_group) {
            const members = getGroupMembers(selected_group);
            const match   = members?.find(m => m?.name?.toLowerCase() === name.toLowerCase());
            if (match?.avatar) return getSafeThumbnailUrl('avatar', match.avatar);
        }

        if (Array.isArray(characters)) {
            const match = characters.find(c => c?.name?.toLowerCase() === name.toLowerCase());
            if (match?.avatar) return getSafeThumbnailUrl('avatar', match.avatar);
        }

        if (this_chid !== undefined && characters?.[this_chid]) {
            const c = characters[this_chid];
            if (c.name?.toLowerCase() === name.toLowerCase()) return getSafeThumbnailUrl('avatar', c.avatar);
        }

        return null;
    }

    // ── Target selection ──────────────────────────────────────────────────────

    async showTargetSelection(attackType, combatStats) {
        return new Promise((resolve) => {
            const targetModal = document.createElement('div');
            targetModal.className = 'rpg-target-selection-overlay';

            let targetOptions = '';

            if (attackType === 'AoE') {
                targetOptions = `
                    <div class="rpg-target-option" data-target="all-enemies">
                        <div class="rpg-target-icon">💥</div>
                        <div class="rpg-target-name">All Enemies</div>
                        <div class="rpg-target-desc">Area of Effect</div>
                    </div>
                `;
            } else if (attackType === 'both') {
                targetOptions = `
                    <div class="rpg-target-option" data-target="all-enemies">
                        <div class="rpg-target-icon">💥</div>
                        <div class="rpg-target-name">All Enemies</div>
                        <div class="rpg-target-desc">Area of Effect</div>
                    </div>
                    <div class="rpg-target-divider">OR</div>
                `;
            }

            if (attackType !== 'AoE') {
                combatStats.enemies.forEach((enemy, index) => {
                    if (enemy.hp > 0) {
                        targetOptions += `
                            <div class="rpg-target-option" data-target="${enemy.name}" data-target-type="enemy" data-target-index="${index}">
                                <div class="rpg-target-icon">${enemy.sprite || '👹'}</div>
                                <div class="rpg-target-name">${enemy.name}</div>
                                <div class="rpg-target-hp">${enemy.hp}/${enemy.maxHp} HP</div>
                            </div>
                        `;
                    }
                });

                combatStats.party.forEach((member, index) => {
                    if (member.hp > 0) {
                        const isPlayer = member.isPlayer ? ' (You)' : '';
                        let avatarIcon = '✨';
                        if (member.isPlayer && user_avatar) {
                            avatarIcon = `<img src="${getSafeThumbnailUrl('persona', user_avatar)}" alt="${member.name}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
                        } else {
                            const url = this.getCharacterAvatar(member.name);
                            if (url) avatarIcon = `<img src="${url}" alt="${member.name}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`;
                        }
                        targetOptions += `
                            <div class="rpg-target-option rpg-target-ally" data-target="${member.name}" data-target-type="party" data-target-index="${index}">
                                <div class="rpg-target-icon">${avatarIcon}</div>
                                <div class="rpg-target-name">${member.name}${isPlayer}</div>
                                <div class="rpg-target-hp">${member.hp}/${member.maxHp} HP</div>
                            </div>
                        `;
                    }
                });
            }

            targetModal.innerHTML = `
                <div class="rpg-target-selection-modal">
                    <h3><i class="fa-solid fa-crosshairs"></i> Select Target</h3>
                    <div class="rpg-target-list">${targetOptions}</div>
                    <button class="rpg-target-cancel">Cancel</button>
                </div>
            `;

            document.body.appendChild(targetModal);

            targetModal.querySelectorAll('.rpg-target-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    document.body.removeChild(targetModal);
                    resolve(opt.dataset.target);
                });
            });

            targetModal.querySelector('.rpg-target-cancel').addEventListener('click', () => {
                document.body.removeChild(targetModal);
                resolve(null);
            });

            targetModal.addEventListener('click', (e) => {
                if (e.target === targetModal) {
                    document.body.removeChild(targetModal);
                    resolve(null);
                }
            });
        });
    }

    // ── Player controls ───────────────────────────────────────────────────────

    renderPlayerControls(party, playerActions = null) {
        const player = party.find(m => m.isPlayer);
        if (!player || player.hp <= 0) {
            return '<div class="rpg-encounter-controls"><p class="rpg-encounter-defeated">You have been defeated...</p></div>';
        }

        const items = playerActions?.items || player.items || [];

        return `
            <div class="rpg-encounter-controls">
                <h3><i class="fa-solid fa-hand-fist"></i> Your Actions</h3>

                <div class="rpg-encounter-action-buttons">

                    <!-- ── Session 7: Stat Sheet Combat Skills ──────────────── -->
                    ${this._renderCombatSkillsSection()}

                    <!-- Items -->
                    ${items.length > 0 ? `
                        <div class="rpg-encounter-button-group">
                            <h4>Items</h4>
                            ${items.map(item => `
                                <button class="rpg-encounter-action-btn rpg-encounter-item-btn" data-action="item" data-value="${item}">
                                    <i class="fa-solid fa-flask"></i> ${item}
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}

                </div>

                <div class="rpg-encounter-custom-action">
                    <h4>Custom Action</h4>
                    <div class="rpg-encounter-input-group">
                        <input type="text" id="rpg-encounter-custom-input" placeholder="Describe what you want to do..." />
                        <button id="rpg-encounter-custom-submit" class="rpg-encounter-submit-btn">
                            <i class="fa-solid fa-paper-plane"></i> Submit
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Combat Skills section (Session 7) ────────────────────────────────────

    /**
     * Build the HTML for the equipped Combat Skills button group.
     * Returns '' if the stat sheet is disabled or no skills are equipped.
     * @returns {string}
     */
    _renderCombatSkillsSection() {
        if (!extensionSettings.statSheet?.enabled) return '';

        let allEquipped;
        try {
            allEquipped = getEquippedSkills();
        } catch {
            return '';
        }

        if (!allEquipped?.length) return '';

        const corrosion  = currentEncounter.corrosion.active;
        const light      = currentEncounter.light;

        // During corrosion: only E.G.O skills are usable
        const skills = corrosion
            ? allEquipped.filter(s => s.isEGO)
            : allEquipped;

        if (!skills.length) {
            return `
                <div class="rpg-encounter-button-group rpg-cs-skills-group">
                    <h4><i class="fa-solid fa-layer-group"></i> Combat Skills</h4>
                    <p class="rpg-cs-no-skills rpg-cs-corrosion-note">
                        ⚠ EGO CORROSION — only E.G.O skills available. No E.G.O skills are equipped.
                    </p>
                </div>
            `;
        }

        const btns = skills.map(skill => {
            const cost        = skill.cost ?? 0;
            const canAfford   = canAffordLight(light, cost);
            const isEGO       = skill.isEGO;
            const egoSanCost  = isEGO ? (EGO_SANITY_COSTS[skill.egoTier] ?? 0) : 0;
            const tierKey     = (skill.egoTier || '').toLowerCase();

            const tierBadge = isEGO
                ? `<span class="rpg-cs-tier-badge rpg-cs-tier-${tierKey}">${skill.egoTier}</span>`
                : '';

            const diceHtml = (skill.dice || []).slice(0, 4).map(d => {
                const cls = _getDieColorClass(d.diceType);
                return `<span class="cs-die-chip ${cls}">${d.diceType} d${d.sides}${d.basePower > 0 ? '+' + d.basePower : ''}</span>`;
            }).join('');

            return `
                <button class="rpg-encounter-action-btn rpg-cs-skill-btn${!canAfford ? ' rpg-cs-skill-unaffordable' : ''}"
                        data-action="combat-skill"
                        data-skill-id="${skill.id}"
                        data-skill-name="${skill.name.replace(/"/g, '&quot;')}"
                        data-skill-cost="${cost}"
                        data-skill-is-ego="${isEGO ? '1' : '0'}"
                        data-skill-ego-sanity="${egoSanCost}"
                        ${!canAfford ? 'disabled' : ''}>
                    <span class="rpg-cs-skill-line1">
                        ${tierBadge}
                        <span class="rpg-cs-skill-name">${skill.name}</span>
                        <span class="rpg-cs-cost-group">
                            <span class="rpg-cs-light-cost"><span class="rpg-cs-pip">💡</span>${cost}</span>
                            ${isEGO ? `<span class="rpg-cs-sanity-cost">🧠−${egoSanCost}</span>` : ''}
                        </span>
                    </span>
                    ${diceHtml ? `<span class="rpg-cs-dice-row">${diceHtml}</span>` : ''}
                </button>
            `;
        }).join('');

        const corrosionNote = corrosion
            ? '<p class="rpg-cs-corrosion-note">⚠ EGO CORROSION — only E.G.O skills are usable</p>'
            : '';

        return `
            <div class="rpg-encounter-button-group rpg-cs-skills-group">
                <h4><i class="fa-solid fa-layer-group"></i> Combat Skills</h4>
                ${corrosionNote}
                ${btns}
            </div>
        `;
    }

    /**
     * Re-render only the combat skills button group inside the existing controls.
     * Called after light/sanity changes without rebuilding the entire controls section.
     */
    _refreshCombatSkillsSection() {
        const group = this.modal?.querySelector('.rpg-cs-skills-group');
        if (!group) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this._renderCombatSkillsSection();
        const newGroup = tempDiv.firstElementChild;
        if (newGroup) group.replaceWith(newGroup);
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    attachControlListeners(party) {
        if (this._listenersAttached) return;

        this._actionHandler = async (e) => {
            // ── Combat Skill buttons (Session 7) ─────────────────────────────
            const skillBtn = e.target.closest('.rpg-cs-skill-btn');
            if (skillBtn && !skillBtn.disabled && !this.isProcessing) {
                const skillId      = skillBtn.dataset.skillId;
                const skillName    = skillBtn.dataset.skillName;
                const cost         = parseInt(skillBtn.dataset.skillCost)      || 0;
                const isEGO        = skillBtn.dataset.skillIsEgo === '1';
                const egoSanCost   = parseInt(skillBtn.dataset.skillEgoSanity) || 0;

                // Spend Light
                if (!spendLight(currentEncounter.light, cost)) {
                    this.addToLog('Not enough Light!', 'system');
                    return;
                }

                // Spend Sanity for E.G.O
                if (isEGO && egoSanCost > 0) {
                    const newSanity   = clampSanity(currentEncounter.sanity.current - egoSanCost);
                    currentEncounter.sanity.current = newSanity;
                    currentEncounter.sanityLevel    = calculateSanityLevel(newSanity);
                    this.addToLog(`E.G.O used! −${egoSanCost} Sanity`, 'sanity-loss');
                }

                currentEncounter.selectedSkill = skillId;
                this.updateHUD();

                // Build the action text with die sequence info
                let allSkills;
                try { allSkills = getEquippedSkills(); } catch { allSkills = []; }
                const skill = allSkills.find(s => s.id === skillId);

                const context  = getContext();
                const userName = context.name1;
                let actionText = `I use "${skillName}"`;

                if (skill?.dice?.length) {
                    const diceDesc = skill.dice
                        .map(d => `${d.diceType} 1d${d.sides}${d.basePower > 0 ? '+' + d.basePower : ''}`)
                        .join(', ');
                    actionText += ` [${diceDesc}]`;
                }

                const target = await this.showTargetSelection('single-target', currentEncounter.combatStats);
                if (!target) {
                    // User cancelled — refund costs
                    currentEncounter.light.current = Math.min(
                        currentEncounter.light.max,
                        currentEncounter.light.current + cost
                    );
                    if (isEGO && egoSanCost > 0) {
                        currentEncounter.sanity.current = clampSanity(
                            currentEncounter.sanity.current + egoSanCost
                        );
                        currentEncounter.sanityLevel = calculateSanityLevel(currentEncounter.sanity.current);
                    }
                    currentEncounter.selectedSkill = null;
                    this.updateHUD();
                    return;
                }

                actionText += ` targeting ${target}`;
                await this.processCombatAction(actionText);
                return;
            }

            // ── Standard attack / item buttons ───────────────────────────────
            const actionBtn = e.target.closest('.rpg-encounter-action-btn');
            if (actionBtn && !actionBtn.disabled && !this.isProcessing) {
                const actionType = actionBtn.dataset.action;
                const value      = actionBtn.dataset.value;
                const attackType = actionBtn.dataset.attackType;
                const context    = getContext();
                const userName   = context.name1;

                let actionText = '';

                if (actionType === 'item') {
                    const target = await this.showTargetSelection('single-target', currentEncounter.combatStats);
                    if (!target) return;
                    actionText = `${userName} uses ${value} on ${target}!`;
                }

                await this.processCombatAction(actionText);
                return;
            }

            // ── Custom submit button ──────────────────────────────────────────
            const submitBtn = e.target.closest('#rpg-encounter-custom-submit');
            if (submitBtn && !submitBtn.disabled && !this.isProcessing) {
                const input = this.modal.querySelector('#rpg-encounter-custom-input');
                if (input) {
                    const action = input.value.trim();
                    if (action) {
                        await this.processCombatAction(action);
                        input.value = '';
                    }
                }
            }
        };

        this._keypressHandler = async (e) => {
            const input = e.target.closest('#rpg-encounter-custom-input');
            if (input && e.key === 'Enter' && !this.isProcessing) {
                const action = input.value.trim();
                if (action) {
                    await this.processCombatAction(action);
                    input.value = '';
                }
            }
        };

        this.modal.addEventListener('click', this._actionHandler);
        this.modal.addEventListener('keypress', this._keypressHandler);
        this._listenersAttached = true;
    }

    // ── Process combat action ─────────────────────────────────────────────────

    async processCombatAction(action) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Snapshot enemy/party HP before the round resolves
        const prevStats = currentEncounter.combatStats
            ? JSON.parse(JSON.stringify(currentEncounter.combatStats))
            : null;

        try {
            this.modal.querySelectorAll('.rpg-encounter-action-btn, #rpg-encounter-custom-submit').forEach(btn => {
                btn.disabled = true;
            });

            this.addToLog(`You: ${action}`, 'player-action');

            const actionPrompt = await buildCombatActionPrompt(action, currentEncounter.combatStats);
            this.lastRequest   = { type: 'action', action, prompt: actionPrompt };

            const response = await safeGenerateRaw({ prompt: actionPrompt, quietToLoud: false });

            if (!response) {
                this.showErrorWithRegenerate('No response received from AI. The model may be unavailable.');
                return;
            }

            const result = parseEncounterJSON(response);

            if (!result || !result.combatStats) {
                this.showErrorWithRegenerate('Invalid JSON format detected. The AI returned malformed data. Ensure the Max Response Length is set to at least 2048 tokens, otherwise the model might run out of tokens and produce unfinished structures.');
                return;
            }

            updateCurrentEncounter({
                combatStats:   result.combatStats,
                playerActions: result.playerActions,
            });

            // Build log entries
            const logEntries = [];
            result.enemyActions?.forEach(ea => {
                logEntries.push({ message: `${ea.enemyName}: ${ea.action}`, type: 'enemy-action' });
            });
            result.partyActions?.forEach(pa => {
                logEntries.push({ message: `${pa.memberName}: ${pa.action}`, type: 'party-action' });
            });
            if (result.narrative) {
                result.narrative.split('\n').filter(l => l.trim()).forEach(line => {
                    logEntries.push({ message: line, type: 'narrative' });
                });
            }

            await this.addLogsSequentially(logEntries);

            let fullActionLog = action;
            result.enemyActions?.forEach(ea => { fullActionLog += `\n${ea.enemyName}: ${ea.action}`; });
            result.partyActions?.forEach(pa => { fullActionLog += `\n${pa.memberName}: ${pa.action}`; });
            addEncounterLogEntry(fullActionLog, result.narrative || 'Action resolved');

            // ── Phase 4: Run local clash engine ──────────────────────────
            const clashResult    = this._runClashResolution(
                response,
                currentEncounter.selectedSkill ?? null
            );
            const clashLogLines  = clashResult?.logLines     ?? [];
            const clashMoraleDelta = clashResult?.moraleDelta ?? 0;
            const killedEnemies  = clashResult?.killedEnemies ?? [];
            if (clashLogLines?.length) {
                this.addToLog('── Clash Resolution ──', 'system');
                for (const line of clashLogLines) {
                    this.addToLog(line, 'clash-result');
                }
            }

            // ── Update visuals ────────────────────────────────────────────
            this.updateCombatUI(result.combatStats);

            // ── Morale / Light / Scene post-round updates ─────────────────
            this._applyPostRoundUpdates(result.combatStats, prevStats, clashMoraleDelta, killedEnemies);

            // ── Check combat end ──────────────────────────────────────────────
            if (result.combatEnd) {
                await this.endCombat(result.result || 'unknown');
                return;
            }

            this.modal.querySelectorAll('.rpg-encounter-action-btn, #rpg-encounter-custom-submit').forEach(btn => {
                btn.disabled = false;
            });

        } catch (error) {
            console.error('[RPG Companion] Error processing combat action:', error);
            this.showErrorWithRegenerate(`Error processing action: ${error.message}`);
            this.modal.querySelectorAll('.rpg-encounter-action-btn, #rpg-encounter-custom-submit').forEach(btn => {
                btn.disabled = false;
            });
        } finally {
            this.isProcessing = false;
        }
    }

    // ── Phase 4: Clash resolution pipeline ───────────────────────────────────

    /**
     * Parse Rev 4 combat tags from an AI response, run the clash engine,
     * apply results to engine state + player bars, and return log lines
     * for display in the combat log.
     *
     * Returns null if no combat tags were found (engine stays idle this round).
     *
     * @param {string} rawResponse   — full AI response text
     * @param {string|null} skillId  — ID of the combat skill the player used this round
     * @returns {string[]|null}      — array of log lines, or null if no tags
     */
    _runClashResolution(rawResponse, skillId) {
        const parsed = parseCombatTags(rawResponse);
        if (!parsed.hasTags) return null;

        const logLines = [];
        const es       = currentEncounter.engineState;
        if (!es) return null;

        // ── 1. Log any parse errors ───────────────────────────────────────────
        for (const err of parsed.errors) {
            logLines.push(`⚠ Tag parse error: ${err}`);
            console.warn('[EncounterUI] Tag parse error:', err);
        }

        // ── 2. Register new enemies from enemy_init tags ──────────────────────
        for (const init of parsed.enemyInits) {
            const args = initToUpsertArgs(init);
            upsertCombatant(init.name, args);
            logLines.push(`⚔ ${init.name} enters the battle (${args.hp} HP)`);
        }

        // ── 3. Reset transient round state ────────────────────────────────────
        resetEngineRoundState();

        // Expire saved dice for all combatants at round start
        for (const name of Object.keys(es.combatants)) {
            expireSavedDice(name);
        }

        es.roundNumber = (es.roundNumber ?? 0) + 1;

        // ── 4. Group enemy actions by skill and resolve enemy name ────────────
        const grouped      = groupEnemyActions(parsed.enemyActions);
        const livingEnemies = Object.values(es.combatants)
            .filter(c => c.hp > 0 && c.name !== '_player');

        // Build skill→enemy assignment map.
        // Persistent across rounds in es.skillOwners so consistent assignment is maintained.
        if (!es.skillOwners) es.skillOwners = {};

        const assignedThisRound = new Set();
        const skillGroups = [];

        for (const [skillName, dice] of Object.entries(grouped)) {
            // Already seen this skill before? Re-use the cached owner.
            let ownerName = es.skillOwners[skillName];

            // New skill: assign to the living enemy with the fewest assignments this round.
            if (!ownerName || !es.combatants[ownerName] || es.combatants[ownerName].hp <= 0) {
                const candidate = livingEnemies
                    .filter(e => !assignedThisRound.has(e.name))
                    .sort((a, b) => {
                        // prefer enemy not yet assigned a skill this round
                        const aCount = [...assignedThisRound].filter(n => n === a.name).length;
                        const bCount = [...assignedThisRound].filter(n => n === b.name).length;
                        return aCount - bCount;
                    })[0] ?? livingEnemies[0];

                ownerName = candidate?.name ?? null;
                if (ownerName) es.skillOwners[skillName] = ownerName;
            }

            if (!ownerName) {
                logLines.push(`⚠ Could not assign skill "${skillName}" to an enemy — skipped.`);
                continue;
            }

            assignedThisRound.add(ownerName);

            // Convert parsed dice to DieSpec format for clashEngine
            const enemyDiceSpecs = dice.map(d => ({
                diceType : d.type,
                sides    : d.dice.sides,
                modifier : d.dice.modifier ?? 0,
            }));

            // Speed spec comes from the die_index=1 entry
            const speedSpec = dice.find(d => d.dieIndex === 1)?.speed ?? null;

            skillGroups.push({ skillName, ownerName, enemyDiceSpecs, speedSpec });
        }

        // ── 5. Build player snap ──────────────────────────────────────────────
        const playerState = getCombatantState('_player');
        const isStaggered = playerState?.isStaggered ?? false;
        const playerSnap  = buildPlayerSnap({ isStaggered });

        // Merge engine state into snap (engine may have updated HP mid-fight)
        if (playerState) {
            playerSnap.hp             = playerState.hp;
            playerSnap.staggerResist  = playerState.staggerResist;
            playerSnap.isStaggered    = playerState.isStaggered;
        }

        // Ensure player is registered in engine state
        if (!playerState) {
            upsertCombatant('_player', {
                hp               : playerSnap.hp,
                maxHp            : playerSnap.maxHp,
                staggerResist    : playerSnap.staggerResist,
                maxStaggerResist : playerSnap.maxStaggerResist,
                isStaggered      : false,
                affinities       : playerSnap.affinities,
            });
        }

        // ── 6. Get player dice for this round ─────────────────────────────────
        const playerDice = skillId ? resolvePlayerDiceForSkillId(skillId) : [];

        // ── 7. Build initiative queue (sorts by speed roll) ───────────────────
        const initQueue = buildInitiativeQueue(
            skillGroups.map(g => ({ ...g, dice: g.enemyDiceSpecs, speedSpec: g.speedSpec }))
        );

        // ── 8. Resolve each clash in initiative order ─────────────────────────
        let totalHpDeltaPlayer      = 0;
        let totalStaggerDeltaPlayer = 0;
        let totalMoraleDeltaPlayer  = 0;
        const killedEnemies         = []; // { name, morale } at time of kill

        // Player morale tier modifier — baked into each player die
        const playerMoraleTier = getMoraleTier(currentEncounter.morale ?? 0);
        const playerDiceWithMorale = playerDice.map(d => ({
            ...d,
            modifier: (d.modifier ?? 0) + playerMoraleTier,
        }));

        for (const group of initQueue) {
            const enemyState = getCombatantState(group.ownerName);
            if (!enemyState) continue;

            // Enemy morale tier modifier — baked into each enemy die
            const enemyMoraleTier = getMoraleTier(enemyState.morale ?? 0);
            const enemyDiceWithMorale = group.enemyDiceSpecs.map(d => ({
                ...d,
                modifier: (d.modifier ?? 0) + enemyMoraleTier,
            }));

            const enemySnap = {
                hp               : enemyState.hp,
                maxHp            : enemyState.maxHp,
                staggerResist    : enemyState.staggerResist,
                maxStaggerResist : enemyState.maxStaggerResist,
                isStaggered      : enemyState.isStaggered,
                affinities       : enemyState.affinities ?? {},
                savedDice        : enemyState.savedDice  ?? [],
            };

            logLines.push(`— ${group.ownerName} uses "${group.skillName}" (speed ${group.speedRoll})`);

            const report = resolveClash(
                playerDiceWithMorale,
                enemyDiceWithMorale,
                playerSnap,
                enemySnap,
                es.roundNumber
            );

            // Apply report to mutable engine states
            const livePlayer = getCombatantState('_player');
            const liveEnemy  = enemyState;

            const changes = applyClashReport(report, livePlayer ?? playerSnap, liveEnemy, es.roundNumber);

            // Accumulate player deltas
            totalHpDeltaPlayer      += report.hpDeltaPlayer;
            totalStaggerDeltaPlayer += report.staggerDeltaPlayer;
            totalMoraleDeltaPlayer  += report.moraleDeltaPlayer;

            // Apply morale delta to this enemy
            enemyState.morale = clampMorale((enemyState.morale ?? 0) + report.moraleDeltaEnemy);

            // Track kills for post-round morale bonus
            if (changes.enemyKilled) {
                killedEnemies.push({ name: group.ownerName, morale: enemyState.morale });
            }

            // Log each clash line
            for (const line of report.logLines) {
                logLines.push(`  ${line}`);
            }

            if (changes.playerStaggered) logLines.push('  💫 You are STAGGERED!');
            if (changes.enemyStaggered)  logLines.push(`  💫 ${group.ownerName} is STAGGERED!`);
            if (changes.enemyKilled)     logLines.push(`  💀 ${group.ownerName} defeated!`);
            if (changes.playerKilled)    logLines.push('  💀 You have been defeated...');

            // Log the clash to encounter state
            const allSkills = [];
            try { allSkills.push(...(getEquippedSkills() || [])); } catch { /* ok */ }
            const playerSkillName = allSkills.find(s => s.id === skillId)?.name ?? skillId ?? '(no skill)';
            logClash('_player', group.ownerName, playerSkillName, group.skillName, report);

            // ── Log clash dice as two grouped entries (player skill / enemy skill) ──
            {
                const playerPairs = (report.pairs ?? []).filter(p => p.playerDie && p.playerRoll !== null);
                if (playerPairs.length) {
                    const formulas = playerPairs.map(p => {
                        const mod = p.playerDie.modifier ?? 0;
                        const ms  = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '';
                        return `1d${p.playerDie.sides}${ms}`;
                    });
                    logDiceRoll(
                        formulas.join(' / '),
                        playerPairs.reduce((s, p) => s + p.playerRoll, 0),
                        playerPairs.map(p => p.playerRoll - (p.playerDie.modifier ?? 0)),
                        playerSkillName
                    );
                }

                const enemyPairs = (report.pairs ?? []).filter(p => p.enemyDie && p.enemyRoll !== null);
                if (enemyPairs.length) {
                    const formulas = enemyPairs.map(p => {
                        const mod = p.enemyDie.modifier ?? 0;
                        const ms  = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '';
                        return `1d${p.enemyDie.sides}${ms}`;
                    });
                    logDiceRoll(
                        formulas.join(' / '),
                        enemyPairs.reduce((s, p) => s + p.enemyRoll, 0),
                        enemyPairs.map(p => p.enemyRoll - (p.enemyDie.modifier ?? 0)),
                        `${group.ownerName} — ${group.skillName}`
                    );
                }
            }
        }

        // ── 9. Write player deltas back to bars ───────────────────────────────
        if (totalHpDeltaPlayer !== 0 || totalStaggerDeltaPlayer !== 0) {
            writePlayerDeltas(totalHpDeltaPlayer, totalStaggerDeltaPlayer);
        }

        return { logLines, moraleDelta: totalMoraleDeltaPlayer, killedEnemies };
    }

    // ── Post-round Morale / Light / Scene ────────────────────────────────────

    /**
     * Apply morale changes from the round's outcome, regen Light,
     * advance the Scene counter, and refresh the HUD.
     *
     * Morale sources:
     *   - Per-die clash wins/losses → clashMoraleDelta (from clashEngine)
     *   - Enemy eliminated          → +10 to +15 (scales with enemy's morale tier)
     *   - Ally eliminated           → -10 to -25 (scales with highest living enemy's morale tier)
     *
     * @param {object}   newStats         combatStats from the AI response
     * @param {object}   prevStats        snapshot of combatStats before the round
     * @param {number}   clashMoraleDelta net player morale change from clash engine
     * @param {Array}    killedEnemies    [{ name, morale }] enemies killed during clash
     */
    _applyPostRoundUpdates(newStats, prevStats, clashMoraleDelta = 0, killedEnemies = []) {
        let moraleDelta = clashMoraleDelta;

        // ── Log per-die morale result ─────────────────────────────────────────
        if (clashMoraleDelta > 0) {
            this.addToLog(`+${clashMoraleDelta} Morale (clash wins)`, 'sanity-gain');
        } else if (clashMoraleDelta < 0) {
            this.addToLog(`${clashMoraleDelta} Morale (clash losses)`, 'sanity-loss');
        }

        // ── Enemy elimination bonuses ─────────────────────────────────────────
        // Engine-tracked kills (from clash resolution)
        for (const killed of killedEnemies) {
            const gain = moraleGainOnKill(killed.morale);
            moraleDelta += gain;
            this.addToLog(`${killed.name} defeated! +${gain} Morale`, 'sanity-gain');
        }

        // AI-reported kills not caught by the engine (HP went to 0 in JSON)
        if (newStats?.enemies && prevStats?.enemies) {
            newStats.enemies.forEach((enemy, i) => {
                const prev = prevStats.enemies[i];
                const alreadyCounted = killedEnemies.some(k => k.name === enemy.name);
                if (prev && prev.hp > 0 && enemy.hp <= 0 && !alreadyCounted) {
                    const gain = moraleGainOnKill(0); // no engine state — use neutral morale
                    moraleDelta += gain;
                    this.addToLog(`${enemy.name} defeated! +${gain} Morale`, 'sanity-gain');
                }
            });
        }

        // ── Ally elimination penalties ────────────────────────────────────────
        if (newStats?.party && prevStats?.party) {
            // Find the highest-morale living enemy as the "killer" proxy
            const es = currentEncounter.engineState;
            const highestEnemyMorale = Object.values(es?.combatants ?? {})
                .filter(c => c.hp > 0 && c.name !== '_player')
                .reduce((max, c) => Math.max(max, c.morale ?? 0), 0);

            newStats.party.forEach((member, i) => {
                const prev = prevStats.party[i];
                if (prev && prev.hp > 0 && member.hp <= 0) {
                    const loss = moraleLossOnAllyDeath(highestEnemyMorale);
                    moraleDelta += loss;
                    this.addToLog(`${member.name} defeated! ${loss} Morale`, 'sanity-loss');
                }
            });
        }

        // ── Apply morale to player ────────────────────────────────────────────
        if (moraleDelta !== 0) {
            currentEncounter.morale = clampMorale((currentEncounter.morale ?? 0) + moraleDelta);
        }

        // ── Sanity: E.G.O corrosion check (sanity still driven by E.G.O costs) ──
        {
            const wasInCorrosion = currentEncounter.corrosion.active;
            const currentSanity  = currentEncounter.sanity.current;

            if (currentSanity <= SANITY_MIN && !wasInCorrosion) {
                currentEncounter.corrosion.active = true;
                this.addToLog('⚠ E.G.O CORROSION triggered! Only E.G.O skills available until Sanity ≥ 0.', 'corrosion-trigger');
            }
            if (wasInCorrosion && currentSanity >= 0) {
                currentEncounter.corrosion.active = false;
                this.addToLog('✓ E.G.O Corrosion ended. Normal skills restored.', 'corrosion-end');
            }
        }

        // ── Regen Light & advance Scene ───────────────────────────────────────
        regenLight(currentEncounter.light);
        advanceScene(currentEncounter);

        currentEncounter.selectedSkill = null;

        // ── Refresh HUD and skill buttons ─────────────────────────────────────
        this.updateHUD();
        this._refreshCombatSkillsSection();
    }

    // ── Update combat UI (HP bars etc.) ──────────────────────────────────────

    updateCombatUI(combatStats) {
        // Enemy HP bars
        combatStats.enemies.forEach((enemy, index) => {
            const card = this.modal.querySelector(`[data-enemy-index="${index}"]`);
            if (!card) return;
            const hpPercent = (enemy.hp / enemy.maxHp) * 100;
            if (enemy.hp <= 0) card.classList.add('rpg-encounter-dead');
            const hpBar  = card.querySelector('.rpg-encounter-hp-fill');
            const hpText = card.querySelector('.rpg-encounter-hp-text');
            if (hpBar)  hpBar.style.width   = `${hpPercent}%`;
            if (hpText) hpText.textContent  = `${enemy.hp}/${enemy.maxHp} HP`;
        });

        // Party HP bars
        combatStats.party.forEach((member, index) => {
            const card = this.modal.querySelector(`[data-party-index="${index}"]`);
            if (!card) return;
            const hpPercent = (member.hp / member.maxHp) * 100;
            if (member.hp <= 0) card.classList.add('rpg-encounter-dead');
            const hpBar  = card.querySelector('.rpg-encounter-hp-fill');
            const hpText = card.querySelector('.rpg-encounter-hp-text');
            if (hpBar)  hpBar.style.width   = `${hpPercent}%`;
            if (hpText) hpText.textContent  = `${member.hp}/${member.maxHp} HP`;
        });

        // Re-render controls if player died or actions changed
        const player           = combatStats.party.find(m => m.isPlayer);
        const controlsContainer = this.modal.querySelector('.rpg-encounter-controls');

        if (player && player.hp <= 0) {
            if (controlsContainer) {
                controlsContainer.innerHTML = '<p class="rpg-encounter-defeated">You have been defeated...</p>';
            }
        } else if (currentEncounter.playerActions && controlsContainer) {
            if (this.haveActionsChanged(currentEncounter.playerActions)) {
                this._previousPlayerActions = {
                    items: currentEncounter.playerActions.items ? [...currentEncounter.playerActions.items] : [],
                };
                const newControlsHTML = this.renderPlayerControls(combatStats.party, currentEncounter.playerActions);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = newControlsHTML;
                const newControls = tempDiv.firstElementChild;
                if (newControls) controlsContainer.replaceWith(newControls);
            }
        }

        // ── Session 7: keep HUD in sync ───────────────────────────────────────
        this.updateHUD();
    }

    haveActionsChanged(playerActions) {
        if (!this._previousPlayerActions) {
            this._previousPlayerActions = {
                items: playerActions.items ? [...playerActions.items] : [],
            };
            return false;
        }

        const currentItems = playerActions.items || [];
        const prevItems    = this._previousPlayerActions.items || [];

        return false;
    }

    // ── Log helpers ───────────────────────────────────────────────────────────

    async addLogsSequentially(entries, delay = 400) {
        for (const entry of entries) {
            this.addToLog(entry.message, entry.type);
            if (entries.indexOf(entry) < entries.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    addToLog(message, type = '') {
        const logContainer = this.modal.querySelector('#rpg-encounter-log');
        if (!logContainer) return;
        const entry = document.createElement('div');
        entry.className   = `rpg-encounter-log-entry ${type}`;
        entry.style.whiteSpace = 'pre-wrap';
        entry.textContent = message;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // ── End combat ────────────────────────────────────────────────────────────

    async concludeEncounter() {
        if (!currentEncounter.active) return;
        await this.endCombat('interrupted');
    }

    async endCombat(result) {
        try {
            this.showCombatOverScreen(result);

            const summaryPrompt   = await buildCombatSummaryPrompt(currentEncounter.encounterLog, result);
            const summaryResponse = await safeGenerateRaw({ prompt: summaryPrompt, quietToLoud: false });

            if (summaryResponse) {
                const summary     = summaryResponse.replace(/\[FIGHT CONCLUDED\]\s*/i, '').trim();
                const speakerName = this.getCombatNarrator();

                try {
                    await executeSlashCommandsOnChatInput(
                        `/sendas name="${speakerName}" ${summary}`,
                        { clearChatInput: false }
                    );
                    this.updateCombatOverScreen(true, speakerName);
                } catch (sendError) {
                    console.error('[RPG Companion] Error using /sendas command:', sendError);
                    if (chat?.length > 0) {
                        const lastMessage = chat[chat.length - 1];
                        if (lastMessage) {
                            lastMessage.mes += '\n\n' + summary;
                            saveChatDebounced();
                        }
                    }
                    this.updateCombatOverScreen(true, 'chat');
                }

                const context = getContext();
                if (context.chatId) {
                    saveEncounterLog(context.chatId, {
                        log:     currentEncounter.encounterLog,
                        summary: summary,
                        result:  result,
                    });
                }
            } else {
                this.updateCombatOverScreen(false);
            }
        } catch (error) {
            console.error('[RPG Companion] Error ending combat:', error);
            this.updateCombatOverScreen(false);
        }
    }

    getCombatNarrator() {
        if (selected_group) {
            const group        = groups.find(g => g.id === selected_group);
            const groupMembers = getGroupMembers(selected_group);

            if (groupMembers?.length > 0) {
                const disabled = group?.disabled_members || [];

                const narrator = groupMembers.find(m =>
                    m?.name && !disabled.includes(m.avatar) &&
                    ['narrator', 'gm', 'game master'].includes(m.name.toLowerCase())
                );
                if (narrator) return narrator.name;

                const firstActive = groupMembers.find(m => m?.name && !disabled.includes(m.avatar));
                if (firstActive) return firstActive.name;
            }
        }

        if (this_chid !== undefined && characters?.[this_chid]) return characters[this_chid].name;
        return 'Narrator';
    }

    showCombatOverScreen(result) {
        const mainContent = this.modal.querySelector('#rpg-encounter-main');
        if (!mainContent) return;

        const icons  = { victory: 'fa-trophy', defeat: 'fa-skull-crossbones', fled: 'fa-person-running', interrupted: 'fa-flag-checkered' };
        const colors = { victory: '#4caf50',  defeat: '#e94560',              fled: '#ff9800',           interrupted: '#888' };

        mainContent.innerHTML = `
            <div class="rpg-encounter-over" style="text-align:center;padding:40px 20px;">
                <i class="fa-solid ${icons[result] || 'fa-flag-checkered'}" style="font-size:72px;color:${colors[result] || '#888'};margin-bottom:24px;"></i>
                <h2 style="font-size:32px;margin-bottom:16px;text-transform:uppercase;">${result}</h2>
                <p style="font-size:18px;margin-bottom:32px;opacity:0.8;">Generating combat summary...</p>
                <div class="rpg-encounter-loading" style="display:flex;justify-content:center;align-items:center;gap:12px;">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size:24px;"></i>
                    <span>Please wait...</span>
                </div>
            </div>
        `;
    }

    updateCombatOverScreen(success, speakerName = '') {
        const mainContent = this.modal.querySelector('#rpg-encounter-main');
        if (!mainContent) return;
        const overScreen = mainContent.querySelector('.rpg-encounter-over');
        if (!overScreen) return;

        if (success) {
            overScreen.querySelector('p').textContent = speakerName
                ? `Combat summary has been added to the chat by ${speakerName}.`
                : 'Combat summary has been added to the chat.';
            overScreen.querySelector('.rpg-encounter-loading').innerHTML = `
                <button id="rpg-encounter-close-final" class="rpg-encounter-submit-btn" style="font-size:18px;padding:12px 24px;">
                    <i class="fa-solid fa-check"></i> Close Combat Window
                </button>
            `;
            overScreen.querySelector('#rpg-encounter-close-final')?.addEventListener('click', () => this.close());
        } else {
            overScreen.querySelector('p').textContent = 'Error generating combat summary.';
            overScreen.querySelector('.rpg-encounter-loading').innerHTML = `
                <p style="color:#e94560;">Failed to create summary. You can close this window.</p>
                <button id="rpg-encounter-close-final" class="rpg-encounter-submit-btn" style="font-size:18px;padding:12px 24px;margin-top:16px;">
                    <i class="fa-solid fa-times"></i> Close Combat Window
                </button>
            `;
            overScreen.querySelector('#rpg-encounter-close-final')?.addEventListener('click', () => this.close());
        }
    }

    // ── Error / loading states ────────────────────────────────────────────────

    showLoadingState(message) {
        const loadingContent = this.modal.querySelector('#rpg-encounter-loading');
        const mainContent    = this.modal.querySelector('#rpg-encounter-main');
        if (loadingContent) { loadingContent.querySelector('p').textContent = message; loadingContent.style.display = 'flex'; }
        if (mainContent)    mainContent.style.display = 'none';
    }

    showError(message) {
        const loadingContent = this.modal.querySelector('#rpg-encounter-loading');
        if (loadingContent) {
            loadingContent.innerHTML = `
                <i class="fa-solid fa-exclamation-triangle" style="color:#e94560;font-size:48px;"></i>
                <p style="color:#e94560;">${message}</p>
            `;
        }
    }

    showErrorWithRegenerate(message) {
        const loadingContent = this.modal.querySelector('#rpg-encounter-loading');
        const combatContent  = this.modal.querySelector('#rpg-encounter-content');
        if (combatContent)  combatContent.style.display  = 'none';

        if (loadingContent) {
            loadingContent.style.display = 'flex';
            loadingContent.innerHTML = `
                <div class="rpg-encounter-error-box">
                    <i class="fa-solid fa-exclamation-triangle" style="color:#e94560;font-size:48px;margin-bottom:1em;"></i>
                    <p style="color:#e94560;font-weight:bold;font-size:1.2em;margin:0 0 0.5em 0;">Wrong Format Detected</p>
                    <p style="color:var(--rpg-text,#ccc);margin:0 0 1.5em 0;max-width:500px;">${message}</p>
                    <div style="display:flex;gap:1em;">
                        <button id="rpg-error-regenerate" class="rpg-btn rpg-btn-primary">
                            <i class="fa-solid fa-rotate-right"></i> Regenerate
                        </button>
                        <button id="rpg-error-close" class="rpg-btn rpg-btn-secondary">
                            <i class="fa-solid fa-times"></i> Close
                        </button>
                    </div>
                </div>
            `;
            loadingContent.querySelector('#rpg-error-regenerate')?.addEventListener('click', () => this.regenerateLastRequest());
            loadingContent.querySelector('#rpg-error-close')?.addEventListener('click', () => this.close());
        }
    }

    async regenerateLastRequest() {
        if (!this.lastRequest) return;
        if (this.lastRequest.type === 'init') {
            this.isInitializing = true;
            await this.initialize();
        } else if (this.lastRequest.type === 'action') {
            this.isProcessing = true;
            await this.processCombatAction(this.lastRequest.action);
        }
    }

    applyEnvironmentStyling(styleNotes) {
        if (!styleNotes || typeof styleNotes !== 'object') return;
        const { environmentType, atmosphere, timeOfDay, weather } = styleNotes;
        if (environmentType) this.modal.setAttribute('data-environment', environmentType.toLowerCase());
        if (atmosphere)      this.modal.setAttribute('data-atmosphere',  atmosphere.toLowerCase());
        if (timeOfDay)       this.modal.setAttribute('data-time',        timeOfDay.toLowerCase());
        if (weather)         this.modal.setAttribute('data-weather',     weather.toLowerCase());
    }

    close() {
        if (this.modal) {
            this.modal.classList.remove('is-open');
            resetEncounter();
        }
    }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const encounterModal = new EncounterModal();

export function openEncounterModal() {
    encounterModal.open();
}
