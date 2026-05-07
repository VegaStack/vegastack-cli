# VegaStack CLI Docs

Current architecture:

- CLI package: `@vegastack/cli`.
- Knowledge source: VegaStack Registry at `https://cli-registry.vegastack.com/cli`.
- Project config: committed `.vegastack/vegastack.yml`.
- Global cache: `~/.vegastack/registry/`, `~/.vegastack/tools/`, and `~/.vegastack/instructions/`.
- Main evidence command: `vegastack ask`.
- Exact lookup command: `vegastack search`.
- Registry refresh command: `vegastack registry update`.

Historical planning and audit notes were removed from this repo because they described removed command surfaces and confused agent search. Current contracts live in `docs/contracts/`.
