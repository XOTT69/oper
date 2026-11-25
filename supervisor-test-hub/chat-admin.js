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
