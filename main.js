const mapBackground = document.getElementById("map-background");
const svg = d3.select("#map");
const tooltip = d3.select("#tooltip");

// Global state untuk track selected Local Authority
let selectedLA = null;

function size() {
  // Fixed size - tidak responsive
  return { width: 1400, height: 900 };
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
  // Smart filter: hapus hanya geometry yang benar-benar invalid atau extreme
  const allBounds = [];
  
  // Collect all bounds untuk calculate median
  for (const f of geo.features) {
    try {
      const b = d3.geoBounds(f);
      if (b && b[0] && b[1]) {
        const w = Math.abs(b[1][0] - b[0][0]);
        const h = Math.abs(b[1][1] - b[0][1]);
        if (w > 0 && h > 0) {
          allBounds.push({ feature: f, width: w, height: h });
        }
      }
    } catch (e) {
      // Skip invalid geometry
    }
  }
  
  // Calculate median width/height sebagai baseline
  const widths = allBounds.map(b => b.width).sort((a, b) => a - b);
  const heights = allBounds.map(b => b.height).sort((a, b) => a - b);
  const medianW = widths[Math.floor(widths.length / 2)];
  const medianH = heights[Math.floor(heights.length / 2)];
  
  // Keep only features yang reasonably sized (tidak lebih dari 10x median)
  geo.features = allBounds.filter(b => {
    return b.width <= medianW * 10 && b.height <= medianH * 10;
  }).map(b => b.feature);
  
  console.log("Kept", geo.features.length, "features after smart filter");
  console.log("Median width:", medianW, "Median height:", medianH);

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

  // Print semua feature names untuk debug
  const geoFeatureNames = geo.features.map(f => String(f.properties[laProp] ?? "").trim());
  console.log("GeoJSON features:", geoFeatureNames);
  console.log("=== AVAILABLE REGIONS IN GEOJSON ===");
  geoFeatureNames.forEach((name, idx) => console.log(`${idx + 1}. ${name}`));

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
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
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
        .on("mouseleave", () => tooltip.style("opacity", 0))
        .on("click", (event, d) => {
            const name = String(d.properties[laProp] ?? "").trim();
            selectedLA = selectedLA === name ? null : name;
            window.updateMapHighlight?.();
            window.updateScene3Highlight?.();
        });

  // Function untuk update highlight di map
  function updateMapHighlight() {
    g.selectAll("path.area")
      .attr("opacity", (d) => {
        if (!selectedLA) return 1;
        const name = String(d.properties[laProp] ?? "").trim();
        return name === selectedLA ? 1 : 0.35;
      })
      .attr("stroke-width", (d) => {
        if (!selectedLA) return 0.6;
        const name = String(d.properties[laProp] ?? "").trim();
        return name === selectedLA ? 0.2 : 0.6;
      })
      .attr("stroke", (d) => {
        if (!selectedLA) return "rgba(0,0,0,0.35)";
        const name = String(d.properties[laProp] ?? "").trim();
        return name === selectedLA ? "#FFD700" : "rgba(0,0,0,0.35)";
      })
      .attr("filter", (d) => {
        if (!selectedLA) return "none";
        const name = String(d.properties[laProp] ?? "").trim();
        return name === selectedLA ? "brightness(1.3)" : "none";
      });

    // Zoom ke area yang dipilih
    if (selectedLA) {
      zoomToLA(selectedLA);
    } else {
      // Reset zoom
      svg.transition()
        .duration(1200)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));
    }
  }

  // Function untuk zoom ke LA tertentu
  function zoomToLA(laName) {
    // Fuzzy matching untuk handle perbedaan nama
    let feature = geo.features.find(f => {
      const name = String(f.properties[laProp] ?? "").trim();
      return name === laName;
    });

    // Jika tidak ketemu, coba case-insensitive match
    if (!feature) {
      const laNameLower = laName.toLowerCase().replace(/\s+/g, " ");
      feature = geo.features.find(f => {
        const name = String(f.properties[laProp] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        return name === laNameLower;
      });
    }

    // Jika masih tidak ketemu, coba partial match (contain)
    if (!feature) {
      const laNameLower = laName.toLowerCase();
      feature = geo.features.find(f => {
        const name = String(f.properties[laProp] ?? "").trim().toLowerCase();
        return name.includes(laNameLower) || laNameLower.includes(name);
      });
    }

    if (!feature) {
      console.log("Feature not found:", laName);
      console.log("Available features:", geo.features.map(f => String(f.properties[laProp] ?? "").trim()));
      // FALLBACK: zoom ke semua geo jika daerah tidak ditemukan
      console.log("Zooming to entire map instead");
      svg.transition()
        .duration(1200)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));
      return;
    }

    const { width, height } = size();

    // Create projection untuk feature
    const projTemp = (maxAbs > 180)
      ? d3.geoIdentity().reflectY(true).fitSize([width, height], geo)
      : d3.geoMercator().fitSize([width, height], geo);

    // Get path generator points untuk calculate zoom
    const path = d3.geoPath(projTemp);

    // Approximate zoom level dan pan
    const bounds1 = path.bounds(feature);
    
    // Safety check untuk bounds yang invalid
    if (!bounds1 || bounds1.length < 2 || !bounds1[0] || !bounds1[1]) {
      console.log("Invalid bounds for feature:", laName, bounds1);
      // FALLBACK: reset zoom
      svg.transition()
        .duration(1200)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));
      return;
    }

    const dx = bounds1[1][0] - bounds1[0][0];
    const dy = bounds1[1][1] - bounds1[0][1];
    
    // Safety check untuk dx/dy yang terlalu kecil
    if (dx < 5 || dy < 5) {
      console.log("Feature too small, adjusting...", {dx, dy});
    }

    const x = (bounds1[0][0] + bounds1[1][0]) / 2;
    const y = (bounds1[0][1] + bounds1[1][1]) / 2;

    const scale = Math.max(1, Math.min(width / (dx || 1), height / (dy || 1)) * 0.5);
    const translate = [width / 2 - scale * x, height / 2 - scale * y];

    console.log("Zooming to", laName, "matched as", String(feature.properties[laProp] ?? "").trim(), { scale, translate, dx, dy });

    svg.transition()
      .duration(1200)
      .ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
  }

  // Store reference untuk update dari scene 3
  window.updateMapHighlight = updateMapHighlight;

  // Function untuk update dari scene 3 - akan di-set nanti
  window.updateScene3Highlight = function() {
    if (window.updateScene3HighlightFn) {
      window.updateScene3HighlightFn();
    }
  };

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
    .style("z-index", "9999")
    .style("opacity", 0);

  // Declare variables in outer scope so animateScene2 can access them
  let sourceNames, impactNames, links;

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

    const cleaned = raw.map(d => ({
      cobenefit: String(d["co-benefit_type"] ?? d[cobCol] ?? "").trim(),
      pathway: String(d["damage_pathway"] ?? d[pathCol] ?? "").trim(),
      value: Number(String(d["value_mGBP"] ?? d[valCol] ?? "").replaceAll(",", ""))
    })).filter(d => d.cobenefit && d.pathway && Number.isFinite(d.value));

    // Define source mapping - map from co-benefit TYPE to source (left side)
    const sourceMap = {
      "Calmer & Safer Streets": { pattern: ["noise"] },
      "Cleaner Environments": { pattern: ["air_quality", "air", "pollution"] },
      "Active Movement": { pattern: ["physical_activity", "activity", "physical", "travel", "walking", "diet"] }
    };

    // Define impact mapping - map from damage PATHWAY to impact (right side)
    // Order matters for storytelling (left to right narrative flow)
    const impactMap = {
      "Health & Lives": { pattern: ["mortality", "qaly", "health"] },
      "Wellbeing & Sleep": { pattern: ["sleep_disturbance", "sleep", "disturbance", "wellbeing"] },
      "Time & Convenience": { pattern: ["time_saved", "time", "convenience", "amenity", "nhs", "cost", "saving", "society"] }
    };

    function getSourceForCobenefit(cobenefit) {
      const norm_cob = norm(cobenefit);
      for (const [source, cfg] of Object.entries(sourceMap)) {
        if (cfg.pattern.some(p => norm_cob.includes(p))) return source;
      }
      return "Active Movement"; // default
    }

    function getImpactForPathway(pathway, cobenefit) {
      // Priority 1: Match cobenefit to specific impacts
      const norm_cob = norm(cobenefit);
      
      // Air quality → Wellbeing & Sleep
      if (norm_cob.includes("air")) {
        return "Wellbeing & Sleep";
      }
      
      // Priority 2: Match pathway to impacts
      const norm_path = norm(pathway);
      for (const [impact, cfg] of Object.entries(impactMap)) {
        if (cfg.pattern.some(p => norm_path.includes(p))) return impact;
      }
      return "Time & Convenience"; // default (was Economic Savings)
    }

    // Build Sankey nodes and links - maintain explicit order
    sourceNames = Object.keys(sourceMap); // Quieter Streets, Cleaner Air, Active Travel
    impactNames = Object.keys(impactMap); // Health & Lives, Wellbeing & Sleep, Time & Convenience, Economic Savings
    
    // Aggregate by source->impact path
    const linkMap = new Map();
    for (const row of cleaned) {
      const source = getSourceForCobenefit(row.cobenefit);
      const impact = getImpactForPathway(row.pathway, row.cobenefit);
      const key = `${source}|${impact}`;
      linkMap.set(key, (linkMap.get(key) || 0) + row.value);
    }

    links = Array.from(linkMap.entries()).map(([key, value]) => {
      const [source, impact] = key.split("|");
      return {
        sourceIdx: sourceNames.indexOf(source),
        targetIdx: impactNames.indexOf(impact),
        value: Math.abs(value)
      };
    });

    console.log("Sankey data:", { sourceNames, impactNames, linkCount: links.length, links: links.slice(0, 5) });

    function draw() {
      const { width, height } = s2Size();
      svg2.attr("viewBox", [0, 0, width, height]);
      svg2.selectAll("*").remove();

      const margin = { top: 40, right: 180, bottom: 40, left: 180 };
      const innerW = Math.max(200, width - margin.left - margin.right);
      const innerH = Math.max(200, height - margin.top - margin.bottom);

      const g = svg2.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      // Build nodes for Sankey
      const allNodes = [
        ...sourceNames.map(s => ({ name: s, type: "source" })),
        ...impactNames.map(i => ({ name: i, type: "impact" }))
      ];

      const nodeIndexMap = new Map(allNodes.map((n, i) => [n.name, i]));

      // Convert links to use node indices
      const linksWithIndices = links.map(l => {
        const srcName = sourceNames[l.sourceIdx];
        const impactName = impactNames[l.targetIdx];
        return {
          source: nodeIndexMap.get(srcName),
          target: nodeIndexMap.get(impactName),
          value: l.value
        };
      });

      // D3 Sankey layout
      const sankey = d3.sankey()
        .nodeWidth(80)
        .nodePadding(100)
        .size([innerW, innerH]);

      const { nodes: layoutNodes, links: layoutLinks } = sankey({
        nodes: allNodes.map(d => ({ ...d })),
        links: linksWithIndices.map(d => ({ ...d }))
      });

      // Colors
      const sourceColors = {
        "Calmer & Safer Streets": "#78B7C5",
        "Cleaner Environments": "#7BC4A4",
        "Active Movement": "#E3A45B"
      };

      const impactColors = {
        "Health & Lives": "#6C8FA3",
        "Wellbeing & Sleep": "#6C8FA3",
        "Time & Convenience": "#6C8FA3"
      };

      // Draw links with animation
      let selectedLink = null;
      
      g.selectAll(".sankey-link")
        .data(layoutLinks)
        .join("path")
        .attr("class", "sankey-link")
        .attr("d", d3.sankeyLinkHorizontal())
        .attr("stroke", d => {
          const srcNode = layoutNodes[d.source.index];
          return srcNode.type === "source" ? sourceColors[srcNode.name] : "#999";
        })
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", d => Math.max(1, d.width))
        .attr("fill", "none")
        // Setup for stroke animation
        .attr("stroke-dasharray", function() { return this.getTotalLength(); })
        .attr("stroke-dashoffset", function() { return this.getTotalLength(); })
        // Animate stroke from right to left (reveal animation)
        .transition()
        .duration(1500)
        .delay((d, i) => i * 50)
        .attr("stroke-dashoffset", 0)
        .on("end", function() {
          d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
        })
        .selection()
        .on("mousemove", function(event, d) {
          d3.select(this).attr("stroke-opacity", 0.85);
          const srcName = layoutNodes[d.source.index].name;
          const targetName = layoutNodes[d.target.index].name;
          tip
            .style("opacity", 1)
            .style("left", `${event.clientX + 12}px`)
            .style("top", `${event.clientY - 12}px`)
            .html(`<strong>${srcName} → ${targetName}</strong><br/>Value: ${fmtMoney(d.value)}`);
        })
        .on("mouseleave", function() {
          if (selectedLink !== this) {
            d3.select(this).attr("stroke-opacity", 0.6);
          }
          tip.style("opacity", 0);
        })
        .on("click", function(event, d) {
          // Toggle selection
          if (selectedLink === this) {
            // Deselect
            d3.selectAll(".sankey-link").attr("stroke-opacity", 0.6);
            selectedLink = null;
            tip.style("opacity", 0);
          } else {
            // Select this link and fade others
            d3.selectAll(".sankey-link")
              .attr("stroke-opacity", link => (link === d ? 1 : 0.15));
            selectedLink = this;
            // Show tooltip with value
            const srcName = layoutNodes[d.source.index].name;
            const targetName = layoutNodes[d.target.index].name;
            tip
              .style("opacity", 1)
              .style("left", `${event.clientX + 12}px`)
              .style("top", `${event.clientY - 12}px`)
              .html(`<strong>${srcName} → ${targetName}</strong><br/>Value: ${fmtMoney(d.value)}`);
          }
          event.stopPropagation();
        })
        .style("cursor", "pointer");

      // Draw nodes
      g.selectAll(".sankey-node")
        .data(layoutNodes)
        .join("rect")
        .attr("class", "sankey-node")
        .attr("x", d => d.x0)
        .attr("y", d => d.y0)
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => d.type === "source" ? sourceColors[d.name] : impactColors[d.name])
        .attr("opacity", 0.85)
        .attr("rx", 4)
        .on("mousemove", (event, d) => {
          // D3 Sankey calculates node.value automatically from links
          const value = d.value || 0;
          tip
            .style("opacity", 1)
            .style("left", `${event.clientX + 12}px`)
            .style("top", `${event.clientY - 12}px`)
            .html(`<strong>${d.name}</strong><br/>Value: ${fmtMoney(value)}`);
        })
        .on("mouseleave", () => tip.style("opacity", 0))
        .style("cursor", "pointer");

      // Node labels (names)
      g.selectAll(".sankey-label")
        .data(layoutNodes)
        .join("text")
        .attr("class", "sankey-label")
        .attr("x", d => d.type === "source" ? d.x0 - 12 : d.x1 + 12)
        .attr("y", d => (d.y0 + d.y1) / 2 - 10)
        .attr("text-anchor", d => d.type === "source" ? "end" : "start")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "12px")
        .attr("font-weight", "bold")
        .attr("fill", "#cfd3d8")
        .text(d => d.name);

      // Node values (always visible)
      g.selectAll(".sankey-value")
        .data(layoutNodes)
        .join("text")
        .attr("class", "sankey-value")
        .attr("x", d => d.type === "source" ? d.x0 - 12 : d.x1 + 12)
        .attr("y", d => (d.y0 + d.y1) / 2 + 10)
        .attr("text-anchor", d => d.type === "source" ? "end" : "start")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "11px")
        .attr("fill", "#a0a8af")
        .text(d => fmtMoney(d.value || 0));
    }

    // Tambahkan flag agar tidak animasi dua kali
    let scene2Animated = false;

    function animateScene2() {
      if (scene2Animated) return;
      if (!sourceNames || !links) return; // wait for data to load
      scene2Animated = true;
      console.log("Rendering Scene 2 Sankey with data:", { sourceCount: sourceNames.length, linkCount: links.length });
      draw();
    }

    // Ganti window.addEventListener("resize", draw); menjadi:
    window.addEventListener("resize", () => {
      scene2Animated = false;
      draw();
    });

    // Jangan panggil draw() langsung di sini!
    // draw();

    // Di luar renderScene2, setelah setupScrollReveal():
    setupScrollReveal();

    const scene2Section = document.getElementById("scene-2");
    const observer2 = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          animateScene2();
          observer2.unobserve(entry.target); // animasi hanya sekali
        }
      }
    }, { threshold: 0.18 });
    observer2.observe(scene2Section);
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

    // Tambahkan flag agar tidak animasi dua kali
    let scene3Animated = false;

    function animateScene3() {
    if (scene3Animated) return;
    scene3Animated = true;
    draw(combined);
    }

    // Responsive: reset flag agar animasi bisa muncul lagi saat resize
    window.addEventListener("resize", () => {
    scene3Animated = false;
    draw(combined); // Atau bisa dikosongkan bar-nya jika ingin animasi ulang
    });

    // Jangan panggil draw(combined) langsung di sini!
    // draw(combined);

    // IntersectionObserver untuk scene 3
    const scene3Section = document.getElementById("scene-3");
    const observer3 = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
        animateScene3();
        observer3.unobserve(entry.target); // animasi hanya sekali
        }
    }
    }, { threshold: 0.18 });
    observer3.observe(scene3Section);

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
        .attr("width", 0) // Start from 0
        .attr("height", y.bandwidth())
        .attr("rx", 6)
        .attr("ry", 6)
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          selectedLA = selectedLA === d.name ? null : d.name;
          window.updateMapHighlight?.();
          window.updateScene3Highlight?.();
        })
        .transition()
        .duration(1500)
        .delay((d, i) => i * 80)
        .attr("width", d => x(d.value));

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
        .attr("x", d => x(0) + 8)
        .attr("y", d => y(d.name) + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .text(d => fmtMoney(0))
        .transition()
        .duration(1500)
        .delay((d, i) => i * 80)
        .attr("x", d => x(d.value) + 8)
        .textTween(function(d) {
          const interpolate = d3.interpolate(0, d.value);
          return function(t) {
            return fmtMoney(interpolate(t));
          };
        });

      // Function untuk update highlight di scene 3
      function updateScene3Bars() {
        g.selectAll("rect").attr("opacity", (d) => {
          if (!selectedLA) return 1;
          return d.name === selectedLA ? 1 : 0.3;
        });
      }

      // Store reference untuk update dari map
      window.updateScene3HighlightFn = updateScene3Bars;
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

  // Store card values for animation
  const cardValues = {};

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

      const finalValue = Math.abs(obj.value);
      cardValues[prefix] = finalValue;

      // Display absolute value (time_saved is negative in data but positive in meaning)
      vEl.textContent = fmtMoney(finalValue);

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

    // Trigger animation on scene 4 visibility
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.target.id === "scene-4") {
          animateScene4Cards();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    const scene4 = document.getElementById("scene-4");
    if (scene4) observer.observe(scene4);

    function animateScene4Cards() {
      for (const [prefix, finalValue] of Object.entries(cardValues)) {
        const el = document.getElementById(`kpi-${prefix}`);
        if (!el) continue;

        d3.select(el)
          .transition()
          .duration(1500)
          .delay((prefix === "sleep" ? 0 : prefix === "amenity" ? 200 : 400))
          .textTween(function() {
            const i = d3.interpolate(0, finalValue);
            return t => fmtMoney(i(t));
          });
      }
    }
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

  const finalValues = {};
  let scene5Animated = false;

  function animateScene5() {
    if (scene5Animated) return;
    scene5Animated = true;

    // Animate total
    if (finalValues.total !== undefined) {
      d3.select("#final-total")
        .transition()
        .duration(1500)
        .textTween(function() {
          const i = d3.interpolate(0, finalValues.total);
          return t => fmtMoney(i(t));
        });
    }

    // Animate health share
    if (finalValues.health !== undefined) {
      d3.select("#final-health")
        .transition()
        .duration(1500)
        .delay(200)
        .textTween(function() {
          const i = d3.interpolate(0, finalValues.health);
          return t => `${Math.round(i(t))}%`;
        });
    }

    // Animate places share
    if (finalValues.places !== undefined) {
      d3.select("#final-places")
        .transition()
        .duration(1500)
        .delay(400)
        .textTween(function() {
          const i = d3.interpolate(0, finalValues.places);
          return t => `${Math.round(i(t))}%`;
        });
    }
  }

  // Setup intersection observer for scene 5
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.target.id === "scene-5") {
        animateScene5();
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  const scene5 = document.getElementById("scene-5");
  if (scene5) observer.observe(scene5);

  // 1) Total national value from pathways
  d3.json("data/mechanism_national_coben_pathway.json").then(raw => {
    if (!Array.isArray(raw) || !raw.length) return;

    const cols = Object.keys(raw[0]);
    const valCol =
      cols.find(c => norm(c).includes("value") && norm(c).includes("mgbp")) ||
      cols.find(c => norm(c).includes("value")) ||
      cols[cols.length - 1];

    const total = d3.sum(raw, d => Number(String(d[valCol] ?? "").replaceAll(",", "")));
    finalValues.total = total;

    // Share related to health & wellbeing
    const healthKeys = ["mortality", "health", "sleep"];
    const healthValue = d3.sum(
      raw.filter(d =>
        healthKeys.some(k => norm(JSON.stringify(d)).includes(k))
      ),
      d => Number(String(d[valCol] ?? "").replaceAll(",", ""))
    );

    const healthShare = total ? Math.round((healthValue / total) * 100) : 0;
    finalValues.health = healthShare;
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

    finalValues.places = share;
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

// Scroll arrow button
const scrollArrow = document.querySelector('.scroll-arrow');
if (scrollArrow) {
  scrollArrow.addEventListener('click', () => {
    const nextSection = document.getElementById('scene-2');
    if (nextSection) {
      nextSection.scrollIntoView({ behavior: 'smooth' });
    }
  });
}
