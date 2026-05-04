// Shared in-memory fixtures for MCP tool tests.
//
// We construct a minimal `Env` whose R2 binding is backed by an in-memory Map
// and whose KV binding is undefined. This mirrors what the Worker sees in
// production, without spinning up the workers runtime.

import type {
  KVNamespace,
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from "@cloudflare/workers-types";

export interface FakeBundleSeed {
  rootManifest: unknown;
  providerManifests: Record<string, unknown>;
  knowledge?: Record<string, string>;
  recipes?: Record<string, string>;
}

export function makeEnv(seed: FakeBundleSeed): Env {
  const store = new Map<string, string>();
  // All keys carry the cli/ prefix to mirror the production R2 layout.
  store.set("cli/packs/terraform/MANIFEST.json", JSON.stringify(seed.rootManifest));
  for (const [provider, manifest] of Object.entries(seed.providerManifests)) {
    store.set(`cli/packs/terraform/docs/${provider}/MANIFEST.json`, JSON.stringify(manifest));
  }
  for (const [id, body] of Object.entries(seed.knowledge ?? {})) {
    store.set(`cli/packs/terraform/docs/knowledge/${id}.md`, body);
  }
  for (const [id, body] of Object.entries(seed.recipes ?? {})) {
    store.set(`cli/packs/terraform/docs/recipes/${id}.toml`, body);
  }

  const bucket = makeFakeR2(store);
  return {
    REGISTRY: bucket,
    MCP_OBJECT: {} as unknown as Env["MCP_OBJECT"],
    MCP_CACHE: undefined as unknown as KVNamespace,
    REGISTRY_PUBLIC_BASE_URL: "https://cli-registry.vegastack.com",
    REGISTRY_MANIFEST_KEY: "cli/packs/terraform/MANIFEST.json",
    CACHE_TTL_SECONDS: "300",
    LOG_LEVEL: "warn",
  } as Env;
}

function makeFakeR2(store: Map<string, string>): R2Bucket {
  return {
    async get(key: string): Promise<R2ObjectBody | null> {
      const v = store.get(key);
      if (v === undefined) return null;
      return {
        text: async () => v,
        json: async () => JSON.parse(v),
        body: null,
      } as unknown as R2ObjectBody;
    },
    async head(key: string): Promise<R2Object | null> {
      return store.has(key) ? ({ key } as unknown as R2Object) : null;
    },
    async put(): Promise<R2Object> {
      throw new Error("not implemented in fake");
    },
    async delete(): Promise<void> {},
    async list() {
      return { objects: [], truncated: false } as never;
    },
    async createMultipartUpload(): Promise<never> {
      throw new Error("not implemented");
    },
    async resumeMultipartUpload(): Promise<never> {
      throw new Error("not implemented");
    },
  } as unknown as R2Bucket;
}

// ── Sample manifest fixtures ───────────────────────────────────────────────

export const SEED_BASIC: FakeBundleSeed = {
  rootManifest: {
    manifest_schema_version: 1,
    registry_version: "2026.04.28",
    providers: ["aws", "cloudflare", "datadog"],
    generated_at: "2026-04-28T00:00:00Z",
  },
  providerManifests: {
    aws: {
      manifest_schema_version: 1,
      provider: "aws",
      registry_version: "2026.04.28",
      synced_at: "2026-04-28T00:00:00Z",
      resources: {
        aws_s3_bucket: {
          type: "resource",
          file: "r/s3_bucket.html.markdown",
          description: "Provides an S3 bucket resource. Supports versioning, encryption, and lifecycle rules.",
          subcategory: "S3 (Simple Storage)",
          required_args: [{ name: "bucket" }],
          optional_args: [
            { name: "versioning" },
            { name: "tags" },
            { name: "force_destroy" },
          ],
          computed_attrs: [{ name: "arn" }, { name: "id" }],
          blocks: {},
          enum_values: {},
          import_syntax: { command: "terraform import aws_s3_bucket.example bucket-name", id_format: "<bucket>" },
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: ["aws_s3_bucket_versioning", "aws_s3_bucket_server_side_encryption_configuration"],
          schema_origin: "sdkv2",
          sections: {},
          sha1_prefix: "deadbeef",
        },
        aws_s3_bucket_versioning: {
          type: "resource",
          file: "r/s3_bucket_versioning.html.markdown",
          description: "Provides versioning configuration for an S3 bucket.",
          subcategory: "S3 (Simple Storage)",
          required_args: [{ name: "bucket" }, { name: "versioning_configuration" }],
          optional_args: [],
          computed_attrs: [],
          blocks: {},
          enum_values: {},
          import_syntax: null,
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: [],
          schema_origin: "sdkv2",
          sections: {},
          sha1_prefix: "feedface",
        },
        aws_db_instance: {
          type: "resource",
          file: "r/db_instance.html.markdown",
          description: "Provides an RDS database instance.",
          subcategory: "RDS (Relational Database)",
          required_args: [{ name: "engine" }, { name: "instance_class" }],
          optional_args: [],
          computed_attrs: [],
          blocks: {},
          enum_values: {},
          import_syntax: null,
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: [],
          schema_origin: "sdkv2",
          sections: {},
          sha1_prefix: "12345678",
        },
      },
      data_sources: {},
      argument_index: { versioning: ["aws_s3_bucket"], bucket: ["aws_s3_bucket", "aws_s3_bucket_versioning"] },
      attribute_index: {},
      description_token_index: {
        s3: ["aws_s3_bucket", "aws_s3_bucket_versioning"],
        bucket: ["aws_s3_bucket", "aws_s3_bucket_versioning"],
        versioning: ["aws_s3_bucket", "aws_s3_bucket_versioning"],
      },
      primary_resources: { s3: "aws_s3_bucket" },
      subcat_keywords: { s3: "S3 (Simple Storage)" },
    },
    cloudflare: {
      manifest_schema_version: 1,
      provider: "cloudflare",
      registry_version: "2026.04.28",
      synced_at: "2026-04-28T00:00:00Z",
      resources: {
        cloudflare_dns_record: {
          type: "resource",
          file: "r/dns_record.html.markdown",
          description: "Manages a Cloudflare DNS record.",
          subcategory: "DNS",
          required_args: [{ name: "zone_id" }, { name: "name" }, { name: "type" }, { name: "content" }],
          optional_args: [{ name: "ttl" }, { name: "proxied" }],
          computed_attrs: [],
          blocks: {},
          enum_values: { type: ["A", "AAAA", "CNAME", "TXT", "MX"] },
          import_syntax: { command: "terraform import cloudflare_dns_record.example <zone_id>/<id>", id_format: "<zone_id>/<dns_record_id>" },
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: [],
          schema_origin: "plugin_framework",
          sections: {},
          sha1_prefix: "abc12345",
        },
      },
      data_sources: {},
      primary_resources: { dns: "cloudflare_dns_record" },
    },
    datadog: {
      manifest_schema_version: 1,
      provider: "datadog",
      registry_version: "2026.04.28",
      synced_at: "2026-04-28T00:00:00Z",
      resources: {},
      data_sources: {},
    },
  },
  knowledge: {
    "aws-s3-native-state-locking": [
      "---",
      'title: "S3 native state locking (no DynamoDB)"',
      "date_authored: 2026-03-15",
      'authoritative_source: "https://developer.hashicorp.com/terraform/language/backend/s3"',
      "providers:",
      "  - aws",
      "triggers:",
      '  - phrase: "state locking"',
      "  - tokens: [s3, lock]",
      "overrides_training: true",
      "---",
      "",
      "Use the `use_lockfile = true` argument on the S3 backend; DynamoDB is no longer required.",
    ].join("\n"),
  },
  recipes: {
    "scalable-backend-aws-ecs-fargate": [
      // Real TOML rule: top-level keys MUST appear before any table.
      'providers = ["aws", "datadog"]',
      'scaffold_hcl = """',
      'resource "aws_ecs_cluster" "main" {',
      '  name = "main"',
      "}",
      '"""',
      "",
      "[[triggers]]",
      'phrase = "scalable backend"',
      "",
      "[[triggers]]",
      "tokens = [ecs, fargate]",
      "",
      "[[pitfalls]]",
      'note = "Always set deletion_protection = true on aws_db_instance."',
      'severity = "warn"',
    ].join("\n"),
  },
};
