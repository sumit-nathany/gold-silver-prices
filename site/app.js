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
  const lines = text.trim().split("\n");
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
      gold_am: toNum(r.gold_999_am),
      gold_pm: toNum(r.gold_999_pm),
      silver_am: toNum(r.silver_999_am),
      silver_pm: toNum(r.silver_999_pm),
      reason: r.reason || "",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatInr(n) {
  if (n === null) return "—";
  return n.toLocaleString("en-IN");
}

function renderCards() {
  const tradingRows = allRows.filter((r) => r.gold_pm !== null);
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
    makeCard(`Gold 999 PM (${latest.date})`, latest.gold_pm, prev?.gold_pm, "per 10g"),
    makeCard(`Gold 999 AM (${latest.date})`, latest.gold_am, prev?.gold_am, "per 10g"),
    makeCard(`Silver 999 PM (${latest.date})`, latest.silver_pm, prev?.silver_pm, "per kg"),
    makeCard(`Silver 999 AM (${latest.date})`, latest.silver_am, prev?.silver_am, "per kg"),
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

function renderChart() {
  const metal = document.getElementById("metal").value;
  const range = document.getElementById("range").value;
  const rows = filterByRange(allRows, range).filter((r) => r[`${metal}_pm`] !== null);

  const labels = rows.map((r) => r.date);
  const amData = rows.map((r) => r[`${metal}_am`]);
  const pmData = rows.map((r) => r[`${metal}_pm`]);
  const color = metal === "gold" ? "#d4af37" : "#c0c0c8";

  const ctx = document.getElementById("priceChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "AM",
          data: amData,
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0,
        },
        {
          label: "PM",
          data: pmData,
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
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#9a9ea8", maxTicksLimit: 10 }, grid: { color: "#2a2e38" } },
        y: { ticks: { color: "#9a9ea8" }, grid: { color: "#2a2e38" } },
      },
      plugins: {
        legend: { labels: { color: "#e8e8ea" } },
      },
    },
  });
}

function renderTable() {
  const tbody = document.querySelector("#ratesTable tbody");
  const rowsDesc = [...allRows].reverse();
  tbody.innerHTML = rowsDesc
    .map((r) => {
      const isNonTrading = r.gold_am === null && r.gold_pm === null;
      if (isNonTrading) {
        return `<tr class="non-trading">
          <td>${r.date}</td>
          <td colspan="4">${r.reason}</td>
        </tr>`;
      }
      const note = r.reason ? ` title="${r.reason}"` : "";
      return `<tr${note}>
        <td>${r.date}</td>
        <td>${formatInr(r.gold_am)}</td>
        <td>${formatInr(r.gold_pm)}</td>
        <td>${formatInr(r.silver_am)}</td>
        <td>${formatInr(r.silver_pm)}${r.reason ? " *" : ""}</td>
      </tr>`;
    })
    .join("");
}

async function init() {
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
