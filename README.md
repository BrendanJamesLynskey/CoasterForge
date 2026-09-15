# CoasterForge

A browser-based 3D parametric roller-coaster designer, optimised for FDM 3D printing on the Ender-3 V2 Neo.

CoasterForge opens on a blank canvas: build a ride from scratch in the Track Builder, one segment at a time, or start from a preset and edit it — a translucent "ghost" piece always shows exactly where the next segment will land before you place it. A simplified physics simulation runs along whatever you build to colour the lift and brake runs, work out a realistic speed and G-force profile, and size every support leg from the loads at that point. Hit export and the whole model is cut into pieces that fit your printer's bed, each with a matching sleeve connector for glue-up.

[Design a coaster here](https://brendanjameslynskey.github.io/CoasterForge/) &middot; [View on GitHub](https://github.com/BrendanJamesLynskey/CoasterForge)

## Features

- **Build from scratch** — a Track Builder chains straights, climbs, airtime hills, bank changes, banked curves, barrel rolls, lift hills, brakes, vertical loops and corkscrews end-to-end; start blank or load a preset in to edit. Every add/delete/reorder autosaves to the browser
- **Placeable, not just parametric** — a live translucent ghost segment previews exactly where the next piece will sit as you adjust its sliders, so you can see it before you commit to it
- **On-track arrow controls** — a small cluster of clickable 3D arrows floats just above the ghost piece: blue to bend it (pitch, up/down), orange to turn it (yaw, left/right), purple to twist it (roll/bank, either way) — shape a segment directly in the viewport instead of hunting for the matching slider; only the axes that apply to the current segment type appear
- **Five coaster types** — Wild Mouse (tight switchbacks), Out & Back (classic lift + airtime hills + a big banked U-turn), Looper (vertical loop + corkscrew), Inverted Looper (B&M-style: loop, zero-g roll, dual opposite-handed corkscrews), and a gentle Family Coaster
- **Two track styles** — sit-down (twin round rail) or inverted (B&M-style flat box beam, the way the train hangs below the track rather than rides on top of it) — a per-ride toggle, independent of layout
- **Bank to fully inverted** — curves, dedicated bank-change segments and barrel rolls all sweep the full ±180°, so track can roll upside-down anywhere, not just inside a loop or corkscrew
- **Real track elements** — lift hills, magnetic-style brake fins, banked turns, airtime hills, a true vertical loop, a corkscrew and a barrel roll, all built from one continuous pitch/yaw/bank path integrator so every join is smooth — turns ease into their curvature the way real spiral-transition track does, rather than snapping straight to it
- **Physics-driven** — a point-mass energy simulation (gravity, rolling friction, chain-lift and brake behaviour) gives a real speed profile and per-point G-forces along the ride
- **Force-sized supports** — post diameter is derived from a simplified cantilever-beam estimate (leg height × simulated G-load); tall sections automatically switch from a single post to a leaning A-frame pair
- **Scale to print** — 1:87 (HO), 1:160 (N), 1:220 (Z) or any custom scale in mm per real-world metre; only the printer bed size limits how a *piece* is cut, not the finished ride
- **Cut for printing** — the whole rail run and every tall support are automatically sliced into bed-sized pieces, each capped and paired with a hollow sleeve connector that glues over the joint — no CAD touch-up needed
- **Lift hills built for assembly** — ties on the lift are spaced twice as wide and skip the cross-bracing, leaving an open channel down the centre so a real fine chain can be threaded through and glued in once printed
- **STL export** — export the full model as one reference STL, or a print-ready ZIP kit (numbered pieces, connectors, supports, and an assembly manifest)

## How it works

The whole ride is authored as a chain of segments (`length`, target pitch, heading change, bank). A single integrator numerically steps a pitch/yaw direction vector along each segment, so straights, hills, banked curves, a full vertical loop, a corkscrew and a barrel roll all fall out of the same math with no special-casing and guaranteed C¹ continuity at every join — including full inversions, since bank and pitch are never clamped. The same samples feed a point-mass physics pass (for speed and G-force) and a tube-extrusion geometry pass (round rail or box beam, twin rails, ties, brake fins) — see `coaster.js`. The Track Builder just appends to (or edits) this same segment chain live, rebuilding the ghost preview from wherever the committed chain currently ends.

## 3D Printing Notes

- Default bed is **220 × 220 × 250 mm** (Ender-3 V2 Neo) — change it in the sidebar for your own printer
- Only individual *pieces* need to fit the bed; the assembled ride is much larger
- Rail and support diameters are independent print-scale parameters (not linearly scaled from real rail sizes) so they stay strong enough to print and handle
- Support sizing is a physically-motivated heuristic, not a certified structural calculation
- Lift hill pieces are deliberately left open between ties — glue in a fine chain (around 1.5 mm ball chain works well) before joining them to the rest of the ride
- Recommended: 0.2 mm layers, PLA or PETG, no supports needed if pieces are printed with their flattest face down

## Licence

MIT
