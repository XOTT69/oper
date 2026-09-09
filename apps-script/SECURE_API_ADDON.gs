/**
 * Add this file to the existing KPI Apps Script project.
 * It keeps the current dashboard UI untouched and adds a private JSON API
 * that is callable only by the server-side KPI Cabinet application.
 */

const KPI_API_SECRET_PROPERTY = 'KPI_API_SECRET';
const KPI_LOGIN_TOKENS_SHEET_NAME = 'KPI login tokens';
const KPI_SLACK_BOT_TOKEN_PROPERTY = 'SLACK_BOT_TOKEN';

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty(KPI_API_SECRET_PROPERTY);
    if (!secret || request.sharedSecret !== secret) return kpiJson_({ ok: false, error: 'unauthorized' });

    switch (request.action) {
      case 'request_login': return kpiRequestLogin_(request);
      case 'consume_login': return kpiConsumeLogin_(request);
      case 'get_dashboard': return kpiGetPrivateDashboard_(request);
      default: return kpiJson_({ ok: false, error: 'unknown action' });
    }
  } catch (error) {
    console.error(error);
    return kpiJson_({ ok: false, error: 'request failed' });
  }
}

function kpiRequestLogin_(request) {
  const ldap = kpiNormalizeLdap_(request.ldap);
  const profile = kpiGetAccessProfile_(ldap);
  if (!profile || !profile.slackUserId) return kpiJson_({ ok: false, error: 'access is not configured' });
  const loginBaseUrl = String(request.loginBaseUrl || '');
  if (!/^https:\/\/[a-z0-9.-]+\/api\/auth\/verify$/i.test(loginBaseUrl)) return kpiJson_({ ok: false, error: 'invalid login url' });

  const magicToken = kpiIssueLoginToken_(ldap);
  kpiSendSlackLogin_(profile.slackUserId, loginBaseUrl + '?token=' + encodeURIComponent(magicToken));
  return kpiJson_({ ok: true, data: { delivered: true } });
}

function kpiSendSlackLogin_(slackUserId, loginUrl) {
  const botToken = PropertiesService.getScriptProperties().getProperty(KPI_SLACK_BOT_TOKEN_PROPERTY);
  if (!botToken) throw new Error('Slack bot token is not configured');

  const openResponse = kpiSlackRequest_('conversations.open', { users: slackUserId }, botToken);
  const channelId = openResponse && openResponse.channel && openResponse.channel.id;
  if (!channelId) throw new Error('Slack DM could not be opened');

  kpiSlackRequest_('chat.postMessage', {
    channel: channelId,
    text: 'Вхід до KPI Кабінету: ' + loginUrl,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Вхід до KPI Кабінету*\nНатисніть кнопку, щоб безпечно відкрити особистий кабінет. Посилання діє 10 хвилин і спрацьовує один раз.' } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Відкрити KPI Кабінет' }, url: loginUrl, style: 'primary' }] }
    ]
  }, botToken);
}

function kpiSlackRequest_(method, payload, botToken) {
  const response = UrlFetchApp.fetch('https://slack.com/api/' + method, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + botToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText() || '{}');
  if (!body.ok) throw new Error('Slack request failed');
  return body;
}

function kpiConsumeLogin_(request) {
  const ldap = kpiConsumeLoginToken_(String(request.magicToken || ''));
  const profile = ldap && kpiGetAccessProfile_(ldap);
  if (!profile) return kpiJson_({ ok: false, error: 'invalid token' });
  return kpiJson_({ ok: true, data: { ldap: profile.ldap, role: profile.role } });
}

function kpiGetPrivateDashboard_(request) {
  const ldap = kpiNormalizeLdap_(request.ldap);
  const viewer = kpiGetAccessProfile_(ldap);
  if (!viewer) return kpiJson_({ ok: false, error: 'access is not configured' });

  const profiles = kpiGetAccessProfiles_();
  const allowedLdaps = kpiAllowedLdaps_(viewer, profiles);
  const dashboard = getKpiDashboard();
  const rows = (dashboard.rows || []).filter(row => allowedLdaps[row.ldap.toUpperCase()]);
  const periodsMap = {};
  rows.forEach(row => { periodsMap[row.periodKey] = { key: row.periodKey, label: row.periodLabel, year: row.year, month: row.month }; });
  const periods = Object.keys(periodsMap).map(key => periodsMap[key]).sort((a, b) => b.key.localeCompare(a.key));

  return kpiJson_({ ok: true, data: { viewer: viewer, rows: rows, periods: periods, latestPeriodKey: periods.length ? periods[0].key : '' } });
}

function kpiGetAccessProfiles_() {
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(OPERATORS_SHEET_NAME);
  const result = {};
  if (!sheet) return result;

  const values = sheet.getDataRange().getDisplayValues();
  let headerMap = null;
  let headerRowIndex = -1;
  for (let index = 0; index < Math.min(values.length, 40); index += 1) {
    if (isOperatorsHeaderRow_(values[index])) { headerMap = buildHeaderMap_(values[index]); headerRowIndex = index; break; }
  }
  if (!headerMap) return result;

  for (let index = headerRowIndex + 1; index < values.length; index += 1) {
    const row = values[index];
    const ldap = kpiNormalizeLdap_(getByHeader_(row, headerMap, ['LDAP', 'лдап']));
    if (!ldap) continue;
    const roleValue = cleanValue_(getByHeader_(row, headerMap, ['Роль', 'Role'])).toLowerCase();
    const role = roleValue === 'lead' || roleValue === 'керівник' ? 'lead' : roleValue === 'manager' || roleValue === 'менеджер' ? 'manager' : 'operator';
    result[ldap] = {
      ldap: ldap,
      operator: cleanValue_(getByHeader_(row, headerMap, ['Оператор'])),
      direction: cleanValue_(getByHeader_(row, headerMap, ['Напрямок'])),
      team: cleanValue_(getByHeader_(row, headerMap, ['Команда', 'Team'])),
      managerLdap: kpiNormalizeLdap_(getByHeader_(row, headerMap, ['Керівник LDAP', 'Manager LDAP'])),
      slackUserId: cleanValue_(getByHeader_(row, headerMap, ['Slack User ID', 'Slack ID'])),
      role: role
    };
  }
  return result;
}

function kpiGetAccessProfile_(ldap) {
  return kpiGetAccessProfiles_()[kpiNormalizeLdap_(ldap)] || null;
}

function kpiAllowedLdaps_(viewer, profiles) {
  const allowed = {};
  Object.keys(profiles).forEach(ldap => {
    const profile = profiles[ldap];
    if (viewer.role === 'lead' && viewer.direction && profile.direction === viewer.direction) allowed[ldap] = true;
    if (viewer.role === 'manager' && profile.managerLdap === viewer.ldap) allowed[ldap] = true;
    if (ldap === viewer.ldap) allowed[ldap] = true;
  });
  return allowed;
}

function kpiIssueLoginToken_(ldap) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const sheet = kpiGetLoginTokensSheet_();
  sheet.appendRow([kpiTokenHash_(token), ldap, new Date(Date.now() + 10 * 60 * 1000), '', new Date()]);
  return token;
}

function kpiConsumeLoginToken_(token) {
  if (!/^[a-f0-9-]{36,80}$/i.test(token)) return '';
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = kpiGetLoginTokensSheet_();
    const values = sheet.getDataRange().getValues();
    const hash = kpiTokenHash_(token);
    for (let index = 1; index < values.length; index += 1) {
      const row = values[index];
      const expiresAt = row[2] instanceof Date ? row[2].getTime() : new Date(row[2]).getTime();
      if (row[0] === hash && !row[3] && expiresAt > Date.now()) {
        sheet.getRange(index + 1, 4).setValue('used');
        return kpiNormalizeLdap_(row[1]);
      }
    }
    return '';
  } finally {
    lock.releaseLock();
  }
}

function kpiGetLoginTokensSheet_() {
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_LOGIN_TOKENS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_LOGIN_TOKENS_SHEET_NAME);
    sheet.appendRow(['Token hash', 'LDAP', 'Expires at', 'Used', 'Created at']);
  }
  return sheet;
}

function kpiTokenHash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function kpiNormalizeLdap_(value) {
  const ldap = String(value || '').trim().toUpperCase();
  return /^CC[A-Z0-9._-]{3,60}$/.test(ldap) ? ldap : '';
}

function kpiJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
