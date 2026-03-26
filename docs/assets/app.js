// ── Config (overridden by location subpages) ─────────────────────────────
  const DATA_BASE      = window.__DATA_BASE__  || "";
  const LOCATION_PRESET = window.__LOCATION__ || null;

  // ── State ────────────────────────────────────────────────────────────────
  let hourJobs      = [];
  let todayJobs     = [];
  let yesterdayJobs = [];
  let h1bSet        = new Set();
  let prioritySet   = new Set();
  let runHistory    = [];
  let snapshotCache = {};
  let selectedRunId = null;
  let selectedRunJobs = null;

  let period      = "hour";
  let sortBy      = "time";
  let levelFilter = "all";
  let h1bFilter   = false;
  let query       = "";

  // ── Helpers ──────────────────────────────────────────────────────────────
  const AVATAR_COLORS = [
    "#0066FF","#0052cc","#0ea5e9","#059669","#d97706","#dc2626","#7c3aed","#db2777"
  ];
  const avatarColor = s =>
    AVATAR_COLORS[[...(s||"")].reduce((a,c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

  const fmtDate = iso => {
    if (!iso || iso === "null") return null;
    const d = new Date(iso), n = new Date();
    const sameDay = (a, b) =>
      a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    if (sameDay(d, n)) return "Today";
    const yest = new Date(n - 86400000);
    if (sameDay(d, yest)) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const scoreColor = s => s >= 12 ? "score-hi" : s >= 6 ? "score-md" : "";

  const fmtBatch = iso => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  };

  const levelClass = l => ({ "New Grad": "badge-ng", "Mid": "badge-mid" }[l] || "badge-entry");

  const SOURCE_LABEL = {
    linkedin:    ["LinkedIn",    "badge-src-linkedin"],
    google:      ["Google",      "badge-src-google"],
    indeed:      ["Indeed",      "badge-src-indeed"],
    glassdoor:   ["Glassdoor",   "badge-src-glassdoor"],
    zip_recruiter:["ZipRecruiter","badge-src-zip"],
  };
  const srcBadge = site => {
    const [label, cls] = SOURCE_LABEL[site] || [];
    return label ? `<span class="badge badge-src ${cls}">${label}</span>` : "";
  };

  // Build a lookup set from a jobs array keyed by job_url
  const urlSet = jobs => new Set(jobs.map(j => j.job_url).filter(Boolean));

  // ── Render ───────────────────────────────────────────────────────────────
  function activeJobs() {
    if (selectedRunJobs !== null) return selectedRunJobs;
    return { hour: hourJobs, today: todayJobs, yesterday: yesterdayJobs }[period] || [];
  }

  function render() {
    let jobs = [...activeJobs()];

    // Level filter
    if (levelFilter !== "all") {
      jobs = jobs.filter(j => (j.level || "Entry") === levelFilter);
    }

    // H1B filter
    if (h1bFilter) {
      jobs = jobs.filter(j => h1bSet.has(j.job_url));
    }


    // Location filter (set by /NewYork, /California, /NorthCarolina subpages)
    if (LOCATION_PRESET) {
      const terms = LOCATION_PRESET.terms;
      jobs = jobs.filter(j => {
        const loc = (j.location || "").toLowerCase();
        return terms.some(t => loc.includes(t));
      });
    }

    // Search
    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter(j =>
        (j.title    || "").toLowerCase().includes(q) ||
        (j.company  || "").toLowerCase().includes(q) ||
        (j.location || "").toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy === "score") {
      jobs.sort((a, b) => (b.score ?? b.priority_score ?? 0) - (a.score ?? a.priority_score ?? 0));
    } else {
      // Prefer batch_time (when pipeline found it) over date_posted (LinkedIn date)
      jobs.sort((a, b) => {
        const ta = (a.batch_time || a.date_posted) ? new Date(a.batch_time || a.date_posted).getTime() : 0;
        const tb = (b.batch_time || b.date_posted) ? new Date(b.batch_time || b.date_posted).getTime() : 0;
        return tb - ta;
      });
    }

    const list = document.getElementById("job-list");
    const meta = document.getElementById("result-meta");

    if (!jobs.length) {
      const msgs = {
        hour:      "Nothing new this hour. Next run in a bit.",
        today:     "No jobs loaded for today yet.",
        yesterday: "No data for yesterday.",
      };
      list.innerHTML = `<div class="state-msg"><div class="icon">🔍</div>${msgs[period] || "No results."}<div class="sub">Try clearing the search or changing the level filter.</div></div>`;
      meta.textContent = "";
      return;
    }

    const ngCount = jobs.filter(j => j.level === "New Grad").length;
    meta.textContent = `${jobs.length} job${jobs.length !== 1 ? "s" : ""}${ngCount ? ` · ${ngCount} New Grad` : ""}`;

    list.innerHTML = jobs.map((j, i) => {
      const co      = j.company || "—";
      const initial = co.charAt(0).toUpperCase();
      const color   = avatarColor(co);
      const score   = j.score ?? j.priority_score ?? 0;
      const lvl     = j.level || "Entry";
      const posted  = fmtDate(j.date_posted);
      const batch   = fmtBatch(j.batch_time);
      const isNew   = posted === "Today";
      const isH1b   = h1bSet.has(j.job_url);
      const isPri   = prioritySet.has(j.job_url);
      const top     = i < 3 && score >= 8;
      const src     = (j.site || "").toLowerCase();

      const dateClass = isNew ? "job-date fresh" : "job-date";
      return `<div class="job-card${top ? " top" : ""}">
        <div class="avatar" style="background:${color}">${initial}</div>
        <div class="job-main">
          <div class="job-title">
            ${j.title || "—"}
            ${isNew ? `<span class="badge badge-new">NEW</span>` : ""}
            ${isH1b ? `<span class="badge badge-h1b">H1B ✓</span>` : ""}
            ${isPri ? `<span class="badge badge-pri">Priority</span>` : ""}
            ${srcBadge(src)}
          </div>
          <div class="job-meta">
            <span style="font-weight:500;color:var(--text-2)">${co}</span>
            <span class="sep">·</span>
            <span>${j.location || "Remote"}</span>
            <span class="sep">·</span>
            <span class="badge ${levelClass(lvl)}">${lvl}</span>
            ${batch ? `<span class="sep">·</span><span style="color:var(--accent);font-weight:600">⏱ ${batch}</span>` : ""}
          </div>
        </div>
        <div class="job-right">
          ${posted ? `<div class="${dateClass}">${posted}</div>` : ""}
          <div class="job-score">
            <span class="star">★</span>
            <span class="${scoreColor(score)}">${score}</span>
          </div>
          ${j.job_url
            ? `<a class="apply-btn" href="${j.job_url}" target="_blank" rel="noopener">Apply ↗</a>`
            : `<span style="font-size:12px;color:var(--muted)">—</span>`}
        </div>
      </div>`;
    }).join("");
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  function updateKpis() {
    const hc = hourJobs.length;
    const tc = todayJobs.length;
    const ng = todayJobs.filter(j => j.level === "New Grad").length;
    const best = [...todayJobs].sort((a,b) =>
      (b.score ?? b.priority_score ?? 0) - (a.score ?? a.priority_score ?? 0)
    )[0];

    document.getElementById("kpi-hour").textContent  = hc;
    document.getElementById("kpi-today").textContent = tc || hc;
    document.getElementById("kpi-newgrad").textContent = ng;
    document.getElementById("kpi-score").textContent   = best ? (best.score ?? best.priority_score ?? 0) : "—";
    document.getElementById("kpi-score-sub").textContent = best
      ? ((best.title || "").slice(0, 22) + (best.title?.length > 22 ? "…" : ""))
      : "";

    const hrNg = hourJobs.filter(j => j.level === "New Grad").length;
    document.getElementById("kpi-hour-sub").textContent = hrNg ? `${hrNg} New Grad` : hc > 0 ? "all entry level" : "check back soon";
    document.getElementById("kpi-today-sub").textContent = tc > 0 ? `across ${Math.ceil(tc / Math.max(hc,1))} runs` : "";

    // Tab counts
    document.getElementById("tab-count-hour").textContent      = hc  ? hc  : "";
    document.getElementById("tab-count-today").textContent     = tc  ? tc  : "";
    document.getElementById("tab-count-yesterday").textContent = yesterdayJobs.length ? yesterdayJobs.length : "";
  }

  // ── Events ───────────────────────────────────────────────────────────────
  function onSearch(val) { query = val.trim(); render(); }

  document.querySelectorAll(".period-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".period-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      period = btn.dataset.period;
      // Clear selected run when switching period tabs
      selectedRunId = null;
      selectedRunJobs = null;
      document.querySelectorAll(".run-card").forEach(c => c.classList.remove("active"));
      render();
    });
  });

  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sortBy = btn.dataset.sort;
      render();
    });
  });

  document.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      levelFilter = btn.dataset.level;
      render();
    });
  });

  document.getElementById("chip-h1b").addEventListener("click", function() {
    h1bFilter = !h1bFilter;
    this.classList.toggle("active", h1bFilter);
    render();
  });

  // ── Run history strip ─────────────────────────────────────────────────────
  function fmtHour(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  }

  function renderRunCards() {
    const strip = document.getElementById("run-strip");
    if (!runHistory.length) { strip.innerHTML = ""; return; }

    // Group by hour bucket, prefer standard pipeline
    const buckets = new Map();
    [...runHistory].reverse().forEach(entry => {
      const d = new Date(entry.run_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
      if (!buckets.has(key) || entry.pipeline === "standard") {
        buckets.set(key, entry);
      }
    });

    const cards = [...buckets.values()].slice(0, 24);

    strip.innerHTML = cards.map(entry => {
      const isActive = selectedRunId === entry.session_id;
      return `<button class="run-card${isActive ? " active" : ""}" data-sid="${entry.session_id}" data-snap="${entry.snapshot_file || ""}">
        <span class="run-card-time">${fmtHour(entry.run_at)}</span>
        <span class="run-card-count">${entry.total_jobs} jobs</span>
      </button>`;
    }).join("");

    strip.querySelectorAll(".run-card").forEach(card => {
      card.addEventListener("click", async () => {
        const sid  = card.dataset.sid;
        const snap = card.dataset.snap;

        // Toggle off if already selected
        if (selectedRunId === sid) {
          selectedRunId   = null;
          selectedRunJobs = null;
          card.classList.remove("active");
          // Re-activate the current period tab
          document.querySelectorAll(".period-tab").forEach(b => {
            b.classList.toggle("active", b.dataset.period === period);
          });
          render();
          return;
        }

        selectedRunId = sid;
        strip.querySelectorAll(".run-card").forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        // Deactivate period tabs visually (snapshot mode)
        document.querySelectorAll(".period-tab").forEach(b => b.classList.remove("active"));

        if (!snap) { selectedRunJobs = []; render(); return; }

        if (snapshotCache[snap]) {
          selectedRunJobs = snapshotCache[snap];
          render();
          return;
        }

        // Show loading
        document.getElementById("job-list").innerHTML =
          `<div class="state-msg"><div class="icon">⏳</div>Loading snapshot…</div>`;
        try {
          const data = await fetch(DATA_BASE + `runs/${snap}`).then(r => r.json());
          snapshotCache[snap] = data;
          selectedRunJobs = data;
        } catch {
          selectedRunJobs = [];
        }
        render();
      });
    });
  }

  // ── Load ─────────────────────────────────────────────────────────────────
  async function loadAll() {
    try {
      const [meta, hour, today, yesterday, important, h1b, history] = await Promise.all([
        fetch(DATA_BASE + "metadata.json").then(r => r.json()).catch(() => ({})),
        fetch(DATA_BASE + "jobs.json").then(r => r.json()).catch(() => []),
        fetch(DATA_BASE + "today_jobs.json").then(r => r.json()).catch(() => []),
        fetch(DATA_BASE + "yesterday_jobs.json").then(r => r.json()).catch(() => []),
        fetch(DATA_BASE + "important_jobs.json").then(r => r.json()).catch(() => []),
        fetch(DATA_BASE + "h1b2026_jobs.json").then(r => r.json()).catch(() => []),
        fetch(DATA_BASE + "run_history.json").then(r => r.json()).catch(() => []),
      ]);

      hourJobs      = hour      || [];
      todayJobs     = today.length ? today : hourJobs;
      yesterdayJobs = yesterday || [];
      h1bSet        = urlSet(h1b);
      prioritySet   = urlSet(important);
      runHistory    = history  || [];

      // Header timestamp
      if (meta.last_updated) {
        const d = new Date(meta.last_updated);
        document.getElementById("last-run-text").textContent =
          "Updated " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      }


  // Update header subtitle if filtered to a location
  if (LOCATION_PRESET) {
    const sub = document.querySelector(".logo-sub");
    if (sub) sub.textContent = LOCATION_PRESET.label + " Jobs";
    document.title = "Atriveo · " + LOCATION_PRESET.label + " Jobs";
    const backLink = document.getElementById("loc-back-link");
    if (backLink) backLink.style.display = "";
  }

      updateKpis();
      renderRunCards();
      render();
    } catch (err) {
      document.getElementById("job-list").innerHTML =
        `<div class="state-msg"><div class="icon">⚠️</div>Could not load job data.<div class="sub">${err.message}</div></div>`;
    }
  }

  loadAll();