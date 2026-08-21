# Planning

Use `planning/` for repository-level implementation plans, rollout plans, investigations, and other maintained planning work that is not product documentation.

## Planning mechanism

- Create one folder per initiative under `planning/`.
- Put the main plan in `README.md` inside that folder.
- Keep plans decision-oriented: scope, constraints, options, chosen direction, risks, ordered execution, and exit criteria.
- A plan can ship as a single PR. Split it only when the work would otherwise produce a large or mixed-concern PR.
- Update the same plan as decisions change instead of scattering notes across the repository.
- Resolve facts from the repository or public documentation. Put unresolved material decisions under `## Open questions`.
- A plan is implementation-ready only when every material assumption is resolved or recorded as an explicit open question.

## Conventions

- **English only**: plan content, supporting files, diagrams, and file names.
- **Folder name**: descriptive `kebab-case`, without dates or numeric prefixes.
- **Supporting files**: keep research notes, diagrams, and fixtures beside the initiative's `README.md`.
- **Public sources only**: do not include private-repository paths, implementation details, identifiers, or planning content.

## Plan structure

Each initiative plan should contain, when relevant:

1. Metadata (`Status`, `Owner`, and `Last updated`)
2. Goal
3. Scope
4. Current state
5. Constraints
6. Options considered
7. Chosen direction
8. Risks and mitigations
9. Execution
10. Open questions
11. Exit criteria
12. Change log

Do not keep empty sections or placeholder questions.

## Status guidance

Use one of:

- `Draft`
- `In progress`
- `Blocked`
- `Done`

`Draft` can contain open questions, but it is not ready for implementation while material questions remain.

## Lifecycle

When the final planned change lands, delete the completed initiative folder unless the user explicitly requests a historical record. Git history preserves completed plans.
