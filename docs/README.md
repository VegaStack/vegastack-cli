# VegaStack CLI Docs

Current architecture:

- CLI package: `@vegastack/cli`.
- Knowledge source: VegaStack Registry at `https://cli-registry.vegastack.com/cli`.
- Project config: committed `.vegastack/vegastack.yml`.
- Global cache: `~/.vegastack/registry/`, `~/.vegastack/tools/`, and `~/.vegastack/instructions/`.
- First-run/status command: `vegastack`.
- Main evidence command: `vegastack ask`.
- Exact lookup command: `vegastack search`.
- All-pack download command: `vegastack registry install --all`.
- Registry refresh command: `vegastack registry update`.

Start with [../GETTING_STARTED.md](../GETTING_STARTED.md). Current contracts
live in `docs/contracts/`.
