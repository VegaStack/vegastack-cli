# /vegastack doctor

Use this to verify environment health, Registry cache state, managed tools, scan setup, and agent registration.

Flow:

1. Run `vegastack doctor --json`.
2. If Registry verification is needed, run `vegastack doctor --verify-registry --json`.
3. Summarize failing checks first.
4. Provide the exact corrective VegaStack command, such as `vegastack init`, `vegastack registry update`, `vegastack update`, or `vegastack skills reconcile`.

Doctor returns a non-zero exit when checks fail, but stdout can still be valid JSON. Parse and summarize that JSON instead of treating non-zero exit as no result.

Do not mutate the project from doctor unless the user asks for the fix to be applied.
