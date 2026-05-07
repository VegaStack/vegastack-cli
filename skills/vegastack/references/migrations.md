# Provider-version migrations (v0.1)

When the user upgrades a provider, **resources get renamed, defaults change, arguments deprecate**. The Registry ships date-stamped knowledge cards in pack indexes capturing breaking changes the maintainers or sync pipeline verified. Read the card *before* writing migration HCL; cite its `authoritative_source` in your reply.

## The single workflow

```bash
vegastack ask --entry terraform --tf-provider <provider> "migrate <provider> from v<old> to v<new>"
# or simply:
vegastack ask --entry terraform --tf-provider <provider> "<old_resource_name>"   # e.g. "cloudflare_record"
```

The envelope's `knowledge[]` returns matching migration cards. Cards with `overrides_training: true` are explicitly authoritative over your model memory.

## Migration card examples

The installed pack's `index/knowledge.json` is the source of truth for current
migration cards. These examples show the expected shape.

| Card ID | Provider | What changed |
|---|---|---|
| `cloudflare-resource-renames-v5` | cloudflare | CF v5 (Sep 2024) renamed dozens of resources: `cloudflare_record` → `cloudflare_dns_record`; `cloudflare_access_*` → `cloudflare_zero_trust_access_*`. State migration via `terraform state mv` required. |
| `azure-azurerm-v4-renames` | azure | azurerm v4 (Aug 2024) tightened defaults; some renames; `identity {}` no longer accepts empty block. |
| `kubernetes-provider-v2-fields` | kubernetes | Use `_v1`-suffixed versioned aliases (`kubernetes_deployment_v1`); unversioned forms are stuck on older API versions. |
| `helm-provider-v3` | helm | `name` on `helm_release` is the **release** name, not the chart name; v3 strict-validates this. |
| `mongodb-atlas-cluster-vs-advanced` | mongodb-atlas | `mongodbatlas_cluster` deprecated; use `mongodbatlas_advanced_cluster` with `replication_specs` block (auto-scaling and multi-region land here). |
| `aws-s3-versioning-split` | aws | Inline `versioning {}` / `lifecycle_rule {}` / `server_side_encryption_configuration {}` on `aws_s3_bucket` deprecated; use the per-feature standalone resources. |
| `aws-alb-rename` | aws | `aws_alb*` are aliases of canonical `aws_lb*`. Old code works; new code should use canonical. |
| `gcp-cloud-run-v2-default` | gcp | Use `google_cloud_run_v2_service` / `_job` for new work; v1 in maintenance only; v2 has different argument shape (`template.containers[]`). |
| `datadog-monitor-v2-syntax` | datadog | Tag scoping shifted; `host:` is a no-op on serverless (Lambda/Fargate); use `service:` instead. |

Cards are surfaced from the installed pack's `index/knowledge.json`. For schema and authoring guidelines see [knowledge-cards.md](knowledge-cards.md).

## Generic migration recipe (when no card exists)

1. **Find the old → new mapping in the provider's CHANGELOG.** Provider repos publish `CHANGELOG.md` per major release; the harness's `files[]` returns upgrade-guide pages (`guides/upgrade-from-v<old>.html.markdown`) when they exist.
2. **For every renamed resource:** `terraform state mv old_name.foo new_name.foo`. Script the sequence so the migration is reproducible.
3. **`terraform plan` after each rename.** Drift between new shape and imported state is normal; reconcile by editing HCL until plan is empty.
4. **Pin the new version in `required_providers`.** That's what protects you from another silent upgrade later.

## Pitfalls

- **Don't `terraform destroy` before migrating.** State move preserves the upstream object; destroy + recreate loses data on stateful resources.
- **Argument-rename cascades.** When an argument is renamed (`aws_db_instance.name` → `db_name`), `manifest_entry.optional_args[]` shows only the new name; older configs get a deprecation warning, then break in the next major.
- **Defaults change between versions.** A field that defaulted to `false` in v3 may default to `true` in v4. The manifest shows current defaults only; explicitly set anything you depend on.
- **Multi-provider migrations.** No single "cross-provider migration" recipe — providers version independently. Run `vegastack ask` per provider; read each `knowledge[]`.

## Citation

Cite both the knowledge card ID and the upstream upgrade guide page when present (typically at `<provider>/guides/version-<N>-upgrade.html.markdown`).
