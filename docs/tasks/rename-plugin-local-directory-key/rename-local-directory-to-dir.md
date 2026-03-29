---
Kind: task
Id: rename-local-directory-to-dir
Status: ready
Tracked in: docs/contracts/runtime/rename-plugin-local-directory-key.md
Implements: docs/contracts/runtime/rename-plugin-local-directory-key.md
Decided by:
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
---

# Rename `local_directory` To `dir`

- In the Pravaha config file, rename `plugins.local_directory` to `plugins.dir`.
- Update config parsing and validation so repo-local plugin loading continues to
  work with the renamed key.
- Update checked-in config, fixtures, tests, and docs that still reference
  `local_directory`.
- Preserve the current default repo-local plugin directory behavior when the
  config omits the key.
