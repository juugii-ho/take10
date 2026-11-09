#!/usr/bin/env python3
"""Record TAKE10 for the demo video. usage: record.py OUTDIR live|film [run_id] [take_n]"""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright
OUT, MODE = sys.argv[1], sys.argv[2]; RID = sys.argv[3] if len(sys.argv) > 3 else None; TN = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True); t0 = time.time(); ev = []; fr = []; stop = False
def mark(e): ev.append({"t": round(time.time() - t0, 2), "e": e}); print(f"[{time.time()-t0:6.1f}] {e}", flush=True)
async def grab(pg):
    i = 0
    while not stop:
        try:
            b = await pg.screenshot(type="jpeg", quality=88); open(f"{OUT}/f_{i:06d}.jpg", "wb").write(b); fr.append({"i": i, "t": round(time.time() - t0, 3)}); i += 1
        except Exception: pass
        await asyncio.sleep(0.04)
async def main():
    global stop
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args=["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = await br.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1.5)
        if MODE == "live":
            await pg.goto("http://localhost:8795/"); await pg.wait_for_timeout(2500)
            g = asyncio.create_task(grab(pg)); mark("idle"); await pg.wait_for_timeout(2500)
            await pg.locator("#run").click(); mark("run")
            dl = time.time() + 420; seen = set()
            while time.time() < dl:
                st = await pg.evaluate("document.getElementById('status').innerText")
                k = st[:6]
                if k not in seen: seen.add(k); mark("status:" + st[:30])
                if st.startswith("완료"): break
                await asyncio.sleep(1)
            mark("done"); await pg.wait_for_timeout(2000)
            cards = pg.locator(".take")
            for i in range(min(2, await cards.count())):
                await cards.nth(i).click(); mark(f"card:{i}"); await pg.wait_for_timeout(2500)
            await pg.locator(".take.best").first.click(); mark("best"); await pg.wait_for_timeout(3000)
        else:
            await pg.goto(f"http://localhost:8795/?run={RID}"); await pg.wait_for_timeout(4000)
            await pg.locator(f".take[data-n='{TN}']").click(); await pg.wait_for_timeout(1500)
            await pg.locator("#film").scroll_into_view_if_needed(); await pg.wait_for_timeout(1500)
            g = asyncio.create_task(grab(pg)); mark("film")
            for s in ["wide", "closeup", "ots", "top", "wide"]:
                await pg.locator(f"#shots [data-s='{s}']").click(); mark(f"shot:{s}"); await pg.wait_for_timeout(5500)
        stop = True; await g; await br.close()
    json.dump(ev, open(f"{OUT}/events.json", "w"), ensure_ascii=False, indent=1); json.dump(fr, open(f"{OUT}/frames.json", "w")); print("frames", len(fr))
asyncio.run(main())
