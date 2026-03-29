/**
 * EXP Gain Module  (Session 10)
 *
 * Scans each AI response for an <exp_gain> tag, then presents
 * a confirmation popup before writing the value into the stat sheet.
 *
 * Tag format the AI should write (add to your system / encounter prompt):
 *   <exp_gain>50</exp_gain>
 *
 * Rules:
 *  • Only one tag per message is read (the first match wins).
 *  • The tag is stripped from the displayed message after confirmation.
 *  • If ss.level.autoCalculate is true, level-ups are applied automatically.
 *
 * Exports:
 *   onMessageReceivedExpCheck(data)  — wire to event_types.MESSAGE_RECEIVED
 */

import { extensionSettings }   from '../../core/state.js';
import { saveStatSheetData }   from '../../core/persistence.js';

// ── CSS (injected once) ───────────────────────────────────────────────────────

const _CSS_ID = 'rpg-exp-gain-styles';

function _injectStyles() {
    if (document.getElementById(_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = _CSS_ID;
    style.textContent = `
        #rpg-exp-popup-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.65);
            z-index: 99998;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #rpg-exp-popup {
            background: #1a1a2e;
            border: 1px solid #4a4a6a;
            border-radius: 12px;
            padding: 28px 32px 24px;
            min-width: 300px;
            max-width: 420px;
            color: #e0e0f0;
            font-family: inherit;
            box-shadow: 0 8px 32px rgba(0,0,0,.6);
            text-align: center;
            animation: rpg-exp-popup-in .18s ease;
        }
        @keyframes rpg-exp-popup-in {
            from { transform: scale(.88); opacity: 0; }
            to   { transform: scale(1);  opacity: 1; }
        }
        #rpg-exp-popup .exp-icon {
            font-size: 2.4rem;
            margin-bottom: 8px;
        }
        #rpg-exp-popup h3 {
            margin: 0 0 6px;
            font-size: 1.15rem;
            color: #ffd700;
            letter-spacing: .04em;
        }
        #rpg-exp-popup .exp-amount {
            font-size: 2rem;
            font-weight: 700;
            color: #7ec8e3;
            margin: 8px 0 4px;
        }
        #rpg-exp-popup .exp-current {
            font-size: .85rem;
            color: #8888aa;
            margin-bottom: 20px;
        }
        #rpg-exp-popup .exp-btn-row {
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        #rpg-exp-popup .exp-btn {
            padding: 8px 22px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: .95rem;
            font-weight: 600;
            transition: opacity .15s;
        }
        #rpg-exp-popup .exp-btn:hover { opacity: .85; }
        #rpg-exp-popup .exp-btn-confirm {
            background: #4a9eff;
            color: #fff;
        }
        #rpg-exp-popup .exp-btn-deny {
            background: #3a3a5a;
            color: #b0b0cc;
        }
        #rpg-exp-popup .exp-levelup-notice {
            margin: 10px 0 0;
            padding: 8px 14px;
            background: rgba(255,215,0,.12);
            border: 1px solid rgba(255,215,0,.35);
            border-radius: 7px;
            color: #ffd700;
            font-size: .88rem;
            display: none;
        }
    `;
    document.head.appendChild(style);
}

// ── EXP application ───────────────────────────────────────────────────────────

/**
 * Add exp to ss.level.exp.
 * If autoCalculate is true, also bumps ss.level.current for each full expPerLevel block.
 * Saves to persistence automatically.
 * @param {number} amount
 * @returns {{ newExp: number, levelUps: number, newLevel: number }}
 */
export function applyExpGain(amount) {
    const ss  = extensionSettings.statSheet;
    const lvl = ss.level;

    lvl.exp = (lvl.exp ?? 0) + amount;

    let levelUps = 0;

    if (lvl.autoCalculate && lvl.expPerLevel > 0) {
        while (lvl.exp >= lvl.expPerLevel) {
            lvl.exp       -= lvl.expPerLevel;
            lvl.current    = (lvl.current ?? 1) + 1;
            levelUps++;
        }
    }

    saveStatSheetData();

    return {
        newExp:   lvl.exp,
        levelUps,
        newLevel: lvl.current ?? 1
    };
}

// ── Popup ─────────────────────────────────────────────────────────────────────

/**
 * Show the confirmation popup for an EXP gain.
 * Resolves true (confirmed) or false (denied / dismissed).
 * @param {number} amount
 * @returns {Promise<boolean>}
 */
function _showPopup(amount) {
    return new Promise(resolve => {
        _injectStyles();

        const ss       = extensionSettings.statSheet;
        const lvl      = ss?.level;
        const curExp   = lvl?.exp     ?? 0;
        const curLevel = lvl?.current ?? 1;
        const perLevel = lvl?.expPerLevel ?? 0;

        // Preview: would this trigger a level-up?
        let levelUpsPreview = 0;
        if (lvl?.autoCalculate && perLevel > 0) {
            let simExp = curExp + amount;
            while (simExp >= perLevel) { simExp -= perLevel; levelUpsPreview++; }
        }

        const expAfter = perLevel > 0
            ? `${curExp + amount - levelUpsPreview * perLevel} / ${perLevel} EXP`
            : `${curExp + amount} EXP`;

        const $overlay = $(`
            <div id="rpg-exp-popup-overlay">
                <div id="rpg-exp-popup">
                    <div class="exp-icon">✨</div>
                    <h3>EXP Gained</h3>
                    <div class="exp-amount">+${amount} EXP</div>
                    <div class="exp-current">
                        Level ${curLevel} &nbsp;·&nbsp; ${expAfter}
                    </div>
                    ${levelUpsPreview > 0
                        ? `<div class="exp-levelup-notice" style="display:block;">
                               ⬆️ Level up! → Level ${curLevel + levelUpsPreview}
                           </div>`
                        : ''}
                    <div class="exp-btn-row" style="margin-top:20px;">
                        <button class="exp-btn exp-btn-confirm">Apply</button>
                        <button class="exp-btn exp-btn-deny">Ignore</button>
                    </div>
                </div>
            </div>
        `);

        $('body').append($overlay);

        const _close = (result) => {
            $overlay.fadeOut(150, () => $overlay.remove());
            resolve(result);
        };

        $overlay.find('.exp-btn-confirm').on('click', () => _close(true));
        $overlay.find('.exp-btn-deny').on('click',   () => _close(false));

        // Clicking outside the card also dismisses
        $overlay.on('click', e => {
            if ($(e.target).is('#rpg-exp-popup-overlay')) _close(false);
        });

        // Escape key
        const _onKey = (e) => {
            if (e.key === 'Escape') { $(document).off('keydown', _onKey); _close(false); }
        };
        $(document).on('keydown', _onKey);
    });
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Called by the parser when it detects an exp_gain field in the AI's JSON.
 * Shows the confirmation popup and applies EXP on confirm.
 * Fire-and-forget — do not await from the parser.
 *
 * @param {number} amount
 */
export async function queueExpGain(amount) {
    try {
        const ss = extensionSettings?.statSheet;
        if (!ss?.enabled) return;
        if (!amount || amount <= 0) return;

        const confirmed = await _showPopup(amount);
        if (!confirmed) return;

        applyExpGain(amount);
        console.log(`[RPG Companion] ✅ EXP applied: +${amount}`);
    } catch (err) {
        console.error('[RPG Companion] EXP gain handler error:', err);
    }
}
