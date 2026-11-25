import fs from 'node:fs';
await import('./build-chat.mjs');
const root=new URL('.',import.meta.url);
let s=fs.readFileSync(new URL('worker.js',root),'utf8');
s=s.replace('async function begin(env,user,id){','async function beginTest(env,user,id){');
s=s.replace('async function beginTest(env,user,id){',fs.readFileSync(new URL('learning.js',root),'utf8')+'\nasync function beginTest(env,user,id){');
s=s.replace("    if(p[0]==='s')await begin(env,user,p[1]);", "    if(['ln','lr','lt'].includes(p[0])){\n      if(q.message?.chat?.type!=='private'||String(q.message.chat.id)!==user)throw Error('Відкрийте тест у приватному чаті.');\n      await learningCallback(env,user,p[0],p[1],Number(p[2]));\n    }\n    else if(p[0]==='s')await begin(env,user,p[1]);");
s=s.replace('  let db=env.DB,method=req.method;','  let db=env.DB,method=req.method;\n  await ensureLearning(db);');
s=s.replace('SELECT t.*,COALESCE(m.archived,0) archived,','SELECT t.*,COALESCE(m.archived,0) archived,COALESCE(l.enabled,0) learning_enabled,');
s=s.replace('LEFT JOIN th3_testmeta m ON m.test_id=t.id\n         ORDER BY', 'LEFT JOIN th3_testmeta m ON m.test_id=t.id\n         LEFT JOIN th_test_learning l ON l.test_id=t.id\n         ORDER BY');
s=s.replaceAll("'SELECT * FROM th_tests WHERE id=?'", "'SELECT t.*,COALESCE(l.enabled,0) learning_enabled FROM th_tests t LEFT JOIN th_test_learning l ON l.test_id=t.id WHERE t.id=?'");
s=s.replaceAll("'SELECT * FROM th_questions WHERE test_id=? ORDER BY position'", "`SELECT q.*,COALESCE(l.learning_text,'') learning_text,COALESCE(l.source_url,'') source_url FROM th_questions q LEFT JOIN th_question_learning l ON l.question_id=q.id WHERE q.test_id=? ORDER BY q.position`");
s=s.replace('        explanation:x.explanation\n','        explanation:x.explanation,learning_text:x.learning_text,source_url:x.source_url\n');
s=s.replace("    let testId=b.id||ID();", "    try{validateLearning(b);}catch(e){return J({error:e.message},400);}\n    let testId=b.id||ID();");
s=s.replace("      cmds.push(db.prepare(\n        'DELETE FROM th_questions WHERE test_id=?'", "      cmds.push(db.prepare('DELETE FROM th_question_learning WHERE question_id IN (SELECT id FROM th_questions WHERE test_id=?)').bind(b.id));\n      cmds.push(db.prepare(\n        'DELETE FROM th_questions WHERE test_id=?'");
const start=s.indexOf('    b.questions.forEach((q,i)=>cmds.push(');const end=s.indexOf('\n    await db.batch(cmds);',start);
s=s.slice(0,start)+`    cmds.push(db.prepare('INSERT INTO th_test_learning(test_id,enabled) VALUES(?,?) ON CONFLICT(test_id) DO UPDATE SET enabled=excluded.enabled').bind(testId,Number(learningEnabled(b))));
    b.questions.forEach((q,i)=>{
      const questionId=ID();
      cmds.push(db.prepare('INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) VALUES(?,?,?,?,?,?,?,?)').bind(questionId,testId,i,q.question,JSON.stringify(q.options),JSON.stringify(q.correct),q.points??1,String(q.explanation||'').slice(0,2000)));
      cmds.push(db.prepare('INSERT INTO th_question_learning(question_id,learning_text,source_url) VALUES(?,?,?)').bind(questionId,String(q.learning_text||'').trim(),studyURL(q.source_url||'')));
    });
`+s.slice(end);
const dstart=s.indexOf('    qs.forEach((q,i)=>cmds.push(');const dend=s.indexOf('\n    await db.batch(cmds);',dstart);
s=s.slice(0,dstart)+`    cmds.push(db.prepare('INSERT INTO th_test_learning(test_id,enabled) VALUES(?,?)').bind(id,Number(!!test.learning_enabled)));
    qs.forEach((q,i)=>{
      const questionId=ID();
      cmds.push(db.prepare('INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) VALUES(?,?,?,?,?,?,?,?)').bind(questionId,id,i,q.question,q.options_json,q.correct_json,q.points,q.explanation));
      cmds.push(db.prepare('INSERT INTO th_question_learning(question_id,learning_text,source_url) VALUES(?,?,?)').bind(questionId,q.learning_text||'',q.source_url||''));
    });
`+s.slice(dend);
s=s.replace("      db.prepare('DELETE FROM th_questions WHERE test_id=?').bind(b.id),", "      db.prepare('DELETE FROM th_question_learning WHERE question_id IN (SELECT id FROM th_questions WHERE test_id=?)').bind(b.id),\n      db.prepare('DELETE FROM th_test_learning WHERE test_id=?').bind(b.id),\n      db.prepare('DELETE FROM th_questions WHERE test_id=?').bind(b.id),");
s=s.replace("text:'Розпочати тест →',callback_data:'s:'","text:'Відкрити тест →',callback_data:'s:'");
s=s.replace("version:'3.2-chat-admin'","version:'3.3-learning-chat'");
// Telegram controls and message continuity. Keep the original source snapshot intact.
const questionStart=s.indexOf('function buildQuestion(r,q){');
const questionEnd=s.indexOf('\nfunction wrong(',questionStart);
s=s.slice(0,questionStart)+fs.readFileSync(new URL('telegram-ux.js',root),'utf8')+s.slice(questionEnd);
s=s.replace('async function beginTest(env,user,id){','async function beginTest(env,user,id,message=null){');
s=s.replace('  let r=await getRun(env.DB,runId,user);',`  let r=await getRun(env.DB,runId,user);
  if(message){
    await env.DB.prepare('UPDATE th3_attempts SET display_message_id=? WHERE id=?').bind(message,runId).run();
    r.display_message_id=message;
  }`);
s=s.replace('await learningCallback(env,user,p[0],p[1],Number(p[2]));','await learningCallback(env,user,p[0],p[1],Number(p[2]),q.message.message_id);');
s=s.replace("await begin(env,user,p[1]);","await begin(env,user,p[1],q.message?.message_id);");
s=s.replace("    else if(p[0]==='p'){", "    else if(p[0]==='d'){\n      await deferQuestion(env,user,p[1],+p[2],p[3]);\n    }\n    else if(p[0]==='p'){");
s=s.replace('await pick(env,user,p[1],+p[2],+p[3]);','await pick(env,user,p[1],+p[2],+p[3],p[4]);');
s=s.replace('await confirm(env,user,p[1],+p[2]);','await confirm(env,user,p[1],+p[2],p[3]);');
s=s.replace('async function pick(env,user,id,pos,index){','async function pick(env,user,id,pos,index,tag){');
s=s.replace('async function confirm(env,user,id,pos){','async function confirm(env,user,id,pos,tag){');
s=s.replaceAll('  let q=await question(env.DB,r);\n  let ',"  let q=await question(env.DB,r);\n  if(tag&&q.id.slice(0,8)!==tag)throw Error('Запитання вже оновилося.');\n  let ");
s=s.replace("UPDATE th3_attempts SET selected_json=? WHERE id=? AND position=? AND selected_json=? AND status='active' AND pending_feedback=''", "UPDATE th3_attempts SET selected_json=? WHERE id=? AND position=? AND selected_json=? AND questions_json=? AND status='active' AND pending_feedback=''");
s=s.replace(').bind(JSON.stringify(next),id,pos,r.selected_json).run();',').bind(JSON.stringify(next),id,pos,r.selected_json,r.questions_json).run();');
s=s.replace("SET pending_feedback=?,corrections_used=corrections_used+1 WHERE id=? AND position=? AND status='active'", "SET pending_feedback=?,corrections_used=corrections_used+1 WHERE id=? AND position=? AND questions_json=? AND selected_json=? AND status='active'");
s=s.replace(').bind(JSON.stringify({selected}),id,pos).run();',').bind(JSON.stringify({selected}),id,pos,r.questions_json,r.selected_json).run();');
s=s.replace("'INSERT OR IGNORE INTO th3_answers(id,attempt_id,question_id,selected_json,correct,points_earned) VALUES(?,?,?,?,?,?)'", "`INSERT OR IGNORE INTO th3_answers(id,attempt_id,question_id,selected_json,correct,points_earned) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th3_attempts WHERE id=? AND position=? AND questions_json=? AND selected_json=? AND status='active' AND pending_feedback='')`");
s=s.replace(').bind(answerId,id,q.id,JSON.stringify(selected),Number(right),earned),',').bind(answerId,id,q.id,JSON.stringify(selected),Number(right),earned,id,pos,r.questions_json,r.selected_json),');
s=s.replace("       WHERE id=? AND position=? AND status='active' AND pending_feedback=''", "       WHERE id=? AND position=? AND questions_json=? AND status='active' AND pending_feedback=''");
s=s.replace(').bind(earned,id,pos,id,q.id,answerId)',').bind(earned,id,pos,r.questions_json,id,q.id,answerId)');
s=s.replace("version:'3.3-learning-chat'","version:'3.5-bulk-import'");
s=s.replace("version:'3.5-bulk-import'","version:'3.6-browser-login'");
s=s.replace("version:'3.6-browser-login'","version:'3.7-test-packages'");
const browserSource=fs.readFileSync(new URL('web-access.js',root),'utf8');
const previousAPI=s.indexOf('async function api(req,env,path){');
const sharedAPI=s.indexOf('async function adminApi(req,env,path,user){',previousAPI);
if(previousAPI<0||sharedAPI<0)throw Error('Admin API insertion point missing');
s=s.slice(0,previousAPI)+browserSource+`
async function api(req,env,path){
  if(path.startsWith('/api/web-access/'))return browserAccessApi(req,env,path);
  let user;
  if(req.headers.has('X-Telegram-Init-Data')){
    try{user=await auth(req,env);}
    catch(e){return J({error:e.message},401);}
  }else{
    if(!['GET','HEAD'].includes(req.method)&&!sameBrowserOrigin(req))return J({error:'Дія доступна лише на цьому сайті.'},403);
    user=(await resolveBrowserSession(req,env.DB))?.user_id;
    if(!user)return J({error:'Увійдіть у Центр знань.'},401);
  }
  if(!admin(env,user))return J({error:'Доступ тільки супервайзеру'},403);
  return adminApi(req,env,path,user);
}

`+s.slice(sharedAPI);
const saveRoute=s.indexOf("  if(path==='/api/test/save'&&method==='POST'){");
const writesStart=s.indexOf('    let count=Number.isInteger(b.draw_count)',saveRoute);
const writesEnd=s.indexOf('    await db.batch(cmds);',writesStart);
if(saveRoute<0||writesStart<0||writesEnd<0)throw Error('Test save insertion point missing');
const statements=s.slice(writesStart,writesEnd).replace(/^  /gm,'');
const packageSource=fs.readFileSync(new URL('test-package.js',root),'utf8');
s=s.slice(0,writesStart)+'    const cmds=testWriteStatements(db,b,testId);\n'+s.slice(writesEnd);
s=s.replace('async function adminApi(req,env,path,user){',
  'function testWriteStatements(db,b,testId){\n'+statements+'  return cmds;\n}\n\n'+packageSource+'\nasync function adminApi(req,env,path,user){');
s=s.replace("  if(path==='/api/test/save'&&method==='POST'){",
  "  if(method==='POST'&&(path==='/api/test/import/preview'||path==='/api/test/import')){\n"+
  "    return testPackageApi(req,db,path.endsWith('/preview'));\n  }\n\n"+
  "  if(path==='/api/test/save'&&method==='POST'){");
s=s.replace("version:'3.7-test-packages'","version:'3.8-operator-management'");
const operatorSource=fs.readFileSync(new URL('operator-management.js',root),'utf8');
const listStart=s.indexOf('async function list(env,user){');
const callbackStart=s.indexOf('async function callback(env,q){',listStart);
if(listStart<0||callbackStart<0)throw Error('Operator list insertion point missing');
s=s.slice(0,listStart)+operatorSource+'\n'+s.slice(callbackStart);
s=s.replace("    else if(p[0]==='l')await list(env,user);",
  "    else if(p[0]==='l')await listOperatorTests(env,user,/^\\d{1,6}$/.test(p[1]||'')?Number(p[1]):0,q.message.message_id);");
s=s.replace("    await callback(env,u.callback_query);",`    const q=u.callback_query;
    const user=String(q.from?.id||'');
    if(q.message?.chat?.type!=='private'||String(q.message.chat.id)!==user)return J({ok:true});
    if(!admin(env,user)&&await isOperatorBlocked(env.DB,user)){
      await tg(env,'answerCallbackQuery',{callback_query_id:q.id,text:blockedOperatorMessage,show_alert:true});
      return J({ok:true});
    }
    await callback(env,q);`);
s=s.replace('  await register(env.DB,m.from);\n  let user=String(m.from.id);',`  let user=String(m.from.id);
  if(!admin(env,user)&&await isOperatorBlocked(env.DB,user)){
    if(/^\\/(start|tests|admin)(?:@\\w+)?(?:\\s|$)/i.test(m.text||'')){
      await tg(env,'sendMessage',{chat_id:user,text:blockedOperatorMessage});
    }
    return J({ok:true});
  }
  await register(env.DB,m.from);`);
const welcomeStart=s.indexOf("  if(/^\\/(start|admin)(\\s|$)/.test(m.text||'')){");
const welcomeEnd=s.indexOf('  return J({ok:true});',welcomeStart);
if(welcomeStart<0||welcomeEnd<0)throw Error('Operator entry point missing');
s=s.slice(0,welcomeStart)+`  if(/^\\/(start|admin|tests)(?:@\\w+)?(?:\\s|$)/i.test(m.text||'')){
    await listOperatorTests(env,user);
  }
`+s.slice(welcomeEnd);
s=s.replace('  await ensureLearning(db);\n\n  if(path', '  await ensureLearning(db);\n  await ensureOperatorAccess(db);\n\n  if(path');
s=s.replace("SELECT id,name,username,display_name,operator_tag FROM th_users ORDER BY",
  "SELECT id,name,username,display_name,operator_tag,EXISTS(SELECT 1 FROM th_blocked_operators b WHERE b.user_id=th_users.id) blocked FROM th_users ORDER BY");
s=s.replace('      users:users.results,','      users:users.results.map(person=>({...person,admin:admin(env,person.id)})),');
s=s.replace("  if(path==='/api/operator'&&method==='POST'){",`  if(path==='/api/operator/access'&&method==='POST')return changeOperatorAccess(req,env);
  if(path==='/api/assignment/delete'&&method==='POST')return deleteAssignment(req,db);

  if(path==='/api/operator'&&method==='POST'){`);
const deleteStart=s.indexOf("  if(path==='/api/test/delete'&&method==='POST'){");
const assignStart=s.indexOf("  if(path==='/api/assign'&&method==='POST'){",deleteStart);
if(deleteStart<0||assignStart<0)throw Error('Test removal insertion point missing');
s=s.slice(0,deleteStart)+"  if(path==='/api/test/delete'&&method==='POST')return deleteLibraryTest(req,db);\n\n"+s.slice(assignStart);
s=s.replace("        await db.prepare(\n          'INSERT INTO th3_assignments(id,test_id,user_id,deadline,max_attempts,correction_limit) VALUES(?,?,?,?,?,?)'",
  `        const assignment=await db.prepare(
          \`INSERT INTO th3_assignments(id,test_id,user_id,deadline,max_attempts,correction_limit)
           SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th_tests t LEFT JOIN th3_testmeta m ON m.test_id=t.id WHERE t.id=? AND COALESCE(m.archived,0)=0)
           AND EXISTS(SELECT 1 FROM th_users WHERE id=?)
           AND NOT EXISTS(SELECT 1 FROM th_blocked_operators WHERE user_id=?)\``);
s=s.replace('          b.max_attempts,b.correction_limit\n        ).run();\n        created++;',
  '          b.max_attempts,b.correction_limit,b.test_id,userId,userId\n        ).run();\n        if(!assignment.meta.changes)continue;\n        created++;');
s=s.replace('    return J({created,notified});','    return J({created,notified,skipped:new Set(b.user_ids).size-created});');
s=s.replace('SELECT r.id,r.status,r.percent,r.passed,','SELECT r.id,r.assignment_id,r.status,r.percent,r.passed,');
s=s.replace("     AND NOT EXISTS(SELECT 1 FROM th3_attempts WHERE assignment_id=? AND status='active')",
  "     AND NOT EXISTS(SELECT 1 FROM th3_attempts WHERE assignment_id=? AND (status='active' OR passed=1))");
s=s.replace('  let r=await getRun(env.DB,runId,user);\n  if(message){',
  "  let r=await getRun(env.DB,runId,user);\n  if(!r)throw Error('Призначення вже недоступне.');\n  if(message){");
s=s.replaceAll("  if(active)return showQuestion(env,user,await getRun(env.DB,active.id,user));","  if(active)return resumeOperatorTest(env,user,active.id,message);");
s=s.replace("  let next=await getRun(env.DB,id,user);\n  if(next.position",
  "  let next=await getRun(env.DB,id,user);\n  if(!next)throw Error('Призначення вже недоступне.');\n  if(next.position");
s=s.replace("    let q=await question(env.DB,r);\n    let sel=JSON.parse",
  "    let q=await question(env.DB,r);\n    if(!q)throw Error('Призначення вже недоступне.');\n    let sel=JSON.parse");
s=s.replaceAll("  let q=await question(env.DB,r);\n  if(tag", "  let q=await question(env.DB,r);\n  if(!q)throw Error('Призначення вже недоступне.');\n  if(tag");
s=s.replace("INSERT INTO th_test_learning(test_id,enabled) VALUES(?,?) ON CONFLICT(test_id) DO UPDATE SET enabled=excluded.enabled').bind(testId,Number(learningEnabled(b)))",
  "INSERT INTO th_test_learning(test_id,enabled) SELECT ?,? WHERE EXISTS(SELECT 1 FROM th_tests WHERE id=?) ON CONFLICT(test_id) DO UPDATE SET enabled=excluded.enabled').bind(testId,Number(learningEnabled(b)),testId)");
s=s.replace("points,explanation) VALUES(?,?,?,?,?,?,?,?)').bind(questionId,testId,i,q.question,JSON.stringify(q.options),JSON.stringify(q.correct),q.points??1,String(q.explanation||'').slice(0,2000))",
  "points,explanation) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th_tests WHERE id=?)').bind(questionId,testId,i,q.question,JSON.stringify(q.options),JSON.stringify(q.correct),q.points??1,String(q.explanation||'').slice(0,2000),testId)");
s=s.replace("learning_text,source_url) VALUES(?,?,?)').bind(questionId,String(q.learning_text||'').trim(),studyURL(q.source_url||''))",
  "learning_text,source_url) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM th_questions WHERE id=?)').bind(questionId,String(q.learning_text||'').trim(),studyURL(q.source_url||''),questionId)");
s=s.replace("    await db.batch(cmds);\n    return J({ok:true,id:testId});",
  "    const [saved]=await db.batch(cmds);\n    if(!saved.meta.changes)return J({error:'Тест не знайдено'},404);\n    return J({ok:true,id:testId});");
const template=fs.readFileSync(new URL('admin.html',root),'utf8');
const parser=fs.readFileSync(new URL('bulk-import.js',root),'utf8');
if(!template.includes('/* BULK_IMPORT_PARSER */'))throw Error('Bulk parser insertion point missing');
const page=template.replace('/* BULK_IMPORT_PARSER */',()=>parser.trimEnd());
const pageStart=s.indexOf('const PAGE=');
const pageEnd=s.indexOf('export default {',pageStart);
if(pageStart<0||pageEnd<0)throw Error('Admin page insertion point missing');
s=s.slice(0,pageStart)+'const PAGE='+JSON.stringify(page)+';\n\n'+s.slice(pageEnd);
fs.writeFileSync(new URL('worker.js',root),s);
console.log('Built worker.js with study materials and independent pre-test progress');
