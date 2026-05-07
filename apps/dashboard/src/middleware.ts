/**
 * Defense-in-depth response headers for the eval dashboard.
 *
 * Astro middleware runs for every SSR route. Headers added here apply to
 * the rendered HTML and to /api/* JSON responses; static assets served by
 * the Cloudflare adapter's [assets] binding are unaffected (CF returns
 * those before the worker runs).
 *
 * CSP notes:
 *   - We currently rely on `'unsafe-inline'` for the theme-toggle inline
 *     script (`<script is:inline>` in ThemeToggle.astro) and inline
 *     styles emitted by Astro's `inlineStylesheets: "auto"` build option.
 *     TODO(F-csp-nonce): switch to a per-request nonce after Astro
 *     ships first-class nonce support for inline-styles, or refactor the
 *     theme-toggle to a non-inline module script. Once that's done,
 *     replace `'unsafe-inline'` with `'nonce-...'` in script-src/style-src.
 *   - The Inter web font lives at https://rsms.me/inter — allowlisted
 *     under style-src and font-src.
 */

import type { MiddlewareHandler } from "astro";

const CSP = [
  "default-src 'self'",
  // Inline theme-toggle + Astro's inline styles — see TODO above.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://rsms.me",
  "font-src 'self' https://rsms.me data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

export const onRequest: MiddlewareHandler = async (_ctx, next) => {
  const response = await next();
  // Only set on responses we actually mint. (Already-set values from a
  // route handler are preserved.)
  const h = response.headers;
  if (!h.has("content-security-policy")) h.set("content-security-policy", CSP);
  if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
  if (!h.has("referrer-policy")) h.set("referrer-policy", "strict-origin-when-cross-origin");
  if (!h.has("permissions-policy")) h.set("permissions-policy", PERMISSIONS_POLICY);
  return response;
};
