// pv-demo · vanilla JS · talks to https://api.pvlmtd.com
// No deps, no build. ES2020 features used: async/await, optional chaining.

const API_BASE = "https://api.pvlmtd.com";
const PROBE_INTERVAL_MS = 5000;
const SPARK_MAX_POINTS = 60;

// ---------- DOM refs ----------
const $dot       = document.getElementById("hc-dot");
const $state     = document.getElementById("hc-state");
const $db        = document.getElementById("hc-db");
const $redis     = document.getElementById("hc-redis");
const $ms        = document.getElementById("hc-ms");
const $count     = document.getElementById("hc-count");
const $sparkLine = document.getElementById("spark-line");
const $burstBtn  = document.getElementById("burst-btn");
const $burstOut  = document.getElementById("burst-out");

// ---------- healthcheck loop ----------
const latencyBuffer = [];
let probeCount = 0;

async function probeOnce() {
  const t0 = performance.now();
  let body = null;
  let httpOk = false;

  try {
    const res = await fetch(`${API_BASE}/healthz`, { cache: "no-store" });
    httpOk = res.ok;
    if (httpOk) body = await res.json();
  } catch {
    // network error or CORS rejection — treat as down
  }

  const dtMs = Math.round(performance.now() - t0);
  probeCount++;

  // Ring buffer for sparkline
  latencyBuffer.push(httpOk ? dtMs : null);
  if (latencyBuffer.length > SPARK_MAX_POINTS) latencyBuffer.shift();

  paintHealth({ httpOk, body, dtMs });
  paintSparkline();
}

function paintHealth({ httpOk, body, dtMs }) {
  if (!httpOk) {
    $dot.dataset.state = "down";
    $state.textContent = "unreachable";
    $db.textContent = "·";
    $redis.textContent = "·";
    $ms.textContent = `— ms`;
    $count.textContent = String(probeCount);
    return;
  }

  // body looks like {"status":"ok","db":"ok","redis":"ok"}
  const allOk = body?.status === "ok" && body?.db === "ok" && body?.redis === "ok";
  $dot.dataset.state = allOk ? "ok" : "degraded";
  $state.textContent = allOk ? "ok" : "degraded";
  $db.textContent    = body?.db    ?? "?";
  $redis.textContent = body?.redis ?? "?";
  $ms.textContent    = `${dtMs} ms`;
  $count.textContent = String(probeCount);
}

function paintSparkline() {
  // Map values to viewBox 600×60. Skip nulls (drawn as gaps).
  const vals = latencyBuffer;
  if (vals.length === 0) {
    $sparkLine.setAttribute("points", "");
    return;
  }
  const finite = vals.filter((v) => v != null);
  if (finite.length === 0) {
    $sparkLine.setAttribute("points", "");
    return;
  }
  const max = Math.max(...finite, 50); // floor of 50ms so a flat 10ms line still shows shape
  const stepX = 600 / Math.max(SPARK_MAX_POINTS - 1, 1);

  const points = vals
    .map((v, i) => {
      if (v == null) return null;
      const x = i * stepX;
      const y = 58 - (v / max) * 54; // pad 2px top/bottom
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");

  $sparkLine.setAttribute("points", points);
}

// Kick off + loop
probeOnce();
setInterval(probeOnce, PROBE_INTERVAL_MS);

// ---------- burst test ----------
$burstBtn.addEventListener("click", async () => {
  $burstBtn.disabled = true;
  $burstBtn.textContent = "running…";
  $burstOut.innerHTML = "";

  const N = 50;
  const tasks = Array.from({ length: N }, () =>
    fetch(`${API_BASE}/healthz`, { cache: "no-store" })
      .then((r) => r.status)
      .catch(() => 0) // 0 = network/CORS error
  );
  const codes = await Promise.all(tasks);

  const histogram = codes.reduce((acc, c) => {
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});

  paintHistogram(histogram, N);

  $burstBtn.disabled = false;
  $burstBtn.textContent = "Run 50-burst";
});

function paintHistogram(hist, total) {
  const sortedCodes = Object.keys(hist).sort((a, b) => Number(a) - Number(b));
  const max = Math.max(...Object.values(hist));

  $burstOut.innerHTML = sortedCodes
    .map((code) => {
      const n = hist[code];
      const pct = (n / max) * 100;
      const label = code === "0" ? "ERR" : code;
      return `<div class="bar-row" data-code="${code}">
        <span>${label}</span>
        <div class="bar" style="width:${pct.toFixed(1)}%"></div>
        <span style="text-align:right">${n}</span>
      </div>`;
    })
    .join("");
}
