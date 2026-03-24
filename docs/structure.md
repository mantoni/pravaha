# Docs Structure

- Kind: convention
- Status: active

- `docs/pravaha.md`: Product definition.
- `docs/structure.md`: Repo documentation map for humans and agents.
- `docs/decisions/`: Decision records.
- `docs/roadmap/`: Milestone and version roadmaps.
- `docs/plans/<version>/`: Change-level implementation plans.
- `docs/tasks/<version>/`: Work items grouped by version.
- `docs/conventions/`: Naming, config, graph, CLI, output conventions.
- `docs/research/`: Exploratory notes.

- One decision per file.
- One roadmap per milestone or version.
- One plan per change.
- One conventions file per topic or version.
- Prefer append-only decisions.
- Prefer short files.
- Prefer examples over prose.

```mermaid
graph TD
  A["docs/pravaha.md"]
  B["docs/structure.md"]
  C["docs/decisions/"]
  D["docs/roadmap/"]
  E["docs/plans/<version>/"]
  F["docs/tasks/<version>/"]
  G["docs/conventions/"]
  H["docs/research/"]

  A --> B
  B --> C
  B --> D
  B --> E
  B --> F
  B --> G
  B --> H
```
