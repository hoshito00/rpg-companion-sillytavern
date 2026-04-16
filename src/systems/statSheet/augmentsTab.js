/**
 * Augments Tab Module  (Session 5)
 */

import { extensionSettings } from '../../core/state.js';
import { generateUniqueId } from './statSheetState.js';
import { saveStatSheetData } from '../../core/persistence.js';
import { refreshCurrentTab, showNotification, buildPromptIncludeToggle } from './statSheetUI.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_AUGMENT_SLOTS = [
    { id: 'headLeft',   name: 'Left Eye',   side: 'left',   bodyZone: 'head',  capacity: 3, order: 0 },
    { id: 'headRight',  name: 'Right Eye',  side: 'right',  bodyZone: 'head',  capacity: 3, order: 0 },
    { id: 'armLeft',    name: 'Left Arm',   side: 'left',   bodyZone: 'armLeft',  capacity: 4, order: 1 },
    { id: 'armRight',   name: 'Right Arm',  side: 'right',  bodyZone: 'armRight', capacity: 4, order: 1 },
    { id: 'legLeft',    name: 'Left Leg',   side: 'left',   bodyZone: 'legLeft',  capacity: 4, order: 2 },
    { id: 'legRight',   name: 'Right Leg',  side: 'right',  bodyZone: 'legRight', capacity: 4, order: 2 },
    { id: 'internal',   name: 'Internal',   side: 'left',   bodyZone: 'torso', capacity: 6, order: 3 },
    { id: 'external',   name: 'External',   side: 'right',  bodyZone: 'torso', capacity: 6, order: 3 },
    { id: 'special',    name: 'Special',    side: 'left',   bodyZone: 'misc',  capacity: 4, order: 4 },
    { id: 'innate',     name: 'Innate',     side: 'right',  bodyZone: 'misc',  capacity: 4, order: 4 },
];

// Rarity tiers — fixed palette, user picks one per augment
export const RARITY_TIERS = [
    { id: 'common',     label: 'Common',     color: '#9e9e9e' },
    { id: 'uncommon',   label: 'Uncommon',   color: '#4caf7d' },
    { id: 'rare',       label: 'Rare',       color: '#4a9eff' },
    { id: 'premium',    label: 'Premium',    color: '#b06fff' },
    { id: 'masterclass',label: 'Masterclass',color: '#ff9c3a' },
    { id: 'legendary',  label: 'Legendary',  color: '#ff4f4f' },
];



// ── Module Pool — INT grants chart (Session 10) ───────────────────────────────
// Cumulative spare modules granted at each INT level (1-indexed; INT 0 = nothing).
// INT 10 grants no new modules but unlocks the Unique→Base skill designation (see modulesPool.uniqueSkillAsBaseId).
const INT_MODULE_GRANTS = [
    // [r1, r2, r3] cumulative
    [0, 0, 0],   // INT 0  (no grants)
    [2, 0, 0],   // INT 1  +2 R1
    [3, 0, 0],   // INT 2  +1 R1
    [4, 0, 0],   // INT 3  +1 R1
    [4, 1, 0],   // INT 4  +1 R2
    [4, 2, 0],   // INT 5  +1 R2
    [4, 3, 0],   // INT 6  +1 R2
    [4, 4, 0],   // INT 7  +1 R2
    [4, 4, 1],   // INT 8  +1 R3
    [4, 4, 2],   // INT 9  +1 R3
    [4, 4, 2],   // INT 10 — same modules; unlocks: designate one Unique Skill as Base (+2 R2, +2 R1 innate)
];

/** INT level at which the Unique→Base designation unlocks. */
const INT_UNIQUE_AS_BASE_THRESHOLD = 10;

/**
 * Compute the spare module grants from a given INT attribute value.
 * @param {number} intValue  Resolved numeric INT value.
 * @returns {{ r1: number, r2: number, r3: number, uniqueAsBase: boolean }}
 */
function _spareFromInt(intValue) {
    const clamped = Math.max(0, Math.min(10, Math.floor(intValue || 0)));
    const row = INT_MODULE_GRANTS[clamped];
    return { r1: row[0], r2: row[1], r3: row[2], uniqueAsBase: clamped >= INT_UNIQUE_AS_BASE_THRESHOLD };
}

/**
 * Count how many spare module slots (by rank) are consumed across all skills.
 * Spare = total filled tags - innate allowance.
 * Regular skills: 3×R1 + 1×R2 innate. Unique: 0. INT-10 designated: +2R1+2R2.
 * @param {object} ss
 * @returns {{ r1: number, r2: number, r3: number }}
 */
function _countAssignedSpares(ss) {
    const _DIE_TAG_KEYS_A   = ['onHit','onClashWin','onClashLose','onCrit','onCheck','onEvade'];
    const _SKILL_TAG_KEYS_A = ['onUse','afterUse','onKill','onStagger','eminence','exhaust','proactive','reactive'];

    // Count all filled tag slots per rank
    const filled = { r1: 0, r2: 0, r3: 0 };
    for (const skill of (ss.combatSkills || [])) {
        for (const die of (skill.dice || [])) {
            for (const key of _DIE_TAG_KEYS_A) {
                const tag = die[key];
                if (tag && typeof tag === 'object' && tag.text !== undefined) {
                    const r = Math.max(1, Math.min(3, tag.rank || 1));
                    filled[`r${r}`]++;
                }
            }
        }
        for (const key of _SKILL_TAG_KEYS_A) {
            const tag = skill[key];
            if (tag && typeof tag === 'object' && tag.text !== undefined) {
                const r = Math.max(1, Math.min(3, tag.rank || 1));
                filled[`r${r}`]++;
            }
        }
    }

    // Compute total innate allowance across all skills
    const designatedId = ss.modulesPool?.uniqueSkillAsBaseId || '';
    let innateR1 = 0, innateR2 = 0;
    for (const skill of (ss.combatSkills || [])) {
        const isUnique     = !!skill.isUnique;
        const isDesignated = skill.id === designatedId;
        if (!isUnique) { innateR1 += 3; innateR2 += 1; }
        if (isDesignated) { innateR1 += 2; innateR2 += 2; }
    }

    return {
        r1: Math.max(0, filled.r1 - innateR1),
        r2: Math.max(0, filled.r2 - innateR2),
        r3: filled.r3, // R3 has no innate allowance
    };
}

/**
 * Sum modulePoolBonus from all augments that are assigned to a valid slot.
 * Only installed augments (aug.slotId matches an existing augmentSlot) contribute.
 * @param {object} ss
 * @returns {{ r1: number, r2: number, r3: number }}
 */
function _sumAugmentPoolBonuses(ss) {
    const validSlotIds = new Set((ss.augmentSlots || []).map(s => s.id));
    const result = { r1: 0, r2: 0, r3: 0 };
    for (const aug of (ss.augments || [])) {
        if (!aug.slotId || !validSlotIds.has(aug.slotId)) continue;
        const mpb = aug.modulePoolBonus || {};
        result.r1 += mpb.r1 || 0;
        result.r2 += mpb.r2 || 0;
        result.r3 += mpb.r3 || 0;
    }
    return result;
}

/**
 * Resolve the numeric value of an attribute from the stat sheet.
 * Works for both numeric and alphabetic modes.
 */
function _resolveAttrValue(attrId, ss) {
    if (!attrId) return 0;
    const attr = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
    if (!attr) return 0;
    if (ss.mode === 'numeric') return attr.value ?? 0;
    const gvm     = ss.editorSettings?.gradeValueMap    || {};
    const divisor = ss.editorSettings?.attrValueDivisor || 100;
    return (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
}

/**
 * Render the Module Pool summary section for the top of the Augments tab.
 * @returns {string} HTML
 */
function _buildModulePoolHTML() {
    const ss      = extensionSettings.statSheet;
    const pool    = ss.modulesPool || {};
    const intId   = pool.intAttributeId || '';
    const manual  = pool.manualBonus   || { r1: 0, r2: 0, r3: 0 };
    const attrs   = (ss.attributes || []).filter(a => a.enabled);

    const intValue   = _resolveAttrValue(intId, ss);
    const fromInt    = _spareFromInt(intValue);
    const augBonus   = _sumAugmentPoolBonuses(ss);
    const total      = { r1: fromInt.r1 + (manual.r1||0) + augBonus.r1, r2: fromInt.r2 + (manual.r2||0) + augBonus.r2, r3: fromInt.r3 + (manual.r3||0) + augBonus.r3 };
    const used       = _countAssignedSpares(ss);
    const free       = { r1: total.r1 - used.r1, r2: total.r2 - used.r2, r3: total.r3 - used.r3 };

    const attrOpts = attrs.map(a =>
        `<option value="${escHtml(a.id)}" ${intId === a.id ? 'selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');

    // ── INT 10: Unique→Base designation ──────────────────────────────────────
    const uniqueSkills   = (ss.combatSkills || []).filter(s => s.isUnique && !s.isEGO);
    const designatedId   = pool.uniqueSkillAsBaseId || '';
    const uniqueSkillOpts = uniqueSkills.map(s =>
        `<option value="${escHtml(s.id)}" ${designatedId === s.id ? 'selected' : ''}>${escHtml(s.name || '(Unnamed)')}</option>`
    ).join('');

    const int10Section = fromInt.uniqueAsBase ? `
    <div class="mp-int10-row" style="margin-top:10px;padding:8px 10px;background:#2a1e3a;border:1px solid #7c4dff55;border-radius:6px;">
        <div style="font-size:.78rem;color:#b39ddb;font-weight:600;margin-bottom:6px;">
            🌟 INT 10 Unlock — Unique Skill Designation
        </div>
        <div style="font-size:.75rem;color:#8888aa;margin-bottom:8px;">
            Treat the chosen Unique Skill as a Base Skill, granting it an additional <strong style="color:#c49ae8">+2 R1 + 2 R2 Innate Modules</strong>.
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <label class="mp-label" style="min-width:120px;">Designated Skill</label>
            ${uniqueSkills.length
                ? `<select class="mp-unique-base-select" id="mp-unique-base-select" style="flex:1;">
                       <option value="">— None —</option>
                       ${uniqueSkillOpts}
                   </select>`
                : `<span style="font-size:.8rem;color:#c06060;">No Unique Skills defined yet.</span>`
            }
        </div>
    </div>` : '';

    function rankRow(label, color, rank, frInt, frManual, frAug, tot, us, fr) {
        const overCls = fr < 0 ? 'mp-over' : fr === 0 ? 'mp-depleted' : '';
        return `
        <tr class="${overCls}">
            <td><span class="mp-rank-badge" style="background:${color}22;border-color:${color};color:${color};">${label}</span></td>
            <td class="mp-num">${frInt}</td>
            <td class="mp-num">
                <input type="number" class="mp-manual-input rpg-input" min="0" max="99"
                    data-rank="${rank}" value="${frManual}"
                    style="width:44px;text-align:center;padding:2px 4px;">
            </td>
            <td class="mp-num">${frAug > 0 ? `<span style="color:#a0d4a0;">+${frAug}</span>` : frAug}</td>
            <td class="mp-num">${tot}</td>
            <td class="mp-num">${us}</td>
            <td class="mp-num mp-free" style="color:${fr < 0 ? '#ff4f4f' : fr === 0 ? '#6a6a8a' : '#e0e0f0'};">${fr}</td>
        </tr>`;
    }

    return `
    <div class="mp-section">
        <div class="mp-header">
            <span class="mp-title">🧩 Module Pool</span>
            <span class="mp-subtitle">Spare modules available to assign to Combat Skills</span>
        </div>
        <div class="mp-int-row">
            <label class="mp-label">Intellect Attribute</label>
            <select class="mp-int-select" id="mp-int-select">
                <option value="">— None —</option>
                ${attrOpts}
            </select>
            ${intId
                ? `<span class="mp-int-val" title="Current resolved value">${intValue} INT</span>`
                : ''}
        </div>
        <table class="mp-table">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>From INT</th>
                    <th>Manual</th>
                    <th>Aug</th>
                    <th>Total</th>
                    <th>Used</th>
                    <th>Free</th>
                </tr>
            </thead>
            <tbody>
                ${rankRow('R1', '#7eb8d4', 1, fromInt.r1, manual.r1||0, augBonus.r1, total.r1, used.r1, free.r1)}
                ${rankRow('R2', '#c49ae8', 2, fromInt.r2, manual.r2||0, augBonus.r2, total.r2, used.r2, free.r2)}
                ${rankRow('R3', '#f0ad4e', 3, fromInt.r3, manual.r3||0, augBonus.r3, total.r3, used.r3, free.r3)}
            </tbody>
        </table>
        ${int10Section}
        <div class="mp-hint">Assign spare modules to skills in the <strong>Combat Skills</strong> tab → Master Mode.</div>
    </div>`;
}

// Which SVG zone ids map to which body zone
const ZONE_MAP = {
    head:     ['headLeft', 'headRight'],
    armLeft:  ['armLeft'],
    armRight: ['armRight'],
    torso:    ['internal', 'external'],
    legLeft:  ['legLeft'],
    legRight: ['legRight'],
    misc:     ['special',  'innate'],
};

// ============================================================================
// MODULE STATE
// ============================================================================

let isMasterMode    = false;
let selectedSlotId  = null; // null = show all

// ============================================================================
// MIGRATION HELPER  (called from statSheetState._migrate via augmentsTab init)
// ============================================================================

export function ensureAugmentSlots() {
    const ss = extensionSettings.statSheet;
    if (!ss) return;
    let dirty = false;

    if (!Array.isArray(ss.augmentSlots) || ss.augmentSlots.length === 0) {
        ss.augmentSlots = DEFAULT_AUGMENT_SLOTS.map(s => ({ ...s }));
        dirty = true;
    }

    // Ensure every augment has new fields
    for (const aug of (ss.augments || [])) {
        if (!aug.rarityTier)        { aug.rarityTier        = 'common';  dirty = true; }
        if (!aug.shortDesc)         { aug.shortDesc         = '';        dirty = true; }
        if (!aug.longDesc)          { aug.longDesc          = '';        dirty = true; }
        if (!Array.isArray(aug.statBonuses))      { aug.statBonuses      = []; dirty = true; }
        if (!Array.isArray(aug.combatSkillLinks)) { aug.combatSkillLinks = []; dirty = true; }
        if (!aug.modulePoolBonus)   { aug.modulePoolBonus   = { r1: 0, r2: 0, r3: 0 }; dirty = true; }
    }

    // Ensure augmentTemplates array exists (Session 10)
    if (!Array.isArray(ss.augmentTemplates)) {
        ss.augmentTemplates = [];
        dirty = true;
    }

    if (dirty) saveStatSheetData();
}

// ============================================================================
// MAIN RENDER ENTRY POINT
// ============================================================================

export function renderAugmentsTab(container) {
    ensureAugmentSlots();
    const ss = extensionSettings.statSheet;
    if (!ss) { container.html('<div class="error-message">Stat sheet not initialized</div>'); return; }

    container.html(buildTabHTML());
    attachListeners();
}

// ============================================================================
// TAB HTML
// ============================================================================

function buildTabHTML() {
    const ss    = extensionSettings.statSheet;
    const slots = ss.augmentSlots || [];

    const leftSlots  = slots.filter(s => s.side === 'left').sort((a,b) => a.order - b.order);
    const rightSlots = slots.filter(s => s.side === 'right').sort((a,b) => a.order - b.order);

    return `
        <div class="aug-tab ${isMasterMode ? 'master-mode' : 'player-mode'}">

            <div class="aug-tab-header">
                <h3>Augments</h3>
                ${buildPromptIncludeToggle('augments', 'Augments')}
                <button type="button" id="btn-open-aug-pool" class="btn-toggle-mode" title="Browse built-in and saved augment templates">
                    📦 Pool
                </button>
                <button type="button" id="btn-toggle-aug-mode" class="btn-toggle-mode ${isMasterMode ? 'btn-exit-master' : ''}">
                    ${isMasterMode ? '▶ Player' : '⚙️ Master'}
                </button>
            </div>

            ${_buildModulePoolHTML()}

            <div class="aug-grid">

                <!-- LEFT COLUMN -->
                <div class="aug-col aug-col-left">
                    ${leftSlots.map(s => renderSlotPanel(s)).join('')}
                </div>

                <!-- CENTER: SVG BODY -->
                <div class="aug-col aug-col-center">
                    ${renderBodySVG(slots)}
                    <div class="aug-body-hint">Click a body zone to filter</div>
                    ${selectedSlotId
                        ? `<button type="button" class="aug-clear-filter">✕ Show All</button>`
                        : ''}
                </div>

                <!-- RIGHT COLUMN -->
                <div class="aug-col aug-col-right">
                    ${rightSlots.map(s => renderSlotPanel(s)).join('')}
                </div>

            </div>

            ${isMasterMode ? renderMasterSlotManager() : ''}
        </div>

        ${renderDetailPopupShell()}
    `;
}

// ============================================================================
// SVG BODY DIAGRAM
// ============================================================================

function renderBodySVG(slots) {
    // Determine which zones are active (have augments) and selected
    const ss = extensionSettings.statSheet;
    const augsBySlot = {};
    for (const aug of (ss.augments || [])) {
        if (!augsBySlot[aug.slotId]) augsBySlot[aug.slotId] = 0;
        augsBySlot[aug.slotId]++;
    }

    function zoneActive(zone) {
        return (ZONE_MAP[zone] || []).some(sid => (augsBySlot[sid] || 0) > 0);
    }
    function zoneSelected(zone) {
        if (!selectedSlotId) return false;
        const slot = slots.find(s => s.id === selectedSlotId);
        return slot?.bodyZone === zone;
    }

    function zoneClass(zone) {
        let cls = 'aug-svg-zone';
        if (zoneActive(zone))   cls += ' zone-active';
        if (zoneSelected(zone)) cls += ' zone-selected';
        return cls;
    }

    return `
        <svg class="aug-body-svg" viewBox="0 0 160 380" xmlns="http://www.w3.org/2000/svg">
            <!-- Body silhouette -->
            <g class="aug-silhouette">
                <!-- Head -->
                <ellipse cx="80" cy="38" rx="22" ry="26" />
                <!-- Neck -->
                <rect x="72" y="62" width="16" height="14" rx="4" />
                <!-- Torso -->
                <rect x="48" y="75" width="64" height="90" rx="8" />
                <!-- Left arm upper -->
                <rect x="22" y="78" width="22" height="55" rx="7" />
                <!-- Left arm lower -->
                <rect x="24" y="135" width="18" height="50" rx="6" />
                <!-- Left hand -->
                <ellipse cx="33" cy="193" rx="10" ry="8" />
                <!-- Right arm upper -->
                <rect x="116" y="78" width="22" height="55" rx="7" />
                <!-- Right arm lower -->
                <rect x="118" y="135" width="18" height="50" rx="6" />
                <!-- Right hand -->
                <ellipse cx="127" cy="193" rx="10" ry="8" />
                <!-- Pelvis -->
                <rect x="50" y="163" width="60" height="28" rx="6" />
                <!-- Left leg upper -->
                <rect x="50" y="190" width="26" height="70" rx="7" />
                <!-- Left leg lower -->
                <rect x="52" y="260" width="22" height="65" rx="6" />
                <!-- Left foot -->
                <ellipse cx="63" cy="332" rx="15" ry="8" />
                <!-- Right leg upper -->
                <rect x="84" y="190" width="26" height="70" rx="7" />
                <!-- Right leg lower -->
                <rect x="86" y="260" width="22" height="65" rx="6" />
                <!-- Right foot -->
                <ellipse cx="97" cy="332" rx="15" ry="8" />
            </g>

            <!-- Clickable zone overlays -->
            <ellipse class="${zoneClass('head')}" data-zone="head"
                cx="80" cy="38" rx="26" ry="30" />
            <rect class="${zoneClass('armLeft')}"  data-zone="armLeft"
                x="18" y="74" width="30" height="128" rx="8" />
            <rect class="${zoneClass('armRight')}" data-zone="armRight"
                x="112" y="74" width="30" height="128" rx="8" />
            <rect class="${zoneClass('torso')}" data-zone="torso"
                x="44" y="72" width="72" height="122" rx="10" />
            <rect class="${zoneClass('legLeft')}"  data-zone="legLeft"
                x="46" y="186" width="34" height="154" rx="8" />
            <rect class="${zoneClass('legRight')}" data-zone="legRight"
                x="80" y="186" width="34" height="154" rx="8" />
            <g class="${zoneClass('misc')}" data-zone="misc">
                <circle cx="80" cy="350" r="12" />
            </g>
        </svg>
    `;
}

// ============================================================================
// SLOT PANEL
// ============================================================================

function renderSlotPanel(slot) {
    const ss       = extensionSettings.statSheet;
    const augments = (ss.augments || [])
        .filter(a => a.slotId === slot.id && a.enabled !== false);
    const capacity = slot.capacity || 4;
    const isFull   = augments.length >= capacity;
    const isSelected = selectedSlotId === slot.id;

    const augRows = augments.map(a => renderAugmentCard(a, slot)).join('');

    const addBtn = isMasterMode && !isFull
        ? `<button type="button" class="aug-add-btn" data-slot-id="${slot.id}">+ Add</button>`
        : isMasterMode && isFull
        ? `<span class="aug-full-note">Slot full (${capacity})</span>`
        : '';

    return `
        <div class="aug-slot-panel ${isSelected ? 'slot-selected' : ''}" data-slot-id="${slot.id}">
            <div class="aug-slot-header">
                <span class="aug-slot-name">${escHtml(slot.name)}</span>
                <span class="aug-slot-count">${augments.length}/${capacity}</span>
            </div>
            <div class="aug-slot-list">
                ${augRows || `<div class="aug-empty">Empty</div>`}
            </div>
            ${addBtn}
        </div>
    `;
}

function renderAugmentCard(aug, slot) {
    const tier      = RARITY_TIERS.find(t => t.id === (aug.rarityTier || 'common')) || RARITY_TIERS[0];
    const nameStyle = `color: ${tier.color};`;

    if (isMasterMode) {
        return `
            <div class="aug-card aug-card-master" data-aug-id="${aug.id}">
                <div class="aug-card-row">
                    <span class="aug-card-name" style="${nameStyle}">${escHtml(aug.name)}</span>
                    <div class="aug-card-actions">
                        <button type="button" class="aug-btn-detail" data-aug-id="${aug.id}" title="Edit details">✏️</button>
                        <button type="button" class="aug-btn-remove" data-aug-id="${aug.id}" data-slot-id="${slot.id}" title="Remove">×</button>
                    </div>
                </div>
                ${aug.shortDesc ? `<div class="aug-short-desc">${escHtml(aug.shortDesc)}</div>` : ''}
            </div>
        `;
    }

    return `
        <div class="aug-card aug-card-player" data-aug-id="${aug.id}">
            <span class="aug-card-name" style="${nameStyle}">${escHtml(aug.name)}</span>
            ${aug.shortDesc ? `<div class="aug-short-desc">${escHtml(aug.shortDesc)}</div>` : ''}
            ${aug.longDesc
                ? `<button type="button" class="aug-btn-view-detail" data-aug-id="${aug.id}" title="View details">▸ Details</button>`
                : ''}
        </div>
    `;
}

// ============================================================================
// MASTER MODE SLOT MANAGER  (rename slots, adjust capacity)
// ============================================================================

function renderMasterSlotManager() {
    const ss    = extensionSettings.statSheet;
    const slots = ss.augmentSlots || [];

    const rows = slots.map(slot => `
        <div class="aug-slot-config-row">
            <input type="text" class="rpg-input aug-slot-name-input"
                   data-slot-id="${slot.id}"
                   value="${escHtml(slot.name)}"
                   placeholder="Slot name"
                   style="flex:1; min-width:80px;">
            <span class="rpg-threshold-label" style="white-space:nowrap;">Cap:</span>
            <input type="number" class="rpg-threshold-input aug-slot-cap-input"
                   data-slot-id="${slot.id}"
                   value="${slot.capacity || 4}"
                   min="1" max="20"
                   style="width:52px; text-align:center;">
        </div>
    `).join('');

    return `
        <div class="feat-tags-section aug-slot-manager">
            <span class="subskills-label">⚙ Slot Configuration
                <span style="font-weight:400;opacity:0.6;font-size:11px;">
                    (rename slots and set capacity)
                </span>
            </span>
            <div class="aug-slot-config-grid" style="margin-top:10px;">
                ${rows}
            </div>
        </div>
    `;
}

// ============================================================================
// DETAIL POPUP SHELL  (empty — filled dynamically)
// ============================================================================

function renderDetailPopupShell() {
    return `
        <div id="aug-detail-popup" class="aug-popup-overlay" style="display:none;">
            <div class="aug-popup-modal">
                <div class="aug-popup-header">
                    <span id="aug-popup-title" class="aug-popup-title-text"></span>
                    <button type="button" id="aug-popup-close" class="aug-popup-close-btn">×</button>
                </div>
                <div id="aug-popup-body" class="aug-popup-body"></div>
            </div>
        </div>
    `;
}

// ============================================================================
// DETAIL POPUP — CONTENT BUILDERS
// ============================================================================

function buildViewPopupContent(aug) {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss.attributes || []).filter(a => a.enabled);
    const bonusLines = (aug.statBonuses || []).map(sb => {
        const target = attrs.find(a => a.id === sb.targetId)?.name
            || (ss.savingThrows || []).find(s => s.id === sb.targetId)?.name
            || attrs.flatMap(a => a.skills || []).find(s => s.id === sb.targetId)?.name
            || sb.targetId;
        return `<li>${target} <strong>+${sb.value}</strong></li>`;
    }).join('');

    const linkLines = (aug.combatSkillLinks || []).map(lnk =>
        `<li>${escHtml(lnk.skillName || lnk.skillId)}${lnk.bonusValue ? ` +${lnk.bonusValue}` : ''}</li>`
    ).join('');

    return `
        ${aug.longDesc
            ? `<div class="aug-popup-longdesc">${escHtml(aug.longDesc).replace(/\n/g,'<br>')}</div>`
            : '<div class="aug-popup-longdesc" style="opacity:0.4;font-style:italic;">No details written.</div>'}
        ${bonusLines ? `<div class="aug-popup-section"><strong>Stat Bonuses</strong><ul>${bonusLines}</ul></div>` : ''}
        ${linkLines  ? `<div class="aug-popup-section"><strong>Combat Skill Links</strong><ul>${linkLines}</ul></div>` : ''}
    `;
}

function buildEditPopupContent(aug) {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss.attributes   || []).filter(a => a.enabled);
    const skills = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled).map(s => ({ ...s, attrName: a.name, attrId: a.id }))
    );
    const savs  = (ss.savingThrows || []).filter(s => s.enabled);

    const bonusesHTML = (aug.statBonuses || []).map(sb => renderAugStatBonusRow(sb, aug.id, attrs, skills, savs)).join('');
    const linksHTML   = (aug.combatSkillLinks || []).map((lnk, i) => renderCombatLinkRow(lnk, aug.id, i)).join('');

    // Module pool stub
    const mpb = aug.modulePoolBonus || { r1: 0, r2: 0, r3: 0 };

    return `
        <div class="aug-edit-grid">

            <label class="aug-edit-label">Name</label>
            <input type="text" class="rpg-input aug-edit-name" data-aug-id="${aug.id}"
                   value="${escHtml(aug.name)}" style="width:100%;">

            <label class="aug-edit-label">Rarity</label>
            <div class="aug-rarity-picker">
                ${RARITY_TIERS.map(t => `
                    <button type="button" class="aug-rarity-btn ${(aug.rarityTier||'common') === t.id ? 'aug-rarity-active' : ''}"
                            data-aug-id="${aug.id}" data-tier-id="${t.id}"
                            style="--tier-color:${t.color};"
                            title="${t.label}">
                        ${t.label}
                    </button>
                `).join('')}
            </div>

            <label class="aug-edit-label">Short Description</label>
            <input type="text" class="rpg-input aug-edit-shortdesc" data-aug-id="${aug.id}"
                   value="${escHtml(aug.shortDesc || '')}"
                   placeholder="One-line summary shown on the card"
                   style="width:100%;">

            <label class="aug-edit-label">Full Description</label>
            <textarea class="rpg-input aug-edit-longdesc" data-aug-id="${aug.id}"
                      placeholder="Detailed description, lore, mechanics…"
                      rows="6"
                      style="width:100%; resize:vertical;">${escHtml(aug.longDesc || '')}</textarea>

            <label class="aug-edit-label">Stat Bonuses</label>
            <div>
                <div class="aug-stat-bonuses-list" data-aug-id="${aug.id}">
                    ${bonusesHTML || '<div class="subskills-empty">No bonuses yet.</div>'}
                </div>
                <button type="button" class="aug-add-stat-bonus btn-add-flat-term" data-aug-id="${aug.id}"
                        style="margin-top:8px;">+ Add Bonus</button>
            </div>

            <label class="aug-edit-label">Combat Skill Links</label>
            <div>
                <div class="aug-combat-links-list" data-aug-id="${aug.id}">
                    ${linksHTML || '<div class="subskills-empty">No links yet.</div>'}
                </div>
                <button type="button" class="aug-add-combat-link btn-add-flat-term" data-aug-id="${aug.id}"
                        style="margin-top:8px;">+ Link Combat Skill</button>
            </div>

            <label class="aug-edit-label">Module Pool Bonus</label>
            <div style="display:flex;gap:10px;">
                <label>R1 <input type="number" class="rpg-input aug-mp-r1" data-aug-id="${aug.id}"
                    value="${mpb.r1}" min="0" style="width:60px;text-align:center;"></label>
                <label>R2 <input type="number" class="rpg-input aug-mp-r2" data-aug-id="${aug.id}"
                    value="${mpb.r2}" min="0" style="width:60px;text-align:center;"></label>
                <label>R3 <input type="number" class="rpg-input aug-mp-r3" data-aug-id="${aug.id}"
                    value="${mpb.r3}" min="0" style="width:60px;text-align:center;"></label>
            </div>

            <label class="aug-edit-label"></label>
            <div style="margin-top:4px;">
                <button type="button" class="aug-btn-save-template btn-add-flat-term" data-aug-id="${aug.id}"
                        title="Save this augment to your personal pool for reuse on other characters"
                        style="display:flex;align-items:center;gap:6px;">
                    💾 Save as Template
                </button>
            </div>
        </div>
    `;
}

// ============================================================================
// SHARED STAT BONUS ROW (self-contained for augments)
// ============================================================================

function renderAugStatBonusRow(sb, augId, attrs, skills, savs) {
    const attrOpts = attrs.map(a  => `<option value="${a.id}"  ${sb.targetId===a.id  ?'selected':''}>${escHtml(a.name)}</option>`).join('');
    const skillOpts= skills.map(s => `<option value="${s.id}"  ${sb.targetId===s.id  ?'selected':''}>${escHtml(s.attrName)} / ${escHtml(s.name)}</option>`).join('');
    const savOpts  = savs.map(s   => `<option value="${s.id}"  ${sb.targetId===s.id  ?'selected':''}>${escHtml(s.name)}</option>`).join('');

    // Affinity target options: Type.pool combinations (e.g. "Slash.damage")
    const affTargets = ['Slash.damage','Slash.stagger','Blunt.damage','Blunt.stagger','Pierce.damage','Pierce.stagger']
        .map(t => `<option value="${t}" ${sb.targetId===t?'selected':''}>${t.replace('.',' — ')}</option>`).join('');

    const targets = sb.type==='attribute' ? attrOpts
                  : sb.type==='skill'     ? skillOpts
                  : sb.type==='affinity'  ? affTargets
                  : savOpts;

    return `
        <div class="stat-bonus-row" data-bonus-id="${sb.id}">
            <select class="aug-sb-type" data-aug-id="${augId}" data-bonus-id="${sb.id}">
                <option value="attribute"   ${sb.type==='attribute'   ?'selected':''}>Attribute</option>
                <option value="skill"       ${sb.type==='skill'       ?'selected':''}>Skill</option>
                <option value="savingThrow" ${sb.type==='savingThrow' ?'selected':''}>Saving Throw</option>
                <option value="affinity"    ${sb.type==='affinity'    ?'selected':''}>Affinity</option>
            </select>
            <select class="aug-sb-target" data-aug-id="${augId}" data-bonus-id="${sb.id}">
                ${targets || '<option value="">— none —</option>'}
            </select>
            <span class="st-term-op">+</span>
            <input type="number" class="aug-sb-value" value="${sb.value||0}"
                   data-aug-id="${augId}" data-bonus-id="${sb.id}" style="width:52px;text-align:center;">
            <button type="button" class="aug-sb-remove" data-aug-id="${augId}" data-bonus-id="${sb.id}" title="Remove">×</button>
        </div>
    `;
}

// ============================================================================
// COMBAT SKILL LINK ROW  (Option A)
// ============================================================================

function renderCombatLinkRow(lnk, augId, idx) {
    return `
        <div class="stat-bonus-row" data-link-idx="${idx}">
            <input type="text" class="rpg-input aug-link-name" data-aug-id="${augId}" data-link-idx="${idx}"
                   value="${escHtml(lnk.skillName || '')}"
                   placeholder="Combat skill name"
                   style="flex:1; min-width:100px;"
                   title="Name of the combat skill this augment links to">
            <span class="st-term-op">+</span>
            <input type="number" class="rpg-input aug-link-bonus" data-aug-id="${augId}" data-link-idx="${idx}"
                   value="${lnk.bonusValue || 0}" style="width:52px; text-align:center;"
                   title="Flat bonus to that skill (0 = just an unlock)">
            <button type="button" class="aug-link-remove" data-aug-id="${augId}" data-link-idx="${idx}" title="Remove">×</button>
        </div>
    `;
}

// ============================================================================
// MODULE POOL PANEL  (Session 10)
// ============================================================================

let _poolActiveTab = 'library'; // 'library' | 'templates'

const _POOL_CSS_ID = 'rpg-aug-pool-styles';
function _injectPoolStyles() {
    if (document.getElementById(_POOL_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _POOL_CSS_ID;
    s.textContent = `
        #aug-pool-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.7);
            z-index: 99997;
            display: flex; align-items: flex-start; justify-content: flex-end;
        }
        #aug-pool-panel {
            width: min(440px, 96vw);
            height: 100vh;
            background: #16162a;
            border-left: 1px solid #3a3a5a;
            display: flex; flex-direction: column;
            animation: aug-pool-slide-in .2s ease;
            overflow: hidden;
        }
        @keyframes aug-pool-slide-in {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
        }
        #aug-pool-panel .pool-header {
            display: flex; align-items: center; gap: 10px;
            padding: 16px 18px 14px;
            border-bottom: 1px solid #2a2a42;
        }
        #aug-pool-panel .pool-header h3 {
            flex: 1; margin: 0; font-size: 1rem; color: #e0e0f0;
        }
        #aug-pool-panel .pool-close {
            background: none; border: none; color: #888; font-size: 1.3rem;
            cursor: pointer; padding: 2px 6px; line-height: 1;
        }
        #aug-pool-panel .pool-close:hover { color: #e0e0f0; }
        #aug-pool-panel .pool-tabs {
            display: flex; border-bottom: 1px solid #2a2a42;
        }
        #aug-pool-panel .pool-tab-btn {
            flex: 1; padding: 9px 0; background: none; border: none;
            color: #6a6a8a; font-size: .88rem; cursor: pointer;
            border-bottom: 2px solid transparent; transition: color .15s;
        }
        #aug-pool-panel .pool-tab-btn.active {
            color: #7ec8e3; border-bottom-color: #7ec8e3;
        }
        #aug-pool-panel .pool-search {
            padding: 10px 18px 8px;
        }
        #aug-pool-panel .pool-search input {
            width: 100%; box-sizing: border-box;
            background: #1e1e38; border: 1px solid #3a3a5a;
            border-radius: 6px; color: #d0d0e8; padding: 6px 10px;
            font-size: .88rem;
        }
        #aug-pool-panel .pool-list {
            flex: 1; overflow-y: auto; padding: 8px 18px 16px;
            display: flex; flex-direction: column; gap: 8px;
        }
        .aug-pool-card {
            background: #1e1e38; border: 1px solid #2e2e52;
            border-radius: 8px; padding: 10px 12px;
        }
        .aug-pool-card-header {
            display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
        }
        .aug-pool-card-name { font-weight: 600; font-size: .93rem; }
        .aug-pool-card-cat {
            font-size: .72rem; background: #2a2a48; border-radius: 4px;
            padding: 1px 6px; color: #8888aa; margin-left: auto;
        }
        .aug-pool-card-desc { font-size: .8rem; color: #8888aa; margin-bottom: 8px; }
        .aug-pool-card-actions { display: flex; gap: 6px; align-items: center; }
        .aug-pool-install-btn {
            background: #2a5aaa; color: #fff; border: none;
            border-radius: 6px; padding: 4px 12px;
            font-size: .82rem; cursor: pointer; transition: opacity .15s;
        }
        .aug-pool-install-btn:hover { opacity: .85; }
        .aug-pool-slot-picker {
            flex: 1; background: #1a1a2e; border: 1px solid #3a3a5a;
            color: #d0d0e8; border-radius: 6px; padding: 3px 6px;
            font-size: .82rem;
        }
        .aug-pool-delete-btn {
            background: none; border: none; color: #c06060;
            font-size: 1rem; cursor: pointer; padding: 0 4px;
        }
        .aug-pool-delete-btn:hover { color: #ff4f4f; }
        .aug-pool-empty {
            text-align: center; color: #5a5a7a; padding: 32px 16px;
            font-size: .9rem;
        }
    `;
    document.head.appendChild(s);
}

function _buildPoolCardHTML(entry, slots, isTemplate) {
    const tier      = RARITY_TIERS.find(t => t.id === (entry.rarityTier || 'common')) || RARITY_TIERS[0];
    const slotOpts  = slots.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    const deleteBtn = isTemplate
        ? `<button type="button" class="aug-pool-delete-btn" data-tmpl-id="${entry._templateId}" title="Delete template">🗑</button>`
        : '';

    return `
        <div class="aug-pool-card">
            <div class="aug-pool-card-header">
                <span class="aug-pool-card-name" style="color:${tier.color};">${escHtml(entry.name)}</span>
                <span class="aug-pool-card-cat">${escHtml(entry.category || 'Custom')}</span>
            </div>
            ${entry.shortDesc ? `<div class="aug-pool-card-desc">${escHtml(entry.shortDesc)}</div>` : ''}
            <div class="aug-pool-card-actions">
                <select class="aug-pool-slot-picker">
                    ${slotOpts || '<option value="">— no slots —</option>'}
                </select>
                <button type="button" class="aug-pool-install-btn"
                        data-name="${escHtml(entry.name)}"
                        data-rarity="${escHtml(entry.rarityTier || 'common')}"
                        data-short="${escHtml(entry.shortDesc || '')}"
                        data-long="${escHtml(entry.longDesc  || '')}"
                        data-cat="${escHtml(entry.category || 'Custom')}">
                    Install →
                </button>
                ${deleteBtn}
            </div>
        </div>
    `;
}

function _buildPoolContent(query) {
    const ss    = extensionSettings.statSheet;
    const slots = (ss.augmentSlots || []);
    const q     = (query || '').toLowerCase().trim();

    // My Templates
    const templates = (ss.augmentTemplates || []).filter(e =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (e.shortDesc || '').toLowerCase().includes(q)
    );
    if (!templates.length) {
        return '<div class="aug-pool-empty">No saved templates yet.<br>Use ✏️ + 💾 Save as Template in the edit popup.</div>';
    }
    return templates.map(e => _buildPoolCardHTML(e, slots, true)).join('');
}

function _refreshPoolList() {
    const q = String($('#aug-pool-search').val() || '');
    $('#aug-pool-list').html(_buildPoolContent(q));
}

function openPoolPanel() {
    _injectPoolStyles();
    if ($('#aug-pool-overlay').length) { $('#aug-pool-overlay').show(); return; }

    const $overlay = $(`
        <div id="aug-pool-overlay">
            <div id="aug-pool-panel">
                <div class="pool-header">
                    <h3>📦 Augment Module Pool</h3>
                    <button type="button" class="pool-close" id="aug-pool-close">✕</button>
                </div>
                <div class="pool-tabs">
                    <button type="button" class="pool-tab-btn active" data-pool-tab="templates">My Templates</button>
                </div>
                <div class="pool-search">
                    <input type="text" id="aug-pool-search" placeholder="Search…" autocomplete="off">
                </div>
                <div class="pool-list" id="aug-pool-list">
                    ${_buildPoolContent('')}
                </div>
            </div>
        </div>
    `);
    $('body').append($overlay);

    // Close on overlay background click
    $overlay.on('click', function(e) {
        if (e.target.id === 'aug-pool-overlay') closePoolPanel();
    });
}

function closePoolPanel() {
    $('#aug-pool-overlay').fadeOut(150, function() { $(this).remove(); });
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function attachListeners() {
    const ss = extensionSettings.statSheet;

    // Mode toggle
    $(document).off('click', '#btn-toggle-aug-mode')
        .on('click', '#btn-toggle-aug-mode', () => {
            isMasterMode = !isMasterMode;
            refreshCurrentTab();
        });

    // Clear filter
    $(document).off('click', '.aug-clear-filter')
        .on('click', '.aug-clear-filter', () => {
            selectedSlotId = null;
            refreshCurrentTab();
        });

    // SVG zone click — select zone, filter slots
    $(document).off('click', '.aug-svg-zone')
        .on('click', '.aug-svg-zone', function() {
            const zone     = $(this).data('zone');
            const slotIds  = ZONE_MAP[zone] || [];
            // Toggle: if any of these slots already selected, clear. Otherwise pick first.
            if (slotIds.includes(selectedSlotId)) {
                selectedSlotId = null;
            } else {
                selectedSlotId = slotIds[0] || null;
            }
            refreshCurrentTab();
        });

    // Slot panel header click — select that slot
    $(document).off('click', '.aug-slot-header')
        .on('click', '.aug-slot-header', function() {
            const slotId = $(this).closest('.aug-slot-panel').data('slot-id');
            selectedSlotId = (selectedSlotId === slotId) ? null : slotId;
            refreshCurrentTab();
        });

    // ── ADD AUGMENT ──────────────────────────────────────────────────────────
    $(document).off('click', '.aug-add-btn')
        .on('click', '.aug-add-btn', function() {
            const slotId = $(this).data('slot-id');
            const slot   = (ss.augmentSlots || []).find(s => s.id === slotId);
            const count  = (ss.augments || []).filter(a => a.slotId === slotId && a.enabled !== false).length;
            if (count >= (slot?.capacity || 4)) {
                showNotification('Slot is at capacity.', 'error');
                return;
            }
            const newAug = {
                id:               generateUniqueId(),
                slotId,
                name:             'New Augment',
                rarityTier:       'common',
                shortDesc:        '',
                longDesc:         '',
                enabled:          true,
                statBonuses:      [],
                combatSkillLinks: [],
                modulePoolBonus:  { r1: 0, r2: 0, r3: 0 }
            };
            if (!ss.augments) ss.augments = [];
            ss.augments.push(newAug);
            saveStatSheetData();
            openEditPopup(newAug.id);
            refreshCurrentTab();
        });

    // ── REMOVE AUGMENT ───────────────────────────────────────────────────────
    $(document).off('click', '.aug-btn-remove')
        .on('click', '.aug-btn-remove', function(e) {
            e.stopPropagation();
            const augId = $(this).data('aug-id');
            if (!confirm('Remove this augment?')) return;
            ss.augments = (ss.augments || []).filter(a => a.id !== augId);
            saveStatSheetData();
            refreshCurrentTab();
            showNotification('Augment removed.', 'info');
        });

    // ── OPEN EDIT POPUP (master) ─────────────────────────────────────────────
    $(document).off('click', '.aug-btn-detail')
        .on('click', '.aug-btn-detail', function(e) {
            e.stopPropagation();
            openEditPopup($(this).data('aug-id'));
        });

    // ── OPEN VIEW POPUP (player) ─────────────────────────────────────────────
    $(document).off('click', '.aug-btn-view-detail')
        .on('click', '.aug-btn-view-detail', function(e) {
            e.stopPropagation();
            openViewPopup($(this).data('aug-id'));
        });

    // ── CLOSE POPUP ──────────────────────────────────────────────────────────
    $(document).off('click', '#aug-popup-close')
        .on('click', '#aug-popup-close', closePopup);
    // Blanket stop: any click originating inside the modal never reaches the overlay.
    // Without this, DOM replacement in _refreshPopup (innerHTML swap) causes the
    // browser to re-evaluate bubbling on the pre-removal path and closes the popup.
    $(document).off('click', '.aug-popup-modal')
        .on('click', '.aug-popup-modal', function(e) {
            e.stopPropagation();
        });
    $(document).off('click', '#aug-detail-popup')
        .on('click', '#aug-detail-popup', function(e) {
            if (e.target.id === 'aug-detail-popup') closePopup();
        });

    // ── SLOT CONFIG (master) ─────────────────────────────────────────────────
    $(document).off('change', '.aug-slot-name-input')
        .on('change', '.aug-slot-name-input', function() {
            const slot = (ss.augmentSlots || []).find(s => s.id === $(this).data('slot-id'));
            if (slot) { slot.name = $(this).val(); saveStatSheetData(); refreshCurrentTab(); }
        });

    $(document).off('change', '.aug-slot-cap-input')
        .on('change', '.aug-slot-cap-input', function() {
            const slot = (ss.augmentSlots || []).find(s => s.id === $(this).data('slot-id'));
            if (slot) { slot.capacity = Math.max(1, parseInt($(this).val()) || 4); saveStatSheetData(); refreshCurrentTab(); }
        });

    // ── POPUP FIELD EDITS ────────────────────────────────────────────────────
    $(document).off('change', '.aug-edit-name')
        .on('change', '.aug-edit-name', function() {
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            aug.name = $(this).val();
            saveStatSheetData();
            const _nt = RARITY_TIERS.find(t => t.id === (aug.rarityTier||'common')) || RARITY_TIERS[0];
            $('#aug-popup-title').text(aug.name).css('color', _nt.color);
        });

    $(document).off('click', '.aug-rarity-btn')
        .on('click', '.aug-rarity-btn', function() {
            const aug    = _getAug($(this).data('aug-id'));
            if (!aug) return;
            aug.rarityTier = $(this).data('tier-id');
            saveStatSheetData();
            const tier = RARITY_TIERS.find(t => t.id === aug.rarityTier) || RARITY_TIERS[0];
            $('#aug-popup-title').css('color', tier.color);
            _refreshPopup(aug.id);
        });

    $(document).off('change', '.aug-edit-shortdesc')
        .on('change', '.aug-edit-shortdesc', function() {
            const aug = _getAug($(this).data('aug-id'));
            if (aug) { aug.shortDesc = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.aug-edit-longdesc')
        .on('change', '.aug-edit-longdesc', function() {
            const aug = _getAug($(this).data('aug-id'));
            if (aug) { aug.longDesc = $(this).val(); saveStatSheetData(); }
        });

    // ── STAT BONUSES (in popup) ──────────────────────────────────────────────
    $(document).off('click', '.aug-add-stat-bonus')
        .on('click', '.aug-add-stat-bonus', function(e) {
            e.stopPropagation();
            const aug  = _getAug($(this).data('aug-id'));
            if (!aug) return;
            const firstAttr = (ss.attributes || []).find(a => a.enabled);
            aug.statBonuses.push({ id: generateUniqueId(), type: 'attribute', targetId: firstAttr?.id || '', value: 1 });
            saveStatSheetData();
            _refreshPopup(aug.id);
        });

    $(document).off('click', '.aug-sb-remove')
        .on('click', '.aug-sb-remove', function(e) {
            e.stopPropagation();
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            aug.statBonuses = aug.statBonuses.filter(sb => sb.id !== $(this).data('bonus-id'));
            saveStatSheetData();
            _refreshPopup(aug.id);
        });

    $(document).off('change', '.aug-sb-type')
        .on('change', '.aug-sb-type', function() {
            const aug = _getAug($(this).data('aug-id'));
            const sb  = aug?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
            if (!sb) return;
            sb.type = $(this).val();
            const attrs = (ss.attributes || []).filter(a => a.enabled);
            const allSk = attrs.flatMap(a => (a.skills || []).filter(s => s.enabled));
            const savs  = (ss.savingThrows || []).filter(s => s.enabled);
            if      (sb.type === 'attribute')   sb.targetId = attrs[0]?.id  || '';
            else if (sb.type === 'skill')        sb.targetId = allSk[0]?.id || '';
            else if (sb.type === 'affinity')     sb.targetId = 'Slash.damage';
            else                                 sb.targetId = savs[0]?.id  || '';
            saveStatSheetData();
            _refreshPopup(aug.id);
        });

    $(document).off('change', '.aug-sb-target')
        .on('change', '.aug-sb-target', function() {
            const aug = _getAug($(this).data('aug-id'));
            const sb  = aug?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
            if (sb) { sb.targetId = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.aug-sb-value')
        .on('change', '.aug-sb-value', function() {
            const aug = _getAug($(this).data('aug-id'));
            const sb  = aug?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
            if (sb) { sb.value = parseInt($(this).val()) || 0; saveStatSheetData(); }
        });

    // ── COMBAT SKILL LINKS (in popup) ────────────────────────────────────────
    $(document).off('click', '.aug-add-combat-link')
        .on('click', '.aug-add-combat-link', function(e) {
            e.stopPropagation();
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            aug.combatSkillLinks.push({ skillId: '', skillName: '', bonusValue: 0 });
            saveStatSheetData();
            _refreshPopup(aug.id);
        });

    $(document).off('click', '.aug-link-remove')
        .on('click', '.aug-link-remove', function(e) {
            e.stopPropagation();
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            const idx = parseInt($(this).data('link-idx'));
            aug.combatSkillLinks.splice(idx, 1);
            saveStatSheetData();
            _refreshPopup(aug.id);
        });

    $(document).off('change', '.aug-link-name')
        .on('change', '.aug-link-name', function() {
            const aug = _getAug($(this).data('aug-id'));
            const lnk = aug?.combatSkillLinks?.[parseInt($(this).data('link-idx'))];
            if (lnk) { lnk.skillName = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.aug-link-bonus')
        .on('change', '.aug-link-bonus', function() {
            const aug = _getAug($(this).data('aug-id'));
            const lnk = aug?.combatSkillLinks?.[parseInt($(this).data('link-idx'))];
            if (lnk) { lnk.bonusValue = parseInt($(this).val()) || 0; saveStatSheetData(); }
        });

    // ── MODULE POOL controls (Session 10) ────────────────────────────────────

    // INT attribute selector
    $(document).off('change', '#mp-int-select')
        .on('change', '#mp-int-select', function() {
            if (!ss.modulesPool) ss.modulesPool = { intAttributeId: '', manualBonus: { r1: 0, r2: 0, r3: 0 } };
            ss.modulesPool.intAttributeId = $(this).val();
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Manual bonus inputs (R1/R2/R3)
    $(document).off('change', '.mp-manual-input')
        .on('change', '.mp-manual-input', function() {
            if (!ss.modulesPool) ss.modulesPool = { intAttributeId: '', manualBonus: { r1: 0, r2: 0, r3: 0 } };
            const rank = $(this).data('rank');
            const key  = `r${rank}`;
            ss.modulesPool.manualBonus[key] = Math.max(0, parseInt($(this).val()) || 0);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Per-augment module pool bonus inputs (in edit popup)
    $(document).off('change', '.aug-mp-r1, .aug-mp-r2, .aug-mp-r3')
        .on('change', '.aug-mp-r1, .aug-mp-r2, .aug-mp-r3', function() {
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            if (!aug.modulePoolBonus) aug.modulePoolBonus = { r1: 0, r2: 0, r3: 0 };
            const cls = $(this).attr('class').match(/aug-mp-(r[123])/)?.[1];
            if (cls) aug.modulePoolBonus[cls] = Math.max(0, parseInt($(this).val()) || 0);
            saveStatSheetData();
            _refreshPopup(aug.id); // stay in popup — refreshCurrentTab would close it
        });

    // INT 10 — Unique Skill → Base designation
    $(document).off('change', '#mp-unique-base-select')
        .on('change', '#mp-unique-base-select', function() {
            if (!ss.modulesPool) ss.modulesPool = { intAttributeId: '', manualBonus: { r1: 0, r2: 0, r3: 0 }, uniqueSkillAsBaseId: '' };
            ss.modulesPool.uniqueSkillAsBaseId = $(this).val();
            saveStatSheetData();
            refreshCurrentTab(); // rebuilds Combat Skills tab module counts too
        });

    // ── MODULE POOL (Session 10) ─────────────────────────────────────────────

    // Open pool panel
    $(document).off('click', '#btn-open-aug-pool')
        .on('click', '#btn-open-aug-pool', (e) => {
            e.stopPropagation();
            openPoolPanel();
        });

    // Close pool panel button
    $(document).off('click', '#aug-pool-close')
        .on('click', '#aug-pool-close', closePoolPanel);

    // Pool tab switch
    $(document).off('click', '.pool-tab-btn')
        .on('click', '.pool-tab-btn', function() {
            _poolActiveTab = $(this).data('pool-tab');
            $('.pool-tab-btn').removeClass('active');
            $(this).addClass('active');
            _refreshPoolList();
        });

    // Pool search
    $(document).off('input', '#aug-pool-search')
        .on('input', '#aug-pool-search', _refreshPoolList);

    // Install button: reads the slot picker on the same card
    $(document).off('click', '.aug-pool-install-btn')
        .on('click', '.aug-pool-install-btn', function(e) {
            e.stopPropagation();
            const $card  = $(this).closest('.aug-pool-card');
            const slotId = $card.find('.aug-pool-slot-picker').val();
            if (!slotId) { showNotification('No slot selected.', 'error'); return; }

            const slot  = (ss.augmentSlots || []).find(s => s.id === slotId);
            const count = (ss.augments || []).filter(a => a.slotId === slotId && a.enabled !== false).length;
            if (count >= (slot?.capacity || 4)) {
                showNotification(`Slot "${slot?.name}" is full.`, 'error');
                return;
            }

            const $btn = $(this);
            const newAug = {
                id:               generateUniqueId(),
                slotId,
                name:             $btn.data('name')    || 'Augment',
                rarityTier:       $btn.data('rarity')  || 'common',
                shortDesc:        $btn.data('short')   || '',
                longDesc:         $btn.data('long')    || '',
                enabled:          true,
                statBonuses:      [],
                combatSkillLinks: [],
                modulePoolBonus:  { r1: 0, r2: 0, r3: 0 }
            };
            if (!ss.augments) ss.augments = [];
            ss.augments.push(newAug);
            saveStatSheetData();
            refreshCurrentTab();
            showNotification(`"${newAug.name}" installed into ${slot?.name || slotId}.`, 'success');
        });

    // Delete template
    $(document).off('click', '.aug-pool-delete-btn')
        .on('click', '.aug-pool-delete-btn', function(e) {
            e.stopPropagation();
            const tmplId = $(this).data('tmpl-id');
            if (!confirm('Delete this template?')) return;
            ss.augmentTemplates = (ss.augmentTemplates || []).filter(t => t._templateId !== tmplId);
            saveStatSheetData();
            _refreshPoolList();
            showNotification('Template deleted.', 'info');
        });

    // Save as Template (from edit popup)
    $(document).off('click', '.aug-btn-save-template')
        .on('click', '.aug-btn-save-template', function(e) {
            e.stopPropagation();
            const aug = _getAug($(this).data('aug-id'));
            if (!aug) return;
            if (!ss.augmentTemplates) ss.augmentTemplates = [];
            // Avoid duplicates by name
            const alreadyExists = ss.augmentTemplates.some(t => t.name === aug.name);
            if (alreadyExists) {
                showNotification(`A template named "${aug.name}" already exists.`, 'error');
                return;
            }
            ss.augmentTemplates.push({
                _templateId:      generateUniqueId(),
                category:         'Custom',
                name:             aug.name,
                rarityTier:       aug.rarityTier || 'common',
                shortDesc:        aug.shortDesc  || '',
                longDesc:         aug.longDesc   || '',
            });
            saveStatSheetData();
            showNotification(`"${aug.name}" saved to My Templates.`, 'success');
        });
}

// ============================================================================
// POPUP HELPERS
// ============================================================================

function openViewPopup(augId) {
    const aug = _getAug(augId);
    if (!aug) return;
    const _vt = RARITY_TIERS.find(t => t.id === (aug.rarityTier||'common')) || RARITY_TIERS[0];
    $('#aug-popup-title').text(aug.name).css('color', _vt.color);
    $('#aug-popup-body').html(buildViewPopupContent(aug));
    $('#aug-detail-popup').fadeIn(150);
}

function openEditPopup(augId) {
    const aug = _getAug(augId);
    if (!aug) return;
    const _et = RARITY_TIERS.find(t => t.id === (aug.rarityTier||'common')) || RARITY_TIERS[0];
    $('#aug-popup-title').text(aug.name).css('color', _et.color);
    $('#aug-popup-body').html(buildEditPopupContent(aug));
    $('#aug-detail-popup').fadeIn(150);
}

function closePopup() {
    $('#aug-detail-popup').fadeOut(150);
    refreshCurrentTab(); // refresh so cards reflect any edits
}

function _refreshPopup(augId) {
    const aug = _getAug(augId);
    if (!aug) return;
    $('#aug-popup-body').html(buildEditPopupContent(aug));
}

// ============================================================================
// UTILITIES
// ============================================================================

function _getAug(id) {
    return (extensionSettings.statSheet?.augments || []).find(a => a.id === id) || null;
}

function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
