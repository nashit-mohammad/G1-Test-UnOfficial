const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATABASE_FILE = path.join(ROOT, 'submissions.json');
const PAGE_FILE = path.join(ROOT, 'index.html');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#004990"/><path d="M32 8 54 20v24L32 56 10 44V20z" fill="#d62828" stroke="#fff" stroke-width="4"/><text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">G1</text></svg>`;

function readLocalSubmissions(){
  if(!fs.existsSync(DATABASE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch(error){
    return [];
  }
}

function writeLocalSubmissions(submissions){
  fs.writeFileSync(DATABASE_FILE, JSON.stringify(submissions, null, 2), 'utf8');
}

async function supabaseRequest(pathname, options = {}){
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if(!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
  const responseText = await response.text();
  return responseText ? JSON.parse(responseText) : null;
}

function rowToSubmission(row){
  return {
    sessionId: row.session_id,
    attemptId: row.attempt_id,
    submittedAt: row.submitted_at || row.created_at,
    user: row.user_data || {},
    difficulty: row.difficulty || 'medium',
    feedback: row.feedback || '',
    improvementAreas: row.improvement_areas || [],
    score: row.score || {},
    answers: row.answers || [],
    clientIp: 'Unknown IP',
    serverUserAgent: row.user_data?.userAgent || 'Unknown browser'
  };
}

async function readSubmissions(){
  if(!USE_SUPABASE) return readLocalSubmissions();
  const rows = await supabaseRequest('submissions?select=*');
  return rows.map(rowToSubmission);
}

async function saveSubmission(submission){
  if(!USE_SUPABASE){
    const submissions = readLocalSubmissions();
    const existingIndex = submission.attemptId
      ? submissions.findIndex(item => item.attemptId === submission.attemptId)
      : submission.sessionId
        ? submissions.findIndex(item => item.sessionId === submission.sessionId)
        : -1;
    if(existingIndex >= 0) submissions[existingIndex] = submission;
    else submissions.push(submission);
    writeLocalSubmissions(submissions);
    return {count: submissions.length, overwritten: existingIndex >= 0};
  }

  const row = {
    attempt_id: submission.attemptId || null,
    session_id: submission.sessionId || null,
    submitted_at: submission.submittedAt,
    user_data: submission.user || {},
    difficulty: submission.difficulty || 'medium',
    feedback: submission.feedback || '',
    improvement_areas: submission.improvementAreas || [],
    score: submission.score,
    answers: submission.answers
  };
  const rows = await supabaseRequest('submissions?on_conflict=attempt_id', {
    method: 'POST',
    headers: {'Prefer': 'resolution=merge-duplicates,return=minimal'},
    body: JSON.stringify(row)
  });
  return {count: rows ? rows.length : 0, overwritten: false};
}

async function deleteSubmission(recordKey){
  if(!USE_SUPABASE){
    const submissions = readLocalSubmissions();
    const remaining = submissions.filter(submission => submission.attemptId !== recordKey && submission.sessionId !== recordKey && submission.submittedAt !== recordKey);
    if(remaining.length === submissions.length) return false;
    writeLocalSubmissions(remaining);
    return true;
  }

  const rows = await supabaseRequest('submissions?select=id,attempt_id,session_id,submitted_at');
  const matches = rows.filter(row => row.attempt_id === recordKey || row.session_id === recordKey || row.submitted_at === recordKey);
  for(const row of matches){
    await supabaseRequest(`submissions?id=eq.${encodeURIComponent(row.id)}`, {method:'DELETE'});
  }
  return matches.length > 0;
}

function sendJson(response, statusCode, payload){
  response.writeHead(statusCode, {'Content-Type':'application/json; charset=utf-8'});
  response.end(JSON.stringify(payload));
}

function requireAdmin(request, response){
  if(!ADMIN_USERNAME || !ADMIN_PASSWORD){
    sendJson(response, 503, {ok:false, error:'Admin authentication is not configured'});
    return false;
  }

  const authorization = request.headers.authorization || '';
  const [scheme, encodedCredentials] = authorization.split(' ');
  if(scheme !== 'Basic' || !encodedCredentials){
    response.writeHead(401, {
      'Content-Type':'text/plain; charset=utf-8',
      'WWW-Authenticate':'Basic realm="G1 Practice Admin", charset="UTF-8"'
    });
    response.end('Admin authentication required');
    return false;
  }

  let credentials;
  try {
    credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
  } catch(error){
    credentials = '';
  }
  const separator = credentials.indexOf(':');
  const username = separator >= 0 ? credentials.slice(0, separator) : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';
  if(username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD){
    response.writeHead(401, {
      'Content-Type':'text/plain; charset=utf-8',
      'WWW-Authenticate':'Basic realm="G1 Practice Admin", charset="UTF-8"'
    });
    response.end('Invalid admin credentials');
    return false;
  }
  return true;
}

function escapeHtml(value){
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function renderAdminPage(){
  const submissions = (await readSubmissions()).slice().reverse();
  const rows = submissions.length ? submissions.map((submission, index) => {
    const user = submission.user || {};
    const displayName = user.name || 'Name not provided';
    const platform = user.platform || 'Unknown platform';
    const browser = user.userAgent || submission.serverUserAgent || 'Unknown browser';
    const clientIp = submission.clientIp || 'Unknown IP';
    const answers = (submission.answers || []).map(answer => {
      const isSkipped = answer.status === 'skipped' || answer.selected === 'Not answered';
      const status = isSkipped ? 'skipped' : answer.status;
      return `
      <tr class="${isSkipped ? 'skipped-row' : ''}">
        <td>${escapeHtml(answer.number)}</td>
        <td>${escapeHtml(answer.type)}</td>
        <td>${answer.image ? `<img class="question-image" src="${escapeHtml(answer.image)}" alt="Related question image" loading="lazy">` : ''}<div class="question-text">${escapeHtml(answer.question)}</div><ol class="answer-options">${(answer.options || []).map(option => `<li>${escapeHtml(option)}</li>`).join('')}</ol></td>
        <td>${escapeHtml(answer.selected || 'Not answered')}</td>
        <td>${escapeHtml(answer.correct)}</td>
        <td class="${status === 'correct' ? 'correct' : status === 'skipped' ? 'skipped' : 'incorrect'}">${escapeHtml(status)}</td>
      </tr>`;
    }).join('');
    return `<details class="attempt">
      <summary><strong>Response ${index + 1}</strong> · ${escapeHtml(displayName)} | ${escapeHtml(submission.submittedAt)} | ${escapeHtml(submission.difficulty || 'medium')} | ${escapeHtml(submission.score.correct)}/${escapeHtml(submission.score.total)} (${escapeHtml(submission.score.percent)}%) | ${escapeHtml(submission.score.answered)} answered</summary>
      <div class="attempt-meta">Road signs: ${escapeHtml(submission.score.signsCorrect)}/${escapeHtml(submission.score.signsTotal)} | Rules: ${escapeHtml(submission.score.rulesCorrect)}/${escapeHtml(submission.score.rulesTotal)}</div>
      <div class="device-meta">Device: ${escapeHtml(platform)} | IP: ${escapeHtml(clientIp)}<br>Browser: ${escapeHtml(browser)}</div>
      <div class="feedback-summary"><strong>Feedback:</strong> ${escapeHtml(submission.feedback || 'Not recorded')}<br><strong>Current improvement area:</strong> ${escapeHtml((submission.improvementAreas || []).join(', ') || 'None recorded')}</div>
      <button class="delete-attempt" type="button" data-record-key="${escapeHtml(submission.attemptId || submission.sessionId || submission.submittedAt || '')}">Delete this response</button>
      <label class="skip-filter"><input type="checkbox" class="hide-skipped"> Hide skipped questions</label>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Question</th><th>Submitted</th><th>Correct answer</th><th>Status</th></tr></thead><tbody>${answers}</tbody></table></div>
    </details>`;
  }).join('') : '<p>No submissions saved yet.</p>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23004990'/%3E%3Cpath d='M32 8 54 20v24L32 56 10 44V20z' fill='%23d62828' stroke='%23fff' stroke-width='4'/%3E%3Ctext x='32' y='38' text-anchor='middle' font-family='Arial,sans-serif' font-size='13' font-weight='700' fill='%23fff'%3EG1%3C/text%3E%3C/svg%3E"><title>G1 Admin Submissions</title><style>
    :root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#17202a;background:#edf3f8}*{box-sizing:border-box}body{max-width:1180px;margin:0 auto;padding:24px}.admin-header{background:#004990;color:#fff;border-radius:10px;padding:24px 26px;margin-bottom:18px;box-shadow:0 8px 20px rgba(0,73,144,.18)}h1{margin:0;font-size:26px}.intro{margin:7px 0 0;color:rgba(255,255,255,.84)}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.count{font-weight:700;color:#17324d}.home-link{color:#004990;background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:8px 11px;text-decoration:none;font-size:13px}.attempt{background:#fff;border:1px solid #dbe2ea;border-radius:8px;margin:12px 0;padding:16px;box-shadow:0 4px 14px rgba(15,23,42,.06)}summary{cursor:pointer;color:#17324d;line-height:1.5}.attempt-meta{margin:10px 0;color:#5c6773}.device-meta{margin:10px 0;padding:9px;background:#f4f7fb;color:#526174;font-size:12px;overflow-wrap:anywhere;border-radius:5px}.feedback-summary{margin:10px 0;padding:10px;border-left:3px solid #d99018;background:#fffaf0;font-size:13px;line-height:1.5;border-radius:0 5px 5px 0}.delete-attempt{padding:8px 11px;border:0;border-radius:6px;background:#a52222;color:#fff;cursor:pointer;font-weight:600}.skip-filter{display:block;margin:11px 0;font-size:13px;color:#526174}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}th,td{border:1px solid #dbe2ea;padding:8px;text-align:left;vertical-align:top}th{background:#eef3f8;color:#334155}.question-image{display:block;width:110px;height:74px;object-fit:contain;object-position:center;margin-bottom:7px;border-radius:5px;background:#eef3f8;border:1px solid #dbe2ea}.question-text{font-weight:600;color:#17324d}.answer-options{margin:8px 0 0;padding-left:22px;color:#526174}.answer-options li{padding:2px 0}.correct{color:#176b3c;font-weight:700}.incorrect{color:#a52222;font-weight:700}.skipped{color:#9a6500;font-weight:700}.empty{padding:28px;text-align:center;background:#fff;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b}@media(max-width:640px){body{padding:12px}.admin-header{padding:18px}.admin-header h1{font-size:21px}}
  </style></head><body><header class="admin-header"><h1>G1 Practice Admin</h1><p class="intro">Review user submissions, feedback, device details, and every answer.</p></header><div class="toolbar"><span id="attemptsCount" class="count">Saved attempts: ${submissions.length}</span><a class="home-link" href="/">Open user page</a></div><main id="attemptsList">${rows}</main><script>const count=document.getElementById('attemptsCount');const list=document.getElementById('attemptsList');function refreshCount(){const total=list.querySelectorAll('.attempt').length;count.textContent='Saved attempts: '+total;if(!total)list.innerHTML='<div class="empty">No submissions saved yet.</div>';}document.querySelectorAll('.hide-skipped').forEach(filter => filter.addEventListener('change', event => { const table = event.target.closest('.attempt'); table.querySelectorAll('.skipped-row').forEach(row => row.hidden = event.target.checked); }));document.querySelectorAll('.delete-attempt').forEach(button => button.addEventListener('click', async event => { const recordKey = event.currentTarget.dataset.recordKey; if(!recordKey || !confirm('Delete this complete response?')) return; event.currentTarget.disabled=true; const response = await fetch('/api/submissions/' + encodeURIComponent(recordKey), {method:'DELETE'}); if(response.ok){window.location.reload();}else{event.currentTarget.disabled=false;alert('Could not delete this response.');} }));</script></body></html>`;
}

function localAddresses(){
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces).flat().filter(info => info && info.family === 'IPv4' && !info.internal).map(info => info.address);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const isAdminRoute = requestUrl.pathname === '/admin'
    || (request.method === 'GET' && requestUrl.pathname === '/api/submissions')
    || (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/submissions/'));

  if(isAdminRoute && !requireAdmin(request, response)) return;

  if(request.method === 'GET' && requestUrl.pathname === '/favicon.ico'){
    response.writeHead(200, {'Content-Type':'image/svg+xml', 'Cache-Control':'public, max-age=86400'});
    response.end(FAVICON_SVG);
    return;
  }

  if(request.method === 'GET' && requestUrl.pathname === '/health'){
    const wantsHtml = (request.headers.accept || '').includes('text/html');
    const sendHealth = (statusCode, payload) => {
      if(!wantsHtml){
        sendJson(response, statusCode, payload);
        return;
      }
      response.writeHead(statusCode, {'Content-Type':'text/html; charset=utf-8'});
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>G1 Health Check</title><style>body{margin:0;padding:40px;font-family:system-ui,sans-serif;color:#17324d;background:#f5f7fb}main{max-width:560px;margin:auto;padding:28px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;box-shadow:0 8px 20px rgba(15,23,42,.08)}h1{margin-top:0}strong{color:${payload.ok ? '#176b3c' : '#a52222'}}</style></head><body><main><h1>G1 Health Check</h1><p>Status: <strong>${payload.ok ? 'Healthy' : 'Unavailable'}</strong></p><p>Storage: ${escapeHtml(payload.storage || payload.error || 'Unknown')}</p></main></body></html>`);
    };
    if(!USE_SUPABASE){
      sendHealth(200, {ok:true, storage:'local'});
      return;
    }
    try {
      await supabaseRequest('submissions?select=id&limit=1');
      sendHealth(200, {ok:true, storage:'supabase'});
    } catch(error){
      sendHealth(503, {ok:false, error:'Supabase unavailable'});
    }
    return;
  }

  if(request.method === 'POST' && requestUrl.pathname === '/api/submissions'){
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if(body.length > 2 * 1024 * 1024) request.destroy();
    });
    request.on('end', async () => {
      try {
        const submission = JSON.parse(body);
        if(!submission || !submission.score || !Array.isArray(submission.answers)) throw new Error('Invalid submission');
        const savedSubmission = {...submission, submittedAt: new Date().toISOString(), clientIp: request.socket.remoteAddress || 'Unknown IP', serverUserAgent: request.headers['user-agent'] || 'Unknown browser'};
        const result = await saveSubmission(savedSubmission);
        sendJson(response, 201, {ok:true, ...result});
      } catch(error){
        sendJson(response, 400, {ok:false, error:'Invalid submission'});
      }
    });
    return;
  }

  if(request.method === 'GET' && requestUrl.pathname === '/api/submissions'){
    sendJson(response, 200, await readSubmissions());
    return;
  }

  if(request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/submissions/')){
    const recordKey = decodeURIComponent(requestUrl.pathname.slice('/api/submissions/'.length));
    if(!await deleteSubmission(recordKey)){
      sendJson(response, 404, {ok:false, error:'Submission not found'});
    } else {
      sendJson(response, 200, {ok:true});
    }
    return;
  }

  if(request.method === 'GET' && requestUrl.pathname === '/admin'){
    renderAdminPage().then(page => {
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      response.end(page.replace('<a class="home-link" href="/">Open user page</a>', '<a class="home-link" href="/">Open user page</a><a class="home-link" href="/health">Health check</a>'));
    }).catch(() => sendJson(response, 503, {ok:false, error:'Could not load submissions'}));
    return;
  }

  if(request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/ontario-g1-practice.html')){
    fs.readFile(PAGE_FILE, (error, data) => {
      if(error){ response.writeHead(500); response.end('Practice page unavailable'); return; }
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      response.end(data);
    });
    return;
  }

  response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
  response.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Practice page: http://localhost:${PORT}`);
  console.log(`Admin submissions: http://localhost:${PORT}/admin`);
  for(const address of localAddresses()){
    console.log(`Phone page: http://${address}:${PORT}`);
    console.log(`Phone admin: http://${address}:${PORT}/admin`);
  }
});
