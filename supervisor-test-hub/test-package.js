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


function trainingTitle(value){return String(value).trim().replace(/\s+/g,' ').toLocaleLowerCase('uk');}
const trainingStatuses=['VERIFIED','SOURCE_CHECKED','NEEDS_REVIEW','BLOCKED'];
async function trainingPackageApi(payload,tests,db,preview){
  const raw=payload.tests;
  const extended=!Array.isArray(payload)&&(payload.assignments!==undefined||raw.some(t=>t.verification_status!==undefined));
  const assignments=extended?(payload.assignments??[]):[];
  if(!Array.isArray(assignments)||assignments.length>500)throw Error('До 500 призначень у пакеті.');
  const byTitle=new Map(tests.map((t,i)=>[trainingTitle(t.title),i]));
  const plan=tests.map((t,i)=>{
    const status=raw[i].verification_status??'UNSPECIFIED';
    if(status!=='UNSPECIFIED'&&!trainingStatuses.includes(status))throw Error('Невідомий статус: '+t.title);
    return {title:t.title,verification_status:status,action:'create',testId:ID()};
  });
  if(extended&&plan.some(p=>p.verification_status!=='VERIFIED'&&p.verification_status!=='SOURCE_CHECKED'))
    throw Error('Пакет навчання може містити лише VERIFIED або SOURCE_CHECKED.');
  if(!preview&&extended&&plan.some(p=>p.verification_status==='SOURCE_CHECKED')&&payload.approve_source_checked!==true)
    throw Error('Підтвердьте ручну перевірку SOURCE_CHECKED.');
  const existing=(await db.prepare('SELECT t.*,COALESCE(m.archived,0) archived,COALESCE(l.enabled,0) learning_enabled FROM th_tests t LEFT JOIN th3_testmeta m ON m.test_id=t.id LEFT JOIN th_test_learning l ON l.test_id=t.id').all()).results;
  const digest=async t=>browserDigest(JSON.stringify(t));
  for(let i=0;i<tests.length;i++){
    const t=tests[i], p=plan[i];p.digest=await digest(t);
    const matches=existing.filter(x=>trainingTitle(x.title)===trainingTitle(t.title));
    if(matches.length>1)throw Error('Кілька тестів з такою назвою: '+t.title);
    if(!matches.length)continue;
    const x=matches[0];
    if(x.archived)throw Error('Тест в архіві: '+t.title);
    const rows=(await db.prepare("SELECT q.*,COALESCE(l.learning_text,'') learning_text,COALESCE(l.source_url,'') source_url FROM th_questions q LEFT JOIN th_question_learning l ON l.question_id=q.id WHERE q.test_id=? ORDER BY q.position").bind(x.id).all()).results;
    const oldTest=normalizeTestPackage([{title:x.title,description:x.description,pass_percent:x.pass_percent,draw_count:x.draw_count,learning_enabled:!!x.learning_enabled,questions:rows.map(q=>({question:q.question,options:JSON.parse(q.options_json),correct:JSON.parse(q.correct_json),points:q.points,explanation:q.explanation,learning_text:q.learning_text,source_url:q.source_url}))}])[0];
    if(await digest(oldTest)!==p.digest)throw Error('Назва вже існує з іншим вмістом: '+t.title);
    p.action='reuse';p.testId=x.id;
  }
  const targets=[], seen=new Set();
  for(const a of assignments){
    if(!a||typeof a.ldap!=='string'||!a.ldap.trim()||a.ldap.length>80||typeof a.test_title!=='string')throw Error('Призначення має містити ldap і test_title.');
    const i=byTitle.get(trainingTitle(a.test_title));if(i===undefined)throw Error('Тест відсутній у пакеті: '+a.test_title);
    const p=plan[i], ldap=a.ldap.trim();
    const users=(await db.prepare("SELECT id,name,display_name,EXISTS(SELECT 1 FROM th_blocked_operators b WHERE b.user_id=th_users.id) blocked FROM th_users WHERE UPPER(TRIM(operator_tag))=UPPER(?)").bind(ldap).all()).results;
    if(users.length!==1||users[0].blocked)throw Error('LDAP не знайдено, неоднозначний або заблокований: '+ldap);
    const u=users[0], key=p.testId+':'+u.id;
    if(seen.has(key))throw Error('Дублікат призначення: '+ldap+' / '+p.title);seen.add(key);
    const max=a.max_attempts??3, correction=a.correction_limit??0, deadline=a.deadline??null;
    if(!Number.isInteger(max)||max<1||max>10||!Number.isInteger(correction)||correction<0||correction>10||(deadline!==null&&(typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now())))throw Error('Некоректні налаштування призначення: '+ldap);
    const exists=p.action==='reuse'&&await db.prepare('SELECT 1 FROM th3_assignments WHERE test_id=? AND user_id=?').bind(p.testId,u.id).first();
    targets.push({ldap,operator_name:u.display_name||u.name,test_title:p.title,testId:p.testId,userId:u.id,max_attempts:max,correction_limit:correction,deadline,action:exists?'skip':'create'});
  }
  const questionCount=tests.reduce((n,t)=>n+t.questions.length,0);
  if(preview)return J({tests:tests.map((t,i)=>({...t,verification_status:plan[i].verification_status,action:plan[i].action})),questionCount,assignments:targets.map(({userId,testId,...a})=>a),requiresApproval:extended&&plan.some(p=>p.verification_status==='SOURCE_CHECKED')});
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS th_training_import_tests (title_key TEXT PRIMARY KEY,digest TEXT NOT NULL,test_id TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS th_training_verification (test_id TEXT PRIMARY KEY,reported_status TEXT NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS th_training_import_assignments (test_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(test_id,user_id))')
  ]);
  const statements=[];
  for(let i=0;i<plan.length;i++){
    const p=plan[i];
    if(p.action==='create'){
      statements.push(db.prepare('INSERT INTO th_training_import_tests(title_key,digest,test_id) VALUES(?,?,?)').bind(trainingTitle(p.title),p.digest,p.testId));
      statements.push(...testWriteStatements(db,tests[i],p.testId));
    }
    if(p.verification_status!=='UNSPECIFIED')statements.push(db.prepare('INSERT INTO th_training_verification(test_id,reported_status,reviewed) VALUES(?,?,?) ON CONFLICT(test_id) DO UPDATE SET reported_status=excluded.reported_status,reviewed=excluded.reviewed').bind(p.testId,p.verification_status,Number(p.verification_status==='SOURCE_CHECKED'&&payload.approve_source_checked===true)));
  }
  for(const a of targets.filter(x=>x.action==='create')){
    statements.push(db.prepare('INSERT INTO th_training_import_assignments(test_id,user_id) VALUES(?,?)').bind(a.testId,a.userId));
    statements.push(db.prepare('INSERT INTO th3_assignments(id,test_id,user_id,deadline,max_attempts,correction_limit) VALUES(?,?,?,?,?,?)').bind(ID(),a.testId,a.userId,a.deadline,a.max_attempts,a.correction_limit));
  }
  if(statements.length)await db.batch(statements);
  return J({created:plan.filter(p=>p.action==='create').length,reused:plan.filter(p=>p.action==='reuse').length,questionCount,assigned:targets.filter(a=>a.action==='create').length,skipped:targets.filter(a=>a.action==='skip').length});
}
async function testPackageApi(req,db,preview){
  if(Number(req.headers.get('Content-Length'))>packageSizeLimit)return J({error:'Розмір пакета має бути до 1 МБ.'},413);
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength>packageSizeLimit)return J({error:'Розмір пакета має бути до 1 МБ.'},413);
  try{
    const input=JSON.parse(new TextDecoder().decode(bytes));
    const tests=normalizeTestPackage(input);
    const payload=Array.isArray(input)?{tests:input}:input;
    return await trainingPackageApi(payload,tests,db,preview);
  }catch(error){return J({error:error instanceof SyntaxError?'Перевірте формат JSON.':error.message},400);}
}
