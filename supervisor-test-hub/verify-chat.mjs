import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createHmac,webcrypto} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`
CREATE TABLE th_users(id TEXT PRIMARY KEY,name TEXT,username TEXT,display_name TEXT DEFAULT '',operator_tag TEXT DEFAULT '');
CREATE TABLE th_tests(id TEXT PRIMARY KEY,title TEXT,description TEXT,pass_percent INTEGER,draw_count INTEGER,published INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE th_questions(id TEXT PRIMARY KEY,test_id TEXT,position INTEGER,question TEXT,options_json TEXT,correct_json TEXT,points INTEGER,explanation TEXT);
CREATE TABLE th3_testmeta(test_id TEXT PRIMARY KEY,archived INTEGER DEFAULT 0);
CREATE TABLE th3_assignments(id TEXT PRIMARY KEY,test_id TEXT,user_id TEXT,deadline TEXT,max_attempts INTEGER,correction_limit INTEGER,notified INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE th3_attempts(id TEXT PRIMARY KEY,assignment_id TEXT,user_id TEXT,questions_json TEXT,position INTEGER DEFAULT 0,selected_json TEXT DEFAULT '[]',pending_feedback TEXT DEFAULT '',corrections_used INTEGER DEFAULT 0,display_message_id INTEGER,status TEXT DEFAULT 'active',percent INTEGER,passed INTEGER,score INTEGER DEFAULT 0,max_score INTEGER,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);
CREATE TABLE th3_answers(id TEXT PRIMARY KEY,attempt_id TEXT,question_id TEXT,selected_json TEXT,correct INTEGER,points_earned INTEGER,UNIQUE(attempt_id,question_id));
INSERT INTO th_users(id,name,username,operator_tag) VALUES('456','Олена Коваль','olena_demo','Зміна 2'),('789','Дмитро Бондар','dmytro_demo','СВ');
`);
const DB={prepare(sql){const statement=sqlite.prepare(sql);let values=[];return{bind(...v){values=v;return this;},async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};}};},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
let calls=[],mid=1;
const fetch=async(url,opts)=>{assert(String(url).startsWith('https://api.telegram.org/botfixture/'));const body=JSON.parse(opts.body);calls.push({method:String(url).split('/').at(-1),...body});return new Response(JSON.stringify({ok:true,result:{message_id:mid++}}));};
const context={crypto:webcrypto,TextEncoder,TextDecoder,URLSearchParams,Response,Request,URL,Intl,console,fetch};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('./worker.js',import.meta.url),'utf8').replace('export default {','const worker={')+'\nthis.test={worker,parseCorrect,parseKyivDeadline,chatApi,CHAT_TABLE_SQL,begin,learningCallback,studyURL,validateLearning,pick,confirm,deferQuestion,getRun,question,buildQuestion};',context);
const {worker,parseCorrect,parseKyivDeadline,chatApi,begin,learningCallback,studyURL,validateLearning,pick,confirm,deferQuestion,getRun,question,buildQuestion}=context.test;
const env={DB,BOT_TOKEN:'fixture',WEBHOOK_SECRET:'fixture-secret',ADMIN_TELEGRAM_IDS:'123'};
let event=1000;
const state=()=>JSON.parse(sqlite.prepare("SELECT state_json FROM th_admin_chat WHERE user_id='123'").get()?.state_json||'null');
const count=table=>sqlite.prepare('SELECT count(*) n FROM '+table).get().n;
const msg=(text,user='123',type='private')=>({update_id:event++,message:{message_id:mid++,chat:{id:Number(user),type},from:{id:Number(user),first_name:'Admin',username:'admin_demo'},text}});
const cb=(data,user='123',type='private')=>({update_id:event++,callback_query:{id:'cb'+event,from:{id:Number(user)},message:{message_id:mid++,chat:{id:Number(user),type}},data}});
const post=async(update,secret='fixture-secret')=>{const r=await worker.fetch(new Request('https://fixture/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret,'content-type':'application/json'},body:JSON.stringify(update)}),env);assert.equal(r.status,200,await r.clone().text());return r;};
const say=async(text)=>post(msg(text));const click=async(data)=>post(cb('a:'+data));const w=async(action)=>click('w:'+state().token+':'+action);
const latest=()=>calls.filter(x=>x.method==='sendMessage'||x.method==='editMessageText').at(-1);
const assertStep=step=>assert.equal(state()?.step,step,latest()?.text);
// Authorization is verified before session storage or mutations.
let bad=await worker.fetch(new Request('https://fixture/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'bad'},body:JSON.stringify(msg('/admin'))}),env);assert.equal(bad.status,403);
await post(cb('a:new','456'));assert.equal(count('th_tests'),0);assert.match(calls.at(-1).text,/Доступ/);
await post(cb('a:new','123','group'));assert.equal(count('th_tests'),0);
await assert.rejects(()=>chatApi(env,'456','/api/data'));
await say('/admin');assert.match(latest().text,/КЕРУВАННЯ/);
await say('/newtest');assertStep('title');await say('X');assertStep('title');
await say('Комунікація з клієнтами');assertStep('description');await w('skip');assertStep('pass');await w('default');assertStep('question');
await say('Які правила важливі?');await say('Без образ\nКоректне спілкування\nАгресія\nСтриманість');assertStep('correct');
await say('G');assertStep('correct');await w('correctPick:0');await w('correctPick:1');await w('correctPick:3');await w('correctPick:3');assert.deepEqual(state().question.correct,[0,1]);await w('correctPick:3');await w('correctDone');assertStep('points');await w('default');assertStep('explanation');await w('skip');assertStep('learning');await say('Спілкуйтеся коректно, доброзичливо та без образ.');assertStep('source');await say('https://example.com/service');assertStep('review');assert.equal(count('th_tests'),0);
const draftToken=state().token;
await w('questions:0');assert.match(latest().text,/✓ 1/);await w('qedit:0');assertStep('question');await say('Оновлене запитання?');await say('Так\nНі');await say('1');await w('default');await w('skip');await say('Правило та приклад для повторення.');await say('https://example.com/policy');assert.equal(state().draft.questions.length,1);assert.equal(state().draft.questions[0].question,'Оновлене запитання?');
await w('save');assert.equal(state(),null);assert.equal(count('th_tests'),1);assert.equal(count('th_questions'),1);
const first=sqlite.prepare('SELECT * FROM th_tests').get();
// Browser access creates tests in the same database and can only be enabled in the Telegram Mini App.
function signedTelegram(user) {
  const date=String(Math.floor(Date.now()/1000));
  const account=JSON.stringify({id:user});
  const key=createHmac('sha256','WebAppData').update(env.BOT_TOKEN).digest();
  const hash=createHmac('sha256',key).update('auth_date='+date+'\nuser='+account).digest('hex');
  return new URLSearchParams({auth_date:date,user:account,hash}).toString();
}
const webSetup='/api/web-access/setup';
const webLogin='/api/web-access/login';
const webLogout='/api/web-access/logout';
function browserRequest(path,{method='GET',body,origin='https://fixture',telegram,cookie,settings=env}={}) {
  const headers={Origin:origin};
  if(body)headers['Content-Type']='application/json';
  if(cookie)headers.Cookie=cookie;
  if(telegram)headers['X-Telegram-Init-Data']=signedTelegram(telegram);
  return worker.fetch(new Request('https://fixture'+path,{method,headers,body:body?JSON.stringify(body):undefined}),settings);
}
assert.equal((await browserRequest(webSetup,{method:'POST'})).status,401);
assert.equal((await browserRequest(webSetup,{method:'POST',telegram:456})).status,403);
assert.equal((await browserRequest(webSetup,{method:'POST',telegram:123,origin:'https://external.test'})).status,403);
const credential=await (await browserRequest(webSetup,{method:'POST',telegram:123})).json();
assert.equal(credential.login,'123');
assert.match(credential.password,/^[a-f0-9]{40}$/);
assert.notEqual(sqlite.prepare('SELECT password_hash FROM th_web_credentials').get().password_hash,credential.password);
const login=()=>browserRequest(webLogin,{method:'POST',body:credential});
assert.equal((await browserRequest(webLogin,{method:'POST',body:{...credential,password:'0'.repeat(40)}})).status,401);
const session=await login();
assert.equal(session.status,200);
assert.match(session.headers.get('Set-Cookie'),/Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Strict/);
const sessionCookie=session.headers.get('Set-Cookie').split(';')[0];
assert.equal((await browserRequest('/api/me',{cookie:sessionCookie})).status,200);
assert.equal((await browserRequest(webSetup,{method:'POST',cookie:sessionCookie})).status,401);
assert.equal((await browserRequest('/api/me',{cookie:sessionCookie,settings:{...env,ADMIN_TELEGRAM_IDS:''}})).status,403);
const fixtureTest={title:'Перевірка браузера',pass_percent:80,questions:[{question:'Зберегти?',options:['Так','Ні'],correct:[0]}]};
assert.equal((await browserRequest('/api/test/save',{method:'POST',body:fixtureTest,cookie:sessionCookie,origin:'https://external.test'})).status,403);
const savedInBrowser=await browserRequest('/api/test/save',{method:'POST',body:fixtureTest,cookie:sessionCookie});
assert.equal(savedInBrowser.status,200);
const sharedLibrary=await (await browserRequest('/api/data',{telegram:123})).json();
const browserTest=sharedLibrary.tests.find(test=>test.title===fixtureTest.title);
assert(browserTest);
assert.equal((await browserRequest('/api/test/delete',{method:'POST',body:{id:browserTest.id,confirm:true},cookie:sessionCookie})).status,200);
assert.equal((await browserRequest(webLogout,{method:'POST',cookie:sessionCookie})).status,200);
assert.equal((await browserRequest('/api/me',{cookie:sessionCookie})).status,401);
const expiredCookie=(await login()).headers.get('Set-Cookie').split(';')[0];
sqlite.prepare('UPDATE th_web_sessions SET expires_at=1').run();
assert.equal((await browserRequest('/api/me',{cookie:expiredCookie})).status,401);
const rotatingCookie=(await login()).headers.get('Set-Cookie').split(';')[0];
const rotated=await browserRequest(webSetup,{method:'POST',telegram:123});
assert.equal(rotated.status,200);
assert.notEqual((await rotated.json()).password,credential.password);
assert.equal((await login()).status,401);
assert.equal((await browserRequest('/api/me',{cookie:rotatingCookie})).status,401);
console.log('PASS: browser setup, shared test library, origin checks, cookie security, logout, expiration and credential rotation.');
await click('w:'+draftToken+':save');assert.equal(count('th_tests'),1);assert.match(latest().text,/застаріла/);
// Assignment uses named users, username and working tags; nothing sends before confirmation.
await say('/assign');await click('select:'+first.id);assertStep('people');assert.match(latest().text,/@olena_demo/);assert.match(latest().text,/Зміна 2/);
await w('pick:456');assert.equal(state().user_ids.length,1);await w('next');assertStep('deadline');await say('31.02.2027 12:00');assertStep('deadline');
await w('skip');await w('default');await w('default');assertStep('review');assert.equal(count('th3_assignments'),0);
await w('notify');assert.equal(state().notify,false);const assignUpdate=cb('a:w:'+state().token+':send');await post(assignUpdate);assert.equal(count('th3_assignments'),1);assert.equal(state(),null);
await post(assignUpdate);assert.equal(count('th3_assignments'),1);
assert.equal(calls.filter(x=>x.method==='sendMessage'&&String(x.chat_id)==='456').length,0);
// Editing an assigned test creates a separate draft copy and preserves the original.
await click('edit:'+first.id);assert.equal(state().draft.id,undefined);await w('save');assert.equal(count('th_tests'),2);assert.equal(sqlite.prepare('SELECT title FROM th_tests WHERE id=?').get(first.id).title,first.title);
const copy=sqlite.prepare('SELECT * FROM th_tests WHERE id!=?').get(first.id);
await click('edit:'+copy.id);assert.equal(state().draft.id,copy.id);await w('title');await say('Відредагований тест');await w('save');assert.equal(count('th_tests'),2);assert.equal(sqlite.prepare('SELECT title FROM th_tests WHERE id=?').get(copy.id).title,'Відредагований тест');
// Tag changes never overwrite a concurrently edited display name.
await say('/team');assert.match(latest().text,/@olena_demo/);await click('tag:456');sqlite.prepare("UPDATE th_users SET display_name='Нове ім’я' WHERE id='456'").run();await say('Нічна зміна');let person=sqlite.prepare("SELECT * FROM th_users WHERE id='456'").get();assert.equal(person.display_name,'Нове ім’я');assert.equal(person.operator_tag,'Нічна зміна');
await click('tag:456');await w('clear');assert.equal(sqlite.prepare("SELECT operator_tag FROM th_users WHERE id='456'").get().operator_tag,'');
// Archive is confirmed separately and resumable.
await click('archive:'+copy.id);assert.equal(sqlite.prepare('SELECT archived FROM th3_testmeta WHERE test_id=?').get(copy.id).archived,0);await click('menu');await click('resume');assert.match(latest().text,/Архівувати/);await w('archive');assert.equal(state(),null);assert.equal(sqlite.prepare('SELECT archived FROM th3_testmeta WHERE test_id=?').get(copy.id).archived,1);
// JSON split inside a string is preserved, reviewed and saved explicitly.
const json=JSON.stringify({title:'Імпортований тест',pass_percent:75,questions:[{question:'Чи правильно?',options:['Так','Ні'],correct:[0]}]});
await say('/importtest');await say(json.slice(0,12));await say(json.slice(12));await w('parse');assertStep('review');await w('save');assert.equal(count('th_tests'),3);
// A new flow cannot overwrite a draft; /cancel clears only the draft.
await say('/newtest');await say('Чернетка');const oldState=state();await say('/importtest');assert.equal(state().draft.title,oldState.draft.title);await say('/cancel');assert.equal(state(),null);assert.equal(count('th_tests'),3);
// Study is shuffled across every question, resumable, and does not consume attempts.
const learningAssignment=sqlite.prepare('SELECT * FROM th3_assignments').get();
assert.equal(sqlite.prepare('SELECT enabled FROM th_test_learning WHERE test_id=?').get(first.id).enabled,1);
await begin(env,'456',learningAssignment.id);
assert.equal(count('th3_attempts'),0);assert.match(latest().text,/ПІДГОТОВКА ДО ТЕСТУ/);assert.match(latest().text,/Правило та приклад/);
assert.equal(latest().reply_markup.inline_keyboard[0][0].url,'https://example.com/policy');
await assert.rejects(()=>learningCallback(env,'456','lt',learningAssignment.id,0),/Спочатку/);
await assert.rejects(()=>learningCallback(env,'789','lt',learningAssignment.id,0),/не призначено/);
await begin(env,'456',learningAssignment.id);assert.equal(sqlite.prepare('SELECT count(*) n FROM th_learning_progress').get().n,1);
await learningCallback(env,'456','ln',learningAssignment.id,0);assert.match(latest().text,/ПІДГОТОВКУ ЗАВЕРШЕНО/);assert.equal(count('th3_attempts'),0);
await assert.rejects(()=>learningCallback(env,'456','ln',learningAssignment.id,0),/уже переглянуто/);
await learningCallback(env,'456','lr',learningAssignment.id);assert.match(latest().text,/ПІДГОТОВКА ДО ТЕСТУ/);
await learningCallback(env,'456','ln',learningAssignment.id,0);await learningCallback(env,'456','lt',learningAssignment.id);assert.equal(count('th3_attempts'),1);
await learningCallback(env,'456','lt',learningAssignment.id);assert.equal(count('th3_attempts'),1);
assert.equal(studyURL('https://example.com/policy'),'https://example.com/policy');assert.throws(()=>studyURL('javascript:alert(1)'));assert.throws(()=>studyURL('https://name:password@example.com/'));
assert.throws(()=>validateLearning({learning_enabled:true,questions:[{learning_text:''}]}));
assert.doesNotThrow(()=>validateLearning({learning_enabled:false,questions:[{}]}));
const detail=await chatApi(env,'123','/api/test/detail?id='+first.id);assert.equal(detail.questions[0].source_url,'https://example.com/policy');assert.equal(detail.questions[0].learning_text,'Правило та приклад для повторення.');
const duplicated=await chatApi(env,'123','/api/test/duplicate',{id:first.id});const copied=await chatApi(env,'123','/api/test/detail?id='+duplicated.id);assert.equal(copied.test.learning_enabled,1);assert.equal(copied.questions[0].learning_text,detail.questions[0].learning_text);
// Results expose both username and tag, including answer drill-down.
const assignment=sqlite.prepare('SELECT id FROM th3_assignments').get();
sqlite.prepare("UPDATE th_users SET operator_tag='Зміна 2' WHERE id='456'").run();
sqlite.prepare("INSERT INTO th3_attempts(id,assignment_id,user_id,status,percent,passed,score,max_score) VALUES('r1',?,'456','finished',100,1,1,1)").run(assignment.id);
const answerQuestion=sqlite.prepare('SELECT id FROM th_questions WHERE test_id=?').get(first.id);
sqlite.prepare("INSERT INTO th3_answers VALUES('an1','r1',?,'[0]',1,1)").run(answerQuestion.id);
await say('/results');assert.match(latest().text,/@olena_demo/);assert.match(latest().text,/Зміна 2/);await click('answer:r1');assert.match(latest().text,/@olena_demo/);assert.match(latest().text,/Правильна відповідь/);
assert.deepEqual(Array.from(parseCorrect('1 3',4)),[0,2]);assert.throws(()=>parseCorrect('A A',4));
assert.equal(parseKyivDeadline('29.10.2027 18:00'),'2027-10-29T15:00:00.000Z');assert.equal(parseKyivDeadline('29.12.2027 18:00'),'2027-12-29T16:00:00.000Z');assert.throws(()=>parseKyivDeadline('31.02.2027 12:00'));
// Every study question is shown even when the scored test draws only one.
const multi=await chatApi(env,'123','/api/test/save',{title:'Повторення всіх тем',pass_percent:80,draw_count:1,learning_enabled:true,questions:[0,1,2].map(i=>({question:'Тема '+i,options:['Так','Ні'],correct:[0],learning_text:i===0?'&'.repeat(3000):'Пояснення '+i,source_url:'https://example.com/topic/'+i}))});
await chatApi(env,'123','/api/assign',{test_id:multi.id,user_ids:['789'],deadline:null,max_attempts:1,correction_limit:0,notify:false});
const ma=sqlite.prepare('SELECT id FROM th3_assignments WHERE test_id=?').get(multi.id);const before=count('th3_attempts');
const studyCallStart=calls.length;const studyMessage=9000;await begin(env,'789',ma.id,studyMessage);let progress=sqlite.prepare('SELECT * FROM th_learning_progress WHERE assignment_id=?').get(ma.id);const ids=JSON.parse(progress.questions_json);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
for(let i=0;i<3;i++){await assert.rejects(()=>learningCallback(env,'789','lt',ma.id),/Спочатку/);await learningCallback(env,'789','ln',ma.id,i,studyMessage);assert.equal(count('th3_attempts'),before);}
await learningCallback(env,'789','lt',ma.id,undefined,studyMessage);assert.equal(count('th3_attempts'),before+1);
const studyEdits=calls.slice(studyCallStart).filter(x=>x.method==='sendMessage'||x.method==='editMessageText');assert(studyEdits.length>=5);assert(studyEdits.every(x=>x.method==='editMessageText'&&x.message_id===studyMessage));
assert.equal(sqlite.prepare('SELECT display_message_id FROM th3_attempts WHERE assignment_id=?').get(ma.id).display_message_id,studyMessage);assert.equal(JSON.parse(sqlite.prepare('SELECT questions_json FROM th3_attempts WHERE assignment_id=?').get(ma.id).questions_json).length,1);
// Deferral rotates only unanswered questions, keeps one message, and scores each once.
const quiz=await chatApi(env,'123','/api/test/save',{title:'Зручний вибір відповідей',pass_percent:80,draw_count:0,learning_enabled:false,questions:[0,1,2].map(i=>({question:'Правила '+i,options:['Повага','Коректність','Агресія','Стриманість'],correct:[0,1,3]}))});
await chatApi(env,'123','/api/assign',{test_id:quiz.id,user_ids:['456'],deadline:null,max_attempts:1,correction_limit:0,notify:false});
const qa=sqlite.prepare('SELECT id FROM th3_assignments WHERE test_id=?').get(quiz.id);const quizCallStart=calls.length;const quizMessage=9100;await begin(env,'456',qa.id,quizMessage);
const qr=sqlite.prepare('SELECT id FROM th3_attempts WHERE assignment_id=?').get(qa.id);let current=await getRun(DB,qr.id,'456');let currentQuestion=await question(DB,current);const deferredId=currentQuestion.id;
const deferUpdate=cb('d:'+qr.id+':0:'+deferredId.slice(0,8),'456');deferUpdate.callback_query.message.message_id=quizMessage;await post(deferUpdate);
current=await getRun(DB,qr.id,'456');assert.equal(current.position,0);assert.equal(current.score,0);assert.equal(JSON.parse(current.questions_json).at(-1),deferredId);
await assert.rejects(()=>pick(env,'456',qr.id,0,0,deferredId.slice(0,8)),/оновилося/);await assert.rejects(()=>confirm(env,'456',qr.id,0,deferredId.slice(0,8)),/оновилося/);await assert.rejects(()=>deferQuestion(env,'789',qr.id,0),/оновилося/);
currentQuestion=await question(DB,current);let tag=currentQuestion.id.slice(0,8);await pick(env,'456',qr.id,0,0,tag);await pick(env,'456',qr.id,0,1,tag);await pick(env,'456',qr.id,0,3,tag);
assert.deepEqual(JSON.parse((await getRun(DB,qr.id,'456')).selected_json),[0,1,3]);let choices=latest().reply_markup.inline_keyboard;assert.equal(choices[0].length,4);assert.equal(choices[0][0].text,'1 ☑️');assert.equal(choices[0][2].text,'3 ◻️');
// Interleave a deferral between confirm's read and transaction: no orphan answer is inserted.
const originalBatch=DB.batch;DB.batch=async stmts=>{DB.batch=originalBatch;await deferQuestion(env,'456',qr.id,0,tag);return originalBatch(stmts);};
await assert.rejects(()=>confirm(env,'456',qr.id,0,tag),/уже збережено/);assert.equal(sqlite.prepare('SELECT count(*) n FROM th3_answers WHERE attempt_id=?').get(qr.id).n,0);
for(let pos=0;pos<3;pos++){
  current=await getRun(DB,qr.id,'456');currentQuestion=await question(DB,current);tag=currentQuestion.id.slice(0,8);
  if(pos===2)await assert.rejects(()=>deferQuestion(env,'456',qr.id,pos,tag),/останнє/);
  for(const index of [0,1,3])await pick(env,'456',qr.id,pos,index,tag);
  const submit=cb('c:'+qr.id+':'+pos+':'+tag,'456');submit.callback_query.message.message_id=quizMessage;await post(submit);
}
current=await getRun(DB,qr.id,'456');assert.equal(current.status,'finished');assert.equal(current.percent,100);assert.equal(current.score,3);assert.equal(sqlite.prepare('SELECT count(*) n FROM th3_answers WHERE attempt_id=?').get(qr.id).n,3);
assert(calls.slice(quizCallStart).filter(x=>x.method==='sendMessage'||x.method==='editMessageText').every(x=>x.method==='editMessageText'&&x.message_id===quizMessage));
// Telegram payload limits and callback byte budgets across every exercised path.
for(const call of calls){if(call.text)assert(call.text.replace(/&(?:amp|lt|gt|quot|#39);/g,'x').replace(/<[^>]*>/g,'').length<=4096);for(const b of call.reply_markup?.inline_keyboard?.flat()||[])if(b.callback_data)assert(Buffer.byteLength(b.callback_data)<=64,b.callback_data);}
fs.writeFileSync(new URL('./preview/chat-fixture.json',import.meta.url),JSON.stringify(calls.filter(x=>x.method==='sendMessage'||x.method==='editMessageText'),null,2));
const testPackage={tests:Array.from({length:14},(_,i)=>({
  title:'Пакетний тест '+(i+1),description:'Приклад',pass_percent:80,draw_count:0,learning_enabled:true,
  questions:Array.from({length:5},(_,j)=>({
    question:'Питання '+(j+1)+' для тесту '+(i+1),options:['Один','Два','Три','Чотири'],correct:[2],points:1,
    explanation:'Пояснення '+j,learning_text:'Матеріал для підготовки '+j,source_url:'https://example.com/policy#section'
  }))
}))};
const packageRoute='/api/test/import';
const packagePreview=await chatApi(env,'123',packageRoute+'/preview',testPackage);
assert.equal(packagePreview.tests.length,14);
assert.equal(packagePreview.questionCount,70);
const testsBeforePackage=count('th_tests');
const questionsBeforePackage=count('th_questions');
const invalid=structuredClone(testPackage);
invalid.tests[13].questions[4].correct=[4];
await assert.rejects(()=>chatApi(env,'123',packageRoute,invalid),/Тест 14.*питання 5/);
assert.equal(count('th_tests'),testsBeforePackage);
assert.equal(count('th_questions'),questionsBeforePackage);
const messageCount=calls.length;
const assignmentCount=count('th3_assignments');
const imported=await chatApi(env,'123',packageRoute,testPackage);
assert.deepEqual(imported,{created:14,questionCount:70});
await assert.rejects(()=>chatApi(env,'123',packageRoute,[...testPackage.tests].reverse()),/уже імпортовано/);
assert.equal(count('th_tests'),testsBeforePackage+14);
assert.equal(count('th_questions'),questionsBeforePackage+70);
const importedLibrary=(await chatApi(env,'123','/api/data')).tests.filter(test=>test.title.startsWith('Пакетний тест'));
assert.equal(importedLibrary.length,14);
assert(importedLibrary.every(test=>test.question_count===5&&test.assigned===0&&test.learning_enabled===1));
const importedQuestion=sqlite.prepare('SELECT learning_text,source_url FROM th_question_learning WHERE learning_text=?').get('Матеріал для підготовки 4');
assert.equal(importedQuestion.source_url,'https://example.com/policy#section');
assert.equal(count('th3_assignments'),assignmentCount);
assert.equal(calls.length,messageCount);
console.log('PASS: one package adds 14 separate tests and 70 questions, with review, validation, materials, no notifications and safe retry.');
const testToDelete=importedLibrary[0];
const assignmentApi='/api/assignment/delete';
const operatorApi='/api/operator/access';
const assignTest=(testId,userIds)=>chatApi(env,'123','/api/assign',{
  test_id:testId,user_ids:userIds,deadline:null,max_attempts:2,correction_limit:0,notify:false
});
const forUser=(testId,userId)=>sqlite.prepare('SELECT id FROM th3_assignments WHERE test_id=? AND user_id=?').get(testId,userId);
await assignTest(testToDelete.id,['456','789']);
const onlyOne=forUser(testToDelete.id,'456').id;
const other=forUser(testToDelete.id,'789').id;
await begin(env,'456',onlyOne);
await begin(env,'789',other);
assert(sqlite.prepare('SELECT 1 FROM th_learning_progress WHERE assignment_id=?').get(onlyOne));
await assert.rejects(()=>chatApi(env,'123',assignmentApi,{id:onlyOne}),/Підтвердьте/);
await assert.rejects(()=>chatApi(env,'123','/api/test/delete',{id:testToDelete.id}),/Підтвердьте/);
await chatApi(env,'123',assignmentApi,{id:onlyOne,confirm:true});
assert.equal(forUser(testToDelete.id,'456'),undefined);
assert(forUser(testToDelete.id,'789'));
assert.equal(sqlite.prepare('SELECT 1 FROM th_learning_progress WHERE assignment_id=?').get(onlyOne),undefined);
await post(cb('s:'+onlyOne,'456'));
assert.match(calls.at(-1).text,/не призначено/);
await chatApi(env,'123','/api/test/delete',{id:testToDelete.id,confirm:true});
assert.equal(forUser(testToDelete.id,'789'),undefined);
assert.equal(sqlite.prepare('SELECT 1 FROM th_tests WHERE id=?').get(testToDelete.id),undefined);
assert.equal(sqlite.prepare('SELECT 1 FROM th_learning_progress WHERE assignment_id=?').get(other),undefined);
await chatApi(env,'123',assignmentApi,{id:qa.id,confirm:true});
assert.equal(sqlite.prepare('SELECT 1 FROM th3_attempts WHERE id=?').get(qr.id),undefined);
assert.equal(sqlite.prepare('SELECT 1 FROM th3_answers WHERE attempt_id=?').get(qr.id),undefined);
assert(sqlite.prepare('SELECT 1 FROM th_tests WHERE id=?').get(quiz.id));
const managed=await chatApi(env,'123','/api/test/save',fixtureTest);
await assignTest(managed.id,['456','789']);
const managedId=forUser(managed.id,'456').id;
const managedMenuCalls=calls.length;
await post(msg('/tests','456'));
assert.equal(calls.slice(managedMenuCalls).filter(x=>x.method==='sendMessage').length,1);
assert.match(latest().text,/МОЇ ТЕСТИ/);
assert(latest().reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='s:'+managedId));
await post(cb('s:'+managedId,'456'));
const managedRun=sqlite.prepare('SELECT * FROM th3_attempts WHERE assignment_id=?').get(managedId);
assert(managedRun);
await assert.rejects(()=>chatApi(env,'123',operatorApi,{id:'123',blocked:true}),/супервайзера/);
await chatApi(env,'123',operatorApi,{id:'456',blocked:true});
assert.equal((await chatApi(env,'123','/api/data')).users.find(x=>x.id==='456').blocked,1);
assert.deepEqual(await assignTest(managed.id,['456']),{created:0,notified:0,skipped:1});
await post(msg('/start','456'));
assert.match(latest().text,/Доступ до Центру знань вимкнено/);
await post(cb('p:'+managedRun.id+':0:0','456'));
assert.match(calls.at(-1).text,/Доступ до Центру знань вимкнено/);
assert.equal(sqlite.prepare('SELECT selected_json FROM th3_attempts WHERE id=?').get(managedRun.id).selected_json,'[]');
await chatApi(env,'123',operatorApi,{id:'456',blocked:false});
await post(msg('/tests','456'));
assert.match(latest().reply_markup.inline_keyboard.flat().find(b=>b.callback_data==='s:'+managedId).text,/Продовжити/);
await post(cb('p:'+managedRun.id+':0:0','456'));
assert.equal(sqlite.prepare('SELECT selected_json FROM th3_attempts WHERE id=?').get(managedRun.id).selected_json,'[0]');
for(const test of importedLibrary.slice(1,7))await assignTest(test.id,['456']);
await post(msg('/tests','456'));
const menu=latest();
assert.match(menu.reply_markup.inline_keyboard[0][0].text,/Продовжити/);
assert(menu.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='s:'+managedId));
assert.match(menu.text,/Сторінка 1 із [2-9]/);
const nextPage=cb('l:1','456');
nextPage.callback_query.message.message_id=menu.message_id||9200;
await post(nextPage);
assert.equal(latest().method,'editMessageText');
assert.match(latest().text,/Сторінка 2 із [2-9]/);
console.log('PASS: operator block, restore, saved history, available-first single menu, per-operator deletion and full test removal.');
console.log('PASS: numeric checkbox selection, author selection buttons, single-message study/test transitions, defer/return/scoring and stale/racing actions, independent study stage, gating, resume, source validation, learning copy, chat wizard/create/edit/copy/import, assignment confirmation and replay, tags, archive/resume, results/answers, draft persistence/cancel, private-admin authorization, Kyiv DST, Telegram payload limits. No external messages sent.');


sqlite.prepare('UPDATE th_users SET operator_tag=? WHERE id=?').run('DEMO-LDAP','456');
const extendedTest={...testPackage.tests[0],title:'Unified training fixture',verification_status:'VERIFIED'};
const training={tests:[extendedTest],assignments:[{ldap:'demo-ldap',test_title:extendedTest.title}]};
const unifiedPreview=await chatApi(env,'123',packageRoute+'/preview',training);
assert.equal(unifiedPreview.assignments[0].action,'create');
assert.equal(unifiedPreview.tests[0].verification_status,'VERIFIED');
await assert.rejects(()=>chatApi(env,'123',packageRoute,{...training,assignments:[{ldap:'missing-ldap',test_title:extendedTest.title}]}),/LDAP/);
const unified=await chatApi(env,'123',packageRoute,training);
assert.equal(unified.created,1);assert.equal(unified.assigned,1);
const repeated=await chatApi(env,'123',packageRoute,training);
assert.equal(repeated.reused,1);assert.equal(repeated.skipped,1);
const manual={tests:[{...extendedTest,title:'Manual review fixture',verification_status:'SOURCE_CHECKED'}]};
assert.equal((await chatApi(env,'123',packageRoute+'/preview',manual)).requiresApproval,true);
await assert.rejects(()=>chatApi(env,'123',packageRoute,manual),/SOURCE_CHECKED/);
assert.equal((await chatApi(env,'123',packageRoute,{...manual,approve_source_checked:true})).created,1);
console.log('PASS: unified training preview, LDAP matching, duplicate reuse and manual review gate.');
