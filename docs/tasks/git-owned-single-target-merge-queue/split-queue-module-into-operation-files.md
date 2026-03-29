---
Kind: task
Id: split-queue-module-into-operation-files
Status: ready
Tracked in: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Implements: docs/contracts/runtime/git-owned-single-target-merge-queue.md
Decided by:
  - docs/decisions/runtime/git-owned-single-target-merge-queue.md
---

# Split Queue Module Into Operation Files

- Split `lib/queue/queue.js` into smaller operation-focused modules for queue
  handoff, init, sync, pull, publish, and shared queue helpers.
- Keep the current queue public surface stable so existing imports can continue
  to resolve through `lib/queue/queue.js`.
- Split `lib/queue/queue.test.js` into per-operation test files that mirror the
  new implementation layout.
- Extract only the shared test helpers that are needed across multiple queue
  operation suites instead of keeping one monolithic test file.
- Preserve current queue behavior and coverage while reducing per-file size and
  review overhead.
