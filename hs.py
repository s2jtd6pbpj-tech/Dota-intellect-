import calendar, json, os, sys, time, urllib.error, urllib.request

# Начало текущего патча (сутки STRATZ считаются по UTC).
PATCH = "7.42"
PATCH_START = "2026-11-19"

UA = {"User-Agent": "dota-intellect"}


def get_json(url, data=None, headers=None):
    h = dict(UA)
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    return json.load(urllib.request.urlopen(req, timeout=60))


# ---------- OpenDota: последние 7 дней (окно OpenDota) ----------
rows = get_json("https://api.opendota.com/api/heroStats")
need = ["id", "pro_pick", "pro_win", "pro_ban"] + \
       ["%d_%s" % (b, k) for b in range(1, 9) for k in ("pick", "win")]
miss = [k for k in need if k not in rows[0]]
if miss:
    print("OpenDota: нет полей:", miss)
    sys.exit(1)
st, pr = {}, {}
for r in rows:
    h = str(r["id"])
    st[h] = [r.get("%d_%s" % (b, k)) or 0
             for b in range(1, 9) for k in ("pick", "win")]
    pr[h] = [r.get("pro_pick") or 0, r.get("pro_win") or 0,
             r.get("pro_ban") or 0]
if len(st) < 120:
    print("OpenDota: слишком мало героев:", len(st))
    sys.exit(1)

out = {"date": time.strftime("%Y-%m-%d"), "st": st, "pr": pr}

# ---------- STRATZ: по дням, с начала патча ----------
TOK = os.environ.get("STRATZ_TOKEN", "").strip()
RANKS = ["HERALD", "GUARDIAN", "CRUSADER", "ARCHON",
         "LEGEND", "ANCIENT", "DIVINE", "IMMORTAL"]


def gql(query):
    # STRATZ иногда отвечает 403/429 при частых запросах: ждём и пробуем снова
    for k in range(4):
        try:
            return gql_once(query)
        except urllib.error.HTTPError as e:
            try:
                body = e.read()[:300].decode("utf-8", "replace")
            except Exception:
                body = ""
            print("STRATZ HTTP", e.code, "server:", e.headers.get("server"),
                  "| ответ:", " ".join(body.split())[:300])
            if e.code not in (403, 429, 502, 503) or k == 3:
                raise
            time.sleep(30 * (k + 1))


def gql_once(query):
    r = get_json("https://api.stratz.com/graphql",
                 json.dumps({"query": query}).encode(),
                 {"Content-Type": "application/json",
                  "Authorization": "Bearer " + TOK,
                  "User-Agent": "STRATZ_API"})
    if r.get("errors"):
        raise RuntimeError(r["errors"][0].get("message"))
    return r["data"]


def ts(x):
    x = int(x)
    if x > 10 ** 11:
        return x // 1000
    if x < 10 ** 7:  # часы с 1970 года
        return x * 3600
    return x


def pull_all(take_d, take_h, start):
    """Один запрос на все ранги: {"winDay": {время: {герой: 16}}, "winHour": ...}"""
    mode = "gameModeIds:[ALL_PICK_RANKED,ALL_PICK]"
    parts = []
    for i, name in enumerate(RANKS):
        parts.append("d%d:winDay(take:%d,bracketIds:[%s],%s){day heroId matchCount winCount}"
                     % (i, take_d, name, mode))
        parts.append("h%d:winHour(take:%d,bracketIds:[%s],%s){hour heroId matchCount winCount}"
                     % (i, take_h, name, mode))
    d = gql("{heroStats{%s}}" % " ".join(parts))["heroStats"]
    res = {"winDay": ({}, set()), "winHour": ({}, set())}
    for i in range(len(RANKS)):
        for pre, field, key in (("d", "winDay", "day"), ("h", "winHour", "hour")):
            out_, seen = res[field]
            for r in d.get("%s%d" % (pre, i)) or []:
                t = ts(r[key])
                seen.add(t)
                if t < start:
                    continue
                a = out_.setdefault(t, {}).setdefault(str(r["heroId"]), [0] * 16)
                a[i * 2] += r["matchCount"]
                a[i * 2 + 1] += r["winCount"]
    return res


def add(dst, src):
    for h, a in src.items():
        p = dst.setdefault(h, [0] * 16)
        for j in range(16):
            p[j] += a[j]


def fmt(t):
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(t))


def stratz():
    start = calendar.timegm(time.strptime(PATCH_START, "%Y-%m-%d"))
    now = time.time()
    res = pull_all(max(2, int((now - start) // 86400) + 2), 72, start)
    days, dseen = res["winDay"]
    hours, hseen = res["winHour"]
    print("STRATZ: суток", len(days), "часов", len(hours),
          "последний час:", fmt(max(hseen)) if hseen else "-")

    # Почасовые данные копим в hours.json: STRATZ отдаёт только ~30 последних часов,
    # а полные сутки появляются больше чем через день.
    tail = (max(days) + 86400) if days else start
    try:
        cache = {int(k): v for k, v in json.load(open("hours.json")).items()}
    except Exception:
        cache = {}
        # Разовый запуск: восстановить часы до начала окна STRATZ из прошлой сводки
        try:
            seed = json.load(open("seed.json"))
            to = calendar.timegm(time.strptime(seed["to"], "%Y-%m-%d %H:%M"))
            first = min(hours) if hours else to
            if first > start:
                have = {}
                for t, hh in hours.items():
                    if t < to:
                        add(have, hh)
                miss = {}
                for h, a in seed["st"].items():
                    b = have.get(h, [0] * 16)
                    miss[h] = [max(0, a[j] - b[j]) for j in range(16)]
                cache[start] = miss
                print("STRATZ: восстановил часы с", fmt(start), "до", fmt(first))
        except Exception as e:
            print("seed не применён:", e)
    cache.update(hours)
    hours = {t: v for t, v in cache.items() if t >= tail}
    json.dump({str(t): v for t, v in sorted(hours.items())},
              open("hours.json", "w"), separators=(",", ":"))

    patch = {}
    for dd in days.values():
        add(patch, dd)
    for t, hh in hours.items():
        if t >= tail:
            add(patch, hh)
    if not patch:
        raise RuntimeError("нет данных с %s; дни: %s; часы: %s" % (
            PATCH_START, ", ".join(fmt(x) for x in sorted(dseen)[-3:]) or "-",
            ", ".join(fmt(x) for x in sorted(hseen)[-2:]) or "-"))
    last = max(list(hours) + [t + 86400 - 3600 for t in days])
    out["patch"] = {"name": PATCH, "since": PATCH_START, "st": patch,
                    "days": len(days), "to": fmt(last + 3600)}
    if hours:
        top = max(hours)
        d24 = {}
        for t, hh in hours.items():
            if t > top - 86400:
                add(d24, hh)
        out["day"] = {"date": fmt(top + 3600)[:10], "to": fmt(top + 3600),
                      "hours": True, "st": d24}
    elif days:
        out["day"] = {"date": fmt(max(days))[:10], "st": days[max(days)]}
    tot = sum(sum(a[8:16:2]) for a in patch.values())
    print("STRATZ: героев", len(patch), "игр Legend+ (героо-игр)", tot,
          "данные до", out["patch"]["to"])


if TOK:
    try:
        stratz()
    except Exception as e:
        out["stratz_error"] = str(e)[:300]
        print("STRATZ: ошибка:", e)
else:
    out["stratz_error"] = "нет STRATZ_TOKEN"
    print("STRATZ: нет токена, пропускаю")

# Если STRATZ сейчас недоступен, оставляем прошлые данные за патч и 24 часа
if "patch" not in out:
    try:
        old = json.load(open("heroes.json"))
        if old.get("patch", {}).get("since") == PATCH_START:
            out["patch"] = old["patch"]
            if old.get("day"):
                out["day"] = old["day"]
            print("STRATZ: оставил прошлые данные до", old["patch"].get("to"))
    except Exception as e:
        print("старый heroes.json не прочитан:", e)

json.dump(out, open("heroes.json", "w"), separators=(",", ":"))
print("ok, героев:", len(st), "дата:", out["date"])
