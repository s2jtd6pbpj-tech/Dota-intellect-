const APP = 'https://s2jtd6pbpj-tech.github.io/Dota-intellect-/';

const WELCOME = `Привет! Я Dota Intellect 👋

Помогаю выигрывать больше:
⚔️ Драфт — герой против вражеской команды и что собирать
🗺 Карта вардов — где ставить и что будет видно
📊 Герои — кто силён в текущем патче
🔍 Разбор матча — вставьте Match ID и посмотрите драфт и варды

Жмите кнопку ниже и начните с драфта 👇`;

const HINT = 'Все функции внутри приложения. Нажмите кнопку ниже 👇';

export default {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('ok');
    let update;
    try { update = await request.json(); } catch { return new Response('ok'); }
    const msg = update.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private') return new Response('ok');
    const text = msg.text || '';
    const isStart = text.startsWith('/start') || text.startsWith('/help');
    return new Response(JSON.stringify({
      method: 'sendMessage',
      chat_id: msg.chat.id,
      text: isStart ? WELCOME : HINT,
      reply_markup: { inline_keyboard: [[
        { text: '⚔️ Открыть Dota Intellect', web_app: { url: APP } }
      ]] }
    }), { headers: { 'Content-Type': 'application/json' } });
  }
};
