# Product Requirements Document — QA Mode

## Document status

| Field | Value |
|-------|--------|
| Product | Nanobrowser — QA Mode |
| Scope | In-browser AI Q&A assistant (this PRD excludes Automation Agent / multi-agent web automation) |
| Platform | Chrome and Edge (Chromium MV3 extension) |

## Problem statement

Users want a **private, self-hosted-friendly AI assistant inside the browser** that can:

- Answer questions about what they are looking at (current tab).
- Continue multi-turn conversations with history.
- Optionally reach the public web or enterprise tools without leaving the extension.
- Use their own LLM API keys or Azure Foundry agents.

Commercial “browser operator” products often charge subscription fees, run automation in opaque clouds, and optimize for task execution rather than fast Q&A. QA Mode targets **grounded chat** first.

## Product vision

**QA Mode** is a side-panel conversational assistant that runs locally in the extension, streams answers in real time, and composes context from: user messages, optional page markdown, optional screenshots, configured personas, and optional tools (search, URL reading, MCP).

Success means a user can install Nanobrowser, configure one QA model, and get accurate answers about the open page—or general knowledge with web assist—without enabling browser automation.

## Goals

1. **Low-latency Q&A** — Streaming responses with cancel/stop support.
2. **Tab-grounded answers** — Optional inclusion of current page content as markdown context.
3. **User control of models and behavior** — Provider/model selection, personas, tool budgets.
4. **Extensibility** — MCP tools and Azure Foundry agents as alternate backends.
5. **Privacy** — Keys and history stay in the browser; no required vendor backend.

## Non-goals (explicit)

- Multi-step web automation (Planner / Navigator / Validator workflows).
- DOM action execution (click, type, navigate) as part of QA turns.
- Cloud-hosted Nanobrowser account or centralized chat storage.
- Built-in SearXNG or MCP servers (user must configure endpoints).

## User personas

| Persona | Needs |
|---------|--------|
| **Researcher** | Summarize articles, compare pages, follow-up questions on same tab |
| **Developer** | Ask about docs open in a tab; attach screenshots of UI errors |
| **Power user** | Swap models, tune tool limits, wire SearXNG + MCP for internal APIs |
| **Enterprise user** | Select Azure Foundry agent personas (`AzF:`) with project-scoped keys |

## Core user stories

### Chat and sessions

- As a user, I can open the side panel and chat in **QA Mode** so that I get direct answers instead of automation tasks.
- As a user, I can start a **new chat** or continue a **follow-up** in the same session so that context is preserved.
- As a user, I can view **chat history** per tab and reopen past sessions.
- As a user, I can **stop** a streaming reply so that a long or unwanted generation ends immediately.

### Page grounding

- As a user, I can toggle **Include page content** so that the model sees markdown from the active tab (or turn it off for generic chat).
- As a user, I can **capture one or more screenshots** and send them with a message so that vision-capable QA models can analyze images.

### Models and personas

- As a user, I can select a **QA model** (provider + model name) from the side-panel toolbar without opening full settings.
- As a user, I can choose a **persona** (system prompt preset) to change tone, role, or instructions.
- As a user, I can configure the default QA model under **Settings → Models → QA**.
- As a user, I can create/edit **personas** under **Settings → Personas**.

### Web assist

- As a user, I can enable **web search** for a turn (toolbar toggle) so the model may call `web_search` when SearXNG is configured.
- As a user, I can configure **SearXNG base URL** (and optional API key, max results) in General settings.
- As a user, I can allow **`fetch_url`** so the model can read a specific public URL via Jina Reader when web assist is on.
- As a user, I expect vague prompts like “look that up online” to be resolved into concrete queries by the model (prompted behavior, not a separate UI step).

### Tools and MCP

- As a user, I can open the **tools menu** in QA chat to see built-in tools (thinking, web search, fetch URL) and discovered MCP tools.
- As a user, I can enable/disable **individual MCP tools** per server without editing JSON.
- As a user, I can configure **MCP servers** (Streamable HTTP or legacy SSE) in Settings → MCP.
- As a user, I see **tool call progress** inline (pending → success/error) and tool output in the thread for transparency.

### Azure Foundry

- As a user, I can register **Azure Foundry agents** (project endpoint, agent name, API key) in Settings → Azure Foundry.
- As a user, I can pick a Foundry agent from the persona list (`AzF:` prefix) so answers come from the hosted agent responses API.
- As a user, I understand that **tools are disabled** when a Foundry agent is selected.

### Appearance

- As a user, I can customize **QA mode colors and fonts** in General settings so the side panel matches my preference.
- As a user, I expect appearance changes when I return to the side panel after saving settings.

## Functional requirements

### FR-1 Mode selection

- The side panel shall offer **QA Mode** and **Automation Agent**; QA is the default for new tabs (`tabModes` default `qa`).
- Mode shall persist per browser tab.

### FR-2 Message send pipeline

- Sending a message shall create or reuse a `chatHistoryStore` session bound to the tab when appropriate.
- User messages shall be stored before the background query runs.
- The background shall receive `qa_query` with session id, tab id, query text, flags, and persona/Foundry metadata.

### FR-3 Streaming responses

- The background shall emit chunked text (`qa_response_chunk`) and a completion event.
- Errors shall surface as `qa_response_error` with a user-readable message.
- A new query on the same tab shall abort the previous stream.

### FR-4 Page content

- When `includePageContent` is true, the system shall extract markdown from the target tab for the system/foundry prompt.
- When false, prompts shall not include page markdown (generic assistant behavior).

### FR-5 Vision

- Messages may attach one or more JPEG base64 images (`imageDataList`, with legacy `imageData` support).
- History replay shall pass images to multimodal-capable models.

### FR-6 LLM path

- QA shall require a configured `AgentNameEnum.QA` model and valid provider credentials.
- The system shall support tool calling when the model implements `bindTools`.
- Tool loops shall enforce configurable caps: thinking calls, non-thinking calls, and max rounds.
- After tools complete, the system shall stream a final natural-language answer.

### FR-7 Tool: thinking

- Optional internal reasoning tool; does not fetch external data.
- Configurable max calls per answer; can be disabled in settings.

### FR-8 Tool: web_search

- Calls user’s SearXNG instance with a model-provided query string.
- Requires web assist on the message and `searxngBaseUrl` configured.
- Results formatted for model consumption; URLs should be citable in answers (prompt guidance).

### FR-9 Tool: fetch_url

- Fetches readable content for http(s) URLs via Jina Reader (optional API key).
- Same web-assist gating as web search.

### FR-10 Tool: MCP

- Discover tools from configured servers at query time (respecting per-tool enablement).
- Execute with JSON arguments from the model (`arguments_json` string).
- Handle transport/auth per server config (bearer token optional).
- Collide duplicate tool names across servers with deterministic suffixing.

### FR-11 Foundry path

- When `foundryAgentId` is provided, route to Azure Foundry Responses API with streaming SSE when available.
- Build conversation input from session history plus current query and optional page content.
- Do not register local LangChain tools on this path.

### FR-12 Personas

- Store multiple personas with `name` and `systemPrompt`; one active id.
- Merge Foundry agents into persona picker with `azf:` ids and `AzF:` display prefix.
- Default persona shall always exist and not be deletable.

### FR-13 Tool UI persistence

- Tool calls and results shall be persisted as `toolEvent` on chat messages for display and LLM replay.

### FR-14 Settings surfaces

| Setting area | QA-related configuration |
|--------------|-------------------------|
| General | Include page content default, SearXNG, Jina key, QA tool enable flags, tool budgets, QA appearance |
| Models | QA agent provider/model/parameters |
| Personas | CRUD + active persona |
| Azure Foundry | Agent registry |
| MCP | Server list, global MCP enable for QA, per-tool allowlists |

### FR-15 Internationalization

- User-visible strings shall use `@extension/i18n` keys (`chat_*`, `options_*`, etc.).

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **Local-first**: Chat history and API keys stored in Chrome extension local storage |
| NFR-2 | **Responsiveness**: Stream tokens as they arrive; UI remains interactive with stop |
| NFR-3 | **Multi-tab**: QA streams isolated per `tabId`; switching tabs restores per-tab buffer state |
| NFR-4 | **Fail gracefully**: Missing QA model, provider, SearXNG, or Foundry config → clear error message |
| NFR-5 | **Budget safety**: Hard caps on tool calls and rounds prevent runaway loops |
| NFR-6 | **Compatibility**: Support models without tool calling (degraded path: stream only, warn if tools enabled) |

## UX requirements

- QA toolbar exposes: model, persona, page-content toggle, web-search toggle, tools menu, attach/capture actions.
- Tool menu shows count of enabled tools; Foundry selection disables tools menu.
- Markdown rendering in assistant messages with QA theme-aware components.
- Follow-up mode enabled after a completed QA turn so the next message continues the session.

## Configuration defaults (reference)

From `DEFAULT_GENERAL_SETTINGS`:

- `includePageContent`: true  
- `qaEnableThinkingTool`: true  
- `qaEnableWebSearchTool` / `qaEnableFetchUrlTool`: false (legacy `enableWebSearch` may migrate)  
- `qaMaxNonThinkingToolCalls`: 3  
- `qaMaxThinkingCalls`: 5  
- `qaMaxToolRounds`: 16  
- `searxngMaxResults`: 5  

## Acceptance criteria (release checklist)

- [ ] User can send a message in QA Mode with only QA model + provider configured (no tools).
- [ ] With page content on, answer references visible tab content appropriately.
- [ ] With page content off, behavior is general chat without DOM reads.
- [ ] Streaming, stop, and error states work; partial text not lost on benign completion.
- [ ] Web search + fetch work when SearXNG URL set and web assist toggled on.
- [ ] MCP tool appears after server configured and tool enabled in QA menu; execution shows inline trace.
- [ ] Foundry agent streams response; tools menu disabled; persona shows `AzF:` label.
- [ ] Persona system prompt affects LLM-path answers.
- [ ] Session history reloads prior turns including tool bubbles.
- [ ] QA appearance settings apply in side panel.
- [ ] Tool budgets enforced (user sees limit messages in tool trace, model receives tool error content).

## Metrics (suggested)

- Time to first token (p50/p95) per provider  
- QA session count and messages per session (local analytics only if added later)  
- Tool invocation rate per session (thinking vs search vs MCP)  
- Error rate: missing config, provider 4xx/5xx, MCP discovery failures  
- Stop/cancel rate (proxy for unsatisfactory generations)

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Large page markdown exceeds context | `maxInputTokens` setting; future truncation strategy |
| SearXNG/Jina unavailable | Tool errors returned to model; user messaging in settings |
| MCP servers slow or flaky | Per-server discovery timeout; errors in tool UI |
| Models without tool support | Explicit system warning; no false claims of tool use |
| Foundry API shape changes | Isolated client module; optional endpoint override field |

## Future considerations (out of current scope)

- RAG over saved snippets or bookmarks  
- Shared/exported chat sessions  
- Per-persona model overrides  
- Tool calling on Foundry path when platform supports it  
- Automatic page-content summarization before prompt injection  
- Additional built-in tools (calculator, code execution sandbox) with same budget framework  

## Glossary

| Term | Definition |
|------|------------|
| **QA Mode** | Side-panel mode for direct Q&A (`tabMode: qa`) |
| **Web assist** | User-enabled use of `web_search` / `fetch_url` for a turn or by default |
| **Persona** | Named system prompt preset |
| **Foundry agent** | Azure AI Foundry hosted agent invoked via Responses protocol |
| **MCP** | Model Context Protocol — external tool servers |
| **Session** | A chat thread with stored messages in `chatHistoryStore` |
