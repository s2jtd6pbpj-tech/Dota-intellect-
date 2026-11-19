import json, sys, time, urllib.request

URL = "https://api.opendota.com/api/heroStats"
req = urllib.request.Request(URL, headers={"User-Agent": "dota-intellect"})
rows = json.load(urllib.request.urlopen(req, timeout=60))

need = ["id", "pro_pick", "pro_win", "pro_ban"] + \
       ["%d_%s" % (b, k) for b in range(1, 9) for k in ("pick", "win")]
miss = [k for k in need if k not in rows[0]]
if miss:
    print("нет полей:", miss)
    sys.exit(1)

st, pr = {}, {}
for r in rows:
    h = str(r["id"])
    st[h] = [r.get("%d_%s" % (b, k)) or 0
             for b in range(1, 9) for k in ("pick", "win")]
    pr[h] = [r.get("pro_pick") or 0, r.get("pro_win") or 0,
             r.get("pro_ban") or 0]

if len(st) < 120:
    print("слишком мало героев:", len(st))
    sys.exit(1)

out = {"date": time.strftime("%Y-%m-%d"), "st": st, "pr": pr}
json.dump(out, open("heroes.json", "w"), separators=(",", ":"))
print("ok, героев:", len(st), "дата:", out["date"])
