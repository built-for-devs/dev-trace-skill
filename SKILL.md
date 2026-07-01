---
name: dev-trace
description: Turn an email address into an enriched public profile via a deterministic waterfall (validate, surface, Hunter verify, GitHub, Tabstack company enrichment plus a cited /research bio, Hunter person enrichment, and an optional --deep SixtyFour LinkedIn dive). Use when asked to trace, enrich, look up, or profile a person or company from an email—for lead/prospect research, signup enrichment, or feeding a CRM record or brief. Runs the same way every time; free layers work with no keys.
---

# dev-trace

Turns an email into a structured public profile by running a fixed waterfall of public sources, each layer gated by whether its API key is present. Public data only—below the confidence threshold it returns candidates rather than guessing. Zero dependencies (Node 18+); bring your own API keys.

## How to run

```
node scripts/dev-trace.mjs <email> [--pretty] [--json <path>] [--max-depth N] [--deep] [--tier low|medium|high] [--no-bio] [--bio-mode fast|balanced|deep|max]
```

- `--pretty`—human-readable JSON (use this when showing the user).
- `--json <path>`—write the raw object to a file instead of stdout.
- `--max-depth N`—stop after depth N (0–4) for the fast layers. Default 4.
- `--deep`—also run depth 5 (SixtyFour). Slow (minutes) and expensive; requires `SIXTYFOUR_API_KEY`.
- `--tier low|medium|high`—SixtyFour research depth (default `low`). Higher = more thorough, slower, more credits.
- `--no-bio`—skip the Tabstack `/research` bio step (on by default when a name is resolved and `TABSTACK_API_KEY` is set).
- `--bio-mode fast|balanced|deep|max`—research depth for the bio (default `fast`).

## The waterfall

| Depth | Layer | Source | Key | Runs |
|---|---|---|---|---|
| 0 | validate | syntax + MX + disposable | none | always, free |
| 1 | surface | Gravatar + domain scrape | none | always, free |
| 1 | verify | Hunter email verification | `HUNTER_API_KEY` | if key |
| 2 | profile | GitHub identity + ICP basics | `GITHUB_TOKEN` (recommended) | always, free |
| 3 | enriched | Tabstack web/company | `TABSTACK_API_KEY` | if key |
| 4 | deep | Hunter person enrichment | `HUNTER_API_KEY` | if key |
| 5 | deepest | SixtyFour people-intelligence (LinkedIn search) | `SIXTYFOUR_API_KEY` | only with `--deep` |

`HUNTER_API_KEY` unlocks both verification (depth 1, 0.5 credits/call) and person enrichment (depth 4, 0.2 credits/call)—note verify costs *more* than enrichment. Depth 5 (SixtyFour) is the opt-in deep dive: it runs only with `--deep`, takes minutes (async web research), and anchors on the **email itself** plus any name/company/LinkedIn found upstream. It skips only for disposable or undeliverable emails (logged in `meta`).

## Keys

Copy `.env.example` to `.env` in this skill directory and add whatever keys you have (the engine reads `.env` from the skill root or `scripts/`). All are optional; the validate, surface, and GitHub layers run with none. A layer whose key is absent is silently skipped. Keys are never bundled with the skill (`.env` is gitignored).

## Cost & usage policy (for the agent)

The skill is built so you get a useful profile for free, and each paid provider is opt-in—spend only when a lead is worth it.

**Cost tiers, cheapest first:**
- 🟢 **Free, no account**—validate, surface (Gravatar + domain), GitHub identity. Run with zero keys.
- 🟢 **Free key, optional**—`GITHUB_TOKEN` (free to generate) just raises GitHub's rate limit and reliability.
- 🟢 **Free account, goes far**—**Tabstack** (`TABSTACK_API_KEY`): company enrichment (depth 3) + the cited `/research` bio. A free Tabstack account covers a lot before you ever pay.
- 🟡 **Metered credits, free tier then paid**—**Hunter** (`HUNTER_API_KEY`): email verification (0.5 cr) + person enrichment (0.2 cr).
- 🔴 **Premium, real $$$$**—**SixtyFour** (`SIXTYFOUR_API_KEY`, `--deep`): deepest person + LinkedIn search. The break-glass layer for high-value targets.

Per-layer detail:

| Layer | Cost | Runs |
|---|---|---|
| 1 verify (Hunter) | 0.5 Hunter credits | if `HUNTER_API_KEY` present |
| 3 Tabstack company | Tabstack credits | if `TABSTACK_API_KEY` present |
| 4 Hunter person | 0.2 Hunter credits | if `HUNTER_API_KEY` present |
| bio (Tabstack `/research`) | Tabstack credits (`fast` cheapest) | if a name was resolved |
| 5 SixtyFour | expensive—see below | only with `--deep` |

Policy: default to free + cheap layers. For a quick free lookup, `--max-depth 2` runs only the no-cost layers.

**SixtyFour (`--deep`) is expensive and rate-limited.** Exact cost depends on your SixtyFour plan; on the entry plan (~100 credits/month, $0.24/credit) a `medium` people-intelligence pull measured ~20 credits (~$4.80, ~2.5 min), i.e. roughly 5 pulls/month. Treat every `--deep` run as a scarce resource:
- Never run `--deep` to "be thorough." Only on a genuinely high-value target.
- Only after the cheaper layers (Hunter person enrichment, the `/research` bio) have come up short.
- **Confirm with the user before spending a SixtyFour pull**, and default `--tier low`—never raise the tier unprompted.
- **Enforced, not just advised:** `--deep` refuses to run unless a human accepted the cost, via `DEV_TRACE_ALLOW_DEEP=1` in the environment or an interactive confirmation. It cannot fire autonomously. `DEV_TRACE_MAX_DEPTH=N` caps depth for headless use. See the README "Headless / autonomous agents" section.

`--bio-mode` above `fast` and depths 3/4 spend ordinary credits—fine when relevant, but don't raise `--bio-mode` unprompted.

## Bio (Tabstack /research)

After the identity layers, if a name was resolved and `TABSTACK_API_KEY` is set, a Tabstack `/research` call synthesizes a cited professional **`bio`** into the profile, with source URLs in `meta.bio_sources`. Default mode `fast` (cheapest); raise with `--bio-mode`, or skip with `--no-bio`. Needs a name, so without a Hunter/GitHub match it only runs alongside `--deep` (which supplies the name via SixtyFour).

When relaying results: report which depths ran (`meta.depths_run`) and which keys would unlock more. Do not invent fields the trace did not return.

## Output

```json
{
  "meta": { "email": "...", "depths_run": [0,1,2], "match_status": "probable", "generated_at": "..." },
  "profile": { "<field>": { "value": "...", "confidence": 0.85, "sources": ["github"], "conflict": null } }
}
```

- Every field is wrapped with `value`, `confidence` (0–1), `sources`, and `conflict` (null, or the competing value when layers disagree).
- `meta.match_status`: `verified` (confirmed identity + deliverable), `probable` (identity found, unconfirmed), `unverified_candidates` (below threshold).
- Failed or rate-limited layers are recorded in `meta.errors` / `meta.rate_limited`; the waterfall never aborts on one layer.

## Notes

- Produces the profile only. Shaping it into a CRM record, brief, or other deliverable is a separate follow-on step.
- Standalone and distributable: zero dependencies (Node 18+), no external clone or build required.
- Public data only; no invented profiles. Below the confidence threshold it returns candidates instead of asserting a value.
