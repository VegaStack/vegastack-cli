# /vegastack preview and /vegastack tunnel

Use this for local app previews and temporary Cloudflare Tunnel URLs.

Flow:

1. If the app is already running, use `vegastack preview --url <local-url>`.
2. If VegaStack should start the app, use `vegastack preview --command "<dev command>" --port <port>`.
3. For a temporary Cloudflare Quick Tunnel, add `--tunnel`.
4. For custom hostnames, add `--hostname <hostname>` only after confirming the user controls the Cloudflare zone and is logged in.
5. Use `--agent` when the returned URL should be parsed.

`/vegastack tunnel` is a skill alias only. The CLI command is always `vegastack preview --tunnel`; never run `vegastack tunnel`.

Disclose that Quick Tunnels are temporary development previews, not production hosting. Custom hostnames require Cloudflare login and a domain/zone the user controls.
