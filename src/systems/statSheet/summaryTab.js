/**
 * Summary Tab  (Session 9)
 *
 * Read-only overview of the character's current state.
 * Renders: sprite, bars, level, attributes, saving throws,
 *          speed dice, damage affinities, job/feat passives.
 *
 * Never mutates extensionSettings — display only.
 */

import { extensionSettings }              from '../../core/state.js';
import { calculateSavingThrowValue,
         buildSavingThrowFormula,
         getSkillEffectiveLevel,
         sortSavingThrows }               from './statSheetState.js';
import { buildPromptIncludeToggle,
         showNotification }               from './statSheetUI.js';
import { exportStatSheet, importStatSheet } from '../../core/persistence.js';
import { getContext }                       from '../../../../../../extensions.js';

// ============================================================================
// SPRITE — IndexedDB storage
// Sprites are stored in browser IndexedDB keyed by chat/character ID.
// spriteUrl in the stat sheet holds 'idb:<key>' — never raw base64.
// This keeps both chat metadata and settings.json free of large binary blobs.
// ============================================================================

const _IDB_NAME    = 'rpg_companion_sprites';
const _IDB_VERSION = 1;
const _IDB_STORE   = 'sprites';

function _openSpriteDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
        req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
        req.onsuccess       = e => resolve(e.target.result);
        req.onerror         = e => reject(e.target.error);
    });
}

async function _saveSprite(key, dataUrl) {
    const db = await _openSpriteDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        tx.objectStore(_IDB_STORE).put(dataUrl, key);
        tx.oncomplete = () => resolve();
        tx.onerror    = e => reject(e.target.error);
    });
}

async function _loadSprite(key) {
    const db = await _openSpriteDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(_IDB_STORE, 'readonly');
        const req = tx.objectStore(_IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = e => reject(e.target.error);
    });
}

async function _deleteSprite(key) {
    const db = await _openSpriteDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        tx.objectStore(_IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror    = e => reject(e.target.error);
    });
}

/** Returns a stable per-chat key for IndexedDB sprite storage. */
function _spriteKey() {
    try {
        const ctx = getContext();
        return `sprite_${ctx.chatId || ctx.characterId || 'default'}`;
    } catch {
        return 'sprite_default';
    }
}

/**
 * Resolves the displayable image src for the current spriteUrl value.
 * - 'idb:<key>'  → loads from IndexedDB (async)
 * - 'data:...'   → legacy base64; auto-migrates to IndexedDB, returns the data url
 * - 'http...'    → plain URL, returned as-is
 * - ''           → null
 * Always resolves; never rejects.
 */
async function _resolveSpriteSrc(spriteUrl) {
    if (!spriteUrl) return null;

    // Legacy base64 in stored value — migrate to IndexedDB transparently
    if (spriteUrl.startsWith('data:')) {
        try {
            const key = _spriteKey();
            await _saveSprite(key, spriteUrl);
            const ss = extensionSettings.statSheet;
            ss.spriteUrl = `idb:${key}`;
            const { saveStatSheetData } = await import('../../core/persistence.js');
            saveStatSheetData();
            console.log('[SummaryTab] Migrated legacy base64 sprite to IndexedDB');
        } catch (err) {
            console.warn('[SummaryTab] IndexedDB migration failed, using inline base64:', err);
        }
        return spriteUrl; // display works either way
    }

    if (spriteUrl.startsWith('idb:')) {
        const key = spriteUrl.slice(4);
        try { return await _loadSprite(key); } catch { return null; }
    }

    // Plain URL (http/https/relative)
    return spriteUrl;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

export function renderSummaryTab(container) {
    const ss = extensionSettings.statSheet;
    if (!ss) {
        container.html('<div class="error-message">Stat sheet not initialized.</div>');
        return;
    }
    container.html(renderSummaryHTML(ss));
    attachSummaryListeners();
    // Load sprite image asynchronously after render so IDB reads don't block the UI
    _loadSpriteIntoDOM();
}

// ============================================================================
// HTML BUILDER
// ============================================================================

function renderSummaryHTML(ss) {
    return `
        <div class="summary-tab">
            ${renderSummaryHeader(ss)}
            <div class="summary-body">
                <div class="summary-col-left">
                    ${renderLevelBlock(ss)}
                    ${renderAttributesBlock(ss)}
                    ${renderSavingThrowsBlock(ss)}
                </div>
                <div class="summary-col-right">
                    ${renderAffinitiesBlock(ss)}
                    ${renderSpeedDiceBlock(ss)}
                    ${renderPassivesBlock(ss)}
                </div>
            </div>
            ${renderImportExportBar()}
        </div>
    `;
}

// ── Header (sprite + name placeholder) ──────────────────────────────────────

function renderSummaryHeader(ss) {
    const spriteUrl = ss.spriteUrl || '';
    // Always render a placeholder img; _loadSpriteIntoDOM() fills it async after render.
    // This avoids blocking the synchronous HTML build on an async IndexedDB read.
    const sprite = spriteUrl
        ? `<img id="summary-sprite-img" class="summary-sprite" alt="Character sprite"
               src="" style="display:none" onerror="this.style.display='none'">`
        : `<div id="summary-sprite-img" class="summary-sprite-placeholder">🧑</div>`;

    const clearBtn = spriteUrl
        ? `<button id="btn-sprite-clear" class="rpg-btn-secondary summary-sprite-clear-btn"
                   title="Remove sprite">✕ Clear</button>`
        : '';

    return `
        <div class="summary-header-block">
            <div class="summary-sprite-wrapper">
                ${sprite}
            </div>
            <div class="summary-header-info">
                <div class="summary-sprite-field">
                    <span class="summary-sprite-label">Character Sprite</span>
                    <div class="summary-sprite-actions">
                        <label for="summary-sprite-file" class="rpg-btn-secondary summary-sprite-upload-btn">
                            ⬆ Upload Image
                        </label>
                        <input type="file" id="summary-sprite-file" accept="image/*" style="display:none;">
                        ${clearBtn}
                    </div>
                    <span class="summary-sprite-hint" id="summary-sprite-hint">${spriteUrl ? 'Loading…' : 'No image set.'}</span>
                </div>
            </div>
        </div>
    `;
}

/** Async: resolves the stored spriteUrl and injects the image into the DOM. */
async function _loadSpriteIntoDOM() {
    const ss        = extensionSettings.statSheet;
    const spriteUrl = ss?.spriteUrl || '';
    const el        = document.getElementById('summary-sprite-img');
    const hint      = document.getElementById('summary-sprite-hint');
    if (!el || !spriteUrl) return;

    const src = await _resolveSpriteSrc(spriteUrl);
    if (src) {
        if (el.tagName === 'IMG') {
            el.src = src;
            el.style.display = '';
        } else {
            // Replace placeholder div with img
            const img = document.createElement('img');
            img.id        = 'summary-sprite-img';
            img.className = 'summary-sprite';
            img.alt       = 'Character sprite';
            img.src       = src;
            img.onerror   = () => { img.style.display = 'none'; };
            el.replaceWith(img);
        }
        if (hint) hint.textContent = 'Image loaded.';
    } else {
        if (hint) hint.textContent = 'Image not found.';
    }
}

// ── Level block ──────────────────────────────────────────────────────────────

function renderLevelBlock(ss) {
    const lv = ss.level;
    if (!lv || (lv.showLevel === false && lv.showExp === false)) return '';
    const parts = [];
    if (lv.showLevel !== false) parts.push(`<span class="summary-stat-label">Level</span><span class="summary-stat-value">${lv.current || 1}</span>`);
    if (lv.showExp   !== false) parts.push(`<span class="summary-stat-label">EXP</span><span class="summary-stat-value">${lv.exp || 0}</span>`);
    return `<div class="summary-section summary-level-row">${parts.join('')}</div>`;
}

// ── Attributes block ─────────────────────────────────────────────────────────

function renderAttributesBlock(ss) {
    const attrs = (ss.attributes || []).filter(a => a.enabled);
    if (!attrs.length) return '';
    const mode = ss.mode;
    const rows = attrs.map(a => {
        const val = mode === 'numeric'
            ? a.value
            : `${a.rank || 'C'} <span style="opacity:0.55;font-size:10px;">(${a.rankValue || 0})</span>`;
        const skillsText = (a.skills || []).filter(s => s.enabled)
            .map(s => {
                const eff = getSkillEffectiveLevel(a.id, s.id);
                return eff > 0
                    ? `<span class="summary-skill-chip">${escapeHtml(s.name)} ${eff}</span>`
                    : null;
            })
            .filter(Boolean)
            .join('');
        return `<tr>
            <td class="summary-attr-name">${escapeHtml(a.name)}</td>
            <td class="summary-attr-val">${val}</td>
            <td class="summary-attr-skills">${skillsText}</td>
        </tr>`;
    }).join('');
    return `
        <div class="summary-section">
            <div class="summary-section-title">Attributes</div>
            <table class="summary-attrs-table">
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// ── Saving throws block ───────────────────────────────────────────────────────

function renderSavingThrowsBlock(ss) {
    const sts = (ss.savingThrows || []).filter(s => s.enabled !== false);
    if (!sts.length) return '';
    const sorted = sortSavingThrows(sts, ss.attributes || [], ss.stCategories || []);
    const rows = sorted.map(st => {
        let total = 0;
        try { total = calculateSavingThrowValue(st); } catch {}
        const formula = buildSavingThrowFormula(st);
        return `<tr>
            <td class="summary-attr-name">${escapeHtml(st.name)}</td>
            <td class="summary-attr-val summary-st-val">${total >= 0 ? '+' : ''}${total}</td>
            <td style="font-size:10px;opacity:0.55;">${escapeHtml(formula)}</td>
        </tr>`;
    }).join('');
    return `
        <div class="summary-section">
            <div class="summary-section-title">Saving Throws</div>
            <table class="summary-attrs-table">
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// ── Speed dice block ──────────────────────────────────────────────────────────

function renderSpeedDiceBlock(ss) {
    const sd = ss.speedDice;
    if (!sd?.enabled) return '';

    const linkedAttr = sd.attrId
        ? (ss.attributes || []).find(a => a.id === sd.attrId && a.enabled)
        : null;
    const attrValue = linkedAttr ? (linkedAttr.value ?? 0) : null;
    const _sides = v => { v=v||0; if(v<=2) return 6; if(v<=4) return 8; if(v<=6) return 10; return 12; };
    const sides = attrValue != null ? _sides(attrValue) : (sd.sides ?? 6);
    const modSign = (sd.modifier || 0) >= 0 ? '+' : '';
    const formula = `${sd.count || 1}d${sides}${modSign}${sd.modifier || 0}`;
    const attrNote = linkedAttr
        ? `<span class="summary-speed-attr">${escapeHtml(linkedAttr.name)} ${attrValue}</span>`
        : '';

    return `
        <div class="summary-section">
            <div class="summary-section-title">Speed Dice</div>
            <div class="summary-speed-row">
                <span class="summary-speed-dice">${formula}</span>
                ${attrNote}
            </div>
        </div>
    `;
}

// ── Affinities block ──────────────────────────────────────────────────────────

function renderAffinitiesBlock(ss) {
    const aff = ss.affinities;
    if (!aff?.enabled) return '';

    const weakness = aff.weakness || { type: 'Slash', pool: 'damage' };
    const weakVal  = weakness.pool === 'damage' ? 2 : 1;
    const mods     = aff.modifiers || {};
    const types    = ['Slash', 'Blunt', 'Pierce'];
    const pools    = ['damage', 'stagger'];

    const rows = types.map(type => {
        const cells = pools.map(pool => {
            const base = (type === weakness.type && pool === weakness.pool) ? weakVal : 0;
            const val  = base + (mods[type]?.[pool] ?? 0);
            const cls  = val > 0 ? 'aff-val-weak' : val < 0 ? 'aff-val-resist' : 'aff-val-neutral';
            const weakBadge = (type === weakness.type && pool === weakness.pool)
                ? '<span class="aff-weak-badge">(weak)</span>' : '';
            return `<td class="${cls}">${val >= 0 ? '+' : ''}${val}${weakBadge}</td>`;
        }).join('');
        return `<tr><td>${type}</td>${cells}</tr>`;
    }).join('');

    return `
        <div class="summary-section">
            <div class="summary-section-title">Damage Affinities</div>
            <table class="aff-summary-table">
                <thead><tr><th>Type</th><th>Damage</th><th>Stagger</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// ── Passives from jobs & feats ────────────────────────────────────────────────

function renderPassivesBlock(ss) {
    const passives = [];

    for (const job of (ss.jobs || []).filter(j => j.enabled !== false && (j.level || 0) > 0)) {
        if (job.description) passives.push({ source: job.name, text: job.description });
    }
    for (const feat of (ss.feats || []).filter(f => f.enabled)) {
        if (feat.description) passives.push({ source: feat.name, text: feat.description });
    }

    if (!passives.length) return '';

    const items = passives.map(p => `
        <div class="summary-passive-item">
            <span class="summary-passive-source">${escapeHtml(p.source)}</span>
            <span class="summary-passive-text">${escapeHtml(p.text)}</span>
        </div>
    `).join('');

    return `
        <div class="summary-section">
            <div class="summary-section-title">Passives</div>
            <div class="summary-passives-list">${items}</div>
        </div>
    `;
}

// ── Import / Export bar ───────────────────────────────────────────────────────

function renderImportExportBar() {
    return `
        <div class="summary-ie-bar">
            <span style="font-size:11px;opacity:0.6;">Stat Sheet Data</span>
            <button id="btn-export-statsheet" class="rpg-btn-secondary"
                    style="font-size:11px;padding:3px 10px;">⬇ Export JSON</button>
            <button id="btn-import-statsheet" class="rpg-btn-secondary"
                    style="font-size:11px;padding:3px 10px;">⬆ Import JSON</button>
            <input type="file" id="statsheet-import-file" accept=".json"
                   style="display:none;">
        </div>
    `;
}

// ============================================================================
// LISTENERS
// ============================================================================

function attachSummaryListeners() {
    // Sprite — local file upload → IndexedDB (never base64 in chat metadata)
    $(document).off('change', '#summary-sprite-file').on('change', '#summary-sprite-file', async function() {
        const file = this.files?.[0];
        if (!file) return;
        this.value = '';

        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            const key     = _spriteKey();
            try {
                await _saveSprite(key, dataUrl);
            } catch (err) {
                console.error('[SummaryTab] IndexedDB sprite save failed:', err);
                showNotification('Failed to save image. Storage may be unavailable.', 'error');
                return;
            }

            // Store only the key reference — no base64 in chat metadata or settings
            const ss = extensionSettings.statSheet;
            ss.spriteUrl = `idb:${key}`;
            const { saveStatSheetData } = await import('../../core/persistence.js');
            saveStatSheetData();

            // Update DOM directly (we already have the dataUrl in memory)
            const wrapper = document.querySelector('.summary-sprite-wrapper');
            if (wrapper) {
                wrapper.innerHTML = `<img id="summary-sprite-img" src="${dataUrl}" class="summary-sprite" alt="Character sprite">`;
            }
            const hint = document.getElementById('summary-sprite-hint');
            if (hint) hint.textContent = 'Image loaded.';
            const actions = document.querySelector('.summary-sprite-actions');
            if (actions && !document.getElementById('btn-sprite-clear')) {
                const btn = document.createElement('button');
                btn.id        = 'btn-sprite-clear';
                btn.className = 'rpg-btn-secondary summary-sprite-clear-btn';
                btn.title     = 'Remove sprite';
                btn.textContent = '✕ Clear';
                actions.appendChild(btn);
            }
        };
        reader.readAsDataURL(file);
    });

    // Sprite — clear (also removes from IndexedDB)
    $(document).off('click', '#btn-sprite-clear').on('click', '#btn-sprite-clear', async function() {
        const ss  = extensionSettings.statSheet;
        const ref = ss.spriteUrl || '';
        if (ref.startsWith('idb:')) {
            try { await _deleteSprite(ref.slice(4)); } catch { /* best-effort */ }
        }
        ss.spriteUrl = '';
        const { saveStatSheetData } = await import('../../core/persistence.js');
        saveStatSheetData();

        const wrapper = document.querySelector('.summary-sprite-wrapper');
        if (wrapper) wrapper.innerHTML = `<div id="summary-sprite-img" class="summary-sprite-placeholder">🧑</div>`;
        const hint = document.getElementById('summary-sprite-hint');
        if (hint) hint.textContent = 'No image set.';
        $(this).remove();
    });

    // Export
    $(document).off('click', '#btn-export-statsheet').on('click', '#btn-export-statsheet', function() {
        import('../../core/persistence.js').then(m => {
            const result = m.exportStatSheet();
            if (!result) { showNotification('Nothing to export.', 'info'); return; }
            const blob = new Blob([result], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = 'stat-sheet.json'; a.click();
            URL.revokeObjectURL(url);
            showNotification('Exported!', 'success');
        });
    });

    // Import — trigger file picker
    $(document).off('click', '#btn-import-statsheet').on('click', '#btn-import-statsheet', function() {
        $('#statsheet-import-file').trigger('click');
    });

    $(document).off('change', '#statsheet-import-file').on('change', '#statsheet-import-file', function() {
        const file = this.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const m = await import('../../core/persistence.js');
            const ok = await m.importStatSheet(e.target.result);
            if (ok) showNotification('Imported! Reload the tab to see changes.', 'success');
            else    showNotification('Import failed — invalid or corrupt JSON.', 'error');
        };
        reader.readAsText(file);
        // Reset so same file can be re-imported
        this.value = '';
    });
}

// ============================================================================
// UTILITY
// ============================================================================

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
