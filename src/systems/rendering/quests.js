// fileName: quests.js
/**
 * Quests Rendering Module
 * Handles UI rendering for quests system (main and optional quests)
 */

import { extensionSettings, $questsContainer, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isItemLocked, setItemLock } from '../generation/lockManager.js';

/**
 * Safely parses quest data from legacy strings or current objects.
 * @param {any} q
 * @returns {{ title: string, expReward: number }}
 */
function getQuestData(q) {
    if (!q || q === 'None') return { title: '', expReward: 0 };
    if (typeof q === 'string') return { title: q, expReward: 0 };
    
    // Check for nested .value artifacts
    let extracted = q;
    while (typeof extracted === 'object' && extracted.value !== undefined) {
        extracted = extracted.value;
    }
    
    if (typeof extracted === 'string') return { title: extracted, expReward: 0 };
    return { title: extracted.title || '', expReward: extracted.expReward || 0 };
}

/**
 * Syncs the current extensionSettings.quests to committedTrackerData.userStats
 * This ensures quest changes made via UI are reflected in the data sent to AI
 */
function syncQuestsToCommittedData() {
    const currentData = committedTrackerData.userStats || lastGeneratedData.userStats;
    if (!currentData) return;

    const trimmed = currentData.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const jsonData = JSON.parse(currentData);
            if (jsonData && typeof jsonData === 'object') {
                jsonData.quests = extensionSettings.quests || { main: 'None', optional: [] };
                const updatedJSON = JSON.stringify(jsonData, null, 2);
                committedTrackerData.userStats = updatedJSON;
                lastGeneratedData.userStats = updatedJSON;
            }
        } catch (e) {
            console.warn('[RPG Quests] Failed to sync quests to committed data:', e);
        }
    }
}

/**
 * Helper to generate lock icon HTML if setting is enabled
 */
function getLockIconHtml(tracker, path) {
    const showLockIcons = extensionSettings.showLockIcons ?? true;
    if (!showLockIcons) return '';

    const isLocked = isItemLocked(tracker, path);
    const lockIcon = isLocked ? '🔒' : '🔓';
    const lockTitle = isLocked ? 'Locked' : 'Unlocked';
    const lockedClass = isLocked ? ' locked' : '';
    return `<span class="rpg-section-lock-icon${lockedClass}" data-tracker="${tracker}" data-path="${path}" title="${lockTitle}">${lockIcon}</span>`;
}

/**
 * HTML escape helper
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Renders the quests sub-tab navigation (Main, Optional)
 */
export function renderQuestsSubTabs(activeTab = 'main') {
    return `
        <div class="rpg-quests-subtabs">
            <button class="rpg-quests-subtab ${activeTab === 'main' ? 'active' : ''}" data-tab="main">
                Main Quest
            </button>
            <button class="rpg-quests-subtab ${activeTab === 'optional' ? 'active' : ''}" data-tab="optional">
                Optional Quests
            </button>
        </div>
    `;
}

/**
 * Renders the main quest view
 */
export function renderMainQuestView(mainQuestRaw) {
    const q = getQuestData(mainQuestRaw);
    const hasQuest = q.title.length > 0;

    return `
        <div class="rpg-quest-section">
            <div class="rpg-quest-header">
                <h3 class="rpg-quest-section-title">Main Quests</h3>
                ${!hasQuest ? `<button class="rpg-add-quest-btn" data-action="add-quest" data-field="main" title="Add main quests">
                    <i class="fa-solid fa-plus"></i> Add Quest
                </button>` : ''}
            </div>
            <div class="rpg-quest-content">
                ${hasQuest ? `
                    <div class="rpg-inline-form" id="rpg-edit-quest-form-main" style="display: none;">
                        <input type="text" class="rpg-inline-input" id="rpg-edit-quest-main" value="${escapeHtml(q.title)}" />
                        <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                            <label style="font-size: 0.85em; opacity: 0.8;">EXP Reward:</label>
                            <input type="number" class="rpg-inline-input" id="rpg-edit-quest-exp-main" value="${q.expReward}" min="0" style="width: 80px; padding: 4px 8px;" />
                        </div>
                        <div class="rpg-inline-buttons" style="margin-top: 8px;">
                            <button class="rpg-inline-btn rpg-inline-cancel" data-action="cancel-edit-quest" data-field="main">
                                <i class="fa-solid fa-times"></i> Cancel
                            </button>
                            <button class="rpg-inline-btn rpg-inline-save" data-action="save-edit-quest" data-field="main">
                                <i class="fa-solid fa-check"></i> Save
                            </button>
                        </div>
                    </div>
                    <div class="rpg-quest-item" id="rpg-quest-display-main" data-field="main">
                        ${getLockIconHtml('userStats', 'quests.main')}
                        <div class="rpg-quest-title">
                            ${escapeHtml(q.title)}
                            ${q.expReward > 0 ? `<span style="font-size: 0.75em; color: #f1c40f; background: rgba(241, 196, 15, 0.15); padding: 2px 6px; border-radius: 4px; margin-left: 8px; border: 1px solid rgba(241,196,15,0.3); white-space: nowrap;">+${q.expReward} EXP</span>` : ''}
                        </div>
                        <div class="rpg-quest-actions">
                            <button class="rpg-quest-edit" data-action="edit-quest" data-field="main" title="Edit quest">
                                <i class="fa-solid fa-edit"></i>
                            </button>
                            <button class="rpg-quest-remove" data-action="remove-quest" data-field="main" title="Complete/Remove quest">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        </div>
                    </div>
                ` : `
                    <div class="rpg-inline-form" id="rpg-add-quest-form-main" style="display: none;">
                        <input type="text" class="rpg-inline-input" id="rpg-new-quest-main" placeholder="Enter main quest title..." />
                        <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                            <label style="font-size: 0.85em; opacity: 0.8;">EXP Reward:</label>
                            <input type="number" class="rpg-inline-input" id="rpg-new-quest-exp-main" value="0" min="0" style="width: 80px; padding: 4px 8px;" />
                        </div>
                        <div class="rpg-inline-actions" style="margin-top: 8px; display: flex; justify-content: flex-end; gap: 0.5rem;">
                            <button class="rpg-inline-btn rpg-inline-cancel" data-action="cancel-add-quest" data-field="main">
                                <i class="fa-solid fa-times"></i> Cancel
                            </button>
                            <button class="rpg-inline-btn rpg-inline-save" data-action="save-add-quest" data-field="main">
                                <i class="fa-solid fa-check"></i> Add
                            </button>
                        </div>
                    </div>
                    <div class="rpg-quest-empty">No active main quests</div>
                `}
            </div>
            <div class="rpg-quest-hint">
                <i class="fa-solid fa-lightbulb"></i>
                The main quests represent your primary objective in the story.
            </div>
        </div>
    `;
}

/**
 * Renders the optional quests view
 */
export function renderOptionalQuestsView(optionalQuestsRaw) {
    const quests = (optionalQuestsRaw || []).filter(q => q && q !== 'None');

    let questsHtml = '';
    if (quests.length === 0) {
        questsHtml = '<div class="rpg-quest-empty">No active optional quests</div>';
    } else {
        questsHtml = quests.map((qData, index) => {
            const q = getQuestData(qData);
            return `
            <div class="rpg-quest-item-container" data-index="${index}" style="margin-bottom: 8px;">
                <div class="rpg-inline-form" id="rpg-edit-quest-form-optional-${index}" style="display: none;">
                    <input type="text" class="rpg-inline-input" id="rpg-edit-quest-optional-${index}" value="${escapeHtml(q.title)}" placeholder="Quest Title" />
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                        <label style="font-size: 0.85em; opacity: 0.8;">EXP Reward:</label>
                        <input type="number" class="rpg-inline-input" id="rpg-edit-quest-exp-optional-${index}" value="${q.expReward}" min="0" style="width: 80px; padding: 4px 8px;" />
                    </div>
                    <div class="rpg-inline-buttons" style="margin-top: 8px;">
                        <button class="rpg-inline-btn rpg-inline-cancel" data-action="cancel-edit-quest" data-field="optional" data-index="${index}">
                            <i class="fa-solid fa-times"></i> Cancel
                        </button>
                        <button class="rpg-inline-btn rpg-inline-save" data-action="save-edit-quest" data-field="optional" data-index="${index}">
                            <i class="fa-solid fa-check"></i> Save
                        </button>
                    </div>
                </div>
                <div class="rpg-quest-item" id="rpg-quest-display-optional-${index}" data-field="optional" data-index="${index}">
                    ${getLockIconHtml('userStats', `quests.optional[${index}]`)}
                    <div class="rpg-quest-title">
                        ${escapeHtml(q.title)}
                        ${q.expReward > 0 ? `<span style="font-size: 0.75em; color: #f1c40f; background: rgba(241, 196, 15, 0.15); padding: 2px 6px; border-radius: 4px; margin-left: 8px; border: 1px solid rgba(241,196,15,0.3); white-space: nowrap;">+${q.expReward} EXP</span>` : ''}
                    </div>
                    <div class="rpg-quest-actions">
                        <button class="rpg-quest-edit" data-action="edit-quest" data-field="optional" data-index="${index}" title="Edit quest">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="rpg-quest-remove" data-action="remove-quest" data-field="optional" data-index="${index}" title="Complete/Remove quest">
                            <i class="fa-solid fa-check"></i>
                        </button>
                    </div>
                </div>
            </div>
        `}).join('');
    }

    return `
        <div class="rpg-quest-section">
            <div class="rpg-quest-header">
                <h3 class="rpg-quest-section-title">Optional Quests</h3>
                <button class="rpg-add-quest-btn" data-action="add-quest" data-field="optional" title="Add optional quest">
                    <i class="fa-solid fa-plus"></i> Add Quest
                </button>
            </div>
            <div class="rpg-quest-content">
                <div class="rpg-inline-form" id="rpg-add-quest-form-optional" style="display: none;">
                    <input type="text" class="rpg-inline-input" id="rpg-new-quest-optional" placeholder="Enter optional quest title..." />
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                        <label style="font-size: 0.85em; opacity: 0.8;">EXP Reward:</label>
                        <input type="number" class="rpg-inline-input" id="rpg-new-quest-exp-optional" value="0" min="0" style="width: 80px; padding: 4px 8px;" />
                    </div>
                    <div class="rpg-inline-buttons" style="margin-top: 8px;">
                        <button class="rpg-inline-btn rpg-inline-cancel" data-action="cancel-add-quest" data-field="optional">
                            <i class="fa-solid fa-times"></i> Cancel
                        </button>
                        <button class="rpg-inline-btn rpg-inline-save" data-action="save-add-quest" data-field="optional">
                            <i class="fa-solid fa-check"></i> Add
                        </button>
                    </div>
                </div>
                <div class="rpg-quest-list">
                    ${questsHtml}
                </div>
                <div class="rpg-quest-hint">
                    <i class="fa-solid fa-info-circle"></i>
                    Optional quests are side objectives that complement your main story.
                </div>
            </div>
        </div>
    `;
}

/**
 * Main render function for quests
 */
export function renderQuests() {
    if (!extensionSettings.showInventory || !$questsContainer) {
        return;
    }

    const activeSubTab = $questsContainer.data('active-subtab') || 'main';

    let html = '<div class="rpg-quests-wrapper">';
    html += renderQuestsSubTabs(activeSubTab);

    html += '<div class="rpg-quests-panels">';
    if (activeSubTab === 'main') {
        html += renderMainQuestView(extensionSettings.quests.main);
    } else {
        html += renderOptionalQuestsView(extensionSettings.quests.optional);
    }
    html += '</div></div>';

    $questsContainer.html(html);
    attachQuestEventHandlers();
}

/**
 * Attach event handlers for quest interactions
 */
function attachQuestEventHandlers() {
    // Sub-tab switching
    $questsContainer.find('.rpg-quests-subtab').on('click', function() {
        const tab = $(this).data('tab');
        $questsContainer.data('active-subtab', tab);
        renderQuests();
    });

    // Add quest button
    $questsContainer.find('[data-action="add-quest"]').on('click', function() {
        const field = $(this).data('field');
        $(`#rpg-add-quest-form-${field}`).show();
        $(`#rpg-new-quest-${field}`).focus();
    });

    // Cancel add quest
    $questsContainer.find('[data-action="cancel-add-quest"]').on('click', function() {
        const field = $(this).data('field');
        $(`#rpg-add-quest-form-${field}`).hide();
        $(`#rpg-new-quest-${field}`).val('');
        $(`#rpg-new-quest-exp-${field}`).val('0');
    });

    // Save add quest
    $questsContainer.find('[data-action="save-add-quest"]').on('click', function() {
        const field = $(this).data('field');
        const title = $(`#rpg-new-quest-${field}`).val().trim();
        const expReward = parseInt($(`#rpg-new-quest-exp-${field}`).val()) || 0;

        if (title) {
            const questObj = { title, expReward };
            if (field === 'main') {
                extensionSettings.quests.main = questObj;
            } else {
                if (!extensionSettings.quests.optional) extensionSettings.quests.optional = [];
                extensionSettings.quests.optional.push(questObj);
            }
            syncQuestsToCommittedData();
            saveSettings();
            saveChatData();
            renderQuests();
        }
    });

    // Edit quest
    $questsContainer.find('[data-action="edit-quest"]').on('click', function() {
        const field = $(this).data('field');
        const index = $(this).data('index');
        
        if (field === 'main') {
            $(`#rpg-edit-quest-form-main`).show();
            $('#rpg-quest-display-main').hide();
            $(`#rpg-edit-quest-main`).focus();
        } else {
            $(`#rpg-edit-quest-form-optional-${index}`).show();
            $(`#rpg-quest-display-optional-${index}`).hide();
            $(`#rpg-edit-quest-optional-${index}`).focus();
        }
    });

    // Cancel edit quest
    $questsContainer.find('[data-action="cancel-edit-quest"]').on('click', function() {
        const field = $(this).data('field');
        const index = $(this).data('index');
        
        if (field === 'main') {
            $(`#rpg-edit-quest-form-main`).hide();
            $('#rpg-quest-display-main').show();
        } else {
            $(`#rpg-edit-quest-form-optional-${index}`).hide();
            $(`#rpg-quest-display-optional-${index}`).show();
        }
    });

    // Save edit quest
    $questsContainer.find('[data-action="save-edit-quest"]').on('click', function() {
        const field = $(this).data('field');
        const index = $(this).data('index');
        
        if (field === 'main') {
            const title = $(`#rpg-edit-quest-main`).val().trim();
            const exp = parseInt($(`#rpg-edit-quest-exp-main`).val()) || 0;
            if (title) {
                extensionSettings.quests.main = { title, expReward: exp };
                syncQuestsToCommittedData();
                saveSettings();
                saveChatData();
                renderQuests();
            }
        } else {
            const title = $(`#rpg-edit-quest-optional-${index}`).val().trim();
            const exp = parseInt($(`#rpg-edit-quest-exp-optional-${index}`).val()) || 0;
            if (title) {
                extensionSettings.quests.optional[index] = { title, expReward: exp };
                syncQuestsToCommittedData();
                saveSettings();
                saveChatData();
                renderQuests();
            }
        }
    });

    // Remove quest (Complete)
    $questsContainer.find('[data-action="remove-quest"]').on('click', async function() {
        const field = $(this).data('field');
        const index = $(this).data('index');
        let expToAward = 0;

        if (field === 'main') {
            const q = getQuestData(extensionSettings.quests.main);
            expToAward = q.expReward || 0;
            extensionSettings.quests.main = 'None';
        } else {
            const q = getQuestData(extensionSettings.quests.optional[index]);
            expToAward = q.expReward || 0;
            extensionSettings.quests.optional.splice(index, 1);
        }

        // Apply EXP if applicable and stat sheet is active
        if (expToAward > 0) {
            if (!extensionSettings.statSheet?.enabled) {
                console.warn('[RPG Companion] Quest EXP skipped — stat sheet is not enabled.');
            } else {
                try {
                    const { queueExpGain } = await import('../features/expGain.js');
                    queueExpGain(expToAward); // fire-and-forget — popup handles confirm/deny
                } catch (err) {
                    console.error('[RPG Companion] Failed to load expGain module:', err);
                }
            }
        } else {
            console.log('[RPG Companion] Quest completed with no EXP reward (expReward was 0).');
        }

        syncQuestsToCommittedData();
        saveSettings();
        saveChatData();
        renderQuests();
    });

    // Enter key to save in forms
    $questsContainer.find('.rpg-inline-input').on('keypress', function(e) {
        if (e.which === 13) {
            const $form = $(this).closest('.rpg-inline-form');
            $form.find('.rpg-inline-save').click();
        }
    });

    // Section lock icon clicks
    $questsContainer.find('.rpg-section-lock-icon').on('click touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $icon = $(this);
        const trackerType = $icon.data('tracker');
        const itemPath = $icon.data('path');
        const currentlyLocked = isItemLocked(trackerType, itemPath);

        setItemLock(trackerType, itemPath, !currentlyLocked);

        const newIcon = !currentlyLocked ? '🔒' : '🔓';
        const newTitle = !currentlyLocked ? 'Locked' : 'Unlocked';
        $icon.text(newIcon);
        $icon.attr('title', newTitle);
        $icon.toggleClass('locked', !currentlyLocked);

        saveSettings();
    });
}
