// Netlify Function: Data sync API
// Uses GitHub repo for persistent cloud storage
// GitHub token is stored in Netlify env vars — frontend never sees it

const headers = {
  'Content-Type': 'application/json;charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Config from env vars
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'JustXylia';
const GITHUB_REPO = process.env.GITHUB_REPO || 'relic-restoration-db';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DATA_DIR = process.env.DATA_DIR || 'data';

const GITHUB_API = 'https://api.github.com';

// Valid keys (prevent arbitrary file access)
const VALID_KEYS = [
  'userRelics_v1',
  'regUsers_v1',
  'relicOverrides_v1',
  'libs_v1',
  'allUsers_v1',
  'seqCounter_v1',
  'deletedRelics_v1'
];

async function githubRequest(path, options = {}) {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'relic-restoration-db',
      ...options.headers
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${data.message || text}`);
  }
  return data;
}

async function getFileContent(key) {
  const path = `repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_DIR}/${key}.json?ref=${GITHUB_BRANCH}`;
  try {
    const data = await githubRequest(path);
    if (data && data.content) {
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      return { content, sha: data.sha };
    }
    return { content: null, sha: null };
  } catch (e) {
    if (e.message && e.message.indexOf('404') >= 0) {
      return { content: null, sha: null };
    }
    throw e;
  }
}

async function putFileContent(key, content, sha) {
  const path = `repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_DIR}/${key}.json`;
  const body = {
    message: `Update ${key} via API`,
    content: Buffer.from(content).toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (sha) {
    body.sha = sha;
  }
  await githubRequest(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  });
}

exports.handler = async function(event, context) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // Parse key from path
  var path = event.path || '';
  var prefixes = ['/.netlify/functions/api/', '/api/'];
  var key = '';
  for (var i = 0; i < prefixes.length; i++) {
    if (path.startsWith(prefixes[i])) {
      key = path.substring(prefixes[i].length);
      break;
    }
  }

  // Health check (no key)
  if (!key) {
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        ok: true, 
        service: 'relic-db-api',
        hasToken: !!GITHUB_TOKEN,
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO
      }) 
    };
  }

  // Validate key
  if (VALID_KEYS.indexOf(key) < 0) {
    return { 
      statusCode: 400, 
      headers, 
      body: JSON.stringify({ ok: false, error: 'Invalid key' }) 
    };
  }

  // Require token for write operations
  if ((event.httpMethod === 'POST' || event.httpMethod === 'PUT' || event.httpMethod === 'DELETE') && !GITHUB_TOKEN) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ ok: false, error: 'Server not configured: missing GITHUB_TOKEN' }) 
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      var data = null;
      try {
        const result = await getFileContent(key);
        if (result.content !== null && result.content !== undefined) {
          try { data = JSON.parse(result.content); } catch (e) { data = result.content; }
        }
      } catch (e) {
        data = null;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: data }) };
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      const body = event.body || '';
      // Validate JSON
      try { JSON.parse(body); } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid JSON body' }) };
      }
      const existing = await getFileContent(key);
      await putFileContent(key, body, existing.sha);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      try {
        const existing = await getFileContent(key);
        if (existing.sha) {
          const path = `repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_DIR}/${key}.json`;
          await githubRequest(path, {
            method: 'DELETE',
            body: JSON.stringify({
              message: `Delete ${key} via API`,
              sha: existing.sha,
              branch: GITHUB_BRANCH
            }),
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (e) {}
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};
