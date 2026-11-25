import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('./worker.js',import.meta.url),'utf8');
const sandbox={crypto:webcrypto,TextEncoder,URLSearchParams,Response,Intl,URL,console};
vm.createContext(sandbox);
vm.runInContext(source.replace('export default {','const worker = {')+'\nthis.test={buildQuestion,displayTitle,auth,admin,worker,PAGE};',sandbox);
const {buildQuestion,displayTitle,auth,admin,worker,PAGE}=sandbox.test;
for(const body of [...PAGE.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)])new vm.Script(body[1]);
let run={id:'12345678-1234-1234-1234-123456789012',position:2,questions_json:'[1,2,3,4,5]',selected_json:'[1,3]',title:'Кото-бліц №2 СВ 23.10.2026',deadline:'2026-10-29T12:00:00Z'};
let q={question:'Які правила <важливі>?',options_json:JSON.stringify(['Без образ','Коректне спілкування','Агресія','Стриманість']),correct_json:'[0,1,3]'};
let v=buildQuestion(run,q);
assert(v.text.includes('Запитання 3 із 5'));
assert(v.text.includes('&lt;важливі&gt;'));
assert(!v.text.includes('Кото'));
assert.equal(v.buttons[0][1].text,'2 ☑️');
assert.equal(v.buttons[0][3].text,'4 ☑️');
assert.equal(v.buttons[1][0].text,'Відповісти пізніше');
assert.equal(v.buttons[2][0].text,'Наступне питання');
assert(v.text.includes('<b>1.</b>'));
assert(!v.text.includes('<b>A.</b>'));
assert.equal(v.buttons.at(-2)[0].callback_data,'c:'+run.id+':2');
assert(v.buttons.flat().every(b=>Buffer.byteLength(b.callback_data)<=64));
const max=buildQuestion({...run,position:0},{question:'&'.repeat(2000),options_json:JSON.stringify(Array(6).fill('a'.repeat(120))),correct_json:'[1]'});
// Telegram's limit is measured after parsing HTML entities.
assert(max.text.replace(/&amp;/g,'&').replace(/<[^>]*>/g,'').length<4096);
assert.equal(displayTitle('Кото-бліц №2 СВ 23.10.2026'),'Перевірка знань №2 23.10.2026');
const env={BOT_TOKEN:'fixture-only',ADMIN_TELEGRAM_IDS:'123,456'};
const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:123})});
const sign=async(key,data)=>{let k=await webcrypto.subtle.importKey('raw',typeof key==='string'?new TextEncoder().encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await webcrypto.subtle.sign('HMAC',k,new TextEncoder().encode(data)));};
let check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
params.set('hash',Buffer.from(await sign(await sign('WebAppData',env.BOT_TOKEN),check)).toString('hex'));
assert.equal(await auth(new Request('https://fixture/',{headers:{'X-Telegram-Init-Data':params.toString()}}),env),'123');
params.set('user',JSON.stringify({id:999}));
await assert.rejects(()=>auth(new Request('https://fixture/',{headers:{'X-Telegram-Init-Data':params.toString()}}),env));
assert(admin(env,'123'));assert(!admin(env,'999'));
assert.equal((await worker.fetch(new Request('https://fixture/api/data'),{DB:{},...env})).status,401);
let page=await worker.fetch(new Request('https://fixture/'),{});
assert.equal(page.status,200);assert((await page.text()).includes('Центр знань'));
const template=fs.readFileSync(new URL('./admin.html',import.meta.url),'utf8');
const parser=fs.readFileSync(new URL('./bulk-import.js',import.meta.url),'utf8').trimEnd();
assert.equal(PAGE,template.replace('/* BULK_IMPORT_PARSER */',()=>parser));
const parseQuestions=vm.runInNewContext(parser+'\nparseQuestionText');
const parse=value=>JSON.parse(JSON.stringify(parseQuestions(value)));
const imported=(question,options)=>({question,options,correct:[],points:1});
assert.deepEqual(parse('1. Що перевірити?\r\nА) Особу\r\nБ) Доступ\r\n2. Що повідомити\r\n• Рішення\r\n• Строк'),[
  imported('Що перевірити?',['Особу','Доступ']),
  imported('Що повідомити',['Рішення','Строк'])
]);
assert.deepEqual(parse('1. Перевірка\n  1) Особа\n  2) Доступ\n2. Результат\n1) Рішення\n2) Строк\n3) Звернення'),[
  imported('Перевірка',['Особа','Доступ']),
  imported('Результат',['Рішення','Строк','Звернення'])
]);
assert.deepEqual(parse('Питання 1: Що зробити\nУточнити\nПояснити\n\nЩо записати\nРішення\nДомовленість'),[
  imported('Що зробити',['Уточнити','Пояснити']),
  imported('Що записати',['Рішення','Домовленість'])
]);
assert.deepEqual(parse('Питання 1: Що зробити?\nА) Уточнити\nПитання 2: Що записати?'),[
  imported('Що зробити?',['Уточнити']),
  imported('Що записати?',[])
]);
assert.deepEqual(parse(' \n '),[]);
assert.equal(parse(Array.from({length:100},(_,i)=>(i+1)+'. Питання?\nA) Так\nB) Ні').join('\n')).length,100);
console.log('PASS: bulk text formats and limits, frontend syntax, Telegram progress/selection/escaping/limits, legacy title, valid and tampered auth, unauthorized API, HTML response.');
