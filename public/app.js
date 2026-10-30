// 쉼표숲 화면: 웹소켓으로 방·사람·채팅을 받고, 캐릭터와 소리는 모두 코드로 그린다(외부 파일 없음).
(() => {
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('shimpyo:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('shimpyo:' + k, JSON.stringify(v)); } catch {} }
  };

  const ROOMS = [
    { id: 'lake', name: '달빛 호숫가' },
    { id: 'fire', name: '모닥불 언덕' },
    { id: 'attic', name: '빗소리 다락방' }
  ];
  const COLORS = ['#f6c6a8', '#f7d794', '#c7e9b0', '#b5d8f2', '#d9c2f0', '#f5b8c8', '#fbe3b0', '#c2ece4'];

  const state = {
    ws: null, me: null, room: store.get('room', 'lake'), users: new Map(),
    blocked: new Set(), breathing: new Set(), counts: { total: 0, rooms: {} },
    outfit: store.get('outfit', { body: 'robe', feet: 'shoes' }),
    sound: false, volume: store.get('volume', 60), retry: 0
  };

  // ── 캐릭터 그림 ──
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  function itemSvg(id) {
    switch (id) {
      case 'robe':
        return '<path d="M22 112 Q20 78 50 70 Q80 78 78 112 Z" fill="#8d939c"/>' +
          '<path d="M22 112 Q20 78 50 70 Q80 78 78 112 Z" fill="none" stroke="#6f757e" stroke-width="2"/>' +
          '<path d="M40 73 L50 92 L60 73" fill="none" stroke="#dfe3e8" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M50 92 L50 112" stroke="#6f757e" stroke-width="2"/>';
      case 'shoes':
        return '<path d="M28 110 Q27 118 36 118 L47 118 Q48 112 44 110 Z" fill="#f2f2ee" stroke="#b9bcc0" stroke-width="1.5"/>' +
          '<path d="M72 110 Q73 118 64 118 L53 118 Q52 112 56 110 Z" fill="#f2f2ee" stroke="#b9bcc0" stroke-width="1.5"/>';
      case 'earmuff':
        return '<path d="M18 44 Q50 -2 82 44" fill="none" stroke="#c0525e" stroke-width="5" stroke-linecap="round"/>' +
          '<circle cx="18" cy="48" r="11" fill="#f4a6b4"/><circle cx="82" cy="48" r="11" fill="#f4a6b4"/>' +
          '<circle cx="15" cy="45" r="4" fill="#fbd3da"/><circle cx="79" cy="45" r="4" fill="#fbd3da"/>';
      case 'beanie':
        return '<path d="M19 38 Q22 8 50 8 Q78 8 81 38 Z" fill="#5f8fc9"/>' +
          '<rect x="16" y="32" width="68" height="11" rx="5" fill="#4a73a6"/>' +
          '<path d="M30 14 L30 32 M40 10 L40 32 M50 9 L50 32 M60 10 L60 32 M70 14 L70 32" stroke="#4a73a6" stroke-width="2"/>' +
          '<circle cx="50" cy="7" r="7" fill="#f3f1ea"/>';
    }
    return '';
  }
  function charSvg(color, outfit = {}, closed = false) {
    const body = outfit.body ? itemSvg(outfit.body) : `<path d="M24 112 Q22 80 50 72 Q78 80 76 112 Z" fill="${shade(color, -25)}"/>`;
    const feet = outfit.feet ? itemSvg(outfit.feet)
      : `<ellipse cx="38" cy="114" rx="9" ry="5" fill="${shade(color, -45)}"/><ellipse cx="62" cy="114" rx="9" ry="5" fill="${shade(color, -45)}"/>`;
    const eyes = closed
      ? '<path d="M36 50 Q40 54 44 50 M56 50 Q60 54 64 50" fill="none" stroke="#3b2f2f" stroke-width="2.5" stroke-linecap="round"/>'
      : '<circle cx="40" cy="50" r="3.2" fill="#3b2f2f"/><circle cx="60" cy="50" r="3.2" fill="#3b2f2f"/>';
    const sprout = outfit.head ? '' : '<path d="M50 14 Q50 6 50 4" stroke="#5c9b5a" stroke-width="2.5" fill="none"/><path d="M50 6 Q40 -2 36 6 Q44 10 50 6 Z M50 6 Q60 -2 64 6 Q56 10 50 6 Z" fill="#7cc274"/>';
    return `<svg viewBox="0 -4 100 126" aria-hidden="true">
      <ellipse cx="50" cy="118" rx="30" ry="5" fill="rgba(0,0,0,.25)"/>
      ${feet}${body}
      <ellipse cx="22" cy="92" rx="7" ry="9" fill="${color}"/><ellipse cx="78" cy="92" rx="7" ry="9" fill="${color}"/>
      ${sprout}
      <circle cx="50" cy="44" r="31" fill="${color}"/>
      <ellipse cx="42" cy="26" rx="10" ry="5" fill="rgba(255,255,255,.35)"/>
      ${eyes}
      <ellipse cx="33" cy="59" rx="6" ry="3.5" fill="rgba(240,120,130,.45)"/><ellipse cx="67" cy="59" rx="6" ry="3.5" fill="rgba(240,120,130,.45)"/>
      <path d="M46 60 Q50 63 54 60" fill="none" stroke="#3b2f2f" stroke-width="2" stroke-linecap="round"/>
      ${outfit.head ? itemSvg(outfit.head) : ''}
    </svg>`;
  }

  // 자리: 아래쪽 땅 위에 줄지어 앉는다. 뒤 줄일수록 작게.
  function seatPos(seat) {
    const rows = [5, 7, 8, 9, 10, 11, 12];
    let s = seat, row = 0;
    while (row < rows.length - 1 && s >= rows[row]) { s -= rows[row]; row++; }
    const n = rows[row];
    const y = 96 - row * 5.4;                      // 앞줄이 아래
    const spread = 92 - row * 4;
    // 가운데부터 좌우로 번갈아 앉는다
    const mid = (n - 1) / 2;
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    const x = 50 + (order[s % n] - mid) * (spread / n) + (row % 2 ? 3 : 0);
    const scale = 1 - row * 0.1;
    return { x, y, scale, z: 100 - row };
  }

  // ── 화면 그리기 ──
  const people = $('#people');
  function personEl(u) {
    let el = document.getElementById('p' + u.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'person';
      el.id = 'p' + u.id;
      el.innerHTML = '<div class="char"></div><div class="tag"></div>';
      el.addEventListener('click', (e) => openPersonMenu(u.id, e));
      people.appendChild(el);
    }
    return el;
  }
  function drawPerson(u) {
    const el = personEl(u);
    const p = seatPos(u.seat);
    const base = Math.max(52, Math.min(90, people.clientWidth / 9));
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
    el.style.width = base * p.scale + 'px';
    el.style.zIndex = p.z;
    el.classList.toggle('me', state.me && u.id === state.me.id);
    el.classList.toggle('breathing', state.breathing.has(u.id));
    el.querySelector('.char').innerHTML = charSvg(u.color, u.outfit, state.breathing.has(u.id));
    el.querySelector('.tag').textContent = u.name;
  }
  function drawAll() {
    people.innerHTML = '';
    for (const u of state.users.values()) drawPerson(u);
    drawBreathCount();
  }
  window.addEventListener('resize', () => { for (const u of state.users.values()) drawPerson(u); });

  function drawRooms() {
    const nav = $('#rooms');
    nav.innerHTML = '';
    for (const r of ROOMS) {
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', String(r.id === state.room));
      b.innerHTML = `${r.name}<small>${state.counts.rooms[r.id] || 0}</small>`;
      b.onclick = () => { if (r.id !== state.room) send({ t: 'room', room: r.id }); };
      nav.appendChild(b);
    }
  }
  function drawCount() {
    $('#count').innerHTML = `지금 <b>${state.counts.total}</b>명이 쉬는 중`;
    drawRooms();
  }
  function drawBreathCount() {
    const n = state.breathing.size;
    const el = $('#breathCount');
    el.hidden = n === 0;
    el.textContent = `🌬️ ${n}명이 함께 숨 고르는 중`;
  }

  function addMessage(m) {
    if (state.blocked.has(m.from)) return;
    const box = $('#messages');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const div = document.createElement('div');
    div.className = 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = m.color;
    who.textContent = m.name;
    who.onclick = (e) => openPersonMenu(m.from, e);
    const text = document.createElement('span');
    text.textContent = m.text;
    div.append(who, text);
    box.appendChild(div);
    while (box.children.length > 120) box.firstChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
  }
  function addNotice(text) {
    const div = document.createElement('div');
    div.className = 'msg notice';
    div.textContent = text;
    $('#messages').appendChild(div);
    $('#messages').scrollTop = $('#messages').scrollHeight;
  }
  function bubble(id, text) {
    const el = document.getElementById('p' + id);
    if (!el) return;
    el.querySelectorAll('.bubble').forEach((b) => b.remove());
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
    el.appendChild(b);
    setTimeout(() => b.remove(), 5000);
  }
  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function lantern(w, delay = 0) {
    const el = document.createElement('div');
    el.className = 'lantern';
    el.style.left = 12 + w.x * 76 + '%';
    el.style.animationDelay = delay + 's';
    el.innerHTML = '<div class="lamp"></div><div class="wish"></div>';
    el.querySelector('.wish').textContent = w.text;
    $('#wishes').appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // ── 연결 ──
  function send(msg) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(msg)); }
  function connect() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    state.ws = ws;
    ws.onopen = () => {
      state.retry = 0;
      send({ t: 'hello', room: state.room, name: store.get('name', null), color: store.get('color', null), outfit: state.outfit });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case 'room':
          state.room = m.room;
          store.set('room', m.room);
          document.body.dataset.room = m.room;
          state.me = m.me;
          state.users = new Map(m.users.map((u) => [u.id, u]));
          state.breathing.clear();
          state.counts = { total: m.total, rooms: m.rooms };
          $('#messages').innerHTML = '';
          addNotice(`${m.roomName}에 들어왔어요. 편하게 쉬다 가세요.`);
          m.chat.forEach(addMessage);
          m.wishes.slice(-5).forEach((w, i) => lantern(w, i * 2.5));
          drawAll();
          drawCount();
          sound.setRoom(m.room);
          break;
        case 'count':
          state.counts = { total: m.total, rooms: m.rooms };
          drawCount();
          break;
        case 'join':
          state.users.set(m.user.id, m.user);
          drawPerson(m.user);
          break;
        case 'update':
          state.users.set(m.user.id, m.user);
          if (state.me && m.user.id === state.me.id) state.me = m.user;
          drawPerson(m.user);
          break;
        case 'leave':
          state.users.delete(m.id);
          state.breathing.delete(m.id);
          document.getElementById('p' + m.id)?.remove();
          drawBreathCount();
          break;
        case 'chat':
          addMessage(m.msg);
          if (!state.blocked.has(m.msg.from)) bubble(m.msg.from, m.msg.text);
          break;
        case 'act':
          onAct(m.id, m.a);
          break;
        case 'wish':
          lantern(m.wish);
          break;
        case 'notice':
          toast(m.text);
          addNotice(m.text);
          break;
      }
    };
    ws.onclose = () => {
      const wait = Math.min(15000, 1000 * 2 ** state.retry++);
      $('#count').textContent = '다시 연결하는 중…';
      setTimeout(connect, wait);
    };
  }

  function onAct(id, a) {
    const u = state.users.get(id);
    if (!u) return;
    const el = document.getElementById('p' + id);
    if (a === 'breathe') { state.breathing.add(id); drawPerson(u); drawBreathCount(); }
    if (a === 'breatheEnd') { state.breathing.delete(id); drawPerson(u); drawBreathCount(); }
    if (a === 'nod' && el) { el.classList.remove('nod'); void el.offsetWidth; el.classList.add('nod'); }
    if (a === 'chime' && el) {
      const r = document.createElement('div');
      r.className = 'ripple';
      el.appendChild(r);
      setTimeout(() => r.remove(), 1700);
      sound.chime(state.me && id === state.me.id ? 1 : 0.5);
    }
  }

  // ── 숨 고르기 (4초 들이쉬기 · 4초 멈춤 · 6초 내쉬기, 세 번) ──
  let breathTimers = [];
  function startBreath() {
    const ov = $('#breath'), circle = ov.querySelector('.breath-circle'), text = $('#breathText'), sub = $('#breathSub');
    ov.hidden = false;
    send({ t: 'act', a: 'breathe' });
    const steps = [];
    for (let i = 0; i < 3; i++) {
      steps.push([`들이쉬고…`, 4000, 1.45, `${i + 1} / 3`]);
      steps.push([`잠깐 멈추고`, 4000, 1.45, `${i + 1} / 3`]);
      steps.push([`천천히 내쉬어요`, 6000, 1, `${i + 1} / 3`]);
    }
    let t = 600;
    text.textContent = '편하게 앉아요';
    circle.style.transform = 'scale(1)';
    for (const [label, dur, scale, s] of steps) {
      breathTimers.push(setTimeout(() => {
        text.textContent = label;
        sub.textContent = s;
        circle.style.transitionDuration = dur + 'ms';
        circle.style.transform = `scale(${scale})`;
      }, t));
      t += dur;
    }
    breathTimers.push(setTimeout(() => { text.textContent = '잘했어요'; sub.textContent = '조금 가벼워졌길 바라요'; }, t));
    breathTimers.push(setTimeout(stopBreath, t + 2200));
  }
  function stopBreath() {
    breathTimers.forEach(clearTimeout);
    breathTimers = [];
    $('#breath').hidden = true;
    send({ t: 'act', a: 'breatheEnd' });
  }
  $('#breathStop').onclick = stopBreath;

  // ── 버튼 ──
  document.querySelectorAll('#actions button').forEach((b) => {
    b.onclick = () => {
      sound.unlock();
      const a = b.dataset.act;
      if (a === 'breathe') startBreath();
      if (a === 'chime' || a === 'nod') send({ t: 'act', a });
      if (a === 'wish') { $('#wishInput').value = ''; $('#wishDialog').showModal(); }
    };
  });
  $('#wishDialog').addEventListener('close', () => {
    if ($('#wishDialog').returnValue === 'ok' && $('#wishInput').value.trim()) {
      send({ t: 'wish', text: $('#wishInput').value.trim() });
    }
  });

  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#chatInput').value.trim();
    if (!v) return;
    send({ t: 'chat', text: v });
    $('#chatInput').value = '';
  };

  // 사람 메뉴(신고)
  let menuTarget = null;
  function openPersonMenu(id, e) {
    e.stopPropagation();
    const u = state.users.get(id);
    if (!u || (state.me && id === state.me.id)) return;
    menuTarget = id;
    const menu = $('#personMenu');
    $('#personName').textContent = u.name;
    menu.hidden = false;
    const x = Math.min(e.clientX, innerWidth - 170), y = Math.min(e.clientY, innerHeight - 100);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('#personMenu')) $('#personMenu').hidden = true; });
  $('#reportBtn').onclick = () => {
    if (menuTarget == null) return;
    state.blocked.add(menuTarget);
    send({ t: 'report', id: menuTarget });
    document.querySelectorAll('#messages .msg').forEach((m) => {
      const w = m.querySelector('.who');
      if (w && w.textContent === state.users.get(menuTarget)?.name) m.remove();
    });
    $('#personMenu').hidden = true;
  };

  // ── 옷장 ──
  function drawCloset() {
    $('#closetPreview').innerHTML = charSvg(state.me ? state.me.color : COLORS[0], state.outfit);
    const grid = $('#itemGrid');
    grid.innerHTML = '';
    for (const it of window.ITEMS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (it.price ? ' locked' : '');
      b.setAttribute('aria-pressed', String(state.outfit[it.slot] === it.id));
      const box = { head: '0 -6 100 72', body: '14 64 72 54', feet: '22 100 56 24' }[it.slot];
      const svg = `<svg viewBox="${box}">${it.slot === 'head' ? '<circle cx="50" cy="44" r="31" fill="#e8dccb"/>' : ''}${itemSvg(it.id)}</svg>`;
      b.innerHTML = `${svg}<div>${it.name}</div><div class="price">${it.price ? it.price + '원 · 준비 중' : '기본 · 무료'}</div>`;
      b.onclick = () => {
        if (it.price) return toast(`${it.name}은 결제가 열리면 살 수 있어요.`);
        if (state.outfit[it.slot] === it.id) delete state.outfit[it.slot];
        else state.outfit[it.slot] = it.id;
        store.set('outfit', state.outfit);
        send({ t: 'outfit', outfit: state.outfit });
        drawCloset();
      };
      grid.appendChild(b);
    }
  }
  $('#closetBtn').onclick = () => { drawCloset(); $('#closet').showModal(); };

  // ── 설정 ──
  let pickedColor = null;
  $('#settingsBtn').onclick = () => {
    $('#nameInput').value = state.me ? state.me.name : '';
    $('#volume').value = state.volume;
    pickedColor = state.me ? state.me.color : COLORS[0];
    const row = $('#colorRow');
    row.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('aria-label', '색 고르기');
      b.setAttribute('aria-pressed', String(c === pickedColor));
      b.onclick = () => { pickedColor = c; row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
      row.appendChild(b);
    }
    $('#settings').showModal();
  };
  $('#volume').oninput = (e) => { state.volume = +e.target.value; store.set('volume', state.volume); sound.setVolume(); };
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'ok') return;
    const n = $('#nameInput').value.trim();
    if (n && state.me && n !== state.me.name) { store.set('name', n); send({ t: 'name', name: n }); }
    if (pickedColor && state.me && pickedColor !== state.me.color) {
      store.set('color', pickedColor);
      // 색은 다시 들어올 때 반영되므로 방에 다시 들어간다
      state.ws.close();
    }
  });

  // ── 소리: 전부 코드로 만든 잔잔한 소리 ──
  const sound = (() => {
    let ctx, master, roomNodes = [], room = null;
    function noiseBuffer() {
      const b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      return b;
    }
    function stopRoom() { roomNodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch {} }); roomNodes = []; }
    function startRoom() {
      if (!ctx || !state.sound) return;
      stopRoom();
      const out = ctx.createGain();
      out.gain.value = 0;
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
      out.connect(master);
      roomNodes.push(out);
      // 바람·물·비 소리(걸러 낸 잡음)
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = room === 'attic' ? 'highpass' : 'lowpass';
      f.frequency.value = room === 'attic' ? 1200 : room === 'fire' ? 500 : 700;
      const g = ctx.createGain();
      g.gain.value = room === 'attic' ? 0.5 : 0.35;
      src.connect(f).connect(g).connect(out);
      src.start();
      roomNodes.push(src);
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 0.07; lfoG.gain.value = room === 'attic' ? 0.1 : 0.2;
      lfo.connect(lfoG).connect(g.gain);
      lfo.start();
      roomNodes.push(lfo);
      // 낮게 깔리는 화음
      const notes = room === 'fire' ? [146.8, 220, 277.2] : room === 'attic' ? [130.8, 196, 246.9] : [110, 164.8, 220];
      for (const hz of notes) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine'; o.frequency.value = hz; og.gain.value = 0.018;
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = 0.05 + Math.random() * 0.08; lg.gain.value = 0.012;
        l.connect(lg).connect(og.gain);
        o.connect(og).connect(out);
        o.start(); l.start();
        roomNodes.push(o, l);
      }
      // 모닥불 타닥 소리
      if (room === 'fire') {
        const tick = () => {
          if (room !== 'fire' || !state.sound) return;
          const s = ctx.createBufferSource(), b = ctx.createBuffer(1, 400, ctx.sampleRate), d = b.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 60);
          s.buffer = b;
          const cg = ctx.createGain(); cg.gain.value = 0.15 + Math.random() * 0.25;
          s.connect(cg).connect(out); s.start();
          setTimeout(tick, 80 + Math.random() * 600);
        };
        tick();
      }
    }
    return {
      unlock() {
        if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
        this.setVolume();
      },
      setVolume() { if (master) master.gain.value = state.sound ? (state.volume / 100) * 0.9 : 0; },
      toggle() {
        this.unlock();
        state.sound = !state.sound;
        this.setVolume();
        if (state.sound) startRoom(); else stopRoom();
        return state.sound;
      },
      setRoom(r) { room = r; if (state.sound) startRoom(); },
      chime(level) {
        if (!ctx || !state.sound) return;
        const now = ctx.currentTime;
        [880, 1318.5, 1760, 2217].forEach((hz, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = hz * (1 + (Math.random() - 0.5) * 0.004);
          const t = now + i * 0.09;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.12 * level, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
          o.connect(g).connect(master);
          o.start(t); o.stop(t + 3.3);
        });
      }
    };
  })();
  $('#soundBtn').onclick = () => {
    const on = sound.toggle();
    $('#soundBtn').textContent = on ? '🔊' : '🔇';
    $('#soundBtn').setAttribute('aria-label', on ? '소리 끄기' : '소리 켜기');
  };

  // ── 휴대폰에 앱처럼 설치 ──
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $('#installBtn').hidden = true;
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  document.body.dataset.room = state.room;
  drawRooms();
  connect();
})();
