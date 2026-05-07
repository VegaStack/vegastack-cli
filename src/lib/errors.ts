// Errors as types. Every error a command can produce is a VegaStackError variant
// with a stable exit code and a human-readable hint(). Calling code throws a
// VegaStackError; the top-level handler in cli.ts catches it and renders.
//
// Why discriminated union over class hierarchy:
//   - `kind` is serializable for `--json` mode and tests.
//   - Exhaustive `switch (e.kind)` over the union catches new variants at
//     compile time when we extend it.
//   - The hint() table lives next to the variants, so adding a new error
//     means adding both the data and the recovery message together.

export type VegaStackErrorKind =
  | "RegistryEntryMissing"
  | "ArtifactCorrupt"
  | "RegistryVersionMismatch"
  | "NetworkError"
  | "ChecksumMismatch"
  | "AgentInstallError"
  | "ValidationError"
  | "DiscoverError"
  | "Ambiguous"
  | "PythonMissing"
  | "Unsupported"
  | "Unknown";

/** Stable exit-code mapping. Documented; do not reorder. */
export const EXIT_CODES: Readonly<Record<VegaStackErrorKind, number>> = Object.freeze({
  RegistryEntryMissing: 4,
  ArtifactCorrupt: 5,
  RegistryVersionMismatch: 6,
  NetworkError: 7,
  ChecksumMismatch: 8,
  AgentInstallError: 9,
  ValidationError: 10,
  DiscoverError: 2,
  Ambiguous: 3,
  PythonMissing: 11,
  Unsupported: 12,
  Unknown: 1,
});

export interface VegaStackErrorJson {
  kind: VegaStackErrorKind;
  message: string;
  exitCode: number;
  hint: string;
  cause?: string;
  context?: Record<string, unknown>;
}

/** Single concrete error type. We use a class so `instanceof` works at the boundary. */
export class VegaStackError extends Error {
  readonly kind: VegaStackErrorKind;
  readonly exitCode: number;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    kind: VegaStackErrorKind,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "VegaStackError";
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

  toJSON(): VegaStackErrorJson {
    const out: VegaStackErrorJson = {
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

/** Wrap an unknown thrown value into a VegaStackError. */
export function asVegaStackError(e: unknown): VegaStackError {
  if (e instanceof VegaStackError) return e;
  if (e instanceof Error) {
    return new VegaStackError("Unknown", e.message, { cause: e });
  }
  return new VegaStackError("Unknown", String(e));
}

// ── hint() table ──────────────────────────────────────────────────
// Keep these short and actionable. Each one answers "what should the user do?"

function hintFor(kind: VegaStackErrorKind, ctx: Readonly<Record<string, unknown>>): string {
  switch (kind) {
    case "RegistryEntryMissing":
      return "Run `vegastack init` to select and download Registry entries for this project.";
    case "ArtifactCorrupt":
      return "The Registry pack on disk is invalid. Re-download with `vegastack registry update --force`. If the problem persists, file a bug with `vegastack doctor --json`.";
    case "RegistryVersionMismatch":
      return `The installed Registry pack is not compatible with this CLI version (expected schema_version=${
        typeof ctx.expected === "number" ? ctx.expected : "?"
      }, got ${typeof ctx.actual === "number" ? ctx.actual : "?"}). Run \`vegastack registry update --force\` to pull a matching Registry pack.`;
    case "NetworkError":
      return "Check your network connection and confirm the VegaStack Registry is reachable.";
    case "ChecksumMismatch":
      return "The downloaded registry artifact did not match its expected SHA256. This means a corrupt download or a tampered artifact. Retry with `vegastack registry update --force`; if it persists, open an issue at https://github.com/vegastack/vegastack-cli/issues with `vegastack doctor --json`.";
    case "AgentInstallError":
      return "The destination already exists or is not writable. Re-run with --force to overwrite, or pick a different --scope.";
    case "ValidationError":
      return "Check the input you passed. CLI args are validated for path traversal and control characters.";
    case "DiscoverError":
      return "The discovery harness exited non-zero. Run `vegastack doctor` to verify the Registry pack, then re-run with --raw if the issue persists.";
    case "Ambiguous":
      return "The query matched more than one candidate. Disambiguate with a more specific term, or pass an explicit selector flag (e.g. `--tf-provider <name>` for terraform-discover).";
    case "PythonMissing":
      return "python3 is not required for the CLI. If you see this, a development-only script is being run in the wrong environment.";
    case "Unsupported":
      return "This environment is not supported. See the README's compatibility matrix.";
    case "Unknown":
      return "Run with --json for the structured error, or open an issue with `vegastack doctor --json` output.";
  }
}
