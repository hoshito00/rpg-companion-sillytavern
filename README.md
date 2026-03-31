# hoshito's RPG Companion — SillyTavern Fork

a fork of [SpicyMarinara's RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern). i've been messing with this thing for way too long and it's become kind of its own beast at this point, so i figured i'd give it its own page.

fair warning: i am not a developer. like, at all. most of this was built by describing what i wanted to Claude and then piecing together what it gave me until it stopped breaking. if you look at the source code and feel confused, that's valid and same.

### also it might not work as intended because it's still in an unfinished state.

---

## what's in here

### the stat sheet

a full character sheet that replaces the attribute grid. has tabs for everything — summary, attributes, jobs and feats, gear, augments, and combat skills.

attributes can be numeric (STR 18 style) or alphabetic (letter ranks, going from FFF up to EX). there's a full skill tree, specialty point allocation, a gear slot system with stat bonuses, a body-slot augment system, and a combat skill deck builder.

the deck builder is probably the most elaborate thing in here. skills have die sequences, tag modules (on hit effects, clash win effects, eminence triggers, etc.), and there's a separate pool for E.G.O skills which work differently.

---

### the combat engine

this is the part i'm most proud of, and also the part that took the longest and broke the most. it's a local dice resolution system for turn-based encounters, meaning the actual clash math happens client-side rather than being left up to the AI to figure out.

it works like this: you hit **Start Encounter**, pick a combat skill or type a custom action, and the AI generates enemy actions wrapped in tags. the extension parses those tags and resolves everything locally — damage, clashing, stagger, affinities, speed order. the results feed back into the HP bars and the HUD.

the die types are slash, pierce, blunt for attacking, and block or evade for defense. clashes resolve in a linear queue, ties cancel, evade has a recycle mechanic. it's very specifically based on how combat works in Project Moon's games (Limbus Company / Library of Ruina), adapted for a text RPG context.

the HUD is supposed to track:
- **Light** — currency for using combat skills, refills every round
- **Sanity** — goes up when you win clashes and land kills, goes down when you lose them. if it hits -45 you go into E.G.O Corrosion and can only use E.G.O skills until you recover
- **Round** — current round counter

---

## settings

the main panel has controls for position (left, right, or top), theme, whether to auto-update, how many context messages to include in Separate mode, and generation mode.

inside the **Tracker Settings** button there's a lot more: configuring which stats exist and how they display, setting up the info box widgets, customizing the present characters panel, and controlling which fields get injected into historical messages.

there's also a **Preset Manager** so you can have different tracker configurations for different characters or genres and switch between them.

---

## a note on how this was built

i want to be upfront that i used Claude (the AI) extensively to write and debug most of the code in this fork. i had a clear vision for what i wanted, i understood the systems i was adapting, and i did a lot of the design work — but the actual implementation was very much a collaboration with an AI because i don't know how to code.

---

## where the ideas came from

this is important to me to credit properly because i built basically nothing from scratch conceptually — i just adapted and combined things that already existed.

- **[Project Moon games]** (Library of Ruina, Limbus Company) — the entire combat engine structure, the clash system, die types, E.G.O Corrosion, Light and Sanity as resources. if you've played these games the combat system will feel very familiar.
- **[Jakkafang's Stars of the City system](https://docs.google.com/document/d/1BnU-VNWkLPjhtYfSfpaErkzdUd_LYk2deGrSQgsatXk/edit?tab=t.zgcrpcvhyh3f)** — the direct mechanical inspiration for the clash engine. this is a fan-made TTRPG system based on Project Moon's combat that i used as the blueprint for the local resolution logic. if you're interested in the TTRPG system check out this doc.
- **[Pathfinder](https://paizo.com/pathfinder)** — the job/feat structure, skill trees, and a lot of the general character sheet architecture is pulling from Pathfinder 2e's design sensibility
- **[Cyberpunk RED](https://rtalsoriangames.com/cyberpunk/)** — stat design, the augment system

and of course the original extension by **SpicyMarinara**, which is what all of this is built on top of.

---

## license

GNU Affero General Public License v3.0 or later. see [LICENSE](LICENSE).

---

## credits

**original author:** SpicyMarinara

**original contributors:** Paperboygold, Munimunigamer, Subarashimo, Lilminzyu, Claude, IDeathByte, Chungchandev, Joenunezb, Amauragis, Tomt610, Jakstein

**this fork:** hoshito00

---

## support the original

- [SpicyMarinara's Discord](https://discord.com/invite/KdAkTg94ME)
- [SpicyMarinara on Ko-fi](https://ko-fi.com/marinara_spaghetti)
