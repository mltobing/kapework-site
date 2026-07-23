/* netlify/functions/_ma-github-dispatch.js
 *
 * Shared, secret-safe GitHub Actions workflow-dispatch helper for the private
 * irma-sync repo. Used by both ma-sync-trigger.js (manual sync refresh) and
 * ma-calendar-write-request.js (owner-confirmed calendar actions) — same
 * fine-grained token, same repo/workflow/ref defaults, same never-log-the-
 * token/response discipline. Only the `inputs` payload differs per caller,
 * and only an explicitly allowlisted set of input keys is ever forwarded.
 */

const { requireEnvVars } = require('./_utils');

const DEFAULT_GITHUB_REPOSITORY = 'mltobing/irma-sync';
const DEFAULT_GITHUB_WORKFLOW = 'sync.yml';
const DEFAULT_GITHUB_REF = 'main';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const WORKFLOW_RE = /^[\w.-]+\.ya?ml$/;
const REF_RE = /^[\w./-]+$/;

// Every workflow_dispatch input this repo is ever allowed to send. Anything
// else in an `inputs` object is silently dropped, never forwarded verbatim —
// this is the one place that decides what a browser-triggered request can
// possibly cause the private workflow to see.
const ALLOWED_INPUT_KEYS = new Set(['manual_request_id', 'calendar_write_request_id']);

/** Validates the dispatch env vars and returns the resolved config. Throws
 * (never logs the token) if MA_SYNC_GITHUB_TOKEN is missing or any of the
 * optional repository/workflow/ref overrides don't look like their expected
 * shape. */
function githubWorkflowConfig() {
  requireEnvVars('MA_SYNC_GITHUB_TOKEN');
  const token = process.env.MA_SYNC_GITHUB_TOKEN;
  const repository = process.env.MA_SYNC_GITHUB_REPOSITORY || DEFAULT_GITHUB_REPOSITORY;
  const workflow = process.env.MA_SYNC_GITHUB_WORKFLOW || DEFAULT_GITHUB_WORKFLOW;
  const ref = process.env.MA_SYNC_GITHUB_REF || DEFAULT_GITHUB_REF;
  if (!REPO_RE.test(repository) || !WORKFLOW_RE.test(workflow) || !REF_RE.test(ref)) {
    throw new Error('invalid github dispatch configuration');
  }
  return { token, repository, workflow, ref };
}

/**
 * Dispatch the private irma-sync workflow with an allowlisted `inputs`
 * object (e.g. `{ manual_request_id }` or `{ calendar_write_request_id }`).
 * Never logs the token, the Authorization header, the request body, or the
 * GitHub response body — only a controlled error code on failure. Treats
 * both documented GitHub Actions workflow-dispatch success responses (204 No
 * Content, and the newer 200 with a workflow-run id/URL) as success; a run
 * id is kept only as an internal correlation aid, never required, never
 * returned to the browser as a private Actions URL.
 */
async function dispatchIrmaSync(inputs) {
  const { token, repository, workflow, ref } = githubWorkflowConfig();
  const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`;

  const safeInputs = {};
  for (const [key, value] of Object.entries(inputs || {})) {
    if (ALLOWED_INPUT_KEYS.has(key) && value != null) safeInputs[key] = String(value);
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: safeInputs }),
    });
  } catch (err) {
    console.error('[ma-github-dispatch] github dispatch network error:', err.message);
    return { ok: false, errorCode: 'network_error' };
  }

  if (res.status === 204) return { ok: true, githubRunId: null };

  if (res.status === 200) {
    let githubRunId = null;
    try {
      const runInfo = await res.json();
      if (runInfo && runInfo.id != null) githubRunId = String(runInfo.id);
    } catch {
      // A 200 with an unparseable body is still a documented success — the
      // run id is a best-effort correlation aid, never required.
    }
    return { ok: true, githubRunId };
  }

  console.error('[ma-github-dispatch] github dispatch rejected: status=%d', res.status);
  return { ok: false, errorCode: res.status >= 500 ? 'github_server_error' : 'github_client_error' };
}

module.exports = { githubWorkflowConfig, dispatchIrmaSync, ALLOWED_INPUT_KEYS };
