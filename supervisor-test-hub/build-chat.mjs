import fs from 'node:fs';
const root=new URL('.',import.meta.url);
let source=fs.readFileSync(new URL('worker.before-chat.js',root),'utf8');
let chat=fs.readFileSync(new URL('chat-admin.js',root),'utf8');
source=source.replace('async function webhook(req,env){',chat+'\nasync function webhook(req,env){');
source=source.replace("  if(u.callback_query){\n    await callback(env,u.callback_query);", "  if(u.callback_query){\n    if((u.callback_query.data||'').startsWith('a:')){\n      await adminChat(env,u,new URL(req.url).origin);\n      return J({ok:true});\n    }\n    await callback(env,u.callback_query);");
source=source.replace("  if(/^\\/(start|admin)(\\s|$)/.test(m.text||'')){", "  if(admin(env,user)&&!/^\\/tests(?:@\\w+)?(?:\\s|$)/i.test(m.text||'')){\n    await adminChat(env,u,new URL(req.url).origin);\n    return J({ok:true});\n  }\n  if(/^\\/(start|admin)(\\s|$)/.test(m.text||'')){");
source=source.replace("  let db=env.DB,method=req.method;", "  return adminApi(req,env,path,user);\n}\n\nasync function adminApi(req,env,path,user){\n  if(!admin(env,user))return J({error:'Доступ тільки супервайзеру'},403);\n  let db=env.DB,method=req.method;");
source=source.replace('u.operator_tag,t.title,','u.operator_tag,u.username,t.title,').replace('        u.operator_tag\n','        u.operator_tag,u.username\n');
// Both Telegram usernames and working tags are visible in every participant view.
source=source.replace("const initials=s=>", "const identityMeta=x=>[x.username?'@'+x.username:'',x.operator_tag||''].filter(Boolean).join(' · ')||'Учасник команди';\nconst initials=s=>");
source=source.replaceAll("safe(x.operator_tag||'Учасник команди')","safe(identityMeta(x))").replaceAll("safe(r.operator_tag||'Учасник команди')","safe(identityMeta(r))");
source=source.replace("    (x.operator_tag?' · '+safe(x.operator_tag):'')+'</label>'", "    ' · '+safe(identityMeta(x))+'</label>'");
source=source.replace("'<div class=\"muted\">@'+safe(x.username)+' · ID '+safe(x.id)+'</div>'", "'<div class=\"muted\">'+safe(identityMeta(x))+' · ID '+safe(x.id)+'</div>'");
source=source.replace("['Оператор','Позначка','Тест','Відсоток','Статус','Дата']", "['Оператор','Telegram','Позначка','Тест','Відсоток','Статус','Дата']").replace('x.name,x.operator_tag,titleName(x.title)','x.name,x.username?\'@\'+x.username:\'\',x.operator_tag,titleName(x.title)');
source=source.replace("version:'3.1-design'","version:'3.2-chat-admin'");
fs.writeFileSync(new URL('worker.js',root),source);
console.log('Built worker.js with chat admin');
