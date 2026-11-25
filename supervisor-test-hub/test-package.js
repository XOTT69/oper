const packageSizeLimit = 1_000_000;

function normalizeTestPackage(payload) {
  const tests = Array.isArray(payload) ? payload : payload?.tests;
  if (!Array.isArray(tests) || !tests.length || tests.length > 50) {
    throw Error('Пакет має містити від 1 до 50 тестів.');
  }

  const titles = new Set();
  let questionCount = 0;
  return tests.map((test, index) => {
    const title = typeof test?.title === 'string' ? test.title.trim() : '';
    const label = 'Тест ' + (index + 1) + (title ? ' · ' + title.slice(0, 180) : '');
    if (title.length < 3 || title.length > 180) throw Error(label + '. Назва має містити від 3 до 180 символів.');
    const titleKey = title.replace(/\s+/g, ' ').toLocaleLowerCase('uk');
    if (titles.has(titleKey)) throw Error(label + '. Така назва вже є в пакеті.');
    titles.add(titleKey);

    if (!Array.isArray(test.questions) || !test.questions.length || test.questions.length > 100) {
      throw Error(label + '. Додайте від 1 до 100 питань.');
    }
    questionCount += test.questions.length;
    if (questionCount > 250) throw Error('Один пакет може містити до 250 питань.');

    const entry = {
      title,
      description: String(test.description ?? '').slice(0, 1000),
      pass_percent: test.pass_percent ?? 80,
      draw_count: test.draw_count ?? 0,
      learning_enabled: test.learning_enabled === undefined ? false : test.learning_enabled,
      questions: []
    };
    if (!Number.isInteger(entry.pass_percent) || entry.pass_percent < 0 || entry.pass_percent > 100) {
      throw Error(label + '. Прохідний бал має бути цілим числом від 0 до 100.');
    }
    if (!Number.isInteger(entry.draw_count) || entry.draw_count < 0 || entry.draw_count > test.questions.length) {
      throw Error(label + '. Перевірте кількість випадкових питань.');
    }
    if (![true, false, 0, 1].includes(entry.learning_enabled)) throw Error(label + '. Перевірте налаштування підготовки.');
    entry.learning_enabled = learningEnabled(entry);

    entry.questions = test.questions.map((q, questionIndex) => {
      const questionLabel = label + ', питання ' + (questionIndex + 1);
      if (!q || !validTest({ title, pass_percent: entry.pass_percent, questions: [q] })) {
        throw Error(questionLabel + '. Перевірте текст, 2–6 непорожніх варіантів до 120 символів, індекси правильних відповідей і бали.');
      }
      try { validateLearning({ learning_enabled: entry.learning_enabled, questions: [q] }); }
      catch (error) { throw Error(questionLabel + '. ' + error.message); }
      return {
        question: q.question,
        options: q.options,
        correct: [...q.correct].sort((a, b) => a - b),
        points: q.points ?? 1,
        explanation: String(q.explanation ?? '').slice(0, 2000),
        learning_text: String(q.learning_text ?? '').trim(),
        source_url: studyURL(q.source_url || '')
      };
    });
    return entry;
  });
}

async function testPackageApi(req, db, preview) {
  if (Number(req.headers.get('Content-Length')) > packageSizeLimit) {
    return J({ error: 'Розмір пакета має бути до 1 МБ.' }, 413);
  }
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > packageSizeLimit) return J({ error: 'Розмір пакета має бути до 1 МБ.' }, 413);

  let tests;
  try { tests = normalizeTestPackage(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) {
    return J({ error: error instanceof SyntaxError ? 'Перевірте формат JSON.' : error.message }, 400);
  }

  const questionCount = tests.reduce((count, test) => count + test.questions.length, 0);
  if (preview) return J({ tests, questionCount });

  await db.prepare('CREATE TABLE IF NOT EXISTS th_test_package_imports (digest TEXT PRIMARY KEY)').run();
  const canonical = JSON.stringify(tests.map(test => JSON.stringify(test)).sort());
  const digest = await browserDigest(canonical);
  const receipt = () => db.prepare('SELECT 1 FROM th_test_package_imports WHERE digest=?').bind(digest).first();
  const duplicate = () => J({ error: 'Цей пакет уже імпортовано. Його тести можна знайти в бібліотеці.' }, 409);
  if (await receipt()) return duplicate();

  const statements = [db.prepare('INSERT INTO th_test_package_imports(digest) VALUES(?)').bind(digest)];
  for (const test of tests) statements.push(...testWriteStatements(db, test, ID()));
  try {
    await db.batch(statements);
  } catch (error) {
    // A simultaneous retry can win the same unique receipt before this transaction starts.
    if (await receipt()) return duplicate();
    throw error;
  }
  return J({ created: tests.length, questionCount });
}
