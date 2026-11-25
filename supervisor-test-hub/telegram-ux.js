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
