import type { Overview } from '../shared/Api.ts'
import { briefInstruction, questions } from '../shared/ResearchBrief.ts'

const headers = {
  'cache-control': 'public, max-age=15',
  'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function attribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function script(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function document(
  origin: string,
  path: string,
  title: string,
  description: string,
  content: string,
  context: unknown,
) {
  const url = `${origin}${path}`
  const image = `${origin}/xframe-card.jpg`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>${attribute(title)}</title>
<meta name="description" content="${attribute(description)}">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${attribute(title)}">
<meta name="twitter:description" content="${attribute(description)}">
<meta name="twitter:image" content="${attribute(image)}">
<meta name="twitter:player" content="${attribute(url)}">
<meta name="twitter:player:width" content="800">
<meta name="twitter:player:height" content="450">
<meta property="og:type" content="website">
<meta property="og:title" content="${attribute(title)}">
<meta property="og:description" content="${attribute(description)}">
<meta property="og:image" content="${attribute(image)}">
<meta property="og:url" content="${attribute(url)}">
<style>${styles}</style>
</head>
<body>
<div class="app">
  <header><a href="${attribute(origin)}" target="_blank" rel="noreferrer">SWARMS</a><span>LIVE RESEARCH FRAME</span></header>
  <div class="world" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
  ${content}
  <footer><span><b></b> Tempo mainnet</span><a href="${attribute(origin)}" target="_blank" rel="noreferrer">Open Swarm World ↗</a></footer>
</div>
<script>window.__SWARM_FRAME__=${script(context)};</script>
<script>${client}</script>
</body>
</html>`
}

function amounts(label: string) {
  return `<div class="funding" id="funding">
    <div class="amounts" role="group" aria-label="MACH amount">
      <button class="amount selected" data-amount="0.25" type="button">0.25</button>
      <button class="amount" data-amount="1" type="button">1</button>
      <button class="amount" data-amount="5" type="button">5</button>
      <span>MACH</span>
    </div>
    <input id="note" maxlength="280" placeholder="Optional steering note">
    <button class="launch" id="action" type="button">${attribute(label)}</button>
  </div>`
}

function approval() {
  return `<section class="approval" id="approval" hidden>
    <div class="portal"><span>1</span><span>2</span><span>3</span></div>
    <p class="eyebrow">WALLET CHECKPOINT</p>
    <h2>Approve in Tempo Wallet</h2>
    <p>Your code is <strong id="code"></strong>. The swarm starts only after you approve.</p>
    <a class="launch" id="approve" target="_blank" rel="noreferrer">Open Tempo Wallet ↗</a>
  </section>
  <section class="approval success" id="success" hidden>
    <div class="success-mark">✓</div>
    <p class="eyebrow">QUEST FUNDED</p>
    <h2 id="success-title">The swarm is moving</h2>
    <p>Follow every round and every researcher from Swarm World.</p>
    <div class="success-actions"><a class="launch" id="expedition" target="_blank" rel="noreferrer">Enter expedition ↗</a><a class="secondary" id="share" target="_blank" rel="noreferrer">Share on X</a></div>
  </section>`
}

export function start(origin: string) {
  const title = 'Launch a research swarm'
  const description = 'Pick a science quest, fund it with MACH and watch the research party work.'
  const choices = questions
    .map(
      (question, index) =>
        `<button class="quest" data-question="${index}" type="button"><strong>${attribute(question.label)}</strong><span>${attribute(question.hint)}</span></button>`,
    )
    .join('')
  const content = `<main>
    <section class="panel" id="setup">
      <p class="eyebrow">CHOOSE · EQUIP · LAUNCH</p>
      <h1>Start a science quest</h1>
      <p class="lede">Pick a mission. Your swarm handles the expedition.</p>
      <div class="quests" role="group" aria-label="Research quest">${choices}</div>
      <div class="custom"><input id="custom" maxlength="1000" placeholder="Or ask your own research question"><button id="custom-pick" type="button">Use</button></div>
      ${amounts('Launch swarm')}
      <p class="status" id="status">Choose a quest to continue.</p>
    </section>
    ${approval()}
  </main>`
  return new Response(
    document(origin, '/x', title, description, content, {
      briefInstruction,
      kind: 'start',
      questions,
      url: `${origin}/x`,
    }),
    { headers },
  )
}

export function swarm(origin: string, value: Overview) {
  const title = `Fund ${value.title}`
  const description = `Join this research swarm from the timeline. Round ${Math.max(1, value.rounds)} · ${value.workers} researchers.`
  const content = `<main>
    <section class="panel mission" id="setup">
      <div class="mission-top"><p class="eyebrow">${attribute(value.status.toUpperCase())} · ROUND ${Math.max(1, value.rounds)}</p><span>${value.workers} RESEARCHERS</span></div>
      <h1>${attribute(value.title)}</h1>
      <p class="lede clamp">${attribute(value.goal)}</p>
      <div class="mission-stats"><span><strong>${attribute(value.raised)}</strong> raised</span><span><strong>${attribute(value.remaining)}</strong> fuel left</span><span><strong>${value.rounds}</strong> rounds</span></div>
      ${amounts('Back this quest')}
      <p class="status" id="status">Your pledge is capped. Unused MACH returns to your wallet.</p>
    </section>
    ${approval()}
  </main>`
  return new Response(
    document(origin, `/x/s/${encodeURIComponent(value.id)}`, title, description, content, {
      kind: 'swarm',
      swarm: { id: value.id, title: value.title },
      url: `${origin}/x/s/${encodeURIComponent(value.id)}`,
    }),
    { headers },
  )
}

export function card(title: string) {
  const safe = attribute(title.trim().slice(0, 64) || 'Fund a research swarm')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#eaf4df"/><path d="M0 492 300 320 610 500 900 330 1200 505V630H0Z" fill="#cbe5b7"/><path d="M0 560 290 392 600 570 910 400 1200 565" fill="none" stroke="#193d2b" stroke-width="3" opacity=".28"/><g fill="#193d2b"><circle cx="1000" cy="135" r="55"/><circle cx="1000" cy="135" r="27" fill="#eaf4df"/><path d="m945 175 55 32 55-32v65l-55 32-55-32Z"/></g><text x="82" y="112" fill="#193d2b" font-family="ui-monospace,monospace" font-size="24" letter-spacing="5">SWARM WORLD · LIVE QUEST</text><text x="80" y="240" fill="#12251b" font-family="Georgia,serif" font-size="66" font-weight="700">${safe}</text><text x="82" y="315" fill="#315342" font-family="ui-sans-serif,sans-serif" font-size="31">Fund science. Follow every researcher.</text><rect x="82" y="372" width="300" height="70" rx="35" fill="#193d2b"/><text x="232" y="417" fill="#fff" font-family="ui-sans-serif,sans-serif" font-size="25" font-weight="700" text-anchor="middle">ENTER THE QUEST</text></svg>`
  return new Response(svg, {
    headers: {
      'cache-control': 'public, max-age=86400',
      'content-type': 'image/svg+xml; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}

const styles = `
@keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(9px,-7px)}}
@keyframes pulse{0%,100%{opacity:.28;transform:scale(.9)}50%{opacity:.78;transform:scale(1.12)}}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:#eaf4df;color:#13281d;font-family:Inter,ui-sans-serif,system-ui,sans-serif;overflow:hidden}.app{height:100dvh;min-height:320px;position:relative;display:grid;grid-template-rows:46px 1fr 38px;overflow:hidden;background:radial-gradient(circle at 50% -25%,#fff 0,#eaf4df 48%,#dcefd0 100%)}header,footer{position:relative;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font:700 11px ui-monospace,SFMono-Regular,monospace;letter-spacing:.13em}header{border-bottom:1px solid rgba(25,61,43,.16)}header a,footer a{color:inherit;text-decoration:none}header span{color:#587064}footer{border-top:1px solid rgba(25,61,43,.14);letter-spacing:.04em;color:#4c6759}footer span{display:flex;align-items:center;gap:7px}footer b{width:7px;height:7px;border-radius:50%;background:#33a668;box-shadow:0 0 0 5px rgba(51,166,104,.12)}.world{position:absolute;inset:46px 0 38px;background-image:linear-gradient(rgba(25,61,43,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(25,61,43,.07) 1px,transparent 1px);background-size:36px 36px;transform:perspective(500px) rotateX(58deg) scale(1.4);transform-origin:center bottom;opacity:.6}.world i{position:absolute;width:12px;height:12px;background:#2b744d;box-shadow:9px 9px 0 rgba(25,61,43,.18);transform:rotate(30deg);animation:drift 5s ease-in-out infinite}.world i:after{content:"";position:absolute;inset:3px;border-radius:50%;background:#d8ff95;animation:pulse 2s ease-in-out infinite}.world i:nth-child(1){left:12%;top:28%}.world i:nth-child(2){left:31%;top:66%;animation-delay:-1s}.world i:nth-child(3){left:69%;top:24%;animation-delay:-2s}.world i:nth-child(4){left:84%;top:70%;animation-delay:-3s}.world i:nth-child(5){left:54%;top:48%;animation-delay:-4s}main{position:relative;z-index:3;display:flex;align-items:center;justify-content:center;padding:10px 18px;min-height:0}.panel,.approval{width:min(760px,100%);background:rgba(249,252,245,.92);border:1px solid rgba(25,61,43,.2);border-radius:18px;box-shadow:0 18px 50px rgba(25,61,43,.12);padding:16px 18px;backdrop-filter:blur(10px)}.eyebrow{margin:0 0 5px;color:#397052;font:800 10px ui-monospace,SFMono-Regular,monospace;letter-spacing:.14em}h1,h2{font-family:Georgia,serif;letter-spacing:-.025em}h1{font-size:clamp(27px,5vw,42px);line-height:1;margin:0 0 5px}h2{font-size:clamp(25px,4vw,38px);margin:4px 0 8px}.lede{margin:0 0 11px;color:#4b6457;font-size:13px}.quests{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:8px}.quest{min-height:58px;text-align:left;padding:9px 10px;border:1px solid rgba(25,61,43,.18);border-radius:11px;background:#f8fbf5;color:inherit;cursor:pointer}.quest strong,.quest span{display:block}.quest strong{font-size:12px;line-height:1.15}.quest span{font-size:10px;line-height:1.2;color:#61776a;margin-top:4px}.quest:hover,.quest.selected{background:#1a3d2c;color:#fff;border-color:#1a3d2c;transform:translateY(-1px)}.quest.selected span{color:#cfe2d7}.custom{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:8px}.custom input,.funding input{width:100%;height:39px;border:1px solid rgba(25,61,43,.18);border-radius:10px;background:#fff;color:#13281d;padding:0 11px;font:500 12px inherit;outline:none}.custom input:focus,.funding input:focus{border-color:#307a51;box-shadow:0 0 0 3px rgba(48,122,81,.12)}button,.launch,.secondary{min-height:39px;border:0;border-radius:10px;font:800 12px inherit;cursor:pointer;transition:.15s ease}.custom button,.secondary{padding:0 14px;background:#dae8d2;color:#173b29}.funding{display:grid;grid-template-columns:auto minmax(120px,1fr) minmax(130px,auto);gap:7px;align-items:center}.amounts{display:flex;align-items:center;border:1px solid rgba(25,61,43,.18);border-radius:10px;background:#fff;padding:3px;height:39px}.amounts span{padding:0 7px;font:800 9px ui-monospace,SFMono-Regular,monospace;color:#557064}.amount{min-width:41px;min-height:31px;background:transparent;color:#294c39}.amount.selected{background:#d9edb4;color:#183b29}.launch{display:inline-flex;align-items:center;justify-content:center;background:#193d2b;color:#fff;text-decoration:none;padding:0 18px}.launch:hover{background:#24593e;transform:translateY(-1px)}.launch:disabled{opacity:.42;cursor:not-allowed;transform:none}.status{min-height:14px;margin:7px 2px 0;color:#597064;font-size:10px}.status.error{color:#a13f35}.mission h1{font-size:clamp(30px,6vw,52px);max-width:680px}.mission-top{display:flex;justify-content:space-between;align-items:center}.mission-top>span{font:800 9px ui-monospace,SFMono-Regular,monospace;color:#496859}.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;max-width:680px}.mission-stats{display:flex;gap:8px;margin:9px 0 12px}.mission-stats span{padding:7px 9px;border-radius:8px;background:#e5f0dc;color:#5a7064;font-size:10px}.mission-stats strong{color:#1a432f;font-size:12px}.approval{text-align:center;max-width:560px;padding:25px}.approval p:not(.eyebrow){margin:0 auto 16px;color:#587064;font-size:13px}.approval .launch{min-width:220px}.portal{display:flex;justify-content:center;gap:10px;margin-bottom:12px}.portal span{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:#dcecbf;color:#1b5034;font:900 16px ui-monospace,monospace;box-shadow:0 7px 18px rgba(25,61,43,.12)}.portal span:nth-child(2){transform:translateY(-8px);background:#1b5034;color:#fff}.success-mark{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;margin:0 auto 12px;background:#1d7448;color:#fff;font-size:25px}.success-actions{display:flex;justify-content:center;gap:8px}.secondary{display:inline-flex;align-items:center;justify-content:center;padding:0 18px;text-decoration:none}.approval[hidden],.panel[hidden]{display:none}@media(max-width:560px){header,footer{padding:0 11px}header span{font-size:8px}.app{grid-template-rows:40px 1fr 34px}.world{inset:40px 0 34px}main{padding:7px}.panel{padding:12px}.lede{font-size:11px}.quest{padding:7px;min-height:64px}.quest strong{font-size:10px}.quest span{font-size:9px}.funding{grid-template-columns:1fr 1fr}.amounts{grid-column:1/-1}.funding .launch{grid-column:2}.funding input{grid-column:1}.mission-stats{margin:7px 0}.mission-stats span{padding:5px 7px}.approval{padding:18px}.success-actions{flex-direction:column}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

const client = `
const frame=window.__SWARM_FRAME__;
const setup=document.getElementById('setup');
const approval=document.getElementById('approval');
const success=document.getElementById('success');
const action=document.getElementById('action');
const statusLine=document.getElementById('status');
const note=document.getElementById('note');
let amount='0.25';
let choice=null;
let currentSwarm=frame.swarm||null;
let polling=false;
const say=(text,error=false)=>{statusLine.textContent=text;statusLine.classList.toggle('error',error)};
document.querySelectorAll('.amount').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.amount').forEach(item=>item.classList.remove('selected'));button.classList.add('selected');amount=button.dataset.amount}));
if(frame.kind==='start'){
  const custom=document.getElementById('custom');
  const pick=index=>{choice=frame.questions[index];document.querySelectorAll('.quest').forEach((item,at)=>item.classList.toggle('selected',at===index));custom.value='';say(choice.label+' selected. Add fuel and launch.');action.disabled=false};
  document.querySelectorAll('.quest').forEach((button,index)=>button.addEventListener('click',()=>pick(index)));
  const customPick=()=>{const question=custom.value.trim();if(question.length<10){say('Ask a research question with at least 10 characters.',true);return}choice={label:question,title:question.slice(0,80),goal:question+'\\n\\n'+frame.briefInstruction};document.querySelectorAll('.quest').forEach(item=>item.classList.remove('selected'));say('Custom quest selected. Add fuel and launch.');action.disabled=false};
  document.getElementById('custom-pick').addEventListener('click',customPick);
  custom.addEventListener('keydown',event=>{if(event.key==='Enter')customPick()});
  action.disabled=true;
}
async function send(path,options){
  const response=await fetch(path,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.detail||'The request failed.');error.status=response.status;throw error}
  return data;
}
function pledgePath(id,pledge){return '/v1/swarms/'+encodeURIComponent(id)+'/pledges/'+encodeURIComponent(pledge)}
function finish(){
  polling=false;approval.hidden=true;success.hidden=false;
  document.getElementById('success-title').textContent=currentSwarm.title+' is moving';
  document.getElementById('expedition').href='/s/'+encodeURIComponent(currentSwarm.id);
  const shareUrl=new URL(frame.url).origin+'/x/s/'+encodeURIComponent(currentSwarm.id);
  document.getElementById('share').href='https://x.com/intent/post?text='+encodeURIComponent('I backed '+currentSwarm.title+' on Swarm World '+shareUrl);
}
async function poll(requested){
  if(polling)return;polling=true;
  const expires=requested.device.expiresAt;
  try{
    while(Date.now()<expires){
      const result=await send(pledgePath(currentSwarm.id,requested.pledge)+'?wait=15');
      if(result.status!=='pending'){finish();return}
      await new Promise(resolve=>setTimeout(resolve,Math.max(1500,requested.device.interval*1000)));
    }
    throw new Error('The wallet approval expired. Try again.');
  }catch(error){polling=false;approval.hidden=true;setup.hidden=false;action.disabled=false;say(error.message||'Approval failed.',true)}
}
function approve(requested){
  setup.hidden=true;approval.hidden=false;
  document.getElementById('code').textContent=requested.device.userCode;
  const link=document.getElementById('approve');link.href=requested.device.verificationUriFull;
  link.addEventListener('click',()=>poll(requested),{once:true});
  void poll(requested);
}
action.addEventListener('click',async()=>{
  action.disabled=true;say(frame.kind==='start'?'Opening the expedition…':'Preparing your pledge…');
  try{
    if(!currentSwarm){
      if(!choice)throw new Error('Choose a quest first.');
      currentSwarm=await send('/v1/swarms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:choice.title,goal:choice.goal})});
    }
    const requested=await send('/v1/swarms/'+encodeURIComponent(currentSwarm.id)+'/pledges',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount,note:note.value.trim()||undefined,token:'mach',device:true})});
    if(!requested.device)throw new Error('Tempo Wallet did not return an approval link.');
    approve(requested);
  }catch(error){action.disabled=false;say(error.message||'Could not start the wallet approval.',true)}
});
`
