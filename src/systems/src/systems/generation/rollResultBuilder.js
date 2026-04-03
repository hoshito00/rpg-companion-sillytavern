/**
 * Roll Result Builder  (Stars of the City — Phase 5)
 *
 * Converts ClashReport data into HTML strings for the encounter combat log.
 * Zero DOM dependency — all functions return HTML strings only.
 * Caller is responsible for injecting into the DOM via addHTMLToLog().
 *
 * Deploy path: src/systems/generation/rollResultBuilder.js
 *
 * Exports:
 *   buildPairRowHTML(pair)                 — one die-vs-die pair row
 *   buildClashBlockHTML(report, meta)      — full visual block for one enemy skill
 *   buildRoundSummaryHTML(summary)         — round-total footer with status flags
 */

// ── Die colour mapping ────────────────────────────────────────────────────────
// Mirrors _getDieColorClass() in encounterUI.js — kept local to avoid circular import.

function _dieColorClass(diceType) {
    if (!diceType) return 'cs-dt-offensive';
    const dt = diceType.toLowerCase();
    if (dt === 'slash' || dt === 'pierce' || dt === 'blunt') return 'cs-dt-offensive';
    if (
        dt.startsWith('counter-slash') ||
        dt.startsWith('counter-pierce') ||
        dt.startsWith('counter-blunt')
    ) return 'cs-dt-counter';
    return 'cs-dt-defensive'; // Block, Evade, Counter-Block, Counter-Evade
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a flat modifier for display alongside a die label.
 * Returns '' for 0, '+N' for positive, '-N' for negative.
 * @param {number} mod
 * @returns {string}
 */
function _modStr(mod) {
    if (!mod || mod === 0) return '';
    return mod > 0 ? `+${mod}` : `${mod}`;
}

/**
 * Build a die chip HTML span.
 * Reuses the existing cs-die-chip + cs-dt-* classes from style.css.
 * @param {{ diceType: string, sides: number, modifier?: number }} die
 * @returns {string}
 */
function _dieChip(die) {
    const cls = _dieColorClass(die.diceType);
    return `<span class="cs-die-chip ${cls}">${die.diceType}&thinsp;d${die.sides}${_modStr(die.modifier ?? 0)}</span>`;
}

// ── Single pair row ───────────────────────────────────────────────────────────

/**
 * Build one row of the clash table for a single PairRecord.
 *
 * Layout (4 columns via CSS grid):
 *   [player die + roll] | [VS / UNOPPOSED / =] | [roll + enemy die] | [damage]
 *
 * @param {PairRecord} pair
 * @returns {string} HTML
 */
export function buildPairRowHTML(pair) {
    const { playerDie, enemyDie, playerRoll, enemyRoll, outcome, hpDelta, staggerDelta } = pair;

    const isPlayerWin  = outcome === 'player'          || outcome === 'unopposed-player';
    const isEnemyWin   = outcome === 'enemy'           || outcome === 'unopposed-enemy';
    const isTie        = outcome === 'tie';
    const isUnopposed  = outcome === 'unopposed-player' || outcome === 'unopposed-enemy';
    const isCounterRow = pair.note?.startsWith('[Counter]') ?? false;

    // ── Player die cell ───────────────────────────────────────────────────────
    let playerCell = '<div class="rrb-die-cell rrb-player-side rrb-empty"></div>';
    if (playerDie) {
        const rollCls = isPlayerWin ? 'rrb-roll-win' : (isTie ? 'rrb-roll-tie' : 'rrb-roll-loss');
        const rollSpan = playerRoll !== null
            ? `<span class="rrb-roll ${rollCls}">${playerRoll}</span>`
            : '';
        const counterTag = isCounterRow && playerDie.diceType.startsWith('Counter')
            ? '<span class="rrb-counter-tag">↺</span>'
            : '';
        playerCell = `
            <div class="rrb-die-cell rrb-player-side">
                ${counterTag}${_dieChip(playerDie)}${rollSpan}
            </div>`;
    }

    // ── Enemy die cell ────────────────────────────────────────────────────────
    let enemyCell = '<div class="rrb-die-cell rrb-enemy-side rrb-empty"></div>';
    if (enemyDie) {
        const rollCls = isEnemyWin ? 'rrb-roll-win' : (isTie ? 'rrb-roll-tie' : 'rrb-roll-loss');
        const rollSpan = enemyRoll !== null
            ? `<span class="rrb-roll ${rollCls}">${enemyRoll}</span>`
            : '';
        const counterTag = isCounterRow && enemyDie.diceType.startsWith('Counter')
            ? '<span class="rrb-counter-tag">↺</span>'
            : '';
        enemyCell = `
            <div class="rrb-die-cell rrb-enemy-side">
                ${rollSpan}${_dieChip(enemyDie)}${counterTag}
            </div>`;
    }

    // ── Middle separator ──────────────────────────────────────────────────────
    let midHTML;
    if (isUnopposed) {
        midHTML = '<span class="rrb-unopposed">FREE</span>';
    } else if (isTie) {
        midHTML = '<span class="rrb-tie-icon">═</span>';
    } else {
        midHTML = '<span class="rrb-vs-sep">VS</span>';
    }

    // ── Damage / outcome annotation ───────────────────────────────────────────
    let damageHTML = '';
    if (hpDelta > 0 || staggerDelta > 0) {
        const parts = [];
        if (hpDelta      > 0) parts.push(`${hpDelta} HP`);
        if (staggerDelta > 0) parts.push(`${staggerDelta} Stagger`);
        const arrowStr = isPlayerWin ? '→' : '←';
        damageHTML = `<span class="rrb-damage">${arrowStr}&thinsp;${parts.join('&thinsp;/&thinsp;')}</span>`;
    } else if (outcome === 'player' || outcome === 'unopposed-player') {
        // Defensive win — attacker deflected
        damageHTML = '<span class="rrb-deflect">deflected</span>';
    } else if (outcome === 'enemy') {
        // Enemy defensive win
        damageHTML = '<span class="rrb-deflect">blocked</span>';
    } else if (outcome === 'tie') {
        damageHTML = '<span class="rrb-deflect">cancel</span>';
    }

    // Map outcome to a CSS modifier class (safe for CSS selectors)
    const outcomeCls = `rrb-outcome-${outcome.replace('unopposed-', 'unopp-')}`;

    return `
        <div class="rrb-pair ${outcomeCls}">
            ${playerCell}
            <div class="rrb-pair-mid">${midHTML}</div>
            ${enemyCell}
            <div class="rrb-damage-cell">${damageHTML}</div>
        </div>`;
}

// ── Full clash block ──────────────────────────────────────────────────────────

/**
 * Build the complete visual block for one enemy-skill clash.
 * Each ClashReport (one per enemy skill in the initiative queue) gets one block.
 *
 * @param {ClashReport} report
 * @param {{ skillName: string, enemyName: string, speedRoll: number }} meta
 * @returns {string} HTML
 */
export function buildClashBlockHTML(report, meta) {
    const { skillName, enemyName, speedRoll } = meta;

    const pairsHTML = report.pairs.map(pair => buildPairRowHTML(pair)).join('');

    // ── Per-clash damage totals ───────────────────────────────────────────────
    const playerHpLost  = Math.abs(report.hpDeltaPlayer);
    const playerSRLost  = Math.abs(report.staggerDeltaPlayer);
    const enemyHpLost   = Math.abs(report.hpDeltaEnemy);
    const enemySRLost   = Math.abs(report.staggerDeltaEnemy);

    const hasPlayerDmg = playerHpLost > 0 || playerSRLost > 0;
    const hasEnemyDmg  = enemyHpLost  > 0 || enemySRLost  > 0;

    let totalsHTML = '';
    if (hasPlayerDmg || hasEnemyDmg) {
        const parts = [];
        if (hasEnemyDmg)  parts.push(`<span class="rrb-total-enemy">Enemy −${enemyHpLost}&thinsp;HP&thinsp;/&thinsp;−${enemySRLost}&thinsp;Stagger</span>`);
        if (hasPlayerDmg) parts.push(`<span class="rrb-total-player">You −${playerHpLost}&thinsp;HP&thinsp;/&thinsp;−${playerSRLost}&thinsp;Stagger</span>`);
        totalsHTML = `
            <div class="rrb-clash-totals">
                ${parts.join('<span class="rrb-total-sep">·</span>')}
            </div>`;
    }

    const speedLabel = speedRoll > 0
        ? `<span class="rrb-speed-badge">⚡&thinsp;${speedRoll}</span>`
        : '';

    return `
        <div class="rrb-clash-block">
            <div class="rrb-clash-header">
                <span class="rrb-enemy-name">${enemyName}</span>
                <span class="rrb-skill-name">&ldquo;${skillName}&rdquo;</span>
                ${speedLabel}
            </div>
            <div class="rrb-pairs">${pairsHTML}</div>
            ${totalsHTML}
        </div>`;
}

// ── Round summary ─────────────────────────────────────────────────────────────

/**
 * Build a summary footer for the entire round, showing accumulated player deltas
 * and any triggered status events.
 *
 * Returns an empty string if there is nothing worth showing.
 *
 * @param {{
 *   totalHpDelta      : number,   // negative = damage taken by player
 *   totalStaggerDelta : number,   // negative = SR damage taken by player
 *   playerStaggered   : boolean,
 *   playerKilled      : boolean,
 * }} summary
 * @returns {string} HTML
 */
export function buildRoundSummaryHTML(summary) {
    const { totalHpDelta, totalStaggerDelta, playerStaggered, playerKilled } = summary;

    const hpLost    = Math.abs(totalHpDelta);
    const srLost    = Math.abs(totalStaggerDelta);
    const hasDamage = hpLost > 0 || srLost > 0;
    const hasStatus = playerStaggered || playerKilled;

    if (!hasDamage && !hasStatus) return '';

    const parts = [];

    if (hasDamage) {
        parts.push(
            `<span class="rrb-summary-damage">Round: −${hpLost}&thinsp;HP&thinsp;&middot;&thinsp;−${srLost}&thinsp;Stagger to you</span>`
        );
    }
    if (playerStaggered) parts.push('<span class="rrb-status-flag rrb-flag-staggered">💫 STAGGERED</span>');
    if (playerKilled)    parts.push('<span class="rrb-status-flag rrb-flag-killed">💀 DEFEATED</span>');

    return `<div class="rrb-round-summary">${parts.join('')}</div>`;
}
