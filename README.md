# Verity — Regulations Assistant

A voice-first research assistant for accountants, built around a small animated
desk robot. Ask it about a federal tax or financial regulation — out loud or by
typing — and it searches the live Code of Federal Regulations, reads the section
it found, and cites what it read. Drop in an engagement letter or a client memo
and it will tell you which passages a reviewer would stop at, and why.

It is bring-your-own-key: you paste an OpenAI key, it stays in your browser, and
nothing is stored on the server.

```bash
npm install
npm run dev
```

Open http://localhost:5173, paste a key with Realtime access, and press **Talk
to Verity**. Text mode works with any key.

---

## What it does

**Talk to it.** `gpt-realtime-2` over WebRTC, straight from the browser to
OpenAI. Speak naturally; interrupting works. The robot's mouth is driven by the
waveform you are actually hearing, and the transcript prints onto its receipt
paper as it speaks.

**Watch the regulations arrive.** The model's tool calls surface as cards while
it is still talking, so the section it is describing is on screen before it
finishes the sentence. Every citation the session touches collects into a rail
under the transcript.

**Give it a document.** Paste text or drop a file — plain text, Markdown, CSV,
JSON or PDF. It scans for the passages that carry a federal regulatory exposure,
names the concern, and then goes and reads the regulation that settles it.

**Or just type.** Voice and text share one transcript, one tool registry and one
set of cards. You can start by typing, switch to speaking, and keep one thread —
and typing during a live voice session joins the conversation rather than
starting a competing one.

## Where the regulations come from

Two free public APIs. Neither needs a key, an account, or a payment method.

| Source | Answers | Used for |
| --- | --- | --- |
| [eCFR](https://www.ecfr.gov/developers) | What the rule **is** | Search and full section text across CFR titles 12, 17, 26, 29, 31 and 48 |
| [Federal Register](https://www.federalregister.gov/developers/api/v1) | What is **changing** | Proposed and final rules, effective dates, comment deadlines |

### Search is not the eCFR's own search

The eCFR's full-text index ranks by term frequency over whole section bodies,
which is close to useless for a conceptual question — "home office exclusive
use" returns building-and-loan associations, because those sections happen to
say "home", "loan" and "use" a great many times.

A section's *heading* is the precise signal, and every title's structure is one
small JSON document covering tens of thousands of sections. So headings are
indexed and matched first, with full text filling in behind. The difference,
from the regression tests in `src/lib/sources/search-quality.spec.ts`:

```
substantiation requirements travel    →  26 CFR § 1.274-5
compensation for personal services    →  26 CFR § 1.162-7
amounts paid to improve tangible …    →  26 CFR § 1.263(a)-3
auditor independence                  →  17 CFR § 240.10A-2
reports of foreign financial accounts →  31 CFR § 1010.350
```

### What it deliberately cannot do

The CFR carries **regulations, not statutes**. The Internal Revenue Code itself
is not in it, and neither are IRS publications or revenue rulings. Plenty of
well-known rules are purely statutory — the home-office exclusive-use test in
26 U.S.C. § 280A(c)(1) has no Treasury regulations under it at all. Verity is
told this explicitly, so an empty lookup reads as a fact about where the rule
lives rather than as a search to retry.

State and local tax, foreign law, and standards outside the CFR (FASB, PCAOB)
are out of scope, and it says so rather than improvising.

## Architecture

### The harness

The agent layer is built on the **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**
model — everything is a plugin, mounted into a Cordis-style context.

`src/lib/harness/` is a compact implementation of that contract, sized for this
app: a `Context` with services claimed under stable keys, `inject` for
dependency declaration, reversible `effect()` registrations, and the five
documented dispatch modes (`emit`, `waterfall`, `parallel`, `serial`, `bail`).
Tools are authored with `defineTool` exactly as upstream describes — a schema
DSL that compiles to JSON Schema for the model, validates its arguments before
`execute` runs, and infers both the argument type and the canonical return type
from the schemas so the two can never drift. Execution runs a
`pre-execute → execute → result` pipeline, and presentation is a set of pure
projections a tool declares without importing a single UI type.

It runs in-process rather than as the upstream Node runtime, because that
runtime is a coding agent with a filesystem, a sandbox and subprocesses — the
wrong shape for a browser app where each visitor brings their own key. Running
the harness in-process also makes it isomorphic, which is the property this app
actually needs: the same context boots in a SvelteKit endpoint for the text
agent and drives the voice agent's tools, so both modes call identical code.

```
src/lib/harness/
├── context.ts     Services, inject, effects, typed events
├── schema.ts      The schema DSL, JSON Schema compilation, validation
├── tools.ts       Registry, execution pipeline, card presenters
├── llm.ts         The provider seam
├── openai.ts      OpenAI adapter over the Responses API
└── agent.ts       The loop: stream, call tools, feed back, repeat
```

### The plugins

```
src/lib/plugins/
├── ecfr.ts             search_regulations, read_regulation
├── federal-register.ts find_rule_changes
├── review.ts           review_document, list_documents
├── review-rules.ts     27 rules — what a reviewer circles in red
├── documents.ts        Per-request document service
├── loop-guard.ts       Refuses an exact repeated call
└── index.ts            Assembly — the only file that knows the full set
```

The **review pack** is the domain core. It covers worker classification,
reasonable compensation, capitalisation versus repair, the research credit,
transfer pricing, foreign accounts, auditor independence, going concern, and
the assertion patterns that are unsupportable however true they might be
("fully deductible", "guaranteed to survive audit").

A rule never decides anything. It flags the passage, names the concern, and
hands the assistant the lookup that settles it — so the regulation is always
fetched live rather than recalled. Every rule's lookup is pinned by a test
against the provision it is supposed to find.

### The robot

`src/lib/robot/` is the Three.js character, vendored verbatim from the original
Verity prototype. It owns geometry, materials, the receipt printer and all
character animation, and knows nothing about a renderer, a microphone or an AI
provider. `VENDOR.md` records the boundary; pull upstream changes by re-copying
the folder rather than editing in place.

### Request flow

```
Voice   browser ──► /api/realtime ──► OpenAI (mints an ephemeral secret)
        browser ──────WebRTC──────► OpenAI (audio + events)
        browser ──► /api/tools ───► eCFR / Federal Register

Text    browser ──► /api/chat ────► OpenAI (SSE stream of AgentEvents)
                         └────────► eCFR / Federal Register
```

The caller's key reaches the server only as a request header, is spent on that
one request, and is never written to a log, a database or an error message.
There is no server-side session for it to leak into — which is why the auth and
database scaffolding came out of the project.

## Testing

```bash
npm run check        # types and a11y — 0 errors, 0 warnings
npm test -- --run    # 40 offline tests
```

The live suite hits the real APIs and, for the agent tests, a real key:

```bash
LIVE=1 OPENAI_API_KEY=sk-… npx vitest run --project server
```

It covers search quality against expected citations, every review rule's
lookup, section reads, rule-change lookups, and two full agent turns including
a document review that follows its own findings into the regulation.

## Deployment

Configured for Vercel via `@sveltejs/adapter-vercel`. `npm run build` produces
the bundle. **Microphone access requires HTTPS** anywhere but localhost.

No environment variables are needed — the app has no server-side secrets.

## Limitations

Verity is research assistance, not a tax opinion. It helps you find and read
the rule; the judgement is yours. It has no memory between sessions, does not
cover state or local tax, and cannot read a scanned PDF without a text layer.

Voice needs Realtime access on the OpenAI account. Text mode does not, and the
app detects which you have and says so.
