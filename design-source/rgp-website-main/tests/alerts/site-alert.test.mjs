/**
 * Website alerts (CORE_CONTRACTS §32): scripts/lib/site-alert.mjs against mocked GitHub, ClickUp and Slack HTTP —
 * the ClickUp → Slack → issue order, dedup, the 24 h reminder, recovery, missing config, ClickUp failure, secret
 * scrubbing, the watches' external issue — plus alerts.json and the site-alerts.yml workflow list.
 * Copied unchanged into every client repo. Run: npm run test:alerts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAlerter, parseMarker, trackConsecutive, slackMentions, whenText, alertKey } from '../../scripts/lib/site-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'alerts.json'), 'utf8'));
const SLACK = 'https://hooks.slack.com/services/T000/B000/SECRETWEBHOOKPATH';
const CU_TOKEN = 'pk_12345_SECRETCLICKUPTOKEN';
const GH_TOKEN = 'ghs_SECRETGITHUBTOKEN123';
const ENV = { GITHUB_TOKEN: GH_TOKEN, GITHUB_REPOSITORY: 'org/client-website', CLICKUP_API_TOKEN: CU_TOKEN, SLACK_ALERT_WEBHOOK_URL: SLACK };

/** In-memory GitHub + ClickUp + Slack. `calls` records [service, method, path] in order. */
function world({ clickupFails = false, clickupEcho = false } = {}) {
  const w = { calls: [], issues: [], comments: [], tasks: new Map(), taskComments: [], slack: [], labels: new Set(), nextIssue: 1, nextTask: 1 };
  const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url === SLACK) { w.calls.push(['slack', method, '']); w.slack.push(body.text); return new Response('ok', { status: 200 }); }
    if (u.host === 'api.clickup.com') {
      const p = u.pathname.replace('/api/v2', '');
      w.calls.push(['clickup', method, p]);
      assert.equal(init.headers.authorization, CU_TOKEN);
      if (clickupFails) return json(500, { err: clickupEcho ? `bad token ${CU_TOKEN}` : 'ClickUp is down' });
      let m;
      if (method === 'GET' && (m = /^\/list\/(\d+)\/task$/.exec(p))) return json(200, { tasks: [...w.tasks.values()].filter((t) => t.status.type !== 'closed') });
      if (method === 'POST' && (m = /^\/list\/(\d+)\/task$/.exec(p))) {
        const id = `task${w.nextTask++}`;
        const t = { id, url: `https://app.clickup.com/t/${id}`, ...body, status: { status: body.status, type: 'open' } };
        w.tasks.set(id, t);
        return json(200, t);
      }
      if (method === 'GET' && (m = /^\/list\/(\d+)$/.exec(p))) return json(200, { statuses: [{ status: 'new error', type: 'open' }, { status: 'resolved', type: 'closed' }] });
      if ((m = /^\/task\/(\w+)$/.exec(p))) {
        const t = w.tasks.get(m[1]);
        if (method === 'GET') return json(200, t);
        if (method === 'PUT') { Object.assign(t, body.status ? { status: { status: body.status, type: body.status === 'resolved' ? 'closed' : 'custom' } } : body); return json(200, t); }
      }
      if (method === 'POST' && (m = /^\/task\/(\w+)\/comment$/.exec(p))) { w.taskComments.push({ id: m[1], text: body.comment_text }); return json(200, {}); }
      return json(404, { err: `unmocked ${method} ${p}` });
    }
    if (u.host === 'api.github.com') {
      const p = u.pathname.replace('/repos/org/client-website', '');
      w.calls.push(['github', method, p]);
      assert.equal(init.headers.authorization, `Bearer ${GH_TOKEN}`);
      let m;
      if (method === 'GET' && p === '/issues') {
        const label = u.searchParams.get('labels');
        return json(200, w.issues.filter((i) => i.state === 'open' && i.labels.includes(label)).map((i) => ({ ...i, labels: i.labels.map((name) => ({ name })) })));
      }
      if (method === 'POST' && p === '/labels') { if (w.labels.has(body.name)) return json(422, { message: 'exists' }); w.labels.add(body.name); return json(201, {}); }
      if (method === 'POST' && p === '/issues') {
        const i = { number: w.nextIssue++, title: body.title, body: body.body, labels: body.labels ?? [], state: 'open' };
        i.html_url = `https://github.com/org/client-website/issues/${i.number}`;
        w.issues.push(i);
        return json(201, i);
      }
      if ((m = /^\/issues\/(\d+)$/.exec(p))) {
        const i = w.issues.find((x) => x.number === Number(m[1]));
        if (method === 'GET') return json(200, i);
        if (method === 'PATCH') { Object.assign(i, body); return json(200, i); }
      }
      if (method === 'POST' && (m = /^\/issues\/(\d+)\/comments$/.exec(p))) { w.comments.push({ n: Number(m[1]), body: body.body }); return json(201, {}); }
      if (method === 'POST' && (m = /^\/issues\/(\d+)\/labels$/.exec(p))) { const i = w.issues.find((x) => x.number === Number(m[1])); i.labels.push(...body.labels); return json(200, []); }
      return json(404, { message: `unmocked ${method} ${p}` });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return w;
}

const T0 = Date.parse('2026-10-28T14:05:00Z');
function alerter(w, { env = ENV, at = () => T0, logs = [] } = {}) {
  return createAlerter({ env, config: CONFIG, fetch: w.fetch, now: at, log: (l) => logs.push(l) });
}
const ALERT = {
  site: 'Romexterra Restoration', check: 'uptime', title: 'Website down or broken', summary: 'homepage returned HTTP 500',
  where: 'https://www.romexterra.com/', severity: 'Critical', cause: 'HTTP 500', nextStep: 'Check Vercel', links: [{ label: 'Page', url: 'https://www.romexterra.com/' }],
};
const kinds = (w) => w.calls.map(([s, m, p]) => `${s} ${m} ${p}`);

test('alerts.json holds the owner settings (channel, three tags, list, statuses, assignees, High)', () => {
  assert.equal(CONFIG.slack.channel, 'C09M21R8U8H');
  assert.deepEqual(CONFIG.slack.mentionOnNewAlert.map((p) => p.slackId), ['U08FYV2PA4C', 'U0A6MC0SE84', 'U02P5FDUR8W']);
  assert.equal(CONFIG.clickup.listId, '901820755955');
  assert.equal(CONFIG.clickup.openStatus, 'new error');
  assert.equal(CONFIG.clickup.closedStatus, 'resolved');
  assert.deepEqual(CONFIG.clickup.assignees.map((p) => p.clickupId), [107572892, 95483966]);
  assert.equal(CONFIG.clickup.priority, 2);
  assert.equal(slackMentions(CONFIG.slack.mentionOnNewAlert), '<@U08FYV2PA4C> <@U0A6MC0SE84> <@U02P5FDUR8W>');
  assert.equal(slackMentions(['S0123ABC']), '<!subteam^S0123ABC>');
  assert.match(whenText(T0), /^2026-10-28 14:05 UTC \(Oct 28, 10:05 AM EDT\)$/);
});

test('new alert: ClickUp task, then Slack (tags + ClickUp URL), then GitHub issue (ClickUp link); task gets the issue link', async () => {
  const w = world();
  const r = await alerter(w).raise(ALERT);
  assert.equal(r.action, 'opened');
  const order = kinds(w).filter((k) => /clickup POST \/list|slack POST|github POST \/issues$/.test(k));
  assert.deepEqual(order, ['clickup POST /list/901820755955/task', 'slack POST ', 'github POST /issues']);
  const task = w.tasks.get('task1');
  assert.equal(task.name, '[Romexterra Restoration] Website down or broken');
  assert.deepEqual(task.assignees, [107572892, 95483966]);
  assert.equal(task.priority, 2);
  assert.equal(task.status.status, 'new error');
  for (const part of ['What broke', 'https://www.romexterra.com/', '2026-10-28 14:05 UTC', 'EDT', 'Critical', 'Likely cause', '**Next step:** Check Vercel']) assert.ok(task.markdown_content.includes(part), part);
  assert.ok(task.markdown_content.includes('https://github.com/org/client-website/issues/1'), 'ClickUp description updated with the issue link');
  assert.equal(w.slack.length, 1);
  assert.ok(w.slack[0].startsWith('<@U08FYV2PA4C> <@U0A6MC0SE84> <@U02P5FDUR8W>'), w.slack[0]);
  assert.ok(w.slack[0].includes('https://app.clickup.com/t/task1'));
  assert.ok(w.slack[0].includes('homepage returned HTTP 500'));
  const issue = w.issues[0];
  assert.deepEqual(issue.labels, ['site-alert']);
  assert.ok(issue.body.includes('https://app.clickup.com/t/task1'));
  const st = parseMarker(issue.body);
  assert.equal(st.key, 'romexterra-restoration/uptime');
  assert.equal(st.clickup.id, 'task1');
  assert.ok(st.lastSlack);
});

test('repeat failure: comments on the same task + issue, no new task / issue / Slack; status untouched; quiet within 6 h', async () => {
  const w = world();
  await alerter(w).raise(ALERT);
  const second = await alerter(w, { at: () => T0 + 15 * 60_000 }).raise({ ...ALERT, summary: 'homepage timed out after 20 s' });
  assert.equal(second.action, 'repeat');
  assert.equal(w.tasks.size, 1);
  assert.equal(w.issues.length, 1);
  assert.equal(w.slack.length, 1);
  assert.ok(w.taskComments.some((c) => c.id === 'task1' && c.text.includes('timed out')));
  assert.ok(w.comments.some((c) => c.n === 1 && c.body.includes('timed out')));
  assert.equal(w.tasks.get('task1').status.status, 'new error');
  // same summary 15 min later: no comment anywhere, only the marker's count changes
  const before = [w.taskComments.length, w.comments.length];
  const third = await alerter(w, { at: () => T0 + 30 * 60_000 }).raise({ ...ALERT, summary: 'homepage timed out after 20 s' });
  assert.equal(third.action, 'repeat');
  assert.deepEqual([w.taskComments.length, w.comments.length], before);
  assert.equal(parseMarker(w.issues[0].body).count, 3);
});

test('one Slack reminder (no tags) after 24 h, never a second one', async () => {
  const w = world();
  await alerter(w).raise(ALERT);
  await alerter(w, { at: () => T0 + 25 * 3_600_000 }).raise(ALERT);
  await alerter(w, { at: () => T0 + 50 * 3_600_000 }).raise(ALERT);
  assert.equal(w.slack.length, 2);
  assert.match(w.slack[1], /^⏰ Still broken after/);
  assert.ok(!w.slack[1].includes('<@'), 'reminder does not tag');
  assert.ok(w.slack[1].includes('https://app.clickup.com/t/task1'));
});

test('recovery: task → "resolved", Slack ✅ with the ClickUp link (no tags), issue commented + closed', async () => {
  const w = world();
  await alerter(w).raise(ALERT);
  const r = await alerter(w, { at: () => T0 + 45 * 60_000 }).resolve({ site: ALERT.site, check: 'uptime' });
  assert.equal(r.action, 'resolved');
  assert.equal(w.tasks.get('task1').status.status, 'resolved');
  assert.match(w.slack[1], /^✅ resolved: \*\[Romexterra Restoration\] Website down or broken\* — back to normal after 45 min\. ClickUp: <https:\/\/app\.clickup\.com\/t\/task1\|task>$/);
  assert.equal(w.issues[0].state, 'closed');
  assert.ok(w.comments.at(-1).body.startsWith('✅ Resolved'));
  // a later pass finds nothing open
  const again = await alerter(w).resolve({ site: ALERT.site, check: 'uptime' });
  assert.equal(again.action, 'none');
  assert.equal(w.slack.length, 2);
  // the next failure opens a NEW alert
  await alerter(w).raise(ALERT);
  assert.equal(w.issues.length, 2);
  assert.equal(w.tasks.size, 2);
});

test('recovery leaves an already-resolved task alone', async () => {
  const w = world();
  await alerter(w).raise(ALERT);
  w.tasks.get('task1').status = { status: 'resolved', type: 'closed' };
  await alerter(w).resolve({ site: ALERT.site, check: 'uptime' });
  const puts = w.calls.filter(([s, m, p]) => s === 'clickup' && m === 'PUT' && p === '/task/task1');
  assert.equal(puts.length, 1, 'only the description update from raise, no status change');
});

test('missing secrets: GitHub issue only, each skipped channel named; recovery closes the issue', async () => {
  const w = world();
  const logs = [];
  const a = alerter(w, { env: { GITHUB_TOKEN: GH_TOKEN, GITHUB_REPOSITORY: 'org/client-website' }, logs });
  const r = await a.raise({ ...ALERT, test: true, check: 'alert-test', title: 'Alert test — please ignore' });
  assert.equal(r.clickup, 'skipped');
  assert.equal(r.slack, 'skipped');
  assert.equal(r.github, 'opened');
  assert.ok(logs.some((l) => l.includes('CLICKUP_API_TOKEN not set')));
  assert.ok(logs.some((l) => l.includes('SLACK_ALERT_WEBHOOK_URL not set')));
  assert.ok(!w.calls.some(([s]) => s !== 'github'));
  assert.equal(w.issues[0].title, '[TEST] [Romexterra Restoration] Alert test — please ignore');
  assert.ok(w.issues[0].body.includes('CLICKUP_API_TOKEN not set'));
  const done = await a.resolve({ site: ALERT.site, check: 'alert-test' });
  assert.equal(done.github, 'closed');
  assert.equal(w.issues[0].state, 'closed');
  // the closed issue keeps the full delivery log (not the body from before Slack was tried)
  assert.ok(w.issues[0].body.includes('Slack: skipped — SLACK_ALERT_WEBHOOK_URL not set'), w.issues[0].body);
  assert.ok(parseMarker(w.issues[0].body).resolvedAt);
});

test('ClickUp failure: the issue is opened first and Slack says ClickUp failed and links the issue; secrets never logged', async () => {
  const w = world({ clickupFails: true, clickupEcho: true });
  const logs = [];
  const r = await alerter(w, { logs }).raise(ALERT);
  assert.equal(r.clickup, 'failed');
  const order = kinds(w).filter((k) => /slack POST|github POST \/issues$/.test(k));
  assert.deepEqual(order, ['github POST /issues', 'slack POST ']);
  assert.match(w.slack[0], /ClickUp failed .* GitHub issue: <https:\/\/github\.com\/org\/client-website\/issues\/1\|#1>/);
  assert.ok(w.slack[0].includes('<@U02P5FDUR8W>'));
  const everything = [...logs, ...r.lines, w.issues[0].body, ...w.slack].join('\n');
  for (const secret of [CU_TOKEN, SLACK, GH_TOKEN]) assert.ok(!everything.includes(secret), 'secret leaked');
  assert.ok(everything.includes('***'));
});

test('watches: an existing issue is the GitHub record (no second issue); a newer watch issue takes the record over', async () => {
  const w = world();
  w.issues.push({ number: 7, title: 'PageSpeed watch: October 2026 — 1 site(s) below the bars', body: 'report', labels: [], state: 'open', html_url: 'https://github.com/org/client-website/issues/7' });
  w.nextIssue = 8;
  const watch = { site: 'All live sites', check: 'perf-watch', title: 'PageSpeed watch: sites below the bars', summary: '1 site below', issue: 7 };
  const r = await alerter(w).raise(watch);
  assert.equal(r.github, 'linked');
  assert.equal(w.issues.length, 1);
  assert.deepEqual(w.issues[0].labels, ['site-alert']);
  assert.ok(w.issues[0].body.startsWith('report'));
  assert.equal(parseMarker(w.issues[0].body).key, 'all-live-sites/perf-watch');
  // next month: issue #8, same open alert → moved, #7 closed, no new task or Slack
  w.issues.push({ number: 8, title: 'PageSpeed watch: November 2026 — 1 site(s) below the bars', body: 'report 2', labels: [], state: 'open' });
  const r2 = await alerter(w, { at: () => T0 + 30 * 86_400_000 }).raise({ ...watch, issue: 8 });
  assert.equal(r2.action, 'repeat');
  assert.equal(w.issues[0].state, 'closed');
  assert.equal(parseMarker(w.issues[0].body), null);
  assert.equal(parseMarker(w.issues[1].body).key, 'all-live-sites/perf-watch');
  assert.equal(w.tasks.size, 1);
  assert.equal(w.slack.filter((s) => s.startsWith('<@')).length, 1);
});

test('no GitHub record but an open ClickUp task with the same name: reused, no second task, no Slack', async () => {
  const w = world();
  w.tasks.set('old1', { id: 'old1', url: 'https://app.clickup.com/t/old1', name: '[Romexterra Restoration] Website down or broken', status: { status: 'investigating', type: 'custom' } });
  const r = await alerter(w).raise(ALERT);
  assert.equal(r.clickup, 'reused');
  assert.equal(w.tasks.size, 1);
  assert.equal(w.slack.length, 0);
  assert.equal(parseMarker(w.issues[0].body).clickup.id, 'old1');
  assert.equal(w.tasks.get('old1').status.status, 'investigating', 'status untouched');
});

test('never throws: an exploding fetch is logged and returned as an error', async () => {
  const logs = [];
  const a = createAlerter({ env: ENV, config: CONFIG, fetch: () => { throw new Error(`boom ${SLACK}`); }, log: (l) => logs.push(l) });
  const r = await a.raise(ALERT);
  assert.ok(['opened', 'error'].includes(r.action));
  assert.ok(!logs.join('\n').includes(SLACK));
});

test('two consecutive failures before an alert; recovery on the first success', () => {
  let s = {};
  let step = trackConsecutive(s, false); assert.equal(step.action, 'wait'); s = step.state;
  step = trackConsecutive(s, false); assert.equal(step.action, 'raise'); s = step.state;
  step = trackConsecutive(s, false); assert.equal(step.action, 'raise'); s = step.state;
  step = trackConsecutive(s, true); assert.equal(step.action, 'resolve'); s = step.state;
  assert.equal(trackConsecutive(s, true).action, 'none');
  // one blip then fine: resolve is harmless (nothing open)
  assert.equal(trackConsecutive(trackConsecutive({}, false).state, true).action, 'resolve');
  assert.equal(alertKey({ site: 'Green State Restoration', check: 'uptime' }), 'green-state-restoration/uptime');
});

test('site-alerts.yml watches EVERY other workflow in this repo', () => {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return;
  const alerts = readFileSync(join(dir, 'site-alerts.yml'), 'utf8');
  const listed = /workflows:\n((?:\s+- .+\n)+)/.exec(alerts)[1].split('\n').map((l) => l.replace(/^\s+- /, '').trim()).filter(Boolean);
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x) && x !== 'site-alerts.yml')) {
    const name = /^name:\s*(.+)$/m.exec(readFileSync(join(dir, f), 'utf8'))?.[1].trim().replace(/^['"]|['"]$/g, '');
    assert.ok(listed.includes(name), `${f} ("${name}") is not listed under workflow_run.workflows in site-alerts.yml — its failures would not alert`);
  }
});
