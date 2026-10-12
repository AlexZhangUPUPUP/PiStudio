/**
 * Two independent Chrome instances pointing at the same session.
 * Verifies that a user message typed in one client is rendered in the other
 * (it can only come from the `message_start` event — the sender draws it
 * optimistically and must not get a duplicate).
 *
 *   node server.js --cwd . &                       # :4173
 *   ".../Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pi-tab-a about:blank &
 *   ".../Google Chrome" --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/pi-tab-b about:blank &
 *   node dev/multi-tab-test.mjs
 */
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function connect(port){
  const list=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  const t=list.find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0; const p=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}});
  const send=(method,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true}); return r.result?.value;};
  await send('Page.enable'); await send('Runtime.enable');
  // Two tabs are independent sessions by design, so pin both to one client id —
  // that is what makes this a cross-client rendering test rather than two chats.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try { sessionStorage.setItem('pi-gui-client', 'multitab-test'); } catch {}",
  });
  return {ev,send};
}
const A=await connect(9222);
const B=await connect(9223);
await A.send('Page.navigate',{url:'http://127.0.0.1:4173/'});
await B.send('Page.navigate',{url:'http://127.0.0.1:4173/'});
await sleep(3500);
console.log('A 状态:', await A.ev(`document.querySelector('#status').textContent`));
console.log('B 状态:', await B.ev(`document.querySelector('#status').textContent`));

const prompt='Say exactly: TWO TABS OK';
await A.ev(`(()=>{const i=document.querySelector('#input');i.value=${JSON.stringify(prompt)};i.dispatchEvent(new Event('input'));document.querySelector('#btn-send').click();return true})()`);
console.log('→ 已从 A 发出:', prompt);

const t0=Date.now();
while(Date.now()-t0<60000){
  const done = await B.ev(`[...document.querySelectorAll('.msg.assistant .md')].some(e=>/TWO TABS OK/.test(e.textContent))`);
  if(done) break;
  await sleep(400);
}
const bUsers = await B.ev(`[...document.querySelectorAll('.msg.user')].map(e=>e.innerText.trim())`);
const bAssist = await B.ev(`[...document.querySelectorAll('.msg.assistant .md')].map(e=>e.innerText.trim())`);
console.log('B 看到的用户消息:', JSON.stringify(bUsers));
console.log('B 看到的助手回复:', JSON.stringify(bAssist.slice(-2)));
console.log('');
const okUsers = bUsers.some((t) => t.includes('TWO TABS OK'));
const okReply = bAssist.some((t) => /TWO TABS OK/.test(t));
const okDupe = bUsers.filter((t) => t.includes('TWO TABS OK')).length === 1;
console.log(okUsers ? '✅ B 页显示了 A 发出的提问' : '❌ B 页缺少提问气泡');
console.log(okReply ? '✅ B 页显示了回复' : '❌ B 页缺少回复');
console.log(okDupe ? '✅ 没有重复气泡' : '❌ 出现重复气泡');
process.exit(okUsers && okReply && okDupe ? 0 : 1);
