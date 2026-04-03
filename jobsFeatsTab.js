/**
 * Jobs & Feats Tab Module  (Session 4 — patched)
 *
 * Full Jobs & Feats tab — Player Mode and Master Mode.
 */

import { extensionSettings } from '../../core/state.js';
import {
    addJob,
    removeJob,
    levelUpJob,
    addFeat,
    removeFeat,
    generateUniqueId,
    calculateUpgradeCost,
    calculateJobLevelCost,
    getJobsWithUnspentPoints,
    spendJobPointOnSubSkill,
    refundJobPointFromSubSkill,
    refundJobPointFromSkill,
    createSubSkillWithJobPoint,
    addSubSkill,
    removeSubSkill,
    updateSubSkillLevel,
    addSkill,
    spendExpOnSkill,
    getSkillEffectiveLevel,
    updateSkillLevel,
    checkFeatPrerequisites
} from './statSheetState.js';
import { saveStatSheetData } from '../../core/persistence.js';
import { refreshCurrentTab, showNotification, buildPromptIncludeToggle } from './statSheetUI.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let isMasterMode = false;

// ============================================================================
// MAIN RENDER ENTRY POINT
// ============================================================================

export function renderJobsFeatsTab(container) {
    const ss = extensionSettings.statSheet;
    if (!ss) {
        container.html('<div class="error-message">Stat sheet not initialized</div>');
        return;
    }

    if (isMasterMode) {
        container.html(renderMasterModeHTML());
        attachMasterModeListeners();
    } else {
        container.html(renderPlayerModeHTML());
        attachPlayerModeListeners();
    }

    attachToggleListener();
}

// ============================================================================
// HELPERS
// ============================================================================

function getJobLevelCost(job) {
    return calculateJobLevelCost(job.id);
}

function canAffordJobLevel(job) {
    if ((job.level || 0) >= 10) return false;
    return (extensionSettings.statSheet.level.exp || 0) >= getJobLevelCost(job);
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

/**
 * Given a job, a tree type name, and the mapped attribute object,
 * find the skill on that attribute whose name matches the tree type (case-insensitive).
 * Returns the skill object or null.
 */
function findTreeSkill(treeType, mappedAttr) {
    if (!mappedAttr) return null;
    return (mappedAttr.skills || []).find(
        s => s.enabled && s.name.toLowerCase() === treeType.toLowerCase()
    ) || null;
}

/**
 * Compute effective unspent Specialty Points for a job from real data.
 * effectiveUnspent = (level × pointGrantsPerLevel) − totalSpent
 * where totalSpent = sum of all enabled sub-skill levels under this job's tree type skills.
 * This is the single source of truth — always use this instead of job.unspentPoints directly.
 */
function computeEffectiveUnspent(job) {
    const ss       = extensionSettings.statSheet;
    const attrMap  = job.treeTypeAttributeMap || {};
    const granted  = (job.level || 0) * (job.pointGrantsPerLevel || 1);
    let spent = 0;
    for (const [treeName, attrId] of Object.entries(attrMap)) {
        const attr  = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
        const skill = (attr?.skills || []).find(
            s => s.enabled && s.name.toLowerCase() === treeName.toLowerCase()
        );
        if (skill) {
            spent += (skill.subSkills || [])
                .filter(s => s.enabled)
                .reduce((sum, s) => sum + (s.level || 0), 0);
        }
    }
    return Math.max(0, granted - spent);
}

// ============================================================================
// PLAYER MODE — HTML
// ============================================================================

function renderPlayerModeHTML() {
    const ss    = extensionSettings.statSheet;
    const jobs  = (ss.jobs  || []).filter(j => j.enabled !== false);
    const feats = (ss.feats || []).filter(f => f.enabled !== false);

    return `
        <div class="jobs-feats-tab player-mode">
            <div class="tab-header">
                <div class="header-left"><h3>Jobs &amp; Feats</h3></div>
                <div class="header-right">
                    ${buildPromptIncludeToggle('jobsFeats', 'Jobs & Feats')}
                    <button id="btn-toggle-jf-mode" class="btn-toggle-mode" title="Switch to Master Mode">
                        ⚙️ Master
                    </button>
                </div>
            </div>

            ${renderUnspentPointsBanner(jobs)}

            <div class="jobs-section">
                <div class="section-header">
                    <h4>Jobs</h4>
                    <span class="attribute-count">(${jobs.length} active)</span>
                </div>
                <div class="jobs-list-view">
                    ${jobs.length === 0
                        ? `<div class="view-no-skills">No jobs yet.</div>`
                        : jobs.map(job => renderPlayerJob(job)).join('')}
                </div>
            </div>

            <div class="feats-section" style="margin-top: 24px;">
                <div class="section-header">
                    <h4>Feats</h4>
                    <span class="attribute-count">(${feats.length} active)</span>
                </div>
                <div class="feats-list-view">
                    ${feats.length === 0
                        ? `<div class="view-no-skills">No feats yet.</div>`
                        : feats.map(renderPlayerFeat).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderUnspentPointsBanner(jobs) {
    // Compute effective unspent for each job at render time
    const ss = extensionSettings.statSheet;
    const jobsWithPoints = jobs.filter(job => {
        const attrMap      = job.treeTypeAttributeMap || {};
        const totalGranted = (job.level || 0) * (job.pointGrantsPerLevel || 1);
        let totalSpent = 0;
        for (const [treeName, attrId] of Object.entries(attrMap)) {
            const attr  = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
            const skill = (attr?.skills  || []).find(
                s => s.enabled && s.name.toLowerCase() === treeName.toLowerCase()
            );
            if (skill) {
                totalSpent += (skill.subSkills || [])
                    .filter(s => s.enabled)
                    .reduce((sum, s) => sum + (s.level || 0), 0);
            }
        }
        return Math.max(0, totalGranted - totalSpent) > 0;
    });

    if (jobsWithPoints.length === 0) return '';

    const totalPoints = jobsWithPoints.reduce((sum, job) => {
        const attrMap      = job.treeTypeAttributeMap || {};
        const totalGranted = (job.level || 0) * (job.pointGrantsPerLevel || 1);
        let totalSpent = 0;
        for (const [treeName, attrId] of Object.entries(attrMap)) {
            const attr  = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
            const skill = (attr?.skills  || []).find(
                s => s.enabled && s.name.toLowerCase() === treeName.toLowerCase()
            );
            if (skill) {
                totalSpent += (skill.subSkills || [])
                    .filter(s => s.enabled)
                    .reduce((sum, s) => sum + (s.level || 0), 0);
            }
        }
        return sum + Math.max(0, totalGranted - totalSpent);
    }, 0);

    const jobNames = jobsWithPoints.map(j => escapeHtml(j.name)).join(', ');

    return `
        <div class="unspent-points-banner">
            <span class="banner-icon">✨</span>
            <div class="banner-text">
                <strong>You have ${totalPoints} unspent sub-skill point${totalPoints !== 1 ? 's' : ''}</strong>
                <span class="banner-source">from: ${jobNames}</span>
            </div>
        </div>
    `;
}

function renderPlayerJob(job) {
    const atMax  = (job.level || 0) >= 10;
    const cost   = getJobLevelCost(job);
    const canAff = canAffordJobLevel(job);

    // Compute effective unspent points from actual data (level × ppl - totalSpent)
    const ss           = extensionSettings.statSheet;
    const attrMap      = job.treeTypeAttributeMap || {};
    const totalGranted = (job.level || 0) * (job.pointGrantsPerLevel || 1);
    let totalSpent = 0;
    for (const [treeName, attrId] of Object.entries(attrMap)) {
        const attr  = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
        const skill = (attr?.skills  || []).find(
            s => s.enabled && s.name.toLowerCase() === treeName.toLowerCase()
        );
        if (skill) {
            totalSpent += (skill.subSkills || [])
                .filter(s => s.enabled)
                .reduce((sum, s) => sum + (s.level || 0), 0);
        }
    }
    const effectiveUnspent = Math.max(0, totalGranted - totalSpent);
    const hasPoints        = effectiveUnspent > 0;

    // Linked feats
    const linkedFeats = (job.associatedFeatIds || [])
        .map(fid => (ss.feats || []).find(f => f.id === fid))
        .filter(Boolean);

    return `
        <div class="job-view-item ${hasPoints ? 'job-has-points' : ''}" data-job-id="${job.id}">
            <div class="job-view-header">
                <span class="job-view-name">${escapeHtml(job.name)}</span>
                <div class="job-view-controls">
                    <span class="job-level-badge">Lv.${job.level || 0}</span>
                    ${hasPoints
                        ? `<span class="unspent-badge" title="${effectiveUnspent} unspent sub-skill point${effectiveUnspent !== 1 ? 's' : ''}">+${effectiveUnspent} pts</span>`
                        : ''}
                    ${atMax
                        ? `<span class="job-max-badge">MAX</span>`
                        : `<button class="btn-raise-job ${canAff ? '' : 'btn-raise-disabled'}"
                                   data-job-id="${job.id}"
                                   title="${canAff ? `Spend ${cost} EXP to level up` : `Need ${cost} EXP`}"
                                   ${canAff ? '' : 'disabled'}>
                               ↑ Level Up <span class="raise-cost">${cost} EXP</span>
                           </button>`}
                </div>
            </div>
            ${linkedFeats.length > 0 ? renderLinkedFeatsView(linkedFeats) : ''}
            ${renderJobSubSkillTree(job)}
        </div>
    `;
}

function renderLinkedFeatsView(feats) {
    return `
        <div class="job-linked-feats-view">
            <span class="job-linked-feats-label">✦ Class Feats</span>
            <div class="job-linked-feats-list">
                ${feats.map(f => `
                    <div class="job-linked-feat-item">
                        <span class="job-linked-feat-name">${escapeHtml(f.name)}</span>
                        ${(f.tags || []).map(t => `<span class="feat-tag">${escapeHtml(t)}</span>`).join('')}
                        ${f.description ? `<p class="job-linked-feat-desc">${escapeHtml(f.description)}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Renders the sub-skill tree for a job in Player Mode.
 * Always visible regardless of unspentPoints.
 * Raise buttons are always shown; disabled when no points remain.
 * "New sub-skill" row only appears when points > 0.
 *
 * Effective unspent points are computed from actual data at render time:
 *   effectiveUnspent = (level × pointGrantsPerLevel) - totalSpent
 * where totalSpent = sum of all sub-skill levels under this job's tree types.
 * This is reliable regardless of whether the stored job.unspentPoints is correct.
 *
 * Each tree type is matched to the skill of the SAME NAME on its mapped attribute.
 * Unrelated skills (e.g. Athletics on STR) are never included.
 */
function renderJobSubSkillTree(job) {
    const ss        = extensionSettings.statSheet;
    const treeTypes = job.treeTypes || [];
    const attrMap   = job.treeTypeAttributeMap || {};

    if (treeTypes.length === 0) {
        return '';  // No tree types configured — nothing to show
    }

    // ── Compute effective unspent points from real data ───────────────────────
    const totalGranted = (job.level || 0) * (job.pointGrantsPerLevel || 1);
    let totalSpent = 0;
    for (const [treeName, attrId] of Object.entries(attrMap)) {
        const attr  = (ss.attributes || []).find(a => a.id === attrId && a.enabled);
        const skill = (attr?.skills  || []).find(
            s => s.enabled && s.name.toLowerCase() === treeName.toLowerCase()
        );
        if (skill) {
            totalSpent += (skill.subSkills || [])
                .filter(s => s.enabled)
                .reduce((sum, s) => sum + (s.level || 0), 0);
        }
    }
    const effectiveUnspent = Math.max(0, totalGranted - totalSpent);

    // Keep stored value in sync so spend functions stay correct
    if (job.unspentPoints !== effectiveUnspent) {
        job.unspentPoints = effectiveUnspent;
    }

    const hasPoints = effectiveUnspent > 0;

    const groups = treeTypes.map(treeType => {
        const mappedAttrId = attrMap[treeType];
        const mappedAttr   = mappedAttrId
            ? (ss.attributes || []).find(a => a.id === mappedAttrId && a.enabled)
            : null;

        // Only pull sub-skills from the skill whose name matches the tree type
        const matchingSkill = findTreeSkill(treeType, mappedAttr);
        const subSkills     = matchingSkill
            ? (matchingSkill.subSkills || []).filter(s => s.enabled)
            : [];

        const attrLabel = mappedAttr ? mappedAttr.name : null;

        // Parent skill raise buttons removed — sub-skills are the point allocation target.
        const skillRaiseBtn = '';

        const subRows = subSkills.map(sub => `
            <div class="point-alloc-row">
                <span class="point-alloc-name">${escapeHtml(sub.name)}</span>
                <span class="point-alloc-level skill-tree-level">${sub.level || 0}</span>
                ${matchingSkill ? `
                    <button class="btn-refund-job-point ${(sub.level || 0) > 0 ? '' : 'btn-raise-disabled'}"
                            data-job-id="${job.id}"
                            data-attr-id="${mappedAttrId}"
                            data-skill-id="${matchingSkill.id}"
                            data-subskill-id="${sub.id}"
                            ${(sub.level || 0) > 0 ? '' : 'disabled'}
                            title="${(sub.level || 0) > 0 ? `Refund 1 point from ${escapeHtml(sub.name)}` : 'Already at 0'}">▼</button>
                    <button class="btn-spend-job-point ${hasPoints ? '' : 'btn-raise-disabled'}"
                            data-job-id="${job.id}"
                            data-attr-id="${mappedAttrId}"
                            data-skill-id="${matchingSkill.id}"
                            data-subskill-id="${sub.id}"
                            ${hasPoints ? '' : 'disabled'}
                            title="${hasPoints ? `Spend 1 point to raise ${escapeHtml(sub.name)}` : 'No Specialty Points remaining'}">▲</button>
                    ${(sub.level || 0) === 0
                        ? `<button class="btn-delete-zero-subskill"
                                   data-attr-id="${mappedAttrId}"
                                   data-skill-id="${matchingSkill.id}"
                                   data-subskill-id="${sub.id}"
                                   title="Remove this sub-skill (level 0)">✕</button>`
                        : ''}
                ` : ''}
            </div>
        `).join('');

        const emptyNote = subSkills.length === 0
            ? `<div class="subskills-empty">No sub-skills yet.</div>`
            : '';

        // Create row: show whenever points are available AND the tree type has a mapped attribute.
        // If the matching skill doesn't exist yet on the attribute, it will be auto-created on click.
        const createRow = hasPoints && mappedAttrId
            ? `<div class="point-alloc-create-row">
                   <input type="text"
                          class="point-alloc-new-name rpg-input"
                          placeholder="New sub-skill name…"
                          data-job-id="${job.id}"
                          data-attr-id="${mappedAttrId}"
                          data-skill-id="${matchingSkill ? matchingSkill.id : ''}"
                          data-tree-type="${escapeHtml(treeType)}"
                          maxlength="40">
                   <button class="btn-create-job-subskill"
                           data-job-id="${job.id}"
                           data-attr-id="${mappedAttrId}"
                           data-skill-id="${matchingSkill ? matchingSkill.id : ''}"
                           data-tree-type="${escapeHtml(treeType)}"
                           title="Spend 1 point to create this sub-skill">
                       + New (1pt)
                   </button>
               </div>`
            : '';

        const labelAttrPart = attrLabel
            ? ` <span style="opacity:0.45;font-weight:400;font-size:11px;">(${escapeHtml(attrLabel)})</span>`
            : '';

        return `
            <div class="point-alloc-group">
                <div class="point-alloc-group-label" style="display:flex;align-items:center;gap:8px;">
                    <span>${escapeHtml(treeType)}${labelAttrPart}</span>
                    <span style="flex:1;"></span>
                    ${skillRaiseBtn}
                </div>
                ${subRows}
                ${emptyNote}
                ${createRow}
            </div>
        `;
    }).join('');

    return `
        <div class="point-allocation-section">
            <div class="point-alloc-header">
                <span class="point-alloc-title">Skill Tree</span>
                ${hasPoints
                    ? `<span class="point-alloc-remaining">${effectiveUnspent} point${effectiveUnspent !== 1 ? 's' : ''} to spend</span>`
                    : ''}
            </div>
            ${groups}
        </div>
    `;
}

function renderPlayerFeat(feat) {
    const check  = checkFeatPrerequisites(feat.id);
    const locked = !check.met;

    const lockBadge = locked
        ? `<span class="feat-locked-badge" title="Prerequisites not met">🔒 Locked</span>`
        : '';

    const unmetList = locked
        ? `<ul class="feat-prereq-unmet">${check.unmet.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>`
        : '';

    return `
        <div class="feat-view-item ${locked ? 'feat-locked' : ''}">
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="feat-view-name">${escapeHtml(feat.name)}</span>
                ${lockBadge}
            </div>
            ${feat.description
                ? `<p class="feat-view-desc">${escapeHtml(feat.description)}</p>`
                : ''}
            ${unmetList}
            <div class="feat-view-tags">
                ${(feat.tags || []).map(t => `<span class="feat-tag">${escapeHtml(t)}</span>`).join('')}
            </div>
        </div>
    `;
}

// ============================================================================
// MASTER MODE — HTML
// ============================================================================

function renderMasterModeHTML() {
    const ss    = extensionSettings.statSheet;
    const jobs  = ss.jobs  || [];
    const feats = ss.feats || [];

    return `
        <div class="jobs-feats-tab master-mode">
            <div class="tab-header">
                <div class="header-left"><h3>Jobs &amp; Feats</h3></div>
                <div class="header-right">
                    ${buildPromptIncludeToggle('jobsFeats', 'Jobs & Feats')}
                    <button id="btn-toggle-jf-mode" class="btn-toggle-mode btn-exit-master"
                            title="Return to Player Mode">
                        ▶ Player
                    </button>
                </div>
            </div>

            <div class="jobs-section master-section">
                <div class="section-header">
                    <h4>Jobs</h4>
                    <button id="jf-add-job-btn" class="btn-add-small">+ Add Job</button>
                </div>
                <div class="jobs-list">
                    ${jobs.length === 0
                        ? `<div class="subskills-empty">No jobs yet. Add one above.</div>`
                        : jobs.map(job => renderMasterJob(job)).join('')}
                </div>
            </div>

            <div class="feats-section master-section" style="margin-top: 28px;">
                <div class="section-header">
                    <h4>Feats</h4>
                    <button id="jf-add-feat-btn" class="btn-add-small">+ Add Feat</button>
                </div>
                <div class="feats-list">
                    ${feats.length === 0
                        ? `<div class="subskills-empty">No feats yet. Add one above.</div>`
                        : feats.map(feat => renderMasterFeat(feat)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderMasterJob(job) {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss.attributes   || []).filter(a => a.enabled);
    const skills = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled).map(s => ({ ...s, attrName: a.name, attrId: a.id }))
    );
    const savs   = (ss.savingThrows || []).filter(s => s.enabled);
    const atMax  = (job.level || 0) >= 10;
    const isOff  = job.enabled === false;
    const attrMap = job.treeTypeAttributeMap || {};

    // Sync stored unspentPoints to effective value so spend functions stay accurate
    const effectiveUnspent = computeEffectiveUnspent(job);
    if (job.unspentPoints !== effectiveUnspent) {
        job.unspentPoints = effectiveUnspent;
    }


    const bonusesHTML = (job.statBonuses || []).map(sb =>
        renderStatBonusRow(sb, job.id, 'job', attrs, skills, savs)
    ).join('');

    // Tree types: each chip has an attribute assignment dropdown
    const treeTypesHTML = (job.treeTypes || []).map(tag => {
        const selectedAttr = attrMap[tag] || '';
        return `
        <div class="tree-type-chip-row">
            <span class="feat-tag-chip">
                ${escapeHtml(tag)}
                <button class="btn-remove-tree-type"
                        data-job-id="${job.id}"
                        data-tag="${escapeHtml(tag)}"
                        title="Remove tree type">×</button>
            </span>
            <select class="tree-type-attr-select"
                    data-job-id="${job.id}"
                    data-tag="${escapeHtml(tag)}"
                    title="Assign to attribute (controls which sub-skills are shown for point allocation)">
                <option value="">— attr —</option>
                ${attrs.map(a =>
                    `<option value="${a.id}" ${selectedAttr === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
                ).join('')}
            </select>
        </div>`;
    }).join('');

    // Linked feats section
    const allFeats  = ss.feats || [];
    const linkedIds = job.associatedFeatIds || [];
    const linkedFeatsHTML = linkedIds.map(fid => {
        const feat = allFeats.find(f => f.id === fid);
        if (!feat) return '';
        return `
            <span class="feat-tag-chip linked-feat-chip">
                ${escapeHtml(feat.name)}
                <button class="btn-unlink-job-feat"
                        data-job-id="${job.id}"
                        data-feat-id="${fid}"
                        title="Unlink feat">×</button>
            </span>`;
    }).join('');

    const unlinkableFeats = allFeats.filter(f => !linkedIds.includes(f.id));
    const linkFeatSelectHTML = unlinkableFeats.length > 0
        ? `<div class="feat-tag-add-row">
               <select class="link-feat-select" data-job-id="${job.id}">
                   <option value="">Link a feat…</option>
                   ${unlinkableFeats.map(f =>
                       `<option value="${f.id}">${escapeHtml(f.name)}</option>`
                   ).join('')}
               </select>
               <button class="btn-link-job-feat" data-job-id="${job.id}" title="Link feat">+</button>
           </div>`
        : `<span class="subskills-empty">${allFeats.length === 0 ? 'No feats exist yet.' : 'All feats already linked.'}</span>`;

    return `
        <div class="job-item ${isOff ? 'item-disabled' : ''}" data-job-id="${job.id}">
            <div class="job-header">
                <div class="job-name-controls">
                    <input type="text" class="jf-job-name-input"
                           value="${escapeHtml(job.name)}" data-job-id="${job.id}"
                           placeholder="Job Name">
                    <button class="btn-toggle-jf-source-enabled ${isOff ? '' : 'btn-enabled-state'}"
                            data-source-type="job" data-source-id="${job.id}"
                            title="${isOff ? 'Enable this job' : 'Disable this job'}">
                        ${isOff ? '○ Off' : '● On'}
                    </button>
                    <button class="btn-remove-jf-job" data-job-id="${job.id}" title="Remove job">🗑️</button>
                </div>
                <div class="job-level-controls">
                    <span class="level-label">Lv.</span>
                    <button class="btn-decrease-job-level" data-job-id="${job.id}" title="Decrease level">−</button>
                    <span class="job-level-display">${job.level || 0}</span>
                    <button class="btn-increase-job-level" data-job-id="${job.id}" title="Increase level">+</button>
                    ${atMax ? `<span class="job-max-badge">MAX</span>` : ''}
                    <button class="btn-toggle-jf-job-exp-cost ${(job.expCost || 'normal') === 'expensive' ? 'btn-exp-expensive' : ''}"
                            data-job-id="${job.id}"
                            title="${(job.expCost || 'normal') === 'expensive' ? 'Expensive — click for Normal' : 'Normal — click for Expensive'}">
                        ${(job.expCost || 'normal') === 'expensive' ? '💰 Expensive' : 'Normal'}
                    </button>
                </div>
            </div>

            <div class="job-details-row">
                <label class="job-field-label">Points / Level</label>
                <input type="number" class="job-points-per-level-input"
                       value="${job.pointGrantsPerLevel || 1}" min="1" max="10"
                       data-job-id="${job.id}">
                <span class="job-unspent-note">Unspent now: ${computeEffectiveUnspent(job)}</span>
            </div>

            ${renderMilestoneSection(job)}

            <div class="feat-tags-section">
                <span class="subskills-label">Tree Types <span style="font-weight:400;opacity:0.6;font-size:11px;">(assign each to an attribute to control sub-skill allocation)</span></span>
                <div class="feat-tags-list tree-types-list">
                    ${treeTypesHTML}
                    <div class="feat-tag-add-row">
                        <input type="text" class="tree-type-new-input"
                               data-job-id="${job.id}"
                               placeholder="Add tree type…" maxlength="30">
                        <button class="btn-add-tree-type" data-job-id="${job.id}">+</button>
                    </div>
                </div>
            </div>

            <div class="feat-tags-section">
                <span class="subskills-label">✦ Linked Feats <span style="font-weight:400;opacity:0.6;font-size:11px;">(shown on job card in Player Mode)</span></span>
                <div class="feat-tags-list linked-feats-list">
                    ${linkedFeatsHTML}
                    ${linkFeatSelectHTML}
                </div>
            </div>

            ${renderMasterJobSubSkills(job)}

            <div class="stat-bonuses-section">
                <div class="subskills-header">
                    <span class="subskills-label">Stat Bonuses</span>
                    <button class="btn-add-jf-stat-bonus"
                            data-source-type="job" data-source-id="${job.id}">+ Add Bonus</button>
                </div>
                <div class="jf-stat-bonuses-list" data-source-type="job" data-source-id="${job.id}">
                    ${bonusesHTML || '<div class="subskills-empty">No bonuses yet.</div>'}
                </div>
            </div>
        </div>
    `;
}

/**
 * Master Mode: sub-skill editor for a job.
 *
 * Each tree type is matched to the skill of the SAME NAME on its mapped attribute.
 * Only that skill's sub-skills are shown — unrelated skills never appear.
 * If no matching skill exists, shows a clear hint to create it in the Attributes tab.
 */
function renderMasterJobSubSkills(job) {
    const ss        = extensionSettings.statSheet;
    const attrMap   = job.treeTypeAttributeMap || {};
    const treeTypes = job.treeTypes || [];

    if (treeTypes.length === 0) {
        return `
            <div class="feat-tags-section">
                <span class="subskills-label">Sub-Skills
                    <span style="font-weight:400;opacity:0.6;font-size:11px;">
                        (add tree types above first)
                    </span>
                </span>
            </div>
        `;
    }

    const groupsHTML = treeTypes.map(treeType => {
        const mappedAttrId = attrMap[treeType];
        const mappedAttr   = mappedAttrId
            ? (ss.attributes || []).find(a => a.id === mappedAttrId && a.enabled)
            : null;

        // Tree type not yet assigned to an attribute
        if (!mappedAttr) {
            return `
                <div class="master-subskill-group">
                    <div class="master-subskill-group-label">${escapeHtml(treeType)}</div>
                    <div class="subskills-empty">Assign this tree type to an attribute above.</div>
                </div>
            `;
        }

        // Find the skill on the mapped attribute whose name matches the tree type
        const matchingSkill = findTreeSkill(treeType, mappedAttr);

        if (!matchingSkill) {
            return `
                <div class="master-subskill-group">
                    <div class="master-subskill-group-label">
                        ${escapeHtml(treeType)}
                        <span style="opacity:0.55;font-weight:400;font-size:11px;">(${escapeHtml(mappedAttr.name)})</span>
                    </div>
                    <div class="subskills-empty">
                        No skill named "${escapeHtml(treeType)}" on ${escapeHtml(mappedAttr.name)}.
                        Add it in the Attributes tab first.
                    </div>
                </div>
            `;
        }

        const subs    = (matchingSkill.subSkills || []).filter(s => s.enabled);
        const subRows = subs.map(sub => `
            <div class="master-subskill-row" data-subskill-id="${sub.id}">
                <input type="text"
                       class="rpg-input master-subskill-name-input"
                       value="${escapeHtml(sub.name)}"
                       data-attr-id="${mappedAttr.id}"
                       data-skill-id="${matchingSkill.id}"
                       data-subskill-id="${sub.id}"
                       placeholder="Sub-skill name"
                       style="flex:1; min-width:100px;">
                <button class="master-subskill-dec btn-decrease-subskill-master"
                        data-attr-id="${mappedAttr.id}"
                        data-skill-id="${matchingSkill.id}"
                        data-subskill-id="${sub.id}"
                        title="Decrease level">−</button>
                <input type="number"
                       class="rpg-input master-subskill-level-input"
                       value="${sub.level || 0}"
                       min="0"
                       data-attr-id="${mappedAttr.id}"
                       data-skill-id="${matchingSkill.id}"
                       data-subskill-id="${sub.id}"
                       style="width:52px; text-align:center;">
                <button class="master-subskill-inc btn-increase-subskill-master"
                        data-attr-id="${mappedAttr.id}"
                        data-skill-id="${matchingSkill.id}"
                        data-subskill-id="${sub.id}"
                        title="Increase level">+</button>
                <button class="btn-remove-subskill-master"
                        data-attr-id="${mappedAttr.id}"
                        data-skill-id="${matchingSkill.id}"
                        data-subskill-id="${sub.id}"
                        title="Remove sub-skill"
                        style="color:#ff9999; background:transparent; border:none; cursor:pointer; font-size:14px; padding:2px 6px;">✕</button>
            </div>
        `).join('');

        return `
            <div class="master-subskill-group">
                <div class="master-subskill-group-label">
                    ${escapeHtml(treeType)}
                    <span style="opacity:0.55;font-weight:400;font-size:11px;">(${escapeHtml(mappedAttr.name)})</span>
                </div>
                ${subRows}
                <div class="master-subskill-add-row">
                    <input type="text"
                           class="rpg-input master-subskill-new-input"
                           placeholder="New sub-skill name…"
                           data-attr-id="${mappedAttr.id}"
                           data-skill-id="${matchingSkill.id}"
                           maxlength="40"
                           style="flex:1;">
                    <button class="btn-master-add-subskill"
                            data-attr-id="${mappedAttr.id}"
                            data-skill-id="${matchingSkill.id}"
                            title="Add sub-skill (no point cost in Master Mode)">
                        + Add
                    </button>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="feat-tags-section master-subskills-section">
            <span class="subskills-label">Sub-Skills
                <span style="font-weight:400;opacity:0.6;font-size:11px;">
                    (free to add/edit in Master Mode)
                </span>
            </span>
            <div class="master-subskills-list">
                ${groupsHTML || `<div class="subskills-empty">No numeric skills found on mapped attributes.</div>`}
            </div>
        </div>
    `;
}

// ============================================================================
// MASTER MODE — MILESTONES (Attribute / Feat / Sub-skill)
// ============================================================================

function renderMilestoneSection(job) {
    const ss         = extensionSettings.statSheet;
    const attrs      = (ss.attributes || []).filter(a => a.enabled);
    const allFeats   = (ss.feats || []);
    const milestones = (job.attributeMilestones || []);

    const rowsHTML = milestones.map((ms, i) => {
        const type = ms.type || 'attribute';

        // ── Type selector ─────────────────────────────────────────────────────
        const typeSelect = `
            <select class="ms-type-select"
                    data-job-id="${job.id}" data-ms-idx="${i}"
                    style="min-width:100px;">
                <option value="attribute" ${type === 'attribute' ? 'selected' : ''}>Attribute +</option>
                <option value="feat"      ${type === 'feat'      ? 'selected' : ''}>Grant Feat</option>
                <option value="skill"     ${type === 'skill'     ? 'selected' : ''}>Skill +</option>
                <option value="subskill"  ${type === 'subskill'  ? 'selected' : ''}>Sub-skill +</option>
                <option value="module"        ${type === 'module'        ? 'selected' : ''}>Grant Module</option>
                <option value="saving_throw" ${type === 'saving_throw' ? 'selected' : ''}>Save +</option>
            </select>`;

        // ── Level trigger ─────────────────────────────────────────────────────
        const levelInput = `
            <span class="rpg-threshold-label" style="white-space:nowrap;">At Lv.</span>
            <input type="number" class="rpg-threshold-input ms-level-input"
                   data-job-id="${job.id}" data-ms-idx="${i}"
                   value="${ms.level || 1}" min="1" max="10"
                   style="width:52px; text-align:center;">`;

        // ── Dynamic right side based on type ──────────────────────────────────
        let rightSide = '';

        if (type === 'attribute') {
            const attrOptions = attrs.map(a =>
                `<option value="${a.id}" ${ms.attrId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
            ).join('');
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <select class="ms-attr-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1; min-width:80px;">
                    ${attrOptions || '<option value="">— no attributes —</option>'}
                </select>
                <span class="rpg-threshold-label">+</span>
                <input type="number" class="rpg-threshold-input ms-amount-input"
                       data-job-id="${job.id}" data-ms-idx="${i}"
                       value="${ms.amount || 1}" min="1" style="width:52px; text-align:center;">`;

        } else if (type === 'feat') {
            const featOptions = allFeats.map(f =>
                `<option value="${f.id}" ${ms.featId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
            ).join('');
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <select class="ms-feat-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1; min-width:100px;">
                    ${featOptions || '<option value="">— add feats first —</option>'}
                </select>`;

        } else if (type === 'skill') {
            const skillOpts = [];
            for (const attr of attrs) {
                for (const skill of (attr.skills || []).filter(s => s.enabled)) {
                    const selected = ms.skillId === skill.id ? 'selected' : '';
                    skillOpts.push(`<option value="${skill.id}"
                        data-attr-id="${attr.id}"
                        ${selected}>${escapeHtml(attr.name)} / ${escapeHtml(skill.name)}</option>`);
                }
            }
            const attrOptsForSkill = attrs.map(a =>
                `<option value="${a.id}">${escapeHtml(a.name)}</option>`
            ).join('');
            const showNewSkillRow = skillOpts.length === 0;
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:120px;">
                    <div style="display:flex;gap:4px;align-items:center;">
                        <select class="ms-skill-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1;">
                            ${skillOpts.length ? skillOpts.join('') : '<option value="">— none yet —</option>'}
                        </select>
                        <button class="btn-ms-quick-add-skill"
                                data-job-id="${job.id}" data-ms-idx="${i}"
                                title="Quick-add a new skill inline"
                                style="padding:3px 8px;font-size:11px;font-weight:600;border-radius:5px;border:1px solid rgba(100,200,120,0.45);background:rgba(100,200,120,0.1);color:#8ecf9a;cursor:pointer;white-space:nowrap;">＋ New</button>
                    </div>
                    <div class="ms-new-skill-row"
                         data-job-id="${job.id}" data-ms-idx="${i}"
                         style="display:${showNewSkillRow ? 'flex' : 'none'};gap:4px;align-items:center;flex-wrap:wrap;padding:5px 6px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:5px;">
                        ${attrs.length
                            ? `<select class="ms-new-skill-attr rpg-input" data-job-id="${job.id}" data-ms-idx="${i}" style="min-width:100px;font-size:11px;">${attrOptsForSkill}</select>`
                            : `<span style="font-size:11px;opacity:0.55;font-style:italic;">Add attributes first</span>`}
                        <input type="text" class="ms-new-skill-name rpg-input"
                               data-job-id="${job.id}" data-ms-idx="${i}"
                               placeholder="Skill name…"
                               style="flex:1;min-width:80px;font-size:11px;"
                               ${!attrs.length ? 'disabled' : ''}>
                        <button class="btn-ms-confirm-new-skill"
                                data-job-id="${job.id}" data-ms-idx="${i}"
                                ${!attrs.length ? 'disabled' : ''}
                                style="padding:3px 8px;font-size:11px;font-weight:600;border-radius:5px;border:1px solid rgba(100,200,120,0.45);background:rgba(100,200,120,0.12);color:#8ecf9a;cursor:pointer;white-space:nowrap;">Create</button>
                    </div>
                </div>
                <span class="rpg-threshold-label">+</span>
                <input type="number" class="rpg-threshold-input ms-amount-input"
                       data-job-id="${job.id}" data-ms-idx="${i}"
                       value="${ms.amount || 1}" min="1" style="width:52px; text-align:center;">`;

        } else if (type === 'subskill') {
            // Build a flat list of all subskills across all enabled attrs/skills
            const subOptions = [];
            for (const attr of attrs) {
                for (const skill of (attr.skills || []).filter(s => s.enabled)) {
                    for (const sub of (skill.subSkills || []).filter(s => s.enabled)) {
                        const selected = ms.subSkillId === sub.id ? 'selected' : '';
                        subOptions.push(`<option value="${sub.id}"
                            data-attr-id="${attr.id}" data-skill-id="${skill.id}"
                            ${selected}>${escapeHtml(attr.name)} / ${escapeHtml(skill.name)} / ${escapeHtml(sub.name)}</option>`);
                    }
                }
            }
            // Build parent-skill options for the inline quick-create row
            const parentOpts = [];
            for (const attr of attrs) {
                for (const skill of (attr.skills || []).filter(s => s.enabled && s.mode === 'numeric')) {
                    parentOpts.push(`<option value="${skill.id}" data-attr-id="${attr.id}">${escapeHtml(attr.name)} / ${escapeHtml(skill.name)}</option>`);
                }
            }
            const hasParents   = parentOpts.length > 0;
            // Auto-expand the quick-create row when no sub-skills exist yet
            const showNewRow   = subOptions.length === 0;
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:120px;">
                    <div style="display:flex;gap:4px;align-items:center;">
                        <select class="ms-subskill-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1;">
                            ${subOptions.length ? subOptions.join('') : '<option value="">— none yet —</option>'}
                        </select>
                        <button class="btn-ms-quick-add-subskill"
                                data-job-id="${job.id}" data-ms-idx="${i}"
                                title="Quick-add a new sub-skill inline"
                                style="padding:3px 8px;font-size:11px;font-weight:600;border-radius:5px;border:1px solid rgba(100,200,120,0.45);background:rgba(100,200,120,0.1);color:#8ecf9a;cursor:pointer;white-space:nowrap;">＋ New</button>
                    </div>
                    <div class="ms-new-sub-row"
                         data-job-id="${job.id}" data-ms-idx="${i}"
                         style="display:${showNewRow ? 'flex' : 'none'};gap:4px;align-items:center;flex-wrap:wrap;padding:5px 6px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:5px;">
                        ${hasParents
                            ? `<select class="ms-new-sub-parent rpg-input" data-job-id="${job.id}" data-ms-idx="${i}" style="min-width:130px;font-size:11px;">${parentOpts.join('')}</select>`
                            : `<span style="font-size:11px;opacity:0.55;font-style:italic;white-space:nowrap;">Add a numeric skill to an attribute first</span>`}
                        <input type="text" class="ms-new-sub-name rpg-input"
                               data-job-id="${job.id}" data-ms-idx="${i}"
                               placeholder="Sub-skill name…"
                               style="flex:1;min-width:80px;font-size:11px;"
                               ${!hasParents ? 'disabled' : ''}>
                        <button class="btn-ms-confirm-new-subskill"
                                data-job-id="${job.id}" data-ms-idx="${i}"
                                ${!hasParents ? 'disabled' : ''}
                                style="padding:3px 8px;font-size:11px;font-weight:600;border-radius:5px;border:1px solid rgba(100,200,120,0.45);background:rgba(100,200,120,0.12);color:#8ecf9a;cursor:pointer;white-space:nowrap;">Create</button>
                    </div>
                </div>
                <span class="rpg-threshold-label">+</span>
                <input type="number" class="rpg-threshold-input ms-amount-input"
                       data-job-id="${job.id}" data-ms-idx="${i}"
                       value="${ms.amount || 1}" min="1" style="width:52px; text-align:center;">`;

        } else if (type === 'module') {
            const skillOpts = (ss.combatSkills || []).map(s =>
                `<option value="${s.id}" ${ms.skillId === s.id ? 'selected' : ''}>${escapeHtml(s.name || 'Unnamed')}</option>`
            ).join('');
            const rank = ms.moduleRank || 1;
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <select class="ms-module-skill-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1;min-width:100px;" title="Combat skill that receives the module slot">
                    ${skillOpts || '<option value="">— no combat skills yet —</option>'}
                </select>
                <select class="ms-module-rank-select" data-job-id="${job.id}" data-ms-idx="${i}" style="min-width:62px;" title="Module rank">
                    <option value="1" ${rank === 1 ? 'selected' : ''}>R1</option>
                    <option value="2" ${rank === 2 ? 'selected' : ''}>R2</option>
                    <option value="3" ${rank === 3 ? 'selected' : ''}>R3</option>
                </select>
                <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;cursor:pointer;" title="Innate = permanent slot; Spare = draws from the INT-based pool">
                    <input type="checkbox" class="ms-module-innate-chk"
                           data-job-id="${job.id}" data-ms-idx="${i}"
                           ${ms.moduleIsInnate !== false ? 'checked' : ''}>
                    Innate
                </label>`;
        } else if (type === 'saving_throw') {
            const stOptions = (ss.savingThrows || []).filter(s => s.enabled !== false).map(s =>
                `<option value="${s.id}" ${ms.stId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
            ).join('');
            rightSide = `
                <span class="rpg-threshold-label">→</span>
                <select class="ms-st-select" data-job-id="${job.id}" data-ms-idx="${i}" style="flex:1;min-width:100px;">
                    ${stOptions || '<option value="">— no saving throws —</option>'}
                </select>
                <span class="rpg-threshold-label">+</span>
                <input type="number" class="rpg-threshold-input ms-amount-input"
                       data-job-id="${job.id}" data-ms-idx="${i}"
                       value="${ms.amount || 1}" min="1" style="width:52px;text-align:center;">`;
        }

        return `
            <div class="rpg-threshold-row ms-row" data-job-id="${job.id}" data-ms-idx="${i}">
                ${typeSelect}
                ${levelInput}
                ${rightSide}
                ${ms.appliedAt != null
                    ? `<span class="ms-applied-badge" title="Applied at Lv.${ms.appliedAt}" style="font-size:11px;color:#4ade80;white-space:nowrap;">✓ Applied</span>
                       <button class="btn-ms-reset-applied ms-remove-btn"
                               data-job-id="${job.id}" data-ms-idx="${i}"
                               title="Mark as unapplied (won't undo the stat change)"
                               style="font-size:11px;background:transparent;border:1px solid #555;color:#aaa;border-radius:4px;padding:2px 5px;cursor:pointer;">↺</button>`
                    : ''}
                <button class="btn-remove-st-term ms-remove-btn"
                        data-job-id="${job.id}" data-ms-idx="${i}" title="Remove milestone">×</button>
            </div>`;
    }).join('');

    return `
        <div class="feat-tags-section" style="margin-top:4px;">
            <span class="subskills-label">⚑ Milestones
                <span style="font-weight:400;opacity:0.6;font-size:11px;">
                    (rewards granted automatically when job reaches a given level)
                </span>
            </span>
            <div class="rpg-threshold-list" style="margin-top:8px;">
                ${milestones.length === 0 ? '<div class="subskills-empty">No milestones yet.</div>' : ''}
                ${rowsHTML}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;">
                <button class="btn-add-flat-term ms-add-btn" data-job-id="${job.id}">+ Add Milestone</button>
                <button class="btn-apply-current-milestones" data-job-id="${job.id}"
                        title="Manually apply all milestones set at the job's current level (Lv.${job.level || 0}). Use this if milestones were added after the level was already reached."
                        style="background:#2a4a2a;border:1px solid #4a8a4a;color:#8dff8d;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">
                    ⚡ Apply Now (Lv.${job.level || 0})
                </button>
            </div>
        </div>
    `;
}
// ============================================================================
// PREREQUISITES HELPER RENDERER
// ============================================================================

function renderPrereqRow(req, idx, featId, ss) {
    const attrs = (ss.attributes || []).filter(a => a.enabled);
    const jobs  = (ss.jobs  || []);
    const feats = (ss.feats || []);

    let inner = '';

    if (req.type === 'characterLevel') {
        inner = `
            <span class="rpg-threshold-label">Character Level ≥</span>
            <input type="number" class="rpg-threshold-input prereq-value-input"
                   data-feat-id="${featId}" data-prereq-idx="${idx}"
                   value="${req.value || 1}" min="1" style="width:56px; text-align:center;">`;

    } else if (req.type === 'attribute') {
        const attrOpts = attrs.map(a =>
            `<option value="${a.id}" ${req.attrId === a.id ? 'selected':''}>${escapeHtml(a.name)}</option>`
        ).join('');
        inner = `
            <select class="prereq-attr-select" data-feat-id="${featId}" data-prereq-idx="${idx}" style="flex:1;min-width:80px;">
                ${attrOpts || '<option value="">— no attributes —</option>'}
            </select>
            <span class="rpg-threshold-label">≥</span>
            <input type="number" class="rpg-threshold-input prereq-value-input"
                   data-feat-id="${featId}" data-prereq-idx="${idx}"
                   value="${req.value || 1}" min="0" style="width:56px; text-align:center;">`;

    } else if (req.type === 'jobLevel') {
        const jobOpts = jobs.map(j =>
            `<option value="${j.id}" ${req.jobId === j.id ? 'selected':''}>${escapeHtml(j.name)}</option>`
        ).join('');
        inner = `
            <select class="prereq-job-select" data-feat-id="${featId}" data-prereq-idx="${idx}" style="flex:1;min-width:80px;">
                ${jobOpts || '<option value="">— no jobs —</option>'}
            </select>
            <span class="rpg-threshold-label">Lv ≥</span>
            <input type="number" class="rpg-threshold-input prereq-value-input"
                   data-feat-id="${featId}" data-prereq-idx="${idx}"
                   value="${req.value || 1}" min="1" max="10" style="width:52px; text-align:center;">`;

    } else if (req.type === 'feat') {
        const otherFeats = feats.filter(f => f.id !== featId);
        const featOpts   = otherFeats.map(f =>
            `<option value="${f.id}" ${req.featId === f.id ? 'selected':''}>${escapeHtml(f.name)}</option>`
        ).join('');
        inner = `
            <span class="rpg-threshold-label">Has Feat:</span>
            <select class="prereq-feat-select" data-feat-id="${featId}" data-prereq-idx="${idx}" style="flex:1;min-width:100px;">
                ${featOpts || '<option value="">— no other feats —</option>'}
            </select>`;
    }

    return `
        <div class="rpg-threshold-row prereq-row" data-feat-id="${featId}" data-prereq-idx="${idx}">
            ${inner}
            <button class="btn-remove-prereq" data-feat-id="${featId}" data-prereq-idx="${idx}" title="Remove">×</button>
        </div>`;
}


function renderMasterFeat(feat) {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss.attributes   || []).filter(a => a.enabled);
    const skills = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled).map(s => ({ ...s, attrName: a.name, attrId: a.id }))
    );
    const savs  = (ss.savingThrows || []).filter(s => s.enabled);
    const isOff = feat.enabled === false;

    const bonusesHTML = (feat.statBonuses || []).map(sb =>
        renderStatBonusRow(sb, feat.id, 'feat', attrs, skills, savs)
    ).join('');

    const tagsHTML = (feat.tags || []).map(tag => `
        <span class="feat-tag-chip">
            ${escapeHtml(tag)}
            <button class="btn-remove-jf-feat-tag"
                    data-feat-id="${feat.id}"
                    data-tag="${escapeHtml(tag)}"
                    title="Remove tag">×</button>
        </span>
    `).join('');

    return `
        <div class="feat-item ${isOff ? 'item-disabled' : ''}" data-feat-id="${feat.id}">
            <div class="feat-header">
                <input type="text" class="jf-feat-name-input"
                       value="${escapeHtml(feat.name)}" data-feat-id="${feat.id}"
                       placeholder="Feat Name">
                <button class="btn-toggle-jf-source-enabled ${isOff ? '' : 'btn-enabled-state'}"
                        data-source-type="feat" data-source-id="${feat.id}"
                        title="${isOff ? 'Enable this feat' : 'Disable this feat'}">
                    ${isOff ? '○ Off' : '● On'}
                </button>
                <button class="btn-remove-jf-feat" data-feat-id="${feat.id}" title="Remove feat">🗑️</button>
            </div>

            <textarea class="jf-feat-description-input" data-feat-id="${feat.id}"
                      placeholder="Description (optional)" rows="2">${escapeHtml(feat.description || '')}</textarea>

            <div class="feat-tags-section">
                <span class="subskills-label">Tags</span>
                <div class="feat-tags-list">
                    ${tagsHTML}
                    <div class="feat-tag-add-row">
                        <input type="text" class="jf-feat-tag-new-input"
                               data-feat-id="${feat.id}"
                               placeholder="Add tag…" maxlength="30">
                        <button class="btn-add-jf-feat-tag" data-feat-id="${feat.id}">+</button>
                    </div>
                </div>
            </div>

            <div class="feat-tags-section">
                <span class="subskills-label">Prerequisites
                    <span style="font-weight:400;opacity:0.6;font-size:11px;">(all must be met for feat to be available in Player Mode)</span>
                </span>
                <div class="rpg-threshold-list" style="margin-top:8px;">
                    ${(feat.prerequisites || []).length === 0
                        ? '<div class="subskills-empty">No prerequisites — always available.</div>'
                        : (feat.prerequisites || []).map((req, i) => renderPrereqRow(req, i, feat.id, ss)).join('')}
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                    <button class="btn-add-prereq" data-feat-id="${feat.id}" data-prereq-type="characterLevel">+ Char Level</button>
                    <button class="btn-add-prereq" data-feat-id="${feat.id}" data-prereq-type="attribute">+ Attribute</button>
                    <button class="btn-add-prereq" data-feat-id="${feat.id}" data-prereq-type="jobLevel">+ Job Level</button>
                    <button class="btn-add-prereq" data-feat-id="${feat.id}" data-prereq-type="feat">+ Has Feat</button>
                </div>
            </div>

            <div class="stat-bonuses-section">
                <div class="subskills-header">
                    <span class="subskills-label">Stat Bonuses</span>
                    <button class="btn-add-jf-stat-bonus"
                            data-source-type="feat" data-source-id="${feat.id}">+ Add Bonus</button>
                </div>
                <div class="jf-stat-bonuses-list" data-source-type="feat" data-source-id="${feat.id}">
                    ${bonusesHTML || '<div class="subskills-empty">No bonuses yet.</div>'}
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// SHARED — STAT BONUS ROW
// ============================================================================

function renderStatBonusRow(sb, sourceId, sourceType, attrs, skills, savs) {
    const attrOptions  = attrs.map(a =>
        `<option value="${a.id}" ${sb.targetId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
    ).join('');
    const skillOptions = skills.map(s =>
        `<option value="${s.id}" ${sb.targetId === s.id ? 'selected' : ''}>${escapeHtml(s.attrName)} / ${escapeHtml(s.name)}</option>`
    ).join('');
    const savOptions   = savs.map(s =>
        `<option value="${s.id}" ${sb.targetId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');

    // Affinity target options: Type.pool (e.g. "Slash.damage")
    const affOptions = ['Slash.damage','Slash.stagger','Blunt.damage','Blunt.stagger','Pierce.damage','Pierce.stagger']
        .map(t => `<option value="${t}" ${sb.targetId === t ? 'selected' : ''}>${t.replace('.', ' — ')}</option>`).join('');

    const targetOptions = sb.type === 'attribute' ? attrOptions
                        : sb.type === 'skill'     ? skillOptions
                        : sb.type === 'affinity'  ? affOptions
                        :                           savOptions;

    return `
        <div class="stat-bonus-row" data-bonus-id="${sb.id}">
            <select class="jf-stat-bonus-type-select"
                    data-source-type="${sourceType}" data-source-id="${sourceId}"
                    data-bonus-id="${sb.id}">
                <option value="attribute"   ${sb.type === 'attribute'   ? 'selected' : ''}>Attribute</option>
                <option value="skill"       ${sb.type === 'skill'       ? 'selected' : ''}>Skill</option>
                <option value="savingThrow" ${sb.type === 'savingThrow' ? 'selected' : ''}>Saving Throw</option>
                <option value="affinity"    ${sb.type === 'affinity'    ? 'selected' : ''}>Affinity</option>
            </select>
            <select class="jf-stat-bonus-target-select"
                    data-source-type="${sourceType}" data-source-id="${sourceId}"
                    data-bonus-id="${sb.id}">
                ${targetOptions || '<option value="">— none —</option>'}
            </select>
            <span class="st-term-op">+</span>
            <input type="number" class="jf-stat-bonus-value-input"
                   value="${sb.value || 0}"
                   data-source-type="${sourceType}" data-source-id="${sourceId}"
                   data-bonus-id="${sb.id}">
            <button class="btn-remove-jf-stat-bonus"
                    data-source-type="${sourceType}" data-source-id="${sourceId}"
                    data-bonus-id="${sb.id}" title="Remove bonus">×</button>
        </div>
    `;
}

// ============================================================================
// TOGGLE LISTENER (shared by both modes)
// ============================================================================

function attachToggleListener() {
    $(document).off('click', '#btn-toggle-jf-mode')
        .on('click', '#btn-toggle-jf-mode', function() {
            isMasterMode = !isMasterMode;
            refreshCurrentTab();
        });
}

// ============================================================================
// PLAYER MODE — EVENT LISTENERS
// ============================================================================

function attachPlayerModeListeners() {
    // Level up job (spend EXP)
    $(document).off('click', '.btn-raise-job')
        .on('click', '.btn-raise-job', function() {
            const result = levelUpJob($(this).data('job-id'));
            if (result.success) {
                const pts = result.pointsAwarded;
                showNotification(
                    `Job leveled up to ${result.newLevel}! +${pts} point${pts !== 1 ? 's' : ''} granted.`,
                    'success'
                );
                refreshCurrentTab();
            } else {
                showNotification(result.reason || 'Not enough EXP.', 'error');
            }
        });

    // Create new sub-skill by spending a job point
    $(document).off('click', '.btn-create-job-subskill')
        .on('click', '.btn-create-job-subskill', function() {
            const jobId    = $(this).data('job-id');
            const attrId   = $(this).data('attr-id');
            let   skillId  = $(this).data('skill-id');
            const treeType = $(this).data('tree-type');
            const $input   = $(`.point-alloc-new-name[data-job-id="${jobId}"][data-attr-id="${attrId}"]`);
            const name     = ($input.val() || '').trim();
            if (!name) {
                showNotification('Enter a name for the new sub-skill.', 'error');
                $input.focus();
                return;
            }

            // If no matching skill exists yet on the attribute, auto-create it first
            if (!skillId) {
                const ss   = extensionSettings.statSheet;
                const attr = (ss.attributes || []).find(a => a.id === attrId);
                if (!attr) {
                    showNotification('Attribute not found.', 'error');
                    return;
                }
                const newSkillId = generateUniqueId();
                addSkill(attrId, {
                    id:        newSkillId,
                    name:      treeType || 'New Skill',
                    mode:      'numeric',
                    level:     0,
                    enabled:   true,
                    subSkills: [],
                    expCost:   'normal'
                });
                skillId = newSkillId;
                showNotification(`Skill "${treeType}" auto-created on ${attr.name}.`, 'info');
            }

            const result = createSubSkillWithJobPoint(jobId, attrId, skillId, name);
            if (result.success) {
                showNotification(`"${name}" created!`, 'success');
                refreshCurrentTab();
            } else {
                showNotification(result.reason || 'Could not create sub-skill.', 'error');
            }
        });

    // Delete a level-0 sub-skill (no refund — it was never spent)
    $(document).off('click', '.btn-delete-zero-subskill')
        .on('click', '.btn-delete-zero-subskill', function() {
            const attrId    = $(this).data('attr-id');
            const skillId   = $(this).data('skill-id');
            const subSkillId = $(this).data('subskill-id');
            removeSubSkill(attrId, skillId, subSkillId);
            showNotification('Sub-skill removed.', 'info');
            refreshCurrentTab();
        });

    // Allow Enter key on the create input
    $(document).off('keypress', '.point-alloc-new-name')
        .on('keypress', '.point-alloc-new-name', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const jobId  = $(this).data('job-id');
                const attrId = $(this).data('attr-id');
                $(`.btn-create-job-subskill[data-job-id="${jobId}"][data-attr-id="${attrId}"]`).trigger('click');
            }
        });

    // Spend job point on a sub-skill
    $(document).off('click', '.btn-spend-job-point')
        .on('click', '.btn-spend-job-point', function() {
            const result = spendJobPointOnSubSkill(
                $(this).data('job-id'),
                $(this).data('attr-id'),
                $(this).data('skill-id'),
                $(this).data('subskill-id')
            );
            if (result.success) {
                showNotification('Sub-skill raised!', 'success');
                refreshCurrentTab();
            } else {
                showNotification(result.reason || 'Could not spend point.', 'error');
            }
        });

    // Refund point from a sub-skill back to job pool
    $(document).off('click', '.btn-refund-job-point')
        .on('click', '.btn-refund-job-point', function() {
            const result = refundJobPointFromSubSkill(
                $(this).data('job-id'),
                $(this).data('attr-id'),
                $(this).data('skill-id'),
                $(this).data('subskill-id')
            );
            if (result.success) {
                showNotification('Point refunded.', 'info');
                refreshCurrentTab();
            } else {
                showNotification(result.reason || 'Could not refund point.', 'error');
            }
        });

    // Raise parent skill using a job Specialty Point (NOT EXP)
    $(document).off('click', '.btn-spend-job-point-on-skill')
        .on('click', '.btn-spend-job-point-on-skill', function() {
            const jobId   = $(this).data('job-id');
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const ss      = extensionSettings.statSheet;
            const job     = (ss.jobs || []).find(j => j.id === jobId);
            if (!job || (job.unspentPoints || 0) <= 0) {
                showNotification('No Specialty Points remaining.', 'error');
                return;
            }
            job.unspentPoints -= 1;
            updateSkillLevel(attrId, skillId, 1);
            saveStatSheetData();
            showNotification('Skill raised!', 'success');
            refreshCurrentTab();
        });

    // Refund point from parent skill back to job pool
    $(document).off('click', '.btn-refund-job-point-on-skill')
        .on('click', '.btn-refund-job-point-on-skill', function() {
            const result = refundJobPointFromSkill(
                $(this).data('job-id'),
                $(this).data('attr-id'),
                $(this).data('skill-id')
            );
            if (result.success) {
                showNotification('Point refunded.', 'info');
                refreshCurrentTab();
            } else {
                showNotification(result.reason || 'Could not refund point.', 'error');
            }
        });
}

// ============================================================================
// MASTER MODE — EVENT LISTENERS
// ============================================================================

function attachMasterModeListeners() {

    // ── Jobs ──────────────────────────────────────────────────────────────────

    $(document).off('click', '#jf-add-job-btn')
        .on('click', '#jf-add-job-btn', function() {
            addJob({
                id:                  generateUniqueId(),
                name:                'New Job',
                level:               1,
                enabled:             true,
                expCost:             'normal',
                statBonuses:         [],
                treeTypes:           [],
                pointGrantsPerLevel: 1,
                unspentPoints:       1,
                attributeMilestones: [],
                _pointsBootstrapped: true
            });
            refreshCurrentTab();
            showNotification('Job added', 'success');
        });

    $(document).off('click', '.btn-remove-jf-job')
        .on('click', '.btn-remove-jf-job', function() {
            if (confirm('Remove this job?')) {
                removeJob($(this).data('job-id'));
                refreshCurrentTab();
                showNotification('Job removed', 'success');
            }
        });

    $(document).off('change', '.jf-job-name-input')
        .on('change', '.jf-job-name-input', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            if (job) { job.name = $(this).val(); saveStatSheetData(); }
        });

    // Level +/− in Master Mode (no EXP cost — sets directly, but still grants/removes Specialty Points)
    $(document).off('click', '.btn-increase-job-level, .btn-decrease-job-level')
        .on('click', '.btn-increase-job-level, .btn-decrease-job-level', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            if (!job) return;
            const delta    = $(this).hasClass('btn-increase-job-level') ? 1 : -1;
            const oldLevel = job.level || 0;
            const newLevel = Math.max(0, Math.min(10, oldLevel + delta));
            if (newLevel === oldLevel) return;
            const ppl = job.pointGrantsPerLevel || 1;
            job.level = newLevel;
            if (delta > 0) {
                // Levelled up: grant Specialty Points
                job.unspentPoints = (job.unspentPoints || 0) + ppl;
                // Apply any milestones that trigger at this level (same logic as levelUpJob)
                const ss2 = extensionSettings.statSheet;
                for (const ms of (job.attributeMilestones || [])) {
                    if (ms.level !== newLevel) continue;
                    const type = ms.type || 'attribute';
                    if (type === 'attribute') {
                        const attr = (ss2.attributes || []).find(a => a.id === ms.attrId && a.enabled);
                        if (!attr) continue;
                        const max = ss2.editorSettings?.attributeMaxValue || 999;
                        attr.value     = Math.min(max, (attr.value || 0) + (ms.amount || 1));
                        attr.rankValue = attr.value;
                        showNotification(`Milestone: ${attr.name} +${ms.amount || 1}`, 'success');
                    } else if (type === 'feat') {
                        const feat = (ss2.feats || []).find(f => f.id === ms.featId);
                        if (!feat) continue;
                        feat.enabled = true;
                        showNotification(`Milestone: Feat "${feat.name}" unlocked`, 'success');
                    } else if (type === 'subskill') {
                        const attr  = (ss2.attributes || []).find(a => a.id === ms.attrId && a.enabled);
                        const skill = (attr?.skills || []).find(s => s.id === ms.skillId);
                        const sub   = (skill?.subSkills || []).find(s => s.id === ms.subSkillId);
                        if (!sub) continue;
                        sub.level = (sub.level || 0) + (ms.amount || 1);
                        showNotification(`Milestone: ${sub.name} +${ms.amount || 1}`, 'success');
                    } else if (type === 'module') {
                        const cSkill = (ss2.combatSkills || []).find(s => s.id === ms.skillId);
                        if (!cSkill) continue;
                        if (!Array.isArray(cSkill.modules)) cSkill.modules = [];
                        cSkill.modules.push({
                            id:       generateUniqueId(),
                            rank:     ms.moduleRank || 1,
                            name:     '',
                            isInnate: ms.moduleIsInnate !== false,
                            notes:    '',
                        });
                        const innateLabel = ms.moduleIsInnate !== false ? 'Innate' : 'Spare';
                        showNotification(`Milestone: R${ms.moduleRank || 1} ${innateLabel} module → ${cSkill.name || 'Unnamed'}`, 'success');
                    } else if (type === 'saving_throw') {
                        const st = (ss2.savingThrows || []).find(s => s.id === ms.stId);
                        if (!st) continue;
                        if (!Array.isArray(st.terms)) st.terms = [];
                        st.terms.push({ id: generateUniqueId(), type: 'flat', value: ms.amount || 1, _fromMilestone: true });
                        showNotification(`Milestone: ${st.name} +${ms.amount || 1}`, 'success');
                    }
                }
            } else {
                // Levelled down: remove the points that were granted by that level
                job.unspentPoints = Math.max(0, (job.unspentPoints || 0) - ppl);
                // Reverse any milestones that fired AT the level we just left
                const ss2 = extensionSettings.statSheet;
                for (const ms of (job.attributeMilestones || [])) {
                    if (ms.appliedAt !== oldLevel) continue;
                    const undoDesc = _revertMilestone(ms, ss2);
                    if (undoDesc) showNotification(`Milestone reversed: ${undoDesc}`, 'info');
                    delete ms.appliedAt;
                }
            }
            saveStatSheetData();
            refreshCurrentTab();
        });

    $(document).off('input', '.job-points-per-level-input')
        .on('input', '.job-points-per-level-input', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            if (job) {
                const newPPL = Math.max(1, Math.min(10, parseInt($(this).val()) || 1));
                // Capture OLD value BEFORE overwriting — this is the source of the previous bug.
                const oldPPL     = job.pointGrantsPerLevel || 1;
                job.pointGrantsPerLevel = newPPL;
                // Recalculate unspentPoints: newGranted - spent, where spent = oldGranted - oldUnspent.
                const oldGranted = (job.level || 0) * oldPPL;
                const spent      = Math.max(0, oldGranted - (job.unspentPoints || 0));
                const newGranted = (job.level || 0) * newPPL;
                job.unspentPoints = Math.max(0, newGranted - spent);
                saveStatSheetData();
                refreshCurrentTab();
            }
        });

    $(document).off('click', '.btn-toggle-jf-job-exp-cost')
        .on('click', '.btn-toggle-jf-job-exp-cost', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            if (!job) return;
            job.expCost = (job.expCost || 'normal') === 'expensive' ? 'normal' : 'expensive';
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Tree types
    $(document).off('click', '.btn-add-tree-type')
        .on('click', '.btn-add-tree-type', function() {
            const jobId  = $(this).data('job-id');
            const $input = $(`.tree-type-new-input[data-job-id="${jobId}"]`);
            const tag    = ($input.val() || '').trim();
            if (!tag) return;
            const job    = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job) return;
            if (!job.treeTypes) job.treeTypes = [];
            if (!job.treeTypeAttributeMap) job.treeTypeAttributeMap = {};
            if (!job.treeTypes.includes(tag)) { job.treeTypes.push(tag); saveStatSheetData(); refreshCurrentTab(); }
            else $input.val('');
        });

    $(document).off('keypress', '.tree-type-new-input')
        .on('keypress', '.tree-type-new-input', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); $(`.btn-add-tree-type[data-job-id="${$(this).data('job-id')}"]`).trigger('click'); }
        });

    $(document).off('click', '.btn-remove-tree-type')
        .on('click', '.btn-remove-tree-type', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            if (job) {
                const tag = $(this).data('tag');
                job.treeTypes = (job.treeTypes || []).filter(t => t !== tag);
                if (job.treeTypeAttributeMap) delete job.treeTypeAttributeMap[tag];
                saveStatSheetData();
                refreshCurrentTab();
            }
        });

    // Tree type → attribute assignment (auto-creates the skill if it doesn't exist)
    $(document).off('change', '.tree-type-attr-select')
        .on('change', '.tree-type-attr-select', function() {
            const jobId  = $(this).data('job-id');
            const tag    = $(this).data('tag');
            const attrId = $(this).val() || null;
            const job    = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job) return;
            if (!job.treeTypeAttributeMap) job.treeTypeAttributeMap = {};
            if (attrId) {
                job.treeTypeAttributeMap[tag] = attrId;
                // Auto-create the matching skill on the attribute if it doesn't exist
                _ensureTreeSkillExists(attrId, tag);
            } else {
                delete job.treeTypeAttributeMap[tag];
            }
            saveStatSheetData();
            refreshCurrentTab();
        });

    // ── Master Mode Sub-skills ────────────────────────────────────────────────

    // Add sub-skill (free, no point cost)
    $(document).off('click', '.btn-master-add-subskill')
        .on('click', '.btn-master-add-subskill', function() {
            const attrId  = $(this).data('attr-id');
            const skillId = $(this).data('skill-id');
            const $input  = $(`.master-subskill-new-input[data-attr-id="${attrId}"][data-skill-id="${skillId}"]`);
            const name    = ($input.val() || '').trim() || 'New Sub-skill';
            addSubSkill(attrId, skillId, {
                id: generateUniqueId(), name, level: 0, enabled: true
            });
            refreshCurrentTab();
            showNotification(`Sub-skill "${name}" added.`, 'success');
        });

    $(document).off('keypress', '.master-subskill-new-input')
        .on('keypress', '.master-subskill-new-input', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const attrId  = $(this).data('attr-id');
                const skillId = $(this).data('skill-id');
                $(`.btn-master-add-subskill[data-attr-id="${attrId}"][data-skill-id="${skillId}"]`).trigger('click');
            }
        });

    // Remove sub-skill
    $(document).off('click', '.btn-remove-subskill-master')
        .on('click', '.btn-remove-subskill-master', function() {
            if (!confirm('Remove this sub-skill?')) return;
            removeSubSkill($(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'));
            refreshCurrentTab();
            showNotification('Sub-skill removed.', 'success');
        });

    // Rename sub-skill
    $(document).off('change', '.master-subskill-name-input')
        .on('change', '.master-subskill-name-input', function() {
            const attr  = extensionSettings.statSheet.attributes.find(a => a.id === $(this).data('attr-id'));
            const skill = attr?.skills.find(s => s.id === $(this).data('skill-id'));
            const sub   = (skill?.subSkills || []).find(s => s.id === $(this).data('subskill-id'));
            if (sub) { sub.name = $(this).val() || sub.name; saveStatSheetData(); }
        });

    // Sub-skill level +/−
    $(document).off('click', '.btn-increase-subskill-master, .btn-decrease-subskill-master')
        .on('click', '.btn-increase-subskill-master, .btn-decrease-subskill-master', function() {
            const delta = $(this).hasClass('btn-increase-subskill-master') ? 1 : -1;
            updateSubSkillLevel(
                $(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'), delta
            );
            refreshCurrentTab();
        });

    // Sub-skill level direct input
    $(document).off('change', '.master-subskill-level-input')
        .on('change', '.master-subskill-level-input', function() {
            updateSubSkillLevel(
                $(this).data('attr-id'), $(this).data('skill-id'), $(this).data('subskill-id'),
                Math.max(0, parseInt($(this).val()) || 0), true
            );
            refreshCurrentTab();
        });

    // ── Linked feats: link ────────────────────────────────────────────────────
    $(document).off('click', '.btn-link-job-feat')
        .on('click', '.btn-link-job-feat', function() {
            const jobId  = $(this).data('job-id');
            const $sel   = $(`.link-feat-select[data-job-id="${jobId}"]`);
            const featId = $sel.val();
            if (!featId) return;
            const job    = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job) return;
            if (!job.associatedFeatIds) job.associatedFeatIds = [];
            if (!job.associatedFeatIds.includes(featId)) {
                job.associatedFeatIds.push(featId);
                saveStatSheetData();
                refreshCurrentTab();
            }
        });

    // Linked feats: unlink
    $(document).off('click', '.btn-unlink-job-feat')
        .on('click', '.btn-unlink-job-feat', function() {
            const jobId  = $(this).data('job-id');
            const featId = $(this).data('feat-id');
            const job    = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job) return;
            job.associatedFeatIds = (job.associatedFeatIds || []).filter(id => id !== featId);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // ── Feats ─────────────────────────────────────────────────────────────────

    $(document).off('click', '#jf-add-feat-btn')
        .on('click', '#jf-add-feat-btn', function() {
            addFeat({
                id: generateUniqueId(), name: 'New Feat', description: '',
                tags: [], enabled: true, statBonuses: []
            });
            refreshCurrentTab();
            showNotification('Feat added', 'success');
        });

    $(document).off('click', '.btn-remove-jf-feat')
        .on('click', '.btn-remove-jf-feat', function() {
            if (confirm('Remove this feat?')) {
                removeFeat($(this).data('feat-id'));
                refreshCurrentTab();
                showNotification('Feat removed', 'success');
            }
        });

    $(document).off('change', '.jf-feat-name-input')
        .on('change', '.jf-feat-name-input', function() {
            const feat = extensionSettings.statSheet.feats.find(f => f.id === $(this).data('feat-id'));
            if (feat) { feat.name = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.jf-feat-description-input')
        .on('change', '.jf-feat-description-input', function() {
            const feat = extensionSettings.statSheet.feats.find(f => f.id === $(this).data('feat-id'));
            if (feat) { feat.description = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('click', '.btn-add-jf-feat-tag')
        .on('click', '.btn-add-jf-feat-tag', function() {
            const featId = $(this).data('feat-id');
            const $input = $(`.jf-feat-tag-new-input[data-feat-id="${featId}"]`);
            const tag    = ($input.val() || '').trim();
            if (!tag) return;
            const feat   = extensionSettings.statSheet.feats.find(f => f.id === featId);
            if (!feat) return;
            if (!feat.tags) feat.tags = [];
            if (!feat.tags.includes(tag)) { feat.tags.push(tag); saveStatSheetData(); refreshCurrentTab(); }
            else $input.val('');
        });

    $(document).off('keypress', '.jf-feat-tag-new-input')
        .on('keypress', '.jf-feat-tag-new-input', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); $(`.btn-add-jf-feat-tag[data-feat-id="${$(this).data('feat-id')}"]`).trigger('click'); }
        });

    $(document).off('click', '.btn-remove-jf-feat-tag')
        .on('click', '.btn-remove-jf-feat-tag', function() {
            const feat = extensionSettings.statSheet.feats.find(f => f.id === $(this).data('feat-id'));
            if (feat) { feat.tags = (feat.tags || []).filter(t => t !== $(this).data('tag')); saveStatSheetData(); refreshCurrentTab(); }
        });

    // ── Enable / Disable (shared by jobs and feats) ───────────────────────────

    $(document).off('click', '.btn-toggle-jf-source-enabled')
        .on('click', '.btn-toggle-jf-source-enabled', function() {
            const type     = $(this).data('source-type');
            const sourceId = $(this).data('source-id');
            const ss       = extensionSettings.statSheet;
            const source   = type === 'job'
                ? ss.jobs.find(j => j.id === sourceId)
                : ss.feats.find(f => f.id === sourceId);
            if (!source) return;
            // Treat undefined/true as enabled; only false is explicitly off
            source.enabled = (source.enabled !== false) ? false : true;
            saveStatSheetData();
            refreshCurrentTab();
        });

    // ── Stat Bonuses (shared by jobs and feats) ───────────────────────────────

    $(document).off('click', '.btn-add-jf-stat-bonus')
        .on('click', '.btn-add-jf-stat-bonus', function() {
            const sourceType = $(this).data('source-type');
            const sourceId   = $(this).data('source-id');
            const ss         = extensionSettings.statSheet;
            const source     = _getBonusSource(ss, sourceType, sourceId);
            if (!source) return;
            if (!source.statBonuses) source.statBonuses = [];
            const firstAttr = (ss.attributes || []).find(a => a.enabled);
            source.statBonuses.push({
                id:       generateUniqueId(),
                type:     'attribute',
                targetId: firstAttr?.id || '',
                value:    1
            });
            saveStatSheetData();
            refreshCurrentTab();
        });

    $(document).off('click', '.btn-remove-jf-stat-bonus')
        .on('click', '.btn-remove-jf-stat-bonus', function() {
            const { sourceType, sourceId, bonusId } = _getBonusDataset(this);
            const source = _getBonusSource(extensionSettings.statSheet, sourceType, sourceId);
            if (!source) return;
            source.statBonuses = (source.statBonuses || []).filter(sb => sb.id !== bonusId);
            saveStatSheetData();
            refreshCurrentTab();
        });

    $(document).off('change', '.jf-stat-bonus-type-select')
        .on('change', '.jf-stat-bonus-type-select', function() {
            const { sourceType, sourceId, bonusId } = _getBonusDataset(this);
            const ss     = extensionSettings.statSheet;
            const source = _getBonusSource(ss, sourceType, sourceId);
            const sb     = (source?.statBonuses || []).find(b => b.id === bonusId);
            if (!sb) return;
            sb.type = $(this).val();
            // Reset target to first available item of new type
            const attrs  = (ss.attributes   || []).filter(a => a.enabled);
            const allSk  = attrs.flatMap(a => (a.skills || []).filter(s => s.enabled));
            const savs   = (ss.savingThrows || []).filter(s => s.enabled);
            if      (sb.type === 'attribute')   sb.targetId = attrs[0]?.id || '';
            else if (sb.type === 'skill')        sb.targetId = allSk[0]?.id || '';
            else if (sb.type === 'affinity')     sb.targetId = 'Slash.damage';
            else                                 sb.targetId = savs[0]?.id  || '';
            saveStatSheetData();
            refreshCurrentTab();
        });

    $(document).off('change', '.jf-stat-bonus-target-select')
        .on('change', '.jf-stat-bonus-target-select', function() {
            const { sourceType, sourceId, bonusId } = _getBonusDataset(this);
            const source = _getBonusSource(extensionSettings.statSheet, sourceType, sourceId);
            const sb     = (source?.statBonuses || []).find(b => b.id === bonusId);
            if (sb) { sb.targetId = $(this).val(); saveStatSheetData(); }
        });

    $(document).off('change', '.jf-stat-bonus-value-input')
        .on('change', '.jf-stat-bonus-value-input', function() {
            const { sourceType, sourceId, bonusId } = _getBonusDataset(this);
            const source = _getBonusSource(extensionSettings.statSheet, sourceType, sourceId);
            const sb     = (source?.statBonuses || []).find(b => b.id === bonusId);
            if (sb) { sb.value = parseInt($(this).val()) || 0; saveStatSheetData(); }
        });

    // ── Attribute Milestones ──────────────────────────────────────────────────

    // Manually apply all milestones whose level matches the job's current level.
    // Use this when a milestone was added AFTER the job was already at that level.
    $(document).off('click', '.btn-apply-current-milestones')
        .on('click', '.btn-apply-current-milestones', function() {
            const jobId  = $(this).data('job-id');
            const ss     = extensionSettings.statSheet;
            const job    = (ss.jobs || []).find(j => j.id === jobId);
            if (!job) return;
            const targetLevel = job.level || 0;
            let applied = 0;
            let skipped = 0;

            for (const ms of (job.attributeMilestones || [])) {
                if ((ms.level || 1) !== targetLevel) continue;

                // Skip milestones already applied at this level
                if (ms.appliedAt === targetLevel) {
                    skipped++;
                    continue;
                }

                const type = ms.type || 'attribute';

                if (type === 'attribute') {
                    const attr = (ss.attributes || []).find(a => a.id === ms.attrId && a.enabled);
                    if (!attr) continue;
                    const max = ss.editorSettings?.attributeMaxValue || 999;
                    attr.value     = Math.min(max, (attr.value || 0) + (ms.amount || 1));
                    attr.rankValue = attr.value;
                    showNotification(`Milestone applied: ${attr.name} +${ms.amount || 1}`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;

                } else if (type === 'feat') {
                    const feat = (ss.feats || []).find(f => f.id === ms.featId);
                    if (!feat) continue;
                    feat.enabled = true;
                    showNotification(`Milestone applied: Feat "${feat.name}" unlocked`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;

                } else if (type === 'skill') {
                    // Find the skill — ms.attrId might be unset for skill milestones
                    let attr  = null;
                    let skill = null;
                    for (const a of (ss.attributes || [])) {
                        const s = (a.skills || []).find(sk => sk.id === ms.skillId);
                        if (s) { attr = a; skill = s; break; }
                    }
                    if (!skill) continue;
                    const max = ss.editorSettings?.skillMaxValue;
                    skill.level = Math.max(0, (skill.level || 0) + (ms.amount || 1));
                    if (max != null) skill.level = Math.min(max, skill.level);
                    showNotification(`Milestone applied: ${attr?.name} / ${skill.name} +${ms.amount || 1}`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;

                } else if (type === 'subskill') {
                    let sub = null;
                    for (const a of (ss.attributes || [])) {
                        for (const sk of (a.skills || [])) {
                            const s = (sk.subSkills || []).find(ss => ss.id === ms.subSkillId);
                            if (s) { sub = s; break; }
                        }
                        if (sub) break;
                    }
                    if (!sub) continue;
                    sub.level = (sub.level || 0) + (ms.amount || 1);
                    showNotification(`Milestone applied: ${sub.name} +${ms.amount || 1}`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;

                } else if (type === 'module') {
                    const cSkill = (ss.combatSkills || []).find(s => s.id === ms.skillId);
                    if (!cSkill) continue;
                    if (!Array.isArray(cSkill.modules)) cSkill.modules = [];
                    cSkill.modules.push({
                        id:       generateUniqueId(),
                        rank:     ms.moduleRank || 1,
                        name:     '',
                        isInnate: ms.moduleIsInnate !== false,
                        notes:    '',
                    });
                    const innateLabel = ms.moduleIsInnate !== false ? 'Innate' : 'Spare';
                    showNotification(`Milestone applied: R${ms.moduleRank || 1} ${innateLabel} module → ${cSkill.name || 'Unnamed'}`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;

                } else if (type === 'saving_throw') {
                    const st = (ss.savingThrows || []).find(s => s.id === ms.stId);
                    if (!st) continue;
                    if (!Array.isArray(st.terms)) st.terms = [];
                    st.terms.push({ id: generateUniqueId(), type: 'flat', value: ms.amount || 1, _fromMilestone: true });
                    showNotification(`Milestone applied: ${st.name} +${ms.amount || 1}`, 'success');
                    ms.appliedAt = targetLevel;
                    applied++;
                }
            }

            if (applied === 0 && skipped === 0) {
                showNotification(`No milestones configured for Lv.${targetLevel}.`, 'info');
            } else if (applied === 0 && skipped > 0) {
                showNotification(`All Lv.${targetLevel} milestones already applied.`, 'info');
            } else {
                if (skipped > 0) showNotification(`(${skipped} already-applied milestone${skipped !== 1 ? 's' : ''} skipped)`, 'info');
                saveStatSheetData();
            }
            refreshCurrentTab();
        });

    // Add a new milestone (defaults: level 1, first available attribute, +1)
    $(document).off('click', '.ms-add-btn')
        .on('click', '.ms-add-btn', function() {
            const jobId = $(this).data('job-id');
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job) return;
            if (!Array.isArray(job.attributeMilestones)) job.attributeMilestones = [];
            const firstAttr  = (extensionSettings.statSheet.attributes || []).find(a => a.enabled);
            const firstSkill = (extensionSettings.statSheet.combatSkills || [])[0];
            job.attributeMilestones.push({
                id:            generateUniqueId(),
                type:          'attribute',
                level:         1,
                attrId:        firstAttr?.id || '',
                amount:        1,
                // module fields (unused until type switched)
                skillId:       firstSkill?.id || '',
                moduleRank:    1,
                moduleIsInnate: true,
            });
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Remove a milestone by index
    $(document).off('click', '.ms-remove-btn')
        .on('click', '.ms-remove-btn', function() {
            if ($(this).hasClass('btn-ms-reset-applied')) {
                const jobId = $(this).data('job-id');
                const idx   = parseInt($(this).data('ms-idx'));
                const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
                const ms    = job?.attributeMilestones?.[idx];
                if (!ms) return;
                const ss = extensionSettings.statSheet;
                // Ask whether to also undo the actual stat change
                const undo = confirm(
                    'Mark this milestone as unapplied?\n\n' +
                    'OK = also reverse the stat change (subtract what was granted).\n' +
                    'Cancel = only clear the "Applied" flag, keep the stat as-is.'
                );
                if (undo) {
                    const undoDesc = _revertMilestone(ms, ss);
                    if (undoDesc) showNotification(`Milestone reversed: ${undoDesc}`, 'info');
                    else showNotification('Milestone marked unapplied (target not found — stat unchanged).', 'info');
                } else {
                    showNotification('Milestone marked as unapplied (stat unchanged).', 'info');
                }
                delete ms.appliedAt;
                saveStatSheetData();
                refreshCurrentTab();
                return;
            }
            const jobId = $(this).data('job-id');
            const idx   = parseInt($(this).data('ms-idx'));
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            if (!job || isNaN(idx)) return;
            job.attributeMilestones.splice(idx, 1);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Edit milestone level
    $(document).off('change', '.ms-level-input')
        .on('change', '.ms-level-input', function() {
            const jobId = $(this).data('job-id');
            const idx   = parseInt($(this).data('ms-idx'));
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms    = job?.attributeMilestones?.[idx];
            if (!ms) return;
            ms.level = Math.max(1, Math.min(10, parseInt($(this).val()) || 1));
            saveStatSheetData();
        });

    // Edit milestone attribute target
    $(document).off('change', '.ms-attr-select')
        .on('change', '.ms-attr-select', function() {
            const jobId = $(this).data('job-id');
            const idx   = parseInt($(this).data('ms-idx'));
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms    = job?.attributeMilestones?.[idx];
            if (!ms) return;
            ms.attrId = $(this).val();
            saveStatSheetData();
        });

    // Edit milestone amount
    $(document).off('change', '.ms-amount-input')
        .on('change', '.ms-amount-input', function() {
            const jobId = $(this).data('job-id');
            const idx   = parseInt($(this).data('ms-idx'));
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms    = job?.attributeMilestones?.[idx];
            if (!ms) return;
            ms.amount = Math.max(1, parseInt($(this).val()) || 1);
            saveStatSheetData();
        });

    // Milestone type change — reset fields for new type
    $(document).off('change', '.ms-type-select')
        .on('change', '.ms-type-select', function() {
            const jobId = $(this).data('job-id');
            const idx   = parseInt($(this).data('ms-idx'));
            const job   = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms    = job?.attributeMilestones?.[idx];
            if (!ms) return;
            const ss = extensionSettings.statSheet;
            ms.type = $(this).val();
            // Reset type-specific fields
            delete ms.attrId; delete ms.featId; delete ms.subSkillId; delete ms.skillId;
            ms.amount = 1;
            if (ms.type === 'attribute') {
                ms.attrId = (ss.attributes || []).find(a => a.enabled)?.id || '';
            } else if (ms.type === 'feat') {
                ms.featId = (ss.feats || [])[0]?.id || '';
            } else if (ms.type === 'skill') {
                // Pick first available skill
                for (const attr of (ss.attributes || []).filter(a => a.enabled)) {
                    const skill = (attr.skills || []).find(s => s.enabled);
                    if (skill) { ms.attrId = attr.id; ms.skillId = skill.id; break; }
                }
            } else if (ms.type === 'subskill') {
                // Pick first available subskill
                for (const attr of (ss.attributes || []).filter(a => a.enabled)) {
                    for (const skill of (attr.skills || []).filter(s => s.enabled && s.mode === 'numeric')) {
                        const sub = (skill.subSkills || []).find(s => s.enabled);
                        if (sub) { ms.attrId = attr.id; ms.skillId = skill.id; ms.subSkillId = sub.id; break; }
                    }
                    if (ms.subSkillId) break;
                }
            } else if (ms.type === 'module') {
                ms.skillId       = (ss.combatSkills || [])[0]?.id || '';
                ms.moduleRank    = 1;
                ms.moduleIsInnate = true;
            } else if (ms.type === 'saving_throw') {
                ms.stId = (ss.savingThrows || []).find(s => s.enabled !== false)?.id || '';
            }
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Milestone feat select
    $(document).off('change', '.ms-feat-select')
        .on('change', '.ms-feat-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (ms) { ms.featId = $(this).val(); saveStatSheetData(); }
        });

    // Milestone saving throw select
    $(document).off('change', '.ms-st-select')
        .on('change', '.ms-st-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (ms) { ms.stId = $(this).val(); saveStatSheetData(); }
        });

    // Milestone skill select — stores attrId and skillId from option data-attrs
    $(document).off('change', '.ms-skill-select')
        .on('change', '.ms-skill-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (!ms) return;
            const $opt = $(this).find(':selected');
            ms.skillId = $(this).val();
            ms.attrId  = $opt.data('attr-id');
            saveStatSheetData();
        });

    // Milestone subskill select — stores attrId, skillId, subSkillId from option data-attrs
    $(document).off('change', '.ms-subskill-select')
        .on('change', '.ms-subskill-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (!ms) return;
            const $opt   = $(this).find(':selected');
            ms.subSkillId = $(this).val();
            ms.attrId     = $opt.data('attr-id');
            ms.skillId    = $opt.data('skill-id');
            saveStatSheetData();
        });

    // Toggle the inline quick-create row for skill milestones
    $(document).off('click', '.btn-ms-quick-add-skill')
        .on('click', '.btn-ms-quick-add-skill', function() {
            const jobId = $(this).data('job-id');
            const idx   = $(this).data('ms-idx');
            const $row  = $(`.ms-new-skill-row[data-job-id="${jobId}"][data-ms-idx="${idx}"]`);
            $row.toggle();
            if ($row.is(':visible')) $row.find('.ms-new-skill-name').focus();
        });

    // Confirm: create a new skill and wire it to the milestone
    $(document).off('click', '.btn-ms-confirm-new-skill')
        .on('click', '.btn-ms-confirm-new-skill', function() {
            const jobId  = $(this).data('job-id');
            const idx    = parseInt($(this).data('ms-idx'));
            const $row   = $(`.ms-new-skill-row[data-job-id="${jobId}"][data-ms-idx="${idx}"]`);
            const attrId = $row.find('.ms-new-skill-attr').val();
            const name   = ($row.find('.ms-new-skill-name').val() || '').trim();
            if (!name) {
                showNotification('Enter a name for the new skill.', 'error');
                $row.find('.ms-new-skill-name').focus();
                return;
            }
            if (!attrId) {
                showNotification('Select an attribute first.', 'error');
                return;
            }
            const newSkill = {
                id:        generateUniqueId(),
                name,
                mode:      'numeric',
                level:     0,
                enabled:   true,
                subSkills: [],
                expCost:   'normal'
            };
            addSkill(attrId, newSkill);
            // Wire the new skill to the milestone
            const job = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms  = job?.attributeMilestones?.[idx];
            if (ms) {
                ms.skillId = newSkill.id;
                ms.attrId  = attrId;
                saveStatSheetData();
            }
            showNotification(`Skill "${name}" created and selected.`, 'success');
            refreshCurrentTab();
        });

    // Allow Enter key on the skill quick-create name input
    $(document).off('keypress', '.ms-new-skill-name')
        .on('keypress', '.ms-new-skill-name', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const jobId = $(this).data('job-id');
                const idx   = $(this).data('ms-idx');
                $(`.btn-ms-confirm-new-skill[data-job-id="${jobId}"][data-ms-idx="${idx}"]`).trigger('click');
            }
        });

    // Toggle the inline quick-create row for sub-skill milestones
    $(document).off('click', '.btn-ms-quick-add-subskill')
        .on('click', '.btn-ms-quick-add-subskill', function() {
            const jobId = $(this).data('job-id');
            const idx   = $(this).data('ms-idx');
            const $row  = $(`.ms-new-sub-row[data-job-id="${jobId}"][data-ms-idx="${idx}"]`);
            $row.toggle();
            if ($row.is(':visible')) $row.find('.ms-new-sub-name').focus();
        });

    // Confirm: create a new sub-skill and wire it to the milestone
    $(document).off('click', '.btn-ms-confirm-new-subskill')
        .on('click', '.btn-ms-confirm-new-subskill', function() {
            const jobId  = $(this).data('job-id');
            const idx    = parseInt($(this).data('ms-idx'));
            const $row   = $(`.ms-new-sub-row[data-job-id="${jobId}"][data-ms-idx="${idx}"]`);
            const $par   = $row.find('.ms-new-sub-parent');
            const name   = ($row.find('.ms-new-sub-name').val() || '').trim();
            if (!name) {
                showNotification('Enter a name for the new sub-skill.', 'error');
                $row.find('.ms-new-sub-name').focus();
                return;
            }
            const skillId = $par.val();
            const attrId  = $par.find(':selected').data('attr-id');
            if (!skillId || !attrId) {
                showNotification('Select a parent skill first.', 'error');
                return;
            }
            const newSub = { id: generateUniqueId(), name, level: 0, enabled: true };
            addSubSkill(attrId, skillId, newSub);
            // Wire the new sub-skill to the milestone
            const job = extensionSettings.statSheet.jobs.find(j => j.id === jobId);
            const ms  = job?.attributeMilestones?.[idx];
            if (ms) {
                ms.subSkillId = newSub.id;
                ms.skillId    = skillId;
                ms.attrId     = attrId;
                saveStatSheetData();
            }
            showNotification(`Sub-skill "${name}" created and selected.`, 'success');
            refreshCurrentTab();
        });

    // Allow Enter key on the quick-create name input
    $(document).off('keypress', '.ms-new-sub-name')
        .on('keypress', '.ms-new-sub-name', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const jobId = $(this).data('job-id');
                const idx   = $(this).data('ms-idx');
                $(`.btn-ms-confirm-new-subskill[data-job-id="${jobId}"][data-ms-idx="${idx}"]`).trigger('click');
            }
        });

    // ── Module milestone fields ───────────────────────────────────────────────

    // Which combat skill receives the module slot
    $(document).off('change', '.ms-module-skill-select')
        .on('change', '.ms-module-skill-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (ms) { ms.skillId = $(this).val(); saveStatSheetData(); }
        });

    // Module rank (R1 / R2 / R3)
    $(document).off('change', '.ms-module-rank-select')
        .on('change', '.ms-module-rank-select', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (ms) { ms.moduleRank = parseInt($(this).val()) || 1; saveStatSheetData(); }
        });

    // Innate vs Spare toggle
    $(document).off('change', '.ms-module-innate-chk')
        .on('change', '.ms-module-innate-chk', function() {
            const job = extensionSettings.statSheet.jobs.find(j => j.id === $(this).data('job-id'));
            const ms  = job?.attributeMilestones?.[parseInt($(this).data('ms-idx'))];
            if (ms) { ms.moduleIsInnate = $(this).is(':checked'); saveStatSheetData(); }
        });

    // ── Feat Prerequisites ────────────────────────────────────────────────────

    // Add prerequisite
    $(document).off('click', '.btn-add-prereq')
        .on('click', '.btn-add-prereq', function() {
            const featId = $(this).data('feat-id');
            const type   = $(this).data('prereq-type');
            const ss     = extensionSettings.statSheet;
            const feat   = (ss.feats || []).find(f => f.id === featId);
            if (!feat) return;
            if (!Array.isArray(feat.prerequisites)) feat.prerequisites = [];
            const req = { id: generateUniqueId(), type };
            if      (type === 'characterLevel') { req.value  = 1; }
            else if (type === 'attribute')      { req.attrId = (ss.attributes || []).find(a => a.enabled)?.id || ''; req.value = 10; }
            else if (type === 'jobLevel')       { req.jobId  = (ss.jobs  || [])[0]?.id || ''; req.value = 1; }
            else if (type === 'feat')           { req.featId = (ss.feats || []).find(f => f.id !== featId)?.id || ''; }
            feat.prerequisites.push(req);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Remove prerequisite
    $(document).off('click', '.btn-remove-prereq')
        .on('click', '.btn-remove-prereq', function() {
            const featId = $(this).data('feat-id');
            const idx    = parseInt($(this).data('prereq-idx'));
            const feat   = extensionSettings.statSheet.feats?.find(f => f.id === featId);
            if (!feat || isNaN(idx)) return;
            feat.prerequisites.splice(idx, 1);
            saveStatSheetData();
            refreshCurrentTab();
        });

    // Edit prereq: character/attribute/job level value
    $(document).off('change', '.prereq-value-input')
        .on('change', '.prereq-value-input', function() {
            const feat = extensionSettings.statSheet.feats?.find(f => f.id === $(this).data('feat-id'));
            const req  = feat?.prerequisites?.[parseInt($(this).data('prereq-idx'))];
            if (req) { req.value = parseInt($(this).val()) || 1; saveStatSheetData(); }
        });

    // Edit prereq: attribute target
    $(document).off('change', '.prereq-attr-select')
        .on('change', '.prereq-attr-select', function() {
            const feat = extensionSettings.statSheet.feats?.find(f => f.id === $(this).data('feat-id'));
            const req  = feat?.prerequisites?.[parseInt($(this).data('prereq-idx'))];
            if (req) { req.attrId = $(this).val(); saveStatSheetData(); }
        });

    // Edit prereq: job target
    $(document).off('change', '.prereq-job-select')
        .on('change', '.prereq-job-select', function() {
            const feat = extensionSettings.statSheet.feats?.find(f => f.id === $(this).data('feat-id'));
            const req  = feat?.prerequisites?.[parseInt($(this).data('prereq-idx'))];
            if (req) { req.jobId = $(this).val(); saveStatSheetData(); }
        });

    // Edit prereq: required feat target
    $(document).off('change', '.prereq-feat-select')
        .on('change', '.prereq-feat-select', function() {
            const feat = extensionSettings.statSheet.feats?.find(f => f.id === $(this).data('feat-id'));
            const req  = feat?.prerequisites?.[parseInt($(this).data('prereq-idx'))];
            if (req) { req.featId = $(this).val(); saveStatSheetData(); }
        });
}

// ============================================================================
// DATASET HELPERS
// ============================================================================

/**
 * Ensures a numeric skill with the given name exists on the specified attribute.
 * Called automatically when a tree type is assigned to an attribute in Master Mode.
 * Does nothing if the skill already exists (case-insensitive match).
 */
function _ensureTreeSkillExists(attrId, skillName) {
    const ss   = extensionSettings.statSheet;
    const attr = (ss.attributes || []).find(a => a.id === attrId);
    if (!attr) return;
    const already = (attr.skills || []).some(
        s => s.name.toLowerCase() === skillName.toLowerCase()
    );
    if (!already) {
        addSkill(attrId, {
            id:        generateUniqueId(),
            name:      skillName,
            mode:      'numeric',
            level:     0,
            enabled:   true,
            subSkills: [],
            expCost:   'normal'
        });
        showNotification(`Skill "${skillName}" auto-created on ${attr.name}.`, 'info');
    }
}

/**
 * Reverse the stat mutation that a milestone caused when it was applied.
 * Handles: attribute, skill, subskill, feat, module.
 * Returns a human-readable description of what was undone (or null if nothing found).
 *
 * @param {object} ms  — the milestone object (must have appliedAt set)
 * @param {object} ss  — extensionSettings.statSheet
 * @returns {string|null}
 */
function _revertMilestone(ms, ss) {
    const type = ms.type || 'attribute';

    if (type === 'attribute') {
        const attr = (ss.attributes || []).find(a => a.id === ms.attrId);
        if (!attr) return null;
        attr.value     = Math.max(0, (attr.value || 0) - (ms.amount || 1));
        attr.rankValue = attr.value;
        return `${attr.name} −${ms.amount || 1}`;

    } else if (type === 'skill') {
        for (const a of (ss.attributes || [])) {
            const skill = (a.skills || []).find(s => s.id === ms.skillId);
            if (skill) {
                skill.level = Math.max(0, (skill.level || 0) - (ms.amount || 1));
                return `${a.name} / ${skill.name} −${ms.amount || 1}`;
            }
        }
        return null;

    } else if (type === 'subskill') {
        for (const a of (ss.attributes || [])) {
            for (const sk of (a.skills || [])) {
                const sub = (sk.subSkills || []).find(s => s.id === ms.subSkillId);
                if (sub) {
                    sub.level = Math.max(0, (sub.level || 0) - (ms.amount || 1));
                    return `${sub.name} −${ms.amount || 1}`;
                }
            }
        }
        return null;

    } else if (type === 'feat') {
        const feat = (ss.feats || []).find(f => f.id === ms.featId);
        if (!feat) return null;
        feat.enabled = false;
        return `Feat "${feat.name}" disabled`;

    } else if (type === 'module') {
        // Remove the most recently added module matching the rank from the target skill
        const cSkill = (ss.combatSkills || []).find(s => s.id === ms.skillId);
        if (!cSkill || !Array.isArray(cSkill.modules)) return null;
        const targetRank    = ms.moduleRank || 1;
        const targetInnate  = ms.moduleIsInnate !== false;
        // Find last module that matches rank + innate, with empty name (auto-generated)
        const idx = [...cSkill.modules].reverse().findIndex(
            m => m.rank === targetRank && m.isInnate === targetInnate && (m.name || '') === ''
        );
        if (idx === -1) return null;
        const realIdx = cSkill.modules.length - 1 - idx;
        cSkill.modules.splice(realIdx, 1);
        return `R${targetRank} ${targetInnate ? 'Innate' : 'Spare'} module removed from ${cSkill.name || 'skill'}`;

    } else if (type === 'saving_throw') {
        const st = (ss.savingThrows || []).find(s => s.id === ms.stId);
        if (!st || !Array.isArray(st.terms)) return null;
        const targetVal = ms.amount || 1;
        // Remove the last milestone-granted flat term matching this amount
        const idx = [...st.terms].reverse().findIndex(
            t => t.type === 'flat' && t.value === targetVal && t._fromMilestone
        );
        if (idx === -1) return null;
        const realIdx = st.terms.length - 1 - idx;
        st.terms.splice(realIdx, 1);
        return `${st.name} −${targetVal}`;
    }

    return null;
}

function _getBonusDataset(el) {
    const $el = $(el);
    return {
        sourceType: $el.data('source-type'),
        sourceId:   $el.data('source-id'),
        bonusId:    $el.data('bonus-id')
    };
}

function _getBonusSource(ss, sourceType, sourceId) {
    return sourceType === 'job'
        ? (ss.jobs  || []).find(j => j.id === sourceId)
        : (ss.feats || []).find(f => f.id === sourceId);
}
