/* Standalone layout study. All people, chat, sends and connection states are fixtures. */
const query = new URLSearchParams(location.search)
const title = 'The Woman at the Edge of the Frame'
const surface =
  "After my father died, I unscrewed a painted-over kitchen cupboard and found a hidden darkroom filled with two hundred numbered photographs of me, including ones taken years after my mother's ghost had 'gone on.'"
const root = document.getElementById('root')
const designs = {
  a: {
    name: '会话优先',
    pitch: '大家的话、正式提问和砚的回答，留在同一条时间线上。汤面随用随开。',
    benefit: '最像坐在一起聊天，手机上顺手。',
    tradeoff: '人多时讨论会穿插在正式问答之间。',
  },
  b: {
    name: '案卷翻页',
    pitch: '案卷、推理、讨论是三张完整的页面。眼前只处理一件事，切换保留位置。',
    benefit: '读长汤面、回看问答都清楚。',
    tradeoff: '看汤面和聊猜想，需要切换页面。',
  },
  c: {
    name: '围桌工作台',
    pitch: '电脑上把资料、推理、讨论左右排开；手机以推理为主，讨论从侧边拉出。',
    benefit: '多人一起推理时，正式问答最清晰。',
    tradeoff: '手机上讨论要多点一下，桌面优势更大。',
  },
}
const icons = {
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  book: '<path d="M5 4h14v17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 13h14M7 4v13"/>',
  chat: '<path d="M4 4h16v12H9l-5 4V4Zm4 5h8m-8 3h5"/>',
  ask: '<path d="M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6m0 4v.1"/><circle cx="12" cy="12" r="10"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-3-5"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M6 10H4v11h16V10h-2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M15 8V3H3v13h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  signal: '<path d="M3 17v-3m5 3v-6m5 6V8m5 9V4"/>',
  battery: '<rect x="2" y="6" width="17" height="12" rx="3"/><path d="M22 10v4M5 9h11v6H5Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
}
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.dots}</svg>`
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
  )
const button = (action, text, cls = 'text-button', label = '') =>
  `<button type="button" class="${cls}" data-action="${action}"${label ? ` aria-label="${label}"` : ''}>${text}</button>`
const avatar = (name, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${name}</span>`
const readChoice = () => {
  try {
    return localStorage.getItem('soup-layout-choice')
  } catch {
    return null
  }
}

let variant = query.get('variant') in designs ? query.get('variant') : 'a'
let platform = query.get('platform') || 'app'
let phase = query.get('state') || 'playing'
let theme = query.get('theme') || 'dark'
let folioPage = phase === 'waiting' ? 'lobby' : 'ask'
let composerMode = phase === 'waiting' ? 'talk' : 'ask'
let joined = phase === 'playing'
let toastTimer
let askCount = 2
const added = []
const drafts = { ask: '', talk: '' }
const scrolls = {}

function roomURL(v, p = platform, s = phase, embedded = true) {
  return `./index.html?${new URLSearchParams({ view: 'room', variant: v, platform: p, state: s, theme, ...(embedded ? { embed: '1' } : {}) })}`
}
function applyTheme() {
  document.documentElement.dataset.theme = theme
}

function gallery() {
  applyTheme()
  document.body.className = ''
  const chosen = readChoice()
  root.innerHTML = `<main class="gallery" data-device="${platform}">
    <header class="gallery-head"><div><span class="gallery-logo">海龟汤调查局 / 布局研究</span><h1>同桌，三个方向。</h1><p>汤面按需查看，推理占主屏。点开、切换、试着发一句，再挑你用着顺手的。</p></div><span class="prototype-stamp">可交互原型 · 演示数据</span></header>
    <div class="review-controls" aria-label="原型预览设置">
      <div class="control-group"><span class="control-label">设备</span>${[
        ['app', '原生 App'],
        ['web', '手机网页'],
        ['desktop', '电脑网页'],
      ]
        .map(
          ([v, t]) =>
            `<button data-device="${v}" class="${v === platform ? 'active' : ''}" aria-pressed="${v === platform}">${t}</button>`,
        )
        .join('')}</div>
      <div class="control-group"><span class="control-label">状态</span>${[
        ['playing', '已经开汤'],
        ['waiting', '等待入座'],
      ]
        .map(
          ([v, t]) =>
            `<button data-state="${v}" class="${v === phase ? 'active' : ''}" aria-pressed="${v === phase}">${t}</button>`,
        )
        .join('')}</div>
      <div class="control-group"><span class="control-label">外观</span>${[
        ['dark', '墨色'],
        ['light', '纸色'],
      ]
        .map(
          ([v, t]) =>
            `<button data-theme="${v}" class="${v === theme ? 'active' : ''}" aria-pressed="${v === theme}">${t}</button>`,
        )
        .join('')}</div>
    </div>
    <nav class="mobile-choice" aria-label="选择布局">${Object.entries(designs)
      .map(
        ([v, d]) =>
          `<button data-select="${v}" class="${v === variant ? 'active' : ''}">${v.toUpperCase()} ${d.name}</button>`,
      )
      .join('')}</nav>
    <div class="design-grid">${Object.entries(designs)
      .map(
        ([v, d]) => `<article class="design-card ${v === variant ? 'is-active' : ''}">
      <div class="design-intro"><h2><span class="letter">${v.toUpperCase()}</span>${d.name}</h2><p>${d.pitch}</p></div>
      <div class="prototype-frame"><iframe title="${v.toUpperCase()} ${d.name}交互原型" src="${roomURL(v)}"></iframe></div>
      <p class="design-fit"><strong>${d.benefit}</strong><br>${d.tradeoff}</p>
      <div class="design-footer"><a href="${roomURL(v, platform, phase, false)}" target="_blank" rel="noopener">单独体验 ${v.toUpperCase()} ${icon('next')}</a><button class="choose ${chosen === v ? 'selected' : ''}" data-choose="${v}">${chosen === v ? '已选这一版' : '偏向这一版'}</button></div>
    </article>`,
      )
      .join('')}</div>
    <footer class="gallery-foot"><p>可试：展开汤面、切换讨论、发送演示消息、邀请朋友入座。<br>App 视图为布局模拟，所有内容均为演示，不连接真实房间。</p><p class="selection-note" aria-live="polite">${chosen ? `你偏向 ${chosen.toUpperCase()} · ${designs[chosen]?.name}。选择只保存在这台设备，回聊天告诉我即可。` : '也可以混搭，例如 A 的手机布局 + C 的电脑布局。'}</p></footer>
  </main>`
}
function chrome() {
  const review = query.get('embed')
    ? ''
    : `<div class="review-back"><a href="./index.html">${icon('back')} 返回对比</a><span>${variant.toUpperCase()} · ${designs[variant].name}</span>${button('toggle-state', phase === 'waiting' ? '试试开汤' : '试试等人')}</div>`
  if (platform === 'desktop')
    return (
      review +
      `<div class="web-brand"><span>海龟汤调查局</span><nav><span>同桌</span><span>题库</span><span>简律纯</span></nav></div>`
    )
  return (
    review +
    `<div class="statusbar"><span>08:10</span><span class="status-right">${icon('signal')}${icon('battery')}</span></div>${platform === 'web' ? `<div class="addressbar">${icon('lock')} hgt.mmstudio.games</div>` : ''}`
  )
}
function header() {
  const subtitle = phase === 'waiting' ? '等待入座' : `${askCount} 轮提问 · 砚主持`
  return `<header class="room-header">${button('back', icon('back'), 'icon-button back', '返回布局对比')}<div class="room-heading"><h1>${variant === 'b' ? '同桌 / 共同案卷' : title}</h1><p><span class="dot"></span>${subtitle}</p></div>${button('members', `<span class="avatar-stack">${avatar('简', 'me')}${joined ? avatar('晚') + avatar('岛') : ''}</span><span>${joined ? 3 : 1}/6</span>`, 'member-link', '查看同桌成员')}</header>`
}
function caseLink() {
  return button(
    'surface',
    `<span>汤面</span><span class="snippet">${surface}</span>${icon('next')}`,
    'case-link',
    '查看完整汤面',
  )
}
function chat(name, mark, text, extra = '') {
  return `<article class="chat">${avatar(mark, name === '你' ? 'me' : '')}<div class="chat-content"><div class="chat-meta"><b>${name}</b><span>${extra || '08:09'}</span></div><p class="chat-text">${esc(text)}</p></div></article>`
}
function question(name, mark, text, number, response = true) {
  return `<article class="chat">${avatar(mark, name === '你' ? 'me' : '')}<div class="chat-content"><div class="chat-meta"><b>${name}</b><span>问砚 · 第 ${number} 轮</span></div><div class="question-slip"><p class="chat-text">${esc(text)}</p>${response ? `<div class="host-reply"><span class="host-signature">砚</span><span class="verdict">是</span><span class="answer-caption">照片里的人都是你。</span></div>` : `<div class="host-reply"><span class="host-signature">砚</span><span class="answer-caption">正在听这个问题…</span></div>`}</div></div></article>`
}
function discussion() {
  return `<div class="system-note">只和同桌聊 · 不计提问轮数</div>${chat('晚风', '晚', '我觉得可以先从照片的时间线入手。')}${chat('小岛', '岛', '对，先确认照片编号和拍摄时间是不是一回事。')}${chat('你', '简', '我来问照片，大家再看看暗房有没有线索。')}${added
    .filter((x) => x.mode === 'talk')
    .map((x) => chat('你', '简', x.text, '刚刚'))
    .join('')}<div class="typing">晚风正在想下一条线索…</div>`
}
function askTranscript(unified = false) {
  if (unified)
    return `<div class="system-note">三个人，围同一碗汤。 / 08:08</div>${chat('晚风', '晚', '这碗汤有意思，先从照片问起吧。')}${question('你', '简', '照片里的人都是「我」吗？', 1)}${chat('小岛', '岛', '那我们把编号和时间分开想，别混在一起。')}${question('晚风', '晚', '编号与拍摄顺序有关吗？', 2, false)}${added.map((x) => (x.mode === 'ask' ? question('你', '简', x.text, x.number, false) : chat('你', '简', x.text, '刚刚'))).join('')}`
  if (variant === 'c')
    return `<div class="transcript-title"><h2>一起往下问</h2><span>${askCount} 轮</span></div><article class="case-turn"><div class="turn-label"><span class="turn-index">01 / 已回答</span><span>简律纯提问</span></div><h3>照片里的人都是「我」吗？</h3><div class="answer-line"><span class="host-signature">砚</span><span class="verdict">是</span><span class="answer-caption">照片里的人都是你。</span></div></article><article class="case-turn"><div class="turn-label"><span class="turn-index">02 / 等待回答</span><span>晚风提问</span></div><h3>编号与拍摄顺序有关吗？</h3><div class="answer-line"><span class="host-signature">砚</span><span class="answer-caption">正在听这个问题…</span></div></article>${added
      .filter((x) => x.mode === 'ask')
      .map((x) => question('你', '简', x.text, x.number, false))
      .join('')}`
  return `<div class="transcript-title"><h2>推理记录</h2><span>${askCount} 轮</span></div>${question('你', '简', '照片里的人都是「我」吗？', 1)}${question('晚风', '晚', '编号与拍摄顺序有关吗？', 2, false)}${added
    .filter((x) => x.mode === 'ask')
    .map((x) => question('你', '简', x.text, x.number, false))
    .join('')}<p class="inline-note">接下来，我们该问哪一条线索？</p>`
}
function composer(mode = 'ask', mix = false, drawer = false) {
  return `<form class="composer" data-mode="${mode}" ${drawer ? 'data-drawer="true"' : ''}><div class="composer-inner">
    ${mix ? `<div class="compose-modes"><div class="switch">${phase === 'playing' ? button('mode-ask', '问砚', mode === 'ask' ? 'active' : '') : ''}${button('mode-talk', '和大家聊', mode === 'talk' ? 'active' : '')}</div><span class="compose-mode-note">${mode === 'ask' ? '提问会交给砚回答' : '讨论不计轮数'}</span></div>` : variant === 'c' && !drawer ? `<div class="room-toolbar-footer"><span>${mode === 'ask' ? '下一轮 · 问砚' : '等待朋友入座'}</span>${button('discussion', `${icon('chat')}桌边讨论 <span class="unread">2</span>`, 'text-button discussion-toggle')}</div>` : ''}
    <div class="input-row"><textarea rows="1" aria-label="${mode === 'ask' ? '向砚提问' : '给同桌发消息'}" placeholder="${mode === 'ask' ? '把问题交给砚…' : '和同桌说说你的想法…'}" maxlength="600">${esc(drafts[mode])}</textarea><button class="send-button" type="submit" aria-label="${mode === 'ask' ? '发送问题' : '发送讨论'}">${icon('arrow')}</button></div>
    ${!mix ? `<div class="compose-helper"><span>${mode === 'ask' ? '正式提问，按顺序回答' : '只发给同桌，不计轮数'}</span>${mode === 'ask' ? button('vote', '一起揭晓？') : ''}</div>` : ''}
  </div></form>`
}
function seats(round = false) {
  const people = ['简', ...(joined ? ['晚', '岛'] : [])]
  const names = ['你 · 房主', ...(joined ? ['晚风', '小岛'] : [])]
  const elements = Array.from(
    { length: 6 },
    (_, i) =>
      `<div class="${round ? 'table-seat' : 'seat'} ${i >= people.length ? 'empty' : ''}">${avatar(people[i] || '+', i === 0 ? 'me' : '')}<span class="seat-name">${names[i] || '空位'}</span></div>`,
  ).join('')
  return round
    ? `<div class="round-table"><div class="table-center"><strong>同桌</strong><span>${joined ? '朋友到齐，可以开汤' : '留几个位置给朋友'}</span></div>${elements}</div>`
    : `<div class="seat-list">${elements}</div>`
}
function waiting() {
  return `<div class="waiting"><div class="eyebrow">${joined ? '朋友入座了' : '这桌已经为你留好'}</div><h2>${variant === 'c' ? '坐下来，一起想。' : variant === 'b' ? '人到了，再一起开汤。' : '先把朋友叫过来。'}</h2><p class="intro">${joined ? '晚风和小岛已经入座。你是房主，准备好就开始。' : '至少两人在线就能开始。等朋友的时候，也可以先看看汤面、聊聊猜想。'}</p>${seats(variant === 'c')}
    <div class="seat-actions">${button('invite', `${icon('share')}邀请朋友`, 'outline')}<button type="button" class="primary" data-action="start" ${joined ? '' : 'disabled'}>开始同桌 ${icon('next')}</button></div>
    ${!joined ? '<p class="waiting-footnote">还差一位朋友，开始按钮就会亮起。</p>' : ''}
    <div class="invite-strip"><span>本桌邀请码 · 演示</span><span class="mono">DEMO 8262</span></div>
    ${variant === 'a' ? `<div class="lobby-conversation">${chat('你', '简', '我先坐下啦，等你们来。', '刚刚')}</div>` : ''}</div>`
}
function storyDocument(action = true) {
  return `<article class="story-document"><div class="document-number"><span>本桌案卷 / 汤面</span><span>英文 · 中等</span></div><div class="document-rule"></div><h2>${title}</h2><p class="surface">${surface}</p><div class="doc-meta"><span>2—6 人同桌</span><span>由砚主持</span></div>${action ? `<div class="doc-action">${button(variant === 'b' ? 'page-ask' : 'close', phase === 'waiting' ? '回到同桌' : '回到推理', 'primary')}</div>` : ''}</article>`
}
function folioNavigation() {
  return `<nav class="folio-navigation" aria-label="同桌页面">${[
    ['story', 'book', '案卷'],
    ['ask', 'ask', phase === 'waiting' ? '同桌' : '推理'],
    ['talk', 'chat', '讨论'],
  ]
    .map(([id, ic, label]) =>
      button(
        `page-${id}`,
        `${icon(ic)}<span>${label}${id === 'talk' ? ' · 2' : ''}</span>`,
        folioPage === id || (folioPage === 'lobby' && id === 'ask') ? 'active' : '',
      ),
    )
    .join('')}</nav>`
}
function rail() {
  return `<aside class="work-rail"><span class="eyebrow">本桌案卷</span><h2>${title}</h2><p class="rail-story">After my father died, I unscrewed a painted-over kitchen cupboard…</p>${button('surface', '展开完整汤面 ↗', 'link-button')}<div class="rail-members"><span class="eyebrow">桌边 · ${joined ? 3 : 1}/6</span><div class="rail-member">${avatar('简', 'me')}<span>简律纯 · 你</span><span class="dot"></span></div>${joined ? `<div class="rail-member">${avatar('晚')}<span>晚风</span><span class="dot"></span></div><div class="rail-member">${avatar('岛')}<span>小岛</span><span class="dot"></span></div>` : ''}${button('invite', `${icon('share')}邀请朋友`, 'link-button')}</div></aside>`
}
function saveScrolls() {
  document.querySelectorAll('[data-scroll]').forEach((el) => {
    scrolls[el.dataset.scroll] = el.scrollTop
  })
}
function room() {
  applyTheme()
  document.body.className = 'room-body'
  document.body.dataset.platform = platform
  let contents = ''
  if (variant === 'a')
    contents = `${header()}${caseLink()}<div class="room-main"><div class="scroll-pane" data-scroll="a-${phase}">${phase === 'waiting' ? waiting() : `<div class="conversation">${askTranscript(true)}</div>`}</div></div>${composer(phase === 'waiting' ? 'talk' : composerMode, true)}`
  if (variant === 'b') {
    const page =
      folioPage === 'story'
        ? `<div class="scroll-pane" data-scroll="b-story">${storyDocument()}</div>`
        : folioPage === 'talk'
          ? `<div class="scroll-pane" data-scroll="b-talk"><div class="conversation"><div class="transcript-title"><h2>桌边的猜想</h2><span>3 人在线</span></div>${discussion()}</div></div>${composer('talk')}`
          : phase === 'waiting'
            ? `<div class="scroll-pane" data-scroll="b-lobby">${waiting()}</div>`
            : `<div class="scroll-pane" data-scroll="b-ask"><div class="conversation">${askTranscript()}</div></div>${composer('ask')}`
    contents = `${header()}<div class="folio"><div class="folio-page">${page}</div></div>${folioNavigation()}`
  }
  if (variant === 'c')
    contents = `${header()}<div class="workbench">${rail()}<section class="work-center"><div class="work-toolbar">${button('surface', `${icon('book')}汤面`)}<span>${joined ? '简律纯、晚风、小岛在线' : '只有你在桌边'}</span>${button('members', icon('people'), 'text-button', '查看成员')}</div><div class="scroll-pane" data-scroll="c-${phase}">${phase === 'waiting' ? waiting() : `<div class="conversation">${askTranscript()}</div>`}</div>${phase === 'playing' ? composer('ask') : `<div class="composer"><div class="composer-inner">${button('discussion', `${icon('chat')}等人时，和同桌聊两句`, 'outline discussion-toggle')}</div></div>`}</section><aside class="work-talk"><h2 class="discussion-heading">桌边讨论 <span class="muted">/ 不计轮数</span></h2><div class="scroll-pane" data-scroll="c-talk"><div class="conversation">${phase === 'waiting' && !joined ? chat('你', '简', '我先坐下啦，等你们来。', '刚刚') : discussion()}</div></div>${composer('talk', false, true)}</aside></div>`
  root.innerHTML = `<div class="room-root">${chrome()}<main class="room variant-${variant}">${contents}<div class="prototype-announcement" aria-live="polite"></div></main>${platform === 'app' ? '<div class="home-indicator"></div>' : ''}</div>`
  document.querySelectorAll('[data-scroll]').forEach((el) => {
    el.scrollTop = scrolls[el.dataset.scroll] || 0
  })
  fitViewport()
}
function fitViewport() {
  if (query.get('view') === 'room')
    document.documentElement.style.setProperty(
      '--viewport',
      `${window.visualViewport?.height || innerHeight}px`,
    )
}
function toast(text) {
  clearTimeout(toastTimer)
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.querySelector('.room').append(el)
  toastTimer = setTimeout(() => el.remove(), 2600)
}
let lastFocus
function closeOverlay() {
  document.querySelector('.overlay')?.remove()
  document.querySelectorAll('.room > [inert]').forEach((el) => (el.inert = false))
  lastFocus?.focus({ preventScroll: true })
}
function overlay(type) {
  closeOverlay()
  lastFocus = document.activeElement
  const body =
    type === 'surface'
      ? storyDocument()
      : type === 'discussion'
        ? `<div class="scroll-pane" data-scroll="drawer-talk"><div class="conversation">${discussion()}</div></div>${composer('talk', false, true)}`
        : type === 'members'
          ? `<div class="waiting"><span class="eyebrow">${joined ? 3 : 1} / 6 人在桌边</span>${seats()}${button('invite', `${icon('share')}邀请朋友`, 'primary')}</div>`
          : `<div class="share-body"><h2 class="serif">给朋友留了位置。</h2><p>把邀请发给朋友，登录后就能来到你这桌。</p><div class="share-code">DEMO 8262</div>${button('copy', `${icon('copy')}复制邀请`, 'primary')}${phase === 'waiting' && !joined ? button('join-demo', '模拟朋友入座', 'outline') : ''}<small class="muted">交互演示，不会创建或加入真实房间。</small></div>`
  const heading = {
    surface: '汤面',
    discussion: '桌边讨论 · 3 人',
    members: '这一桌的人',
    invite: '邀请朋友',
  }[type]
  const wrap = document.createElement('div')
  wrap.className = `overlay ${type === 'discussion' ? 'drawer' : 'surface-overlay'}`
  wrap.innerHTML = `<section class="overlay-panel" role="dialog" aria-modal="true" aria-label="${heading}"><div class="overlay-header"><span>${heading}</span>${button('close', icon('close'), 'icon-button', '关闭')}</div>${type === 'surface' ? `<div class="scroll-pane">${body}</div>` : body}</section>`
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeOverlay()
  })
  document.querySelectorAll('.room > *').forEach((el) => (el.inert = true))
  document.querySelector('.room').append(wrap)
  wrap.querySelector('[data-action=close]').focus({ preventScroll: true })
}
function handleAction(action) {
  if (['surface', 'discussion', 'members', 'invite'].includes(action)) return overlay(action)
  if (action === 'close') return closeOverlay()
  if (action === 'copy') {
    const value = '海龟汤同桌布局原型 · 演示邀请码 DEMO 8262（非真实邀请）'
    if (navigator.clipboard?.writeText)
      navigator.clipboard
        .writeText(value)
        .then(() => toast('演示邀请已复制'))
        .catch(() => toast('演示邀请码：DEMO 8262'))
    else toast('演示邀请码：DEMO 8262')
    return
  }
  if (action === 'vote') return toast('演示：已发起揭晓投票，需要全体同意。')
  if (action === 'back') {
    if (query.get('embed')) return toast('当前是独立布局原型。可用上方控件切换方案。')
    location.href = './index.html'
    return
  }
  saveScrolls()
  if (action === 'join-demo') {
    joined = true
    room()
    toast('晚风和小岛入座了，现在可以开始。')
    return
  }
  if (action === 'start') {
    if (!joined) return
    phase = 'playing'
    folioPage = 'ask'
    composerMode = 'ask'
    room()
    return
  }
  if (action === 'toggle-state') {
    phase = phase === 'waiting' ? 'playing' : 'waiting'
    joined = phase === 'playing'
    folioPage = phase === 'waiting' ? 'lobby' : 'ask'
    composerMode = phase === 'waiting' ? 'talk' : 'ask'
    room()
    return
  }
  if (action.startsWith('mode-')) {
    composerMode = action.slice(5)
    room()
    return
  }
  if (action.startsWith('page-')) {
    folioPage = action.slice(5)
    room()
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]')
  if (b && !b.disabled) return handleAction(b.dataset.action)
  const control = e.target.closest(
    'button[data-device],button[data-state],button[data-theme],button[data-select],button[data-choose]',
  )
  if (!control) return
  if (control.dataset.device) platform = control.dataset.device
  if (control.dataset.state) phase = control.dataset.state
  if (control.dataset.theme) theme = control.dataset.theme
  if (control.dataset.select) variant = control.dataset.select
  if (control.dataset.choose) {
    try {
      localStorage.setItem('soup-layout-choice', control.dataset.choose)
    } catch {}
    variant = control.dataset.choose
  }
  gallery()
})
document.addEventListener('input', (e) => {
  if (!e.target.matches('textarea')) return
  const form = e.target.closest('form')
  drafts[form.dataset.mode] = e.target.value
  e.target.style.height = '30px'
  e.target.style.height = Math.min(90, e.target.scrollHeight) + 'px'
})
document.addEventListener('submit', (e) => {
  if (!e.target.matches('.composer')) return
  e.preventDefault()
  const mode = e.target.dataset.mode
  const text = e.target.querySelector('textarea').value.trim()
  if (!text) return
  if (mode === 'ask' && phase !== 'playing') return toast('等朋友入座、开汤后再提问。')
  added.push({ mode, text, number: mode === 'ask' ? ++askCount : null })
  drafts[mode] = ''
  const drawer = !!e.target.closest('.overlay')
  saveScrolls()
  room()
  if (drawer) overlay('discussion')
  const container = drawer
    ? document.querySelector('.overlay .scroll-pane')
    : variant === 'c' && mode === 'talk'
      ? document.querySelector('.work-talk .scroll-pane')
      : document.querySelector(
          '.room-main .scroll-pane,.folio .scroll-pane,.work-center .scroll-pane',
        )
  if (container) container.scrollTop = container.scrollHeight
  toast(mode === 'ask' ? '演示问题已加入记录。砚的回答在正式版中生成。' : '已发给同桌 · 原型演示')
})
document.addEventListener('keydown', (e) => {
  const dialog = document.querySelector('.overlay')
  if (e.key === 'Escape' && dialog) {
    closeOverlay()
    return
  }
  if (e.key === 'Tab' && dialog) {
    const items = [...dialog.querySelectorAll('button:not(:disabled),textarea,a')]
    const first = items[0],
      last = items.at(-1)
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.matches('textarea'))
    e.target.closest('form').requestSubmit()
})
window.visualViewport?.addEventListener('resize', fitViewport)
window.addEventListener('resize', fitViewport)
if (query.get('view') === 'room') room()
else gallery()
