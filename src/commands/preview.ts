import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import {
  installCloudflared,
  quickTunnelNotice,
  resolveCloudflaredBin,
} from "../lib/cloudflared.js";
import { VegaStackError } from "../lib/errors.js";
import { log, printError } from "../lib/log.js";

export interface PreviewOptions {
  command?: string | undefined;
  url?: string | undefined;
  port?: number | undefined;
  tunnel: boolean;
  hostname?: string | undefined;
  tunnelName: string;
  timeout: number;
  json: boolean;
  yes: boolean;
  shell?: boolean | undefined;
  allowPrivateHost?: boolean | undefined;
}

/**
 * Validate `--url` against an allowlist (loopback only by default) to prevent
 * SSRF probes against link-local / RFC1918 / cloud-metadata services. Exported
 * for unit testing.
 */
export function validatePreviewUrl(rawUrl: string, opts: { allowPrivateHost?: boolean } = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new VegaStackError("ValidationError", `--url is not a valid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VegaStackError(
      "ValidationError",
      `--url must be http(s); got '${parsed.protocol}' in ${rawUrl}`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  const loopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "0.0.0.0";
  if (loopback) return parsed;
  if (opts.allowPrivateHost === true) return parsed;
  // Reject link-local (169.254.0.0/16, IPv6 fe80::/10) and RFC1918 ranges and
  // cloud metadata endpoints. Hostnames (non-IP) are also rejected unless the
  // operator passes --allow-private-host.
  throw new VegaStackError(
    "ValidationError",
    `--url '${rawUrl}' is not a loopback host; pass --allow-private-host to override (SSRF guard)`,
  );
}

const SHELL_METACHAR_RE = /[;&|`$<>()\n\r]/;
const DOUBLE_AMP_OR_PIPE_RE = /&&|\|\|/;

/**
 * Tokenize a `--command` string into an argv array without invoking a shell.
 * Honours single/double quoted segments. Refuses unquoted shell metacharacters
 * (`; & | ` $ < > ( )` and newlines) that would enable command injection if the
 * resulting string were re-evaluated by a shell.
 *
 * Exported for unit testing of the security boundary.
 */
export function parseCommandArgv(command: string): string[] {
  const argv: string[] = [];
  let i = 0;
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let curHasContent = false;
  while (i < command.length) {
    const ch = command[i]!;
    if (escape) {
      cur += ch;
      curHasContent = true;
      escape = false;
      i++;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escape = true;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      curHasContent = true;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      curHasContent = true;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (curHasContent) {
        argv.push(cur);
        cur = "";
        curHasContent = false;
      }
      i++;
      continue;
    }
    if (
      !inSingle &&
      !inDouble &&
      (SHELL_METACHAR_RE.test(ch) || command.slice(i, i + 2).match(DOUBLE_AMP_OR_PIPE_RE))
    ) {
      throw new VegaStackError(
        "ValidationError",
        `--command contains an unquoted shell metacharacter (${JSON.stringify(ch)}); pass --shell to opt-in to shell evaluation if intentional`,
      );
    }
    cur += ch;
    curHasContent = true;
    i++;
  }
  if (inSingle || inDouble) {
    throw new VegaStackError("ValidationError", "--command has an unterminated quoted string");
  }
  if (curHasContent) argv.push(cur);
  if (argv.length === 0) {
    throw new VegaStackError("ValidationError", "--command is empty");
  }
  return argv;
}

interface RunningPreview {
  localUrl: string;
  server: PreviewChild | null;
}

type PreviewChild = ChildProcessByStdio<null, Readable, Readable>;

export async function runPreview(opts: PreviewOptions): Promise<number> {
  const children: PreviewChild[] = [];
  try {
    const preview = await startLocalPreview(opts, children);
    const out: Record<string, unknown> = {
      local_url: preview.localUrl,
      tunnel: null,
    };

    if (opts.hostname ?? opts.tunnel) {
      const bin = await ensureCloudflared();
      const tunnel = opts.hostname
        ? await startNamedTunnel(bin, preview.localUrl, opts.hostname, opts.tunnelName, children)
        : await startQuickTunnel(bin, preview.localUrl, children);
      out.tunnel = tunnel;
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else {
      log.ok(`local preview: ${preview.localUrl}`);
      const tunnel = out.tunnel as { url?: string; hostname?: string; notice?: string } | null;
      if (tunnel?.url) log.ok(`temporary Cloudflare preview: ${tunnel.url}`);
      if (tunnel?.hostname) log.ok(`Cloudflare hostname: https://${tunnel.hostname}`);
      if (tunnel?.notice) log.warn(tunnel.notice);
    }

    if (children.length === 0) return 0;
    await waitForExit(children);
    return 0;
  } catch (e) {
    for (const child of children) killPreviewChild(child);
    return printError(e);
  }
}

async function startLocalPreview(
  opts: PreviewOptions,
  children: PreviewChild[],
): Promise<RunningPreview> {
  if (opts.url) {
    validatePreviewUrl(opts.url, { allowPrivateHost: opts.allowPrivateHost === true });
    await waitForUrl(opts.url, opts.timeout);
    return { localUrl: opts.url, server: null };
  }

  const command = opts.command ?? detectDevCommand(process.cwd());
  if (!command) {
    const port = opts.port ?? 3000;
    const url = `http://localhost:${port}`;
    await waitForUrl(url, opts.timeout);
    return { localUrl: url, server: null };
  }

  const server = spawnShell(command, opts.shell === true);
  children.push(server);
  pipeChild(server, "preview");
  const url = opts.port
    ? `http://localhost:${opts.port}`
    : await waitForServerUrl(server, opts.timeout);
  return { localUrl: url, server };
}

async function ensureCloudflared(): Promise<string> {
  const existing = resolveCloudflaredBin();
  if (existing) return existing;
  log.step("installing managed cloudflared for preview tunnels");
  return (await installCloudflared()).bin;
}

async function startQuickTunnel(
  bin: string,
  localUrl: string,
  children: PreviewChild[],
): Promise<{ mode: "quick"; url: string; notice: string }> {
  const child = spawn(bin, ["tunnel", "--url", localUrl], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const url = await waitForCloudflareUrl(child, 45);
  return { mode: "quick", url, notice: quickTunnelNotice() };
}

async function startNamedTunnel(
  bin: string,
  localUrl: string,
  hostname: string,
  tunnelName: string,
  children: PreviewChild[],
): Promise<{ mode: "named"; hostname: string; tunnel_name: string; notice: string }> {
  ensureCloudflareLogin(bin);
  ensureTunnel(bin, tunnelName);
  const route = spawnSync(bin, ["tunnel", "route", "dns", tunnelName, hostname], {
    encoding: "utf8",
  });
  if ((route.status ?? 0) !== 0) {
    throw new VegaStackError("Unknown", route.stderr || route.stdout || "failed to route DNS");
  }
  const child = spawn(bin, ["tunnel", "--url", localUrl, "run", tunnelName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  pipeChild(child, "cloudflared");
  return {
    mode: "named",
    hostname,
    tunnel_name: tunnelName,
    notice:
      "Custom hostnames require a Cloudflare account and a domain/zone you control. VegaStack uses cloudflared for tunnel auth and DNS routing.",
  };
}

function ensureCloudflareLogin(bin: string): void {
  const r = spawnSync(bin, ["tunnel", "list"], { encoding: "utf8" });
  if ((r.status ?? 0) === 0) return;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (/login|cert\.pem|not logged in|origin cert/i.test(output)) {
    throw new VegaStackError(
      "ValidationError",
      "Cloudflare login required for custom hostnames. Run `cloudflared tunnel login`, then retry.",
    );
  }
  throw new VegaStackError("Unknown", output || "failed to check Cloudflare tunnel login");
}

function ensureTunnel(bin: string, tunnelName: string): void {
  const list = spawnSync(bin, ["tunnel", "list"], { encoding: "utf8" });
  if ((list.status ?? 0) === 0 && (list.stdout ?? "").includes(tunnelName)) return;
  const create = spawnSync(bin, ["tunnel", "create", tunnelName], { encoding: "utf8" });
  if ((create.status ?? 0) !== 0 && !/already exists/i.test(`${create.stdout}${create.stderr}`)) {
    throw new VegaStackError(
      "Unknown",
      create.stderr || create.stdout || `failed to create tunnel ${tunnelName}`,
    );
  }
}

function detectDevCommand(cwd: string): string | null {
  const pkg = path.join(cwd, "package.json");
  try {
    const raw = JSON.parse(fs.readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> };
    if (raw.scripts?.dev) return `${detectPackageManager(cwd)} run dev`;
    if (raw.scripts?.start) return `${detectPackageManager(cwd)} run start`;
  } catch {
    // no package.json
  }
  return null;
}

function detectPackageManager(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock")))
    return "bun";
  return "npm";
}

function spawnShell(command: string, shell: boolean): PreviewChild {
  const env = { ...process.env, BROWSER: "none" };
  // detached:true puts the child in a new process group on POSIX so we can
  // signal the entire group (parent + grandchildren spawned by `npm run dev`,
  // `next dev`, etc.) via process.kill(-pid). On Windows detached has no
  // group semantics; we use taskkill /T in killPreviewChild() instead.
  const detached = process.platform !== "win32";
  if (shell) {
    log.warn(
      "preview --shell evaluates --command via the system shell; only use with trusted input",
    );
    return spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached,
    });
  }
  const argv = parseCommandArgv(command);
  return spawn(argv[0]!, argv.slice(1), {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    detached,
  });
}

/**
 * Terminate a preview child including any grandchildren. POSIX uses the
 * process group id (negative pid); Windows uses taskkill /T /F. Exported for
 * unit testing.
 */
// Accept any object with a `pid` and a `kill(signal?)` method. Using a wide
// `(...args: unknown[]) => boolean` lets us pass real `ChildProcess` objects
// (whose `kill` is typed with `NodeJS.Signals | number`) and test stubs.
interface KillableChild {
  pid?: number | undefined;
  kill(signal?: unknown): boolean;
}

export function killPreviewChild(child: KillableChild): void {
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
    return;
  }
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // taskkill missing — fall back to direct kill
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    return;
  }
  // POSIX: kill the process group (parent + descendants)
  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    // ESRCH (group exited) or EPERM — fall through
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function pipeChild(child: PreviewChild, label: string): void {
  child.stderr.on("data", (chunk: Buffer) =>
    process.stderr.write(`[${label}] ${chunk.toString("utf8")}`),
  );
  child.stdout.on("data", (chunk: Buffer) =>
    process.stderr.write(`[${label}] ${chunk.toString("utf8")}`),
  );
}

async function waitForServerUrl(child: PreviewChild, timeoutSeconds: number): Promise<string> {
  const urls: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/);
    if (match?.[0]) urls.push(match[0]);
  });
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (urls[0]) {
      await waitForUrl(urls[0], 3).catch(() => undefined);
      return urls[0];
    }
    const fallback = await firstHealthyUrl([3000, 5173, 4321, 8000]);
    if (fallback) return fallback;
    await sleep(250);
  }
  throw new VegaStackError("ValidationError", "preview server did not become ready in time");
}

async function firstHealthyUrl(ports: number[]): Promise<string | null> {
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      await waitForUrl(url, 0.2);
      return url;
    } catch {
      // try next
    }
  }
  return null;
}

async function waitForUrl(url: string, timeoutSeconds: number): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() <= deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) return;
    } catch {
      // keep waiting
    }
    await sleep(250);
  }
  throw new VegaStackError("ValidationError", `local preview URL did not respond: ${url}`);
}

async function waitForCloudflareUrl(child: PreviewChild, timeoutSeconds: number): Promise<string> {
  const seen: string[] = [];
  const collect = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    process.stderr.write(`[cloudflared] ${text}`);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match?.[0]) seen.push(match[0]);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (seen[0]) return seen[0];
    await sleep(250);
  }
  throw new VegaStackError("ValidationError", "cloudflared did not print a Quick Tunnel URL");
}

async function waitForExit(children: PreviewChild[]): Promise<void> {
  if (children.some((child) => child.exitCode !== null || child.signalCode !== null)) return;
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      for (const child of children) killPreviewChild(child);
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    for (const child of children) child.once("exit", () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
