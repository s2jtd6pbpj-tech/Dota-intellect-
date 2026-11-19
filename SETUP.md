# Dota Intellect — хостинг и ежедневное обновление винрейта

Что внутри:
- `index.html` — приложение целиком.
- `hs.py` — берёт свежую статистику героев из OpenDota и пишет `heroes.json`.
- `.github/workflows/heroes.yml` — запускает `hs.py` каждый день в 06:37 по Москве.

Страница сама подхватывает `heroes.json`, если он лежит рядом, и пишет дату данных
во вкладке «Герои». Если файла нет или он битый, работают встроенные данные.

## Настройка (один раз, с компьютера)
1. github.com → New repository → имя `dota-intellect`, Public → Create.
2. Add file → Upload files → перетащите всё содержимое этой папки,
   включая папку `.github` → Commit changes.
3. Settings → Actions → General → Workflow permissions → **Read and write** → Save.
4. Settings → Pages → Source: **Deploy from a branch**, Branch: `main`, папка `/ (root)` → Save.
5. Actions → `heroes-daily` → **Run workflow** (первый запуск вручную).
   Через минуту в репозитории появится `heroes.json`.
6. Через 1–2 минуты сайт откроется по адресу
   `https://ВАШ_ЛОГИН.github.io/dota-intellect/`.
   Во вкладке «Герои» должно быть: «Данные OpenDota на ГГГГ-ММ-ДД · обновляются каждый день».

Если запуск в Actions красный — откройте его и пришлите текст ошибки.
