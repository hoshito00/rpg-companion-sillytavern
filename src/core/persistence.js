/**
 * Core Persistence Module
 * Handles saving/loading extension settings and chat data
 */

import { saveSettingsDebounced, chat_metadata, saveChatDebounced } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    setExtensionSettings,
    updateExtensionSettings,
    setLastGeneratedData,
    setCommittedTrackerData,
    FEATURE_FLAGS
} from './state.js';
import { migrateInventory } from '../utils/migration.js';
import { validateStoredInventory, cleanItemString } from '../utils/security.js';
import { migrateToV3JSON } from '../utils/jsonMigration.js';

const extensionName = 'third-party/rpg-companion-sillytavern';

/**
 * Validates extension settings structure
 * @param {Object} settings - Settings object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return false;
    }

    // Only validate fields that are actually present in global settings.json.
    // NOTE: userStats, classicStats, quests, infoBox, characterThoughts, and npcAvatars
    // are all listed in GLOBAL_SETTINGS_OMIT and are intentionally ABSENT from
    // settings.json. Do NOT require them here — their absence is correct, not corrupt.
    // They are loaded per-chat via loadChatData() / loadStatSheetData() instead.
    if (typeof settings.enabled !== 'boolean' ||
        typeof settings.autoUpdate !== 'boolean') {
        console.warn('[RPG Companion] Settings validation failed: missing required top-level properties');
        return false;
    }

    return true;
}

/**
 * Loads the extension settings from the global settings object.
 * Automatically migrates v1 inventory to v2 format if needed.
 */
export function loadSettings() {
    try {
        const context = getContext();
        const extension_settings = context.extension_settings || context.extensionSettings;

        // Validate extension_settings structure
        if (!extension_settings || typeof extension_settings !== 'object') {
            console.warn('[RPG Companion] extension_settings is not available, using default settings');
            return;
        }

        if (extension_settings[extensionName]) {
            const savedSettings = extension_settings[extensionName];

            // Validate loaded settings
            if (!validateSettings(savedSettings)) {
                console.warn('[RPG Companion] Loaded settings failed validation, using defaults');
                console.warn('[RPG Companion] Invalid settings:', savedSettings);
                // Save valid defaults to replace corrupt data
                saveSettings();
                return;
            }

            updateExtensionSettings(savedSettings);

            // Guard: userStats may have been stored as a JSON string in older saves.
            // Parse it back to an object so downstream code can safely access properties.
            if (typeof extensionSettings.userStats === 'string') {
                try {
                    extensionSettings.userStats = JSON.parse(extensionSettings.userStats);
                } catch (e) {
                    console.warn('[RPG Companion] Failed to parse userStats string, resetting to defaults');
                    extensionSettings.userStats = {
                        stats: [],
                        status: { mood: '😐', conditions: 'None' },
                        inventory: { onPerson: [], stored: [] },
                        quests: { active: [], completed: [] }
                    };
                }
            }

            // Perform settings migrations based on version
            const currentVersion = extensionSettings.settingsVersion || 1;
            let settingsChanged = false;

            // Migration to version 2: Enable dynamic weather for existing users
            if (currentVersion < 2) {
                // console.log('[RPG Companion] Migrating settings to version 2 (enabling dynamic weather)');
                extensionSettings.enableDynamicWeather = true;
                extensionSettings.settingsVersion = 2;
                settingsChanged = true;
            }

            // Migration to version 3: Convert text trackers to JSON format
            if (currentVersion < 3) {
                // console.log('[RPG Companion] Migrating settings to version 3 (JSON tracker format)');
                migrateToV3JSON();
                extensionSettings.settingsVersion = 3;
                settingsChanged = true;
            }

            // Migration to version 4: Enable FAB widgets by default
            if (currentVersion < 4) {
                // console.log('[RPG Companion] Migrating settings to version 4 (enabling FAB widgets)');
                if (!extensionSettings.mobileFabWidgets) {
                    extensionSettings.mobileFabWidgets = {};
                }
                extensionSettings.mobileFabWidgets.enabled = true;
                extensionSettings.mobileFabWidgets.weatherIcon = { enabled: true };
                extensionSettings.mobileFabWidgets.weatherDesc = { enabled: true };
                extensionSettings.mobileFabWidgets.clock = { enabled: true };
                extensionSettings.mobileFabWidgets.date = { enabled: true };
                extensionSettings.mobileFabWidgets.location = { enabled: true };
                extensionSettings.mobileFabWidgets.stats = { enabled: true };
                extensionSettings.mobileFabWidgets.attributes = { enabled: true };
                extensionSettings.settingsVersion = 4;
                settingsChanged = true;
            }

            // Migration to version 5: Add opacity properties for all colors
            if (currentVersion < 5) {
                // console.log('[RPG Companion] Migrating settings to version 5 (adding color opacity)');
                if (!extensionSettings.customColors) {
                    extensionSettings.customColors = {};
                }
                if (extensionSettings.customColors.bgOpacity === undefined) extensionSettings.customColors.bgOpacity = 100;
                if (extensionSettings.customColors.accentOpacity === undefined) extensionSettings.customColors.accentOpacity = 100;
                if (extensionSettings.customColors.textOpacity === undefined) extensionSettings.customColors.textOpacity = 100;
                if (extensionSettings.customColors.highlightOpacity === undefined) extensionSettings.customColors.highlightOpacity = 100;
                if (extensionSettings.statBarColorLowOpacity === undefined) extensionSettings.statBarColorLowOpacity = 100;
                if (extensionSettings.statBarColorHighOpacity === undefined) extensionSettings.statBarColorHighOpacity = 100;
                extensionSettings.settingsVersion = 5;
                settingsChanged = true;
            }

            // Save migrated settings
            if (settingsChanged) {
                saveSettings();
            }

            // console.log('[RPG Companion] Settings loaded:', extensionSettings);
        } else {
            // console.log('[RPG Companion] No saved settings found, using defaults');
        }

        // Migrate inventory if feature flag enabled
        if (FEATURE_FLAGS.useNewInventory) {
            const migrationResult = migrateInventory(extensionSettings.userStats.inventory);
            if (migrationResult.migrated) {
                // console.log(`[RPG Companion] Inventory migrated from ${migrationResult.source} to v2 format`);
                extensionSettings.userStats.inventory = migrationResult.inventory;
                saveSettings(); // Persist migrated inventory
            }
        }

        // Migrate to trackerConfig if it doesn't exist
        if (!extensionSettings.trackerConfig) {
            // console.log('[RPG Companion] Migrating to trackerConfig format');
            migrateToTrackerConfig();
            saveSettings(); // Persist migration
        }

        // Migrate to preset manager system if presets don't exist
        migrateToPresetManager();

        // Initialize custom status fields
        initializeCustomStatusFields();

        // Ensure all stats have maxValue (for number display mode)
        ensureStatsHaveMaxValue();
    } catch (error) {
        console.error('[RPG Companion] Error loading settings:', error);
        console.error('[RPG Companion] Error details:', error.message, error.stack);
        console.warn('[RPG Companion] Using default settings due to load error');
        // Settings will remain at defaults from state.js
    }

    // Validate inventory structure (Bug #3 fix)
    validateInventoryStructure(extensionSettings.userStats.inventory, 'settings');
}

/**
 * Saves the extension settings to the global settings object.
 */
/**
 * Fields on extensionSettings that are character/chat-specific and must NOT
 * be written to the global settings.json. Already persisted per-chat via
 * saveChatData() / saveStatSheetData().
 */
const GLOBAL_SETTINGS_OMIT = new Set([
    'userStats',        // live stat bar values
    'classicStats',     // D&D-style attribute values
    'quests',           // active/completed quest lists
    'infoBox',          // current date/weather/location values
    'characterThoughts',// current NPC thoughts snapshot
    'npcAvatars',       // base64 avatar images — the largest offender
]);

export function saveSettings() {
    const context = getContext();
    const extension_settings = context.extension_settings || context.extensionSettings;

    if (!extension_settings) {
        console.error('[RPG Companion] extension_settings is not available, cannot save');
        return;
    }

    // Build a shallow copy with per-chat fields stripped so they never
    // bloat settings.json. The in-memory extensionSettings is NOT mutated.
    const globalSnapshot = Object.assign({}, extensionSettings);
    for (const key of GLOBAL_SETTINGS_OMIT) {
        delete globalSnapshot[key];
    }

    // Strip character-specific fields from statSheet, keeping only global prefs
    // (enabled, mode, editorSettings, promptIncludes, modulesPool).
    if (globalSnapshot.statSheet) {
        const ssClean = {};
        for (const [k, v] of Object.entries(globalSnapshot.statSheet)) {
            if (!STAT_SHEET_CHAT_FIELDS.includes(k)) {
                ssClean[k] = v;
            }
        }
        globalSnapshot.statSheet = ssClean;
    }

    extension_settings[extensionName] = globalSnapshot;
    saveSettingsDebounced();
}

/**
 * Saves RPG data to the current chat's metadata.
 */
export function saveChatData() {
    if (!chat_metadata) {
        return;
    }

    const existingStatSheet = chat_metadata.rpg_companion?.statSheet;

    chat_metadata.rpg_companion = {
        userStats: extensionSettings.userStats,
        classicStats: extensionSettings.classicStats,
        quests: extensionSettings.quests,
        lastGeneratedData: lastGeneratedData,
        committedTrackerData: committedTrackerData,
        timestamp: Date.now()
    };

    if (existingStatSheet !== undefined) {
        chat_metadata.rpg_companion.statSheet = existingStatSheet;
    }

    saveChatDebounced();
}

// ============================================================================
// STAT SHEET PER-CHAT PERSISTENCE
// ============================================================================

/**
 * The character-specific fields of the stat sheet.
 * These are stored per-chat, NOT in global settings.
 */
const STAT_SHEET_CHAT_FIELDS = [
    'attributes',
    'savingThrows',
    'level',
    'jobs',
    'feats',
    'augments',
    'augmentSlots',      // Character-specific body-slot layout — MUST be per-chat
    'augmentTemplates',  // Character-specific saved augment templates — MUST be per-chat
    'combatSkills',
    'anatomicalDiagram',
    'maxEquippedPages',
    'maxEGOPerTier',
    'affinities',   // Phase 0.5 — per-character, not global
    'speedDice',    // Session 9 — optional speed dice config
    'spriteUrl',    // Session 9 — character sprite URL (stores 'idb:<key>' or plain URL)
    'gear',         // Session 14 — equipped gear items
    'gearSlots',    // Session 14 — configurable gear slot definitions
    'mode'          // BUG-07 — per-chat alphabetic/numeric mode (was leaking across chats)
];

/**
 * Saves stat sheet character data into the current chat's metadata.
 * Called whenever character data changes (addAttribute, removeSkill, etc.)
 */
export function saveStatSheetData() {
    if (!chat_metadata) return;
    if (!extensionSettings.statSheet) return;

    if (!chat_metadata.rpg_companion) {
        chat_metadata.rpg_companion = {};
    }

    const snapshot = {};
    for (const field of STAT_SHEET_CHAT_FIELDS) {
        if (extensionSettings.statSheet[field] !== undefined) {
            snapshot[field] = extensionSettings.statSheet[field];
        }
    }

    chat_metadata.rpg_companion.statSheet = snapshot;
    saveChatDebounced();
}

/**
 * Loads stat sheet character data from the current chat's metadata.
 * Falls back to a clean default state for new/empty chats.
 * Global prefs (enabled, mode, editorSettings) are always preserved.
 */
export function loadStatSheetData() {
    if (!extensionSettings.statSheet) return;

    const saved = chat_metadata?.rpg_companion?.statSheet;

    if (saved) {
        // Restore only the per-chat fields — never touch global prefs
        for (const field of STAT_SHEET_CHAT_FIELDS) {
            if (saved[field] !== undefined) {
                extensionSettings.statSheet[field] = saved[field];
            }
        }
        console.log('[RPG Companion] Stat sheet data loaded from chat metadata');
    } else {
        // No chat metadata found. Only reset to defaults if in-memory state is
        // also empty — this protects against a toggle disable→re-enable cycle
        // where saveStatSheetData() hadn't yet committed data to chat_metadata.
        const hasLiveData = Array.isArray(extensionSettings.statSheet.attributes)
            && extensionSettings.statSheet.attributes.length > 0;

        if (hasLiveData) {
            console.log('[RPG Companion] No chat metadata for stat sheet but live data present — skipping reset');
            return;
        }

        // New chat — reset character data to clean defaults
        resetStatSheetCharacterData();
        console.log('[RPG Companion] No stat sheet data for this chat — reset to defaults');
    }
}

/**
 * Resets only the per-chat character data fields to clean defaults.
 * Preserves global prefs: enabled, mode, editorSettings.
 */
export function resetStatSheetCharacterData() {
    if (!extensionSettings.statSheet) return;

    // Current schema — matches what _migrate() expects so no migration needed on first load
    const defaultAttributes = [
        { id: 'str', name: 'STR', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
        { id: 'dex', name: 'DEX', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
        { id: 'con', name: 'CON', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
        { id: 'int', name: 'INT', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
        { id: 'wis', name: 'WIS', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] },
        { id: 'cha', name: 'CHA', value: 10, rank: 'C', rankValue: 10, threshold: 0, enabled: true, collapsed: false, skills: [] }
    ];

    extensionSettings.statSheet.attributes = defaultAttributes;

    // Current saving throw schema (terms[] not sources/flatModifier)
    extensionSettings.statSheet.savingThrows = [
        { id: 'fortitude', name: 'Fortitude', terms: [{ id: 'fort_con', type: 'attribute', attrId: 'con', multiplier: 1 }], enabled: true },
        { id: 'reflex',    name: 'Reflex',    terms: [{ id: 'ref_dex',  type: 'attribute', attrId: 'dex', multiplier: 1 }], enabled: true },
        { id: 'will',      name: 'Will',      terms: [{ id: 'will_wis', type: 'attribute', attrId: 'wis', multiplier: 1 }], enabled: true }
    ];
    extensionSettings.statSheet.level = {
        current: 1, autoCalculate: false, calculationMode: 'manual',
        exp: 0, expCurve: 'linear', expPerLevel: 1000,
        customCurve: [], showLevel: true, showExp: true
    };
    extensionSettings.statSheet.jobs             = [];
    extensionSettings.statSheet.feats            = [];
    extensionSettings.statSheet.augments         = [];
    extensionSettings.statSheet.combatSkills     = [];
    extensionSettings.statSheet.anatomicalDiagram = { enabled: true, highlightedParts: [] };
    extensionSettings.statSheet.maxEquippedPages  = 9;
    extensionSettings.statSheet.maxEGOPerTier     = 1;

    // Seed a fresh affinities block for this character (disabled by default)
    extensionSettings.statSheet.affinities = {
        enabled:     false,
        weakness:    { type: 'Slash', pool: 'damage' },
        modifiers:   { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } },
        assignments: { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } },
        slotAttrId:  ''
    };
    extensionSettings.statSheet.speedDice = { enabled: false, count: 1, sides: 6, modifier: 0 };
    extensionSettings.statSheet.spriteUrl = '';
    // Reset augment slot data so ensureAugmentSlots() rebuilds clean defaults for this character
    extensionSettings.statSheet.augmentSlots     = [];
    extensionSettings.statSheet.augmentTemplates = [];
}

/**
 * Export the full stat sheet as a JSON string for download.
 * Includes both global prefs and the current per-chat character data.
 *
 * @returns {string|null} JSON string, or null if no stat sheet.
 */
export function exportStatSheet() {
    const ss = extensionSettings.statSheet;
    if (!ss) return null;
    try {
        return JSON.stringify(ss, null, 2);
    } catch {
        return null;
    }
}

/**
 * Import a stat sheet from a JSON string.
 * Runs the migration guard so any old-schema data is upgraded on import.
 * Requires user confirmation before overwriting — that prompt lives in the UI layer.
 *
 * @param {string} jsonText  — raw file text from FileReader
 * @returns {boolean} true on success, false on parse/validation error
 */
export async function importStatSheet(jsonText) {
    try {
        const parsed = JSON.parse(jsonText);
        if (typeof parsed !== 'object' || parsed === null) return false;

        // Support both bare exports ({ mode, attributes, ... })
        // and wrapped exports ({ version, exportDate, statSheet: { ... } })
        const data = (parsed.statSheet && typeof parsed.statSheet === 'object')
            ? parsed.statSheet
            : parsed;

        // Minimal sanity check — must have at least one recognisable stat sheet field
        const SS_KEYS = new Set(['attributes','mode','enabled','jobs','feats','combatSkills','savingThrows']);
        const looksLikeStatSheet = Object.keys(data).some(k => SS_KEYS.has(k));
        if (!looksLikeStatSheet) return false;

        if (!confirm('Replace current stat sheet data with the imported file?\n\nThis cannot be undone.')) {
            return false;
        }

        // Merge: preserve extensionSettings identity, overwrite statSheet fields.
        // Global prefs (enabled, mode, editorSettings, promptIncludes) come from the
        // LIVE settings — NOT from the imported file. Importing a template that was
        // exported with enabled:false or specific promptIncludes should never silently
        // override what the user has configured in this session.
        const IMPORT_GLOBAL_PREFS = ['enabled', 'mode', 'editorSettings', 'promptIncludes', 'modulesPool'];
        const preserved = {};
        for (const k of IMPORT_GLOBAL_PREFS) {
            if (extensionSettings.statSheet[k] !== undefined) {
                preserved[k] = extensionSettings.statSheet[k];
            }
        }
        Object.assign(extensionSettings.statSheet, data);
        // Restore global prefs so the import never clobbers them
        Object.assign(extensionSettings.statSheet, preserved);
        // Run migration to handle any schema differences in the imported data
        const { initializeStatSheet } = await import('../systems/statSheet/statSheetState.js');
        initializeStatSheet(); // migrate schema gaps before saving
        saveSettings();
        saveStatSheetData();
        return true;
    } catch {
        return false;
    }
}

/**
 * This ensures user edits are preserved across swipes and included in generation context.
 */
export function updateMessageSwipeData() {
    const chat = getContext().chat;
    if (!chat || chat.length === 0) {
        return;
    }

    // Find the last assistant message
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message.is_user) {
            // Found last assistant message - update its swipe data
            if (!message.extra) {
                message.extra = {};
            }
            if (!message.extra.rpg_companion_swipes) {
                message.extra.rpg_companion_swipes = {};
            }

            const swipeId = message.swipe_id || 0;
            message.extra.rpg_companion_swipes[swipeId] = {
                userStats: lastGeneratedData.userStats,
                infoBox: lastGeneratedData.infoBox,
                characterThoughts: lastGeneratedData.characterThoughts
            };

            // console.log('[RPG Companion] Updated message swipe data after user edit');
            break;
        }
    }
}

/**
 * Loads RPG data from the current chat's metadata.
 * Automatically migrates v1 inventory to v2 format if needed.
 */
export function loadChatData() {
    if (!chat_metadata || !chat_metadata.rpg_companion) {
        // Reset to defaults if no data exists
        updateExtensionSettings({
            userStats: {
                health: 100,
                satiety: 100,
                energy: 100,
                hygiene: 100,
                arousal: 0,
                mood: '😐',
                conditions: 'None',
                // Use v2 inventory format for defaults
                inventory: {
                    version: 2,
                    onPerson: "None",
                    stored: {},
                    assets: "None"
                }
            },
            quests: {
                main: "None",
                optional: []
            }
        });
        setLastGeneratedData({
            userStats: null,
            infoBox: null,
            characterThoughts: null,
            html: null
        });
        setCommittedTrackerData({
            userStats: null,
            infoBox: null,
            characterThoughts: null
        });
        return;
    }

    const savedData = chat_metadata.rpg_companion;

    // Restore stats
    if (savedData.userStats) {
        extensionSettings.userStats = { ...savedData.userStats };
    }

    // Restore classic stats
    if (savedData.classicStats) {
        extensionSettings.classicStats = { ...savedData.classicStats };
    }

    // Restore quests
    if (savedData.quests) {
        extensionSettings.quests = { ...savedData.quests };
    } else {
        // Initialize with defaults if not present
        extensionSettings.quests = {
            main: "None",
            optional: []
        };
    }

    // Restore committed tracker data first
    if (savedData.committedTrackerData) {
        // console.log('[RPG Companion] 📥 loadChatData restoring committedTrackerData:', {
        //     userStats: savedData.committedTrackerData.userStats ? `${savedData.committedTrackerData.userStats.substring(0, 50)}...` : 'null',
        //     infoBox: savedData.committedTrackerData.infoBox ? 'exists' : 'null',
        //     characterThoughts: savedData.committedTrackerData.characterThoughts ? 'exists' : 'null'
        // });
        // console.log('[RPG Companion] 📥 RAW savedData.committedTrackerData:', savedData.committedTrackerData);
        // console.log('[RPG Companion] 📥 Type check:', {
        //     userStatsType: typeof savedData.committedTrackerData.userStats,
        //     infoBoxType: typeof savedData.committedTrackerData.infoBox,
        //     characterThoughtsType: typeof savedData.committedTrackerData.characterThoughts
        // });
        setCommittedTrackerData({ ...savedData.committedTrackerData });
    }

    // Restore last generated data (for display)
    // Always prefer lastGeneratedData as it contains the most recent generation (including swipes)
    if (savedData.lastGeneratedData) {
        // console.log('[RPG Companion] 📥 loadChatData restoring lastGeneratedData');
        setLastGeneratedData({ ...savedData.lastGeneratedData });
    } else {
        // console.log('[RPG Companion] ⚠️ No lastGeneratedData found in save');
    }

    // Migrate inventory in chat data if feature flag enabled
    if (FEATURE_FLAGS.useNewInventory && extensionSettings.userStats.inventory) {
        const migrationResult = migrateInventory(extensionSettings.userStats.inventory);
        if (migrationResult.migrated) {
            // console.log(`[RPG Companion] Chat inventory migrated from ${migrationResult.source} to v2 format`);
            extensionSettings.userStats.inventory = migrationResult.inventory;
            saveChatData(); // Persist migrated inventory to chat metadata
        }
    }

    // Validate inventory structure (Bug #3 fix)
    validateInventoryStructure(extensionSettings.userStats.inventory, 'chat');

    // console.log('[RPG Companion] Loaded chat data:', savedData);
}

/**
 * Validates and repairs inventory structure to prevent corruption.
 * Ensures all v2 fields exist and are the correct type.
 * Fixes Bug #3: Location disappears when switching tabs
 *
 * @param {Object} inventory - Inventory object to validate
 * @param {string} source - Source of load ('settings' or 'chat') for logging
 * @private
 */
function validateInventoryStructure(inventory, source) {
    if (!inventory || typeof inventory !== 'object') {
        console.error(`[RPG Companion] Invalid inventory from ${source}, resetting to defaults`);
        extensionSettings.userStats.inventory = {
            version: 2,
            onPerson: "None",
            stored: {},
            assets: "None"
        };
        saveSettings();
        return;
    }

    let needsSave = false;

    // Ensure v2 structure
    if (inventory.version !== 2) {
        console.warn(`[RPG Companion] Inventory from ${source} missing version, setting to 2`);
        inventory.version = 2;
        needsSave = true;
    }

    // Validate onPerson field
    if (typeof inventory.onPerson !== 'string') {
        console.warn(`[RPG Companion] Invalid onPerson from ${source}, resetting to "None"`);
        inventory.onPerson = "None";
        needsSave = true;
    } else {
        // Clean items in onPerson (removes corrupted/dangerous items)
        const cleanedOnPerson = cleanItemString(inventory.onPerson);
        if (cleanedOnPerson !== inventory.onPerson) {
            console.warn(`[RPG Companion] Cleaned corrupted items from onPerson inventory (${source})`);
            inventory.onPerson = cleanedOnPerson;
            needsSave = true;
        }
    }

    // Validate stored field (CRITICAL for Bug #3)
    if (!inventory.stored || typeof inventory.stored !== 'object' || Array.isArray(inventory.stored)) {
        console.error(`[RPG Companion] Corrupted stored inventory from ${source}, resetting to empty object`);
        inventory.stored = {};
        needsSave = true;
    } else {
        // Validate stored object keys/values
        const cleanedStored = validateStoredInventory(inventory.stored);
        if (JSON.stringify(cleanedStored) !== JSON.stringify(inventory.stored)) {
            console.warn(`[RPG Companion] Cleaned dangerous/invalid stored locations from ${source}`);
            inventory.stored = cleanedStored;
            needsSave = true;
        }
    }

    // Validate assets field
    if (typeof inventory.assets !== 'string') {
        console.warn(`[RPG Companion] Invalid assets from ${source}, resetting to "None"`);
        inventory.assets = "None";
        needsSave = true;
    } else {
        // Clean items in assets (removes corrupted/dangerous items)
        const cleanedAssets = cleanItemString(inventory.assets);
        if (cleanedAssets !== inventory.assets) {
            console.warn(`[RPG Companion] Cleaned corrupted items from assets inventory (${source})`);
            inventory.assets = cleanedAssets;
            needsSave = true;
        }
    }

    // Persist repairs if needed
    if (needsSave) {
        // console.log(`[RPG Companion] Repaired inventory structure from ${source}, saving...`);
        saveSettings();
        if (source === 'chat') {
            saveChatData();
        }
    }
}

/**
 * Migrates old settings format to new trackerConfig format
 * Converts statNames to customStats array and sets up default config
 */
function migrateToTrackerConfig() {
    // Initialize trackerConfig if it doesn't exist
    if (!extensionSettings.trackerConfig) {
        extensionSettings.trackerConfig = {
            userStats: {
                customStats: [],
                showRPGAttributes: true,
                rpgAttributes: [
                    { id: 'str', name: 'STR', enabled: true },
                    { id: 'dex', name: 'DEX', enabled: true },
                    { id: 'con', name: 'CON', enabled: true },
                    { id: 'int', name: 'INT', enabled: true },
                    { id: 'wis', name: 'WIS', enabled: true },
                    { id: 'cha', name: 'CHA', enabled: true }
                ],
                statusSection: {
                    enabled: true,
                    showMoodEmoji: true,
                    customFields: ['Conditions']
                },
                skillsSection: {
                    enabled: false,
                    label: 'Skills'
                }
            },
            infoBox: {
                widgets: {
                    date: { enabled: true, format: 'Weekday, Month, Year' },
                    weather: { enabled: true },
                    temperature: { enabled: true, unit: 'C' },
                    time: { enabled: true },
                    location: { enabled: true },
                    recentEvents: { enabled: true }
                }
            },
            presentCharacters: {
                showEmoji: true,
                showName: true,
                customFields: [
                    { id: 'physicalState', label: 'Physical State', enabled: true, placeholder: 'Visible Physical State (up to three traits)' },
                    { id: 'demeanor', label: 'Demeanor Cue', enabled: true, placeholder: 'Observable Demeanor Cue (one trait)' },
                    { id: 'relationship', label: 'Relationship', enabled: true, type: 'relationship', placeholder: 'Enemy/Neutral/Friend/Lover' },
                    { id: 'internalMonologue', label: 'Internal Monologue', enabled: true, placeholder: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)' }
                ],
                characterStats: {
                    enabled: false,
                    stats: []
                }
            }
        };
    }

    // Migrate old statNames to customStats if statNames exists
    if (extensionSettings.statNames && extensionSettings.trackerConfig.userStats.customStats.length === 0) {
        const statOrder = ['health', 'satiety', 'energy', 'hygiene', 'arousal'];
        extensionSettings.trackerConfig.userStats.customStats = statOrder.map(id => ({
            id: id,
            name: extensionSettings.statNames[id] || id.charAt(0).toUpperCase() + id.slice(1),
            enabled: true
        }));
        // console.log('[RPG Companion] Migrated statNames to customStats array');
    }

    // Ensure all stats have corresponding values in userStats
    if (extensionSettings.userStats) {
        for (const stat of extensionSettings.trackerConfig.userStats.customStats) {
            if (extensionSettings.userStats[stat.id] === undefined) {
                extensionSettings.userStats[stat.id] = stat.id === 'arousal' ? 0 : 100;
            }
        }
    }

    // Migrate old showRPGAttributes boolean to rpgAttributes array
    if (extensionSettings.trackerConfig.userStats.showRPGAttributes !== undefined) {
        const shouldShow = extensionSettings.trackerConfig.userStats.showRPGAttributes;
        extensionSettings.trackerConfig.userStats.rpgAttributes = [
            { id: 'str', name: 'STR', enabled: shouldShow },
            { id: 'dex', name: 'DEX', enabled: shouldShow },
            { id: 'con', name: 'CON', enabled: shouldShow },
            { id: 'int', name: 'INT', enabled: shouldShow },
            { id: 'wis', name: 'WIS', enabled: shouldShow },
            { id: 'cha', name: 'CHA', enabled: shouldShow }
        ];
        delete extensionSettings.trackerConfig.userStats.showRPGAttributes;
        // console.log('[RPG Companion] Migrated showRPGAttributes to rpgAttributes array');
    }

    // Ensure rpgAttributes exists even if no migration was needed
    if (!extensionSettings.trackerConfig.userStats.rpgAttributes) {
        extensionSettings.trackerConfig.userStats.rpgAttributes = [
            { id: 'str', name: 'STR', enabled: true },
            { id: 'dex', name: 'DEX', enabled: true },
            { id: 'con', name: 'CON', enabled: true },
            { id: 'int', name: 'INT', enabled: true },
            { id: 'wis', name: 'WIS', enabled: true },
            { id: 'cha', name: 'CHA', enabled: true }
        ];
    }

    // Ensure showRPGAttributes exists (defaults to true)
    if (extensionSettings.trackerConfig.userStats.showRPGAttributes === undefined) {
        extensionSettings.trackerConfig.userStats.showRPGAttributes = true;
    }

    // Ensure all rpgAttributes have corresponding values in classicStats
    if (extensionSettings.classicStats) {
        for (const attr of extensionSettings.trackerConfig.userStats.rpgAttributes) {
            if (extensionSettings.classicStats[attr.id] === undefined) {
                extensionSettings.classicStats[attr.id] = 10;
            }
        }
    }

    // Migrate old presentCharacters structure to new format
    if (extensionSettings.trackerConfig.presentCharacters) {
        const pc = extensionSettings.trackerConfig.presentCharacters;

        // Check if using old flat customFields structure (has 'label' or 'placeholder' keys)
        if (pc.customFields && pc.customFields.length > 0) {
            const hasOldFormat = pc.customFields.some(f => f.label || f.placeholder || f.type === 'relationship');

            if (hasOldFormat) {
                // console.log('[RPG Companion] Migrating Present Characters to new structure');

                // Extract relationship fields from old customFields
                const relationshipFields = ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'];

                // Extract non-relationship fields and convert to new format
                const newCustomFields = pc.customFields
                    .filter(f => f.type !== 'relationship' && f.id !== 'internalMonologue')
                    .map(f => ({
                        id: f.id,
                        name: f.label || f.name || 'Field',
                        enabled: f.enabled !== false,
                        description: f.placeholder || f.description || ''
                    }));

                // Extract thoughts config from old Internal Monologue field
                const thoughtsField = pc.customFields.find(f => f.id === 'internalMonologue');
                const thoughts = {
                    enabled: thoughtsField ? (thoughtsField.enabled !== false) : true,
                    name: 'Thoughts',
                    description: thoughtsField?.placeholder || 'Internal Monologue (in first person from character\'s POV, up to three sentences long)'
                };

                // Update to new structure
                pc.relationshipFields = relationshipFields;
                pc.customFields = newCustomFields;
                pc.thoughts = thoughts;

                // console.log('[RPG Companion] Present Characters migration complete');
                saveSettings(); // Persist the migration
            }
        }

        // Ensure new structure exists even if migration wasn't needed
        if (!pc.relationshipFields) {
            pc.relationshipFields = ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'];
        }
        if (!pc.relationshipEmojis) {
            // Create default emoji mapping from relationshipFields
            pc.relationshipEmojis = {
                'Lover': '❤️',
                'Friend': '⭐',
                'Ally': '🤝',
                'Enemy': '⚔️',
                'Neutral': '⚖️'
            };
        }

        // Migrate to new relationships structure if not already present
        if (!pc.relationships) {
            pc.relationships = {
                enabled: true, // Default to enabled for backward compatibility
                relationshipEmojis: pc.relationshipEmojis || {
                    'Lover': '❤️',
                    'Friend': '⭐',
                    'Ally': '🤝',
                    'Enemy': '⚔️',
                    'Neutral': '⚖️'
                }
            };
        }

        if (!pc.thoughts) {
            pc.thoughts = {
                enabled: true,
                name: 'Thoughts',
                description: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)'
            };
        }
    }
}

// ============================================================================
// Preset Management Functions
// ============================================================================

/**
 * Gets the entity key for the current character or group
 * @returns {string|null} Entity key in format "char_{id}" or "group_{id}", or null if no character selected
 */
export function getCurrentEntityKey() {
    const context = getContext();
    if (context.groupId) {
        return `group_${context.groupId}`;
    } else if (context.characterId !== undefined && context.characterId !== null) {
        return `char_${context.characterId}`;
    }
    return null;
}

/**
 * Gets the display name for the current character or group
 * @returns {string} Display name for the current entity
 */
export function getCurrentEntityName() {
    const context = getContext();
    if (context.groupId) {
        const group = context.groups?.find(g => g.id === context.groupId);
        return group?.name || 'Group Chat';
    } else if (context.characterId !== undefined && context.characterId !== null) {
        return context.name2 || 'Character';
    }
    return 'No Character';
}

/**
 * Migrates existing trackerConfig to the preset system if presetManager doesn't exist
 * Creates a "Default" preset from the current trackerConfig
 */
export function migrateToPresetManager() {
    if (!extensionSettings.presetManager || Object.keys(extensionSettings.presetManager.presets || {}).length === 0) {
        // console.log('[RPG Companion] Migrating to preset manager system');

        // Initialize presetManager if it doesn't exist
        if (!extensionSettings.presetManager) {
            extensionSettings.presetManager = {
                presets: {},
                characterAssociations: {},
                activePresetId: null,
                defaultPresetId: null
            };
        }

        // Create default preset from existing trackerConfig
        const defaultPresetId = 'preset_default';
        extensionSettings.presetManager.presets[defaultPresetId] = {
            id: defaultPresetId,
            name: 'Default',
            trackerConfig: JSON.parse(JSON.stringify(extensionSettings.trackerConfig))
        };
        extensionSettings.presetManager.activePresetId = defaultPresetId;
        extensionSettings.presetManager.defaultPresetId = defaultPresetId;

        // console.log('[RPG Companion] Created Default preset from existing trackerConfig');
        saveSettings();
    }
}

/**
 * Initializes custom status fields in userStats based on trackerConfig
 * Ensures all defined custom status fields have a value in the userStats object
 */
function initializeCustomStatusFields() {
    const customFields = extensionSettings.trackerConfig?.userStats?.statusSection?.customFields || [];

    // Initialize each custom field if it doesn't exist
    for (const fieldName of customFields) {
        const fieldKey = fieldName.toLowerCase();
        if (extensionSettings.userStats[fieldKey] === undefined) {
            extensionSettings.userStats[fieldKey] = 'None';
            // console.log(`[RPG Companion] Initialized custom status field: ${fieldKey}`);
        }
    }
}

/**
 * Ensures all custom stats have a maxValue property
 * This migration supports the number display mode feature
 */
function ensureStatsHaveMaxValue() {
    const customStats = extensionSettings.trackerConfig?.userStats?.customStats || [];

    for (const stat of customStats) {
        if (stat && stat.maxValue === undefined) {
            stat.maxValue = 100; // Default to 100 for backward compatibility
            // console.log(`[RPG Companion] Added maxValue to stat: ${stat.id || stat.name}`);
        }
    }

    // Ensure statsDisplayMode is set (default to percentage)
    if (extensionSettings.trackerConfig?.userStats &&
        extensionSettings.trackerConfig.userStats.statsDisplayMode === undefined) {
        extensionSettings.trackerConfig.userStats.statsDisplayMode = 'percentage';
        // console.log('[RPG Companion] Initialized statsDisplayMode to percentage');
    }
}

/**
 * Gets all available presets
 * @returns {Object} Map of preset ID to preset data
 */
export function getPresets() {
    return extensionSettings.presetManager?.presets || {};
}

/**
 * Gets a specific preset by ID
 * @param {string} presetId - The preset ID
 * @returns {Object|null} The preset object or null if not found
 */
export function getPreset(presetId) {
    return extensionSettings.presetManager?.presets?.[presetId] || null;
}

/**
 * Gets the currently active preset ID
 * @returns {string|null} The active preset ID or null
 */
export function getActivePresetId() {
    return extensionSettings.presetManager?.activePresetId || null;
}

/**
 * Gets the default preset ID
 * @returns {string|null} The default preset ID or null
 */
export function getDefaultPresetId() {
    return extensionSettings.presetManager?.defaultPresetId || null;
}

/**
 * Sets a preset as the default
 * @param {string} presetId - The preset ID to set as default
 */
export function setDefaultPreset(presetId) {
    if (extensionSettings.presetManager.presets[presetId]) {
        extensionSettings.presetManager.defaultPresetId = presetId;
        saveSettings();
        // console.log(`[RPG Companion] Set preset ${presetId} as default`);
    }
}

/**
 * Checks if the given preset is the default
 * @param {string} presetId - The preset ID to check
 * @returns {boolean} True if it's the default preset
 */
export function isDefaultPreset(presetId) {
    return extensionSettings.presetManager?.defaultPresetId === presetId;
}

/**
 * Creates a new preset from the current trackerConfig
 * @param {string} name - Name for the new preset
 * @returns {string} The ID of the newly created preset
 */
export function createPreset(name) {
    const presetId = `preset_${Date.now()}`;
    extensionSettings.presetManager.presets[presetId] = {
        id: presetId,
        name: name,
        trackerConfig: JSON.parse(JSON.stringify(extensionSettings.trackerConfig)),
        historyPersistence: extensionSettings.historyPersistence
            ? JSON.parse(JSON.stringify(extensionSettings.historyPersistence))
            : null
    };
    // Also set it as the active preset so edits go to the new preset
    extensionSettings.presetManager.activePresetId = presetId;
    saveSettings();
    // console.log(`[RPG Companion] Created preset "${name}" with ID ${presetId}`);
    return presetId;
}

/**
 * Saves the current trackerConfig and historyPersistence to the specified preset
 * @param {string} presetId - The preset ID to save to
 */
export function saveToPreset(presetId) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset) {
        preset.trackerConfig = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));
        preset.historyPersistence = extensionSettings.historyPersistence
            ? JSON.parse(JSON.stringify(extensionSettings.historyPersistence))
            : null;
        saveSettings();
        // console.log(`[RPG Companion] Saved current config to preset "${preset.name}"`);
    }
}

/**
 * Loads a preset's trackerConfig and historyPersistence as the active configuration
 * @param {string} presetId - The preset ID to load
 * @returns {boolean} True if loaded successfully, false otherwise
 */
export function loadPreset(presetId) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset && preset.trackerConfig) {
        extensionSettings.trackerConfig = JSON.parse(JSON.stringify(preset.trackerConfig));
        // Load historyPersistence if present, otherwise use defaults
        if (preset.historyPersistence) {
            extensionSettings.historyPersistence = JSON.parse(JSON.stringify(preset.historyPersistence));
        } else {
            // Default values for presets that don't have historyPersistence yet
            extensionSettings.historyPersistence = {
                enabled: false,
                messageCount: 5,
                injectionPosition: 'assistant_message_end',
                contextPreamble: ''
            };
        }
        extensionSettings.presetManager.activePresetId = presetId;
        saveSettings();
        // console.log(`[RPG Companion] Loaded preset "${preset.name}"`);
        return true;
    }
    return false;
}

/**
 * Renames a preset
 * @param {string} presetId - The preset ID to rename
 * @param {string} newName - The new name for the preset
 */
export function renamePreset(presetId, newName) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset) {
        preset.name = newName;
        saveSettings();
        // console.log(`[RPG Companion] Renamed preset to "${newName}"`);
    }
}

/**
 * Deletes a preset
 * @param {string} presetId - The preset ID to delete
 * @returns {boolean} True if deleted, false if it's the last preset (can't delete)
 */
export function deletePreset(presetId) {
    const presets = extensionSettings.presetManager.presets;
    const presetIds = Object.keys(presets);

    // Don't delete if it's the last preset
    if (presetIds.length <= 1) {
        // console.warn('[RPG Companion] Cannot delete the last preset');
        return false;
    }

    // Remove any character associations using this preset
    const associations = extensionSettings.presetManager.characterAssociations;
    for (const entityKey of Object.keys(associations)) {
        if (associations[entityKey] === presetId) {
            delete associations[entityKey];
        }
    }

    // Delete the preset
    delete presets[presetId];

    // If the deleted preset was active, switch to the first available preset
    if (extensionSettings.presetManager.activePresetId === presetId) {
        const remainingIds = Object.keys(presets);
        if (remainingIds.length > 0) {
            loadPreset(remainingIds[0]);
        }
    }

    saveSettings();
    // console.log(`[RPG Companion] Deleted preset ${presetId}`);
    return true;
}

/**
 * Associates the current preset with the current character/group
 */
export function associatePresetWithCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    const activePresetId = extensionSettings.presetManager.activePresetId;

    if (entityKey && activePresetId) {
        extensionSettings.presetManager.characterAssociations[entityKey] = activePresetId;
        saveSettings();
        // console.log(`[RPG Companion] Associated preset ${activePresetId} with ${entityKey}`);
    }
}

/**
 * Removes the preset association for the current character/group
 */
export function removePresetAssociationForCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    if (entityKey && extensionSettings.presetManager.characterAssociations[entityKey]) {
        delete extensionSettings.presetManager.characterAssociations[entityKey];
        saveSettings();
        // console.log(`[RPG Companion] Removed preset association for ${entityKey}`);
    }
}

/**
 * Gets the preset ID associated with the current character/group
 * @returns {string|null} The associated preset ID or null
 */
export function getPresetForCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    if (entityKey) {
        return extensionSettings.presetManager.characterAssociations[entityKey] || null;
    }
    return null;
}

/**
 * Checks if the current character/group has a preset association
 * @returns {boolean} True if there's an association
 */
export function hasPresetAssociation() {
    const entityKey = getCurrentEntityKey();
    return entityKey && extensionSettings.presetManager.characterAssociations[entityKey] !== undefined;
}

/**
 * Checks if the current character/group is associated with the currently active preset
 * @returns {boolean} True if the current entity is associated with the active preset
 */
export function isAssociatedWithCurrentPreset() {
    const entityKey = getCurrentEntityKey();
    const activePresetId = extensionSettings.presetManager?.activePresetId;
    if (!entityKey || !activePresetId) return false;
    return extensionSettings.presetManager.characterAssociations[entityKey] === activePresetId;
}

/**
 * Auto-switches to the preset associated with the current character/group
 * Called when character changes. Falls back to default preset if no association.
 * @returns {boolean} True if a preset was switched, false otherwise
 */
export function autoSwitchPresetForEntity() {
    const associatedPresetId = getPresetForCurrentEntity();

    // If there's a character-specific preset, use it
    if (associatedPresetId && associatedPresetId !== extensionSettings.presetManager.activePresetId) {
        // Check if the preset still exists
        if (extensionSettings.presetManager.presets[associatedPresetId]) {
            return loadPreset(associatedPresetId);
        } else {
            // Preset was deleted, remove the stale association
            removePresetAssociationForCurrentEntity();
        }
    }

    // No character association - fall back to default preset if set
    if (!associatedPresetId) {
        const defaultPresetId = extensionSettings.presetManager.defaultPresetId;
        if (defaultPresetId &&
            defaultPresetId !== extensionSettings.presetManager.activePresetId &&
            extensionSettings.presetManager.presets[defaultPresetId]) {
            return loadPreset(defaultPresetId);
        }
    }

    return false;
}

/**
 * Exports presets for sharing (without character associations)
 * @param {string[]} presetIds - Array of preset IDs to export, or empty for all
 * @returns {Object} Export data object
 */
export function exportPresets(presetIds = []) {
    const presetsToExport = {};
    const allPresets = extensionSettings.presetManager.presets;

    // If no specific IDs provided, export all
    const idsToExport = presetIds.length > 0 ? presetIds : Object.keys(allPresets);

    for (const id of idsToExport) {
        if (allPresets[id]) {
            presetsToExport[id] = {
                id: allPresets[id].id,
                name: allPresets[id].name,
                trackerConfig: allPresets[id].trackerConfig
            };
        }
    }

    return {
        version: '1.0',
        exportDate: new Date().toISOString(),
        presets: presetsToExport
        // Note: characterAssociations are intentionally NOT exported
    };
}

/**
 * Imports presets from an export file
 * @param {Object} importData - The imported data object
 * @param {boolean} overwrite - If true, overwrites existing presets with same name
 * @returns {number} Number of presets imported
 */
export function importPresets(importData, overwrite = false) {
    if (!importData.presets || typeof importData.presets !== 'object') {
        throw new Error('Invalid import data: missing presets');
    }

    let importCount = 0;
    const existingNames = new Set(
        Object.values(extensionSettings.presetManager.presets).map(p => p.name.toLowerCase())
    );

    for (const [originalId, preset] of Object.entries(importData.presets)) {
        if (!preset.name || !preset.trackerConfig) {
            continue; // Skip invalid presets
        }

        let name = preset.name;
        const nameLower = name.toLowerCase();

        // Check for name collision
        if (existingNames.has(nameLower)) {
            if (overwrite) {
                // Find and delete the existing preset with this name
                for (const [existingId, existingPreset] of Object.entries(extensionSettings.presetManager.presets)) {
                    if (existingPreset.name.toLowerCase() === nameLower) {
                        delete extensionSettings.presetManager.presets[existingId];
                        break;
                    }
                }
            } else {
                // Generate a unique name
                let counter = 1;
                while (existingNames.has(`${nameLower} (${counter})`)) {
                    counter++;
                }
                name = `${preset.name} (${counter})`;
            }
        }

        // Create new preset with new ID
        const newId = `preset_${Date.now()}_${importCount}`;
        extensionSettings.presetManager.presets[newId] = {
            id: newId,
            name: name,
            trackerConfig: JSON.parse(JSON.stringify(preset.trackerConfig))
        };
        existingNames.add(name.toLowerCase());
        importCount++;
    }

    if (importCount > 0) {
        saveSettings();
    }

    return importCount;
}
