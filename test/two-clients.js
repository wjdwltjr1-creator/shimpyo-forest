// 두 사람이 동시에 들어와 접속자 수·채팅·거르기·신고가 되는지 확인한다.
// 사용법: node test/two-clients.js [주소]  (기본 http://localhost:3000)
const WebSocket = require('ws');
const base = process.argv[2] || 'http://localhost:3000';
const wsUrl = base.replace(/^http/, 'ws');

function client(name) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const wait = (test, ms = 8000) => new Promise((resolve, reject) => {
    const hit = inbox.find(test);
    if (hit) return resolve(hit);
    const w = { test, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error(`${name}: 기다리던 메시지가 안 옴`)), ms);
  });
  const opened = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return { ws, wait, opened, send: (m) => ws.send(JSON.stringify(m)), inbox };
}

(async () => {
  const ok = (msg) => console.log('✅ ' + msg);
  const a = client('A'), b = client('B');
  await Promise.all([a.opened, b.opened]);
  a.send({ t: 'hello', room: 'lake', name: '시험A' });
  const ra = await a.wait((m) => m.t === 'room');
  b.send({ t: 'hello', room: 'lake', name: '시험B' });
  const rb = await b.wait((m) => m.t === 'room');
  ok(`둘 다 입장 (A=${ra.me.name}, B=${rb.me.name}, 기본 옷=${JSON.stringify(rb.me.outfit)})`);
  if (rb.users.length < 2) throw new Error('B 화면에 사람이 2명 미만');
  await a.wait((m) => m.t === 'join' && m.user.id === rb.me.id);
  ok('A 화면에 B가 들어옴');
  const c = await a.wait((m) => m.t === 'count' && m.rooms.lake >= 2);
  ok(`접속자 수 ${c.total}명 (호숫가 ${c.rooms.lake}명)`);

  a.send({ t: 'chat', text: '안녕하세요 쉬다 가요' });
  await b.wait((m) => m.t === 'chat' && m.msg.text === '안녕하세요 쉬다 가요');
  ok('A가 쓴 말이 B에게 도착');

  await new Promise((r) => setTimeout(r, 1300));
  a.send({ t: 'chat', text: '시 발 010-1234-5678 연락주세요' });
  const f = await b.wait((m) => m.t === 'chat' && m.msg.text.includes('연락주세요'));
  if (/시|010/.test(f.msg.text.replace('연락주세요', ''))) throw new Error('거르기 실패: ' + f.msg.text);
  ok(`욕설·전화번호 가림: "${f.msg.text}"`);

  b.send({ t: 'outfit', outfit: { head: 'beanie', body: 'robe' } });
  const up = await a.wait((m) => m.t === 'update' && m.user.id === rb.me.id);
  if (up.user.outfit.head) throw new Error('결제 안 한 털모자가 입혀짐');
  ok('결제 전 털모자는 못 입음(기본템만)');

  b.send({ t: 'act', a: 'chime' });
  await a.wait((m) => m.t === 'act' && m.a === 'chime');
  ok('풍경 울리기 전달');

  b.send({ t: 'wish', text: '푹 자기' });
  await a.wait((m) => m.t === 'wish' && m.wish.text === '푹 자기');
  ok('소원 등불 전달');

  b.send({ t: 'report', id: ra.me.id });
  await b.wait((m) => m.t === 'notice' && m.text.includes('신고'));
  ok('신고 접수');

  b.ws.close();
  await a.wait((m) => m.t === 'leave' && m.id === rb.me.id);
  ok('B가 나가면 A 화면에서 사라짐');
  a.ws.close();
  console.log('모두 통과');
  process.exit(0);
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
