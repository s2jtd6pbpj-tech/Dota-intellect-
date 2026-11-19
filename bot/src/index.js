const APP = 'https://s2jtd6pbpj-tech.github.io/Dota-intellect-/';

const WELCOME = `Привет! Я Dota Intellect 👋

Помогаю выигрывать больше:
⚔️ Драфт — герой против вражеской команды и что собирать
🗺 Карта вардов — где ставить и что будет видно
📊 Герои — кто силён в текущем патче
🔍 Разбор матча — вставьте Match ID и посмотрите драфт и варды

Жмите кнопку ниже и начните с драфта 👇`;

const HINT = 'Все функции внутри приложения. Нажмите кнопку ниже 👇';

// Статистика хранится в базе D1 (привязка с именем DB).
// Сохраняются только номер пользователя, время и источник — без имён и текстов.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS bot_users (id INTEGER PRIMARY KEY, first INTEGER, last INTEGER, src TEXT, msgs INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, first INTEGER, last INTEGER, plat TEXT, src TEXT, opens INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)'
];
let ready = false;
async function db(env) {
  if (!env.DB) return null;
  if (!ready) {
    await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
    ready = true;
  }
  return env.DB;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function reply(chatId, text, button = true) {
  const body = { method: 'sendMessage', chat_id: chatId, text };
  if (button) {
    body.reply_markup = { inline_keyboard: [[
      { text: '⚔️ Открыть Dota Intellect', web_app: { url: APP } }
    ]] };
  }
  return new Response(JSON.stringify(body),
    { headers: { 'Content-Type': 'application/json' } });
}

async function stats(d, now) {
  const t0 = now - 86400e3, d7 = now - 7 * 86400e3, d30 = now - 30 * 86400e3;
  const q = (sql, ...a) => d.prepare(sql).bind(...a);
  const [b, a, plat, src] = await d.batch([
    q(`SELECT COUNT(*) n,
         SUM(first>=?1) nt, SUM(first>=?2) n7,
         SUM(last>=?1) at, SUM(last>=?2) a7, SUM(last>=?3) a30,
         SUM(msgs) m FROM bot_users`, t0, d7, d30),
    q(`SELECT COUNT(*) n, SUM(id LIKE 'tg%') tgn,
         SUM(first>=?1) nt, SUM(first>=?2) n7,
         SUM(last>=?1) at, SUM(last>=?2) a7, SUM(last>=?3) a30,
         SUM(opens) o FROM app_users`, t0, d7, d30),
    q(`SELECT plat, COUNT(*) n FROM app_users GROUP BY plat ORDER BY n DESC LIMIT 6`),
    q(`SELECT src, COUNT(*) n FROM bot_users WHERE src<>'' GROUP BY src ORDER BY n DESC LIMIT 5`)
  ]);
  const B = b.results[0], A = a.results[0], z = v => v || 0;
  const names = { ios: 'iPhone', android: 'Android', android_x: 'Android',
    tdesktop: 'Telegram Desktop', macos: 'Telegram Mac', weba: 'Telegram Web',
    webk: 'Telegram Web', web: 'браузер (вне Telegram)', unknown: 'неизвестно' };
  let t = `📊 Статистика Dota Intellect\n\n`;
  t += `🤖 Бот (писали боту)\n`;
  t += `• всего людей: ${z(B.n)}\n`;
  t += `• новых: за 24 часа ${z(B.nt)} · 7 дней ${z(B.n7)}\n`;
  t += `• активны: за 24 часа ${z(B.at)} · 7 дней ${z(B.a7)} · 30 дней ${z(B.a30)}\n`;
  t += `• сообщений всего: ${z(B.m)}\n\n`;
  t += `📱 Приложение (открывали)\n`;
  t += `• всего: ${z(A.n)} (из Telegram ${z(A.tgn)}, из браузера ${z(A.n) - z(A.tgn)})\n`;
  t += `• новых: за 24 часа ${z(A.nt)} · 7 дней ${z(A.n7)}\n`;
  t += `• активны: за 24 часа ${z(A.at)} · 7 дней ${z(A.a7)} · 30 дней ${z(A.a30)}\n`;
  t += `• открытий всего: ${z(A.o)}\n`;
  if (plat.results.length) {
    t += `\nУстройства:\n` + plat.results
      .map(r => `• ${names[r.plat] || r.plat}: ${r.n}`).join('\n') + '\n';
  }
  if (src.results.length) {
    t += `\nОткуда пришли (ссылки t.me/DotaIntellectBot?start=…):\n` + src.results
      .map(r => `• ${r.src}: ${r.n}`).join('\n') + '\n';
  }
  return t;
}

async function onMessage(msg, env) {
  const text = msg.text || '';
  const uid = msg.from && msg.from.id;
  const now = Date.now();
  const d = await db(env).catch(() => null);

  if (d && uid) {
    const m = text.match(/^\/start\s+(\S{1,64})/);
    const src = m ? m[1].replace(/[^\w-]/g, '').slice(0, 32) : '';
    await d.prepare(`INSERT INTO bot_users (id, first, last, src, msgs) VALUES (?1, ?2, ?2, ?3, 1)
      ON CONFLICT(id) DO UPDATE SET last=?2, msgs=msgs+1`).bind(uid, now, src).run().catch(() => {});
  }

  if (text.startsWith('/stats')) {
    if (!d) return reply(msg.chat.id, 'Статистика ещё не подключена: привяжите базу D1 с именем DB к воркеру.', false);
    const owner = await d.prepare(`SELECT v FROM meta WHERE k='owner'`).first('v');
    if (!owner) {
      // Первый, кто отправил /stats, становится владельцем статистики.
      await d.prepare(`INSERT INTO meta (k, v) VALUES ('owner', ?1)`).bind(String(uid)).run();
      return reply(msg.chat.id, '✅ Вы владелец статистики. Только вам бот будет её показывать.\n\n' + await stats(d, now), false);
    }
    if (owner !== String(uid)) return reply(msg.chat.id, HINT);
    return reply(msg.chat.id, await stats(d, now), false);
  }

  const isStart = text.startsWith('/start') || text.startsWith('/help');
  return reply(msg.chat.id, isStart ? WELCOME : HINT);
}

// Приложение сообщает об открытии: {u: "tg123" или "w<случайный id>", p: платформа, s: источник}
async function onOpen(request, env) {
  const d = await db(env).catch(() => null);
  if (!d) return new Response('no db', { headers: CORS });
  let j;
  try { j = JSON.parse(await request.text()); } catch { return new Response('bad', { status: 400, headers: CORS }); }
  const u = String(j.u || '');
  if (!/^(tg\d{1,15}|w[a-z0-9]{8,24})$/.test(u)) return new Response('bad', { status: 400, headers: CORS });
  const p = String(j.p || 'unknown').replace(/[^\w]/g, '').slice(0, 16) || 'unknown';
  const s = String(j.s || '').replace(/[^\w-]/g, '').slice(0, 32);
  const now = Date.now();
  await d.prepare(`INSERT INTO app_users (id, first, last, plat, src, opens) VALUES (?1, ?2, ?2, ?3, ?4, 1)
    ON CONFLICT(id) DO UPDATE SET last=?2, plat=?3, opens=opens+1`).bind(u, now, p, s).run();
  return new Response('ok', { headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/open') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
      if (request.method === 'POST') return onOpen(request, env).catch(() => new Response('err', { status: 500, headers: CORS }));
    }
    if (request.method !== 'POST') return new Response('ok');
    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    const msg = update.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private') return new Response('ok');
    return onMessage(msg, env);
  }
};
