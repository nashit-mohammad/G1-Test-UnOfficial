const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT) || 8000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATABASE_FILE = path.join(ROOT, 'submissions.json');
const PAGE_FILE = path.join(ROOT, 'index.html');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(/[;,]/)
  .map(email => email.trim())
  .filter(Boolean);
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || '';
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

function emailNotificationsConfigured(){
  return Boolean(ADMIN_EMAILS.length && ((RESEND_API_KEY && RESEND_FROM) || (SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM)));
}

function buildSubmissionEmail(submission){
  const user = submission.user || {};
  const score = submission.score || {};
  const answers = submission.answers || [];
  const displayName = user.name || 'Name not provided';
  const platform = user.platform || 'Unknown platform';
  const browser = user.userAgent || submission.serverUserAgent || 'Unknown browser';
  const improvementAreas = submission.improvementAreas || [];
  const answerRows = answers.map(answer => {
    const isSkipped = answer.status === 'skipped' || answer.selected === 'Not answered';
    const status = isSkipped ? 'skipped' : answer.status || 'incorrect';
    const statusIcon = status === 'correct' ? '&#9989;' : status === 'skipped' ? '&#9197;' : '&#10060;';
    const statusColor = status === 'correct' ? '#176b3c' : status === 'skipped' ? '#64748b' : '#a52222';
    const image = answer.image && /^https?:\/\//i.test(answer.image)
      ? `<img src="${escapeHtml(answer.image)}" alt="Related question image" width="120" style="display:block;width:120px;height:80px;object-fit:contain;margin:0 0 8px;background:#eef3f8;border:1px solid #dbe2ea;border-radius:5px;">`
      : '';
    return `<tr>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;">${escapeHtml(answer.number)}</td>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;">${escapeHtml(answer.type)}</td>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;">${image}<strong>${escapeHtml(answer.question)}</strong><ol style="margin:8px 0 0;padding-left:20px;color:#526174;">${(answer.options || []).map(option => `<li style="padding:2px 0;">${escapeHtml(option)}</li>`).join('')}</ol></td>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;">${escapeHtml(answer.selected || 'Not answered')}</td>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;">${escapeHtml(answer.correct)}</td>
      <td style="padding:10px 8px;border:1px solid #dbe2ea;vertical-align:top;color:${statusColor};font-weight:700;white-space:nowrap;">${statusIcon} ${escapeHtml(status)}</td>
    </tr>`;
  }).join('');
  const textAnswers = answers.map(answer => {
    const status = answer.status === 'skipped' || answer.selected === 'Not answered' ? 'skipped' : answer.status || 'incorrect';
    return `Question ${answer.number} (${answer.type})\n${answer.question}\nSelected: ${answer.selected || 'Not answered'}\nCorrect: ${answer.correct}\nStatus: ${status}`;
  }).join('\n\n');
  const text = [
    'A new G1 practice response was submitted.',
    `Name: ${displayName}`,
    `Platform: ${platform}`,
    `Browser: ${browser}`,
    `IP: ${submission.clientIp || 'Unknown IP'}`,
    `Score: ${score.correct ?? 0}/${score.total ?? 0} (${score.percent ?? 0}%)`,
    `Answered: ${score.answered ?? 0}`,
    `Road signs: ${score.signsCorrect ?? 0}/${score.signsTotal ?? 0}`,
    `Rules: ${score.rulesCorrect ?? 0}/${score.rulesTotal ?? 0}`,
    `Difficulty: ${submission.difficulty || 'medium'}`,
    `Submitted: ${submission.submittedAt}`,
    `Feedback: ${submission.feedback || 'Not recorded'}`,
    `Improvement areas: ${improvementAreas.join(', ') || 'None recorded'}`,
    '',
    'Answers:',
    textAnswers
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#edf3f8;font-family:Arial,sans-serif;color:#17202a;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1100px;background:#fff;border:1px solid #dbe2ea;"><tr><td style="padding:24px 26px;background:#004990;color:#fff;"><h1 style="margin:0;font-size:24px;">&#128203; New G1 Practice Response</h1><p style="margin:8px 0 0;color:#e5eff8;">A user submitted a response for admin review.</p></td></tr><tr><td style="padding:20px 24px;"><h2 style="margin:0 0 14px;color:#17324d;">&#127919; ${escapeHtml(displayName)} &mdash; ${escapeHtml(score.percent ?? 0)}%</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;"><tr><td style="padding:10px;background:#f4f7fb;border:1px solid #dbe2ea;"><strong>&#9989; Score</strong><br>${escapeHtml(score.correct ?? 0)}/${escapeHtml(score.total ?? 0)}</td><td style="padding:10px;background:#f4f7fb;border:1px solid #dbe2ea;"><strong>&#128221; Answered</strong><br>${escapeHtml(score.answered ?? 0)}</td><td style="padding:10px;background:#f4f7fb;border:1px solid #dbe2ea;"><strong>&#128663; Road signs</strong><br>${escapeHtml(score.signsCorrect ?? 0)}/${escapeHtml(score.signsTotal ?? 0)}</td><td style="padding:10px;background:#f4f7fb;border:1px solid #dbe2ea;"><strong>&#128218; Rules</strong><br>${escapeHtml(score.rulesCorrect ?? 0)}/${escapeHtml(score.rulesTotal ?? 0)}</td></tr></table><h3 style="color:#17324d;">&#128100; User and device</h3><p style="padding:10px;background:#f4f7fb;line-height:1.6;"><strong>Name:</strong> ${escapeHtml(displayName)}<br><strong>Platform:</strong> ${escapeHtml(platform)}<br><strong>Browser:</strong> ${escapeHtml(browser)}<br><strong>IP:</strong> ${escapeHtml(submission.clientIp || 'Unknown IP')}<br><strong>Difficulty:</strong> ${escapeHtml(submission.difficulty || 'medium')}<br><strong>Submitted:</strong> ${escapeHtml(submission.submittedAt)}</p><h3 style="color:#17324d;">&#128172; Feedback</h3><p style="padding:10px;border-left:3px solid #d99018;background:#fffaf0;line-height:1.5;"><strong>Feedback:</strong> ${escapeHtml(submission.feedback || 'Not recorded')}<br><strong>Improvement areas:</strong> ${escapeHtml(improvementAreas.join(', ') || 'None recorded')}</p><h3 style="color:#17324d;">&#128203; Answer review</h3><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><thead><tr style="background:#eef3f8;color:#334155;"><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">#</th><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">Type</th><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">Question</th><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">Submitted</th><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">Correct answer</th><th align="left" style="padding:9px 8px;border:1px solid #dbe2ea;">Status</th></tr></thead><tbody>${answerRows}</tbody></table></td></tr></table></td></tr></table></body></html>`;
  return {html, text};
}

async function notifyAdminOfSubmission(submission){
  if(!emailNotificationsConfigured()){
    console.warn('Submission saved, but email notification is not configured. Set RESEND_API_KEY and RESEND_FROM in Render Environment.');
    return false;
  }

  const user = submission.user || {};
  const displayName = user.name || 'Name not provided';
  const email = buildSubmissionEmail(submission);
  const subject = `New G1 practice response from ${displayName}`;
  if(RESEND_API_KEY && RESEND_FROM){
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({from: RESEND_FROM, to: ADMIN_EMAILS, subject, text: email.text, html: email.html})
    });
    if(!resendResponse.ok){
      throw new Error(`Resend request failed: ${resendResponse.status} ${await resendResponse.text()}`);
    }
  } else {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {user: SMTP_USER, pass: SMTP_PASSWORD}
    });
    await transporter.sendMail({from: SMTP_FROM, to: ADMIN_EMAILS, subject, text: email.text, html: email.html});
  }
  console.log(`Submission notification email sent to ${ADMIN_EMAILS.join(', ')}`);
  return true;
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
  const userNames = [...new Set(submissions.map(submission => submission.user?.name?.trim() || 'Name not provided'))].sort((a, b) => a.localeCompare(b));
  const userFilters = userNames.map(name => `<label class="user-filter-option"><input type="checkbox" value="${escapeHtml(name)}"> ${escapeHtml(name)}</label>`).join('');
  const rows = submissions.length ? submissions.map((submission, index) => {
    const user = submission.user || {};
    const displayName = user.name || 'Name not provided';
    const submittedDate = /^\d{4}-\d{2}-\d{2}/.test(submission.submittedAt || '') ? submission.submittedAt.slice(0, 10) : '';
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
    return `<details class="attempt" data-user="${escapeHtml(displayName)}" data-date="${escapeHtml(submittedDate)}">
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
    :root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#17202a;background:#edf3f8}*{box-sizing:border-box}body{max-width:1180px;margin:0 auto;padding:24px}.admin-header{background:#004990;color:#fff;border-radius:10px;padding:24px 26px;margin-bottom:18px;box-shadow:0 8px 20px rgba(0,73,144,.18)}h1{margin:0;font-size:26px}.intro{margin:7px 0 0;color:rgba(255,255,255,.84)}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.count{font-weight:700;color:#17324d}.home-link{color:#004990;background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:8px 11px;text-decoration:none;font-size:13px}.attempt{background:#fff;border:1px solid #dbe2ea;border-radius:8px;margin:12px 0;padding:16px;box-shadow:0 4px 14px rgba(15,23,42,.06)}summary{cursor:pointer;color:#17324d;line-height:1.5}.attempt-meta{margin:10px 0;color:#5c6773}.device-meta{margin:10px 0;padding:9px;background:#f4f7fb;color:#526174;font-size:12px;overflow-wrap:anywhere;border-radius:5px}.feedback-summary{margin:10px 0;padding:10px;border-left:3px solid #d99018;background:#fffaf0;font-size:13px;line-height:1.5;border-radius:0 5px 5px 0}.delete-attempt{padding:8px 11px;border:0;border-radius:6px;background:#a52222;color:#fff;cursor:pointer;font-weight:600}.skip-filter{display:block;margin:11px 0;font-size:13px;color:#526174}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:600px;table-layout:fixed;font-size:12px}th,td{width:16.666%;border:1px solid #dbe2ea;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef3f8;color:#334155}.question-image{display:block;width:100%;max-width:110px;height:60px;object-fit:contain;object-position:center;margin-bottom:6px;border-radius:5px;background:#eef3f8;border:1px solid #dbe2ea}.question-text{font-weight:600;color:#17324d}.answer-options{margin:6px 0 0;padding-left:16px;color:#526174}.answer-options li{padding:2px 0}.correct{color:#176b3c;font-weight:700}.incorrect{color:#a52222;font-weight:700}.skipped{color:#9a6500;font-weight:700}.empty{padding:28px;text-align:center;background:#fff;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b}@media(max-width:640px){body{padding:12px}.admin-header{padding:18px}.admin-header h1{font-size:21px}}
    .filter-panel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:16px;margin-bottom:16px;background:#fff;border:1px solid #dbe2ea;border-radius:10px;box-shadow:0 4px 14px rgba(15,23,42,.05)}.filter-field{display:grid;align-content:start;gap:6px;font-size:13px;font-weight:650;color:#334155}.filter-field input[type=date],.filter-field input[type=search],.filter-field select,.multi-select>summary{width:100%;min-height:38px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#17324d;font:inherit;font-weight:500}.filter-field input:focus,.filter-field select:focus,.multi-select>summary:focus{outline:3px solid rgba(0,73,144,.14);border-color:#004990}.multi-select{position:relative}.multi-select>summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none}.multi-select>summary::-webkit-details-marker{display:none}.multi-select>summary:after{content:'▾';margin-left:10px;color:#526174}.multi-select[open]>summary{border-color:#004990;border-radius:7px 7px 0 0}.multi-select-menu{position:absolute;z-index:10;top:100%;left:0;right:0;padding:10px;background:#fff;border:1px solid #004990;border-top:0;border-radius:0 0 8px 8px;box-shadow:0 10px 22px rgba(15,23,42,.15)}.user-filter-list{display:grid;gap:2px;max-height:180px;overflow:auto;margin-top:8px;padding:5px;border:1px solid #e2e8f0;border-radius:6px}.user-filter-option{display:flex;align-items:center;gap:8px;padding:6px;border-radius:5px;font-weight:400;overflow-wrap:anywhere}.user-filter-option:hover{background:#f2f6fa}.user-filter-option input{accent-color:#004990}.user-filter-actions{display:flex;justify-content:space-between;gap:8px;margin-top:8px}.filter-panel button{padding:7px 11px;border:0;border-radius:999px;background:#004990;color:#fff;cursor:pointer;font:inherit;font-size:12px;font-weight:600}.filter-panel button.secondary{background:#e2e6f0;color:#004990}.selected-user-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.user-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;background:#e8f1f9;color:#17324d;font-size:11px;font-weight:600}.user-chip button{width:17px;height:17px;padding:0!important;border-radius:50%!important;background:#c9dced!important;color:#17324d!important;line-height:17px}.response-group{margin:18px 0}.response-group>h2{margin:0;padding:10px 13px;border-radius:7px;background:#dfeaf4;color:#17324d;font-size:17px}.response-group .response-group{margin:12px 0 12px 14px}.response-group .response-group>h2{font-size:15px;background:#edf3f8}.filter-empty{padding:24px;text-align:center;background:#fff;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b}@media(max-width:760px){.filter-panel{grid-template-columns:1fr}}
.response-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 8px}.response-heading{font-weight:700;color:#17324d;font-size:17px}.response-sort-toggle{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:7px 12px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#004990;font:inherit;font-size:13px;font-weight:650;cursor:pointer}.response-sort-toggle:hover{background:#edf4fa;border-color:#9db7d0}.response-sort-toggle:focus-visible{outline:3px solid rgba(0,73,144,.2);outline-offset:2px}.response-sort-toggle span:first-child{font-size:17px;line-height:1}</style><style>.filter-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.filter-label-row label,.filter-label-row span{font-size:13px;font-weight:650;color:#334155}.filter-panel .clear-filter{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:#e2e6f0;color:#004990;font-size:16px;line-height:1;cursor:pointer}.filter-panel .clear-filter:hover{background:#cbdced}.response-group{display:block;margin:12px 0;padding:0;overflow:hidden;background:#fff;border:1px solid #dbe2ea;border-radius:8px;box-shadow:0 4px 14px rgba(15,23,42,.06)}.response-group-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:#dfeaf4;color:#17324d;font-weight:700;list-style:none;cursor:pointer}.response-group-heading::-webkit-details-marker{display:none}.response-group-heading:after{content:"+";color:#004990;font-size:18px;line-height:1}.response-group[open]>.response-group-heading:after{content:"-"}.response-group .response-group{margin:10px 12px 10px 14px;box-shadow:none}.response-group .response-group-heading{background:#edf3f8;font-size:14px}</style></head><body><header class="admin-header"><h1>G1 Practice Admin</h1><p class="intro">Review user submissions, feedback, device details, and every answer.</p></header><div class="toolbar"><span id="attemptsCount" class="count">Saved attempts: ${submissions.length}</span><a class="home-link" href="/">Open user page</a></div><section class="filter-panel" aria-label="Filter and group responses"><div class="filter-field"><div class="filter-label-row"><label for="dateFrom">From date</label><button class="clear-filter" type="button" id="clearDateFrom" aria-label="Clear from date" title="Clear from date">&#215;</button></div><input id="dateFrom" type="date"></div><div class="filter-field"><div class="filter-label-row"><label for="dateTo">To date</label><button class="clear-filter" type="button" id="clearDateTo" aria-label="Clear to date" title="Clear to date">&#215;</button></div><input id="dateTo" type="date"></div><div class="filter-field"><div class="filter-label-row"><label for="groupMode">Group responses by</label><button class="clear-filter" type="button" id="clearGroupMode" aria-label="Reset grouping" title="Reset grouping">&#215;</button></div><select id="groupMode"><option value="date">Date</option><option value="user">User</option><option value="date-user">Date, then user</option><option value="user-date">User, then date</option></select></div><div class="filter-field"><div class="filter-label-row"><span>Filter by users</span><button class="clear-filter" type="button" id="clearUsers" aria-label="Clear user filter" title="Clear user filter">&#215;</button></div><details class="multi-select" id="userPicker"><summary id="userPickerSummary">All users</summary><div class="multi-select-menu"><input id="userSearch" type="search" placeholder="Search users"><div class="user-filter-list" id="userFilterList">${userFilters || '<span>No users yet</span>'}</div></div></details><div class="selected-user-chips" id="selectedUserChips"></div></div><div class="filter-field"><span>Dates are inclusive</span><button type="button" class="secondary" id="clearFilters">Clear all filters</button></div></section><div class="response-toolbar"><span class="response-heading">Responses</span><button id="responseSortToggle" class="response-sort-toggle" type="button"><span aria-hidden="true">&#8595;</span> <span>Descending</span></button></div><main id="attemptsList">${rows}</main><script>
    const count=document.getElementById('attemptsCount');
    const list=document.getElementById('attemptsList');
    const allAttempts=Array.from(list.querySelectorAll('.attempt'));
    const dateFrom=document.getElementById('dateFrom');
    const dateTo=document.getElementById('dateTo');
    const groupMode=document.getElementById('groupMode');
    let groupOrder='desc';
    const responseSortToggle=document.getElementById('responseSortToggle');
    const userFilterList=document.getElementById('userFilterList');
    const userPickerSummary=document.getElementById('userPickerSummary');
    const selectedUserChips=document.getElementById('selectedUserChips');
    let appliedUsers=[];
    const getSelectedUsers=()=>Array.from(userFilterList.querySelectorAll('input:checked')).map(input=>input.value);
    function syncUserPicker(){
      const selected=appliedUsers;
      const allSelected=selected.length===userFilterList.querySelectorAll('.user-filter-option').length&&selected.length>0;
      userPickerSummary.textContent=selected.length===0||allSelected?'All users':selected.length+' user'+(selected.length===1?'':'s')+' selected';
      selectedUserChips.replaceChildren();
      (allSelected?[]:selected).forEach(name=>{
        const chip=document.createElement('span');chip.className='user-chip';chip.appendChild(document.createTextNode(name));
        const remove=document.createElement('button');remove.type='button';remove.textContent='x';remove.setAttribute('aria-label','Remove '+name);remove.addEventListener('click',()=>{appliedUsers=appliedUsers.filter(user=>user!==name);const input=Array.from(userFilterList.querySelectorAll('input')).find(option=>option.value===name);if(input)input.checked=false;applyFilters();});
        chip.appendChild(remove);selectedUserChips.appendChild(chip);
      });
    }
    function groupLabel(attempt, dimension){
      if(dimension==='user') return attempt.dataset.user || 'Name not provided';
      const date=attempt.dataset.date;
      if(!date) return 'Unknown date';
      const [year,month,day]=date.split('-').map(Number);
      return new Date(year,month-1,day).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    }
    function renderGroupInto(parent, attempts, dimensions, depth, firstPath=true){
      if(depth>=dimensions.length){attempts.forEach(attempt=>parent.appendChild(attempt));return;}
      const groups=new Map();
      attempts.forEach(attempt=>{const label=groupLabel(attempt,dimensions[depth]);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(attempt);});
      let groupIndex=0;
      const sortedGroups=Array.from(groups.entries()).sort(([labelA,itemsA],[labelB,itemsB])=>{
        const comparison=dimensions[depth]==='date'
          ? (itemsA[0].dataset.date||'').localeCompare(itemsB[0].dataset.date||'')
          : labelA.localeCompare(labelB,undefined,{sensitivity:'base',numeric:true});
        return comparison*(groupOrder==='asc'?1:-1);
      });
      for(const [label,items] of sortedGroups){
        const section=document.createElement('details');section.className='response-group';section.open=firstPath&&groupIndex===0;
        const heading=document.createElement('summary');heading.className='response-group-heading';heading.textContent=label+' ('+items.length+')';section.appendChild(heading);parent.appendChild(section);
        renderGroupInto(section,items,dimensions,depth+1,firstPath&&groupIndex===0);
        groupIndex++;
      }
    }
    function applyFilters(){
      syncUserPicker();
      const isAscending=groupOrder==='asc';
      responseSortToggle.innerHTML='<span aria-hidden="true">'+(isAscending?'&#8593;':'&#8595;')+'</span> <span>'+(isAscending?'Ascending':'Descending')+'</span>';
      responseSortToggle.setAttribute('aria-label','Sort '+(isAscending?'ascending':'descending')+'. Activate to reverse sort order.');
      responseSortToggle.title='Sort '+(isAscending?'ascending':'descending')+'; click to reverse';
      const selectedUsers=appliedUsers;
      const filtered=allAttempts.filter(attempt=>{
        const date=attempt.dataset.date||'';
        return (!dateFrom.value||date>=dateFrom.value)&&(!dateTo.value||date<=dateTo.value)&&(!selectedUsers.length||selectedUsers.includes(attempt.dataset.user));
      });
      list.replaceChildren();
      count.textContent='Showing '+filtered.length+' of '+allAttempts.length+' responses';
      if(!filtered.length){const empty=document.createElement('div');empty.className='filter-empty';empty.textContent='No responses match these filters.';list.appendChild(empty);return;}
      const dimensions=groupMode.value.split('-');
      renderGroupInto(list,filtered,dimensions,0);
    }
    document.querySelectorAll('.hide-skipped').forEach(filter=>filter.addEventListener('change',event=>{const table=event.target.closest('.attempt');table.querySelectorAll('.skipped-row').forEach(row=>row.hidden=event.target.checked);}));
    list.addEventListener('click',async event=>{const button=event.target.closest('.delete-attempt');if(!button)return;const recordKey=button.dataset.recordKey;if(!recordKey||!confirm('Delete this complete response?'))return;button.disabled=true;const response=await fetch('/api/submissions/'+encodeURIComponent(recordKey),{method:'DELETE'});if(response.ok){window.location.reload();}else{button.disabled=false;alert('Could not delete this response.');}});
    [dateFrom,dateTo,groupMode].forEach(control=>control.addEventListener('change',applyFilters));
    responseSortToggle.addEventListener('click',()=>{groupOrder=groupOrder==='asc'?'desc':'asc';applyFilters();});
    userFilterList.addEventListener('change',()=>{appliedUsers=getSelectedUsers();applyFilters();});
    document.getElementById('userSearch').addEventListener('input',event=>{const query=event.target.value.trim().toLocaleLowerCase();userFilterList.querySelectorAll('.user-filter-option').forEach(option=>{const matches=option.textContent.toLocaleLowerCase().includes(query);option.hidden=!matches;option.style.display=matches?'':'none';});});
    document.getElementById('clearDateFrom').addEventListener('click',()=>{dateFrom.value='';applyFilters();});
    document.getElementById('clearDateTo').addEventListener('click',()=>{dateTo.value='';applyFilters();});
    document.getElementById('clearGroupMode').addEventListener('click',()=>{groupMode.value='date';applyFilters();});
    document.getElementById('clearUsers').addEventListener('click',()=>{appliedUsers=[];userFilterList.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=false);applyFilters();});
    document.addEventListener('click',event=>{const picker=document.getElementById('userPicker');if(picker.open&&!picker.contains(event.target))picker.open=false;});
    document.addEventListener('keydown',event=>{const picker=document.getElementById('userPicker');if(event.key==='Escape'&&picker.open)picker.open=false;});
    document.getElementById('clearFilters').addEventListener('click',()=>{dateFrom.value='';dateTo.value='';groupMode.value='date';groupOrder='desc';appliedUsers=[];document.getElementById('userSearch').value='';userFilterList.querySelectorAll('.user-filter-option').forEach(option=>{option.hidden=false;option.style.display='';});userFilterList.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=false);applyFilters();document.getElementById('userPicker').open=false;});
    applyFilters();
  </script></body></html>`;
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
        const userName = submission.user?.name;
        if(typeof userName !== 'string' || userName.trim().length > 50 || !/^[\p{L}\p{N} _.]+$/u.test(userName.trim())) throw new Error('Invalid user name');
        const savedSubmission = {...submission, submittedAt: new Date().toISOString(), clientIp: request.socket.remoteAddress || 'Unknown IP', serverUserAgent: request.headers['user-agent'] || 'Unknown browser'};
        const result = await saveSubmission(savedSubmission);
        try {
          await notifyAdminOfSubmission(savedSubmission);
        } catch(error){
          console.error('Could not send submission notification email:', error.message);
        }
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
