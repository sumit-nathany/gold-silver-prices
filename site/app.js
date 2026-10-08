const REPO_RAW_BASE = "https://raw.githubusercontent.com/sumit-nathany/gold-silver-prices/main/data";
const START_YEAR = 2026;

let allRows = [];
let chart = null;

async function fetchYearCsv(year) {
  const url = `${REPO_RAW_BASE}/${year}.csv`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  return parseCsv(text);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

function toNum(v) {
  return v === "" || v === undefined ? null : Number(v);
}

async function loadAllData() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = START_YEAR; y <= currentYear; y++) years.push(y);

  const results = await Promise.all(years.map(fetchYearCsv));
  allRows = results
    .flat()
    .map((r) => ({
      date: r.date,
      gold: toNum(r.gold_999_pm),
      silver: toNum(r.silver_999_pm),
      reason: r.reason || "",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatInr(n) {
  if (n === null) return "—";
  return n.toLocaleString("en-IN");
}

function renderCards() {
  const tradingRows = allRows.filter((r) => r.gold !== null);
  const cardsEl = document.getElementById("cards");
  if (tradingRows.length === 0) {
    cardsEl.innerHTML = '<div class="card">No data available</div>';
    return;
  }

  const latest = tradingRows[tradingRows.length - 1];
  const prev = tradingRows.length > 1 ? tradingRows[tradingRows.length - 2] : null;

  const makeCard = (label, value, prevValue, unit) => {
    let deltaHtml = "";
    if (prev && prevValue !== null && value !== null) {
      const diff = value - prevValue;
      const pct = ((diff / prevValue) * 100).toFixed(2);
      const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
      deltaHtml = `<div class="delta ${cls}">${arrow} ${Math.abs(pct)}% vs prev</div>`;
    }
    return `
      <div class="card">
        <div class="label">${label}</div>
        <div class="value">₹${formatInr(value)}</div>
        <div class="unit">${unit}</div>
        ${deltaHtml}
      </div>`;
  };

  cardsEl.innerHTML = [
    makeCard(`Gold 999 (${latest.date})`, latest.gold, prev?.gold, "per 10g"),
    makeCard(`Silver 999 (${latest.date})`, latest.silver, prev?.silver, "per kg"),
  ].join("");
}

function filterByRange(rows, rangeValue) {
  if (rangeValue === "all") return rows;
  const days = Number(rangeValue);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return rows.filter((r) => r.date >= cutoffStr);
}

function pctChangeSeries(values) {
  const base = values.find((v) => v !== null);
  if (base === undefined || base === null) return values.map(() => null);
  return values.map((v) => (v === null ? null : ((v - base) / base) * 100));
}

function renderChart() {
  const metal = document.getElementById("metal").value;
  const range = document.getElementById("range").value;

  const ctx = document.getElementById("priceChart").getContext("2d");
  if (chart) chart.destroy();

  if (metal === "both") {
    const rows = filterByRange(allRows, range).filter((r) => r.gold !== null && r.silver !== null);
    const labels = rows.map((r) => r.date);
    const goldPct = pctChangeSeries(rows.map((r) => r.gold));
    const silverPct = pctChangeSeries(rows.map((r) => r.silver));

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Gold 999",
            data: goldPct,
            borderColor: "#d4af37",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
          },
          {
            label: "Silver 999",
            data: silverPct,
            borderColor: "#8a8f99",
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: "var(--text-dim)", maxTicksLimit: 8 }, grid: { color: "var(--border)" } },
          y: {
            ticks: {
              color: "var(--text-dim)",
              callback: (v) => `${v > 0 ? "+" : ""}${v}%`,
            },
            grid: { color: "var(--border)" },
          },
        },
        plugins: {
          legend: { labels: { color: "var(--text)" } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y > 0 ? "+" : ""}${ctx.parsed.y.toFixed(2)}%`,
            },
          },
        },
      },
    });
  } else {
    const rows = filterByRange(allRows, range).filter((r) => r[metal] !== null);
    const labels = rows.map((r) => r.date);
    const data = rows.map((r) => r[metal]);
    const color = metal === "gold" ? "#d4af37" : "#8a8f99";

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: metal === "gold" ? "Gold 999" : "Silver 999",
            data,
            borderColor: color,
            backgroundColor: "transparent",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: "var(--text-dim)", maxTicksLimit: 8 }, grid: { color: "var(--border)" } },
          y: { ticks: { color: "var(--text-dim)" }, grid: { color: "var(--border)" } },
        },
        plugins: {
          legend: { labels: { color: "var(--text)" } },
        },
      },
    });
  }
  applyChartTheme();
}

function renderTable() {
  const tbody = document.querySelector("#ratesTable tbody");
  const rowsDesc = [...allRows].reverse();
  tbody.innerHTML = rowsDesc
    .map((r) => {
      const isNonTrading = r.gold === null && r.silver === null;
      if (isNonTrading) {
        return `<tr class="non-trading">
          <td>${r.date}</td>
          <td colspan="2">${r.reason}</td>
        </tr>`;
      }
      const note = r.reason ? ` title="${r.reason}"` : "";
      return `<tr${note}>
        <td>${r.date}</td>
        <td>${formatInr(r.gold)}</td>
        <td>${formatInr(r.silver)}${r.reason ? " *" : ""}</td>
      </tr>`;
    })
    .join("");
}

function getStoredTheme() {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* ignore */
  }
}

function applyChartTheme() {
  if (!chart) return;
  const styles = getComputedStyle(document.documentElement);
  const textDim = styles.getPropertyValue("--text-dim").trim();
  const border = styles.getPropertyValue("--border").trim();
  const text = styles.getPropertyValue("--text").trim();
  chart.options.scales.x.ticks.color = textDim;
  chart.options.scales.x.grid.color = border;
  chart.options.scales.y.ticks.color = textDim;
  chart.options.scales.y.grid.color = border;
  chart.options.plugins.legend.labels.color = text;
  chart.update();
}

function setTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  document.getElementById("themeToggle").textContent = theme === "light" ? "☀️" : "🌙";
  storeTheme(theme);
  applyChartTheme();
}

function initTheme() {
  const stored = getStoredTheme();
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const initial = stored || (prefersLight ? "light" : "dark");
  setTheme(initial);

  document.getElementById("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    setTheme(current === "light" ? "dark" : "light");
  });
}

async function init() {
  initTheme();
  await loadAllData();
  renderCards();
  renderChart();
  renderTable();

  document.getElementById("metal").addEventListener("change", renderChart);
  document.getElementById("range").addEventListener("change", renderChart);
}

init().catch((err) => {
  document.getElementById("cards").innerHTML = `<div class="card">Failed to load data: ${err.message}</div>`;
  console.error(err);
});
