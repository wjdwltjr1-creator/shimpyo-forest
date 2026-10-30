// 쉼표숲 서버: 정적 파일 + 실시간(웹소켓) 방·채팅·접속자 수.
// 개인정보는 받지도 저장하지도 않는다(IP·기록 저장 없음, 대화는 메모리에 최근 것만).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { clean } = require('./filter');
const { ITEMS } = require('./items');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_CLIENTS = 800;
const MAX_PER_ROOM = 60;

const ROOMS = {
  lake: '달빛 호숫가',
  fire: '모닥불 언덕',
  attic: '빗소리 다락방'
};

const ADJ = ['졸린', '느긋한', '포근한', '말랑한', '조용한', '따뜻한', '나른한', '살랑이는', '꾸벅꾸벅', '반짝이는', '동글동글', '보송한'];
const NOUN = ['다람쥐', '고슴도치', '부엉이', '두더지', '수달', '아기곰', '토끼', '너구리', '오리', '거북이', '고양이', '청설모'];
const COLORS = ['#f6c6a8', '#f7d794', '#c7e9b0', '#b5d8f2', '#d9c2f0', '#f5b8c8', '#fbe3b0', '#c2ece4'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (url.pathname === '/api/count') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(counts()));
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (file === '/items.js') file = path.join(__dirname, 'items.js');
  else {
    try { file = path.join(PUBLIC, decodeURIComponent(file)); } catch { file = ''; }
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.endsWith('.html') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 });
const rooms = Object.fromEntries(Object.keys(ROOMS).map((k) => [k, { users: new Map(), chat: [], wishes: [] }]));
let nextId = 1;

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function counts() {
  const r = {};
  let total = 0;
  for (const k of Object.keys(rooms)) { r[k] = rooms[k].users.size; total += r[k]; }
  return { total, rooms: r };
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const u of rooms[room].users.values()) if (u.ws !== except && u.ws.readyState === 1) u.ws.send(data);
}
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(data);
}
let countTimer = null;
function countChanged() {
  if (countTimer) return;
  countTimer = setTimeout(() => { countTimer = null; broadcastAll({ t: 'count', ...counts() }); }, 300);
}
function publicUser(u) { return { id: u.id, name: u.name, color: u.color, seat: u.seat, outfit: u.outfit }; }
function freeSeat(room) {
  const used = new Set([...rooms[room].users.values()].map((u) => u.seat));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}
// 아직 결제가 없으므로 기본템(가격 0)만 입을 수 있다. 결제를 붙이면 여기서 구매 기록을 확인한다.
function validOutfit(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const slot of ['head', 'body', 'feet']) {
    const item = ITEMS.find((i) => i.id === o[slot] && i.slot === slot);
    if (item && item.price === 0) out[slot] = item.id;
  }
  return out;
}
function allow(u, key, ms) {
  const now = Date.now();
  if (now - (u.last[key] || 0) < ms) return false;
  u.last[key] = now;
  return true;
}
function leaveRoom(u) {
  if (!u.room) return;
  const r = rooms[u.room];
  r.users.delete(u.id);
  broadcast(u.room, { t: 'leave', id: u.id });
  u.room = null;
  countChanged();
}
function joinRoom(u, room) {
  if (!ROOMS[room]) room = 'lake';
  if (rooms[room].users.size >= MAX_PER_ROOM) {
    const alt = Object.keys(rooms).find((k) => rooms[k].users.size < MAX_PER_ROOM);
    if (!alt) return send(u.ws, { t: 'notice', text: '숲이 가득 찼어요. 잠시 뒤에 다시 와 주세요.' });
    if (alt !== room) send(u.ws, { t: 'notice', text: `${ROOMS[room]}이 가득 차서 ${ROOMS[alt]}로 안내했어요.` });
    room = alt;
  }
  leaveRoom(u);
  u.room = room;
  u.seat = freeSeat(room);
  const r = rooms[room];
  r.users.set(u.id, u);
  const now = Date.now();
  r.wishes = r.wishes.filter((w) => now - w.at < 10 * 60 * 1000);
  send(u.ws, {
    t: 'room', room, roomName: ROOMS[room], me: publicUser(u),
    users: [...r.users.values()].map(publicUser), chat: r.chat, wishes: r.wishes, ...counts()
  });
  broadcast(room, { t: 'join', user: publicUser(u) }, u.ws);
  countChanged();
}

// 신고: 서로 다른 사람에게 3번(방 인원이 적으면 2번) 신고되면 10분 동안 말하기 멈춤
const reports = new Map(); // targetId -> Set(reporterId)
function handleReport(u, targetId) {
  const r = rooms[u.room];
  const target = r && r.users.get(targetId);
  if (!target || target.id === u.id) return;
  if (!reports.has(target.id)) reports.set(target.id, new Set());
  const set = reports.get(target.id);
  set.add(u.id);
  send(u.ws, { t: 'notice', text: '신고했어요. 이 분의 말은 이제 내 화면에서 안 보여요.' });
  const need = r.users.size <= 4 ? 2 : 3;
  if (set.size >= need && !(target.mutedUntil > Date.now())) {
    target.mutedUntil = Date.now() + 10 * 60 * 1000;
    reports.delete(target.id);
    send(target.ws, { t: 'notice', text: '여러 분이 불편하다고 알려 와서 10분 동안 말하기가 멈춰요.' });
    broadcast(u.room, { t: 'notice', text: `${target.name}님의 말하기가 잠시 멈췄어요.` });
  }
}

wss.on('connection', (ws) => {
  if (wss.clients.size > MAX_CLIENTS) {
    send(ws, { t: 'notice', text: '지금 숲이 붐벼요. 잠시 뒤에 다시 와 주세요.' });
    return ws.close();
  }
  const u = {
    id: nextId++, ws, room: null, seat: 0, last: {}, mutedUntil: 0, msgs: [],
    name: `${pick(ADJ)} ${pick(NOUN)}`, color: pick(COLORS), outfit: { body: 'robe', feet: 'shoes' }
  };
  ws.on('message', (raw) => {
    // 초당 메시지 폭주 방지
    const now = Date.now();
    u.msgs = u.msgs.filter((t) => now - t < 5000);
    u.msgs.push(now);
    if (u.msgs.length > 30) return ws.close();
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'hello') {
      if (typeof m.name === 'string') {
        const n = clean(m.name, 12).text;
        if (n.length >= 1 && !n.includes('○') && !n.includes('(가림)')) u.name = n;
      }
      if (typeof m.color === 'string' && COLORS.includes(m.color)) u.color = m.color;
      if (m.outfit) u.outfit = validOutfit(m.outfit);
      return joinRoom(u, m.room);
    }
    if (!u.room) return;
    const room = u.room;
    switch (m.t) {
      case 'room':
        if (ROOMS[m.room] && m.room !== room && allow(u, 'room', 1500)) joinRoom(u, m.room);
        break;
      case 'chat': {
        if (u.mutedUntil > now) return send(ws, { t: 'notice', text: '지금은 말하기가 잠시 멈춰 있어요.' });
        if (!allow(u, 'chat', 1200)) return send(ws, { t: 'notice', text: '조금 천천히 말해 주세요.' });
        const { text } = clean(m.text, 120);
        if (!text) return;
        const msg = { id: `${u.id}-${now}`, from: u.id, name: u.name, color: u.color, text, at: now };
        const r = rooms[room];
        r.chat.push(msg);
        if (r.chat.length > 40) r.chat.shift();
        broadcast(room, { t: 'chat', msg });
        break;
      }
      case 'act':
        if (['breathe', 'breatheEnd', 'chime', 'nod'].includes(m.a) && allow(u, 'act' + m.a, m.a === 'chime' ? 3000 : 800))
          broadcast(room, { t: 'act', id: u.id, a: m.a });
        break;
      case 'wish': {
        if (u.mutedUntil > now) return send(ws, { t: 'notice', text: '지금은 소원 띄우기가 잠시 멈춰 있어요.' });
        if (!allow(u, 'wish', 20000)) return send(ws, { t: 'notice', text: '소원은 20초에 하나씩 띄울 수 있어요.' });
        const { text } = clean(m.text, 40);
        if (!text) return;
        const wish = { id: `${u.id}-${now}`, from: u.id, text, at: now, x: Math.random() };
        const r = rooms[room];
        r.wishes.push(wish);
        if (r.wishes.length > 12) r.wishes.shift();
        broadcast(room, { t: 'wish', wish });
        break;
      }
      case 'outfit':
        if (allow(u, 'outfit', 500)) {
          u.outfit = validOutfit(m.outfit);
          broadcast(room, { t: 'update', user: publicUser(u) });
        }
        break;
      case 'name': {
        if (!allow(u, 'name', 3000)) return;
        const n = clean(m.name, 12).text;
        if (!n || n.includes('○') || n.includes('(가림)')) return send(ws, { t: 'notice', text: '그 이름은 쓸 수 없어요.' });
        u.name = n;
        broadcast(room, { t: 'update', user: publicUser(u) });
        break;
      }
      case 'report':
        if (allow(u, 'report', 2000)) handleReport(u, Number(m.id));
        break;
    }
  });
  ws.on('close', () => { leaveRoom(u); reports.delete(u.id); });
  ws.on('error', () => {});
});

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._dead) { ws.terminate(); continue; }
    ws._dead = true;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => { ws.on('pong', () => { ws._dead = false; }); });

server.listen(PORT, () => console.log(`쉼표숲 열림: http://localhost:${PORT}`));
