#!/usr/bin/env node
// dev-trace: email to enriched public profile via a deterministic waterfall.
// A Built for Devs agent skill. Zero dependencies (Node 18+: global fetch, node:dns, node:crypto).
// Reads a sibling .env (skill root or scripts/) if present. Free layers run with no keys.
//
// Usage:
//   node dev-trace.mjs someone@example.com [--pretty] [--json out.json] [--max-depth N]
//                       [--deep] [--tier low|medium|high] [--no-bio] [--bio-mode fast|balanced|deep|max]
//
// Keys (env or .env), each unlocks a layer:
//   GITHUB_TOKEN      depth 2 (optional, free, raises GitHub rate limit)
//   TABSTACK_API_KEY  depth 3 company/web enrichment + the cited /research bio
//   HUNTER_API_KEY    depth 1 verify (0.5 cr) + depth 4 person enrichment (0.2 cr)
//   SIXTYFOUR_API_KEY depth 5 people-intelligence (premium, only with --deep)

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- .env loader (no dependency); checks skill root and scripts/ ----
for (const dir of [join(HERE, '..'), HERE]) {
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const HUNTER = process.env.HUNTER_API_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const TABSTACK = process.env.TABSTACK_API_KEY;
const SIXTYFOUR = process.env.SIXTYFOUR_API_KEY;

// ---- static lists ----
const readList = (f) =>
  new Set(
    (existsSync(join(HERE, f)) ? readFileSync(join(HERE, f), 'utf8') : '')
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && !s.startsWith('#')),
  );
const DISPOSABLE = readList('disposable-domains.txt');
const FREE_PROVIDERS = readList('free-providers.txt');

// ---- args ----
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const flag = (f) => args.includes(f);
const flagVal = (f) => (args.indexOf(f) !== -1 ? args[args.indexOf(f) + 1] : undefined);
const PRETTY = flag('--pretty');
const OUT = flagVal('--json');
const MAX_DEPTH = flagVal('--max-depth') !== undefined ? Number(flagVal('--max-depth')) : 4;
const DEEP = flag('--deep');
const TIER = flagVal('--tier') || 'low';
const NO_BIO = flag('--no-bio');
const BIO_MODE = flagVal('--bio-mode') || 'fast';

if (!email) {
  console.error(
    'Usage: node dev-trace.mjs <email> [--pretty] [--json <path>] [--max-depth N] [--deep] [--tier low|medium|high] [--no-bio] [--bio-mode fast|balanced|deep|max]',
  );
  process.exit(2);
}

// ---- helpers ----
const meta = {
  email,
  depths_run: [],
  match_status: 'unverified_candidates',
  rate_limited: [],
  errors: [],
  generated_at: new Date().toISOString(),
};
const profile = {};

function addField(key, value, confidence, source) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value === 'string') {
    value = value.trim();
    if (!value || /^\.?(null|n\/?a|none|undefined|unknown)$/i.test(value)) return;
  }
  const existing = profile[key];
  if (!existing) {
    profile[key] = { value, confidence, sources: [source], conflict: null };
    return;
  }
  if (existing.value === value) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.confidence = Math.max(existing.confidence, confidence);
    return;
  }
  if (confidence > existing.confidence) {
    profile[key] = {
      value,
      confidence,
      sources: [source],
      conflict: { value: existing.value, sources: existing.sources },
    };
  } else if (!existing.conflict) {
    existing.conflict = { value, sources: [source] };
  }
}

async function http(url, { method = 'GET', headers = {}, body, ms = 9000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { ok: r.ok, status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse a /research SSE stream (read in full) for the final report + cited source URLs.
function parseResearch(sseText) {
  let report = null;
  let cited = [];
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const o = JSON.parse(line.slice(5).trim());
      const d = o.data || o; // raw data line is the Data object; tolerate an envelope too
      if (typeof d.report === 'string' && d.report) {
        report = d.report;
        cited = (d.metadata?.citedPages || []).map((p) => p.url).filter(Boolean);
      }
    } catch {
      /* skip non-JSON keepalive/comment lines */
    }
  }
  return { report, cited };
}

const domain = (email.split('@')[1] || '').toLowerCase();
const isFreeProvider = FREE_PROVIDERS.has(domain);
let strongIdentity = false;

// ---- depth 0: validate (free, always) ----
async function depth0() {
  const syntax = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const disposable = DISPOSABLE.has(domain);
  let mx = false;
  try {
    const records = await resolveMx(domain);
    mx = Array.isArray(records) && records.length > 0;
  } catch {
    mx = false;
  }
  meta.validation = { syntax, mx, disposable };
  meta.depths_run.push(0);
}

// ---- depth 1: surface (free, always) ----
async function depth1Surface() {
  // Gravatar
  try {
    const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    const res = await http(`https://www.gravatar.com/${hash}.json`, {
      headers: { 'User-Agent': 'trace-skill' },
    });
    const entry = res.json?.entry?.[0];
    if (entry) {
      addField('name', entry.displayName || entry.name?.formatted, 0.7, 'gravatar');
      addField('location', entry.currentLocation, 0.6, 'gravatar');
      addField('avatar', entry.thumbnailUrl, 0.8, 'gravatar');
      for (const acct of entry.accounts || [])
        addField(`social_${acct.shortname || acct.domain}`, acct.url, 0.6, 'gravatar');
      strongIdentity = true;
    }
  } catch (e) {
    meta.errors.push(`gravatar: ${e.message}`);
  }
  // Domain surface scrape (skip free webmail)
  if (!isFreeProvider && domain) {
    try {
      const res = await http(`https://${domain}`, { headers: { 'User-Agent': 'trace-skill' } });
      if (res.ok && res.text) {
        const title = res.text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
        const desc = res.text
          .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
          ?.trim();
        const site = res.text
          .match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
          ?.trim();
        addField('company_name', site || title, 0.5, 'domain');
        addField('company_description', desc, 0.5, 'domain');
        addField('company_domain', domain, 0.9, 'domain');
      }
    } catch (e) {
      meta.errors.push(`domain: ${e.message}`);
    }
  }
  meta.depths_run.push(1);
}

// ---- depth 1: verify (Hunter, if key) ----
async function depth1Verify() {
  if (!HUNTER) return;
  try {
    const res = await http(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER}`,
    );
    if (res.status === 429) {
      meta.rate_limited.push('hunter-verify');
      return;
    }
    if (!res.ok) {
      meta.errors.push(`hunter-verify: HTTP ${res.status}`);
      return;
    }
    const d = res.json?.data;
    if (d) {
      meta.verification = { status: d.status, result: d.result, score: d.score };
      if (d.status === 'valid' || d.result === 'deliverable') strongIdentity = true;
    }
  } catch (e) {
    meta.errors.push(`hunter-verify: ${e.message}`);
  }
}

// ---- depth 2: profile (GitHub, free; token recommended) ----
async function depth2() {
  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'trace-skill',
    };
    if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;
    const search = await http(
      `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
      { headers },
    );
    if (search.status === 403 || search.status === 429) {
      meta.rate_limited.push('github');
      meta.depths_run.push(2);
      return;
    }
    const login = search.json?.items?.[0]?.login;
    if (login) {
      const u = (await http(`https://api.github.com/users/${login}`, { headers })).json;
      if (u) {
        addField('github_login', u.login, 0.85, 'github');
        addField('name', u.name, 0.8, 'github');
        addField('company_name', (u.company || '').replace(/^@/, ''), 0.7, 'github');
        addField('location', u.location, 0.75, 'github');
        addField('bio', u.bio, 0.7, 'github');
        addField('website', u.blog, 0.6, 'github');
        addField('github_public_repos', u.public_repos, 0.9, 'github');
        addField('github_followers', u.followers, 0.9, 'github');
        strongIdentity = true;
      }
    }
  } catch (e) {
    meta.errors.push(`github: ${e.message}`);
  }
  meta.depths_run.push(2);
}

// ---- depth 3: enriched (Tabstack, if key) ----
async function depth3() {
  if (!TABSTACK || isFreeProvider || !domain) return;
  try {
    const res = await http('https://api.tabstack.ai/v1/extract/json', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TABSTACK}`,
        'Content-Type': 'application/json',
      },
      body: {
        url: `https://${domain}`,
        effort: 'standard',
        json_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Company or organization name' },
            description: { type: 'string', description: 'What the company does' },
            industry: { type: 'string' },
            employee_count: { type: 'string', description: 'Company size or employee range' },
            location: { type: 'string', description: 'Headquarters location' },
            social_links: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      ms: 60000,
    });
    if (res.status === 429) {
      meta.rate_limited.push('tabstack');
      return;
    }
    const d = res.json;
    if (d && typeof d === 'object') {
      addField('company_name', d.name, 0.75, 'tabstack');
      addField('company_description', d.description, 0.75, 'tabstack');
      addField('company_industry', d.industry, 0.75, 'tabstack');
      addField('company_size', d.employee_count, 0.7, 'tabstack');
      addField('company_location', d.location, 0.7, 'tabstack');
      for (const link of d.social_links || []) {
        if (typeof link !== 'string' || /google\.[a-z.]+\/url/i.test(link)) continue;
        const host = (link.match(/https?:\/\/(?:www\.)?([^./]+)/) || [])[1] || 'link';
        addField(`company_social_${host}`, link, 0.6, 'tabstack');
      }
    }
    meta.depths_run.push(3);
  } catch (e) {
    meta.errors.push(`tabstack: ${e.message}`);
  }
}

// ---- depth 4: deep (Hunter person enrichment via people/find, if key) ----
async function depth4() {
  if (!HUNTER) return;
  try {
    const res = await http(
      `https://api.hunter.io/v2/people/find?email=${encodeURIComponent(email)}&api_key=${HUNTER}`,
    );
    if (res.status === 429) {
      meta.rate_limited.push('hunter-enrich');
      return;
    }
    if (res.status === 404) {
      // ran, but Hunter has no enrichment record for this email, not an error
      meta.depths_run.push(4);
      return;
    }
    if (!res.ok) {
      meta.errors.push(`hunter-enrich: HTTP ${res.status}`);
      return;
    }
    const p = res.json?.data;
    if (p) {
      addField('name', p.name?.fullName, 0.9, 'hunter');
      addField('role', p.employment?.title, 0.9, 'hunter');
      addField('seniority', p.employment?.seniority, 0.85, 'hunter');
      addField('company_name', p.employment?.name, 0.8, 'hunter');
      addField('location', p.location, 0.8, 'hunter');
      addField('bio', p.bio, 0.7, 'hunter');
      addField('website', p.site, 0.6, 'hunter');
      if (p.github?.handle) addField('github_login', p.github.handle, 0.8, 'hunter');
      if (p.linkedin?.handle)
        addField('social_linkedin', `https://linkedin.com/in/${p.linkedin.handle}`, 0.9, 'hunter');
      if (p.twitter?.handle)
        addField('social_twitter', `https://twitter.com/${p.twitter.handle}`, 0.85, 'hunter');
      strongIdentity = true;
    }
    meta.depths_run.push(4);
  } catch (e) {
    meta.errors.push(`hunter-enrich: ${e.message}`);
  }
}

// ---- depth 5: deep (SixtyFour people-intelligence, async; needs --deep + key + identity anchor) ----
async function depth5() {
  if (!SIXTYFOUR || !DEEP) return;
  if (meta.validation?.disposable || meta.validation?.mx === false) {
    meta.errors.push('sixtyfour: skipped, email is disposable or has no MX');
    return;
  }
  const name = profile.name?.value;
  const linkedin = profile.social_linkedin?.value;
  try {
    const lead_info = { email };
    if (name) lead_info.name = name;
    if (profile.role?.value) lead_info.title = profile.role.value;
    if (profile.company_name?.value) lead_info.company = profile.company_name.value;
    if (profile.location?.value) lead_info.location = profile.location.value;
    if (linkedin) lead_info.linkedin = linkedin;
    const struct = {
      name: "The individual's full name",
      email: "The individual's email address",
      phone: "The individual's phone number",
      title: "The individual's job title",
      linkedin: 'LinkedIn URL for the person',
      github_url: 'URL for their GitHub profile',
      website: 'Company website URL',
      location: "The individual's location",
      industry: 'Industry the person operates in',
    };
    const submit = await http('https://api.sixtyfour.ai/people-intelligence-async', {
      method: 'POST',
      headers: { 'x-api-key': SIXTYFOUR, 'Content-Type': 'application/json' },
      body: { lead_info, struct, tier: TIER },
      ms: 30000,
    });
    if (!submit.ok) {
      meta.errors.push(`sixtyfour: submit HTTP ${submit.status}`);
      return;
    }
    const taskId = submit.json?.task_id || submit.json?.taskId;
    if (!taskId) {
      meta.errors.push('sixtyfour: no task_id returned');
      return;
    }
    const deadline = Date.now() + 12 * 60 * 1000; // 12 min cap
    let result = null;
    while (Date.now() < deadline) {
      await sleep(10000);
      const st = await http(`https://api.sixtyfour.ai/job-status/${taskId}`, {
        headers: { 'x-api-key': SIXTYFOUR },
        ms: 30000,
      });
      const status = (st.json?.status || '').toLowerCase();
      if (status === 'completed') {
        result = st.json?.result;
        break;
      }
      if (status === 'failed' || status === 'cancelled') {
        meta.errors.push(`sixtyfour: job ${status}`);
        return;
      }
    }
    if (!result) {
      meta.errors.push('sixtyfour: timed out before completion');
      return;
    }
    const sd = result.structured_data || result;
    const score = result.confidence_score;
    const conf = typeof score === 'number' ? Math.max(0, Math.min(1, score / 10)) : 0.8;
    if (sd && typeof sd === 'object') {
      addField('name', sd.name, conf, 'sixtyfour');
      addField('role', sd.title, conf, 'sixtyfour');
      addField('location', sd.location, conf, 'sixtyfour');
      addField('company_name', sd.company, conf, 'sixtyfour');
      addField('company_industry', sd.industry, conf, 'sixtyfour');
      addField('website', sd.website, conf * 0.9, 'sixtyfour');
      if (sd.linkedin) addField('social_linkedin', sd.linkedin, conf, 'sixtyfour');
      if (sd.github_url) addField('social_github', sd.github_url, conf, 'sixtyfour');
      if (sd.phone) addField('phone', sd.phone, conf, 'sixtyfour');
      if (sd.email) addField('email_found', sd.email, conf, 'sixtyfour');
      meta.sixtyfour_confidence = score;
      strongIdentity = true;
    }
    meta.depths_run.push(5);
  } catch (e) {
    meta.errors.push(`sixtyfour: ${e.message}`);
  }
}

// ---- bio: synthesized via Tabstack /research, anchored on the resolved name ----
async function bioResearch() {
  if (!TABSTACK || NO_BIO) return;
  const name = profile.name?.value;
  if (!name) {
    meta.errors.push('bio: skipped, no name to research');
    return;
  }
  try {
    const company = profile.company_name?.value;
    const role = profile.role?.value;
    const q =
      `Write a concise professional bio (3-5 sentences) of ${name}` +
      (company ? `, who works at ${company}` : '') +
      (role ? ` (${role})` : '') +
      `. Email: ${email}. Cover their background, current role, and notable work. Public information only.`;
    const res = await http('https://api.tabstack.ai/v1/research', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TABSTACK}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: { query: q, mode: BIO_MODE },
      ms: 240000,
    });
    if (!res.ok) {
      meta.errors.push(`bio: research HTTP ${res.status}`);
      return;
    }
    const { report, cited } = parseResearch(res.text || '');
    if (report) {
      addField('bio', report.trim(), 0.85, 'tabstack-research');
      if (cited.length) meta.bio_sources = cited;
    } else {
      meta.errors.push('bio: no report found in research stream');
    }
  } catch (e) {
    meta.errors.push(`bio: ${e.message}`);
  }
}

// ---- run waterfall in order ----
await depth0();
if (MAX_DEPTH >= 1) {
  await depth1Surface();
  await depth1Verify();
}
if (MAX_DEPTH >= 2) await depth2();
if (MAX_DEPTH >= 3) await depth3();
if (MAX_DEPTH >= 4) await depth4();
await depth5(); // gated internally by --deep + SIXTYFOUR_API_KEY + identity anchor
await bioResearch(); // Tabstack /research bio, gated on TABSTACK_API_KEY + resolved name

// ---- match status ----
const verified = meta.verification?.result === 'deliverable' || meta.verification?.status === 'valid';
if (verified && strongIdentity) meta.match_status = 'verified';
else if (strongIdentity) meta.match_status = 'probable';
else meta.match_status = 'unverified_candidates';

meta.depths_run = [...new Set(meta.depths_run)].sort((a, b) => a - b);
if (!meta.errors.length) delete meta.errors;
if (!meta.rate_limited.length) delete meta.rate_limited;

const result = { meta, profile };
const out = JSON.stringify(result, null, PRETTY ? 2 : 0);
if (OUT) {
  writeFileSync(OUT, out);
  console.error(`Wrote ${OUT}`);
} else {
  console.log(out);
}
