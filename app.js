// pv-demo · vanilla JS · talks to https://api.pvlmtd.com
// No deps, no build. ES2020 features used: async/await, optional chaining.

const API_BASE = "https://api.pvlmtd.com";
const PROBE_INTERVAL_MS = 5000;
const SPARK_MAX_POINTS = 60;
// slowapi cap on the API side; client-side counter mirrors it for UX feedback.
const API_RATE_LIMIT_PER_MIN = 60;

// ---------- DOM refs ----------
const $dot       = document.getElementById("hc-dot");
const $state     = document.getElementById("hc-state");
const $db        = document.getElementById("hc-db");
const $redis     = document.getElementById("hc-redis");
const $ms        = document.getElementById("hc-ms");
const $count     = document.getElementById("hc-count");
const $sparkLine = document.getElementById("spark-line");
const $version   = document.getElementById("hc-version");
const $burstBtn  = document.getElementById("burst-btn");
const $burstOut  = document.getElementById("burst-out");
const $uptime    = document.getElementById("stat-uptime");
const $uptimeSub = document.getElementById("stat-uptime-sub");
const $budget    = document.getElementById("stat-budget-used");
const $budgetFill = document.getElementById("stat-budget-fill");

// ---------- state ----------
const latencyBuffer = [];                // ring of last SPARK_MAX_POINTS values (null = failed probe)
const requestTimestamps = [];            // unbounded; pruned to last 60s on each tick
let probeCount = 0;
let currentVersion = null;

// ---------- healthcheck loop ----------
async function probeOnce() {
  const t0 = performance.now();
  let body = null;
  let httpOk = false;

  // Track this request's timestamp for the budget meter (every fetch counts —
  // probe + burst alike, mirroring how slowapi sees us).
  trackRequest();

  try {
    const res = await fetch(`${API_BASE}/healthz`, { cache: "no-store" });
    httpOk = res.ok;
    if (httpOk) body = await res.json();
  } catch {
    // network error or CORS rejection — treat as down
  }

  const dtMs = Math.round(performance.now() - t0);
  probeCount++;

  // Ring buffer for sparkline + uptime.
  latencyBuffer.push(httpOk ? dtMs : null);
  if (latencyBuffer.length > SPARK_MAX_POINTS) latencyBuffer.shift();

  paintHealth({ httpOk, body, dtMs });
  paintSparkline();
  paintStats();
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

  // body shape (post PR #34): {status, db, redis, version}
  const allOk = body?.status === "ok" && body?.db === "ok" && body?.redis === "ok";
  $dot.dataset.state = allOk ? "ok" : "degraded";
  $state.textContent = allOk ? "ok" : "degraded";
  $db.textContent    = body?.db    ?? "?";
  $redis.textContent = body?.redis ?? "?";
  $ms.textContent    = `${dtMs} ms`;
  $count.textContent = String(probeCount);

  if (body?.version && body.version !== currentVersion) {
    currentVersion = body.version;
    $version.textContent = currentVersion;
  } else if (!currentVersion && body?.version) {
    currentVersion = body.version;
    $version.textContent = currentVersion;
  }
}

function paintSparkline() {
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

// ---------- stats: uptime % + request budget ----------
function paintStats() {
  // uptime: fraction of probes in latencyBuffer that succeeded
  const total = latencyBuffer.length;
  if (total === 0) {
    $uptime.innerHTML = `— <span class="stat-unit">%</span>`;
    $uptimeSub.textContent = `of last 0 probes`;
  } else {
    const ok = latencyBuffer.filter((v) => v != null).length;
    const pct = (ok / total) * 100;
    const display = pct === 100 ? "100" : pct.toFixed(1);
    $uptime.innerHTML = `${display} <span class="stat-unit">%</span>`;
    $uptimeSub.textContent = `${ok}/${total} probes ok`;
  }

  paintBudget();
}

function paintBudget() {
  // budget: number of fetches initiated in the last 60 seconds
  pruneOldTimestamps();
  const used = requestTimestamps.length;
  const pct = Math.min(100, (used / API_RATE_LIMIT_PER_MIN) * 100);
  $budget.textContent = String(used);
  $budgetFill.style.width = `${pct.toFixed(1)}%`;
  $budgetFill.dataset.state =
    pct < 60 ? "ok" : pct < 90 ? "warn" : "bad";
}

function trackRequest() {
  requestTimestamps.push(Date.now());
  pruneOldTimestamps();
}

function pruneOldTimestamps() {
  const cutoff = Date.now() - 60_000;
  while (requestTimestamps.length && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

// Refresh budget meter on a faster cadence than probes (so you watch it
// drain when burst test fires; otherwise paintStats only runs every 5s).
setInterval(paintBudget, 1000);

// ---------- click-to-copy version ----------
$version.addEventListener("click", async () => {
  if (!currentVersion) return;
  try {
    await navigator.clipboard.writeText(currentVersion);
    const original = $version.textContent;
    $version.textContent = "copied!";
    setTimeout(() => { $version.textContent = original; }, 900);
  } catch {
    // clipboard blocked (e.g. http context) — silently ignore
  }
});

// ---------- burst test ----------
$burstBtn.addEventListener("click", async () => {
  $burstBtn.disabled = true;
  $burstBtn.textContent = "running…";
  $burstOut.innerHTML = "";

  const N = 50;
  const tasks = Array.from({ length: N }, () => {
    trackRequest();
    return fetch(`${API_BASE}/healthz`, { cache: "no-store" })
      .then((r) => r.status)
      .catch(() => 0);
  });
  const codes = await Promise.all(tasks);

  const histogram = codes.reduce((acc, c) => {
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});

  paintHistogram(histogram, N);
  paintBudget();

  $burstBtn.disabled = false;
  $burstBtn.textContent = "Run 50-burst";
});

function paintHistogram(hist, _total) {
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

// Kick off + loop
probeOnce();
setInterval(probeOnce, PROBE_INTERVAL_MS);
