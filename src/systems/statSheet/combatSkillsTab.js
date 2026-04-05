/**
 * Combat Skills Tab Module  (Session 6 — Full Tag System)
 */

import { extensionSettings } from '../../core/state.js';
import {
    addCombatSkill,
    removeCombatSkill,
    equipCombatSkill,
    unequipCombatSkill,
    duplicateCombatSkill,
    generateUniqueId,
    calculateSavingThrowValue,
} from './statSheetState.js';
import { saveStatSheetData } from '../../core/persistence.js';
import { refreshCurrentTab, showNotification, buildPromptIncludeToggle } from './statSheetUI.js';
import { logDiceRoll } from '../interaction/diceLog.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DICE_TYPES = [
    'Slash', 'Pierce', 'Blunt', 'Block', 'Evade',
    'Counter-Slash', 'Counter-Pierce', 'Counter-Blunt', 'Counter-Block', 'Counter-Evade',
];

const DICE_SIDES = [4, 6, 8, 10, 12];

const EGO_TIERS = [
    { key: 'ZAYIN', sanityCost: 5  },
    { key: 'TETH',  sanityCost: 10 },
    { key: 'HE',    sanityCost: 20 },
    { key: 'WAW',   sanityCost: 25 },
    { key: 'ALEPH', sanityCost: 30 },
];

const EGO_TIER_COLORS = {
    ZAYIN: '#7ec8e3',
    TETH:  '#a8d8a8',
    HE:    '#f6d365',
    WAW:   '#e07b54',
    ALEPH: '#c471ed',
};

// ── Skill Module Library  (Session 10) ───────────────────────────────────────
// Each entry is an installable archetype. `attributeRole` describes what kind
// of stat powers it (shown in the install picker). `diceTemplate` entries each
// get wired to the chosen attribute on install.

export const COMBAT_SKILL_LIBRARY = [

    // ── Physical (Power) ──────────────────────────────────────────────────────
    {
        category: 'Physical', name: 'Iron Fist',      cost: 2,  attributeRole: 'Power',
        description: 'Heavy blunt assault that crushes guard and stalls counter-actions.',
        diceTemplate: [
            { diceType: 'Blunt', sides: 12, multiplier: 1,    roundDown: false },
            { diceType: 'Blunt', sides:  8, multiplier: 0.5,  roundDown: true  },
        ],
    },
    {
        category: 'Physical', name: 'Widowmaker',     cost: 2,  attributeRole: 'Power',
        description: 'A two-hit combination of slash and thrust built for raw damage output.',
        diceTemplate: [
            { diceType: 'Slash',  sides: 10, multiplier: 1,   roundDown: false },
            { diceType: 'Pierce', sides:  8, multiplier: 1,   roundDown: false },
        ],
    },
    {
        category: 'Physical', name: 'Wrecking Blow',  cost: 3,  attributeRole: 'Power',
        description: 'A single devastating strike scaled to the attacker\'s full brute strength.',
        diceTemplate: [
            { diceType: 'Blunt', sides: 10, multiplier: 1.5,  roundDown: true  },
            { diceType: 'Blunt', sides:  6, multiplier: 0.5,  roundDown: true  },
        ],
    },
    {
        category: 'Physical', name: 'Fury Combo',     cost: 1,  attributeRole: 'Power',
        description: 'Three rapid blows — power at the cost of precision.',
        diceTemplate: [
            { diceType: 'Blunt', sides:  8, multiplier: 1,    roundDown: false },
            { diceType: 'Blunt', sides:  8, multiplier: 1,    roundDown: false },
            { diceType: 'Slash', sides:  6, multiplier: 0.5,  roundDown: true  },
        ],
    },

    // ── Speed / Agility ───────────────────────────────────────────────────────
    {
        category: 'Agility', name: 'Fleet Blade',     cost: 1,  attributeRole: 'Speed',
        description: 'A light strike-and-counter cycle driven by quickness over force.',
        diceTemplate: [
            { diceType: 'Slash',         sides:  8, multiplier: 1,   roundDown: false },
            { diceType: 'Counter-Slash', sides:  8, multiplier: 1,   roundDown: false },
        ],
    },
    {
        category: 'Agility', name: 'Evasive Strike',  cost: 1,  attributeRole: 'Speed',
        description: 'A piercing thrust with a built-in sidestep. Defense and offence in one motion.',
        diceTemplate: [
            { diceType: 'Pierce', sides:  8, multiplier: 1,    roundDown: false },
            { diceType: 'Evade',  sides:  6, multiplier: 0.5,  roundDown: true  },
        ],
    },
    {
        category: 'Agility', name: 'Shadowstep',      cost: 2,  attributeRole: 'Speed',
        description: 'Closes the distance and counters in one fluid motion. Punishes overextension.',
        diceTemplate: [
            { diceType: 'Counter-Pierce', sides: 10, multiplier: 1,  roundDown: false },
            { diceType: 'Pierce',         sides:  6, multiplier: 1,  roundDown: false },
        ],
    },
    {
        category: 'Agility', name: 'Duelist Stance',  cost: 2,  attributeRole: 'Speed',
        description: 'Three-step sequence: strike, counter, evade. Difficult to interrupt.',
        diceTemplate: [
            { diceType: 'Slash',  sides:  8, multiplier: 1,    roundDown: false },
            { diceType: 'Counter-Slash', sides: 8, multiplier: 1, roundDown: false },
            { diceType: 'Evade',  sides:  6, multiplier: 0.5,  roundDown: true  },
        ],
    },

    // ── Focus / Intelligence ──────────────────────────────────────────────────
    {
        category: 'Focus',   name: 'Pale Conduit',    cost: 2,  attributeRole: 'Focus',
        description: 'Channels raw cognitive bandwidth into directed physical force. Scales with mental acuity.',
        diceTemplate: [
            { diceType: 'Slash',  sides:  8, multiplier: 1,   roundDown: false },
            { diceType: 'Pierce', sides:  8, multiplier: 1,   roundDown: false },
        ],
    },
    {
        category: 'Focus',   name: 'Arcane Lash',     cost: 2,  attributeRole: 'Focus',
        description: 'An overloaded strike that converts concentrated thought into kinetic burst.',
        diceTemplate: [
            { diceType: 'Slash', sides: 10, multiplier: 1.5,  roundDown: true  },
            { diceType: 'Blunt', sides:  6, multiplier: 1,    roundDown: false },
        ],
    },
    {
        category: 'Focus',   name: 'Mind Fracture',   cost: 3,  attributeRole: 'Focus',
        description: 'A precise, targeted strike designed to disrupt internal composure as much as cause harm.',
        diceTemplate: [
            { diceType: 'Pierce', sides: 12, multiplier: 1,   roundDown: false },
            { diceType: 'Pierce', sides:  6, multiplier: 0.5, roundDown: true  },
        ],
    },

    // ── Defense / Endurance ───────────────────────────────────────────────────
    {
        category: 'Defense', name: 'Ironwall Guard',  cost: 1,  attributeRole: 'Defense',
        description: 'A high-stance defensive skill that absorbs pressure and punishes follow-through.',
        diceTemplate: [
            { diceType: 'Block',         sides: 12, multiplier: 1,   roundDown: false },
            { diceType: 'Counter-Blunt', sides:  8, multiplier: 0.5, roundDown: true  },
        ],
    },
    {
        category: 'Defense', name: 'Parry & Riposte',  cost: 2,  attributeRole: 'Defense',
        description: 'Meets an incoming attack and redirects its force back in a single counter-stroke.',
        diceTemplate: [
            { diceType: 'Block',         sides: 10, multiplier: 1,   roundDown: false },
            { diceType: 'Counter-Slash', sides: 10, multiplier: 1,   roundDown: false },
        ],
    },
    {
        category: 'Defense', name: 'Counter Press',   cost: 2,  attributeRole: 'Defense',
        description: 'Takes the hit first, then drives back with accumulated force.',
        diceTemplate: [
            { diceType: 'Counter-Blunt', sides: 12, multiplier: 1,   roundDown: false },
            { diceType: 'Block',         sides:  8, multiplier: 1,   roundDown: false },
        ],
    },
    {
        category: 'Defense', name: 'Endure & Strike', cost: 1,  attributeRole: 'Defense',
        description: 'Weathers the blow and delivers a measured response. Economical and reliable.',
        diceTemplate: [
            { diceType: 'Block',         sides:  8, multiplier: 1,   roundDown: false },
            { diceType: 'Counter-Blunt', sides:  8, multiplier: 1,   roundDown: false },
            { diceType: 'Blunt',         sides:  6, multiplier: 0.5, roundDown: true  },
        ],
    },
];

const MAX_REGULAR_DECK = 9;

// ── Die-level effect definitions ─────────────────────────────────────────────
// `filter(die)` — null = show for all dice; function = show only when true

const DIE_EFFECT_DEFS = [
    { key: 'onHit',       label: 'On Hit',        cls: 'cs-effect-hit',    filter: d => _isOffensiveDie(d) },
    { key: 'onClashWin',  label: 'On Clash Win',  cls: 'cs-effect-win',    filter: null },
    { key: 'onClashLose', label: 'On Clash Lose', cls: 'cs-effect-lose',   filter: null },
    { key: 'onCrit',      label: 'Crit',          cls: 'cs-effect-crit',   filter: d => _isOffensiveDie(d) },
    { key: 'onCheck',     label: 'Check',         cls: 'cs-effect-check',  filter: null },
    { key: 'onEvade',     label: 'On Evade',      cls: 'cs-effect-evade',  filter: d => _isEvadeDie(d) },
];

// ── Skill-level tag definitions ───────────────────────────────────────────────
// `inputType` — 'text' or 'number' (for Limit)
// `hint`      — placeholder text shown in the input

const SKILL_TAG_DEFS = [
    { key: 'onUse',     label: 'On Use',     cls: 'cs-stag-onuse',     inputType: 'text',   hint: 'Effect when skill is declared…' },
    { key: 'afterUse',  label: 'After Use',  cls: 'cs-stag-afteruse',  inputType: 'text',   hint: 'Effect after all dice resolve…' },
    { key: 'onKill',    label: 'On Kill',    cls: 'cs-stag-onkill',    inputType: 'text',   hint: 'Effect when this skill kills…' },
    { key: 'onStagger', label: 'On Stagger', cls: 'cs-stag-onstagger', inputType: 'text',   hint: 'Effect when this skill staggers…' },
    { key: 'eminence',  label: 'Eminence',   cls: 'cs-stag-eminence',  inputType: 'text',   hint: 'Ongoing passive while skill is active…' },
    { key: 'limitUses', label: 'Limit',      cls: 'cs-stag-limit',     inputType: 'number', hint: 'Uses' },
    { key: 'exhaust',   label: 'Exhaust',    cls: 'cs-stag-exhaust',   inputType: 'text',   hint: 'Effect when last Limit use is spent…' },
    { key: 'proactive', label: 'Proactive',  cls: 'cs-stag-proactive', inputType: 'text',   hint: 'Effect when declared first…' },
    { key: 'reactive',  label: 'Reactive',   cls: 'cs-stag-reactive',  inputType: 'text',   hint: 'Effect when responding to enemy…' },
];

// ============================================================================
// MODULE CATALOG  (Session 11)
// Full list of tag-producing modules from the rulebook, keyed by which tag
// slot each option fills. Used by the module picker UI.
// ============================================================================

const MODULE_CATALOG = [
  // ── RANK 1 ─────────────────────────────────────────────────────────────
  { name: 'Counterplay', rank: 1, repeating: true, options: [
    { tag: 'onClashLose', text: 'Boost power of final Die by 2', label: '[Clash Lose] Boost final Die power by 2 (one die)' },
    { tag: 'onClashLose', text: 'Boost power of final Die by 1', label: '[Clash Lose] Boost final Die power by 1 (all dice)' },
  ]},
  { name: 'Comeback', rank: 1, options: [
    { tag: 'onCheck', text: 'When clashing vs {chosen type} Die, gain {Cost+1} power', label: '[Check] +{Cost+1} power vs chosen damage type' },
  ]},
  { name: 'Forceful', rank: 1, options: [
    { tag: 'onClashWin', text: 'Target loses 2 Stagger Resist', label: '[Clash Win] Target loses 2 Stagger Resist' },
  ]},
  { name: 'Heroic', rank: 1, options: [
    { tag: 'onCheck', text: 'Power +2 if this skill intercepted the opposing attack (Block Die)', label: '[Check] +2 Power if intercepted (Block die)' },
  ]},
  { name: 'Cut Through', rank: 1, repeating: true, options: [
    { tag: 'onHit', text: 'Remove 1 Protection, 1 Thorns, and 1 Aggro from target', label: '[Hit] Remove 1 Protection, 1 Thorns, 1 Aggro from target' },
  ]},
  { name: 'Bonus Doubler', rank: 1, options: [
    { tag: 'eminence', text: 'Double the bonus from Strength (single-die skill only)', label: '[Eminence] Double Strength bonus (single offensive die only)' },
  ]},
  { name: 'Double Defender', rank: 1, options: [
    { tag: 'onCheck', text: 'Double the bonus from Endurance (Block Die)', label: '[Check] Double Endurance bonus (Block die)' },
  ]},
  { name: 'Critical Bind', rank: 1, repeating: true, options: [
    { tag: 'onCrit', text: 'Inflict 1 Bind (2 if die is d10 or higher)', label: '[Crit] Inflict 1 Bind (2 if d10+)' },
  ]},
  { name: 'Critical Fragility', rank: 1, repeating: true, options: [
    { tag: 'onCrit', text: 'Inflict 1 Fragile (2 if die is d10 or higher)', label: '[Crit] Inflict 1 Fragile (2 if d10+)' },
  ]},
  { name: 'Recursive Crit', rank: 1, repeating: true, options: [
    { tag: 'onCrit', text: 'Gain 1 Poise', label: '[Crit] Gain 1 Poise' },
  ]},
  { name: 'Siphon Energy', rank: 1, options: [
    { tag: 'onCrit', text: 'Deal {X} additional damage and gain {X} Charge (X=1 for d6\u2212, 2 for d8/d10, 3 for d12)', label: '[Crit] Deal {X} damage + gain {X} Charge' },
  ]},
  { name: 'Quick Step', rank: 1, options: [
    { tag: 'onEvade', text: 'Gain 1 Haste (max 2 per scene)', label: '[On Evade] Gain 1 Haste \u2014 max 2/scene (Evade die)' },
  ]},
  { name: 'Flame Step', rank: 1, options: [
    { tag: 'onEvade', text: 'Inflict 1 Burn on the attacker', label: '[On Evade] Inflict 1 Burn on attacker (Evade die)' },
  ]},
  { name: 'Futility', rank: 1, options: [
    { tag: 'onEvade', text: 'Inflict 1 Sinking on the attacker', label: '[On Evade] Inflict 1 Sinking on attacker (Evade die)' },
  ]},
  { name: 'Burning', rank: 1, repeating: true, options: [
    { tag: 'onHit',      text: 'Inflict {Cost+1} Burn', label: '[Hit] Inflict {Cost+1} Burn (one die)' },
    { tag: 'onHit',      text: 'Inflict 1 Burn',        label: '[Hit] Inflict 1 Burn (all dice)' },
    { tag: 'onClashWin', text: 'Inflict {Cost+1} Burn', label: '[Clash Win] Inflict {Cost+1} Burn' },
    { tag: 'onClashWin', text: 'Inflict 1 Burn',        label: '[Clash Win] Inflict 1 Burn (all dice)' },
  ]},
  { name: 'Blazing', rank: 1, repeating: true, options: [
    { tag: 'onHit',      text: 'Trigger Blaze on target', label: '[Hit] Trigger Blaze on target' },
    { tag: 'onClashWin', text: 'Trigger Blaze on target', label: '[Clash Win] Trigger Blaze on target' },
  ]},
  { name: 'Sinking', rank: 1, repeating: true, options: [
    { tag: 'onHit',      text: 'Inflict {Cost+1} Sinking', label: '[Hit] Inflict {Cost+1} Sinking (one die)' },
    { tag: 'onHit',      text: 'Inflict 1 Sinking',        label: '[Hit] Inflict 1 Sinking (all dice)' },
    { tag: 'onClashWin', text: 'Inflict {Cost+1} Sinking', label: '[Clash Win] Inflict {Cost+1} Sinking' },
    { tag: 'onClashWin', text: 'Inflict 1 Sinking',        label: '[Clash Win] Inflict 1 Sinking (all dice)' },
  ]},
  { name: 'Bleeding', rank: 1, repeating: true, options: [
    { tag: 'onHit', text: 'Inflict {Cost} Bleed', label: '[Hit] Inflict {Cost} Bleed (one die)' },
    { tag: 'onHit', text: 'Inflict 1 Bleed',      label: '[Hit] Inflict 1 Bleed (all dice)' },
  ]},
  { name: 'Open Wounds', rank: 1, options: [
    { tag: 'onHit', text: "Deal additional damage = target's Bleed", label: "[Hit] Deal damage = target's Bleed" },
  ]},
  { name: 'Tremoring', rank: 1, repeating: true, options: [
    { tag: 'onHit',      text: 'Inflict {Cost} Tremor', label: '[Hit] Inflict {Cost} Tremor (one die)' },
    { tag: 'onHit',      text: 'Inflict 1 Tremor',      label: '[Hit] Inflict 1 Tremor (all dice)' },
    { tag: 'onClashWin', text: 'Inflict {Cost} Tremor', label: '[Clash Win] Inflict {Cost} Tremor' },
    { tag: 'onClashWin', text: 'Inflict 1 Tremor',      label: '[Clash Win] Inflict 1 Tremor (all dice)' },
  ]},
  { name: 'Unstable Burst', rank: 1, repeating: true, options: [
    { tag: 'onHit',      text: "Trigger Tremor Burst, then reduce target's Tremor by 4", label: '[Hit] Tremor Burst, \u22124 Tremor' },
    { tag: 'onClashWin', text: "Trigger Tremor Burst, then reduce target's Tremor by 4", label: '[Clash Win] Tremor Burst, \u22124 Tremor (non-Evade)' },
  ]},
  { name: 'Thorny', rank: 1, options: [
    { tag: 'onClashLose', text: 'Gain 1 Thorns', label: '[Clash Lose] Gain 1 Thorns ({Cost} dice)' },
  ]},
  { name: 'Seed', rank: 1, options: [
    { tag: 'onCheck', text: 'If this Defensive Die is saved and unused at end of scene, gain {Cost} Thorns at start of next scene', label: '[Check] Saved unused \u2192 gain {Cost} Thorns next scene (Defensive die)' },
  ]},
  { name: 'Kinetic Absorption', rank: 1, options: [
    { tag: 'onClashWin', text: 'Gain 1 Charge (2 if Block Die, Cost 2+)', label: '[Clash Win] Gain 1 Charge (2 if Block die, Cost 2+)' },
  ]},
  { name: 'Static Charge', rank: 1, options: [
    { tag: 'onClashLose', text: 'Consume 2 HP to gain 1 Charge (up to {Cost} dice)', label: '[Clash Lose] Consume 2 HP \u2192 gain 1 Charge ({Cost} dice)' },
  ]},
  { name: 'Emotional Consequence', rank: 1, options: [
    { tag: 'onKill', text: 'Gain 4 Emotion Points', label: '[On Kill] Gain 4 Emotion Points' },
  ]},
  { name: 'Inspirational', rank: 1, options: [
    { tag: 'eminence', text: 'Whenever you gain Emotion Points from clashing, an ally of your choice gains them instead', label: '[Eminence] Ally gains your clash EP' },
  ]},
  { name: 'Frightening', rank: 1, options: [
    { tag: 'eminence', text: 'If opposing skill user has 6+ Sinking, reduce power of all their dice by 1 (Cost 2+)', label: '[Eminence] Opponent 6+ Sinking \u2192 \u22121 power all their dice (Cost 2+)' },
  ]},
  { name: 'Endless Battle', rank: 1, options: [
    { tag: 'onCheck', text: 'If any dice on this skill clash, give all Defensive non-counter dice +1 Power, but lose 5 HP', label: '[Check] Clashing \u2192 Defensive dice +1 Power, lose 5 HP' },
  ]},
  { name: 'Bypass', rank: 1, options: [
    { tag: 'proactive', text: 'This attack cannot have its target changed, such as through interception', label: '[Proactive] Attack target cannot be changed' },
  ]},
  { name: 'Shield', rank: 1, options: [
    { tag: 'afterUse', text: 'Give all of your saved Defensive Dice to another ally', label: '[After Use] Give all saved Defensive Dice to an ally' },
  ]},
  { name: 'Fast', rank: 1, options: [
    { tag: 'onUse',    text: 'Gain 1 Haste (2 if Cost 3 or higher)', label: '[On Use] Gain 1 Haste (2 if Cost 3+)' },
    { tag: 'afterUse', text: 'Gain 1 Haste (2 if Cost 3 or higher)', label: '[After Use] Gain 1 Haste (2 if Cost 3+)' },
  ]},
  { name: 'Speed Order', rank: 1, options: [
    { tag: 'onUse', text: 'Give an ally 1 Haste (2 if Cost 3 or higher)', label: '[On Use] Give ally 1 Haste (2 if Cost 3+)' },
  ]},
  { name: 'Shields Up', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost} Protection (1 if Cost 0)', label: '[On Use] Gain {Cost} Protection' },
  ]},
  { name: 'Protective', rank: 1, options: [
    { tag: 'onUse', text: 'Grant 1 Protection to {Cost} allies (1 ally if Cost 0)', label: '[On Use] Grant 1 Protection to {Cost} allies' },
  ]},
  { name: 'Aggravate', rank: 1, options: [
    { tag: 'afterUse', text: 'Gain {Cost+1} Aggro', label: '[After Use] Gain {Cost+1} Aggro' },
  ]},
  { name: 'Cover Me', rank: 1, options: [
    { tag: 'onUse', text: 'Give an ally {Cost} Aggro (1 if Cost 0)', label: '[On Use] Give ally {Cost} Aggro' },
  ]},
  { name: 'Preventative Measures', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost} Safeguard (1 if Cost 0)', label: '[On Use] Gain {Cost} Safeguard' },
  ]},
  { name: 'Charging', rank: 1, options: [
    { tag: 'onUse',    text: 'Gain {Cost} Charge (1 if Cost 0)', label: '[On Use] Gain {Cost} Charge' },
    { tag: 'afterUse', text: 'Gain {Cost} Charge (1 if Cost 0)', label: '[After Use] Gain {Cost} Charge' },
  ]},
  { name: 'Biofuel', rank: 1, options: [
    { tag: 'onKill', text: 'Gain 5 Charge', label: '[On Kill] Gain 5 Charge' },
  ]},
  { name: 'Backup Power', rank: 1, options: [
    { tag: 'exhaust', text: 'Trigger all "Spend Charge" effects on this skill without actually spending Charge', label: '[Exhaust] Trigger Spend Charge effects for free' },
  ]},
  { name: 'Poised', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost} Poise (1 if Cost 0)', label: '[On Use] Gain {Cost} Poise' },
  ]},
  { name: 'Lethal Precision', rank: 1, options: [
    { tag: 'onKill', text: 'Gain 6 Poise', label: '[On Kill] Gain 6 Poise' },
  ]},
  { name: 'Sudden Growth', rank: 1, options: [
    { tag: 'exhaust', text: 'Gain 3 Thorns and 1 Protection', label: '[Exhaust] Gain 3 Thorns and 1 Protection' },
  ]},
  { name: 'Spontaneous Combustion', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost+1} Burn, then trigger Blaze on self spreading Burn to enemies instead of allies (Cost 1+)', label: '[On Use] Gain {Cost+1} Burn + Blaze on self (Cost 1+)' },
  ]},
  { name: 'Grim Resolution', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost+1} Sinking and 1 Resolve (2 Resolve if Cost 3)', label: '[On Use] Gain {Cost+1} Sinking + 1 Resolve (Cost 1+)' },
  ]},
  { name: 'Blood Burst', rank: 1, options: [
    { tag: 'onStagger', text: "Target takes damage = 3\xd7 their Bleed", label: '[On Stagger] Target takes 3\xd7 Bleed damage' },
  ]},
  { name: 'Quaking Fear', rank: 1, options: [
    { tag: 'onKill', text: 'Inflict 5 Tremor on all remaining enemies', label: '[On Kill] Inflict 5 Tremor on all remaining enemies' },
  ]},
  { name: 'Inertia', rank: 1, options: [
    { tag: 'onUse', text: 'Gain {Cost+1} Tremor (Cost 1+)', label: '[On Use] Gain {Cost+1} Tremor (Cost 1+)' },
  ]},

  // ── RANK 2 ─────────────────────────────────────────────────────────────
  { name: 'Reliable', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'If this die rolled minimum value, may re-roll it once (die size \u22121 stage, +2 Base Power)', label: '[Check] Re-roll on minimum (die \u22121 size, +2 Power)' },
  ]},
  { name: 'Health Hauler', rank: 2, repeating: true, options: [
    { tag: 'onClashWin', text: 'Regain {Cost+2} HP', label: '[Clash Win] Regain {Cost+2} HP' },
  ]},
  { name: 'Stamina Hauler', rank: 2, repeating: true, options: [
    { tag: 'onClashWin', text: 'Regain {Cost+2} Stagger Resist', label: '[Clash Win] Regain {Cost+2} Stagger Resist' },
  ]},
  { name: 'Deep Cuts', rank: 2, options: [
    { tag: 'onHit', text: 'Deal 1 additional damage, plus 1 more for every 10 HP you are missing', label: '[Hit] Deal 1+ damage scaled to missing HP' },
  ]},
  { name: 'Transferral Edge', rank: 2, options: [
    { tag: 'onHit', text: 'Transfer up to {Cost+1} of an Ailment from self to target', label: '[Hit] Transfer up to {Cost+1} of an Ailment to target' },
  ]},
  { name: 'Resonant', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Gain Power = highest total number of E.G.O passives active on one combatant (non-counter)', label: '[Check] Power = highest E.G.O passives count' },
  ]},
  { name: 'Struggle', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} if at or below half HP (non-counter)', label: '[Check] +{Cost+1} at \u2264 half HP (non-counter)' },
    { tag: 'onCheck', text: 'Power +{Cost} if at or below half HP (counter)',     label: '[Check] +{Cost} at \u2264 half HP (counter)' },
  ]},
  { name: 'Velocity', rank: 2, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} when used at 8+ Speed', label: '[Check] +{Cost+1} at 8+ Speed' },
  ]},
  { name: 'Ongoing Struggle', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: '+1 Power for every scene concluded this combat (max {Cost+2}, non-counter)', label: '[Check] +1/concluded scene (max {Cost+2}, non-counter)' },
    { tag: 'onCheck', text: '+1 Power for every scene concluded this combat (max {Cost}, counter)', label: '[Check] +1/concluded scene (max {Cost}, counter)' },
  ]},
  { name: 'Desperation', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'If you have any exhausted skills: Power = 1 + exhausted skill count (max {Cost+2}, non-counter)', label: '[Check] +Power per exhausted skill (max {Cost+2}, non-counter)' },
    { tag: 'onCheck', text: 'If you have any exhausted skills: Power = exhausted skill count (max {Cost}, counter)', label: '[Check] +Power per exhausted skill (max {Cost}, counter)' },
  ]},
  { name: 'Binding', rank: 2, repeating: true, options: [
    { tag: 'onHit',      text: 'Inflict 1 Bind (2 if skill Cost 3+)', label: '[Hit] Inflict 1 Bind (2 if Cost 3+)' },
    { tag: 'onClashWin', text: 'Inflict 1 Bind (2 if skill Cost 3+)', label: '[Clash Win] Inflict 1 Bind (2 if Cost 3+)' },
  ]},
  { name: 'Shattering', rank: 2, repeating: true, options: [
    { tag: 'onHit', text: 'Inflict 1 Fragile (2 if Cost 3+ or single offensive die)', label: '[Hit] Inflict 1 Fragile (2 if Cost 3+ or single die)' },
  ]},
  { name: 'Combat Chains', rank: 2, options: [
    { tag: 'onClashWin', text: "May spend 3 Bind on foe to destroy the target's next Die", label: "[Clash Win] Spend 3 Bind \u2192 destroy target's next Die" },
  ]},
  { name: 'Unbreakable Blockade', rank: 2, options: [
    { tag: 'onClashLose', text: 'May spend {Cost+2} Poise to recycle this Die', label: '[Clash Lose] Spend {Cost+2} Poise to recycle this Die (non-counter Block)' },
  ]},
  { name: 'Refined Technique', rank: 2, repeating: true, options: [
    { tag: 'onClashWin', text: 'Gain 2 Poise', label: '[Clash Win] Gain 2 Poise' },
  ]},
  { name: 'Controlled Breathing', rank: 2, options: [
    { tag: 'onEvade', text: 'Gain 1 Poise', label: '[On Evade] Gain 1 Poise (Evade die)' },
  ]},
  { name: 'Burn Exploit', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} if target has 6+ Burn (non-counter)', label: '[Check] +{Cost+1} if target has 6+ Burn (non-counter)' },
    { tag: 'onCheck', text: 'Power +{Cost} if target has 6+ Burn (counter)',       label: '[Check] +{Cost} if target has 6+ Burn (counter)' },
  ]},
  { name: 'Inferno', rank: 2, repeating: true, options: [
    { tag: 'onHit',      text: 'Trigger Blaze on target, then inflict 2 Burn', label: '[Hit] Trigger Blaze + inflict 2 Burn' },
    { tag: 'onClashWin', text: "If Speed Die is higher value, inflict Burn = the difference (max 10, deployed dice = 0 Speed)", label: '[Clash Win] Inflict Burn = Speed Die difference (max 10)' },
  ]},
  { name: 'Kinetic Burn', rank: 2, options: [
    { tag: 'onClashWin', text: "If Speed Die is higher value than opposing, inflict Burn = difference (max 10) \u2014 not for 0-Cost skills", label: '[Clash Win] Inflict Burn = Speed Die difference (not 0-Cost)' },
  ]},
  { name: 'Incinerate', rank: 2, options: [
    { tag: 'onHit', text: 'May spend 4 Burn on target to inflict 2 Fragile', label: '[Hit] Spend 4 Burn on target \u2192 inflict 2 Fragile' },
  ]},
  { name: 'Paralyzer', rank: 2, options: [
    { tag: 'onCrit', text: 'Inflict 1 Paralyze', label: '[Crit] Inflict 1 Paralyze' },
  ]},
  { name: 'Sinking Exploit', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} if target has 6+ Sinking (non-counter)', label: '[Check] +{Cost+1} if target has 6+ Sinking (non-counter)' },
    { tag: 'onCheck', text: 'Power +{Cost} if target has 6+ Sinking (counter)',       label: '[Check] +{Cost} if target has 6+ Sinking (counter)' },
  ]},
  { name: 'Sinking Deluge', rank: 2, options: [
    { tag: 'onHit', text: 'May spend 3 Emotion Points to Trigger Sinking Deluge', label: '[Hit] Spend 3 EP \u2192 Trigger Sinking Deluge' },
  ]},
  { name: 'Nightmare Hunt', rank: 2, options: [
    { tag: 'onHit', text: 'Absorb up to 3 Sinking from target. If 3 Sinking absorbed, gain 1 Strength next scene', label: '[Hit] Absorb up to 3 Sinking from target' },
  ]},
  { name: 'Tremor Exploit', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} if target has 8+ Tremor (non-counter)', label: '[Check] +{Cost+1} if target has 8+ Tremor (non-counter)' },
    { tag: 'onCheck', text: 'Power +{Cost} if target has 8+ Tremor (counter)',       label: '[Check] +{Cost} if target has 8+ Tremor (counter)' },
  ]},
  { name: 'Burst', rank: 2, repeating: true, options: [
    { tag: 'onHit',      text: "Trigger Tremor Burst, then reduce target's Tremor by 2", label: '[Hit] Tremor Burst, \u22122 Tremor' },
    { tag: 'onClashWin', text: "Trigger Tremor Burst, then reduce target's Tremor by 2", label: '[Clash Win] Tremor Burst, \u22122 Tremor (non-Evade)' },
  ]},
  { name: 'Bleed Exploit', rank: 2, repeating: true, options: [
    { tag: 'onCheck', text: 'Power +{Cost+1} if target has 3+ Bleed (non-counter)', label: '[Check] +{Cost+1} if target has 3+ Bleed (non-counter)' },
    { tag: 'onCheck', text: 'Power +{Cost} if target has 3+ Bleed (counter)',       label: '[Check] +{Cost} if target has 3+ Bleed (counter)' },
  ]},
  { name: 'Tremor: Chain', rank: 2, options: [
    { tag: 'onHit', text: 'If target has 10+ Tremor, inflict 1 Feeble (2 if 25+), reduce Tremor by 3 per Feeble inflicted', label: '[Hit] Tremor 10+: inflict Feeble, drain Tremor' },
  ]},
  { name: 'Tremor: Fracture', rank: 2, options: [
    { tag: 'onHit', text: 'If target has 10+ Tremor, inflict 1 Disarm (2 if 25+), reduce Tremor by 3 per Disarm inflicted', label: '[Hit] Tremor 10+: inflict Disarm, drain Tremor' },
  ]},
  { name: 'Hemorrhage', rank: 2, options: [
    { tag: 'onCrit', text: "Inflict Bleed equal to target's Bleed cap (die size d8+, Cost 2+)", label: "[Crit] Inflict max-cap Bleed (d8+ die, Cost 2+)" },
  ]},
  { name: 'Revitalizer', rank: 2, options: [
    { tag: 'afterUse', text: 'Regain 1 Light (also adds [Limit: 5 Uses] to this skill)', label: '[After Use] Regain 1 Light \u2014 also adds Limit: 5 Uses' },
  ]},
  { name: 'HP Ampule', rank: 2, options: [
    { tag: 'afterUse', text: 'Regain 10 HP (15 at Lv6, 20 at Lv13) (also adds [Limit: 5 Uses] to this skill)', label: '[After Use] Regain 10 HP \u2014 also adds Limit: 5 Uses' },
  ]},
  { name: 'Keep Trucking', rank: 2, options: [
    { tag: 'onUse', text: 'Regain 1 Stagger Resist, plus 1 more for every 10 HP you are missing', label: '[On Use] Regain 1+ Stagger Resist scaled to missing HP' },
  ]},
  { name: 'Emotionally Charged', rank: 2, options: [
    { tag: 'onUse', text: 'Gain {Cost} Emotion Points (1 if Cost 0)', label: '[On Use] Gain {Cost} Emotion Points' },
  ]},
  { name: 'Curative', rank: 2, options: [
    { tag: 'onUse',    text: 'Reduce 1 Ailment on self by {Cost+2}', label: '[On Use] Reduce 1 Ailment by {Cost+2}' },
    { tag: 'afterUse', text: 'Reduce 1 Ailment on self by {Cost+2}', label: '[After Use] Reduce 1 Ailment by {Cost+2}' },
  ]},
  { name: 'Nullify', rank: 2, options: [
    { tag: 'eminence', text: 'This skill and the opposing skill both ignore any changes in Power (except Base Power) and ignore effects of [Check] tags', label: '[Eminence] Both skills ignore Power changes and [Check] effects' },
  ]},
  { name: 'Berserker', rank: 2, options: [
    { tag: 'onUse', text: 'Gain 1 Strength and 2 Fragile (Cost 2+)', label: '[On Use] Gain 1 Strength and 2 Fragile (Cost 2+)' },
  ]},
  { name: 'Bunker', rank: 2, options: [
    { tag: 'onUse', text: 'Gain 1 Endurance and 2 Bind (Cost 2+)', label: '[On Use] Gain 1 Endurance and 2 Bind (Cost 2+)' },
  ]},
  { name: 'Last Push', rank: 2, options: [
    { tag: 'exhaust', text: 'Roll an additional Speed Die and add it to the scene. If unnatural, gain 2 Haste instead', label: '[Exhaust] Extra Speed Die (unnatural \u2192 2 Haste)' },
  ]},
  { name: 'Toughened', rank: 2, options: [
    { tag: 'onUse', text: 'Gain {Cost} Aggro and {X} Protection (X=1 if Cost \u22641, X=2 if Cost \u22652)', label: '[On Use] Gain {Cost} Aggro and Protection' },
  ]},
  { name: 'Steel Yourself', rank: 2, options: [
    { tag: 'onUse', text: 'Grant 1 Resolve to {Cost} allies (1 ally if Cost 0)', label: '[On Use] Grant 1 Resolve to {Cost} allies' },
  ]},
  { name: 'Sanctuary', rank: 2, options: [
    { tag: 'onUse',    text: 'Give another ally {Cost} Safeguard (1 if Cost 0)', label: '[On Use] Give ally {Cost} Safeguard' },
    { tag: 'afterUse', text: 'Give another ally {Cost} Safeguard (1 if Cost 0)', label: '[After Use] Give ally {Cost} Safeguard' },
  ]},
  { name: 'Charge Support', rank: 2, options: [
    { tag: 'onUse', text: 'Give an ally {Cost} Charge (1 if Cost 0)', label: '[On Use] Give ally {Cost} Charge' },
  ]},
  { name: 'Boost Infliction', rank: 2, options: [
    { tag: 'onUse', text: 'Spend 5 Charge to increase Ailments, Bind, and Fragile inflicted by this skill by 1', label: '[On Use] Spend 5 Charge \u2192 +1 to all inflictions' },
  ]},
  { name: 'Charge Ripper', rank: 2, options: [
    { tag: 'onUse', text: 'Spend 5 Charge to give all Dice on this skill +2 Power (single die: +4 instead)', label: '[On Use] Spend 5 Charge \u2192 all dice +2 Power' },
  ]},
  { name: 'Recharge', rank: 2, options: [
    { tag: 'afterUse', text: 'May spend 4 Charge to regain 1 Light', label: '[After Use] Spend 4 Charge \u2192 regain 1 Light' },
  ]},
  { name: 'Explosive Canister', rank: 2, options: [
    { tag: 'exhaust', text: 'Inflict 4 Burn on self and all enemies. Until end of skill, Blaze triggers on each hit', label: '[Exhaust] 4 Burn to all + Blaze on each hit until end' },
  ]},
  { name: 'Cheating', rank: 2, options: [
    { tag: 'onUse', text: 'May spend 2 uses of a [Limit] skill to activate its [Exhaust] effect (unnatural unless final use) \u2014 also adds [Limit: 3 Uses] + free R3 module slot', label: '[On Use] Spend 2 Limit uses \u2192 trigger Exhaust (also Limit: 3 Uses + free R3)' },
  ]},
  { name: 'Unstable Tapping', rank: 2, options: [
    { tag: 'onUse', text: 'May spend 2 uses of a [Limit] skill to activate its [Exhaust] effect (unnatural unless final use, Cost 2+)', label: '[On Use] Spend 2 Limit uses \u2192 trigger Exhaust (Cost 2+)' },
  ]},
  { name: 'Blumenwand', rank: 2, options: [
    { tag: 'afterUse', text: 'You and up to {Cost} allies gain 1 Thorns (you gain an extra 1 if Cost 2+)', label: '[After Use] You and {Cost} allies gain 1 Thorns' },
  ]},
  { name: 'Brambles', rank: 2, options: [
    { tag: 'onUse', text: 'Gain {Cost} Thorns (1 if Cost 0)', label: '[On Use] Gain {Cost} Thorns' },
  ]},
  { name: 'Fruits', rank: 2, options: [
    { tag: 'afterUse', text: 'Spend all Thorns on self; an ally of your choice regains that much HP', label: '[After Use] Spend all Thorns \u2192 ally regains HP' },
  ]},
  { name: 'Flowers', rank: 2, options: [
    { tag: 'afterUse', text: 'Spend all Thorns on self; an ally of your choice regains that much Stagger Resist', label: '[After Use] Spend all Thorns \u2192 ally regains Stagger Resist' },
  ]},
  { name: 'Outspeed', rank: 2, options: [
    { tag: 'proactive', text: 'Target cannot respond using Speed Dice whose value is lower than the used Speed Die by 5 or more (Cost 0\u20131 only)', label: '[Proactive] Opponent cannot respond with Speed Dice \u22655 lower (Cost 0\u20131)' },
  ]},

  // ── RANK 3 ─────────────────────────────────────────────────────────────
  { name: 'Crumble', rank: 3, options: [
    { tag: 'onClashWin', text: "May spend 1 Light to destroy the target's next Die", label: "[Clash Win] Spend 1 Light \u2192 destroy target's next Die" },
  ]},
  { name: 'Extreme Critical', rank: 3, options: [
    { tag: 'onCrit', text: 'Deal additional damage and stagger = the max possible value of this die (counts only the die itself, not modifier)', label: '[Crit] Bonus damage + stagger = max die value' },
  ]},
  { name: 'Universal Exploit', rank: 3, options: [
    { tag: 'onCheck', text: 'Power +1 for every unique Ailment and Debuff on target (Ailments at 10+ give +2 each, non-counter)', label: '[Check] +1/unique Ailment or Debuff (+2 if 10+)' },
  ]},
  { name: 'Crippling Blow', rank: 3, options: [
    { tag: 'onCrit', text: 'Inflict 1 Feeble and 1 Disarm', label: '[Crit] Inflict 1 Feeble and 1 Disarm' },
  ]},
  { name: 'Proliferate', rank: 3, options: [
    { tag: 'onHit', text: 'Increase value of all Ailments, Fragile, and Bind on foe by 1 ([Crit] also +1 if Cost 2+)', label: '[Hit] +1 to all Ailments, Fragile, Bind on foe' },
  ]},
  { name: 'Neurotoxin', rank: 3, options: [
    { tag: 'onHit', text: 'Inflict 1 Paralyze (+1 Base Power if Cost 3+)', label: '[Hit] Inflict 1 Paralyze (+1 Power if Cost 3+)' },
  ]},
  { name: 'Enfeebling', rank: 3, options: [
    { tag: 'onHit', text: 'Inflict 1 Feeble', label: '[Hit] Inflict 1 Feeble' },
  ]},
  { name: 'Disarming', rank: 3, options: [
    { tag: 'onHit', text: 'Inflict 1 Disarm', label: '[Hit] Inflict 1 Disarm' },
  ]},
  { name: 'Wildfire', rank: 3, options: [
    { tag: 'onHit', text: "Set target's Burn equal to the highest Burn among combatants (Cost 1+)", label: "[Hit] Set target's Burn to highest among combatants (Cost 1+)" },
  ]},
  { name: 'Stable Burst', rank: 3, repeating: true, options: [
    { tag: 'onHit',      text: 'Trigger Tremor Burst', label: '[Hit] Trigger Tremor Burst' },
    { tag: 'onClashWin', text: 'Trigger Tremor Burst', label: '[Clash Win] Trigger Tremor Burst (non-Evade)' },
  ]},
  { name: 'Thorn Burst', rank: 3, options: [
    { tag: 'onHit', text: 'Spend all your Thorns to deal that much damage to all other enemies and twice as much to target. Lose Stagger Resist = Thorns spent (Cost 2+)', label: '[Hit] Spend all Thorns for AoE damage (Cost 2+)' },
  ]},
  { name: 'Tremor: Decay', rank: 3, options: [
    { tag: 'onHit', text: "Inflict 1 Fragile plus 1 per 10 Tremor on target, then reduce target's Tremor by 2 per Fragile inflicted", label: "[Hit] Fragile scaled to target's Tremor, drain Tremor" },
  ]},
  { name: 'Sapper', rank: 3, options: [
    { tag: 'onHit', text: "Target loses 1 Light (this die's size is reduced by 1 stage; requires d6+ die, Cost 3+)", label: '[Hit] Target loses 1 Light (die \u22121 size, Cost 3+)' },
  ]},
  { name: 'Shackled', rank: 3, options: [
    { tag: 'onClashWin', text: "May spend 5 Bind on foe to destroy the target's slowest unused Speed Die (Offensive die, Cost 3+)", label: "[Clash Win] Spend 5 Bind \u2192 destroy slowest enemy Speed Die (Cost 3+)" },
  ]},
  { name: 'D\xe9racin\xe9e', rank: 3, options: [
    { tag: 'exhaust', text: 'After skill ends, consume all Thorns on self. Distribute Bleed equal to twice the Thorns consumed as evenly as possible amongst all enemies', label: '[Exhaust] Consume all Thorns \u2192 distribute 2\xd7 Bleed to all enemies' },
  ]},
  { name: 'Counter', rank: 3, options: [
    { tag: 'afterUse', text: 'Gain the following Counter Die: {size: 1d4/1d6/1d8 by Cost} of your chosen Counter type. Modules can be added (combined ranks \u22643). (Cost 1+)', label: '[After Use] Gain a Counter Die (size by Cost, Cost 1+)' },
  ]},
  { name: 'Gift of Defense', rank: 3, options: [
    { tag: 'afterUse', text: 'Give the following Saved Defensive Die to an ally (can include self): {size: 1d4/1d6/1d8/1d10 by Cost} Block or Evade. Modules can be added.', label: '[After Use] Give a Saved Defensive Die to ally (size by Cost)' },
  ]},
  { name: 'Panacea', rank: 3, options: [
    { tag: 'afterUse', text: 'Remove all of 1 Ailment or Debuff on self (Cost 2+)', label: '[After Use] Remove all of 1 Ailment or Debuff (Cost 2+)' },
  ]},
  { name: 'Fervor', rank: 3, options: [
    { tag: 'eminence', text: 'Cost reduced by 1 while at least 3 E.G.O passives are active on self', label: '[Eminence] Cost \u22121 while 3+ E.G.O passives active on self' },
  ]},
  { name: 'Assist Attack', rank: 3, options: [
    { tag: 'afterUse', text: 'If at least 1 Offensive Die on this skill hits, another ally may use a skill with a Cost of 1 or lower against the same target without using a Speed Die. They must still spend Light. (Cost 3+)', label: '[After Use] Ally free Cost 0\u20131 attack on hit (Cost 3+)' },
  ]},
  { name: 'Mighty', rank: 3, options: [
    { tag: 'onUse', text: 'Gain 1 Strength (Cost 2+)', label: '[On Use] Gain 1 Strength (Cost 2+)' },
  ]},
  { name: 'Sturdy', rank: 3, options: [
    { tag: 'onUse', text: 'Gain 1 Endurance (Cost 2+)', label: '[On Use] Gain 1 Endurance (Cost 2+)' },
  ]},
  { name: 'Offense Formation', rank: 3, options: [
    { tag: 'onUse',    text: 'Give another ally 1 Strength (Cost 3+)', label: '[On Use] Give ally 1 Strength (Cost 3+)' },
    { tag: 'afterUse', text: 'Give another ally 1 Strength (Cost 3+)', label: '[After Use] Give ally 1 Strength (Cost 3+)' },
  ]},
  { name: 'Defense Formation', rank: 3, options: [
    { tag: 'onUse',    text: 'Give another ally 1 Endurance (Cost 3+)', label: '[On Use] Give ally 1 Endurance (Cost 3+)' },
    { tag: 'afterUse', text: 'Give another ally 1 Endurance (Cost 3+)', label: '[After Use] Give ally 1 Endurance (Cost 3+)' },
  ]},
  { name: 'Fatal Fury', rank: 3, options: [
    { tag: 'exhaust', text: 'Lose 20 HP and gain 3 Strength (2 Strength if this effect did not trigger naturally)', label: '[Exhaust] Lose 20 HP \u2192 gain 3 Strength' },
  ]},
  { name: 'Sink With Me', rank: 3, options: [
    { tag: 'onUse', text: 'Spend all Emotion Points; inflict X Sinking on all enemies where X = amount spent \u22125 (max 15 Sinking, Cost 2+). May be used as [After Use] instead.', label: '[On Use] Spend all EP \u2192 mass Sinking on enemies (Cost 2+)' },
  ]},
];

// ============================================================================
// MODULE STATE
// ============================================================================

let isMasterMode = false;
const _autoSaveTimers = {};
// Persists card collapse state across re-renders. Key = skillId, value = true (collapsed).
const _collapsedCards = new Set();

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export function renderCombatSkillsTab(container) {
    const ss = extensionSettings.statSheet;
    if (!ss) {
        container.html('<div class="error-message">Stat sheet not initialized</div>');
        return;
    }

    _ensureCombatSkillsDefaults();
    _injectCsPoolStyles();   // ensure badge + pool CSS always present
    container.off('.cs');

    if (isMasterMode) {
        container.html(_buildMasterHTML());
        _attachMasterListeners(container);
    } else {
        container.html(_buildPlayerHTML());
        _attachPlayerListeners(container);
    }
    _attachToggleListener(container);
}

// ============================================================================
// DATA DEFAULTS / MIGRATION
// ============================================================================

function _ensureCombatSkillsDefaults() {
    const ss = extensionSettings.statSheet;
    let dirty = false;

    if (!Array.isArray(ss.combatSkills)) { ss.combatSkills = []; dirty = true; }

    // Session 10: seed user template store
    if (!Array.isArray(ss.combatSkillTemplates)) { ss.combatSkillTemplates = []; dirty = true; }

    for (const skill of ss.combatSkills) {
        if (!skill.id)                   { skill.id            = generateUniqueId(); dirty = true; }
        if (skill.name       == null)    { skill.name          = '';                 dirty = true; }
        if (skill.cost       == null)    { skill.cost          = 1;                  dirty = true; }
        if (skill.isUnique   == null)    { skill.isUnique      = false;              dirty = true; }
        if (skill.isEGO      == null)    { skill.isEGO         = false;              dirty = true; }
        if (skill.egoTier    == null)    { skill.egoTier       = 'ZAYIN';            dirty = true; }
        if (skill.egoSanityCost == null) { skill.egoSanityCost = 5;                 dirty = true; }
        if (skill.equipped   == null)    { skill.equipped      = false;              dirty = true; }
        if (!Array.isArray(skill.dice))  { skill.dice          = [];                 dirty = true; }
        if (skill.notes      == null)    { skill.notes         = '';                 dirty = true; }

        // Migration: old freeform skillModules textarea → notes
        if (skill.skillModules !== undefined) {
            if (skill.skillModules && !skill.notes) {
                skill.notes = skill.skillModules;
            } else if (skill.skillModules && skill.notes) {
                skill.notes = skill.skillModules + '\n' + skill.notes;
            }
            delete skill.skillModules;
            dirty = true;
        }

        // Session 11: ensure die tag values are { text, rank } objects
        const _DIE_TAG_KEYS   = ['onHit','onClashWin','onClashLose','onCrit','onCheck','onEvade'];
        const _SKILL_TAG_KEYS = ['onUse','afterUse','onKill','onStagger','eminence','exhaust','proactive','reactive'];
        for (const die of skill.dice) {
            for (const key of _DIE_TAG_KEYS) {
                if (typeof die[key] === 'string') {
                    die[key] = { text: die[key], rank: 1 };
                    dirty = true;
                }
            }
        }
        for (const key of _SKILL_TAG_KEYS) {
            if (typeof skill[key] === 'string') {
                skill[key] = { text: skill[key], rank: 1 };
                dirty = true;
            }
        }
        // Remove legacy modules array
        if (Object.prototype.hasOwnProperty.call(skill, 'modules')) {
            delete skill.modules;
            dirty = true;
        }

        // Skill-level tag fields are all optional (undefined = slot not added).
        // No defaults needed.

        for (const die of skill.dice) {
            if (!die.id)               { die.id        = generateUniqueId(); dirty = true; }
            if (!die.diceType)         { die.diceType  = 'Slash';            dirty = true; }
            if (die.sides    == null)  { die.sides     = 6;                  dirty = true; }
            if (die.basePower == null) { die.basePower = 0;                  dirty = true; }
            if (!die.modifier) {
                die.modifier = { type: 'flat', flatValue: die.basePower ?? 0, targetId: '', multiplier: 1, roundDown: false };
                dirty = true;
            }

            // Migration: old freeform `effects` string → onHit
            if (die.effects !== undefined) {
                if (die.effects && die.onHit === undefined) die.onHit = die.effects;
                delete die.effects;
                dirty = true;
            }
            // Die effect fields are optional — undefined = slot not added.
        }
    }

    if (dirty) saveStatSheetData();
}

// ============================================================================
// HELPERS
// ============================================================================

function _esc(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _tierInfo(tierKey)   { return EGO_TIERS.find(t => t.key === tierKey) || EGO_TIERS[0]; }
function _sanityCost(tierKey) { return _tierInfo(tierKey).sanityCost; }

function _equippedRegular() {
    return (extensionSettings.statSheet.combatSkills || []).filter(p => p.equipped && !p.isEGO);
}
function _equippedEGO() {
    return (extensionSettings.statSheet.combatSkills || []).filter(p => p.equipped && p.isEGO);
}
function _allSkills() { return extensionSettings.statSheet.combatSkills || []; }
function _skill(id)   { return _allSkills().find(s => s.id === id) || null; }
function _die(skillId, dieId) {
    const sk = _skill(skillId);
    return sk ? (sk.dice || []).find(d => d.id === dieId) || null : null;
}

function _save(skillId) {
    clearTimeout(_autoSaveTimers[skillId]);
    _autoSaveTimers[skillId] = setTimeout(() => saveStatSheetData(), 500);
}

function _costPips(cost) {
    const n = Math.max(0, cost || 0);
    return `<span class="cs-cost-pips">${'●'.repeat(n) || '○'}</span>`;
}

function _dieClass(diceType) {
    if (!diceType) return 'cs-dt-offensive';
    if (diceType.startsWith('Counter-')) return 'cs-dt-counter';
    if (diceType === 'Block' || diceType === 'Evade') return 'cs-dt-defensive';
    return 'cs-dt-offensive';
}

// Die type predicates used by effect filter functions
function _isOffensiveDie(die) {
    const t = die.diceType || '';
    return !['Block', 'Evade', 'Counter-Block', 'Counter-Evade'].includes(t);
}

function _isEvadeDie(die) {
    const t = die.diceType || '';
    return t === 'Evade' || t === 'Counter-Evade';
}

/**
 * Roll all dice for a combat skill, log each to diceLog, and show a popover near $btn.
 * Uses _resolveModLive() so attribute/skill/ST modifiers are applied live.
 * @param {jQuery} $btn   — the button that was clicked (used for positioning)
 * @param {object} skill  — the combat skill object
 */
function _showSkillRollPopover($btn, skill) {
    // Dismiss any existing popover
    $('.cs-roll-popover').remove();

    if (!skill.dice?.length) {
        showNotification('This skill has no dice to roll.', 'info');
        return;
    }

    const results = skill.dice.map(die => {
        const resolvedMod = _resolveModLive(die.modifier);
        const rawRoll     = Math.floor(Math.random() * (die.sides || 6)) + 1;
        const total       = rawRoll + resolvedMod;
        const modStr      = resolvedMod > 0 ? `+${resolvedMod}` : resolvedMod < 0 ? `${resolvedMod}` : '';
        const formula     = `1d${die.sides || 6}${modStr}`;
        return { die, rawRoll, total, resolvedMod, formula };
    });

    // Log all dice as one grouped entry: label = skill name, formula = "XdY+M / XdY", total = sum
    {
        const groupFormula = results.map(r => r.formula).join(' / ');
        const groupTotal   = results.reduce((sum, r) => sum + r.total, 0);
        const groupRolls   = results.map(r => r.rawRoll);
        logDiceRoll(groupFormula, groupTotal, groupRolls, skill.name);
    }

    const rows = results.map(r => {
        const modStr  = r.resolvedMod > 0 ? `+${r.resolvedMod}` : r.resolvedMod < 0 ? `${r.resolvedMod}` : '';
        const isCrit  = r.rawRoll === r.die.sides;
        const isFail  = r.rawRoll === 1;
        const cls     = isCrit ? 'cs-rp-crit' : isFail ? 'cs-rp-fail' : '';
        const glyph   = isCrit ? ' ✨' : isFail ? ' 💀' : '';
        return `
            <div class="cs-rp-row">
                <span class="cs-die-chip ${_dieClass(r.die.diceType)}">${_esc(r.die.diceType || '?')} d${r.die.sides || 6}${modStr}</span>
                <span class="cs-rp-result ${cls}">${r.total}${glyph}</span>
            </div>`;
    }).join('');

    const $pop = $(`
        <div class="cs-roll-popover">
            <div class="cs-rp-title">🎲 ${_esc(skill.name || 'Roll')}</div>
            ${rows}
            <button class="cs-rp-close">✕</button>
        </div>
    `);

    $('body').append($pop);

    // Position using getBoundingClientRect (works correctly for position:fixed)
    const rect     = $btn[0].getBoundingClientRect();
    const popW     = 230;
    const left     = Math.min(rect.left, window.innerWidth - popW - 8);
    $pop.css({ position: 'fixed', left: Math.max(8, left), top: rect.top - 8, zIndex: 100002 });

    // After render, push popover above the button
    requestAnimationFrame(() => {
        const popH = $pop.outerHeight(true) || 0;
        $pop.css({ top: Math.max(8, rect.top - popH - 6) });
    });

    $pop.find('.cs-rp-close').on('click', () => $pop.remove());

    // Dismiss on outside click (deferred so this click doesn't immediately count)
    setTimeout(() => {
        $(document).one('click.csrollpop', e => {
            if (!$(e.target).closest('.cs-roll-popover').length) $pop.remove();
        });
    }, 50);
}

/**
 * Build a short label for a die modifier (used in chips and the detail popup).
 * For flat modifiers: "+3" / "-2" / ""
 * For attribute/skill: "+STR", "+×0.5 Athletics↓"
 */
function _modifierLabel(mod, plain) {
    if (!mod || mod.type === 'flat') {
        const v = mod?.flatValue ?? 0;
        return v > 0 ? `+${v}` : v < 0 ? String(v) : '';
    }
    const ss  = extensionSettings.statSheet;
    let tname = null;
    if (mod.type === 'attribute') {
        const attr = (ss?.attributes || []).find(a => a.id === mod.targetId);
        tname = attr?.name ?? null;
    } else if (mod.type === 'saving_throw') {
        const st = (ss?.savingThrows || []).find(s => s.id === mod.targetId);
        tname = st?.name ?? null;
        if (!tname) tname = 'Save';   // ID stale but type is known
    } else if (mod.type === 'subskill') {
        for (const attr of (ss?.attributes || [])) {
            for (const sk of (attr.skills || [])) {
                const sub = (sk.subSkills || []).find(s => s.id === mod.targetId);
                if (sub) { tname = sub.name; break; }
            }
            if (tname) break;
        }
        if (!tname) tname = 'Sub-skill';
    } else {
        for (const attr of (ss?.attributes || [])) {
            const sk = (attr.skills || []).find(s => s.id === mod.targetId);
            if (sk) { tname = sk.name; break; }
        }
        if (!tname) tname = 'Skill';
    }
    const mult  = mod.multiplier ?? 1;
    const mStr  = mult !== 1 ? `×${mult} ` : '';
    const rStr  = mod.roundDown ? '↓' : '';
    return plain ? `+${mStr}${tname}${rStr}` : `<span style="opacity:.7;font-size:.85em">+${mStr}${tname}${rStr}</span>`;
}

function _diceChips(dice) {
    if (!dice || dice.length === 0) return '<span class="cs-no-dice">—</span>';
    return dice.map(d => {
        const mod = d.modifier ?? { type: 'flat', flatValue: d.basePower ?? 0 };
        const ml  = _modifierLabel(mod, true);
        const cls = _dieClass(d.diceType);
        return `<span class="cs-die-chip ${cls}">${_esc(d.diceType)} 1d${d.sides || 6}${ml}</span>`;
    }).join('');
}

// Render the coloured limit badge shown in the chip row
function _limitBadge(skill) {
    if (skill.limitUses === undefined || skill.limitUses === null) return '';
    return `<span class="cs-limit-badge">Limit: ${skill.limitUses}</span>`;
}

// ── Skill Power Tier System  (Session 10) ────────────────────────────────────

const _POWER_TIERS = [
    { label: 'I',   min:  0,  color: '#7a7a9a' },
    { label: 'II',  min: 10,  color: '#4a9eff' },
    { label: 'III', min: 20,  color: '#4caf7d' },
    { label: 'IV',  min: 35,  color: '#ff9c3a' },
    { label: 'V',   min: 55,  color: '#ffd700' },
];

/**
 * Resolve a die modifier to its current numeric value using live stat-sheet data.
 * Returns 0 for unresolvable dynamic modifiers.
 */
function _resolveModLive(mod) {
    if (!mod || mod.type === 'flat') return mod?.flatValue ?? 0;
    const ss      = extensionSettings.statSheet;
    const es      = ss?.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    if (mod.type === 'attribute') {
        const attr = (ss?.attributes || []).find(a => a.id === mod.targetId && a.enabled);
        if (!attr) return 0;
        const raw = ss.mode === 'numeric'
            ? (attr.value ?? 0)
            : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
        const val = (mod.multiplier ?? 1) * raw;
        return mod.roundDown ? Math.floor(val) : val;
    }

    if (mod.type === 'skill') {
        for (const attr of (ss?.attributes || [])) {
            if (!attr.enabled) continue;
            const sk = (attr.skills || []).find(s => s.id === mod.targetId && s.enabled);
            if (!sk) continue;
            const attrMod = ss.mode === 'numeric'
                ? (attr.value ?? 0)
                : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
            const skillRaw = sk.mode === 'alphabetic'
                ? (gvm[sk.rank ?? 'C'] ?? 0) + Math.floor((sk.rankValue ?? 0) / divisor)
                : (sk.level ?? 0);
            const val = attrMod + (mod.multiplier ?? 1) * skillRaw;
            return mod.roundDown ? Math.floor(val) : val;
        }
        return 0;
    }

    if (mod.type === 'saving_throw') {
        const st = (ss?.savingThrows || []).find(s => s.id === mod.targetId && s.enabled);
        if (!st) return 0;
        try {
            const raw = calculateSavingThrowValue(st);
            const val = (mod.multiplier ?? 1) * raw;
            return mod.roundDown ? Math.floor(val) : val;
        } catch { return 0; }
    }

    if (mod.type === 'subskill') {
        // Formula: attrModifier + (subSkillLevel × multiplier)
        // Finds the sub-skill, then its parent attribute for the attr component.
        for (const attr of (ss?.attributes || [])) {
            if (!attr.enabled) continue;
            for (const sk of (attr.skills || [])) {
                if (!sk.enabled) continue;
                const sub = (sk.subSkills || []).find(s => s.id === mod.targetId && s.enabled);
                if (!sub) continue;
                const attrMod = ss.mode === 'numeric'
                    ? (attr.value ?? 0)
                    : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
                const subVal = sub.level ?? 0;
                const scaled = (mod.multiplier ?? 1) * subVal;
                const total  = attrMod + (mod.roundDown ? Math.floor(scaled) : scaled);
                return total;
            }
        }
        return 0;
    }

    return 0;
}

/**
 * Sum the resolved modifier values across all dice in a skill.
 * Used to determine its power tier.
 * @param {object} skill
 * @returns {number}
 */
function _computeSkillPower(skill) {
    let total = 0;
    for (const die of (skill.dice || [])) {
        total += Math.abs(_resolveModLive(die.modifier ?? { type: 'flat', flatValue: die.basePower ?? 0 }));
    }
    return total;
}

/**
 * Compute the suggested Light cost floor for a skill.
 *
 * Per-die cost = Layer1 (type) + Layer2 (resolved value) + Layer3 (multiplier), min 0.
 * Skill total  = sum of all per-die costs, clamped 0–3.
 *
 * Layer 1 — Type base points:
 *   flat                     → 0 (skip all other layers)
 *   attribute                → 1
 *   skill / subskill / save  → 2
 *
 * Layer 2 — Resolved value (pre-multiplier stat total):
 *   1–4   → −1
 *   5–10  →  0
 *   11–18 → +1
 *   19+   → +2
 *
 * Layer 3 — Multiplier:
 *   0.25        → −1
 *   0.5         →  0
 *   0.75–1.0    → +1
 *   1.25–1.5    → +2
 *   2.0+        → +3
 *
 * @param {object} skill
 * @returns {{ floor: number, breakdown: { dieCost: number, layer1: number, layer2: number, layer3: number }[] }}
 */
function _computeCostFloor(skill) {
    const ss      = extensionSettings.statSheet;
    const es      = ss?.editorSettings;
    const gvm     = es?.gradeValueMap    || {};
    const divisor = es?.attrValueDivisor || 100;

    let total = 0;
    const breakdown = [];

    for (const die of (skill.dice || [])) {
        const mod  = die.modifier ?? { type: 'flat', flatValue: die.basePower ?? 0 };
        const type = mod.type || 'flat';

        // Flat — always 0
        if (type === 'flat') {
            breakdown.push({ dieCost: 0, layer1: 0, layer2: 0, layer3: 0 });
            continue;
        }

        // Layer 1 — type base
        const layer1 = (type === 'attribute') ? 1 : 2;

        // Layer 2 — resolved pre-multiplier stat value
        // For attribute: just the attr value
        // For skill/subskill/save: attr + skill/sub raw (before multiplier)
        let rawValue = 0;
        if (type === 'attribute') {
            const attr = (ss?.attributes || []).find(a => a.id === mod.targetId && a.enabled);
            if (attr) {
                rawValue = ss.mode === 'numeric'
                    ? (attr.value ?? 0)
                    : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
            }
        } else if (type === 'skill') {
            for (const attr of (ss?.attributes || [])) {
                if (!attr.enabled) continue;
                const sk = (attr.skills || []).find(s => s.id === mod.targetId && s.enabled);
                if (!sk) continue;
                const attrVal = ss.mode === 'numeric'
                    ? (attr.value ?? 0)
                    : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
                const skVal = sk.mode === 'alphabetic'
                    ? (gvm[sk.rank ?? 'C'] ?? 0) + Math.floor((sk.rankValue ?? 0) / divisor)
                    : (sk.level ?? 0);
                rawValue = attrVal + skVal;
                break;
            }
        } else if (type === 'subskill') {
            for (const attr of (ss?.attributes || [])) {
                if (!attr.enabled) continue;
                for (const sk of (attr.skills || [])) {
                    if (!sk.enabled) continue;
                    const sub = (sk.subSkills || []).find(s => s.id === mod.targetId && s.enabled);
                    if (!sub) continue;
                    const attrVal = ss.mode === 'numeric'
                        ? (attr.value ?? 0)
                        : (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
                    rawValue = attrVal + (sub.level ?? 0);
                    break;
                }
                if (rawValue > 0) break;
            }
        } else if (type === 'saving_throw') {
            const st = (ss?.savingThrows || []).find(s => s.id === mod.targetId && s.enabled);
            if (st) {
                try { rawValue = calculateSavingThrowValue(st); } catch { rawValue = 0; }
            }
        }

        const layer2 = rawValue <= 0  ?  0
                     : rawValue <= 4  ? -1
                     : rawValue <= 10 ?  0
                     : rawValue <= 18 ?  1
                     :                   2;

        // Layer 3 — multiplier
        const mult   = mod.multiplier ?? 1;
        const layer3 = mult <= 0.25 ? -1
                     : mult <= 0.5  ?  0
                     : mult <= 1.0  ?  1
                     : mult <= 1.5  ?  2
                     :                 3;

        const dieCost = Math.max(0, layer1 + layer2 + layer3);
        total += dieCost;
        breakdown.push({ dieCost, layer1, layer2, layer3 });
    }

    return { floor: Math.max(0, total), breakdown };
}

/**
 * Patch the Floor badge and cost-select border for one skill card without
 * re-rendering the whole tab.  Call this from any handler that changes a
 * die modifier type, target, or multiplier, and from the cost-select handler.
 *
 * @param {jQuery} container  — the tab container passed into _attachMasterListeners
 * @param {string} skillId
 */
function _updateCostFloorUI(container, skillId) {
    const sk = _skill(skillId);
    if (!sk) return;

    const { floor, breakdown } = _computeCostFloor(sk);
    const belowFloor = (sk.cost || 0) < floor;

    // Update badge text, class, and tooltip
    const tip = breakdown.map((b, i) =>
        `Die ${i + 1}: type=${b.layer1} val=${b.layer2 >= 0 ? '+' : ''}${b.layer2} mult=${b.layer3 >= 0 ? '+' : ''}${b.layer3} = ${b.dieCost}`
    ).join('\n') + `\nTotal: ${floor}`;

    // Use data-floor-badge attribute — avoids complex nested selector chains
    const $badge  = $(`[data-floor-badge="${skillId}"]`);
    const $select = $(`[data-skill-id="${skillId}"].cs-cost-input`);

    $badge
        .text(`Floor: ${floor}`)
        .attr('title', tip)
        .toggleClass('cs-cost-floor-warn', belowFloor);

    $select.css('border-color', belowFloor ? '#ff4f4f' : '');
}

/**
 * Build a small tier badge showing the skill's current power rating.
 * Returns '' for skills with no dice.
 * @param {object} skill
 * @returns {string}  HTML string
 */
function _powerTierBadge(skill) {
    if (!skill.dice?.length) return '';
    const power = _computeSkillPower(skill);
    let tier = _POWER_TIERS[0];
    for (const t of _POWER_TIERS) { if (power >= t.min) tier = t; }
    const c = tier.color;
    return `<span class="cs-power-tier-badge"
                  style="color:${c};border-color:${c}55;background:${c}18;"
                  title="Skill power tier (total modifier sum: ${Math.round(power)})">T${tier.label}</span>`;
}

function _tierBadge(tier) {
    const color = EGO_TIER_COLORS[tier] || '#aaa';
    return `<span class="cs-tier-badge" style="color:${color};border-color:${color}55;background:${color}18">${tier}</span>`;
}

function _createDefaultSkill(isEGO = false) {
    return {
        id:            generateUniqueId(),
        name:          isEGO ? 'New E.G.O' : 'New Skill',
        cost:          1,
        isUnique:      false,
        isEGO,
        egoTier:       'ZAYIN',
        egoSanityCost: 5,
        equipped:      false,
        dice:          [],
        notes:         '',
    };
}

function _createDefaultDie() {
    return {
        id:       generateUniqueId(),
        diceType: 'Slash',
        sides:    6,
        basePower: 0,   // kept for backward compat; canonical value is modifier.flatValue
        modifier: { type: 'flat', flatValue: 0, targetId: '', multiplier: 1, roundDown: false },
    };
}

// ============================================================================
// DIE EFFECT SLOT HELPERS
// ============================================================================

/** Returns effect defs visible for this specific die (filtered by die type). */
function _visibleDieEffects(die) {
    return DIE_EFFECT_DEFS.filter(e => e.filter === null || e.filter(die));
}

/** Returns effect defs that are visible AND not yet added to the die. */
function _missingDieEffects(die) {
    return _visibleDieEffects(die).filter(e => die[e.key] === undefined || die[e.key] === null);
}

function _dieEffectRow(skillId, dieId, def, tagVal) {
    // tagVal is now a { text, rank } object; handle legacy string gracefully
    const text = (tagVal && typeof tagVal === 'object') ? (tagVal.text || '') : (tagVal || '');
    const rank = (tagVal && typeof tagVal === 'object') ? (tagVal.rank || 1) : 1;

    const rankOpts = [1, 2, 3].map(r => {
        const c = _MOD_RANK_COLORS[r];
        return `<option value="${r}" ${rank === r ? 'selected' : ''}>R${r}</option>`;
    }).join('');

    return `
<div class="cs-die-effect-row" data-effect="${def.key}"
     data-die-id="${_esc(dieId)}" data-skill-id="${_esc(skillId)}">
    <span class="cs-effect-tag ${def.cls}">${def.label}</span>
    <select class="cs-effect-rank-select cs-input-sm"
        data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${def.key}"
        title="Module rank this tag occupies"
        style="width:46px;padding:2px 2px;color:${_MOD_RANK_COLORS[rank]};border-color:${_MOD_RANK_COLORS[rank]}55;background:#1a1a2e;">
        ${rankOpts}
    </select>
    <input type="text" class="cs-effect-input"
        data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${def.key}"
        value="${_esc(text)}"
        placeholder="Describe the effect…" />
    <button class="cs-btn cs-btn-icon cs-mod-pick-btn"
        data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${def.key}"
        title="Browse module catalog">📋</button>
    <button class="cs-btn cs-btn-icon cs-remove-effect-btn"
        data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${def.key}"
        title="Remove">✕</button>
</div>`;
}

function _dieAddEffectsRowHTML(skillId, dieId, die) {
    const missing = _missingDieEffects(die);
    if (!missing.length) return '<div class="cs-add-effects-row"></div>';
    return `
<div class="cs-add-effects-row">
    ${missing.map(e => `
    <button class="cs-btn cs-btn-sm cs-add-effect-btn"
        data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${e.key}">
        + ${e.label}
    </button>`).join('')}
</div>`;
}

function _rebuildDieAddEffectsRow(dieEditor, skillId, dieId, die) {
    const missing = _missingDieEffects(die);
    dieEditor.find('.cs-add-effects-row').html(
        missing.map(e => `
        <button class="cs-btn cs-btn-sm cs-add-effect-btn"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(dieId)}" data-effect="${e.key}">
            + ${e.label}
        </button>`).join('')
    );
}

// ============================================================================
// SKILL TAG SLOT HELPERS
// ============================================================================

/** Returns skill tag defs not yet added to the skill. */
function _missingSkillTags(skill) {
    return SKILL_TAG_DEFS.filter(t => skill[t.key] === undefined || skill[t.key] === null);
}

function _skillTagRow(skillId, def, tagVal) {
    // tagVal: { text, rank } object for text tags, or a number for limitUses
    const isLimit = def.inputType === 'number';
    const text  = isLimit
        ? (typeof tagVal === 'number' ? tagVal : (tagVal?.text ?? 5))
        : ((tagVal && typeof tagVal === 'object') ? (tagVal.text || '') : (tagVal || ''));
    const rank  = (!isLimit && tagVal && typeof tagVal === 'object') ? (tagVal.rank || 1) : 1;

    const rankOpts = [1, 2, 3].map(r =>
        `<option value="${r}" ${rank === r ? 'selected' : ''}>R${r}</option>`
    ).join('');

    const rankSelectHTML = !isLimit
        ? `<select class="cs-stag-rank-select cs-input-sm"
               data-skill-id="${_esc(skillId)}" data-tag="${def.key}"
               title="Module rank this tag occupies"
               style="width:46px;padding:2px 2px;color:${_MOD_RANK_COLORS[rank]};border-color:${_MOD_RANK_COLORS[rank]}55;background:#1a1a2e;">
               ${rankOpts}
           </select>`
        : '';

    const inputHTML = isLimit
        ? `<div class="cs-stag-limit-wrap">
               <input type="number" class="cs-stag-input cs-stag-number"
                   data-skill-id="${_esc(skillId)}" data-tag="${def.key}"
                   value="${_esc(String(text))}" min="1" max="99"
                   placeholder="${def.hint}" />
               <span class="cs-stag-limit-label">uses</span>
           </div>`
        : `<input type="text" class="cs-stag-input"
               data-skill-id="${_esc(skillId)}" data-tag="${def.key}"
               value="${_esc(String(text))}"
               placeholder="${_esc(def.hint)}" />`;

    const pickBtnHTML = !isLimit
        ? `<button class="cs-btn cs-btn-icon cs-stag-pick-btn"
               data-skill-id="${_esc(skillId)}" data-tag="${def.key}"
               title="Browse module catalog">📋</button>`
        : '';

    return `
<div class="cs-skill-tag-row" data-tag="${def.key}" data-skill-id="${_esc(skillId)}">
    <span class="cs-stag-pill ${def.cls}">${def.label}</span>
    ${rankSelectHTML}
    ${inputHTML}
    ${pickBtnHTML}
    <button class="cs-btn cs-btn-icon cs-remove-stag-btn"
        data-skill-id="${_esc(skillId)}" data-tag="${def.key}" title="Remove">✕</button>
</div>`;
}

function _skillTagAddRowHTML(skillId, skill) {
    const missing = _missingSkillTags(skill);
    if (!missing.length) return '<div class="cs-add-stags-row"></div>';
    return `
<div class="cs-add-stags-row">
    ${missing.map(t => `
    <button class="cs-btn cs-btn-sm cs-add-stag-btn"
        data-skill-id="${_esc(skillId)}" data-tag="${t.key}">
        + ${t.label}
    </button>`).join('')}
</div>`;
}

function _rebuildSkillTagAddRow(cardEl, skillId, skill) {
    const missing = _missingSkillTags(skill);
    cardEl.find('.cs-add-stags-row').html(
        missing.map(t => `
        <button class="cs-btn cs-btn-sm cs-add-stag-btn"
            data-skill-id="${_esc(skillId)}" data-tag="${t.key}">
            + ${t.label}
        </button>`).join('')
    );
}

// ============================================================================
// MODULE PICKER PANEL  (Session 11)
// A reusable side panel for browsing/selecting modules from the catalog.
// ============================================================================

const _CS_MPICK_ID       = 'cs-module-pick-panel';
const _CS_MPICK_STYLE_ID = 'cs-module-pick-styles';
let _mpickTarget = null; // { $input, $rank }

function _injectModulePickerStyles() {
    const existing = document.getElementById(_CS_MPICK_STYLE_ID);
    if (existing) existing.remove();
    const s = document.createElement('style');
    s.id = _CS_MPICK_STYLE_ID;
    s.textContent = `
        #${_CS_MPICK_ID} {
            position: fixed; top: 0; right: 0; width: 400px; height: 100vh;
            background: #13132a; border-left: 2px solid #2e2e50;
            display: flex; flex-direction: column; z-index: 99999;
            box-shadow: -6px 0 24px rgba(0,0,0,.5);
            animation: csmpi-in .18s ease;
        }
        @keyframes csmpi-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

        #${_CS_MPICK_ID} .csmpi-hdr {
            display: flex; align-items: center; gap: 8px;
            padding: 14px 16px 12px; border-bottom: 1px solid #2a2a42; flex-shrink: 0;
        }
        #${_CS_MPICK_ID} .csmpi-hdr h3 { flex: 1; margin: 0; font-size: .95rem; color: #e0e0f0; }
        #${_CS_MPICK_ID} .csmpi-close {
            background: none; border: none; color: #888; font-size: 1.2rem; cursor: pointer; padding: 2px 6px; line-height: 1;
        }
        #${_CS_MPICK_ID} .csmpi-close:hover { color: #e0e0f0; }

        #${_CS_MPICK_ID} .csmpi-context {
            padding: 8px 16px 0; font-size: .75rem; color: #7070a0; flex-shrink: 0; line-height: 1.4;
        }
        #${_CS_MPICK_ID} .csmpi-search { padding: 8px 16px 4px; flex-shrink: 0; }
        #${_CS_MPICK_ID} .csmpi-search input {
            width: 100%; box-sizing: border-box; background: #1e1e38;
            border: 1px solid #3a3a5a; border-radius: 6px; color: #d0d0e8;
            padding: 6px 10px; font-size: .85rem; outline: none;
        }
        #${_CS_MPICK_ID} .csmpi-search input:focus { border-color: #5a5aaa; }

        #${_CS_MPICK_ID} .csmpi-rank-tabs {
            display: flex; gap: 4px; padding: 6px 16px 8px; flex-shrink: 0;
        }
        #${_CS_MPICK_ID} .csmpi-rtab {
            flex: 1; padding: 5px 0; background: #1a1a32; border: 1px solid #2e2e50;
            border-radius: 5px; color: #6a6a9a; font-size: .78rem; cursor: pointer; line-height: 1;
        }
        #${_CS_MPICK_ID} .csmpi-rtab.active        { background: #22223e; border-color: #5a5aaa; color: #c0c0e8; }
        #${_CS_MPICK_ID} .csmpi-rtab[data-rank="1"].active { border-color: #7eb8d4; color: #7eb8d4; }
        #${_CS_MPICK_ID} .csmpi-rtab[data-rank="2"].active { border-color: #c49ae8; color: #c49ae8; }
        #${_CS_MPICK_ID} .csmpi-rtab[data-rank="3"].active { border-color: #f0ad4e; color: #f0ad4e; }

        #${_CS_MPICK_ID} .csmpi-list {
            flex: 1; overflow-y: auto; overflow-x: hidden;
            padding: 4px 12px 20px; display: flex; flex-direction: column; gap: 0;
        }

        /* ── Rank section divider ───────────────────────────── */
        .csmpi-rank-hdr {
            font-size: .68rem; font-weight: 800; letter-spacing: .1em;
            text-transform: uppercase; padding: 12px 4px 6px;
            border-bottom: 1px solid; flex-shrink: 0;
        }

        /* ── Flat option row ────────────────────────────────── */
        .csmpi-row {
            display: grid;
            grid-template-columns: 3px 1fr auto;
            align-items: stretch;
            background: #1c1c36;
            border-left: 1px solid #28284a;
            border-right: 1px solid #28284a;
            border-bottom: 1px solid #222240;
            cursor: pointer;
            transition: background .1s;
            min-height: 0;
        }
        .csmpi-row:first-of-type { border-top: 1px solid #28284a; border-radius: 6px 6px 0 0; }
        .csmpi-row:last-of-type  { border-radius: 0 0 6px 6px; margin-bottom: 8px; }
        .csmpi-row:only-of-type  { border-radius: 6px; margin-bottom: 8px; }
        .csmpi-row:hover { background: #242448; }

        .csmpi-row-stripe { width: 3px; border-radius: 3px 0 0 3px; align-self: stretch; }

        .csmpi-row-body { padding: 8px 10px; min-width: 0; }
        .csmpi-row-name {
            font-size: .76rem; font-weight: 700; color: #c8c8ec;
            display: flex; align-items: center; gap: 5px; margin-bottom: 2px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .csmpi-row-rep { font-size: .65rem; color: #7070a0; font-weight: 400; }
        .csmpi-row-label {
            font-size: .8rem; color: #9494bc; line-height: 1.4;
            white-space: normal; word-break: break-word;
        }
        .csmpi-row-label:hover { color: #c8c8ec; }

        .csmpi-row-badge {
            font-size: .68rem; font-weight: 700; padding: 3px 7px 3px;
            border-left: 1px solid #22223e; border-radius: 0 5px 5px 0;
            display: flex; align-items: center; white-space: nowrap; flex-shrink: 0;
        }

        /* Tag badge (when showing all slots) */
        .csmpi-tag-pill {
            display: inline-block; font-size: .65rem; padding: 1px 5px;
            border-radius: 3px; border: 1px solid #2e2e50;
            background: #1a1a30; color: #6868a8; margin-right: 4px;
            vertical-align: middle; white-space: nowrap;
        }

        #${_CS_MPICK_ID} .csmpi-empty {
            text-align: center; color: #5a5a7a; font-size: .85rem; padding: 30px 0; line-height: 1.6;
        }
    `;
    document.head.appendChild(s);
}

function _buildModulePicker() {
    _injectModulePickerStyles();
    if (document.getElementById(_CS_MPICK_ID)) return;
    const $p = $(`
<div id="${_CS_MPICK_ID}">
    <div class="csmpi-hdr">
        <h3>📋 Module Catalog</h3>
        <button class="csmpi-close" id="csmpi-close-btn">✕</button>
    </div>
    <div class="csmpi-context" id="csmpi-context"></div>
    <div class="csmpi-search">
        <input type="text" id="csmpi-search" placeholder="Search modules…">
    </div>
    <div class="csmpi-rank-tabs">
        <button class="csmpi-rtab active" data-rank="0">All</button>
        <button class="csmpi-rtab" data-rank="1">R1</button>
        <button class="csmpi-rtab" data-rank="2">R2</button>
        <button class="csmpi-rtab" data-rank="3">R3</button>
    </div>
    <div class="csmpi-list" id="csmpi-list"></div>
</div>`);

    $p.find('#csmpi-close-btn').on('click', _closeModulePicker);

    $p.find('.csmpi-rtab').on('click', function() {
        $p.find('.csmpi-rtab').removeClass('active');
        $(this).addClass('active');
        _refreshModulePicker();
    });

    $p.find('#csmpi-search').on('input', _refreshModulePicker);

    $p.on('click', '.csmpi-row', function() {
        const text = $(this).data('text');
        const rank = parseInt($(this).data('rank')) || 1;
        if (!_mpickTarget) return;
        const { $input, $rank } = _mpickTarget;
        $input.val(text).trigger('input');
        if ($rank.length) $rank.val(rank).trigger('change');
        _closeModulePicker();
    });

    $('body').append($p);
}

function _openModulePicker(tagKey, $input, $rank) {
    _buildModulePicker();
    _mpickTarget = { $input, $rank };

    // Set context label
    const tagLabels = {
        onHit: 'On Hit', onClashWin: 'On Clash Win', onClashLose: 'On Clash Lose',
        onCrit: 'Crit', onCheck: 'Check', onEvade: 'On Evade',
        onUse: 'On Use', afterUse: 'After Use', onKill: 'On Kill',
        onStagger: 'On Stagger', eminence: 'Eminence', exhaust: 'Exhaust',
        proactive: 'Proactive', reactive: 'Reactive',
    };
    const label = tagLabels[tagKey] || tagKey;
    $('#csmpi-context').text(`Showing modules for [${label}] slot — click any option to fill`);
    $('#csmpi-context').attr('data-tagkey', tagKey);

    // Reset filters
    $('#csmpi-search').val('');
    $('.csmpi-rtab').removeClass('active');
    $('.csmpi-rtab[data-rank="0"]').addClass('active');

    _refreshModulePicker();
    $(`#${_CS_MPICK_ID}`).show();
}

function _closeModulePicker() {
    $(`#${_CS_MPICK_ID}`).hide();
    _mpickTarget = null;
}

function _refreshModulePicker() {
    const tagKey     = $('#csmpi-context').attr('data-tagkey') || '';
    const search     = ($('#csmpi-search').val() || '').toLowerCase();
    const rankFilter = parseInt($('.csmpi-rtab.active').data('rank')) || 0;
    const $list      = $('#csmpi-list').empty();

    const RANK_COLOR = { 1: '#7eb8d4', 2: '#c49ae8', 3: '#f0ad4e' };
    const RANK_LABEL = { 1: 'Rank 1', 2: 'Rank 2', 3: 'Rank 3' };
    const TAG_SHORT  = {
        onHit:'On Hit', onClashWin:'Clash Win', onClashLose:'Clash Lose',
        onCrit:'Crit', onCheck:'Check', onEvade:'Evade',
        onUse:'On Use', afterUse:'After Use', onKill:'On Kill',
        onStagger:'Stagger', eminence:'Eminence',
        exhaust:'Exhaust', proactive:'Proactive', reactive:'Reactive',
    };

    // Collect visible rows grouped by rank
    const byRank = { 1: [], 2: [], 3: [] };

    for (const mod of MODULE_CATALOG) {
        if (rankFilter && mod.rank !== rankFilter) continue;
        const opts = tagKey ? mod.options.filter(o => o.tag === tagKey) : mod.options;
        if (!opts.length) continue;
        if (search) {
            const nameMatch = mod.name.toLowerCase().includes(search);
            const optMatch  = opts.some(o =>
                o.label.toLowerCase().includes(search) ||
                o.text.toLowerCase().includes(search)
            );
            if (!nameMatch && !optMatch) continue;
        }
        for (const opt of opts) {
            byRank[mod.rank].push({ mod, opt });
        }
    }

    let total = 0;
    const ranks = rankFilter ? [rankFilter] : [1, 2, 3];

    for (const rank of ranks) {
        const rows = byRank[rank];
        if (!rows.length) continue;

        const clr = RANK_COLOR[rank];

        // Section header
        if (!rankFilter) {
            $list.append(
                `<div class="csmpi-rank-hdr" style="color:${clr};border-color:${clr}33;">${RANK_LABEL[rank]}</div>`
            );
        }

        // Build group of consecutive rows (so border-radius can be handled via CSS)
        const groupEl = $('<div style="display:flex;flex-direction:column;margin-bottom:8px;"></div>');

        rows.forEach(({ mod, opt }, i) => {
            const repHTML = mod.repeating ? `<span class="csmpi-row-rep">↻ Repeating</span>` : '';
            const tagPill = !tagKey
                ? `<span class="csmpi-tag-pill">${TAG_SHORT[opt.tag] || opt.tag}</span>`
                : '';

            const isFirst = i === 0;
            const isLast  = i === rows.length - 1;
            const radius  = isFirst && isLast ? '6px'
                          : isFirst           ? '6px 6px 0 0'
                          : isLast            ? '0 0 6px 6px'
                          : '0';
            const borderB = isLast ? '1px solid #28284a' : '1px solid #1e1e3a';

            groupEl.append(`
<div class="csmpi-row"
     data-text="${_esc(opt.text)}"
     data-rank="${mod.rank}"
     title="${_esc(opt.text)}"
     style="border-radius:${radius};border-bottom:${borderB};">
    <div class="csmpi-row-stripe" style="background:${clr};border-radius:${isFirst ? '5px' : '0'} 0 0 ${isLast ? '5px' : '0'};"></div>
    <div class="csmpi-row-body">
        <div class="csmpi-row-name">${_esc(mod.name)}${repHTML}</div>
        <div class="csmpi-row-label">${tagPill}${_esc(opt.label)}</div>
    </div>
    <div class="csmpi-row-badge" style="color:${clr};background:${clr}12;border-color:${clr}25;border-radius:0 ${isFirst ? '5px' : '0'} ${isLast ? '5px' : '0'} 0;">R${mod.rank}</div>
</div>`);
            total++;
        });

        $list.append(groupEl);
    }

    if (!total) {
        $list.html('<div class="csmpi-empty">No modules match.<br>Try a different rank filter or clear the search.</div>');
    }
}

// ============================================================================
// PLAYER MODE — HTML
// ============================================================================

function _buildPlayerHTML() {
    const equipped    = _equippedRegular();
    const equippedEGO = _equippedEGO();
    const maxDeck     = extensionSettings.statSheet.maxEquippedPages || MAX_REGULAR_DECK;

    const deckSlots = [];
    for (let i = 0; i < maxDeck; i++) {
        const sk = equipped[i];
        deckSlots.push(sk
            ? _playerCard(sk, false)
            : `<div class="cs-deck-slot cs-slot-empty"><span class="cs-empty-slot-label">Empty</span></div>`
        );
    }

    const egoSlots = EGO_TIERS.map(t => {
        const sk = equippedEGO.find(s => s.egoTier === t.key);
        if (sk) return _playerCard(sk, true);
        return `<div class="cs-ego-slot cs-slot-empty" data-tier="${t.key}">
            <div class="cs-ego-slot-tier" style="color:${EGO_TIER_COLORS[t.key]}">${t.key}</div>
            <div class="cs-ego-slot-cost">${t.sanityCost}<small>SP</small></div>
        </div>`;
    }).join('');

    const availRegular = _allSkills().filter(s => !s.equipped && !s.isEGO);
    const availEGO     = _allSkills().filter(s => !s.equipped &&  s.isEGO);

    const availRegHTML = availRegular.length
        ? availRegular.map(s => _availRow(s)).join('')
        : '<div class="cs-empty-state">No skills available — add some in Master Mode.</div>';

    const availEGOHTML = availEGO.length
        ? availEGO.map(s => _availRow(s)).join('')
        : '<div class="cs-empty-state">No E.G.O skills available.</div>';

    return `
<div class="cs-tab cs-player">
    <div class="cs-mode-bar">
        <span class="cs-mode-label">⚔️ Combat Skills</span>
        ${buildPromptIncludeToggle('combatSkills', 'Combat')}
        <button class="cs-pool-btn cs-btn">📦 Skill Pool</button>
        <button class="cs-toggle-btn">⚙ Master Mode</button>
    </div>
    <section class="cs-section">
        <div class="cs-section-hdr">
            <span class="cs-section-title">Equipped Deck</span>
            <span class="cs-count-badge">${equipped.length} / ${maxDeck}</span>
        </div>
        <div class="cs-deck-grid">${deckSlots.join('')}</div>
    </section>
    <section class="cs-section">
        <div class="cs-section-hdr">
            <span class="cs-section-title">👁 E.G.O</span>
            <span class="cs-count-badge">${equippedEGO.length} / 5</span>
        </div>
        <div class="cs-ego-row">${egoSlots}</div>
    </section>
    <section class="cs-section">
        <div class="cs-section-hdr"><span class="cs-section-title">Available Skills</span></div>
        <div class="cs-avail-list">${availRegHTML}</div>
    </section>
    <section class="cs-section">
        <div class="cs-section-hdr"><span class="cs-section-title">Available E.G.O</span></div>
        <div class="cs-avail-list">${availEGOHTML}</div>
    </section>
</div>`;
}

function _playerCard(skill, isEGO) {
    const tierBadge   = isEGO ? _tierBadge(skill.egoTier) : '';
    const uniqueBadge = skill.isUnique ? '<span class="cs-unique-badge">UNIQUE</span>' : '';
    const egoStyle    = isEGO ? `style="border-top-color:${EGO_TIER_COLORS[skill.egoTier] || '#aaa'}"` : '';
    const powerBadge  = _powerTierBadge(skill);

    return `
<div class="cs-equipped-card ${isEGO ? 'cs-ego-card' : ''}" data-skill-id="${_esc(skill.id)}" ${egoStyle}>
    <div class="cs-card-hdr">
        ${_costPips(skill.cost)} ${tierBadge} ${uniqueBadge} ${_limitBadge(skill)} ${powerBadge}
    </div>
    <div class="cs-card-name">${_esc(skill.name || 'Unnamed')}</div>
    <div class="cs-card-dice">${_diceChips(skill.dice)}</div>
    <div class="cs-card-actions">
        <button class="cs-btn cs-btn-sm cs-btn-roll-skill" data-skill-id="${_esc(skill.id)}" title="Roll this skill's dice">🎲</button>
        <button class="cs-btn cs-btn-sm cs-btn-detail"     data-skill-id="${_esc(skill.id)}">Detail</button>
        <button class="cs-btn cs-btn-sm cs-btn-unequip"    data-skill-id="${_esc(skill.id)}">Unequip</button>
    </div>
</div>`;
}

function _availRow(skill) {
    const tierBadge  = skill.isEGO ? _tierBadge(skill.egoTier) : '';
    const spCost     = skill.isEGO ? `<span class="cs-sp-cost">${_sanityCost(skill.egoTier)} SP</span>` : '';
    const powerBadge = _powerTierBadge(skill);
    return `
<div class="cs-avail-row" data-skill-id="${_esc(skill.id)}">
    <div class="cs-avail-left">
        ${_costPips(skill.cost)}
        <span class="cs-avail-name">${_esc(skill.name || 'Unnamed')}</span>
        ${tierBadge}
        ${skill.isUnique ? '<span class="cs-unique-badge">UNIQUE</span>' : ''}
        ${_limitBadge(skill)}
        ${powerBadge}
        ${spCost}
    </div>
    <div class="cs-avail-dice">${_diceChips(skill.dice)}</div>
    <div class="cs-avail-actions">
        <button class="cs-btn cs-btn-sm cs-btn-roll-skill" data-skill-id="${_esc(skill.id)}" title="Roll this skill's dice">🎲</button>
        <button class="cs-btn cs-btn-sm cs-btn-detail"     data-skill-id="${_esc(skill.id)}">Detail</button>
        <button class="cs-btn cs-btn-sm cs-btn-equip"      data-skill-id="${_esc(skill.id)}">Equip</button>
    </div>
</div>`;
}

// ============================================================================
// MASTER MODE — HTML
// ============================================================================

function _buildMasterHTML() {
    const all       = _allSkills();
    const cardsHTML = all.length
        ? all.map(s => _masterCard(s)).join('')
        : '<div class="cs-empty-state">No combat skills yet. Click "+ Add Skill" or "+ Add E.G.O" to start.</div>';

    return `
<div class="cs-tab cs-master">
    <div class="cs-mode-bar">
        <span class="cs-mode-label">⚙ Master Mode</span>
        ${buildPromptIncludeToggle('combatSkills', 'Combat')}
        <button class="cs-pool-btn cs-btn">📦 Skill Pool</button>
        <button class="cs-toggle-btn">👤 Player Mode</button>
    </div>
    <div class="cs-master-toolbar">
        <button class="cs-btn cs-btn-primary cs-add-skill-btn">+ Add Skill</button>
        <button class="cs-btn cs-btn-ego   cs-add-ego-btn">+ Add E.G.O</button>
    </div>
    <div class="cs-master-list">${cardsHTML}</div>
</div>`;
}

// ============================================================================
// MODULE SYSTEM  (Session 10)
// ============================================================================

const _MOD_RANK_COLORS = { 1: '#7eb8d4', 2: '#c49ae8', 3: '#f0ad4e' };

// All die-level and skill-level tag keys that consume module slots
const _MODULE_DIE_TAG_KEYS   = ['onHit','onClashWin','onClashLose','onCrit','onCheck','onEvade'];
const _MODULE_SKILL_TAG_KEYS = ['onUse','afterUse','onKill','onStagger','eminence','exhaust','proactive','reactive'];
// limitUses is NOT a module slot — it's a mechanical counter

/**
 * Count all filled tag slots across all skills, grouped by rank.
 */
function _countFilledTagSlots(ss) {
    const counts = { r1: 0, r2: 0, r3: 0 };
    for (const skill of (ss.combatSkills || [])) {
        for (const die of (skill.dice || [])) {
            for (const key of _MODULE_DIE_TAG_KEYS) {
                const tag = die[key];
                if (tag && typeof tag === 'object' && (tag.text !== undefined)) {
                    const r = Math.max(1, Math.min(3, tag.rank || 1));
                    counts[`r${r}`]++;
                }
            }
        }
        for (const key of _MODULE_SKILL_TAG_KEYS) {
            const tag = skill[key];
            if (tag && typeof tag === 'object' && (tag.text !== undefined)) {
                const r = Math.max(1, Math.min(3, tag.rank || 1));
                counts[`r${r}`]++;
            }
        }
    }
    return counts;
}

/**
 * Compute the total innate module allowance across all skills.
 * Regular (non-unique) skills: 3×R1 + 1×R2 free.
 * Unique skills: 0 innate (all slots cost spare pool).
 * INT-10 designated unique: 2×R1 + 2×R2 extra innate.
 * EGO skills: treated as regular (3×R1 + 1×R2).
 */
function _getInnateAllowance(ss) {
    const designatedId = ss.modulesPool?.uniqueSkillAsBaseId || '';
    let r1 = 0, r2 = 0;
    for (const skill of (ss.combatSkills || [])) {
        const isUnique     = !!skill.isUnique;
        const isDesignated = skill.id === designatedId;
        if (!isUnique) {
            r1 += 3;
            r2 += 1;
        }
        if (isDesignated) {
            // INT-10 grant: +2R1 +2R2 on top of any base innate
            r1 += 2;
            r2 += 2;
        }
    }
    return { r1, r2, r3: 0 };
}

/**
 * Read the current module pool state: total spare slots, how many are used,
 * and how many remain free.
 *
 * "used spare" = max(0, filled tags of rank N - innate allowance for rank N)
 *
 * @param {object} ss  extensionSettings.statSheet
 * @returns {{ total, used, free, designatedUniqueId }}
 */
function _getModulePool(ss) {
    const pool   = ss.modulesPool || {};
    const intId  = pool.intAttributeId || '';
    const manual = pool.manualBonus || { r1: 0, r2: 0, r3: 0 };

    // Resolve INT value
    let intValue = 0;
    const attr = (ss.attributes || []).find(a => a.id === intId && a.enabled);
    if (attr) {
        if (ss.mode === 'numeric') {
            intValue = attr.value ?? 0;
        } else {
            const gvm     = ss.editorSettings?.gradeValueMap    || {};
            const divisor = ss.editorSettings?.attrValueDivisor || 100;
            intValue = (gvm[attr.rank] ?? 0) + Math.floor((attr.rankValue ?? 0) / divisor);
        }
    }

    // INT grants (cumulative) — mirrors augmentsTab.js INT_MODULE_GRANTS
    const INT_GRANTS = [
        [0,0,0], [2,0,0], [3,0,0], [4,0,0], [4,1,0],
        [4,2,0], [4,3,0], [4,4,0], [4,4,1], [4,4,2], [4,4,2],
    ];
    const clamped = Math.max(0, Math.min(10, Math.floor(intValue)));
    const g = INT_GRANTS[clamped];

    // Total spare slots available = INT grant + manual bonus
    const total = {
        r1: g[0] + (manual.r1 || 0),
        r2: g[1] + (manual.r2 || 0),
        r3: g[2] + (manual.r3 || 0),
    };

    // Count filled tags and innate allowance
    const filled  = _countFilledTagSlots(ss);
    const innate  = _getInnateAllowance(ss);

    // Spare used = how many filled tags exceed the free innate budget
    const usedSpare = {
        r1: Math.max(0, filled.r1 - innate.r1),
        r2: Math.max(0, filled.r2 - innate.r2),
        r3: Math.max(0, filled.r3 - innate.r3),
    };

    const free = {
        r1: total.r1 - usedSpare.r1,
        r2: total.r2 - usedSpare.r2,
        r3: total.r3 - usedSpare.r3,
    };

    return { total, used: usedSpare, free, designatedUniqueId: pool.uniqueSkillAsBaseId || '' };
}

/**
 * Build a compact module-pool status badge for use inside a skill card header.
 * Shows per-rank free counts from the global spare pool.
 */
function _modulePoolStatus(ss) {
    const pool = _getModulePool(ss);
    const parts = [1, 2, 3].map(r => {
        const key = `r${r}`;
        const f   = pool.free[key];
        const clr = f < 0 ? '#ff4f4f' : f === 0 ? '#6a6a8a' : _MOD_RANK_COLORS[r];
        return `<span style="color:${clr};">R${r} ${f}</span>`;
    }).join(' · ');
    return `<span class="cs-mod-free-counter" style="font-size:.76rem;color:#8888aa;">Pool free: ${parts}</span>`;
}

function _masterCard(skill) {
    const isEGO    = !!skill.isEGO;
    const tier     = skill.egoTier || 'ZAYIN';
    const tierClr  = EGO_TIER_COLORS[tier] || '#aaa';
    const egoStyle = isEGO ? `style="border-left:3px solid ${tierClr}"` : '';

    const diceHTML = (skill.dice || []).map((d, i) => _dieEditor(skill.id, d, i)).join('');

    // Render existing skill-level tag rows
    const existingTagsHTML = SKILL_TAG_DEFS
        .filter(t => skill[t.key] !== undefined && skill[t.key] !== null)
        .map(t  => _skillTagRow(skill.id, t, skill[t.key]))
        .join('');

    const egoFields = isEGO ? `
    <div class="cs-field-row">
        <label class="cs-label">E.G.O Tier</label>
        <select class="cs-ego-tier-select" data-skill-id="${_esc(skill.id)}">
            ${EGO_TIERS.map(t =>
                `<option value="${t.key}" ${tier === t.key ? 'selected' : ''}>
                    ${t.key} — ${t.sanityCost} Sanity
                </option>`
            ).join('')}
        </select>
    </div>` : '';

    return `
<div class="cs-master-card ${isEGO ? 'cs-mc-ego' : ''}" data-skill-id="${_esc(skill.id)}" ${egoStyle}>

    <div class="cs-mc-header">
        <div class="cs-mc-title">
            ${isEGO ? _tierBadge(tier) : ''}
            ${skill.isUnique ? '<span class="cs-unique-badge">UNIQUE</span>' : ''}
            <span class="cs-mc-name">${_esc(skill.name || 'Unnamed')}</span>
            ${_costPips(skill.cost)}
            ${_limitBadge(skill)}
            ${skill.equipped ? '<span class="cs-equipped-badge">EQUIPPED</span>' : ''}
        </div>
        <div class="cs-mc-actions">
            <button class="cs-btn cs-btn-sm ${skill.equipped ? 'cs-btn-unequip' : 'cs-btn-equip'}"
                data-skill-id="${_esc(skill.id)}">${skill.equipped ? 'Unequip' : 'Equip'}</button>
            <button class="cs-btn cs-btn-sm cs-btn-roll-skill" data-skill-id="${_esc(skill.id)}" title="Roll this skill's dice">🎲</button>
            <button class="cs-btn cs-btn-sm cs-btn-duplicate" data-skill-id="${_esc(skill.id)}" title="Duplicate">⧉</button>
            <button class="cs-btn cs-btn-sm cs-btn-delete"    data-skill-id="${_esc(skill.id)}" title="Delete">🗑</button>
            <button class="cs-btn cs-btn-sm cs-btn-collapse"  data-skill-id="${_esc(skill.id)}">${_collapsedCards.has(skill.id) ? '▸' : '▾'}</button>
        </div>
    </div>

    <div class="cs-mc-body ${_collapsedCards.has(skill.id) ? 'cs-collapsed' : ''}" data-body="${_esc(skill.id)}">

        <div class="cs-field-row">
            <label class="cs-label">Name</label>
            <input class="cs-input cs-name-input" type="text"
                value="${_esc(skill.name || '')}"
                data-skill-id="${_esc(skill.id)}"
                placeholder="Skill name…" />
        </div>

        <div class="cs-field-row cs-field-inline">
            <div class="cs-field-group">
                <label class="cs-label">Light Cost</label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <input type="number" class="cs-input cs-cost-input" data-skill-id="${_esc(skill.id)}"
                           value="${skill.cost || 0}" min="0" max="99" step="1"
                           style="width:60px;text-align:center;${(skill.cost || 0) < _computeCostFloor(skill).floor ? 'border-color:#ff4f4f;' : ''}">
                    ${(() => {
                        const { floor, breakdown } = _computeCostFloor(skill);
                        const belowFloor = (skill.cost || 0) < floor;
                        const tip = breakdown.map((b, i) =>
                            `Die ${i+1}: type=${b.layer1} val=${b.layer2>=0?'+':''}${b.layer2} mult=${b.layer3>=0?'+':''}${b.layer3} = ${b.dieCost}`
                        ).join('&#10;') + `&#10;Total: ${floor}`;
                        return `<span class="cs-cost-floor-badge ${belowFloor ? 'cs-cost-floor-warn' : ''}"
                                      data-floor-badge="${_esc(skill.id)}"
                                      title="${tip}">
                                    Floor: ${floor}
                                </span>`;
                    })()}
                </div>
            </div>
            <div class="cs-field-group">
                <label class="cs-label">Unique Skill</label>
                <label class="cs-toggle-wrap">
                    <input type="checkbox" class="cs-unique-chk" data-skill-id="${_esc(skill.id)}"
                        ${skill.isUnique ? 'checked' : ''} />
                    <span class="cs-toggle-knob"></span>
                </label>
            </div>
            <div class="cs-field-group">
                <label class="cs-label">E.G.O</label>
                <label class="cs-toggle-wrap">
                    <input type="checkbox" class="cs-ego-chk" data-skill-id="${_esc(skill.id)}"
                        ${isEGO ? 'checked' : ''} />
                    <span class="cs-toggle-knob"></span>
                </label>
            </div>
        </div>

        ${egoFields}

        <div class="cs-subsection">
            <div class="cs-subsection-hdr"><span>🏷 Skill Tags</span></div>
            <div class="cs-skill-tags-list" data-tags-list="${_esc(skill.id)}">
                ${existingTagsHTML || ''}
            </div>
            ${_skillTagAddRowHTML(skill.id, skill)}
        </div>

        <div class="cs-subsection">
            <div class="cs-subsection-hdr">
                <span>⚂ Dice Sequence</span>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${_modulePoolStatus(extensionSettings.statSheet)}
                    <button class="cs-btn cs-btn-sm cs-add-die-btn" data-skill-id="${_esc(skill.id)}">+ Add Die</button>
                </div>
            </div>
            <div class="cs-dice-list" data-dice-list="${_esc(skill.id)}">
                ${diceHTML || '<div class="cs-empty-state cs-empty-sm">No dice — click "+ Add Die"</div>'}
            </div>
        </div>

        <div class="cs-subsection">
            <div class="cs-subsection-hdr"><span>📝 Notes / Flavor</span></div>
            <textarea class="cs-textarea cs-notes-ta"
                data-skill-id="${_esc(skill.id)}"
                rows="2"
                placeholder="Flavor text, GM notes…">${_esc(skill.notes || '')}</textarea>
        </div>

    </div></div>`;
}

// ============================================================================
// DIE MODIFIER EDITOR HELPER
// ============================================================================

/**
 * Build the modifier sub-UI for one die.
 * Replaces the old flat "Base +" number input.
 * type=flat    -> shows a number input
 * type=attribute -> shows attribute dropdown + multiplier + round-down
 * type=skill   -> shows skill dropdown + multiplier + round-down
 */
function _modEditorHTML(skillId, die) {
    const mod  = die.modifier ?? { type: 'flat', flatValue: die.basePower ?? 0, targetId: '', multiplier: 1, roundDown: false };
    const type = mod.type || 'flat';
    const ss   = extensionSettings.statSheet;

    // Build attribute options
    const attrs = (ss?.attributes || []).filter(a => a.enabled);
    const attrOpts = attrs.length
        ? attrs.map(a => `<option value="${a.id}" ${mod.targetId === a.id ? 'selected' : ''} >${_esc(a.name)}</option>`).join('')
        : '<option value="">None</option>';

    // Build skill options (flattened from all attributes)
    const skillOpts = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled)
            .map(s => `<option value="${s.id}" ${mod.targetId === s.id ? 'selected' : ''} >${_esc(s.name)} (${_esc(a.name)})</option>`)
    ).join('');

    // Build sub-skill options (attr › skill › subSkill)
    const subSkillOpts = attrs.flatMap(a =>
        (a.skills || []).filter(s => s.enabled).flatMap(s =>
            (s.subSkills || []).filter(sub => sub.enabled)
                .map(sub => `<option value="${sub.id}" ${mod.targetId === sub.id ? 'selected' : ''}>${_esc(sub.name)} (${_esc(a.name)} › ${_esc(s.name)})</option>`)
        )
    ).join('');

    // Build saving throw options
    const savingThrows = (ss?.savingThrows || []).filter(st => st.enabled);
    const stOpts = savingThrows.length
        ? savingThrows.map(st => `<option value="${st.id}" ${mod.targetId === st.id ? 'selected' : ''} >${_esc(st.name)}</option>`).join('')
        : '<option value="">No saving throws</option>';

    const isMult = type !== 'flat';
    const mult   = mod.multiplier ?? 1;

    return `
        <select class="cs-input cs-die-mod-type"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Modifier type">
            <option value="flat"         ${type === 'flat'         ? 'selected' : ''}>+Flat</option>
            <option value="attribute"    ${type === 'attribute'    ? 'selected' : ''}>+Attr</option>
            <option value="skill"        ${type === 'skill'        ? 'selected' : ''}>+Skill</option>
            <option value="subskill"     ${type === 'subskill'     ? 'selected' : ''}>+SubSkill</option>
            <option value="saving_throw" ${type === 'saving_throw' ? 'selected' : ''}>+Save</option>
        </select>
        <input type="number"
            class="cs-input cs-die-mod-flat"
            value="${mod.flatValue ?? 0}" min="-99" max="99" step="1"
            style="${type !== 'flat' ? 'display:none' : ''}"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Flat bonus" />
        <select class="cs-input cs-die-mod-target-attr"
            style="${type !== 'attribute' ? 'display:none' : ''}"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Attribute">${attrOpts}</select>
        <select class="cs-input cs-die-mod-target-skill"
            style="${type !== 'skill' ? 'display:none' : ''}"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Skill">${skillOpts || '<option value="">No skills</option>'}</select>
        <select class="cs-input cs-die-mod-target-st"
            style="${type !== 'saving_throw' ? 'display:none' : ''}"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Saving Throw">${stOpts}</select>
        <select class="cs-input cs-die-mod-target-subskill"
            style="${type !== 'subskill' ? 'display:none' : ''}"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
            title="Sub-Skill (scales as Attr + Sub-Skill)">${subSkillOpts || '<option value="">No sub-skills</option>'}</select>
        <span class="cs-die-mod-dyn" style="${!isMult ? 'display:none' : 'display:inline-flex'};align-items:center;gap:4px;">
            <input type="number"
                class="cs-input cs-die-mod-mult"
                value="${mult}" min="0.25" max="10" step="0.25"
                style="width:68px"
                data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}"
                title="Multiplier (e.g. 0.5 = half value)" />
            <label style="display:inline-flex;align-items:center;gap:3px;font-size:12px;color:rgba(200,205,215,0.8);cursor:pointer;" title="Round down">
                <input type="checkbox"
                    class="cs-die-mod-round"
                    ${mod.roundDown ? 'checked' : ''}
                    data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}" />
                ↓
            </label>
        </span>`;
}

// ============================================================================
// DIE EDITOR
// ============================================================================

function _dieEditor(skillId, die, idx) {
    const chipCls = _dieClass(die.diceType);

    const effectRowsHTML = DIE_EFFECT_DEFS
        .filter(e => (e.filter === null || e.filter(die)) && die[e.key] !== undefined && die[e.key] !== null)
        .map(e  => _dieEffectRow(skillId, die.id, e, die[e.key]))
        .join('');

    return `
<div class="cs-die-editor" data-die-id="${_esc(die.id)}" data-skill-id="${_esc(skillId)}">

    <div class="cs-die-hdr">
        <span class="cs-die-idx">
            <span class="cs-die-chip ${chipCls}">Die ${idx + 1}</span>
        </span>
        <div class="cs-die-controls">
            <select class="cs-die-type" data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}">
                ${DICE_TYPES.map(t =>
                    `<option value="${t}" ${(die.diceType || 'Slash') === t ? 'selected' : ''}>${t}</option>`
                ).join('')}
            </select>
            <select class="cs-die-sides" data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}">
                ${DICE_SIDES.map(s =>
                    `<option value="${s}" ${(die.sides || 6) === s ? 'selected' : ''}>d${s}</option>`
                ).join('')}
            </select>
            <div class="cs-die-mod-wrap">
                ${_modEditorHTML(skillId, die)}
            </div>
        </div>
        <button class="cs-btn cs-btn-icon cs-remove-die-btn"
            data-skill-id="${_esc(skillId)}" data-die-id="${_esc(die.id)}" title="Remove die">✕</button>
    </div>

    <div class="cs-die-effects-list">
        ${effectRowsHTML}
    </div>

    ${_dieAddEffectsRowHTML(skillId, die.id, die)}

</div>`;
}

// ============================================================================
// DETAIL POPUP
// ============================================================================

function _showDetail(skillId) {
    const skill = _allSkills().find(s => s.id === skillId);
    if (!skill) return;

    const isEGO = !!skill.isEGO;

    // Skill tag summary lines
    const tagLines = SKILL_TAG_DEFS
        .filter(t => skill[t.key] !== undefined && skill[t.key] !== null)
        .map(t => {
            const raw = skill[t.key];
            const val = t.inputType === 'number'
                ? `${typeof raw === 'number' ? raw : (raw?.text ?? '?')} uses`
                : _esc(String(typeof raw === 'object' ? (raw?.text ?? '') : raw));
            const rankBadge = (t.inputType !== 'number' && raw && typeof raw === 'object' && raw.rank)
                ? `<span style="font-size:.68rem;color:${_MOD_RANK_COLORS[raw.rank] || '#aaa'};margin-left:3px;">R${raw.rank}</span>`
                : '';
            return `<div class="cs-detail-tag-line">
                <span class="cs-stag-pill ${t.cls}">${t.label}</span>
                ${rankBadge}
                <span class="cs-detail-tag-text">${val}</span>
            </div>`;
        }).join('');

    const diceHTML = (skill.dice || []).length
        ? (skill.dice || []).map(d => {
            const _dmod = d.modifier ?? { type: 'flat', flatValue: d.basePower ?? 0 };
            const pw  = _modifierLabel(_dmod, true);
            const cls = _dieClass(d.diceType);

            const effectsHTML = DIE_EFFECT_DEFS
                .filter(e => (e.filter === null || e.filter(d)) && d[e.key])
                .map(e => {
                    const raw  = d[e.key];
                    const text = typeof raw === 'object' ? (raw?.text ?? '') : String(raw ?? '');
                    const rank = (raw && typeof raw === 'object') ? raw.rank : null;
                    const rankBadge = rank
                        ? `<span style="font-size:.68rem;color:${_MOD_RANK_COLORS[rank] || '#aaa'};margin:0 3px;">R${rank}</span>`
                        : '';
                    return `
                    <div class="cs-detail-effect">
                        <span class="cs-effect-tag ${e.cls}">${e.label}</span>
                        ${rankBadge}
                        <span class="cs-detail-effect-text">${_esc(text)}</span>
                    </div>`;
                })
                .join('');

            return `
<div class="cs-detail-die">
    <div class="cs-detail-die-header">
        <span class="cs-die-chip ${cls}">${_esc(d.diceType)} 1d${d.sides || 6}${pw}</span>
    </div>
    ${effectsHTML ? `<div class="cs-detail-effects-block">${effectsHTML}</div>` : ''}
</div>`;
        }).join('')
        : '<em class="cs-muted">No dice</em>';

    const notesHTML = skill.notes
        ? `<div class="cs-detail-block">
               <div class="cs-detail-section-lbl">Notes</div>
               <div class="cs-detail-text cs-muted">${_esc(skill.notes).replace(/\n/g, '<br>')}</div>
           </div>`
        : '';

    const egoStyle = isEGO
        ? `style="border-top:3px solid ${EGO_TIER_COLORS[skill.egoTier] || '#aaa'}"`
        : '';

    const $popup = $(`
<div class="cs-detail-overlay">
    <div class="cs-detail-popup" ${egoStyle}>
        <div class="cs-detail-hdr">
            <div class="cs-detail-title">
                <span class="cs-detail-name">${_esc(skill.name || 'Unnamed')}</span>
                ${isEGO ? _tierBadge(skill.egoTier) : ''}
                ${skill.isUnique ? '<span class="cs-unique-badge">UNIQUE</span>' : ''}
                ${_costPips(skill.cost)}
                ${_limitBadge(skill)}
                ${_powerTierBadge(skill)}
                ${isEGO ? `<span class="cs-sp-cost">${_sanityCost(skill.egoTier)} SP</span>` : ''}
            </div>
            <button class="cs-detail-close">✕</button>
        </div>
        <div class="cs-detail-body">
            ${tagLines ? `<div class="cs-detail-block cs-detail-tags-block">${tagLines}</div>` : ''}
            <div class="cs-detail-block">
                <div class="cs-detail-section-lbl">Dice Sequence</div>
                ${diceHTML}
            </div>
            ${notesHTML}
        </div>
        <div class="cs-detail-footer" style="padding:10px 16px;border-top:1px solid #2a2a42;display:flex;justify-content:flex-end;">
            <button class="cs-save-template-btn cs-btn cs-btn-sm"
                    data-skill-id="${_esc(skill.id)}"
                    title="Save this skill as a reusable template in the Skill Pool">
                💾 Save as Template
            </button>
        </div>
    </div>
</div>`);

    $popup.find('.cs-detail-close').on('click', () => $popup.remove());
    $popup.on('click', e => { if ($(e.target).hasClass('cs-detail-overlay')) $popup.remove(); });

    $popup.find('.cs-save-template-btn').on('click', function() {
        const skillId = $(this).data('skill-id');
        const sk      = _allSkills().find(s => s.id === skillId);
        if (!sk) return;
        const ss = extensionSettings.statSheet;
        if (!ss.combatSkillTemplates) ss.combatSkillTemplates = [];
        if (ss.combatSkillTemplates.some(t => t.name === sk.name)) {
            showNotification(`A template named "${sk.name}" already exists.`, 'error');
            return;
        }
        ss.combatSkillTemplates.push({
            _templateId:   generateUniqueId(),
            category:      'Custom',
            attributeRole: 'Custom',
            name:          sk.name,
            cost:          sk.cost ?? 1,
            description:   sk.notes || '',
            diceTemplate:  (sk.dice || []).map(d => ({
                diceType:   d.diceType,
                sides:      d.sides,
                multiplier: d.modifier?.multiplier ?? 1,
                roundDown:  d.modifier?.roundDown  ?? false,
            })),
        });
        saveStatSheetData();
        showNotification(`"${sk.name}" saved to My Templates.`, 'success');
    });

    $('body').append($popup);
}


// ============================================================================
// SKILL MODULE POOL PANEL  (Session 10)
// ============================================================================

const _CS_POOL_CSS_ID = 'rpg-cs-pool-styles';
let _csPoolActiveTab  = 'library';

function _injectCsPoolStyles() {
    if (document.getElementById(_CS_POOL_CSS_ID)) return;
    const s = document.createElement('style');
    s.id = _CS_POOL_CSS_ID;
    s.textContent = `
        #cs-pool-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.72);
            z-index: 99996;
            display: flex; align-items: flex-start; justify-content: flex-end;
        }
        #cs-pool-panel {
            width: min(460px, 97vw);
            height: 100vh;
            background: #14142a;
            border-left: 1px solid #3a3a5a;
            display: flex; flex-direction: column;
            animation: cs-pool-in .2s ease;
            overflow: hidden;
        }
        @keyframes cs-pool-in {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
        }
        #cs-pool-panel .csp-header {
            display: flex; align-items: center; gap: 10px;
            padding: 16px 18px 14px;
            border-bottom: 1px solid #2a2a42;
        }
        #cs-pool-panel .csp-header h3 { flex: 1; margin: 0; font-size: 1rem; color: #e0e0f0; }
        #cs-pool-panel .csp-close {
            background: none; border: none; color: #888; font-size: 1.3rem;
            cursor: pointer; padding: 2px 6px; line-height: 1;
        }
        #cs-pool-panel .csp-close:hover { color: #e0e0f0; }
        #cs-pool-panel .csp-tabs { display: flex; border-bottom: 1px solid #2a2a42; }
        #cs-pool-panel .csp-tab-btn {
            flex: 1; padding: 9px 0; background: none; border: none;
            color: #6a6a8a; font-size: .88rem; cursor: pointer;
            border-bottom: 2px solid transparent; transition: color .15s;
        }
        #cs-pool-panel .csp-tab-btn.active { color: #7ec8e3; border-bottom-color: #7ec8e3; }
        #cs-pool-panel .csp-search { padding: 10px 18px 8px; }
        #cs-pool-panel .csp-search input {
            width: 100%; box-sizing: border-box;
            background: #1e1e38; border: 1px solid #3a3a5a;
            border-radius: 6px; color: #d0d0e8; padding: 6px 10px; font-size: .88rem;
        }
        #cs-pool-panel .csp-list {
            flex: 1; overflow-y: auto; padding: 8px 18px 16px;
            display: flex; flex-direction: column; gap: 10px;
        }
        .cs-pool-card {
            background: #1e1e38; border: 1px solid #2e2e52;
            border-radius: 9px; padding: 12px 14px;
        }
        .cs-pool-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
        .cs-pool-card-name { font-weight: 600; font-size: .95rem; color: #e0e0f0; }
        .cs-pool-card-cat {
            font-size: .72rem; background: #2a2a48; border-radius: 4px;
            padding: 1px 7px; color: #8888aa;
        }
        .cs-pool-card-role {
            font-size: .72rem; color: #7ec8e3;
            border: 1px solid #3a5a7a; border-radius: 4px; padding: 1px 6px;
            margin-left: auto;
        }
        .cs-pool-card-cost { font-size: .8rem; color: #9a9aaa; }
        .cs-pool-card-desc { font-size: .8rem; color: #8888aa; margin: 4px 0 8px; }
        .cs-pool-dice-preview {
            display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;
        }
        .cs-pool-dice-chip {
            font-size: .72rem; background: #2a2a48;
            border-radius: 4px; padding: 2px 7px; color: #c0c0e0;
        }
        .cs-pool-actions { display: flex; gap: 8px; align-items: center; }
        .cs-pool-attr-select {
            flex: 1; background: #1a1a2e; border: 1px solid #3a3a5a;
            color: #d0d0e8; border-radius: 6px; padding: 4px 7px; font-size: .82rem;
        }
        .cs-pool-install-btn {
            background: #2a5aaa; color: #fff; border: none;
            border-radius: 6px; padding: 5px 14px;
            font-size: .83rem; cursor: pointer; white-space: nowrap;
        }
        .cs-pool-install-btn:hover { opacity: .85; }
        .cs-pool-delete-btn {
            background: none; border: none; color: #c06060;
            font-size: 1rem; cursor: pointer; padding: 0 4px;
        }
        .cs-pool-delete-btn:hover { color: #ff4f4f; }
        .cs-pool-empty { text-align: center; color: #5a5a7a; padding: 32px 16px; font-size: .9rem; }
        /* Power tier badge */
        .cs-power-tier-badge {
            font-size: .72rem; font-weight: 700; border-radius: 4px;
            border: 1px solid; padding: 1px 5px; letter-spacing: .04em;
        }
        /* Cost floor badge */
        .cs-cost-floor-badge {
            font-size: .72rem; font-weight: 700; border-radius: 4px;
            border: 1px solid #3a3a5a; padding: 1px 6px;
            color: #8888cc; background: #1a1a30;
            cursor: help; white-space: nowrap;
        }
        .cs-cost-floor-warn {
            color: #ff6060; border-color: #ff404055; background: #2a1a1a;
        }
    `;
    document.head.appendChild(s);
}

function _buildCsPoolCardHTML(entry, attrs, isTemplate) {
    const attrOpts = attrs.map(a => `<option value="${a.id}">${_esc(a.name)}</option>`).join('');
    const dicePreview = (entry.diceTemplate || []).map(d => {
        const multStr = (d.multiplier ?? 1) !== 1 ? `×${d.multiplier}` : '';
        return `<span class="cs-pool-dice-chip">${_esc(d.diceType)} 1d${d.sides}+${entry.attributeRole}${multStr}</span>`;
    }).join('');
    const deleteBtn = isTemplate
        ? `<button class="cs-pool-delete-btn" data-tmpl-id="${_esc(entry._templateId)}" title="Delete template">🗑</button>`
        : '';

    return `
        <div class="cs-pool-card">
            <div class="cs-pool-card-header">
                <span class="cs-pool-card-name">${_esc(entry.name)}</span>
                <span class="cs-pool-card-cat">${_esc(entry.category || 'Custom')}</span>
                <span class="cs-pool-card-role">${_esc(entry.attributeRole)}</span>
            </div>
            <div class="cs-pool-card-cost">${'●'.repeat(Math.min(3, entry.cost ?? 1))} ${entry.cost ?? 1}L cost</div>
            ${entry.description ? `<div class="cs-pool-card-desc">${_esc(entry.description)}</div>` : ''}
            <div class="cs-pool-dice-preview">${dicePreview}</div>
            <div class="cs-pool-actions">
                ${attrOpts
                    ? `<select class="cs-pool-attr-select" title="Choose ${_esc(entry.attributeRole)} attribute">
                           ${attrOpts}
                       </select>`
                    : `<span style="font-size:.8rem;color:#c06060;">No attributes defined in your stat sheet.</span>`
                }
                <button class="cs-pool-install-btn"
                        data-entry='${JSON.stringify({ name: entry.name, cost: entry.cost ?? 1, diceTemplate: entry.diceTemplate }).replace(/'/g, "&#39;")}'
                        ${!attrOpts ? 'disabled' : ''}>
                    Install →
                </button>
                ${deleteBtn}
            </div>
        </div>
    `;
}

function _buildCsPoolContent(query) {
    const ss    = extensionSettings.statSheet;
    const attrs = (ss?.attributes || []).filter(a => a.enabled);
    const q     = (query || '').toLowerCase().trim();

    if (_csPoolActiveTab === 'library') {
        const filtered = COMBAT_SKILL_LIBRARY.filter(e =>
            !q ||
            e.name.toLowerCase().includes(q) ||
            (e.category || '').toLowerCase().includes(q) ||
            (e.attributeRole || '').toLowerCase().includes(q) ||
            (e.description || '').toLowerCase().includes(q)
        );
        if (!filtered.length) return '<div class="cs-pool-empty">No matches.</div>';
        return filtered.map(e => _buildCsPoolCardHTML(e, attrs, false)).join('');
    }

    const templates = (ss?.combatSkillTemplates || []).filter(e =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q)
    );
    if (!templates.length) {
        return '<div class="cs-pool-empty">No saved templates yet.<br>Open a skill in detail view and click 💾 Save as Template.</div>';
    }
    return templates.map(e => _buildCsPoolCardHTML(e, attrs, true)).join('');
}

function _refreshCsPoolList() {
    const q = String($('#cs-pool-search').val() || '');
    $('#cs-pool-list').html(_buildCsPoolContent(q));
}

function _openCsPoolPanel() {
    _injectCsPoolStyles();
    if ($('#cs-pool-overlay').length) { $('#cs-pool-overlay').show(); return; }

    const $overlay = $(`
        <div id="cs-pool-overlay">
            <div id="cs-pool-panel">
                <div class="csp-header">
                    <h3>📦 Skill Module Pool</h3>
                    <button class="csp-close" id="cs-pool-close">✕</button>
                </div>
                <div class="csp-tabs">
                    <button class="csp-tab-btn ${_csPoolActiveTab === 'library'   ? 'active' : ''}" data-csp-tab="library">Built-in Library</button>
                    <button class="csp-tab-btn ${_csPoolActiveTab === 'templates' ? 'active' : ''}" data-csp-tab="templates">My Templates</button>
                </div>
                <div class="csp-search">
                    <input type="text" id="cs-pool-search" placeholder="Search…" autocomplete="off">
                </div>
                <div class="csp-list" id="cs-pool-list">
                    ${_buildCsPoolContent('')}
                </div>
            </div>
        </div>
    `);
    $('body').append($overlay);
    $overlay.on('click', function(e) {
        if (e.target.id === 'cs-pool-overlay') _closeCsPoolPanel();
    });
}

function _closeCsPoolPanel() {
    $('#cs-pool-overlay').fadeOut(150, function() { $(this).remove(); });
}

// ============================================================================
// PLAYER MODE LISTENERS
// ============================================================================

function _attachPlayerListeners(container) {
    container.on('click.cs', '.cs-btn-equip', function() {
        const id  = $(this).data('skill-id');
        const ok  = equipCombatSkill(id);
        if (!ok) {
            const sk = _allSkills().find(s => s.id === id);
            showNotification(
                sk?.isEGO
                    ? 'That E.G.O tier is already equipped!'
                    : `Deck is full (max ${extensionSettings.statSheet.maxEquippedPages || MAX_REGULAR_DECK})`,
                'error'
            );
        }
        refreshCurrentTab();
    });

    container.on('click.cs', '.cs-btn-unequip', function() {
        unequipCombatSkill($(this).data('skill-id'));
        refreshCurrentTab();
    });

    container.on('click.cs', '.cs-btn-detail', function() {
        _showDetail($(this).data('skill-id'));
    });

    container.on('click.cs', '.cs-btn-roll-skill', function(e) {
        e.stopPropagation();
        const skill = _skill($(this).data('skill-id'));
        if (skill) _showSkillRollPopover($(this), skill);
    });
}

// ============================================================================
// MASTER MODE LISTENERS
// ============================================================================

function _attachMasterListeners(container) {

   // ── Roll popover ──────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-roll-skill', function(e) {
        e.stopPropagation();
        const skill = _skill($(this).data('skill-id'));
        if (skill) _showSkillRollPopover($(this), skill);
    });

    // ── Add skill / EGO ──────────────────────────────────────────────────────
    container.on('click.cs', '.cs-add-skill-btn', () => {
        addCombatSkill(_createDefaultSkill(false));
        refreshCurrentTab();
    });
    container.on('click.cs', '.cs-add-ego-btn', () => {
        addCombatSkill(_createDefaultSkill(true));
        refreshCurrentTab();
    });

    // ── Collapse / expand ─────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-collapse', function() {
        const id         = $(this).data('skill-id');
        const body       = container.find(`[data-body="${id}"]`);
        const isCollapsed = body.hasClass('cs-collapsed');
        body.toggleClass('cs-collapsed', !isCollapsed);
        $(this).text(isCollapsed ? '▾' : '▸');
        if (!isCollapsed) {
            _collapsedCards.add(id);
        } else {
            _collapsedCards.delete(id);
        }
    });

    // ── Equip / unequip ───────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-equip', function() {
        const id = $(this).data('skill-id');
        if (!equipCombatSkill(id)) showNotification('Cannot equip: deck full or tier already occupied', 'error');
        refreshCurrentTab();
    });
    container.on('click.cs', '.cs-btn-unequip', function() {
        unequipCombatSkill($(this).data('skill-id'));
        refreshCurrentTab();
    });

    // ── Duplicate ─────────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-duplicate', function() {
        duplicateCombatSkill($(this).data('skill-id'));
        refreshCurrentTab();
    });

    // ── Delete ────────────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-delete', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        if (!confirm(`Delete "${sk.name || 'Unnamed'}"? This cannot be undone.`)) return;
        removeCombatSkill(id);
        refreshCurrentTab();
    });

    // ── Detail popup ──────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-btn-detail', function() {
        _showDetail($(this).data('skill-id'));
    });

    // ── Name ──────────────────────────────────────────────────────────────────
    container.on('input.cs', '.cs-name-input', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.name = $(this).val();
        container.find(`.cs-master-card[data-skill-id="${id}"] .cs-mc-name`).text(sk.name || 'Unnamed');
        _save(id);
    });

    // ── Light Cost ────────────────────────────────────────────────────────────
    container.on('input.cs change.cs', '.cs-cost-input', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.cost = Math.max(0, parseInt($(this).val()) || 0);
        _save(id);
        _updateCostFloorUI(container, id);
    });

    // ── Unique toggle ─────────────────────────────────────────────────────────
    container.on('change.cs', '.cs-unique-chk', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.isUnique = $(this).is(':checked');
        _save(id);
        refreshCurrentTab();
    });

    // ── EGO toggle ────────────────────────────────────────────────────────────
    container.on('change.cs', '.cs-ego-chk', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.isEGO = $(this).is(':checked');
        if (sk.isEGO && !sk.egoTier) { sk.egoTier = 'ZAYIN'; sk.egoSanityCost = 5; }
        _save(id);
        refreshCurrentTab();
    });

    // ── EGO tier ──────────────────────────────────────────────────────────────
    container.on('change.cs', '.cs-ego-tier-select', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.egoTier       = $(this).val();
        sk.egoSanityCost = _sanityCost(sk.egoTier);
        _save(id);
        refreshCurrentTab();
    });

    // ── Notes ─────────────────────────────────────────────────────────────────
    container.on('input.cs', '.cs-notes-ta', function() {
        const id = $(this).data('skill-id');
        const sk = _skill(id);
        if (!sk) return;
        sk.notes = $(this).val();
        _save(id);
    });

    // ── Add skill-level tag slot ──────────────────────────────────────────────
    container.on('click.cs', '.cs-add-stag-btn', function() {
        const skillId = $(this).data('skill-id');
        const tagKey  = $(this).data('tag');
        const sk      = _skill(skillId);
        if (!sk) return;

        const def = SKILL_TAG_DEFS.find(t => t.key === tagKey);
        if (!def) return;

        // limitUses stays as a number; all other tags become { text, rank } objects
        sk[tagKey] = def.inputType === 'number' ? 5 : { text: '', rank: 1 };
        saveStatSheetData();

        const cardEl  = container.find(`.cs-master-card[data-skill-id="${skillId}"]`);
        const tagList = cardEl.find(`[data-tags-list="${skillId}"]`);
        tagList.append(_skillTagRow(skillId, def, sk[tagKey]));
        _rebuildSkillTagAddRow(cardEl, skillId, sk);
    });

    // ── Remove skill-level tag slot ───────────────────────────────────────────
    container.on('click.cs', '.cs-remove-stag-btn', function() {
        const skillId = $(this).data('skill-id');
        const tagKey  = $(this).data('tag');
        const sk      = _skill(skillId);
        if (!sk) return;

        delete sk[tagKey];
        saveStatSheetData();

        $(this).closest('.cs-skill-tag-row').remove();
        const cardEl = container.find(`.cs-master-card[data-skill-id="${skillId}"]`);
        _rebuildSkillTagAddRow(cardEl, skillId, sk);
    });

    // ── Skill-level tag text input — debounced save ───────────────────────────
    container.on('input.cs', '.cs-stag-input', function() {
        const skillId = $(this).data('skill-id');
        const tagKey  = $(this).data('tag');
        const sk      = _skill(skillId);
        if (!sk) return;
        const def = SKILL_TAG_DEFS.find(t => t.key === tagKey);
        if (def?.inputType === 'number') {
            sk[tagKey] = parseInt($(this).val()) || 1;
        } else {
            if (!sk[tagKey] || typeof sk[tagKey] !== 'object') sk[tagKey] = { text: '', rank: 1 };
            sk[tagKey].text = $(this).val();
        }
        // Live-update limit badge in header
        if (tagKey === 'limitUses') {
            container.find(`.cs-master-card[data-skill-id="${skillId}"] .cs-limit-badge`)
                .text(`Limit: ${sk.limitUses}`);
        }
        _save(skillId);
    });

    // ── Skill-level tag rank select ───────────────────────────────────────────
    container.on('change.cs', '.cs-stag-rank-select', function() {
        const skillId = $(this).data('skill-id');
        const tagKey  = $(this).data('tag');
        const sk      = _skill(skillId);
        if (!sk) return;
        if (!sk[tagKey] || typeof sk[tagKey] !== 'object') sk[tagKey] = { text: '', rank: 1 };
        const rank = parseInt($(this).val()) || 1;
        sk[tagKey].rank = rank;
        const clr = _MOD_RANK_COLORS[rank] || '#aaa';
        $(this).css({ color: clr, borderColor: `${clr}55` });
        _save(skillId);
    });

    // ── Add die ───────────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-add-die-btn', function() {
        const id  = $(this).data('skill-id');
        const sk  = _skill(id);
        if (!sk) return;
        const newDie = _createDefaultDie();
        sk.dice.push(newDie);
        const list = container.find(`[data-dice-list="${id}"]`);
        list.find('.cs-empty-sm').remove();
        list.append(_dieEditor(id, newDie, sk.dice.length - 1));
        saveStatSheetData();
    });

    // ── Remove die ────────────────────────────────────────────────────────────
    container.on('click.cs', '.cs-remove-die-btn', function() {
        const skillId = $(this).data('skill-id');
        const dieId   = $(this).data('die-id');
        const sk      = _skill(skillId);
        if (!sk) return;
        sk.dice = (sk.dice || []).filter(d => d.id !== dieId);
        $(this).closest('.cs-die-editor').remove();
        container.find(`[data-dice-list="${skillId}"] .cs-die-editor`).each(function(i) {
            $(this).find('.cs-die-idx .cs-die-chip').text(`Die ${i + 1}`);
        });
        saveStatSheetData();
    });

    // ── Die type — recolours chip, also rebuilds add-effects row (On Evade filter) ──
    container.on('change.cs', '.cs-die-type', function() {
        const skillId = $(this).data('skill-id');
        const dieId   = $(this).data('die-id');
        const d       = _die(skillId, dieId);
        if (!d) return;

        const oldType  = d.diceType;
        d.diceType     = $(this).val();

        // Recolour chip
        const dieEditor = $(this).closest('.cs-die-editor');
        dieEditor.find('.cs-die-idx .cs-die-chip')
            .removeClass('cs-dt-offensive cs-dt-defensive cs-dt-counter')
            .addClass(_dieClass(d.diceType));

        // If type changed between evade / non-evade, remove incompatible slots
        // e.g. switching away from Evade removes onEvade; switching to non-offensive removes onHit/onCrit
        if (_isEvadeDie({ diceType: oldType }) && !_isEvadeDie(d)) {
            if (d.onEvade !== undefined) {
                delete d.onEvade;
                dieEditor.find(`.cs-die-effect-row[data-effect="onEvade"]`).remove();
            }
        }
        if (!_isOffensiveDie(d)) {
            ['onHit', 'onCrit'].forEach(k => {
                if (d[k] !== undefined) {
                    delete d[k];
                    dieEditor.find(`.cs-die-effect-row[data-effect="${k}"]`).remove();
                }
            });
        }

        _rebuildDieAddEffectsRow(dieEditor, skillId, dieId, d);
        _save(skillId);
    });

    // ── Die sides ─────────────────────────────────────────────────────────────
    container.on('change.cs', '.cs-die-sides', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d) return;
        d.sides = parseInt($(this).val());
        _save($(this).data('skill-id'));
    });

    // ── Die modifier type (flat / attribute / skill / saving_throw) ───────────────────────
    container.on('change.cs', '.cs-die-mod-type', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d) return;
        const type = $(this).val();
        if (!d.modifier) d.modifier = { type: 'flat', flatValue: d.basePower ?? 0, targetId: '', multiplier: 1, roundDown: false };
        d.modifier.type = type;
        const wrap = $(this).closest('.cs-die-mod-wrap');
        wrap.find('.cs-die-mod-flat').toggle(type === 'flat');
        wrap.find('.cs-die-mod-target-attr').toggle(type === 'attribute');
        wrap.find('.cs-die-mod-target-skill').toggle(type === 'skill');
        wrap.find('.cs-die-mod-target-st').toggle(type === 'saving_throw');
        wrap.find('.cs-die-mod-target-subskill').toggle(type === 'subskill');
        wrap.find('.cs-die-mod-dyn').toggle(type !== 'flat');
        _save($(this).data('skill-id'));
        _updateCostFloorUI(container, $(this).data('skill-id'));
    });

    container.on('input.cs', '.cs-die-mod-flat', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d) return;
        if (!d.modifier) d.modifier = { type: 'flat', flatValue: 0, targetId: '', multiplier: 1, roundDown: false };
        const v = parseInt($(this).val());
        d.modifier.flatValue = isNaN(v) ? 0 : v;
        d.basePower = d.modifier.flatValue;
        _save($(this).data('skill-id'));
    });

    container.on('change.cs', '.cs-die-mod-target-attr, .cs-die-mod-target-skill, .cs-die-mod-target-st, .cs-die-mod-target-subskill', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d?.modifier) return;
        d.modifier.targetId = $(this).val();
        _save($(this).data('skill-id'));
        _updateCostFloorUI(container, $(this).data('skill-id'));
    });

    container.on('input.cs', '.cs-die-mod-mult', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d?.modifier) return;
        const v = parseFloat($(this).val());
        d.modifier.multiplier = isNaN(v) || v <= 0 ? 1 : v;
        _save($(this).data('skill-id'));
        _updateCostFloorUI(container, $(this).data('skill-id'));
    });

    container.on('change.cs', '.cs-die-mod-round', function() {
        const d = _die($(this).data('skill-id'), $(this).data('die-id'));
        if (!d?.modifier) return;
        d.modifier.roundDown = $(this).is(':checked');
        _save($(this).data('skill-id'));
    });

        // ── Add die effect slot ───────────────────────────────────────────────────
    container.on('click.cs', '.cs-add-effect-btn', function() {
        const skillId   = $(this).data('skill-id');
        const dieId     = $(this).data('die-id');
        const effectKey = $(this).data('effect');
        const d         = _die(skillId, dieId);
        if (!d) return;

        d[effectKey] = { text: '', rank: 1 };
        saveStatSheetData();

        const def       = DIE_EFFECT_DEFS.find(e => e.key === effectKey);
        const dieEditor = container.find(`.cs-die-editor[data-die-id="${dieId}"]`);
        dieEditor.find('.cs-die-effects-list').append(_dieEffectRow(skillId, dieId, def, d[effectKey]));
        _rebuildDieAddEffectsRow(dieEditor, skillId, dieId, d);
    });

    // ── Remove die effect slot ────────────────────────────────────────────────
    container.on('click.cs', '.cs-remove-effect-btn', function() {
        const skillId   = $(this).data('skill-id');
        const dieId     = $(this).data('die-id');
        const effectKey = $(this).data('effect');
        const d         = _die(skillId, dieId);
        if (!d) return;

        delete d[effectKey];
        saveStatSheetData();

        $(this).closest('.cs-die-effect-row').remove();
        const dieEditor = container.find(`.cs-die-editor[data-die-id="${dieId}"]`);
        _rebuildDieAddEffectsRow(dieEditor, skillId, dieId, d);
    });

    // ── Die effect text input — debounced save ────────────────────────────────
    container.on('input.cs', '.cs-effect-input', function() {
        const skillId   = $(this).data('skill-id');
        const dieId     = $(this).data('die-id');
        const effectKey = $(this).data('effect');
        const d         = _die(skillId, dieId);
        if (!d) return;
        if (!d[effectKey] || typeof d[effectKey] !== 'object') d[effectKey] = { text: '', rank: 1 };
        d[effectKey].text = $(this).val();
        _save(skillId);
    });

    // ── Die effect rank select ────────────────────────────────────────────────
    container.on('change.cs', '.cs-effect-rank-select', function() {
        const skillId   = $(this).data('skill-id');
        const dieId     = $(this).data('die-id');
        const effectKey = $(this).data('effect');
        const d         = _die(skillId, dieId);
        if (!d) return;
        if (!d[effectKey] || typeof d[effectKey] !== 'object') d[effectKey] = { text: '', rank: 1 };
        const rank = parseInt($(this).val()) || 1;
        d[effectKey].rank = rank;
        // Update select colour live
        const clr = _MOD_RANK_COLORS[rank] || '#aaa';
        $(this).css({ color: clr, borderColor: `${clr}55` });
        _save(skillId);
    });

    // ── Module picker: open from die effect row ───────────────────────────────
    container.on('click.cs', '.cs-mod-pick-btn', function(e) {
        e.stopPropagation();
        const effectKey = $(this).data('effect');
        const $row      = $(this).closest('.cs-die-effect-row');
        const $input    = $row.find('.cs-effect-input');
        const $rank     = $row.find('.cs-effect-rank-select');
        _openModulePicker(effectKey, $input, $rank);
    });

    // ── Module picker: open from skill tag row ────────────────────────────────
    container.on('click.cs', '.cs-stag-pick-btn', function(e) {
        e.stopPropagation();
        const tagKey = $(this).data('tag');
        const $row   = $(this).closest('.cs-skill-tag-row');
        const $input = $row.find('.cs-stag-input');
        const $rank  = $row.find('.cs-stag-rank-select');
        _openModulePicker(tagKey, $input, $rank);
    });

} // <-- ADDED THIS MISSING BRACE

// ============================================================================
// SHARED TOGGLE LISTENER
// ============================================================================

function _attachToggleListener(container) {
    container.on('click.cs', '.cs-toggle-btn', function() {
        isMasterMode = !isMasterMode;
        refreshCurrentTab();
    });

    // ── Module Pool (Session 10) ──────────────────────────────────────────────
    container.on('click.cs', '.cs-pool-btn', _openCsPoolPanel);

    // Pool close
    $(document).off('click.cspool', '#cs-pool-close')
        .on('click.cspool', '#cs-pool-close', _closeCsPoolPanel);

    // Pool tab switch
    $(document).off('click.cspool', '.csp-tab-btn')
        .on('click.cspool', '.csp-tab-btn', function() {
            _csPoolActiveTab = $(this).data('csp-tab');
            $('.csp-tab-btn').removeClass('active');
            $(this).addClass('active');
            _refreshCsPoolList();
        });

    // Pool search
    $(document).off('input.cspool', '#cs-pool-search')
        .on('input.cspool', '#cs-pool-search', _refreshCsPoolList);

    // Install button
    $(document).off('click.cspool', '.cs-pool-install-btn')
        .on('click.cspool', '.cs-pool-install-btn', function(e) {
            e.stopPropagation();
            const $card    = $(this).closest('.cs-pool-card');
            const attrId   = $card.find('.cs-pool-attr-select').val();
            const attr     = (extensionSettings.statSheet?.attributes || []).find(a => a.id === attrId);
            const entryRaw = $(this).attr('data-entry');
            if (!entryRaw) return;

            let entry;
            try { entry = JSON.parse(entryRaw.replace(/&#39;/g, "'")); } catch { return; }

            const ss = extensionSettings.statSheet;
            const skill = {
                id:            generateUniqueId(),
                name:          entry.name,
                cost:          entry.cost ?? 1,
                isUnique:      false,
                isEGO:         false,
                egoTier:       'ZAYIN',
                egoSanityCost: 5,
                equipped:      false,
                notes:         '',
                dice: (entry.diceTemplate || []).map(dt => ({
                    id:        generateUniqueId(),
                    diceType:  dt.diceType,
                    sides:     dt.sides,
                    basePower: 0,
                    modifier: attrId
                        ? { type: 'attribute', targetId: attrId, multiplier: dt.multiplier ?? 1, roundDown: dt.roundDown ?? false, flatValue: 0 }
                        : { type: 'flat', flatValue: 0, targetId: '', multiplier: 1, roundDown: false },
                })),
            };

            if (!ss.combatSkills) ss.combatSkills = [];
            ss.combatSkills.push(skill);
            saveStatSheetData();
            refreshCurrentTab();
            showNotification(`"${skill.name}" added to your skills (${attr?.name || 'unlinked'}).`, 'success');
        });

    // Delete user template
    $(document).off('click.cspool', '.cs-pool-delete-btn')
        .on('click.cspool', '.cs-pool-delete-btn', function(e) {
            e.stopPropagation();
            const tmplId = $(this).data('tmpl-id');
            if (!confirm('Delete this template?')) return;
            const ss = extensionSettings.statSheet;
            ss.combatSkillTemplates = (ss.combatSkillTemplates || []).filter(t => t._templateId !== tmplId);
            saveStatSheetData();
            _refreshCsPoolList();
            showNotification('Template deleted.', 'info');
        });
}
