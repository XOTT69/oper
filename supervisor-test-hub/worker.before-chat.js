
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
const startKeys=id=>[[{text:'Розпочати тест →',callback_data:'s:'+id}]];

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

function buildQuestion(r,q){
  let options=JSON.parse(q.options_json);
  let multi=JSON.parse(q.correct_json).length>1;
  let sel=JSON.parse(r.selected_json||'[]');
  let n=JSON.parse(r.questions_json).length;
  let filled=Math.round(r.position/n*10);
  let progress='▰'.repeat(filled)+'▱'.repeat(10-filled);
  let text='<b>ПЕРЕВІРКА ЗНАНЬ</b>\n'+
    E(displayTitle(r.title))+'\n\n'+
    '<b>Запитання '+(r.position+1)+' із '+n+'</b>  ·  '+Math.round(r.position/n*100)+'%\n'+
    progress+'\n\n'+
    '<b>'+E(q.question)+'</b>\n\n'+
    options.map((x,i)=>'<b>'+String.fromCharCode(65+i)+'.</b> '+E(x)).join('\n\n')+
    '\n\n<i>'+(multi?'Оберіть усі правильні відповіді.':'Оберіть одну відповідь.')+'</i>'+
    (r.deadline?'\nЗавершити до '+E(fmt(r.deadline)):'');
  let buttons=[];
  for(let i=0;i<options.length;i+=3){
    buttons.push(options.slice(i,i+3).map((x,j)=>({
      text:(sel.includes(i+j)?'✓ ':'')+String.fromCharCode(65+i+j),
      callback_data:'p:'+r.id+':'+r.position+':'+(i+j)
    })));
  }
  buttons.push([{text:'Підтвердити відповідь →',callback_data:'c:'+r.id+':'+r.position}]);
  return {text,buttons};
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

async function begin(env,user,id){
  let a=await getA(env.DB,id,user);
  if(!a)throw Error('Тест не призначено.');
  if(expired(a.deadline))throw Error('Дедлайн минув.');

  let active=await env.DB.prepare(
    "SELECT id FROM th3_attempts WHERE assignment_id=? AND status='active'"
  ).bind(id).first();
  if(active)return showQuestion(env,user,await getRun(env.DB,active.id,user));

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
     AND NOT EXISTS(SELECT 1 FROM th3_attempts WHERE assignment_id=? AND status='active')
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
  await display(env,user,r,
    '<b>ПЕРЕВІРКА ЗНАНЬ</b>\n'+E(displayTitle(a.title))+'\n\n'+
    'Запитань: <b>'+picked.length+'</b>\n'+
    'Прохідний результат: <b>'+a.pass_percent+'%</b>\n'+
    'Завершити до: <b>'+E(fmt(a.deadline))+'</b>\n\n'+
    'Читайте запитання уважно. Відповідь зберігається після підтвердження.',
    [[{text:'Перейти до запитань →',callback_data:'g:'+runId}]]
  );
}

async function pick(env,user,id,pos,index){
  let r=await getRun(env.DB,id,user);
  if(!r||r.status!=='active'||r.position!==pos||
     r.pending_feedback||expired(r.deadline)){
    throw Error('Питання недоступне.');
  }
  let q=await question(env.DB,r);
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
    "UPDATE th3_attempts SET selected_json=? WHERE id=? AND position=? AND selected_json=? AND status='active' AND pending_feedback=''"
  ).bind(JSON.stringify(next),id,pos,r.selected_json).run();
  if(saved.meta.changes){
    await showQuestion(env,user,await getRun(env.DB,id,user));
  }
}

async function confirm(env,user,id,pos){
  let r=await getRun(env.DB,id,user);
  if(!r||r.status!=='active'||r.position!==pos||r.pending_feedback){
    throw Error('Відповідь уже опрацьовано.');
  }
  if(expired(r.deadline))return finish(env,user,r,true);
  let q=await question(env.DB,r);
  let selected=JSON.parse(r.selected_json);
  let correct=JSON.parse(q.correct_json);
  if(!selected.length)throw Error('Спочатку вибери відповідь.');

  let right=JSON.stringify([...selected].sort())===
    JSON.stringify([...correct].sort());

  if(!right&&r.corrections_used<r.correction_limit){
    let changed=await env.DB.prepare(
      "UPDATE th3_attempts SET pending_feedback=?,corrections_used=corrections_used+1 WHERE id=? AND position=? AND status='active' AND pending_feedback=''"
    ).bind(JSON.stringify({selected}),id,pos).run();
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
      'INSERT OR IGNORE INTO th3_answers(id,attempt_id,question_id,selected_json,correct,points_earned) VALUES(?,?,?,?,?,?)'
    ).bind(answerId,id,q.id,JSON.stringify(selected),Number(right),earned),
    env.DB.prepare(
      `UPDATE th3_attempts
       SET position=position+1,score=score+?,selected_json='[]'
       WHERE id=? AND position=? AND status='active' AND pending_feedback=''
       AND EXISTS(SELECT 1 FROM th3_answers
         WHERE attempt_id=? AND question_id=? AND id=?)
       AND EXISTS(SELECT 1 FROM th3_assignments a
         WHERE a.id=th3_attempts.assignment_id
         AND (a.deadline IS NULL OR julianday(a.deadline)>julianday('now')))`
    ).bind(earned,id,pos,id,q.id,answerId)
  ]);

  if(!run[1].meta.changes){
    throw Error('Відповідь уже збережено або дедлайн минув.');
  }

  let next=await getRun(env.DB,id,user);
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

async function list(env,user){
  let rows=(await env.DB.prepare(
    `SELECT a.*,t.title,
      (SELECT COUNT(*) FROM th3_attempts r WHERE r.assignment_id=a.id) used,
      (SELECT MAX(percent) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='finished') best,
      (SELECT MAX(passed) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='finished') passed,
      (SELECT COUNT(*) FROM th3_attempts r WHERE r.assignment_id=a.id AND r.status='active') active
     FROM th3_assignments a
     JOIN th_tests t ON t.id=a.test_id
     WHERE a.user_id=?
     ORDER BY a.created_at DESC,a.rowid DESC LIMIT 20`
  ).bind(user).all()).results;

  if(!rows.length){
    return tg(env,'sendMessage',{
      chat_id:user,text:'Наразі немає призначених тестів. Нові призначення з’являться тут.'
    });
  }

  for(let a of rows){
    let finished=Number(a.passed)===1;
    let can=!expired(a.deadline)&&
      (a.active>0||(!finished&&a.used<a.max_attempts));
    let status=finished?'✅ Складено':
      a.active?'🟡 У процесі':
      expired(a.deadline)?'⌛ Дедлайн минув':
      a.best!==null?'❌ Не складено':'⏳ Очікує';

    await tg(env,'sendMessage',{
      chat_id:user,
      parse_mode:'HTML',
      text:'<b>'+E(displayTitle(a.title))+'</b>\n\n'+
        E(status)+'\n'+
        'Завершити до: '+E(fmt(a.deadline))+'\n'+
        'Використано спроб: '+a.used+' із '+a.max_attempts+'\n'+
        'Найкращий результат: '+(a.best===null?'—':a.best+'%'),
      ...(can?{reply_markup:{inline_keyboard:startKeys(a.id)}}:{})
    });
  }
}

async function callback(env,q){
  let user=String(q.from.id);
  let p=(q.data||'').split(':');
  try{
    if(p[0]==='s')await begin(env,user,p[1]);
    else if(p[0]==='g'){
      let r=await getRun(env.DB,p[1],user);
      if(r?.status==='active')await showQuestion(env,user,r);
    }
    else if(p[0]==='p'){
      await pick(env,user,p[1],+p[2],+p[3]);
    }
    else if(p[0]==='c'){
      await confirm(env,user,p[1],+p[2]);
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
    else if(p[0]==='l')await list(env,user);

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

async function webhook(req,env){
  if(!env.WEBHOOK_SECRET||
     req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET){
    return J({error:'Forbidden'},403);
  }
  let u=await req.json();
  if(u.callback_query){
    await callback(env,u.callback_query);
    return J({ok:true});
  }
  let m=u.message;
  if(!m||m.chat?.type!=='private'||!m.from?.id)return J({ok:true});

  await register(env.DB,m.from);
  let user=String(m.from.id);

  if(/^\/(start|admin)(\s|$)/.test(m.text||'')){
    if(admin(env,user)){
      await tg(env,'sendMessage',{
        chat_id:user,
        text:'Центр знань\n\nТести, команда та результати — у вашій панелі керування.',
        reply_markup:{
          inline_keyboard:[[
            {text:'Панель керування →',web_app:{url:new URL(req.url).origin}}
          ]]
        }
      });
    }else{
      await tg(env,'sendMessage',{
        chat_id:user,
        text:'Центр знань\n\nВаш простір для навчання та розвитку.\n\nВідкрийте /tests, щоб переглянути призначені тести.'
      });
    }
  }else if(/^\/tests(\s|$)/.test(m.text||'')){
    await list(env,user);
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

async function api(req,env,path){
  let user;
  try{user=await auth(req,env);}
  catch(e){return J({error:e.message},401);}

  if(!admin(env,user))return J({error:'Доступ тільки супервайзеру'},403);
  let db=env.DB,method=req.method;

  if(path==='/api/me')return J({admin:true,id:user});

  if(path==='/api/data'){
    let [users,tests,assignments]=await Promise.all([
      db.prepare(
        "SELECT id,name,username,display_name,operator_tag FROM th_users ORDER BY COALESCE(NULLIF(display_name,''),name)"
      ).all(),
      db.prepare(
        `SELECT t.*,COALESCE(m.archived,0) archived,
          (SELECT COUNT(*) FROM th_questions q WHERE q.test_id=t.id) question_count,
          (SELECT COUNT(*) FROM th3_assignments a WHERE a.test_id=t.id) assigned
         FROM th_tests t
         LEFT JOIN th3_testmeta m ON m.test_id=t.id
         ORDER BY t.created_at DESC`
      ).all(),
      db.prepare(
        `SELECT a.*,
          COALESCE(NULLIF(u.display_name,''),u.name) name,
          u.operator_tag,t.title,
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
      users:users.results,
      tests:tests.results,
      assignments:assignments.results
    });
  }

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
      'SELECT * FROM th_tests WHERE id=?'
    ).bind(id).first();
    if(!t)return J({error:'Тест не знайдено'},404);
    let q=(await db.prepare(
      'SELECT * FROM th_questions WHERE test_id=? ORDER BY position'
    ).bind(id).all()).results;
    return J({
      test:t,
      questions:q.map(x=>({
        question:x.question,
        options:JSON.parse(x.options_json),
        correct:JSON.parse(x.correct_json),
        points:x.points,
        explanation:x.explanation
      }))
    });
  }

  if(path==='/api/test/save'&&method==='POST'){
    let b=await req.json();
    if(!validTest(b)){
      return J({error:'Перевір назву, запитання та правильні відповіді'},400);
    }
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

    b.questions.forEach((q,i)=>cmds.push(db.prepare(
      'INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) VALUES(?,?,?,?,?,?,?,?)'
    ).bind(
      ID(),testId,i,q.question,
      JSON.stringify(q.options),
      JSON.stringify(q.correct),
      q.points??1,
      String(q.explanation||'').slice(0,2000)
    )));

    await db.batch(cmds);
    return J({ok:true,id:testId});
  }

  if(path==='/api/test/duplicate'&&method==='POST'){
    let b=await req.json();
    let test=await db.prepare(
      'SELECT * FROM th_tests WHERE id=?'
    ).bind(b.id).first();
    if(!test)return J({error:'Тест не знайдено'},404);

    let qs=(await db.prepare(
      'SELECT * FROM th_questions WHERE test_id=? ORDER BY position'
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
    qs.forEach((q,i)=>cmds.push(db.prepare(
      'INSERT INTO th_questions(id,test_id,position,question,options_json,correct_json,points,explanation) VALUES(?,?,?,?,?,?,?,?)'
    ).bind(
      ID(),id,i,q.question,q.options_json,q.correct_json,
      q.points,q.explanation
    )));
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

  if(path==='/api/test/delete'&&method==='POST'){
    let b=await req.json();
    let count=await db.prepare(
      'SELECT COUNT(*) n FROM th3_assignments WHERE test_id=?'
    ).bind(b.id).first();
    if(count.n){
      return J({
        error:'Тест уже призначався. Можна тільки архівувати, щоб зберегти історію.'
      },409);
    }
    await db.batch([
      db.prepare('DELETE FROM th_questions WHERE test_id=?').bind(b.id),
      db.prepare('DELETE FROM th3_testmeta WHERE test_id=?').bind(b.id),
      db.prepare('DELETE FROM th_tests WHERE id=?').bind(b.id)
    ]);
    return J({ok:true});
  }

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
        await db.prepare(
          'INSERT INTO th3_assignments(id,test_id,user_id,deadline,max_attempts,correction_limit) VALUES(?,?,?,?,?,?)'
        ).bind(
          id,b.test_id,userId,b.deadline||null,
          b.max_attempts,b.correction_limit
        ).run();
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
    return J({created,notified});
  }

  if(path==='/api/results'){
    let x=await db.prepare(
      `SELECT r.id,r.status,r.percent,r.passed,
        r.score,r.max_score,r.started_at,r.finished_at,t.title,
        COALESCE(NULLIF(u.display_name,''),u.name) name,
        u.operator_tag
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

const PAGE=String.raw`<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Центр знань — панель супервайзера</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{color-scheme:light;--bg:#f5f6f8;--surface:#fff;--ink:#18232d;--muted:#73808a;--line:#e5e9ec;--accent:#146b58;--soft:#e9f4ef;--danger:#ae3b46;--shadow:0 2px 5px #132c1f03}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}button,input,textarea,select{font:inherit}button,a,input,textarea,select{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #6da894;outline-offset:3px}button:disabled{opacity:.5;cursor:wait}.hidden{display:none!important}
main{max-width:1500px;margin:auto;padding:0 36px 48px 254px;min-height:100vh}.hero{position:fixed;inset:0 auto 0 0;width:218px;background:#fff;border-right:1px solid var(--line);padding:29px 22px;z-index:5;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px}.brand-mark{width:36px;height:36px;border-radius:11px;background:var(--accent);color:white;display:grid;place-items:center}.brand-mark svg{width:21px;height:21px}.brand h1{font-size:17px;letter-spacing:-.5px;margin:0;line-height:1.2}.brand small{font-size:10px;color:var(--muted);letter-spacing:1.2px;text-transform:uppercase}.hero-sub{font-size:11px;letter-spacing:1.4px;color:#89939a;margin:38px 12px 12px;text-transform:uppercase}.tabs{display:flex;flex-direction:column;gap:5px}.tabs button{display:flex;align-items:center;gap:12px;margin:0;text-align:left;padding:12px;border-radius:9px;border:0;background:transparent;color:#75818b;font-size:13px;font-weight:600}.tabs button svg{width:18px;height:18px;flex-shrink:0}.tabs button.on{background:var(--soft);color:var(--accent)}.tabs button:hover{background:#f1f6f3}.sidebar-foot{margin-top:auto;padding-top:25px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}.sidebar-foot b{display:block;color:#4d5d67;font-size:12px}.online-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#3c9b79;margin-right:6px}
.topbar{height:88px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:26px}.breadcrumb{color:var(--muted);font-size:12px}.breadcrumb span{color:#354550;margin-left:10px}.profile{display:flex;align-items:center;gap:11px;font-size:11px;color:var(--muted)}.profile b{display:block;color:#354550;font-size:12px}.avatar{display:grid;place-items:center;width:35px;height:35px;border-radius:50%;background:#e2eae6;color:var(--accent);font-weight:700;font-size:12px}.page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.eyebrow{text-transform:uppercase;letter-spacing:1.7px;color:var(--accent);font-size:10px;font-weight:750;margin-bottom:8px}h1,h2,h3,p{overflow-wrap:anywhere}h2{font-size:28px;line-height:1.2;letter-spacing:-.8px;margin:0 0 9px;font-weight:700}h3{font-size:15px;margin:0 0 7px}.page-heading p{margin:0;color:var(--muted);font-size:13px}.card,.stat{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:22px;margin:12px 0;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:25px}.stat{margin:0;padding:20px}.stat-head{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}.stat-icon{color:var(--accent);width:29px;height:29px;border-radius:8px;background:var(--soft);display:grid;place-items:center}.stat-icon svg{width:15px;height:15px}.stat b{font-size:32px;line-height:1.8;letter-spacing:-1px;font-weight:650}.stat-foot{font-size:10px;color:var(--muted)}.stat-foot span{color:var(--accent);font-weight:650}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}.section-heading h3{margin:0}.section-heading small{font-size:11px;color:var(--muted)}button{border:1px solid transparent;background:var(--accent);color:white;border-radius:8px;padding:10px 15px;font-weight:600;font-size:12px;line-height:1.4;margin:3px 4px 3px 0;transition:background .15s,box-shadow .15s}button:hover{background:#0c5646}button.alt{background:white;border-color:var(--line);color:#485761}button.alt:hover{background:#f4f7f5;border-color:#b7c9c0}button.danger{background:#fff;border-color:#f1dde0;color:var(--danger)}button.danger:hover{background:#fff1f2}.link-button{background:none!important;border:0;color:var(--accent);padding:0;font-size:11px}.muted{color:var(--muted);font-size:12px}.error{color:var(--danger)}#notice{padding:11px 15px;font-size:12px;border-left:3px solid var(--accent);margin:0 0 22px;background:#f0f8f3;border-radius:7px}#notice.error{border-color:var(--danger);background:#fff4f3}#notice:empty{display:none}#notice.access-notice{max-width:540px;margin:80px auto;padding:30px;background:white;border:1px solid var(--line);font-size:14px}
input,textarea,select{width:100%;font:inherit;color:var(--ink);border:1px solid #dfe5e8;border-radius:8px;padding:11px 12px;margin:7px 0 17px;background:#fff;outline:none}input:focus,textarea:focus,select:focus{border-color:#75a48e;box-shadow:0 0 0 3px #146b5810}input::placeholder,textarea::placeholder{color:#9ca6ae}textarea{min-height:90px;resize:vertical}label{font-size:12px;font-weight:600;color:#4b5b64;display:block}.check{display:flex;align-items:center;gap:10px;padding:11px 0;font-size:12px;font-weight:400}.check input{width:16px;height:16px;accent-color:var(--accent);margin:0;flex-shrink:0}.question{border:1px solid var(--line);border-radius:10px;padding:19px;margin:17px 0;background:#fafcfb}.question>b{display:inline-block;margin-bottom:20px;font-size:13px}.question>button.danger{float:right;margin-top:-3px}.question>label{clear:both}.toolbar{display:flex;flex-wrap:wrap;gap:4px;margin-top:16px}.toolbar button{font-size:11px;padding:8px 11px}.pill{border-radius:5px;padding:4px 8px;background:#f0f3f5;color:#697783;font-size:10px;font-weight:650;display:inline-flex;align-items:center;white-space:nowrap;gap:5px}.pill:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.pill.success{background:#e8f4ed;color:#25704f}.pill.active{background:#edf2fc;color:#4f70a7}.pill.waiting{background:#fff5e1;color:#9b7627}.pill.failed{background:#fceef0;color:#ac4857}.card,.editor-grid,.overview-grid{min-width:0}.table-wrap{overflow:auto;margin:0 -22px -22px}.data-table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.data-table th{padding:12px 22px;color:#87929b;background:#fafbfc;font-size:10px;font-weight:600;white-space:nowrap;border-block:1px solid var(--line)}.data-table td{padding:17px 22px;border-bottom:1px solid #eef1f3;vertical-align:middle}.data-table tr:last-child td{border:0}.person-cell{display:flex;align-items:center;gap:10px;min-width:150px}.person-cell .avatar{width:31px;height:31px;font-size:10px}.person-cell b{font-size:12px;font-weight:600}.person-cell small{display:block;color:var(--muted);font-size:10px}.score{font-weight:700;font-variant-numeric:tabular-nums}.score-track{display:block;width:62px;height:3px;border-radius:10px;background:#edf0f2;margin-top:6px;overflow:hidden}.score-track i{display:block;height:100%;background:#54947d;border-radius:10px}.table-meta{font-size:10px;color:var(--muted);padding:16px 0 0}.empty{padding:38px;text-align:center;color:var(--muted);font-size:13px}.empty svg{width:30px;height:30px;display:block;margin:0 auto 10px;color:#a4b7ab}.searchbar{display:flex;align-items:center;gap:10px;margin:18px 0}.searchbar input{margin:0;max-width:330px;font-size:12px;padding:10px 13px}.searchbar select{margin:0;max-width:180px;font-size:12px;padding:10px}.searchbar .muted{margin-left:auto;font-size:11px}#testList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}#testList>.card{margin:0;padding:23px}#testList>.card>b{display:block;font-size:16px;line-height:1.5;margin-bottom:12px}#testList>.card>.muted{line-height:1.8}#testList .test-icon{width:35px;height:35px;border-radius:9px;background:var(--soft);color:var(--accent);display:grid;place-items:center;margin-bottom:17px}#testList .test-icon svg{width:18px;height:18px}.editor-grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px;align-items:start}.editor-grid>.card{margin-top:0}.editor-grid .import-card{position:sticky;top:20px}#import{min-height:185px;font:12px/1.7 ui-monospace,monospace;background:#f7f9f8}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field-help{font-size:10px;color:var(--muted);margin:-10px 0 18px}.form-actions{border-top:1px solid var(--line);padding-top:17px;margin-top:15px}.assignment-card{max-width:780px}#people{max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 14px;margin:7px 0}#people .check+.check{border-top:1px solid #f0f2f4}#teamList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#teamList .card{margin:0}#teamList .card>b{font-size:15px;display:block}#teamList .muted{margin:5px 0 18px}#filter{width:200px;margin:0}#answers .card p{font-size:13px}.report-tools{display:flex;gap:8px;justify-content:space-between;margin-bottom:18px}.overview-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:18px;align-items:start}.overview-grid>.card{margin-top:0}.insight-title{font-size:10px;letter-spacing:1.2px;color:var(--muted);margin-bottom:20px}.completion-ring{width:126px;height:126px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) calc(var(--rate,0)*1%),#edf1ef 0)}.completion-ring>div{background:#fff;border-radius:50%;width:104px;height:104px;display:flex;align-items:center;justify-content:center;flex-direction:column}.completion-ring b{font-size:27px;line-height:1.2;letter-spacing:-1px}.completion-ring small{font-size:10px;color:var(--muted)}.legend-row{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:12px 0}.legend-row b{color:var(--ink);font-weight:600}.legend-row .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:7px}.tip{background:#f3f7f4;border-radius:8px;padding:14px;font-size:11px;color:#657b6c;margin-top:22px}.tip b{display:block;color:#3c5c4c;margin-bottom:5px}.dashboard-footer{display:flex;justify-content:space-between;gap:15px;margin-top:30px;font-size:10px;color:#99a2aa}
@media(min-width:1600px){.hero{left:calc((100vw - 1500px)/2)}}
@media(max-width:1150px){main{padding-left:224px;padding-right:24px}.hero{width:200px;padding-inline:16px}.overview-grid{grid-template-columns:1fr}.overview-grid>.insight{display:none}.editor-grid{grid-template-columns:1fr}.editor-grid .import-card{position:static}.grid{gap:10px}.stat{padding:15px}.data-table td,.data-table th{padding-inline:16px}}
@media(max-width:760px){main{padding:0 18px 35px}.hero{position:static;width:auto;border:0;border-bottom:1px solid var(--line);padding:18px;margin:0 -18px 0;display:block}.hero-sub,.sidebar-foot{display:none}.brand small{font-size:9px}.tabs{flex-direction:row;overflow:auto;margin-top:18px;gap:3px;padding-bottom:2px}.tabs button{white-space:nowrap;padding:10px 12px;font-size:11px;gap:7px}.tabs button svg{width:15px;height:15px}.topbar{height:57px;margin-bottom:23px}.profile .profile-name{display:none}.profile .avatar{width:27px;height:27px;font-size:10px}.page-heading{margin-bottom:20px;gap:10px}h2{font-size:25px}.page-heading p{font-size:12px;max-width:260px}.page-heading button{padding:10px 12px;font-size:11px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.stat{padding:16px}.stat b{font-size:29px}.stat-foot{font-size:9px}.card{padding:18px;border-radius:11px}.table-wrap{margin:0 -18px -18px}.data-table td,.data-table th{padding:14px 16px}.data-table td:nth-child(4),.data-table th:nth-child(4){display:none}.data-table td{font-size:11px}.table-meta{padding-top:16px}.overview-grid{gap:0}#testList,#teamList{grid-template-columns:1fr}.searchbar{flex-wrap:wrap}.searchbar input{max-width:none;flex:1;min-width:140px}.searchbar select{width:140px}.searchbar .muted{width:100%;margin:0}.form-row{gap:12px}.question{padding:14px}.dashboard-footer{font-size:9px}.editor-grid{gap:0}.breadcrumb{font-size:10px}.report-tools{align-items:center}.report-tools select{max-width:170px}.hero .tabs::-webkit-scrollbar{height:0}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<main>
<header class="hero"><div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4ZM6 10v7c4 4 8 4 12 0v-7"/></svg></span><div><h1>Центр знань</h1><small>TEAM LEARNING</small></div></div><div class="hero-sub">Робочий простір</div><nav class="tabs" aria-label="Основна навігація"><button class="on" data-tab="overview" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Огляд</span></button><button data-tab="tests" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z"/><path d="M8 7h8M8 11h5"/></svg><span>Бібліотека тестів</span></button><button data-tab="edit" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"/></svg><span>Редактор</span></button><button data-tab="assign" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/></svg><span>Призначення</span></button><button data-tab="results" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18M8 16v-5M13 16V7M18 16V4"/></svg><span>Результати</span></button><button data-tab="team" aria-current="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/></svg><span>Команда</span></button></nav><div class="sidebar-foot"><b><span class="online-dot"></span>Панель супервайзера</b>Навчання, що дає результат</div></header><div class="topbar"><div class="breadcrumb">Робочий простір <span>/ <span id="currentPage">Огляд</span></span></div><div class="profile"><div class="profile-name"><b>Супервайзер</b>Керування навчанням</div><span class="avatar" aria-hidden="true">СВ</span></div></div>
<div class="card" id="notice" role="status" aria-live="polite">Перевірка доступу…</div>

<div id="app" class="hidden">



<section id="overview">
<div class="page-heading"><div><div class="eyebrow">Навчання команди</div><h2>Усе починається зі знань.</h2><p>Призначайте тести й тримайте прогрес команди у фокусі.</p></div><button data-go="edit">+ Створити тест</button></div><div id="stats" class="grid"></div><div class="overview-grid"><div class="card"><div class="section-heading"><h3>Останні призначення</h3><button class="link-button" data-go="results">Усі результати ↗</button></div><div id="recent"></div></div><aside class="card insight"><div class="insight-title">ПРОГРЕС КОМАНДИ</div><div id="completion"></div><div class="tip"><b>Наступний крок</b>Відкрийте результати, щоб визначити теми для наступного навчання.</div></aside></div>
</section>

<section id="tests" class="hidden">
<div class="page-heading"><div><div class="eyebrow">Робочий простір</div><h2>Бібліотека тестів</h2><p>Знання команди, зібрані в одному місці.</p></div><button data-go="edit">+ Створити тест</button></div>
<div class="searchbar"><input id="testSearch" type="search" aria-label="Пошук тестів" placeholder="Пошук за назвою тесту…"><select id="testStatus" aria-label="Статус тестів"><option value="active">Активні тести</option><option value="all">Усі тести</option><option value="archived">Архів</option></select><span class="muted" id="testCount"></span></div><div id="testList"></div>
</section>

<section id="edit" class="hidden">
<div class="page-heading"><div><div class="eyebrow">Конструктор</div><h2>Редактор тесту</h2><p>Створіть зрозумілі запитання та позначте правильні відповіді.</p></div></div>
<div class="editor-grid"><div class="card"><h3>Основна інформація</h3><p class="muted">Сформулюйте назву, яка пояснює тему тесту.</p>
<label for="title">Назва тесту</label>
<input id="title" placeholder="Стандарти сервісу" maxlength="180">
<label for="description">Опис</label>
<textarea id="description"></textarea>
<div class="form-row"><div><label for="pass">Прохідний бал, %</label>
<input id="pass" type="number" min="0" max="100" value="80">
</div><div><label for="draw">Кількість випадкових питань</label>
<input id="draw" type="number" min="0" value="0">
<div class="field-help">0 — усі запитання</div></div></div><h3>Запитання та відповіді</h3><div id="builder"></div><div class="form-actions">
<button id="add" class="alt">+ Запитання</button>
<button id="save">Зберегти тест</button>
<button id="reset" class="alt">Новий тест</button></div>
</div>
<div class="card import-card">
<h3>Імпорт запитань</h3>
<p class="muted">Встав JSON тесту та перевір відповіді перед публікацією.</p>
<textarea aria-label="JSON тесту для імпорту" id="import" placeholder="{...}"></textarea>
<button id="importBtn">Імпортувати JSON</button><p class="muted">Правильні відповіді варто перевірити перед призначенням.</p>
</div></div>
</section>

<section id="assign" class="hidden">
<div class="page-heading"><div><div class="eyebrow">Робочий простір</div><h2>Призначення тесту</h2><p>Оберіть тест, учасників і зручний термін завершення.</p></div></div>
<div class="card assignment-card">
<label for="testSelect">Навчальний тест</label>
<select id="testSelect"></select>
<label>Оператори</label>
<div id="people"></div>
<button id="all" class="alt">Усі</button>
<button id="none" class="alt">Очистити</button>
<label for="deadline">Дедлайн (час за Києвом)</label>
<input id="deadline" type="datetime-local">
<label for="tries">Повних спроб</label>
<input id="tries" type="number" min="1" max="10" value="1">
<label for="corrections">Виправлень у спробі</label>
<input id="corrections" type="number" min="0" max="10" value="0">
<label class="check">
<input type="checkbox" id="notify" checked>
Надіслати оператору сповіщення
</label>
<button id="assignBtn">Призначити тест →</button>
</div>
</section>

<section id="results" class="hidden">
<div class="page-heading"><div><div class="eyebrow">Робочий простір</div><h2>Результати навчання</h2><p>Від загальної картини — до кожної відповіді.</p></div></div>
<div class="report-tools"><select id="filter" aria-label="Фільтр результатів">
<option value="all">Усі</option>
<option value="passed">Складено</option>
<option value="failed">Не складено</option>
<option value="active">У процесі</option>
</select>
<button id="csv" class="alt">↓ Експорт CSV</button></div>
<div id="reports"></div>
<div id="answers"></div>
</section>

<section id="team" class="hidden">
<div class="page-heading"><div><div class="eyebrow">Робочий простір</div><h2>Ваша команда</h2><p>Учасники та робочі позначки для зручного керування.</p></div></div>
<div id="teamList"></div>
</section>
</div>
<footer class="dashboard-footer"><span>Центр знань · Простір розвитку команди</span><span>Зроблено для щоденної роботи</span></footer></main>

<script>
(function(){
'use strict';

const el=id=>document.getElementById(id);
const safe=s=>String(s??'').replace(
  /[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
);

const icons={"overview": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></svg>", "book": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z\"/><path d=\"M8 7h8M8 11h5\"/></svg>", "edit": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5\"/></svg>", "assign": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m22 2-7 20-4-9-9-4Z M22 2 11 13\"/></svg>", "results": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 3v18h18M8 16v-5M13 16V7M18 16V4\"/></svg>", "users": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/></svg>", "check": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m8 12 3 3 5-6\"/></svg>", "clock": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></svg>", "logo": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m3 7 9-4 9 4-9 4ZM6 10v7c4 4 8 4 12 0v-7\"/></svg>"};
const titleName=s=>String(s??'').replace(/кото[\s–—-]*бліц/gi,'Перевірка знань').replace(/(^|\s)СВ(?=\s|$)/g,'$1').replace(/\s{2,}/g,' ').trim();
const titleSafe=s=>safe(titleName(s));
const initials=s=>safe(String(s||'Учасник').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase());
const status=x=>x.passed===1?['success','Складено']:x.active?['active','У процесі']:x.deadline&&Date.parse(x.deadline)<Date.now()?['failed','Термін минув']:x.best!==null?['failed','Не складено']:['waiting','Очікує'];
const badge=x=>{let s=status(x);return '<span class="pill '+s[0]+'">'+s[1]+'</span>';};
const empty=t=>'<div class="empty">'+icons.book+safe(t)+'</div>';
const app=window.Telegram?.WebApp;
app?.ready();
app?.expand();
const init=app?.initData||'';

let state={users:[],tests:[],assignments:[],reports:[]};
let qs=[];
let editing=null;

function note(t,bad=false){
  el('notice').textContent=t;
  el('notice').className='card '+(bad?'error':'');
}

async function api(path,method='GET',body){
  let r=await fetch(path,{
    method,
    headers:{
      'X-Telegram-Init-Data':init,
      ...(body?{'Content-Type':'application/json'}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let d=await r.json();
  if(!r.ok)throw Error(d.error||'Помилка API');
  return d;
}

function tab(name){
  document.querySelectorAll('[data-tab]').forEach(b=>
    (b.classList.toggle('on',b.dataset.tab===name),b.setAttribute('aria-current',b.dataset.tab===name?'page':'false'))
  );
  ['overview','tests','edit','assign','results','team'].forEach(x=>
    el(x).classList.toggle('hidden',x!==name)
  );
  el('currentPage').textContent=document.querySelector('[data-tab="'+name+'"] span').textContent;
  if(name==='results')loadReports();
}

document.querySelectorAll('[data-tab]').forEach(b=>
  b.onclick=()=>tab(b.dataset.tab)
);

document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>tab(b.dataset.go));
el('testSearch').oninput=()=>drawTests();
el('testStatus').onchange=()=>drawTests();

function drawBuilder(){
  el('builder').innerHTML=qs.map((q,i)=>
    '<div class="question"><b>Питання '+(i+1)+'</b> '+
    '<button class="danger" data-del="'+i+'">Видалити</button>'+
    '<label>Текст питання</label>'+
    '<textarea aria-label="Текст запитання" data-question="'+i+'">'+safe(q.question)+'</textarea>'+
    q.options.map((o,n)=>
      '<label>Варіант '+(n+1)+'</label>'+
      '<input aria-label="Варіант відповіді" data-option="'+i+':'+n+'" value="'+safe(o)+'">'+
      '<label class="check">'+
      '<input type="checkbox" data-correct="'+i+':'+n+'" '+
      (q.correct.includes(n)?'checked':'')+'>'+
      ' Правильна відповідь</label>'
    ).join('')+
    '<button class="alt" data-addopt="'+i+'">+ Варіант</button>'+
    '<label>Бали</label>'+
    '<input aria-label="Бали за запитання" type="number" min="1" data-points="'+i+'" value="'+q.points+'">'+
    '<label>Пояснення</label>'+
    '<textarea aria-label="Пояснення відповіді" data-explain="'+i+'">'+safe(q.explanation||'')+'</textarea>'+
    '</div>'
  ).join('');

  document.querySelectorAll('[data-del]').forEach(x=>
    x.onclick=()=>{
      qs.splice(+x.dataset.del,1);
      drawBuilder();
    }
  );
  document.querySelectorAll('[data-addopt]').forEach(x=>
    x.onclick=()=>{
      let q=qs[+x.dataset.addopt];
      if(q.options.length<6){
        q.options.push('');
        drawBuilder();
      }else note('Максимум 6 варіантів',true);
    }
  );
  document.querySelectorAll('[data-question]').forEach(x=>
    x.oninput=()=>qs[+x.dataset.question].question=x.value
  );
  document.querySelectorAll('[data-option]').forEach(x=>
    x.oninput=()=>{
      let [i,j]=x.dataset.option.split(':').map(Number);
      qs[i].options[j]=x.value;
    }
  );
  document.querySelectorAll('[data-correct]').forEach(x=>
    x.onchange=()=>{
      let [i,j]=x.dataset.correct.split(':').map(Number);
      let s=new Set(qs[i].correct);
      x.checked?s.add(j):s.delete(j);
      qs[i].correct=[...s].sort((a,b)=>a-b);
    }
  );
  document.querySelectorAll('[data-points]').forEach(x=>
    x.oninput=()=>qs[+x.dataset.points].points=+x.value
  );
  document.querySelectorAll('[data-explain]').forEach(x=>
    x.oninput=()=>qs[+x.dataset.explain].explanation=x.value
  );
}

function add(){
  qs.push({
    question:'',
    options:['','','',''],
    correct:[],
    points:1,
    explanation:''
  });
  drawBuilder();
}
el('add').onclick=add;

function reset(){
  editing=null;
  el('title').value='';
  el('description').value='';
  el('pass').value=80;
  el('draw').value=0;
  qs=[];
  add();
}
el('reset').onclick=reset;

async function refresh(){
  state=await api('/api/data');

  let a=state.assignments;
  let done=a.filter(x=>x.passed===1);
  let scored=a.filter(x=>x.best!==null);
  let avg=scored.length
    ?Math.round(scored.reduce((s,x)=>s+Number(x.best),0)/scored.length)+'%'
    :'—';

  let active=a.filter(x=>x.active&&!x.passed).length;
  let rate=a.length?Math.round(done.length*100/a.length):0;
  el('stats').innerHTML=[
    ['Призначено тестів',a.length,'book','Учасників у команді: '+state.users.length],
    ['Успішно складено',done.length,'check','<span>'+rate+'%</span> від усіх призначень'],
    ['Середній результат',avg,'results','За завершеними тестами'],
    ['У процесі',active,'clock','Активні спроби учасників']
  ].map(x=>'<div class="stat"><div class="stat-head">'+x[0]+'<span class="stat-icon">'+icons[x[2]]+'</span></div><b>'+x[1]+'</b><div class="stat-foot">'+x[3]+'</div></div>').join('');
  el('completion').innerHTML='<div class="completion-ring" style="--rate:'+rate+'"><div><b>'+rate+'%</b><small>склали тест</small></div></div>'+[['#146b58','Складено',done.length],['#7393bc','У процесі',active],['#c4ceca','Інші призначення',a.length-done.length-active]].map(x=>'<div class="legend-row"><span><i class="dot" style="background:'+x[0]+'"></i>'+x[1]+'</span><b>'+x[2]+'</b></div>').join('');
  el('recent').innerHTML=a.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>УЧАСНИК</th><th>ТЕСТ</th><th>СТАТУС</th><th>СПРОБИ</th><th>РЕЗУЛЬТАТ</th></tr></thead><tbody>'+a.slice(0,10).map(x=>'<tr><td><div class="person-cell"><span class="avatar" aria-hidden="true">'+initials(x.name)+'</span><div><b>'+safe(x.name)+'</b><small>'+safe(x.operator_tag||'Учасник команди')+'</small></div></div></td><td>'+titleSafe(x.title)+'</td><td>'+badge(x)+'</td><td class="muted">'+x.used+' / '+x.max_attempts+'</td><td><span class="score">'+(x.best===null?'—':safe(x.best)+'%')+'</span>'+(x.best===null?'':'<span class="score-track"><i style="width:'+Math.max(0,Math.min(100,Number(x.best)||0))+'%"></i></span>')+'</td></tr>').join('')+'</tbody></table></div><div class="table-meta">Показано '+Math.min(a.length,10)+' із '+a.length+' призначень</div>':empty('Поки немає призначень. Почніть із бібліотеки тестів.');

  el('testSelect').innerHTML=state.tests
    .filter(x=>!x.archived)
    .map(x=>
      '<option value="'+safe(x.id)+'">'+titleSafe(x.title)+'</option>'
    ).join('');

  el('people').innerHTML=state.users.map(x=>
    '<label class="check"><input type="checkbox" data-person="'+
    safe(x.id)+'"> '+safe(x.display_name||x.name)+
    (x.operator_tag?' · '+safe(x.operator_tag):'')+'</label>'
  ).join('');

  drawTests();
  drawTeam();
}

function drawTests(){
  let query=el('testSearch').value.toLocaleLowerCase('uk');
  let filter=el('testStatus').value;
  let tests=state.tests.filter(x=>titleName(x.title).toLocaleLowerCase('uk').includes(query)&&(filter==='all'||(filter==='archived'?x.archived:!x.archived)));
  el('testCount').textContent='Знайдено: '+tests.length;
  el('testList').innerHTML=tests.map(x=>
    '<div class="card"><div class="test-icon">'+icons.book+'</div><b>'+titleSafe(x.title)+'</b> '+
    (x.archived?'<span class="pill">Архів</span>':'')+
    '<div class="muted">'+x.question_count+
    ' питань · призначень: '+x.assigned+
    ' · прохідний '+x.pass_percent+'%</div>'+
    '<div class="toolbar">'+
    '<button class="alt" data-edit="'+safe(x.id)+'">Редагувати</button>'+
    '<button class="alt" data-copy="'+safe(x.id)+'">Копіювати</button>'+
    '<button class="alt" data-archive="'+safe(x.id)+'">'+
    (x.archived?'Відновити':'Архівувати')+'</button>'+
    '<button class="danger" data-delete="'+safe(x.id)+'">Видалити</button>'+
    '</div></div>'
  ).join('')||empty('Тестів не знайдено. Створіть новий або змініть пошук.');

  document.querySelectorAll('[data-edit]').forEach(b=>
    b.onclick=async()=>{
      try{
        let t=state.tests.find(x=>x.id===b.dataset.edit);
        if(t.assigned){
          note('Цей тест уже призначений. Зроби копію для редагування.',true);
          return;
        }
        let d=await api('/api/test/detail?id='+encodeURIComponent(t.id));
        editing=t.id;
        el('title').value=titleName(d.test.title);
        el('description').value=d.test.description;
        el('pass').value=d.test.pass_percent;
        el('draw').value=d.test.draw_count;
        qs=d.questions;
        drawBuilder();
        tab('edit');
      }catch(e){note(e.message,true);}
    }
  );

  document.querySelectorAll('[data-copy]').forEach(b=>
    b.onclick=async()=>{
      try{
        await api('/api/test/duplicate','POST',{id:b.dataset.copy});
        await refresh();
        note('Копію створено');
      }catch(e){note(e.message,true);}
    }
  );

  document.querySelectorAll('[data-archive]').forEach(b=>
    b.onclick=async()=>{
      try{
        let t=state.tests.find(x=>x.id===b.dataset.archive);
        await api('/api/test/archive','POST',{
          id:t.id,
          archived:!t.archived
        });
        await refresh();
        note('Статус тесту змінено');
      }catch(e){note(e.message,true);}
    }
  );

  document.querySelectorAll('[data-delete]').forEach(b=>
    b.onclick=async()=>{
      try{
        if(!confirm('Видалити тест безповоротно? Тести з історією проходжень видалити не можна.'))return;
        await api('/api/test/delete','POST',{id:b.dataset.delete});
        await refresh();
        note('Тест видалено');
      }catch(e){note(e.message,true);}
    }
  );
}

function drawTeam(){
  el('teamList').innerHTML=state.users.map(x=>
    '<div class="card"><b>'+safe(x.display_name||x.name)+'</b>'+
    '<div class="muted">@'+safe(x.username)+' · ID '+safe(x.id)+'</div>'+
    '<label>Власне ім’я</label>'+
    '<input aria-label="Власне ім’я учасника" data-name="'+safe(x.id)+'" value="'+safe(x.display_name||'')+'">'+
    '<label>Позначка / зміна</label>'+
    '<input aria-label="Позначка або зміна" data-tag="'+safe(x.id)+'" value="'+safe(x.operator_tag||'')+'">'+
    '<button data-save-person="'+safe(x.id)+'">Зберегти</button>'+
    '</div>'
  ).join('')||empty('Учасники з’являться після першого звернення до бота.');

  document.querySelectorAll('[data-save-person]').forEach(b=>
    b.onclick=async()=>{
      try{
        let id=b.dataset.savePerson;
        await api('/api/operator','POST',{
          id,
          display_name:document.querySelector('[data-name="'+id+'"]').value,
          operator_tag:document.querySelector('[data-tag="'+id+'"]').value
        });
        await refresh();
        note('Оператора оновлено');
      }catch(e){note(e.message,true);}
    }
  );
}

el('save').onclick=async()=>{
  try{
    await api('/api/test/save','POST',{
      id:editing||undefined,
      title:el('title').value,
      description:el('description').value,
      pass_percent:+el('pass').value,
      draw_count:+el('draw').value,
      questions:qs
    });
    reset();
    await refresh();
    tab('tests');
    note('Тест збережено');
  }catch(e){note(e.message,true);}
};

el('importBtn').onclick=async()=>{
  try{
    let b=JSON.parse(el('import').value);
    if(!confirm('Перевірено правильні відповіді?'))return;
    await api('/api/test/save','POST',b);
    el('import').value='';
    await refresh();
    note('Тест імпортовано');
  }catch(e){note(e.message,true);}
};

el('all').onclick=()=>
  document.querySelectorAll('[data-person]').forEach(x=>x.checked=true);

el('none').onclick=()=>
  document.querySelectorAll('[data-person]').forEach(x=>x.checked=false);

el('assignBtn').onclick=async()=>{
  try{
    let people=[...document.querySelectorAll('[data-person]:checked')]
      .map(x=>x.dataset.person);
    let deadline=el('deadline').value;
    if(!people.length)throw Error('Обери операторів.');

    let r=await api('/api/assign','POST',{
      test_id:el('testSelect').value,
      user_ids:people,
      deadline:deadline?new Date(deadline).toISOString():null,
      max_attempts:+el('tries').value,
      correction_limit:+el('corrections').value,
      notify:el('notify').checked
    });
    await refresh();
    note('Створено: '+r.created+', сповіщень: '+r.notified);
  }catch(e){note(e.message,true);}
};

async function loadReports(){
  try{
    state.reports=(await api('/api/results')).items;
    drawReports();
  }catch(e){note(e.message,true);}
}

function drawReports(){
  let filter=el('filter').value;
  let x=state.reports.filter(r=>
    filter==='all'||
    (filter==='passed'&&r.passed===1)||
    (filter==='failed'&&r.status==='finished'&&r.passed===0)||
    (filter==='active'&&r.status==='active')
  );

  el('reports').innerHTML=x.length?'<div class="card"><div class="section-heading"><h3>Історія проходжень</h3><small>Записів: '+x.length+'</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>УЧАСНИК</th><th>ТЕСТ</th><th>СТАТУС</th><th>БАЛИ</th><th>РЕЗУЛЬТАТ</th><th></th></tr></thead><tbody>'+x.map(r=>
    '<tr><td><div class="person-cell"><span class="avatar" aria-hidden="true">'+initials(r.name)+'</span><div><b>'+safe(r.name)+'</b><small>'+safe(r.operator_tag||'Учасник команди')+'</small></div></div></td><td>'+titleSafe(r.title)+'</td><td><span class="pill '+(r.status==='active'?'active':r.passed?'success':'failed')+'">'+(r.status==='active'?'У процесі':r.passed?'Складено':'Не складено')+'</span></td><td class="muted">'+r.score+' / '+r.max_score+'</td><td class="score">'+(r.percent===null?'—':safe(r.percent)+'%')+'</td><td><button class="alt" data-answer="'+safe(r.id)+'">Відповіді</button></td></tr>'
  ).join('')+'</tbody></table></div></div>':empty('Результатів за цим фільтром немає.');

  document.querySelectorAll('[data-answer]').forEach(b=>
    b.onclick=async()=>{
      try{
        let d=await api('/api/answers?id='+encodeURIComponent(b.dataset.answer));
        el('answers').innerHTML='<h3>Розбір відповідей</h3>'+
          d.items.map(a=>
            '<div class="card"><b>'+safe(a.question)+'</b>'+
            '<p>Обрано: '+safe(a.selected.join('; '))+'</p>'+
            '<p>Правильно: '+safe(a.correct.join('; '))+'</p>'+
            (a.right?'<span class="pill success">Правильно</span>':'<span class="pill failed">Варто повторити</span>')+'</div>'
          ).join('');
      }catch(e){note(e.message,true);}
    }
  );
}
el('filter').onchange=drawReports;

el('csv').onclick=()=>{
  let rows=[
    ['Оператор','Позначка','Тест','Відсоток','Статус','Дата'],
    ...state.reports.map(x=>[
      x.name,x.operator_tag,titleName(x.title),x.percent??'',
      x.status==='active'?'У процесі':x.passed?'Складено':'Не складено',
      x.finished_at||''
    ])
  ];
  let csv=rows.map(r=>
    r.map(x=>
      '"'+String(x??'').replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"'
    ).join(',')
  ).join('\r\n');

  let blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'});
  let a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='supervisor-results.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

(async()=>{
  if(!init){
    note('Для входу відкрийте панель кнопкою «Панель керування» у Telegram-боті.');
    el('notice').classList.add('access-notice');
    return;
  }
  try{
    await api('/api/me');
    el('app').classList.remove('hidden');
    reset();
    await refresh();
    el('notice').textContent='';
  }catch(e){note(e.message,true);}
})().catch(e=>note(e.message,true));

})();
</script>
</body>
</html>`;

export default {
  async fetch(req,env){
    let path=new URL(req.url).pathname;
    try{
      if(path==='/health')return J({ok:true,version:'3.1-design'});

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
