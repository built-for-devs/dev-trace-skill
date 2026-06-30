# dev-trace

**Turn an email into an enriched, cited public profile—with one command.**
A standalone [agent skill](https://docs.claude.com/en/docs/claude-code/skills) from [Built for Devs](https://builtfor.dev).

`dev-trace` runs a fixed **waterfall** of public sources over an email address—validating it, surfacing public profiles, checking deliverability, pulling GitHub identity, enriching company and person data, and synthesizing a cited bio. Each layer is gated by whether its API key is present, so it works on day one with zero keys and gets richer as you add them. Public data only: below its confidence threshold it returns *candidates* instead of inventing an answer.

Zero dependencies (Node 18+). Bring your own keys. Runs the same way every time.

---

## What it costs (the important part)

`dev-trace` is built so you get a genuinely useful profile **for free**, and every paid provider is **opt-in**—so you (or your company) spend only when a lead is worth it.

| Tier | Providers | What you get |
|---|---|---|
| 🟢 **Free, no account** | built-in | Email validation (syntax/MX/disposable), Gravatar + domain surface, **GitHub** identity |
| 🟢 **Free key, optional** | GitHub token | Higher GitHub rate limits and reliability (`GITHUB_TOKEN` is free to generate) |
| 🟢 **Free account, goes far** | **Tabstack** | Company/web enrichment **and** a cited, multi-source `/research` bio. A free Tabstack account covers a lot before you ever pay. |
| 🟡 **Metered, free tier then paid** | **Hunter** | Email verification + person enrichment (LinkedIn, role, seniority) |
| 🔴 **Premium, real $$$$** | **SixtyFour** | The deepest person + LinkedIn dive. **~$4.80 per pull** (≈20 credits at the `medium` tier, $0.24/credit)—on the $24/mo entry plan that's ~5 pulls/month. The break-glass layer. |

You can run the whole free path and never spend a cent. The metered and premium layers are there **if you want the depth and choose to make the spend.**

---

## The waterfall

| Depth | Layer | Source | Key | Runs |
|---|---|---|---|---|
| 0 | validate | syntax + MX + disposable | none | always, free |
| 1 | surface | Gravatar + domain scrape | none | always, free |
| 1 | verify | Hunter email verification | `HUNTER_API_KEY` | if key |
| 2 | profile | GitHub identity + basics | `GITHUB_TOKEN` optional | always, free |
| 3 | enriched | Tabstack web/company | `TABSTACK_API_KEY` | if key |
| 4 | deep | Hunter person enrichment | `HUNTER_API_KEY` | if key |
| 5 | deepest | SixtyFour people-intelligence | `SIXTYFOUR_API_KEY` | only with `--deep` |
| + | bio | Tabstack `/research` (cited) | `TABSTACK_API_KEY` | when a name is resolved |

Layers run in order and merge into one profile. Every field is wrapped with a `value`, a `confidence` score, the `sources` that contributed, and a `conflict` marker when sources disagree.

---

## Install

It's a folder. Drop it into your agent's skills directory:

```bash
git clone https://github.com/built-for-devs/dev-trace-skill ~/.claude/skills/dev-trace
```

(Any path your agent loads skills from works; for Claude Code that's `~/.claude/skills/` or a project's `.claude/skills/`.) Or just run the engine directly—see below.

## Setup keys

Every key is optional. Copy the example and add the ones you have:

```bash
cp .env.example .env
# edit .env—the engine reads it from the skill root or scripts/
```

```
GITHUB_TOKEN=        # free; raises GitHub rate limits
TABSTACK_API_KEY=    # free account, generous credits
HUNTER_API_KEY=      # metered credits
SIXTYFOUR_API_KEY=   # premium; only used with --deep
```

`.env` is gitignored—keys are never committed.

## Usage

```bash
# Free layers only—no keys, no cost
node scripts/dev-trace.mjs someone@example.com --max-depth 2 --pretty

# Full default run (uses whatever keys are present)
node scripts/dev-trace.mjs someone@example.com --pretty

# Save raw JSON
node scripts/dev-trace.mjs someone@example.com --json out.json

# Premium deep dive (SixtyFour)—expensive, opt-in
node scripts/dev-trace.mjs someone@example.com --deep
```

| Flag | Effect |
|---|---|
| `--pretty` | Human-readable JSON |
| `--json <path>` | Write raw JSON to a file |
| `--max-depth N` | Stop after depth N (0–4)—`2` keeps it entirely free |
| `--deep` | Add SixtyFour (depth 5). Expensive, rate-limited, opt-in |
| `--tier low\|medium\|high` | SixtyFour depth (default `low`) |
| `--no-bio` | Skip the Tabstack `/research` bio |
| `--bio-mode fast\|balanced\|deep\|max` | Bio research depth (default `fast`) |

## Output

```json
{
  "meta": {
    "email": "someone@example.com",
    "depths_run": [0, 1, 2, 3],
    "match_status": "verified | probable | unverified_candidates",
    "generated_at": "<ISO-8601>"
  },
  "profile": {
    "name":     { "value": "...", "confidence": 0.9,  "sources": ["hunter"], "conflict": null },
    "role":     { "value": "...", "confidence": 0.9,  "sources": ["hunter"], "conflict": null },
    "bio":      { "value": "...", "confidence": 0.85, "sources": ["tabstack-research"], "conflict": null }
  }
}
```

- `match_status`: `verified` (confirmed + deliverable), `probable` (found, unconfirmed), `unverified_candidates` (below threshold).
- A layer that errors or is rate-limited is recorded in `meta.errors` / `meta.rate_limited`; the waterfall never aborts on one layer.

## Principles

- **Public data only.** No invented profiles. Below the confidence threshold, candidates are returned, not asserted.
- **Deterministic.** Fixed layer order and flags; output varies only with live source data and which keys are present, and `meta.depths_run` always explains what ran.
- **Transparent cost.** Free by default; paid layers are opt-in and labeled.

---

MIT © Built for Devs. Providers (Hunter, Tabstack, SixtyFour, GitHub) are independent services—bring your own keys and accounts.
