const container = document.getElementById("map-container");
const svg = d3.select("#map");
const tooltip = d3.select("#tooltip");

function size() {
  const r = container.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

function norm(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function fmtMoney(mGBP) {
  if (!Number.isFinite(mGBP)) return "No data";
  const abs = Math.abs(mGBP);
  if (abs >= 1000) return `£${(mGBP / 1000).toFixed(2)}bn`;
  return `£${mGBP.toFixed(1)}m`;
}

Promise.all([
  d3.json("data/la_boundaries_simplified.geojson"),
  d3.csv("data/la_values_total.csv")
]).then(([geo, rows]) => {
  // Remove extreme outlier geometries that break fitSize
const overall = d3.geoBounds(geo);
const overallW = Math.abs(overall[1][0] - overall[0][0]);
const overallH = Math.abs(overall[1][1] - overall[0][1]);

geo.features = geo.features.filter(f => {
  const b = d3.geoBounds(f);
  const w = Math.abs(b[1][0] - b[0][0]);
  const h = Math.abs(b[1][1] - b[0][1]);

  // If one feature spans most of the whole dataset bounds, it's suspicious
  const tooWide = w > overallW * 0.8;
  const tooHigh = h > overallH * 0.8;

  return !(tooWide && tooHigh);
});

  const { width, height } = size();
  svg.attr("viewBox", [0, 0, width, height]);

  // Detect CSV columns
  const csvCols = rows.length ? Object.keys(rows[0]) : [];
  const laColCsv =
    csvCols.find(c => norm(c) === "local_authority") ||
    csvCols.find(c => norm(c).includes("authority")) ||
    csvCols.find(c => norm(c).includes("lad") && norm(c).includes("name")) ||
    csvCols[0];

  const valColCsv =
    csvCols.find(c => norm(c) === "total_value_mgbp") ||
    csvCols.find(c => norm(c).includes("total") && norm(c).includes("mgbp")) ||
    csvCols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
    csvCols.find(c => norm(c).includes("total_value")) ||
    csvCols.find(c => norm(c).includes("value")) ||
    csvCols[1];

  // Detect GeoJSON name property
  const propKeys = Object.keys(geo.features?.[0]?.properties || {});
  const laProp =
    propKeys.find(k => norm(k) === "local_authority") ||
    propKeys.find(k => norm(k).includes("authority")) ||
    propKeys.find(k => norm(k).includes("lad") && norm(k).includes("name")) ||
    propKeys[0];

  // Build value lookup
  const valueByLA = new Map();
  for (const r of rows) {
    const name = String(r[laColCsv] ?? "").trim();
    const v = Number(String(r[valColCsv] ?? "").replaceAll(",", ""));
    if (name) valueByLA.set(name, v);
  }

  // Match values for scale
  const vals = [];
  let matched = 0;
  for (const f of geo.features) {
    const name = String(f.properties[laProp] ?? "").trim();
    const v = valueByLA.get(name);
    if (Number.isFinite(v)) {
      vals.push(v);
      matched++;
    }
  }

  console.log("Detected csv LA:", laColCsv, "value:", valColCsv);
  console.log("Detected geo LA prop:", laProp);
  console.log("Matched:", matched, "/", geo.features.length);

  // Color: quantile for contrast
  const color = d3.scaleQuantile()
    .domain(vals)
    .range(d3.schemeYlGnBu[9]);

  // AUTO DETECT COORD SYSTEM (EPSG:27700 vs lonlat)
  const b = d3.geoBounds(geo);
  const maxAbs = Math.max(
    Math.abs(b[0][0]), Math.abs(b[0][1]),
    Math.abs(b[1][0]), Math.abs(b[1][1])
  );

  const projection = (maxAbs > 180)
    ? d3.geoIdentity().reflectY(true).fitSize([width, height], geo)
    : d3.geoMercator().fitSize([width, height], geo);

  const path = d3.geoPath(projection);

  svg.selectAll("*").remove();
  const g = svg.append("g");

  // Draw LA shapes (map UK silhouette otomatis terbentuk)
  g.selectAll("path")
    .data(geo.features)
    .join("path")
    .attr("class", "area")
    .attr("d", path)
    .attr("fill", d => {
      const name = String(d.properties[laProp] ?? "").trim();
      const v = valueByLA.get(name);
      return Number.isFinite(v) ? color(v) : "#1a1f2b";
    })
    .attr("stroke", "rgba(0,0,0,0.35)")
    .attr("stroke-width", 0.6)
    .on("mousemove", (event, d) => {
        // ambil data persis seperti kode kamu sebelumnya
        const name = String(d.properties[laProp] ?? "").trim();
        const v = valueByLA.get(name);

        // posisi tooltip relative ke map-container (biar tidak geser ke kanan)
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const OFFSET_X = 12;
        const OFFSET_Y = 16;

        tooltip
            .style("opacity", 1)
            .style("left", `${x + OFFSET_X}px`)
            .style("top", `${y - OFFSET_Y}px`)
            .html(`<strong>${name || "Unknown"}</strong><br/>Economic value: ${fmtMoney(v)}`);
        })
        .on("mouseleave", () => tooltip.style("opacity", 0));

  // Optional: zoom + pan (biar enak explore)
  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => g.attr("transform", event.transform));

  svg.call(zoom);

  // Responsive redraw
  window.addEventListener("resize", () => {
    const { width, height } = size();
    svg.attr("viewBox", [0, 0, width, height]);

    const proj = (maxAbs > 180)
      ? d3.geoIdentity().reflectY(true).fitSize([width, height], geo)
      : d3.geoMercator().fitSize([width, height], geo);

    const p = d3.geoPath(proj);
    g.selectAll("path").attr("d", p);
  });
});

renderScene2();

function renderScene2() {
  const container2 = document.getElementById("comp-container");
  const svg2 = d3.select("#comp");
  const noteEl = document.getElementById("comp-note");

  function s2Size() {
    const r = container2.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  function norm(s) {
    return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function fmtMoney(mGBP) {
    if (!Number.isFinite(mGBP)) return "£0m";
    const abs = Math.abs(mGBP);
    if (abs >= 1000) return `£${(mGBP / 1000).toFixed(2)}bn`;
    return `£${mGBP.toFixed(1)}m`;
  }

  function humanizeKey(s) {
    const t = String(s ?? "").trim().replaceAll("_", " ");
    return t.replace(/\b[a-z]/g, ch => ch.toUpperCase());
  }

  const tip = d3.select("body").append("div")
    .attr("id", "scene2-tooltip")
    .style("position", "fixed")
    .style("pointer-events", "none")
    .style("background", "rgba(20, 24, 32, 0.95)")
    .style("color", "#fff")
    .style("padding", "0.55rem 0.75rem")
    .style("border-radius", "6px")
    .style("font-size", "0.85rem")
    .style("line-height", "1.35")
    .style("opacity", 0);

  d3.json("data/mechanism_national_coben_pathway.json").then(raw => {
    if (!Array.isArray(raw) || raw.length === 0) {
      noteEl.textContent = "No data";
      return;
    }

    // Detect columns
    const cols = Object.keys(raw[0]);

    const cobCol =
      cols.find(c => norm(c).includes("co") && norm(c).includes("benefit")) ||
      cols.find(c => norm(c).includes("benefit")) ||
      cols[0];

    const pathCol =
      cols.find(c => norm(c).includes("pathway")) ||
      cols.find(c => norm(c).includes("mechanism")) ||
      cols[1];

    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("value")) ||
      cols[2];

    // Clean rows and aggregate to pathway total
    const cleaned = raw.map(d => ({
      pathway: String(d[pathCol] ?? "").trim(),
      cobenefit: String(d[cobCol] ?? "").trim(),
      value: Number(String(d[valCol] ?? "").replaceAll(",", ""))
    })).filter(d => d.pathway && Number.isFinite(d.value));

    const byPath = d3.rollups(
      cleaned,
      v => d3.sum(v, d => d.value),
      d => d.pathway
    ).map(([pathway, value]) => ({ pathway, value }))
     .sort((a, b) => b.value - a.value);

    const total = d3.sum(byPath, d => d.value);

    // Choose top N, but never exceed available categories
    const requestedTopN = 10;
    const top = byPath.slice(0, Math.min(requestedTopN, byPath.length));

    const shown = top.length;
    const topTotal = d3.sum(top, d => d.value);

    // Count negatives in the shown set
    const negCount = top.filter(d => d.value < 0).length;

    noteEl.textContent =
      `Top ${shown} pathways shown. ` +
      `Together: ${Math.round((topTotal / total) * 100)}% of national total. `;

    function draw() {
      const { width, height } = s2Size();
      svg2.attr("viewBox", [0, 0, width, height]);
      svg2.selectAll("*").remove();

      const margin = { top: 20, right: 30, bottom: 70, left: 260 };
      const innerW = Math.max(10, width - margin.left - margin.right);
      const innerH = Math.max(10, height - margin.top - margin.bottom);

      const g = svg2.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      const y = d3.scaleBand()
        .domain(top.map(d => d.pathway))
        .range([0, innerH])
        .padding(0.18);

      const minV = d3.min(top, d => d.value) ?? 0;
      const maxV = d3.max(top, d => d.value) ?? 1;

      const x = d3.scaleLinear()
        .domain([Math.min(0, minV), Math.max(0, maxV)])
        .nice()
        .range([0, innerW]);

      const x0 = x(0);

      // background grid ticks
      g.append("g")
        .selectAll("line")
        .data(x.ticks(5))
        .join("line")
        .attr("x1", d => x(d))
        .attr("x2", d => x(d))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "rgba(255,255,255,0.06)");

      // zero line
      g.append("line")
        .attr("x1", x0)
        .attr("x2", x0)
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "rgba(255,255,255,0.18)");

      // highlight largest (by absolute, to also catch large negative if any)
      const maxAbs = d3.max(top, d => Math.abs(d.value)) ?? 0;

      // bars
      g.selectAll("rect")
        .data(top)
        .join("rect")
        .attr("class", "comp-bar")
        .attr("x", d => d.value < 0 ? x(d.value) : x0)
        .attr("y", d => y(d.pathway))
        .attr("width", d => Math.abs(x(d.value) - x0))
        .attr("height", y.bandwidth())
        .attr("rx", 8)
        .attr("ry", 8)
        .attr("fill", d => {
          const isHighlight = Math.abs(d.value) === maxAbs;
          if (isHighlight) return "rgba(120, 210, 210, 0.65)";
          return "rgba(120, 210, 210, 0.30)";
        })
        .attr("stroke", d => {
          const isHighlight = Math.abs(d.value) === maxAbs;
          if (isHighlight) return "rgba(120, 210, 210, 0.55)";
          return "rgba(120, 210, 210, 0.20)";
        })
        .attr("stroke-width", 1)
        .on("mousemove", (event, d) => {
          tip
            .style("opacity", 1)
            .style("left", `${event.clientX + 12}px`)
            .style("top", `${event.clientY - 12}px`)
            .html(
              `<strong>${humanizeKey(d.pathway)}</strong><br/>` +
              `National value: ${fmtMoney(d.value)}`
            );
        })
        .on("mouseleave", () => tip.style("opacity", 0));

      // pathway labels (left)
      g.selectAll("text.comp-label")
        .data(top)
        .join("text")
        .attr("class", "comp-label")
        .attr("x", -12)
        .attr("y", d => y(d.pathway) + y.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text(d => humanizeKey(d.pathway));

      // values (near bar end, correct side for negative)
      g.selectAll("text.comp-value")
        .data(top)
        .join("text")
        .attr("class", "comp-value")
        .attr("y", d => y(d.pathway) + y.bandwidth() / 2)
        .attr("x", d => {
          const a = x(d.value);
          const w = Math.abs(a - x0);
          return d.value >= 0 ? (x0 + w - 10) : (x0 - w + 10);
        })
        .attr("text-anchor", d => (d.value >= 0 ? "end" : "start"))
        .attr("dominant-baseline", "middle")
        .text(d => fmtMoney(d.value));
    }

    draw();
    window.addEventListener("resize", draw);
  });
}

renderScene3();

function renderScene3() {
  const container = document.getElementById("rank-container");
  const svg = d3.select("#rank");
  const noteEl = document.getElementById("rank-note");

  function size() {
    const r = container.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  function norm(s) {
    return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function fmtMoney(mGBP) {
    if (!Number.isFinite(mGBP)) return "£0m";
    const abs = Math.abs(mGBP);
    if (abs >= 1000) return `£${(mGBP / 1000).toFixed(2)}bn`;
    return `£${mGBP.toFixed(1)}m`;
  }

  function humanize(s) {
    return String(s ?? "").replaceAll("_", " ");
  }

  // Try JSON first, fallback to CSV
  const loadData = d3.json("data/level1_local_authority_ranking.json")
    .catch(() => d3.csv("data/la_values_total.csv"));

  loadData.then(raw => {
    if (!raw || !raw.length) return;

    const cols = Object.keys(raw[0]);

    const laCol =
      cols.find(c => norm(c).includes("authority")) ||
      cols.find(c => norm(c).includes("lad")) ||
      cols[0];

    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("total")) ||
      cols[1];

    const data = raw.map(d => ({
      name: String(d[laCol] ?? "").trim(),
      value: Number(String(d[valCol] ?? "").replaceAll(",", ""))
    }))
    .filter(d => d.name && Number.isFinite(d.value));

    // Sort descending
    data.sort((a, b) => b.value - a.value);

    const topN = 10;
    const bottomN = 10;

    const top = data.slice(0, topN);
    const bottom = data.slice(-bottomN).reverse();

    const combined = [...top, ...bottom];

    noteEl.textContent =
      `Top ${topN} and bottom ${bottomN} Local Authorities shown. ` +
      `The gap between them highlights unequal benefits.`;

    draw(combined);

    window.addEventListener("resize", () => draw(combined));

    function draw(rows) {
      const { width, height } = size();
      svg.attr("viewBox", [0, 0, width, height]);
      svg.selectAll("*").remove();

      const margin = { top: 20, right: 30, bottom: 60, left: 280 };
      const innerW = Math.max(10, width - margin.left - margin.right);
      const innerH = Math.max(10, height - margin.top - margin.bottom);

      const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const y = d3.scaleBand()
        .domain(rows.map(d => d.name))
        .range([0, innerH])
        .padding(0.18);

      const x = d3.scaleLinear()
        .domain([0, d3.max(rows, d => d.value) || 1])
        .nice()
        .range([0, innerW]);

      // Bars
      g.selectAll("rect")
        .data(rows)
        .join("rect")
        .attr("class", d => top.includes(d) ? "rank-bar" : "rank-bar low")
        .attr("x", 0)
        .attr("y", d => y(d.name))
        .attr("width", d => x(d.value))
        .attr("height", y.bandwidth())
        .attr("rx", 6)
        .attr("ry", 6);

      // Labels
      g.selectAll("text.rank-label")
        .data(rows)
        .join("text")
        .attr("class", "rank-label")
        .attr("x", -12)
        .attr("y", d => y(d.name) + y.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text(d => humanize(d.name));

      // Values
      g.selectAll("text.rank-value")
        .data(rows)
        .join("text")
        .attr("class", "rank-value")
        .attr("x", d => x(d.value) + 8)
        .attr("y", d => y(d.name) + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .text(d => fmtMoney(d.value));
    }
  });
}

renderScene4();

function renderScene4() {
  function norm(s) {
    return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function fmtMoney(mGBP) {
    if (!Number.isFinite(mGBP)) return "£0m";
    const abs = Math.abs(mGBP);
    if (abs >= 1000) return `£${(mGBP / 1000).toFixed(2)}bn`;
    return `£${mGBP.toFixed(1)}m`;
  }

  function fmtSignedMoney(mGBP) {
    if (!Number.isFinite(mGBP)) return "£0m";
    const sign = mGBP < 0 ? "−" : "";
    return sign + fmtMoney(Math.abs(mGBP));
  }

  function humanize(s) {
    return String(s ?? "").replaceAll("_", " ");
  }

  d3.json("data/mechanism_national_coben_pathway.json").then(raw => {
    if (!Array.isArray(raw) || raw.length === 0) return;

    const cols = Object.keys(raw[0]);

    const pathCol =
      cols.find(c => norm(c).includes("pathway")) ||
      cols.find(c => norm(c).includes("mechanism")) ||
      cols[1];

    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("value")) ||
      cols[2];

    const cleaned = raw.map(d => ({
      pathway: String(d[pathCol] ?? "").trim(),
      value: Number(String(d[valCol] ?? "").replaceAll(",", ""))
    })).filter(d => d.pathway && Number.isFinite(d.value));

    const byPath = d3.rollups(
      cleaned,
      v => d3.sum(v, d => d.value),
      d => d.pathway
    ).map(([pathway, value]) => ({ pathway, value }));

    const map = new Map(byPath.map(d => [d.pathway, d.value]));

    // Preferred daily-life pathways
    const candidates = [
      { key: "sleep_disturbance", title: "Better sleep", el: "sleep" },
      { key: "amenity", title: "More liveable places", el: "amenity" },
      { key: "time_saved", title: "Time back", el: "time" }
    ];

    // If some are missing, fill with top absolute pathways
    const present = [];
    const missing = [];

    for (const c of candidates) {
      const foundKey = Array.from(map.keys()).find(k => norm(k) === norm(c.key));
      if (foundKey) present.push({ ...c, key: foundKey, value: map.get(foundKey) });
      else missing.push(c);
    }

    if (missing.length) {
      const sortedAbs = [...byPath]
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

      for (const m of missing) {
        const pick = sortedAbs.find(d => !present.some(p => p.key === d.pathway));
        if (pick) present.push({ ...m, key: pick.pathway, value: pick.value, fallback: true });
      }
    }

    const totalAbs = d3.sum(byPath, d => Math.abs(d.value)) || 1;

    function setCard(prefix, obj) {
      const vEl = document.getElementById(`kpi-${prefix}`);
      const sEl = document.getElementById(`kpi-${prefix}-sub`);
      if (!vEl || !sEl) return;

      vEl.textContent = fmtSignedMoney(obj.value);

      const share = Math.round((Math.abs(obj.value) / totalAbs) * 100);
      const label = obj.fallback
        ? `Pathway used: ${humanize(obj.key)} (fallback). Share of national impact: ${share}%`
        : `Pathway: ${humanize(obj.key)}. Share of national impact: ${share}%`;

      sEl.textContent = label;
    }

    // We want order sleep, amenity, time
    const byPrefix = new Map(present.map(d => [d.el, d]));
    if (byPrefix.get("sleep")) setCard("sleep", byPrefix.get("sleep"));
    if (byPrefix.get("amenity")) setCard("amenity", byPrefix.get("amenity"));
    if (byPrefix.get("time")) setCard("time", byPrefix.get("time"));
  });
}

renderScene5();

function renderScene5() {
  function norm(s) {
    return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function fmtMoney(mGBP) {
    if (!Number.isFinite(mGBP)) return "£0m";
    const abs = Math.abs(mGBP);
    if (abs >= 1000) return `£${(mGBP / 1000).toFixed(1)}bn`;
    return `£${mGBP.toFixed(1)}m`;
  }

  // 1) Total national value from pathways
  d3.json("data/mechanism_national_coben_pathway.json").then(raw => {
    if (!Array.isArray(raw) || !raw.length) return;

    const cols = Object.keys(raw[0]);
    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("value")) ||
      cols[cols.length - 1];

    const total = d3.sum(raw, d => Number(String(d[valCol] ?? "").replaceAll(",", "")));
    document.getElementById("final-total").textContent = fmtMoney(total);

    // Share related to health & wellbeing
    const healthKeys = ["mortality", "health", "sleep"];
    const healthValue = d3.sum(
      raw.filter(d =>
        healthKeys.some(k => norm(JSON.stringify(d)).includes(k))
      ),
      d => Number(String(d[valCol] ?? "").replaceAll(",", ""))
    );

    const healthShare = total ? Math.round((healthValue / total) * 100) : 0;
    document.getElementById("final-health").textContent = `${healthShare}%`;
  });

  // 2) How many Local Authorities benefit
  d3.csv("data/la_values_total.csv").then(rows => {
    if (!rows || !rows.length) return;

    const cols = Object.keys(rows[0]);
    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("total")) ||
      cols[cols.length - 1];

    const positive = rows.filter(r => Number(String(r[valCol] ?? "").replaceAll(",", "")) > 0);
    const share = Math.round((positive.length / rows.length) * 100);

    document.getElementById("final-places").textContent = `${share}%`;
  });
}

setupScrollReveal();

function setupScrollReveal() {
  const targets = document.querySelectorAll(".reveal, .stagger");

  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        obs.unobserve(e.target);
      }
    }
  }, {
    root: null,
    threshold: 0.18
  });

  targets.forEach(el => obs.observe(el));
}
