
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ID=()=>crypto.randomUUID();
const expired=x=>!!x&&Date.parse(x)<=Date.now();
const fmt=x=>x?new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(x)):'Без дедлайну';
const admin=(env,id)=>String(env.ADMIN_TELEGRAM_IDS||'').split(',').map(x=>x.trim()).includes(String(id));

async function mac(key,data){
  let k=await crypto.subtle.importKey('raw',typeof key==='string'?new TextEncoder().encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',k,typeof data==='string'?new TextEncoder().encode(data):data));
}

async function auth(req,env){
  let raw=req.headers.get('X-Telegram-Init-Data')||'';
  if(!raw||raw.length>12000)throw Error('Відкрий адмінку кнопкою в Telegram.');
  let p=new URLSearchParams(raw),t=+p.get('auth_date'),now=Date.now()/1000;
  if(!t||t>now+300||now-t>86400)throw Error('Сесія Telegram застаріла.');
  let str=[...p].filter(([k])=>k!=='hash').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  let key=await mac('WebAppData',env.BOT_TOKEN.trim());
  let hash=Array.from(await mac(key,str),x=>x.toString(16).padStart(2,'0')).join('');
  let target=(p.get('hash')||'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(target))throw Error('Немає підпису Telegram.');
  let d=0;
  for(let i=0;i<64;i++)d|=hash.charCodeAt(i)^target.charCodeAt(i);
  if(d)throw Error('BOT_TOKEN не відповідає Telegram Mini App.');
  let u=JSON.parse(p.get('user')||'null');
  if(!u||!Number.isSafeInteger(u.id))throw Error('Немає Telegram ID.');
  return String(u.id);
}

async function tg(env,method,body){
  let r=await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN.trim()+'/'+method,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  let v=await r.json();
  if(!r.ok||!v.ok)throw Error(v.description||'Telegram API error');
  return v.result;
}

async function register(db,u){
  await db.prepare(
    'INSERT INTO th_users(id,name,username) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username'
  ).bind(
    String(u.id),
    [u.first_name,u.last_name].filter(Boolean).join(' ')||'Оператор',
    u.username||''
  ).run();
}

async function getA(db,id,user){
  return db.prepare(
    'SELECT a.*,t.title,t.pass_percent,t.draw_count FROM th3_assignments a JOIN th_tests t ON t.id=a.test_id WHERE a.id=? AND a.user_id=?'
  ).bind(id,user).first();
}

async function getRun(db,id,user){
  return db.prepare(
    'SELECT r.*,a.deadline,a.correction_limit,a.max_attempts,t.title,t.pass_percent FROM th3_attempts r JOIN th3_assignments a ON a.id=r.assignment_id JOIN th_tests t ON t.id=a.test_id WHERE r.id=? AND r.user_id=?'
  ).bind(id,user).first();
}

async function question(db,r){
  let ids=JSON.parse(r.questions_json);
  return ids[r.position]
    ?db.prepare('SELECT * FROM th_questions WHERE id=?').bind(ids[r.position]).first()
    :null;
}

const displayTitle=s=>String(s??'').replace(/кото[\s–—-]*бліц/gi,'Перевірка знань').replace(/(^|\s)СВ(?=\s|$)/g,'$1').replace(/\s{2,}/g,' ').trim();
const startKeys=id=>[[{text:'Відкрити тест →',callback_data:'s:'+id}]];

async function display(env,user,r,text,buttons){
  let data={
    chat_id:user,
    text,
    parse_mode:'HTML',
    reply_markup:{inline_keyboard:buttons}
  };
  if(r?.display_message_id){
    try{
      await tg(env,'editMessageText',{...data,message_id:r.display_message_id});
      return;
    }catch(e){
      if(e.message.includes('message is not modified'))return;
    }
  }
  let sent=await tg(env,'sendMessage',data);
  if(r)await env.DB.prepare(
    'UPDATE th3_attempts SET display_message_id=? WHERE id=?'
  ).bind(sent.message_id,r.id).run();
}

// Compact number/checkbox controls shared by the test and the authoring wizard.
function answerRows(options,selected,prefix,suffix=''){
  const columns=options.length<=4?options.length:3;
  const buttons=options.map((text,i)=>({
    text:(i+1)+' '+(selected.includes(i)?'☑️':'◻️'),
    callback_data:prefix+i+suffix,
    ...(selected.includes(i)?{style:'success'}:{})
  }));
  const rows=[];
  for(let i=0;i<buttons.length;i+=columns)rows.push(buttons.slice(i,i+columns));
  return rows;
}
function buildQuestion(r,q){
  const options=JSON.parse(q.options_json);
  const multi=JSON.parse(q.correct_json).length>1;
  const selected=JSON.parse(r.selected_json||'[]');
  const n=JSON.parse(r.questions_json).length;
  const filled=Math.round(r.position/n*10);
  const tag=q.id?.slice(0,8)||'';
  const text='<b>ПЕРЕВІРКА ЗНАНЬ</b>\n'+E(displayTitle(r.title))+'\n\n'+
    '<b>Запитання '+(r.position+1)+' із '+n+'</b>\n'+
    '▰'.repeat(filled)+'▱'.repeat(10-filled)+'\n\n'+
    '<b>'+E(q.question)+'</b>\n\n'+
    options.map((x,i)=>'<b>'+(i+1)+'.</b> '+E(x)).join('\n\n')+
    '\n\n<i>'+(multi?'Позначте всі правильні варіанти.':'Позначте один правильний варіант.')+'</i>'+
    (selected.length?'\nОбрано: <b>'+selected.map(i=>i+1).join(', ')+'</b>':'')+
    (r.deadline?'\nЗавершити до '+E(fmt(r.deadline)):'');
  const buttons=answerRows(options,selected,'p:'+r.id+':'+r.position+':',tag?':'+tag:'');
  if(r.position+1<n)buttons.push([{text:'Відповісти пізніше',callback_data:'d:'+r.id+':'+r.position+(tag?':'+tag:'')}]);
  buttons.push([{text:r.position+1===n?'Завершити тест':'Наступне питання',callback_data:'c:'+r.id+':'+r.position+(tag?':'+tag:''),style:'primary'}]);
  buttons.push([{text:'Мої тести',callback_data:'l'}]);
  return {text,buttons};
}
async function deferQuestion(env,user,id,pos,tag){
  const r=await getRun(env.DB,id,user);
  if(!r||r.status!=='active'||r.position!==pos||r.pending_feedback)throw Error('Запитання вже оновилося. Використайте поточні кнопки.');
  if(expired(r.deadline))return finish(env,user,r,true);
  const ids=JSON.parse(r.questions_json);
  if(tag&&ids[pos]?.slice(0,8)!==tag)throw Error('Запитання вже оновилося.');
  if(pos+1>=ids.length)throw Error('Це останнє запитання. Позначте відповідь і завершіть тест.');
  const next=[...ids.slice(0,pos),...ids.slice(pos+1),ids[pos]];
  const result=await env.DB.prepare("UPDATE th3_attempts SET questions_json=?,selected_json='[]' WHERE id=? AND position=? AND questions_json=? AND selected_json=? AND status='active' AND pending_feedback=''").bind(JSON.stringify(next),id,pos,r.questions_json,r.selected_json).run();
  if(!result.meta.changes)throw Error('Вибір змінився. Натисніть «Відповісти пізніше» ще раз.');
  return showQuestion(env,user,await getRun(env.DB,id,user));
}

function wrong(q,sel){
  let opts=JSON.parse(q.options_json);
  let correct=JSON.parse(q.correct_json);
  return '<b>Варто повторити</b>\n\n'+E(q.question)+
    '\n\n<b>Ваша відповідь</b>\n'+E(sel.map(i=>opts[i]).join('; '))+
    '\n\n<b>Правильна відповідь</b>\n'+E(correct.map(i=>opts[i]).join('; '))+
    (q.explanation?'\n\n<b>Пояснення</b>\n'+E(q.explanation):'');
}

async function showQuestion(env,user,r){
  if(!r||r.status!=='active')return;
  if(expired(r.deadline))return finish(env,user,r,true);
  if(r.pending_feedback){
    let q=await question(env.DB,r);
    if(!q)throw Error('Призначення вже недоступне.');
    let sel=JSON.parse(r.pending_feedback).selected;
    return display(env,user,r,wrong(q,sel),[[
      {text:'Спробувати ще раз ↻',callback_data:'r:'+r.id+':'+r.position}
    ]]);
  }
  let q=await question(env.DB,r);
  if(q){
    let v=buildQuestion(r,q);
    await display(env,user,r,v.text,v.buttons);
  }
}

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
  if(active)return resumeOperatorTest(env,user,active.id,message);
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

async function beginTest(env,user,id,message=null){
  let a=await getA(env.DB,id,user);
  if(!a)throw Error('Тест не призначено.');
  if(expired(a.deadline))throw Error('Дедлайн минув.');

  let active=await env.DB.prepare(
    "SELECT id FROM th3_attempts WHERE assignment_id=? AND status='active'"
  ).bind(id).first();
  if(active)return resumeOperatorTest(env,user,active.id,message);

  let pool=(await env.DB.prepare(
    'SELECT id,points FROM th_questions WHERE test_id=? ORDER BY position'
  ).bind(a.test_id).all()).results;

  if(!pool.length)throw Error('Тест без питань.');
  for(let i=pool.length-1;i>0;i--){
    let j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  let picked=pool.slice(0,a.draw_count>0?Math.min(a.draw_count,pool.length):pool.length);
  let runId=ID();

  let created=await env.DB.prepare(
    `INSERT INTO th3_attempts(id,assignment_id,user_id,questions_json,max_score)
     SELECT ?,?,?,?,?
     WHERE (SELECT COUNT(*) FROM th3_attempts WHERE assignment_id=?)<?
     AND NOT EXISTS(SELECT 1 FROM th3_attempts WHERE assignment_id=? AND (status='active' OR passed=1))
     AND EXISTS(SELECT 1 FROM th3_assignments WHERE id=?
     AND (deadline IS NULL OR julianday(deadline)>julianday('now')))`
  ).bind(
    runId,id,user,
    JSON.stringify(picked.map(x=>x.id)),
    picked.reduce((s,x)=>s+x.points,0),
    id,a.max_attempts,id,id
  ).run();

  if(!created.meta.changes)throw Error('Ліміт спроб вичерпано.');
  let r=await getRun(env.DB,runId,user);
  if(!r)throw Error('Призначення вже недоступне.');
  if(message){
    await env.DB.prepare('UPDATE th3_attempts SET display_message_id=? WHERE id=?').bind(message,runId).run();
    r.display_message_id=message;
  }
  await display(env,user,r,
    '<b>ПЕРЕВІРКА ЗНАНЬ</b>\n'+E(displayTitle(a.title))+'\n\n'+
    'Запитань: <b>'+picked.length+'</b>\n'+
    'Прохідний результат: <b>'+a.pass_percent+'%</b>\n'+
    'Завершити до: <b>'+E(fmt(a.deadline))+'</b>\n\n'+
    'Читайте запитання уважно. Відповідь зберігається після підтвердження.',
    [[{text:'Перейти до запитань →',callback_data:'g:'+runId}]]
  );
}

async function pick(env,user,id,pos,index,tag){
  let r=await getRun(env.DB,id,user);
  if(!r||r.status!=='active'||r.position!==pos||
     r.pending_feedback||expired(r.deadline)){
    throw Error('Питання недоступне.');
  }
  let q=await question(env.DB,r);
  if(!q)throw Error('Призначення вже недоступне.');
  if(tag&&q.id.slice(0,8)!==tag)throw Error('Запитання вже оновилося.');
  let opts=JSON.parse(q.options_json);
  let multi=JSON.parse(q.correct_json).length>1;
  if(!Number.isInteger(index)||index<0||index>=opts.length){
    throw Error('Некоректний варіант.');
  }
  let old=JSON.parse(r.selected_json);
  let next=multi
    ?(old.includes(index)?old.filter(n=>n!==index):[...old,index].sort((a,b)=>a-b))
    :[index];
  let saved=await env.DB.prepare(
    "UPDATE th3_attempts SET selected_json=? WHERE id=? AND position=? AND selected_json=? AND questions_json=? AND status='active' AND pending_feedback=''"
  ).bind(JSON.stringify(next),id,pos,r.selected_json,r.questions_json).run();
  if(saved.meta.changes){
    await showQuestion(env,user,await getRun(env.DB,id,user));
  }
}

async function confirm(env,user,id,pos,tag){
  let r=await getRun(env.DB,id,user);
  if(!r||r.status!=='active'||r.position!==pos||r.pending_feedback){
    throw Error('Відповідь уже опрацьовано.');
  }
  if(expired(r.deadline))return finish(env,user,r,true);
  let q=await question(env.DB,r);
  if(!q)throw Error('Призначення вже недоступне.');
  if(tag&&q.id.slice(0,8)!==tag)throw Error('Запитання вже оновилося.');
  let selected=JSON.parse(r.selected_json);
  let correct=JSON.parse(q.correct_json);
  if(!selected.length)throw Error('Спочатку вибери відповідь.');

  let right=JSON.stringify([...selected].sort())===
    JSON.stringify([...correct].sort());

  if(!right&&r.corrections_used<r.correction_limit){
    let changed=await env.DB.prepare(
      "UPDATE th3_attempts SET pending_feedback=?,corrections_used=corrections_used+1 WHERE id=? AND position=? AND questions_json=? AND selected_json=? AND status='active' AND pending_feedback=''"
    ).bind(JSON.stringify({selected}),id,pos,r.questions_json,r.selected_json).run();
    if(changed.meta.changes){
      await showQuestion(env,user,await getRun(env.DB,id,user));
    }
    return;
  }

  let earned=right?q.points:0;
  let answerId=ID();

  // D1 batch записує відповідь та оновлює позицію разом.
  let run=await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO th3_answers(id,attempt_id,question_id,selected_json,correct,points_earned) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th3_attempts WHERE id=? AND position=? AND questions_json=? AND selected_json=? AND status='active' AND pending_feedback='')`
    ).bind(answerId,id,q.id,JSON.stringify(selected),Number(right),earned,id,pos,r.questions_json,r.selected_json),
    env.DB.prepare(
      `UPDATE th3_attempts
       SET position=position+1,score=score+?,selected_json='[]'
       WHERE id=? AND position=? AND questions_json=? AND status='active' AND pending_feedback=''
       AND EXISTS(SELECT 1 FROM th3_answers
         WHERE attempt_id=? AND question_id=? AND id=?)
       AND EXISTS(SELECT 1 FROM th3_assignments a
         WHERE a.id=th3_attempts.assignment_id
         AND (a.deadline IS NULL OR julianday(a.deadline)>julianday('now')))`
    ).bind(earned,id,pos,r.questions_json,id,q.id,answerId)
  ]);

  if(!run[1].meta.changes){
    throw Error('Відповідь уже збережено або дедлайн минув.');
  }

  let next=await getRun(env.DB,id,user);
  if(!next)throw Error('Призначення вже недоступне.');
  if(next.position>=JSON.parse(next.questions_json).length){
    return finish(env,user,next,false);
  }
  if(!right){
    return display(env,user,next,wrong(q,selected),[[
      {text:'Наступне запитання →',callback_data:'g:'+id}
    ]]);
  }
  return showQuestion(env,user,next);
}

async function finish(env,user,r,timeout){
  let n=JSON.parse(r.questions_json).length;
  let percent=r.max_score?Math.round(r.score*100/r.max_score):0;
  let passed=!timeout&&r.position>=n&&percent>=r.pass_percent;
  let save=await env.DB.prepare(
    "UPDATE th3_attempts SET status='finished',percent=?,passed=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'"
  ).bind(percent,Number(passed),r.id).run();
  if(!save.meta.changes)return;

  let answers=(await env.DB.prepare(
    `SELECT an.*,q.question,q.options_json,q.correct_json
     FROM th3_answers an
     JOIN th_questions q ON q.id=an.question_id
     WHERE an.attempt_id=? ORDER BY q.position`
  ).bind(r.id).all()).results;

  let text='<b>'+(passed?'ТЕСТ СКЛАДЕНО':'ТЕСТ ЗАВЕРШЕНО')+'</b>\n'+E(displayTitle(r.title))+'\n\n'+
    '<b>'+percent+'%</b> — ваш результат\n\n'+
    'Набрано балів: <b>'+r.score+' із '+r.max_score+'</b>\n'+
    'Правильних відповідей: <b>'+answers.filter(x=>x.correct).length+' із '+n+'</b>\n'+
    'Прохідний результат: <b>'+r.pass_percent+'%</b>\n\n'+
    (passed?'Вітаємо! Ви успішно пройшли перевірку знань.':'Перегляньте відповіді нижче, щоб закріпити матеріал.')+
    (timeout?'\nТермін завершення тесту минув.':'');

  for(let a of answers.filter(x=>!x.correct)){
    let opts=JSON.parse(a.options_json);
    let fragment='\n\n<b>Варто повторити</b>\n'+E(a.question)+
      '\nОбрано: '+E(JSON.parse(a.selected_json).map(i=>opts[i]).join(', '))+
      '\nПравильно: '+E(JSON.parse(a.correct_json).map(i=>opts[i]).join(', '));
    if(text.length+fragment.length>3700)break;
    text+=fragment;
  }
  await display(env,user,r,text,[[
    {text:'Мої тести →',callback_data:'l'}
  ]]);
}

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

async function callback(env,q){
  let user=String(q.from.id);
  let p=(q.data||'').split(':');
  try{
    if(['ln','lr','lt'].includes(p[0])){
      if(q.message?.chat?.type!=='private'||String(q.message.chat.id)!==user)throw Error('Відкрийте тест у приватному чаті.');
      await learningCallback(env,user,p[0],p[1],Number(p[2]),q.message.message_id);
    }
    else if(p[0]==='s')await begin(env,user,p[1],q.message?.message_id);
    else if(p[0]==='g'){
      let r=await getRun(env.DB,p[1],user);
      if(r?.status==='active')await showQuestion(env,user,r);
    }
    else if(p[0]==='d'){
      await deferQuestion(env,user,p[1],+p[2],p[3]);
    }
    else if(p[0]==='p'){
      await pick(env,user,p[1],+p[2],+p[3],p[4]);
    }
    else if(p[0]==='c'){
      await confirm(env,user,p[1],+p[2],p[3]);
    }
    else if(p[0]==='r'){
      let r=await getRun(env.DB,p[1],user);
      if(!r||r.status!=='active'||r.position!==+p[2]||
         !r.pending_feedback||expired(r.deadline)){
        throw Error('Виправлення недоступне.');
      }
      let save=await env.DB.prepare(
        "UPDATE th3_attempts SET selected_json='[]',pending_feedback='' WHERE id=? AND position=? AND pending_feedback<>'' AND status='active'"
      ).bind(r.id,r.position).run();
      if(save.meta.changes){
        await showQuestion(env,user,await getRun(env.DB,r.id,user));
      }
    }
    else if(p[0]==='l')await listOperatorTests(env,user,/^\d{1,6}$/.test(p[1]||'')?Number(p[1]):0,q.message.message_id);

    await tg(env,'answerCallbackQuery',{callback_query_id:q.id});
  }catch(e){
    try{
      await tg(env,'answerCallbackQuery',{
        callback_query_id:q.id,
        text:String(e.message).slice(0,180),
        show_alert:true
      });
    }catch{}
  }
}

// Bundled into worker.js before webhook(). All entry points verify the administrator.
const CHAT_TABLE_SQL=`CREATE TABLE IF NOT EXISTS th_admin_chat (
  user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL DEFAULT 'null',
  last_update_id INTEGER NOT NULL DEFAULT -1, lock_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const chatButton=(text,data)=>({text,callback_data:'a:'+data});
const chatBack=()=>[chatButton('← Меню','menu')];
const userName=u=>u.display_name||u.name||'Учасник';
const userMeta=u=>[u.username?'@'+u.username:'',u.operator_tag||''].filter(Boolean).join(' · ');
const userLine=u=>'<b>'+E(userName(u))+'</b>'+(userMeta(u)?' · '+E(userMeta(u)):'');
const clip=(s,n=55)=>String(s).length>n?String(s).slice(0,n-1)+'…':String(s);
const chatToken=()=>ID().replaceAll('-','').slice(0,10);

async function chatApi(env,user,path,body){
  if(!admin(env,user))throw Error('Доступ тільки супервайзеру.');
  const r=await adminApi(new Request('https://test-hub.internal'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,path.split('?')[0],user);
  const d=await r.json();
  if(!r.ok)throw Error(d.error||'Не вдалося виконати дію.');
  return d;
}

async function chatSaveTag(env,user,id,tag){
  if(!admin(env,user))throw Error('Доступ тільки супервайзеру.');
  if(!/^\d+$/.test(id)||typeof tag!=='string'||tag.length>80)throw Error('Перевірте позначку учасника.');
  const result=await env.DB.prepare('UPDATE th_users SET operator_tag=? WHERE id=?').bind(tag.trim(),id).run();
  if(!result.meta.changes)throw Error('Учасника не знайдено.');
}

async function chatState(env,user,state){
  if(state)state.token=chatToken();
  await env.DB.prepare('UPDATE th_admin_chat SET state_json=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').bind(JSON.stringify(state),user).run();
  return state;
}

async function chatSay(env,user,text,keys=[],message=null){
  const data={chat_id:user,text,parse_mode:'HTML',reply_markup:{inline_keyboard:keys}};
  if(message){
    try{return await tg(env,'editMessageText',{...data,message_id:message});}
    catch(e){if(e.message.includes('message is not modified'))return;}
  }
  return tg(env,'sendMessage',data);
}

async function chatMenu(env,user,origin,state,message){
  return chatSay(env,user,'<b>ЦЕНТР ЗНАНЬ · КЕРУВАННЯ</b>\n\nСтворюйте тести, призначайте їх команді та переглядайте результати прямо тут.'+(state?'\n\nУ вас є незавершена дія. Її можна продовжити або скасувати командою /cancel.':''),[
    ...(state?[[chatButton('Продовжити незавершену дію','resume')]]:[]),
    [chatButton('+ Створити тест','new'),chatButton('Імпорт JSON','import')],
    [chatButton('Бібліотека тестів','lib:0'),chatButton('Призначити тест','choose:0')],
    [chatButton('Команда та теги','team:0'),chatButton('Результати','results:0')],
    [{text:'Відкрити вебпанель ↗',web_app:{url:origin}}]
  ],message);
}

function wizardButton(state,text,action){return chatButton(text,'w:'+state.token+':'+action);}
function parseCorrect(text,count){
  const parts=text.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if(!parts.length)throw Error('Вкажіть правильні варіанти: наприклад, A C або 1 3.');
  const values=parts.map(x=>/^[A-F]$/.test(x)?x.charCodeAt(0)-65:/^[1-6]$/.test(x)?Number(x)-1:-1);
  if(values.some(x=>x<0||x>=count)||new Set(values).size!==values.length)throw Error('Вкажіть наявні варіанти без повторів: A C або 1 3.');
  return values.sort((a,b)=>a-b);
}
function parseKyivDeadline(text){
  const m=/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(text.trim());
  if(!m)throw Error('Формат дати: ДД.ММ.РРРР ГГ:ХХ, наприклад 29.10.2026 18:00. Час — Київ.');
  const [day,month,year,hour,minute]=m.slice(1).map(Number);
  const desired=Date.UTC(year,month-1,day,hour,minute);
  const same=new Date(desired);
  if(same.getUTCFullYear()!==year||same.getUTCMonth()!==month-1||same.getUTCDate()!==day||hour>23||minute>59)throw Error('Перевірте дату та час.');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const match=stamp=>{const p=Object.fromEntries(parts.formatToParts(new Date(stamp)).map(x=>[x.type,x.value]));return +p.year===year&&+p.month===month&&+p.day===day&&+p.hour===hour&&+p.minute===minute;};
  const options=[desired-2*3600000,desired-3*3600000].filter(match);
  if(options.length!==1)throw Error('Цей час припадає на переведення годинника. Оберіть інший час.');
  if(options[0]<=Date.now())throw Error('Дедлайн має бути в майбутньому.');
  return new Date(options[0]).toISOString();
}

async function chatPrompt(env,user,s,message){
  const buttons=[];
  let text='';
  if(s.kind==='test'){
    const number=s.editIndex===undefined?s.draft.questions.length+1:s.editIndex+1;
    const labels={
      title:'<b>Новий тест · Назва</b>\n\nНадішліть назву тесту (3–180 символів).',
      description:'<b>Опис тесту</b>\n\nКороткий вступ: що перевіряємо й навіщо. Наприклад: «Стандарти комунікації з клієнтами». Матеріали з Confluence додаються окремо до кожного питання.\n\nНадішліть вступ або натисніть «Без опису».',
      pass:'<b>Прохідний результат</b>\n\nНадішліть ціле число від 0 до 100.',
      question:'<b>Запитання '+number+'</b>\n\nНадішліть текст запитання (до 2000 символів).',
      options:'<b>Варіанти відповідей</b>\n\nНадішліть від 2 до 6 варіантів одним повідомленням — кожен із нового рядка, без нумерації. До 120 символів на варіант.',
      correct:'<b>Правильні відповіді</b>\n\n'+(s.question?.options||[]).map((x,i)=>'<b>'+(i+1)+'.</b> '+E(x)).join('\n\n')+'\n\nПозначте правильні варіанти кнопками нижче та натисніть «Готово».',
      points:'<b>Бали за запитання</b>\n\nНадішліть ціле число від 1 до 100 або залиште 1 бал.',
      learning:'<b>Матеріал перед тестом</b>\n\nНадішліть пояснення правила, приклад або виклад із Confluence (до 3000 символів). Оператор побачить його під час підготовки, перед початком тесту.',
      source:'<b>Посилання для повторення</b>\n\nНадішліть повне HTTPS-посилання на сторінку Confluence або інше джерело. Можна пропустити.',
      explanation:'<b>Пояснення після відповіді</b>\n\nНадішліть пояснення (до 2000 символів) або пропустіть цей крок.'
    };
    text=labels[s.step]||'';
    if(s.step==='description')buttons.push([wizardButton(s,'Без опису','skip')]);
    if(s.step==='pass')buttons.push([wizardButton(s,'80%','default')]);
    if(s.step==='correct'){
      buttons.push(...answerRows(s.question.options,s.question.correct,'a:w:'+s.token+':correctPick:'));
      buttons.push([{...wizardButton(s,'Готово →','correctDone'),style:'primary'}]);
    }
    if(s.step==='points')buttons.push([wizardButton(s,'1 бал','default')]);
    if(s.step==='explanation')buttons.push([wizardButton(s,'Без пояснення','skip')]);
    if(s.step==='source')buttons.push([wizardButton(s,'Без посилання','skip')]);
    if(s.step==='review'){
      text='<b>ЧЕРНЕТКА ТЕСТУ</b>\n\n<b>'+E(s.draft.title)+'</b>\n'+(s.draft.description?E(s.draft.description)+'\n':'')+'\nЗапитань: <b>'+s.draft.questions.length+'</b>\nПрохідний результат: <b>'+s.draft.pass_percent+'%</b>\nВипадкових запитань: <b>'+(s.draft.draw_count||'усі')+'</b>\n\nПеревірте запитання перед збереженням. Чернетка ще не доступна для призначення.';
      text=text.replace('\n\nПеревірте','\nПідготовка: '+(s.draft.learning_enabled?'увімкнена':'вимкнена')+'\nМатеріалів: '+s.draft.questions.filter(q=>q.learning_text?.trim()).length+' із '+s.draft.questions.length+'\n\nПеревірте');
      if(s.draft.questions.length<100)buttons.push([wizardButton(s,'+ Запитання','add')]);
      if(s.draft.questions.length)buttons.push([wizardButton(s,'Переглянути запитання','questions:0'),wizardButton(s,'Зберегти тест','save')]);
      buttons.push([wizardButton(s,'Змінити назву','title'),wizardButton(s,'Прохідний %','pass')]);
      buttons.push([wizardButton(s,'Змінити опис','description'),wizardButton(s,'Випадкові питання','draw')]);
      buttons.push([wizardButton(s,s.draft.learning_enabled?'✓ Підготовка ввімкнена':'Увімкнути підготовку','learning')]);
      if(s.draft.questions.length)buttons.push([wizardButton(s,'Прибрати останнє питання','remove')]);
    }
    if(s.step==='draw')text='<b>Випадкові запитання</b>\n\nНадішліть кількість від 0 до '+s.draft.questions.length+'. 0 — усі запитання.';
  }else if(s.kind==='import'){
    text='<b>ІМПОРТ ТЕСТУ</b>\n\nНадішліть JSON текстом (можна кількома повідомленнями). Після останньої частини натисніть «Перевірити JSON».\n\n<pre>{"title":"Стандарти сервісу","pass_percent":80,"questions":[{"question":"Текст питання?","options":["Так","Ні"],"correct":[0],"points":1}]}</pre>\n\nУ correct нумерація починається з 0. Завантаження JSON-файлів через вкладення поки не підтримується.\n\nОтримано символів: '+(s.text||'').length;
    buttons.push([wizardButton(s,'Перевірити JSON','parse')]);
  }else if(s.kind==='archive'){
    text='<b>'+E(displayTitle(s.title))+'</b>\n\n'+(s.archived?'Архівувати тест? Історія збережеться.':'Відновити тест для нових призначень?');
    buttons.push([wizardButton(s,'Підтвердити','archive')]);
  }else if(s.kind==='tag'){
    text='<b>Позначка учасника</b>\n\n'+userLine(s.person)+'\n\nНадішліть нову позначку / зміну (до 80 символів). Telegram @username відображається окремо та оновлюється при зверненні учасника до бота.';
    buttons.push([wizardButton(s,'Очистити позначку','clear')]);
  }else if(s.kind==='assign'){
    if(s.step==='people')return chatPeople(env,user,s,message);
    const labels={deadline:'<b>Дедлайн · Київ</b>\n\nНадішліть дату у форматі <code>29.10.2026 18:00</code> або оберіть «Без дедлайну».',tries:'<b>Кількість спроб</b>\n\nНадішліть ціле число від 1 до 10.',corrections:'<b>Виправлення у спробі</b>\n\nНадішліть ціле число від 0 до 10.'};
    text=labels[s.step]||'';
    if(s.step==='deadline')buttons.push([wizardButton(s,'Без дедлайну','skip')]);
    if(s.step==='tries')buttons.push([wizardButton(s,'1 спроба','default')]);
    if(s.step==='corrections')buttons.push([wizardButton(s,'Без виправлень','default')]);
    if(s.step==='review'){
      const data=await chatApi(env,user,'/api/data');
      const selected=data.users.filter(x=>s.user_ids.includes(x.id));
      text='<b>ПЕРЕВІРТЕ ПРИЗНАЧЕННЯ</b>\n\n<b>'+E(displayTitle(s.title))+'</b>\nУчасників: '+s.user_ids.length+'\nДедлайн: '+E(fmt(s.deadline))+'\nСпроб: '+s.max_attempts+' · виправлень: '+s.correction_limit+'\nСповіщення: '+(s.notify?'так':'ні')+'\n\n'+selected.slice(0,8).map(userLine).join('\n')+(selected.length>8?'\n… та ще '+(selected.length-8):'')+'\n\nПризначення та сповіщення будуть створені тільки після підтвердження.';
      buttons.push([wizardButton(s,s.notify?'✓ Сповіщення увімкнені':'Сповіщення вимкнені','notify')]);
      buttons.push([wizardButton(s,'Змінити учасників','people'),wizardButton(s,'Підтвердити призначення','send')]);
    }
  }
  return chatSay(env,user,text+'\n\n/cancel — скасувати дію.',[...buttons,chatBack()],message);
}

async function chatLibrary(env,user,page,choose,message){
  const data=await chatApi(env,user,'/api/data');
  const tests=data.tests.filter(x=>!choose||!x.archived);
  page=Math.min(Math.max(0,page||0),Math.max(0,Math.ceil(tests.length/8)-1));
  const rows=tests.slice(page*8,page*8+8);
  const keys=rows.map(t=>[chatButton(clip((t.archived?'[Архів] ':'')+displayTitle(t.title)),(choose?'select:':'test:')+t.id)]);
  if(page||tests.length>(page+1)*8)keys.push([...(page?[chatButton('← Назад',(choose?'choose:':'lib:')+(page-1))]:[]),...(tests.length>(page+1)*8?[chatButton('Далі →',(choose?'choose:':'lib:')+(page+1))]:[])]);
  keys.push(chatBack());
  return chatSay(env,user,'<b>'+(choose?'ОБЕРІТЬ ТЕСТ ДЛЯ ПРИЗНАЧЕННЯ':'БІБЛІОТЕКА ТЕСТІВ')+'</b>\n\n'+(rows.length?'Тестів: '+tests.length+' · сторінка '+(page+1)+'\nОберіть тест нижче.':'Поки немає тестів. Створіть перший через /newtest.'),keys,message);
}
async function chatTest(env,user,id,message){
  const {tests}=await chatApi(env,user,'/api/data');const t=tests.find(x=>x.id===id);
  if(!t)throw Error('Тест не знайдено.');
  return chatSay(env,user,'<b>'+E(displayTitle(t.title))+'</b>\n\n'+E(t.description||'')+'\nЗапитань: '+t.question_count+' · прохідний: '+t.pass_percent+'%\nПризначень: '+t.assigned+'\nПідготовка: '+(t.learning_enabled?'увімкнена':'вимкнена')+'\nСтатус: '+(t.archived?'Архів':'Активний'),[
    ...(!t.archived?[[chatButton('Призначити команді','select:'+id)]]:[]),
    [chatButton('Переглянути запитання','view:'+id+':0')],
    [chatButton(t.assigned?'Створити копію для редагування':'Редагувати','edit:'+id)],
    [chatButton(t.archived?'Відновити з архіву':'Архівувати','archive:'+id)],
    [chatButton('← Бібліотека','lib:0')]
  ],message);
}
async function chatTeam(env,user,page,message){
  const {users}=await chatApi(env,user,'/api/data');
  page=Math.min(Math.max(0,page||0),Math.max(0,Math.ceil(users.length/8)-1));
  const rows=users.slice(page*8,page*8+8);
  const keys=rows.map(x=>[chatButton(clip('Позначка · '+userName(x)+(x.username?' @'+x.username:'')),'tag:'+x.id)]);
  if(page||users.length>(page+1)*8)keys.push([...(page?[chatButton('← Назад','team:'+(page-1))]:[]),...(users.length>(page+1)*8?[chatButton('Далі →','team:'+(page+1))]:[])]);
  keys.push(chatBack());
  return chatSay(env,user,'<b>КОМАНДА ТА ТЕГИ</b>\n\n'+(rows.length?rows.map(x=>userLine(x)+'\nID: <code>'+E(x.id)+'</code>').join('\n\n'):'Учасники з’являться після першого звернення до бота.')+'\n\nОберіть учасника, щоб змінити робочу позначку.',keys,message);
}
async function chatPeople(env,user,s,message){
  const {users:team}=await chatApi(env,user,'/api/data');
  const users=team.filter(person=>!person.blocked);
  const page=Math.min(Math.max(0,s.page||0),Math.max(0,Math.ceil(users.length/8)-1));
  const rows=users.slice(page*8,page*8+8);
  const keys=rows.map(x=>[wizardButton(s,(s.user_ids.includes(x.id)?'✓ ':'○ ')+clip(userName(x)+(x.username?' @'+x.username:'')+(x.operator_tag?' · '+x.operator_tag:''),50),'pick:'+x.id)]);
  if(page||users.length>(page+1)*8)keys.push([...(page?[wizardButton(s,'← Назад','page:'+(page-1))]:[]),...(users.length>(page+1)*8?[wizardButton(s,'Далі →','page:'+(page+1))]:[])]);
  keys.push([wizardButton(s,'Усі (до 100)','all'),wizardButton(s,'Очистити вибір','none')]);
  if(s.user_ids.length)keys.push([wizardButton(s,'Продовжити · '+s.user_ids.length,'next')]);
  keys.push(chatBack());
  return chatSay(env,user,'<b>ОБЕРІТЬ УЧАСНИКІВ</b>\n\n'+E(displayTitle(s.title))+'\nОбрано: '+s.user_ids.length+'\n\n'+rows.map(userLine).join('\n')+'\n\nНатискайте кнопки, щоб додати або прибрати учасника.',keys,message);
}
async function chatResults(env,user,page,message){
  const {items}=await chatApi(env,user,'/api/results');
  page=Math.min(Math.max(0,page||0),Math.max(0,Math.ceil(items.length/6)-1));
  const rows=items.slice(page*6,page*6+6);
  const keys=rows.map((x,i)=>[chatButton('Відповіді · '+(page*6+i+1)+' · '+clip(userName(x),30),'answer:'+x.id)]);
  if(page||items.length>(page+1)*6)keys.push([...(page?[chatButton('← Назад','results:'+(page-1))]:[]),...(items.length>(page+1)*6?[chatButton('Далі →','results:'+(page+1))]:[])]);
  keys.push(chatBack());
  return chatSay(env,user,'<b>РЕЗУЛЬТАТИ КОМАНДИ</b>\n\n'+(rows.length?rows.map((x,i)=>(page*6+i+1)+'. '+userLine(x)+'\n'+E(displayTitle(x.title))+'\n'+(x.status==='active'?'У процесі':x.passed?'Складено':'Не складено')+' · '+(x.percent===null?'—':x.percent+'%')+'\nБали: '+x.score+'/'+x.max_score).join('\n\n'):'Завершених або активних спроб поки немає.'),keys,message);
}
async function chatQuestions(env,user,questions,title,index,back,message,answers=false){
  index=Math.max(0,Math.min(Number(index)||0,questions.length-1));
  const q=questions[index];if(!q)throw Error('Немає запитань.');
  const options=answers?[]:q.options;
  const text='<b>'+E(clip(answers?title:displayTitle(title),180))+'</b>\n\nЗапитання '+(index+1)+' із '+questions.length+'\n\n<b>'+E(q.question)+'</b>\n\n'+(answers?'<b>Обрано</b>\n'+E(q.selected.join('; '))+'\n\n<b>Правильно</b>\n'+E(q.correct.join('; '))+'\n\n'+(q.right?'Правильна відповідь':'Варто повторити'):options.map((x,i)=>(q.correct.includes(i)?'✓ ':'')+(i+1)+'. '+E(x)).join('\n')+'\n\nБали: '+(q.points??1)+(q.explanation?'\n\n'+E(clip(q.explanation,200)):''));
  const material=!answers&&q.learning_text?'\n\n<b>Матеріал перед тестом</b>\n'+E(clip(q.learning_text,200))+(q.source_url?'\n'+E(clip(q.source_url,100)):''):'';
  const nav=[];
  if(index)nav.push(chatButton('← Попереднє',back.prefix+(index-1)));
  if(index<questions.length-1)nav.push(chatButton('Наступне →',back.prefix+(index+1)));
  return chatSay(env,user,text+material,[...(nav.length?[nav]:[]),...(back.editPrefix?[[chatButton('Редагувати це запитання',back.editPrefix+index)]]:[]),[chatButton('← Назад',back.exit)]],message);
}

async function chatWizardInput(env,user,s,text){
  if(s.kind==='import'){
    s.text=(s.text||'')+text;
    if(s.text.length>500000)throw Error('JSON завеликий. Скасуйте імпорт через /cancel і скористайтеся вебпанеллю.');
  }else if(s.kind==='tag'){
    if(text.length>80)throw Error('Позначка має містити до 80 символів.');
    await chatSaveTag(env,user,s.person.id,text);
    await chatState(env,user,null);
    return chatSay(env,user,'Позначку збережено.\n\n'+userLine({...s.person,operator_tag:text}),[[chatButton('Команда та теги','team:0')],chatBack()]);
  }else if(s.kind==='test'){
    const d=s.draft;
    if(s.step==='title'){
      if(text.length<3||text.length>180)throw Error('Назва має містити від 3 до 180 символів.');
      d.title=displayTitle(text);if(d.title.length<3)throw Error('Вкажіть змістовну назву тесту.');s.step=s.returnReview?'review':'description';delete s.returnReview;
    }else if(s.step==='description'){
      if(text.length>1000)throw Error('Опис має містити до 1000 символів.');d.description=text;s.step=s.returnReview?'review':'pass';delete s.returnReview;
    }else if(s.step==='pass'){
      if(!/^\d{1,3}$/.test(text)||Number(text)>100)throw Error('Надішліть ціле число від 0 до 100.');d.pass_percent=Number(text);s.step=s.returnReview?'review':'question';delete s.returnReview;
    }else if(s.step==='draw'){
      if(!/^\d{1,3}$/.test(text)||Number(text)>d.questions.length)throw Error('Вкажіть число від 0 до '+d.questions.length+'.');d.draw_count=Number(text);s.step='review';
    }else if(s.step==='question'){
      if(text.length>2000)throw Error('Запитання має містити до 2000 символів.');s.question={question:text,options:[],correct:[],points:1,explanation:''};s.step='options';
    }else if(s.step==='options'){
      const options=text.split('\n').map(x=>x.trim()).filter(Boolean);
      if(options.length<2||options.length>6||options.some(x=>x.length>120))throw Error('Потрібно від 2 до 6 рядків, до 120 символів кожен.');s.question.options=options;s.step='correct';
    }else if(s.step==='correct'){
      s.question.correct=parseCorrect(text,s.question.options.length);s.step='points';
    }else if(s.step==='points'){
      if(!/^\d{1,3}$/.test(text)||Number(text)<1||Number(text)>100)throw Error('Надішліть ціле число від 1 до 100.');s.question.points=Number(text);s.step='explanation';
    }else if(s.step==='explanation'){
      if(text.length>2000)throw Error('Пояснення має містити до 2000 символів.');s.question.explanation=text;if(d.learning_enabled)s.step='learning';else completeDraftQuestion(s);
    }else if(s.step==='learning'){
      if(text.length>3000)throw Error('Матеріал має містити до 3000 символів.');s.question.learning_text=text;s.step='source';
    }else if(s.step==='source'){s.question.source_url=studyURL(text);completeDraftQuestion(s);
    }else throw Error('Оберіть дію кнопкою під чернеткою або відкрийте /admin.');
  }else if(s.kind==='assign'){
    if(s.step==='deadline'){s.deadline=parseKyivDeadline(text);s.step='tries';}
    else if(s.step==='tries'){if(!/^\d{1,2}$/.test(text)||Number(text)<1||Number(text)>10)throw Error('Кількість спроб — від 1 до 10.');s.max_attempts=Number(text);s.step='corrections';}
    else if(s.step==='corrections'){if(!/^\d{1,2}$/.test(text)||Number(text)>10)throw Error('Кількість виправлень — від 0 до 10.');s.correction_limit=Number(text);s.step='review';}
    else throw Error('Оберіть дію кнопками під призначенням.');
  }
  await chatState(env,user,s);return chatPrompt(env,user,s);
}

async function chatWizardAction(env,user,s,action,args,message){
  if(s.kind==='test'){
    if(s.step==='correct'&&action==='correctPick'){
      const index=Number(args[0]);if(!Number.isInteger(index)||index<0||index>=s.question.options.length)throw Error('Варіант недоступний.');
      const chosen=new Set(s.question.correct);chosen.has(index)?chosen.delete(index):chosen.add(index);s.question.correct=[...chosen].sort((a,b)=>a-b);
      await chatState(env,user,s);return chatPrompt(env,user,s,message);
    }
    if(s.step==='correct'&&action==='correctDone'){
      if(!s.question.correct.length)throw Error('Позначте хоча б одну правильну відповідь.');
      s.step='points';await chatState(env,user,s);return chatPrompt(env,user,s,message);
    }
    if(action==='questions'&&s.step==='review')return chatQuestions(env,user,s.draft.questions,s.draft.title,args[0],{prefix:'w:'+s.token+':questions:',exit:'resume',editPrefix:'w:'+s.token+':qedit:'},message);
    if(action==='qedit'&&s.step==='review'){
      const index=Number(args[0]);if(!Number.isInteger(index)||!s.draft.questions[index])throw Error('Запитання не знайдено.');
      s.editIndex=index;s.step='question';await chatState(env,user,s);return chatPrompt(env,user,s,message);
    }
    if(action==='save'&&s.step==='review'){
      if(!validTest(s.draft))throw Error('Перевірте назву, запитання й правильні відповіді.');
      validateLearning(s.draft);
      const result=await chatApi(env,user,'/api/test/save',s.draft);
      await chatState(env,user,null);
      return chatSay(env,user,'<b>Тест збережено</b>\n\n'+E(s.draft.title)+'\nЗапитань: '+s.draft.questions.length+'\n\nТест також доступний у вебпанелі.',[[chatButton('Призначити команді','select:'+result.id)],[chatButton('Відкрити тест','test:'+result.id)],chatBack()],message);
    }
    if(s.step==='review'&&['title','description','pass','draw'].includes(action)){s.step=action;s.returnReview=true;}
    else if(action==='add'&&s.step==='review'&&s.draft.questions.length<100)s.step='question';
    else if(action==='learning'&&s.step==='review')s.draft.learning_enabled=!s.draft.learning_enabled;
    else if(action==='remove'&&s.step==='review'){s.draft.questions.pop();s.draft.draw_count=Math.min(s.draft.draw_count||0,s.draft.questions.length);}
    else if(action==='skip'&&s.step==='description'){s.draft.description='';s.step=s.returnReview?'review':'pass';delete s.returnReview;}
    else if(action==='default'&&s.step==='pass')return chatWizardInput(env,user,s,'80');
    else if(action==='default'&&s.step==='points')return chatWizardInput(env,user,s,'1');
    else if(action==='skip'&&s.step==='explanation'){if(s.draft.learning_enabled)s.step='learning';else completeDraftQuestion(s);}
    else if(action==='skip'&&s.step==='source'){s.question.source_url='';completeDraftQuestion(s);}
    else if(!(s.returnReview&&s.step===action))throw Error('Ця дія більше не доступна. Відкрийте /admin.');
  }else if(s.kind==='import'&&action==='parse'){
    let draft;
    try{draft=JSON.parse((s.text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('JSON ще не повний або містить помилку. Надішліть решту частин або /cancel для нового імпорту.');}
    if(!draft||typeof draft!=='object'||typeof draft.title!=='string')throw Error('JSON має містити назву title та масив questions.');
    draft={title:displayTitle(draft.title),description:String(draft.description||'').slice(0,1000),pass_percent:draft.pass_percent??80,draw_count:draft.draw_count??0,learning_enabled:draft.learning_enabled??false,questions:draft.questions};
    if(!validTest(draft))throw Error('Перевірте title, pass_percent, questions, options та correct. Для нового імпорту — /cancel.');
    validateLearning(draft);
    s={kind:'test',step:'review',draft};
  }else if(s.kind==='archive'&&action==='archive'){
    await chatApi(env,user,'/api/test/archive',{id:s.test_id,archived:s.archived});
    await chatState(env,user,null);return chatTest(env,user,s.test_id,message);
  }else if(s.kind==='tag'&&action==='clear'){
    await chatSaveTag(env,user,s.person.id,'');
    await chatState(env,user,null);return chatTeam(env,user,0,message);
  }else if(s.kind==='assign'){
    if(s.step==='people'){
      if(action==='pick'){
        const {users}=await chatApi(env,user,'/api/data');if(!users.some(x=>x.id===args[0]&&!x.blocked))throw Error('Учасника не знайдено.');
        s.user_ids=s.user_ids.includes(args[0])?s.user_ids.filter(x=>x!==args[0]):[...s.user_ids,args[0]];
        if(s.user_ids.length>100)throw Error('За раз можна призначити тест до 100 учасникам.');
      }else if(action==='page')s.page=Number(args[0])||0;
      else if(action==='all'){const {users:team}=await chatApi(env,user,'/api/data');const users=team.filter(person=>!person.blocked);if(users.length>100)throw Error('У команді більше 100 учасників. Оберіть потрібних вручну.');s.user_ids=users.map(x=>x.id);}
      else if(action==='none')s.user_ids=[];
      else if(action==='next'&&s.user_ids.length)s.step=s.returnReview?'review':'deadline';
      else throw Error('Оберіть учасників кнопками.');
      if(s.step==='review')delete s.returnReview;
    }else if(action==='skip'&&s.step==='deadline'){s.deadline=null;s.step='tries';}
    else if(action==='default'&&s.step==='tries')return chatWizardInput(env,user,s,'1');
    else if(action==='default'&&s.step==='corrections')return chatWizardInput(env,user,s,'0');
    else if(action==='notify'&&s.step==='review')s.notify=!s.notify;
    else if(action==='people'&&s.step==='review'){s.step='people';s.returnReview=true;}
    else if(action==='send'&&s.step==='review'){
      const result=await chatApi(env,user,'/api/assign',{test_id:s.test_id,user_ids:s.user_ids,deadline:s.deadline,max_attempts:s.max_attempts,correction_limit:s.correction_limit,notify:s.notify});
      await chatState(env,user,null);
      return chatSay(env,user,'<b>Призначення опрацьовано</b>\n\nСтворено: '+result.created+' із '+s.user_ids.length+'\nСповіщень надіслано: '+result.notified+(result.created<s.user_ids.length?'\nЧастину призначень не вдалося створити. Перевірте їх у вебпанелі.':''),[chatBack()],message);
    }else throw Error('Ця дія більше не доступна.');
  }else throw Error('Ця дія більше не доступна.');
  await chatState(env,user,s);return chatPrompt(env,user,s,message);
}

async function adminChat(env,update,origin){
  const query=update.callback_query;
  const msg=query?.message||update.message;
  const user=String((query?.from||msg?.from)?.id||'');
  if(!admin(env,user)||msg?.chat?.type!=='private'||String(msg.chat.id)!==user){
    if(query)await tg(env,'answerCallbackQuery',{callback_query_id:query.id,text:'Доступ тільки супервайзеру.',show_alert:true});
    return false;
  }
  const event=Number(update.update_id);
  if(!Number.isSafeInteger(event))throw Error('Missing Telegram update ID');
  await env.DB.prepare(CHAT_TABLE_SQL).run();
  await env.DB.prepare('INSERT OR IGNORE INTO th_admin_chat(user_id) VALUES(?)').bind(user).run();
  const now=Date.now();
  const lock=await env.DB.prepare("UPDATE th_admin_chat SET lock_until=? WHERE user_id=? AND lock_until<? AND (last_update_id<? OR datetime(updated_at)<datetime('now','-7 days'))").bind(now+120000,user,now,event).run();
  if(!lock.meta.changes){
    const seen=await env.DB.prepare('SELECT last_update_id FROM th_admin_chat WHERE user_id=?').bind(user).first();
    if(seen.last_update_id>=event){if(query)await tg(env,'answerCallbackQuery',{callback_query_id:query.id});return true;}
    throw Error('Admin chat is busy; retry webhook');
  }
  try{
    if(query)await tg(env,'answerCallbackQuery',{callback_query_id:query.id});
    const row=await env.DB.prepare('SELECT state_json FROM th_admin_chat WHERE user_id=?').bind(user).first();
    let s=JSON.parse(row.state_json);
    const text=(msg.text||'').trim();
    const cmd=/^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    let data=query?.data?.slice(2)||'';
    if(!query){
      const commands={start:'menu',admin:'menu',help:'menu',newtest:'new',library:'lib:0',team:'team:0',results:'results:0',assign:'choose:0',importtest:'import'};
      if(cmd==='cancel'){await chatState(env,user,null);return await chatSay(env,user,'Дію скасовано. Збережені тести та призначення залишилися без змін.',[chatBack()]);}
      if(commands[cmd])data=commands[cmd];
      else if(cmd) return await chatSay(env,user,'Для керування відкрийте /admin. /tests — ваші призначені тести. /cancel — скасувати незавершену дію.',[chatBack()]);
      else if(s){if(!text)throw Error('Надішліть текстове повідомлення або скористайтеся кнопками.');return await chatWizardInput(env,user,s,s.kind==='import'?(msg.text||''):text);}
      else return await chatMenu(env,user,origin,null);
    }
    const [action,...args]=data.split(':');const mid=query?.message?.message_id;
    if(action==='menu')return await chatMenu(env,user,origin,s,mid);
    if(action==='resume'){if(!s)throw Error('Немає незавершених дій.');return await chatPrompt(env,user,s,mid);}
    if(action==='lib'||action==='choose')return await chatLibrary(env,user,Number(args[0]),action==='choose',mid);
    if(action==='team')return await chatTeam(env,user,Number(args[0]),mid);
    if(action==='results')return await chatResults(env,user,Number(args[0]),mid);
    if(action==='test')return await chatTest(env,user,args[0],mid);
    if(action==='view'){
      const d=await chatApi(env,user,'/api/test/detail?id='+encodeURIComponent(args[0]));
      return await chatQuestions(env,user,d.questions,d.test.title,args[1],{prefix:'view:'+args[0]+':',exit:'test:'+args[0]},mid);
    }
    if(action==='answer'){
      const d=await chatApi(env,user,'/api/answers?id='+encodeURIComponent(args[0]));
      const {items}=await chatApi(env,user,'/api/results');const result=items.find(x=>x.id===args[0]);
      return await chatQuestions(env,user,d.items,result?userName(result)+(userMeta(result)?' · '+userMeta(result):''):'Розбір відповідей',args[1],{prefix:'answer:'+args[0]+':',exit:'results:0'},mid,true);
    }
    if(action==='w'){
      if(!s||args[0]!==s.token)throw Error('Ця кнопка застаріла. Використайте останнє повідомлення або /admin → «Продовжити».');
      return await chatWizardAction(env,user,s,args[1],args.slice(2),mid);
    }
    if(s)throw Error('Спочатку завершіть поточну дію або скасуйте її через /cancel. Чернетку збережено.');
    if(action==='new'||action==='import'){
      s=action==='import'?{kind:'import',text:''}:{kind:'test',step:'title',draft:{title:'',description:'',pass_percent:80,draw_count:0,learning_enabled:true,questions:[]}};
    }else if(action==='tag'){
      const {users}=await chatApi(env,user,'/api/data');const person=users.find(x=>x.id===args[0]);if(!person)throw Error('Учасника не знайдено.');s={kind:'tag',person};
    }else if(action==='select'){
      const {tests}=await chatApi(env,user,'/api/data');const test=tests.find(x=>x.id===args[0]&&!x.archived);if(!test)throw Error('Тест недоступний для призначення.');s={kind:'assign',step:'people',test_id:test.id,title:test.title,user_ids:[],page:0,notify:true};
    }else if(action==='edit'){
      const {tests}=await chatApi(env,user,'/api/data');const t=tests.find(x=>x.id===args[0]);if(!t)throw Error('Тест не знайдено.');
      const d=await chatApi(env,user,'/api/test/detail?id='+encodeURIComponent(t.id));
      // For assigned tests a new copy is saved only after review, preserving history.
      s={kind:'test',step:'review',draft:{...(t.assigned?{}:{id:t.id}),title:displayTitle(t.title)+(t.assigned?' (копія)':''),description:d.test.description||'',pass_percent:d.test.pass_percent,draw_count:d.test.draw_count,learning_enabled:!!d.test.learning_enabled,questions:d.questions}};
    }else if(action==='archive'){
      const {tests}=await chatApi(env,user,'/api/data');const t=tests.find(x=>x.id===args[0]);if(!t)throw Error('Тест не знайдено.');
      s={kind:'archive',test_id:t.id,archived:!t.archived,title:t.title};
      await chatState(env,user,s);
      return await chatSay(env,user,'<b>'+E(displayTitle(t.title))+'</b>\n\n'+(s.archived?'Архівувати тест? Він зникне з нових призначень. Історія збережеться.':'Відновити тест для нових призначень?'),[[wizardButton(s,'Підтвердити','archive')],chatBack()],mid);
    }else throw Error('Невідома дія. Відкрийте /admin.');
    await chatState(env,user,s);return await chatPrompt(env,user,s,mid);
  }catch(e){
    await chatSay(env,user,E(e.message)+'\n\n/admin — меню · /cancel — скасувати дію.');
  }finally{
    await env.DB.prepare('UPDATE th_admin_chat SET lock_until=0,last_update_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').bind(event,user).run();
  }
  return true;
}

async function webhook(req,env){
  if(!env.WEBHOOK_SECRET||
     req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET){
    return J({error:'Forbidden'},403);
  }
  let u=await req.json();
  if(u.callback_query){
    if((u.callback_query.data||'').startsWith('a:')){
      await adminChat(env,u,new URL(req.url).origin);
      return J({ok:true});
    }
    const q=u.callback_query;
    const user=String(q.from?.id||'');
    if(q.message?.chat?.type!=='private'||String(q.message.chat.id)!==user)return J({ok:true});
    if(!admin(env,user)&&await isOperatorBlocked(env.DB,user)){
      await tg(env,'answerCallbackQuery',{callback_query_id:q.id,text:blockedOperatorMessage,show_alert:true});
      return J({ok:true});
    }
    await callback(env,q);
    return J({ok:true});
  }
  let m=u.message;
  if(!m||m.chat?.type!=='private'||!m.from?.id)return J({ok:true});

  let user=String(m.from.id);
  if(!admin(env,user)&&await isOperatorBlocked(env.DB,user)){
    if(/^\/(start|tests|admin)(?:@\w+)?(?:\s|$)/i.test(m.text||'')){
      await tg(env,'sendMessage',{chat_id:user,text:blockedOperatorMessage});
    }
    return J({ok:true});
  }
  await register(env.DB,m.from);

  if(admin(env,user)&&!/^\/tests(?:@\w+)?(?:\s|$)/i.test(m.text||'')){
    await adminChat(env,u,new URL(req.url).origin);
    return J({ok:true});
  }
  if(/^\/(start|admin|tests)(?:@\w+)?(?:\s|$)/i.test(m.text||'')){
    await listOperatorTests(env,user);
  }
  return J({ok:true});
}

function validTest(b){
  return typeof b.title==='string'&&
    b.title.trim().length>=3&&b.title.length<=180&&
    Number.isInteger(b.pass_percent)&&b.pass_percent>=0&&
    b.pass_percent<=100&&Array.isArray(b.questions)&&
    b.questions.length>0&&b.questions.length<=100&&
    b.questions.every(q=>
      typeof q.question==='string'&&q.question.trim()&&
      q.question.length<=2000&&
      Array.isArray(q.options)&&q.options.length>=2&&
      q.options.length<=6&&
      q.options.every(x=>typeof x==='string'&&x.trim()&&x.length<=120)&&
      Array.isArray(q.correct)&&q.correct.length>0&&
      q.correct.every(n=>Number.isInteger(n)&&n>=0&&n<q.options.length)&&
      new Set(q.correct).size===q.correct.length&&
      Number.isInteger(q.points??1)&&(q.points??1)>=1&&
      (q.points??1)<=100
    );
}

const browserCookie = '__Host-test-hub-session';
const browserSessionSeconds = 30 * 24 * 60 * 60;
const browserAccessReady = new WeakMap();

function ensureBrowserAccess(db) {
  if (!browserAccessReady.has(db)) {
    browserAccessReady.set(db, db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS th_web_credentials (user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS th_web_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)')
    ]).then(() => db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS th_web_sessions_user ON th_web_sessions(user_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS th_web_sessions_expiry ON th_web_sessions(expires_at)')
    ])).catch(error => {
      browserAccessReady.delete(db);
      throw error;
    }));
  }
  return browserAccessReady.get(db);
}

function browserHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function browserDigest(value) {
  return browserHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function browserSessionToken(req) {
  const entry = (req.headers.get('Cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(browserCookie + '='));
  const token = entry?.slice(browserCookie.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}

function browserResponse(token, maxAge) {
  const response = J({ ok: true });
  response.headers.set('Set-Cookie', browserCookie + '=' + token + '; Max-Age=' + maxAge + '; Path=/; Secure; HttpOnly; SameSite=Strict');
  return response;
}

function sameBrowserOrigin(req) {
  return req.headers.get('Origin') === new URL(req.url).origin;
}

async function resolveBrowserSession(req, db) {
  const token = browserSessionToken(req);
  if (!token) return null;
  await ensureBrowserAccess(db);
  return db.prepare('SELECT user_id FROM th_web_sessions WHERE token_hash=? AND expires_at>?')
    .bind(await browserDigest(token), Math.floor(Date.now() / 1000)).first();
}

async function setupBrowserPassword(req, env) {
  let user;
  try { user = await auth(req, env); }
  catch { return J({ error: 'Відкрийте вебпанель у Telegram ще раз.' }, 401); }
  if (!admin(env, user)) return J({ error: 'Доступ тільки супервайзеру.' }, 403);
  // Only credentials generated here are accepted. They contain 160 random bits.
  const password = browserHex(crypto.getRandomValues(new Uint8Array(20)));
  const hash = await browserDigest(password);
  await ensureBrowserAccess(env.DB);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO th_web_credentials(user_id,password_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash').bind(user, hash),
    env.DB.prepare('DELETE FROM th_web_sessions WHERE user_id=?').bind(user)
  ]);
  return J({ login: user, password });
}

async function browserLogin(req, env) {
  const invalid = () => J({ error: 'Невірний логін або вебпароль.' }, 401);
  const body = await req.json().catch(() => null);
  const login = typeof body?.login === 'string' ? body.login.trim() : '';
  const password = typeof body?.password === 'string' ? body.password.trim() : '';
  if (!/^\d{1,16}$/.test(login) || !/^[a-f0-9]{40}$/.test(password) || !admin(env, login)) return invalid();
  const db = env.DB;
  await ensureBrowserAccess(db);
  const now = Math.floor(Date.now() / 1000);
  const token = browserHex(crypto.getRandomValues(new Uint8Array(32)));
  const passwordHash = await browserDigest(password);
  const tokenHash = await browserDigest(token);
  // Match the current credential and create its session in one statement.
  const created = await db.prepare('INSERT INTO th_web_sessions(token_hash,user_id,expires_at) SELECT ?,user_id,? FROM th_web_credentials WHERE user_id=? AND password_hash=?')
    .bind(tokenHash, now + browserSessionSeconds, login, passwordHash).run();
  if (!created.meta.changes) return invalid();
  await db.prepare('DELETE FROM th_web_sessions WHERE expires_at<=?').bind(now).run();
  return browserResponse(token, browserSessionSeconds);
}

async function browserAccessApi(req, env, path) {
  if (req.method !== 'POST') return J({ error: 'Метод не підтримується.' }, 405);
  if (!sameBrowserOrigin(req)) return J({ error: 'Відкрийте сторінку входу на цьому сайті.' }, 403);
  if (path === '/api/web-access/setup') return setupBrowserPassword(req, env);
  if (path === '/api/web-access/login') {
    if (!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) return J({ error: 'Некоректний запит.' }, 415);
    const size = Number(req.headers.get('Content-Length'));
    if (size > 1024) return J({ error: 'Некоректний запит.' }, 413);
    return browserLogin(req, env);
  }
  if (path === '/api/web-access/logout') {
    const token = browserSessionToken(req);
    if (token) {
      await ensureBrowserAccess(env.DB);
      await env.DB.prepare('DELETE FROM th_web_sessions WHERE token_hash=?').bind(await browserDigest(token)).run();
    }
    return browserResponse('', 0);
  }
  return J({ error: 'Сторінку не знайдено.' }, 404);
}

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

function testWriteStatements(db,b,testId){
  let count=Number.isInteger(b.draw_count)
    ?Math.max(0,Math.min(b.draw_count,b.questions.length)):0;

  let cmds=[];
  if(b.id){
    cmds.push(db.prepare(
      'UPDATE th_tests SET title=?,description=?,pass_percent=?,draw_count=? WHERE id=?'
    ).bind(
      b.title.trim(),
      String(b.description||'').slice(0,1000),
      b.pass_percent,count,b.id
    ));
    cmds.push(db.prepare('DELETE FROM th_question_learning WHERE question_id IN (SELECT id FROM th_questions WHERE test_id=?)').bind(b.id));
    cmds.push(db.prepare(
      'DELETE FROM th_questions WHERE test_id=?'
    ).bind(b.id));
  }else{
    cmds.push(db.prepare(
      'INSERT INTO th_tests(id,title,description,pass_percent,draw_count,published) VALUES(?,?,?,?,?,1)'
    ).bind(
      testId,b.title.trim(),String(b.description||'').slice(0,1000),
      b.pass_percent,count
    ));
    cmds.push(db.prepare(
      'INSERT INTO th3_testmeta(test_id) VALUES(?)'
    ).bind(testId));
  }

  cmds.push(db.prepare('INSERT INTO th_test_learning(test_id,enabled) SELECT ?,? WHERE EXISTS(SELECT 1 FROM th_tests WHERE id=?) ON CONFLICT(test_id) DO UPDATE SET enabled=excluded.enabled').bind(testId,Number(learningEnabled(b)),testId));
  b.questions.forEach((q,i)=>{
    const questionId=ID();
    cmds.push(db.prepare('INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th_tests WHERE id=?)').bind(questionId,testId,i,q.question,JSON.stringify(q.options),JSON.stringify(q.correct),q.points??1,String(q.explanation||'').slice(0,2000),testId));
    cmds.push(db.prepare('INSERT INTO th_question_learning(question_id,learning_text,source_url) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM th_questions WHERE id=?)').bind(questionId,String(q.learning_text||'').trim(),studyURL(q.source_url||''),questionId));
  });

  return cmds;
}

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

async function adminApi(req,env,path,user){
  if(!admin(env,user))return J({error:'Доступ тільки супервайзеру'},403);
  let db=env.DB,method=req.method;
  await ensureLearning(db);
  await ensureOperatorAccess(db);

  if(path==='/api/me')return J({admin:true,id:user});

  if(path==='/api/data'){
    let [users,tests,assignments]=await Promise.all([
      db.prepare(
        "SELECT id,name,username,display_name,operator_tag,EXISTS(SELECT 1 FROM th_blocked_operators b WHERE b.user_id=th_users.id) blocked FROM th_users ORDER BY COALESCE(NULLIF(display_name,''),name)"
      ).all(),
      db.prepare(
        `SELECT t.*,COALESCE(m.archived,0) archived,COALESCE(l.enabled,0) learning_enabled,
          (SELECT COUNT(*) FROM th_questions q WHERE q.test_id=t.id) question_count,
          (SELECT COUNT(*) FROM th3_assignments a WHERE a.test_id=t.id) assigned
         FROM th_tests t
         LEFT JOIN th3_testmeta m ON m.test_id=t.id
         LEFT JOIN th_test_learning l ON l.test_id=t.id
         ORDER BY t.created_at DESC`
      ).all(),
      db.prepare(
        `SELECT a.*,
          COALESCE(NULLIF(u.display_name,''),u.name) name,
          u.operator_tag,u.username,t.title,
          (SELECT COUNT(*) FROM th3_attempts r WHERE r.assignment_id=a.id) used,
          (SELECT MAX(percent) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='finished') best,
          (SELECT MAX(passed) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='finished') passed,
          (SELECT COUNT(*) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='active') active
         FROM th3_assignments a
         JOIN th_users u ON u.id=a.user_id
         JOIN th_tests t ON t.id=a.test_id
         ORDER BY a.created_at DESC,a.rowid DESC LIMIT 500`
      ).all()
    ]);
    return J({
      users:users.results.map(person=>({...person,admin:admin(env,person.id)})),
      tests:tests.results,
      assignments:assignments.results
    });
  }

  if(path==='/api/operator/access'&&method==='POST')return changeOperatorAccess(req,env);
  if(path==='/api/assignment/delete'&&method==='POST')return deleteAssignment(req,db);

  if(path==='/api/operator'&&method==='POST'){
    let b=await req.json();
    if(!/^\d+$/.test(b.id||'')||
       typeof b.display_name!=='string'||b.display_name.length>80||
       typeof b.operator_tag!=='string'||b.operator_tag.length>80){
      return J({error:'Некоректні дані'},400);
    }
    let x=await db.prepare(
      'UPDATE th_users SET display_name=?,operator_tag=? WHERE id=?'
    ).bind(b.display_name.trim(),b.operator_tag.trim(),b.id).run();
    return J({ok:!!x.meta.changes});
  }

  if(path==='/api/test/detail'&&method==='GET'){
    let id=new URL(req.url).searchParams.get('id');
    let t=await db.prepare(
      'SELECT t.*,COALESCE(l.enabled,0) learning_enabled FROM th_tests t LEFT JOIN th_test_learning l ON l.test_id=t.id WHERE t.id=?'
    ).bind(id).first();
    if(!t)return J({error:'Тест не знайдено'},404);
    let q=(await db.prepare(
      `SELECT q.*,COALESCE(l.learning_text,'') learning_text,COALESCE(l.source_url,'') source_url FROM th_questions q LEFT JOIN th_question_learning l ON l.question_id=q.id WHERE q.test_id=? ORDER BY q.position`
    ).bind(id).all()).results;
    return J({
      test:t,
      questions:q.map(x=>({
        question:x.question,
        options:JSON.parse(x.options_json),
        correct:JSON.parse(x.correct_json),
        points:x.points,
        explanation:x.explanation,learning_text:x.learning_text,source_url:x.source_url
      }))
    });
  }

  if(method==='POST'&&(path==='/api/test/import/preview'||path==='/api/test/import')){
    return testPackageApi(req,db,path.endsWith('/preview'));
  }

  if(path==='/api/test/save'&&method==='POST'){
    let b=await req.json();
    if(!validTest(b)){
      return J({error:'Перевір назву, запитання та правильні відповіді'},400);
    }
    try{validateLearning(b);}catch(e){return J({error:e.message},400);}
    let testId=b.id||ID();
    if(b.id){
      let count=await db.prepare(
        'SELECT COUNT(*) n FROM th3_assignments WHERE test_id=?'
      ).bind(b.id).first();
      if(count.n){
        return J({
          error:'Тест уже призначався. Для редагування створи його копію, щоб зберегти історію.'
        },409);
      }
      let exists=await db.prepare(
        'SELECT id FROM th_tests WHERE id=?'
      ).bind(b.id).first();
      if(!exists)return J({error:'Тест не знайдено'},404);
    }

    const cmds=testWriteStatements(db,b,testId);
    const [saved]=await db.batch(cmds);
    if(!saved.meta.changes)return J({error:'Тест не знайдено'},404);
    return J({ok:true,id:testId});
  }

  if(path==='/api/test/duplicate'&&method==='POST'){
    let b=await req.json();
    let test=await db.prepare(
      'SELECT t.*,COALESCE(l.enabled,0) learning_enabled FROM th_tests t LEFT JOIN th_test_learning l ON l.test_id=t.id WHERE t.id=?'
    ).bind(b.id).first();
    if(!test)return J({error:'Тест не знайдено'},404);

    let qs=(await db.prepare(
      `SELECT q.*,COALESCE(l.learning_text,'') learning_text,COALESCE(l.source_url,'') source_url FROM th_questions q LEFT JOIN th_question_learning l ON l.question_id=q.id WHERE q.test_id=? ORDER BY q.position`
    ).bind(b.id).all()).results;
    let id=ID();
    let cmds=[
      db.prepare(
        'INSERT INTO th_tests(id,title,description,pass_percent,draw_count,published) VALUES(?,?,?,?,?,1)'
      ).bind(
        id,test.title+' (копія)',test.description,
        test.pass_percent,test.draw_count
      ),
      db.prepare(
        'INSERT INTO th3_testmeta(test_id) VALUES(?)'
      ).bind(id)
    ];
    cmds.push(db.prepare('INSERT INTO th_test_learning(test_id,enabled) VALUES(?,?)').bind(id,Number(!!test.learning_enabled)));
    qs.forEach((q,i)=>{
      const questionId=ID();
      cmds.push(db.prepare('INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) VALUES(?,?,?,?,?,?,?,?)').bind(questionId,id,i,q.question,q.options_json,q.correct_json,q.points,q.explanation));
      cmds.push(db.prepare('INSERT INTO th_question_learning(question_id,learning_text,source_url) VALUES(?,?,?)').bind(questionId,q.learning_text||'',q.source_url||''));
    });

    await db.batch(cmds);
    return J({ok:true,id});
  }

  if(path==='/api/test/archive'&&method==='POST'){
    let b=await req.json();
    if(typeof b.id!=='string'||typeof b.archived!=='boolean'){
      return J({error:'Некоректні дані'},400);
    }
    await db.prepare(
      'INSERT INTO th3_testmeta(test_id,archived) VALUES(?,?) ON CONFLICT(test_id) DO UPDATE SET archived=excluded.archived'
    ).bind(b.id,Number(b.archived)).run();
    return J({ok:true});
  }

  if(path==='/api/test/delete'&&method==='POST')return deleteLibraryTest(req,db);

  if(path==='/api/assign'&&method==='POST'){
    let b=await req.json();
    if(typeof b.test_id!=='string'||
       !Array.isArray(b.user_ids)||!b.user_ids.length||
       b.user_ids.length>100||
       !b.user_ids.every(x=>typeof x==='string'&&/^\d+$/.test(x))||
       !Number.isInteger(b.max_attempts)||b.max_attempts<1||
       b.max_attempts>10||
       !Number.isInteger(b.correction_limit)||
       b.correction_limit<0||b.correction_limit>10||
       (b.deadline&&(!Number.isFinite(Date.parse(b.deadline))||
        Date.parse(b.deadline)<=Date.now()))){
      return J({error:'Невірні параметри призначення'},400);
    }

    let test=await db.prepare(
      `SELECT t.title,COALESCE(m.archived,0) archived
       FROM th_tests t
       LEFT JOIN th3_testmeta m ON m.test_id=t.id
       WHERE t.id=?`
    ).bind(b.test_id).first();
    if(!test||test.archived){
      return J({error:'Тест відсутній або в архіві'},409);
    }

    let created=0,notified=0;
    for(let userId of [...new Set(b.user_ids)]){
      let id=ID();
      try{
        const assignment=await db.prepare(
          `INSERT INTO th3_assignments(id,test_id,user_id,deadline,max_attempts,correction_limit)
           SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM th_tests t LEFT JOIN th3_testmeta m ON m.test_id=t.id WHERE t.id=? AND COALESCE(m.archived,0)=0)
           AND EXISTS(SELECT 1 FROM th_users WHERE id=?)
           AND NOT EXISTS(SELECT 1 FROM th_blocked_operators WHERE user_id=?)`
        ).bind(
          id,b.test_id,userId,b.deadline||null,
          b.max_attempts,b.correction_limit,b.test_id,userId,userId
        ).run();
        if(!assignment.meta.changes)continue;
        created++;
        if(b.notify!==false){
          try{
            await tg(env,'sendMessage',{
              chat_id:userId,
              text:'НОВИЙ ТЕСТ\n\n'+displayTitle(test.title)+'\n\nЗавершити до: '+fmt(b.deadline)+'\nСпроб: '+b.max_attempts+'\n\nРозпочніть, коли будете готові.',
              reply_markup:{inline_keyboard:startKeys(id)}
            });
            notified++;
            await db.prepare(
              'UPDATE th3_assignments SET notified=1 WHERE id=?'
            ).bind(id).run();
          }catch(e){
            console.log('Notification:',e.message);
          }
        }
      }catch(e){
        console.log('Assign:',e.message);
      }
    }
    return J({created,notified,skipped:new Set(b.user_ids).size-created});
  }

  if(path==='/api/results'){
    let x=await db.prepare(
      `SELECT r.id,r.assignment_id,r.status,r.percent,r.passed,
        r.score,r.max_score,r.started_at,r.finished_at,t.title,
        COALESCE(NULLIF(u.display_name,''),u.name) name,
        u.operator_tag,u.username
       FROM th3_attempts r
       JOIN th3_assignments a ON a.id=r.assignment_id
       JOIN th_tests t ON t.id=a.test_id
       JOIN th_users u ON u.id=r.user_id
       ORDER BY r.started_at DESC LIMIT 1000`
    ).all();
    return J({items:x.results});
  }

  if(path==='/api/answers'){
    let runId=new URL(req.url).searchParams.get('id');
    let rows=(await db.prepare(
      `SELECT a.*,q.question,q.options_json,q.correct_json
       FROM th3_answers a
       JOIN th_questions q ON q.id=a.question_id
       WHERE a.attempt_id=? ORDER BY q.position`
    ).bind(runId).all()).results;
    return J({
      items:rows.map(x=>({
        question:x.question,
        selected:JSON.parse(x.selected_json).map(i=>JSON.parse(x.options_json)[i]),
        correct:JSON.parse(x.correct_json).map(i=>JSON.parse(x.options_json)[i]),
        right:!!x.correct
      }))
    });
  }

  return J({error:'API endpoint not found'},404);
}

const PAGE="<!DOCTYPE html>\n<html lang=\"uk\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Центр знань — панель супервайзера</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{color-scheme:light;--bg:#f5f6f8;--surface:#fff;--ink:#18232d;--muted:#73808a;--line:#e5e9ec;--accent:#146b58;--soft:#e9f4ef;--danger:#ae3b46;--shadow:0 2px 5px #132c1f03}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}button,input,textarea,select{font:inherit}button,a,input,textarea,select{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #6da894;outline-offset:3px}button:disabled{opacity:.5;cursor:wait}.hidden{display:none!important}\nmain{max-width:1500px;margin:auto;padding:0 36px 48px 254px;min-height:100vh}.hero{position:fixed;inset:0 auto 0 0;width:218px;background:#fff;border-right:1px solid var(--line);padding:29px 22px;z-index:5;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px}.brand-mark{width:36px;height:36px;border-radius:11px;background:var(--accent);color:white;display:grid;place-items:center}.brand-mark svg{width:21px;height:21px}.brand h1{font-size:17px;letter-spacing:-.5px;margin:0;line-height:1.2}.brand small{font-size:10px;color:var(--muted);letter-spacing:1.2px;text-transform:uppercase}.hero-sub{font-size:11px;letter-spacing:1.4px;color:#89939a;margin:38px 12px 12px;text-transform:uppercase}.tabs{display:flex;flex-direction:column;gap:5px}.tabs button{display:flex;align-items:center;gap:12px;margin:0;text-align:left;padding:12px;border-radius:9px;border:0;background:transparent;color:#75818b;font-size:13px;font-weight:600}.tabs button svg{width:18px;height:18px;flex-shrink:0}.tabs button.on{background:var(--soft);color:var(--accent)}.tabs button:hover{background:#f1f6f3}.sidebar-foot{margin-top:auto;padding-top:25px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}.sidebar-foot b{display:block;color:#4d5d67;font-size:12px}.online-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#3c9b79;margin-right:6px}\n.topbar{height:88px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:26px}.breadcrumb{color:var(--muted);font-size:12px}.breadcrumb span{color:#354550;margin-left:10px}.profile{display:flex;align-items:center;gap:11px;font-size:11px;color:var(--muted)}.profile b{display:block;color:#354550;font-size:12px}.avatar{display:grid;place-items:center;width:35px;height:35px;border-radius:50%;background:#e2eae6;color:var(--accent);font-weight:700;font-size:12px}.page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.eyebrow{text-transform:uppercase;letter-spacing:1.7px;color:var(--accent);font-size:10px;font-weight:750;margin-bottom:8px}h1,h2,h3,p{overflow-wrap:anywhere}h2{font-size:28px;line-height:1.2;letter-spacing:-.8px;margin:0 0 9px;font-weight:700}h3{font-size:15px;margin:0 0 7px}.page-heading p{margin:0;color:var(--muted);font-size:13px}.card,.stat{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:22px;margin:12px 0;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:25px}.stat{margin:0;padding:20px}.stat-head{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}.stat-icon{color:var(--accent);width:29px;height:29px;border-radius:8px;background:var(--soft);display:grid;place-items:center}.stat-icon svg{width:15px;height:15px}.stat b{font-size:32px;line-height:1.8;letter-spacing:-1px;font-weight:650}.stat-foot{font-size:10px;color:var(--muted)}.stat-foot span{color:var(--accent);font-weight:650}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}.section-heading h3{margin:0}.section-heading small{font-size:11px;color:var(--muted)}button{border:1px solid transparent;background:var(--accent);color:white;border-radius:8px;padding:10px 15px;font-weight:600;font-size:12px;line-height:1.4;margin:3px 4px 3px 0;transition:background .15s,box-shadow .15s}button:hover{background:#0c5646}button.alt{background:white;border-color:var(--line);color:#485761}button.alt:hover{background:#f4f7f5;border-color:#b7c9c0}button.danger{background:#fff;border-color:#f1dde0;color:var(--danger)}button.danger:hover{background:#fff1f2}.link-button{background:none!important;border:0;color:var(--accent);padding:0;font-size:11px}.muted{color:var(--muted);font-size:12px}.error{color:var(--danger)}#notice{padding:11px 15px;font-size:12px;border-left:3px solid var(--accent);margin:0 0 22px;background:#f0f8f3;border-radius:7px}#notice.error{border-color:var(--danger);background:#fff4f3}#notice:empty{display:none}#notice.access-notice{max-width:540px;margin:80px auto;padding:30px;background:white;border:1px solid var(--line);font-size:14px}\ninput,textarea,select{width:100%;font:inherit;color:var(--ink);border:1px solid #dfe5e8;border-radius:8px;padding:11px 12px;margin:7px 0 17px;background:#fff;outline:none}input:focus,textarea:focus,select:focus{border-color:#75a48e;box-shadow:0 0 0 3px #146b5810}input::placeholder,textarea::placeholder{color:#9ca6ae}textarea{min-height:90px;resize:vertical}label{font-size:12px;font-weight:600;color:#4b5b64;display:block}.check{display:flex;align-items:center;gap:10px;padding:11px 0;font-size:12px;font-weight:400}.check input{width:16px;height:16px;accent-color:var(--accent);margin:0;flex-shrink:0}.question{border:1px solid var(--line);border-radius:10px;padding:19px;margin:17px 0;background:#fafcfb}.question>b{display:inline-block;margin-bottom:20px;font-size:13px}.question>button.danger{float:right;margin-top:-3px}.question>label{clear:both}.toolbar{display:flex;flex-wrap:wrap;gap:4px;margin-top:16px}.toolbar button{font-size:11px;padding:8px 11px}.pill{border-radius:5px;padding:4px 8px;background:#f0f3f5;color:#697783;font-size:10px;font-weight:650;display:inline-flex;align-items:center;white-space:nowrap;gap:5px}.pill:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.pill.success{background:#e8f4ed;color:#25704f}.pill.active{background:#edf2fc;color:#4f70a7}.pill.waiting{background:#fff5e1;color:#9b7627}.pill.failed{background:#fceef0;color:#ac4857}.card,.editor-grid,.overview-grid{min-width:0}.table-wrap{overflow:auto;margin:0 -22px -22px}.data-table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.data-table th{padding:12px 22px;color:#87929b;background:#fafbfc;font-size:10px;font-weight:600;white-space:nowrap;border-block:1px solid var(--line)}.data-table td{padding:17px 22px;border-bottom:1px solid #eef1f3;vertical-align:middle}.data-table tr:last-child td{border:0}.person-cell{display:flex;align-items:center;gap:10px;min-width:150px}.person-cell .avatar{width:31px;height:31px;font-size:10px}.person-cell b{font-size:12px;font-weight:600}.person-cell small{display:block;color:var(--muted);font-size:10px}.score{font-weight:700;font-variant-numeric:tabular-nums}.score-track{display:block;width:62px;height:3px;border-radius:10px;background:#edf0f2;margin-top:6px;overflow:hidden}.score-track i{display:block;height:100%;background:#54947d;border-radius:10px}.table-meta{font-size:10px;color:var(--muted);padding:16px 0 0}.empty{padding:38px;text-align:center;color:var(--muted);font-size:13px}.empty svg{width:30px;height:30px;display:block;margin:0 auto 10px;color:#a4b7ab}.searchbar{display:flex;align-items:center;gap:10px;margin:18px 0}.searchbar input{margin:0;max-width:330px;font-size:12px;padding:10px 13px}.searchbar select{margin:0;max-width:180px;font-size:12px;padding:10px}.searchbar .muted{margin-left:auto;font-size:11px}#testList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}#testList>.card{margin:0;padding:23px}#testList>.card>b{display:block;font-size:16px;line-height:1.5;margin-bottom:12px}#testList>.card>.muted{line-height:1.8}#testList .test-icon{width:35px;height:35px;border-radius:9px;background:var(--soft);color:var(--accent);display:grid;place-items:center;margin-bottom:17px}#testList .test-icon svg{width:18px;height:18px}.editor-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px;align-items:start}.editor-grid>.card{margin-top:0}.editor-grid .import-card{position:sticky;top:20px}#import{min-height:185px;font:12px/1.7 ui-monospace,monospace;background:#f7f9f8}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field-help{font-size:10px;color:var(--muted);margin:-10px 0 18px}.form-actions{border-top:1px solid var(--line);padding-top:17px;margin-top:15px}.assignment-card{max-width:780px}#people{max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 14px;margin:7px 0}#people .check+.check{border-top:1px solid #f0f2f4}#teamList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#teamList .card{margin:0}#teamList .card>b{font-size:15px;display:block}#teamList .muted{margin:5px 0 18px}#filter{width:200px;margin:0}#answers .card p{font-size:13px}.report-tools{display:flex;gap:8px;justify-content:space-between;margin-bottom:18px}.overview-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:18px;align-items:start}.overview-grid>.card{margin-top:0}.insight-title{font-size:10px;letter-spacing:1.2px;color:var(--muted);margin-bottom:20px}.completion-ring{width:126px;height:126px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) calc(var(--rate,0)*1%),#edf1ef 0)}.completion-ring>div{background:#fff;border-radius:50%;width:104px;height:104px;display:flex;align-items:center;justify-content:center;flex-direction:column}.completion-ring b{font-size:27px;line-height:1.2;letter-spacing:-1px}.completion-ring small{font-size:10px;color:var(--muted)}.legend-row{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:12px 0}.legend-row b{color:var(--ink);font-weight:600}.legend-row .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:7px}.tip{background:#f3f7f4;border-radius:8px;padding:14px;font-size:11px;color:#657b6c;margin-top:22px}.tip b{display:block;color:#3c5c4c;margin-bottom:5px}.dashboard-footer{display:flex;justify-content:space-between;gap:15px;margin-top:30px;font-size:10px;color:#99a2aa}\n@media(min-width:1600px){.hero{left:calc((100vw - 1500px)/2)}}\n@media(max-width:1150px){main{padding-left:224px;padding-right:24px}.hero{width:200px;padding-inline:16px}.overview-grid{grid-template-columns:1fr}.overview-grid>.insight{display:none}.editor-grid{grid-template-columns:1fr}.editor-grid .import-card{position:static}.grid{gap:10px}.stat{padding:15px}.data-table td,.data-table th{padding-inline:16px}}\n@media(max-width:760px){main{padding:0 18px 35px}.hero{position:static;width:auto;border:0;border-bottom:1px solid var(--line);padding:18px;margin:0 -18px 0;display:block}.hero-sub,.sidebar-foot{display:none}.brand small{font-size:9px}.tabs{flex-direction:row;overflow:auto;margin-top:18px;gap:3px;padding-bottom:2px}.tabs button{white-space:nowrap;padding:10px 12px;font-size:11px;gap:7px}.tabs button svg{width:15px;height:15px}.topbar{height:57px;margin-bottom:23px}.profile .profile-name{display:none}.profile .avatar{width:27px;height:27px;font-size:10px}.page-heading{margin-bottom:20px;gap:10px}h2{font-size:25px}.page-heading p{font-size:12px;max-width:260px}.page-heading button{padding:10px 12px;font-size:11px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.stat{padding:16px}.stat b{font-size:29px}.stat-foot{font-size:9px}.card{padding:18px;border-radius:11px}.table-wrap{margin:0 -18px -18px}.data-table td,.data-table th{padding:14px 16px}.data-table td:nth-child(4),.data-table th:nth-child(4){display:none}.data-table td{font-size:11px}.table-meta{padding-top:16px}.overview-grid{gap:0}#testList,#teamList{grid-template-columns:1fr}.searchbar{flex-wrap:wrap}.searchbar input{max-width:none;flex:1;min-width:140px}.searchbar select{width:140px}.searchbar .muted{width:100%;margin:0}.form-row{gap:12px}.question{padding:14px}.dashboard-footer{font-size:9px}.editor-grid{gap:0}.breadcrumb{font-size:10px}.report-tools{align-items:center}.report-tools select{max-width:170px}.hero .tabs::-webkit-scrollbar{height:0}}\n@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}\n\n#notice:empty{display:none}\n.composer{max-width:960px;display:grid;gap:16px}\n.composer .card{margin:0}\n.composer h3{font-size:17px;margin:0}\n.composer .section-heading{align-items:center;gap:12px;margin-bottom:12px}\n.composer .section-heading h3{margin:0}\n.composer label,.composer summary{font-size:14px}\n.composer .field-help{font-size:13px;margin:4px 0;color:#52636d}\n.composer input,.composer textarea{font-size:16px}\n.composer-settings>label,.composer-details>label,.paste-card>label{margin-top:14px}\n.composer-details{border-top:1px solid var(--line);padding-top:12px;margin-top:8px}\n.composer-details summary{width:fit-content;cursor:pointer;font-weight:650;color:var(--accent)}\n.composer-details summary:focus-visible{outline:3px solid #6da894;outline-offset:3px}\n.paste-card{border-top:3px solid var(--accent)}\n#pasteText{min-height:182px;line-height:1.55;margin-bottom:10px}\n.json-import{margin-top:16px}\n.json-import textarea{margin-bottom:8px}\n#jsonStatus{margin:6px 0}\n#jsonPreview{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}\n#jsonPreview details{padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}\n#jsonPreview summary{cursor:pointer;font-weight:650}\n#jsonPreview ol{padding-left:22px}\n#jsonPreview li{margin-bottom:8px}\n#savePackage{margin-top:12px}\n#assignmentHistory{max-width:780px;margin-top:22px}\n#assignmentHistory th:last-child,#assignmentHistory td:last-child{white-space:nowrap}\n#teamList .team-actions{display:flex;flex-wrap:wrap;gap:6px}\n#teamList .pill{margin-top:6px}\n.composer-actions,.composer-footer,.question-head,.question-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}\n.composer-actions [role=status]{font-size:14px;color:var(--muted)}\n.composer [role=status].error-text{color:var(--danger)}\n.composer-footer{position:sticky;bottom:0;z-index:3;justify-content:space-between;border-top:1px solid var(--line);box-shadow:0 -4px 20px #132c1f14}\n.composer-footer strong{font-size:14px}\n.composer-footer #nextIncomplete{margin-left:10px}\n.composer-footer #saveStatus:empty{display:none}\n.composer .question{margin:0 0 12px;padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:12px;scroll-margin-top:16px}\n.question-head{justify-content:space-between;margin-bottom:6px}\n.question-head h4{margin:0;font-size:15px}\n.question-state{font-size:13px;color:#56656e}\n.question-state[data-ready=true]{color:var(--accent)}\n.composer .question textarea[data-question]{min-height:58px}\n.answer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;margin:6px 0}\n.answer-option{display:flex;min-width:0;align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;padding:0 10px;color:#4b5b64;background:#f8faf9}\n.answer-option:has([type=checkbox]:checked){border-color:#75a48e;background:var(--soft);color:var(--accent)}\n.answer-option input[type=checkbox]{width:18px;height:18px;margin:0;flex:none;accent-color:var(--accent);cursor:pointer}\n.answer-option textarea[data-option]{border:0;background:transparent;margin:0;padding:10px 2px;min-width:0;min-height:44px;field-sizing:content;resize:vertical}\n.answer-option:focus-within{outline:2px solid #75a48e}\n.answer-option textarea[data-option]:focus{box-shadow:none}\n.question-tools{margin-top:10px;justify-content:space-between}\n.question-empty{padding:18px;border:1px dashed #cdd9d4;border-radius:12px;color:#52636d}\n.composer button:disabled{cursor:default}\n@media(max-width:560px){.composer .section-heading{flex-wrap:wrap}.composer .card,.composer .question{padding:14px}.composer-footer #nextIncomplete{margin-left:0;display:block}.composer-footer{gap:8px}.composer .question-tools button,.answer-row>button{padding-inline:8px}.composer .answer-option{gap:6px;padding-inline:7px}}\n\n#loginCard{max-width:430px;margin:46px auto;padding:28px}\n#loginCard h2{font-size:25px;margin:0 0 10px}\n#loginCard input,#webAccessDialog input{font-size:16px}\n#loginCard label,#webAccessDialog label{font-size:14px}\n#loginCard button{width:100%}\n#loginCard details{margin-top:18px}\n#loginCard summary{color:var(--accent);cursor:pointer;font-weight:600}\n#loginStatus:empty,#accessStatus:empty{display:none}\n#loginStatus,#accessStatus{margin:10px 0;color:var(--muted)}\n#loginStatus.error-text,#accessStatus.error-text{color:var(--danger)}\n#webAccessDialog{width:min(460px,calc(100% - 24px));border:1px solid var(--line);border-radius:14px;padding:22px;color:var(--ink);box-shadow:0 18px 60px #18312a30}\n#webAccessDialog::backdrop{background:#18232d75}\n#webAccessDialog h2{margin:0;font-size:21px}\n#webAccessPassword{font-family:monospace}\nbody[data-locked] .tabs,body[data-locked] .sidebar-foot,body[data-locked] .topbar,body[data-locked] .dashboard-footer{display:none}\n@media(max-width:760px){#loginCard{margin:28px auto;padding:20px}.topbar .profile #accessButton{font-size:12px;padding-inline:8px}}\n</style>\n</head>\n<body data-locked>\n<main>\n<header class=\"hero\"><div class=\"brand\"><span class=\"brand-mark\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m3 7 9-4 9 4-9 4ZM6 10v7c4 4 8 4 12 0v-7\"/></svg></span><div><h1>Центр знань</h1><small>TEAM LEARNING</small></div></div><div class=\"hero-sub\">Робочий простір</div><nav class=\"tabs\" aria-label=\"Основна навігація\"><button class=\"on\" data-tab=\"overview\" aria-current=\"page\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></svg><span>Огляд</span></button><button data-tab=\"tests\" aria-current=\"false\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z\"/><path d=\"M8 7h8M8 11h5\"/></svg><span>Бібліотека тестів</span></button><button data-tab=\"edit\" aria-current=\"false\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5\"/></svg><span>Редактор</span></button><button data-tab=\"assign\" aria-current=\"false\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m22 2-7 20-4-9-9-4Z M22 2 11 13\"/></svg><span>Призначення</span></button><button data-tab=\"results\" aria-current=\"false\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 3v18h18M8 16v-5M13 16V7M18 16V4\"/></svg><span>Результати</span></button><button data-tab=\"team\" aria-current=\"false\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/></svg><span>Команда</span></button></nav><div class=\"sidebar-foot\"><b><span class=\"online-dot\"></span>Панель супервайзера</b>Навчання, що дає результат</div></header><div class=\"topbar\"><div class=\"breadcrumb\">Робочий простір <span>/ <span id=\"currentPage\">Огляд</span></span></div><div class=\"profile\"><div class=\"profile-name\"><b>Супервайзер</b>Керування навчанням</div><button type=\"button\" class=\"alt hidden\" id=\"accessButton\"></button></div></div>\n<div class=\"card\" id=\"notice\" role=\"status\" aria-live=\"polite\">Перевірка доступу…</div>\n\n<section id=\"loginCard\" class=\"card hidden\" aria-labelledby=\"loginTitle\">\n<h2 id=\"loginTitle\">Вхід до Центру знань</h2>\n<form id=\"loginForm\" method=\"post\" action=\"/api/web-access/login\">\n<label for=\"browserLogin\">Логін</label>\n<input id=\"browserLogin\" name=\"username\" inputmode=\"numeric\" autocomplete=\"username\" maxlength=\"16\" required>\n<label for=\"browserPassword\">Вебпароль</label>\n<input id=\"browserPassword\" name=\"password\" type=\"password\" autocomplete=\"current-password\" maxlength=\"64\" required>\n<button id=\"loginSubmit\">Увійти</button>\n<p id=\"loginStatus\" role=\"status\"></p>\n</form>\n<details><summary>Перший вхід або забули вебпароль?</summary>\n<p>У Telegram-боті відкрийте /admin, натисніть «Відкрити вебпанель», а потім «Вхід з комп’ютера». Там можна створити вебпароль і скопіювати логін.</p>\n</details>\n</section>\n<dialog id=\"webAccessDialog\" aria-labelledby=\"webAccessTitle\">\n<h2 id=\"webAccessTitle\">Вхід з комп’ютера</h2>\n<p>Створіть вебпароль і збережіть його в менеджері паролів. Новий пароль завершує попередні сеанси в браузері.</p>\n<div id=\"webAccessCredentials\" class=\"hidden\">\n<label for=\"webAccessLogin\">Логін</label><input id=\"webAccessLogin\" autocomplete=\"off\" readonly>\n<label for=\"webAccessPassword\">Вебпароль</label><input id=\"webAccessPassword\" autocomplete=\"off\" readonly>\n</div>\n<div class=\"composer-actions\">\n<button type=\"button\" id=\"generateAccess\">Створити вебпароль</button>\n<button type=\"button\" id=\"copyAccessPassword\" class=\"alt hidden\">Копіювати пароль</button>\n<button type=\"button\" id=\"closeAccess\" class=\"alt\">Закрити</button>\n</div>\n<p id=\"accessStatus\" role=\"status\"></p>\n</dialog>\n<div id=\"app\" class=\"hidden\">\n\n\n\n<section id=\"overview\">\n<div class=\"page-heading\"><div><div class=\"eyebrow\">Навчання команди</div><h2>Усе починається зі знань.</h2><p>Призначайте тести й тримайте прогрес команди у фокусі.</p></div><button data-go=\"edit\">+ Створити тест</button></div><div id=\"stats\" class=\"grid\"></div><div class=\"overview-grid\"><div class=\"card\"><div class=\"section-heading\"><h3>Останні призначення</h3><button class=\"link-button\" data-go=\"results\">Усі результати ↗</button></div><div id=\"recent\"></div></div><aside class=\"card insight\"><div class=\"insight-title\">ПРОГРЕС КОМАНДИ</div><div id=\"completion\"></div><div class=\"tip\"><b>Наступний крок</b>Відкрийте результати, щоб визначити теми для наступного навчання.</div></aside></div>\n</section>\n\n<section id=\"tests\" class=\"hidden\">\n<div class=\"page-heading\"><div><div class=\"eyebrow\">Робочий простір</div><h2>Бібліотека тестів</h2><p>Знання команди, зібрані в одному місці.</p></div><button data-go=\"edit\">+ Створити тест</button></div>\n<div class=\"searchbar\"><input id=\"testSearch\" type=\"search\" aria-label=\"Пошук тестів\" placeholder=\"Пошук за назвою тесту…\"><select id=\"testStatus\" aria-label=\"Статус тестів\"><option value=\"active\">Активні тести</option><option value=\"all\">Усі тести</option><option value=\"archived\">Архів</option></select><span class=\"muted\" id=\"testCount\"></span></div><div id=\"testList\"></div>\n</section>\n\n<section id=\"edit\" class=\"hidden\">\n<div class=\"page-heading\"><div><h2 id=\"editorTitle\">Новий тест</h2><p>Додайте запитання, позначте правильні відповіді та збережіть тест у бібліотеці.</p></div><button id=\"reset\" class=\"alt\">Почати новий тест</button></div>\n<div class=\"composer\">\n<section class=\"card composer-settings\" aria-labelledby=\"settingsTitle\">\n<h3 id=\"settingsTitle\">Налаштування тесту</h3>\n<label for=\"title\">Назва тесту</label>\n<input id=\"title\" placeholder=\"Стандарти сервісу\" maxlength=\"180\" required>\n<details class=\"composer-details\">\n<summary>Опис і параметри</summary>\n<label for=\"description\">Опис</label>\n<textarea id=\"description\" maxlength=\"1000\" placeholder=\"Що перевіряємо і для кого цей тест\"></textarea>\n<div class=\"form-row\"><div><label for=\"pass\">Прохідний бал, %</label>\n<input id=\"pass\" type=\"number\" min=\"0\" max=\"100\" value=\"80\"></div>\n<div><label for=\"draw\">Кількість випадкових питань</label>\n<input id=\"draw\" type=\"number\" min=\"0\" max=\"100\" value=\"0\" aria-describedby=\"drawHint\"><div id=\"drawHint\" class=\"field-help\">0 — усі запитання</div></div></div>\n<label class=\"check\"><input type=\"checkbox\" id=\"learningEnabled\"> Підготовка перед тестом</label>\n<p class=\"field-help\">Для підготовки додайте матеріал до кожного питання.</p>\n</details>\n</section>\n<section class=\"card paste-card\" aria-labelledby=\"pasteTitle\">\n<div class=\"section-heading\"><h3 id=\"pasteTitle\">Додати питання з тексту</h3><button type=\"button\" id=\"pasteExample\" class=\"alt\">Вставити приклад</button></div>\n<label for=\"pasteText\">Питання та варіанти відповідей</label>\n<p id=\"pasteHint\" class=\"field-help\">Кожен варіант з нового рядка. Між питаннями залиште порожній рядок. Якщо і питання, і варіанти пронумеровані, порожній рядок допоможе їх розрізнити. Варіанти можна позначити літерами, цифрами чи маркерами.</p>\n<textarea id=\"pasteText\" maxlength=\"250000\" spellcheck=\"false\" aria-describedby=\"pasteHint\" placeholder=\"1. Яку інформацію можна передати клієнту?&#10;А) Дані після перевірки особи&#10;Б) Дані без перевірки&#10;&#10;2. Що зробити перед закриттям звернення?&#10;А) Підсумувати рішення&#10;Б) Закрити діалог одразу\"></textarea>\n<div class=\"composer-actions\"><button type=\"button\" id=\"parseText\">Розпізнати й додати</button><span id=\"pasteStatus\" role=\"status\"></span></div>\n<details class=\"composer-details json-import\">\n<summary>Імпорт із JSON</summary>\n<p class=\"field-help\">Виберіть файл .json або вставте JSON. Для одного тесту відкриється редактор, для пакета — список тестів перед імпортом.</p>\n<label for=\"jsonFile\">Файл JSON</label>\n<input id=\"jsonFile\" type=\"file\" accept=\".json,application/json\">\n<label for=\"import\">Вставити JSON</label>\n<textarea id=\"import\" spellcheck=\"false\" placeholder='{\"tests\":[...]}'></textarea>\n<button id=\"importBtn\" class=\"alt\" type=\"button\">Перевірити JSON</button>\n<p id=\"jsonStatus\" class=\"field-help\" role=\"status\"></p>\n<div id=\"jsonPreview\" class=\"hidden\">\n<h4 id=\"jsonSummary\" tabindex=\"-1\"></h4>\n<div id=\"packageTests\"></div>\n<button id=\"savePackage\" type=\"button\">Додати тести до бібліотеки</button>\n</div>\n</details>\n</section>\n<section class=\"composer-questions\" aria-labelledby=\"questionsTitle\">\n<div class=\"section-heading\"><div><h3 id=\"questionsTitle\">Запитання та відповіді</h3><p class=\"field-help\">Натисніть на один або кілька правильних варіантів у кожному питанні.</p></div><button id=\"add\" class=\"alt\">+ Питання вручну</button></div>\n<div id=\"builder\"></div>\n</section>\n<div class=\"card composer-footer\">\n<div><strong id=\"questionProgress\" aria-live=\"polite\"></strong><button id=\"nextIncomplete\" class=\"link-button hidden\" type=\"button\">До незаповненого питання</button><p id=\"saveStatus\" class=\"field-help\" role=\"status\"></p></div>\n<button id=\"save\">Зберегти тест</button>\n</div>\n</div>\n</section>\n\n<section id=\"assign\" class=\"hidden\">\n<div class=\"page-heading\"><div><div class=\"eyebrow\">Робочий простір</div><h2>Призначення тесту</h2><p>Оберіть тест, учасників і зручний термін завершення.</p></div></div>\n<div class=\"card assignment-card\">\n<label for=\"testSelect\">Навчальний тест</label>\n<select id=\"testSelect\"></select>\n<label>Оператори</label>\n<div id=\"people\"></div>\n<button id=\"all\" class=\"alt\">Усі</button>\n<button id=\"none\" class=\"alt\">Очистити</button>\n<label for=\"deadline\">Дедлайн (час за Києвом)</label>\n<input id=\"deadline\" type=\"datetime-local\">\n<label for=\"tries\">Повних спроб</label>\n<input id=\"tries\" type=\"number\" min=\"1\" max=\"10\" value=\"1\">\n<label for=\"corrections\">Виправлень у спробі</label>\n<input id=\"corrections\" type=\"number\" min=\"0\" max=\"10\" value=\"0\">\n<label class=\"check\">\n<input type=\"checkbox\" id=\"notify\" checked>\nНадіслати оператору сповіщення\n</label>\n<button id=\"assignBtn\">Призначити тест →</button>\n</div>\n<div class=\"card\" id=\"assignmentHistory\">\n<div class=\"section-heading\"><h3>Призначення операторів</h3></div>\n<label for=\"assignmentSearch\">Знайти за оператором або тестом</label>\n<input id=\"assignmentSearch\" type=\"search\" placeholder=\"Ім’я оператора або назва тесту\">\n<div id=\"assignmentList\"></div>\n</div>\n</section>\n\n<section id=\"results\" class=\"hidden\">\n<div class=\"page-heading\"><div><div class=\"eyebrow\">Робочий простір</div><h2>Результати навчання</h2><p>Від загальної картини — до кожної відповіді.</p></div></div>\n<div class=\"report-tools\"><select id=\"filter\" aria-label=\"Фільтр результатів\">\n<option value=\"all\">Усі</option>\n<option value=\"passed\">Складено</option>\n<option value=\"failed\">Не складено</option>\n<option value=\"active\">У процесі</option>\n</select>\n<button id=\"csv\" class=\"alt\">↓ Експорт CSV</button></div>\n<div id=\"reports\"></div>\n<div id=\"answers\"></div>\n</section>\n\n<section id=\"team\" class=\"hidden\">\n<div class=\"page-heading\"><div><div class=\"eyebrow\">Робочий простір</div><h2>Ваша команда</h2><p>Учасники та робочі позначки для зручного керування.</p></div></div>\n<div id=\"teamList\"></div>\n</section>\n</div>\n<footer class=\"dashboard-footer\"><span>Центр знань · Простір розвитку команди</span><span>Зроблено для щоденної роботи</span></footer></main>\n\n<script>\n(function(){\n'use strict';\n\nconst el=id=>document.getElementById(id);\nconst safe=s=>String(s??'').replace(\n  /[&<>\"']/g,\n  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c])\n);\n\nconst icons={\"overview\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><rect x=\\\"3\\\" y=\\\"3\\\" width=\\\"7\\\" height=\\\"7\\\" rx=\\\"1.5\\\"/><rect x=\\\"14\\\" y=\\\"3\\\" width=\\\"7\\\" height=\\\"7\\\" rx=\\\"1.5\\\"/><rect x=\\\"3\\\" y=\\\"14\\\" width=\\\"7\\\" height=\\\"7\\\" rx=\\\"1.5\\\"/><rect x=\\\"14\\\" y=\\\"14\\\" width=\\\"7\\\" height=\\\"7\\\" rx=\\\"1.5\\\"/></svg>\", \"book\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z\\\"/><path d=\\\"M8 7h8M8 11h5\\\"/></svg>\", \"edit\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5\\\"/></svg>\", \"assign\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"m22 2-7 20-4-9-9-4Z M22 2 11 13\\\"/></svg>\", \"results\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"M3 3v18h18M8 16v-5M13 16V7M18 16V4\\\"/></svg>\", \"users\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8\\\"/><circle cx=\\\"9\\\" cy=\\\"7\\\" r=\\\"4\\\"/></svg>\", \"check\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><circle cx=\\\"12\\\" cy=\\\"12\\\" r=\\\"9\\\"/><path d=\\\"m8 12 3 3 5-6\\\"/></svg>\", \"clock\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><circle cx=\\\"12\\\" cy=\\\"12\\\" r=\\\"9\\\"/><path d=\\\"M12 7v5l3 2\\\"/></svg>\", \"logo\": \"<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\" aria-hidden=\\\"true\\\"><path d=\\\"m3 7 9-4 9 4-9 4ZM6 10v7c4 4 8 4 12 0v-7\\\"/></svg>\"};\nconst titleName=s=>String(s??'').replace(/кото[\\s–—-]*бліц/gi,'Перевірка знань').replace(/(^|\\s)СВ(?=\\s|$)/g,'$1').replace(/\\s{2,}/g,' ').trim();\nconst titleSafe=s=>safe(titleName(s));\nconst identityMeta=x=>[x.username?'@'+x.username:'',x.operator_tag||''].filter(Boolean).join(' · ')||'Учасник команди';\nconst initials=s=>safe(String(s||'Учасник').split(/\\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase());\nconst status=x=>x.passed===1?['success','Складено']:x.active?['active','У процесі']:x.deadline&&Date.parse(x.deadline)<Date.now()?['failed','Термін минув']:x.best!==null?['failed','Не складено']:['waiting','Очікує'];\nconst badge=x=>{let s=status(x);return '<span class=\"pill '+s[0]+'\">'+s[1]+'</span>';};\nconst empty=t=>'<div class=\"empty\">'+icons.book+safe(t)+'</div>';\nconst app=window.Telegram?.WebApp;\napp?.ready();\napp?.expand();\nconst init=app?.initData||'';\n\nlet state={users:[],tests:[],assignments:[],reports:[]};\nlet qs=[];\nlet editing=null;\nlet saving=false;\nlet previewedPackage=null;\nlet packageBusy=false;\n\nfunction parseQuestionText(source) {\n  const lines = source.replace(/\\r\\n?/g, '\\n').replace(/\\uFEFF/g, '').split('\\n');\n  const questionMarker = /^(?:питання|запитання|question)\\s*(?:№\\s*)?\\d*\\s*[:.)-]\\s*(.+)$/iu;\n  const numberMarker = /^(\\d{1,3})[.)]\\s*(\\S.*)$/u;\n  const optionMarker = /^(?:[A-FАБВГҐДЕЄЖ][.)\\]:]|[-–—•●▪*])\\s*(\\S.*)$/iu;\n  const questions = [];\n  let current = null;\n  let gap = true;\n\n  function start(question, number, indent) {\n    current = { question, options: [], correct: [], points: 1 };\n    questions.push(current);\n    return { number, indent, lastOption: null };\n  }\n\n  let heading;\n  for (const raw of lines) {\n    const line = raw.trim();\n    if (!line) {\n      gap = true;\n      continue;\n    }\n    const indent = raw.length - raw.trimStart().length;\n    const explicit = line.match(questionMarker);\n    const numbered = line.match(numberMarker);\n    const option = line.match(optionMarker);\n    const number = numbered ? Number(numbered[1]) : null;\n    const canStartNumberedQuestion = numbered && current && indent <= heading.indent &&\n      (heading.lastOption === null || number !== heading.lastOption + 1 || numbered[2].endsWith('?'));\n    const numberedHeading = canStartNumberedQuestion && (\n      (heading.number !== null && number === heading.number + 1 && (current.options.length >= 2 || gap)) ||\n      (gap && current.options.length >= 2)\n    );\n\n    if (!current || explicit || numberedHeading || (gap && !option && !numbered && current.options.length >= 2) ||\n        (!option && !numbered && line.endsWith('?') && current.options.length >= 2)) {\n      heading = start(explicit?.[1] ?? numbered?.[2] ?? line, number, indent);\n    } else {\n      current.options.push(option?.[1] ?? numbered?.[2] ?? line);\n      heading.lastOption = number;\n    }\n    gap = false;\n  }\n\n  return questions;\n}\n\nfunction note(t,bad=false){\n  el('notice').textContent=t;\n  el('notice').className='card '+(bad?'error':'');\n}\n\nasync function api(path,method='GET',body){\n  let r=await fetch(path,{\n    method,\n    headers:{\n      ...(init?{'X-Telegram-Init-Data':init}:{}),\n      ...(body?{'Content-Type':'application/json'}:{})\n    },\n    ...(body?{body:JSON.stringify(body)}:{})\n  });\n  let d=await r.json();\n  if(!r.ok){\n    if(!init&&r.status===401&&!path.startsWith('/api/web-access/'))showLogin('Увійдіть, щоб продовжити.');\n    const error=Error(d.error||'Помилка API');\n    error.status=r.status;\n    throw error;\n  }\n  return d;\n}\n\nfunction tab(name){\n  document.querySelectorAll('[data-tab]').forEach(b=>\n    (b.classList.toggle('on',b.dataset.tab===name),b.setAttribute('aria-current',b.dataset.tab===name?'page':'false'))\n  );\n  ['overview','tests','edit','assign','results','team'].forEach(x=>\n    el(x).classList.toggle('hidden',x!==name)\n  );\n  el('currentPage').textContent=document.querySelector('[data-tab=\"'+name+'\"] span').textContent;\n  if(name==='results')loadReports();\n}\n\ndocument.querySelectorAll('[data-tab]').forEach(b=>\n  b.onclick=()=>tab(b.dataset.tab)\n);\n\ndocument.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>tab(b.dataset.go));\nel('testSearch').oninput=()=>drawTests();\nel('testStatus').onchange=()=>drawTests();\n\nfunction questionIssue(q){\n  if(!q.question.trim())return 'Додайте текст питання.';\n  if(q.question.length>2000)return 'Скоротіть питання до 2000 символів.';\n  if(q.options.length<2||q.options.length>6)return 'Потрібно від 2 до 6 варіантів.';\n  if(q.options.some(o=>!o.trim()))return 'Заповніть або видаліть порожні варіанти.';\n  if(q.options.some(o=>o.length>120))return 'Скоротіть кожен варіант до 120 символів.';\n  if(!q.correct.length)return 'Позначте правильну відповідь.';\n  if(!Number.isInteger(q.points)||q.points<1||q.points>100)return 'Вкажіть від 1 до 100 балів.';\n  if(q.learning_text?.length>3000)return 'Скоротіть матеріал до 3000 символів.';\n  if(el('learningEnabled').checked&&!q.learning_text?.trim())return 'Додайте матеріал або вимкніть підготовку.';\n  if(q.source_url){\n    try{\n      const source=new URL(q.source_url);\n      if(source.protocol!=='https:'||source.username||source.password||source.href.length>1000)return 'Перевірте HTTPS-посилання.';\n    }catch{return 'Перевірте HTTPS-посилання.';}\n  }\n  return '';\n}\n\nfunction updateProgress(){\n  const issues=qs.map(questionIssue);\n  const ready=issues.filter(issue=>!issue).length;\n  el('questionProgress').textContent=qs.length?'Готові питання: '+ready+' із '+qs.length:'Додайте перше питання';\n  el('nextIncomplete').classList.toggle('hidden',ready===qs.length);\n  el('save').disabled=saving||packageBusy||!qs.length;\n  el('add').disabled=qs.length>=100;\n  document.querySelectorAll('[data-question-state]').forEach(label=>{\n    const issue=issues[Number(label.dataset.questionState)];\n    label.textContent=issue||'Готово';\n    label.dataset.ready=String(!issue);\n  });\n}\n\nfunction drawBuilder(){\n  el('builder').innerHTML=qs.map((q,i)=>\n    '<article class=\"question\" id=\"question-'+i+'\" data-card=\"'+i+'\" tabindex=\"-1\">'+\n    '<div class=\"question-head\"><h4>Питання '+(i+1)+'</h4><span class=\"question-state\" data-question-state=\"'+i+'\"></span></div>'+\n    '<textarea aria-label=\"Текст питання '+(i+1)+'\" data-field=\"question\" data-question>'+safe(q.question)+'</textarea>'+\n    q.options.map((o,n)=>\n      '<div class=\"answer-row\"><div class=\"answer-option\">'+\n      '<input type=\"checkbox\" data-correct=\"'+n+'\" aria-label=\"Правильний варіант '+(n+1)+'\" '+(q.correct.includes(n)?'checked':'')+'>'+\n      '<textarea rows=\"1\" data-option=\"'+n+'\" aria-label=\"Варіант '+(n+1)+'\" placeholder=\"Варіант '+(n+1)+'\">'+safe(o)+'</textarea>'+\n      '</div><button type=\"button\" class=\"alt\" data-remove-option=\"'+n+'\" aria-label=\"Видалити варіант '+(n+1)+'\">×</button></div>'\n    ).join('')+\n    '<div class=\"question-tools\"><button type=\"button\" class=\"alt\" data-add-option '+(q.options.length>=6?'disabled':'')+'>+ Варіант</button>'+\n    '<button type=\"button\" class=\"danger\" data-remove-question>Видалити питання</button></div>'+\n    '<details class=\"composer-details\"><summary>Бали, пояснення й матеріали</summary>'+\n    '<label for=\"points-'+i+'\">Бали</label><input id=\"points-'+i+'\" data-field=\"points\" type=\"number\" min=\"1\" max=\"100\" value=\"'+safe(q.points)+'\">'+\n    '<label for=\"explanation-'+i+'\">Пояснення після відповіді</label><textarea id=\"explanation-'+i+'\" maxlength=\"2000\" data-field=\"explanation\">'+safe(q.explanation)+'</textarea>'+\n    '<label for=\"learning-'+i+'\">Матеріал для повторення</label><textarea id=\"learning-'+i+'\" maxlength=\"3000\" data-field=\"learning_text\">'+safe(q.learning_text)+'</textarea>'+\n    '<label for=\"source-'+i+'\">HTTPS-посилання на джерело</label><input id=\"source-'+i+'\" type=\"url\" maxlength=\"1000\" data-field=\"source_url\" value=\"'+safe(q.source_url)+'\">'+\n    '</details></article>'\n  ).join('')||'<div class=\"question-empty\">Тут з’являться додані питання.</div>';\n  updateProgress();\n}\n\nfunction editorStatus(id,message,error=false){\n  el(id).textContent=message;\n  el(id).classList.toggle('error-text',error);\n}\n\nfunction focusQuestion(index){\n  el('question-'+index)?.focus();\n}\n\nel('builder').addEventListener('input',event=>{\n  const input=event.target;\n  const q=qs[Number(input.closest('[data-card]').dataset.card)];\n  if(input.hasAttribute('data-correct')){\n    const index=Number(input.dataset.correct);\n    q.correct=input.checked?[...q.correct,index].sort((a,b)=>a-b):q.correct.filter(n=>n!==index);\n  }else if(input.hasAttribute('data-option')){\n    q.options[Number(input.dataset.option)]=input.value;\n  }else if(input.dataset.field){\n    q[input.dataset.field]=input.dataset.field==='points'?input.valueAsNumber:input.value;\n  }\n  editorStatus('saveStatus','');\n  updateProgress();\n});\n\nel('builder').addEventListener('click',event=>{\n  const button=event.target.closest('button');\n  if(!button)return;\n  const index=Number(button.closest('[data-card]').dataset.card);\n  const q=qs[index];\n  if(button.hasAttribute('data-remove-question')){\n    qs.splice(index,1);\n    drawBuilder();\n    if(qs.length)focusQuestion(Math.min(index,qs.length-1));\n    else el('add').focus();\n    return;\n  }\n  if(button.hasAttribute('data-add-option')){\n    q.options.push('');\n  }else{\n    const option=Number(button.dataset.removeOption);\n    q.options.splice(option,1);\n    q.correct=q.correct.filter(n=>n!==option).map(n=>n>option?n-1:n);\n  }\n  drawBuilder();\n  const optionIndex=button.hasAttribute('data-add-option')?q.options.length-1:Math.min(Number(button.dataset.removeOption),q.options.length-1);\n  (el('question-'+index).querySelector('[data-option=\"'+optionIndex+'\"]')||el('question-'+index).querySelector('[data-add-option]')).focus();\n});\n\nel('learningEnabled').onchange=updateProgress;\nel('nextIncomplete').onclick=()=>focusQuestion(qs.findIndex(questionIssue));\nel('add').onclick=()=>{\n  if(qs.length>=100)return;\n  qs.push({question:'',options:['',''],correct:[],points:1});\n  drawBuilder();\n  el('question-'+(qs.length-1)).querySelector('[data-question]').focus();\n};\n\nel('pasteExample').onclick=()=>{\n  if(el('pasteText').value.trim()&&!confirm('Замінити вставлений текст прикладом?'))return;\n  el('pasteText').value=el('pasteText').placeholder;\n  el('pasteText').focus();\n};\nel('pasteText').oninput=()=>editorStatus('pasteStatus','');\nel('parseText').onclick=()=>{\n  const parsed=parseQuestionText(el('pasteText').value);\n  if(!parsed.length){\n    editorStatus('pasteStatus','Вставте текст із питаннями.',true);\n    el('pasteText').focus();\n    return;\n  }\n  if(qs.length+parsed.length>100){\n    editorStatus('pasteStatus','Один тест може містити до 100 питань. Скоротіть текст або розділіть його на тести.',true);\n    return;\n  }\n  const first=qs.length;\n  qs.push(...parsed);\n  el('pasteText').value='';\n  editorStatus('pasteStatus','Додано питань: '+parsed.length+'. Перевірте розподіл і позначте відповіді.');\n  drawBuilder();\n  focusQuestion(first);\n};\n\nfunction reset(){\n  editing=null;\n  el('editorTitle').textContent='Новий тест';\n  el('title').value='';\n  el('description').value='';\n  el('pass').value=80;\n  el('draw').value=0;\n  el('learningEnabled').checked=false;\n  el('pasteText').value='';\n  clearPackageImport();\n  editorStatus('pasteStatus','');\n  editorStatus('saveStatus','');\n  qs=[];\n  drawBuilder();\n}\nel('reset').onclick=()=>{\n  if((editing||qs.length||el('title').value||el('description').value||el('pasteText').value||el('import').value)&&\n      !confirm('Почати новий тест? Незбережені зміни буде втрачено.'))return;\n  reset();\n  el('title').focus();\n};\n\nasync function refresh(){\n  state=await api('/api/data');\n\n  let a=state.assignments;\n  let done=a.filter(x=>x.passed===1);\n  let scored=a.filter(x=>x.best!==null);\n  let avg=scored.length\n    ?Math.round(scored.reduce((s,x)=>s+Number(x.best),0)/scored.length)+'%'\n    :'—';\n\n  let active=a.filter(x=>x.active&&!x.passed).length;\n  let rate=a.length?Math.round(done.length*100/a.length):0;\n  el('stats').innerHTML=[\n    ['Призначено тестів',a.length,'book','Учасників у команді: '+state.users.length],\n    ['Успішно складено',done.length,'check','<span>'+rate+'%</span> від усіх призначень'],\n    ['Середній результат',avg,'results','За завершеними тестами'],\n    ['У процесі',active,'clock','Активні спроби учасників']\n  ].map(x=>'<div class=\"stat\"><div class=\"stat-head\">'+x[0]+'<span class=\"stat-icon\">'+icons[x[2]]+'</span></div><b>'+x[1]+'</b><div class=\"stat-foot\">'+x[3]+'</div></div>').join('');\n  el('completion').innerHTML='<div class=\"completion-ring\" style=\"--rate:'+rate+'\"><div><b>'+rate+'%</b><small>склали тест</small></div></div>'+[['#146b58','Складено',done.length],['#7393bc','У процесі',active],['#c4ceca','Інші призначення',a.length-done.length-active]].map(x=>'<div class=\"legend-row\"><span><i class=\"dot\" style=\"background:'+x[0]+'\"></i>'+x[1]+'</span><b>'+x[2]+'</b></div>').join('');\n  el('recent').innerHTML=a.length?'<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>УЧАСНИК</th><th>ТЕСТ</th><th>СТАТУС</th><th>СПРОБИ</th><th>РЕЗУЛЬТАТ</th></tr></thead><tbody>'+a.slice(0,10).map(x=>'<tr><td><div class=\"person-cell\"><span class=\"avatar\" aria-hidden=\"true\">'+initials(x.name)+'</span><div><b>'+safe(x.name)+'</b><small>'+safe(identityMeta(x))+'</small></div></div></td><td>'+titleSafe(x.title)+'</td><td>'+badge(x)+'</td><td class=\"muted\">'+x.used+' / '+x.max_attempts+'</td><td><span class=\"score\">'+(x.best===null?'—':safe(x.best)+'%')+'</span>'+(x.best===null?'':'<span class=\"score-track\"><i style=\"width:'+Math.max(0,Math.min(100,Number(x.best)||0))+'%\"></i></span>')+'</td></tr>').join('')+'</tbody></table></div><div class=\"table-meta\">Показано '+Math.min(a.length,10)+' із '+a.length+' призначень</div>':empty('Поки немає призначень. Почніть із бібліотеки тестів.');\n\n  el('testSelect').innerHTML=state.tests\n    .filter(x=>!x.archived)\n    .map(x=>\n      '<option value=\"'+safe(x.id)+'\">'+titleSafe(x.title)+'</option>'\n    ).join('');\n\n  el('people').innerHTML=state.users.filter(x=>!x.blocked).map(x=>\n    '<label class=\"check\"><input type=\"checkbox\" data-person=\"'+\n    safe(x.id)+'\"> '+safe(x.display_name||x.name)+\n    ' · '+safe(identityMeta(x))+'</label>'\n  ).join('')||'<p class=\"muted\">Немає операторів із доступом.</p>';\n\n  drawTests();\n  drawTeam();\n  drawAssignments();\n}\n\nfunction drawAssignments(){\n  const query=el('assignmentSearch').value.trim().toLocaleLowerCase('uk');\n  const matches=state.assignments.filter(x=>[x.name,x.username,x.operator_tag,titleName(x.title)]\n    .some(value=>String(value||'').toLocaleLowerCase('uk').includes(query)));\n  el('assignmentList').innerHTML=matches.length?\n    '<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>ОПЕРАТОР</th><th>ТЕСТ</th><th>СТАТУС</th><th></th></tr></thead><tbody>'+\n    matches.map(x=>'<tr><td>'+safe(x.name)+'</td><td>'+titleSafe(x.title)+'</td><td>'+badge(x)+'</td><td>'+\n      '<button type=\"button\" class=\"danger\" data-delete-assignment=\"'+safe(x.id)+'\">Видалити призначення</button></td></tr>').join('')+\n    '</tbody></table></div>':empty('Призначень за цим пошуком немає.');\n}\nel('assignmentSearch').oninput=drawAssignments;\n\nfunction drawTests(){\n  let query=el('testSearch').value.toLocaleLowerCase('uk');\n  let filter=el('testStatus').value;\n  let tests=state.tests.filter(x=>titleName(x.title).toLocaleLowerCase('uk').includes(query)&&(filter==='all'||(filter==='archived'?x.archived:!x.archived)));\n  el('testCount').textContent='Знайдено: '+tests.length;\n  el('testList').innerHTML=tests.map(x=>\n    '<div class=\"card\"><div class=\"test-icon\">'+icons.book+'</div><b>'+titleSafe(x.title)+'</b> '+\n    (x.archived?'<span class=\"pill\">Архів</span>':'')+\n    '<div class=\"muted\">'+x.question_count+\n    ' питань · призначень: '+x.assigned+\n    ' · прохідний '+x.pass_percent+'%</div>'+\n    '<div class=\"toolbar\">'+\n    '<button class=\"alt\" data-edit=\"'+safe(x.id)+'\">Редагувати</button>'+\n    '<button class=\"alt\" data-copy=\"'+safe(x.id)+'\">Копіювати</button>'+\n    '<button class=\"alt\" data-archive=\"'+safe(x.id)+'\">'+\n    (x.archived?'Відновити':'Архівувати')+'</button>'+\n    '<button class=\"danger\" data-delete=\"'+safe(x.id)+'\">Видалити</button>'+\n    '</div></div>'\n  ).join('')||empty('Тестів не знайдено. Створіть новий або змініть пошук.');\n\n  document.querySelectorAll('[data-edit]').forEach(b=>\n    b.onclick=async()=>{\n      try{\n        let t=state.tests.find(x=>x.id===b.dataset.edit);\n        if(t.assigned){\n          note('Цей тест уже призначений. Зроби копію для редагування.',true);\n          return;\n        }\n        let d=await api('/api/test/detail?id='+encodeURIComponent(t.id));\n        reset();\n        editing=t.id;\n        el('editorTitle').textContent='Редагування тесту';\n        el('title').value=titleName(d.test.title);\n        el('description').value=d.test.description;\n        el('pass').value=d.test.pass_percent;\n        el('draw').value=d.test.draw_count;\n        el('learningEnabled').checked=!!d.test.learning_enabled;\n        qs=d.questions;\n        drawBuilder();\n        tab('edit');\n      }catch(e){note(e.message,true);}\n    }\n  );\n\n  document.querySelectorAll('[data-copy]').forEach(b=>\n    b.onclick=async()=>{\n      try{\n        await api('/api/test/duplicate','POST',{id:b.dataset.copy});\n        await refresh();\n        note('Копію створено');\n      }catch(e){note(e.message,true);}\n    }\n  );\n\n  document.querySelectorAll('[data-archive]').forEach(b=>\n    b.onclick=async()=>{\n      try{\n        let t=state.tests.find(x=>x.id===b.dataset.archive);\n        await api('/api/test/archive','POST',{\n          id:t.id,\n          archived:!t.archived\n        });\n        await refresh();\n        note('Статус тесту змінено');\n      }catch(e){note(e.message,true);}\n    }\n  );\n\n  document.querySelectorAll('[data-delete]').forEach(b=>\n    b.onclick=async()=>{\n      const test=state.tests.find(x=>x.id===b.dataset.delete);\n      if(!test||!confirm('Назавжди видалити тест «'+titleName(test.title)+'»? Будуть видалені всі його призначення, спроби й результати.'))return;\n      b.disabled=true;\n      try{\n        await api('/api/test/delete','POST',{id:test.id,confirm:true});\n        el('answers').replaceChildren();\n        await refresh();\n        note('Тест і його історію видалено');\n      }catch(e){note(e.message,true);}\n      finally{b.disabled=false;}\n    }\n  );\n}\n\nfunction drawTeam(){\n  el('teamList').innerHTML=state.users.map(x=>\n    '<div class=\"card\"><b>'+safe(x.display_name||x.name)+'</b>'+\n    (x.blocked?'<span class=\"pill failed\">Доступ вимкнено</span>':'')+\n    '<div class=\"muted\">'+safe(identityMeta(x))+' · ID '+safe(x.id)+'</div>'+\n    '<label>Власне ім’я</label>'+\n    '<input aria-label=\"Власне ім’я учасника\" data-name=\"'+safe(x.id)+'\" value=\"'+safe(x.display_name||'')+'\">'+\n    '<label>Позначка / зміна</label>'+\n    '<input aria-label=\"Позначка або зміна\" data-tag=\"'+safe(x.id)+'\" value=\"'+safe(x.operator_tag||'')+'\">'+\n    '<div class=\"team-actions\"><button data-save-person=\"'+safe(x.id)+'\">Зберегти</button>'+\n    (x.admin?'':'<button type=\"button\" class=\"'+(x.blocked?'alt':'danger')+'\" data-operator-access=\"'+safe(x.id)+'\">'+\n      (x.blocked?'Повернути доступ':'Вимкнути доступ')+'</button>')+'</div>'+\n    '</div>'\n  ).join('')||empty('Учасники з’являться після першого звернення до бота.');\n\n  document.querySelectorAll('[data-save-person]').forEach(b=>\n    b.onclick=async()=>{\n      try{\n        let id=b.dataset.savePerson;\n        await api('/api/operator','POST',{\n          id,\n          display_name:document.querySelector('[data-name=\"'+id+'\"]').value,\n          operator_tag:document.querySelector('[data-tag=\"'+id+'\"]').value\n        });\n        await refresh();\n        note('Оператора оновлено');\n      }catch(e){note(e.message,true);}\n    }\n  );\n}\n\nel('teamList').addEventListener('click',async event=>{\n  const button=event.target.closest('[data-operator-access]');\n  if(!button||button.disabled)return;\n  const person=state.users.find(x=>x.id===button.dataset.operatorAccess);\n  if(!person)return;\n  const blocked=!person.blocked;\n  if(blocked&&!confirm('Вимкнути доступ для «'+(person.display_name||person.name)+'»? Оператор не зможе відкривати або продовжувати тести в боті.'))return;\n  button.disabled=true;\n  try{\n    await api('/api/operator/access','POST',{id:person.id,blocked});\n    await refresh();\n    note(blocked?'Доступ оператора вимкнено':'Доступ оператора відновлено');\n  }catch(e){note(e.message,true);}\n  finally{button.disabled=false;}\n});\n\nasync function removeAssignment(button){\n  if(button.disabled)return;\n  const id=button.dataset.deleteAssignment;\n  const record=state.assignments.find(x=>x.id===id)||state.reports.find(x=>x.assignment_id===id);\n  if(!record||!confirm('Видалити «'+titleName(record.title)+'» для '+record.name+'? Це прибере призначення, усі спроби й результати цього оператора.'))return;\n  button.disabled=true;\n  try{\n    await api('/api/assignment/delete','POST',{id,confirm:true});\n    el('answers').replaceChildren();\n    await refresh();\n    if(!el('results').classList.contains('hidden'))await loadReports();\n    note('Призначення та його результати видалено');\n  }catch(e){note(e.message,true);}\n  finally{button.disabled=false;}\n}\n\nfor(const id of ['assignmentList','reports'])el(id).addEventListener('click',event=>{\n  const button=event.target.closest('[data-delete-assignment]');\n  if(button)removeAssignment(button);\n});\n\nel('save').onclick=async()=>{\n  if(saving)return;\n  editorStatus('saveStatus','');\n  const title=el('title').value.trim();\n  if(title.length<3){\n    editorStatus('saveStatus','Вкажіть назву тесту від 3 символів.',true);\n    el('title').focus();\n    return;\n  }\n  for(const id of ['pass','draw']){\n    const field=el(id);\n    if(!Number.isInteger(field.valueAsNumber)||!field.checkValidity()){\n      field.closest('details').open=true;\n      editorStatus('saveStatus','Перевірте відсоток і кількість випадкових питань.',true);\n      field.focus();\n      return;\n    }\n  }\n  const incomplete=qs.findIndex(questionIssue);\n  if(incomplete!==-1){\n    editorStatus('saveStatus','Питання '+(incomplete+1)+'. '+questionIssue(qs[incomplete]),true);\n    focusQuestion(incomplete);\n    return;\n  }\n  saving=true;\n  el('edit').inert=true;\n  updateProgress();\n  try{\n    await api('/api/test/save','POST',{\n      id:editing||undefined,\n      title,\n      description:el('description').value,\n      pass_percent:el('pass').valueAsNumber,\n      draw_count:el('draw').valueAsNumber,\n      learning_enabled:el('learningEnabled').checked,\n      questions:qs\n    });\n  }catch(e){\n    editorStatus('saveStatus',e.message,true);\n    return;\n  }finally{\n    saving=false;\n    el('edit').inert=false;\n    updateProgress();\n  }\n  reset();\n  tab('tests');\n  note('Тест збережено');\n  try{await refresh();}\n  catch{note('Тест збережено. Оновіть сторінку, щоб побачити його в бібліотеці.',true);}\n};\n\nfunction clearPackagePreview(){\n  previewedPackage=null;\n  el('jsonPreview').classList.add('hidden');\n  el('packageTests').replaceChildren();\n}\n\nfunction clearPackageImport(){\n  clearPackagePreview();\n  el('import').value='';\n  el('jsonFile').value='';\n  editorStatus('jsonStatus','');\n}\n\nfunction lockPackageImport(locked){\n  packageBusy=locked;\n  for(const id of ['import','jsonFile','importBtn','savePackage','reset','save'])el(id).disabled=locked;\n  if(!locked)updateProgress();\n}\n\nel('import').oninput=()=>{\n  clearPackagePreview();\n  el('jsonFile').value='';\n  editorStatus('jsonStatus','');\n};\n\nel('jsonFile').onchange=async()=>{\n  const file=el('jsonFile').files[0];\n  if(!file)return;\n  clearPackagePreview();\n  if(file.size>1_000_000){\n    el('jsonFile').value='';\n    editorStatus('jsonStatus','Розмір файлу має бути до 1 МБ.',true);\n    return;\n  }\n  lockPackageImport(true);\n  try{\n    el('import').value=await file.text();\n    editorStatus('jsonStatus','Файл завантажено. Натисніть «Перевірити JSON».');\n  }catch{\n    editorStatus('jsonStatus','Не вдалося прочитати файл.',true);\n  }finally{lockPackageImport(false);}\n};\n\nel('importBtn').onclick=async()=>{\n  if(packageBusy)return;\n  clearPackagePreview();\n  editorStatus('jsonStatus','');\n  lockPackageImport(true);\n  try{\n    const input=el('import').value.trim().replace(/^\\x60{3}(?:json)?\\s*\\n([\\s\\S]*?)\\n\\s*\\x60{3}$/i,'$1');\n    if(new TextEncoder().encode(input).length>1_000_000)throw Error('Розмір пакета має бути до 1 МБ.');\n    const data=JSON.parse(input);\n    if(Array.isArray(data)||Array.isArray(data?.tests)){\n      const result=await api('/api/test/import/preview','POST',data);\n      previewedPackage=data;\n      el('jsonSummary').textContent='Тестів: '+result.tests.length+' · Питань: '+result.questionCount;\n      el('packageTests').innerHTML=result.tests.map(test=>\n        '<details><summary>'+safe(test.title)+' · '+test.questions.length+' питань</summary><ol>'+\n        test.questions.map(q=>'<li>'+safe(q.question)+'<br><strong>Правильні:</strong> '+\n          q.correct.map(i=>safe(q.options[i])).join(' · ')+'</li>').join('')+\n        '</ol></details>'\n      ).join('');\n      el('jsonPreview').classList.remove('hidden');\n      el('jsonSummary').focus();\n      return;\n    }\n    if(typeof data?.title!=='string'||!Array.isArray(data.questions)||!data.questions.length||data.questions.length>100||\n        !data.questions.every(q=>typeof q?.question==='string'&&Array.isArray(q.options)&&q.options.every(o=>typeof o==='string')&&\n          Array.isArray(q.correct)&&q.correct.every(n=>Number.isInteger(n)&&n>=0&&n<q.options.length))){\n      throw Error('JSON має містити назву й від 1 до 100 питань із варіантами та масивом правильних відповідей.');\n    }\n    if((editing||qs.length||el('title').value||el('description').value||el('pasteText').value)&&\n        !confirm('Замінити поточну чернетку тестом із JSON?'))return;\n    reset();\n    el('title').value=data.title.slice(0,180);\n    el('description').value=String(data.description??'').slice(0,1000);\n    el('pass').value=data.pass_percent??80;\n    el('draw').value=data.draw_count??0;\n    el('learningEnabled').checked=[true,1].includes(data.learning_enabled);\n    qs=data.questions.map(q=>({...q,correct:[...new Set(q.correct)],points:Number(q.points??1)}));\n    drawBuilder();\n    editorStatus('pasteStatus','Відкрито питань: '+qs.length+'. Перевірте тест і збережіть.');\n    focusQuestion(0);\n  }catch(e){\n    editorStatus('jsonStatus',e instanceof SyntaxError?'Перевірте формат JSON.':e.message,true);\n  }finally{lockPackageImport(false);}\n};\n\nel('savePackage').onclick=async()=>{\n  if(packageBusy||!previewedPackage)return;\n  lockPackageImport(true);\n  editorStatus('jsonStatus','Додаємо тести до бібліотеки…');\n  try{\n    const result=await api('/api/test/import','POST',previewedPackage);\n    clearPackageImport();\n    el('testSearch').value='';\n    el('testStatus').value='active';\n    tab('tests');\n    note('Імпортовано тестів: '+result.created+' · Питань: '+result.questionCount);\n    try{await refresh();}\n    catch{note('Тести збережено. Оновіть сторінку, щоб побачити їх у бібліотеці.',true);}\n  }catch(e){editorStatus('jsonStatus',e.message,true);}\n  finally{lockPackageImport(false);}\n};\n\nel('all').onclick=()=>\n  document.querySelectorAll('[data-person]').forEach(x=>x.checked=true);\n\nel('none').onclick=()=>\n  document.querySelectorAll('[data-person]').forEach(x=>x.checked=false);\n\nel('assignBtn').onclick=async()=>{\n  try{\n    let people=[...document.querySelectorAll('[data-person]:checked')]\n      .map(x=>x.dataset.person);\n    let deadline=el('deadline').value;\n    if(!people.length)throw Error('Обери операторів.');\n\n    let r=await api('/api/assign','POST',{\n      test_id:el('testSelect').value,\n      user_ids:people,\n      deadline:deadline?new Date(deadline).toISOString():null,\n      max_attempts:+el('tries').value,\n      correction_limit:+el('corrections').value,\n      notify:el('notify').checked\n    });\n    await refresh();\n    note('Створено: '+r.created+', сповіщень: '+r.notified+(r.skipped?', пропущено: '+r.skipped:''));\n  }catch(e){note(e.message,true);}\n};\n\nasync function loadReports(){\n  try{\n    state.reports=(await api('/api/results')).items;\n    drawReports();\n  }catch(e){note(e.message,true);}\n}\n\nfunction drawReports(){\n  let filter=el('filter').value;\n  let x=state.reports.filter(r=>\n    filter==='all'||\n    (filter==='passed'&&r.passed===1)||\n    (filter==='failed'&&r.status==='finished'&&r.passed===0)||\n    (filter==='active'&&r.status==='active')\n  );\n\n  el('reports').innerHTML=x.length?'<div class=\"card\"><div class=\"section-heading\"><h3>Історія проходжень</h3><small>Записів: '+x.length+'</small></div><div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>УЧАСНИК</th><th>ТЕСТ</th><th>СТАТУС</th><th>БАЛИ</th><th>РЕЗУЛЬТАТ</th><th></th></tr></thead><tbody>'+x.map(r=>\n    '<tr><td><div class=\"person-cell\"><span class=\"avatar\" aria-hidden=\"true\">'+initials(r.name)+'</span><div><b>'+safe(r.name)+'</b><small>'+safe(identityMeta(r))+'</small></div></div></td><td>'+titleSafe(r.title)+'</td><td><span class=\"pill '+(r.status==='active'?'active':r.passed?'success':'failed')+'\">'+(r.status==='active'?'У процесі':r.passed?'Складено':'Не складено')+'</span></td><td class=\"muted\">'+r.score+' / '+r.max_score+'</td><td class=\"score\">'+(r.percent===null?'—':safe(r.percent)+'%')+'</td><td><button class=\"alt\" data-answer=\"'+safe(r.id)+'\">Відповіді</button>'+(r.assignment_id?'<button type=\"button\" class=\"danger\" data-delete-assignment=\"'+safe(r.assignment_id)+'\">Видалити призначення</button>':'')+'</td></tr>'\n  ).join('')+'</tbody></table></div></div>':empty('Результатів за цим фільтром немає.');\n\n  document.querySelectorAll('[data-answer]').forEach(b=>\n    b.onclick=async()=>{\n      try{\n        let d=await api('/api/answers?id='+encodeURIComponent(b.dataset.answer));\n        el('answers').innerHTML='<h3>Розбір відповідей</h3>'+\n          d.items.map(a=>\n            '<div class=\"card\"><b>'+safe(a.question)+'</b>'+\n            '<p>Обрано: '+safe(a.selected.join('; '))+'</p>'+\n            '<p>Правильно: '+safe(a.correct.join('; '))+'</p>'+\n            (a.right?'<span class=\"pill success\">Правильно</span>':'<span class=\"pill failed\">Варто повторити</span>')+'</div>'\n          ).join('');\n      }catch(e){note(e.message,true);}\n    }\n  );\n}\nel('filter').onchange=drawReports;\n\nel('csv').onclick=()=>{\n  let rows=[\n    ['Оператор','Telegram','Позначка','Тест','Відсоток','Статус','Дата'],\n    ...state.reports.map(x=>[\n      x.name,x.username?'@'+x.username:'',x.operator_tag,titleName(x.title),x.percent??'',\n      x.status==='active'?'У процесі':x.passed?'Складено':'Не складено',\n      x.finished_at||''\n    ])\n  ];\n  let csv=rows.map(r=>\n    r.map(x=>\n      '\"'+String(x??'').replace(/^[=+@-]/,\"'\").replace(/\"/g,'\"\"')+'\"'\n    ).join(',')\n  ).join('\\r\\n');\n\n  let blob=new Blob(['\\uFEFF',csv],{type:'text/csv;charset=utf-8'});\n  let a=document.createElement('a');\n  a.href=URL.createObjectURL(blob);\n  a.download='supervisor-results.csv';\n  a.click();\n  setTimeout(()=>URL.revokeObjectURL(a.href),1000);\n};\n\nfunction showLogin(message=''){\n  document.body.setAttribute('data-locked','');\n  el('app').classList.add('hidden');\n  el('loginCard').classList.remove('hidden');\n  note('');\n  editorStatus('loginStatus',message,!!message);\n}\n\nlet panelReady=false;\nasync function openPanel(){\n  await api('/api/me');\n  if(!panelReady){\n    reset();\n    await refresh();\n    panelReady=true;\n  }\n  el('loginCard').classList.add('hidden');\n  el('app').classList.remove('hidden');\n  el('accessButton').classList.remove('hidden');\n  document.body.removeAttribute('data-locked');\n  note('');\n}\n\nel('loginForm').onsubmit=async event=>{\n  event.preventDefault();\n  const button=el('loginSubmit');\n  if(button.disabled)return;\n  button.disabled=true;\n  editorStatus('loginStatus','Вхід…');\n  try{\n    await api('/api/web-access/login','POST',{login:el('browserLogin').value,password:el('browserPassword').value});\n    el('browserPassword').value='';\n    await openPanel();\n  }catch(error){editorStatus('loginStatus',error.message,true);}\n  finally{button.disabled=false;}\n};\n\nel('accessButton').textContent=init?'Вхід з комп’ютера':'Вийти';\nel('accessButton').onclick=async()=>{\n  if(init){el('webAccessDialog').showModal();return;}\n  const button=el('accessButton');\n  if(button.disabled)return;\n  button.disabled=true;\n  try{\n    await api('/api/web-access/logout','POST');\n    location.reload();\n  }catch(error){note(error.message,true);}\n  finally{button.disabled=false;}\n};\n\nel('closeAccess').onclick=()=>el('webAccessDialog').close();\nel('webAccessDialog').addEventListener('cancel',event=>{\n  if(el('closeAccess').disabled)event.preventDefault();\n});\nel('webAccessDialog').addEventListener('close',()=>{\n  el('webAccessLogin').value='';\n  el('webAccessPassword').value='';\n  el('webAccessCredentials').classList.add('hidden');\n  el('copyAccessPassword').classList.add('hidden');\n  el('generateAccess').classList.remove('hidden');\n  editorStatus('accessStatus','');\n});\nel('generateAccess').onclick=async()=>{\n  const button=el('generateAccess');\n  if(button.disabled)return;\n  if(!confirm('Створити вебпароль? Попередній вебпароль і сеанси в браузері стануть недійсними.'))return;\n  button.disabled=true;\n  el('closeAccess').disabled=true;\n  try{\n    const data=await api('/api/web-access/setup','POST');\n    el('webAccessLogin').value=data.login;\n    el('webAccessPassword').value=data.password;\n    el('webAccessCredentials').classList.remove('hidden');\n    el('copyAccessPassword').classList.remove('hidden');\n    button.classList.add('hidden');\n    el('webAccessLogin').focus();\n    editorStatus('accessStatus','Збережіть вебпароль. Після закриття вікна його можна лише створити заново.');\n  }catch(error){editorStatus('accessStatus',error.message,true);}\n  finally{\n    button.disabled=false;\n    el('closeAccess').disabled=false;\n  }\n};\n\nel('copyAccessPassword').onclick=async()=>{\n  const password=el('webAccessPassword');\n  try{\n    await navigator.clipboard.writeText(password.value);\n    editorStatus('accessStatus','Вебпароль скопійовано.');\n  }catch{\n    password.select();\n    editorStatus('accessStatus','Скопіюйте виділений вебпароль вручну.');\n  }\n};\n\nopenPanel().catch(error=>{\n  if(!init&&error.status===401){showLogin();return;}\n  note(error.message,true);\n});\n\n})();\n</script>\n</body>\n</html>\n";

export default {
  async fetch(req,env){
    let path=new URL(req.url).pathname;
    try{
      if(path==='/health')return J({ok:true,version:'3.8-operator-management'});

      if(path==='/'&&req.method==='GET'){
        return new Response(PAGE,{
          headers:{
            'content-type':'text/html; charset=utf-8',
            'cache-control':'no-store',
            'x-content-type-options':'nosniff'
          }
        });
      }
      if(!env.DB)return J({error:'Missing DB binding'},503);

      if(path==='/telegram'&&req.method==='POST'){
        return await webhook(req,env);
      }
      if(path.startsWith('/api/')){
        return await api(req,env,path);
      }
      return J({error:'Not found'},404);
    }catch(e){
      console.error('TestHub:',e);
      return J({error:'Помилка сервера. Перевір Cloudflare Logs.'},500);
    }
  }
};
