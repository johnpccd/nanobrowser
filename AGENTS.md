# Agent instructions (Nanobrowser)

## Primary development guide

Follow **[CLAUDE.md](./CLAUDE.md)** for build commands, monorepo layout, i18n conventions, code quality, and security rules.

## Project documentation (`docs/`)

**Always consult and keep `docs/` in sync with the codebase.**

Before implementing or reviewing changes—especially to **QA Mode** (side-panel chat, tools, personas, Foundry, MCP, settings)—read the relevant docs:

| Document | Purpose |
|----------|---------|
| [docs/architecture.md](./docs/architecture.md) | How QA Mode is structured: components, data flow, storage, messaging, tools |
| [docs/prd.md](./docs/prd.md) | Product requirements, user stories, acceptance criteria for QA Mode |

Automation-agent (Planner / Navigator / Validator) behavior is out of scope for those files unless you are explicitly extending that area and updating the docs accordingly.

### When to update `docs/`

Update `docs/architecture.md` and/or `docs/prd.md` in the **same change** whenever you:

- Add, remove, or change QA features, settings, or user-visible behavior
- Change the `qa_query` flow, streaming protocol, or port message types
- Add or modify tools (built-in, MCP, Foundry), personas, or model selection
- Change storage keys, session/message shape, or configuration defaults
- Refactor modules listed in the architecture “Related files” section in a way that changes responsibilities or boundaries

If a change is trivial (typo, comment-only, pure test with no behavior change), doc updates are optional.

### How to update

1. Read the affected doc(s) first so new work matches documented design.
2. After code changes, edit the doc(s) so they reflect **current** behavior—not aspirational design.
3. Keep [architecture.md](./docs/architecture.md) factual (what exists and how it connects).
4. Keep [prd.md](./docs/prd.md) aligned with user-facing requirements and acceptance criteria.
5. Do not duplicate full content from `CLAUDE.md`; link to it for dev workflow and point here for product/architecture.

### New documentation

If you introduce a major new area (e.g. a third side-panel mode or a new top-level subsystem), add a focused markdown file under `docs/` and link it from this section and from `architecture.md` as appropriate. Ask before adding unrelated doc types (ADRs, runbooks) unless the user requests them.
