import time
import asyncio
from collections import defaultdict, deque
from contextlib import asynccontextmanager

import aiohttp
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

BINANCE_REST = "https://api.binance.com"
USDT = "USDT"

TIMEFRAMES = {
    "1m": 60,
    "3m": 3 * 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "12h": 12 * 60 * 60,
    "1d": 24 * 60 * 60,
}

prices: dict[str, float] = {}
rsi_cache: dict[str, dict[str, float]] = defaultdict(dict)
closes = defaultdict(lambda: defaultdict(lambda: deque(maxlen=480)))
volumes = defaultdict(lambda: defaultdict(lambda: deque(maxlen=480)))

symbols_top25: list[str] = []


async def fetch_json(session: aiohttp.ClientSession, url: str, params=None):
    for _ in range(3):
        try:
            async with session.get(url, params=params, timeout=10) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            await asyncio.sleep(0.5)
    return None


async def load_top25_symbols():
    global symbols_top25
    url = f"{BINANCE_REST}/api/v3/ticker/24hr"
    print(f"Loading top‑25 from {url}")
    async with aiohttp.ClientSession() as session:
        data = await fetch_json(session, url)
        if not data:
            print("❌ Binance /ticker/24hr failed, using fallback")
            symbols_top25 = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"]
            return
        print(f"✅ Loaded {len(data)} tickers")
        usdt = [d for d in data if d["symbol"].endswith(USDT)]
        usdt.sort(key=lambda x: float(x["quoteVolume"]), reverse=True)
        symbols_top25 = [d["symbol"] for d in usdt[:25]]
        print(f"✅ Top‑25: {symbols_top25[:3]}...")


def calc_rsi(symbol: str, tf: str):
    vals = list(closes[symbol][tf])
    rsi = rsi_numpy(vals, period=14)
    if rsi is not None:
        rsi_cache[symbol][tf] = rsi

def rsi_numpy(values: list[float], period: int = 14) -> float | None:
    if len(values) < period + 1:
        return None
    import numpy as np
    arr = np.array(values, dtype=float)
    deltas = np.diff(arr)

    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])

    if avg_loss == 0:
        return 100.0

    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return float(rsi)


async def prefill_history():
    print("Prefill history…")
    async with aiohttp.ClientSession() as session:
        for sym in symbols_top25:
            for tf in TIMEFRAMES:
                url = f"{BINANCE_REST}/api/v3/klines"
                params = {"symbol": sym, "interval": tf, "limit": 480}
                data = await fetch_json(session, url, params)
                if not data:
                    continue
                cq = closes[sym][tf]
                vq = volumes[sym][tf]
                cq.clear()
                vq.clear()
                for k in data:
                    cq.append(float(k[4]))  # close [web:277]
                    vq.append(float(k[5]))  # volume [web:277]
                calc_rsi(sym, tf)
                await asyncio.sleep(0.04)
    print("Prefill done")


async def updater_loop():
    last_tick = {tf: 0.0 for tf in TIMEFRAMES}
    url = f"{BINANCE_REST}/api/v3/ticker/price"

    async with aiohttp.ClientSession() as session:
        while True:
            now = time.time()
            ready = [
                tf for tf, sec in TIMEFRAMES.items()
                if now - last_tick[tf] >= sec
            ]
            if ready:
                for tf in ready:
                    last_tick[tf] = now

            tickers = await fetch_json(session, url)
            if tickers:
                mp = {d["symbol"]: float(d["price"]) for d in tickers}
                for sym in symbols_top25:
                    if sym not in mp:
                        continue
                    price = mp[sym]
                    prices[sym] = price
                    for tf in ready:
                        closes[sym][tf].append(price)
                        last_vol = volumes[sym][tf][-1] if volumes[sym][tf] else 0.0
                        volumes[sym][tf].append(last_vol)
                        calc_rsi(sym, tf)
            await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await load_top25_symbols()
    await prefill_history()
    task = asyncio.create_task(updater_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok", 
        "symbols": len(symbols_top25),
        "sample": symbols_top25[:3] if symbols_top25 else []
    }



@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            payload = {
                "symbols": symbols_top25,
                "prices": prices,
                "rsi": rsi_cache,
                "closes": {
                    sym: {tf: list(closes[sym][tf]) for tf in TIMEFRAMES}
                    for sym in symbols_top25
                },
                "volumes": {
                    sym: {tf: list(volumes[sym][tf]) for tf in TIMEFRAMES}
                    for sym in symbols_top25
                },
            }
            await ws.send_json(payload)
            await asyncio.sleep(1)
    except Exception:
        pass
