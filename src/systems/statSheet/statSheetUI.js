/**
 * Stat Sheet UI Module - COMPLETE FIX
 * Fixes: Auto-opening bug AND modal won't close bug
 *
 * Cross-browser patch (Session 23):
 *   - Removed jQuery fadeOut/fadeIn wrapping from renderCurrentTab().
 *     The async callback chain (fadeOut → render → fadeIn) caused queued
 *     animation stutter in Chrome/Edge when called rapidly (e.g. on every
 *     CHAT_CHANGED event). Firefox defers layout differently and masked this.
 *     Tab content is now replaced synchronously; the modal-open fade is kept.
 *   - Added _lastRenderedTab guard in switchTab() to skip re-rendering a tab
 *     that is already displayed. refreshCurrentTab() bypasses the guard so
 *     data-change refreshes still work correctly.
 */

import { extensionSettings } from '../../core/state.js';
import { saveStatSheetData }      from '../../core/persistence.js';
import { renderAttributesTab }    from './attributesTab.js';
import { renderJobsFeatsTab }     from './jobsFeatsTab.js';
import { renderAugmentsTab }      from './augmentsTab.js';
import { renderGearTab }          from './gearTab.js';
import { renderCombatSkillsTab }  from './combatSkillsTab.js';
import { renderSummaryTab }       from './summaryTab.js';
import { renderCultivationTab }   from './cultivationTab.js';

// Current active tab
let currentTab = 'summary';

// Modal state
let isModalOpen = false;

// CHANGED: Tracks which tab is currently rendered so switchTab() can skip
// redundant work when the user clicks the already-active tab.
// Set to null to force a re-render on next renderCurrentTab() call.
let _lastRenderedTab = null;

/**
 * Initialize stat sheet UI
 * Sets up event listeners and prepares modal
 */
export function initializeStatSheetUI() {
    console.log('[Stat Sheet] Initializing UI...');
    createModalHTML();
    attachEventListeners();
    console.log('[Stat Sheet] UI initialized successfully');
}

/**
 * Create modal HTML structure
 */
function createModalHTML() {
    const modalHTML = `
        <div id="stat-sheet-modal" class="stat-sheet-modal" style="display: none;">
            <div class="stat-sheet-overlay"></div>
            <div class="stat-sheet-content">
                <!-- Modal Header -->
                <div class="stat-sheet-header">
                    <h2>
                        <span class="stat-sheet-icon">📊</span>
                        Character Stats
                    </h2>
                    <button id="stat-sheet-close" class="stat-sheet-close-btn" title="Close">
                        ✕
                    </button>
                </div>
                
                <!-- Tab Navigation -->
                <div class="stat-sheet-tabs">
                    <button class="stat-sheet-tab active" data-tab="summary">
                        Summary
                    </button>
                    <button class="stat-sheet-tab" data-tab="attributes">
                        Attributes
                    </button>
                    <button class="stat-sheet-tab" data-tab="jobsFeats">
                        Jobs &amp; Feats
                    </button>
                    <button class="stat-sheet-tab" data-tab="gear">
                        Gear
                    </button>
                    <button class="stat-sheet-tab" data-tab="augments">
                        Augments
                    </button>
                    <button class="stat-sheet-tab" data-tab="cultivation" id="stat-sheet-tab-cultivation" style="display:none;">
                        Cultivation
                    </button>
                    <button class="stat-sheet-tab" data-tab="combatSkills">
                        Combat Skills
                    </button>
                </div>
                
                <!-- Tab Content Area -->
                <div id="stat-sheet-tab-content" class="stat-sheet-tab-content">
                    <!-- Tab content will be rendered here -->
                </div>
            </div>
        </div>
    `;
    
    // Append to body if not already present
    if (!document.getElementById('stat-sheet-modal')) {
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        console.log('[Stat Sheet] Modal HTML created');
    }
}

/**
 * Attach event listeners - FIXED version
 */
function attachEventListeners() {
    // Close button - using proper event delegation
    $(document).on('click', '#stat-sheet-close', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Stat Sheet] Close button clicked');
        closeModal();
    });
    
    // Overlay click (close modal) - FIXED
    $(document).on('click', '.stat-sheet-overlay', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Stat Sheet] Overlay clicked');
        closeModal();
    });
    
    // Prevent clicks inside modal content from closing modal
    $(document).on('click', '.stat-sheet-content', function(e) {
        e.stopPropagation();
    });
    
    // Tab switching
    $(document).on('click', '.stat-sheet-tab', handleTabClick);
    
    // Escape key to close - FIXED
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && isModalOpen) {
            console.log('[Stat Sheet] Escape key pressed');
            closeModal();
        }
    });

    // Prompt-include toggles — one listener, all tabs
    $(document).on('click', '.btn-prompt-include', function(e) {
        e.stopPropagation();
        const key = $(this).data('pi-key');
        const ss  = extensionSettings.statSheet;
        if (!ss?.promptIncludes || key == null) return;
        ss.promptIncludes[key] = (ss.promptIncludes[key] !== false) ? false : true;
        saveStatSheetData();
        refreshCurrentTab();
    });
    
    console.log('[Stat Sheet] Event listeners attached');
}

/**
 * Open stat sheet modal
 */
/**
 * Show or hide the Cultivation tab button based on xianxiaMode setting.
 * Called on modal open and whenever the setting changes in the tracker editor.
 */
export function syncCultivationTabVisibility() {
    const xianxia = extensionSettings.statSheet?.xianxiaMode === true;
    const $btn = $('#stat-sheet-tab-cultivation');
    $btn.toggle(xianxia);
    // If cultivation tab is active but mode just turned off, fall back to summary
    if (!xianxia && currentTab === 'cultivation') {
        switchTab('summary');
    }
}

export function openModal() {
    console.log('[Stat Sheet] openModal called');
    console.log('[Stat Sheet] extensionSettings.statSheet:', extensionSettings.statSheet);
    console.log('[Stat Sheet] enabled:', extensionSettings.statSheet?.enabled);
    
    if (!extensionSettings.statSheet?.enabled) {
        console.warn('[Stat Sheet] Stat sheet is not enabled');
        return;
    }
    
    const modal = $('#stat-sheet-modal');
    console.log('[Stat Sheet] Modal element found:', modal.length > 0);
    
    if (modal.length === 0) {
        console.error('[Stat Sheet] Modal element not found!');
        return;
    }
    
    // Show modal
    modal.fadeIn(200);
    isModalOpen = true;
    
    // Sync cultivation tab visibility before rendering
    syncCultivationTabVisibility();
    console.log('[Stat Sheet] Calling renderCurrentTab...');
    renderCurrentTab();
    
    // Focus management for accessibility
    modal.find('.stat-sheet-close-btn').focus();
}

/**
 * Close stat sheet modal - FIXED version
 */
export function closeModal() {
    console.log('[Stat Sheet] closeModal called');
    const modal = $('#stat-sheet-modal');
    
    if (modal.length === 0) {
        console.warn('[Stat Sheet] Modal not found when trying to close');
        return;
    }
    
    modal.fadeOut(200, function() {
        isModalOpen = false;
        // CHANGED: Clear the render cache on close so the next open always
        // gets a fresh render with current data, regardless of what tab was
        // last shown.
        _lastRenderedTab = null;
        console.log('[Stat Sheet] Modal closed successfully');
    });
}

/**
 * Handle tab click
 * @param {Event} e - Click event
 */
function handleTabClick(e) {
    const tabName = $(e.currentTarget).data('tab');
    console.log('[Stat Sheet] Tab clicked:', tabName);
    switchTab(tabName);
}

/**
 * Switch to a specific tab
 * @param {string} tabName - Name of tab to switch to
 */
export function switchTab(tabName) {
    console.log('[Stat Sheet] Switching to tab:', tabName);
    
    // Update active tab button
    $('.stat-sheet-tab').removeClass('active');
    $(`.stat-sheet-tab[data-tab="${tabName}"]`).addClass('active');
    
    // Update current tab
    currentTab = tabName;

    // CHANGED: Skip re-render if this tab is already rendered.
    // Previously every click fired a full fadeOut→render→fadeIn cycle even
    // when nothing changed. Chrome/Edge queue jQuery animations more eagerly
    // than Firefox, causing visible stutter when the same tab was clicked
    // twice or when CHAT_CHANGED fired mid-animation.
    if (tabName === _lastRenderedTab) {
        console.log('[Stat Sheet] Tab already rendered, skipping re-render:', tabName);
        return;
    }
    
    // Render tab content
    renderCurrentTab();
}

/**
 * Render current tab content
 *
 * CHANGED: Removed the jQuery fadeOut/fadeIn wrapping.
 *
 * The original pattern was:
 *   contentContainer.fadeOut(100, () => { render(); contentContainer.fadeIn(100); })
 *
 * This caused two cross-browser problems:
 *
 *   1. STUTTER — If renderCurrentTab() was called while a previous fade was
 *      still running (e.g. rapid tab clicks, or CHAT_CHANGED firing during a
 *      render), jQuery silently queued a second animation. Chrome/Edge process
 *      the animation queue eagerly, causing a double-flash. Firefox's layout
 *      engine deferred repaints more aggressively and hid the problem.
 *
 *   2. STUCK CONTENT — If the render threw inside the fadeOut callback, the
 *      container stayed hidden (opacity 0) until the next successful render.
 *      The error handler called fadeIn() but by then the queue was in an
 *      inconsistent state in some browsers.
 *
 * Tab content is now replaced synchronously. The modal-open fade (fadeIn(200)
 * in openModal) is untouched — that one is fine since it runs exactly once
 * per open and has no render work inside its callback.
 */
function renderCurrentTab() {
    console.log('[Stat Sheet] renderCurrentTab - currentTab:', currentTab);
    
    const contentContainer = $('#stat-sheet-tab-content');
    console.log('[Stat Sheet] Content container found:', contentContainer.length > 0);
    
    if (contentContainer.length === 0) {
        console.error('[Stat Sheet] ERROR: Content container not found!');
        return;
    }

    try {
        console.log('[Stat Sheet] Rendering tab:', currentTab);
        
        // Render based on tab
        if (currentTab === 'attributes') {
            console.log('[Stat Sheet] Calling renderAttributesTab...');
            renderAttributesTab(contentContainer);
            console.log('[Stat Sheet] renderAttributesTab completed');
        } else if (currentTab === 'jobsFeats') {
            renderJobsFeatsTab(contentContainer);
        } else if (currentTab === 'gear') {
            renderGearTab(contentContainer);
        } else if (currentTab === 'combatSkills') {
            renderCombatSkillsTab(contentContainer);
        } else if (currentTab === 'augments') {
            renderAugmentsTab(contentContainer);
        } else if (currentTab === 'summary') {
            renderSummaryTab(contentContainer);
        } else if (currentTab === 'cultivation') {
            renderCultivationTab(contentContainer);
        } else {
            renderPlaceholderTab(currentTab);
        }

        // CHANGED: Record which tab is now displayed so switchTab() can
        // skip redundant renders on repeated clicks of the same tab.
        _lastRenderedTab = currentTab;

    } catch (error) {
        console.error('[Stat Sheet] ERROR rendering tab:', error);
        // CHANGED: Write error directly — no fadeIn needed since the container
        // is never hidden now. This also means the error message is always
        // visible immediately instead of potentially staying hidden.
        contentContainer.html(`
            <div class="error-message">
                <p>Error rendering tab: ${error.message}</p>
                <p>Check console for details</p>
            </div>
        `);
        // Don't cache the tab name on error — next call will retry the render.
        _lastRenderedTab = null;
    }
}

/**
 * Render placeholder for tabs not yet implemented
 * @param {string} tabName - Tab name
 */
function renderPlaceholderTab(tabName) {
    const contentContainer = $('#stat-sheet-tab-content');
    
    const placeholderHTML = `
        <div class="stat-sheet-placeholder">
            <div class="placeholder-icon">🚧</div>
            <h3>${capitalize(tabName)} Tab</h3>
            <p>This tab is coming in a future session!</p>
            <p class="placeholder-note">
                Current session: <strong>Session 1 - Foundation</strong><br>
                This tab will be implemented in later sessions.
            </p>
        </div>
    `;
    
    contentContainer.html(placeholderHTML);
}

/**
 * Refresh current tab (re-render).
 * Bypasses the _lastRenderedTab guard so data changes (e.g. prompt-include
 * toggles, CHAT_CHANGED) always produce a fresh render.
 */
export function refreshCurrentTab() {
    console.log('[Stat Sheet] Refreshing current tab');
    // CHANGED: Clear the cache before calling renderCurrentTab() so the
    // guard in switchTab() does not suppress this intentional re-render.
    _lastRenderedTab = null;
    renderCurrentTab();
}

/**
 * Utility: Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Show notification in modal
 * @param {string} message - Notification message
 * @param {string} type - 'success' | 'error' | 'info'
 */
export function showNotification(message, type = 'info') {
    const notification = $('<div></div>')
        .addClass(`stat-sheet-notification stat-sheet-notification-${type}`)
        .text(message);
    
    $('.stat-sheet-content').prepend(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.fadeOut(300, () => notification.remove());
    }, 3000);
}

/**
 * Show loading state
 */
export function showLoading() {
    const loadingHTML = `
        <div class="stat-sheet-loading">
            <div class="loading-spinner"></div>
            <p>Loading...</p>
        </div>
    `;
    
    $('#stat-sheet-tab-content').html(loadingHTML);
}

/**
 * Check if modal is currently open
 * @returns {boolean} Modal open state
 */
export function isOpen() {
    return isModalOpen;
}

/**
 * Refreshes the stat sheet UI only if the modal is currently open.
 * Called on CHAT_CHANGED so the user immediately sees the new character's data.
 */
export function refreshStatSheetIfOpen() {
    if (isModalOpen) {
        refreshCurrentTab();
    }
}

/**
 * Build the prompt-include toggle button for a tab header.
 * Renders as a small pill showing current on/off state.
 * The click is handled globally in attachEventListeners — no per-tab wiring needed.
 *
 * @param {string} key   — key in ss.promptIncludes ('attributes' | 'savingThrows' | 'jobsFeats' | 'combatSkills' | 'augments')
 * @param {string} label — short human label shown in the button, e.g. 'Attrs'
 * @returns {string} HTML string
 */
export function buildPromptIncludeToggle(key, label) {
    const ss = extensionSettings.statSheet;
    const on = ss?.promptIncludes?.[key] !== false;   // default: true (undefined → on)
    return `<button class="btn-prompt-include ${on ? 'pi-active' : 'pi-inactive'}"
                    data-pi-key="${key}"
                    title="${on
                        ? `${label} is sent to the AI — click to exclude`
                        : `${label} is excluded from the AI — click to include`}">
                🤖 ${label}: ${on ? 'On' : 'Off'}
            </button>`;
}
