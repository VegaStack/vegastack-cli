// Tier 1: deterministic O(1) scoring against a per-provider MANIFEST.json.
// 12 stages total — 1a..1k are ports of the legacy Python harness; 1l is
// the v0.1 recommended_companions surface.
//
// New in v0.1:
//   • Stages 1a + primary_resource ALSO fire `subcategory_peer` boosts
//     on every other resource in the same subcategory. Closes F9.
//   • SUBCAT_KEYWORDS / PRIMARY_RESOURCES come from the manifest, not
//     hand-curated tables in code. Closes the "embedded tables" smell.
//   • Stage 1l consumes a pre-built `fileToResource` Map (built once in
//     enrich.ts) instead of re-scanning resources on every hit. Closes F24.
//   • Alias-resource widening: when an alias matches the original query,
//     every alias resource gets a guaranteed +60 boost so it survives top-K.

import * as fs from "node:fs";
import * as path from "node:path";
import { bigrams } from "./bigrams.js";
import { INTENT_KEYWORDS } from "./constants.js";
import { Scorer } from "./scoring.js";
import type { AliasRewrite } from "./tokenize.js";
import type { ProviderManifest, ScoredFile } from "./types.js";

export interface Tier1Args {
  manifest: ProviderManifest;
  tokens: string[];
  provider: string;
  providerDir: string;
  /** Pre-built reverse map: relative file path → resource name. Built in
   *  enrich.ts and passed in to keep stage 1l O(1). Optional for backwards
   *  compat — when absent we build it locally. */
  fileToResource?: ReadonlyMap<string, string>;
  /** Alias matches that should widen the result set (resources guaranteed
   *  in top-K via a +60 boost with reason `alias_resource:<alias>`). */
  aliasMatches?: AliasRewrite[];
}

export function tier1(args: Tier1Args): ReadonlyMap<string, ScoredFile> {
  const { manifest, tokens, provider, providerDir } = args;
  const scorer = new Scorer();

  const resources = manifest.resources ?? {};
  const dataSources = manifest.data_sources ?? {};
  const subcategoryUseful = manifest.subcategory_useful ?? true;
  const subcategories = subcategoryUseful ? (manifest.subcategories ?? {}) : {};
  const synthetic = manifest.synthetic_subcategories ?? {};
  const hclRefs = manifest.hcl_references ?? {};
  const argIndex = manifest.argument_index ?? {};
  const attrIndex = manifest.attribute_index ?? {};
  const exampleTokens = manifest.example_tokens ?? {};
  const resourceBigrams = manifest.resource_bigrams ?? {};
  const guides = manifest.guides ?? {};
  const recommendedCompanions: Record<string, string[]> = {};
  for (const [name, entry] of Object.entries(resources)) {
    if (entry.recommended_companions && entry.recommended_companions.length > 0) {
      recommendedCompanions[name] = entry.recommended_companions;
    }
  }
  const subcatKeywords = manifest.subcat_keywords ?? {};
  const primaryResources = manifest.primary_resources ?? {};

  const fullPath = (filepath: string): string => path.join(providerDir, filepath);
  const lookupAny = (name: string) => resources[name] ?? dataSources[name] ?? undefined;

  /** Add a subcategory_peer boost for every resource in `subcat` (skipping `selfFile`). */
  const fanoutSubcatPeers = (subcat: string | undefined, selfFile: string | undefined): void => {
    if (!subcategoryUseful || !subcat) return;
    const peers = subcategories[subcat];
    if (!peers) return;
    for (const peer of peers) {
      if (peer === selfFile) continue;
      scorer.add(fullPath(peer), 25, "subcategory_peer", subcat);
    }
  };

  // ── 1a. exact resource-name match ────────────────────────────────────
  for (const token of tokens) {
    for (const [resName, entry] of Object.entries(resources)) {
      const stripped = resName.startsWith(`${provider}_`)
        ? resName.slice(provider.length + 1)
        : resName;
      if (token !== resName && token !== stripped) continue;

      scorer.add(fullPath(entry.file), 100, "exact_resource", resName);
      fanoutSubcatPeers(entry.subcategory, entry.file);

      // HCL reference graph expansion (+30 each direction).
      const refs = hclRefs[resName];
      if (refs) {
        for (const ref of refs.references ?? []) {
          const peerEntry = lookupAny(ref);
          if (peerEntry) scorer.add(fullPath(peerEntry.file), 30, "hcl_ref", ref);
        }
        for (const back of refs.referenced_by ?? []) {
          const peerEntry = lookupAny(back);
          if (peerEntry) scorer.add(fullPath(peerEntry.file), 30, "hcl_back_ref", back);
        }
      }
    }

    for (const [resName, entry] of Object.entries(dataSources)) {
      const stripped = resName.startsWith(`${provider}_`)
        ? resName.slice(provider.length + 1)
        : resName;
      if (token === resName || token === stripped) {
        scorer.add(fullPath(entry.file), 90, "exact_datasource", resName);
      }
    }
  }

  // ── 1b. SUBCAT_KEYWORDS (from manifest) ──────────────────────────────
  if (subcategoryUseful) {
    for (const token of tokens) {
      const target = subcatKeywords[token];
      if (target && subcategories[target]) {
        for (const f of subcategories[target]) {
          scorer.add(fullPath(f), 70, "subcat_keyword", `${token}→${target}`);
        }
      }
    }
  }

  // ── PRIMARY_RESOURCES boost (from manifest) ──────────────────────────
  // Now also fans out subcategory_peer for every sibling resource, mirroring
  // 1a. Closes F9 — a query like "ec2 instance" lights up VPC peers, not
  // only when the user said the literal resource name.
  for (const token of tokens) {
    const primaryName = primaryResources[token];
    if (!primaryName) continue;
    const entry = lookupAny(primaryName);
    if (entry) {
      scorer.add(fullPath(entry.file), 100, "primary_resource", primaryName);
      fanoutSubcatPeers(entry.subcategory, entry.file);
    }
  }

  // ── 1c. synthetic subcategory ─────────────────────────────────────────
  for (const token of tokens) {
    if (synthetic[token]) {
      for (const f of synthetic[token]) {
        scorer.add(fullPath(f), 65, "synthetic_subcat", token);
      }
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const combined = `${tokens[i]}_${tokens[i + 1]}`;
    if (synthetic[combined]) {
      for (const f of synthetic[combined]) {
        scorer.add(fullPath(f), 68, "synthetic_subcat", combined);
      }
    }
  }

  // ── 1d. token-in-subcategory substring ───────────────────────────────
  if (subcategoryUseful) {
    for (const [subcat, files] of Object.entries(subcategories)) {
      const sc = subcat.toLowerCase();
      for (const token of tokens) {
        if (token.length >= 3 && sc.includes(token)) {
          for (const f of files) scorer.add(fullPath(f), 40, "subcategory", subcat);
          break;
        }
      }
    }
  }

  // ── 1e. partial resource-name match ──────────────────────────────────
  for (const [resName, entry] of Object.entries(resources)) {
    const parts = resName.split("_");
    for (const token of tokens) {
      if (token.length >= 3 && parts.includes(token)) {
        scorer.add(fullPath(entry.file), 35, "name_partial", resName);
      }
    }
  }

  // ── 1f. argument / attribute reverse index ───────────────────────────
  for (const token of tokens) {
    for (const f of argIndex[token] ?? []) {
      scorer.add(fullPath(f), 40, "argument_index", token);
    }
    for (const f of attrIndex[token] ?? []) {
      scorer.add(fullPath(f), 40, "attribute_index", token);
    }
  }

  // ── 1g. example-token index (HCL code-block tokens) ──────────────────
  for (const token of tokens) {
    for (const f of exampleTokens[token] ?? []) {
      scorer.add(fullPath(f), 20, "example_token", token);
    }
    const upper = token.toUpperCase();
    if (upper !== token) {
      for (const f of exampleTokens[upper] ?? []) {
        scorer.add(fullPath(f), 20, "example_token", upper);
      }
    }
  }

  // ── 1h. description substring match ──────────────────────────────────
  for (const [, entry] of [...Object.entries(resources), ...Object.entries(dataSources)]) {
    const desc = (entry.description ?? "").toLowerCase();
    if (!desc || desc === "|-") continue;
    for (const token of tokens) {
      if (token.length >= 4 && desc.includes(token)) {
        scorer.add(fullPath(entry.file), 15, "description", token);
      }
    }
  }

  // ── 1i. guides — intent-gated ────────────────────────────────────────
  const queryIntents = new Set<string>();
  for (const t of tokens) if (INTENT_KEYWORDS.has(t)) queryIntents.add(t);
  if (queryIntents.size > 0) {
    for (const [guideFile, meta] of Object.entries(guides)) {
      const tagsOverlap = (meta.intent_tags ?? []).some((t) => queryIntents.has(t));
      if (!tagsOverlap) continue;
      for (const resName of meta.referenced_resources ?? []) {
        if (tokens.some((t) => resName.includes(t))) {
          scorer.add(fullPath(guideFile), 45, "guide_link", resName);
        }
      }
    }
  }

  // ── 1j. bigram typo fallback (only when nothing else fired) ──────────
  if (scorer.isEmpty() && Object.keys(resourceBigrams).length > 0) {
    for (const token of tokens) {
      if (token.length < 5) continue;
      const tb = new Set(bigrams(token));
      if (tb.size === 0) continue;
      const candidates: { overlap: number; resName: string }[] = [];
      for (const [resName, rb] of Object.entries(resourceBigrams)) {
        let overlap = 0;
        const rbSet = new Set(rb);
        for (const bi of tb) if (rbSet.has(bi)) overlap++;
        if (overlap >= tb.size * 0.7) candidates.push({ overlap, resName });
      }
      candidates.sort((a, b) => b.overlap - a.overlap);
      for (const c of candidates.slice(0, 3)) {
        const entry = lookupAny(c.resName);
        if (entry) {
          scorer.add(fullPath(entry.file), 25, "bigram_typo", `${token}→${c.resName}`);
        }
      }
    }
  }

  // ── 1k. provider index page ──────────────────────────────────────────
  for (const idx of ["index.md", "index.html.markdown"]) {
    const p = path.join(providerDir, idx);
    if (fs.existsSync(p)) scorer.add(p, 5, "provider_index", idx);
  }

  // ── 1l. recommended_companions — uses pre-built fileToResource ───────
  // Build a one-time map ONLY if the caller didn't pass one in; in the real
  // pipeline, enrich builds it once per call. Closes F24.
  let fileToResource = args.fileToResource;
  if (!fileToResource) {
    const local = new Map<string, string>();
    for (const [name, entry] of Object.entries(resources)) local.set(entry.file, name);
    for (const [name, entry] of Object.entries(dataSources)) local.set(entry.file, name);
    fileToResource = local;
  }

  const currentHits = Array.from(scorer.toMap().keys());
  const seenCompanions = new Set<string>();
  for (const hitPath of currentHits) {
    const hitFile = path.relative(providerDir, hitPath);
    const hitResource = fileToResource.get(hitFile);
    if (!hitResource) continue;
    const companions = recommendedCompanions[hitResource];
    if (!companions) continue;

    // Determine companion boost amount based on how the source resource was hit.
    // exact_resource hits are high-confidence (user typed the resource name
    // literally) so companions deserve a stronger signal. primary_resource is
    // less certain. All other paths fall back to the legacy +20. Closes P5 C5.
    const hitReasons = new Set(
      scorer
        .toMap()
        .get(hitPath)
        ?.reasons.map((r) => r.kind) ?? [],
    );
    let companionBoost: number;
    if (hitReasons.has("exact_resource")) {
      companionBoost = 50; // exact_resource → companion boost (closes P5 C5)
    } else if (hitReasons.has("primary_resource")) {
      companionBoost = 30; // primary_resource → companion boost (secondary bump)
    } else {
      companionBoost = 20; // legacy flat boost for all other hit kinds
    }

    // Cap: companion contribution must not exceed 60% of the source resource's
    // raw score. This prevents companions from outranking their source resource.
    const sourceScore = scorer.toMap().get(hitPath)?.score ?? 0;
    const cappedBoost = Math.min(companionBoost, sourceScore * 0.6);

    for (const companion of companions) {
      const dedupKey = `${hitResource}|${companion}`;
      if (seenCompanions.has(dedupKey)) continue;
      seenCompanions.add(dedupKey);
      const entry = lookupAny(companion);
      if (entry) {
        scorer.add(
          fullPath(entry.file),
          cappedBoost,
          "recommended_companion",
          `${hitResource}→${companion}`,
        );
      }
    }
  }

  // ── alias-resource widening (concept aliases) ────────────────────────
  // Resources from matched aliases get a +60 boost so they're guaranteed in
  // top-K even if no other stage fired for them.
  if (args.aliasMatches && args.aliasMatches.length > 0) {
    const aliasSeen = new Set<string>();
    for (const a of args.aliasMatches) {
      for (const resName of a.resources) {
        const dedupKey = `${a.alias}|${resName}`;
        if (aliasSeen.has(dedupKey)) continue;
        aliasSeen.add(dedupKey);
        const entry = lookupAny(resName);
        if (entry) {
          scorer.add(fullPath(entry.file), 60, "alias_resource", `${a.alias}→${resName}`);
        }
      }
    }
  }

  return scorer.toMap();
}
