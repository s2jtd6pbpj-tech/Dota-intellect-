const APP = 'https://s2jtd6pbpj-tech.github.io/Dota-intellect-/';

const WELCOME = `Привет! Я Dota Intellect 👋

Помогаю выигрывать больше:
⚔️ Драфт — герой против вражеской команды и что собирать
🗺 Карта вардов — где ставить и что будет видно
📊 Герои — кто силён в текущем патче
🔍 Разбор матча — вставьте Match ID и посмотрите драфт и варды

Жмите кнопку ниже и начните с драфта 👇

💬 Что-то непонятно или не работает? Просто напишите сюда сообщение — я читаю каждое.`;

const HINT = 'Все функции внутри приложения. Нажмите кнопку ниже 👇';

const FB_PROMPT = `💬 Напишите одним сообщением:
• что непонятно или неудобно;
• что не работает (можно скриншот);
• чего не хватает.

Читаю каждое сообщение лично и отвечаю 🙏`;

const FB_THANKS = 'Спасибо! Передал разработчику 🙏 Если ответит — сообщение придёт сюда.';

const OWNER_HELP = `Команды владельца:
/stats — статистика
/inbox — последние отзывы
/broadcast — рассылка всем пользователям

Чтобы ответить на отзыв, ответьте (свайп влево) на уведомление о нём.`;

// Данные хранятся в базе D1 (привязка DB). Токен бота — секрет BOT_TOKEN.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS bot_users (id INTEGER PRIMARY KEY, first INTEGER, last INTEGER, src TEXT, msgs INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, first INTEGER, last INTEGER, plat TEXT, src TEXT, opens INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
  'CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, uid TEXT, chat INTEGER, name TEXT, src TEXT, rating INTEGER, tags TEXT, text TEXT, answered INTEGER DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS bcast (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, text TEXT, entities TEXT, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, status TEXT)',
  'CREATE TABLE IF NOT EXISTS bq (bc INTEGER, chat INTEGER, PRIMARY KEY (bc, chat))'
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
const APP_BTN = { text: '⚔️ Открыть Dota Intellect', web_app: { url: APP } };
const RATE_ROW = [1, 2, 3, 4, 5].map(n => ({ text: ['😡', '🙁', '😐', '🙂', '😍'][n - 1] + ' ' + n, callback_data: 'rt:' + n }));
const BATCH = 30; // сообщений рассылки за один запуск (лимит подзапросов Cloudflare)

function json(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
function reply(chatId, text, button = true, extra = {}) {
  const body = { method: 'sendMessage', chat_id: chatId, text, ...extra };
  if (button && !body.reply_markup) body.reply_markup = { inline_keyboard: [[APP_BTN]] };
  return json(body);
}

// ---------- Telegram API (нужен секрет BOT_TOKEN) ----------
async function tg(env, method, body) {
  if (!env.BOT_TOKEN) return { ok: false, description: 'no token' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
// Секрет вебхука выводится из токена: отдельно хранить ничего не нужно.
async function hookSecret(env) {
  return (await sha256hex('webhook:' + env.BOT_TOKEN)).slice(0, 48);
}

let setupDone = false;
async function setup(env, origin) {
  if (setupDone) return true;
  const r = await tg(env, 'setWebhook', {
    url: origin + '/', secret_token: await hookSecret(env),
    allowed_updates: ['message', 'callback_query']
  });
  if (!r.ok) {
    console.log('setWebhook failed', r.description);
    return false;
  }
  setupDone = true;
  await tg(env, 'setMyCommands', { commands: [
    { command: 'start', description: 'Открыть Dota Intellect' },
    { command: 'feedback', description: 'Написать отзыв или сообщить об ошибке' }
  ] });
  return true;
}

// Проверка подписи данных мини-приложения (Telegram.WebApp.initData)
async function checkInit(init, token) {
  try {
    const p = new URLSearchParams(init);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
    const key = await hmac('WebAppData', token);
    const sig = [...await hmac(key, dcs)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (sig !== hash) return null;
    if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 7 * 86400) return null;
    return JSON.parse(p.get('user') || 'null');
  } catch {
    return null;
  }
}

// ---------- вспомогательное ----------
const getOwner = d => d.prepare(`SELECT v FROM meta WHERE k='owner'`).first('v');
const setMeta = (d, k, v) => d.prepare(`INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v=?2`).bind(k, v).run();
const delMeta = (d, k) => d.prepare(`DELETE FROM meta WHERE k=?1`).bind(k).run();
const who = u => u ? ((u.first_name || '') + (u.last_name ? ' ' + u.last_name : '')).trim().slice(0, 60) +
  (u.username ? ' (@' + u.username + ')' : '') : 'аноним';
const stars = r => r ? '⭐'.repeat(r) + ` (${r} из 5)` : '';
function msk(ts) {
  const d = new Date(ts + 3 * 3600e3), z = n => String(n).padStart(2, '0');
  return `${z(d.getUTCDate())}.${z(d.getUTCMonth() + 1)} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`;
}

async function saveFeedback(d, f) {
  const r = await d.prepare(`INSERT INTO feedback (ts, uid, chat, name, src, rating, tags, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`)
    .bind(Date.now(), f.uid, f.chat || null, f.name || '', f.src, f.rating || null, f.tags || '', (f.text || '').slice(0, 3000)).first();
  return r && r.id;
}
async function tooMany(d, uid) {
  const n = await d.prepare(`SELECT COUNT(*) n FROM feedback WHERE uid=?1 AND ts>?2`).bind(uid, Date.now() - 86400e3).first('n');
  return n >= 20;
}
async function notifyOwner(env, d, id, f, copyFrom) {
  const owner = await getOwner(d);
  if (!owner) return;
  const where = { bot: 'в боте', app: 'из приложения', rate: 'оценка из рассылки' }[f.src] || f.src;
  let t = `💬 Отзыв #${id} · ${where}\nОт: ${f.name || 'аноним'}${f.chat ? ' · id ' + f.chat : ''}`;
  if (f.rating) t += `\nОценка: ${stars(f.rating)}`;
  if (f.tags) t += `\nТеги: ${f.tags}`;
  if (f.text) t += `\n\n${f.text}`;
  if (f.chat) t += `\n\n↩️ Ответьте на это сообщение, чтобы ответить человеку.`;
  if (copyFrom) await tg(env, 'copyMessage', { chat_id: Number(owner), from_chat_id: copyFrom.chat, message_id: copyFrom.id });
  await tg(env, 'sendMessage', { chat_id: Number(owner), text: t.slice(0, 4000) });
}

// ---------- статистика ----------
async function stats(d, now) {
  const t0 = now - 86400e3, d7 = now - 7 * 86400e3, d30 = now - 30 * 86400e3;
  const q = (sql, ...a) => d.prepare(sql).bind(...a);
  const [b, a, plat, src, fb] = await d.batch([
    q(`SELECT COUNT(*) n,
         SUM(first>=?1) nt, SUM(first>=?2) n7,
         SUM(last>=?1) at, SUM(last>=?2) a7, SUM(last>=?3) a30,
         SUM(msgs) m FROM bot_users`, t0, d7, d30),
    q(`SELECT COUNT(*) n, SUM(id LIKE 'tg%') tgn,
         SUM(first>=?1) nt, SUM(first>=?2) n7,
         SUM(last>=?1) at, SUM(last>=?2) a7, SUM(last>=?3) a30,
         SUM(opens) o FROM app_users`, t0, d7, d30),
    q(`SELECT plat, COUNT(*) n FROM app_users GROUP BY plat ORDER BY n DESC LIMIT 6`),
    q(`SELECT src, COUNT(*) n FROM bot_users WHERE src<>'' GROUP BY src ORDER BY n DESC LIMIT 5`),
    q(`SELECT COUNT(*) n, SUM(ts>=?1) n7, AVG(rating) avg, COUNT(rating) nr FROM feedback`, d7)
  ]);
  const B = b.results[0], A = a.results[0], F = fb.results[0], z = v => v || 0;
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
  t += `• открытий всего: ${z(A.o)}\n\n`;
  t += `💬 Отзывы: всего ${z(F.n)} · за 7 дней ${z(F.n7)}`;
  t += F.nr ? ` · средняя оценка ${F.avg.toFixed(1)} (оценок: ${F.nr})\n` : '\n';
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

async function inbox(d) {
  const r = await d.prepare(`SELECT * FROM feedback ORDER BY id DESC LIMIT 10`).all();
  if (!r.results.length) return 'Отзывов пока нет.';
  return '💬 Последние отзывы (новые сверху):\n\n' + r.results.map(f =>
    `#${f.id} · ${msk(f.ts)} · ${f.name || 'аноним'}` +
    (f.rating ? ` · ${'⭐'.repeat(f.rating)}` : '') + (f.answered ? ' · ✅ отвечено' : '') +
    (f.tags ? `\n${f.tags}` : '') + (f.text ? `\n${f.text.slice(0, 300)}` : '')
  ).join('\n\n').slice(0, 4000) + '\n\nЧтобы ответить: /reply номер текст';
}

// ---------- рассылка ----------
async function bcPreview(env, d, owner, text, entities) {
  const id = (await d.prepare(`INSERT INTO bcast (ts, text, entities, status) VALUES (?1, ?2, ?3, 'draft') RETURNING id`)
    .bind(Date.now(), text, JSON.stringify(entities || [])).first()).id;
  const n = await d.prepare(`SELECT COUNT(*) n FROM (SELECT id c FROM bot_users UNION SELECT CAST(substr(id,3) AS INTEGER) FROM app_users WHERE id LIKE 'tg%')`).first('n');
  await tg(env, 'sendMessage', { chat_id: owner, text: `👀 Так увидят рассылку (получателей: ${n}):` });
  await tg(env, 'sendMessage', { chat_id: owner, text, entities: entities || [], reply_markup: { inline_keyboard: [RATE_ROW, [APP_BTN]] } });
  await tg(env, 'sendMessage', { chat_id: owner, text: 'Отправить?', reply_markup: { inline_keyboard: [[
    { text: `✅ Отправить всем (${n})`, callback_data: 'bc_go:' + id },
    { text: '✖️ Отмена', callback_data: 'bc_no:' + id }
  ]] } });
}

async function bcSend(env, d, id, owner) {
  const bc = await d.prepare(`SELECT * FROM bcast WHERE id=?1`).bind(id).first();
  if (!bc || bc.status === 'done' || bc.status === 'cancel') return;
  if (bc.status === 'draft') {
    await d.prepare(`INSERT OR IGNORE INTO bq (bc, chat) SELECT ?1, c FROM (SELECT id c FROM bot_users UNION SELECT CAST(substr(id,3) AS INTEGER) FROM app_users WHERE id LIKE 'tg%')`).bind(id).run();
    const total = await d.prepare(`SELECT COUNT(*) n FROM bq WHERE bc=?1`).bind(id).first('n');
    await d.prepare(`UPDATE bcast SET status='sending', total=?2 WHERE id=?1`).bind(id, total).run();
    bc.total = total;
  }
  const rows = (await d.prepare(`SELECT chat FROM bq WHERE bc=?1 LIMIT ${BATCH}`).bind(id).all()).results;
  const entities = JSON.parse(bc.entities || '[]');
  let ok = 0, bad = 0;
  for (const r of rows) {
    const res = await tg(env, 'sendMessage', { chat_id: r.chat, text: bc.text, entities,
      reply_markup: { inline_keyboard: [RATE_ROW, [APP_BTN]] } });
    if (res.ok) ok++; else bad++;
    await d.prepare(`DELETE FROM bq WHERE bc=?1 AND chat=?2`).bind(id, r.chat).run();
  }
  const left = await d.prepare(`SELECT COUNT(*) n FROM bq WHERE bc=?1`).bind(id).first('n');
  await d.prepare(`UPDATE bcast SET sent=sent+?2, failed=failed+?3, status=?4 WHERE id=?1`)
    .bind(id, ok, bad, left ? 'sending' : 'done').run();
  const s = await d.prepare(`SELECT * FROM bcast WHERE id=?1`).bind(id).first();
  if (!owner) return;
  if (left) {
    await tg(env, 'sendMessage', { chat_id: owner, text: `📨 Отправлено ${s.sent + s.failed} из ${s.total}. Осталось ${left}.`,
      reply_markup: { inline_keyboard: [[{ text: `▶️ Отправить следующие ${Math.min(left, BATCH)}`, callback_data: 'bc_more:' + id }]] } });
  } else {
    await tg(env, 'sendMessage', { chat_id: owner, text: `✅ Рассылка #${id} завершена.\nДоставлено: ${s.sent}\nНе доставлено: ${s.failed} (заблокировали бота или ни разу его не запускали)` });
  }
}

// ---------- обработка сообщений ----------
async function onMessage(msg, env, ctx) {
  const text = msg.text || msg.caption || '';
  const u = msg.from || {};
  const uid = u.id;
  const chat = msg.chat.id;
  const now = Date.now();
  const d = await db(env).catch(() => null);

  if (d && uid) {
    const m = (msg.text || '').match(/^\/start\s+(\S{1,64})/);
    const src = m ? m[1].replace(/[^\w-]/g, '').slice(0, 32) : '';
    await d.prepare(`INSERT INTO bot_users (id, first, last, src, msgs) VALUES (?1, ?2, ?2, ?3, 1)
      ON CONFLICT(id) DO UPDATE SET last=?2, msgs=msgs+1`).bind(uid, now, src).run().catch(() => {});
  }
  if (!d) {
    if (msg.text && msg.text.startsWith('/start')) return reply(chat, WELCOME);
    return reply(chat, HINT);
  }

  let owner = await getOwner(d);
  const isOwner = owner && owner === String(uid);
  const cmd = (msg.text || '').startsWith('/') ? msg.text.split(/[\s@]/)[0].toLowerCase() : '';

  // ----- команды -----
  if (cmd === '/start') {
    const p = (msg.text.split(/\s+/)[1] || '');
    if (p === 'fb' || p === 'feedback') return reply(chat, FB_PROMPT, false);
    return reply(chat, WELCOME);
  }
  if (cmd === '/help') return reply(chat, isOwner ? WELCOME + '\n\n' + OWNER_HELP : WELCOME);
  if (cmd === '/feedback') return reply(chat, FB_PROMPT, false);
  if (cmd === '/stats') {
    if (!owner) {
      // Первый, кто отправил /stats, становится владельцем.
      await setMeta(d, 'owner', String(uid));
      return reply(chat, '✅ Вы владелец бота. Статистику и отзывы бот будет показывать только вам.\n\n' + await stats(d, now) + '\n' + OWNER_HELP, false);
    }
    if (!isOwner) return reply(chat, HINT);
    return reply(chat, await stats(d, now), false);
  }
  if (isOwner && cmd === '/inbox') return reply(chat, await inbox(d), false);
  if (isOwner && cmd === '/reply') {
    const m = msg.text.match(/^\/reply(?:@\w+)?\s+#?(\d+)\s+([\s\S]+)/);
    if (!m) return reply(chat, 'Формат: /reply номер текст\nНапример: /reply 12 Спасибо, исправил!', false);
    return answer(env, d, chat, Number(m[1]), m[2]);
  }
  if (isOwner && cmd === '/broadcast') {
    if (!env.BOT_TOKEN) return reply(chat, 'Для рассылки добавьте в Cloudflare секрет BOT_TOKEN (Settings → Variables and Secrets).', false);
    const body = msg.text.replace(/^\/broadcast(@\w+)?\s*/, '');
    if (!body) {
      await setMeta(d, 'bc_wait', '1');
      return reply(chat, '✍️ Пришлите текст рассылки следующим сообщением. Можно с жирным и ссылками.\n\nПод сообщением будут кнопки оценки 1–5 и кнопка открытия приложения.\n\nОтмена: /cancel', false);
    }
    const off = msg.text.length - body.length;
    const ents = (msg.entities || []).filter(e => e.offset >= off).map(e => ({ ...e, offset: e.offset - off }));
    ctx.waitUntil(bcPreview(env, d, chat, body, ents));
    return new Response('ok');
  }
  if (isOwner && cmd === '/cancel') {
    await delMeta(d, 'bc_wait');
    return reply(chat, 'Отменено.', false);
  }
  if (cmd) return reply(chat, isOwner ? OWNER_HELP : HINT, !isOwner);

  // ----- владелец: ответ на отзыв или текст рассылки -----
  if (isOwner) {
    const rt = msg.reply_to_message && (msg.reply_to_message.text || '');
    const m = rt && rt.match(/Отзыв #(\d+)/);
    if (m) {
      if (!msg.text) return reply(chat, 'Ответить можно только текстом.', false);
      return answer(env, d, chat, Number(m[1]), msg.text);
    }
    if (await d.prepare(`SELECT v FROM meta WHERE k='bc_wait'`).first('v')) {
      if (!msg.text) return reply(chat, 'Рассылка пока только текстом. Пришлите текст или /cancel.', false);
      await delMeta(d, 'bc_wait');
      ctx.waitUntil(bcPreview(env, d, chat, msg.text, msg.entities || []));
      return new Response('ok');
    }
  }

  // ----- всё остальное — отзыв -----
  if (await tooMany(d, String(uid))) return reply(chat, HINT);
  const kind = msg.text ? '' : msg.photo ? '[фото] ' : msg.voice ? '[голосовое] ' : msg.video ? '[видео] ' :
    msg.document ? '[файл] ' : msg.sticker ? '[стикер] ' : '[вложение] ';
  const f = { uid: String(uid), chat, name: who(u), src: 'bot', text: kind + text };
  const id = await saveFeedback(d, f);
  ctx.waitUntil(notifyOwner(env, d, id, f, msg.text ? null : { chat, id: msg.message_id }));
  return reply(chat, FB_THANKS);
}

async function answer(env, d, chat, id, text) {
  const f = await d.prepare(`SELECT * FROM feedback WHERE id=?1`).bind(id).first();
  if (!f) return reply(chat, `Отзыв #${id} не найден.`, false);
  if (!f.chat) return reply(chat, `Отзыв #${id} оставлен из браузера без Telegram — ответить некому.`, false);
  if (!env.BOT_TOKEN) return reply(chat, 'Чтобы отвечать, добавьте в Cloudflare секрет BOT_TOKEN.', false);
  const r = await tg(env, 'sendMessage', { chat_id: f.chat, text: '💬 Ответ разработчика Dota Intellect:\n\n' + text,
    reply_markup: { inline_keyboard: [[APP_BTN]] } });
  if (!r.ok) return reply(chat, `Не доставлено: ${r.description || 'ошибка'}`, false);
  await d.prepare(`UPDATE feedback SET answered=1 WHERE id=?1`).bind(id).run();
  return reply(chat, `✅ Ответ на отзыв #${id} отправлен.`, false);
}

async function onCallback(cq, env, ctx) {
  const d = await db(env).catch(() => null);
  const ans = text => json({ method: 'answerCallbackQuery', callback_query_id: cq.id, text });
  if (!d) return ans('');
  const data = cq.data || '';
  const u = cq.from || {};
  const owner = await getOwner(d);
  const isOwner = owner && owner === String(u.id);

  let m = data.match(/^rt:([1-5])$/);
  if (m) {
    const r = Number(m[1]);
    const chat = cq.message ? cq.message.chat.id : u.id;
    if (await tooMany(d, String(u.id))) return ans('Спасибо!');
    const f = { uid: String(u.id), chat, name: who(u), src: 'rate', rating: r };
    const id = await saveFeedback(d, f);
    ctx.waitUntil((async () => {
      if (cq.message) {
        await tg(env, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id,
          reply_markup: { inline_keyboard: [[APP_BTN]] } });
      }
      await tg(env, 'sendMessage', { chat_id: chat, text: r >= 4
        ? 'Спасибо за оценку! 🙌 Что нравится больше всего и чего не хватает? Напишите сюда одним сообщением.'
        : 'Спасибо за честность 🙏 Что мешает или непонятно? Напишите сюда одним сообщением — постараюсь исправить.' });
      await notifyOwner(env, d, id, f);
    })());
    return ans('Спасибо за оценку!');
  }

  m = data.match(/^bc_(go|no|more):(\d+)$/);
  if (m && isOwner) {
    const id = Number(m[2]);
    if (m[1] === 'no') {
      await d.prepare(`UPDATE bcast SET status='cancel' WHERE id=?1 AND status='draft'`).bind(id).run();
      return ans('Рассылка отменена');
    }
    const bc = await d.prepare(`SELECT status FROM bcast WHERE id=?1`).bind(id).first('status');
    if (m[1] === 'go' && bc !== 'draft') return ans('Эта рассылка уже запущена или отменена');
    if (cq.message) {
      ctx.waitUntil(tg(env, 'editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [] } }));
    }
    ctx.waitUntil(bcSend(env, d, id, Number(owner)));
    return ans('Отправляю…');
  }
  return ans('');
}

// ---------- запросы из приложения ----------
// Отметка открытия: {u: "tg123" или "w<случайный id>", p: платформа, s: источник}
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

// Отзыв из приложения: {init: Telegram.WebApp.initData, u: id браузера, r: 1-5, tags: [...], t: текст}
async function onAppFeedback(request, env, ctx) {
  const d = await db(env).catch(() => null);
  const out = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!d) return out({ ok: false, error: 'no db' }, 503);
  let j;
  try { j = JSON.parse(await request.text()); } catch { return out({ ok: false }, 400); }
  const text = String(j.t || '').trim().slice(0, 3000);
  const rating = [1, 2, 3, 4, 5].includes(Number(j.r)) ? Number(j.r) : null;
  const tags = (Array.isArray(j.tags) ? j.tags : []).map(x => String(x).slice(0, 40)).slice(0, 6).join(', ');
  if (!text && !rating && !tags) return out({ ok: false, error: 'empty' }, 400);

  let user = null;
  if (j.init && env.BOT_TOKEN) user = await checkInit(String(j.init), env.BOT_TOKEN);
  let uid, chat = null, name;
  if (user && user.id) {
    uid = String(user.id); chat = user.id; name = who(user);
  } else {
    uid = String(j.u || '');
    if (!/^w[a-z0-9]{8,24}$/.test(uid)) return out({ ok: false }, 400);
    name = 'без Telegram (браузер)';
  }
  if (await tooMany(d, uid)) return out({ ok: false, error: 'limit' }, 429);
  const f = { uid, chat, name, src: 'app', rating, tags, text };
  const id = await saveFeedback(d, f);
  ctx.waitUntil(notifyOwner(env, d, id, f));
  return out({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/open' || url.pathname === '/fb') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
      if (request.method === 'POST') {
        const h = url.pathname === '/open' ? onOpen(request, env) : onAppFeedback(request, env, ctx);
        return h.catch(() => new Response('err', { status: 500, headers: CORS }));
      }
    }
    if (request.method !== 'POST') return new Response('ok');

    // С токеном принимаем только запросы Telegram с секретом вебхука.
    // Если секрета нет (первый запуск после добавления токена) — один раз
    // перерегистрируем вебхук с секретом, а этот запрос пропускаем.
    // Если токен неверный и вебхук не ставится — работаем как без токена.
    if (env.BOT_TOKEN) {
      const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (got !== await hookSecret(env)) {
        if (await setup(env, url.origin)) return new Response('ok');
        env = { ...env, BOT_TOKEN: '' };
      }
    }

    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    try {
      if (update.callback_query) return await onCallback(update.callback_query, env, ctx);
      const msg = update.message;
      if (!msg || !msg.chat || msg.chat.type !== 'private') return new Response('ok');
      return await onMessage(msg, env, ctx);
    } catch (e) {
      console.log('error', e && e.stack || e);
      return new Response('ok');
    }
  },

  // Необязательно: если добавить Cron Trigger, большие рассылки допишутся сами.
  async scheduled(event, env, ctx) {
    const d = await db(env).catch(() => null);
    if (!d) return;
    const bc = await d.prepare(`SELECT id FROM bcast WHERE status='sending' ORDER BY id LIMIT 1`).first('id');
    if (bc) await bcSend(env, d, bc, null);
  }
};
