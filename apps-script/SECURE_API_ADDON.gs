/**
 * Add this file to the existing KPI Apps Script project.
 * It keeps the current dashboard UI untouched and adds a private JSON API
 * that is callable only by the server-side KPI Cabinet application.
 */

const KPI_API_SECRET_PROPERTY = 'KPI_API_SECRET';
const KPI_LOGIN_TOKENS_SHEET_NAME = 'KPI login tokens';
const KPI_SLACK_CACHE_SHEET_NAME = 'KPI Slack cache';
const KPI_SLACK_BOT_TOKEN_PROPERTY = 'SLACK_BOT_TOKEN';
const KPI_ADMIN_LDAPS_PROPERTY = 'KPI_ADMIN_LDAPS';
const KPI_ACCESS_SHEET_NAME = 'KPI access';
const KPI_OPERATOR_SETTINGS_SHEET_NAME = 'KPI cabinet profiles';
const KPI_PERIOD_INDEPENDENCE_SHEET_NAME = 'KPI independence by period';
const KPI_USEFUL_LINKS_SHEET_NAME = 'KPI useful links';
const KPI_DEVELOPMENT_PLANS_SHEET_NAME = 'KPI development plans';
const KPI_TARGETS_SHEET_NAME = 'KPI targets';
const KPI_AUDIT_SHEET_NAME = 'KPI cabinet audit';

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty(KPI_API_SECRET_PROPERTY);
    if (!secret || request.sharedSecret !== secret) return kpiJson_({ ok: false, error: 'unauthorized' });

    switch (request.action) {
      case 'request_login': return kpiRequestLogin_(request);
      case 'consume_login': return kpiConsumeLogin_(request);
      case 'get_dashboard': return kpiGetPrivateDashboard_(request);
      case 'set_access': return kpiSetAccess_(request);
      case 'set_independence': return kpiSetIndependence_(request);
      case 'add_useful_link': return kpiAddUsefulLink_(request);
      case 'add_development_plan': return kpiAddDevelopmentPlan_(request);
      case 'set_kpi_target': return kpiSetKpiTarget_(request);
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
  if (!profile) return kpiJson_({ ok: false, error: 'access is not configured' });
  const loginBaseUrl = String(request.loginBaseUrl || '');
  if (!/^https:\/\/[a-z0-9.-]+\/api\/auth\/verify$/i.test(loginBaseUrl)) return kpiJson_({ ok: false, error: 'invalid login url' });

  const botToken = PropertiesService.getScriptProperties().getProperty(KPI_SLACK_BOT_TOKEN_PROPERTY);
  if (!botToken) return kpiJson_({ ok: false, error: 'Slack bot is not configured' });
  // Slack is the source of truth for the mapping: each user has an LDAP custom
  // profile field. A manually supplied Slack ID is only an optional fallback.
  const slackUserId = profile.slackUserId || kpiFindSlackUserIdByLdap_(ldap, botToken);
  if (!slackUserId) return kpiJson_({ ok: false, error: 'Slack user is not configured' });

  const magicToken = kpiIssueLoginToken_(ldap);
  kpiSendSlackLogin_(slackUserId, loginBaseUrl + '?token=' + encodeURIComponent(magicToken), botToken);
  return kpiJson_({ ok: true, data: { delivered: true } });
}

function kpiSendSlackLogin_(slackUserId, loginUrl, botToken) {

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

function kpiFindSlackUserIdByLdap_(ldap, botToken) {
  const cached = kpiGetCachedSlackUserId_(ldap);
  if (cached) return cached;

  let cursor = '';
  do {
    const url = 'https://slack.com/api/users.list?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + botToken },
      muteHttpExceptions: true
    });
    const body = JSON.parse(response.getContentText() || '{}');
    if (!body.ok) throw new Error('Slack users list request failed');

    const members = body.members || [];
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      if (member.deleted || member.is_bot || !member.id) continue;
      if (kpiProfileHasLdap_(member.profile, ldap)) {
        kpiCacheSlackUserId_(ldap, member.id);
        return member.id;
      }
    }
    cursor = body.response_metadata && body.response_metadata.next_cursor ? body.response_metadata.next_cursor : '';
  } while (cursor);

  // Some Slack workspaces omit custom fields from users.list. In that case,
  // read each public profile once; successful matches are cached in the KPI file.
  cursor = '';
  do {
    const listUrl = 'https://slack.com/api/users.list?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const listResponse = UrlFetchApp.fetch(listUrl, {
      method: 'get', headers: { Authorization: 'Bearer ' + botToken }, muteHttpExceptions: true
    });
    const listBody = JSON.parse(listResponse.getContentText() || '{}');
    if (!listBody.ok) throw new Error('Slack users list request failed');

    const members = listBody.members || [];
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      if (member.deleted || member.is_bot || !member.id) continue;
      const profile = kpiGetSlackProfile_(member.id, botToken);
      if (kpiProfileHasLdap_(profile, ldap)) {
        kpiCacheSlackUserId_(ldap, member.id);
        return member.id;
      }
    }
    cursor = listBody.response_metadata && listBody.response_metadata.next_cursor ? listBody.response_metadata.next_cursor : '';
  } while (cursor);

  return '';
}

function kpiGetSlackProfile_(slackUserId, botToken) {
  const response = UrlFetchApp.fetch('https://slack.com/api/users.profile.get?user=' + encodeURIComponent(slackUserId), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + botToken },
    muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText() || '{}');
  return body.ok && body.profile ? body.profile : {};
}

function kpiProfileHasLdap_(profile, ldap) {
  const fields = profile && profile.fields ? profile.fields : {};
  const target = kpiNormalizeLdap_(ldap);
  return Object.keys(fields).some(fieldId => {
    const field = fields[fieldId] || {};
    return kpiNormalizeLdap_(field.value) === target || kpiNormalizeLdap_(field.alt) === target;
  });
}

function kpiGetCachedSlackUserId_(ldap) {
  const sheet = kpiGetSlackCacheSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (let index = 1; index < values.length; index += 1) {
    if (kpiNormalizeLdap_(values[index][0]) !== ldap) continue;
    const updatedAt = new Date(values[index][2]).getTime();
    if (values[index][1] && updatedAt >= threshold) return values[index][1];
  }
  return '';
}

function kpiCacheSlackUserId_(ldap, slackUserId) {
  const sheet = kpiGetSlackCacheSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    if (kpiNormalizeLdap_(values[index][0]) === ldap) {
      sheet.getRange(index + 1, 2, 1, 2).setValues([[slackUserId, new Date()]]);
      return;
    }
  }
  sheet.appendRow([ldap, slackUserId, new Date()]);
}

function kpiGetSlackCacheSheet_() {
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_SLACK_CACHE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_SLACK_CACHE_SHEET_NAME);
    sheet.appendRow(['LDAP', 'Slack User ID', 'Updated at']);
  }
  return sheet;
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
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  const periodContent = kpiBuildPeriodContent_(ss, dashboard.rows || []);
  const legacyIndependence = kpiGetOperatorSettingsMap_(ss);
  const periodIndependence = kpiGetPeriodIndependenceMap_(ss);

  // The legacy Web.gs dashboard is deliberately normalized here. This keeps
  // the existing public dashboard untouched while the private cabinet always
  // uses one unambiguous period for recommendations, errors and independence.
  const normalizedRows = (dashboard.rows || []).map(row => {
    const ldapKey = kpiNormalizeLdap_(row.ldap);
    const key = kpiPeriodLdapKey_(ldapKey, row.periodKey);
    const errors = periodContent.errors[key] || kpiEmptyErrors_();
    const recommendations = (periodContent.recommendations.global[ldapKey] || [])
      .concat(periodContent.recommendations.byPeriod[key] || []);

    row.critsCount = errors.crits;
    row.warningsCount = errors.warnings;
    row.errorsTotal = errors.total;
    row.errorThemes = Object.keys(errors.themes).map(name => ({ name: name, count: errors.themes[name] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'uk'));
    row.errorExamples = errors.examples;
    row.errorAdvice = buildErrorAdvice_(errors);
    row.recommendations = recommendations;
    row.recommendationsCount = recommendations.length;
    row.independence = kpiGetIndependenceForPeriod_(periodIndependence, legacyIndependence, ldapKey, row.periodKey);
    return row;
  });

  const rows = normalizedRows.filter(row => allowedLdaps[kpiNormalizeLdap_(row.ldap)]);
  const periodsMap = {};
  rows.forEach(row => { periodsMap[row.periodKey] = { key: row.periodKey, label: row.periodLabel, year: row.year, month: row.month }; });
  const periods = Object.keys(periodsMap).map(key => periodsMap[key]).sort((a, b) => b.key.localeCompare(a.key));
  const helpfulLinks = kpiGetUsefulLinks_(viewer.ldap, false);
  const developmentPlans = kpiGetDevelopmentPlans_(ss, viewer.role === 'admin' ? Object.keys(allowedLdaps) : [viewer.ldap]);
  const kpiTargets = kpiGetKpiTargets_(ss, viewer.role === 'admin' ? '' : viewer.direction);
  const accessProfiles = viewer.role === 'admin'
    ? Object.keys(profiles).map(profileLdap => ({
      ldap: profiles[profileLdap].ldap,
      operator: profiles[profileLdap].operator,
      direction: profiles[profileLdap].direction,
      team: profiles[profileLdap].team,
      level: profiles[profileLdap].level,
      status: profiles[profileLdap].status,
      role: profiles[profileLdap].role,
      independence: profiles[profileLdap].independence,
      accessEnabled: profiles[profileLdap].accessEnabled,
      hasKpi: normalizedRows.some(row => kpiNormalizeLdap_(row.ldap) === profileLdap)
    })).sort((a, b) => String(a.operator || '').localeCompare(String(b.operator || ''), 'uk'))
    : [];

  const adminLinks = viewer.role === 'admin' ? kpiGetUsefulLinks_(viewer.ldap, true) : [];
  return kpiJson_({ ok: true, data: { viewer: viewer, rows: rows, periods: periods, latestPeriodKey: periods.length ? periods[0].key : '', helpfulLinks: helpfulLinks, accessProfiles: accessProfiles, adminLinks: adminLinks, developmentPlans: developmentPlans, kpiTargets: kpiTargets, dataQuality: periodContent.diagnostics } });
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
    const candidateMap = buildHeaderMap_(values[index]);
    if (kpiHasLdapHeader_(candidateMap)) { headerMap = candidateMap; headerRowIndex = index; break; }
  }
  if (!headerMap) return result;

  for (let index = headerRowIndex + 1; index < values.length; index += 1) {
    const row = values[index];
    const ldap = kpiGetLdapByHeader_(row, headerMap);
    if (!ldap) continue;
    const roleValue = cleanValue_(getByHeader_(row, headerMap, ['Роль', 'Role'])).toLowerCase();
    const role = kpiIsAdminLdap_(ldap) || roleValue === 'admin' || roleValue === 'адміністратор'
      ? 'admin'
      : roleValue === 'lead' || roleValue === 'керівник'
        ? 'lead'
        : roleValue === 'manager' || roleValue === 'менеджер'
          ? 'manager'
          : 'operator';
    result[ldap] = {
      ldap: ldap,
      operator: cleanValue_(getByHeader_(row, headerMap, ['Оператор'])),
      direction: cleanValue_(getByHeader_(row, headerMap, ['Напрямок'])),
      team: cleanValue_(getByHeader_(row, headerMap, ['Команда', 'Team'])),
      level: cleanValue_(getByHeader_(row, headerMap, ['Левел', 'Рівень', 'Level'])),
      status: cleanValue_(getByHeader_(row, headerMap, ['Статус'])),
      managerLdap: kpiNormalizeLdap_(getByHeader_(row, headerMap, ['Керівник LDAP', 'Manager LDAP'])),
      slackUserId: cleanValue_(getByHeader_(row, headerMap, ['Slack User ID', 'Slack ID'])),
      role: role
    };
  }

  const accessMap = kpiGetAccessMap_(ss, Object.keys(result));
  const settingsMap = kpiGetOperatorSettingsMap_(ss);
  Object.keys(result).forEach(ldap => {
    result[ldap].accessEnabled = accessMap[ldap] === true;
    result[ldap].independence = settingsMap[ldap] || '';
  });
  return result;
}

function kpiHasLdapHeader_(headerMap) {
  return Object.keys(headerMap).some(header => {
    const normalized = String(header).trim().toLowerCase();
    return normalized === 'ldap' || normalized === 'лдап';
  });
}

function kpiGetLdapByHeader_(row, headerMap) {
  const ldapHeader = Object.keys(headerMap).find(header => {
    const normalized = String(header).trim().toLowerCase();
    return normalized === 'ldap' || normalized === 'лдап';
  });
  return ldapHeader ? kpiNormalizeLdap_(getByHeader_(row, headerMap, [ldapHeader])) : '';
}

function kpiGetAccessProfile_(ldap) {
  const profile = kpiGetAccessProfiles_()[kpiNormalizeLdap_(ldap)] || null;
  return profile && profile.accessEnabled ? profile : null;
}

function kpiGetAdminLdaps_() {
  return String(PropertiesService.getScriptProperties().getProperty(KPI_ADMIN_LDAPS_PROPERTY) || '')
    .split(/[;,\s]+/)
    .map(kpiNormalizeLdap_)
    .filter(Boolean);
}

function kpiIsAdminLdap_(ldap) {
  return kpiGetAdminLdaps_().indexOf(kpiNormalizeLdap_(ldap)) !== -1;
}

function kpiAllowedLdaps_(viewer, profiles) {
  const allowed = {};
  Object.keys(profiles).forEach(ldap => {
    const profile = profiles[ldap];
    if (!profile.accessEnabled) return;
    if (viewer.role === 'admin') allowed[ldap] = true;
    if (viewer.role === 'lead' && viewer.direction && profile.direction === viewer.direction) allowed[ldap] = true;
    if (viewer.role === 'manager' && profile.managerLdap === viewer.ldap) allowed[ldap] = true;
    if (ldap === viewer.ldap) allowed[ldap] = true;
  });
  return allowed;
}

function kpiGetAccessMap_(ss, knownLdaps) {
  let sheet = ss.getSheetByName(KPI_ACCESS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_ACCESS_SHEET_NAME);
    sheet.appendRow(['LDAP', 'Доступ', 'Оновлено']);
    (knownLdaps || []).forEach(ldap => sheet.appendRow([ldap, 'так', new Date()]));
  }

  const map = {};
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const ldap = kpiNormalizeLdap_(values[index][0]);
    if (ldap) map[ldap] = kpiIsAccessEnabled_(values[index][1]);
  }
  return map;
}

function kpiIsAccessEnabled_(value) {
  return ['так', 'yes', 'true', '1', 'увімкнено', 'enabled'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
}

function kpiSetAccess_(request) {
  const viewer = kpiGetAccessProfile_(request.viewerLdap);
  if (!viewer || viewer.role !== 'admin') return kpiJson_({ ok: false, error: 'forbidden' });

  const targetLdap = kpiNormalizeLdap_(request.targetLdap);
  const enabled = request.enabled === true;
  const profiles = kpiGetAccessProfiles_();
  if (!targetLdap || !profiles[targetLdap]) return kpiJson_({ ok: false, error: 'LDAP не знайдено серед операторів' });
  if (targetLdap === viewer.ldap && !enabled) return kpiJson_({ ok: false, error: 'Не можна вимкнути власний доступ адміністратора' });

  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  const sheet = kpiGetAccessSheet_(ss);
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    if (kpiNormalizeLdap_(values[index][0]) === targetLdap) {
      sheet.getRange(index + 1, 2, 1, 2).setValues([[enabled ? 'так' : 'ні', new Date()]]);
      kpiAudit_(viewer.ldap, targetLdap, enabled ? 'Доступ надано' : 'Доступ вимкнено', '', '');
      return kpiJson_({ ok: true, data: { ldap: targetLdap, accessEnabled: enabled } });
    }
  }
  sheet.appendRow([targetLdap, enabled ? 'так' : 'ні', new Date()]);
  kpiAudit_(viewer.ldap, targetLdap, enabled ? 'Доступ надано' : 'Доступ вимкнено', '', '');
  return kpiJson_({ ok: true, data: { ldap: targetLdap, accessEnabled: enabled } });
}

function kpiGetAccessSheet_(ss) {
  let sheet = ss.getSheetByName(KPI_ACCESS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_ACCESS_SHEET_NAME);
    sheet.appendRow(['LDAP', 'Доступ', 'Оновлено']);
  }
  return sheet;
}

function kpiGetOperatorSettingsMap_(ss) {
  const sheet = ss.getSheetByName(KPI_OPERATOR_SETTINGS_SHEET_NAME);
  const result = {};
  if (!sheet) return result;
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const ldap = kpiNormalizeLdap_(values[index][0]);
    if (ldap) result[ldap] = String(values[index][1] || '').trim();
  }
  return result;
}

function kpiSetIndependence_(request) {
  const viewer = kpiGetAccessProfile_(request.viewerLdap);
  if (!viewer || viewer.role !== 'admin') return kpiJson_({ ok: false, error: 'forbidden' });
  const targetLdap = kpiNormalizeLdap_(request.targetLdap);
  const periodKey = kpiNormalizePeriodKey_(request.periodKey);
  const independence = String(request.independence || '').trim().slice(0, 120);
  const profiles = kpiGetAccessProfiles_();
  if (!targetLdap || !profiles[targetLdap]) return kpiJson_({ ok: false, error: 'LDAP не знайдено серед операторів' });
  if (!periodKey) return kpiJson_({ ok: false, error: 'Оберіть коректний місяць KPI' });

  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_PERIOD_INDEPENDENCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_PERIOD_INDEPENDENCE_SHEET_NAME);
    sheet.appendRow(['LDAP', 'Період', 'Рівень самостійності', 'Оновлено']);
  }
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    if (kpiNormalizeLdap_(values[index][0]) === targetLdap && kpiNormalizePeriodKey_(values[index][1]) === periodKey) {
      sheet.getRange(index + 1, 3, 1, 2).setValues([[independence, new Date()]]);
      kpiAudit_(viewer.ldap, targetLdap, 'Самостійність', periodKey, independence);
      return kpiJson_({ ok: true, data: { ldap: targetLdap, periodKey: periodKey, independence: independence } });
    }
  }
  sheet.appendRow([targetLdap, periodKey, independence, new Date()]);
  kpiAudit_(viewer.ldap, targetLdap, 'Самостійність', periodKey, independence);
  return kpiJson_({ ok: true, data: { ldap: targetLdap, periodKey: periodKey, independence: independence } });
}

function kpiGetPeriodIndependenceMap_(ss) {
  const sheet = ss.getSheetByName(KPI_PERIOD_INDEPENDENCE_SHEET_NAME);
  const result = {};
  if (!sheet) return result;
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const ldap = kpiNormalizeLdap_(values[index][0]);
    const periodKey = kpiNormalizePeriodKey_(values[index][1]);
    if (ldap && periodKey) result[kpiPeriodLdapKey_(ldap, periodKey)] = String(values[index][2] || '').trim();
  }
  return result;
}

function kpiGetIndependenceForPeriod_(periodMap, legacyMap, ldap, periodKey) {
  const exact = periodMap[kpiPeriodLdapKey_(ldap, periodKey)];
  return exact !== undefined ? exact : (legacyMap[ldap] || '');
}

function kpiPeriodLdapKey_(ldap, periodKey) {
  return kpiNormalizeLdap_(ldap) + '|' + kpiNormalizePeriodKey_(periodKey);
}

function kpiNormalizePeriodKey_(value) {
  const match = String(value || '').trim().match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  return match ? match[0] : '';
}

function kpiBuildPeriodContent_(ss, kpiRows) {
  const nameToLdap = {};
  (kpiRows || []).forEach(row => {
    const ldap = kpiNormalizeLdap_(row.ldap);
    const name = kpiNormalizeName_(row.operator);
    if (ldap && name) nameToLdap[name] = ldap;
  });
  return {
    errors: kpiBuildMonthlyErrors_(ss, nameToLdap),
    recommendations: kpiBuildMonthlyRecommendations_(ss),
    diagnostics: { source: 'period-aware', errorsWithoutLdap: 0, errorsWithoutPeriod: 0 }
  };
}

function kpiBuildMonthlyRecommendations_(ss) {
  const result = { global: {}, byPeriod: {} };
  const sheet = ss.getSheetByName(RECOMMENDATIONS_SHEET_NAME);
  if (!sheet) return result;
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return result;

  let start = 0;
  let ldapIndex = 0;
  let textIndex = 1;
  let periodIndex = 2;
  const firstMap = buildHeaderMap_(values[0]);
  const ldapHeader = kpiFindHeader_(firstMap, ['LDAP', 'лдап']);
  const textHeader = kpiFindHeader_(firstMap, ['Рекомендація', 'Рекомендації', 'Порада', 'Текст']);
  if (ldapHeader !== '' && textHeader !== '') {
    ldapIndex = Number(ldapHeader);
    textIndex = Number(textHeader);
    const foundPeriod = kpiFindHeader_(firstMap, ['Період', 'Місяць']);
    periodIndex = foundPeriod === '' ? -1 : Number(foundPeriod);
    start = 1;
  }

  for (let index = start; index < values.length; index += 1) {
    const ldap = kpiNormalizeLdap_(values[index][ldapIndex]);
    const text = String(values[index][textIndex] || '').trim();
    const rawPeriod = periodIndex >= 0 ? values[index][periodIndex] : '';
    const periodKey = kpiParsePeriodKey_(rawPeriod);
    if (!ldap || !text) continue;
    const recommendation = { title: periodKey ? 'Рекомендація за період' : 'Загальна рекомендація', text: text };
    if (String(rawPeriod || '').trim() && !periodKey) continue;
    if (!periodKey) {
      if (!result.global[ldap]) result.global[ldap] = [];
      result.global[ldap].push(recommendation);
    } else {
      const key = kpiPeriodLdapKey_(ldap, periodKey);
      if (!result.byPeriod[key]) result.byPeriod[key] = [];
      result.byPeriod[key].push(recommendation);
    }
  }
  return result;
}

function kpiBuildMonthlyErrors_(ss, nameToLdap) {
  const result = {};
  kpiReadErrorSheet_(ss, CRITS_SHEET_NAME, 'crit', nameToLdap, result);
  kpiReadErrorSheet_(ss, WARNINGS_SHEET_NAME, 'warning', nameToLdap, result);
  return result;
}

function kpiReadErrorSheet_(ss, sheetName, type, nameToLdap, result) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  const values = sheet.getDataRange().getDisplayValues();
  let headerMap = null;
  let sectionPeriod = '';

  values.forEach(row => {
    const rowPeriod = kpiFindPeriodInCells_(row);
    if (rowPeriod && !headerMap) sectionPeriod = rowPeriod;
    const candidateMap = buildHeaderMap_(row);
    const operatorIndex = kpiFindHeader_(candidateMap, ['Оператор']);
    const errorIndex = kpiFindHeader_(candidateMap, ['Суть помилки', 'Помилка', 'Опис помилки']);
    if (operatorIndex !== '' && errorIndex !== '') {
      headerMap = candidateMap;
      if (rowPeriod) sectionPeriod = rowPeriod;
      return;
    }
    if (!headerMap) return;

    const errorText = kpiGetByIndex_(row, Number(kpiFindHeader_(headerMap, ['Суть помилки', 'Помилка', 'Опис помилки'])));
    if (!errorText) {
      if (rowPeriod) sectionPeriod = rowPeriod;
      return;
    }
    const ldapColumn = kpiFindHeader_(headerMap, ['LDAP', 'лдап']);
    const ldap = ldapColumn !== ''
      ? kpiNormalizeLdap_(kpiGetByIndex_(row, Number(ldapColumn)))
      : (nameToLdap[kpiNormalizeName_(kpiGetByIndex_(row, Number(kpiFindHeader_(headerMap, ['Оператор']))))] || '');
    if (!ldap) return;

    const dateIndex = kpiFindHeader_(headerMap, ['Дата Кріта', 'Дата кріта', 'Дата зауваження', 'Дата']);
    const periodIndex = kpiFindHeader_(headerMap, ['Період', 'Місяць', 'Unnamed: 0']);
    const directPeriod = (dateIndex !== '' && kpiParsePeriodKey_(kpiGetByIndex_(row, Number(dateIndex)))) ||
      (periodIndex !== '' && kpiParsePeriodKey_(kpiGetByIndex_(row, Number(periodIndex)))) || '';
    const periodKey = directPeriod || sectionPeriod;
    if (!periodKey) return;

    const key = kpiPeriodLdapKey_(ldap, periodKey);
    if (!result[key]) result[key] = kpiEmptyErrors_();
    const bucket = result[key];
    if (type === 'crit') bucket.crits += 1; else bucket.warnings += 1;
    bucket.total += 1;
    const category = categorizeError_(errorText);
    bucket.themes[category] = (bucket.themes[category] || 0) + 1;
    if (bucket.examples.length < 5) bucket.examples.push({
      type: type === 'crit' ? 'Крит' : 'Зауваження',
      category: category,
      date: dateIndex !== '' ? kpiGetByIndex_(row, Number(dateIndex)) : periodKey,
      text: shorten_(errorText, 320)
    });
  });
}

function kpiEmptyErrors_() {
  return { crits: 0, warnings: 0, total: 0, themes: {}, examples: [] };
}

function kpiFindHeader_(headerMap, names) {
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (headerMap.hasOwnProperty(name)) {
      const columns = Array.isArray(headerMap[name]) ? headerMap[name] : [headerMap[name]];
      return String(columns[0]);
    }
  }
  return '';
}

function kpiGetByIndex_(row, index) {
  return String(index >= 0 && row[index] !== undefined ? row[index] : '').trim();
}

function kpiNormalizeName_(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/ґ/g, 'г').replace(/\s+/g, ' ').trim();
}

function kpiFindPeriodInCells_(row) {
  for (let index = 0; index < row.length; index += 1) {
    const periodKey = kpiParsePeriodKey_(row[index]);
    if (periodKey) return periodKey;
  }
  return '';
}

function kpiParsePeriodKey_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  let match = text.match(/^(20\d{2})\s*[-/.]\s*(0?[1-9]|1[0-2])(?:\s*[-/.]\s*\d{1,2})?$/);
  if (match) return match[1] + '-' + String(Number(match[2])).padStart(2, '0');
  match = text.match(/^\d{1,2}\s*[-/.]\s*(0?[1-9]|1[0-2])\s*[-/.]\s*(20\d{2})$/);
  if (match) return match[2] + '-' + String(Number(match[1])).padStart(2, '0');
  match = text.match(/^(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})$/);
  if (match) return match[2] + '-' + String(Number(match[1])).padStart(2, '0');
  const year = (text.match(/20\d{2}/) || [])[0];
  if (!year) return '';
  for (let index = 0; index < MONTHS_UA.length; index += 1) {
    if (MONTHS_UA[index].keys.some(key => text.indexOf(key) !== -1)) return year + '-' + MONTHS_UA[index].number;
  }
  return '';
}

function kpiGetUsefulLinks_(viewerLdap, includeAll) {
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(KPI_USEFUL_LINKS_SHEET_NAME);
  if (!sheet) return [];
  const result = [];
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const title = String(values[index][0] || '').trim();
    const url = String(values[index][1] || '').trim();
    const audience = kpiNormalizeLdap_(values[index][2]) || (String(values[index][2] || '').trim().toUpperCase() === 'ALL' ? 'ALL' : '');
    const active = kpiIsAccessEnabled_(values[index][3]);
    if (!title || !/^https:\/\//i.test(url) || !audience || (!includeAll && (!active || (audience !== 'ALL' && audience !== viewerLdap)))) continue;
    result.push({ title: title, url: url, audience: audience, active: active });
  }
  return result;
}

function kpiAddUsefulLink_(request) {
  const viewer = kpiGetAccessProfile_(request.viewerLdap);
  if (!viewer || viewer.role !== 'admin') return kpiJson_({ ok: false, error: 'forbidden' });
  const title = String(request.title || '').trim().slice(0, 120);
  const url = String(request.url || '').trim();
  const audience = kpiNormalizeLdap_(request.audience) || (String(request.audience || '').trim().toUpperCase() === 'ALL' ? 'ALL' : '');
  const profiles = kpiGetAccessProfiles_();
  if (!title || !/^https:\/\//i.test(url) || !audience || (audience !== 'ALL' && !profiles[audience])) return kpiJson_({ ok: false, error: 'Перевірте назву, HTTPS-посилання та LDAP отримувача' });

  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_USEFUL_LINKS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_USEFUL_LINKS_SHEET_NAME);
    sheet.appendRow(['Назва', 'Посилання', 'Для LDAP', 'Активне', 'Оновлено']);
  }
  sheet.appendRow([title, url, audience, 'так', new Date()]);
  kpiAudit_(viewer.ldap, audience, 'Корисне посилання', '', title);
  return kpiJson_({ ok: true, data: { title: title, url: url, audience: audience, active: true } });
}

function kpiGetDevelopmentPlans_(ss, allowedLdaps) {
  const sheet = ss.getSheetByName(KPI_DEVELOPMENT_PLANS_SHEET_NAME);
  if (!sheet) return [];
  const allowed = {};
  (allowedLdaps || []).forEach(ldap => { allowed[kpiNormalizeLdap_(ldap)] = true; });
  const result = [];
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const ldap = kpiNormalizeLdap_(values[index][0]);
    const periodKey = kpiNormalizePeriodKey_(values[index][1]);
    const task = String(values[index][2] || '').trim();
    const status = String(values[index][3] || '').trim() || 'Заплановано';
    if (allowed[ldap] && periodKey && task) result.push({ ldap: ldap, periodKey: periodKey, task: task, status: status });
  }
  return result.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

function kpiAddDevelopmentPlan_(request) {
  const viewer = kpiGetAccessProfile_(request.viewerLdap);
  if (!viewer || viewer.role !== 'admin') return kpiJson_({ ok: false, error: 'forbidden' });
  const targetLdap = kpiNormalizeLdap_(request.targetLdap);
  const periodKey = kpiNormalizePeriodKey_(request.periodKey);
  const task = String(request.task || '').trim().slice(0, 500);
  const status = String(request.status || '').trim().slice(0, 80) || 'Заплановано';
  const profiles = kpiGetAccessProfiles_();
  if (!targetLdap || !profiles[targetLdap] || !periodKey || !task) return kpiJson_({ ok: false, error: 'Вкажіть LDAP, місяць і крок донавчання' });
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_DEVELOPMENT_PLANS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_DEVELOPMENT_PLANS_SHEET_NAME);
    sheet.appendRow(['LDAP', 'Період', 'Крок донавчання', 'Статус', 'Оновлено']);
  }
  sheet.appendRow([targetLdap, periodKey, task, status, new Date()]);
  kpiAudit_(viewer.ldap, targetLdap, 'План донавчання', periodKey, task);
  return kpiJson_({ ok: true, data: { ldap: targetLdap, periodKey: periodKey, task: task, status: status } });
}

function kpiGetKpiTargets_(ss, direction) {
  const sheet = ss.getSheetByName(KPI_TARGETS_SHEET_NAME);
  if (!sheet) return [];
  const requiredDirection = String(direction || '').trim();
  const result = [];
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    const itemDirection = String(values[index][0] || '').trim();
    const metric = String(values[index][1] || '').trim();
    const target = String(values[index][2] || '').trim();
    if (metric && target && (!requiredDirection || itemDirection === requiredDirection || itemDirection === 'ALL')) result.push({ direction: itemDirection || 'ALL', metric: metric, target: target });
  }
  return result;
}

function kpiSetKpiTarget_(request) {
  const viewer = kpiGetAccessProfile_(request.viewerLdap);
  if (!viewer || viewer.role !== 'admin') return kpiJson_({ ok: false, error: 'forbidden' });
  const direction = String(request.direction || '').trim().slice(0, 100) || 'ALL';
  const metric = String(request.metric || '').trim().slice(0, 80);
  const target = String(request.target || '').trim().slice(0, 80);
  if (!metric || !target) return kpiJson_({ ok: false, error: 'Вкажіть показник і ціль' });
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_TARGETS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_TARGETS_SHEET_NAME);
    sheet.appendRow(['Напрямок', 'Показник', 'Ціль', 'Оновлено']);
  }
  const values = sheet.getDataRange().getDisplayValues();
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0] || '').trim() === direction && String(values[index][1] || '').trim().toLowerCase() === metric.toLowerCase()) {
      sheet.getRange(index + 1, 3, 1, 2).setValues([[target, new Date()]]);
      kpiAudit_(viewer.ldap, direction, 'Ціль KPI', '', metric + ': ' + target);
      return kpiJson_({ ok: true, data: { direction: direction, metric: metric, target: target } });
    }
  }
  sheet.appendRow([direction, metric, target, new Date()]);
  kpiAudit_(viewer.ldap, direction, 'Ціль KPI', '', metric + ': ' + target);
  return kpiJson_({ ok: true, data: { direction: direction, metric: metric, target: target } });
}

function kpiAudit_(actorLdap, target, action, periodKey, details) {
  const ss = SpreadsheetApp.openById(KPI_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(KPI_AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(KPI_AUDIT_SHEET_NAME);
    sheet.appendRow(['Дата/час', 'Хто змінив', 'Кого/що', 'Дія', 'Період', 'Деталі']);
  }
  sheet.appendRow([new Date(), actorLdap, target, action, periodKey, details]);
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
