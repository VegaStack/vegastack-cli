# Registry Format Examples

Current Registry content is produced by `vegastack/vegastack-cli-registry` and
installed by `vegastack init` into the user's VegaStack cache. The CLI treats
exact local files plus generated manifests and indexes as source of truth.

## Pack Layout

Each pack is published under `cli/packs/<pack>/` with:

- `MANIFEST.json`: pack metadata, version, content hash, source refs, file list,
  and generated indexes.
- `ARTIFACTS.json`: download artifact metadata and SHA256 integrity data.
- `pack.tar.gz`: compressed pack payload.
- `index/entities.json`: deterministic extracted entities for routing.
- `index/rank_index.json`: deterministic terms and section hints for ranking.

## Terraform Entries

Terraform remains a structured pack. Per-provider docs live under the Terraform
pack and preserve provider manifests for resource/data-source lookup, import
syntax, arguments, companion resources, examples, and deprecation metadata.

## Generic Docs Entries

Generic docs packs such as Supabase, GitHub Actions, Docker, Kubernetes, Helm,
AWS CLI, and Jenkins use the same pack artifact shape. Their metadata is built
from source-controlled sync mappings in the Registry repo and searched through
`vegastack search` / `vegastack ask`.
