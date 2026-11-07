import type { Overview, Summary } from '../shared/Api.ts'
import { briefInstruction, open } from '../shared/ResearchBrief.ts'
import * as Status from '../shared/Status.ts'

const headers = {
  'cache-control': 'public, max-age=15',
  'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

const player = {
  'cache-control': 'public, max-age=15',
  'content-security-policy': "object-src 'none'; base-uri 'none'; script-src 'self' 'unsafe-inline'",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

const mini = {
  'cache-control': 'public, max-age=15',
  'content-security-policy': "object-src 'none'; base-uri 'none'; script-src 'self' 'unsafe-inline' https://telegram.org",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

const sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'

export function shell(request?: URL) {
  return request?.pathname === '/tg' || request?.pathname.startsWith('/tg/') ? '/tg' : '/x'
}

const host = `(()=>{const frame=document.getElementById('xframe-player');const own=location.origin;const allowed=value=>{try{const url=new URL(value);if(url.origin==='https://wallet.tempo.xyz'&&/^[a-z0-9-]{8,16}$/i.test(url.searchParams.get('user_code')||''))return 'wallet';if(url.origin===own&&(url.pathname.startsWith('/s/')||url.pathname.startsWith('/x/')))return 'page';if(url.origin==='https://x.com'&&url.pathname==='/intent/post')return 'page'}catch{}};addEventListener('message',event=>{const message=event.data;if(event.source!==frame.contentWindow||message?.type!=='swarms:open'||typeof message.url!=='string')return;const kind=allowed(message.url);if(!kind)return;let popup=null;try{popup=kind==='wallet'?window.open(message.url,'swarms-wallet','popup,width=460,height=760'):window.open(message.url,'_blank','noopener')}catch{}if(!popup&&kind==='wallet')location.href=message.url});const content=new URL(location.href);content.searchParams.set('xframes-content','');frame.src=content.href})();`

function attribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function script(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function dollars(value: string) {
  const number = Number(value)
  return Number.isFinite(number) ? '$' + number.toFixed(2) : value
}

function backers(count: number) {
  return `${count} backer${count === 1 ? '' : 's'}`
}

function document(origin: string, path: string, title: string, description: string, content: string, context: object, status = 200, request?: URL, bot?: string) {
  const base = shell(request)
  const url = `${origin}${base}${path}`
  const card = `${origin}/x${path}`
  const image = `${origin}/xframe-card.jpg?v=3`
  const telegram = base === '/tg'
  const hosted = request !== undefined && !telegram && !request.searchParams.has('xframes-content')
  const tags = `<meta charset="utf-8"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>${attribute(title)}</title>
<meta name="description" content="${attribute(description)}">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${attribute(title)}">
<meta name="twitter:description" content="${attribute(description)}">
<meta name="twitter:image" content="${attribute(image)}">
<meta name="twitter:player" content="${attribute(card)}">
<meta name="twitter:player:width" content="800">
<meta name="twitter:player:height" content="450">
<meta property="og:type" content="website">
<meta property="og:title" content="${attribute(title)}">
<meta property="og:description" content="${attribute(description)}">
<meta property="og:image" content="${attribute(image)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="450">
<meta property="og:url" content="${attribute(url)}">`
  if (hosted)
    return new Response(
      `<!doctype html>
<html lang="en">
<head>
${tags}
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f6f8f2}#xframe-player{display:block;border:0;width:100%;height:100%}</style>
</head>
<body>
<iframe id="xframe-player" title="${attribute(title)}" sandbox="${sandbox}" allow="autoplay; fullscreen *; clipboard-write"></iframe>
<script>${host}</script>
</body>
</html>`,
      { headers: player, status },
    )
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
${tags}
${telegram ? '<script src="https://telegram.org/js/telegram-web-app.js?59"></script>\n' : ''}<style>${styles}</style>
</head>
<body${telegram ? ' class="tg"' : ''}>
<div class="app">${content}</div>
<script>window.__SWARM_FRAME__=${script({ ...context, base, bot: telegram ? (bot ?? null) : null, hosted: !telegram && (request?.searchParams.has('xframes-content') ?? false), telegram, url })};</script>
<script>${client}</script>
</body>
</html>`,
    { headers: telegram ? mini : headers, status },
  )
}

function amounts(label: string, extra = '') {
  return `<div class="pay">
    ${extra}
    <p class="big"><span>$</span><b data-big>2</b></p>
    <div class="seg" role="radiogroup" aria-label="Amount">
      <button aria-checked="true" data-amount="2" role="radio" type="button">$2</button>
      <button aria-checked="false" data-amount="5" role="radio" type="button">$5</button>
      <button aria-checked="false" data-amount="10" role="radio" type="button">$10</button>
    </div>
    <button class="go" data-go type="button">${attribute(label)}</button>
    <p class="status" data-status></p>
  </div>`
}

const wallet = `<section class="view center" data-view="approve" hidden>
    <p class="kicker">Send it with Tempo Wallet</p>
    <p class="code" id="code">$2</p>
    <a class="go wide" id="approve" target="_blank" rel="noreferrer">Open the swarm to pay ↗</a>
    <p class="hint">You send USDC.e, OUSD, pathUSD or MACH from its page.</p>
    <button class="back" data-back type="button">Cancel</button>
  </section>
  <section class="view center" data-view="done" hidden>
    <i class="mark">✓</i>
    <h2 id="done-title">You're in.</h2>
    <div class="row"><a class="go" id="watch" target="_blank" rel="noreferrer">Watch it ↗</a><a class="ghost" id="share" target="_blank" rel="noreferrer">Share</a></div>
  </section>
`

export function start(origin: string, swarms: readonly Summary[] = [], request?: URL, bot?: string) {
  const base = shell(request)
  const title = 'Start a breakthrough, or be part of one'
  const description = 'Fund research an AI does in the open. Start one, or join one already running.'
  const free = open(swarms)
  const ideas = free.slice(0, 4)
  const latest = Math.max(0, ...swarms.map((item) => item.updatedAt))
  const live = Status.ranked(swarms.filter((item) => item.status !== 'done'), latest)
  const counted = Status.count(swarms)
  const peekIdeas = ideas.slice(0, 4).map((item) => `<span class="chip"><i class="mark-idea"></i><b>${attribute(item.label)}</b></span>`).join('')
  const peekSwarms = live.slice(0, 4).map((item) => `<span class="chip"><i class="dot" data-status="${item.status}"></i><b>${attribute(item.title)}</b><em>${dollars(item.raised)}</em></span>`).join('')
  const rows = ideas
    .map((item, index) => `<li><button class="row-item idea" data-idea="${index}" type="button"><i class="mark-idea"></i><span>${attribute(item.label)}</span></button></li>`)
    .join('')
  const joins = live
    .slice(0, 6)
    .map((item) => `<li><a class="row-item" href="${base}/s/${encodeURIComponent(item.id)}"><i class="dot" data-status="${item.status}"></i><span>${attribute(item.title)}<small>${Status.word(item)} · ${backers(item.contributors)}</small></span><em>${dollars(item.raised)}</em></a></li>`)
    .join('')
  const content = `<section class="view doors" data-view="home">
    <button class="door door-start" data-open="start" type="button">
      <span class="door-kicker">${Status.ideas(free.length)}</span>
      <span class="door-title">Start a breakthrough <i>→</i></span>
      <span class="door-peek">${peekIdeas}</span>
    </button>
    <button class="door door-join" data-open="join" type="button">
      <span class="door-kicker">${counted.running ? '<i class="live"></i>' : ''}${counted.text}</span>
      <span class="door-title">Be part of the future <i>→</i></span>
      <span class="door-peek">${peekSwarms || '<span class="chip">Nothing yet. Be the first.</span>'}</span>
    </button>
  </section>
  <section class="view split" data-view="start" hidden>
    <div class="left">
      <header class="top"><button class="back" data-back type="button">←</button><h1>Start a breakthrough</h1></header>
      <ol class="list">${rows}<li><label class="row-item idea own"><i class="mark-idea"></i><input id="custom" maxlength="1000" placeholder="Your own idea"></label></li></ol>
    </div>
    ${amounts('Launch')}
  </section>
  <section class="view" data-view="join" hidden>
    <header class="top"><button class="back" data-back type="button">←</button><h1>Be part of the future</h1></header>
    ${joins ? `<ol class="list scroll">${joins}</ol>` : '<button class="empty" data-open="start" type="button">No swarms yet. <b>Start a swarm →</b></button>'}
  </section>
  ${wallet}`
  return document(origin, '', title, description, content, { briefInstruction, ideas, kind: 'home' }, 200, request, bot)
}

export function swarm(origin: string, value: Overview, request?: URL, bot?: string) {
  const working = value.status === 'running' ? value.working : null
  const done = value.status === 'done'
  const title = working ? `Live: ${value.title}` : done ? value.title : `Fund ${value.title}`
  const description = working ? 'Watch this swarm work, live, and steer it.' : `${backers(value.contributors)} · ${dollars(value.raised)} raised.`
  const page = `${origin}/s/${encodeURIComponent(value.id)}`
  const latest = value.updates.at(-1)?.excerpt ?? null
  const content = `<section class="view room" data-view="room">
    <header class="head">
      <i class="dot" data-status="${value.status}"></i>
      <a class="name" href="${attribute(page)}" target="_blank" rel="noreferrer">${attribute(value.title)}</a>
      <span class="sum">${dollars(value.raised)} · ${value.contributors}</span>
      ${done ? `<a class="go small" href="${attribute(page)}" target="_blank" rel="noreferrer">Result ↗</a>` : '<button class="go small" data-open="fund" type="button">Fund</button>'}
    </header>
    <nav class="tabs" role="tablist">
      <button aria-selected="true" data-tab="transcript" role="tab" type="button">Transcript</button>
      <button aria-selected="false" data-tab="chat" role="tab" type="button">Room <span id="watching"></span></button>
    </nav>
    <ol class="feed" data-pane="transcript" aria-live="polite">
      <li class="beat quiet" id="empty-feed">${attribute(latest ?? (working ? 'Tuning in…' : value.goal))}</li>
      <li class="beat now" id="now" hidden><span class="who" id="now-who">Agent</span><span class="say" id="now-text"></span></li>
    </ol>
    <ol class="feed" data-pane="chat" hidden><li class="beat quiet" id="empty-chat">Quiet so far.</li></ol>
    ${done ? '' : `<form class="steer" id="steer">
      <span class="tag">@swarm</span>
      <input id="note" maxlength="280" placeholder="Steer the agent" autocomplete="off">
      <span class="stake" id="stake" hidden><button aria-checked="true" data-stake="2" role="radio" type="button">$2</button><button aria-checked="false" data-stake="5" role="radio" type="button">$5</button><button aria-checked="false" data-stake="10" role="radio" type="button">$10</button></span>
      <button class="send" disabled type="submit" aria-label="Send">↑</button>
    </form>`}
  </section>
  <section class="view split" data-view="fund" hidden>
    <div class="left">
      <header class="top"><button class="back" data-back type="button">←</button><h1>Fund it</h1></header>
      <p class="fund-name"><i class="dot" data-status="${value.status}"></i>${attribute(value.title)}</p>
      <p class="hint">${dollars(value.raised)} raised · ${backers(value.contributors)}</p>
      <p class="goal">${attribute(latest ?? value.goal)}</p>
      ${value.notes.length ? `<ol class="list notes">${value.notes.slice(0, 3).map((note) => `<li class="row-item"><span>${attribute(note.note)}</span><em>${dollars(note.weight)}</em></li>`).join('')}</ol>` : ''}
      <p class="behind" id="behind" hidden></p>
    </div>
    ${amounts('Fund')}
  </section>
  ${wallet}`
  return document(origin, `/s/${encodeURIComponent(value.id)}`, title, description, content, {
    kind: 'swarm',
    live: working ? { since: working.since } : null,
    page,
    swarm: { id: value.id, title: value.title },
  }, 200, request, bot)
}

export function lost(origin: string, request?: URL, bot?: string) {
  const base = shell(request)
  const content = `<section class="view center" data-view="lost">
    <h2>This swarm drifted off.</h2>
    <div class="row"><a class="go" href="${base}?view=start">Start a swarm</a><a class="ghost" href="${base}?view=join">Join a swarm</a></div>
  </section>`
  return document(origin, '', 'Swarms', 'Fund research an AI does in the open.', content, { kind: 'lost' }, 404, request, bot)
}

export function card(title: string) {
  const safe = attribute(title.trim().slice(0, 64) || 'Start a breakthrough')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f6f8f2"/><rect x="60" y="60" width="1080" height="510" rx="40" fill="#1a3d2c"/><text x="120" y="160" fill="#b8d3a6" font-family="ui-monospace,monospace" font-size="26">Swarms</text><text x="118" y="300" fill="#fff" font-family="Georgia,serif" font-size="64">${safe}</text><rect x="120" y="400" width="240" height="76" rx="20" fill="#fff"/><text x="240" y="449" fill="#1a3d2c" font-family="ui-sans-serif,sans-serif" font-size="28" text-anchor="middle">Fund it →</text></svg>`
  return new Response(svg, { headers: { 'cache-control': 'public, max-age=86400', 'content-type': 'image/svg+xml; charset=utf-8', 'x-content-type-options': 'nosniff' } })
}

const mono = 'ui-monospace,SFMono-Regular,Menlo,monospace'

const styles = `
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:#f6f8f2;color:#161616;font:15px/1.4 Georgia,'Times New Roman',serif;overflow:hidden;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit}a{color:inherit}
:focus-visible{outline:2px solid #1a3d2c;outline-offset:2px}.door-join:focus-visible,.door-join :focus-visible,.go:focus-visible{outline-color:#6d8e52}
.app{position:relative;height:100dvh;padding:16px;display:flex}
.view{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;animation:in .18s ease-out}
.view[hidden]{display:none}
@keyframes in{from{opacity:0;transform:translateY(6px)}}
.center{align-items:center;justify-content:center;text-align:center;gap:14px}
.split{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:16px;align-items:stretch}
.split[hidden]{display:none}
.left{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
.left>.list:not(.notes){flex:1;display:flex;flex-direction:column}
.left>.list:not(.notes)>li{flex:1;display:flex}
.left>.list:not(.notes) .row-item{flex:1}
.goal{margin:0;display:-webkit-box;overflow:hidden;font-size:16px;line-height:1.5;color:#3d3d3d;-webkit-box-orient:vertical;-webkit-line-clamp:4}
.notes{margin-top:auto}
.notes .row-item{cursor:default;font-size:14px}
.fund-name{margin:0}
.top{display:flex;align-items:center;gap:8px}
h1{margin:0;font-weight:400;font-size:26px;line-height:1.1;letter-spacing:-.03em}
h2{margin:0;font-weight:400;font-size:28px;letter-spacing:-.02em;max-width:620px}
.back{flex-shrink:0;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:none;font-size:18px;color:#5c7350;cursor:pointer}
.back:hover{background:#eef2ea}
.center .back{width:auto;padding:0 12px;font:12px ${mono}}
.doors{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.door{display:flex;flex-direction:column;gap:10px;padding:22px;border:1px solid #dbe2d0;border-radius:22px;background:#fff;text-align:left;cursor:pointer;transition:transform .2s,box-shadow .2s}
.door:hover{transform:translateY(-3px);box-shadow:0 20px 40px -26px #1a3d2c99}
.door-join{border-color:#1a3d2c;background:#1a3d2c;color:#fff}
.door-kicker{display:flex;align-items:center;gap:6px;font:11px ${mono};color:#5c7350}
.door-join .door-kicker{color:#b8d3a6}
.door-title{font-size:34px;line-height:1;letter-spacing:-.04em}
.door-title i{font-style:normal;display:inline-block;transition:transform .2s}
.door:hover .door-title i{transform:translateX(6px)}
.door-peek{display:grid;gap:6px;margin-top:auto}
.chip{display:flex;align-items:center;gap:8px;min-width:0;min-height:42px;padding:6px 12px;border-radius:12px;background:#f2f5ec;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.door-join .chip{background:#ffffff14}
.chip b{flex:1;min-width:0;overflow:hidden;font-weight:400;white-space:nowrap;text-overflow:ellipsis}.chip em{flex-shrink:0;margin-left:auto;font:11px ${mono};font-style:normal;opacity:.7}
.live{width:7px;height:7px;border-radius:50%;background:#7dff7d}
.list{margin:0;padding:0;list-style:none;overflow:hidden;border:1px solid #e3e9dd;border-radius:14px;background:#fbfcf9}
.list.scroll{overflow-y:auto}
[data-view=join] .list .row-item{min-height:56px;font-size:17px}.row-item small{display:block;font:11px ui-monospace,SFMono-Regular,monospace;color:#6b6b6b}[data-view=join] .row-item span{white-space:normal}
.list li+li{border-top:1px solid #e3e9dd}
.row-item{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:9px 14px;border:0;background:none;text-align:left;font-size:16px;text-decoration:none;cursor:pointer}
.row-item:hover{background:#fff}
.row-item span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row-item em{font:12px ${mono};font-style:normal;color:#6b6b6b}
.idea[aria-pressed=true]{background:#fff;box-shadow:inset 3px 0 #1a3d2c}
.mark-idea{flex-shrink:0;width:9px;height:9px;border-radius:3px;background:#688545;transform:rotate(45deg)}
.idea[aria-pressed=true] .mark-idea{background:#1a3d2c}
.own{cursor:text}.own .mark-idea{background:none;border:1px dashed #a5b79c}
.own input{flex:1;min-width:0;border:0;outline:none;background:none;font-size:16px}
.dot{flex-shrink:0;width:9px;height:9px;border-radius:50%;background:#bdbdbd}
.dot[data-status=running]{background:#2fae5a;box-shadow:0 0 0 4px #2fae5a22}
.door-join .dot[data-status=running]{background:#7dff7d}
.dot[data-status=paused],.dot[data-status=funding]{background:#e0a43c}
.dot[data-status=done]{background:#2b2b2b}
.empty{flex:0 0 auto;padding:28px;border:1px dashed #cfd9c6;border-radius:14px;background:none;color:#6b6b6b;font-size:16px;cursor:pointer}
.empty b{font:13px ${mono};font-weight:400;color:#161616}
.pay{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #e3e9dd;border-radius:18px;background:#fff}
.big{flex:1;display:flex;align-items:center;justify-content:center;gap:2px;margin:0}
.big span{font-size:34px;color:#6b6b6b;margin-top:-18px}.big b{font-weight:400;font-size:84px;line-height:1;letter-spacing:-.03em}
.seg{display:flex;overflow:hidden;border:1px solid #dbe2d0;border-radius:12px;background:#fbfcf9}
.seg button{flex:1;min-height:40px;border:0;background:none;font:13px ${mono};cursor:pointer}
.seg button+button{border-left:1px solid #dbe2d0}
.seg button[aria-checked=true]{background:#1a3d2c;color:#fff}
.go{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 20px;border:0;border-radius:12px;background:#161616;color:#fff;font:15px ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.go.small{min-height:32px;padding:0 14px;border-radius:9px;font-size:13px}
.go.wide{min-width:220px}
.go:disabled{background:#d6decf;color:#8a9585;cursor:default}
.ghost{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 20px;border:1px solid #dbe2d0;border-radius:12px;font:15px ui-sans-serif,system-ui,sans-serif;text-decoration:none}
.status{min-height:15px;margin:0;font:11px/1.4 ${mono};color:#b3261e;text-align:center}
.kicker{margin:0;font:13px ${mono};color:#5c7350}
.code{margin:0;font:400 54px/1 ${mono};letter-spacing:.14em}
.hint{margin:0;font:12px ${mono};color:#6b6b6b}
.mark{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#1a3d2c;color:#fff;font-style:normal;font-size:22px}
.mark.bad{background:#b3261e}
.row{display:flex;gap:10px}
.room{gap:0;margin:-16px;border-radius:0}
.head{display:flex;align-items:center;gap:10px;padding:12px 16px 8px}
.name{flex:1;min-width:0;overflow:hidden;font-size:19px;letter-spacing:-.02em;white-space:nowrap;text-overflow:ellipsis;text-decoration:none}
.sum{flex-shrink:0;font:12px ${mono};color:#6b6b6b}
.tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid #e3e9dd}
.tabs button{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:0;background:none;color:#6b6b6b;font:12.5px ${mono};cursor:pointer}
.tabs button[aria-selected=true]{color:#161616;box-shadow:inset 0 -2px #161616}
#watching{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#6b6b6b}
#watching:not(:empty)::before{content:'';width:6px;height:6px;border-radius:50%;background:#2fbf4a}
.feed{flex:1;min-height:0;margin:0;padding:10px 16px;overflow-y:auto;list-style:none;scrollbar-width:thin}
.feed[hidden]{display:none}
.beat{margin:0 0 8px;font-size:15px;line-height:1.45;overflow-wrap:anywhere}
.beat .who{display:block;margin-bottom:2px;font:10.5px ${mono};color:#2f5f37}
.beat.quiet{color:#6b6b6b}
.beat.tool{overflow:hidden;font:12px/1.6 ${mono};color:#6b6b6b;white-space:nowrap;text-overflow:ellipsis}
.beat.thinking{font-style:italic;color:#7b8576}
.beat.said .say{display:inline-block;padding:7px 11px;border-radius:4px 14px 14px 14px;background:#eef5e6}
.beat.chat .say{display:inline-block;padding:7px 11px;border-radius:4px 14px 14px 14px;background:#fff;border:1px solid #e3e9dd}
.amt{display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;background:#1a3d2c;color:#fff;font:10px/1.6 ${mono}}
.now .say::after{content:'';display:inline-block;width:6px;height:1em;margin-left:2px;vertical-align:-2px;background:#3f7d4e;animation:caret 1s steps(1) infinite}
@keyframes caret{50%{opacity:0}}
.steer{display:flex;align-items:center;gap:6px;margin:8px 12px 12px;padding:4px 4px 4px 6px;border:1px solid #e3e9dd;border-radius:24px;background:#fff}
.steer:focus-within{border-color:#a5b79c}
.tag{flex-shrink:0;padding:3px 8px;border-radius:14px;background:#1a3d2c;color:#fff;font:12px ${mono}}
.steer input{flex:1;min-width:0;padding:8px 4px;border:0;outline:none;background:none;font-size:15px}
.stake{display:flex;gap:3px}.stake[hidden]{display:none}
.stake button{height:28px;padding:0 9px;border:1px solid #e3e9dd;border-radius:14px;background:#fff;font:12px ${mono};cursor:pointer}
.stake button[aria-checked=true]{border-color:#1a3d2c;background:#1a3d2c;color:#fff}
.send{flex-shrink:0;width:36px;height:36px;border:0;border-radius:50%;background:#1a3d2c;color:#fff;font-size:16px;cursor:pointer}
.send:disabled{background:#e3e9dd;color:#a5b79c;cursor:default}
.fund-name{display:flex;align-items:center;gap:10px;margin:6px 0 0;font-size:22px;line-height:1.25;letter-spacing:-.02em}
.behind{margin:6px 0 0;padding:10px 12px;border:1px solid #c5d4b6;border-radius:12px;background:#f1f6ea;font-size:15px}
.behind b{display:block;font:11px ${mono};font-weight:400;color:#4b6a3a}
@media(max-width:560px) and (max-aspect-ratio:1/1){.big b{font-size:56px!important}.door-peek{margin-top:6px}.door-peek .chip:nth-child(n+3){display:none}.goal{-webkit-line-clamp:2}.notes{display:none}.pay{padding:12px}.app{padding:12px}.doors{grid-template-columns:1fr}.door{padding:16px}.door-title{font-size:26px}.door-peek .chip:nth-child(n+4){display:none}.doors{align-content:stretch}.door{gap:8px}.split{grid-template-columns:1fr;gap:10px}h1{font-size:22px}.big b{font-size:42px}.go,.ghost{min-height:44px}.code{font-size:38px}.row{flex-direction:column;width:100%}.room{margin:-12px}.sum{display:none}.stake button{padding:0 7px}}
.tg .app{height:var(--tg-viewport-stable-height,100dvh)}.tg .top .back{display:none}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

const client = `
const frame=window.__SWARM_FRAME__;
const fit=()=>{const app=document.querySelector('.app');const wide=innerWidth>innerHeight;const scale=Math.min(innerWidth/800,innerHeight/450);if(wide&&scale<1){app.style.width='800px';app.style.height='450px';app.style.zoom=String(scale)}else{app.style.width='';app.style.height='';app.style.zoom=''}};fit();addEventListener('resize',fit);
if(frame.hosted)document.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(!link||event.defaultPrevented)return;const url=new URL(link.href,location.href);if(link.target==='_blank'){event.preventDefault();parent.postMessage({type:'swarms:open',url:url.href},new URL(frame.url).origin);return}if(url.origin===new URL(frame.url).origin&&url.pathname.startsWith('/x')){url.searchParams.set('xframes-content','');link.href=url.href}},true);
const query=new URLSearchParams(location.search);
const demo=query.get('scene');
const views=[...document.querySelectorAll('[data-view]')];
let current=views.find(item=>!item.hidden)?.dataset.view;
const history=[];
const tg=frame.telegram?window.Telegram&&window.Telegram.WebApp:null;
const chrome=()=>{if(!tg)return;if(history.length||frame.kind!=='home')tg.BackButton.show();else tg.BackButton.hide()};
const show=(name,push=true)=>{if(push&&current&&current!==name)history.push(current);views.forEach(item=>item.hidden=item.dataset.view!==name);current=name;chrome()};
const back=()=>{show(history.pop()||views[0].dataset.view,false)};
document.querySelectorAll('[data-back]').forEach(button=>button.addEventListener('click',()=>back()));
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.open)));
let amount='2',choice=null,note='',currentSwarm=frame.swarm||null;
if(tg){
  tg.ready();tg.expand();
  try{tg.setHeaderColor('#f6f8f2');tg.setBackgroundColor('#f6f8f2');tg.disableVerticalSwipes()}catch{}
  tg.BackButton.onClick(()=>{if(history.length)back();else location.href=frame.base+'?view=join'});
  document.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[target=_blank]'):null;if(!link||event.defaultPrevented)return;event.preventDefault();const url=new URL(link.href,location.href);if(url.origin==='https://t.me')tg.openTelegramLink(url.href);else tg.openLink(url.href)},true);
  chrome();
}
document.querySelectorAll('[data-amount]').forEach(button=>button.addEventListener('click',()=>{const box=button.closest('.pay');box.querySelectorAll('[data-amount]').forEach(item=>item.setAttribute('aria-checked','false'));button.setAttribute('aria-checked','true');amount=button.dataset.amount;box.querySelector('[data-big]').textContent=amount}));
const say=(box,text)=>{const line=box&&box.querySelector('[data-status]');if(line)line.textContent=text};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function send(path,options){
  if(demo){
    await sleep(500);
    if(path==='/v1/swarms')return{id:'demo',title:choice.title};
    return{};
  }
  const response=await fetch(path,options);const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.detail||'That did not go through.');error.status=response.status;throw error}
  return data;
}
function finish(){
  show('done');
  document.getElementById('done-title').textContent="Finish on the swarm's page"+(currentSwarm&&currentSwarm.title?': '+currentSwarm.title:'.');
  const origin=new URL(frame.url).origin,id=encodeURIComponent(currentSwarm.id),words=(note?'I put money behind "'+note+'" on ':'I funded ')+currentSwarm.title;
  const watch=document.getElementById('watch');
  if(tg){watch.removeAttribute('target');watch.textContent='Watch it';watch.href=frame.base+'/s/'+id;tg.HapticFeedback.notificationOccurred('success')}else watch.href=origin+'/s/'+id;
  document.getElementById('share').href=frame.bot?'https://t.me/share/url?url='+encodeURIComponent('https://t.me/'+frame.bot+'?startapp='+id)+'&text='+encodeURIComponent(words):'https://x.com/intent/post?text='+encodeURIComponent(words+' '+origin+'/x/s/'+id);
}
async function fund(box){
  const go=box&&box.querySelector('[data-go]');if(go)go.disabled=true;say(box,'');
  try{
    if(!currentSwarm){if(!choice)throw new Error('Pick an idea first.');currentSwarm=await send('/v1/swarms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:choice.title,goal:choice.goal,problem:choice.id})})}
    const search=new URLSearchParams({fund:'',amount,...(note?{note}:{})});
    const link=document.getElementById('approve');link.href=(tg?frame.base:new URL(frame.url).origin)+'/s/'+encodeURIComponent(currentSwarm.id)+'?'+search;
    document.getElementById('code').textContent='$'+amount;
    show('approve');
  }catch(error){say(box,error.message||'That did not go through.')}
  finally{if(go)go.disabled=frame.kind==='home'&&!choice}
}
document.getElementById('approve').addEventListener('click',()=>setTimeout(finish,300));
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>fund(button.closest('.pay'))));
if(frame.kind==='home'&&(demo||query.has('demo'))){
  const sample=[['running','Benchmark every open-weight coding model','9.04'],['running','Parse a terabyte of JSON in under a minute','4.20'],['paused','A field guide to DEX routing','2.75'],['funding','Speedrun nanoGPT on a T4','0.00']];
  const esc=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  document.querySelector('.door-join .door-peek').innerHTML=sample.map(([status,title,raised])=>'<span class="chip"><i class="dot" data-status="'+status+'"></i><b>'+esc(title)+'</b><em>$'+raised+'</em></span>').join('');
  document.querySelector('.door-join .door-kicker').innerHTML='<i class="live"></i>2 running';
  const join=document.querySelector('[data-view=join]');join.querySelector('.empty,.list')?.remove();
  join.insertAdjacentHTML('beforeend','<ol class="list scroll">'+sample.map(([status,title,raised])=>'<li><a class="row-item" href="#"><i class="dot" data-status="'+status+'"></i><span>'+esc(title)+'<small>'+(status==='running'?'Running':status==='paused'?'Resting':'Not started')+' · '+(3+title.length%7)+' backers</small></span><em>$'+raised+'</em></a></li>').join('')+'</ol>');
}
if(frame.kind==='home'){
  const custom=document.getElementById('custom'),ideas=[...document.querySelectorAll('[data-idea]')],go=document.querySelector('[data-view=start] [data-go]');
  const pick=index=>{choice=frame.ideas[index];ideas.forEach((item,at)=>item.setAttribute('aria-pressed',String(at===index)));custom.value='';go.disabled=false};
  ideas.forEach((button,index)=>button.addEventListener('click',()=>pick(index)));
  custom.addEventListener('input',()=>{const text=custom.value.trim();ideas.forEach(item=>item.setAttribute('aria-pressed','false'));choice=text.length>=10?{title:text.slice(0,80),goal:text+'\\n\\n'+frame.briefInstruction}:null;go.disabled=!choice});
  go.disabled=true;
  if(query.has('pick'))pick(Number(query.get('pick'))||0);
}
if(frame.kind==='swarm'){
  const panes={transcript:document.querySelector('[data-pane=transcript]'),chat:document.querySelector('[data-pane=chat]')};
  const tabs=[...document.querySelectorAll('[data-tab]')];
  const tab=name=>{tabs.forEach(item=>item.setAttribute('aria-selected',String(item.dataset.tab===name)));Object.entries(panes).forEach(([key,pane])=>pane.hidden=key!==name);panes[name].scrollTop=panes[name].scrollHeight};
  tabs.forEach(button=>button.addEventListener('click',()=>tab(button.dataset.tab)));
  const nowLine=document.getElementById('now'),nowWho=document.getElementById('now-who'),nowText=document.getElementById('now-text');
  const stick=pane=>{if(pane.scrollHeight-pane.scrollTop-pane.clientHeight<60)requestAnimationFrame(()=>pane.scrollTop=pane.scrollHeight)};
  const beat=(pane,kind,who,text,amount)=>{
    const item=document.createElement('li');item.className='beat '+kind;
    if(who){const name=document.createElement('span');name.className='who';name.textContent=who;if(amount){const chip=document.createElement('span');chip.className='amt';chip.textContent='$'+Number(amount).toFixed(2);name.append(chip)}item.append(name)}
    const body=document.createElement('span');body.className='say';body.textContent=text;item.append(body);
    const anchor=pane===panes.transcript?nowLine:null;stick(pane);pane.insertBefore(item,anchor);
  };
  const entry=item=>{
    if(item.kind==='funds'||item.kind==='status'||item.kind==='machine')return;
    const kind=item.kind==='message'?'':item.kind==='thinking'?'thinking':item.kind==='steer'?'quiet':'tool';
    beat(panes.transcript,kind,item.kind==='message'?(item.who||'Agent'):null,(item.kind==='tool'?'› ':'')+(item.text||''));
  };
  const chat=(message,names)=>{
    if(!message.author)return;
    const handle='@'+(names[message.author]||message.author.slice(2,8));
    if(message.steer)beat(panes.transcript,'said',handle,message.text,message.steer.amount);
    beat(panes.chat,message.steer?'said':'chat',handle,message.text,message.steer&&message.steer.amount);
  };
  const samples=()=>{
    document.getElementById('empty-feed').remove();document.getElementById('empty-chat').remove();
    [['message','Agent','SWE-bench Lite. Four subagents, each on its own machine, ran 75 tasks per model.'],['tool',null,'$ python -m swebench.harness.run_evaluation --run_id glm-5.3'],['thinking',null,'Cost per solved task carries the most weight among the notes.'],['message','swe-lite','GLM-5.3 resolved 31 of 75 tasks at 0.0020 MACH per resolved task.']].forEach(([kind,who,text])=>beat(panes.transcript,kind==='message'?'':kind,who,(kind==='tool'?'› ':'')+text));
    beat(panes.transcript,'said','@orbit-0a41','@swarm Report cost per solved task, not per token','1');
    [['@orbit-0a41','@swarm Report cost per solved task, not per token','1'],['@quark-1a2b','the GLM numbers look too good, can we rerun with cold caches?',null],['@kestrel-9c2e','+1, and publish the harness',null]].forEach(([who,text,amount])=>beat(panes.chat,amount?'said':'chat',who,text,amount));
    document.getElementById('watching').textContent='7';
    nowLine.hidden=false;nowWho.textContent='rust-subset';nowText.textContent='Kimi K2.7 passes 37 of 50 Rust tasks so far';
  };
  if(demo||query.has('demo')){samples();const goal=document.querySelector('[data-view=fund] .goal');if(goal&&!document.querySelector('[data-view=fund] .notes'))goal.insertAdjacentHTML('afterend','<ol class="list notes">'+[['Report cost per solved task, not per token','3.30'],['Include Qwen3-Coder even if slow','1.55'],['Publish the harness as a repo','0.90']].map(([text,amount])=>'<li class="row-item"><span>'+text+'</span><em>$'+amount+'</em></li>').join('')+'</ol>')}
  else{
    fetch('/v1/swarms/'+encodeURIComponent(frame.swarm.id)+'/feed?limit=40').then(response=>response.json()).then(page=>{const shown=(page.entries||[]).slice(-30);if(shown.length)document.getElementById('empty-feed').remove();shown.forEach(entry);panes.transcript.scrollTop=panes.transcript.scrollHeight}).catch(()=>{});
    fetch('/v1/swarms/'+encodeURIComponent(frame.swarm.id)+'/chat').then(response=>response.json()).then(room=>{const names=Object.fromEntries((room.members||[]).map(member=>[member.address,member.handle]));if((room.messages||[]).length)document.getElementById('empty-chat').remove();(room.messages||[]).slice(-40).forEach(message=>chat(message,names));if((room.members||[]).length)document.getElementById('watching').textContent=String(room.members.length)}).catch(()=>{});
  }
  if(frame.live&&!demo&&!query.has('demo')){
    let stream={item:'',text:'',who:null};
    const write=(who,delta,item,offset)=>{const base=stream.item===item&&stream.who===who?stream.text:'';stream={item,text:(offset===null||offset===undefined?base+delta:base.slice(0,offset)+delta),who};nowLine.hidden=false;nowWho.textContent=who||'Agent';nowText.textContent=stream.text;stick(panes.transcript)};
    const open=()=>{
      const source=new EventSource('/v1/swarms/'+encodeURIComponent(frame.swarm.id)+'/live');
      source.onmessage=message=>{const event=JSON.parse(message.data);
        if(event.type==='delta'&&event.channel==='text')write(event.who,event.delta,event.item,event.offset);
        else if(event.type==='entry'){if(event.entry.kind==='message'){nowLine.hidden=true;stream={item:'',text:'',who:null}}entry(event.entry)}
        else if(event.type==='end'||event.type==='idle'){source.close();setTimeout(open,event.type==='end'?1500:5000)}};
      source.onerror=()=>{source.close();setTimeout(open,4000)};
    };
    open();
  }
  const form=document.getElementById('steer');
  if(form){
    const input=document.getElementById('note'),stake=document.getElementById('stake'),sendButton=form.querySelector('.send');
    const update=()=>{const text=input.value.trim();stake.hidden=!text;sendButton.disabled=text.length<3};
    input.addEventListener('input',update);
    stake.querySelectorAll('[data-stake]').forEach(button=>button.addEventListener('click',()=>{stake.querySelectorAll('[data-stake]').forEach(item=>item.setAttribute('aria-checked','false'));button.setAttribute('aria-checked','true');amount=button.dataset.stake}));
    form.addEventListener('submit',event=>{event.preventDefault();note=input.value.trim();if(note.length<3)return;history.push('room');void fund(null)});
    if(query.get('note')){input.value=query.get('note');update()}
  }
  const behind=document.getElementById('behind');
  document.querySelector('[data-open=fund]')?.addEventListener('click',()=>{note='';behind.hidden=true});
  if(query.get('tab')==='chat')tab('chat');else tab('transcript');
}
const view=query.get('view')||{join:'join',start:'start'}[query.get('tgWebAppStartParam')];
if(view&&views.some(item=>item.dataset.view===view)){if(view!==current)history.push(current);show(view,false)}
if(demo&&query.has('go')){const box=document.querySelector('[data-view='+(view||current)+'] .pay');if(document.getElementById('note')&&document.getElementById('note').value&&!box){note=document.getElementById('note').value.trim();void fund(null)}else void fund(box)}
`
