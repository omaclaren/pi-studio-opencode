# Architecture

## Current goal

`pi-studio-opencode` is the first standalone host implementation of **π Studio** outside the original Pi extension.

Near-term priority is to ship a genuinely usable opencode-facing Studio and learn from real users before locking in a long-term shared package structure.

## Design philosophy

Keep **Studio behavior** as host-neutral as practical, and keep **host integration** as a thin adapter layer.

In other words:

- shared Studio layers should define what Studio means
  - run / queue steering / stop semantics
  - response history and provenance
  - follow-latest and selection behavior
  - preview and math behavior
  - editor and file-workflow behavior where practical
- host adapters should define how those semantics are delivered
  - session transport
  - backend queue / stop wiring
  - host-specific metadata
  - host-specific editor integration

This repo should avoid drifting into “an opencode app with Studio-like UI”. It should instead remain “a Studio implementation whose first standalone host is opencode”.

## Relationship to `pi-studio`

For now, this repo stays **separate** from `pi-studio`.

That separation is intentional:

- `pi-studio` remains the stable shipped Pi extension
- `pi-studio-opencode` can evolve faster
- we should not force an early merge or premature extraction just for architectural neatness

`pi-studio` may still be used as a behavioral reference when validating parity, but standalone work should happen here.

## Recommended evolution

### Phase A — ship and learn

- make `pi-studio-opencode` useful enough for opencode users to try
- release preliminary versions early
- learn what is genuinely shared and what is still host-specific in disguise

### Phase B — extract only the stable shared layers

Once the boundaries are clearer from real use, extract the pieces that have actually stabilized, for example:

- shared Studio state / provenance logic
- shared preview / math pipeline
- shared browser UI behavior
- shared host type contracts

Do **not** force a giant “core” extraction before that boundary is obvious.

### Phase C — test a new Pi-facing layer on top of the shared layers

A key validation step should be to build a **new Pi layer** on top of the extracted shared Studio layers.

That is the real test of whether the architecture is working.

The point is not just to share code abstractly. The point is to stop manually porting fixes between Pi and opencode and to stop keeping both interfaces in sync by hand.

If the shared layers are good enough, then the eventual end state could be:

- `pi-studio-opencode` = thin opencode-facing layer + shared Studio dependencies
- `pi-studio` = thin Pi-facing layer + shared Studio dependencies

## Non-goals for now

- no premature repo merge with `pi-studio`
- no forced monorepo yet
- no promise that the final extracted package is exactly called `studio-core`
- no rewriting the existing `pi-studio` extension before the shared path proves itself

## Practical rule of thumb

When adding or changing behavior here, ask:

1. Is this genuinely **Studio behavior**?
   - keep it host-neutral if possible.
2. Is this specifically **how opencode works**?
   - keep it in the opencode adapter layer.

That discipline matters more right now than the exact future package layout.
