#!/usr/bin/env node
// Postinstall intentionally does not download Registry content.
//
// Registry entries are installed explicitly with:
//   vegastack init
//
// This keeps npm install fast and avoids writing large docs into user caches
// before a project selects which entries it needs.

if (process.env.VEGASTACK_SKIP_POSTINSTALL === "1") {
  process.stderr.write("vegastack postinstall: VEGASTACK_SKIP_POSTINSTALL=1 set; nothing to do.\n");
} else {
  process.stderr.write(
    "vegastack postinstall: does not download Registry data; run `vegastack init` in a project.\n",
  );
}
