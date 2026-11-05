/**
 * site-alert.mjs — the ONE "something broke on a client website" alert (CORE_CONTRACTS §32).
 * Copied UNCHANGED into every repo that sends alerts (client site repos via the starter, agent-website-builder reads
 * the starter's copy, rgp-lead-router). Settings: alerts.json (non-secret, copied unchanged). Secrets (env, GitHub
 * organization secrets): CLICKUP_API_TOKEN, SLACK_ALERT_WEBHOOK_URL. GitHub: GITHUB_TOKEN or GH_TOKEN (the job's
 * own token, issues: write) and GITHUB_REPOSITORY. Node built-ins only.
 *
 * NEW alert, in this order:
 *   1. ClickUp task in the alerts list: "[<site>] <what broke>", status "new error", assignees, priority High, with a
 *      description (what / where / when UTC + ET / severity / likely cause / exact next step / links).
 *   2. Slack post through the incoming webhook, tagging every person in alerts.json, with a one-line summary and the
 *      ClickUp task URL. If ClickUp failed or was skipped, the GitHub issue is opened first so Slack can link it, and
 *      the post says ClickUp failed.
 *   3. GitHub issue in the repo where the check ran (label "site-alert"), linking the ClickUp task; the ClickUp
 *      description is then updated with the issue link.
 * DEDUP — one open alert per (site, check). The key ("<site-slug>/<check>") and the alert's state (ClickUp task id +
 * URL, first/last seen, count, last comment, last Slack post) live in a one-line marker in the GitHub issue body:
 *   <!-- site-alert:v1 {"key":…} -->
 * Lookup = the repo's OPEN issues labelled "site-alert". If GitHub has no record (issue could not be opened), an OPEN
 * ClickUp task in the list with exactly the same name is reused instead of creating a second one.
 * REPEAT failure: no new task, no new issue, no new Slack post. A comment goes on the ClickUp task and the issue when
 * the one-line summary changed or ≥ repeatCommentHours since the last comment (otherwise only the marker's last-seen /
 * count is updated, silently). The ClickUp status is never changed on a repeat. ONE Slack reminder (no tags) when the
 * alert is still open slackReminderHours after the Slack post; a Slack post that never happened (webhook not set yet)
 * is sent on the first repeat after the webhook exists.
 * RECOVERY (the same check passes): ClickUp task → closedStatus ("resolved") unless it is already closed, plus a
 * comment; Slack "✅ resolved: …" with the ClickUp link (no tags); GitHub issue commented and closed.
 * EXTERNAL issue (the PageSpeed / search engine watches): pass `issue: <number>` — that issue is the GitHub record
 * (labelled + marker appended), no second issue is opened. If the state sits on an older watch issue it moves to the
 * new one (the old one is closed as superseded).
 * MISSING CONFIG: a channel whose secret is not set is SKIPPED with a plain reason; the GitHub issue is still opened.
 * Nothing here throws to the caller and nothing prints a secret (every message is scrubbed).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER = 'site-alert:v1';
const MARKER_RE = /<!-- site-alert:v1 (\{.*?\}) -->/;
const CLICKUP = 'https://api.clickup.com/api/v2';
const HOUR = 3_600_000;

/** alerts.json: ALERTS_CONFIG env, else ./alerts.json, else ./starter/alerts.json (agent-website-builder root). */
export function loadConfig(path, cwd = process.cwd()) {
  const candidates = [path, process.env.ALERTS_CONFIG, join(cwd, 'alerts.json'), join(cwd, 'starter', 'alerts.json')].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`alerts.json not found (looked in: ${candidates.join(', ')})`);
  return JSON.parse(readFileSync(found, 'utf8'));
}

export const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
export const alertKey = (a) => a.key || `${slugify(a.siteSlug || a.site)}/${a.check}`;
export const taskName = (a) => `${a.test ? '[TEST] ' : ''}[${a.site}] ${a.title}`;

/** "2026-10-28 14:05 UTC (10:05 AM EDT)" */
export function whenText(date) {
  const d = new Date(date);
  const utc = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  let et = '';
  try {
    et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', timeZoneName: 'short' }).format(d);
  } catch { /* no ICU: UTC only */ }
  return et ? `${utc} (${et})` : utc;
}

export function durationText(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}

/** Slack mention markup for the configured people: <@U…> users, <!subteam^S…> user groups. */
export function slackMentions(people = []) {
  return people.map((p) => String(p.slackId ?? p).trim()).filter(Boolean)
    .map((id) => (id.startsWith('<') ? id : /^S[A-Z0-9]+$/.test(id) ? `<!subteam^${id}>` : `<@${id}>`)).join(' ');
}

export function parseMarker(body) {
  const m = MARKER_RE.exec(String(body ?? ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
/** JSON inside an HTML comment: "--" and ">" are escaped so the comment can never close early. */
export function markerLine(state) {
  return `<!-- ${MARKER} ${JSON.stringify(state).replace(/--/g, '-\\u002d').replace(/>/g, '\\u003e')} -->`;
}
export function withMarker(body, state) {
  const b = String(body ?? '');
  return MARKER_RE.test(b) ? b.replace(MARKER_RE, markerLine(state)) : `${b.trimEnd()}\n\n${markerLine(state)}\n`;
}
const withoutMarker = (body) => String(body ?? '').replace(MARKER_RE, '').trimEnd() + '\n';

/**
 * Consecutive-failure counter for checks that should not alert on one blip (site uptime: 2 in a row).
 * Returns the next state and what to do: 'raise' (threshold reached or already raised), 'wait' (failing, below the
 * threshold), 'resolve' (passed after failing), 'none' (passed, nothing open).
 */
export function trackConsecutive(prev = {}, ok, threshold = 2, nowIso = new Date().toISOString()) {
  if (ok) return { state: { fails: 0 }, action: prev.fails > 0 || prev.raised ? 'resolve' : 'none' };
  const fails = (prev.fails ?? 0) + 1;
  const firstFailAt = prev.firstFailAt ?? nowIso;
  const raised = prev.raised || fails >= threshold;
  return { state: { fails, firstFailAt, raised }, action: raised ? 'raise' : 'wait' };
}

/**
 * createAlerter({ env, config, fetch, log, now, repo, serverUrl })
 *   raise(alert)   alert = { site, siteSlug?, check, title, summary, where?, severity?, cause?, nextStep?, links?:[{label,url}],
 *                            details?, issue?: number, test?: boolean, key? }
 *   resolve(alert) alert = { site, siteSlug?, check, key?, summary?, issue? }
 * Both resolve to { action, key, clickup, slack, github, lines } and never throw.
 */
export function createAlerter(opts = {}) {
  const env = opts.env ?? process.env;
  const config = opts.config ?? loadConfig();
  const http = opts.fetch ?? globalThis.fetch;
  const log = opts.log ?? ((line) => console.log(line));
  const now = () => new Date(opts.now ? opts.now() : Date.now());
  const repo = opts.repo ?? env.GITHUB_REPOSITORY ?? '';
  const serverUrl = (opts.serverUrl ?? env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/+$/, '');
  const apiUrl = (opts.apiUrl ?? env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
  const ghToken = String(env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  const cuSecret = config.clickup?.tokenSecret ?? 'CLICKUP_API_TOKEN';
  const slackSecret = config.slack?.webhookSecret ?? 'SLACK_ALERT_WEBHOOK_URL';
  const cuToken = String(env[cuSecret] ?? '').trim();
  const slackUrl = String(env[slackSecret] ?? '').trim();
  const listId = String(config.clickup?.listId ?? '').trim();
  const label = config.github?.label ?? 'site-alert';
  const repeatMs = (config.timing?.repeatCommentHours ?? 6) * HOUR;
  const remindMs = (config.timing?.slackReminderHours ?? 24) * HOUR;
  const secrets = [cuToken, slackUrl, ghToken].filter((s) => s.length >= 8);
  const scrub = (s) => secrets.reduce((t, sec) => t.split(sec).join('***'), String(s ?? ''));
  const say = (line) => log(scrub(line));

  const clickupSkip = !cuToken ? `${cuSecret} not set` : !listId ? 'alerts.json clickup.listId not set' : null;
  const slackSkip = !slackUrl ? `${slackSecret} not set` : null;
  const githubSkip = !ghToken ? 'GITHUB_TOKEN / GH_TOKEN not set' : !repo ? 'GITHUB_REPOSITORY not set' : null;

  async function call(url, init, what) {
    let res;
    try {
      res = await http(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new Error(`${what}: ${scrub(e?.message ?? e)}`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && (data.err || data.message || data.error)) || String(text).slice(0, 200);
      const err = new Error(`${what} → HTTP ${res.status}: ${scrub(msg)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------- GitHub ----------------
  const gh = (method, path, body) => call(`${apiUrl}/repos/${repo}${path}`, {
    method,
    headers: { authorization: `Bearer ${ghToken}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'rgp-site-alert', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, `GitHub ${method} ${path.split('?')[0]}`);

  let openCache = null;
  async function openAlertIssues() {
    if (openCache) return openCache;
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await gh('GET', `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`);
      all.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
    openCache = all;
    return all;
  }
  async function findRecord(key) {
    if (githubSkip) return null;
    const issues = await openAlertIssues();
    for (const issue of issues) {
      const state = parseMarker(issue.body);
      if (state?.key === key) return { issue, state };
    }
    return null;
  }
  async function ensureLabel() {
    try { await gh('POST', '/labels', { name: label, color: 'd73a4a', description: 'Website alert (CORE_CONTRACTS §32) — closed automatically on recovery' }); }
    catch (e) { if (e.status !== 422) throw e; }
  }
  const issueUrl = (n) => `${serverUrl}/${repo}/issues/${n}`;
  const remember = (issue) => { if (openCache && issue?.number) openCache = [...openCache.filter((i) => i.number !== issue.number), issue]; };
  const forget = (n) => { if (openCache) openCache = openCache.filter((i) => i.number !== n); };

  // ---------------- ClickUp ----------------
  const cu = (method, path, body) => call(`${CLICKUP}${path}`, {
    method,
    headers: { authorization: cuToken, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, `ClickUp ${method} ${path.split('?')[0].replace(/\/[0-9a-z]{6,}(?=\/|$)/g, '/…')}`);
  async function findOpenTask(name) {
    const data = await cu('GET', `/list/${listId}/task?archived=false&include_closed=false&page=0`);
    return (data?.tasks ?? []).find((t) => t.name === name) ?? null;
  }
  const cuComment = (id, text) => cu('POST', `/task/${id}/comment`, { comment_text: text, notify_all: false });

  // ---------------- Slack ----------------
  async function slack(text) {
    const res = await http(slackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(20_000) })
      .catch((e) => { throw new Error(`Slack: ${scrub(e?.message ?? e)}`); });
    if (!res.ok) throw new Error(`Slack → HTTP ${res.status}: ${scrub((await res.text()).slice(0, 120))}`);
  }

  // ---------------- text ----------------
  function description(a, st, issueLink) {
    const links = (a.links ?? []).filter((l) => l?.url);
    return [
      a.test ? '**TEST ALERT — please ignore.** Sent on purpose to prove the alert path works; it resolves itself right away.\n' : '',
      `**What broke:** ${a.title}${a.summary ? ` — ${a.summary}` : ''}`,
      `**Site:** ${a.site}${a.where ? ` · ${a.where}` : ''}`,
      `**When:** first seen ${whenText(st.firstSeen)}${st.count > 1 ? `; still failing at ${whenText(st.lastSeen)} (${st.count} checks)` : ''}`,
      `**Severity:** ${a.severity ?? 'High'}`,
      `**Likely cause:** ${a.cause || 'Not known to the check — open the link below.'}`,
      `**Next step:** ${a.nextStep || 'Open the link below, fix the cause, then re-run the check.'}`,
      links.length ? `**Links:**\n${links.map((l) => `- ${l.label}: ${l.url}`).join('\n')}` : '',
      `**GitHub issue:** ${issueLink || 'being opened (linked here as soon as it exists)'}`,
      a.details ? `\n${String(a.details).slice(0, 20000)}` : '',
      `\n_Alert key \`${st.key}\` (one open alert per site + check; repeat failures are comments here; closed automatically when the check passes). CORE_CONTRACTS §32._`,
    ].filter(Boolean).join('\n');
  }
  function issueBody(a, st, delivery) {
    return [
      description(a, st, '(this issue)').replace('**GitHub issue:** (this issue)\n', ''),
      '',
      `**ClickUp task:** ${st.clickup?.url ?? 'none'}`,
      '',
      '### Alert delivery',
      ...delivery.map((d) => `- ${d}`),
      '',
      markerLine(st),
      '',
    ].join('\n');
  }

  const result = (action, key) => ({ action, key, clickup: 'skipped', slack: 'skipped', github: 'skipped', lines: [], issue: null, clickupUrl: null });
  function note(r, channel, status, text) {
    r[channel] = status;
    const line = `${channel === 'clickup' ? 'ClickUp' : channel === 'slack' ? 'Slack' : 'GitHub issue'}: ${status}${text ? ` — ${scrub(text)}` : ''}`;
    r.lines.push(line);
    say(`${status === 'failed' ? '✗' : status === 'skipped' ? '⚠' : '✓'} ${line}`);
  }

  // ---------------- raise ----------------
  async function raise(a) {
    const key = alertKey(a);
    const r = result('opened', key);
    const t = now();
    const name = taskName(a);
    let record = null;
    try { record = await findRecord(key); }
    catch (e) { say(`✗ GitHub lookup failed — ${scrub(e.message)} (continuing without dedup on GitHub)`); }
    if (record) return repeat(a, record, r, t, name);

    const st = { key, site: a.site, check: a.check, title: a.title, test: Boolean(a.test), clickup: null, firstSeen: t.toISOString(), lastSeen: t.toISOString(), count: 1, lastComment: t.toISOString(), lastSlack: null, reminded: false, summary: a.summary ?? '' };
    let reused = false;

    // 1. ClickUp
    if (clickupSkip) note(r, 'clickup', 'skipped', clickupSkip);
    else {
      try {
        const existing = await findOpenTask(name).catch(() => null);
        if (existing) {
          reused = true;
          st.clickup = { id: existing.id, url: existing.url };
          await cuComment(existing.id, `Failing again ${whenText(t)}: ${a.summary ?? a.title}`).catch(() => {});
          note(r, 'clickup', 'reused', `open task with the same name found: ${existing.url}`);
        } else {
          const body = {
            name,
            markdown_content: description(a, st, ''),
            description: description(a, st, '').replace(/\*\*/g, ''),
            assignees: (config.clickup?.assignees ?? []).map((p) => Number(p.clickupId ?? p)).filter(Boolean),
            priority: a.test ? (config.clickup?.testPriority ?? 4) : (config.clickup?.priority ?? 2),
            ...(config.clickup?.openStatus ? { status: config.clickup.openStatus } : {}),
          };
          const task = await cu('POST', `/list/${listId}/task`, body);
          st.clickup = { id: task.id, url: task.url ?? `https://app.clickup.com/t/${task.id}` };
          note(r, 'clickup', 'created', st.clickup.url);
        }
      } catch (e) { note(r, 'clickup', 'failed', e.message); }
    }

    // 3 before 2 only when there is no ClickUp task: Slack must link something.
    let issue = null;
    let issueTried = false;
    const delivery = () => r.lines.slice();
    const openIssue = async () => {
      issueTried = true;
      if (githubSkip) { note(r, 'github', 'skipped', githubSkip); return null; }
      try {
        if (a.issue) {
          const existing = await gh('GET', `/issues/${a.issue}`);
          await gh('POST', `/issues/${a.issue}/labels`, { labels: [label] }).catch(async () => { await ensureLabel(); await gh('POST', `/issues/${a.issue}/labels`, { labels: [label] }); });
          const updated = await gh('PATCH', `/issues/${a.issue}`, { body: withMarker(existing.body, st) });
          remember(updated);
          note(r, 'github', 'linked', `${issueUrl(a.issue)} (existing issue used as the record)`);
          return updated;
        }
        await ensureLabel();
        const created = await gh('POST', '/issues', { title: name, body: issueBody(a, st, delivery()), labels: [label] });
        remember(created);
        note(r, 'github', 'opened', created.html_url ?? issueUrl(created.number));
        return created;
      } catch (e) { note(r, 'github', 'failed', e.message); return null; }
    };
    if (!st.clickup) issue = await openIssue();

    // 2. Slack
    if (reused) note(r, 'slack', 'skipped', 'the ClickUp task was already open (team already told)');
    else if (slackSkip) note(r, 'slack', 'skipped', slackSkip);
    else {
      const link = st.clickup
        ? `ClickUp: <${st.clickup.url}|task>`
        : `ClickUp failed (${r.clickup === 'skipped' ? clickupSkip : 'see the issue'}) — GitHub issue: ${issue ? `<${issue.html_url ?? issueUrl(issue.number)}|#${issue.number}>` : 'could not be opened either'}`;
      const text = `${slackMentions(config.slack?.mentionOnNewAlert)} ${a.test ? '🧪 *TEST — please ignore.* ' : '🔴 '}*${name}* — ${a.summary || a.title}. ${link}`;
      try { await slack(text.trim()); st.lastSlack = t.toISOString(); note(r, 'slack', 'posted'); }
      catch (e) { note(r, 'slack', 'failed', e.message); }
    }

    // 3. GitHub issue (or the record update when it was opened early)
    if (!issueTried) issue = await openIssue();
    else if (issue && !a.issue) {
      try { const upd = await gh('PATCH', `/issues/${issue.number}`, { body: issueBody(a, st, delivery()) }); remember(upd); }
      catch (e) { say(`✗ could not update issue #${issue.number}: ${scrub(e.message)}`); }
    }
    if (issue && a.issue) {
      await gh('POST', `/issues/${issue.number}/comments`, { body: `🔴 Alert sent for this issue (CORE_CONTRACTS §32).\n\n${delivery().map((d) => `- ${d}`).join('\n')}` }).catch(() => {});
    }
    if (issue) {
      try { // marker last, so it records the Slack time
        const cur = await gh('GET', `/issues/${issue.number}`);
        remember(await gh('PATCH', `/issues/${issue.number}`, { body: withMarker(cur.body, st) }));
      } catch (e) { say(`✗ could not save the alert state on issue #${issue.number}: ${scrub(e.message)}`); }
    }
    // ClickUp description gets the issue link
    if (st.clickup && issue && !reused) {
      const link = issue.html_url ?? issueUrl(issue.number);
      await cu('PUT', `/task/${st.clickup.id}`, { markdown_content: description(a, st, link), description: description(a, st, link).replace(/\*\*/g, '') })
        .catch((e) => say(`⚠ ClickUp description not updated with the issue link: ${scrub(e.message)}`));
    }
    r.issue = issue?.number ?? null;
    r.clickupUrl = st.clickup?.url ?? null;
    return r;
  }

  async function repeat(a, record, r, t, name) {
    r.action = 'repeat';
    const st = { ...record.state };
    let issueNo = record.issue.number;
    const changed = (a.summary ?? '') !== (st.summary ?? '');
    const due = !st.lastComment || t - new Date(st.lastComment) >= repeatMs;
    const comment = changed || due;
    st.lastSeen = t.toISOString();
    st.count = (st.count ?? 1) + 1;
    st.summary = a.summary ?? st.summary;
    const text = `Still failing (${whenText(t)}, check #${st.count}, broken since ${whenText(st.firstSeen)}): ${a.summary || a.title}`;

    // The watches open a new issue each week/month: move the record to it.
    if (a.issue && a.issue !== issueNo && !githubSkip) {
      try {
        const old = record.issue;
        await gh('POST', `/issues/${old.number}/comments`, { body: `Continued in #${a.issue} (the newer report). Closing this one.` });
        await gh('PATCH', `/issues/${old.number}`, { body: withoutMarker(old.body), state: 'closed', state_reason: 'completed' });
        forget(old.number);
        issueNo = a.issue;
        const cur = await gh('GET', `/issues/${issueNo}`);
        await gh('POST', `/issues/${issueNo}/labels`, { labels: [label] });
        record = { issue: cur, state: st };
      } catch (e) { say(`✗ could not move the alert to #${a.issue}: ${scrub(e.message)}`); }
    }

    // ClickUp: comment only (status untouched). A task missing because ClickUp was not set up yet is created now.
    if (clickupSkip) note(r, 'clickup', 'skipped', clickupSkip);
    else if (st.clickup?.id) {
      if (comment) {
        try { await cuComment(st.clickup.id, text); note(r, 'clickup', 'commented', st.clickup.url); }
        catch (e) { note(r, 'clickup', 'failed', e.message); }
      } else note(r, 'clickup', 'unchanged', `same failure, last comment < ${repeatMs / HOUR} h ago`);
    } else {
      try {
        const existing = await findOpenTask(name).catch(() => null);
        const task = existing ?? await cu('POST', `/list/${listId}/task`, {
          name,
          markdown_content: description(a, st, issueUrl(issueNo)),
          description: description(a, st, issueUrl(issueNo)).replace(/\*\*/g, ''),
          assignees: (config.clickup?.assignees ?? []).map((p) => Number(p.clickupId ?? p)).filter(Boolean),
          priority: a.test ? (config.clickup?.testPriority ?? 4) : (config.clickup?.priority ?? 2),
          ...(config.clickup?.openStatus ? { status: config.clickup.openStatus } : {}),
        });
        st.clickup = { id: task.id, url: task.url ?? `https://app.clickup.com/t/${task.id}` };
        note(r, 'clickup', existing ? 'reused' : 'created', st.clickup.url);
      } catch (e) { note(r, 'clickup', 'failed', e.message); }
    }

    // Slack: never a second "new alert" post. First post if it never happened; one reminder after slackReminderHours.
    const link = st.clickup ? `ClickUp: <${st.clickup.url}|task>` : `GitHub issue: <${issueUrl(issueNo)}|#${issueNo}>`;
    if (slackSkip) note(r, 'slack', 'skipped', slackSkip);
    else if (!st.lastSlack) {
      const msg = `${slackMentions(config.slack?.mentionOnNewAlert)} ${a.test ? '🧪 *TEST — please ignore.* ' : '🔴 '}*${name}* — ${a.summary || a.title} (broken since ${whenText(st.firstSeen)}). ${link}`;
      try { await slack(msg.trim()); st.lastSlack = t.toISOString(); note(r, 'slack', 'posted', 'first post for this alert (Slack was not reachable/set before)'); }
      catch (e) { note(r, 'slack', 'failed', e.message); }
    } else if (!st.reminded && t - new Date(st.lastSlack) >= remindMs) {
      try { await slack(`⏰ Still broken after ${durationText(t - new Date(st.firstSeen))}: *${name}* — ${a.summary || a.title}. ${link}`); st.reminded = true; note(r, 'slack', 'reminder'); }
      catch (e) { note(r, 'slack', 'failed', e.message); }
    } else note(r, 'slack', 'not reposted', 'repeat of an open alert');

    // GitHub: comment (same cadence as ClickUp) + state
    if (githubSkip) note(r, 'github', 'skipped', githubSkip);
    else {
      try {
        if (comment) await gh('POST', `/issues/${issueNo}/comments`, { body: `${text}${a.links?.[0]?.url ? `\n\n${a.links[0].label}: ${a.links[0].url}` : ''}` });
        if (comment) st.lastComment = t.toISOString();
        const cur = issueNo === record.issue.number ? record.issue : await gh('GET', `/issues/${issueNo}`);
        const upd = await gh('PATCH', `/issues/${issueNo}`, { body: withMarker(cur.body, st) });
        forget(record.issue.number); remember(upd);
        note(r, 'github', comment ? 'commented' : 'updated', issueUrl(issueNo));
      } catch (e) { note(r, 'github', 'failed', e.message); }
    }
    r.issue = issueNo;
    r.clickupUrl = st.clickup?.url ?? null;
    return r;
  }

  // ---------------- resolve ----------------
  async function resolve(a) {
    const key = alertKey(a);
    const r = result('none', key);
    if (githubSkip) { r.action = 'unknown'; note(r, 'github', 'skipped', `${githubSkip} — the open alert (if any) cannot be found`); return r; }
    let record = null;
    try { record = await findRecord(key); }
    catch (e) { say(`✗ GitHub lookup failed — ${scrub(e.message)}`); r.action = 'unknown'; return r; }
    if (!record) { r.lines.push('no open alert'); return r; }
    r.action = 'resolved';
    const t = now();
    const st = { ...record.state, resolvedAt: t.toISOString() };
    const name = taskName({ ...a, site: st.site ?? a.site, title: st.title ?? a.title, test: st.test });
    const took = durationText(t - new Date(st.firstSeen));
    const text = `✅ Resolved ${whenText(t)} — the check passed again${a.summary ? ` (${a.summary})` : ''}. Broken for ${took} (since ${whenText(st.firstSeen)}).`;

    if (clickupSkip) note(r, 'clickup', 'skipped', clickupSkip);
    else if (!st.clickup?.id) note(r, 'clickup', 'skipped', 'no ClickUp task for this alert');
    else {
      try {
        const task = await cu('GET', `/task/${st.clickup.id}`);
        const closed = task?.status?.type === 'closed' || task?.status?.type === 'done';
        if (!closed) {
          let target = config.clickup?.closedStatus;
          try { await cu('PUT', `/task/${st.clickup.id}`, { status: target }); }
          catch {
            const list = await cu('GET', `/list/${listId}`);
            target = (list?.statuses ?? []).find((s) => s.type === 'closed')?.status ?? (list?.statuses ?? []).find((s) => s.type === 'done')?.status;
            if (!target) throw new Error('the list has no closed status');
            await cu('PUT', `/task/${st.clickup.id}`, { status: target });
          }
        }
        await cuComment(st.clickup.id, text);
        note(r, 'clickup', closed ? 'already closed' : 'resolved', st.clickup.url);
      } catch (e) { note(r, 'clickup', 'failed', e.message); }
    }

    if (slackSkip) note(r, 'slack', 'skipped', slackSkip);
    else if (!st.lastSlack) note(r, 'slack', 'skipped', 'the alert was never posted to Slack');
    else {
      const link = st.clickup ? `ClickUp: <${st.clickup.url}|task>` : `GitHub issue: <${issueUrl(record.issue.number)}|#${record.issue.number}>`;
      try { await slack(`✅ resolved: *${name}* — back to normal after ${took}. ${link}`); note(r, 'slack', 'posted'); }
      catch (e) { note(r, 'slack', 'failed', e.message); }
    }

    if (githubSkip) note(r, 'github', 'skipped', githubSkip);
    else {
      try {
        const n = record.issue.number;
        await gh('POST', `/issues/${n}/comments`, { body: `${text}\n\n${r.lines.map((l) => `- ${l}`).join('\n')}` });
        await gh('PATCH', `/issues/${n}`, { body: withMarker(record.issue.body, st), state: 'closed', state_reason: 'completed' });
        forget(n);
        note(r, 'github', 'closed', issueUrl(n));
      } catch (e) { note(r, 'github', 'failed', e.message); }
    }
    r.issue = record.issue.number;
    r.clickupUrl = st.clickup?.url ?? null;
    return r;
  }

  const safe = (fn) => async (a) => {
    try { return await fn(a); }
    catch (e) { say(`✗ alert error (ignored so the original job is unaffected): ${scrub(e?.stack ?? e)}`); return { action: 'error', key: alertKey(a), lines: [scrub(e?.message ?? e)] }; }
  };
  return { raise: safe(raise), resolve: safe(resolve), skipped: { clickup: clickupSkip, slack: slackSkip, github: githubSkip } };
}
