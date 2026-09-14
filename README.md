# CoasterForge

A browser-based 3D parametric roller-coaster designer, optimised for FDM 3D printing on the Ender-3 V2 Neo.

Pick a coaster type, and CoasterForge generates a full 3D ride — lift hill, drops, banked turns, brakes, and (on some layouts) a loop and a corkscrew — then runs a simplified physics simulation along the track to colour the lift and brake runs, work out a realistic speed and G-force profile, and size every support leg from the loads at that point. Hit export and the whole model is cut into pieces that fit your printer's bed, each with a matching sleeve connector for glue-up.

[Design a coaster here](https://brendanjameslynskey.github.io/CoasterForge/) &middot; [View on GitHub](https://github.com/BrendanJamesLynskey/CoasterForge)

## Features

- **Four coaster types** — Wild Mouse (tight switchbacks), Out & Back (classic lift + airtime hills + a big banked U-turn), Looper (vertical loop + corkscrew), and a gentle Family Coaster
- **Real track elements** — lift hills with chain-lift teeth, magnetic-style brake fins, banked turns, airtime hills, a true vertical loop and a corkscrew, all built from one continuous pitch/yaw/bank path integrator so every join is smooth
- **Physics-driven** — a point-mass energy simulation (gravity, rolling friction, chain-lift and brake behaviour) gives a real speed profile and per-point G-forces along the ride
- **Force-sized supports** — post diameter is derived from a simplified cantilever-beam estimate (leg height × simulated G-load); tall sections automatically switch from a single post to a leaning A-frame pair
- **Scale to print** — 1:87 (HO), 1:160 (N), 1:220 (Z) or any custom scale in mm per real-world metre; only the printer bed size limits how a *piece* is cut, not the finished ride
- **Cut for printing** — the whole rail run and every tall support are automatically sliced into bed-sized pieces, each capped and paired with a hollow sleeve connector that glues over the joint — no CAD touch-up needed
- **STL export** — export the full model as one reference STL, or a print-ready ZIP kit (numbered pieces, connectors, supports, and an assembly manifest)

## How it works

The whole ride is authored as a chain of segments (`length`, target pitch, heading change, bank). A single integrator numerically steps a pitch/yaw direction vector along each segment, so straights, hills, banked curves, a full vertical loop and a corkscrew all fall out of the same math with no special-casing and guaranteed C¹ continuity at every join. The same samples feed a point-mass physics pass (for speed and G-force) and a tube-extrusion geometry pass (for the twin rails, ties, lift teeth and brake fins) — see `coaster.js`.

## 3D Printing Notes

- Default bed is **220 × 220 × 250 mm** (Ender-3 V2 Neo) — change it in the sidebar for your own printer
- Only individual *pieces* need to fit the bed; the assembled ride is much larger
- Rail and support diameters are independent print-scale parameters (not linearly scaled from real rail sizes) so they stay strong enough to print and handle
- Support sizing is a physically-motivated heuristic, not a certified structural calculation
- Recommended: 0.2 mm layers, PLA or PETG, no supports needed if pieces are printed with their flattest face down

## Licence

MIT
