import calendar, json, os, sys, time, urllib.request

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
    r = get_json("https://api.stratz.com/graphql",
                 json.dumps({"query": query}).encode(),
                 {"Content-Type": "application/json",
                  "Authorization": "Bearer " + TOK,
                  "User-Agent": "STRATZ_API"})
    if r.get("errors"):
        raise RuntimeError(r["errors"][0].get("message"))
    return r["data"]


def stratz():
    start = calendar.timegm(time.strptime(PATCH_START, "%Y-%m-%d"))
    take = max(2, int((time.time() - start) // 86400) + 2)
    enum = gql('{__type(name:"RankBracket"){enumValues{name}}}')
    vals = [v["name"] for v in enum["__type"]["enumValues"]]
    idx = {}
    for v in vals:
        for i, k in enumerate(RANKS):
            if k in v and "_" not in v:
                idx[v] = i
    if len(set(idx.values())) != 8:
        raise RuntimeError("не нашёл все 8 рангов в RankBracket: %s" % vals)
    days = {}  # день -> герой -> 16 чисел
    seen = set()
    for name, i in idx.items():
        d = gql('{heroStats{winDay(take:%d,bracketIds:[%s],'
                'gameModeIds:[ALL_PICK_RANKED,ALL_PICK])'
                '{day heroId matchCount winCount}}}' % (take, name))
        for r in d["heroStats"]["winDay"] or []:
            day = int(r["day"])
            if day > 10 ** 11:
                day //= 1000
            seen.add(day)
            if day < start:
                continue
            a = days.setdefault(day, {}).setdefault(str(r["heroId"]),
                                                     [0] * 16)
            a[i * 2] += r["matchCount"]
            a[i * 2 + 1] += r["winCount"]
        time.sleep(1.2)
    if not days:
        raise RuntimeError("нет данных с %s; STRATZ вернул дни: %s" % (
            PATCH_START, ", ".join(time.strftime("%Y-%m-%d %H:%M", time.gmtime(x))
                                   for x in sorted(seen)[-4:]) or "ни одного"))
    patch = {}
    for dd in days.values():
        for h, a in dd.items():
            p = patch.setdefault(h, [0] * 16)
            for j in range(16):
                p[j] += a[j]
    last = max(days)
    out["patch"] = {"name": PATCH, "since": PATCH_START, "st": patch,
                    "days": len(days)}
    out["day"] = {"date": time.strftime("%Y-%m-%d", time.gmtime(last)),
                  "st": days[last]}
    tot = sum(sum(a[8:16:2]) for a in patch.values())
    print("STRATZ: дней", len(days), "героев", len(patch),
          "игр Legend+ (героо-игр)", tot)


if TOK:
    try:
        stratz()
    except Exception as e:
        out["stratz_error"] = str(e)[:300]
        print("STRATZ: ошибка:", e)
else:
    out["stratz_error"] = "нет STRATZ_TOKEN"
    print("STRATZ: нет токена, пропускаю")

json.dump(out, open("heroes.json", "w"), separators=(",", ":"))
print("ok, героев:", len(st), "дата:", out["date"])
