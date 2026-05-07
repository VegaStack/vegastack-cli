// Worker-native middleware for vegastack-mcp.
//
// Two responsibilities (audit issue #77):
//
//   1. Rate-limit  — token-bucket keyed on cf-connecting-ip + colo. Default
//      60 req/min/IP, configurable via the RATE_LIMIT_PER_MIN env var.
//      In-memory, per-isolate. Acceptable for v0.1 (best-effort): a determined
//      attacker can hop isolates, but the abuse case we care about — a single
//      misbehaving client looping a tool — is killed effectively.
//
//   2. Bearer-token — opt-in via REQUIRE_AUTH=true. Compares Authorization
//      header against MCP_AUTH_TOKEN in constant time. Fails closed if
//      REQUIRE_AUTH=true but MCP_AUTH_TOKEN is empty.
//
// Both helpers return `Response | null`. `null` means "let the request
// through"; a Response means "short-circuit with this".
//
// No Node-only APIs. Uses TextEncoder (available in Workers and Node ≥ 16).

export interface RateLimitOptions {
  /** Max requests per IP per 60-second window. */
  limitPerMin: number;
}

interface Bucket {
  /** Tokens remaining in the current window. */
  tokens: number;
  /** Epoch-ms when the current window expires. */
  resetAt: number;
}

/**
 * Build a token-bucket rate-limiter middleware.
 *
 * Returns a function `(req) => Response | null`. The returned function is
 * stateful: callers should construct one per Worker isolate (i.e. once at
 * module scope) so the buckets persist across requests in the same isolate.
 */
export function createRateLimiter(
  opts: RateLimitOptions,
): (req: Request) => Promise<Response | null> {
  const limit = Math.max(1, Math.floor(opts.limitPerMin));
  const windowMs = 60_000;
  const buckets = new Map<string, Bucket>();

  return async (req: Request): Promise<Response | null> => {
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    // cf-ray looks like "8a1b2c3d4e5f6789-IAD" — last segment is the colo.
    const ray = req.headers.get("cf-ray") ?? "";
    const colo = ray.includes("-") ? ray.slice(ray.lastIndexOf("-") + 1) : ray;
    const key = `${ip}|${colo}`;

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { tokens: limit, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          message: `Too many requests. Limit ${limit}/min per IP.`,
          retry_after_seconds: retryAfterSec,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
          },
        },
      );
    }

    bucket.tokens -= 1;
    return null;
  };
}

export interface BearerAuthOptions {
  requireAuth: boolean;
  expectedToken: string;
}

/**
 * Build a bearer-auth middleware. No-op unless `requireAuth === true`.
 *
 * Comparison is constant-time to avoid leaking token prefixes via timing.
 */
export function createBearerAuth(
  opts: BearerAuthOptions,
): (req: Request) => Promise<Response | null> {
  return async (req: Request): Promise<Response | null> => {
    if (!opts.requireAuth) return null;

    if (!opts.expectedToken || opts.expectedToken.length === 0) {
      // Misconfigured. Fail closed loudly rather than silently allow.
      return jsonError(500, "auth_misconfigured", "REQUIRE_AUTH=true but MCP_AUTH_TOKEN is empty");
    }

    const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!header) return unauthorized("missing Authorization header");

    // Must be exactly "Bearer <token>" — leading "Bearer " (case-insensitive),
    // followed by a non-empty token.
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return unauthorized("malformed Authorization header");
    const presented = m[1]!.trim();
    if (presented.length === 0) return unauthorized("empty bearer token");

    if (!constantTimeEqual(presented, opts.expectedToken)) {
      return unauthorized("invalid bearer token");
    }
    return null;
  };
}

function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized", message: reason }), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": 'Bearer realm="vegastack-mcp"',
    },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Constant-time string compare. Uses byte-length-equalised XOR-OR accumulator
 * so that runtime depends only on the longer string's length, never on the
 * position of the first mismatching byte.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Equalise length so the loop runs the same number of iterations for any
  // wrong-length input. We still record the length-mismatch as a non-zero
  // diff bit so the comparison fails.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const av = i < ab.length ? ab[i]! : 0;
    const bv = i < bb.length ? bb[i]! : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

/** Read rate-limit + bearer-auth config off the Env. */
export function readMiddlewareConfig(env: {
  RATE_LIMIT_PER_MIN?: string;
  REQUIRE_AUTH?: string;
  MCP_AUTH_TOKEN?: string;
}): { limitPerMin: number; requireAuth: boolean; expectedToken: string } {
  const parsed = Number.parseInt(env.RATE_LIMIT_PER_MIN ?? "", 10);
  const limitPerMin = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
  const requireAuth = (env.REQUIRE_AUTH ?? "").toLowerCase() === "true";
  const expectedToken = env.MCP_AUTH_TOKEN ?? "";
  return { limitPerMin, requireAuth, expectedToken };
}
