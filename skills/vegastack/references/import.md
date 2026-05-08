# Importing existing resources (v0.1)

Bringing an existing cloud / SaaS resource under Terraform management starts with the resource's `manifest_entry.import_syntax` — *not* training memory. Composite IDs (`zone_id/record_id`, `region:name`, `<account>/<role>`) are the single most common source of silent confusion.

## The single workflow

```bash
vegastack ask --agent --pack terraform --tf-provider <provider> "import existing <provider> <resource> <hint>"
```

`files[0].manifest_entry.import_syntax` returns `{command, id_format}`:

```json
{
  "command": "terraform import cloudflare_dns_record.example <zone_id>/<dns_record_id>",
  "id_format": "<zone_id>/<dns_record_id>"
}
```

Use `command` **verbatim**; replace only the placeholder values.

## Modern declarative `import {}` block (TF 1.5+)

Prefer the HCL block over the imperative CLI — it's reproducible, survives state rebuilds, and pairs with `terraform plan -generate-config-out=…` to scaffold a starting `resource` block:

```hcl
import {
  to = cloudflare_dns_record.example
  id = "abc123zoneid/def456recordid"
}
```

The `id_format` from `manifest_entry.import_syntax` is the contract for the `id =` value.

## Composite-ID patterns by provider family

| Provider family | Typical id_format | Example |
|---|---|---|
| AWS (most) | `<resource_id>` | `i-0abc1234` for `aws_instance` |
| AWS Route53 records | `<zone_id>_<record_name>_<record_type>` | `Z1ABC..._www.example.com_A` |
| Cloudflare (post v5) | `<zone_id>/<resource_id>` or `<account_id>/<resource_id>` | `abc.../def...` |
| Azure (azurerm) | full ARM resource ID path | `/subscriptions/<sub>/resourceGroups/<rg>/providers/...` |
| GCP (google) | `projects/<p>/<scope>/<name>` or `<name>` | `projects/my-proj/locations/us-central1/clusters/my-cluster` |
| Kubernetes | `<namespace>/<name>` or `<name>` (cluster-scoped) | `default/my-deployment` |
| Vault | full mount + path; KV v2 includes `data/` segment | `secret/data/foo` (see `vault-kv-v2-mount` card) |
| GitHub | `<owner>/<repo>` or numeric IDs | `vegastack/cli` |
| Snowflake | dotted FQ name | `MYDB.PUBLIC.MYTABLE` |

When `manifest_entry.import_syntax` is `null`, the resource is intentionally not importable (transient ops, write-only data sources). Don't guess a format — tell the user.

## Pitfalls

- **Don't `terraform apply` blind after import.** Always `terraform plan` first; reconcile drift by editing HCL, not state.
- **Workspace before import.** `terraform workspace show` — importing into `default` when you meant `prod` is silent and disastrous.
- **Cloudflare v5 rename.** Importing an old `cloudflare_record`? Use the new `cloudflare_dns_record` name (knowledge card `cloudflare-resource-renames-v5`); state migration required.
- **Vault KV v2 path-vs-API confusion.** Resource path is `secret/foo`; import API path includes `data/` (`secret/data/foo`). See `vault-kv-v2-mount`.
- **Importing a resource set.** If the user wants the full companion stack (e.g. `aws_instance` → vpc/subnet/sg/igw/route_table), run a separate `vegastack ask` per companion to get each `import_syntax`. The harness intentionally doesn't chain — users typically have *some* companions already managed.

## Citation

Cite `<provider>/r/<resource>.html.markdown` (the `## Import` section) plus any relevant knowledge card by ID.
