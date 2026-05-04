import type { Buffer } from "node:buffer";
import { verify } from "sigstore";
import { VegaStackError } from "./errors.js";

const REGISTRY_ISSUER = "https://token.actions.githubusercontent.com";
const REGISTRY_IDENTITY_RE =
  "^https://github\\.com/VegaStack/vegastack-cli-registry/\\.github/workflows/sync_registry\\.yml@refs/(heads/main|tags/v.+)$";

export async function verifyRegistryCatalogSignature(args: {
  catalogBytes: Buffer;
  signatureText: string;
  catalogUrl: string;
}): Promise<void> {
  if (process.env.VEGASTACK_REGISTRY_VERIFY === "0") return;

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
