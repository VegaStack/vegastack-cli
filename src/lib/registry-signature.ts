import type { Buffer } from "node:buffer";
import { VegaStackError } from "./errors.js";

const REGISTRY_ISSUER = "https://token.actions.githubusercontent.com";
const REGISTRY_IDENTITY_RE =
  "^https://github\\.com/(VegaStack|vegastack)/vegastack-cli-registry/\\.github/workflows/sync_registry\\.yml@refs/(heads/main|tags/v.+)$";

// Module-scoped flag so the disabled-verify warning is emitted at most once
// per CLI process, even if multiple registry catalogs are verified in a run.
let disabledWarningEmitted = false;

export async function verifyRegistryCatalogSignature(args: {
  catalogBytes: Buffer;
  signatureText: string;
  catalogUrl: string;
}): Promise<void> {
  if (process.env.VEGASTACK_REGISTRY_VERIFY === "0") {
    if (!disabledWarningEmitted) {
      process.stderr.write(
        "warning: VEGASTACK_REGISTRY_VERIFY=0 — Sigstore signature verification is disabled. " +
          "Catalog integrity is no longer cryptographically attested.\n",
      );
      disabledWarningEmitted = true;
    }
    return;
  }
  // Lazy-load sigstore so the ~50ms module-init cost is paid only when we
  // actually need to verify a signature — not on every `vegastack --help`.
  const { verify } = await import("sigstore");

  let signature: unknown;
  try {
    signature = JSON.parse(args.signatureText) as unknown;
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", "Registry signature is not valid JSON", {
      cause: e,
      context: { catalog: args.catalogUrl },
    });
  }

  try {
    await verify(signature as never, args.catalogBytes, {
      certificateIssuer: REGISTRY_ISSUER,
      certificateIdentityURIRegExp: REGISTRY_IDENTITY_RE,
    } as never);
  } catch (e) {
    throw new VegaStackError("ChecksumMismatch", "Registry catalog signature verification failed", {
      cause: e,
      context: {
        catalog: args.catalogUrl,
        issuer: REGISTRY_ISSUER,
        identity: REGISTRY_IDENTITY_RE,
      },
    });
  }
}
