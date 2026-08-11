# PF2e Rune Manager

## PF2e Reference Source

The official Pathfinder 2e source repository is available as a Git submodule at:

reference/pf2e/

Before modifying PF2e-specific functionality, initialize the submodule if needed:

git submodule update --init --recursive

Treat reference/pf2e/ as strictly read-only.

Use it only to inspect the current PF2e implementation.

Never:
- modify files inside reference/pf2e/
- commit changes to the PF2e repository
- import source files from reference/pf2e/ at runtime
- assume that reference/pf2e/ exists on a user's Foundry installation

The installed Pathfinder 2e system is the runtime dependency.
The submodule is development reference material only.
