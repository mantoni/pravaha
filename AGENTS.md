# Agents

> Pravaha turns human workflow into explicit contracts that agents can execute.

Use `patram` to orient in the repo based on the user's request.

- Start with `npx patram queries`.
- Use `change-queue` to see active workflow items across contracts, tasks, and
  decisions.
- Use `active-contracts` to orient on the governing contract for a request.
- Use `ready-tasks` to find executable decomposed work.
- Use `contracts-missing-decisions` when a contract exists but the human choice
  surface is not explicit yet.
- Use `decision-backlog`, `blocked-work`, `review-queue`, and `orphan-tasks`
  when the workflow stage matches those names.
- For a specific document or work item, use `npx patram show <repo-path>` and
  exact relation-target queries such as `tracked_in=contract:<slug>` or
  `decided_by=decision:<slug>`.
- For validation, use `npx patram check <path>`.

## Interaction Style

- Do not make code changes when the users wants your opinion, suggestions or
  asks a question.
- Use code, JSON and mermaid graphs in communication and documentation.
- Never repurpose existing files unless explicitly approved by the user.
- Change size should align with the request. Simple request = simple change.
- Prefer front matter for workflow metadata.
- Avoid free-form `Label: value` prose lines in workflow docs because Patram may
  parse them as visible directives.

## Process

- Docs first.
- Record durable workflow decisions in `docs/decisions/`.
- Record repo implementation plans in `docs/plans/repo/<version>/`.
- Use `v<major>.<minor>` for repo plan version directories such as `v0.1` or
  `v1.0`.
- Record workflow and metadata conventions in `docs/conventions/`.
- Treat `docs/contracts/` as the primary executable work items.
- Add `docs/tasks/` only when a contract needs decomposition or parallel agent
  execution.
- Group contract tasks under `docs/tasks/<contract-slug>/`.
- Keep review gates inside contract documents.
- Use front matter metadata with `Kind`, `Id`, `Status`, and relation directives
  such as `Tracked in`, `Decided by`, `Depends on`, and `Implements`.
- Do not implement before the governing decision or contract is documented.
- TDD is required for code changes.
- Use red, green, refactor.

## Coding Standards

- Use **ECMAScript modules** and modern JavaScript (ES2023+) features.
- Use `PascalCase` for **classes** and **interfaces**.
- Use `camelCase` for **functions** and **methods**.
- Use `lower_snake_case` for **variables and parameters**, except it refers to a
  class or function.
- Use `UPPER_SNAKE_CASE` for **constants**.
- Use `kebab-case` for **file and directory names**.
- Use `.js` files for all runtime code with JSDoc type annotations (TypeScript
  mode).
- Use `.ts` files **only** for interface and type definitions. These files must
  not contain runtime code or side effects.
- JSDoc type imports go into a block at the top of the file.
- Add JSDoc to all functions and methods:
  - Declare all parameters with `@param`.
  - Add `@returns` only when the return type is **not self-evident** from the
    code (e.g., complex conditionals, unions, or context-dependent types). Omit
    it when the return value is **clear and unambiguous** from the function body
    or signature.
  - Description and tags must be separated by a blank line.
- If a local variable’s type may change, or is initialized as an empty
  collection (`{}`, `[]`, `new Set()`, `new Map()`), add a `@type` JSDoc
  annotation to specify the intended type. This applies to both `let` and
  `const` when inference is ambiguous.
- Use braces for all control flow statements, even single-line bodies.
- Use optional chaining (`?.`, `??`, etc.) only when a value is **intentionally
  nullable**. Prefer explicit type narrowing to guarantee value safety.
- Surface programming errors: Never wrap code that may throw in try/catch to
  silence failures.
- Use function hoisting to organize code: Declare all functions at the bottom of
  the file, after the main logic.
- Use early returns to reduce nesting and improve readability.
- When building objects with optional fields, prefer explicit object
  construction plus `if` assignments over conditional object spreads. Use early
  returns when different cases produce materially different shapes.

## Mandatory Validation

For quick checks on touches files or directories:

- Run tests with `npx vitest run <path>`.
- Type check with `npx tsc`.
- Lint with `npx eslint --fix <files>` on touched `*.{js,ts}`.
- Format with `npx prettier --write <files>` on touched `*.{js,ts,json,md}`.

Before handing off always run `npm run all`.

## Committing

- Commit your work. Create separate commits for every unit of work.
- Commit message subject must use the imperative mood. The first word must start
  with a capital letter.
- When asked to make corrections, create fixup commits.
