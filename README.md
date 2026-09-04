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

**Give it a document.** Attach it to the composer — plain text, Markdown, CSV,
JSON or PDF — or just paste it in; anything long enough becomes an attachment
rather than a message. Verity scans for passages carrying a federal regulatory
exposure, names the concern, and reads the regulation that settles it.

**And ask where.** With a Mistral key she marks the passages on the page
itself, colour-coded by severity. Mistral Document AI reports where each block
sits; the PDF's own text layer narrows that to the sentence, so a mark frames
the line it belongs to rather than the paragraph around it. A scan with no text
layer falls back to the block.

**Teach her.** Settings carries *knowledge* — standing background about your
practice, folded into the prompt as background rather than instruction — and
*skills*, which are named instructions plus the tool packs they need. Switching
a skill off withholds those tools rather than politely asking her not to use
them.

**Or just type.** Voice and text share one transcript, one tool registry and one
set of cards. You can start by typing, switch to speaking, and keep one thread —
and typing during a live voice session joins the conversation rather than
starting a competing one.

## Where the regulations come from

Two free public APIs. Neither needs a key, an account, or a payment method.

| Source | Answers | Used for | Key |
| --- | --- | --- | --- |
| [eCFR](https://www.ecfr.gov/developers) | What the rule **is** | Search and full section text across CFR titles 12, 17, 26, 29, 31 and 48 | none |
| [Federal Register](https://www.federalregister.gov/developers/api/v1) | What is **changing** | Proposed and final rules, effective dates, comment deadlines | none |
| [Mistral Document AI](https://docs.mistral.ai/) | **Where** a passage sits | Reading a PDF so a finding can be drawn on the page | yours, optional |

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

Headings are scored by word rarity, because "business" and "deduction" appear
in hundreds of Title 26 headings and "beverage" in a handful. A small synonym
map bridges the gap between the words an accountant types and the words a
drafter used — no Title 26 heading contains the word "meal"; § 1.274-12 says
"food or beverage expenses" — and a synonym only counts once a word the caller
actually typed has also landed, or a question about meals finds the Food Stamp
Act.

### What it deliberately cannot do

The CFR carries **regulations, not statutes**. The Internal Revenue Code itself
is not in it, and neither are IRS publications or revenue rulings. Plenty of
well-known rules are purely statutory — the home-office exclusive-use test in
26 U.S.C. § 280A(c)(1) has no Treasury regulations under it at all. Verity is
told this explicitly, so an empty lookup reads as a fact about where the rule
lives rather than as a search to retry.

State and local tax, foreign law, and standards outside the CFR (FASB, PCAOB)
are out of scope, and it says so rather than improvising.

## Voice is a different medium, not a smaller one

Three things follow from that, and they are where most of the voice work went.

**A listener gets a different rendering of the same result.** A tool declares
`speak()` alongside `render()`, and the registry picks by modality. It matters
more than it sounds: `read_regulation` hands a reader twelve thousand
characters of section text quite happily, and every one of them has to be
swallowed by a realtime model before it can start talking. Nothing is
paraphrased — runs of reserved paragraphs collapse to a pointer at where the
text actually lives, and the cut is declared so she offers the rest rather than
pretending she read it. Measured against the live eCFR:

```
read_regulation      12,198 chars  →  2,047   83% less
find_rule_changes     2,747        →    761   72% less
search_regulations    1,089        →    344   68% less
```

A listener also never receives a URL or a forty-word breadcrumb, because those
are things she might read out.

**She corrects herself out loud.** The text agent gets its checkpoint from the
harness, which owns its loop. OpenAI owns the realtime loop, so the boundary
has to be found rather than declared — `response.done` with nothing
outstanding is the same moment — and steering is a conversation item instead of
a function call. The same audit runs on the same evidence, and if it objects
she says so in her next breath. A badge on a screen is no use to someone
listening. From a live session where the lookups had failed:

> "Actually, let me correct that: I couldn't verify the substantiation
> requirements because the regulation lookups failed, so I don't have the
> section text to rely on."

**The loop guard needed a memory.** A voice function call is its own stateless
request, so a fresh context started every call knowing nothing and the guard
never once fired — in the mode where it matters most, because nobody is reading
the transcript to notice the same search going round again. The browser holds
the session, so the browser supplies the history.

Typing while she is speaking now queues rather than failing: asking for a
second response while one is running is refused outright, which used to leave
the typed message sitting there unanswered.

## She checks her own answer

Before an answer reaches you, the turn stops at a checkpoint. Anything that
objects steers, and the model gets one more step to put it right — so what you
see is the corrected answer, not a draft with an apology under it. The badge
beneath each answer says which happened.

Two things object.

**The mechanical check** compares the answer against what the turn actually
did, and nothing else. Asking a model whether it is confident produces
confident answers; asking whether the citation it just used appears anywhere in
the tools it just called produces a fact. It catches:

- a citation no tool call returned;
- a requirement described from a search excerpt rather than the section text;
- an action claimed but never taken — "here are the passages marked up" from a
  turn that never called the markup tool;
- a failed lookup the answer does not own up to;
- a turn that did the work and then said nothing.

Citations compare by section, so pointing at § 1.274-5(c)(2)(iii) after reading
§ 1.274-5 is precision rather than invention.

**The critic** is one call to a cheap model that reads the draft back against
the tool results, for what a regex cannot see: a dropped condition, a citation
attached to a claim it does not support, the actual question going unanswered.
Its prompt refuses the shapes that waste a round trip — "add more detail",
"consider caveats", tone — and the parser drops anything vague that comes back
anyway. Empty is the normal outcome. Switch it off in settings if you would
rather not pay for the call.

Both found real defects on their first live runs: three constructed
sub-paragraph citations, and a draft attributing text to § 1.274-5(c)(2)(iii)(B)
that the excerpt did not contain.

## When things go wrong

- A model request that fails **before producing anything** is retried twice with
  backoff — a rate limit or a bad gateway should not end a turn. A request that
  has already started streaming is never retried, because replaying it would
  repeat what you have already read.
- Every tool call has a deadline. The source clients have their own timeouts;
  this is the backstop for a body that streams forever or a promise that never
  settles, so one wedged call cannot hold a turn open indefinitely.
- The eCFR and Federal Register are queued per host and retried on 429/5xx —
  a review fires five lookups at once, which is exactly the shape that earns a
  rate limit.
- A dropped voice connection reconnects itself twice, replaying the live
  transcript, before it gives up and says so.

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
├── resilience.ts  Retry and deadline policies, as replaceable plugins
└── agent.ts       The loop: stream, call tools, check, feed back, repeat
```

The events a plugin can hook, following the upstream contract:

| Event | Mode | For |
| --- | --- | --- |
| `tools/pre-execute` | bail | Allow, deny or ask before a call runs |
| `ctx.tools.guard()` | — | A monotonic denial no later listener can undo |
| `tools/execute` | waterfall | Wrap dispatch — deadlines, retries, metrics |
| `tools/post-execute` | serial | Attach model-facing context to a result |
| `tools/result` | emit | Observe the frozen outcome |
| `agent/request-error` | bail | Return a retry action, or let the error stand |
| `agent/turn-stopping` | parallel | Object, and the turn reopens for one more step |

A tool's `output.speak()` is the same idea one level down: the registry picks
the rendering by modality, so one tool serves a reader and a listener without
either being an afterthought.

### The plugins

```
src/lib/plugins/
├── ecfr.ts             search_regulations, read_regulation
├── federal-register.ts find_rule_changes
├── review.ts           review_document, list_documents
├── highlight.ts        highlight_document
├── verify.ts           The mechanical self-check
├── critic.ts           The second opinion
├── review-rules.ts     27 rules — what a reviewer circles in red
├── documents.ts        Per-request document service
├── loop-guard.ts       Refuses an exact repeated call
└── index.ts            Assembly — the only file that knows the full set
```

Which of these mount is decided per turn by the skills that are switched on.

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

Pages   browser ──► /api/ocr ─────► Mistral (blocks and boxes back)
        browser ────────────────── pdf.js renders, text layer places the marks
```

The file itself never leaves the browser except as the body of that one OCR
request, and the marks are matched to positions in the tab that holds it.

The caller's key reaches the server only as a request header, is spent on that
one request, and is never written to a log, a database or an error message.
There is no server-side session for it to leak into — which is why the auth and
database scaffolding came out of the project.

## Testing

```bash
npm run check   # types and a11y — 0 errors, 0 warnings
npm test        # 44 unit tests, then 14 end-to-end
```

The end-to-end suite drives the real UI in Chromium with the API routes
stubbed, so it needs no key and does not call two free government APIs on every
run. It covers the key gate (including a rejected key), a full turn rendering
its regulation card and citation rail, loading and removing a document, the
settings popover, the character switch, and a 375×812 phone layout.

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
app detects which you have and says so. Marking up a page needs a Mistral key;
without one everything else still works.
