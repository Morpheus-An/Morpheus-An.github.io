// Visitor globe ("Where are my visitors?"), the /visitors/ breakdown, and the
// owner-only visit log that opens when a page is visited with #owner.
// Data comes from the Cloudflare Worker in visitor-worker/ (window.VISITOR_MAP.url).
(function () {
  const cfg = window.VISITOR_MAP;
  if (!cfg || !cfg.url) return;
  const base = cfg.url.replace(/\/$/, "");

  const regionNames = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" });
    } catch (e) {
      return null;
    }
  })();

  function countryName(code) {
    if (!code) return "Unknown";
    try {
      return (regionNames && regionNames.of(code)) || code;
    } catch (e) {
      return code;
    }
  }

  function flag(code) {
    if (!code || code.length !== 2) return "";
    return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0)));
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function plural(n, word) {
    return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  }

  function isDark() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  function loadGlobeLibrary() {
    if (window.Globe) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.globeJs;
      if (cfg.globeIntegrity) {
        s.integrity = cfg.globeIntegrity;
        s.crossOrigin = "anonymous";
      }
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  function fetchJson(path, options) {
    return fetch(base + path, options).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  }

  // ------------------------------------------------------------------ globe
  function setupWidget(widget) {
    const full = widget.dataset.full === "true";
    const toggle = widget.querySelector(".visitor-map-toggle");
    const box = widget.querySelector(".visitor-map-globe");
    const summary = widget.querySelector(".visitor-map-summary");
    let world = null;
    let started = false;

    function resize() {
      if (world) world.width(box.clientWidth).height(box.clientHeight);
    }

    function applyTheme() {
      if (!world) return;
      const dark = isDark();
      world
        .atmosphereColor(dark ? "#3b78b8" : "#acd6ef")
        .hexPolygonColor(() => (dark ? "rgba(143, 180, 230, 0.85)" : "rgba(38, 88, 148, 0.8)"));
      const m = world.globeMaterial();
      m.color.set(dark ? "#16263d" : "#cfe7f5");
      m.emissive.set(dark ? "#1e3a5f" : "#2e6bb0");
      m.emissiveIntensity = dark ? 0.35 : 0.1;
    }

    function render(points, stats, countries) {
      box.innerHTML = "";
      const dotColor = getComputedStyle(document.documentElement).getPropertyValue("--global-theme-color").trim() || "#ff4d4f";
      world = new Globe(box, { animateIn: true })
        .backgroundColor("rgba(0,0,0,0)")
        .globeImageUrl(null)
        .showGraticules(true)
        .showAtmosphere(true)
        .atmosphereAltitude(0.18)
        .hexPolygonsData(countries.features || [])
        .hexPolygonResolution(3)
        .hexPolygonMargin(0.32)
        .hexPolygonUseDots(true)
        .pointsData(points)
        .pointLat("lat")
        .pointLng("lon")
        .pointAltitude(0.012)
        .pointColor(() => dotColor)
        .pointRadius((d) => Math.min(0.35 + Math.log(d.count + 1) * 0.28, 1.6))
        .pointLabel((d) => `<div class="visitor-map-label">${esc(d.city || "Unknown city")}, ${esc(countryName(d.country))}<br>${plural(d.count, "visit")}</div>`);
      world.globeMaterial().shininess = 6;
      applyTheme();
      resize();
      const controls = world.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controls.enableZoom = full;
      // Start over the region with the most visits
      if (points.length) world.pointOfView({ lat: points[0].lat, lng: points[0].lon, altitude: 2.2 });

      new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      window.addEventListener("resize", resize);
      if (!full) openFullPageOnTap();
      renderSummary(points, stats);
    }

    // A tap on the small globe (not a drag to rotate it) opens the full page
    function openFullPageOnTap() {
      let down = null;
      box.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: Date.now() }));
      box.addEventListener("pointerup", (e) => {
        if (!down) return;
        const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
        if (moved < 6 && Date.now() - down.t < 400) window.location.href = cfg.pageUrl;
        down = null;
      });
      box.title = "View the full visitor statistics";
    }

    function renderSummary(points, stats) {
      const total = (stats && stats.total) || points.reduce((a, p) => a + p.count, 0);
      const byCountry = (stats && stats.countries) || {};
      const nCountries = Object.keys(byCountry).length;
      const countriesLabel = `${nCountries.toLocaleString()} ${nCountries === 1 ? "country" : "countries"}`;
      let html = `<div class="visitor-map-totals">${plural(total, "visit")} &middot; ${plural(points.length, "place")} &middot; ${countriesLabel}</div>`;
      if (full) {
        html += '<div class="visitor-map-cols">';
        html += column("Countries / regions", top(byCountry, Infinity), (k) => `${flag(k)} ${esc(countryName(k))}`);
        html += column("Top sources", top((stats && stats.refs) || {}, 10), (k) => (k === "direct" ? "Direct / bookmark" : esc(k)));
        html += column("Browsers", top((stats && stats.browsers) || {}, 6), esc);
        html += "</div>";
      } else {
        html += `<a class="visitor-map-more" href="${cfg.pageUrl}">Full statistics &rarr;</a>`;
      }
      summary.innerHTML = html;
    }

    function top(obj, n) {
      return Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
    }

    function column(title, rows, label) {
      const items = rows.map(([k, v]) => `<li><span>${label(k)}</span><b>${v.toLocaleString()}</b></li>`).join("") || '<li class="visitor-map-empty">No data yet</li>';
      return `<div class="visitor-map-col"><h4>${title}</h4><ul>${items}</ul></div>`;
    }

    function start() {
      if (started) return resize();
      started = true;
      box.innerHTML = '<p class="visitor-map-loading">Loading globe…</p>';
      Promise.all([
        loadGlobeLibrary(),
        fetchJson("/points"),
        fetchJson("/stats").catch(() => null),
        fetch(cfg.countriesUrl).then((r) => r.json()).catch(() => ({ features: [] })),
      ])
        .then(([, points, stats, countries]) => render(points, stats, countries))
        .catch(() => {
          box.innerHTML = '<p class="visitor-map-loading">Visitor data is unavailable right now.</p>';
          started = false;
        });
    }

    if (full) {
      start();
    } else if (toggle) {
      toggle.addEventListener("click", () => {
        const open = box.hidden;
        box.hidden = !open;
        summary.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "✕ Hide visitor map" : "🌍 Where are my visitors?";
        if (open) start();
      });
    }
  }

  // ------------------------------------------------------------------ owner log
  function setupOwnerPanel() {
    if (location.hash.toLowerCase() !== "#owner" || document.getElementById("visitor-owner")) return;
    let key = "";
    try {
      key = sessionStorage.getItem("vm_key") || "";
    } catch (e) {}
    if (!key) key = window.prompt("Owner key:") || "";
    if (key) loadOwnerLog(key);
  }

  function loadOwnerLog(key) {
    fetch(base + "/log?limit=500", { headers: { Authorization: "Bearer " + key } })
      .then((r) => {
        if (r.status === 401) {
          try {
            sessionStorage.removeItem("vm_key");
          } catch (e) {}
          alert("Wrong owner key.");
          return null;
        }
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then((data) => {
        if (!data) return;
        try {
          sessionStorage.setItem("vm_key", key);
          // Visits from a browser that has opened the owner log are not counted
          localStorage.setItem("vm_owner", "1");
        } catch (e) {}
        renderOwnerLog(data, key);
      })
      .catch(() => alert("Could not load the visitor log."));
  }

  function browserOf(ua) {
    ua = ua || "";
    const device = /Mobi|Android|iPhone|iPad/.test(ua) ? " (mobile)" : "";
    if (/Edg\//.test(ua)) return "Edge" + device;
    if (/OPR\/|Opera/.test(ua)) return "Opera" + device;
    if (/Firefox\//.test(ua)) return "Firefox" + device;
    if (/Chrome\//.test(ua)) return "Chrome" + device;
    if (/Safari\//.test(ua)) return "Safari" + device;
    return "Other" + device;
  }

  function renderOwnerLog(data, key) {
    const old = document.getElementById("visitor-owner");
    if (old) old.remove();
    const rows = data.visits
      .map((v) => {
        const place = [v.city, v.region, countryName(v.country)].filter(Boolean).join(", ");
        const net = [v.ip && v.ip.includes(":") ? "IPv6" : "IPv4", v.org].filter(Boolean).join(" · ");
        return `<tr><td>${esc(new Date(v.ts).toLocaleString())}</td><td>${flag(v.country)} ${esc(place || "—")}</td><td class="visitor-owner-ip">${esc(
          v.ip || "—",
        )}</td><td>${esc(net)}</td><td>${esc(v.ref === "direct" ? "Direct" : v.ref || "—")}</td><td>${esc(v.path || "—")}</td><td>${esc(browserOf(v.ua))}</td></tr>`;
      })
      .join("");
    const panel = document.createElement("section");
    panel.id = "visitor-owner";
    panel.className = "visitor-owner";
    panel.innerHTML =
      `<div class="visitor-owner-head"><b>Visitor log</b><span>${data.visits.length.toLocaleString()} most recent of ${Number(data.total).toLocaleString()} visits · your own visits from this browser are not counted</span>` +
      '<button type="button" class="visitor-owner-refresh">Refresh</button><button type="button" class="visitor-owner-close">Close</button></div>' +
      '<div class="visitor-owner-table"><table><thead><tr><th>Time</th><th>Location</th><th>IP</th><th>Network</th><th>From</th><th>Page</th><th>Browser</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">No visits recorded yet.</td></tr>') +
      "</tbody></table></div>";
    const main = document.querySelector('[role="main"]') || document.body;
    main.insertBefore(panel, main.firstChild);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.querySelector(".visitor-owner-refresh").addEventListener("click", () => loadOwnerLog(key));
    panel.querySelector(".visitor-owner-close").addEventListener("click", () => {
      panel.remove();
      history.replaceState(null, "", location.pathname + location.search);
    });
  }

  document.querySelectorAll(".visitor-map").forEach(setupWidget);
  setupOwnerPanel();
  window.addEventListener("hashchange", setupOwnerPanel);
})();
