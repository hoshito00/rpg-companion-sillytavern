/**
 * Gear Tab Module  (Session 14)
 *
 * Tracks equipped gear (weapons, armour, accessories, etc.) as discrete items
 * carrying stat bonuses and combat skill links — distinct from Augments
 * (body modifications) and from the freeform Inventory system.
 *
 * Schema per gear item:
 *   { id, slotId, name, linkedInventoryName, equipped, rarityTier,
 *     shortDesc, notes, statBonuses[], combatSkillLinks[] }
 *
 * Schema per gear slot (gearSlots[]):
 *   { id, name, capacity }
 */

import { extensionSettings } from '../../core/state.js';
import { generateUniqueId }  from './statSheetState.js';
import { saveStatSheetData } from '../../core/persistence.js';
import {
    refreshCurrentTab,
    showNotification,
    buildPromptIncludeToggle
} from './statSheetUI.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_GEAR_SLOTS = [
    { id: 'weapon',    name: 'Weapon',    capacity: 2 },
    { id: 'armor',     name: 'Armor',     capacity: 1 },
    { id: 'accessory', name: 'Accessory', capacity: 3 },
    { id: 'offhand',   name: 'Off-hand',  capacity: 1 },
];

export const GEAR_RARITY_TIERS = [
    { id: 'common',      label: 'Common',      color: '#9e9e9e' },
    { id: 'uncommon',    label: 'Uncommon',    color: '#4caf7d' },
    { id: 'rare',        label: 'Rare',        color: '#4a9eff' },
    { id: 'premium',     label: 'Premium',     color: '#b06fff' },
    { id: 'masterclass', label: 'Masterclass', color: '#ff9c3a' },
    { id: 'legendary',   label: 'Legendary',   color: '#ff4f4f' },
];

// ============================================================================
// MODULE STATE
// ============================================================================

let isMasterMode   = false;
let selectedSlotId = null; // null = show all slots

// ============================================================================
// MIGRATION / INIT HELPER
// (called by statSheetState._migrate on every load)
// ============================================================================

export function ensureGearSlots() {
    const ss = extensionSettings.statSheet;
    if (!ss) return;
    let dirty = false;

    if (!Array.isArray(ss.gearSlots) || ss.gearSlots.length === 0) {
        ss.gearSlots = DEFAULT_GEAR_SLOTS.map(s => ({ ...s }));
        dirty = true;
    }

    if (!Array.isArray(ss.gear)) {
        ss.gear = [];
        dirty = true;
    }

    // Backfill any new fields onto existing gear items
    for (const item of ss.gear) {
        if (!item.rarityTier)                   { item.rarityTier   = 'common'; dirty = true; }
        if (!item.shortDesc)                    { item.shortDesc    = '';       dirty = true; }
        if (!item.notes)                        { item.notes        = '';       dirty = true; }
        if (item.linkedInventoryName == null)   { item.linkedInventoryName = null; dirty = true; }
        if (!Array.isArray(item.statBonuses))   { item.statBonuses  = [];      dirty = true; }
        if (!Array.isArray(item.combatSkillLinks)) { item.combatSkillLinks = []; dirty = true; }
        if (item.equipped == null)              { item.equipped     = true;    dirty = true; }
    }

    if (dirty) saveStatSheetData();
}

// ============================================================================
// HELPERS
// ============================================================================

function escHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _gear(id) {
    return (extensionSettings.statSheet.gear || []).find(g => g.id === id) || null;
}

/** Collect all inventory item strings across onPerson and stored locations. */
function _inventoryItems() {
    const inv = extensionSettings.userStats?.inventory;
    if (!inv || typeof inv !== 'object') return [];

    const items = new Set();

    // onPerson — comma-separated string
    if (typeof inv.onPerson === 'string') {
        inv.onPerson.split(',').map(s => s.trim()).filter(Boolean).forEach(s => items.add(s));
    }

    // stored — { locationName: "item1, item2, ..." }
    if (inv.stored && typeof inv.stored === 'object') {
        for (const val of Object.values(inv.stored)) {
            if (typeof val === 'string') {
                val.split(',').map(s => s.trim()).filter(Boolean).forEach(s => items.add(s));
            }
        }
    }

    return [...items].sort();
}

// ============================================================================
// MAIN RENDER ENTRY POINT
// ============================================================================

export function renderGearTab(container) {
    ensureGearSlots();
    const ss = extensionSettings.statSheet;
    if (!ss) {
        container.html('<div class="error-message">Stat sheet not initialised.</div>');
        return;
    }
    container.html(_buildTabHTML());
    _attachListeners();
}

// ============================================================================
// TAB HTML
// ============================================================================

function _buildTabHTML() {
    const ss    = extensionSettings.statSheet;
    const slots = ss.gearSlots || [];
    const gear  = ss.gear      || [];

    const slotsToShow = selectedSlotId
        ? slots.filter(s => s.id === selectedSlotId)
        : slots;

    const slotPanels = slotsToShow.map(slot => {
        const items = gear.filter(g => g.slotId === slot.id);
        const count = items.filter(g => g.equipped !== false).length;
        const cap   = slot.capacity || 2;
        const full  = count >= cap;

        const itemCards = items.length
            ? items.map(g => _buildGearCard(g)).join('')
            : `<div class="gear-slot-empty">No gear in this slot</div>`;

        return `
            <div class="gear-slot-panel" data-slot-id="${escHtml(slot.id)}">
                <div class="gear-slot-header">
                    <span class="gear-slot-name">${escHtml(slot.name)}</span>
                    <span class="gear-slot-count ${full ? 'gear-slot-full' : ''}">${count}/${cap}</span>
                    ${isMasterMode ? `
                        <button class="gear-add-btn btn-add-flat-term"
                                data-slot-id="${escHtml(slot.id)}"
                                ${full ? 'disabled title="Slot at capacity"' : 'title="Add gear item"'}>
                            + Add
                        </button>` : ''}
                </div>
                <div class="gear-slot-items">
                    ${itemCards}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="gear-tab ${isMasterMode ? 'master-mode' : 'player-mode'}">

            <div class="aug-tab-header">
                <h3>Gear &amp; Equipment</h3>
                ${buildPromptIncludeToggle('gear', 'Gear')}
                <button id="btn-gear-toggle-mode" class="btn-toggle-mode">
                    ${isMasterMode ? '▶ Player' : '⚙ Master'}
                </button>
            </div>

            ${isMasterMode ? _buildSlotManager() : ''}

            <div class="gear-slot-filter">
                <button class="gear-filter-btn ${!selectedSlotId ? 'active' : ''}"
                        data-filter-slot="">All Slots</button>
                ${(ss.gearSlots || []).map(s => `
                    <button class="gear-filter-btn ${selectedSlotId === s.id ? 'active' : ''}"
                            data-filter-slot="${escHtml(s.id)}">
                        ${escHtml(s.name)}
                    </button>
                `).join('')}
            </div>

            <div class="gear-slots-list">
                ${slotPanels || '<div class="gear-slot-empty">No gear slots configured.</div>'}
            </div>

            ${_buildDetailPopupShell()}
        </div>
    `;
}

// ── Gear card (player + master) ──────────────────────────────────────────────

function _buildGearCard(item) {
    const tier     = GEAR_RARITY_TIERS.find(t => t.id === (item.rarityTier || 'common')) || GEAR_RARITY_TIERS[0];
    const equipped = item.equipped !== false;
    const equippedBadge = equipped
        ? `<span class="gear-badge-equipped">Equipped</span>`
        : `<span class="gear-badge-unequipped">Unequipped</span>`;

    const bonusSummary = (item.statBonuses || []).length
        ? `<div class="gear-card-bonuses">${
            item.statBonuses.slice(0, 3).map(sb => {
                const sign = (sb.value || 0) >= 0 ? '+' : '';
                return `<span class="gear-bonus-chip">${sign}${sb.value || 0} ${escHtml(sb.type)}</span>`;
            }).join('')
          }${item.statBonuses.length > 3 ? `<span class="gear-bonus-chip">…</span>` : ''}</div>`
        : '';

    const linkedBadge = item.linkedInventoryName
        ? `<div class="gear-linked-inv" title="Linked inventory item">
               🎒 ${escHtml(item.linkedInventoryName)}
           </div>`
        : '';

    return `
        <div class="gear-card ${equipped ? '' : 'gear-card-unequipped'}" data-gear-id="${escHtml(item.id)}">
            <div class="gear-card-header">
                <span class="gear-card-name" style="color:${tier.color};">${escHtml(item.name)}</span>
                ${equippedBadge}
                ${isMasterMode ? `
                    <button class="gear-btn-edit" data-gear-id="${escHtml(item.id)}" title="Edit">✏️</button>
                    <button class="gear-btn-remove" data-gear-id="${escHtml(item.id)}" title="Remove">×</button>
                ` : ''}
                ${!isMasterMode ? `
                    <button class="gear-btn-toggle-equipped btn-add-flat-term"
                            data-gear-id="${escHtml(item.id)}"
                            title="${equipped ? 'Unequip' : 'Equip'}">
                        ${equipped ? 'Unequip' : 'Equip'}
                    </button>
                ` : ''}
            </div>
            ${item.shortDesc ? `<div class="aug-short-desc">${escHtml(item.shortDesc)}</div>` : ''}
            ${linkedBadge}
            ${bonusSummary}
        </div>
    `;
}

// ── Slot manager (master mode config) ───────────────────────────────────────

function _buildSlotManager() {
    const slots = extensionSettings.statSheet.gearSlots || [];
    const rows = slots.map(slot => `
        <div class="aug-slot-config-row">
            <input type="text" class="rpg-input gear-slot-name-input"
                   data-slot-id="${escHtml(slot.id)}"
                   value="${escHtml(slot.name)}"
                   placeholder="Slot name"
                   style="flex:1; min-width:80px;">
            <span class="rpg-threshold-label" style="white-space:nowrap;">Cap:</span>
            <input type="number" class="rpg-threshold-input gear-slot-cap-input"
                   data-slot-id="${escHtml(slot.id)}"
                   value="${slot.capacity || 2}"
                   min="1" max="20"
                   style="width:52px; text-align:center;">
            <button class="gear-slot-delete-btn btn-add-flat-term"
                    data-slot-id="${escHtml(slot.id)}"
                    title="Delete slot (removes all gear in it)">🗑</button>
        </div>
    `).join('');

    return `
        <div class="feat-tags-section aug-slot-manager">
            <span class="subskills-label">⚙ Slot Configuration
                <span style="font-weight:400;opacity:0.6;font-size:11px;">
                    (rename slots, set capacity, add/remove)
                </span>
            </span>
            <div class="aug-slot-config-grid" style="margin-top:10px;">
                ${rows}
            </div>
            <button id="gear-add-slot-btn" class="btn-add-flat-term" style="margin-top:10px;">
                + Add Slot
            </button>
        </div>
    `;
}

// ── Edit popup shell ─────────────────────────────────────────────────────────

function _buildDetailPopupShell() {
    return `
        <div id="gear-detail-popup" class="aug-popup-overlay" style="display:none;">
            <div class="aug-popup-modal">
                <div class="aug-popup-header">
                    <span id="gear-popup-title" class="aug-popup-title-text">Edit Gear</span>
                    <button id="gear-popup-close" class="aug-popup-close-btn" title="Close">✕</button>
                </div>
                <div id="gear-popup-body" class="aug-popup-body"></div>
            </div>
        </div>
    `;
}

// ── Edit popup content ────────────────────────────────────────────────────────

function _buildPopupContent(item) {
    const ss        = extensionSettings.statSheet;
    const tier      = GEAR_RARITY_TIERS.find(t => t.id === (item.rarityTier || 'common')) || GEAR_RARITY_TIERS[0];
    const attrs     = (ss.attributes  || []).filter(a => a.enabled);
    const allSkills = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled).map(s => ({ ...s, attrName: a.name }))
    );
    const savs      = (ss.savingThrows || []).filter(s => s.enabled);

    // Inventory items for link dropdown
    const invItems  = _inventoryItems();
    const invOpts   = invItems.map(name =>
        `<option value="${escHtml(name)}" ${item.linkedInventoryName === name ? 'selected' : ''}>${escHtml(name)}</option>`
    ).join('');

    // Rarity buttons
    const rarityBtns = GEAR_RARITY_TIERS.map(t => `
        <button class="aug-rarity-btn gear-rarity-btn ${item.rarityTier === t.id ? 'active' : ''}"
                data-gear-id="${escHtml(item.id)}"
                data-tier-id="${t.id}"
                style="border-color:${t.color};${item.rarityTier === t.id ? `background:${t.color}33;color:${t.color};` : ''}">
            ${t.label}
        </button>
    `).join('');

    // Stat bonus rows
    const bonusRows = (item.statBonuses || []).map(sb =>
        _buildStatBonusRow(sb, item.id, attrs, allSkills, savs)
    ).join('');

    // Combat skill link rows
    const combatSkills   = ss.combatSkills || [];
    const skillLinkRows  = (item.combatSkillLinks || []).map((lnk, idx) => `
        <div class="stat-bonus-row" data-link-idx="${idx}">
            <select class="rpg-input gear-link-skill" data-gear-id="${escHtml(item.id)}" data-link-idx="${idx}" style="flex:1;">
                <option value="">— none —</option>
                ${combatSkills.map(sk => `
                    <option value="${escHtml(sk.id)}" ${lnk.skillId === sk.id ? 'selected' : ''}>
                        ${escHtml(sk.name || '(Unnamed)')}
                    </option>
                `).join('')}
            </select>
            <span class="st-term-op">note:</span>
            <input type="text" class="rpg-input gear-link-note" data-gear-id="${escHtml(item.id)}" data-link-idx="${idx}"
                   value="${escHtml(lnk.note || '')}" placeholder="Passive note…"
                   style="flex:2; min-width:80px;">
            <button class="gear-link-remove" data-gear-id="${escHtml(item.id)}" data-link-idx="${idx}" title="Remove">×</button>
        </div>
    `).join('');

    return `
        <div style="display:flex; flex-direction:column; gap:14px;">

            <!-- Name -->
            <div>
                <label class="aug-edit-label">Name</label>
                <input type="text" class="rpg-input gear-edit-name" data-gear-id="${escHtml(item.id)}"
                       value="${escHtml(item.name)}" placeholder="Item name…" style="width:100%;">
            </div>

            <!-- Rarity -->
            <div>
                <label class="aug-edit-label">Rarity</label>
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
                    ${rarityBtns}
                </div>
            </div>

            <!-- Short description -->
            <div>
                <label class="aug-edit-label">Short Description</label>
                <input type="text" class="rpg-input gear-edit-shortdesc" data-gear-id="${escHtml(item.id)}"
                       value="${escHtml(item.shortDesc || '')}" placeholder="One-line description…" style="width:100%;">
            </div>

            <!-- Notes -->
            <div>
                <label class="aug-edit-label">Notes</label>
                <textarea class="rpg-input gear-edit-notes" data-gear-id="${escHtml(item.id)}"
                          placeholder="Longer notes, lore, special conditions…"
                          rows="3" style="width:100%; resize:vertical;">${escHtml(item.notes || '')}</textarea>
            </div>

            <!-- Inventory link -->
            <div>
                <label class="aug-edit-label">Linked Inventory Item
                    <span style="font-size:.75rem;opacity:.6;font-weight:400;"> (optional — cosmetic reference only)</span>
                </label>
                <div style="display:flex; gap:8px; align-items:center;">
                    <select class="rpg-input gear-edit-inv-link" data-gear-id="${escHtml(item.id)}" style="flex:1;">
                        <option value="">— None —</option>
                        ${invOpts}
                    </select>
                    ${invItems.length === 0
                        ? `<span style="font-size:.75rem;opacity:.5;">No inventory items found</span>`
                        : ''}
                </div>
            </div>

            <!-- Equipped toggle -->
            <div class="rpg-editor-toggle-row">
                <input type="checkbox" id="gear-edit-equipped-${escHtml(item.id)}"
                       class="gear-edit-equipped" data-gear-id="${escHtml(item.id)}"
                       ${item.equipped !== false ? 'checked' : ''}>
                <label for="gear-edit-equipped-${escHtml(item.id)}">Equipped
                    <span style="font-size:.75rem;opacity:.6;font-weight:400;">
                        (unequipped gear does not apply stat bonuses)
                    </span>
                </label>
            </div>

            <!-- Stat Bonuses -->
            <div>
                <label class="aug-edit-label">Stat Bonuses</label>
                <div class="gear-stat-bonuses-list" data-gear-id="${escHtml(item.id)}">
                    ${bonusRows || '<div class="gear-empty-hint">No bonuses yet.</div>'}
                </div>
                <button class="gear-add-stat-bonus btn-add-flat-term" data-gear-id="${escHtml(item.id)}"
                        style="margin-top:6px;">+ Add Bonus</button>
            </div>

            <!-- Combat Skill Links -->
            <div>
                <label class="aug-edit-label">Combat Skill Links
                    <span style="font-size:.75rem;opacity:.6;font-weight:400;">
                         (passive notes for specific skills)
                    </span>
                </label>
                <div class="gear-skill-links-list" data-gear-id="${escHtml(item.id)}">
                    ${skillLinkRows || '<div class="gear-empty-hint">No links yet.</div>'}
                </div>
                <button class="gear-add-combat-link btn-add-flat-term" data-gear-id="${escHtml(item.id)}"
                        style="margin-top:6px;">+ Add Skill Link</button>
            </div>

        </div>
    `;
}

// ── Stat bonus row ────────────────────────────────────────────────────────────

function _buildStatBonusRow(sb, gearId, attrs, skills, savs) {
    const attrOpts  = attrs.map(a =>
        `<option value="${escHtml(a.id)}" ${sb.targetId === a.id ? 'selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');
    const skillOpts = skills.map(s =>
        `<option value="${escHtml(s.id)}" ${sb.targetId === s.id ? 'selected' : ''}>${escHtml(s.attrName)} / ${escHtml(s.name)}</option>`
    ).join('');
    const savOpts   = savs.map(s =>
        `<option value="${escHtml(s.id)}" ${sb.targetId === s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`
    ).join('');
    const affTargets = ['Slash.damage','Slash.stagger','Blunt.damage','Blunt.stagger','Pierce.damage','Pierce.stagger']
        .map(t => `<option value="${t}" ${sb.targetId === t ? 'selected' : ''}>${t.replace('.', ' — ')}</option>`).join('');

    const targets = sb.type === 'attribute'   ? attrOpts
                  : sb.type === 'skill'        ? skillOpts
                  : sb.type === 'affinity'     ? affTargets
                  : savOpts;

    return `
        <div class="stat-bonus-row" data-bonus-id="${escHtml(sb.id)}">
            <select class="gear-sb-type" data-gear-id="${escHtml(gearId)}" data-bonus-id="${escHtml(sb.id)}">
                <option value="attribute"   ${sb.type === 'attribute'   ? 'selected' : ''}>Attribute</option>
                <option value="skill"       ${sb.type === 'skill'       ? 'selected' : ''}>Skill</option>
                <option value="savingThrow" ${sb.type === 'savingThrow' ? 'selected' : ''}>Saving Throw</option>
                <option value="affinity"    ${sb.type === 'affinity'    ? 'selected' : ''}>Affinity</option>
            </select>
            <select class="gear-sb-target" data-gear-id="${escHtml(gearId)}" data-bonus-id="${escHtml(sb.id)}">
                ${targets || '<option value="">— none —</option>'}
            </select>
            <span class="st-term-op">+</span>
            <input type="number" class="gear-sb-value" value="${sb.value || 0}"
                   data-gear-id="${escHtml(gearId)}" data-bonus-id="${escHtml(sb.id)}"
                   style="width:52px; text-align:center;">
            <button class="gear-sb-remove" data-gear-id="${escHtml(gearId)}" data-bonus-id="${escHtml(sb.id)}"
                    title="Remove">×</button>
        </div>
    `;
}

// ============================================================================
// POPUP HELPERS
// ============================================================================

function _openEditPopup(gearId) {
    const item = _gear(gearId);
    if (!item) return;
    const tier = GEAR_RARITY_TIERS.find(t => t.id === (item.rarityTier || 'common')) || GEAR_RARITY_TIERS[0];
    $('#gear-popup-title').text(item.name || 'Edit Gear').css('color', tier.color);
    $('#gear-popup-body').html(_buildPopupContent(item));
    $('#gear-detail-popup').show();
}

function _refreshPopup(gearId) {
    const item = _gear(gearId);
    if (!item || !$('#gear-detail-popup').is(':visible')) return;
    const tier = GEAR_RARITY_TIERS.find(t => t.id === (item.rarityTier || 'common')) || GEAR_RARITY_TIERS[0];
    $('#gear-popup-title').text(item.name || 'Edit Gear').css('color', tier.color);
    $('#gear-popup-body').html(_buildPopupContent(item));
}

function _closePopup() {
    $('#gear-detail-popup').hide();
    refreshCurrentTab();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function _attachListeners() {
    const ss = extensionSettings.statSheet;

    // ── Master / Player toggle ────────────────────────────────────────────────
    $(document).off('click', '#btn-gear-toggle-mode')
        .on('click', '#btn-gear-toggle-mode', function() {
            isMasterMode = !isMasterMode;
            refreshCurrentTab();
        });

    // ── Slot filter buttons ───────────────────────────────────────────────────
    $(document).off('click', '.gear-filter-btn')
        .on('click', '.gear-filter-btn', function() {
            selectedSlotId = $(this).data('filter-slot') || null;
            refreshCurrentTab();
        });

    // ── Add gear item ─────────────────────────────────────────────────────────
    $(document).off('click', '.gear-add-btn')
        .on('click', '.gear-add-btn', function() {
            const slotId = $(this).data('slot-id');
            const slot   = (ss.gearSlots || []).find(s => s.id === slotId);
            const count  = (ss.gear || []).filter(g => g.slotId === slotId && g.equipped !== false).length;
            if (count >= (slot?.capacity || 2)) {
                showNotification('Slot is at capacity.', 'error');
                return;
            }
            const newItem = {
                id:                  generateUniqueId(),
                slotId,
                name:                'New Item',
                linkedInventoryName: null,
                equipped:            true,
                rarityTier:          'common',
                shortDesc:           '',
                notes:               '',
                statBonuses:         [],
                combatSkillLinks:    [],
            };
            if (!ss.gear) ss.gear = [];
            ss.gear.push(newItem);
            saveStatSheetData();
            _openEditPopup(newItem.id);
            refreshCurrentTab();
        });

    // ── Remove gear item ──────────────────────────────────────────────────────
    $(document).off('click', '.gear-btn-remove')
        .on('click', '.gear-btn-remove', function(e) {
            e.stopPropagation();
            const gearId = $(this).data('gear-id');
            if (!confirm('Remove this gear item?')) return;
            ss.gear = (ss.gear || []).filter(g => g.id !== gearId);
            saveStatSheetData();
            refreshCurrentTab();
            showNotification('Gear removed.', 'info');
        });

    // ── Open edit popup ───────────────────────────────────────────────────────
    $(document).off('click', '.gear-btn-edit')
        .on('click', '.gear-btn-edit', function(e) {
            e.stopPropagation();
            _openEditPopup($(this).data('gear-id'));
        });

    // ── Toggle equipped (player mode) ─────────────────────────────────────────
    $(document).off('click', '.gear-btn-toggle-equipped')
        .on('click', '.gear-btn-toggle-equipped', function(e) {
            e.stopPropagation();
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            item.equipped = !item.equipped;
            saveStatSheetData();
            refreshCurrentTab();
        });

    // ── Close popup ───────────────────────────────────────────────────────────
    $(document).off('click', '#gear-popup-close')
        .on('click', '#gear-popup-close', _closePopup);
    $(document).off('click', '.aug-popup-modal')
        .on('click', '.aug-popup-modal', function(e) { e.stopPropagation(); });
    $(document).off('click', '#gear-detail-popup')
        .on('click', '#gear-detail-popup', function(e) {
            if (e.target.id === 'gear-detail-popup') _closePopup();
        });

    // ── Slot config (master) ──────────────────────────────────────────────────
    $(document).off('change', '.gear-slot-name-input')
        .on('change', '.gear-slot-name-input', function() {
            const slot = (ss.gearSlots || []).find(s => s.id === $(this).data('slot-id'));
            if (slot) { slot.name = $(this).val(); saveStatSheetData(); refreshCurrentTab(); }
        });

    $(document).off('change', '.gear-slot-cap-input')
        .on('change', '.gear-slot-cap-input', function() {
            const slot = (ss.gearSlots || []).find(s => s.id === $(this).data('slot-id'));
            if (slot) { slot.capacity = Math.max(1, parseInt($(this).val()) || 2); saveStatSheetData(); refreshCurrentTab(); }
        });

    $(document).off('click', '.gear-slot-delete-btn')
        .on('click', '.gear-slot-delete-btn', function() {
            const slotId = $(this).data('slot-id');
            const slot   = (ss.gearSlots || []).find(s => s.id === slotId);
            if (!slot) return;
            const count  = (ss.gear || []).filter(g => g.slotId === slotId).length;
            if (count > 0 && !confirm(`Delete slot "${slot.name}"? This will remove all ${count} gear item(s) in it.`)) return;
            ss.gearSlots = (ss.gearSlots || []).filter(s => s.id !== slotId);
            ss.gear      = (ss.gear      || []).filter(g => g.slotId !== slotId);
            saveStatSheetData();
            refreshCurrentTab();
        });

    $(document).off('click', '#gear-add-slot-btn')
        .on('click', '#gear-add-slot-btn', function() {
            const newSlot = { id: generateUniqueId(), name: 'New Slot', capacity: 2 };
            if (!ss.gearSlots) ss.gearSlots = [];
            ss.gearSlots.push(newSlot);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // ── Popup field edits ─────────────────────────────────────────────────────
    $(document).off('change', '.gear-edit-name')
        .on('change', '.gear-edit-name', function() {
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            item.name = $(this).val();
            saveStatSheetData();
            const tier = GEAR_RARITY_TIERS.find(t => t.id === (item.rarityTier || 'common')) || GEAR_RARITY_TIERS[0];
            $('#gear-popup-title').text(item.name).css('color', tier.color);
        });

    $(document).off('click', '.gear-rarity-btn')
        .on('click', '.gear-rarity-btn', function() {
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            item.rarityTier = $(this).data('tier-id');
            saveStatSheetData();
            _refreshPopup(item.id);
        });

    $(document).off('change', '.gear-edit-shortdesc')
        .on('change', '.gear-edit-shortdesc', function() {
            const item = _gear($(this).data('gear-id'));
            if (item) { item.shortDesc = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.gear-edit-notes')
        .on('change', '.gear-edit-notes', function() {
            const item = _gear($(this).data('gear-id'));
            if (item) { item.notes = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.gear-edit-inv-link')
        .on('change', '.gear-edit-inv-link', function() {
            const item = _gear($(this).data('gear-id'));
            if (item) {
                item.linkedInventoryName = $(this).val() || null;
                saveStatSheetData();
            }
        });

    $(document).off('change', '.gear-edit-equipped')
        .on('change', '.gear-edit-equipped', function() {
            const item = _gear($(this).data('gear-id'));
            if (item) { item.equipped = $(this).is(':checked'); saveStatSheetData(); }
        });

    // ── Stat bonuses (in popup) ───────────────────────────────────────────────
    $(document).off('click', '.gear-add-stat-bonus')
        .on('click', '.gear-add-stat-bonus', function(e) {
            e.stopPropagation();
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            const firstAttr = (ss.attributes || []).find(a => a.enabled);
            item.statBonuses.push({
                id: generateUniqueId(), type: 'attribute', targetId: firstAttr?.id || '', value: 1
            });
            saveStatSheetData();
            _refreshPopup(item.id);
        });

    $(document).off('click', '.gear-sb-remove')
        .on('click', '.gear-sb-remove', function(e) {
            e.stopPropagation();
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            item.statBonuses = item.statBonuses.filter(sb => sb.id !== $(this).data('bonus-id'));
            saveStatSheetData();
            _refreshPopup(item.id);
        });

    $(document).off('change', '.gear-sb-type')
        .on('change', '.gear-sb-type', function() {
            const item = _gear($(this).data('gear-id'));
            const sb   = item?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
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
            _refreshPopup(item.id);
        });

    $(document).off('change', '.gear-sb-target')
        .on('change', '.gear-sb-target', function() {
            const item = _gear($(this).data('gear-id'));
            const sb   = item?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
            if (sb) { sb.targetId = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.gear-sb-value')
        .on('change', '.gear-sb-value', function() {
            const item = _gear($(this).data('gear-id'));
            const sb   = item?.statBonuses?.find(b => b.id === $(this).data('bonus-id'));
            if (sb) { sb.value = parseInt($(this).val()) || 0; saveStatSheetData(); }
        });

    // ── Combat skill links (in popup) ─────────────────────────────────────────
    $(document).off('click', '.gear-add-combat-link')
        .on('click', '.gear-add-combat-link', function(e) {
            e.stopPropagation();
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            item.combatSkillLinks.push({ skillId: '', note: '' });
            saveStatSheetData();
            _refreshPopup(item.id);
        });

    $(document).off('click', '.gear-link-remove')
        .on('click', '.gear-link-remove', function(e) {
            e.stopPropagation();
            const item = _gear($(this).data('gear-id'));
            if (!item) return;
            const idx = parseInt($(this).data('link-idx'));
            item.combatSkillLinks.splice(idx, 1);
            saveStatSheetData();
            _refreshPopup(item.id);
        });

    $(document).off('change', '.gear-link-skill')
        .on('change', '.gear-link-skill', function() {
            const item = _gear($(this).data('gear-id'));
            const idx  = parseInt($(this).data('link-idx'));
            if (item?.combatSkillLinks[idx] != null) {
                item.combatSkillLinks[idx].skillId = $(this).val();
                saveStatSheetData();
            }
        });

    $(document).off('change', '.gear-link-note')
        .on('change', '.gear-link-note', function() {
            const item = _gear($(this).data('gear-id'));
            const idx  = parseInt($(this).data('link-idx'));
            if (item?.combatSkillLinks[idx] != null) {
                item.combatSkillLinks[idx].note = $(this).val();
                saveStatSheetData();
            }
        });
}
