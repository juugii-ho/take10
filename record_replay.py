import asyncio, json, os, sys, time
from playwright.async_api import async_playwright
OUT, RID = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True); t0 = time.time(); ev = []; fr = []; stop = False
def mark(e): ev.append({"t": round(time.time() - t0, 2), "e": e}); print(f"[{time.time()-t0:6.1f}] {e}", flush=True)
async def grab(pg):
    i = 0
    while not stop:
        b = await pg.screenshot(type="jpeg", quality=88); open(f"{OUT}/f_{i:06d}.jpg", "wb").write(b); fr.append({"i": i, "t": round(time.time() - t0, 3)}); i += 1
        await asyncio.sleep(0.03)
async def main():
    global stop
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        pg = await br.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1.5)
        await pg.goto(f"http://localhost:8795/?run={RID}"); await pg.wait_for_timeout(3000)
        await pg.evaluate("window.scrollTo(0, 340)"); g = asyncio.create_task(grab(pg)); mark("takes"); await pg.wait_for_timeout(10000)
        for i in [0, 2, 1]:
            await pg.locator(".take").nth(i).click(); mark(f"card:{i}"); await pg.wait_for_timeout(2600)
        await pg.evaluate("document.getElementById('stagecv').scrollIntoView({block:'center'})"); mark("stage"); await pg.wait_for_timeout(13000)
        stop = True; await g; await br.close()
    json.dump(ev, open(f"{OUT}/events.json", "w")); json.dump(fr, open(f"{OUT}/frames.json", "w")); print("frames", len(fr))
asyncio.run(main())
