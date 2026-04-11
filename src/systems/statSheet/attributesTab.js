/**
 * Attributes Tab Module  (v3 — Session 4 clean)
 */

import { extensionSettings } from '../../core/state.js';
import {
    addAttribute,
    removeAttribute,
    updateAttributeValue,
    addSkill,
    removeSkill,
    updateSkillLevel,
    toggleDisplayMode,
    generateUniqueId,
    calculateSavingThrowValue,
    buildSavingThrowFormula,
    addSavingThrowAttributeTerm,
    addSavingThrowFlatTerm,
    addSavingThrowLevelTerm,
    addSavingThrowSkillTerm,
    addSavingThrowSubSkillTerm,
    removeSavingThrowTerm,
    updateSavingThrowTermMultiplier,
    updateSavingThrowFlatTermValue,
    updateSavingThrowFlatTermLabel,
    getSkillEffectiveLevel,
    addSubSkill,
    removeSubSkill,
    updateSubSkillLevel,
    calculateUpgradeCost,
    spendExpOnSkill,
    spendExpOnAlphaSkill,
    spendExpOnSubSkill,
    checkFeatPrerequisites,
    RANKS,
    addSTCategory,
    removeSTCategory,
    renameSTCategory,
    setSavingThrowCategory,
    sortSavingThrows
} from './statSheetState.js';
import { saveStatSheetData, saveSettings } from '../../core/persistence.js';
import { refreshCurrentTab, showNotification, buildPromptIncludeToggle } from './statSheetUI.js';
import { executeRollCommand, updateDiceDisplay } from '../features/dice.js';
import { logDiceRoll } from '../interaction/diceLog.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let isMasterMode   = false;
let stLayout       = 'list';
const _expandedSTIds = new Set(); // tracks which ST cards are open in master mode

// ============================================================================
// GRADE / MODIFIER HELPERS
// ============================================================================

/**
 * Returns the configured base numeric value for a letter rank.
 * Source: extensionSettings.statSheet.editorSettings.gradeValueMap
 */
function getGradeValue(rank) {
    const map = extensionSettings.statSheet?.editorSettings?.gradeValueMap || {};
    return map[rank] || 0;
}

/**
 * Computes the total attribute modifier used in all roll calculations.
 *
 * Numeric mode:    attr.value  (raw number, used as-is)
 * Alphabetic mode: gradeValue(attr.rank) + floor(attr.rankValue ÷ divisor)
 *
 * This is the single source of truth — never compute attrModifier inline.
 */
function getAttrModifier(attr, mode) {
    if (mode === 'numeric') return attr.value || 0;
    const divisor  = extensionSettings.statSheet?.editorSettings?.attrValueDivisor || 100;
    return getGradeValue(attr.rank) + Math.floor((attr.rankValue || 0) / divisor);
}

// ============================================================================
// BONUS HELPERS  (kept here — used for attribute/skill bonus badges)
// ============================================================================

/**
 * Sum all active job+feat stat bonuses for a given attribute.
 * Returns a flat number to add on top of base value.
 */
export function computeAttrBonus(attrId) {
    const ss = extensionSettings.statSheet;
    let bonus = 0;
    for (const job of (ss.jobs || []).filter(j => j.enabled !== false)) {
        for (const sb of (job.statBonuses || [])) {
            if (sb.type === 'attribute' && sb.targetId === attrId) bonus += (sb.value || 0);
        }
    }
    for (const feat of (ss.feats || []).filter(f => f.enabled !== false)) {
        // Skip feats whose prerequisites aren't met — they show as Locked in the UI
        if (!checkFeatPrerequisites(feat.id).met) continue;
        for (const sb of (feat.statBonuses || [])) {
            if (sb.type === 'attribute' && sb.targetId === attrId) bonus += (sb.value || 0);
        }
    }
    for (const aug of (ss.augments || []).filter(a => a.enabled !== false)) {
        for (const sb of (aug.statBonuses || [])) {
            if (sb.type === 'attribute' && sb.targetId === attrId) bonus += (sb.value || 0);
        }
    }
    for (const item of (ss.gear || []).filter(g => g.equipped !== false)) {
        for (const sb of (item.statBonuses || [])) {
            if (sb.type === 'attribute' && sb.targetId === attrId) bonus += (sb.value || 0);
        }
    }
    return bonus;
}

/**
 * Sum all active job+feat stat bonuses for a given skill.
 */
export function computeSkillBonus(skillId) {
    const ss = extensionSettings.statSheet;
    let bonus = 0;
    for (const job of (ss.jobs || []).filter(j => j.enabled !== false)) {
        for (const sb of (job.statBonuses || [])) {
            if (sb.type === 'skill' && sb.targetId === skillId) bonus += (sb.value || 0);
        }
    }
    for (const feat of (ss.feats || []).filter(f => f.enabled !== false)) {
        if (!checkFeatPrerequisites(feat.id).met) continue;
        for (const sb of (feat.statBonuses || [])) {
            if (sb.type === 'skill' && sb.targetId === skillId) bonus += (sb.value || 0);
        }
    }
    for (const aug of (ss.augments || []).filter(a => a.enabled !== false)) {
        for (const sb of (aug.statBonuses || [])) {
            if (sb.type === 'skill' && sb.targetId === skillId) bonus += (sb.value || 0);
        }
    }
    for (const item of (ss.gear || []).filter(g => g.equipped !== false)) {
        for (const sb of (item.statBonuses || [])) {
            if (sb.type === 'skill' && sb.targetId === skillId) bonus += (sb.value || 0);
        }
    }
    return bonus;
}

// ============================================================================
// MAIN RENDER ENTRY POINT
// ============================================================================

export function renderAttributesTab(container) {
    console.log('[Attributes Tab] Rendering... mode:', isMasterMode ? 'MASTER' : 'PLAYER');

    if (!extensionSettings.statSheet) {
        console.error('[Attributes Tab] statSheet is undefined!');
        container.html('<div class="error-message">Error: Stat sheet not initialized</div>');
        return;
    }

    if (isMasterMode) {
        container.html(renderMasterModeHTML());
        attachMasterModeEventListeners();
        initializeSortable();
    } else {
        container.html(renderPlayerModeHTML());
        attachPlayerModeEventListeners();
    }

    attachToggleListener();
}

// ============================================================================
// PLAYER MODE — HTML
// ============================================================================

function renderPlayerModeHTML() {
    const { attributes, savingThrows, level, mode } = extensionSettings.statSheet;

    return `
        <div class="attributes-tab player-mode">
            <div class="tab-header">
                <div class="header-left"><h3>Character Stats</h3></div>
                <div class="header-right">
                    ${buildPromptIncludeToggle('attributes', 'Attrs')}
                    ${buildPromptIncludeToggle('savingThrows', 'Saves')}
                    <button id="btn-toggle-edit-mode" class="btn-toggle-mode" title="Switch to Master Mode">
                        ⚙️ Master
                    </button>
                </div>
            </div>

            ${renderLevelExpSection(level)}

            <div class="attributes-section">
                <div class="section-header">
                    <h4>Attributes</h4>
                    <span class="attribute-count">(${attributes.filter(a => a.enabled).length} active)</span>
                </div>
                <div class="attributes-list-view">
                    ${attributes.filter(a => a.enabled).map(attr => renderPlayerAttribute(attr, mode, savingThrows)).join('')}
                </div>
            </div>

            ${renderPlayerSavingThrows(savingThrows.filter(st => !st.parentAttrId || !attributes.find(a => a.id === st.parentAttrId && a.enabled)))}

            ${renderAffinitySection()}

            ${renderSpeedDicePlayerView()}
        </div>
    `;
}

// ── Player Mode: read-only Speed Dice display ────────────────────────────────

function renderSpeedDicePlayerView() {
    const ss = extensionSettings.statSheet;
    const sd = ss?.speedDice;
    if (!sd?.enabled) return '';

    const attrs      = (ss.attributes || []).filter(a => a.enabled);
    const linkedAttr = attrs.find(a => a.id === sd.attrId);
    const attrValue  = linkedAttr ? (linkedAttr.value ?? 0) : null;
    const sides      = attrValue != null ? _speedDieSides(attrValue) : (sd.sides ?? 6);
    const modSign    = (sd.modifier || 0) >= 0 ? '+' : '';
    const formula    = `${sd.count ?? 1}d${sides}${modSign}${sd.modifier || 0}`;
    const attrHint   = linkedAttr
        ? `<span class="speed-dice-attr-hint">(${escapeHtml(linkedAttr.name)} ${attrValue})</span>`
        : '';

    return `
        <div class="speed-dice-section speed-dice-readonly">
            <div class="speed-dice-header">
                <h4 class="speed-dice-title">Speed Dice</h4>
            </div>
            <div class="speed-dice-body">
                <div class="speed-dice-row">
                    <div class="speed-dice-preview">${formula}</div>
                    ${attrHint}
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// PLAYER MODE — ATTRIBUTE RENDERER
// ============================================================================

function renderPlayerAttribute(attr, mode, savingThrows = []) {
    const isCollapsed  = attr.collapsed === true;
    const attrBonus    = computeAttrBonus(attr.id);
    const divisor      = mode === 'alphabetic'
        ? (extensionSettings.statSheet?.editorSettings?.attrValueDivisor || 100)
        : 1;
    const attrBonusMod = mode === 'alphabetic' ? Math.floor(attrBonus / divisor) : attrBonus;
    const attrModifier = getAttrModifier(attr, mode) + attrBonusMod;

    let valueDisplay;
    if (mode === 'numeric') {
        const effective = (attr.value || 0) + attrBonus;
        const bonusBadge = attrBonus !== 0
            ? `<span class="stat-bonus-indicator" title="Base: ${attr.value}, Bonus: ${attrBonus > 0 ? '+' : ''}${attrBonus}">${attrBonus > 0 ? '+' : ''}${attrBonus}</span>`
            : '';
        valueDisplay = `<span class="view-value-badge">${effective}</span>${bonusBadge}`;
    } else {
        const glowing = attr.threshold > 0 && attr.rankValue >= attr.threshold;
        // effectiveRankVal adds the raw bonus in rankValue units (e.g. 300),
        // so the displayed number reflects the true total rankValue (e.g. 600).
        // attrBonusMod (the divided modifier, e.g. +3) is only used for the badge and rolls.
        const effectiveRankVal = (attr.rankValue || 0) + attrBonus;
        const bonusBadge = attrBonusMod !== 0
            ? `<span class="stat-bonus-indicator" title="Base: ${attr.rankValue}, Bonus: ${attrBonusMod > 0 ? '+' : ''}${attrBonusMod}">${attrBonusMod > 0 ? '+' : ''}${attrBonusMod}</span>`
            : '';
        valueDisplay = `
            <span class="view-rank-badge ${glowing ? 'rank-threshold-glow' : ''}" data-rank="${attr.rank}">
                ${escapeHtml(attr.rank)}
            </span>
            <span class="view-value-badge">${effectiveRankVal}</span>${bonusBadge}
        `;
    }

    const enabledSkills = (attr.skills || []).filter(s => s.enabled);
    const childSaves = savingThrows.filter(st => st.parentAttrId === attr.id && st.enabled);

    let childSavesHTML = '';
    if (childSaves.length > 0) {
        childSavesHTML = `
            <div class="attr-st-inline-view">
                ${childSaves.map(st => {
                    const total = calculateSavingThrowValue(st);
                    return `
                        <div class="skill-item view-skill-item st-inline-player-item" data-skill-id="${st.id}">
                            <div class="view-skill-top-row">
                                <span class="st-player-badge" title="Saving Throw">🛡</span>
                                <span class="view-skill-name st-player-name">${escapeHtml(st.name)}</span>
                                <div class="view-skill-controls">
                                    <span class="view-value-badge">${total}</span>
                                    <button class="btn-roll-skill btn-roll-save"
                                            data-skill-id="${st.id}"
                                            data-attr-name="${escapeHtml(st.name)}"
                                            data-skill-name="${escapeHtml(st.name)} Save"
                                            data-attr-val="${total}"
                                            data-skill-val="0"
                                            data-rank=""
                                            title="Roll ${escapeHtml(st.name)} Save">
                                        <span class="roll-btn-icon">🎲</span>
                                        <span class="roll-btn-modifier">+${total}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    return `
        <div class="attribute-item" data-attr-id="${attr.id}">
            <div class="attribute-header">
                <button class="btn-collapse-attr"
                        data-attr-id="${attr.id}"
                        title="${isCollapsed ? 'Expand skills' : 'Collapse skills'}">
                    ${isCollapsed ? '▶' : '▼'}
                </button>
                <span class="view-attr-name">${escapeHtml(attr.name)}</span>
                <div class="view-attr-controls">
                    ${valueDisplay}
                    <button class="btn-roll-skill btn-roll-attr"
                            data-attr-id="${attr.id}"
                            data-skill-id=""
                            data-attr-name="${escapeHtml(attr.name)}"
                            data-skill-name="${escapeHtml(attr.name)} Check"
                            data-attr-val="${attrModifier}"
                            data-skill-val="0"
                            data-rank="${mode === 'alphabetic' ? escapeHtml(attr.rank) : ''}"
                            data-attr-grade-val="${mode === 'alphabetic' ? getGradeValue(attr.rank) : ''}"
                            data-attr-base-val="${mode === 'alphabetic' ? Math.floor((attr.rankValue || 0) / (extensionSettings.statSheet?.editorSettings?.attrValueDivisor || 100)) : ''}"
                            data-attr-bonus-mod="${attrBonusMod}"
                            title="Roll ${escapeHtml(attr.name)} Check">
                        <span class="roll-btn-icon">🎲</span>
                        <span class="roll-btn-modifier">+${attrModifier}</span>
                    </button>
                </div>
            </div>
            <div class="attr-skills-view ${isCollapsed ? 'collapsed' : ''}">
                ${enabledSkills.length === 0 && childSaves.length === 0
                    ? `<div class="view-no-skills">No skills or saves</div>`
                    : enabledSkills.map(s => renderPlayerSkill(attr, s, mode)).join('')}
                ${childSavesHTML}
            </div>
        </div>
    `;
}

// ============================================================================
// PLAYER MODE — SKILL RENDERER
// ============================================================================

function renderPlayerSkill(attr, skill, mode) {
    if (!skill.mode) skill.mode = 'numeric';

    // Include job/feat bonuses in the attribute modifier used by all roll buttons
    const attrBonusForRoll = computeAttrBonus(attr.id);

    // ── NEW: in alphabetic mode, bonus is stored in rankValue units; divide by divisor ──
    const divisor = mode === 'alphabetic'
    ? (extensionSettings.statSheet?.editorSettings?.attrValueDivisor || 100)
    : 1;
    const attrBonusMod = mode === 'alphabetic' ? Math.floor(attrBonusForRoll / divisor) : attrBonusForRoll;
    const attrModifier = getAttrModifier(attr, mode) + attrBonusMod;
    const effectiveLevel   = getSkillEffectiveLevel(attr.id, skill.id);
    const hasSubs        = skill.mode === 'numeric'
                        && (skill.subSkills || []).filter(s => s.enabled).length > 0;

    // ── Skill modifier & value display ────────────────────────────────────────
    let skillModifier, valueDisplay;

    if (skill.mode === 'numeric') {
        skillModifier = effectiveLevel;
        valueDisplay  = `<span class="view-value-badge">${effectiveLevel}</span>`;
    } else {
        // Alphabetic: grade value only. No numeric box beside the badge.
        skillModifier = getGradeValue(skill.rank);
        const glowing = skill.threshold > 0 && skill.rankValue >= skill.threshold;
        valueDisplay  = `
            <span class="view-rank-badge ${glowing ? 'rank-threshold-glow' : ''}" data-rank="${skill.rank}">
                ${escapeHtml(skill.rank)}
            </span>
        `;
    }

    const totalModifier = attrModifier + skillModifier;

    // ── Raise button (numeric without subs, or alphabetic) ────────────────────
    let raiseBtn = '';
    if (skill.mode === 'numeric' && !hasSubs) {
        const cost      = calculateUpgradeCost(skill.level || 0, skill.expCost || 'normal');
        const canAfford = (extensionSettings.statSheet.level.exp || 0) >= cost;
        raiseBtn = `
            <button class="btn-raise-skill ${canAfford ? '' : 'btn-raise-disabled'}"
                    data-attr-id="${attr.id}"
                    data-skill-id="${skill.id}"
                    title="${canAfford ? `Spend ${cost} EXP to raise` : `Need ${cost} EXP`}"
                    ${canAfford ? '' : 'disabled'}>
                Raise <span class="raise-cost">${cost} EXP</span>
            </button>
        `;
    } else if (skill.mode === 'alphabetic') {
        const rankIdx   = RANKS.indexOf(skill.rank || 'C');
        const atMaxRank = rankIdx < 0 || rankIdx >= RANKS.length - 1;
        const cost      = atMaxRank ? null : calculateUpgradeCost(rankIdx, skill.expCost || 'normal');
        const canAfford = !atMaxRank && (extensionSettings.statSheet.level.exp || 0) >= cost;
        const nextRank  = atMaxRank ? null : RANKS[rankIdx + 1];
        raiseBtn = `
            <button class="btn-raise-skill btn-raise-alpha-skill ${(atMaxRank || !canAfford) ? 'btn-raise-disabled' : ''}"
                    data-attr-id="${attr.id}"
                    data-skill-id="${skill.id}"
                    title="${atMaxRank
                        ? 'Already at max rank (EX)'
                        : canAfford
                            ? `Spend ${cost} EXP to advance to ${nextRank}`
                            : `Need ${cost} EXP`}"
                    ${(atMaxRank || !canAfford) ? 'disabled' : ''}>
                ${atMaxRank ? '⭐ EX' : `↑ ${nextRank}`}${!atMaxRank ? ` <span class="raise-cost">${cost} EXP</span>` : ''}
            </button>
        `;
    }

    // ── Sub-skills (numeric parent only) ─────────────────────────────────────
    let subSkillsHTML = '';
    if (hasSubs) {
        const ss          = extensionSettings.statSheet;
        const enabledSubs = (skill.subSkills || []).filter(s => s.enabled);

        // Primary signal: is this skill itself a job tree?
        // A skill is a job tree if any enabled job maps this skill's name as a
        // tree type to this exact attribute.  When true, ALL its subs are
        // job-managed (no EXP raise), regardless of whether sub.jobId is set.
        // sub.jobId is kept as a secondary/fallback for subs under non-tree skills.
        const isJobTreeSkill = (ss.jobs || []).some(j => {
            if (j.enabled === false) return false;
            const attrMap = j.treeTypeAttributeMap || {};
            return Object.entries(attrMap).some(([treeName, mappedAttrId]) =>
                mappedAttrId === attr.id &&
                treeName.toLowerCase() === skill.name.toLowerCase()
            );
        });

        const jobSubs    = isJobTreeSkill
            ? enabledSubs                                   // all subs are job-owned
            : enabledSubs.filter(s => s.jobId);            // fallback: explicit tag only
        const manualSubs = isJobTreeSkill
            ? []
            : enabledSubs.filter(s => !s.jobId);

        // Build the label (only shown when there are job subs)
        let jobGroupLabel = null;
        if (jobSubs.length > 0) {
            const treeLabels = [];
            for (const job of (ss.jobs || []).filter(j => j.enabled !== false)) {
                const attrMap = job.treeTypeAttributeMap || {};
                for (const [treeName, mappedAttrId] of Object.entries(attrMap)) {
                    if (
                        mappedAttrId === attr.id &&
                        treeName.toLowerCase() === skill.name.toLowerCase()
                    ) {
                        treeLabels.push(`${job.name}: ${treeName}`);
                    }
                }
            }
            if (treeLabels.length > 0) jobGroupLabel = treeLabels.join(' / ');
        }

        // Shared row renderer; showRaiseBtn=true only for manual subs
        const renderSubRow = (sub, showRaiseBtn) => {
            const subMod  = attrModifier + (sub.level || 0);
            const cost    = calculateUpgradeCost(sub.level || 0, sub.expCost || 'normal');
            const afford  = (ss.level?.exp || 0) >= cost;
            const raiseBtnHtml = showRaiseBtn
                ? `<button class="btn-raise-subskill ${afford ? '' : 'btn-raise-disabled'}"
                           data-attr-id="${attr.id}"
                           data-skill-id="${skill.id}"
                           data-subskill-id="${sub.id}"
                           title="${afford ? `Spend ${cost} EXP to raise` : `Need ${cost} EXP`}"
                           ${afford ? '' : 'disabled'}>
                       Raise <span class="raise-cost">${cost} EXP</span>
                   </button>`
                : '';
            return `
                <div class="subskill-item-view">
                    <span class="subskill-name-view">${escapeHtml(sub.name)}</span>
                    <div class="subskill-view-controls">
                        <span class="subskill-level-view">${sub.level || 0}</span>
                        <button class="btn-roll-skill btn-roll-subskill"
                                data-attr-id="${attr.id}"
                                data-skill-id="${skill.id}"
                                data-subskill-id="${sub.id}"
                                data-attr-name="${escapeHtml(attr.name)}"
                                data-skill-name="${escapeHtml(skill.name)}"
                                data-attr-val="${attrModifier}"
                                data-skill-val="0"
                                data-subskill-name="${escapeHtml(sub.name)}"
                                data-subskill-val="${sub.level || 0}"
                                data-rank="${mode === 'alphabetic' ? escapeHtml(attr.rank) : ''}"
                                data-attr-bonus-mod="${attrBonusMod}"
                                title="${escapeHtml(sub.name)}: ${attrModifier} + ${sub.level || 0} = +${subMod}">
                            <span class="roll-btn-icon">🎲</span>
                            <span class="roll-btn-modifier">+${subMod}</span>
                        </button>
                        ${raiseBtnHtml}
                    </div>
                </div>
            `;
        };

        subSkillsHTML = `
            <div class="subskills-list-view">
                ${jobSubs.length > 0 ? `
                    ${jobGroupLabel ? `<div class="subskill-tree-type-label">${escapeHtml(jobGroupLabel)}</div>` : ''}
                    ${jobSubs.map(sub => renderSubRow(sub, false)).join('')}
                ` : ''}
                ${manualSubs.map(sub => renderSubRow(sub, true)).join('')}
            </div>
        `;
    }

    return `
        <div class="skill-item view-skill-item" data-skill-id="${skill.id}" data-attr-id="${attr.id}">
            <div class="view-skill-top-row">
                <span class="view-skill-name">${escapeHtml(skill.name)}</span>
                <div class="view-skill-controls">
                    ${valueDisplay}
                    <button class="btn-roll-skill"
                            data-attr-id="${attr.id}"
                            data-skill-id="${skill.id}"
                            data-attr-name="${escapeHtml(attr.name)}"
                            data-skill-name="${escapeHtml(skill.name)}"
                            data-attr-val="${attrModifier}"
                            data-skill-val="${skillModifier}"
                            data-rank="${mode === 'alphabetic' ? escapeHtml(attr.rank) : ''}"
                            data-attr-grade-val="${mode === 'alphabetic' ? getGradeValue(attr.rank) : ''}"
                            data-attr-base-val="${mode === 'alphabetic' ? Math.floor((attr.rankValue || 0) / (extensionSettings.statSheet?.editorSettings?.attrValueDivisor || 100)) : ''}"
                            data-skill-rank="${skill.mode === 'alphabetic' ? escapeHtml(skill.rank) : ''}"
                            data-attr-bonus-mod="${attrBonusMod}"
                            title="Roll ${escapeHtml(skill.name)}">
                        <span class="roll-btn-icon">🎲</span>
                        <span class="roll-btn-modifier">+${totalModifier}</span>
                    </button>
                    ${raiseBtn}
                </div>
            </div>
            ${subSkillsHTML}
        </div>
    `;
}

// ============================================================================
// PLAYER MODE — SAVING THROWS
// ============================================================================

function renderPlayerSavingThrows(savingThrows) {
    const enabled = (savingThrows || []).filter(st => st.enabled);
    if (enabled.length === 0) return '';

    const ss     = extensionSettings.statSheet;
    const sorted = sortSavingThrows(enabled, ss.attributes || [], ss.stCategories || []);
    const isList = stLayout === 'list';
    const items  = sorted.map(st => {
        const total = calculateSavingThrowValue(st);
        const rollBtn = `<button class="btn-roll-skill btn-roll-save"
                                 data-skill-id="${st.id}"
                                 data-attr-name="${escapeHtml(st.name)}"
                                 data-skill-name="${escapeHtml(st.name)} Save"
                                 data-attr-val="${total}"
                                 data-skill-val="0"
                                 data-rank=""
                                 title="Roll ${escapeHtml(st.name)} Save">
                             <span class="roll-btn-icon">🎲</span>
                             <span class="roll-btn-modifier">+${total}</span>
                         </button>`;
        return isList
            ? `<div class="st-view-item">
                   <span class="st-view-name">${escapeHtml(st.name)}</span>
                   <span class="st-view-spacer"></span>
                   <span class="st-view-total">${total}</span>
                   ${rollBtn}
               </div>`
            : `<div class="st-grid-card">
                   <span class="st-grid-total">${total}</span>
                   <span class="st-grid-name">${escapeHtml(st.name)}</span>
                   ${rollBtn}
               </div>`;
    }).join('');

    return `
        <div class="saving-throws-section">
            <div class="section-header">
                <h4>Saving Throws</h4>
                <button class="btn-st-layout" id="btn-st-layout"
                        title="${isList ? 'Switch to grid view' : 'Switch to list view'}">
                    ${isList ? '⊞ Grid' : '☰ List'}
                </button>
            </div>
            <div class="saving-throws-list-view st-layout-${stLayout}">
                ${items}
            </div>
        </div>
    `;
}

// ============================================================================
// PLAYER MODE — EVENT LISTENERS
// ============================================================================

function attachPlayerModeEventListeners() {
    // Collapse / expand attribute skills
    $(document).off('click', '.btn-collapse-attr')
        .on('click', '.btn-collapse-attr', function(e) {
            e.stopPropagation();
            const attrId = $(this).data('attr-id');
            const attr   = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            if (!attr) return;
            attr.collapsed = !attr.collapsed;
            saveStatSheetData();
            const $item = $(`.attribute-item[data-attr-id="${attrId}"]`);
            $item.find('.attr-skills-view').toggleClass('collapsed', attr.collapsed);
            $(this).text(attr.collapsed ? '▶' : '▼')
                   .attr('title', attr.collapsed ? 'Expand skills' : 'Collapse skills');
        });

    // Saving throws layout toggle
    $(document).off('click', '#btn-st-layout')
        .on('click', '#btn-st-layout', function(e) {
            e.stopPropagation();
            stLayout = stLayout === 'list' ? 'grid' : 'list';
            const { attributes, savingThrows } = extensionSettings.statSheet;
            const orphans = savingThrows.filter(
                st => !st.parentAttrId || !attributes.find(a => a.id === st.parentAttrId && a.enabled)
            );
            $('.saving-throws-section').replaceWith(
                $(renderPlayerSavingThrows(orphans))
            );
        });

    // Dice roll button
    $(document).off('click', '.btn-roll-skill')
        .on('click', '.btn-roll-skill', function(e) {
            e.stopPropagation();
            const existing = document.getElementById('roll-popover');
            if (existing && existing.dataset.skillId === String($(this).data('skill-id'))) {
                closeRollPopover();
                return;
            }
            openRollPopover(this);
        });

    // Raise skill (spend EXP)
    $(document).off('click', '.btn-raise-skill')
        .on('click', '.btn-raise-skill', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');

            if ($(this).hasClass('btn-raise-alpha-skill')) {
                const result = spendExpOnAlphaSkill(attrId, skillId);
                if (result.success) {
                    showNotification(`Rank advanced to ${result.newRank}!`, 'success');
                    refreshCurrentTab();
                } else {
                    showNotification(result.reason || 'Not enough EXP.', 'error');
                }
            } else {
                const success = spendExpOnSkill(attrId, skillId);
                if (success) {
                    showNotification('Skill raised!', 'success');
                    refreshCurrentTab();
                } else {
                    showNotification('Not enough EXP.', 'error');
                }
            }
        });

    // Manual sub-skill EXP raise
    $(document).off('click', '.btn-raise-subskill')
        .on('click', '.btn-raise-subskill', function() {
            const success = spendExpOnSubSkill(
                $(this).data('attr-id'),
                $(this).data('skill-id'),
                $(this).data('subskill-id')
            );
            if (success) {
                showNotification('Sub-skill raised!', 'success');
                refreshCurrentTab();
            } else {
                showNotification('Not enough EXP.', 'error');
            }
        });

    attachLevelExpListeners();
    attachAffinityListeners();
}

// ============================================================================
// ROLL POPOVER
// ============================================================================

function openRollPopover(btnEl) {
    closeRollPopover();

    const $btn         = $(btnEl);
    const skillId      = $btn.data('skill-id');
    const attrName     = $btn.data('attr-name');
    const skillName    = $btn.data('skill-name');
    const attrVal      = parseInt($btn.data('attr-val'))     || 0;
    const skillVal     = parseInt($btn.data('skill-val'))    || 0;
    const subSkillName = $btn.data('subskill-name')          || '';
    const subSkillVal  = parseInt($btn.data('subskill-val')) || 0;
    const attrRank     = $btn.data('rank')                   || '';
    const skillRank    = $btn.data('skill-rank')             || '';
    const attrGradeVal = $btn.data('attr-grade-val');
    const attrBaseVal  = $btn.data('attr-base-val');
    const isAlphaAttr  = attrRank !== '';
    const isSubSkill   = !!subSkillName;
    const attrBonusMod = parseInt($btn.data('attr-bonus-mod')) || 0;

    const modifier    = isSubSkill ? attrVal + subSkillVal : attrVal + skillVal;
    const headerLabel = isSubSkill ? subSkillName : skillName;

    const gradeDiceMap  = extensionSettings.statSheet?.editorSettings?.gradeDiceMap || {};
    const gradeSides    = gradeDiceMap[attrRank] || 20;
    const standardSides = [4, 6, 8, 10, 12, 20, 100];
    const allSides      = [...new Set([...standardSides, gradeSides])].sort((a, b) => a - b);
    const diceOptions   = allSides.map(s =>
        `<option value="${s}" ${s === gradeSides ? 'selected' : ''}>d${s}</option>`
    ).join('');
    const gradeHint = attrRank
        ? `<span class="rdc-grade-hint">${attrRank} → d${gradeSides}</span>`
        : '';

    const bonusLabel = (isAlphaAttr && attrBonusMod !== 0)
        ? `<span class="rmod-sep">+</span><span class="rmod-bonus"><strong>${attrBonusMod > 0 ? '+' + attrBonusMod : attrBonusMod}</strong> <span class="rmod-bonus-tag">(items)</span></span>`
        : '';

    let breakdownHTML;

    if (isAlphaAttr) {
        const attrGradeLabel = `<span class="rmod-attr"><strong>${attrGradeVal}</strong> (${escapeHtml(attrName)} ${attrRank})</span>`;
        const attrBaseLabel  = attrBaseVal > 0
            ? `<span class="rmod-sep">+</span><span class="rmod-attr-base"><strong>${attrBaseVal}</strong></span>`
            : '';

        if (isSubSkill) {
            const subLabel = skillRank
                ? `<strong>${subSkillVal}</strong> (${escapeHtml(subSkillName)} ${skillRank})`
                : `<strong>${subSkillVal}</strong> (${escapeHtml(subSkillName)})`;
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrGradeLabel}
                    ${attrBaseLabel}
                    ${bonusLabel}
                    <span class="rmod-sep">+</span>
                    <span class="rmod-skill">${subLabel}</span>
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        } else if (skillVal === 0) {
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrGradeLabel}
                    ${attrBaseLabel}
                    ${bonusLabel}
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        } else {
            const skLabel = skillRank
                ? `<strong>${skillVal}</strong> (${escapeHtml(skillName)} ${skillRank})`
                : `<strong>${skillVal}</strong> (${escapeHtml(skillName)})`;
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrGradeLabel}
                    ${attrBaseLabel}
                    ${bonusLabel}
                    <span class="rmod-sep">+</span>
                    <span class="rmod-skill">${skLabel}</span>
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        }
    } else {
        const attrLabel = `<span class="rmod-attr"><strong>${attrVal}</strong> (${escapeHtml(attrName)})</span>`;

        if (isSubSkill) {
            const subLabel = skillRank
                ? `<strong>${subSkillVal}</strong> (${escapeHtml(subSkillName)} ${skillRank})`
                : `<strong>${subSkillVal}</strong> (${escapeHtml(subSkillName)})`;
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrLabel}
                    <span class="rmod-sep">+</span>
                    <span class="rmod-skill">${subLabel}</span>
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        } else if (skillVal === 0) {
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrLabel}
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        } else {
            const skLabel = skillRank
                ? `<strong>${skillVal}</strong> (${escapeHtml(skillName)} ${skillRank})`
                : `<strong>${skillVal}</strong> (${escapeHtml(skillName)})`;
            breakdownHTML = `
                <div class="roll-mod-breakdown">
                    ${attrLabel}
                    <span class="rmod-sep">+</span>
                    <span class="rmod-skill">${skLabel}</span>
                    <span class="rmod-eq">= <strong class="rmod-total">+${modifier}</strong></span>
                </div>`;
        }
    }

    const subSkillResultLine = isSubSkill ? `
        <div class="rrb-line subskill-line">
            <span class="rrb-value subskill-value"></span>
            <span class="rrb-label subskill-label"></span>
        </div>` : '';

    $('body').append(`
        <div id="roll-popover" class="roll-popover" data-skill-id="${skillId}">
            <div class="roll-popover-arrow"></div>
            <div class="roll-popover-inner">
                <div class="roll-phase roll-config-phase">
                    <div class="roll-pop-header">
                        <span class="roll-pop-skill-name">${escapeHtml(headerLabel)}</span>
                    </div>
                    ${breakdownHTML}
                    <div class="roll-dice-config">
                        <label class="rdc-label">Dice</label>
                        <div class="rdc-select-wrap">
                            <select class="roll-sides-select">${diceOptions}</select>
                            ${gradeHint}
                        </div>
                    </div>
                    <button class="btn-execute-roll"
                            data-modifier="${modifier}"
                            data-attr-name="${escapeHtml(attrName)}"
                            data-skill-name="${escapeHtml(skillName)}"
                            data-attr-val="${attrVal}"
                            data-skill-val="${skillVal}"
                            data-subskill-name="${escapeHtml(subSkillName)}"
                            data-subskill-val="${subSkillVal}"
                            data-is-subskill="${isSubSkill}"
                            data-attr-rank="${escapeHtml(attrRank)}"
                            data-skill-rank="${escapeHtml(skillRank)}"
                            data-attr-grade-val="${isAlphaAttr ? attrGradeVal : ''}"
                            data-attr-base-val="${isAlphaAttr ? attrBaseVal : ''}"
                            data-attr-bonus-mod="${attrBonusMod}">
                        🎲 Roll
                    </button>
                </div>
                <div class="roll-phase roll-result-phase" style="display:none">
                    <div class="roll-pop-header">
                        <span class="roll-pop-skill-name result-skill-name"></span>
                    </div>
                    <div class="roll-dice-face-wrap">
                        <div class="roll-dice-face">
                            <span class="roll-dice-face-value">—</span>
                        </div>
                    </div>
                    <div class="roll-result-breakdown">
                        <div class="rrb-line roll-line">
                            <span class="rrb-value roll-value"></span>
                            <span class="rrb-label roll-label"></span>
                        </div>
                        <div class="rrb-line attr-line">
                            <span class="rrb-value attr-value"></span>
                            <span class="rrb-label attr-label"></span>
                        </div>
                        <div class="rrb-line attr-base-line" style="display:none">
                            <span class="rrb-value attr-base-value"></span>
                            <span class="rrb-label attr-base-label"></span>
                        </div>
                        <div class="rrb-line attr-bonus-line" style="display:none">
                            <span class="rrb-value attr-bonus-value"></span>
                            <span class="rrb-label attr-bonus-label"></span>
                        </div>
                        <div class="rrb-line skill-line">
                            <span class="rrb-value skill-value"></span>
                            <span class="rrb-label skill-label"></span>
                        </div>
                        ${subSkillResultLine}
                    </div>
                    <div class="roll-total-row">
                        <span class="roll-total-label">TOTAL</span>
                        <span class="roll-total-value">—</span>
                    </div>
                    <button class="btn-roll-again">↻ Roll Again</button>
                </div>
            </div>
        </div>
    `);

    const $pop = $('#roll-popover');
    positionPopover($pop[0], btnEl);

    $pop.on('click', '.btn-execute-roll', async function() {
        const sides    = parseInt($pop.find('.roll-sides-select').val()) || gradeSides;
        const mod      = parseInt($(this).data('modifier'))     || 0;
        const aName    = $(this).data('attr-name');
        const sName    = $(this).data('skill-name');
        const aVal     = parseInt($(this).data('attr-val'))     || 0;
        const sVal     = parseInt($(this).data('skill-val'))    || 0;
        const subName  = $(this).data('subskill-name')          || '';
        const subVal   = parseInt($(this).data('subskill-val')) || 0;
        const aRank    = $(this).data('attr-rank')              || '';
        const hasSub   = $(this).data('is-subskill') === true
                      || $(this).data('is-subskill') === 'true';

        $(this).prop('disabled', true).text('⏳');

        const result   = await executeRollCommand(`/roll 1d${sides}`);
        const diceRoll = result.total;
        const total    = diceRoll + mod;

        // BUG-01 FIX: log the roll and update the Last Roll display
        const rollLabel   = hasSub ? subName : sName;
        const modSign     = mod >= 0 ? '+' : '';
        const rollFormula = `1d${sides}${modSign}${mod}`;
        logDiceRoll(rollFormula, total, [diceRoll], rollLabel);
        extensionSettings.lastDiceRoll = { formula: rollFormula, total, rolls: [diceRoll], label: rollLabel };
        saveSettings();
        updateDiceDisplay();
        window.RPGCompanion?.refreshDiceLog?.();

        $(this).prop('disabled', false).text('🎲 Roll');
        $pop.find('.roll-config-phase').hide();

        const $res = $pop.find('.roll-result-phase');
        $res.find('.result-skill-name').text(hasSub ? subName : sName);
        $res.find('.roll-dice-face-value').text(diceRoll);
        $res.find('.roll-value').text(diceRoll);
        $res.find('.roll-label').text(`Roll (d${sides})`);
        const aRankRes  = $(this).data('attr-rank')      || '';
        const aGradeVal = $(this).data('attr-grade-val');
        const aBaseVal  = $(this).data('attr-base-val');
        const sRank     = $(this).data('skill-rank')     || '';
        const aBonusMod = parseInt($(this).data('attr-bonus-mod')) || 0;

        if (aRankRes) {
            $res.find('.attr-value').text(aGradeVal);
            $res.find('.attr-label').text(`${aName} ${aRankRes}`);
            if (parseInt(aBaseVal) > 0) {
                $res.find('.attr-base-line').show();
                $res.find('.attr-base-value').text(`+ ${aBaseVal}`);
                $res.find('.attr-base-label').text(`${aName} pts`);
            }
            if (aBonusMod !== 0) {
                $res.find('.attr-bonus-line').show();
                $res.find('.attr-bonus-value').text(`${aBonusMod > 0 ? '+ ' : ''}${aBonusMod}`);
                $res.find('.attr-bonus-label').text(`items`);
            }
        } else {
            $res.find('.attr-value').text(`+ ${aVal}`);
            $res.find('.attr-label').text(aName);
        }

        if (hasSub) {
            $res.find('.skill-line').hide();
            $res.find('.subskill-value').text(`+ ${subVal}`);
            $res.find('.subskill-label').text(sRank ? `${subName} ${sRank}` : subName);
        } else if (sVal === 0) {
            $res.find('.skill-line').hide();
        } else {
            $res.find('.skill-value').text(`+ ${sVal}`);
            $res.find('.skill-label').text(sRank ? `${sName} ${sRank}` : sName);
        }

        $res.find('.roll-total-value').text(total);

        const $face = $pop.find('.roll-dice-face');
        $face.removeClass('crit fumble');
        if (diceRoll === sides) $face.addClass('crit');
        if (diceRoll === 1)     $face.addClass('fumble');

        $res.show();
        $pop.addClass('result-open');
        positionPopover($pop[0], btnEl);
    });

    $pop.on('click', '.btn-roll-again', function() {
        $pop.find('.roll-result-phase').hide();
        $pop.find('.roll-config-phase').show();
        $pop.removeClass('result-open');
        positionPopover($pop[0], btnEl);
    });

    setTimeout(() => {
        const handler = (e) => {
            if (!$(e.target).closest('#roll-popover').length &&
                !$(e.target).closest('.btn-roll-skill').length) {
                closeRollPopover();
                document.removeEventListener('click', handler, true);
            }
        };
        document.addEventListener('click', handler, true);
        $('#roll-popover').data('outsideHandler', handler);
    }, 50);
}

function closeRollPopover() {
    const $pop    = $('#roll-popover');
    const handler = $pop.data('outsideHandler');
    if (handler) document.removeEventListener('click', handler, true);
    $pop.remove();
}

function positionPopover(popoverEl, btnEl) {
    const $pop     = $(popoverEl);
    const btnRect  = btnEl.getBoundingClientRect();
    const vpW      = window.innerWidth;
    const vpH      = window.innerHeight;
    const popW     = 240;
    const margin   = 12;
    const arrowGap = 10;

    $pop.css({ visibility: 'hidden', display: 'block', left: '-9999px', top: '-9999px' });
    const popH = $pop.outerHeight() || 260;
    $pop.css({ visibility: '', display: '' });

    const spaceRight = vpW - btnRect.right;
    let leftPx, arrowSide;
    if (spaceRight >= popW + margin + arrowGap) {
        leftPx    = btnRect.right + arrowGap;
        arrowSide = 'left';
    } else {
        leftPx    = btnRect.left - popW - arrowGap;
        arrowSide = 'right';
    }

    const btnCenterY = btnRect.top + btnRect.height / 2;
    let topPx = Math.max(10, Math.min(vpH - popH - 10, btnCenterY - popH / 2));
    const arrowTopPx = btnCenterY - topPx - 10;

    $pop.css({ position: 'fixed', left: leftPx, top: topPx, width: popW });
    $pop.attr('data-arrow', arrowSide);
    $pop.find('.roll-popover-arrow').css('top', Math.max(16, arrowTopPx));
}

// ============================================================================
// AFFINITY SECTION (Phase 0.5b)
// ============================================================================

/**
 * Render the affinity section.
 * When affinities.enabled is false, shows only the header + enable button.
 * When true, renders the full weakness picker, slot assignments, and summary table.
 */
function renderAffinitySection() {
    const ss  = extensionSettings.statSheet;
    const aff = ss?.affinities;
    if (!aff) return '';

    const isEnabled = aff.enabled === true;

    // ── Disabled stub ──────────────────────────────────────────────────────────
    if (!isEnabled) {
        return `
            <div class="affinity-section">
                <div class="section-header">
                    <h4>Damage Affinities</h4>
                    <button id="aff-toggle-enable" class="rpg-btn-secondary"
                            style="font-size:11px; padding:3px 10px; opacity:0.7;">
                        Enable
                    </button>
                    <span class="aff-section-hint">
                        Optional — Library of Ruina-style affinity system
                    </span>
                </div>
            </div>
        `;
    }

    // ── Full UI ────────────────────────────────────────────────────────────────
    const weakness  = aff.weakness  || { type: 'Slash', pool: 'damage' };
    const modifiers = aff.modifiers || { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } };

    const weaknessValue = weakness.pool === 'damage' ? 2 : 1;
    const dmgTypes      = ['Slash', 'Blunt', 'Pierce'];
    const pools         = ['damage', 'stagger'];

    function effectiveAff(type, pool) {
        const base = (type === weakness.type && pool === weakness.pool) ? weaknessValue : 0;
        return base + (modifiers[type]?.[pool] ?? 0);
    }

    // ── Slot attribute: user-configured, not hardcoded ─────────────────────────
    const allAttrs      = (ss.attributes || []).filter(a => a.enabled);
    const slotAttrId    = aff.slotAttrId || '';
    const slotAttr      = allAttrs.find(a => a.id === slotAttrId) || null;
    const slotAttrValue = slotAttr ? (ss.mode === 'numeric' ? (slotAttr.value || 0) : 0) : 0;
    const totalSlots    = Math.max(0, slotAttrValue - 1);

    // assignments is now an object { Slash:{damage,stagger}, Blunt:{...}, Pierce:{...} }
    const asn = aff.assignments || {};
    const usedSlots = ['Slash','Blunt','Pierce'].reduce(
        (sum, t) => sum + (asn[t]?.damage ?? 0) + (asn[t]?.stagger ?? 0), 0
    );
    const remainingSlots = Math.max(0, totalSlots - usedSlots);

    const attrPickerOpts = [
        `<option value="">— None (no slots) —</option>`,
        ...allAttrs.map(a =>
            `<option value="${a.id}" ${slotAttrId === a.id ? 'selected' : ''}>${a.name}</option>`
        )
    ].join('');

    const slotNote = slotAttr
        ? `${slotAttr.name} ${slotAttrValue} → ${totalSlots} slot${totalSlots !== 1 ? 's' : ''} (${remainingSlots} remaining)`
        : `<em style="opacity:0.5;">No attribute selected — slots locked</em>`;

    // ── 3×2 counter grid ─────────────────────────────────────────────────────
    const counterRows = dmgTypes.map(type => {
        const cells = pools.map(pool => {
            const count    = asn[type]?.[pool] ?? 0;
            const canAdd   = remainingSlots > 0;
            const canSub   = count > 0;
            return `<td class="aff-counter-cell">
                <button class="aff-counter-btn aff-counter-sub"
                        data-type="${type}" data-pool="${pool}"
                        ${canSub ? '' : 'disabled'} title="Remove one ${type}/${pool} slot">−</button>
                <span class="aff-counter-val" data-type="${type}" data-pool="${pool}">${count > 0 ? `−${count}` : '0'}</span>
                <button class="aff-counter-btn aff-counter-add"
                        data-type="${type}" data-pool="${pool}"
                        ${canAdd ? '' : 'disabled'} title="Add one ${type}/${pool} slot">+</button>
            </td>`;
        }).join('');
        return `<tr><td class="aff-counter-type">${type}</td>${cells}</tr>`;
    }).join('');

    const summaryRows = dmgTypes.map(type => `
        <tr>
            <td>${type}</td>
            ${pools.map(pool => {
                const val    = effectiveAff(type, pool);
                const isWeak = type === weakness.type && pool === weakness.pool;
                const cls    = val > 0 ? 'aff-val-weak' : val < 0 ? 'aff-val-resist' : 'aff-val-neutral';
                const prefix = val > 0 ? '+' : '';
                const badge  = isWeak ? '<span class="aff-weak-badge">(weak)</span>' : '';
                return `<td class="${cls}">${prefix}${val}${badge}</td>`;
            }).join('')}
        </tr>
    `).join('');

    return `
        <div class="affinity-section">
            <div class="section-header">
                <h4>Damage Affinities</h4>
                <button id="aff-toggle-enable" class="rpg-btn-secondary"
                        style="font-size:11px; padding:3px 10px; border-color:rgba(255,80,80,0.35); color:#ff9999;">
                    Disable
                </button>
            </div>

            <div class="aff-weakness-row">
                <span class="aff-label">Weakness:</span>
                <select id="aff-weakness-type" class="rpg-input" style="width:90px;">
                    ${dmgTypes.map(t => `<option value="${t}" ${weakness.type===t?'selected':''}>${t}</option>`).join('')}
                </select>
                <select id="aff-weakness-pool" class="rpg-input" style="width:120px;">
                    <option value="damage"  ${weakness.pool==='damage' ?'selected':''}>Damage (+2)</option>
                    <option value="stagger" ${weakness.pool==='stagger'?'selected':''}>Stagger (+1)</option>
                </select>
                <span class="aff-hint">Cannot be reduced below starting value.</span>
            </div>

            <div class="aff-slots-section">
                <div class="aff-slots-header">
                    <span class="aff-label">−1 Slots from:</span>
                    <select id="aff-slot-attr" class="rpg-input" style="width:130px;">
                        ${attrPickerOpts}
                    </select>
                    <span class="aff-slot-note">${slotNote}</span>
                </div>
                <table class="aff-counter-grid">
                    <thead>
                        <tr>
                            <th></th>
                            <th>Damage</th>
                            <th>Stagger</th>
                        </tr>
                    </thead>
                    <tbody>${counterRows}</tbody>
                </table>
            </div>

            <table class="aff-summary-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Damage</th>
                        <th>Stagger</th>
                    </tr>
                </thead>
                <tbody>${summaryRows}</tbody>
            </table>
        </div>
    `;
}

/**
 * Attach all affinity section event listeners.
 * Handles both the enabled and disabled state (toggle button is always present).
 */
function attachAffinityListeners() {
    const ss = extensionSettings.statSheet;
    if (!ss?.affinities) return;

    // Enable / Disable toggle
    $(document).off('click', '#aff-toggle-enable').on('click', '#aff-toggle-enable', function() {
        ss.affinities.enabled = !ss.affinities.enabled;
        saveStatSheetData();
        refreshCurrentTab();
    });

    // Slot attribute picker
    $(document).off('change', '#aff-slot-attr').on('change', '#aff-slot-attr', function() {
        ss.affinities.slotAttrId = $(this).val();
        // Trim slot counts that exceed the new budget
        const attr    = ss.attributes?.find(a => a.id === ss.affinities.slotAttrId);
        const newMax  = attr ? Math.max(0, (ss.mode === 'numeric' ? (attr.value || 0) : 0) - 1) : 0;
        const asn     = ss.affinities.assignments;
        let used = ['Slash','Blunt','Pierce'].reduce((s,t) => s + (asn[t]?.damage ?? 0) + (asn[t]?.stagger ?? 0), 0);
        // Remove excess by zeroing stagger then damage per type
        for (const pool of ['stagger','damage']) {
            for (const type of ['Pierce','Blunt','Slash']) {
                while (used > newMax && (asn[type]?.[pool] ?? 0) > 0) {
                    asn[type][pool]--;
                    used--;
                }
            }
        }
        _rebuildAffinityModifiers();
        saveStatSheetData();
        refreshCurrentTab();
    });

    // Counter grid — add slot
    $(document).off('click', '.aff-counter-add').on('click', '.aff-counter-add', function() {
        const type = $(this).data('type');
        const pool = $(this).data('pool');
        if (!ss.affinities.assignments[type]) ss.affinities.assignments[type] = { damage: 0, stagger: 0 };
        ss.affinities.assignments[type][pool] = (ss.affinities.assignments[type][pool] || 0) + 1;
        _rebuildAffinityModifiers();
        saveStatSheetData();
        refreshCurrentTab();
    });

    // Counter grid — remove slot
    $(document).off('click', '.aff-counter-sub').on('click', '.aff-counter-sub', function() {
        const type = $(this).data('type');
        const pool = $(this).data('pool');
        if (!ss.affinities.assignments[type]) return;
        ss.affinities.assignments[type][pool] = Math.max(0, (ss.affinities.assignments[type][pool] || 0) - 1);
        _rebuildAffinityModifiers();
        saveStatSheetData();
        refreshCurrentTab();
    });

    // Weakness type
    $(document).off('change', '#aff-weakness-type').on('change', '#aff-weakness-type', function() {
        ss.affinities.weakness.type = $(this).val();
        saveStatSheetData();
        refreshCurrentTab();
    });

    // Weakness pool
    $(document).off('change', '#aff-weakness-pool').on('change', '#aff-weakness-pool', function() {
        ss.affinities.weakness.pool = $(this).val();
        saveStatSheetData();
        refreshCurrentTab();
    });
}

/**
 * Rebuild affinities.modifiers from all sources: Vitality slots, augments, jobs/feats.
 */
function _rebuildAffinityModifiers() {
    const ss  = extensionSettings.statSheet;
    const aff = ss.affinities;
    const mods = { Slash: { damage: 0, stagger: 0 }, Blunt: { damage: 0, stagger: 0 }, Pierce: { damage: 0, stagger: 0 } };

    // Slot assignments — now an object { Slash:{damage,stagger}, ... }
    const asn = aff.assignments || {};
    for (const type of ['Slash', 'Blunt', 'Pierce']) {
        for (const pool of ['damage', 'stagger']) {
            const count = asn[type]?.[pool] ?? 0;
            if (count > 0) mods[type][pool] -= count;
        }
    }
    for (const aug of (ss.augments || [])) {
        for (const sb of (aug.statBonuses || [])) {
            if (sb.type !== 'affinity') continue;
            const [dmgType, pool] = (sb.targetId || '').split('.');
            if (mods[dmgType] && pool) mods[dmgType][pool] = (mods[dmgType][pool] || 0) + (sb.value || 0);
        }
    }
    for (const source of [...(ss.jobs || []), ...(ss.feats || [])]) {
        for (const sb of (source.statBonuses || [])) {
            if (sb.type !== 'affinity') continue;
            const [dmgType, pool] = (sb.targetId || '').split('.');
            if (mods[dmgType] && pool) mods[dmgType][pool] = (mods[dmgType][pool] || 0) + (sb.value || 0);
        }
    }
    for (const item of (ss.gear || []).filter(g => g.equipped !== false)) {
        for (const sb of (item.statBonuses || [])) {
            if (sb.type !== 'affinity') continue;
            const [dmgType, pool] = (sb.targetId || '').split('.');
            if (mods[dmgType] && pool) mods[dmgType][pool] = (mods[dmgType][pool] || 0) + (sb.value || 0);
        }
    }
    aff.modifiers = mods;
}
// ============================================================================
// MASTER MODE — HTML
// ============================================================================

function renderMasterModeHTML() {
    const { attributes, savingThrows, level, mode } = extensionSettings.statSheet;

    return `
        <div class="attributes-tab master-mode">
            <div class="tab-header">
                <div class="header-left"><h3>Attributes &amp; Skills</h3></div>
                <div class="header-right">
                    ${buildPromptIncludeToggle('attributes', 'Attrs')}
                    ${buildPromptIncludeToggle('savingThrows', 'Saves')}
                    <button id="toggle-display-mode" class="btn-toggle-mode"
                            title="Toggle Numeric / Alphabetic display">
                        <span class="mode-icon">${mode === 'numeric' ? '123' : 'ABC'}</span>
                        <span class="mode-text">${mode === 'numeric' ? 'Numeric' : 'Alphabetic'}</span>
                    </button>
                    <button id="add-attribute-btn" class="btn-add" title="Add new attribute">
                        + Add Attribute
                    </button>
                    <button id="btn-toggle-edit-mode" class="btn-toggle-mode btn-exit-master"
                            title="Return to Player Mode">
                        ▶ Player
                    </button>
                </div>
            </div>

            ${renderLevelExpSection(level)}

            <div class="attributes-section">
                <div class="section-header">
                    <h4>Attributes</h4>
                    <span class="attribute-count">(${attributes.filter(a => a.enabled).length} active)</span>
                </div>
                <div class="attributes-list">
                    ${attributes.map(attr => renderMasterAttribute(attr, mode, savingThrows)).join('')}
                </div>
            </div>

            ${renderSTCategoriesSection(
                savingThrows.filter(st => !st.parentAttrId || !attributes.find(a => a.id === st.parentAttrId && a.enabled)),
                extensionSettings.statSheet
            )}

            ${renderAffinitySection()}
            ${renderSpeedDiceSection()}
        </div>
    `;
}

/** Maps attribute value → Speed Die size per the SotC rulebook. */
function _speedDieSides(attrValue) {
    const v = attrValue || 0;
    if (v <= 2) return 6;
    if (v <= 4) return 8;
    if (v <= 6) return 10;
    return 12;
}

function renderSpeedDiceSection() {
    const ss    = extensionSettings.statSheet;
    const sd    = ss?.speedDice || { enabled: false, count: 1, sides: 6, modifier: 0, attrId: '' };
    const attrs = (ss?.attributes || []).filter(a => a.enabled);

    const linkedAttr   = attrs.find(a => a.id === sd.attrId);
    const attrValue    = linkedAttr ? (linkedAttr.value ?? 0) : null;
    const derivedSides = attrValue != null ? _speedDieSides(attrValue) : (sd.sides ?? 6);

    const attrOptions = '<option value="">— Manual —</option>' +
        attrs.map(a => `<option value="${a.id}" ${a.id === sd.attrId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');

    const modSign = (sd.modifier || 0) >= 0 ? '+' : '';
    const preview = `${sd.count ?? 1}d${derivedSides}${modSign}${sd.modifier || 0}`;

    return `
        <div class="speed-dice-section">
            <div class="speed-dice-header">
                <h4 class="speed-dice-title">Speed Dice</h4>
                <label class="speed-dice-enable-label">
                    <input type="checkbox" id="speed-dice-enabled" ${sd.enabled ? 'checked' : ''}>
                    Enabled
                </label>
                <span class="speed-dice-hint">(optional — shown in Summary if enabled)</span>
            </div>
            ${sd.enabled ? `
            <div class="speed-dice-body">
                <div class="speed-dice-row">
                    <div class="speed-dice-field">
                        <label class="speed-dice-label">Attribute</label>
                        <select id="speed-dice-attr" class="rpg-input speed-dice-attr-select">
                            ${attrOptions}
                        </select>
                    </div>
                    <div class="speed-dice-field">
                        <label class="speed-dice-label">Count</label>
                        <input type="number" id="speed-dice-count" class="rpg-threshold-input speed-dice-number"
                               value="${sd.count ?? 1}" min="1" max="10">
                    </div>
                    <div class="speed-dice-field">
                        <label class="speed-dice-label">Die Size</label>
                        <div class="speed-dice-derived">
                            d<span class="speed-dice-sides-val">${derivedSides}</span>
                            ${linkedAttr ? `<span class="speed-dice-attr-hint">(${linkedAttr.name} ${attrValue})</span>` : '<span class="speed-dice-attr-hint">manual</span>'}
                        </div>
                        ${!linkedAttr ? `<input type="number" id="speed-dice-sides" class="rpg-threshold-input speed-dice-number"
                               value="${sd.sides ?? 6}" min="2" max="20">` : ''}
                    </div>
                    <div class="speed-dice-field">
                        <label class="speed-dice-label">Modifier</label>
                        <input type="number" id="speed-dice-modifier" class="rpg-threshold-input speed-dice-number"
                               value="${sd.modifier ?? 0}">
                    </div>
                    <div class="speed-dice-preview">${preview}</div>
                </div>
                <div class="speed-dice-table-legend">
                    <span class="speed-dice-legend-title">Agility → Die Size</span>
                    <span class="speed-dice-legend-row"><span class="speed-dice-legend-val">1–2</span><span class="speed-dice-legend-die">d6</span></span>
                    <span class="speed-dice-legend-row"><span class="speed-dice-legend-val">3–4</span><span class="speed-dice-legend-die">d8</span></span>
                    <span class="speed-dice-legend-row"><span class="speed-dice-legend-val">5–6</span><span class="speed-dice-legend-die">d10</span></span>
                    <span class="speed-dice-legend-row"><span class="speed-dice-legend-val">7–8</span><span class="speed-dice-legend-die">d12</span></span>
                </div>
            </div>` : ''}
        </div>
    `;
}

function renderRankOptions(currentRank) {
    const ranks = [
        'FFF','FF','F',
        'E','EE','EEE',
        'D','DD','DDD',
        'C','CC','CCC',
        'B','BB','BBB',
        'A','AA','AAA',
        'S','SS','SSS','EX'
    ];
    return ranks.map(r =>
        `<option value="${r}" ${r === currentRank ? 'selected' : ''}>${r}</option>`
    ).join('');
}

// ── 2. NEW COMPACT renderMasterAttribute ──────────────────────────────────────
function renderMasterAttribute(attr, mode, savingThrows = []) {
    if (!attr.enabled) return '';
 
    const isAlpha = mode === 'alphabetic';
    const glowing = isAlpha && attr.threshold > 0 && attr.rankValue >= attr.threshold;
 
    // Rank select — only rendered in alphabetic mode.
    // Always occupies the same visual slot so no layout jump on mode switch.
    const rankSlot = isAlpha ? `
        <select class="attribute-rank-select ${glowing ? 'rank-threshold-glow' : ''}"
                data-rank="${attr.rank}" data-attr-id="${attr.id}">
            ${renderRankOptions(attr.rank)}
        </select>
    ` : '';
 
    // Value input — numeric uses attr.value; alphabetic uses attr.rankValue
    const valueInput = `
        <input type="number"
               class="attribute-value-input ${isAlpha ? 'alphabetic-input' : 'numeric-input'}"
               ${isAlpha ? 'style="min-width:55px"' : ''}
               value="${isAlpha ? (attr.rankValue ?? 0) : (attr.value ?? 0)}"
               data-attr-id="${attr.id}" min="0">
    `;
 
    const childSaves = savingThrows.filter(st => st.parentAttrId === attr.id);

    return `
        <div class="attribute-item attr-compact-item" data-attr-id="${attr.id}">
            <div class="attr-compact-row">
                <span class="attribute-drag-handle" title="Drag to reorder">⠿</span>
                <input type="text" class="attribute-name-input attr-name-compact"
                       value="${escapeHtml(attr.name)}" data-attr-id="${attr.id}"
                       placeholder="Attribute Name">
                <div class="attr-value-cluster" style="flex-shrink:0">
                    ${rankSlot}
                    <button class="btn-decrease-attr"
                            data-attr-id="${attr.id}" title="Decrease">−</button>
                    ${valueInput}
                    <button class="btn-increase-attr"
                            data-attr-id="${attr.id}" title="Increase">+</button>
                </div>
                <button class="btn-remove-attr" data-attr-id="${attr.id}"
                        title="Remove attribute">🗑️</button>
            </div>
            <div class="skills-compact-section">
                <div class="skills-list" data-attr-id="${attr.id}">
                    ${(attr.skills || []).map(skill => renderMasterSkill(attr.id, skill, mode)).join('')}
                </div>
                ${childSaves.length > 0 ? `
                <div class="st-inline-list" data-attr-id="${attr.id}">
                    ${childSaves.map(st => renderMasterSavingThrow(st)).join('')}
                </div>` : ''}
                <div style="display:flex; align-items:center; gap:16px; padding:5px 8px 3px 20px;">
                    <button class="btn-add-skill btn-add-skill-footer"
                            style="width:auto; flex:none;"
                            data-attr-id="${attr.id}" title="Add skill">+ Add Skill</button>
                    <button class="btn-add-st-footer"
                            style="background:none; border:none; color:rgba(100,200,150,0.7); font-size:11px; cursor:pointer; padding:0; width:auto; flex:none;"
                            data-attr-id="${attr.id}" data-cat-id=""
                            title="Add saving throw">+ Add Save</button>
                </div>
            </div>
        </div>
    `;
}

// ── 3. NEW COMPACT renderMasterSkill ──────────────────────────────────────────
function renderMasterSkill(attrId, skill, mode) {
    if (!skill.enabled) return '';
 
    if (!skill.mode)              skill.mode    = 'numeric';
    if (skill.rank === undefined) { skill.rank = 'C'; skill.rankValue = skill.level || 1; }
    if (!skill.expCost)           skill.expCost = 'normal';
    if (!Array.isArray(skill.subSkills)) skill.subSkills = [];
 
    const hasSubs      = skill.mode === 'numeric' && skill.subSkills.filter(s => s.enabled).length > 0;
    const effectiveLvl = hasSubs
        ? skill.subSkills.filter(s => s.enabled).reduce((sum, s) => sum + (s.level || 0), 0)
        : skill.level;
 
    const isExpensive = skill.expCost === 'expensive';
 
    // Compact cost badge: just a dot (●) for normal, gold coin emoji for expensive
    const expCostBtn = `
        <button class="btn-toggle-exp-cost btn-exp-badge ${isExpensive ? 'btn-exp-expensive' : ''}"
                data-attr-id="${attrId}" data-skill-id="${skill.id}"
                title="${isExpensive ? 'Expensive — click for Normal' : 'Normal — click for Expensive'}">
            ${isExpensive ? '💰' : '●'}
        </button>
    `;
 
    // Value cluster (right side of row)
    // Alphabetic mode: rank select + dec/inc (no separate rankValue input — matches current behaviour)
    // Numeric mode:    dec / value input / inc
    let valueCluster;
    if (skill.mode === 'numeric') {
        valueCluster = `
            <div class="skill-value-cluster ${hasSubs ? 'skill-value--locked' : ''}">
                <button class="btn-decrease-skill"
                        data-attr-id="${attrId}" data-skill-id="${skill.id}"
                        title="Decrease" ${hasSubs ? 'disabled' : ''}>−</button>
                <input type="number" class="skill-value-input numeric-input"
                       value="${effectiveLvl}" data-attr-id="${attrId}"
                       data-skill-id="${skill.id}" min="0"
                       ${hasSubs ? 'disabled title="Sum of sub-skills"' : ''}>
                <button class="btn-increase-skill"
                        data-attr-id="${attrId}" data-skill-id="${skill.id}"
                        title="Increase" ${hasSubs ? 'disabled' : ''}>+</button>
            </div>
        `;
    } else {
        // Alphabetic: rank select takes the numeric slot; +/− step through ranks
        valueCluster = `
            <div class="skill-value-cluster">
                <button class="btn-decrease-skill"
                        data-attr-id="${attrId}" data-skill-id="${skill.id}"
                        title="Previous rank">−</button>
                <select class="skill-rank-select"
                        data-rank="${skill.rank}"
                        data-attr-id="${attrId}" data-skill-id="${skill.id}">
                    ${renderRankOptions(skill.rank)}
                </select>
                <button class="btn-increase-skill"
                        data-attr-id="${attrId}" data-skill-id="${skill.id}"
                        title="Next rank">+</button>
            </div>
        `;
    }
 
    // Sub-skills panel — stacked below the skill row (numeric mode only)
    const enabledSubs = skill.subSkills.filter(s => s.enabled);
    const subSkillsPanel = skill.mode === 'numeric' ? `
        <div class="subskills-compact">
            <div class="subskills-list" data-attr-id="${attrId}" data-skill-id="${skill.id}">
                ${enabledSubs.map(sub => renderMasterSubSkill(attrId, skill.id, sub)).join('')}
                ${enabledSubs.length === 0
                    ? `<span class="subskills-empty">No sub-skills. Add one to enable the sub-skill pool.</span>`
                    : ''}
            </div>
            <button class="btn-add-subskill btn-add-subskill-compact"
                    data-attr-id="${attrId}"
                    data-skill-id="${skill.id}">+ Sub-skill</button>
        </div>
    ` : '';
 
    return `
        <div class="skill-item skill-compact-item"
             data-skill-id="${skill.id}" data-attr-id="${attrId}">
            <div class="skill-compact-row">
                <span class="skill-drag-handle" title="Drag to reorder">⠿</span>
                <div class="skill-left">
                    <input type="text" class="skill-name-input"
                           value="${escapeHtml(skill.name)}"
                           data-attr-id="${attrId}" data-skill-id="${skill.id}"
                           placeholder="Skill Name">
                    ${expCostBtn}
                    <button class="btn-toggle-skill-mode btn-mode-badge"
                            data-attr-id="${attrId}" data-skill-id="${skill.id}"
                            title="Toggle Numeric / Alphabetic">
                        ${skill.mode === 'numeric' ? '123' : 'ABC'}
                    </button>
                    <button class="btn-remove-skill"
                            data-attr-id="${attrId}" data-skill-id="${skill.id}"
                            title="Remove skill">🗑️</button>
                </div>
                ${valueCluster}
            </div>
            ${subSkillsPanel}
        </div>
    `;
}

// ── 4. NEW COMPACT renderMasterSubSkill ───────────────────────────────────────
function renderMasterSubSkill(attrId, skillId, sub) {
    return `
        <div class="subskill-item"
             data-subskill-id="${sub.id}"
             data-skill-id="${skillId}"
             data-attr-id="${attrId}">
            <input type="text" class="subskill-name-input"
                   value="${escapeHtml(sub.name)}"
                   data-attr-id="${attrId}" data-skill-id="${skillId}"
                   data-subskill-id="${sub.id}" placeholder="Sub-skill name">
            <div class="subskill-value-controls">
                <button class="btn-decrease-subskill"
                        data-attr-id="${attrId}" data-skill-id="${skillId}"
                        data-subskill-id="${sub.id}" title="Decrease">−</button>
                <input type="number" class="subskill-level-input"
                       value="${sub.level || 0}"
                       data-attr-id="${attrId}" data-skill-id="${skillId}"
                       data-subskill-id="${sub.id}" min="0">
                <button class="btn-increase-subskill"
                        data-attr-id="${attrId}" data-skill-id="${skillId}"
                        data-subskill-id="${sub.id}" title="Increase">+</button>
            </div>
            <button class="btn-remove-subskill"
                    data-attr-id="${attrId}" data-skill-id="${skillId}"
                    data-subskill-id="${sub.id}" title="Remove sub-skill">🗑️</button>
        </div>
    `;
}

// ============================================================================
// MASTER MODE — SAVING THROW SECTION (Task 7: category groups)
// ============================================================================

/**
 * Renders the full saving-throws section, grouped by stCategories.
 * Only receives "orphan" saves (those not pinned under a parent attribute).
 */
function renderSTCategoriesSection(orphanSaves, ss) {
    const cats    = ss.stCategories || [];
    const enabled = orphanSaves.filter(st => st.enabled);

    // Bucket saves by categoryId
    const byCat        = {};
    const uncategorized = [];
    for (const st of enabled) {
        const matched = cats.find(c => c.id === st.categoryId);
        if (matched) {
            if (!byCat[matched.id]) byCat[matched.id] = [];
            byCat[matched.id].push(st);
        } else {
            uncategorized.push(st);
        }
    }

    const catSectionsHTML = cats.map(cat => {
        const saves = (byCat[cat.id] || []).map(st => renderMasterSavingThrow(st)).join('');
        return `
            <div class="st-category-block" data-cat-id="${cat.id}">
                <div class="st-category-header">
                    <input type="text" class="st-category-name-input"
                           value="${escapeHtml(cat.name)}"
                           data-cat-id="${cat.id}"
                           placeholder="Category name">
                    <button class="btn-remove-st-category" data-cat-id="${cat.id}"
                            title="Remove category">🗑️</button>
                </div>
                <div class="st-category-saves">${saves}</div>
                <button class="btn-add-st-footer"
                        data-attr-id="" data-cat-id="${cat.id}"
                        title="Add save to ${escapeHtml(cat.name)}">+ Add Save</button>
            </div>
        `;
    }).join('');

    const uncatHTML = uncategorized.length > 0 || cats.length === 0 ? `
        <div class="st-category-block st-category--uncat">
            ${cats.length > 0
                ? `<div class="st-category-header st-uncat-header">
                       <span class="st-uncat-label">Uncategorized</span>
                   </div>`
                : ''}
            <div class="st-category-saves">
                ${uncategorized.map(st => renderMasterSavingThrow(st)).join('')}
            </div>
            ${cats.length === 0
                ? `<button class="btn-add-st-footer"
                           data-attr-id="" data-cat-id=""
                           title="Add saving throw">+ Add Save</button>`
                : ''}
        </div>
    ` : '';

    return `
        <div class="saving-throws-section">
            <div class="section-header">
                <h4>Saving Throws</h4>
                <button id="btn-add-st-category" class="btn-add-small"
                        title="Add a category group">+ Category</button>
                <button id="add-saving-throw-btn" class="btn-add-small"
                        title="Add saving throw">+ Add</button>
            </div>
            <div class="saving-throws-list">
                ${catSectionsHTML}
                ${uncatHTML}
            </div>
        </div>
    `;
}

// ============================================================================
// MASTER MODE — SAVING THROW RENDERER (collapsed card)
// ============================================================================

/**
 * Renders a single saving throw as a compact collapsed card.
 * Clicking the expand toggle shows the full term editor inline.
 */
function renderMasterSavingThrow(st) {
    if (!st.enabled) return '';
    if (!st.terms) st.terms = [];

    const isExpanded = _expandedSTIds.has(st.id);
    const total      = calculateSavingThrowValue(st);

    return `
        <div class="saving-throw-item st-card ${st.parentAttrId ? 'st-inline-item' : ''} ${isExpanded ? 'st-card--expanded' : ''}"
             data-st-id="${st.id}">
            <div class="st-card-header" style="display:flex; align-items:center; gap:6px; padding:5px 8px;">
                <button class="btn-st-expand" data-st-id="${st.id}"
                        title="${isExpanded ? 'Collapse' : 'Expand'}">
                    ${isExpanded ? '▼' : '▶'}
                </button>
                <input type="text" class="st-name-input"
                       style="flex:1; text-align:left;"
                       value="${escapeHtml(st.name)}" data-st-id="${st.id}"
                       placeholder="Save Name">
                <span class="st-card-total">${total}</span>
                <button class="btn-remove-st" data-st-id="${st.id}"
                        title="Remove saving throw">🗑️</button>
            </div>
            ${isExpanded ? _renderSTEditorBody(st) : ''}
        </div>
    `;
}

/**
 * Renders the full term editor for a saving throw (only when expanded).
 * Extracted from the old monolithic renderMasterSavingThrow.
 */
function _renderSTEditorBody(st) {
    const ss             = extensionSettings.statSheet;
    const allAttrs       = ss.attributes;
    const enabledAttrs   = allAttrs.filter(a => a.enabled);
    const cats           = ss.stCategories || [];

    const usedAttrIds  = st.terms.filter(t => t.type === 'attribute').map(t => t.attrId);
    const usedSkillIds = st.terms.filter(t => t.type === 'skill').map(t => t.skillId);
    const usedSubIds   = st.terms.filter(t => t.type === 'subskill').map(t => t.subSkillId);
    const availAttrs   = enabledAttrs.filter(a => !usedAttrIds.includes(a.id));

    // ── Term rows ──────────────────────────────────────────────────────────────
    const termsHTML = st.terms.map(term => {
        if (term.type === 'attribute') {
            const attr     = enabledAttrs.find(a => a.id === term.attrId);
            const attrName = attr ? attr.name : '(removed)';
            return `
                <div class="st-term-row" data-term-id="${term.id}">
                    <span class="st-term-attr-name">${escapeHtml(attrName)}</span>
                    <span class="st-term-sep">×</span>
                    <input type="number" class="st-term-multiplier"
                           value="${term.multiplier}" step="0.1" min="0"
                           data-st-id="${st.id}" data-term-id="${term.id}">
                    <button class="btn-remove-st-term"
                            data-st-id="${st.id}" data-term-id="${term.id}"
                            title="Remove term">×</button>
                </div>`;
        }
        if (term.type === 'flat') {
            return `
                <div class="st-term-row" data-term-id="${term.id}">
                    <input type="text" class="st-term-flat-label"
                           value="${escapeHtml(term.label || 'Flat Bonus')}"
                           data-st-id="${st.id}" data-term-id="${term.id}"
                           placeholder="Label">
                    <input type="number" class="st-term-flat-value"
                           value="${term.value}"
                           data-st-id="${st.id}" data-term-id="${term.id}">
                    <button class="btn-remove-st-term"
                            data-st-id="${st.id}" data-term-id="${term.id}"
                            title="Remove term">×</button>
                </div>`;
        }
        if (term.type === 'level') {
            return `
                <div class="st-term-row" data-term-id="${term.id}">
                    <span class="st-term-attr-name">Level</span>
                    <span class="st-term-sep">×</span>
                    <input type="number" class="st-term-multiplier"
                           value="${term.multiplier ?? 1}" step="0.1" min="0"
                           data-st-id="${st.id}" data-term-id="${term.id}">
                    <button class="btn-remove-st-term"
                            data-st-id="${st.id}" data-term-id="${term.id}"
                            title="Remove term">×</button>
                </div>`;
        }
        if (term.type === 'skill') {
            const attr  = enabledAttrs.find(a => a.id === term.attrId);
            const sk    = (attr?.skills || []).find(s => s.id === term.skillId);
            const label = sk ? `${escapeHtml(attr.name)}: ${escapeHtml(sk.name)}` : '(removed)';
            return `
                <div class="st-term-row" data-term-id="${term.id}">
                    <span class="st-term-attr-name st-term-skill">${label}</span>
                    <span class="st-term-sep">×</span>
                    <input type="number" class="st-term-multiplier"
                           value="${term.multiplier ?? 1}" step="0.1" min="0"
                           data-st-id="${st.id}" data-term-id="${term.id}">
                    <button class="btn-remove-st-term"
                            data-st-id="${st.id}" data-term-id="${term.id}"
                            title="Remove term">×</button>
                </div>`;
        }
        if (term.type === 'subskill') {
            const attr  = enabledAttrs.find(a => a.id === term.attrId);
            const sk    = (attr?.skills || []).find(s => s.id === term.skillId);
            const sub   = (sk?.subSkills || []).find(s => s.id === term.subSkillId);
            const label = sub ? `${escapeHtml(sk.name)}: ${escapeHtml(sub.name)}` : '(removed)';
            return `
                <div class="st-term-row" data-term-id="${term.id}">
                    <span class="st-term-attr-name st-term-subskill">${label}</span>
                    <span class="st-term-sep">×</span>
                    <input type="number" class="st-term-multiplier"
                           value="${term.multiplier ?? 1}" step="0.1" min="0"
                           data-st-id="${st.id}" data-term-id="${term.id}">
                    <button class="btn-remove-st-term"
                            data-st-id="${st.id}" data-term-id="${term.id}"
                            title="Remove term">×</button>
                </div>`;
        }
        return '';
    }).join('');

    // ── Add-term selects ──────────────────────────────────────────────────────
    const attrOptions = availAttrs.map(a =>
        `<option value="${a.id}">${escapeHtml(a.name)}</option>`
    ).join('');

    const skillOptions = enabledAttrs.flatMap(attr =>
        (attr.skills || [])
            .filter(sk => sk.enabled && !usedSkillIds.includes(sk.id))
            .map(sk => `<option value="${attr.id}:${sk.id}">${escapeHtml(attr.name)}: ${escapeHtml(sk.name)}</option>`)
    ).join('');

    const subSkillOptions = enabledAttrs.flatMap(attr =>
        (attr.skills || [])
            .filter(sk => sk.enabled)
            .flatMap(sk =>
                (sk.subSkills || [])
                    .filter(sub => sub.enabled && !usedSubIds.includes(sub.id))
                    .map(sub => `<option value="${attr.id}:${sk.id}:${sub.id}">${escapeHtml(sk.name)}: ${escapeHtml(sub.name)}</option>`)
            )
    ).join('');

    // ── Meta selects (parent attr + category) ────────────────────────────────
    const parentOptions = allAttrs.map(a =>
        `<option value="${a.id}" ${st.parentAttrId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
    ).join('');

    const catOptions = cats.map(c =>
        `<option value="${c.id}" ${st.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    return `
        <div class="st-card-body">
            <div class="st-meta-row">
                <select class="st-parent-select" data-st-id="${st.id}" title="Parent Attribute">
                    <option value="">(No Parent)</option>
                    ${parentOptions}
                </select>
                ${cats.length > 0 ? `
                <select class="st-category-select" data-st-id="${st.id}" title="Category">
                    <option value="">(No Category)</option>
                    ${catOptions}
                </select>` : ''}
            </div>
            <div class="st-formula-row">
                <span class="st-formula-label">Formula:</span>
                <span class="st-formula-text">${buildSavingThrowFormula(st)}</span>
            </div>
            <div class="st-terms-list">${termsHTML}</div>
            <div class="st-add-controls">
                <select class="st-add-attr-select" data-st-id="${st.id}">
                    <option value="">+ Attribute…</option>
                    ${attrOptions}
                </select>
                ${skillOptions ? `
                <select class="st-add-skill-select" data-st-id="${st.id}">
                    <option value="">+ Skill…</option>
                    ${skillOptions}
                </select>` : ''}
                ${subSkillOptions ? `
                <select class="st-add-subskill-select" data-st-id="${st.id}">
                    <option value="">+ Sub-Skill…</option>
                    ${subSkillOptions}
                </select>` : ''}
                <button class="btn-add-flat-term" data-st-id="${st.id}"
                        title="Add flat bonus">+ Flat</button>
                ${st.terms.some(t => t.type === 'level') ? '' :
                  `<button class="btn-add-level-term" data-st-id="${st.id}"
                           title="Add Level">+ Level</button>`}
            </div>
        </div>
    `;
}

// ============================================================================
// SHARED — CALCULATE EFFECTIVE CHARACTER LEVEL
// ============================================================================

/**
 * Calculate the character's effective level based on calculation mode.
 * If mode is 'manual', returns level.current.
 * If mode is 'sum', returns sum of all enabled job levels.
 * If mode is 'max', returns highest enabled job level.
 */
function getEffectiveCharacterLevel(ss) {
    if (!ss?.level) return 1;

    const mode = ss.level.calculationMode || 'manual';

    if (mode === 'manual') {
        return ss.level.current || 1;
    } else if (mode === 'sum') {
        const totalLevel = (ss.jobs || [])
            .filter(j => j.enabled !== false)
            .reduce((sum, job) => sum + (job.level || 0), 0);
        return totalLevel || 1;
    } else if (mode === 'max') {
        const maxLevel = (ss.jobs || [])
            .filter(j => j.enabled !== false)
            .reduce((max, job) => Math.max(max, job.level || 0), 0);
        return maxLevel || 1;
    }

    return ss.level.current || 1;
}

// ============================================================================
// SHARED — LEVEL & EXP SECTION
// ============================================================================

function renderLevelExpSection(level) {
    if (!level) return '';
    const showLevel = level.showLevel !== false;
    const showExp   = level.showExp   !== false;
    if (!showLevel && !showExp) return '';
 
    return `
        <div class="level-strip">
            ${showLevel ? `
                <span class="level-strip-label">Level</span>
                <input type="number" id="level-input"
                       class="level-strip-input level-strip-input--level"
                       value="${level.current || 1}" min="1" placeholder="1">
            ` : ''}
            ${showLevel && showExp ? `<span class="level-strip-sep">·</span>` : ''}
            ${showExp ? `
                <span class="level-strip-label">EXP</span>
                <input type="number" id="exp-input"
                       class="level-strip-input level-strip-input--exp"
                       value="${level.exp || 0}" min="0" placeholder="0">
            ` : ''}
        </div>
    `;
}

// ============================================================================
// SHARED — TOGGLE LISTENER
// ============================================================================

function attachToggleListener() {
    $(document).off('click', '#btn-toggle-edit-mode')
        .on('click', '#btn-toggle-edit-mode', function() {
            isMasterMode = !isMasterMode;
            refreshCurrentTab();
        });
}

// ============================================================================
// SHARED — LEVEL & EXP LISTENERS
// ============================================================================

function attachLevelExpListeners() {
    $(document).off('change', '#level-input')
        .on('change', '#level-input', function() {
            extensionSettings.statSheet.level.current = Math.max(1, parseInt($(this).val()) || 1);
            saveStatSheetData();
        });

    $(document).off('change', '#exp-input')
        .on('change', '#exp-input', function() {
            extensionSettings.statSheet.level.exp = Math.max(0, parseInt($(this).val()) || 0);
            saveStatSheetData();
        });
}

// ============================================================================
// MASTER MODE — EVENT LISTENERS
// ============================================================================

function attachMasterModeEventListeners() {
    // Debounce timers for name inputs (prevents lost saves when re-rendering)
    const _nameDebounceTimers = {};
    // Global display mode toggle
    $(document).off('click', '#toggle-display-mode')
        .on('click', '#toggle-display-mode', function() {
            toggleDisplayMode();
            refreshCurrentTab();
            showNotification(`Switched to ${extensionSettings.statSheet.mode === 'numeric' ? 'Numeric' : 'Alphabetic'} mode`, 'success');
        });

    // Add attribute
    $(document).off('click', '#add-attribute-btn')
        .on('click', '#add-attribute-btn', function() {
            addAttribute({
                id: generateUniqueId(), name: 'New Attribute',
                value: 10, rank: 'C', rankValue: 10,
                threshold: 0, collapsed: false, enabled: true, skills: []
            });
            refreshCurrentTab();
            showNotification('Attribute added', 'success');
        });

    // Remove attribute
    $(document).off('click', '.btn-remove-attr')
        .on('click', '.btn-remove-attr', function() {
            if (confirm('Remove this attribute and all its skills?')) {
                removeAttribute($(this).data('attr-id'));
                refreshCurrentTab();
                showNotification('Attribute removed', 'success');
            }
        });

    // Attribute value +/−
    $(document).off('click', '.btn-increase-attr, .btn-decrease-attr')
        .on('click', '.btn-increase-attr, .btn-decrease-attr', function() {
            const delta = $(this).hasClass('btn-increase-attr') ? 1 : -1;
            updateAttributeValue($(this).data('attr-id'), delta);
            refreshCurrentTab();
        });

    $(document).off('change', '.attribute-value-input.numeric-input')
        .on('change', '.attribute-value-input.numeric-input', function() {
            const attrId = $(this).data('attr-id');
            const attr   = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            if (!attr) return;
            const max    = extensionSettings.statSheet.editorSettings?.attributeMaxValue || 999;
            const v      = parseInt($(this).val());
            attr.value   = Math.max(0, Math.min(max, isNaN(v) ? 0 : v));
            attr.rankValue = attr.value;
            saveStatSheetData();
        });

    $(document).off('change', '.attribute-value-input.alphabetic-input')
        .on('change', '.attribute-value-input.alphabetic-input', function() {
            const attr = extensionSettings.statSheet.attributes.find(a => a.id === $(this).data('attr-id'));
            if (attr) {
                const v = parseInt($(this).val());
                attr.rankValue = Math.max(0, isNaN(v) ? 0 : v);
                saveStatSheetData();
            }
        });

    $(document).off('change', '.attribute-rank-select')
        .on('change', '.attribute-rank-select', function() {
            const attr = extensionSettings.statSheet.attributes.find(a => a.id === $(this).data('attr-id'));
            if (attr) { attr.rank = $(this).val(); $(this).attr('data-rank', attr.rank); saveStatSheetData(); }
        });

    $(document).off('change input', '.attribute-name-input')
        .on('input', '.attribute-name-input', function() {
            const $this  = $(this);
            const attrId = $this.data('attr-id');
            clearTimeout(_nameDebounceTimers['attr_' + attrId]);
            _nameDebounceTimers['attr_' + attrId] = setTimeout(() => {
                const attr = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
                if (attr) { attr.name = $this.val(); saveStatSheetData(); }
            }, 400);
        })
        .on('blur', '.attribute-name-input', function() {
            // Flush any pending debounce immediately on blur
            const attrId = $(this).data('attr-id');
            clearTimeout(_nameDebounceTimers['attr_' + attrId]);
            const attr = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            if (attr) { attr.name = $(this).val(); saveStatSheetData(); }
        });

    // Add skill
    $(document).off('click', '.btn-add-skill')
        .on('click', '.btn-add-skill', function() {
            addSkill($(this).data('attr-id'), {
                id: generateUniqueId(), name: 'New Skill',
                mode: 'numeric', level: 1,
                rank: 'C', rankValue: 1,
                expCost: 'normal', enabled: true, subSkills: []
            });
            refreshCurrentTab();
            showNotification('Skill added', 'success');
        });

    // Remove skill
    $(document).off('click', '.btn-remove-skill')
        .on('click', '.btn-remove-skill', function() {
            if (confirm('Remove this skill and all its sub-skills?')) {
                removeSkill($(this).data('attr-id'), $(this).data('skill-id'));
                refreshCurrentTab();
                showNotification('Skill removed', 'success');
            }
        });

    // Skill value +/−
    $(document).off('click', '.btn-increase-skill, .btn-decrease-skill')
        .on('click', '.btn-increase-skill, .btn-decrease-skill', function() {
            const delta = $(this).hasClass('btn-increase-skill') ? 1 : -1;
            updateSkillLevel($(this).data('attr-id'), $(this).data('skill-id'), delta);
            refreshCurrentTab();
        });

    $(document).off('change', '.skill-value-input.numeric-input')
        .on('change', '.skill-value-input.numeric-input', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const attr    = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill   = attr?.skills.find(s => s.id === skillId);
            if (skill) {
                const v = parseInt($(this).val());
                skill.level = Math.max(0, isNaN(v) ? 0 : v);
                saveStatSheetData();
            }
        });

    $(document).off('change', '.skill-value-input.alphabetic-input')
        .on('change', '.skill-value-input.alphabetic-input', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const attr    = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill   = attr?.skills.find(s => s.id === skillId);
            if (skill) {
                const v = parseInt($(this).val());
                skill.rankValue = Math.max(0, isNaN(v) ? 0 : v);
                saveStatSheetData();
            }
        });

    $(document).off('change', '.skill-rank-select')
        .on('change', '.skill-rank-select', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const attr    = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill   = attr?.skills.find(s => s.id === skillId);
            if (skill) { skill.rank = $(this).val(); $(this).attr('data-rank', skill.rank); saveStatSheetData(); }
        });

    $(document).off('change input', '.skill-name-input')
        .on('input', '.skill-name-input', function() {
            const $this   = $(this);
            const skillId = $this.data('skill-id');
            clearTimeout(_nameDebounceTimers['skill_' + skillId]);
            _nameDebounceTimers['skill_' + skillId] = setTimeout(() => {
                const attrId = $this.data('attr-id');
                const attr   = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
                const skill  = attr?.skills.find(s => s.id === skillId);
                if (skill) { skill.name = $this.val(); saveStatSheetData(); }
            }, 400);
        })
        .on('blur', '.skill-name-input', function() {
            // Flush pending debounce immediately on blur
            const skillId = $(this).data('skill-id');
            clearTimeout(_nameDebounceTimers['skill_' + skillId]);
            const attrId = $(this).data('attr-id');
            const attr   = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill  = attr?.skills.find(s => s.id === skillId);
            if (skill) { skill.name = $(this).val(); saveStatSheetData(); }
        });

    // Skill mode toggle (123 / ABC)
    $(document).off('click', '.btn-toggle-skill-mode')
        .on('click', '.btn-toggle-skill-mode', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const attr    = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill   = attr?.skills.find(s => s.id === skillId);
            if (!skill) return;
            skill.mode = skill.mode === 'numeric' ? 'alphabetic' : 'numeric';
            saveStatSheetData();
            refreshCurrentTab();
        });

    // EXP cost tier toggle
    $(document).off('click', '.btn-toggle-exp-cost')
        .on('click', '.btn-toggle-exp-cost', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const attr    = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
            const skill   = attr?.skills.find(s => s.id === skillId);
            if (!skill) return;
            skill.expCost = skill.expCost === 'expensive' ? 'normal' : 'expensive';
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Add sub-skill
    $(document).off('click', '.btn-add-subskill')
        .on('click', '.btn-add-subskill', function() {
            addSubSkill($(this).data('attr-id'), $(this).data('skill-id'), {
                id: generateUniqueId(), name: 'New Sub-skill', level: 0, enabled: true
            });
            refreshCurrentTab();
            showNotification('Sub-skill added', 'success');
        });

    // Remove sub-skill
    $(document).off('click', '.btn-remove-subskill')
        .on('click', '.btn-remove-subskill', function() {
            if (confirm('Remove this sub-skill?')) {
                removeSubSkill($(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'));
                refreshCurrentTab();
                showNotification('Sub-skill removed', 'success');
            }
        });

    // Sub-skill value +/−
    $(document).off('click', '.btn-increase-subskill, .btn-decrease-subskill')
        .on('click', '.btn-increase-subskill, .btn-decrease-subskill', function() {
            const delta = $(this).hasClass('btn-increase-subskill') ? 1 : -1;
            updateSubSkillLevel($(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'), delta);
            refreshCurrentTab();
        });

    $(document).off('change', '.subskill-level-input')
        .on('change', '.subskill-level-input', function() {
            updateSubSkillLevel(
                $(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'),
                Math.max(0, parseInt($(this).val()) || 0), true
            );
            refreshCurrentTab();
        });

    // Sub-skill name
    $(document).off('change', '.subskill-name-input')
        .on('change', '.subskill-name-input', function() {
            const attr  = extensionSettings.statSheet.attributes.find(a => a.id === $(this).data('attr-id'));
            const skill = attr?.skills.find(s => s.id === $(this).data('skill-id'));
            const sub   = (skill?.subSkills || []).find(s => s.id === $(this).data('subskill-id'));
            if (sub) { sub.name = $(this).val(); saveStatSheetData(); }
        });

    // Saving throw: add
    $(document).off('click', '#add-saving-throw-btn')
        .on('click', '#add-saving-throw-btn', function() {
            const newST = { id: generateUniqueId(), name: 'New Save', parentAttrId: '', categoryId: '', terms: [], enabled: true };
            extensionSettings.statSheet.savingThrows.push(newST);
            _expandedSTIds.add(newST.id);
            saveStatSheetData();
            refreshCurrentTab();
            showNotification('Saving throw added', 'success');
        });

    // Saving throw: remove
    $(document).off('click', '.btn-remove-st')
        .on('click', '.btn-remove-st', function() {
            if (confirm('Remove this saving throw?')) {
                extensionSettings.statSheet.savingThrows =
                    extensionSettings.statSheet.savingThrows.filter(s => s.id !== $(this).data('st-id'));
                saveStatSheetData();
                refreshCurrentTab();
                showNotification('Saving throw removed', 'success');
            }
        });

    $(document).off('change', '.st-name-input')
        .on('change', '.st-name-input', function() {
            const st = extensionSettings.statSheet.savingThrows.find(s => s.id === $(this).data('st-id'));
            if (st) { st.name = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.st-add-attr-select')
        .on('change', '.st-add-attr-select', function() {
            const attrId = $(this).val();
            if (!attrId) return;
            addSavingThrowAttributeTerm($(this).data('st-id'), attrId);
            $(this).val('');
            refreshCurrentTab();
        });

    $(document).off('click', '.btn-add-flat-term')
        .on('click', '.btn-add-flat-term', function() {
            addSavingThrowFlatTerm($(this).data('st-id'));
            refreshCurrentTab();
        });

    $(document).off('click', '.btn-remove-st-term')
        .on('click', '.btn-remove-st-term', function() {
            removeSavingThrowTerm($(this).data('st-id'), $(this).data('term-id'));
            refreshCurrentTab();
        });

    $(document).off('change', '.st-term-multiplier')
        .on('change', '.st-term-multiplier', function() {
            updateSavingThrowTermMultiplier(
                $(this).data('st-id'), $(this).data('term-id'),
                parseFloat($(this).val()) || 0
            );
            refreshCurrentTab();
        });

    $(document).off('change', '.st-term-flat-value')
        .on('change', '.st-term-flat-value', function() {
            updateSavingThrowFlatTermValue(
                $(this).data('st-id'), $(this).data('term-id'),
                parseFloat($(this).val()) || 0
            );
            refreshCurrentTab();
        });

    $(document).off('change', '.st-term-flat-label')
        .on('change', '.st-term-flat-label', function() {
            updateSavingThrowFlatTermLabel($(this).data('st-id'), $(this).data('term-id'), $(this).val());
            const st = extensionSettings.statSheet.savingThrows.find(s => s.id === $(this).data('st-id'));
            if (st) {
                $(`.saving-throw-item[data-st-id="${$(this).data('st-id')}"]`)
                    .find('.st-formula-text').text(buildSavingThrowFormula(st));
            }
        });

    $(document).off('click', '.btn-add-level-term')
        .on('click', '.btn-add-level-term', function() {
            addSavingThrowLevelTerm($(this).data('st-id'));
            refreshCurrentTab();
        });

    $(document).off('change', '.st-add-skill-select')
        .on('change', '.st-add-skill-select', function() {
            const val = $(this).val();
            if (!val) return;
            const [attrId, skillId] = val.split(':');
            addSavingThrowSkillTerm($(this).data('st-id'), attrId, skillId);
            $(this).val('');
            refreshCurrentTab();
        });

    $(document).off('change', '.st-add-subskill-select')
        .on('change', '.st-add-subskill-select', function() {
            const val = $(this).val();
            if (!val) return;
            const [attrId, skillId, subSkillId] = val.split(':');
            addSavingThrowSubSkillTerm($(this).data('st-id'), attrId, skillId, subSkillId);
            $(this).val('');
            refreshCurrentTab();
        });

    // Inline + Add Save button (used both by per-attribute footer and per-category footer)
    $(document).off('click', '.btn-add-st-footer')
        .on('click', '.btn-add-st-footer', function() {
            const newST = {
                id:          generateUniqueId(),
                name:        'New Save',
                parentAttrId: $(this).data('attr-id') || '',
                categoryId:  $(this).data('cat-id')  || '',
                terms:       [],
                enabled:     true
            };
            extensionSettings.statSheet.savingThrows.push(newST);
            _expandedSTIds.add(newST.id); // open it immediately for editing
            saveStatSheetData();
            refreshCurrentTab();
            showNotification('Saving throw added', 'success');
        });

    // Expand / collapse a saving throw card
    $(document).off('click', '.btn-st-expand')
        .on('click', '.btn-st-expand', function() {
            const stId = $(this).data('st-id');
            if (_expandedSTIds.has(stId)) {
                _expandedSTIds.delete(stId);
            } else {
                _expandedSTIds.add(stId);
            }
            refreshCurrentTab();
        });

    // Add a new ST category
    $(document).off('click', '#btn-add-st-category')
        .on('click', '#btn-add-st-category', function() {
            addSTCategory('New Category');
            refreshCurrentTab();
        });

    // Remove an ST category (unassigns all its saves)
    $(document).off('click', '.btn-remove-st-category')
        .on('click', '.btn-remove-st-category', function() {
            if (confirm('Remove this category? Saves inside it will become uncategorized.')) {
                removeSTCategory($(this).data('cat-id'));
                refreshCurrentTab();
            }
        });

    // Rename an ST category (debounced)
    $(document).off('input', '.st-category-name-input')
        .on('input', '.st-category-name-input', function() {
            const $this = $(this);
            const catId = $this.data('cat-id');
            clearTimeout(_nameDebounceTimers['cat_' + catId]);
            _nameDebounceTimers['cat_' + catId] = setTimeout(() => {
                renameSTCategory(catId, $this.val());
            }, 400);
        });

    // Reassign a saving throw to a different category
    $(document).off('change', '.st-category-select')
        .on('change', '.st-category-select', function() {
            setSavingThrowCategory($(this).data('st-id'), $(this).val());
            refreshCurrentTab();
        });

    // Parent Attribute reassignment dropdown
    $(document).off('change', '.st-parent-select')
        .on('change', '.st-parent-select', function() {
            const st = extensionSettings.statSheet.savingThrows.find(s => s.id === $(this).data('st-id'));
            if (st) {
                st.parentAttrId = $(this).val();
                saveStatSheetData();
                refreshCurrentTab();
            }
        });

    attachLevelExpListeners();
    attachAffinityListeners(); // Affinity section renders in both modes

    // Speed dice — guard against speedDice being undefined if chat data hasn't loaded yet
    $(document).off('change', '#speed-dice-enabled').on('change', '#speed-dice-enabled', function() {
        const sd = extensionSettings.statSheet?.speedDice;
        if (!sd) return;
        sd.enabled = this.checked;
        saveStatSheetData();
        refreshCurrentTab();
    });
    $(document).off('change', '#speed-dice-attr').on('change', '#speed-dice-attr', function() {
        const sd = extensionSettings.statSheet?.speedDice;
        if (!sd) return;
        sd.attrId = $(this).val();
        saveStatSheetData();
        refreshCurrentTab();
    });
    $(document).off('change', '#speed-dice-count, #speed-dice-sides, #speed-dice-modifier')
        .on('change', '#speed-dice-count, #speed-dice-sides, #speed-dice-modifier', function() {
            const sd = extensionSettings.statSheet?.speedDice;
            if (!sd) return;
            sd.count    = Math.max(1, parseInt($('#speed-dice-count').val())    || 1);
            if (!sd.attrId) sd.sides = Math.max(2, parseInt($('#speed-dice-sides').val()) || 6);
            sd.modifier = parseInt($('#speed-dice-modifier').val()) || 0;
            saveStatSheetData();
            refreshCurrentTab();
        });
}

// ============================================================================
// DRAG-AND-DROP (jQuery UI Sortable) — Master Mode only
// ============================================================================

function initializeSortable() {
    const sortableOpts = (handle, idAttr, onStop) => ({
        handle, axis: 'y', tolerance: 'pointer',
        placeholder: 'sort-placeholder', forcePlaceholderSize: true,
        stop: onStop
    });

    $('.attributes-list').sortable(sortableOpts(
        '.attribute-drag-handle', 'data-attr-id',
        function() {
            const newOrder  = $(this).sortable('toArray', { attribute: 'data-attr-id' });
            const original  = extensionSettings.statSheet.attributes;
            const visible   = newOrder.map(id => original.find(a => a.id === id)).filter(Boolean);
            const hidden    = original.filter(a => !newOrder.includes(a.id));
            extensionSettings.statSheet.attributes = [...visible, ...hidden];
            saveStatSheetData();
        }
    ));

    $('.skills-list').each(function() {
        const $list = $(this);
        $list.sortable(sortableOpts(
            '.skill-drag-handle', 'data-skill-id',
            function() {
                const attrId    = $list.data('attr-id');
                const attr      = extensionSettings.statSheet.attributes.find(a => a.id === attrId);
                if (!attr) return;
                const newOrder  = $list.sortable('toArray', { attribute: 'data-skill-id' });
                const visible   = newOrder.map(id => attr.skills.find(s => s.id === id)).filter(Boolean);
                const hidden    = attr.skills.filter(s => !newOrder.includes(s.id));
                attr.skills     = [...visible, ...hidden];
                saveStatSheetData();
            }
        ));
    });
}

// ============================================================================
// UTILITY
// ============================================================================

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
