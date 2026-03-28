---
Kind: reference
Id: runtime-glossary
Status: active
Tracked in: docs/plans/repo/v0.1/pravaha-flow-runtime.md
---

# Runtime Glossary

## Terms

| Term           | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Contract       | The portable workflow document that expresses intent, constraints, review gates, and the root flow reference |
| Flow           | A YAML Patram document that defines Pravaha jobs and steps                                                   |
| Root work item | The durable document that owns a flow instance, bound as `document`                                          |
| Leaseable unit | The durable document class that may be acquired for execution when semantically ready                        |
| Job            | A named unit of flow execution that may fan out across selected durable documents                            |
| Step           | One plugin-backed or command-backed operation executed during a job visit                                    |
| Run snapshot   | The canonical machine-local durable record for one live task run at the latest completed checkpoint          |
| Wait state     | The embedded durable gate inside a run snapshot that blocks continuation on human input                      |
| Worktree       | A git checkout slot used to isolate one leased document at a time                                            |
| Worker         | One supervised local Codex run tied to a leased document and worktree                                        |
| Semantic state | A scheduler-facing meaning such as `ready`, `review`, or `done`, mapped onto repository status values        |
