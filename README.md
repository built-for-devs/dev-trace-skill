# Dev Trace

**Turn an email into an enriched, cited public profile—in one command.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green.svg)](https://nodejs.org)
[![Built for Devs](https://img.shields.io/badge/Built%20for%20Devs-agent%20skill-ff5c00.svg)](https://builtfor.dev)

A standalone [agent skill](https://docs.claude.com/en/docs/claude-code/skills) from [Built for Devs](https://builtfor.dev). Give it an email; it runs a deterministic **waterfall** of public sources—validate, surface, verify, GitHub, company enrichment, person enrichment, and a cited bio—and returns one structured profile with a confidence score and sources on every field.

- **Works on day one with zero keys**, and gets richer as you add them.
- **Costs nothing by default.** Paid providers are opt-in, so you spend only when a lead is worth it.
- **Public data only.** Below its confidence threshold it returns *candidates*, never invents.
- **Zero dependencies** (Node 18+). Runs the same way every time.

---

## Quickstart

```bash
git clone https://github.com/built-for-devs/dev-trace-skill
cd dev-trace-skill

# Free layers only, no keys, no cost:
node scripts/dev-trace.mjs someone@example.com --pretty
```

That already validates the address and pulls Gravatar, domain, and GitHub identity. Add keys (below) to unlock company data, verification, person enrichment, and a cited bio.

## Example

```bash
node scripts/dev-trace.mjs jordan@acme.dev --pretty
```

```jsonc
{
  "meta": { "email": "jordan@acme.dev", "depths_run": [0,1,2,3,4,5], "match_status": "verified", "sixtyfour_confidence": 9 },
  "profile": {
    "name":             { "value": "Jordan Lee",                        "confidence": 0.90, "sources": ["hunter","sixtyfour"] },
    "role":             { "value": "Head of Platform",                  "confidence": 0.90, "sources": ["hunter"] },
    "seniority":        { "value": "executive",                         "confidence": 0.85, "sources": ["hunter"] },
    "location":         { "value": "Austin, Texas, United States",      "confidence": 0.90, "sources": ["sixtyfour"] },
    "avatar":           { "value": "https://gravatar.com/avatar/...",   "confidence": 0.80, "sources": ["gravatar"] },
    "bio":              { "value": "Jordan Lee leads platform engineering at Acme ... [1][2]", "confidence": 0.85, "sources": ["tabstack-research"] },
    "company_name":     { "value": "Acme",                              "confidence": 0.90, "sources": ["tabstack","hunter"] },
    "company_industry": { "value": "Developer tools",                   "confidence": 0.85, "sources": ["tabstack"] },
    "company_domain":   { "value": "acme.dev",                          "confidence": 0.90, "sources": ["domain"] },
    "website":          { "value": "https://acme.dev",                  "confidence": 0.81, "sources": ["sixtyfour"] },
    "phone":            { "value": "+1 512 555 0143",                   "confidence": 0.90, "sources": ["sixtyfour"] },
    "social_linkedin":  { "value": "https://linkedin.com/in/jordanlee", "confidence": 0.90, "sources": ["hunter"] },
    "social_github":    { "value": "https://github.com/jordanlee",      "confidence": 0.90, "sources": ["sixtyfour"] }
    // ...and more, depending on which layers ran
  }
}
```

Every field carries its own `confidence`, the `sources` that produced it, and a `conflict` marker when providers disagree—so you always know how much to trust each value.

## Fields it can populate

What you get back depends on which layers run, but the waterfall can fill a wide profile:

- **Identity**—`name`, `role`, `seniority`, `location`, `avatar`, `bio`
- **Company**—`company_name`, `company_description`, `company_industry`, `company_size`, `company_location`, `company_domain`
- **Social**—`social_linkedin`, `social_twitter`, `social_github`, any Gravatar-linked accounts, plus `company_social_*`
- **Contact**—`email_found`, `phone`, `website`
- **GitHub**—`github_login`, `github_public_repos`, `github_followers`

Fields only appear when a source actually returns them (public data only), and each is wrapped with `value` / `confidence` / `sources` / `conflict`.

## What it costs

Dev Trace is built so you get a genuinely useful profile **for free**, and every paid provider is **opt-in**.

| Tier | Provider | What you get |
|---|---|---|
| 🟢 **Free, no account** | built-in | Email validation (syntax/MX/disposable), Gravatar + domain surface, **GitHub** identity |
| 🟢 **Free key, optional** | GitHub token | Higher GitHub rate limits (`GITHUB_TOKEN` is free to generate) |
| 🟢 **Free account, goes far** | **Tabstack** | Company/web enrichment **and** a cited, multi-source `/research` bio |
| 🟡 **Metered, free tier then paid** | **Hunter** | Email verification + person enrichment (LinkedIn, role, seniority) |
| 🔴 **Premium, real $$$$** | **SixtyFour** | Deepest person + LinkedIn dive. **~$4.80/pull** (≈20 credits at `medium`, $0.24/credit), ~5/month on the entry plan. The break-glass layer, opt-in via `--deep`. |

Run the whole free path and never spend a cent. The metered and premium layers are there for when you want the depth and choose to make the spend.

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
| bio | synthesis | Tabstack `/research` (cited) | `TABSTACK_API_KEY` | when a name is resolved |

Layers run in order and merge into one profile. A layer whose key is absent is skipped; a layer that errors is recorded in `meta` and never aborts the rest.

## Get your keys

Every key is optional. Add only the ones you want, then drop them into `.env`.

| Provider | Where to get a key | Unlocks | Tier |
|---|---|---|---|
| **GitHub** | [github.com/settings/tokens](https://github.com/settings/tokens?utm_source=dev-trace-skill&utm_medium=github&utm_campaign=skill) | Higher GitHub rate limits | Free |
| **Tabstack** | [tabstack.ai](https://tabstack.ai/?utm_source=dev-trace-skill&utm_medium=github&utm_campaign=skill) | Company enrichment + cited `/research` bio | Free account, generous |
| **Hunter** | [hunter.io/api-keys](https://hunter.io/api-keys?utm_source=dev-trace-skill&utm_medium=github&utm_campaign=skill) | Email verification + person enrichment | Metered |
| **SixtyFour** | [sixtyfour.ai](https://sixtyfour.ai/?utm_source=dev-trace-skill&utm_medium=github&utm_campaign=skill) | Deepest person + LinkedIn (`--deep`) | Premium |

```bash
cp .env.example .env
# add the keys you have; the engine reads .env from the skill root or scripts/
```

`.env` is gitignored—keys are never committed.

## Install as a skill

Dev Trace is a self-contained skill folder. To use it inside an agent, clone it into the directory that agent loads skills from:

```bash
git clone https://github.com/built-for-devs/dev-trace-skill ~/.claude/skills/dev-trace
```

For Claude Code that's `~/.claude/skills/` (global) or a project's `.claude/skills/`. The agent reads `SKILL.md` and invokes the engine for you. Not using a skills-aware agent? Run the engine directly, as in [Quickstart](#quickstart).

Or install it through the Claude Code plugin marketplace:

```bash
/plugin marketplace add built-for-devs/dev-trace-skill
/plugin install dev-trace@built-for-devs
```

## Using with other agents

The engine is a plain Node CLI, so any agent or script that can run a shell command can use Dev Trace—Codex, Cursor, Gemini CLI, OpenClaw, or your own automation.

- **Claude Code** reads [`SKILL.md`](./SKILL.md).
- **Codex** and any [AGENTS.md](https://agents.md)-aware tool read [`AGENTS.md`](./AGENTS.md).
- **Gemini CLI / Cursor / others**: run the engine directly, or copy the usage and cost policy from `AGENTS.md` into your `GEMINI.md` or Cursor rules.

Both instruction files describe the same engine and the same cost policy, so behavior is identical no matter which agent drives it.

## Headless / autonomous agents

Dev Trace runs cleanly in any headless context (cloud agents, CI, cron) with no code changes:

- **Keys come from the environment**—set `HUNTER_API_KEY`, `TABSTACK_API_KEY`, etc. however your platform injects secrets. No `.env` file required.
- **Non-interactive**—no prompts; JSON to stdout, failed layers captured in `meta` so a run never crashes the task.
- **SixtyFour cannot spend without acceptance**—the expensive `--deep` layer refuses to run unless a human has accepted the cost: `DEV_TRACE_ALLOW_DEEP=1` in the environment (standing acceptance set by the operator) or an interactive confirmation. An autonomous agent that passes `--deep` without that opt-in gets a skipped layer logged in `meta.errors` and zero SixtyFour spend.
- **`DEV_TRACE_MAX_DEPTH=N`** caps the default depth (the `--max-depth` flag still overrides per call), e.g. `DEV_TRACE_MAX_DEPTH=2` keeps an agent on the free layers.
- **Runtime:** needs Node 18+ available in your container/runtime.

## Usage

```bash
node scripts/dev-trace.mjs <email> [options]
```

| Flag | Effect |
|---|---|
| `--pretty` | Human-readable JSON |
| `--json <path>` | Write raw JSON to a file |
| `--max-depth N` | Stop after depth N (0–4). `--max-depth 2` keeps it entirely free |
| `--deep` | Add SixtyFour (depth 5). Expensive, rate-limited, opt-in |
| `--tier low\|medium\|high` | SixtyFour research depth (default `low`) |
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
    "<field>": { "value": "...", "confidence": 0.0, "sources": ["..."], "conflict": null }
  }
}
```

- `match_status`: `verified` (confirmed + deliverable), `probable` (found, unconfirmed), `unverified_candidates` (below threshold).
- Failed or rate-limited layers are recorded in `meta.errors` / `meta.rate_limited`.

## Principles

- **Public data only.** No invented profiles. Below the confidence threshold, candidates are returned, not asserted.
- **Deterministic.** Fixed layer order and flags; output varies only with live source data and which keys are present. `meta.depths_run` always explains what ran.
- **Transparent cost.** Free by default; paid layers are opt-in and labeled.

## Contributing

Issues and PRs welcome. Keep the engine dependency-free (Node built-ins only) and every new layer key-gated and cost-labeled.

---

MIT © [Built for Devs](https://builtfor.dev). Hunter, Tabstack, SixtyFour, and GitHub are independent services—bring your own keys and accounts.
