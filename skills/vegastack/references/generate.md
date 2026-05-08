# /vegastack generate

Use this when the user wants ops files created, such as workflows, Dockerfiles, Compose files, Kubernetes manifests, or deploy config.

Flow:

1. Run `vegastack generate <intent> --agent`; the CLI caches fresh detection and includes fresh detection in the contract.
2. If `status` is `needs_input`, ask the required questions before writing files.
3. Run every command in `lookup_plan`.
4. Write files using agent editing tools, following `constraints` and detected commands exactly.
5. Run validation commands and `vegastack scan --staged`.

Common intent words include `github-action`, `gitlab-ci`, `dockerfile`, `compose`, `kubernetes`, `vercel`, `cloudflare`, and deployment targets or file types in the user's words. The CLI returns `files[]`, `lookup_plan[]`, `validation[]`, `required_questions[]`, and `agent_instructions[]`; follow those fields rather than guessing templates.

If the user only asks for a generated contract or includes `--agent`, stop after returning/summarizing the contract. Do not write files unless the user asks you to create or update them.

VegaStack generates the contract. The agent writes files.
