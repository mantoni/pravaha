---
Kind: contract
Id: rename-plugin-local-directory-key
Status: done
Decided by:
  - docs/decisions/runtime/pluggable-step-plugins-and-signal-contracts.md
Root flow: docs/flows/implement-task.yaml
---

# Rename Plugin Local Directory Key

## Intent

- Rename the Pravaha config key for repo-local plugin lookup from
  `plugins.local_directory` to `plugins.dir`.
- Keep the repo-local plugin loading contract explicit and executable through
  the checked-in implementation flow.

## Outputs

- One implementation task that updates config parsing, validation, fixtures, and
  checked-in config to use `plugins.dir`.
- Preserved behavior for loading `local/<name>` plugins from the configured
  repo-local directory after the rename.

## Review Gate

- The repo accepts `plugins.dir` as the checked-in config key for repo-local
  plugin resolution.
- The checked-in config, tests, and docs no longer depend on
  `plugins.local_directory`.
- `npm run all` passes.
