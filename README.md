# pv-demo

Live, browser-based demo for the **PV OS** stack — a single-page vanilla
HTML + JS app that talks to the production API at `api.pvlmtd.com` and
shows it's alive in real time.

No build step, no dependencies, no framework. Open `index.html` and it
works.

## What it does

- **Live `/healthz` widget** — auto-refresh every 5s, status + latency.
- **Latency sparkline** — last 60 probes as inline SVG.
- **Rate-limit burst test** — fires 50 parallel requests, shows the
  response-code histogram (you'll see `200` flip to `429` once slowapi's
  60/min/IP limit kicks in).
- **Brand footer** — links to repo + Sentry release info.

## Hosting

Static page deployed to **GitHub Pages** on every push to `main` via
`.github/workflows/pages.yml`. URL after the first deploy:

  https://pvceowner-ops.github.io/pv-demo

(Optional: CNAME `demo.pvlmtd.com` if the DNS gods cooperate one day.)

## Development

```bash
# Just open it
python -m http.server 8080  # or any static server
# → http://localhost:8080
```

The page hits `https://api.pvlmtd.com/healthz` directly. For the browser
to read the response, the API must include the demo's origin in its
`PV_CORS_ALLOWED_ORIGINS` (slowapi + FastAPI CORSMiddleware in pv-api).
Currently allowed:

- `https://pvceowner-ops.github.io`
- `http://localhost:8080` (for `python -m http.server`)
- `http://127.0.0.1:5500` (VS Code Live Server)

## Why vanilla

`pv-os` already has a Python+TypeScript-shaped surface area in pv-api +
pv-console. The demo is intentionally orthogonal — zero dependencies,
zero supply chain, runs forever. If the world ends and Node 24 is gone,
this still opens.
