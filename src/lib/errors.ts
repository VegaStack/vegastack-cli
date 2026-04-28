// Errors as types. Every error a command can produce is a VegastackError variant
// with a stable exit code and a human-readable hint(). Calling code throws a
// VegastackError; the top-level handler in cli.ts catches it and renders.
//
// Why discriminated union over class hierarchy:
//   - `kind` is serializable for `--json` mode and tests.
//   - Exhaustive `switch (e.kind)` over the union catches new variants at
//     compile time when we extend it.
//   - The hint() table lives next to the variants, so adding a new error
//     means adding both the data and the recovery message together.

export type VegastackErrorKind =
  | "BundleMissing"
  | "BundleCorrupt"
  | "BundleVersionMismatch"
  | "NetworkError"
  | "ChecksumMismatch"
  | "AgentInstallError"
  | "ValidationError"
  | "DiscoverError"
  | "PythonMissing"
  | "Unsupported"
  | "Unknown";

/** Stable exit-code mapping. Documented; do not reorder. */
export const EXIT_CODES: Readonly<Record<VegastackErrorKind, number>> = Object.freeze({
  BundleMissing: 4,
  BundleCorrupt: 5,
  BundleVersionMismatch: 6,
  NetworkError: 7,
  ChecksumMismatch: 8,
  AgentInstallError: 9,
  ValidationError: 10,
  DiscoverError: 2,
  PythonMissing: 11,
  Unsupported: 12,
  Unknown: 1,
});

export interface VegastackErrorJson {
  kind: VegastackErrorKind;
  message: string;
  exitCode: number;
  hint: string;
  cause?: string;
  context?: Record<string, unknown>;
}

/** Single concrete error type. We use a class so `instanceof` works at the boundary. */
export class VegastackError extends Error {
  readonly kind: VegastackErrorKind;
  readonly exitCode: number;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    kind: VegastackErrorKind,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "VegastackError";
    this.kind = kind;
    this.exitCode = EXIT_CODES[kind];
    this.context = Object.freeze({ ...(options?.context ?? {}) });
    if (options?.cause !== undefined) {
      // `Error.cause` is the standard ES2022 chain pointer.
      (this as unknown as { cause: unknown }).cause = options.cause;
    }
  }

  /** Human-readable recovery suggestion. Renders as the third line of error output. */
  hint(): string {
    return hintFor(this.kind, this.context);
  }

  toJSON(): VegastackErrorJson {
    const out: VegastackErrorJson = {
      kind: this.kind,
      message: this.message,
      exitCode: this.exitCode,
      hint: this.hint(),
    };
    if (Object.keys(this.context).length > 0) out.context = { ...this.context };
    const cause = (this as unknown as { cause?: unknown }).cause;
    if (cause !== undefined) out.cause = cause instanceof Error ? cause.message : String(cause);
    return out;
  }
}

/** Wrap an unknown thrown value into a VegastackError. */
export function asVegastackError(e: unknown): VegastackError {
  if (e instanceof VegastackError) return e;
  if (e instanceof Error) {
    return new VegastackError("Unknown", e.message, { cause: e });
  }
  return new VegastackError("Unknown", String(e));
}

// ── hint() table ──────────────────────────────────────────────────
// Keep these short and actionable. Each one answers "what should the user do?"

function hintFor(kind: VegastackErrorKind, ctx: Readonly<Record<string, unknown>>): string {
  switch (kind) {
    case "BundleMissing":
      return "Run `vegastack install` to download the docs bundle, or set VEGASTACK_BUNDLE_DIR to an existing bundle.";
    case "BundleCorrupt":
      return "The bundle on disk is invalid. Re-download with `vegastack refresh`. If the problem persists, file a bug with `vegastack doctor --json`.";
    case "BundleVersionMismatch":
      return `The installed bundle is not compatible with this CLI version (expected schema_version=${
        typeof ctx.expected === "number" ? ctx.expected : "?"
      }, got ${typeof ctx.actual === "number" ? ctx.actual : "?"}). Run \`vegastack refresh\` to pull a matching bundle.`;
    case "NetworkError":
      return "Check your network connection. If you're behind a corporate proxy, set HTTPS_PROXY (and NO_PROXY for excluded hosts), or use `VEGASTACK_BUNDLE_URL=file:///path/to/bundle.tar.gz` to install offline.";
    case "ChecksumMismatch":
      return "The downloaded bundle did not match its expected SHA256. This means a corrupt download or a tampered artifact — do NOT trust the bundle. Retry with `vegastack refresh`; if it persists, report security@vegastack.com.";
    case "AgentInstallError":
      return "The destination already exists or is not writable. Re-run with --force to overwrite, or pick a different --scope.";
    case "ValidationError":
      return "Check the input you passed. CLI args are validated for path traversal and control characters.";
    case "DiscoverError":
      return "The discovery harness exited non-zero. Run `vegastack doctor` to verify the bundle, then re-run with --raw if the issue persists.";
    case "PythonMissing":
      return "python3 (>= 3.9) was not found on PATH. The native TS discoverer doesn't need it; only the legacy --legacy-python flag (and bundle-build pipeline) do.";
    case "Unsupported":
      return "This environment is not supported. See the README's compatibility matrix.";
    case "Unknown":
      return "Run with --json for the structured error, or open an issue with `vegastack doctor --json` output.";
  }
}
