/**
 * Cultivation Tab  (Session 23 — Phase 1, Rev 2)
 *
 * Layout: 3-column stage — zone panels | body SVG | zone panels.
 * Corner layer-switcher grid lives inside the center column, top-right.
 * Bottom section is layer-specific (energy form / spirit root cores).
 */

import { extensionSettings }        from '../../core/state.js';
import { saveStatSheetData }        from '../../core/persistence.js';
import { generateUniqueId }         from './statSheetState.js';
import { buildPromptIncludeToggle } from './statSheetUI.js';
import { renderBodySVG }            from './bodyDiagram.js';

// ── Element colours (inlined — CSS vars unreliable inside SVG <line>) ─────────
const EC = {
    fire:'#e85d2a', water:'#3ab5d9', earth:'#c4892a', wind:'#6cce6c',
    lightning:'#c97de0', light:'#f5e060', dark:'#8844cc', ice:'#88ddee',
    default:'#8899aa',
};
const _ec = el => EC[(el||'').toLowerCase().trim()] || EC.default;

// ── Tier labels 1–20 ──────────────────────────────────────────────────────────
const TIER = [
    '','Mortal I','Mortal II','Mortal III',
    'Earth I','Earth II','Earth III',
    'Sky I','Sky II','Sky III',
    'King I','King II','King III',
    'Emperor I','Emperor II','Emperor III',
    'Saint I','Saint II','Saint III','Transcendent',
];

// ── Layer definitions (grid order: col0 top→bot, col1 top→bot) ────────────────
const LAYERS = [
    { id:'bodyCult',  icon:'🫀', label:'Body Cultivation', primary:true,  parent:null,         locked:true  },
    { id:'bloodCore', icon:'🩸', label:'Blood Core',       primary:false, parent:'bodyCult',   locked:true  },
    { id:'energy',    icon:'⚡', label:'Energy Layer',     primary:true,  parent:null,         locked:false },
    { id:'soulCore',  icon:'👁', label:'Soul Core',        primary:false, parent:'energy',     locked:true  },
    { id:'spiritRoot',icon:'✦',  label:'Spirit Root',      primary:true,  parent:null,         locked:false },
    { id:'cultArts',  icon:'📜', label:'Cultivation Arts', primary:false, parent:'spiritRoot', locked:true  },
];

// ── Zone panel layout (left col top→bot, right col top→bot) ──────────────────
const ZONES = [
    { id:'head',     side:'left',  label:'Head'      },
    { id:'armLeft',  side:'left',  label:'Left Arm'  },
    { id:'legLeft',  side:'left',  label:'Left Leg'  },
    { id:'torso',    side:'right', label:'Torso'     },
    { id:'armRight', side:'right', label:'Right Arm' },
    { id:'legRight', side:'right', label:'Right Leg' },
];

// ── Hex geometry — pointy-top, r=80, centre (80,190) ─────────────────────────
const HV = [30,90,150,210,270,330].map(deg => {
    const r = deg * Math.PI / 180;
    return { x:+(80 + 80*Math.cos(r)).toFixed(1), y:+(190 - 80*Math.sin(r)).toFixed(1) };
});

// ── Module-level layer state ──────────────────────────────────────────────────
let _layer = 'energy';

// ============================================================================
// PUBLIC
// ============================================================================

export function renderCultivationTab(container) {
    container.html(_html());
    _bind(container);
}

// ============================================================================
// HTML
// ============================================================================

function _html() {
    return `
        <div class="cult-tab">
            ${_header()}
            <div class="cult-stage">
                <div class="cult-stage-col">${_zonePanels('left')}</div>
                <div class="cult-stage-center" id="cult-stage-center">
                    ${renderBodySVG({ overlayGroups: _layer === 'spiritRoot' ? [_hexOverlay()] : [] })}
                </div>
                <div class="cult-stage-col">${_zonePanels('right')}</div>
            </div>
            <div class="cult-bottom" id="cult-bottom">${_bottom()}</div>
        </div>`;
}

function _header() {
    return `
        <div class="cult-tab-header">
            <h3 class="cult-tab-title">Cultivation</h3>
            <div class="cult-header-right">
                ${_cornerGrid()}
                ${buildPromptIncludeToggle('cultivation', 'Cult')}
            </div>
        </div>`;
}

// ── Corner layer switcher ─────────────────────────────────────────────────────

function _cornerGrid() {
    return `
        <div class="cult-corner-layers">
            ${LAYERS.map(l => {
                const active = l.id === _layer;
                const locked = l.locked || (!l.primary && l.parent !== _layer);
                return `<button
                    class="cult-corner-btn${active?' cult-corner-active':''}${locked?' cult-corner-locked':''}"
                    data-layer="${l.id}" title="${l.label}${locked?' (S24+)':''}"
                    ${locked?'disabled':''}>
                    ${l.icon}
                </button>`;
            }).join('')}
        </div>`;
}

// ── Zone panels ───────────────────────────────────────────────────────────────

function _zonePanels(side) {
    return ZONES.filter(z => z.side === side).map(z => `
        <div class="cult-zone-panel" data-zone="${z.id}">
            <div class="cult-zone-label">${z.label}</div>
            <div class="cult-zone-body">${_zoneBody(z)}</div>
        </div>`).join('');
}

function _zoneBody(zone) {
    if (_layer === 'bodyCult') return `<span class="cult-zone-locked">🔒 S24+</span>`;
    return `<span class="cult-zone-hint">—</span>`;
}

// ── Bottom section ────────────────────────────────────────────────────────────

function _bottom() {
    if (_layer === 'energy')     return _energyForm();
    if (_layer === 'spiritRoot') return _spiritRootBottom();
    return `<div class="cult-empty-note">No content for this layer in S23.</div>`;
}

// ── Energy layer ──────────────────────────────────────────────────────────────

function _energyForm() {
    const c   = _cult();
    const pct = c.threshold > 0 ? Math.min(100, Math.round((c.currentPool/c.threshold)*100)) : 0;
    return `
        <div id="cult-energy-panel">
            <div class="cult-section-title">⚡ Energy Layer</div>
            <div class="cult-field-row cult-field-row--split">
                <div class="cult-field-half">
                    <label class="cult-label">Primary Path</label>
                    <input class="cult-input" id="cult-primaryPath" value="${_e(c.primaryPath)}" placeholder="qi / mana / lua…"/>
                </div>
                <div class="cult-field-half">
                    <label class="cult-label">Realm</label>
                    <input class="cult-input" id="cult-realm" value="${_e(c.realm)}" placeholder="Core Formation…"/>
                </div>
            </div>
            <div class="cult-field-row cult-field-row--split">
                <div class="cult-field-half">
                    <label class="cult-label">Sub-Stage</label>
                    <input class="cult-input cult-input--narrow" id="cult-subStage" type="number" value="${c.subStage||0}" min="0"/>
                </div>
                <div class="cult-field-half">
                    <label class="cult-label">Breakthrough %</label>
                    <input class="cult-input" id="cult-btChance" value="${_e(c.breakthroughChance)}" placeholder="e.g. 65%"/>
                </div>
            </div>
            <div class="cult-field-row">
                <label class="cult-label">Energy Pool</label>
                <div class="cult-progress-wrap">
                    <div class="cult-progress-bar">
                        <div class="cult-progress-fill" id="cult-pool-bar" style="width:${pct}%"></div>
                    </div>
                    <span class="cult-progress-pct" id="cult-pool-pct">${pct}%</span>
                </div>
                <div class="cult-field-row cult-field-row--split">
                    <div class="cult-field-half">
                        <label class="cult-label">Current</label>
                        <input class="cult-input" id="cult-currentPool" type="number" value="${c.currentPool||0}" min="0"/>
                    </div>
                    <div class="cult-field-half">
                        <label class="cult-label">Threshold</label>
                        <input class="cult-input" id="cult-threshold" type="number" value="${c.threshold||0}" min="0"/>
                    </div>
                </div>
            </div>
            <div class="cult-field-row">
                <label class="cult-label">Notes</label>
                <textarea class="cult-textarea" id="cult-notes">${_e(c.cultivationNotes)}</textarea>
            </div>
            <div class="cult-footer-actions">
                <button class="cult-btn-save" id="cult-energy-save">Save</button>
            </div>
        </div>`;
}

// ── Spirit Root layer ─────────────────────────────────────────────────────────

function _spiritRootBottom() {
    const c   = _cult();
    const all = _roots(c);
    return `
        <div id="cult-spirit-panel">
            <div class="cult-section-title">✦ Spirit Root</div>
            ${_hexLegend(all)}
            <div class="cult-cores-list">
                ${['mindCore','bloodCore','energyCore'].map(k => _coreSection(c, k)).join('')}
            </div>
        </div>`;
}

function _coreSection(c, key) {
    const core  = c.cores?.[key] || { name:key, spiritRoots:[] };
    const roots = core.spiritRoots || [];
    return `
        <div class="cult-core-section" data-core="${key}">
            <div class="cult-core-header">
                <span class="cult-core-pip"></span>
                <input class="cult-core-name-input" data-core-rename="${key}"
                       value="${_e(core.name)}" title="Rename core"/>
                <span class="cult-core-count">${roots.length}</span>
            </div>
            <div class="cult-core-roots">
                ${roots.length ? roots.map(_rootCard).join('') : '<div class="cult-empty-note">No spirit roots.</div>'}
                <button class="cult-btn-add" data-add-root="${key}">+ Add Spirit Root</button>
            </div>
        </div>`;
}

function _rootCard(root) {
    const col  = _ec(root.element);
    const qLbl = TIER[Math.min(root.quality||1, 20)] || '—';
    const pLbl = TIER[Math.min(root.purity||1,  20)] || '—';
    return `
        <div class="cult-root-card${root.enabled?'':' cult-root-card--disabled'}" data-root-id="${root.id}">
            <div class="cult-root-header">
                <span class="cult-root-dot" style="background:${col}"></span>
                <input class="cult-root-input" data-root-field="name" data-root-id="${root.id}"
                       value="${_e(root.name)}" placeholder="Root name"/>
                <button class="cult-btn-rm" data-rm-root="${root.id}" title="Remove">✕</button>
            </div>
            <div class="cult-root-meta">
                <span>Quality: <strong>${qLbl}</strong></span>
                <span>Purity: <strong>${pLbl}</strong></span>
                <span>${root.classification==='derivative'?'⊕ Derivative':'◯ Pure'}</span>
                ${root.hexSide!=null?`<span>Side ${root.hexSide}</span>`:''}
            </div>
            <div class="cult-root-edit">
                <label>Element
                    <input class="cult-root-input cult-root-input--sm"
                           data-root-field="element" data-root-id="${root.id}"
                           value="${_e(root.element)}" placeholder="fire…"/>
                </label>
                <label>Quality
                    <input class="cult-root-input cult-root-input--num" type="number"
                           data-root-field="quality" data-root-id="${root.id}"
                           value="${root.quality||1}" min="1" max="20"/>
                </label>
                <label>Purity
                    <input class="cult-root-input cult-root-input--num" type="number"
                           data-root-field="purity" data-root-id="${root.id}"
                           value="${root.purity||1}" min="1" max="20"/>
                </label>
                <label>Side
                    <select class="cult-root-select" data-root-field="hexSide" data-root-id="${root.id}">
                        <option value="">—</option>
                        ${[0,1,2,3,4,5].map(n=>`<option value="${n}" ${root.hexSide===n?'selected':''}>${n}</option>`).join('')}
                    </select>
                </label>
                <label>
                    <select class="cult-root-select" data-root-field="classification" data-root-id="${root.id}">
                        <option value="pure"       ${root.classification!=='derivative'?'selected':''}>Pure</option>
                        <option value="derivative" ${root.classification==='derivative'?'selected':''}>Derivative</option>
                    </select>
                </label>
                <label class="cult-check-label">
                    <input type="checkbox" data-root-field="enabled" data-root-id="${root.id}"
                           ${root.enabled?'checked':''}/>
                    Enabled
                </label>
            </div>
        </div>`;
}

// ── Hex overlay ───────────────────────────────────────────────────────────────

function _hexOverlay() {
    const all = _roots(_cult());
    const map = {};
    for (const r of all) { if (r.enabled && r.hexSide != null) map[r.hexSide] = r; }

    const lines = Array.from({length:6}, (_,i) => {
        const a=HV[i], b=HV[(i+1)%6], r=map[i];
        return r
            ? `<line class="cult-hex-side--active" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${_ec(r.element)}" stroke-width="3"/>`
            : `<line class="cult-hex-side--inactive" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--cult-side-inactive,#2a3040)" stroke-width="2"/>`;
    }).join('');

    const dots = [[80,55,'M'],[80,130,'B'],[80,152,'E']].map(([cx,cy,l])=>`
        <circle class="cult-core-dot" cx="${cx}" cy="${cy}" r="5"/>
        <text class="cult-core-dot-label" x="${cx}" y="${cy-8}" font-size="8" text-anchor="middle">${l}</text>`).join('');

    return `<g class="cult-hex-overlay">${lines}${dots}</g>`;
}

function _hexLegend(all) {
    const active = all.filter(r => r.enabled && r.element);
    if (!active.length) return `<div class="cult-empty-note" style="font-size:10px">No active roots with elements assigned.</div>`;
    return `
        <div class="cult-hex-legend">
            ${active.map(r=>`
                <div class="cult-legend-item">
                    <span class="cult-legend-dot" style="background:${_ec(r.element)}"></span>
                    <span class="cult-legend-text">${_e(r.name)} — ${_e(r.element)}</span>
                </div>`).join('')}
        </div>`;
}

// ============================================================================
// EVENTS  (all delegated on container — survives partial re-renders)
// ============================================================================

function _bind(container) {
    // Remove all previously bound .cult handlers before re-binding.
    // Without this, every layer switch calls _bind again on the same container,
    // causing each delegated handler to fire N times (once per prior bind call).
    container.off('.cult');

    container.on('click.cult', '.cult-corner-btn:not(:disabled)', function () {
        _layer = $(this).data('layer');
        container.html(_html());
        _bind(container);
    });

    // Energy: live pool bar
    container.on('input.cult', '#cult-currentPool, #cult-threshold', function () {
        const cur = parseFloat($('#cult-currentPool').val()) || 0;
        const thr = parseFloat($('#cult-threshold').val()) || 0;
        const pct = thr > 0 ? Math.min(100, Math.round((cur/thr)*100)) : 0;
        $('#cult-pool-bar').css('width', pct+'%');
        $('#cult-pool-pct').text(pct+'%');
    });

    // Energy: save
    container.on('click.cult', '#cult-energy-save', function () {
        const c = _cult();
        c.primaryPath        = $('#cult-primaryPath').val().trim();
        c.realm              = $('#cult-realm').val().trim();
        c.subStage           = parseInt($('#cult-subStage').val(),10) || 0;
        c.currentPool        = parseFloat($('#cult-currentPool').val()) || 0;
        c.threshold          = parseFloat($('#cult-threshold').val()) || 0;
        c.breakthroughChance = $('#cult-btChance').val().trim();
        c.cultivationNotes   = $('#cult-notes').val();
        saveStatSheetData();
        const btn = $(this);
        btn.text('Saved ✓').prop('disabled', true);
        setTimeout(() => btn.text('Save').prop('disabled', false), 1200);
    });

    // Core rename
    container.on('change.cult', '[data-core-rename]', function () {
        const key = $(this).data('core-rename');
        const c   = _cult();
        if (c.cores?.[key]) { c.cores[key].name = $(this).val().trim() || key; saveStatSheetData(); }
    });

    // Add root
    container.on('click.cult', '[data-add-root]', function () {
        const key = $(this).data('add-root');
        const c   = _cult();
        if (!c.cores?.[key]) return;
        c.cores[key].spiritRoots.push({
            id: generateUniqueId(), name:'New Spirit Root',
            element:'', classification:'pure', derivedFrom:[],
            quality:5, purity:5, hexSide:null, notes:'', enabled:true,
        });
        saveStatSheetData();
        _reBottom(container);
    });

    // Remove root
    container.on('click.cult', '[data-rm-root]', function () {
        const id = $(this).data('rm-root');
        const c  = _cult();
        for (const k of ['mindCore','bloodCore','energyCore']) {
            const arr = c.cores?.[k]?.spiritRoots;
            if (!arr) continue;
            const i = arr.findIndex(r => r.id === id);
            if (i !== -1) { arr.splice(i,1); saveStatSheetData(); break; }
        }
        _reBottom(container);
    });

    // Root field change
    container.on('change.cult', '[data-root-field]', function () {
        const field = $(this).data('root-field');
        const id    = $(this).data('root-id');
        const c     = _cult();
        let root = null;
        for (const k of ['mindCore','bloodCore','energyCore']) {
            root = (c.cores?.[k]?.spiritRoots||[]).find(r => r.id === id);
            if (root) break;
        }
        if (!root) return;

        if      (field === 'enabled')                       root[field] = $(this).is(':checked');
        else if (field === 'hexSide')                       root[field] = $(this).val()==='' ? null : parseInt($(this).val(),10);
        else if (field === 'quality' || field === 'purity') root[field] = Math.min(20,Math.max(1,parseInt($(this).val(),10)||1));
        else                                                root[field] = $(this).val();

        saveStatSheetData();

        // Visual-only refresh for element/hexSide/enabled changes
        if (['element','hexSide','enabled'].includes(field)) {
            $('#cult-stage-center').html(renderBodySVG({ overlayGroups:[_hexOverlay()] }));
            _reBottom(container);
        }
    });
}

function _reBottom(container) {
    container.find('#cult-bottom').html(_bottom());
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function _cult() {
    const ss = extensionSettings.statSheet;
    if (!ss.cultivation) ss.cultivation = {};
    const c = ss.cultivation;
    if (!c.cores) c.cores = {
        mindCore:  { name:'Mind Core',   spiritRoots:[] },
        bloodCore: { name:'Blood Core',  spiritRoots:[] },
        energyCore:{ name:'Energy Core', spiritRoots:[] },
    };
    return c;
}

function _roots(c) {
    return [
        ...(c.cores?.mindCore?.spiritRoots   || []),
        ...(c.cores?.bloodCore?.spiritRoots  || []),
        ...(c.cores?.energyCore?.spiritRoots || []),
    ];
}

function _e(s) {
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
