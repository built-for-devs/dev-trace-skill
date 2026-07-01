# AGENTS.md—Dev Trace

Instructions for any coding agent using this skill (Codex, Cursor, Gemini CLI, OpenClaw, your own automation, etc.). Claude Code reads `SKILL.md`; the guidance is identical.

## What this is

Dev Trace turns an email address into an enriched, cited public profile by running a deterministic waterfall of public sources. It is a zero-dependency Node CLI (Node 18+) at `scripts/dev-trace.mjs`. Public data only: below its confidence threshold it returns candidates, never invents.

## How to run

```
node scripts/dev-trace.mjs <email> [--pretty] [--json <path>] [--max-depth N] [--deep] [--tier low|medium|high] [--no-bio] [--bio-mode fast|balanced|deep|max]
```

Relay the JSON to the user. Report which layers ran (`meta.depths_run`) and which keys would unlock more. Do not invent fields the trace did not return.

## Keys

Optional, read from `.env` (skill root or `scripts/`). The free layers (validate, surface, GitHub) run with none. See `.env.example`.

## Cost & usage policy

Free layers always run: validate, surface (Gravatar/domain), GitHub. The rest cost credits on the provider's account:

- `HUNTER_API_KEY`—verify (0.5 cr) + person enrichment (0.2 cr).
- `TABSTACK_API_KEY`—company enrichment + the cited `/research` bio.
- `SIXTYFOUR_API_KEY`—depth 5, only with `--deep`.

Policy: default to the free + cheap layers. `--max-depth 2` stays entirely free.

**SixtyFour (`--deep`) is expensive and rate-limited** (~$4.80 per `medium` pull, ~5/month on the entry plan). Never run `--deep` to "be thorough"—only on a genuinely high-value target, only after cheaper layers came up short, and **confirm with the user before spending a pull**. Default `--tier low`; don't raise the tier or `--bio-mode` unprompted.

**Enforced for autonomous use:** `--deep` will not run unless a human accepted the cost, via `DEV_TRACE_ALLOW_DEEP=1` in the environment or an interactive confirmation. Without that, passing `--deep` is skipped and logged in `meta.errors`, with zero SixtyFour spend. Set `DEV_TRACE_MAX_DEPTH=N` to cap the default depth for a headless agent (the `--max-depth` flag still overrides per call). Keys are read from the environment, so no `.env` file is needed in a container.

## Output

One JSON object: `meta` (email, `depths_run`, `match_status`, timestamps) plus `profile`, where every field is wrapped with `value`, `confidence` (0–1), `sources`, and `conflict`. See the README for the full field list.
