// Optional pre-test study. Progress is independent of scored attempts.
const learningReady=new WeakMap();
async function ensureLearning(db){
  if(!learningReady.has(db))learningReady.set(db,db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS th_question_learning (question_id TEXT PRIMARY KEY,learning_text TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '')"),
    db.prepare('CREATE TABLE IF NOT EXISTS th_test_learning (test_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS th_learning_progress (assignment_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,questions_json TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  ]).catch(e=>{learningReady.delete(db);throw e;}));
  await learningReady.get(db);
}
function studyURL(value){
  if(!value)return '';
  if(typeof value!=='string'||value.length>1000)throw Error('Посилання має містити до 1000 символів.');
  let u;try{u=new URL(value.trim());}catch{throw Error('Надішліть повне HTTPS-посилання на матеріал.');}
  if(u.protocol!=='https:'||u.username||u.password||!u.hostname)throw Error('Додайте HTTPS-посилання без логіна й пароля в адресі.');
  if(u.href.length>1000)throw Error('Повна адреса джерела має містити до 1000 символів.');
  return u.href;
}
function learningEnabled(b){return b.learning_enabled===true||b.learning_enabled===1;}
function validateLearning(b){
  if(b.learning_enabled!==undefined&&![true,false,0,1].includes(b.learning_enabled))throw Error('Перевірте налаштування підготовки.');
  for(let i=0;i<b.questions.length;i++){
    const q=b.questions[i];
    if(q.learning_text!==undefined&&(typeof q.learning_text!=='string'||q.learning_text.length>3000))throw Error('Матеріал до питання '+(i+1)+' має містити до 3000 символів.');
    if(learningEnabled(b)&&!q.learning_text?.trim())throw Error('Додайте матеріал для повторення до питання '+(i+1)+' або вимкніть підготовку перед тестом.');
    if(q.source_url)studyURL(q.source_url);
  }
}
function shuffledIds(rows){
  const ids=rows.map(x=>x.id);
  for(let i=ids.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
  return ids;
}
async function studyAssignment(env,user,id){
  await ensureLearning(env.DB);
  const a=await getA(env.DB,id,user);
  if(!a)throw Error('Тест не призначено.');
  if(expired(a.deadline))throw Error('Дедлайн минув.');
  return a;
}
async function studyCard(env,user,a,progress,message=null){
  const ids=JSON.parse(progress.questions_json);
  if(progress.position>=ids.length){
    return chatSay(env,user,'<b>ПІДГОТОВКУ ЗАВЕРШЕНО</b>\n\n'+E(displayTitle(a.title))+'\n\nВи переглянули матеріали до всіх '+ids.length+' запитань. Тепер можна перейти до тесту.\n\nПідготовка не витрачає спроби. Спроба почнеться після натискання кнопки нижче.',[[{text:'Розпочати тест →',callback_data:'lt:'+a.id}],[{text:'Повторити матеріали ↻',callback_data:'lr:'+a.id}]],message);
  }
  const q=await env.DB.prepare('SELECT q.question,l.learning_text,l.source_url FROM th_questions q JOIN th_question_learning l ON l.question_id=q.id WHERE q.id=? AND q.test_id=?').bind(ids[progress.position],a.test_id).first();
  if(!q?.learning_text?.trim())throw Error('Матеріал ще не додано. Зверніться до супервайзера.');
  const keys=[];
  if(q.source_url)keys.push([{text:'Повторити в джерелі ↗',url:studyURL(q.source_url)}]);
  keys.push([{text:progress.position+1===ids.length?'Завершити підготовку →':'Наступний матеріал →',callback_data:'ln:'+a.id+':'+progress.position}]);
  keys.push([{text:'Мої тести',callback_data:'l'}]);
  return chatSay(env,user,'<b>ПІДГОТОВКА ДО ТЕСТУ</b>\n'+E(displayTitle(a.title))+'\n\nМатеріал '+(progress.position+1)+' із '+ids.length+'\n\n<b>'+E(clip(q.question,180))+'</b>\n\n'+E(q.learning_text)+'\n\n<i>Перегляньте пояснення та за потреби відкрийте джерело. Після підготовки почнеться сам тест.</i>',keys,message);
}
async function begin(env,user,id,message=null){
  const a=await studyAssignment(env,user,id);
  const active=await env.DB.prepare("SELECT id FROM th3_attempts WHERE assignment_id=? AND status='active'").bind(id).first();
  if(active)return showQuestion(env,user,await getRun(env.DB,active.id,user));
  const setting=await env.DB.prepare('SELECT enabled FROM th_test_learning WHERE test_id=?').bind(a.test_id).first();
  if(!setting?.enabled)return beginTest(env,user,id,message);
  const pool=(await env.DB.prepare('SELECT q.id,l.learning_text FROM th_questions q LEFT JOIN th_question_learning l ON l.question_id=q.id WHERE q.test_id=? ORDER BY q.position').bind(a.test_id).all()).results;
  if(!pool.length||pool.some(x=>!x.learning_text?.trim()))throw Error('Підготовка ще не заповнена для всіх питань. Зверніться до супервайзера.');
  await env.DB.prepare('INSERT OR IGNORE INTO th_learning_progress(assignment_id,user_id,questions_json) SELECT id,user_id,? FROM th3_assignments WHERE id=? AND user_id=?').bind(JSON.stringify(shuffledIds(pool)),id,user).run();
  const progress=await env.DB.prepare('SELECT * FROM th_learning_progress WHERE assignment_id=? AND user_id=?').bind(id,user).first();
  if(!progress)throw Error('Призначення вже недоступне.');
  return studyCard(env,user,a,progress,message);
}
async function learningCallback(env,user,action,id,position,message=null){
  const a=await studyAssignment(env,user,id);
  const p=await env.DB.prepare('SELECT * FROM th_learning_progress WHERE assignment_id=? AND user_id=?').bind(id,user).first();
  if(!p)throw Error('Спочатку відкрийте підготовку через «Мої тести».');
  const n=JSON.parse(p.questions_json).length;
  if(action==='ln'){
    if(!Number.isInteger(position)||p.position!==position||position>=n)throw Error('Цей матеріал уже переглянуто. Використайте останню кнопку або /tests.');
    const changed=await env.DB.prepare('UPDATE th_learning_progress SET position=position+1,updated_at=CURRENT_TIMESTAMP WHERE assignment_id=? AND user_id=? AND position=?').bind(id,user,position).run();
    if(!changed.meta.changes)return;
    return studyCard(env,user,a,{...p,position:position+1},message);
  }
  if(action==='lr'){
    if(p.position<n)throw Error('Підготовку ще не завершено.');
    const rows=(await env.DB.prepare('SELECT id FROM th_questions WHERE test_id=? ORDER BY position').bind(a.test_id).all()).results;
    await env.DB.prepare('UPDATE th_learning_progress SET position=0,questions_json=?,updated_at=CURRENT_TIMESTAMP WHERE assignment_id=? AND user_id=? AND position=?').bind(JSON.stringify(shuffledIds(rows)),id,user,n).run();
    return begin(env,user,id,message);
  }
  if(action==='lt'){
    if(p.position<n)throw Error('Спочатку перегляньте всі матеріали підготовки.');
    return beginTest(env,user,id,message);
  }
  throw Error('Невідома дія.');
}
function completeDraftQuestion(s){
  if(s.editIndex===undefined)s.draft.questions.push(s.question);else s.draft.questions[s.editIndex]=s.question;
  delete s.editIndex;delete s.question;s.step='review';
}
