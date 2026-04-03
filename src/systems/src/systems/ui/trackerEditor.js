/**
 * Tracker Editor Module
 * Provides UI for customizing tracker configurations
 */
import { i18n } from '../../core/i18n.js';
import { extensionSettings } from '../../core/state.js';
import {
    saveSettings,
    saveStatSheetData,
    getPresets,
    getPreset,
    getActivePresetId,
    getDefaultPresetId,
    setDefaultPreset,
    isDefaultPreset,
    createPreset,
    saveToPreset,
    loadPreset,
    renamePreset,
    deletePreset,
    associatePresetWithCurrentEntity,
    removePresetAssociationForCurrentEntity,
    getPresetForCurrentEntity,
    hasPresetAssociation,
    isAssociatedWithCurrentPreset,
    getCurrentEntityKey,
    getCurrentEntityName,
    exportPresets,
    importPresets
} from '../../core/persistence.js';
import { renderUserStats } from '../rendering/userStats.js';
import { renderInfoBox } from '../rendering/infoBox.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { updateFabWidgets } from './mobile.js';

let $editorModal = null;
let activeTab = 'userStats';
let tempConfig = null; // Temporary config for cancel functionality
let tempAssociation = null; // Temporary association state: { presetId: string|null, entityKey: string|null }
let originalAssociation = null; // Original association when editor opened

/**
 * Initialize the tracker editor modal
 */
export function initTrackerEditor() {
    // Modal will be in template.html, just set up event listeners
    $editorModal = $('#rpg-tracker-editor-popup');

    if (!$editorModal.length) {
        console.error('[RPG Companion] Tracker editor modal not found in template');
        return;
    }

    // Tab switching
    $(document).on('click', '.rpg-editor-tab', function() {
        $('.rpg-editor-tab').removeClass('active');
        $(this).addClass('active');

        activeTab = $(this).data('tab');
        $('.rpg-editor-tab-content').hide();
        $(`#rpg-editor-tab-${activeTab}`).show();
    });

    // Save button
    $(document).on('click', '#rpg-editor-save', function() {
        applyTrackerConfig();
        closeTrackerEditor();
    });

    // Cancel button
    $(document).on('click', '#rpg-editor-cancel', function() {
        closeTrackerEditor();
    });

    // Close X button
    $(document).on('click', '#rpg-close-tracker-editor', function() {
        closeTrackerEditor();
    });

    // Reset button
    $(document).on('click', '#rpg-editor-reset', function() {
        resetToDefaults();
        renderEditorUI();
    });

    // Close on background click
    $(document).on('click', '#rpg-tracker-editor-popup', function(e) {
        if (e.target.id === 'rpg-tracker-editor-popup') {
            closeTrackerEditor();
        }
    });

    // Open button
    $(document).on('click', '#rpg-open-tracker-editor', function() {
        openTrackerEditor();
    });

    // Export button
    $(document).on('click', '#rpg-editor-export', function() {
        exportTrackerPreset();
    });

    // Import button
    $(document).on('click', '#rpg-editor-import', function() {
        importTrackerPreset();
    });

    // Preset select change
    $(document).on('change', '#rpg-preset-select', function() {
        const presetId = $(this).val();
        if (presetId && presetId !== getActivePresetId()) {
            // Check if the current character had an association (either original or pending)
            const entityKey = getCurrentEntityKey();
            const wasAssociated = tempAssociation
                ? tempAssociation.presetId !== null
                : hasPresetAssociation();

            // Save current changes to the old preset before switching
            const currentPresetId = getActivePresetId();
            if (currentPresetId) {
                saveToPreset(currentPresetId);
            }
            // Load the new preset
            if (loadPreset(presetId)) {
                tempConfig = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));
                renderEditorUI();

                // If the character was associated with a preset, update temp association to new preset
                if (wasAssociated && entityKey) {
                    tempAssociation = { presetId: presetId, entityKey: entityKey };
                    const preset = getPreset(presetId);
                    toastr.info(`"${preset?.name || 'Unknown'}" will be associated with ${getCurrentEntityName()} when saved.`);
                } else {
                    toastr.success(`Switched to preset "${getPreset(presetId)?.name || 'Unknown'}".`);
                }

                updatePresetUI();
            }
        }
    });

    // New preset button
    $(document).on('click', '#rpg-preset-new', function() {
        const name = prompt('Enter a name for the new preset:');
        if (name && name.trim()) {
            const newId = createPreset(name.trim());
            updatePresetUI();
            $('#rpg-preset-select').val(newId);
            toastr.success(`Created preset "${name.trim()}".`);
        }
    });

    // Set as default preset button
    $(document).on('click', '#rpg-preset-default', function() {
        const currentPresetId = getActivePresetId();
        if (currentPresetId) {
            setDefaultPreset(currentPresetId);
            updatePresetUI();
            const preset = getPreset(currentPresetId);
            toastr.success(`"${preset?.name || 'Unknown'}" is now the default preset.`);
        }
    });

    // Delete preset button
    $(document).on('click', '#rpg-preset-delete', function() {
        const currentPresetId = getActivePresetId();
        const presets = getPresets();
        if (Object.keys(presets).length <= 1) {
            toastr.warning('Cannot delete the last preset.');
            return;
        }
        const preset = getPreset(currentPresetId);
        if (confirm(`Are you sure you want to delete the preset "${preset?.name || 'Unknown'}"?`)) {
            if (deletePreset(currentPresetId)) {
                tempConfig = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));
                renderEditorUI();
                updatePresetUI();
                toastr.success('Preset deleted.');
            }
        }
    });

    // Associate preset checkbox
    $(document).on('change', '#rpg-preset-associate', function() {
        const activePresetId = getActivePresetId();
        const preset = getPreset(activePresetId);
        const entityName = getCurrentEntityName();
        const entityKey = getCurrentEntityKey();

        if ($(this).is(':checked')) {
            // Store pending association (don't save yet)
            tempAssociation = { presetId: activePresetId, entityKey: entityKey };
            toastr.info(`"${preset?.name || 'Unknown'}" will be associated with ${entityName} when saved.`);
        } else {
            // Store pending removal (don't save yet)
            tempAssociation = { presetId: null, entityKey: entityKey };
            const defaultPresetId = getDefaultPresetId();
            const defaultPreset = getPreset(defaultPresetId);
            if (defaultPreset && defaultPresetId !== activePresetId) {
                toastr.info(`Association will be removed when saved. Default preset "${defaultPreset.name}" will apply on next character switch.`);
            } else {
                toastr.info(`Association will be removed for ${entityName} when saved.`);
            }
        }
    });
}

/**
 * Updates the preset management UI (dropdown, association checkbox, entity name)
 */
function updatePresetUI() {
    const presets = getPresets();
    const activePresetId = getActivePresetId();
    const defaultPresetId = getDefaultPresetId();
    const $select = $('#rpg-preset-select');

    // Populate the dropdown
    $select.empty();
    for (const [id, preset] of Object.entries(presets)) {
        const isDefault = id === defaultPresetId;
        const starPrefix = isDefault ? '★ ' : '';
        $select.append(`<option value="${id}">${starPrefix}${preset.name}</option>`);
    }
    $select.val(activePresetId);

    // Update the default button appearance
    const $defaultBtn = $('#rpg-preset-default');
    if (isDefaultPreset(activePresetId)) {
        $defaultBtn.addClass('rpg-btn-active').attr('title', 'This is the default preset');
    } else {
        $defaultBtn.removeClass('rpg-btn-active').attr('title', 'Set as Default Preset');
    }

    // Update the entity name display
    const entityName = getCurrentEntityName();
    $('#rpg-preset-entity-name').text(entityName);

    // Update the association checkbox
    // Use temp state if available, otherwise check actual association with CURRENT preset
    let isAssociated;
    if (tempAssociation !== null) {
        // Use pending state: checked if pending preset matches active preset
        isAssociated = tempAssociation.presetId === activePresetId;
    } else {
        // No pending changes, check actual state
        isAssociated = isAssociatedWithCurrentPreset();
    }
    $('#rpg-preset-associate').prop('checked', isAssociated);
}

/**
 * Open the tracker editor modal
 */
function openTrackerEditor() {
    // Create temporary copy for cancel functionality
    tempConfig = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));

    // Store original association state for cancel functionality
    const entityKey = getCurrentEntityKey();
    const currentAssociatedPreset = getPresetForCurrentEntity();
    originalAssociation = { presetId: currentAssociatedPreset, entityKey: entityKey };
    tempAssociation = null; // Reset pending changes

    // Set theme to match current extension theme
    const theme = extensionSettings.theme || 'modern';
    $editorModal.attr('data-theme', theme);

    // Update preset UI
    updatePresetUI();

    renderEditorUI();
    $editorModal.addClass('is-open').css('display', '');
}

/**
 * Close the tracker editor modal
 */
function closeTrackerEditor() {
    // Restore from temp if canceling
    if (tempConfig) {
        extensionSettings.trackerConfig = tempConfig;
        tempConfig = null;
    }

    // Discard pending association changes (cancel = no save)
    tempAssociation = null;
    originalAssociation = null;

    $editorModal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => {
        $editorModal.removeClass('is-closing').hide();
    }, 200);
}

/**
 * Apply the tracker configuration and refresh all trackers
 */
function applyTrackerConfig() {
    tempConfig = null; // Clear temp config

    // BUG-01 guard: never write RPG attribute config when Stat Sheet is active
    const statSheetActive = extensionSettings.statSheet?.enabled === true;

    // Apply pending association changes
    if (tempAssociation) {
        if (tempAssociation.presetId !== null) {
            // Associate with the pending preset
            associatePresetWithCurrentEntity();
            const preset = getPreset(tempAssociation.presetId);
            toastr.success(`"${preset?.name || 'Unknown'}" is now associated with ${getCurrentEntityName()}.`);
        } else {
            // Remove association
            removePresetAssociationForCurrentEntity();
        }
        tempAssociation = null;
    }
    originalAssociation = null;

    // Save to the current preset
    const currentPresetId = getActivePresetId();
    if (currentPresetId) {
        // If stat sheet is active, strip RPG attribute fields from the saved config
        if (statSheetActive) {
            const saved = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));
            // These keys are managed by the Stat Sheet — don't overwrite with stale UI values
            delete saved.userStats.rpgAttributes;
            delete saved.userStats.showRPGAttributes;
            delete saved.userStats.showLevel;
            delete saved.userStats.alwaysSendAttributes;
            extensionSettings.presetManager.presets[currentPresetId].trackerConfig = saved;
            saveSettings();
        } else {
            saveToPreset(currentPresetId);
        }
    } else {
        saveSettings();
    }

    // Re-render all trackers with new config
    renderUserStats();
    renderInfoBox();
    renderThoughts();
    updateFabWidgets(); // Update FAB widgets to reflect new config
}

/**
 * Reset configuration to defaults
 */
function resetToDefaults() {
    extensionSettings.trackerConfig = {
        userStats: {
            customStats: [
                { id: 'health',  name: 'Health',  enabled: true, displayMode: 'percentage', maxValue: 100, scaleWithAttribute: '', scaleMultiplier: 1, scaleBonus: 0, persistInHistory: false },
                { id: 'satiety', name: 'Satiety', enabled: true, displayMode: 'percentage', maxValue: 100, scaleWithAttribute: '', scaleMultiplier: 1, scaleBonus: 0, persistInHistory: false },
                { id: 'energy',  name: 'Energy',  enabled: true, displayMode: 'percentage', maxValue: 100, scaleWithAttribute: '', scaleMultiplier: 1, scaleBonus: 0, persistInHistory: false },
                { id: 'hygiene', name: 'Hygiene', enabled: true, displayMode: 'percentage', maxValue: 100, scaleWithAttribute: '', scaleMultiplier: 1, scaleBonus: 0, persistInHistory: false }
            ],
            showRPGAttributes: true,
            rpgAttributes: [
                { id: 'str', name: 'STR', enabled: true, persistInHistory: false },
                { id: 'dex', name: 'DEX', enabled: true, persistInHistory: false },
                { id: 'con', name: 'CON', enabled: true, persistInHistory: false },
                { id: 'int', name: 'INT', enabled: true, persistInHistory: false },
                { id: 'wis', name: 'WIS', enabled: true, persistInHistory: false },
                { id: 'cha', name: 'CHA', enabled: true, persistInHistory: false }
            ],
            statusSection: {
                enabled: true,
                showMoodEmoji: true,
                customFields: ['Conditions'],
                persistInHistory: false
            },
            skillsSection: {
                enabled: false,
                label: 'Skills',
                customFields: [],
                persistInHistory: false
            },
            inventoryPersistInHistory: false,
            questsPersistInHistory: false
        },
        infoBox: {
            widgets: {
                date: { enabled: true, format: 'Weekday, Month, Year', persistInHistory: true },
                weather: { enabled: true, persistInHistory: true },
                temperature: { enabled: true, unit: 'C', persistInHistory: false },
                time: { enabled: true, persistInHistory: true },
                location: { enabled: true, persistInHistory: true },
                recentEvents: { enabled: true, persistInHistory: false }
            }
        },
        presentCharacters: {
            showEmoji: true,
            showName: true,
            relationships: {
                enabled: true,
                relationshipEmojis: {
                    'Lover': '❤️',
                    'Friend': '⭐',
                    'Ally': '🤝',
                    'Enemy': '⚔️',
                    'Neutral': '⚖️'
                }
            },
            relationshipFields: ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'],
            relationshipEmojis: {
                'Lover': '❤️',
                'Friend': '⭐',
                'Ally': '🤝',
                'Enemy': '⚔️',
                'Neutral': '⚖️'
            },
            customFields: [
                { id: 'appearance', name: 'Appearance', enabled: true, description: 'Visible physical appearance (clothing, hair, notable features)', persistInHistory: false },
                { id: 'demeanor', name: 'Demeanor', enabled: true, description: 'Observable demeanor or emotional state', persistInHistory: false }
            ],
            thoughts: {
                enabled: true,
                name: 'Thoughts',
                description: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)',
                persistInHistory: false
            },
            characterStats: {
                enabled: false,
                customStats: [
                    { id: 'health', name: 'Health', enabled: true, colorLow: '#ff4444', colorHigh: '#44ff44' },
                    { id: 'energy', name: 'Energy', enabled: true, colorLow: '#ffaa00', colorHigh: '#44ffff' }
                ]
            }
        }
    };
    // Reset history persistence settings
    extensionSettings.historyPersistence = {
        enabled: false,
        messageCount: 5,
        injectionPosition: 'assistant_message_end',
        contextPreamble: '',
        sendAllEnabledOnRefresh: false
    };
}

/**
 * Export current tracker configuration to a JSON file
 */
function exportTrackerPreset() {
    try {
        // Get the current tracker configuration
        const config = extensionSettings.trackerConfig;
        const historyPersistence = extensionSettings.historyPersistence;

        // Create a preset object with metadata
        const preset = {
            name: 'Custom Tracker Preset',
            version: '1.1', // Bumped version for historyPersistence support
            exportDate: new Date().toISOString(),
            trackerConfig: JSON.parse(JSON.stringify(config)), // Deep copy
            historyPersistence: historyPersistence ? JSON.parse(JSON.stringify(historyPersistence)) : null // Include history persistence settings
        };

        // Convert to JSON
        const jsonString = JSON.stringify(preset, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });

        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `rpg-tracker-preset-${timestamp}.json`;

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // console.log('[RPG Companion] Tracker preset exported successfully');
        toastr.success(i18n.getTranslation('template.trackerEditorModal.messages.exportSuccess') || 'Tracker preset exported successfully!');
    } catch (error) {
        console.error('[RPG Companion] Error exporting tracker preset:', error);
        toastr.error(i18n.getTranslation('template.trackerEditorModal.messages.exportError') || 'Failed to export tracker preset. Check console for details.');
    }
}

/**
 * Migrates old tracker preset format to current format
 * @param {Object} config - The tracker config to migrate
 * @returns {Object} - Migrated tracker config
 */
function migrateTrackerPreset(config) {
    // Create a deep copy to avoid modifying the original
    const migrated = JSON.parse(JSON.stringify(config));

    // Migrate relationships structure (v3.0.0 -> v3.1.0)
    if (migrated.presentCharacters) {
        // Old format: relationshipEmojis directly on presentCharacters
        // New format: relationships.relationshipEmojis
        if (migrated.presentCharacters.relationshipEmojis &&
            !migrated.presentCharacters.relationships) {
            migrated.presentCharacters.relationships = {
                enabled: migrated.presentCharacters.enableRelationships || true,
                relationshipEmojis: migrated.presentCharacters.relationshipEmojis
            };
            // Keep legacy fields for backward compatibility
            migrated.presentCharacters.relationshipFields = Object.keys(migrated.presentCharacters.relationshipEmojis);
        }

        // Ensure relationships object exists
        if (!migrated.presentCharacters.relationships) {
            migrated.presentCharacters.relationships = {
                enabled: false,
                relationshipEmojis: {}
            };
        }

        // Ensure relationshipEmojis exists within relationships
        if (!migrated.presentCharacters.relationships.relationshipEmojis) {
            migrated.presentCharacters.relationships.relationshipEmojis = {};
        }

        // Add persistInHistory to customFields if missing (v3.4.0)
        if (migrated.presentCharacters.customFields) {
            migrated.presentCharacters.customFields = migrated.presentCharacters.customFields.map(field => ({
                ...field,
                persistInHistory: field.persistInHistory ?? false
            }));
        }

        // Add persistInHistory to thoughts if missing (v3.4.0)
        if (migrated.presentCharacters.thoughts && migrated.presentCharacters.thoughts.persistInHistory === undefined) {
            migrated.presentCharacters.thoughts.persistInHistory = false;
        }
    }

    // Add persistInHistory to userStats fields if missing (v3.4.0)
    if (migrated.userStats) {
        // Custom stats
        if (migrated.userStats.customStats) {
            migrated.userStats.customStats = migrated.userStats.customStats.map(stat => ({
                ...stat,
                displayMode:        stat.displayMode        ?? 'percentage',
                maxValue:           stat.maxValue           ?? 100,
                scaleWithAttribute: stat.scaleWithAttribute ?? '',
                scaleMultiplier:    stat.scaleMultiplier    ?? 1,
                scaleBonus:         stat.scaleBonus         ?? 0,
                persistInHistory:   stat.persistInHistory   ?? false
            }));
        }

        // RPG Attributes
        if (migrated.userStats.rpgAttributes) {
            migrated.userStats.rpgAttributes = migrated.userStats.rpgAttributes.map(attr => ({
                ...attr,
                persistInHistory: attr.persistInHistory ?? false
            }));
        }

        // Status section
        if (migrated.userStats.statusSection && migrated.userStats.statusSection.persistInHistory === undefined) {
            migrated.userStats.statusSection.persistInHistory = false;
        }

        // Skills section
        if (migrated.userStats.skillsSection && migrated.userStats.skillsSection.persistInHistory === undefined) {
            migrated.userStats.skillsSection.persistInHistory = false;
        }

        // Inventory and quests persistence
        if (migrated.userStats.inventoryPersistInHistory === undefined) {
            migrated.userStats.inventoryPersistInHistory = false;
        }
        if (migrated.userStats.questsPersistInHistory === undefined) {
            migrated.userStats.questsPersistInHistory = false;
        }
    }

    // Add persistInHistory to infoBox widgets if missing (v3.4.0)
    if (migrated.infoBox && migrated.infoBox.widgets) {
        for (const [widgetId, widget] of Object.entries(migrated.infoBox.widgets)) {
            if (widget.persistInHistory === undefined) {
                // Default to false for backwards compatibility - user must explicitly enable
                widget.persistInHistory = false;
            }
        }
    }

    return migrated;
}

/**
 * Import tracker configuration from a JSON file
 */
function importTrackerPreset() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Validate the imported data
            if (!data.trackerConfig) {
                throw new Error('Invalid preset file: missing trackerConfig');
            }

            // Validate required sections
            if (!data.trackerConfig.userStats || !data.trackerConfig.infoBox || !data.trackerConfig.presentCharacters) {
                throw new Error('Invalid preset file: missing required configuration sections');
            }

            // Migrate old preset format to current format
            const migratedConfig = migrateTrackerPreset(data.trackerConfig);

            // Extract historyPersistence if present in the import file
            const historyPersistence = data.historyPersistence || null;

            // Show import mode selection dialog
            showImportModeDialog(migratedConfig, data.name || file.name.replace('.json', ''), historyPersistence);
        } catch (error) {
            console.error('[RPG Companion] Error importing tracker preset:', error);
            toastr.error(i18n.getTranslation('template.trackerEditorModal.messages.importError') ||
                `Failed to import tracker preset: ${error.message}`);
        }
    };

    // Trigger file selection
    input.click();
}

/**
 * Show dialog to choose import mode
 * @param {Object} migratedConfig - The migrated tracker config
 * @param {string} suggestedName - Suggested name for new preset
 * @param {Object|null} historyPersistence - The history persistence settings from import (if any)
 */
function showImportModeDialog(migratedConfig, suggestedName, historyPersistence = null) {
    // Create dialog overlay
    const dialogHtml = `
        <div id="rpg-import-mode-dialog" class="rpg-import-dialog-overlay">
            <div class="rpg-import-dialog">
                <h4><i class="fa-solid fa-file-import"></i> Import Configuration</h4>
                <p>How would you like to import this configuration?</p>
                <div class="rpg-import-dialog-buttons">
                    <button id="rpg-import-to-current" class="rpg-btn-secondary">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i>
                        Apply to Current Preset
                    </button>
                    <button id="rpg-import-as-new" class="rpg-btn-primary">
                        <i class="fa-solid fa-plus"></i>
                        Create New Preset
                    </button>
                </div>
                <button id="rpg-import-cancel" class="rpg-btn-cancel">Cancel</button>
            </div>
        </div>
    `;

    $('body').append(dialogHtml);
    const $dialog = $('#rpg-import-mode-dialog');

    // Import to current preset
    $('#rpg-import-to-current').on('click', () => {
        $dialog.remove();

        // Apply the migrated configuration to current
        extensionSettings.trackerConfig = migratedConfig;

        // Apply historyPersistence settings if present in import
        if (historyPersistence) {
            extensionSettings.historyPersistence = historyPersistence;
        }

        // Save to the active preset (saveToPreset uses current trackerConfig)
        const activePresetId = getActivePresetId();
        if (activePresetId) {
            saveToPreset(activePresetId);
        }

        // Re-render the editor UI
        renderEditorUI();

        toastr.success('Configuration applied to current preset.');
    });

    // Import as new preset
    $('#rpg-import-as-new').on('click', () => {
        $dialog.remove();

        // Prompt for preset name
        const presetName = prompt('Enter a name for the new preset:', suggestedName);
        if (!presetName) return;

        // Set the migrated config as current first
        extensionSettings.trackerConfig = migratedConfig;

        // Apply historyPersistence settings if present in import
        if (historyPersistence) {
            extensionSettings.historyPersistence = historyPersistence;
        }

        // Create new preset (createPreset uses current trackerConfig)
        const newPresetId = createPreset(presetName);
        if (newPresetId) {
            // Load the new preset
            loadPreset(newPresetId);
            renderEditorUI();
            updatePresetUI();
            toastr.success(`Created new preset: ${presetName}.`);
        }
    });

    // Cancel
    $('#rpg-import-cancel').on('click', () => {
        $dialog.remove();
    });

    // Close on overlay click
    $dialog.on('click', (e) => {
        if (e.target === $dialog[0]) {
            $dialog.remove();
        }
    });
}

/**
 * Render the editor UI based on current config
 */
function renderEditorUI() {
    renderUserStatsTab();
    renderInfoBoxTab();
    renderPresentCharactersTab();
    renderHistoryPersistenceTab();
    renderStatSheetTab();
}

/**
 * Render User Stats configuration tab
 */
function renderUserStatsTab() {
    const config = extensionSettings.trackerConfig.userStats;
    let html = '<div class="rpg-editor-section">';

    // Custom Stats section
    html += `<h4><i class="fa-solid fa-heart-pulse"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.customStatsTitle')}</h4>`;

    html += '<div class="rpg-editor-stats-list" id="rpg-editor-stats-list">';

    config.customStats.forEach((stat, index) => {
        const statDisplayMode = stat.displayMode || 'percentage'; // Per-stat display mode
        const maxValue = stat.maxValue || 100;
        const scaleAttr = stat.scaleWithAttribute || '';
        const scaleMultiplier = stat.scaleMultiplier || 1;
        const scaleBonus = stat.scaleBonus || 0;
        
        // Get available stat sheet attributes for scaling dropdown
        const statSheetAttrs = extensionSettings.statSheet?.attributes?.filter(a => a.enabled) || [];
        const attrOptions = statSheetAttrs.map(a => 
            `<option value="${a.id}" ${scaleAttr === a.id ? 'selected' : ''}>${a.name}</option>`
        ).join('');
        
        html += `
            <div class="rpg-editor-stat-item-expanded" data-index="${index}" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 12px; margin-bottom: 10px;">
                <!-- Top row: enable, name, remove -->
                <div class="rpg-stat-item-header" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                    <input type="checkbox" ${stat.enabled ? 'checked' : ''} class="rpg-stat-toggle" data-index="${index}" title="Enable/disable" style="flex-shrink: 0;">
                    <input type="text" value="${stat.name}" class="rpg-stat-name" data-index="${index}" placeholder="Stat Name" style="flex: 1; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: inherit;">
                    <button class="rpg-stat-remove" data-index="${index}" title="Remove stat" style="flex-shrink: 0; padding: 4px 8px; background: rgba(200,60,60,0.2); border: 1px solid rgba(200,60,60,0.3); border-radius: 4px; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>
                </div>
                
                <!-- Expanded controls row -->
                <div class="rpg-stat-item-controls" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 0.9em;">
                    <!-- Display mode -->
                    <div class="rpg-stat-control-group" style="display: flex; flex-direction: column; gap: 4px;">
                        <label class="rpg-control-label" style="opacity: 0.7; font-size: 0.85em; font-weight: 600;">Display Mode:</label>
                        <select class="rpg-stat-display-mode rpg-input" data-index="${index}" style="padding: 4px 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: inherit;">
                            <option value="percentage" ${statDisplayMode === 'percentage' ? 'selected' : ''}>Percentage (0-100%)</option>
                            <option value="number" ${statDisplayMode === 'number' ? 'selected' : ''}>Number (0/max)</option>
                        </select>
                    </div>
                    
                    <!-- Max value (shown when number mode AND not scaling) -->
                    <div class="rpg-stat-control-group ${statDisplayMode === 'number' && !scaleAttr ? '' : 'rpg-hidden'}" data-control="max-value" style="display: flex; flex-direction: column; gap: 4px;">
                        <label class="rpg-control-label" style="opacity: 0.7; font-size: 0.85em; font-weight: 600;">Max Value:</label>
                        <input type="number" value="${maxValue}" class="rpg-stat-max rpg-input" data-index="${index}" placeholder="100" min="1" step="1" style="padding: 4px 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: inherit; width: 80px;">
                    </div>
                    
                    <!-- Stat sheet scaling -->
                    <div class="rpg-stat-control-group" style="display: flex; flex-direction: column; gap: 4px;">
                        <label class="rpg-control-label" style="opacity: 0.7; font-size: 0.85em; font-weight: 600;">Scale with Attribute:</label>
                        <select class="rpg-stat-scale-attr rpg-input" data-index="${index}" style="padding: 4px 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: inherit;">
                            <option value="">None (manual)</option>
                            ${attrOptions}
                        </select>
                    </div>
                </div>
                
                <!-- Scaling formula (shown when attribute selected) -->
                <div class="rpg-stat-scaling-formula ${scaleAttr ? '' : 'rpg-hidden'}" data-control="scaling" style="margin-top: 8px; padding: 8px; background: rgba(100,150,200,0.1); border: 1px solid rgba(100,150,200,0.2); border-radius: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.9em;">
                    <span class="rpg-formula-part" style="opacity: 0.8; font-weight: 600;">Max =</span>
                    <span class="rpg-formula-part" style="opacity: 0.7;">Attribute ×</span>
                    <input type="number" value="${scaleMultiplier}" class="rpg-stat-scale-mult rpg-input" data-index="${index}" step="0.1" placeholder="1" title="Multiplier" style="width: 60px; padding: 4px 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; color: inherit;">
                    <span class="rpg-formula-part" style="opacity: 0.7;">+</span>
                    <input type="number" value="${scaleBonus}" class="rpg-stat-scale-bonus rpg-input" data-index="${index}" step="1" placeholder="0" title="Flat bonus" style="width: 60px; padding: 4px 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; color: inherit;">
                    <span class="rpg-formula-part" style="opacity: 0.6; font-size: 0.85em; font-style: italic;">(updates automatically)</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    html += `<button class="rpg-btn-secondary" id="rpg-add-stat"><i class="fa-solid fa-plus"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.addCustomStatButton')}</button>`;

    // RPG Attributes section — dimmed when Stat Sheet is enabled (they're mutually exclusive)
    const statSheetEnabled = extensionSettings.statSheet?.enabled === true;

    // BUG-01 fix: when Stat Sheet is active, fully hide the RPG Attributes section
    // instead of a dim overlay — dim leaves checkboxes readable on Save & Apply.
    if (statSheetEnabled) {
        html += `
            <div class="rpg-editor-section" style="opacity:0.35; pointer-events:none; user-select:none;">
                <h4><i class="fa-solid fa-dice-d20"></i> RPG Attributes
                    <span style="margin-left:8px; font-size:11px; font-weight:400; color:#ff9999;">
                        (hidden — Stat Sheet is active)
                    </span>
                </h4>
                <p class="rpg-editor-hint" style="color:#ff9999; font-size:11px;">
                    Classic RPG Attributes are disabled while the Stat Sheet system is enabled.
                    Disable the Stat Sheet in the Stat Sheet tab to edit these.
                </p>
            </div>
        `;
    } else {
        // Normal render — Stat Sheet is off, show full RPG Attributes editor
        html += `<h4 style="margin-top:24px;"><i class="fa-solid fa-dice-d20"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.rpgAttributesTitle')}</h4>`;

        const showRPGAttributes = config.showRPGAttributes !== undefined ? config.showRPGAttributes : true;
        html += '<div class="rpg-editor-toggle-row">';
        html += `<input type="checkbox" id="rpg-show-rpg-attrs" ${showRPGAttributes ? 'checked' : ''}>`;
        html += `<label for="rpg-show-rpg-attrs">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.enableRpgAttributes')}</label>`;
        html += '</div>';

        const showLevel = config.showLevel !== undefined ? config.showLevel : true;
        html += '<div class="rpg-editor-toggle-row">';
        html += `<input type="checkbox" id="rpg-show-level" ${showLevel ? 'checked' : ''}>`;
        html += `<label for="rpg-show-level">Show Level</label>`;
        html += '</div>';

        const alwaysSendAttributes = config.alwaysSendAttributes !== undefined ? config.alwaysSendAttributes : false;
        html += '<div class="rpg-editor-toggle-row">';
        html += `<input type="checkbox" id="rpg-always-send-attrs" ${alwaysSendAttributes ? 'checked' : ''}>`;
        html += `<label for="rpg-always-send-attrs">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.alwaysIncludeAttributes')}</label>`;
        html += '</div>';
        html += `<small class="rpg-editor-note">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.alwaysIncludeAttributesNote')}</small>`;

        html += '<div class="rpg-editor-stats-list" id="rpg-editor-attrs-list">';

        if (!config.rpgAttributes || config.rpgAttributes.length === 0) {
            config.rpgAttributes = [
                { id: 'str', name: 'STR', enabled: true },
                { id: 'dex', name: 'DEX', enabled: true },
                { id: 'con', name: 'CON', enabled: true },
                { id: 'int', name: 'INT', enabled: true },
                { id: 'wis', name: 'WIS', enabled: true },
                { id: 'cha', name: 'CHA', enabled: true }
            ];
            extensionSettings.trackerConfig.userStats.rpgAttributes = config.rpgAttributes;
        }

        const rpgAttributes = config.rpgAttributes;

        rpgAttributes.forEach((attr, index) => {
            html += `
                <div class="rpg-editor-stat-item" data-index="${index}">
                    <input type="checkbox" ${attr.enabled ? 'checked' : ''} class="rpg-attr-toggle" data-index="${index}">
                    <input type="text" value="${attr.name}" class="rpg-attr-name" data-index="${index}" placeholder="Attribute Name">
                    <button class="rpg-attr-remove" data-index="${index}" title="Remove attribute"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
        });

        html += '</div>';
        html += `<button class="rpg-btn-secondary" id="rpg-add-attr"><i class="fa-solid fa-plus"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.addAttributeButton')}</button>`;
    }

    // Status Section
    html += `<h4><i class="fa-solid fa-face-smile"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.statusSectionTitle')}</h4>`;
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-status-enabled" ${config.statusSection.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-status-enabled">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.enableStatusSection')}</label>`;
    html += '</div>';

    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-mood-emoji" ${config.statusSection.showMoodEmoji ? 'checked' : ''}>`;
    html += `<label for="rpg-mood-emoji">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.showMoodEmoji')}</label>`;
    html += '</div>';

    html += `<label>${i18n.getTranslation('template.trackerEditorModal.userStatsTab.statusFieldsLabel')}</label>`;
    html += `<input type="text" id="rpg-status-fields" value="${config.statusSection.customFields.join(', ')}" class="rpg-text-input" placeholder="e.g., Conditions, Appearance">`;

    // Skills Section
    html += `<h4><i class="fa-solid fa-star"></i> ${i18n.getTranslation('template.trackerEditorModal.userStatsTab.skillsSectionTitle')}</h4>`;
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-skills-enabled" ${config.skillsSection.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-skills-enabled">${i18n.getTranslation('template.trackerEditorModal.userStatsTab.enableSkillsSection')}</label>`;
    html += '</div>';

    html += `<label>${i18n.getTranslation('template.trackerEditorModal.userStatsTab.skillsLabelLabel')}</label>`;
    html += `<input type="text" id="rpg-skills-label" value="${config.skillsSection.label}" class="rpg-text-input" placeholder="Skills">`;

    html += `<label>${i18n.getTranslation('template.trackerEditorModal.userStatsTab.skillsListLabel')}</label>`;
    const skillFields = config.skillsSection.customFields || [];
    html += `<input type="text" id="rpg-skills-fields" value="${skillFields.join(', ')}" class="rpg-text-input" placeholder="e.g., Stealth, Persuasion, Combat">`;

    html += '</div>';

    $('#rpg-editor-tab-userStats').html(html);
    setupUserStatsListeners();
}

/**
 * Set up event listeners for User Stats tab
 */
function setupUserStatsListeners() {
    // Add stat
    $('#rpg-add-stat').off('click').on('click', function() {
        const newId = 'custom_' + Date.now();
        extensionSettings.trackerConfig.userStats.customStats.push({
            id: newId,
            name: 'New Stat',
            enabled: true,
            displayMode: 'percentage',
            maxValue: 100,
            scaleWithAttribute: '',
            scaleMultiplier: 1,
            scaleBonus: 0,
            persistInHistory: false
        });
        // Initialize value if doesn't exist
        if (extensionSettings.userStats[newId] === undefined) {
            extensionSettings.userStats[newId] = 100;
        }
        renderUserStatsTab();
    });

    // Remove stat
    $('.rpg-stat-remove').off('click').on('click', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.customStats.splice(index, 1);
        renderUserStatsTab();
    });

    // Toggle stat
    $('.rpg-stat-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.customStats[index].enabled = $(this).is(':checked');
    });

    // Rename stat
    $('.rpg-stat-name').off('blur').on('blur', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.customStats[index].name = $(this).val();
    });

    // Change stat max value
    $('.rpg-stat-max').off('blur').on('blur', function() {
        const index = $(this).data('index');
        const value = parseInt($(this).val()) || 100;
        extensionSettings.trackerConfig.userStats.customStats[index].maxValue = Math.max(1, value);
    });

    // Per-stat display mode
    $('.rpg-stat-display-mode').off('change').on('change', function() {
        const index = $(this).data('index');
        const mode = $(this).val();
        extensionSettings.trackerConfig.userStats.customStats[index].displayMode = mode;
        renderUserStatsTab(); // Re-render to show/hide max value field
    });

    // Stat sheet scaling - attribute selection
    $('.rpg-stat-scale-attr').off('change').on('change', function() {
        const index = $(this).data('index');
        const attrId = $(this).val();
        extensionSettings.trackerConfig.userStats.customStats[index].scaleWithAttribute = attrId;
        // Set defaults when attribute is selected
        if (attrId && !extensionSettings.trackerConfig.userStats.customStats[index].scaleMultiplier) {
            extensionSettings.trackerConfig.userStats.customStats[index].scaleMultiplier = 1;
            extensionSettings.trackerConfig.userStats.customStats[index].scaleBonus = 0;
        }
        renderUserStatsTab(); // Re-render to show/hide scaling formula
    });

    // Stat sheet scaling - multiplier
    $('.rpg-stat-scale-mult').off('blur').on('blur', function() {
        const index = $(this).data('index');
        const value = parseFloat($(this).val()) || 1;
        extensionSettings.trackerConfig.userStats.customStats[index].scaleMultiplier = value;
    });

    // Stat sheet scaling - bonus
    $('.rpg-stat-scale-bonus').off('blur').on('blur', function() {
        const index = $(this).data('index');
        const value = parseInt($(this).val()) || 0;
        extensionSettings.trackerConfig.userStats.customStats[index].scaleBonus = value;
    });

    // Add attribute
    $('#rpg-add-attr').off('click').on('click', function() {
        // Ensure rpgAttributes array exists with defaults if needed
        if (!extensionSettings.trackerConfig.userStats.rpgAttributes || extensionSettings.trackerConfig.userStats.rpgAttributes.length === 0) {
            extensionSettings.trackerConfig.userStats.rpgAttributes = [
                { id: 'str', name: 'STR', enabled: true },
                { id: 'dex', name: 'DEX', enabled: true },
                { id: 'con', name: 'CON', enabled: true },
                { id: 'int', name: 'INT', enabled: true },
                { id: 'wis', name: 'WIS', enabled: true },
                { id: 'cha', name: 'CHA', enabled: true }
            ];
        }
        const newId = 'attr_' + Date.now();
        extensionSettings.trackerConfig.userStats.rpgAttributes.push({
            id: newId,
            name: 'NEW',
            enabled: true
        });
        // Initialize value in classicStats if doesn't exist
        if (extensionSettings.classicStats[newId] === undefined) {
            extensionSettings.classicStats[newId] = 10;
        }
        renderUserStatsTab();
    });

    // Remove attribute
    $('.rpg-attr-remove').off('click').on('click', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.rpgAttributes.splice(index, 1);
        renderUserStatsTab();
    });

    // Toggle attribute
    $('.rpg-attr-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.rpgAttributes[index].enabled = $(this).is(':checked');
    });

    // Rename attribute
    $('.rpg-attr-name').off('blur').on('blur', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.rpgAttributes[index].name = $(this).val();
    });

    // Enable/disable RPG Attributes section toggle
    $('#rpg-show-rpg-attrs').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.showRPGAttributes = $(this).is(':checked');
    });

    // Show/hide level toggle
    $('#rpg-show-level').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.showLevel = $(this).is(':checked');
    });

    // Always send attributes toggle
    $('#rpg-always-send-attrs').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.alwaysSendAttributes = $(this).is(':checked');
    });

    // Status section toggles
    $('#rpg-status-enabled').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.statusSection.enabled = $(this).is(':checked');
    });

    $('#rpg-mood-emoji').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.statusSection.showMoodEmoji = $(this).is(':checked');
    });

    $('#rpg-status-fields').off('blur').on('blur', function() {
        const fields = $(this).val().split(',').map(f => f.trim()).filter(f => f);
        extensionSettings.trackerConfig.userStats.statusSection.customFields = fields;
    });

    // Skills section toggles
    $('#rpg-skills-enabled').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.skillsSection.enabled = $(this).is(':checked');
    });

    $('#rpg-skills-label').off('blur').on('blur', function() {
        extensionSettings.trackerConfig.userStats.skillsSection.label = $(this).val();
        saveSettings();
    });

    $('#rpg-skills-fields').off('blur').on('blur', function() {
        const fields = $(this).val().split(',').map(f => f.trim()).filter(f => f);
        extensionSettings.trackerConfig.userStats.skillsSection.customFields = fields;
        saveSettings();
    });
}

/**
 * Render Info Box configuration tab
 */
function renderInfoBoxTab() {
    const config = extensionSettings.trackerConfig.infoBox;
    let html = '<div class="rpg-editor-section">';

    html += `<h4><i class="fa-solid fa-info-circle"></i> ${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.widgetsTitle')}</h4>`;

    // Date widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-date" ${config.widgets.date.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-date">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.dateWidget')}</label>`;
    html += '<select id="rpg-date-format" class="rpg-select-mini">';
    html += `<option value="Weekday, Month, Year" ${config.widgets.date.format === 'Weekday, Month, Year' ? 'selected' : ''}>Weekday, Month, Year</option>`;
    html += `<option value="Day (Numerical), Month, Year" ${config.widgets.date.format === 'Day (Numerical), Month, Year' ? 'selected' : ''}>Day (Numerical), Month, Year</option>`;
    html += '</select>';
    html += '</div>';

    // Weather widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-weather" ${config.widgets.weather.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-weather">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.weatherWidget')}</label>`;
    html += '</div>';

    // Temperature widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-temperature" ${config.widgets.temperature.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-temperature">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.temperatureWidget')}</label>`;
    html += '<div class="rpg-radio-group">';
    html += `<label><input type="radio" name="temp-unit" value="C" ${config.widgets.temperature.unit === 'C' ? 'checked' : ''}> °C</label>`;
    html += `<label><input type="radio" name="temp-unit" value="F" ${config.widgets.temperature.unit === 'F' ? 'checked' : ''}> °F</label>`;
    html += '</div>';
    html += '</div>';

    // Time widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-time" ${config.widgets.time.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-time">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.timeWidget')}</label>`;
    html += '</div>';

    // Location widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-location" ${config.widgets.location.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-location">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.locationWidget')}</label>`;
    html += '</div>';

    // Recent Events widget
    html += '<div class="rpg-editor-widget-row">';
    html += `<input type="checkbox" id="rpg-widget-events" ${config.widgets.recentEvents.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-widget-events">${i18n.getTranslation('template.trackerEditorModal.infoBoxTab.recentEventsWidget')}</label>`;
    html += '</div>';

    html += '</div>';

    $('#rpg-editor-tab-infoBox').html(html);
    setupInfoBoxListeners();
}

/**
 * Set up event listeners for Info Box tab
 */
function setupInfoBoxListeners() {
    const widgets = extensionSettings.trackerConfig.infoBox.widgets;

    $('#rpg-widget-date').off('change').on('change', function() {
        widgets.date.enabled = $(this).is(':checked');
    });

    $('#rpg-date-format').off('change').on('change', function() {
        widgets.date.format = $(this).val();
    });

    $('#rpg-widget-weather').off('change').on('change', function() {
        widgets.weather.enabled = $(this).is(':checked');
    });

    $('#rpg-widget-temperature').off('change').on('change', function() {
        widgets.temperature.enabled = $(this).is(':checked');
    });

    $('input[name="temp-unit"]').off('change').on('change', function() {
        widgets.temperature.unit = $(this).val();
    });

    $('#rpg-widget-time').off('change').on('change', function() {
        widgets.time.enabled = $(this).is(':checked');
    });

    $('#rpg-widget-location').off('change').on('change', function() {
        widgets.location.enabled = $(this).is(':checked');
    });

    $('#rpg-widget-events').off('change').on('change', function() {
        widgets.recentEvents.enabled = $(this).is(':checked');
    });
}

/**
 * Render Present Characters configuration tab
 */
function renderPresentCharactersTab() {
    const config = extensionSettings.trackerConfig.presentCharacters;
    let html = '<div class="rpg-editor-section">';

    // Relationship Fields Section
    html += `<h4><i class="fa-solid fa-heart"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.relationshipStatusTitle')}</h4>`;

    // Toggle for enabling/disabling relationships
    const relationshipsEnabled = config.relationships?.enabled !== false; // Default to true if not set
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-relationships-enabled" ${relationshipsEnabled ? 'checked' : ''}>`;
    html += `<label for="rpg-relationships-enabled">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.enableRelationshipStatus')}</label>`;
    html += '</div>';

    html += `<p class="rpg-editor-hint">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.relationshipStatusHint')}</p>`;

    html += '<div class="rpg-relationship-mapping-list" id="rpg-relationship-mapping-list">';
    // Show existing relationships as field → emoji pairs
    const relationshipEmojis = config.relationships?.relationshipEmojis || config.relationshipEmojis || {
        'Lover': '❤️',
        'Friend': '⭐',
        'Ally': '🤝',
        'Enemy': '⚔️',
        'Neutral': '⚖️'
    };

    for (const [relationship, emoji] of Object.entries(relationshipEmojis)) {
        html += `
            <div class="rpg-relationship-item">
                <input type="text" value="${relationship}" class="rpg-relationship-name" placeholder="Relationship type">
                <span class="rpg-arrow">→</span>
                <input type="text" value="${emoji}" class="rpg-relationship-emoji" placeholder="Emoji" maxlength="4">
                <button class="rpg-remove-relationship" data-relationship="${relationship}" title="Remove"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    }
    html += '</div>';
    html += `<button class="rpg-btn-secondary" id="rpg-add-relationship"><i class="fa-solid fa-plus"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.newRelationshipButton')}</button>`;

    // Custom Fields Section
    html += `<h4><i class="fa-solid fa-list"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.appearanceDemeanorTitle')}</h4>`;
    html += `<p class="rpg-editor-hint">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.appearanceDemeanorHint')}</p>`;

    html += '<div class="rpg-editor-fields-list" id="rpg-editor-fields-list">';

    config.customFields.forEach((field, index) => {
        html += `
            <div class="rpg-editor-field-item" data-index="${index}">
                <div class="rpg-field-controls">
                    <button class="rpg-field-move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="rpg-field-move-down" data-index="${index}" ${index === config.customFields.length - 1 ? 'disabled' : ''} title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
                </div>
                <input type="checkbox" ${field.enabled ? 'checked' : ''} class="rpg-field-toggle" data-index="${index}">
                <input type="text" value="${field.name}" class="rpg-field-label" data-index="${index}" placeholder="Field Name">
                <input type="text" value="${field.description || ''}" class="rpg-field-placeholder" data-index="${index}" placeholder="AI Instruction">
                <button class="rpg-field-remove" data-index="${index}" title="Remove field"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    });

    html += '</div>';
    html += `<button class="rpg-btn-secondary" id="rpg-add-field"><i class="fa-solid fa-plus"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.addCustomFieldButton')}</button>`;

    // Thoughts Section
    html += `<h4><i class="fa-solid fa-comment-dots"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.thoughtsConfigTitle')}</h4>`;
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-thoughts-enabled" ${config.thoughts?.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-thoughts-enabled">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.enableCharacterThoughts')}</label>`;
    html += '</div>';

    html += '<div class="rpg-thoughts-config">';
    html += '<div class="rpg-editor-input-group">';
    html += `<label>${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.thoughtsLabelLabel')}</label>`;
    html += `<input type="text" id="rpg-thoughts-name" value="${config.thoughts?.name || 'Thoughts'}" placeholder="e.g., Thoughts, Inner Voice, Feelings">`;
    html += '</div>';
    html += '<div class="rpg-editor-input-group">';
    html += `<label>${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.aiInstructionLabel')}</label>`;
    html += `<input type="text" id="rpg-thoughts-description" value="${config.thoughts?.description || 'Internal Monologue (in first person from character\'s POV, up to three sentences long)'}" placeholder="Description of what to generate">`;
    html += '</div>';
    html += '</div>';

    // Character Stats
    html += `<h4><i class="fa-solid fa-chart-bar"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.characterStatsTitle')}</h4>`;
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-char-stats-enabled" ${config.characterStats?.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-char-stats-enabled">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.trackCharacterStats')}</label>`;
    html += '</div>';

    html += `<p class="rpg-editor-hint">${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.characterStatsHint')}</p>`;
    html += '<div class="rpg-editor-fields-list" id="rpg-char-stats-list">';

    const charStats = config.characterStats?.customStats || [];
    charStats.forEach((stat, index) => {
        html += `
            <div class="rpg-editor-field-item" data-index="${index}">
                <input type="checkbox" ${stat.enabled ? 'checked' : ''} class="rpg-char-stat-toggle" data-index="${index}">
                <input type="text" value="${stat.name}" class="rpg-char-stat-label" data-index="${index}" placeholder="Stat Name (e.g., Health)">
                <button class="rpg-field-remove rpg-char-stat-remove" data-index="${index}" title="Remove stat"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    });

    html += '</div>';
    html += `<button class="rpg-btn-secondary" id="rpg-add-char-stat"><i class="fa-solid fa-plus"></i> ${i18n.getTranslation('template.trackerEditorModal.presentCharactersTab.addCharacterStatButton')}</button>`;

    html += '</div>';

    $('#rpg-editor-tab-presentCharacters').html(html);
    setupPresentCharactersListeners();
}

/**
 * Set up event listeners for Present Characters tab
 */
function setupPresentCharactersListeners() {
    // Relationships enabled toggle
    $('#rpg-relationships-enabled').off('change').on('change', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.relationships) {
            extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true, relationshipEmojis: {} };
        }
        extensionSettings.trackerConfig.presentCharacters.relationships.enabled = $(this).is(':checked');
    });

    // Add new relationship
    $('#rpg-add-relationship').off('click').on('click', function() {
        // Ensure relationships object exists
        if (!extensionSettings.trackerConfig.presentCharacters.relationships) {
            extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true, relationshipEmojis: {} };
        }
        if (!extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis) {
            extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis = {};
        }

        // Generate a unique relationship name
        let baseName = 'New Relationship';
        let relationshipName = baseName;
        let counter = 1;
        const existingRelationships = extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis;

        while (existingRelationships[relationshipName]) {
            counter++;
            relationshipName = `${baseName} ${counter}`;
        }

        // Add to new structure
        extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis[relationshipName] = '😊';

        // Also update legacy fields for backward compatibility
        if (!extensionSettings.trackerConfig.presentCharacters.relationshipEmojis) {
            extensionSettings.trackerConfig.presentCharacters.relationshipEmojis = {};
        }
        extensionSettings.trackerConfig.presentCharacters.relationshipEmojis[relationshipName] = '😊';

        // Sync relationshipFields
        const emojis = extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis;
        extensionSettings.trackerConfig.presentCharacters.relationshipFields = Object.keys(emojis);

        renderPresentCharactersTab();
    });

    // Remove relationship
    $('.rpg-remove-relationship').off('click').on('click', function() {
        const relationship = $(this).data('relationship');

        // Remove from new structure
        if (extensionSettings.trackerConfig.presentCharacters.relationships?.relationshipEmojis) {
            delete extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis[relationship];
        }

        // Remove from legacy structure
        if (extensionSettings.trackerConfig.presentCharacters.relationshipEmojis) {
            delete extensionSettings.trackerConfig.presentCharacters.relationshipEmojis[relationship];
        }

        // Sync relationshipFields
        const emojis = extensionSettings.trackerConfig.presentCharacters.relationships?.relationshipEmojis || {};
        extensionSettings.trackerConfig.presentCharacters.relationshipFields = Object.keys(emojis);

        renderPresentCharactersTab();
    });

    // Update relationship name
    $('.rpg-relationship-name').off('blur').on('blur', function() {
        const newName = $(this).val();
        const $item = $(this).closest('.rpg-relationship-item');
        const emoji = $item.find('.rpg-relationship-emoji').val();

        // Ensure structures exist
        if (!extensionSettings.trackerConfig.presentCharacters.relationships) {
            extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true, relationshipEmojis: {} };
        }
        if (!extensionSettings.trackerConfig.presentCharacters.relationshipEmojis) {
            extensionSettings.trackerConfig.presentCharacters.relationshipEmojis = {};
        }

        // Find the old name by matching the emoji in new structure
        const emojis = extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis;
        const oldName = Object.keys(emojis).find(
            key => emojis[key] === emoji && key !== newName
        );

        if (oldName && oldName !== newName) {
            // Update new structure
            delete emojis[oldName];
            emojis[newName] = emoji;

            // Update legacy structure
            delete extensionSettings.trackerConfig.presentCharacters.relationshipEmojis[oldName];
            extensionSettings.trackerConfig.presentCharacters.relationshipEmojis[newName] = emoji;

            // Sync relationshipFields
            extensionSettings.trackerConfig.presentCharacters.relationshipFields = Object.keys(emojis);
        }
    });

    // Update relationship emoji
    $('.rpg-relationship-emoji').off('blur').on('blur', function() {
        const name = $(this).closest('.rpg-relationship-item').find('.rpg-relationship-name').val();

        // Ensure structures exist
        if (!extensionSettings.trackerConfig.presentCharacters.relationships) {
            extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true, relationshipEmojis: {} };
        }
        if (!extensionSettings.trackerConfig.presentCharacters.relationshipEmojis) {
            extensionSettings.trackerConfig.presentCharacters.relationshipEmojis = {};
        }

        // Update both structures
        extensionSettings.trackerConfig.presentCharacters.relationships.relationshipEmojis[name] = $(this).val();
        extensionSettings.trackerConfig.presentCharacters.relationshipEmojis[name] = $(this).val();
    });

    // Thoughts configuration
    $('#rpg-thoughts-enabled').off('change').on('change', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.thoughts) {
            extensionSettings.trackerConfig.presentCharacters.thoughts = {};
        }
        extensionSettings.trackerConfig.presentCharacters.thoughts.enabled = $(this).is(':checked');
    });

    $('#rpg-thoughts-name').off('blur').on('blur', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.thoughts) {
            extensionSettings.trackerConfig.presentCharacters.thoughts = {};
        }
        extensionSettings.trackerConfig.presentCharacters.thoughts.name = $(this).val();
    });

    $('#rpg-thoughts-description').off('blur').on('blur', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.thoughts) {
            extensionSettings.trackerConfig.presentCharacters.thoughts = {};
        }
        extensionSettings.trackerConfig.presentCharacters.thoughts.description = $(this).val();
    });

    // Add field
    $('#rpg-add-field').off('click').on('click', function() {
        extensionSettings.trackerConfig.presentCharacters.customFields.push({
            id: 'custom_' + Date.now(),
            name: 'New Field',
            enabled: true,
            description: 'Description for AI'
        });
        renderPresentCharactersTab();
    });

    // Remove field
    $('.rpg-field-remove').off('click').on('click', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.customFields.splice(index, 1);
        renderPresentCharactersTab();
    });

    // Move field up
    $('.rpg-field-move-up').off('click').on('click', function() {
        const index = $(this).data('index');
        if (index > 0) {
            const fields = extensionSettings.trackerConfig.presentCharacters.customFields;
            [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
            renderPresentCharactersTab();
        }
    });

    // Move field down
    $('.rpg-field-move-down').off('click').on('click', function() {
        const index = $(this).data('index');
        const fields = extensionSettings.trackerConfig.presentCharacters.customFields;
        if (index < fields.length - 1) {
            [fields[index], fields[index + 1]] = [fields[index + 1], fields[index]];
            renderPresentCharactersTab();
        }
    });

    // Toggle field
    $('.rpg-field-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.customFields[index].enabled = $(this).is(':checked');
    });

    // Rename field
    $('.rpg-field-label').off('blur').on('blur', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.customFields[index].name = $(this).val();
    });

    // Update description
    $('.rpg-field-placeholder').off('blur').on('blur', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.customFields[index].description = $(this).val();
    });

    // Character stats toggle
    $('#rpg-char-stats-enabled').off('change').on('change', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.characterStats) {
            extensionSettings.trackerConfig.presentCharacters.characterStats = { enabled: false, customStats: [] };
        }
        extensionSettings.trackerConfig.presentCharacters.characterStats.enabled = $(this).is(':checked');
    });

    // Add character stat
    $('#rpg-add-char-stat').off('click').on('click', function() {
        if (!extensionSettings.trackerConfig.presentCharacters.characterStats) {
            extensionSettings.trackerConfig.presentCharacters.characterStats = { enabled: false, customStats: [] };
        }
        if (!extensionSettings.trackerConfig.presentCharacters.characterStats.customStats) {
            extensionSettings.trackerConfig.presentCharacters.characterStats.customStats = [];
        }
        extensionSettings.trackerConfig.presentCharacters.characterStats.customStats.push({
            id: `stat-${Date.now()}`,
            name: 'New Stat',
            enabled: true
        });
        renderPresentCharactersTab();
    });

    // Remove character stat
    $('.rpg-char-stat-remove').off('click').on('click', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.characterStats.customStats.splice(index, 1);
        renderPresentCharactersTab();
    });

    // Toggle character stat
    $('.rpg-char-stat-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.characterStats.customStats[index].enabled = $(this).is(':checked');
    });

    // Rename character stat
    $('.rpg-char-stat-label').off('blur').on('blur', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.characterStats.customStats[index].name = $(this).val();
    });
}

/**
 * Render History Persistence configuration tab
 * Allows users to select which tracker data should be injected into historical messages
 */
function renderHistoryPersistenceTab() {
    const historyPersistence = extensionSettings.historyPersistence || {
        enabled: false,
        messageCount: 5,
        injectionPosition: 'assistant_message_end',
        contextPreamble: '',
        sendAllEnabledOnRefresh: false
    };
    const userStatsConfig = extensionSettings.trackerConfig.userStats;
    const infoBoxConfig = extensionSettings.trackerConfig.infoBox;
    const presentCharsConfig = extensionSettings.trackerConfig.presentCharacters;
    const generationMode = extensionSettings.generationMode || 'together';

    let html = '<div class="rpg-editor-section">';

    // Main toggle and settings
    html += `<h4><i class="fa-solid fa-clock-rotate-left"></i> History Persistence Settings</h4>`;
    html += `<p class="rpg-editor-hint">Inject selected tracker data into historical messages to help the AI maintain continuity for time-sensitive events, weather changes, and location tracking.</p>`;

    // Enable toggle
    html += '<div class="rpg-editor-toggle-row">';
    html += `<input type="checkbox" id="rpg-history-persistence-enabled" ${historyPersistence.enabled ? 'checked' : ''}>`;
    html += `<label for="rpg-history-persistence-enabled">Enable History Persistence</label>`;
    html += '</div>';

    // External API Only toggle - only show for separate/external modes
    if (generationMode === 'separate' || generationMode === 'external') {
        html += '<div class="rpg-editor-toggle-row" style="margin-top: 8px;">';
        html += `<input type="checkbox" id="rpg-history-send-all-enabled" ${historyPersistence.sendAllEnabledOnRefresh ? 'checked' : ''}>`;
        html += `<label for="rpg-history-send-all-enabled">Send All Enabled Stats on Refresh</label>`;
        html += '</div>';
        html += `<p class="rpg-editor-hint" style="margin-top: 4px; margin-left: 24px;">When enabled, Refresh RPG Info will include all enabled stats from the preset in history context, ignoring the individual selections below.</p>`;
    }

    // Message count
    html += '<div class="rpg-editor-input-row" style="margin-top: 12px;">';
    html += `<label for="rpg-history-message-count">Number of messages to include (0 = all available):</label>`;
    html += `<input type="number" id="rpg-history-message-count" min="0" max="50" value="${historyPersistence.messageCount}" class="rpg-input" style="width: 80px; margin-left: 8px;">`;
    html += '</div>';

    // Injection position
    html += '<div class="rpg-editor-input-row" style="margin-top: 12px;">';
    html += `<label for="rpg-history-injection-position">Injection Position:</label>`;
    html += `<select id="rpg-history-injection-position" class="rpg-select" style="margin-left: 8px;">`;
    html += `<option value="user_message_end" ${historyPersistence.injectionPosition === 'user_message_end' ? 'selected' : ''}>End of the User's Message</option>`;
    html += `<option value="assistant_message_end" ${historyPersistence.injectionPosition === 'assistant_message_end' ? 'selected' : ''}>End of the Assistant's Message</option>`;
    html += `</select>`;
    html += '</div>';

    // Custom preamble
    html += '<div class="rpg-editor-input-row" style="margin-top: 12px;">';
    html += `<label for="rpg-history-context-preamble">Custom Context Preamble:</label>`;
    html += `<input type="text" id="rpg-history-context-preamble" value="${historyPersistence.contextPreamble || ''}" class="rpg-text-input" placeholder="Context for that moment:" style="width: 100%; margin-top: 4px;">`;
    html += '</div>';

    // User Stats section - which stats to persist
    html += `<h4 style="margin-top: 20px;"><i class="fa-solid fa-heart-pulse"></i> User Stats</h4>`;
    html += `<p class="rpg-editor-hint">Select which stats should be included in historical messages.</p>`;

    // Custom stats
    html += '<div class="rpg-history-persist-list">';
    userStatsConfig.customStats.forEach((stat, index) => {
        if (stat.enabled) {
            html += `
                <div class="rpg-editor-toggle-row">
                    <input type="checkbox" id="rpg-history-stat-${stat.id}" class="rpg-history-stat-toggle" data-index="${index}" ${stat.persistInHistory ? 'checked' : ''}>
                    <label for="rpg-history-stat-${stat.id}">${stat.name}</label>
                </div>
            `;
        }
    });

    // Status section
    if (userStatsConfig.statusSection?.enabled) {
        html += `
            <div class="rpg-editor-toggle-row">
                <input type="checkbox" id="rpg-history-status" ${userStatsConfig.statusSection.persistInHistory ? 'checked' : ''}>
                <label for="rpg-history-status">Status (Mood/Conditions)</label>
            </div>
        `;
    }

    // Skills section
    if (userStatsConfig.skillsSection?.enabled) {
        html += `
            <div class="rpg-editor-toggle-row">
                <input type="checkbox" id="rpg-history-skills" ${userStatsConfig.skillsSection.persistInHistory ? 'checked' : ''}>
                <label for="rpg-history-skills">${userStatsConfig.skillsSection.label || 'Skills'}</label>
            </div>
        `;
    }

    // Inventory
    html += `
        <div class="rpg-editor-toggle-row">
            <input type="checkbox" id="rpg-history-inventory" ${userStatsConfig.inventoryPersistInHistory ? 'checked' : ''}>
            <label for="rpg-history-inventory">Inventory</label>
        </div>
    `;

    // Quests
    html += `
        <div class="rpg-editor-toggle-row">
            <input type="checkbox" id="rpg-history-quests" ${userStatsConfig.questsPersistInHistory ? 'checked' : ''}>
            <label for="rpg-history-quests">Quests</label>
        </div>
    `;
    html += '</div>';

    // Info Box section - which widgets to persist
    html += `<h4 style="margin-top: 20px;"><i class="fa-solid fa-info-circle"></i> Info Box</h4>`;
    html += `<p class="rpg-editor-hint">Select which info box fields should be included in historical messages. These are recommended for time tracking.</p>`;

    html += '<div class="rpg-history-persist-list">';
    const widgetLabels = {
        date: 'Date',
        weather: 'Weather',
        temperature: 'Temperature',
        time: 'Time',
        location: 'Location',
        recentEvents: 'Recent Events'
    };

    for (const [widgetId, widget] of Object.entries(infoBoxConfig.widgets)) {
        if (widget.enabled) {
            html += `
                <div class="rpg-editor-toggle-row">
                    <input type="checkbox" id="rpg-history-widget-${widgetId}" class="rpg-history-widget-toggle" data-widget="${widgetId}" ${widget.persistInHistory ? 'checked' : ''}>
                    <label for="rpg-history-widget-${widgetId}">${widgetLabels[widgetId] || widgetId}</label>
                </div>
            `;
        }
    }
    html += '</div>';

    // Present Characters section
    html += `<h4 style="margin-top: 20px;"><i class="fa-solid fa-users"></i> Present Characters</h4>`;
    html += `<p class="rpg-editor-hint">Select which character fields should be included in historical messages.</p>`;

    html += '<div class="rpg-history-persist-list">';

    // Custom fields (appearance, demeanor, etc.)
    presentCharsConfig.customFields.forEach((field, index) => {
        if (field.enabled) {
            html += `
                <div class="rpg-editor-toggle-row">
                    <input type="checkbox" id="rpg-history-charfield-${field.id}" class="rpg-history-charfield-toggle" data-index="${index}" ${field.persistInHistory ? 'checked' : ''}>
                    <label for="rpg-history-charfield-${field.id}">${field.name}</label>
                </div>
            `;
        }
    });

    // Thoughts
    if (presentCharsConfig.thoughts?.enabled) {
        html += `
            <div class="rpg-editor-toggle-row">
                <input type="checkbox" id="rpg-history-thoughts" ${presentCharsConfig.thoughts.persistInHistory ? 'checked' : ''}>
                <label for="rpg-history-thoughts">${presentCharsConfig.thoughts.name || 'Thoughts'}</label>
            </div>
        `;
    }
    html += '</div>';

    html += '</div>';

    $('#rpg-editor-tab-historyPersistence').html(html);
    setupHistoryPersistenceListeners();
}

/**
 * Set up event listeners for History Persistence tab
 */
function setupHistoryPersistenceListeners() {
    // Ensure historyPersistence object exists
    if (!extensionSettings.historyPersistence) {
        extensionSettings.historyPersistence = {
            enabled: false,
            messageCount: 5,
            injectionPosition: 'assistant_message_end',
            contextPreamble: '',
            externalApiOnly: false
        };
    }

    // Main toggle
    $('#rpg-history-persistence-enabled').off('change').on('change', function() {
        extensionSettings.historyPersistence.enabled = $(this).is(':checked');
    });

    // Send All Enabled on Refresh toggle
    $('#rpg-history-send-all-enabled').off('change').on('change', function() {
        extensionSettings.historyPersistence.sendAllEnabledOnRefresh = $(this).is(':checked');
    });

    // Message count
    $('#rpg-history-message-count').off('change').on('change', function() {
        extensionSettings.historyPersistence.messageCount = parseInt($(this).val()) || 0;
    });

    // Injection position
    $('#rpg-history-injection-position').off('change').on('change', function() {
        extensionSettings.historyPersistence.injectionPosition = $(this).val();
    });

    // Context preamble
    $('#rpg-history-context-preamble').off('blur').on('blur', function() {
        extensionSettings.historyPersistence.contextPreamble = $(this).val();
    });

    // User Stats toggles
    $('.rpg-history-stat-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.userStats.customStats[index].persistInHistory = $(this).is(':checked');
    });

    // Status section
    $('#rpg-history-status').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.statusSection.persistInHistory = $(this).is(':checked');
    });

    // Skills section
    $('#rpg-history-skills').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.skillsSection.persistInHistory = $(this).is(':checked');
    });

    // Inventory
    $('#rpg-history-inventory').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.inventoryPersistInHistory = $(this).is(':checked');
    });

    // Quests
    $('#rpg-history-quests').off('change').on('change', function() {
        extensionSettings.trackerConfig.userStats.questsPersistInHistory = $(this).is(':checked');
    });

    // Info Box widget toggles
    $('.rpg-history-widget-toggle').off('change').on('change', function() {
        const widgetId = $(this).data('widget');
        extensionSettings.trackerConfig.infoBox.widgets[widgetId].persistInHistory = $(this).is(':checked');
    });

    // Present Characters field toggles
    $('.rpg-history-charfield-toggle').off('change').on('change', function() {
        const index = $(this).data('index');
        extensionSettings.trackerConfig.presentCharacters.customFields[index].persistInHistory = $(this).is(':checked');
    });

    // Thoughts
    $('#rpg-history-thoughts').off('change').on('change', function() {
        extensionSettings.trackerConfig.presentCharacters.thoughts.persistInHistory = $(this).is(':checked');
    });
}

// ============================================================================
// STAT SHEET TAB — Session 3: Full Configuration
// ============================================================================

/**
 * Render the full Stat Sheet configuration tab in the tracker editor.
 * Sections:
 *   1. Enable / Display Mode
 *   2. Display options (show level, show EXP)
 *   3. Level Calculation mode
 *   4. XP Curve settings
 *   5. Value limits
 *   6. Rank Thresholds (alphabetic glow)
 *   7. Data management (export / import / reset)
 */
function renderStatSheetTab() {
    const container = $('#rpg-editor-tab-statSheet');
    if (!container.length) return;

    // Ensure statSheet exists (may not if never enabled)
    const ss = extensionSettings.statSheet;
    if (!ss) {
        container.html(`
            <div class="rpg-editor-section">
                <p class="rpg-editor-hint" style="text-align:center; padding:40px 20px;">
                    <i class="fa-solid fa-chart-bar" style="font-size:32px;opacity:0.4;display:block;margin-bottom:12px;"></i>
                    Stat sheet data not found. Reload the extension or start a new chat.
                </p>
            </div>
        `);
        return;
    }

    const enabled       = ss.enabled   || false;

    // ── Sync stat sheet button appearance to enabled state ────────────────────
    const $ssBtn = $('#open-stat-sheet-btn');
    if (enabled) {
        $ssBtn.css({ opacity: '', cursor: '', filter: '' })
              .attr('title', 'Character Stats');
    } else {
        $ssBtn.css({ opacity: '0.35', cursor: 'not-allowed', filter: 'grayscale(1)' })
              .attr('title', 'Character Stats (disabled — enable in Settings → Stat Sheet)');
    }

    const level         = ss.level     || {};
    const edSettings    = ss.editorSettings || {};
    const attributes    = (ss.attributes || []).filter(a => a.enabled);

    const calcMode      = level.calculationMode || 'manual';
    const expCurve      = level.expCurve        || 'linear';
    const expPerLevel   = level.expPerLevel      || 1000;
    const attrMax       = edSettings.attributeMaxValue ?? 999;

    let html = '';

    // ── 1. Enable & Display Mode ──────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-chart-bar"></i> Stat Sheet System</h4>

            <div class="rpg-editor-toggle-row" style="margin-bottom:12px;">
                <input type="checkbox" id="ss-enabled" ${enabled ? 'checked' : ''}>
                <label for="ss-enabled" style="font-weight:600;">Enable Stat Sheet</label>
            </div>
            <p class="rpg-editor-hint" style="margin-top:-4px;">
                When enabled, the stat sheet button appears in the panel header and injects
                character attributes into AI prompts. Classic RPG attributes panel is hidden.
            </p>
        </div>

    `;

    // ── 2. Display Options ────────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-eye"></i> Display Options</h4>
            <div class="rpg-editor-toggle-row">
                <input type="checkbox" id="ss-show-level" ${level.showLevel !== false ? 'checked' : ''}>
                <label for="ss-show-level">Show Level in stat sheet</label>
            </div>
            <div class="rpg-editor-toggle-row" style="margin-top:8px;">
                <input type="checkbox" id="ss-show-exp" ${level.showExp !== false ? 'checked' : ''}>
                <label for="ss-show-exp">Show EXP in stat sheet</label>
            </div>
        </div>
    `;

    // ── 3. Level Calculation ──────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-layer-group"></i> Level Calculation</h4>
            <p class="rpg-editor-hint">How is your character's level determined?</p>
            <div class="rpg-radio-group" style="flex-direction:column; gap:10px;">
                <label>
                    <input type="radio" name="ss-calc-mode" value="manual"
                           ${calcMode === 'manual' ? 'checked' : ''}>
                    <strong>Manual</strong> &mdash; you set the level yourself in the stat sheet
                </label>
                <label>
                    <input type="radio" name="ss-calc-mode" value="sum"
                           ${calcMode === 'sum' ? 'checked' : ''}>
                    <strong>Sum of Job Levels</strong> &mdash; level = total of all job levels added together
                </label>
                <label>
                    <input type="radio" name="ss-calc-mode" value="max"
                           ${calcMode === 'max' ? 'checked' : ''}>
                    <strong>Highest Job Level</strong> &mdash; level = your highest single job level
                </label>
            </div>
        </div>
    `;

    // ── 4. XP Curve ───────────────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-chart-line"></i> XP Curve</h4>
            <p class="rpg-editor-hint">Controls how much EXP is needed per level.</p>
            <div class="rpg-radio-group" style="gap:20px; margin-bottom:14px;">
                <label>
                    <input type="radio" name="ss-exp-curve" value="linear"
                           ${expCurve === 'linear' ? 'checked' : ''}>
                    <strong>Linear</strong> &mdash; same EXP each level
                </label>
                <label>
                    <input type="radio" name="ss-exp-curve" value="exponential"
                           ${expCurve === 'exponential' ? 'checked' : ''}>
                    <strong>Exponential</strong> &mdash; doubles each level
                </label>
            </div>
            <div class="rpg-setting-row" style="align-items:center; gap:12px;">
                <label for="ss-exp-per-level" style="white-space:nowrap;">Base XP per Level:</label>
                <input type="number"
                       id="ss-exp-per-level"
                       class="rpg-input"
                       value="${expPerLevel}"
                       min="1"
                       step="100"
                       style="width:120px;">
                <span class="rpg-editor-hint" style="margin:0; font-size:11px;">
                    ${expCurve === 'exponential'
                        ? 'Lv1→2 needs this amount; doubles each level after.'
                        : 'Every level requires this many EXP to advance.'}
                </span>
            </div>
        </div>
    `;

    // ── 5. Value Limits ───────────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-sliders"></i> Value Limits</h4>
            <div class="rpg-setting-row" style="align-items:center; gap:12px;">
                <label for="ss-attr-max" style="white-space:nowrap;">Attribute Max (Numeric):</label>
                <input type="number"
                       id="ss-attr-max"
                       class="rpg-input"
                       value="${attrMax}"
                       min="1"
                       step="1"
                       style="width:100px;">
            </div>
            <p class="rpg-editor-hint" style="margin-top:8px;">
                Skill values are <strong>uncapped</strong> in numeric mode — they can go as high as needed.
                Alphabetic mode caps at <strong>EX</strong> rank for both attributes and skills.
            </p>
        </div>
    `;

    // ── 6. Alphabetic Mode Settings ──────────────────────────────────────────
    const RANKS = [
        'FFF','FF','F',
        'E','EE','EEE',
        'D','DD','DDD',
        'C','CC','CCC',
        'B','BB','BBB',
        'A','AA','AAA',
        'S','SS','SSS','EX'
    ];

    const gvm     = edSettings.gradeValueMap  || {};
    const gdm     = edSettings.gradeDiceMap   || {};
    const divisor = edSettings.attrValueDivisor ?? 100;

    const rankRows = RANKS.map(r => `
        <tr>
            <td class="rpg-gvm-rank-cell">${r}</td>
            <td>
                <input type="number"
                       class="rpg-input rpg-gvm-input"
                       data-rank="${r}"
                       value="${gvm[r] ?? ''}"
                       min="0"
                       placeholder="0"
                       style="width:70px; text-align:center;">
            </td>
            <td>
                <input type="number"
                       class="rpg-input rpg-gdm-input"
                       data-rank="${r}"
                       value="${gdm[r] ?? ''}"
                       min="1"
                       placeholder="—"
                       style="width:70px; text-align:center;">
            </td>
        </tr>
    `).join('');

    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-ranking-star"></i> Alphabetic Mode Settings</h4>
            <p class="rpg-editor-hint">
                Configure how letter ranks translate to numbers for roll calculations and which
                die each rank uses in the roll popover.
            </p>

            <div class="rpg-setting-row" style="align-items:center; gap:12px; margin-bottom:16px;">
                <label for="ss-attr-divisor" style="white-space:nowrap;">Attribute Value Divisor:</label>
                <input type="number"
                       id="ss-attr-divisor"
                       class="rpg-input"
                       value="${divisor}"
                       min="1"
                       step="1"
                       style="width:90px;">
                <span class="rpg-editor-hint" style="margin:0; font-size:11px;">
                    Attribute rank modifier = Grade Value + floor(rankValue ÷ this number).
                    e.g. divisor 100, rankValue 250 → +2 bonus component.
                </span>
            </div>

            <table class="rpg-gvm-table" style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr>
                        <th style="text-align:left; padding:6px 8px; opacity:0.6; font-weight:600; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.08);">RANK</th>
                        <th style="text-align:center; padding:6px 8px; opacity:0.6; font-weight:600; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.08);">GRADE VALUE<br><span style="font-weight:400; opacity:0.7;">roll modifier bonus</span></th>
                        <th style="text-align:center; padding:6px 8px; opacity:0.6; font-weight:600; font-size:11px; border-bottom:1px solid rgba(255,255,255,0.08);">GRADE DIE<br><span style="font-weight:400; opacity:0.7;">sides on roll die</span></th>
                    </tr>
                </thead>
                <tbody>
                    ${rankRows}
                </tbody>
            </table>
            <p class="rpg-editor-hint" style="margin-top:10px;">
                <strong>Grade Value</strong>: base number added to roll modifier when an attribute or
                skill is at that rank.<br>
                <strong>Grade Die</strong>: the die pre-selected in the roll popover for that rank (e.g. 40 = d40).
            </p>
        </div>
    `;

    // ── 7. Skill EXP Cost Table ───────────────────────────────────────────────
    const useTable  = edSettings.useSkillExpCostTable || false;
    const costTable = Array.isArray(edSettings.skillExpCostTable) ? edSettings.skillExpCostTable : [];

    const tierRows = costTable.map((tier, i) => `
        <tr class="ss-exp-tier-row">
            <td style="padding:4px 6px;">
                <input type="text"
                       class="rpg-input ss-tier-label"
                       data-idx="${i}"
                       value="${String(tier.label || '').replace(/"/g, '&quot;')}"
                       placeholder="Tier name"
                       style="width:130px;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-tier-min"
                       data-idx="${i}"
                       value="${tier.minLevel ?? 0}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-tier-max"
                       data-idx="${i}"
                       value="${tier.maxLevel ?? 9999}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-tier-normal"
                       data-idx="${i}"
                       value="${tier.normalCost ?? 10}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-tier-expensive"
                       data-idx="${i}"
                       value="${tier.expensiveCost ?? 15}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <button class="rpg-btn-secondary ss-remove-tier"
                        data-idx="${i}"
                        type="button"
                        style="padding:4px 10px; font-size:12px;
                               border-color:rgba(255,80,80,0.4); color:#ff9999;">
                    ✕
                </button>
            </td>
        </tr>
    `).join('');

    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-table"></i> Skill EXP Cost Table
                <small style="font-weight:400; opacity:0.7;">(optional — replaces the formula)</small>
            </h4>

            <div class="rpg-editor-toggle-row" style="margin-bottom:10px;">
                <input type="checkbox" id="ss-use-exp-table" ${useTable ? 'checked' : ''}>
                <label for="ss-use-exp-table" style="font-weight:600;">Use custom EXP cost table</label>
            </div>
            <p class="rpg-editor-hint" style="margin-top:-4px;">
                When active, the formula <em>(level + 1) × multiplier</em> is replaced by a tier
                lookup. Tiers are matched top-to-bottom by current level; the last row acts as a
                catch-all. For alphabetic skills the rank's position in the rank ladder is used as
                the level (F = 2, C = 11, S = 18, EX = 20, etc.).
            </p>

            <div id="ss-exp-table-section" ${useTable ? '' : 'style="display:none;"'}>
                <table style="width:100%; border-collapse:collapse; margin-top:12px;">
                    <thead>
                        <tr>
                            <th style="text-align:left;   padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">TIER NAME</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">MIN LV</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">MAX LV</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">NORMAL EXP</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">EXPENSIVE EXP</th>
                            <th style="border-bottom:1px solid rgba(255,255,255,0.08);"></th>
                        </tr>
                    </thead>
                    <tbody id="ss-exp-tier-tbody">
                        ${tierRows || `
                            <tr>
                                <td colspan="6"
                                    style="text-align:center; padding:16px;
                                           opacity:0.5; font-style:italic;">
                                    No tiers yet — click "Add Tier" to create one.
                                </td>
                            </tr>`}
                    </tbody>
                </table>
                <button id="ss-add-exp-tier" class="rpg-btn-secondary" type="button"
                        style="margin-top:10px;">
                    <i class="fa-solid fa-plus"></i> Add Tier
                </button>
            </div>
        </div>
    `;

    // ── 7b. Job EXP Cost Table ───────────────────────────────────────────────
    const useJobTable  = edSettings.useJobExpCostTable || false;
    const jobCostTable = Array.isArray(edSettings.jobExpCostTable) ? edSettings.jobExpCostTable : [];

    const jobTierRows = jobCostTable.map((tier, i) => `
        <tr class="ss-job-exp-tier-row">
            <td style="padding:4px 6px;">
                <input type="text"
                       class="rpg-input ss-job-tier-label"
                       data-idx="${i}"
                       value="${String(tier.label || '').replace(/"/g, '&quot;')}"
                       placeholder="Tier name"
                       style="width:130px;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-job-tier-min"
                       data-idx="${i}"
                       value="${tier.minLevel ?? 0}"
                       min="0"
                       max="9"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-job-tier-max"
                       data-idx="${i}"
                       value="${tier.maxLevel ?? 9}"
                       min="0"
                       max="9"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-job-tier-normal"
                       data-idx="${i}"
                       value="${tier.normalCost ?? 20}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <input type="number"
                       class="rpg-input ss-job-tier-expensive"
                       data-idx="${i}"
                       value="${tier.expensiveCost ?? 30}"
                       min="0"
                       style="width:62px; text-align:center;">
            </td>
            <td style="padding:4px 6px; text-align:center;">
                <button class="rpg-btn-secondary ss-remove-job-tier"
                        data-idx="${i}"
                        type="button"
                        style="padding:4px 10px; font-size:12px;
                               border-color:rgba(255,80,80,0.4); color:#ff9999;">
                    ✕
                </button>
            </td>
        </tr>
    `).join('');

    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-briefcase"></i> Job EXP Cost Table
                <small style="font-weight:400; opacity:0.7;">(optional — replaces the formula for job level-ups)</small>
            </h4>

            <div class="rpg-editor-toggle-row" style="margin-bottom:10px;">
                <input type="checkbox" id="ss-use-job-exp-table" ${useJobTable ? 'checked' : ''}>
                <label for="ss-use-job-exp-table" style="font-weight:600;">Use custom Job EXP cost table</label>
            </div>
            <p class="rpg-editor-hint" style="margin-top:-4px;">
                When active, the formula <em>(level + 1) × multiplier</em> is replaced by a tier
                lookup for job level-ups. Jobs max at level 10, so you only need up to 10 tiers
                (levels 0–9). The last row acts as a catch-all. The <em>Normal / Expensive</em>
                columns correspond to each job's EXP cost toggle in Master Mode.
            </p>

            <div id="ss-job-exp-table-section" ${useJobTable ? '' : 'style="display:none;"'}>
                <table style="width:100%; border-collapse:collapse; margin-top:12px;">
                    <thead>
                        <tr>
                            <th style="text-align:left;   padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">TIER NAME</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">MIN LV</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">MAX LV</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">NORMAL EXP</th>
                            <th style="text-align:center; padding:5px 6px; font-size:11px; opacity:0.65; font-weight:600;
                                       border-bottom:1px solid rgba(255,255,255,0.08);">EXPENSIVE EXP</th>
                            <th style="border-bottom:1px solid rgba(255,255,255,0.08);"></th>
                        </tr>
                    </thead>
                    <tbody id="ss-job-exp-tier-tbody">
                        ${jobTierRows || `
                            <tr>
                                <td colspan="6"
                                    style="text-align:center; padding:16px;
                                           opacity:0.5; font-style:italic;">
                                    No tiers yet — click "Add Tier" to create one.
                                </td>
                            </tr>`}
                    </tbody>
                </table>
                <button id="ss-add-job-exp-tier" class="rpg-btn-secondary" type="button"
                        style="margin-top:10px;">
                    <i class="fa-solid fa-plus"></i> Add Tier
                </button>
                <p class="rpg-editor-hint" style="margin-top:8px;">
                    Job levels run 0–9 (level 0 = not yet levelled, costs to reach level 1).
                    Min/Max values are clamped to 0–9 to match job max level 10.
                </p>
            </div>
        </div>
    `;

    // ── 8. Rank Thresholds ────────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-fire"></i> Rank Thresholds <small style="font-weight:400; opacity:0.7;">(Alphabetic mode only)</small></h4>
            <p class="rpg-editor-hint">
                Set a <strong>rankValue</strong> for each attribute. When the attribute's rankValue
                reaches or exceeds this number its rank badge will glow. Set to <strong>0</strong> to disable.
            </p>
    `;

    if (attributes.length === 0) {
        html += `<p class="rpg-editor-hint" style="font-style:italic;">
            No attributes found. Add attributes to the stat sheet first.
        </p>`;
    } else {
        html += `<div class="rpg-threshold-list">`;
        for (const attr of attributes) {
            html += `
                <div class="rpg-threshold-row">
                    <span class="rpg-threshold-attr-name">${attr.name}</span>
                    <label class="rpg-threshold-label">Glow at rankValue ≥</label>
                    <input type="number"
                           class="rpg-threshold-input"
                           data-attr-id="${attr.id}"
                           value="${attr.threshold || 0}"
                           min="0"
                           step="1"
                           placeholder="0 = off">
                </div>
            `;
        }
        html += `</div>`;
    }

    html += `</div>`;

    // ── 9. Data Management ────────────────────────────────────────────────────
    html += `
        <div class="rpg-editor-section">
            <h4><i class="fa-solid fa-database"></i> Stat Sheet Data</h4>
            <p class="rpg-editor-hint">
                Export your stat sheet (attributes, skills, saving throws, combat pages, etc.)
                as a JSON file, or import a previously saved file. Reset wipes all stat sheet
                data back to the defaults — this cannot be undone.
            </p>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
                <button id="ss-export-btn" class="rpg-btn-secondary" type="button">
                    <i class="fa-solid fa-file-export"></i> Export Stat Sheet
                </button>
                <button id="ss-import-btn" class="rpg-btn-secondary" type="button">
                    <i class="fa-solid fa-file-import"></i> Import Stat Sheet
                </button>
                <button id="ss-reset-btn" class="rpg-btn-secondary" type="button"
                        style="border-color:rgba(255,80,80,0.5); color:#ff9999;">
                    <i class="fa-solid fa-rotate-left"></i> Reset to Defaults
                </button>
            </div>
        </div>
    `;

    container.html(html);
    setupStatSheetTabListeners();
}

/**
 * Set up all event listeners for the Stat Sheet configuration tab.
 * Each listener saves immediately to extensionSettings.statSheet via saveSettings().
 */
function setupStatSheetTabListeners() {
    const ss = extensionSettings.statSheet;
    if (!ss) return;

    // ── Enable toggle ─────────────────────────────────────────────────────────
    $(document).off('change', '#ss-enabled').on('change', '#ss-enabled', function() {
        // Commit current character data to chat_metadata BEFORE any settings write.
        // This ensures the snapshot survives a disable→re-enable cycle.
        saveStatSheetData();
        ss.enabled = $(this).is(':checked');
        saveSettings();
        // Re-render so threshold section shows/hides properly
        renderStatSheetTab();
    });

    // ── Show Level ────────────────────────────────────────────────────────────
    $(document).off('change', '#ss-show-level').on('change', '#ss-show-level', function() {
        if (!ss.level) ss.level = {};
        ss.level.showLevel = $(this).is(':checked');
        saveSettings();
    });

    // ── Show EXP ─────────────────────────────────────────────────────────────
    $(document).off('change', '#ss-show-exp').on('change', '#ss-show-exp', function() {
        if (!ss.level) ss.level = {};
        ss.level.showExp = $(this).is(':checked');
        saveSettings();
    });

    // ── Level calculation mode ────────────────────────────────────────────────
    $(document).off('change', 'input[name="ss-calc-mode"]').on('change', 'input[name="ss-calc-mode"]', function() {
        if (!ss.level) ss.level = {};
        ss.level.calculationMode = $(this).val();
        ss.level.autoCalculate   = ($(this).val() !== 'manual');
        saveSettings();
    });

    // ── XP curve ─────────────────────────────────────────────────────────────
    $(document).off('change', 'input[name="ss-exp-curve"]').on('change', 'input[name="ss-exp-curve"]', function() {
        if (!ss.level) ss.level = {};
        ss.level.expCurve = $(this).val();
        saveSettings();
        // Re-render so the hint text below the input updates
        renderStatSheetTab();
    });

    // ── Base EXP per level ────────────────────────────────────────────────────
    $(document).off('change', '#ss-exp-per-level').on('change', '#ss-exp-per-level', function() {
        if (!ss.level) ss.level = {};
        ss.level.expPerLevel = Math.max(1, parseInt($(this).val()) || 1000);
        saveSettings();
    });

    // ── Attribute max value ───────────────────────────────────────────────────
    $(document).off('change', '#ss-attr-max').on('change', '#ss-attr-max', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        ss.editorSettings.attributeMaxValue = Math.max(1, parseInt($(this).val()) || 999);
        saveSettings();
    });

    // ── Rank thresholds ───────────────────────────────────────────────────────
    $(document).off('change', '.rpg-threshold-input').on('change', '.rpg-threshold-input', function() {
        const attrId = $(this).data('attr-id');
        const value  = parseInt($(this).val()) || 0;
        const attr   = ss.attributes?.find(a => a.id === attrId);
        if (attr) {
            attr.threshold = Math.max(0, value);
            saveSettings();
        }
    });

    // ── Attribute value divisor ───────────────────────────────────────────────
    $(document).off('change', '#ss-attr-divisor').on('change', '#ss-attr-divisor', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        ss.editorSettings.attrValueDivisor = Math.max(1, parseInt($(this).val()) || 100);
        saveSettings();
    });

    // ── Grade value map ───────────────────────────────────────────────────────
    $(document).off('change', '.rpg-gvm-input').on('change', '.rpg-gvm-input', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        if (!ss.editorSettings.gradeValueMap) ss.editorSettings.gradeValueMap = {};
        const rank = $(this).data('rank');
        const val  = parseInt($(this).val());
        ss.editorSettings.gradeValueMap[rank] = isNaN(val) ? 0 : Math.max(0, val);
        saveSettings();
    });

    // ── Grade dice map ────────────────────────────────────────────────────────
    $(document).off('change', '.rpg-gdm-input').on('change', '.rpg-gdm-input', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        if (!ss.editorSettings.gradeDiceMap) ss.editorSettings.gradeDiceMap = {};
        const rank = $(this).data('rank');
        const val  = parseInt($(this).val());
        ss.editorSettings.gradeDiceMap[rank] = isNaN(val) ? 20 : Math.max(1, val);
        saveSettings();
    });

    // ── Use skill EXP cost table toggle ──────────────────────────────────────
    $(document).off('change', '#ss-use-exp-table').on('change', '#ss-use-exp-table', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        ss.editorSettings.useSkillExpCostTable = $(this).is(':checked');
        saveSettings();
        $('#ss-exp-table-section').toggle($(this).is(':checked'));
    });

    // ── Add EXP cost tier ─────────────────────────────────────────────────────
    $(document).off('click', '#ss-add-exp-tier').on('click', '#ss-add-exp-tier', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        if (!Array.isArray(ss.editorSettings.skillExpCostTable)) ss.editorSettings.skillExpCostTable = [];
        const tiers  = ss.editorSettings.skillExpCostTable;
        const last   = tiers[tiers.length - 1];
        const newMin = last ? Math.min(last.maxLevel + 1, 9999) : 0;
        tiers.push({
            id:            `tier_${Date.now()}`,
            label:         `Tier ${tiers.length + 1}`,
            minLevel:      newMin,
            maxLevel:      9999,
            normalCost:    10,
            expensiveCost: 15
        });
        saveSettings();
        renderStatSheetTab();
    });

    // ── Remove EXP cost tier ──────────────────────────────────────────────────
    $(document).off('click', '.ss-remove-tier').on('click', '.ss-remove-tier', function() {
        if (!Array.isArray(ss.editorSettings?.skillExpCostTable)) return;
        const idx = parseInt($(this).data('idx'));
        if (!isNaN(idx)) {
            ss.editorSettings.skillExpCostTable.splice(idx, 1);
            saveSettings();
            renderStatSheetTab();
        }
    });

    // ── Edit tier fields ──────────────────────────────────────────────────────
    $(document).off('change', '.ss-tier-label').on('change', '.ss-tier-label', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.skillExpCostTable?.[idx];
        if (tier) { tier.label = $(this).val(); saveSettings(); }
    });

    $(document).off('change', '.ss-tier-min').on('change', '.ss-tier-min', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.skillExpCostTable?.[idx];
        if (tier) { tier.minLevel = Math.max(0, parseInt($(this).val()) || 0); saveSettings(); }
    });

    $(document).off('change', '.ss-tier-max').on('change', '.ss-tier-max', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.skillExpCostTable?.[idx];
        if (tier) { tier.maxLevel = Math.max(0, parseInt($(this).val()) || 9999); saveSettings(); }
    });

    $(document).off('change', '.ss-tier-normal').on('change', '.ss-tier-normal', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.skillExpCostTable?.[idx];
        if (tier) { tier.normalCost = Math.max(0, parseInt($(this).val()) || 0); saveSettings(); }
    });

    $(document).off('change', '.ss-tier-expensive').on('change', '.ss-tier-expensive', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.skillExpCostTable?.[idx];
        if (tier) { tier.expensiveCost = Math.max(0, parseInt($(this).val()) || 0); saveSettings(); }
    });

    // ── Use job EXP cost table toggle ─────────────────────────────────────────
    $(document).off('change', '#ss-use-job-exp-table').on('change', '#ss-use-job-exp-table', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        ss.editorSettings.useJobExpCostTable = $(this).is(':checked');
        saveSettings();
        $('#ss-job-exp-table-section').toggle($(this).is(':checked'));
    });

    // ── Add Job EXP cost tier ─────────────────────────────────────────────────
    $(document).off('click', '#ss-add-job-exp-tier').on('click', '#ss-add-job-exp-tier', function() {
        if (!ss.editorSettings) ss.editorSettings = {};
        if (!Array.isArray(ss.editorSettings.jobExpCostTable)) ss.editorSettings.jobExpCostTable = [];
        const tiers  = ss.editorSettings.jobExpCostTable;
        if (tiers.length >= 10) {
            toastr.warning('Job EXP table is limited to 10 tiers (one per job level 0–9).');
            return;
        }
        const last   = tiers[tiers.length - 1];
        const newMin = last ? Math.min((last.maxLevel ?? 0) + 1, 9) : 0;
        tiers.push({
            id:            `jtier_${Date.now()}`,
            label:         `Tier ${tiers.length + 1}`,
            minLevel:      newMin,
            maxLevel:      9,
            normalCost:    20,
            expensiveCost: 30
        });
        saveSettings();
        renderStatSheetTab();
    });

    // ── Remove Job EXP cost tier ──────────────────────────────────────────────
    $(document).off('click', '.ss-remove-job-tier').on('click', '.ss-remove-job-tier', function() {
        if (!Array.isArray(ss.editorSettings?.jobExpCostTable)) return;
        const idx = parseInt($(this).data('idx'));
        if (!isNaN(idx)) {
            ss.editorSettings.jobExpCostTable.splice(idx, 1);
            saveSettings();
            renderStatSheetTab();
        }
    });

    // ── Edit job tier fields ──────────────────────────────────────────────────
    $(document).off('change', '.ss-job-tier-label').on('change', '.ss-job-tier-label', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.jobExpCostTable?.[idx];
        if (tier) { tier.label = $(this).val(); saveSettings(); }
    });

    $(document).off('change', '.ss-job-tier-min').on('change', '.ss-job-tier-min', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.jobExpCostTable?.[idx];
        if (tier) { tier.minLevel = Math.max(0, Math.min(9, parseInt($(this).val()) || 0)); saveSettings(); }
    });

    $(document).off('change', '.ss-job-tier-max').on('change', '.ss-job-tier-max', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.jobExpCostTable?.[idx];
        if (tier) { tier.maxLevel = Math.max(0, Math.min(9, parseInt($(this).val()) || 9)); saveSettings(); }
    });

    $(document).off('change', '.ss-job-tier-normal').on('change', '.ss-job-tier-normal', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.jobExpCostTable?.[idx];
        if (tier) { tier.normalCost = Math.max(0, parseInt($(this).val()) || 0); saveSettings(); }
    });

    $(document).off('change', '.ss-job-tier-expensive').on('change', '.ss-job-tier-expensive', function() {
        const idx  = parseInt($(this).data('idx'));
        const tier = ss.editorSettings?.jobExpCostTable?.[idx];
        if (tier) { tier.expensiveCost = Math.max(0, parseInt($(this).val()) || 0); saveSettings(); }
    });

    // ── Export stat sheet ─────────────────────────────────────────────────────
    $(document).off('click', '#ss-export-btn').on('click', '#ss-export-btn', function() {
        exportStatSheetData();
    });

    // ── Import stat sheet ─────────────────────────────────────────────────────
    $(document).off('click', '#ss-import-btn').on('click', '#ss-import-btn', function() {
        importStatSheetData();
    });

    // ── Reset stat sheet ──────────────────────────────────────────────────────
    $(document).off('click', '#ss-reset-btn').on('click', '#ss-reset-btn', function() {
        const confirmed = confirm(
            'RESET STAT SHEET?\n\n' +
            'This will permanently delete ALL attributes, skills, saving throws, jobs, feats, augments, and combat pages.\n\n' +
            'Clicking OK will first download an automatic backup, then reset to defaults.\n\n' +
            'Cancel to abort — no changes will be made.'
        );
        if (!confirmed) return;

        // Auto-export backup before wiping — last line of defense
        try {
            const payload  = {
                version:    '1.0',
                exportDate: new Date().toISOString(),
                note:       'Auto-backup created before stat sheet reset',
                statSheet:  JSON.parse(JSON.stringify(extensionSettings.statSheet || {}))
            };
            const json = JSON.stringify(payload, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href  = url;
            const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            link.download = `stat-sheet-BACKUP-before-reset-${ts}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (backupErr) {
            console.error('[RPG Companion] Backup export failed:', backupErr);
            if (!confirm('WARNING: Automatic backup failed to download.\n\nProceed with reset anyway? (Your data will be lost.)')) return;
        }

        // Now wipe and rebuild
        delete extensionSettings.statSheet;
        saveSettings();
        if (typeof initializeStatSheet === 'function') {
            initializeStatSheet();
        }
        renderStatSheetTab();
        toastr.success('Stat sheet reset. Backup was downloaded before reset.');
    });
}

// ============================================================================
// STAT SHEET DATA MANAGEMENT
// ============================================================================

/**
 * Export the full stat sheet configuration as a JSON file.
 */
function exportStatSheetData() {
    try {
        const payload = {
            version:   '1.0',
            exportDate: new Date().toISOString(),
            statSheet:  JSON.parse(JSON.stringify(extensionSettings.statSheet || {}))
        };

        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download  = `stat-sheet-${ts}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toastr.success('Stat sheet exported successfully.');
    } catch (err) {
        console.error('[RPG Companion] Stat sheet export error:', err);
        toastr.error('Failed to export stat sheet. Check console for details.');
    }
}

/**
 * Import a stat sheet JSON file.
 * Validates structure then asks the user whether to merge or replace.
 */
function importStatSheetData() {
    const input   = document.createElement('input');
    input.type    = 'file';
    input.accept  = '.json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text    = await file.text();
            const data    = JSON.parse(text);

            if (!data.statSheet) {
                throw new Error('Invalid file: missing "statSheet" key. Make sure this is a stat sheet export, not a tracker preset.');
            }

            // Simple confirmation — full merge/replace UX can come later
            const replace = confirm(
                `Import stat sheet from "${file.name}"?\n\n` +
                `This will REPLACE your current stat sheet data (attributes, skills, saving throws, etc.).\n\n` +
                `Press OK to replace, or Cancel to abort.`
            );

            if (!replace) return;

            extensionSettings.statSheet = data.statSheet;
            saveSettings();
            renderStatSheetTab();
            toastr.success('Stat sheet imported successfully.');

        } catch (err) {
            console.error('[RPG Companion] Stat sheet import error:', err);
            toastr.error(`Failed to import: ${err.message}`);
        }
    };

    input.click();
}
