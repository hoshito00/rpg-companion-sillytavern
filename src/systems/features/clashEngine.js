/**
 * Clash Engine  (Stars of the City — Beta 0.7 rule set)
 *
 * Pure math module.  Zero DOM, zero imports from the extension.
 * All exported functions are side-effect-free and accept / return plain objects.
 * Safe to unit-test in any JS environment with `Math.random` stubbed.
 *
 * ─── Die spec (input) ────────────────────────────────────────────────────────
 * {
 *   diceType  : string,    // 'Slash' | 'Pierce' | 'Blunt' | 'Block' | 'Evade'
 *   sides     : number,    // d-value  (e.g. 12 for 1d12)
 *   modifier  : number,    // flat bonus, already resolved by caller
 *   _recycled : boolean,   // INTERNAL — Evade recycle flag; callers should omit
 * }
 *
 * ─── CombatantSnap (read-only snapshot passed to the engine each round) ──────
 * {
 *   hp               : number,
 *   maxHp            : number,
 *   staggerResist    : number,
 *   maxStaggerResist : number,
 *   isStaggered      : boolean,
 *   affinities       : { [diceType]: { damage: number, stagger: number } },
 *   savedDice        : SavedDie[],
 * }
 * Affinity values: positive = weakness (extra damage), negative = resistance (reduced damage).
 *
 * ─── SavedDie ────────────────────────────────────────────────────────────────
 * { die: DieSpec, storedRoll: number, roundSaved: number }
 * Stored when an Unopposed defensive die would otherwise be wasted.
 * Expires at round end.  On Deploy: re-rolled fresh (storedRoll discarded).
 *
 * ─── PairRecord ──────────────────────────────────────────────────────────────
 * {
 *   playerDie         : DieSpec | null,
 *   enemyDie          : DieSpec | null,
 *   playerRoll        : number | null,
 *   enemyRoll         : number | null,
 *   outcome           : 'player' | 'enemy' | 'tie' | 'unopposed-player' | 'unopposed-enemy',
 *   hpDelta           : number,      // magnitude of HP damage dealt  (always >= 0)
 *   staggerDelta      : number,      // magnitude of SR damage dealt  (always >= 0)
 *   moraleDeltaPlayer : number,      // player's morale change for this pair
 *   moraleDeltaEnemy  : number,      // enemy's morale change for this pair
 *   note              : string,      // human-readable log fragment
 * }
 * hpDelta / staggerDelta are MAGNITUDES; resolveClash routes them to the correct
 * combatant based on outcome.
 *
 * ─── ClashReport (output of resolveClash) ────────────────────────────────────
 * {
 *   pairs              : PairRecord[],
 *   hpDeltaPlayer      : number,      // negative = damage to player
 *   hpDeltaEnemy       : number,      // negative = damage to enemy
 *   staggerDeltaPlayer : number,      // negative = SR damage to player
 *   staggerDeltaEnemy  : number,      // negative = SR damage to enemy
 *   newSavedDicePlayer : SavedDie[],  // defensive dice saved THIS round (player)
 *   newSavedDiceEnemy  : SavedDie[],  // defensive dice saved THIS round (enemy)
 *   moraleDeltaPlayer  : number,      // net morale change for the player
 *   moraleDeltaEnemy   : number,      // net morale change for this enemy
 *   logLines           : string[],    // ordered human-readable summary
 * }
 */

// ── Morale constants ──────────────────────────────────────────────────────────

const MORALE_CLASH_WIN  =  3;
const MORALE_CLASH_LOSE = -3;

// ── Morale tier lookup ────────────────────────────────────────────────────────

/**
 * Convert a raw morale value to its tier modifier (-3 to +5).
 * Applied as a flat bonus to each individual combat die roll.
 *
 * Tiers:
 *   >= +75 → +5   >= +60 → +4   >= +45 → +3
 *   >= +30 → +2   >= +15 → +1   > -15  →  0
 *   > -30  → -1   > -45  → -2   else   → -3
 *
 * @param {number} morale
 * @returns {number} tier modifier
 */
export function getMoraleTier(morale) {
    if (morale >= 75) return  5;
    if (morale >= 60) return  4;
    if (morale >= 45) return  3;
    if (morale >= 30) return  2;
    if (morale >= 15) return  1;
    if (morale >  -15) return  0;
    if (morale >  -30) return -1;
    if (morale >  -45) return -2;
    return -3;
}

/**
 * Clamp a morale value to its legal range [-45, +75].
 * @param {number} morale
 * @returns {number}
 */
export function clampMorale(morale) {
    return Math.max(-45, Math.min(75, morale));
}

/**
 * Compute the morale gain when the player eliminates an enemy.
 * Scales with the enemy's morale tier: +10 (tier 0) to +15 (tier 5).
 * @param {number} enemyMorale
 * @returns {number}
 */
export function moraleGainOnKill(enemyMorale) {
    return 10 + Math.max(0, getMoraleTier(enemyMorale));
}

/**
 * Compute the morale penalty when an ally is eliminated.
 * Scales with the killing enemy's morale tier: -10 (tier 0) to -25 (tier 5).
 * @param {number} killerMorale
 * @returns {number}
 */
export function moraleLossOnAllyDeath(killerMorale) {
    return -10 - (3 * Math.max(0, getMoraleTier(killerMorale)));
}

// ── Die classification ────────────────────────────────────────────────────────

const OFFENSIVE_TYPES = new Set(['Slash', 'Pierce', 'Blunt']);
const DEFENSIVE_TYPES = new Set(['Block', 'Evade']);
const COUNTER_TYPES   = new Set(['Counter-Slash', 'Counter-Pierce', 'Counter-Blunt', 'Counter-Block', 'Counter-Evade']);

const COUNTER_BASE_TYPE = {
    'Counter-Slash':  'Slash',
    'Counter-Pierce': 'Pierce',
    'Counter-Blunt':  'Blunt',
    'Counter-Block':  'Block',
    'Counter-Evade':  'Evade',
};

/**
 * True when a die type can deal damage on a win.
 * @param {string} diceType
 * @returns {boolean}
 */
export function isOffensive(diceType) {
    return OFFENSIVE_TYPES.has(diceType);
}

/**
 * True when a die type is defensive (Block or Evade).
 * @param {string} diceType
 * @returns {boolean}
 */
export function isDefensive(diceType) {
    return DEFENSIVE_TYPES.has(diceType);
}

/**
 * True when a die type is a Counter variant.
 * Counter dice sit in the queue normally but are skipped if unopposed.
 * When an opposing die clashes into them, they resolve as their base type.
 * @param {string} diceType
 * @returns {boolean}
 */
export function isCounter(diceType) {
    return COUNTER_TYPES.has(diceType);
}

/**
 * Returns the base die type for a Counter die.
 * e.g. 'Counter-Slash' → 'Slash', 'Counter-Evade' → 'Evade'.
 * Returns the input unchanged for non-Counter types.
 * @param {string} diceType
 * @returns {string}
 */
export function counterBaseType(diceType) {
    return COUNTER_BASE_TYPE[diceType] ?? diceType;
}

// ── Rolling ───────────────────────────────────────────────────────────────────

/**
 * Roll a single die (uniform integer in [1, sides]) and apply a flat modifier.
 * Stub Math.random in tests.
 *
 * @param {number} sides
 * @param {number} [modifier=0]
 * @returns {number}
 */
export function rollDie(sides, modifier = 0) {
    return Math.floor(Math.random() * sides) + 1 + modifier;
}

/**
 * Convenience overload — accepts a die spec object.
 * @param {{ sides: number, modifier?: number }} die
 * @returns {number}
 */
export function rollDieSpec(die) {
    return rollDie(die.sides, die.modifier ?? 0);
}

/**
 * Roll a die spec and apply multiplier/roundDown scaling.
 * Used for player dice only — enemy dice have no multiplier field.
 * Falls back to a plain rollDieSpec if no multiplier is set.
 *
 * @param {{ sides: number, modifier?: number, multiplier?: number, roundDown?: boolean }} die
 * @returns {number}
 */
function _rollWithMultiplier(die) {
    const raw = rollDieSpec(die);
    if (!die.multiplier || die.multiplier === 1) return raw;
    const scaled = raw * die.multiplier;
    return die.roundDown ? Math.floor(scaled) : Math.ceil(scaled);
}

// ── Affinity helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the effective affinity modifier for a die type striking a target.
 *
 * Stagger rule:
 *   — Normal state : full affinity applied (positive or negative).
 *   — Staggered    : negative affinities (resistances) are suppressed;
 *                    positive affinities (weaknesses) still apply.
 *
 * @param {string}  diceType
 * @param {'damage'|'stagger'} pool
 * @param {object}  targetSnap
 * @returns {number}
 */
function _effectiveAffinity(diceType, pool, targetSnap) {
    const raw = targetSnap.affinities?.[diceType]?.[pool] ?? 0;
    return (targetSnap.isStaggered && raw < 0) ? 0 : raw;
}

// ── Damage computation ────────────────────────────────────────────────────────

/**
 * Compute HP and Stagger-resist damage from a winning offensive die.
 *
 * Both pools use the same roll value as base and are computed simultaneously
 * (not sequentially), per the spec.
 *
 * Process:
 *   1. Base value = winning roll (modifier already included).
 *   2. Add per-pool affinity to each pool independently.
 *   3. Clamp both to ≥ 0.
 *   4. If target is staggered: double both values.
 *
 * @param {{ diceType: string }}  die        — the winning offensive die spec
 * @param {number}                roll       — the winning roll total
 * @param {object}                targetSnap — CombatantSnap of the target
 * @returns {{ hp: number, stagger: number }}
 */
export function computeDamage(die, roll, targetSnap) {
    const hpAff      = _effectiveAffinity(die.diceType, 'damage',  targetSnap);
    const staggerAff = _effectiveAffinity(die.diceType, 'stagger', targetSnap);

    let hpDmg      = Math.max(0, roll + hpAff);
    let staggerDmg = Math.max(0, roll + staggerAff);

    if (targetSnap.isStaggered) {
        hpDmg      *= 2;
        staggerDmg *= 2;
    }

    // Ceil so fractional affinities round in the attacker's favour.
    return { hp: Math.ceil(hpDmg), stagger: Math.ceil(staggerDmg) };
}

// ── Single-pair resolution ────────────────────────────────────────────────────

/**
 * Resolve one player die vs one enemy die.
 * Does NOT mutate either snap or either die spec.
 *
 * Tie rule: rolls match → both dice cancel, no damage, morale unchanged.
 * When the winner is Defensive and the loser is Offensive: damage is 0
 *   (the defensive win deflects the attack; no counter-damage).
 *
 * @param {object} pDie   — player die spec
 * @param {object} eDie   — enemy die spec
 * @param {object} pSnap  — player CombatantSnap
 * @param {object} eSnap  — enemy CombatantSnap
 * @returns {PairRecord}
 */
function _resolvePair(pDie, eDie, pSnap, eSnap) {
    const pRoll = _rollWithMultiplier(pDie);
    const eRoll = rollDieSpec(eDie);

    if (pRoll === eRoll) {
        // ── TIE: both dice cancel ────────────────────────────────────────────
        return {
            playerDie: pDie, enemyDie: eDie,
            playerRoll: pRoll, enemyRoll: eRoll,
            outcome: 'tie',
            hpDelta: 0, staggerDelta: 0,
            moraleDeltaPlayer: 0, moraleDeltaEnemy: 0,
            note: `${pDie.diceType} ${pRoll} vs ${eDie.diceType} ${eRoll} — TIE (both cancel)`,
        };
    }

    if (pRoll > eRoll) {
        // ── PLAYER wins this die ─────────────────────────────────────────────
        let hpDelta = 0, staggerDelta = 0, note = '';

        if (isOffensive(pDie.diceType)) {
            const dmg = computeDamage(pDie, pRoll, eSnap);
            hpDelta      = dmg.hp;
            staggerDelta = dmg.stagger;
            note = `${pDie.diceType} ${pRoll} beats ${eDie.diceType} ${eRoll}` +
                   ` → ${dmg.hp} HP / ${dmg.stagger} SR to enemy`;
        } else {
            note = `${pDie.diceType} ${pRoll} beats ${eDie.diceType} ${eRoll} → deflected`;
        }

        return {
            playerDie: pDie, enemyDie: eDie,
            playerRoll: pRoll, enemyRoll: eRoll,
            outcome: 'player',
            hpDelta, staggerDelta,
            moraleDeltaPlayer: MORALE_CLASH_WIN,
            moraleDeltaEnemy:  MORALE_CLASH_LOSE,
            note,
        };
    }

    // ── ENEMY wins this die ──────────────────────────────────────────────────
    let hpDelta = 0, staggerDelta = 0, note = '';

    if (isOffensive(eDie.diceType)) {
        const dmg = computeDamage(eDie, eRoll, pSnap);
        hpDelta      = dmg.hp;
        staggerDelta = dmg.stagger;
        note = `${eDie.diceType} ${eRoll} beats ${pDie.diceType} ${pRoll}` +
               ` → ${dmg.hp} HP / ${dmg.stagger} SR to player`;
    } else {
        note = `${eDie.diceType} ${eRoll} beats ${pDie.diceType} ${pRoll} → enemy deflects`;
    }

    return {
        playerDie: pDie, enemyDie: eDie,
        playerRoll: pRoll, enemyRoll: eRoll,
        outcome: 'enemy',
        hpDelta, staggerDelta,
        moraleDeltaPlayer: MORALE_CLASH_LOSE,
        moraleDeltaEnemy:  MORALE_CLASH_WIN,
        note,
    };
}

// ── Unopposed die resolution ──────────────────────────────────────────────────

/**
 * Process a single die with no opposing die to clash against.
 *
 * — Offensive unopposed → deals full damage to the opposing side.
 * — Defensive unopposed → saved for potential deployment (unless already recycled).
 *
 * @param {object}          die         — die spec
 * @param {'player'|'enemy'} side        — who owns this die
 * @param {object}          targetSnap  — the opposing combatant's snap
 * @param {number}          roundNumber
 * @returns {{ pair: PairRecord, savedDie: SavedDie|null }}
 */
function _resolveUnopposed(die, side, targetSnap, roundNumber) {
    const roll    = rollDieSpec(die);
    const outcome = side === 'player' ? 'unopposed-player' : 'unopposed-enemy';
    const target  = side === 'player' ? 'enemy' : 'player';

    let hpDelta = 0, staggerDelta = 0;
    let moraleDeltaPlayer = 0, moraleDeltaEnemy = 0;
    let savedDie = null, note = '';

    if (isOffensive(die.diceType)) {
        const dmg    = computeDamage(die, roll, targetSnap);
        hpDelta      = dmg.hp;
        staggerDelta = dmg.stagger;
        if (side === 'player') {
            moraleDeltaPlayer = MORALE_CLASH_WIN;
            moraleDeltaEnemy  = MORALE_CLASH_LOSE;
        } else {
            moraleDeltaPlayer = MORALE_CLASH_LOSE;
            moraleDeltaEnemy  = MORALE_CLASH_WIN;
        }
        note = `Unopposed ${die.diceType} ${roll} → ${dmg.hp} HP / ${dmg.stagger} SR to ${target}`;

    } else if (isDefensive(die.diceType)) {
        if (!die._recycled) {
            savedDie = {
                die: { diceType: die.diceType, sides: die.sides, modifier: die.modifier ?? 0 },
                storedRoll: roll,
                roundSaved: roundNumber,
            };
            note = `Unopposed ${die.diceType} ${roll} → saved for deployment`;
        } else {
            note = `Unopposed recycled ${die.diceType} ${roll} → discarded`;
        }
    }

    const pair = {
        playerDie:  side === 'player' ? die  : null,
        enemyDie:   side === 'enemy'  ? die  : null,
        playerRoll: side === 'player' ? roll : null,
        enemyRoll:  side === 'enemy'  ? roll : null,
        outcome, hpDelta, staggerDelta,
        moraleDeltaPlayer, moraleDeltaEnemy,
        note,
    };

    return { pair, savedDie };
}

// ── Main resolve function ─────────────────────────────────────────────────────

/**
 * Resolve a full linear clash sequence between a player skill and an enemy action.
 *
 * Algorithm:
 *   1. Paired clash phase — match dice linearly until one side runs out.
 *   2. Unopposed phase — remaining dice act without opposition.
 *   3. Evade recycle — a winning Evade die inserts a copy (marked _recycled)
 *      at the front of its owner's queue to face the next opposing die.
 *      The copy cannot itself recycle.
 *
 * This function never mutates its inputs.
 *
 * @param {object[]} playerDice   — ordered die specs for the player's skill
 * @param {object[]} enemyDice    — ordered die specs for the enemy's action
 * @param {object}   playerSnap   — CombatantSnap (read-only)
 * @param {object}   enemySnap    — CombatantSnap (read-only)
 * @param {number}   [roundNumber=0]
 * @returns {ClashReport}
 */
export function resolveClash(playerDice, enemyDice, playerSnap, enemySnap, roundNumber = 0) {
    const pQueue = playerDice.map(d => ({ ...d }));
    const eQueue = enemyDice.map(d => ({ ...d }));

    const pairs              = [];
    let hpDeltaPlayer        = 0;
    let hpDeltaEnemy         = 0;
    let staggerDeltaPlayer   = 0;
    let staggerDeltaEnemy    = 0;
    const newSavedDicePlayer = [];
    const newSavedDiceEnemy  = [];
    let moraleDeltaPlayer    = 0;
    let moraleDeltaEnemy     = 0;

    // ── Phase 1: Paired clash ─────────────────────────────────────────────────
    while (pQueue.length > 0 && eQueue.length > 0) {
        let pDie = pQueue.shift();
        let eDie = eQueue.shift();

        const pDieResolved = isCounter(pDie.diceType)
            ? { ...pDie, diceType: counterBaseType(pDie.diceType) }
            : pDie;
        const eDieResolved = isCounter(eDie.diceType)
            ? { ...eDie, diceType: counterBaseType(eDie.diceType) }
            : eDie;

        const pair = _resolvePair(pDieResolved, eDieResolved, playerSnap, enemySnap);

        if (isCounter(pDie.diceType)) pair.note = `[Counter] ${pair.note}`;
        if (isCounter(eDie.diceType)) pair.note = `[Counter] ${pair.note}`;
        pairs.push(pair);

        if (pair.outcome === 'player') {
            hpDeltaEnemy      -= pair.hpDelta;
            staggerDeltaEnemy -= pair.staggerDelta;
            moraleDeltaPlayer += pair.moraleDeltaPlayer;
            moraleDeltaEnemy  += pair.moraleDeltaEnemy;

            if (pDieResolved.diceType === 'Evade' && !pDie._recycled) {
                pQueue.unshift({ ...pDieResolved, _recycled: true });
            }

        } else if (pair.outcome === 'enemy') {
            hpDeltaPlayer      -= pair.hpDelta;
            staggerDeltaPlayer -= pair.staggerDelta;
            moraleDeltaPlayer  += pair.moraleDeltaPlayer;
            moraleDeltaEnemy   += pair.moraleDeltaEnemy;

            if (eDieResolved.diceType === 'Evade' && !eDie._recycled) {
                eQueue.unshift({ ...eDieResolved, _recycled: true });
            }
        }
        // TIE: no damage, no recycle, morale unchanged
    }

    // ── Phase 2: Unopposed player dice ────────────────────────────────────────
    while (pQueue.length > 0) {
        const pDie = pQueue.shift();

        if (isCounter(pDie.diceType)) {
            pairs.push({
                playerDie: pDie, enemyDie: null,
                playerRoll: null, enemyRoll: null,
                outcome: 'unopposed-player',
                hpDelta: 0, staggerDelta: 0,
                moraleDeltaPlayer: 0, moraleDeltaEnemy: 0,
                note: `Unopposed ${pDie.diceType} → skipped (Counter requires opposition)`,
            });
            continue;
        }

        const { pair, savedDie } = _resolveUnopposed(pDie, 'player', enemySnap, roundNumber);
        pairs.push(pair);

        hpDeltaEnemy      -= pair.hpDelta;
        staggerDeltaEnemy -= pair.staggerDelta;
        moraleDeltaPlayer += pair.moraleDeltaPlayer;
        moraleDeltaEnemy  += pair.moraleDeltaEnemy;
        if (savedDie) newSavedDicePlayer.push(savedDie);
    }

    // ── Phase 3: Unopposed enemy dice ─────────────────────────────────────────
    while (eQueue.length > 0) {
        const eDie = eQueue.shift();
        const { pair, savedDie } = _resolveUnopposed(eDie, 'enemy', playerSnap, roundNumber);
        pairs.push(pair);

        hpDeltaPlayer      -= pair.hpDelta;
        staggerDeltaPlayer -= pair.staggerDelta;
        moraleDeltaPlayer  += pair.moraleDeltaPlayer;
        moraleDeltaEnemy   += pair.moraleDeltaEnemy;
        if (savedDie) newSavedDiceEnemy.push(savedDie);
    }

    const logLines = pairs.map(p => p.note).filter(Boolean);

    return {
        pairs,
        hpDeltaPlayer,
        hpDeltaEnemy,
        staggerDeltaPlayer,
        staggerDeltaEnemy,
        newSavedDicePlayer,
        newSavedDiceEnemy,
        moraleDeltaPlayer,
        moraleDeltaEnemy,
        logLines,
    };
}

// ── Saved Die deployment ──────────────────────────────────────────────────────

/**
 * Deploy a previously saved defensive die against an incoming offensive die.
 *
 * Per spec: the saved die is re-rolled fresh (storedRoll is discarded).
 * A deployed Evade die CAN recycle if it wins — it is treated as a fresh die.
 *
 * @param {SavedDie} savedDie     — the saved die being deployed
 * @param {object}   incomingDie  — the incoming offensive die spec
 * @param {object}   ownerSnap    — CombatantSnap of the deploying side (player)
 * @param {object}   attackerSnap — CombatantSnap of the attacker (enemy)
 * @returns {{
 *   pair: PairRecord,
 *   recycledEvade: DieSpec | null,
 * }}
 */
export function deploySavedDie(savedDie, incomingDie, ownerSnap, attackerSnap) {
    const freshDie = { ...savedDie.die, _recycled: false };
    const pair     = _resolvePair(freshDie, incomingDie, ownerSnap, attackerSnap);

    const recycledEvade = (pair.outcome === 'player' && freshDie.diceType === 'Evade')
        ? { ...freshDie, _recycled: true }
        : null;

    return { pair, recycledEvade };
}

// ── Speed / Initiative queue ──────────────────────────────────────────────────

/**
 * Roll a speed spec (parsed from enemy_action die_index=1 speed attribute).
 * Returns 0 for null/missing specs (die_index > 1 always have speed=null).
 *
 * @param {{ count: number, sides: number, modifier: number } | null} speedSpec
 * @returns {number}
 */
export function rollSpeedDice(speedSpec) {
    if (!speedSpec || !speedSpec.sides) return 0;
    let total = speedSpec.modifier ?? 0;
    const count = speedSpec.count ?? 1;
    for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * speedSpec.sides) + 1;
    }
    return total;
}

/**
 * Build the initiative queue for a round by rolling speed for each enemy skill group.
 * Returns skill groups sorted by speed roll descending (highest speed acts first).
 * Ties are broken by insertion order (stable sort).
 *
 * @param {{ skillName: string, dice: object[], speedSpec: object|null }[]} skillGroups
 * @returns {{ skillName: string, dice: object[], speedSpec: object|null, speedRoll: number }[]}
 */
export function buildInitiativeQueue(skillGroups) {
    return skillGroups
        .map(group => ({
            ...group,
            speedRoll: rollSpeedDice(group.speedSpec ?? null),
        }))
        .sort((a, b) => b.speedRoll - a.speedRoll);
}

/**
 * True when the combatant's current stagger resist has hit zero.
 * @param {number} currentStaggerResist
 * @returns {boolean}
 */
export function isNowStaggered(currentStaggerResist) {
    return currentStaggerResist <= 0;
}

/**
 * Reset stagger state at the end of a round.
 * Stagger resist fully restores; isStaggered clears.
 * HP is NOT restored here.
 *
 * @param {object} state — mutable CombatantEngineState
 */
export function resetStaggerForNewRound(state) {
    state.staggerResist    = state.maxStaggerResist;
    state.isStaggered      = false;
    state.staggeredAtRound = null;
}

// ── Apply report to live state ────────────────────────────────────────────────

/**
 * Apply a ClashReport's deltas to two mutable combatant state objects.
 *
 * Expected state shape:
 *   { hp, maxHp, staggerResist, maxStaggerResist, isStaggered, staggeredAtRound }
 *
 * Stagger is triggered only on transition (not re-applied if already staggered).
 * Values are clamped to [0, max] where applicable.
 *
 * @param {ClashReport} report
 * @param {object}      playerState   — mutable CombatantEngineState
 * @param {object}      enemyState    — mutable CombatantEngineState
 * @param {number}      [roundNumber=0]
 * @returns {{
 *   playerStaggered : boolean,
 *   enemyStaggered  : boolean,
 *   playerKilled    : boolean,
 *   enemyKilled     : boolean,
 * }}
 */
export function applyClashReport(report, playerState, enemyState, roundNumber = 0) {
    const changes = {
        playerStaggered: false,
        enemyStaggered:  false,
        playerKilled:    false,
        enemyKilled:     false,
    };

    // ── Player ────────────────────────────────────────────────────────────────
    playerState.hp            = Math.max(0, playerState.hp + report.hpDeltaPlayer);
    playerState.staggerResist = Math.max(0, playerState.staggerResist + report.staggerDeltaPlayer);

    if (!playerState.isStaggered && isNowStaggered(playerState.staggerResist)) {
        playerState.isStaggered      = true;
        playerState.staggeredAtRound = roundNumber;
        changes.playerStaggered      = true;
    }
    if (playerState.hp <= 0) changes.playerKilled = true;

    // ── Enemy ─────────────────────────────────────────────────────────────────
    enemyState.hp            = Math.max(0, enemyState.hp + report.hpDeltaEnemy);
    enemyState.staggerResist = Math.max(0, enemyState.staggerResist + report.staggerDeltaEnemy);

    if (!enemyState.isStaggered && isNowStaggered(enemyState.staggerResist)) {
        enemyState.isStaggered      = true;
        enemyState.staggeredAtRound = roundNumber;
        changes.enemyStaggered      = true;
    }
    if (enemyState.hp <= 0) changes.enemyKilled = true;

    return changes;
}

// ── Quick-test helper (development only) ─────────────────────────────────────

/**
 * Run a deterministic clash with fixed rolls for unit testing.
 * Overrides Math.random for the duration of the call.
 *
 * @param {object[]} playerDice
 * @param {object[]} enemyDice
 * @param {object}   playerSnap
 * @param {object}   enemySnap
 * @param {number[]} rollSequence  — values in [0, 1) consumed in order by Math.random
 * @param {number}   [roundNumber=0]
 * @returns {ClashReport}
 */
export function resolveClashFixed(playerDice, enemyDice, playerSnap, enemySnap, rollSequence, roundNumber = 0) {
    const seq = [...rollSequence];
    const orig = Math.random;
    Math.random = () => seq.length > 0 ? seq.shift() : 0.5;
    try {
        return resolveClash(playerDice, enemyDice, playerSnap, enemySnap, roundNumber);
    } finally {
        Math.random = orig;
    }
}
