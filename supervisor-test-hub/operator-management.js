const operatorAccessReady = new WeakMap();
const blockedOperatorMessage = 'Доступ до Центру знань вимкнено. Зверніться до супервайзера.';

function ensureOperatorAccess(db) {
  if (!operatorAccessReady.has(db)) {
    operatorAccessReady.set(db, db.prepare(
      'CREATE TABLE IF NOT EXISTS th_blocked_operators (user_id TEXT PRIMARY KEY)'
    ).run().catch(error => {
      operatorAccessReady.delete(db);
      throw error;
    }));
  }
  return operatorAccessReady.get(db);
}

async function isOperatorBlocked(db, user) {
  await ensureOperatorAccess(db);
  return !!await db.prepare('SELECT 1 FROM th_blocked_operators WHERE user_id=?').bind(user).first();
}

async function changeOperatorAccess(req, env) {
  const data = await req.json();
  if (typeof data?.id !== 'string' || !/^\d+$/.test(data.id) || typeof data.blocked !== 'boolean') {
    return J({ error: 'Перевірте оператора й параметри доступу.' }, 400);
  }
  if (admin(env, data.id)) return J({ error: 'Доступ супервайзера керується окремо.' }, 403);
  const db = env.DB;
  if (!await db.prepare('SELECT 1 FROM th_users WHERE id=?').bind(data.id).first()) {
    return J({ error: 'Оператора не знайдено.' }, 404);
  }
  await db.prepare(data.blocked
    ? 'INSERT OR IGNORE INTO th_blocked_operators(user_id) VALUES(?)'
    : 'DELETE FROM th_blocked_operators WHERE user_id=?').bind(data.id).run();
  return J({ ok: true, blocked: data.blocked });
}

function assignmentRemovalStatements(db, scope, id) {
  const selector = scope === 'test' ? 'test_id=?' : 'id=?';
  const assignmentIds = 'SELECT id FROM th3_assignments WHERE ' + selector;
  return [
    db.prepare('DELETE FROM th3_answers WHERE attempt_id IN (SELECT id FROM th3_attempts WHERE assignment_id IN (' + assignmentIds + '))').bind(id),
    db.prepare('DELETE FROM th_learning_progress WHERE assignment_id IN (' + assignmentIds + ')').bind(id),
    db.prepare('DELETE FROM th3_attempts WHERE assignment_id IN (' + assignmentIds + ')').bind(id),
    db.prepare('DELETE FROM th3_assignments WHERE ' + selector).bind(id)
  ];
}

async function deleteAssignment(req, db) {
  const data = await req.json();
  if (typeof data?.id !== 'string' || !data.id || data.confirm !== true) {
    return J({ error: 'Підтвердьте видалення призначення.' }, 400);
  }
  const results = await db.batch(assignmentRemovalStatements(db, 'assignment', data.id));
  if (!results.at(-1).meta.changes) return J({ error: 'Призначення вже видалене або відсутнє.' }, 404);
  return J({ ok: true });
}

async function deleteLibraryTest(req, db) {
  const data = await req.json();
  if (typeof data?.id !== 'string' || !data.id || data.confirm !== true) {
    return J({ error: 'Підтвердьте видалення тесту разом з історією.' }, 400);
  }
  const id = data.id;
  const results = await db.batch([
    ...assignmentRemovalStatements(db, 'test', id),
    db.prepare('DELETE FROM th_question_learning WHERE question_id IN (SELECT id FROM th_questions WHERE test_id=?)').bind(id),
    db.prepare('DELETE FROM th_test_learning WHERE test_id=?').bind(id),
    db.prepare('DELETE FROM th_questions WHERE test_id=?').bind(id),
    db.prepare('DELETE FROM th3_testmeta WHERE test_id=?').bind(id),
    db.prepare('DELETE FROM th_tests WHERE id=?').bind(id)
  ]);
  if (!results.at(-1).meta.changes) return J({ error: 'Тест уже видалено або не знайдено.' }, 404);
  return J({ ok: true });
}

async function resumeOperatorTest(env, user, id, message) {
  const run = await getRun(env.DB, id, user);
  if (!run) throw Error('Призначення вже недоступне.');
  if (message && message !== run.display_message_id) {
    await env.DB.prepare('UPDATE th3_attempts SET display_message_id=? WHERE id=?').bind(message, id).run();
    run.display_message_id = message;
  }
  return showQuestion(env, user, run);
}

async function listOperatorTests(env, user, page = 0, message = null) {
  const pageSize = 5;
  const rows = (await env.DB.prepare(
    `WITH summary AS (
      SELECT a.id,a.created_at,t.title,a.deadline,a.max_attempts,
       COUNT(r.id) used,
       MAX(CASE WHEN r.status='finished' THEN r.percent END) best,
       MAX(CASE WHEN r.status='finished' THEN COALESCE(r.passed,0) ELSE 0 END) passed,
       MAX(CASE WHEN r.status='active' THEN 1 ELSE 0 END) active
      FROM th3_assignments a JOIN th_tests t ON t.id=a.test_id
      LEFT JOIN th3_attempts r ON r.assignment_id=a.id
      WHERE a.user_id=?
      GROUP BY a.id
    ), available AS (
      SELECT *, (deadline IS NULL OR julianday(deadline)>julianday('now')) AND
        (active=1 OR (passed=0 AND used<max_attempts)) can_open
      FROM summary
    )
    SELECT *,COUNT(*) OVER() total FROM available
    ORDER BY can_open DESC, CASE WHEN can_open THEN active ELSE 0 END DESC,
      CASE WHEN can_open THEN COALESCE(deadline,'9999') END ASC, created_at DESC,id DESC
    LIMIT ? OFFSET ?`
  ).bind(user, pageSize, page * pageSize).all()).results;

  if (!rows.length && page) return listOperatorTests(env, user, 0, message);
  if (!rows.length) {
    return chatSay(env, user, '<b>МОЇ ТЕСТИ</b>\n\nПоки немає призначених тестів.', [], message);
  }

  const buttons = [];
  const text = rows.map((test, index) => {
    const number = page * pageSize + index + 1;
    const status = test.passed ? '✅ Складено' : expired(test.deadline) ? '⌛ Дедлайн минув' :
      test.active ? '🟡 У процесі' : test.best !== null ? '❌ Не складено' : '⏳ Очікує';
    if (test.can_open) {
      const action = test.active ? 'Продовжити' : test.used ? 'Спробувати ще раз' : 'Відкрити';
      buttons.push([{ text: number + '. ' + action + ' · ' + clip(displayTitle(test.title), 34), callback_data: 's:' + test.id, style: 'primary' }]);
    }
    return '<b>' + number + '. ' + E(displayTitle(test.title)) + '</b>\n' +
      status + ' · спроби ' + test.used + '/' + test.max_attempts +
      (test.best === null ? '' : ' · результат ' + test.best + '%') +
      (test.deadline ? '\nДо ' + E(fmt(test.deadline)) : '');
  }).join('\n\n');

  const pages = Math.ceil(rows[0].total / pageSize);
  if (pages > 1) {
    const navigation = [];
    if (page) navigation.push({ text: 'Попередні', callback_data: 'l:' + (page - 1) });
    if (page + 1 < pages) navigation.push({ text: 'Наступні', callback_data: 'l:' + (page + 1) });
    buttons.push(navigation);
  }
  return chatSay(env, user, '<b>МОЇ ТЕСТИ</b>\n\n' + text + (pages > 1 ? '\n\nСторінка ' + (page + 1) + ' із ' + pages : ''), buttons, message);
}
