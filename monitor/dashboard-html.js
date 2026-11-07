export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>usim_cms monitor</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  h3 { margin-top: 1.6rem; }
  button { cursor: pointer; padding: 0.3rem 0.7rem; margin: 0.15rem 0.15rem 0.15rem 0; border-radius: 6px; border: 1px solid #8884; background: #0071e3; color: #fff; font-size: 0.85rem; }
  button.secondary { background: transparent; color: inherit; }
  button.danger { background: #d32f2f; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .muted { opacity: 0.7; font-size: 0.85rem; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.7rem; margin: 0.8rem 0; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 0.6rem 0.8rem; }
  .card .label { font-size: 0.72rem; opacity: 0.65; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 1.1rem; font-weight: 600; margin: .15rem 0 .4rem; }
  .meter { height: 8px; border-radius: 999px; background: #8882; overflow: hidden; }
  .meter > span { display: block; height: 100%; border-radius: 999px; transition: width .5s; }
  .meter.ok > span { background: #2e7d32; }
  .meter.warn > span { background: #f9a825; }
  .meter.bad > span { background: #d32f2f; }

  .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem; margin: 0.6rem 0; }
  .svc-card { border: 1px solid #8884; border-radius: 10px; padding: 0.7rem 0.8rem; }
  .svc-head { display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.3rem; }
  .svc-head b { font-size: 0.95rem; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; background: #8888; flex: none; }
  .dot.up { background: #2e7d32; box-shadow: 0 0 6px #2e7d3299; }
  .dot.down { background: #d32f2f; box-shadow: 0 0 6px #d32f2f99; }
  .history { display: flex; gap: 2px; margin: 0.4rem 0; }
  .history span { width: 6px; height: 14px; border-radius: 2px; background: #8884; }
  .history span.up { background: #2e7d32; }
  .history span.down { background: #d32f2f; }

  .term { background: #0d1117; color: #c9d1d9; border-radius: 8px; padding: 0.75rem; max-height: 300px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; white-space: pre-wrap; }
  .t-head { color: #79c0ff; }
  .t-head2 { color: #d2a8ff; font-weight: 600; }
  .t-err { color: #ff7b72; }
  .t-ok { color: #7ee787; }

  .progress-track { height: 6px; border-radius: 999px; background: #8882; overflow: hidden; margin: .5rem 0; }
  .progress-fill { height: 100%; width: 0; border-radius: 999px; background: #0071e3; }
  .progress-fill.running { width: 40%; animation: indet 1.1s ease-in-out infinite; transform-origin: left; }
  .progress-fill.success { width: 100%; background: #2e7d32; }
  .progress-fill.fail { width: 100%; background: #d32f2f; }
  @keyframes indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }

  .tabs { display: flex; gap: 0.2rem; margin: 1.2rem 0 0; border-bottom: 1px solid #8884; overflow-x: auto; }
  .tab-btn { background: transparent; color: inherit; border: none; border-radius: 8px 8px 0 0; padding: 0.5rem 0.9rem; font-size: 0.85rem; font-weight: 500; opacity: 0.6; margin: 0; white-space: nowrap; }
  .tab-btn:hover { opacity: 0.9; background: #8882; }
  .tab-btn.active { opacity: 1; background: #8883; font-weight: 600; }
  .tab-panel { display: none; padding-top: 1rem; }
  .tab-panel.active { display: block; }

  .role-badge { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 0.12rem 0.5rem; border-radius: 999px; background: #0071e322; color: #0071e3; white-space: nowrap; }
  .container-desc { max-width: 340px; }
  .account-field { display:block; margin:0.55rem 0; }
  .account-field input { display:block; box-sizing:border-box; width:100%; max-width:380px; padding:0.45rem; border:1px solid #8886; border-radius:6px; background:transparent; color:inherit; }
  .security-status { font-weight:700; padding:0.65rem 0.85rem; border-radius:8px; background:#ecf5f0; border:1px solid #b4d9c8; }
  .security-status.attention { background:#fff0ea; border-color:#eebbaa; color:#873b2c; }
  .security-status.unknown { background:#fff6e4; border-color:#e8cb8e; color:#765a19; }
  .security-list { display:grid; gap:0.65rem; margin:1rem 0; }
  .security-item { padding:0.75rem 0.9rem; border:1px solid var(--line); border-radius:8px; background:var(--surface); }
  .security-item strong { display:block; }
  .security-item small { color:var(--muted); }

  /* The monitor is an operations console: navigation stays visible while
     the work area can grow with logs, sites, and infrastructure controls. */
  :root { color-scheme: light; --ink:#18303d; --muted:#627783; --line:#dce6ea; --paper:#f3f7f8; --surface:#fff; --nav:#102b38; --accent:#16735f; }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body { max-width:none; min-height:100dvh; margin:0; padding:0; background:var(--paper); color:var(--ink); font-family:"Segoe UI Variable","Aptos","Segoe UI",system-ui,sans-serif; line-height:1.5; }
  h1 { margin:0; font-size:clamp(1.55rem,2.5vw,2.2rem); line-height:1.14; letter-spacing:-0.045em; font-weight:700; }
  h3 { margin:1.8rem 0 0.55rem; font-size:1.08rem; letter-spacing:-0.025em; }
  p { max-width:72ch; }
  button { min-height:2.35rem; padding:0.45rem 0.85rem; border:1px solid #126652; border-radius:7px; background:var(--accent); color:#fff; font-family:inherit; font-size:0.83rem; font-weight:600; line-height:1.3; transition:background .18s ease,transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
  button:hover:not(:disabled) { background:#105b4c; border-color:#105b4c; }
  button:active:not(:disabled) { transform:translateY(1px); }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:3px solid #7ac8ad; outline-offset:2px; }
  button.secondary { background:#fff; color:var(--ink); border-color:#cbd9df; }
  button.secondary:hover:not(:disabled) { background:#edf4f4; border-color:#9eb8bd; }
  button.danger { background:#a63838; border-color:#a63838; }
  button.danger:hover:not(:disabled) { background:#872e2e; border-color:#872e2e; }
  .muted { color:var(--muted); opacity:1; }
  .row { gap:0.55rem; }
  .app-shell { display:grid; grid-template-columns:15.75rem minmax(0,1fr); min-height:100dvh; }
  .sidebar { position:sticky; top:0; display:flex; flex-direction:column; height:100dvh; overflow-y:auto; padding:1.4rem 0.85rem 1rem; background:var(--nav); color:#c5d6dc; border-right:1px solid #214352; }
  .brand { display:flex; align-items:center; gap:0.7rem; padding:0.25rem 0.7rem 1.45rem; color:#fff; text-decoration:none; }
  .brand-mark { display:grid; place-items:center; width:2.3rem; height:2.3rem; border-radius:9px; background:#267e68; color:#fff; font-size:0.8rem; font-weight:800; letter-spacing:-0.08em; box-shadow:0 7px 18px #061c2755; }
  .brand strong { display:block; font-size:0.94rem; letter-spacing:-0.025em; line-height:1.2; }
  .brand small { display:block; margin-top:0.14rem; color:#9fb9c2; font-size:0.67rem; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; }
  .nav-label { margin:1.2rem 0 0.4rem; padding:0 0.75rem; color:#7fa0ad; font-size:0.66rem; font-weight:700; letter-spacing:0.13em; text-transform:uppercase; }
  .tabs { display:flex; flex-direction:column; gap:0.15rem; margin:0; border:0; overflow:visible; }
  .tab-btn { display:flex; align-items:center; gap:0.8rem; width:100%; min-height:2.8rem; margin:0; padding:0.55rem 0.75rem; border:1px solid transparent; border-radius:8px; background:transparent; color:#c9d9de; opacity:1; text-align:left; font-size:0.85rem; font-weight:500; white-space:normal; }
  .tab-btn:hover:not(:disabled) { background:#1c4050; border-color:transparent; color:#fff; }
  .tab-btn.active { background:#244b59; border-color:#355d68; color:#fff; box-shadow:inset 3px 0 #69c9a6; font-weight:650; }
  .nav-index { display:grid; place-items:center; flex:none; width:1.55rem; height:1.55rem; border:1px solid #496777; border-radius:5px; color:#9bb8c0; font:600 0.67rem ui-monospace,Consolas,monospace; }
  .tab-btn.active .nav-index { border-color:#6ac9a6; color:#a5ead3; }
  .nav-count { display:inline-block; margin-left:auto; min-width:1.35rem; padding:0.06rem 0.32rem; border-radius:5px; background:#bd7950; color:#fff; font:700 0.68rem ui-monospace,Consolas,monospace; text-align:center; }
  .sidebar-footer { margin-top:auto; padding:1.35rem 0.75rem 0; border-top:1px solid #32505c; font-size:0.76rem; }
  .sidebar-footer p { margin:0.25rem 0; }
  .sidebar-footer .muted { color:#9eb6be; }
  .workspace { min-width:0; }
  .workspace-header { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:1.25rem; min-height:7.2rem; padding:1.15rem clamp(1.1rem,3.2vw,3rem); border-bottom:1px solid var(--line); background:#ffffffed; backdrop-filter:blur(12px); }
  .workspace-heading { min-width:0; flex:1; }
  .eyebrow { display:block; margin-bottom:0.32rem; color:#4e7c78; font-size:0.66rem; font-weight:750; letter-spacing:0.16em; text-transform:uppercase; }
  .workspace-description { margin:0.28rem 0 0; color:var(--muted); font-size:0.82rem; }
  .header-tools { display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap; justify-content:flex-end; }
  .mode-chip { display:inline-flex; align-items:center; gap:0.42rem; min-height:2.1rem; padding:0.35rem 0.72rem; border:1px solid #d3e4de; border-radius:6px; background:#ecf5f0; color:#225c4b; font-size:0.73rem; font-weight:650; white-space:nowrap; }
  .mode-chip::before { content:""; width:0.42rem; height:0.42rem; border-radius:50%; background:#719d98; }
  .sidebar-toggle { display:none; width:2.5rem; min-width:2.5rem; padding:0; font-size:1.15rem; }
  .sidebar-backdrop { display:none; }
  .skip-link { position:fixed; z-index:50; top:-4rem; left:1rem; padding:0.55rem 0.8rem; border-radius:6px; background:#fff; color:var(--ink); }
  .skip-link:focus { top:0.7rem; }
  .main-content { max-width:94rem; margin:0 auto; padding:clamp(1.15rem,2.5vw,2.25rem) clamp(1.1rem,3.2vw,3rem) 4rem; }
  .tab-panel { display:none; padding-top:0; animation:panel-in .22s ease-out; }
  .tab-panel.active { display:block; }
  .tab-panel > h3:first-child { margin-top:0; }
  .section-intro + h3 { margin-top:0.4rem; }
  @keyframes panel-in { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
  .section-intro { margin:0 0 1.2rem; color:var(--muted); font-size:0.86rem; }
  .section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; margin:1.7rem 0 0.7rem; }
  .section-head h3 { margin:0; }
  .grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr)); gap:0.8rem; margin:0 0 1.1rem; }
  .card, .svc-card { border:1px solid #dce7e8; border-radius:11px; background:var(--surface); box-shadow:0 5px 18px #183f4b09; }
  .card { min-height:7.2rem; padding:1rem 1.1rem; }
  .card .label { color:#607b83; opacity:1; font-size:0.66rem; font-weight:700; letter-spacing:0.11em; }
  .card .value { margin:0.45rem 0 0.65rem; color:var(--ink); font-size:1.25rem; font-variant-numeric:tabular-nums; }
  .services-grid { grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr)); gap:0.8rem; margin:0.7rem 0; }
  .svc-card { padding:0.95rem 1rem; }
  .svc-head { margin-bottom:0.45rem; }
  .dot { width:9px; height:9px; }
  .meter { height:7px; background:#e6edef; }
  .action-panel { padding:1.1rem 1.2rem; border:1px solid #dce7e8; border-radius:11px; background:#fff; box-shadow:0 5px 18px #183f4b09; }
  .action-panel .row { margin-top:0.75rem; }
  .action-panel h3 { margin:0; }
  .action-panel p { margin:0.3rem 0 0; }
  .notice { margin:0 0 0.8rem; padding:0.85rem 1rem; border:1px solid #eadcae; border-left:4px solid #bf9253; border-radius:8px; background:#fff8e9; color:#5a442d; font-size:0.84rem; }
  .notice code { color:inherit; }
  .term { max-height:27rem; border-radius:9px; background:#132632; color:#d6e5e6; line-height:1.55; }
  .progress-track { height:7px; background:#e1e8e9; }
  .progress-fill { background:var(--accent); }
  .progress-fill.running { width:40%; }
  .role-badge { border-radius:5px; background:#e6f2ed; color:#236851; }
  .account-field { color:#365360; font-size:0.8rem; font-weight:600; }
  .account-field input { margin-top:0.25rem; min-height:2.45rem; border-color:#cddde0; background:#fff; font:inherit; }
  .tab-panel table { margin:0.7rem 0 1.1rem; background:#fff; border-radius:8px; }
  #panel-containers { overflow-x:auto; }
  #containersTable { min-width:53rem; }
  #git { margin-top:2rem; color:#8da1aa; font:0.69rem ui-monospace,Consolas,monospace; }
  @media (max-width:860px) {
    .app-shell { display:block; }
    .sidebar { position:fixed; z-index:30; left:0; width:min(18rem,82vw); transform:translateX(-101%); transition:transform .24s ease; box-shadow:12px 0 28px #0b243044; }
    body.nav-open .sidebar { transform:translateX(0); }
    .sidebar-backdrop { position:fixed; z-index:20; inset:0; border:0; border-radius:0; background:#0b253895; }
    body.nav-open .sidebar-backdrop { display:block; }
    .sidebar-backdrop:hover:not(:disabled) { border:0; background:#0b253895; }
    body.nav-open { overflow:hidden; }
    .sidebar-toggle { display:inline-grid; place-items:center; }
    .workspace-header { min-height:6rem; }
  }
  @media (max-width:620px) {
    .workspace-header { align-items:flex-start; flex-wrap:wrap; gap:0.65rem; }
    .workspace-heading { flex:1 1 calc(100% - 3.5rem); }
    .header-tools { width:100%; justify-content:flex-start; padding-left:3rem; }
    .workspace-description { font-size:0.76rem; }
    .main-content { padding-bottom:2.5rem; }
    .action-panel { padding:0.9rem; }
    .tab-panel input, .tab-panel select, .tab-panel textarea { max-width:100%; min-width:0 !important; }
    .tab-panel .row > input { flex:1 1 100%; }
  }
  @media (prefers-reduced-motion:reduce) {
    *, *::before, *::after { scroll-behavior:auto !important; animation-duration:0.01ms !important; transition-duration:0.01ms !important; }
  }
</style>
</head>
<body>
<a class="skip-link" href="#mainContent">Skip to content</a>
<div class="app-shell">
  <aside class="sidebar" id="sidebar">
    <div class="brand"><span class="brand-mark">UC</span><span><strong>usim_cms</strong><small>Server monitor</small></span></div>
    <nav class="tabs" id="tabs" aria-label="Monitor sections">
      <p class="nav-label">Workspace</p>
      <button class="tab-btn active" data-tab="overview" aria-current="page"><span class="nav-index">01</span>Overview</button>
      <button class="tab-btn" data-tab="deploy"><span class="nav-index">02</span>Deployments<span class="nav-count" id="updateCount" style="display:none"></span></button>
      <p class="nav-label">Infrastructure</p>
      <button class="tab-btn" data-tab="stack"><span class="nav-index">03</span>Stack &amp; versions</button>
      <button class="tab-btn" data-tab="containers"><span class="nav-index">04</span>Containers</button>
      <button class="tab-btn" data-tab="data"><span class="nav-index">05</span>Database &amp; sites</button>
      <button class="tab-btn" data-tab="storage"><span class="nav-index">06</span>Storage &amp; backups</button>
      <button class="tab-btn" data-tab="logs"><span class="nav-index">07</span>Logs</button>
      <p class="nav-label">Access &amp; security</p>
      <button class="tab-btn" data-tab="security"><span class="nav-index">08</span>Security status</button>
      <button class="tab-btn" data-tab="ssl"><span class="nav-index">09</span>SSL certificates</button>
      <button class="tab-btn" data-tab="accounts"><span class="nav-index">10</span>Accounts</button>
    </nav>
    <div class="sidebar-footer"><p>HOST RUNTIME</p><p class="muted" id="uptime">Loading…</p><p class="muted">Privileged operations console</p></div>
  </aside>
  <button class="sidebar-backdrop" data-action="close-sidebar" aria-label="Close navigation"></button>
  <div class="workspace">
    <header class="workspace-header">
      <button class="sidebar-toggle secondary" data-action="toggle-sidebar" id="sidebarToggle" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">☰</button>
      <div class="workspace-heading"><span class="eyebrow">Operations / Monitor</span><h1 id="pageTitle">Overview</h1><p class="workspace-description" id="pageDescription">Health, capacity and service availability at a glance.</p></div>
      <div class="header-tools"><span class="mode-chip" id="mode">Loading…</span><button class="secondary" data-action="refresh">Refresh now</button></div>
    </header>
    <main class="main-content" id="mainContent">
      <div id="updateBanner" class="notice" style="display:none"></div>
      <div id="alertWebhookBanner" class="notice" style="display:none">
        <b>No alert webhook configured.</b> Service and disk alerts have no recipient. Set <code>ALERT_WEBHOOK_URL</code> in <code>/etc/ucms-monitor.env</code> and restart <code>ucms-monitor</code>.
      </div>

<div class="tab-panel active" id="panel-overview">
  <p class="section-intro">Current host usage and the services answering traffic.</p>
  <div class="grid" id="hostGrid"></div>
  <div class="section-head"><h3>Services</h3><span class="muted">Live status</span></div>
  <div class="services-grid" id="services"></div>
  <div id="alertTestSection" style="display:none">
    <div class="section-head"><h3>Alerts</h3><span class="muted">Service, disk and backup alerts go to <code>ALERT_WEBHOOK_URL</code></span></div>
    <div class="row"><button class="secondary" data-action="send-test-alert">Send test alert</button><span class="muted" id="alertTestMsg" role="status"></span></div>
  </div>
</div>

<div class="tab-panel" id="panel-deploy">
  <p class="section-intro">Promote an update or return to the previous release.</p>
  <div class="action-panel">
    <h3>Release controls</h3>
    <p class="muted">Deployment checks the new release before switching traffic.</p>
    <div class="row">
      <button data-action="pull">Pull latest &amp; deploy</button>
      <button class="secondary" data-action="rollback">Rollback</button>
      <button class="secondary" data-action="git-sync">Sync local commits to GitHub</button>
    </div>
    <p class="muted">To refresh the app services, use Pull latest &amp; deploy; it checks the release before switching traffic. Restarting every service would interrupt the shared database and proxy on this single VPS, so that action is unavailable. Postgres, Redis and Caddy patch refreshes are under Stack &amp; versions, with a brief confirmed outage.</p>
    <p class="muted">Sync local commits to GitHub pushes anything this VPS committed itself (e.g. a dependency update whose automatic push failed) up to GitHub. It refuses if GitHub also has new commits this VPS hasn't deployed yet — that case needs Pull latest &amp; deploy, or Claude's help, instead.</p>
  </div>
  <div class="section-head"><h3>Deployment activity</h3></div>
  <p class="muted" id="deployState">No deploy run yet.</p>
  <div class="progress-track" id="deployTrack" style="display:none"><div class="progress-fill" id="deployFill"></div></div>
  <pre class="term" id="deployLog" style="display:none"></pre>
</div>

<div class="tab-panel" id="panel-stack">
  <h3>Tech stack &amp; versions</h3>
  <p class="muted" id="versionGitLine"></p>
  <div class="grid" id="versionGrid"></div>
</div>

<div class="tab-panel" id="panel-security">
  <p class="section-intro">Dependency advisories for the checked-out release. Registry checks are cached for ten minutes; a failed audit is shown as unknown and blocks deployment.</p>
  <div class="row"><button class="secondary" data-action="refresh-security">Refresh security check</button><span class="muted" id="securityCheckedAt"></span></div>
  <p class="security-status unknown" id="securityStatus">Checking dependency security…</p>
  <h3>Five packages from the review</h3>
  <div class="security-list" id="trackedSecurity"></div>
  <h3>Registry audit</h3>
  <div class="grid" id="securityAuditSummary"></div>
  <div class="security-list" id="securityAdvisories"></div>
  <h3>Recommended actions</h3>
  <ul id="securityRecommendations"></ul>
</div>

<div class="tab-panel" id="panel-containers">
  <h3>All containers (system-wide, every compose project)</h3>
  <p class="muted">Unlike Services (which only ever asks about this repo's base project + whichever blue/green color is currently promoted), this is a plain <code>docker ps -a</code> — it shows a leftover trial-mode or otherwise-orphaned container too, which could still be answering real traffic and re-writing the frontend's Redis html-cache with stale output even right after a normal deploy.</p>
  <p id="containersWarning" style="display:none; margin: 0.5rem 0; padding: 0.5rem 0.8rem; border-radius: 8px; background: #b45309; color: #fff; font-weight: 600;"></p>
  <table id="containersTable" style="width:100%; border-collapse: collapse;">
    <thead>
      <tr class="muted" style="text-align:left; font-size:0.72rem; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid #8884;">
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Container</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Role</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">What it does</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Status</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Image</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Created</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>

<div class="tab-panel" id="panel-data">
  <h3>Database</h3>
  <div class="row">
    <span class="dot" id="dbDot"></span>
    <span class="muted" id="dbStatus">checking…</span>
    <button class="secondary" id="dbRestartBtn" data-action="db-restart">Restart DB</button>
  </div>

  <h3>Sites (uploads folder size per tenant)</h3>
  <p class="muted">Folder name is the tenant's slug (lowercase, non-alphanumeric replaced with <code>_</code>), not its full hostname — this dashboard has no database access to translate it back.</p>
  <table id="sitesTable" style="width:100%; border-collapse: collapse;"><tbody></tbody></table>
</div>

<div class="tab-panel" id="panel-storage">
  <p class="section-intro">Docker usage, per-database size and the nightly backup destination.</p>

  <h3>Docker disk usage</h3>
  <p class="muted">What's actually using disk under Docker — images, stopped containers, volumes, and build cache. Every deploy trims build cache to BUILD_CACHE_MAX (default 5GB, least recently used first) and removes unused images (see the deployment skill's disk-hygiene note); this is for checking in between, or diagnosing a spike.</p>
  <table id="diskUsageTable" style="width:100%; border-collapse: collapse;">
    <thead>
      <tr class="muted" style="text-align:left; font-size:0.72rem; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid #8884;">
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Type</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Total</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0;">Active</th>
        <th style="padding:0.35rem 0.6rem 0.35rem 0; text-align:right;">Size</th>
        <th style="padding:0.35rem 0 0.35rem 0.6rem; text-align:right;">Reclaimable</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  <div class="row">
    <button class="secondary" data-action="refresh-disk-usage">Refresh</button>
    <button class="secondary" data-action="show-disk-usage-detail">Full breakdown (per image/volume)</button>
  </div>
  <pre class="term" id="diskUsageLog" style="display:none"></pre>

  <h3>Postgres database sizes</h3>
  <p class="muted">Real data size per database (control-plane + every tenant's own <code>tenant_&lt;host&gt;</code> database) — separate from the disk usage above, which only sees Docker/OS-level noise and can't tell you if a specific tenant's actual content is what's growing.</p>
  <table id="dbSizesTable" style="width:100%; border-collapse: collapse;"><tbody></tbody></table>
  <div class="row">
    <button class="secondary" data-action="refresh-db-sizes">Refresh</button>
  </div>

  <h3>Last backup</h3>
  <p class="muted" id="backupFreshness">Checking…</p>

  <h3>Backup destination</h3>
  <p class="muted">Where the nightly backup cron (<code>/opt/ucms/backup/run.sh</code>) pushes a copy after the local dump finishes. Same setting as the admin panel's Settings tab — editing it here or there updates the same row.</p>
  <div id="backupCronBanner" style="display:none; margin: 0 0 0.6rem; padding: 0.6rem 0.9rem; border-radius: 8px; background: #f9a825; color: #1a1a1a;"></div>
  <div class="row">
    <select id="backupDestType" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;">
      <option value="local">Local only (no off-site copy)</option>
      <option value="ssh">Remote host (SSH/rsync)</option>
      <option value="s3">S3 / Cloudflare R2</option>
      <option value="gdrive">Google Drive</option>
    </select>
  </div>
  <div id="backupDestFields_ssh" class="row" style="display:none;">
    <input id="backupSshTarget" placeholder="user@host:/path" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit; min-width:260px;" />
  </div>
  <div id="backupDestFields_s3" style="display:none;">
    <div class="row">
      <input id="backupS3Endpoint" placeholder="Endpoint (e.g. https://xxx.r2.cloudflarestorage.com)" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit; min-width:300px;" />
      <input id="backupS3Bucket" placeholder="Bucket" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
      <input id="backupS3Region" placeholder="Region (optional, R2: auto)" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
    </div>
    <div class="row">
      <input id="backupS3AccessKey" placeholder="Access key ID" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
      <input id="backupS3SecretKey" type="password" placeholder="Secret access key" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit; min-width:260px;" />
    </div>
  </div>
  <div id="backupDestFields_gdrive" style="display:none;">
    <div class="row">
      <input id="backupGdriveFolder" placeholder="Shared Google Drive folder ID" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit; min-width:260px;" />
    </div>
    <p class="muted">Share that Drive folder with the service account's own email (<code>client_email</code> inside the JSON below) before saving.</p>
    <textarea id="backupGdriveJson" placeholder="Paste the service-account JSON key here" rows="4" style="width:100%; font-family: ui-monospace, Consolas, monospace; font-size: 0.78rem; padding:0.4rem; border-radius:6px; border:1px solid #8884; background:transparent; color:inherit;"></textarea>
  </div>
  <div class="row">
    <button data-action="save-backup-destination">Save</button>
    <span class="muted" id="backupDestMsg"></span>
  </div>
</div>

<div class="tab-panel" id="panel-ssl">
  <h3>SSL (certbot)</h3>
  <p class="muted">Issues/renews a Let's Encrypt cert for a domain already pointed at this box's nginx — requires certbot + the nginx plugin installed on the host (<code>apt install certbot python3-certbot-nginx</code>). Renewal is handled by certbot's own installed timer, not this dashboard.</p>
  <div class="row">
    <input id="sslDomain" placeholder="admin.example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
    <input id="sslEmail" placeholder="admin@example.com" style="padding:0.3rem 0.5rem;border-radius:6px;border:1px solid #8884;background:transparent;color:inherit;" />
    <button data-action="issue-ssl">Issue certificate</button>
  </div>
  <pre class="term" id="sslLog" style="display:none"></pre>
</div>

<div class="tab-panel" id="panel-logs">
  <h3>Logs</h3>
  <div class="row" id="logButtons"></div>
  <pre class="term" id="logs">Pick a service above to view its logs.</pre>
</div>

<div class="tab-panel" id="panel-accounts">
  <h3>Monitor administrators</h3>
  <p class="muted">Every account can deploy code and control this server. Only add people you trust with full server access. Passwords must be at least 24 bytes.</p>
  <p id="accountsCurrent"></p>
  <div id="accountsList"></div>
  <label class="account-field">Your current password<input id="accountCurrentPassword" type="password" autocomplete="current-password" maxlength="1024" /></label>
  <h3>Change your password</h3>
  <label class="account-field">New password<input id="accountNewPassword" type="password" autocomplete="new-password" maxlength="1024" /></label>
  <label class="account-field">Confirm new password<input id="accountNewConfirm" type="password" autocomplete="new-password" maxlength="1024" /></label>
  <button data-action="change-account-password">Change password</button>
  <h3>Add an administrator</h3>
  <label class="account-field">Username<input id="accountAddUsername" type="text" autocomplete="off" maxlength="32" /></label>
  <label class="account-field">New user's password<input id="accountAddPassword" type="password" autocomplete="new-password" maxlength="1024" /></label>
  <label class="account-field">Confirm password<input id="accountAddConfirm" type="password" autocomplete="new-password" maxlength="1024" /></label>
  <button data-action="add-account">Add administrator</button>
  <p id="accountsMsg" role="status"></p>
</div>

<p id="git" style="opacity:0.35; font-size:0.7rem; margin-top:2rem;"></p>

    </main>
  </div>
</div>

<script>
let SERVICES = [];
let DB_MANAGED = true;
let history = {};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === "string" ? body : (body.error || res.statusText));
  return body;
}

const sectionMeta = {
  overview: ["Overview", "Health, capacity and service availability at a glance."],
  deploy: ["Deployments", "Release controls, rollback and live deployment activity."],
  stack: ["Stack & versions", "Installed software and available upstream updates."],
  containers: ["Containers", "Every container on this host, including older releases."],
  data: ["Database & sites", "Database status and tenant upload folders."],
  storage: ["Storage & backups", "Disk usage, database sizes and backup destination."],
  security: ["Security status", "Vulnerable dependencies, audit results and update advice."],
  logs: ["Logs", "Recent output from each managed service."],
  ssl: ["SSL certificates", "Issue a certificate for a configured domain."],
  accounts: ["Accounts", "Manage monitor administrators and passwords."],
};

function closeSidebar() {
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("sidebarToggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open navigation");
}

function toggleSidebar() {
  const open = document.body.classList.toggle("nav-open");
  const toggle = document.getElementById("sidebarToggle");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
}

function switchTab(name, updateHash = true) {
  if (!Object.hasOwn(sectionMeta, name)) name = "overview";
  for (const btn of document.querySelectorAll(".tab-btn")) {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === "panel-" + name);
  }
  document.getElementById("pageTitle").textContent = sectionMeta[name][0];
  document.getElementById("pageDescription").textContent = sectionMeta[name][1];
  if (updateHash) window.history.replaceState(null, "", "#" + name);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function pctClass(pct) {
  if (pct >= 90) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}

function meterCard(label, pct, sub) {
  const cls = pctClass(pct);
  return "<div class=\\"card\\"><div class=\\"label\\">" + label + "</div>" +
    "<div class=\\"value\\">" + pct + "% <span class=\\"muted\\">" + sub + "</span></div>" +
    "<div class=\\"meter " + cls + "\\"><span style=\\"width:" + pct + "%\\"></span></div></div>";
}

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

async function refreshSites() {
  try {
    const data = await api("/api/sites");
    const tbody = document.querySelector("#sitesTable tbody");
    tbody.innerHTML = "";
    const sites = data.sites || [];
    if (!sites.length) {
      tbody.innerHTML = "<tr><td class=\\"muted\\">No uploads folders found yet.</td></tr>";
      return;
    }
    const max = Math.max(...sites.map((s) => s.bytes), 1);
    for (const s of sites) {
      const tr = document.createElement("tr");
      const pct = Math.round((s.bytes / max) * 100);
      tr.innerHTML =
        "<td style=\\"padding:0.25rem 0.5rem 0.25rem 0; white-space:nowrap;\\">" + escapeHtml(s.folder) + "</td>" +
        "<td style=\\"padding:0.25rem 0.5rem; width:100%;\\"><div class=\\"meter ok\\"><span style=\\"width:" + pct + "%\\"></span></div></td>" +
        "<td style=\\"padding:0.25rem 0 0.25rem 0.5rem; white-space:nowrap; text-align:right;\\" class=\\"muted\\">" + formatBytes(s.bytes) + "</td>";
      tbody.appendChild(tr);
    }
  } catch (e) {
    document.querySelector("#sitesTable tbody").innerHTML = "<tr><td class=\\"muted\\">Error: " + escapeHtml(e.message) + "</td></tr>";
  }
}

async function refreshDiskUsage() {
  const tbody = document.querySelector("#diskUsageTable tbody");
  tbody.innerHTML = "<tr><td class=\\"muted\\">Loading…</td></tr>";
  try {
    const data = await api("/api/disk-usage");
    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML = "<tr><td class=\\"muted\\">Not available (docker mode only, or docker unreachable).</td></tr>";
      return;
    }
    tbody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td style=\\"padding:0.3rem 0.6rem 0.3rem 0;\\">" + escapeHtml(r.type) + "</td>" +
        "<td class=\\"muted\\" style=\\"padding:0.3rem 0.6rem;\\">" + escapeHtml(r.total) + "</td>" +
        "<td class=\\"muted\\" style=\\"padding:0.3rem 0.6rem;\\">" + escapeHtml(r.active) + "</td>" +
        "<td style=\\"padding:0.3rem 0.6rem; text-align:right;\\">" + escapeHtml(r.size) + "</td>" +
        "<td class=\\"muted\\" style=\\"padding:0.3rem 0 0.3rem 0.6rem; text-align:right;\\">" + escapeHtml(r.reclaimable) + "</td>";
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = "<tr><td class=\\"muted\\">Error: " + escapeHtml(e.message) + "</td></tr>";
  }
}

async function showDiskUsageDetail() {
  const pre = document.getElementById("diskUsageLog");
  pre.style.display = "block";
  pre.textContent = "Loading…";
  try {
    const data = await api("/api/disk-usage/verbose");
    pre.textContent = data.text || "(empty)";
  } catch (e) {
    pre.textContent = "Error: " + e.message;
  }
}

async function refreshDbSizes() {
  const tbody = document.querySelector("#dbSizesTable tbody");
  tbody.innerHTML = "<tr><td class=\\"muted\\">Loading…</td></tr>";
  try {
    const data = await api("/api/db-sizes");
    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML = "<tr><td class=\\"muted\\">Not available (docker mode only, or docker unreachable).</td></tr>";
      return;
    }
    const max = Math.max(...rows.map((r) => r.bytes), 1);
    tbody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      const pct = Math.round((r.bytes / max) * 100);
      tr.innerHTML =
        "<td style=\\"padding:0.25rem 0.5rem 0.25rem 0; white-space:nowrap;\\">" + escapeHtml(r.name) + "</td>" +
        "<td style=\\"padding:0.25rem 0.5rem; width:100%;\\"><div class=\\"meter ok\\"><span style=\\"width:" + pct + "%\\"></span></div></td>" +
        "<td style=\\"padding:0.25rem 0 0.25rem 0.5rem; white-space:nowrap; text-align:right;\\" class=\\"muted\\">" + formatBytes(r.bytes) + "</td>";
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = "<tr><td class=\\"muted\\">Error: " + escapeHtml(e.message) + "</td></tr>";
  }
}

function onBackupDestTypeChange() {
  const type = document.getElementById("backupDestType").value;
  for (const t of ["ssh", "s3", "gdrive"]) {
    document.getElementById("backupDestFields_" + t).style.display = t === type ? "" : "none";
  }
}

async function refreshBackupDestination() {
  const msg = document.getElementById("backupDestMsg");
  try {
    const cfg = await api("/api/backup-destination");
    document.getElementById("backupDestType").value = cfg.type || "local";
    onBackupDestTypeChange();
    if (cfg.ssh) document.getElementById("backupSshTarget").value = cfg.ssh.target || "";
    if (cfg.s3) {
      document.getElementById("backupS3Endpoint").value = cfg.s3.endpoint || "";
      document.getElementById("backupS3Bucket").value = cfg.s3.bucket || "";
      document.getElementById("backupS3Region").value = cfg.s3.region || "";
      document.getElementById("backupS3AccessKey").value = cfg.s3.accessKeyId || "";
      document.getElementById("backupS3SecretKey").placeholder = cfg.s3.secretAccessKeySet
        ? "Secret already set — leave blank to keep"
        : "Secret access key";
    }
    if (cfg.gdrive) {
      document.getElementById("backupGdriveFolder").value = cfg.gdrive.folderId || "";
      document.getElementById("backupGdriveJson").placeholder = cfg.gdrive.serviceAccountConfigured
        ? "Service-account JSON already set — leave blank to keep"
        : "Paste the service-account JSON key here";
    }
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  }
}

async function saveBackupDestination() {
  const type = document.getElementById("backupDestType").value;
  const body = { type };
  if (type === "ssh") {
    body.ssh = { target: document.getElementById("backupSshTarget").value.trim() };
  } else if (type === "s3") {
    body.s3 = {
      endpoint: document.getElementById("backupS3Endpoint").value.trim(),
      bucket: document.getElementById("backupS3Bucket").value.trim(),
      region: document.getElementById("backupS3Region").value.trim(),
      accessKeyId: document.getElementById("backupS3AccessKey").value.trim(),
      secretAccessKey: document.getElementById("backupS3SecretKey").value,
    };
  } else if (type === "gdrive") {
    body.gdrive = {
      folderId: document.getElementById("backupGdriveFolder").value.trim(),
      serviceAccountJson: document.getElementById("backupGdriveJson").value,
    };
  }
  const msg = document.getElementById("backupDestMsg");
  msg.textContent = "Saving…";
  try {
    await api("/api/backup-destination", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    msg.textContent = "Saved.";
    document.getElementById("backupS3SecretKey").value = "";
    document.getElementById("backupGdriveJson").value = "";
    refreshBackupDestination();
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  }
}

async function refreshBackupCronStatus() {
  const el = document.getElementById("backupCronBanner");
  try {
    const info = await api("/api/backup-cron-status");
    if (info.cronExists && info.needsUpdate) {
      el.style.display = "block";
      el.innerHTML =
        "🔔 <b>Backup-cron scripts are outdated</b> (installed v" + escapeHtml(info.installedVersion || "none") +
        ", current v" + escapeHtml(info.expectedVersion || "?") + ")" +
        (info.pgConfigured ? "" : " — this card can't connect to the database yet") +
        ". Off-site push may not work correctly until updated. " +
        "<button class=\\"secondary\\" data-action=\\"apply-backup-cron-update\\" style=\\"margin-left:0.4rem;\\">Apply update</button>";
    } else {
      el.style.display = "none";
    }
    renderBackupFreshness(info.lastBackup);
  } catch (e) {
    el.style.display = "none";
    document.getElementById("backupFreshness").textContent = "Unavailable: " + e.message;
  }
}

// Same 26-hour line the server's stale-backup alert uses (backup-status.js).
function renderBackupFreshness(b) {
  const el = document.getElementById("backupFreshness");
  el.style.color = "";
  if (!b || !b.cronInstalled) {
    el.textContent = "No backup cron installed on this server, so nothing is backed up nightly.";
    return;
  }
  el.style.color = b.stale ? "#d32f2f" : "";
  if (!b.newestAt) {
    el.textContent = "No control-plane backup found in " + b.backupDir + ". Check /var/log/ucms-backup.log.";
    return;
  }
  const hours = b.ageMs / 3600000;
  el.textContent = (hours < 1 ? Math.round(hours * 60) + " minutes" : hours.toFixed(1) + " hours") + " ago (" +
    new Date(b.newestAt).toLocaleString() + ") in " + b.backupDir +
    (b.stale ? ". Older than 26 hours: check /var/log/ucms-backup.log." : ".");
}

async function sendTestAlert() {
  const msg = document.getElementById("alertTestMsg");
  msg.textContent = "Sending…";
  try {
    const r = await api("/api/alerts/test", { method: "POST" });
    msg.textContent = "Sent; the webhook answered HTTP " + r.status + ".";
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  }
}

async function applyBackupCronUpdate() {
  const el = document.getElementById("backupCronBanner");
  el.style.display = "block";
  el.textContent = "Applying update…";
  try {
    await api("/api/backup-cron/apply-update", { method: "POST" });
    el.textContent = "Update applied — monitor is rolling to the new connection details. Refreshing in a few seconds…";
    setTimeout(() => location.reload(), 4000);
  } catch (e) {
    el.innerHTML = "Error applying update: " + escapeHtml(e.message) + " <button class=\\"secondary\\" data-action=\\"apply-backup-cron-update\\">Retry</button>";
  }
}

// What each container role actually does — plain-language, for whoever's
// reading this tab without the rest of this codebase's own context. Matched
// by substring against name+image (order matters: first match wins), not an
// exact map, since a name always carries a "ucms-<color>-" or "usim_cms-"
// prefix and a "-N" replica suffix this can't predict in full.
const CONTAINER_INFO = [
  { match: /admin/i, role: "Admin panel", desc: "The CMS editor UI (Designer, pages, media library) staff log into to manage content." },
  { match: /frontend/i, role: "Public website", desc: "Renders the actual live site every visitor sees — the published pages." },
  { match: /(^|[^a-z])api([^a-z]|$)/i, role: "Backend API", desc: "Handles data, auth, and business logic for both the admin panel and the public site." },
  { match: /caddy|proxy/i, role: "Reverse proxy", desc: "Routes incoming HTTP/HTTPS traffic to the right container and terminates SSL certificates." },
  { match: /pgbouncer/i, role: "Connection pooler", desc: "Sits in front of Postgres so many short-lived requests share a small pool of real DB connections." },
  { match: /postgres|(^|[^a-z])db([^a-z]|$)/i, role: "Database", desc: "Postgres — the source of truth for every tenant's pages, posts, media, and settings." },
  { match: /redis/i, role: "Cache", desc: "Speeds up repeated page loads (rendered-HTML cache) and backs cross-replica rate limiting." },
];
function describeContainer(c) {
  const haystack = String(c.Names || c.Name || "") + " " + String(c.Image || "");
  for (const entry of CONTAINER_INFO) {
    if (entry.match.test(haystack)) return entry;
  }
  return { role: "—", desc: "—" };
}

// Flags any base name (Names with a trailing "-N" replica suffix stripped)
// that shows up more than once — the signal an orphaned container (trial
// mode, an old un-stopped blue/green color, or anything started outside
// compose entirely) is still alive alongside the one Services above thinks
// is the only frontend/api/admin running. Built entirely with DOM methods
// (createElement/textContent), not innerHTML string-concat — this whole
// file's DASHBOARD_HTML is itself one big template literal, so a raw \\"
// inside a string built here has already broken this dashboard once (its
// backslash gets eaten by that OUTER template literal before the browser
// ever sees this code) — textContent has no such nesting hazard at all.
function renderContainers(containers) {
  const tbody = document.querySelector("#containersTable tbody");
  const warn = document.getElementById("containersWarning");
  tbody.textContent = "";
  if (!containers.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "muted";
    td.textContent = "No containers found (or docker ps failed).";
    tr.appendChild(td);
    tbody.appendChild(tr);
    warn.style.display = "none";
    return;
  }
  const baseCounts = {};
  for (const c of containers) {
    const base = String(c.Names || c.Name || "").replace(/-\\d+$/, "");
    baseCounts[base] = (baseCounts[base] || 0) + 1;
  }
  const dupes = Object.keys(baseCounts).filter((b) => baseCounts[b] > 1);
  if (dupes.length) {
    warn.style.display = "block";
    warn.textContent = "⚠ More than one container shares a base name — possible orphan: " + dupes.join(", ");
  } else {
    warn.style.display = "none";
  }
  const cell = (text, opts) => {
    const td = document.createElement("td");
    td.style.padding = "0.35rem 0.6rem 0.35rem 0";
    td.style.verticalAlign = "top";
    if (opts && opts.muted) td.className = "muted";
    if (opts && opts.nowrap) td.style.whiteSpace = "nowrap";
    if (opts && opts.maxWidth) td.style.maxWidth = opts.maxWidth;
    td.textContent = text;
    return td;
  };
  for (const c of containers) {
    const name = String(c.Names || c.Name || "");
    const base = name.replace(/-\\d+$/, "");
    const info = describeContainer(c);
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #8882";
    if (baseCounts[base] > 1) tr.style.background = "#b4530933";
    tr.appendChild(cell(name, { nowrap: true }));
    const roleTd = document.createElement("td");
    roleTd.style.padding = "0.35rem 0.6rem 0.35rem 0";
    roleTd.style.verticalAlign = "top";
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = info.role;
    roleTd.appendChild(badge);
    tr.appendChild(roleTd);
    tr.appendChild(cell(info.desc, { muted: true, maxWidth: "340px" }));
    tr.appendChild(cell(String(c.Status || c.State || ""), { muted: true, nowrap: true }));
    tr.appendChild(cell(String(c.Image || ""), { muted: true, nowrap: true }));
    tr.appendChild(cell(String(c.RunningFor || c.CreatedAt || ""), { muted: true, nowrap: true }));
    tbody.appendChild(tr);
  }
}

function renderHost(host) {
  const grid = document.getElementById("hostGrid");
  if (!host) { grid.innerHTML = ""; return; }
  let html = "";
  if (host.disk) html += meterCard("Disk /", host.disk.pct, host.disk.used + " / " + host.disk.total);
  if (host.mem) html += meterCard("Memory", host.mem.pct, host.mem.usedMB + "MB / " + host.mem.totalMB + "MB");
  grid.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colorizeLog(text) {
  const lines = escapeHtml(text).split("\\n");
  return lines
    .map((line) => {
      let cls = "";
      if (/^===/.test(line)) cls = "t-head2";
      else if (/^---/.test(line)) cls = "t-head";
      else if (/error/i.test(line)) cls = "t-err";
      else if (/done|finished|success/i.test(line)) cls = "t-ok";
      return cls ? "<span class=\\"" + cls + "\\">" + line + "</span>" : line;
    })
    .join("\\n");
}

function statusDot(s) {
  const up = /running|healthy|active/i.test(s.State || s.Health || "");
  const span = document.createElement("span");
  span.className = "dot " + (up ? "up" : "down");
  return { up, el: span };
}

function pushHistory(name, up) {
  if (!history[name]) history[name] = [];
  history[name].push(up ? 1 : 0);
  if (history[name].length > 24) history[name].shift();
}

function historyEl(name) {
  const wrap = document.createElement("div");
  wrap.className = "history";
  for (const v of history[name] || []) {
    const span = document.createElement("span");
    span.className = v ? "up" : "down";
    wrap.appendChild(span);
  }
  return wrap;
}

function actionButton(label, name, action, secondary) {
  const b = document.createElement("button");
  if (secondary) b.className = "secondary";
  b.textContent = label;
  b.addEventListener("click", () => act(name, action));
  return b;
}

async function init() {
  const cfg = await api("/api/config");
  SERVICES = cfg.services;
  DB_MANAGED = cfg.dbManaged;
  document.getElementById("mode").textContent = cfg.mode === "docker" ? "Docker mode" : "Systemd mode";
  document.getElementById("dbRestartBtn").style.display = DB_MANAGED ? "" : "none";
  document.getElementById("alertWebhookBanner").style.display = cfg.alertWebhookConfigured ? "none" : "block";
  document.getElementById("alertTestSection").style.display = cfg.alertWebhookConfigured ? "" : "none";
  const logButtons = document.getElementById("logButtons");
  for (const name of SERVICES) {
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = name;
    b.addEventListener("click", () => showLogs(name));
    logButtons.appendChild(b);
  }
  refresh();
  refreshDb();
  refreshSites();
  refreshDiskUsage();
  refreshDbSizes();
  refreshBackupDestination();
  refreshAccounts();
  refreshBackupCronStatus();
  refreshUpdateCheck();
  refreshVersions();
  refreshSecurity();
  setInterval(refresh, 5000);
  setInterval(refreshDb, 10000);
  setInterval(refreshSites, 30000);
  setInterval(refreshUpdateCheck, 60_000);
}

function checkLine(check) {
  if (!check) return "<div class=\\"muted\\">checking upstream…</div>";
  const color =
    check.status === "latest" ? "#2e7d32" : check.status === "outdated" ? "#d32f2f" : check.status === "behind" ? "#f9a825" : "#8888";
  return "<div class=\\"muted\\" style=\\"color:" + color + "\\">" + escapeHtml(check.note) + "</div>";
}

function versionCard(label, value, sub, check, checked, actions) {
  return "<div class=\\"card\\"><div class=\\"label\\">" + label + "</div>" +
    "<div class=\\"value\\" style=\\"font-size:0.95rem\\">" + escapeHtml(value || "unknown") + "</div>" +
    (sub ? "<div class=\\"muted\\">" + escapeHtml(sub) + "</div>" : "") +
    (checked ? checkLine(check) : "") + (actions || "") + "</div>";
}

// testable=false (Node/pnpm): the blue-green deploy itself builds+tests the
// new image before switching traffic, so there's no separate dry-run step —
// only an Update button. Everything else gets a Test button that pulls the
// candidate image and boot-tests it in an isolated throwaway container
// (stagingBootTest, server-side) — it never touches the running container.
function stackActions(key, label, testable) {
  let html = "<div style=\\"margin-top:.5rem;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap\\">";
  if (testable) {
    html += "<button class=\\"secondary\\" data-action=\\"stack-test\\" data-stack-key=\\"" + key + "\\">Test</button>";
  }
  const safeLabel = label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (key === "pgbouncer") {
    html += "<span class=\\"muted\\">Pinned tag: bump it in docker-compose.yml with a repo commit</span>";
  } else {
    html += "<button class=\\"secondary\\" data-action=\\"stack-update\\" data-stack-key=\\"" + key + "\\" data-stack-label=\\"" + safeLabel + "\\">Update</button>";
  }
  const last = stackMsgs[key];
  html += "<span class=\\"muted\\" id=\\"stackMsg-" + key + "\\"" +
    (last && last.color ? " style=\\"color:" + last.color + "\\"" : "") + ">" +
    (last ? escapeHtml(last.text) : "") + "</span>";
  html += "</div>";
  return html;
}

// Last Test/Update result per item. A finished run re-renders the whole grid
// (pollDeployLog -> refreshVersions), which used to wipe the message the
// moment it appeared, so stackActions renders it back from here.
const stackMsgs = {};
function setStackMsg(key, text, color) {
  stackMsgs[key] = { text: text, color: color || "" };
  const msg = document.getElementById("stackMsg-" + key);
  if (msg) {
    msg.style.color = color || "";
    msg.textContent = text;
  }
}

let lastVersionsData = null;

function sectionHeader(title) {
  return "<div style=\\"grid-column:1/-1;margin-top:0.6rem;font-weight:600;color:#888;font-size:0.8rem;text-transform:uppercase;letter-spacing:.04em\\">" +
    escapeHtml(title) + "</div>";
}

function renderStackTab(v, checks) {
  let html = "";
  html += sectionHeader("Overview");
  html += versionCard("App (git is the real version)", v.appVersion);
  html += versionCard("API package", v.packages.api);
  html += versionCard("Admin package", v.packages.admin);
  html += versionCard("Frontend package", v.packages.frontend);

  html += sectionHeader("Runtime");
  html += versionCard("pnpm", v.pnpm, null, checks && checks.pnpm, true, stackActions("pnpm", "pnpm", false));
  html += versionCard(
    "Node.js",
    v.node.runtime,
    v.node.dockerImage ? "container base: " + v.node.dockerImage : "",
    checks && checks.node,
    !!v.node.dockerImage,
    v.node.dockerImage ? stackActions("node", "Node base image", false) : "",
  );

  if (v.infra.db || v.infra.redis || v.infra.pgbouncer || v.infra.proxy) {
    html += sectionHeader("Infrastructure");
  }
  if (v.infra.db) {
    html += versionCard("PostgreSQL", v.infra.db, null, checks && checks.postgres, true, stackActions("postgres", "PostgreSQL patch refresh", true));
  }
  if (v.infra.redis) {
    html += versionCard("Redis", v.infra.redis, null, checks && checks.redis, true, stackActions("redis", "Redis patch refresh", true));
  }
  if (v.infra.pgbouncer) {
    html += versionCard("PgBouncer", v.infra.pgbouncer, null, checks && checks.pgbouncer, true, stackActions("pgbouncer", "PgBouncer", true));
  }
  if (v.infra.proxy) {
    html += versionCard("Caddy (proxy)", v.infra.proxy, null, checks && checks.caddy, true, stackActions("caddy", "Caddy patch refresh", true));
  }

  html += sectionHeader("Dependencies");
  html += versionCard(
    "Project dependencies",
    "check for patch/minor updates",
    "Astro, Fastify, React, etc. — within each package's own declared range",
    null,
    false,
    stackActions("deps", "Project dependencies", true),
  );
  document.getElementById("versionGrid").innerHTML = html;
}

async function stackTest(key, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Testing…";
  setStackMsg(key, key === "deps" ? "checking for outdated packages…" : "pulling image + staging boot-test…");
  try {
    const r = await api("/api/stack/" + key + "/test", { method: "POST" });
    setStackMsg(key, "✓ " + (r.message || "test passed"), "#2e7d32");
  } catch (e) {
    setStackMsg(key, "✗ " + e.message, "#d32f2f");
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
    // The full detail (outdated-package table, boot-test pass/fail reason)
    // only ever goes to DEPLOY_LOG, never the one-line stackMsg span above —
    // reveal/refresh the same log viewer Update uses so it's actually
    // visible, instead of silently sitting in a file nobody's looking at.
    pollDeployLog();
  }
}

// Looks the status/message elements up fresh on every tick (not captured
// once up front) because a finished update makes refreshVersions() re-render
// the whole grid (see pollDeployLog) — the old button/span this click came
// from is gone by then, but an element with the same id always exists in
// whatever's currently on screen.
async function pollStackMsg(key, label) {
  const tick = async () => {
    try {
      const st = await api("/api/pull/status");
      if (st.running) {
        setStackMsg(key, "updating " + label + "… (see Deployments for the live log)");
        setTimeout(tick, 2000);
      } else if (st.exitCode === 0) {
        setStackMsg(key, "✓ finished — see Deployments log", "#2e7d32");
      } else {
        setStackMsg(key, "✗ failed (exit " + st.exitCode + ") — see Deployments log", "#d32f2f");
      }
    } catch (e) {
      setTimeout(tick, 2000);
    }
  };
  tick();
}

// Shared services with no standby: restarting one interrupts every site.
const STACK_DOWNTIME = {
  postgres: "Every site loses its database for about 10-30 seconds. A full backup runs first; if it is incomplete, nothing is changed.",
  redis: "Cache and rate-limit counters reset. Sites keep working, a little slower for a moment.",
  caddy: "Every site is unreachable for a few seconds while the proxy restarts.",
};

async function stackUpdate(key, label, btn) {
  const downtime = STACK_DOWNTIME[key];
  if (!confirm(
    "Update " + label + " now?\\n\\nThis pulls the new version, recreates the service, health-checks it, " +
    "and automatically rolls back to what's running now if it doesn't come up healthy." +
    (downtime ? "\\n\\nDOWNTIME: " + downtime + "\\nBest run outside office hours." : ""),
  )) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Updating…";
  setStackMsg(key, "starting…");
  try {
    const r = await api("/api/stack/" + key + "/update", {
      method: "POST",
      body: JSON.stringify({ acceptDowntime: !!downtime }),
      headers: { "Content-Type": "application/json" },
    });
    // Nothing to bump is a normal outcome, not a failure: no job was started.
    if (r && r.upToDate) {
      setStackMsg(key, "✓ " + r.message, "#2e7d32");
      btn.disabled = false;
      btn.textContent = origText;
      return;
    }
    pollDeployLog();
    refresh();
    pollStackMsg(key, label);
  } catch (e) {
    setStackMsg(key, "✗ " + e.message, "#d32f2f");
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function refreshVersions() {
  try {
    const v = await api("/api/versions");
    lastVersionsData = v;
    renderStackTab(v, null);
    refreshVersionChecks();
  } catch (e) {
    document.getElementById("versionGrid").innerHTML = "<p class=\\"muted\\">Error: " + escapeHtml(e.message) + "</p>";
  }
}

async function refreshVersionChecks() {
  if (!lastVersionsData) return;
  try {
    const r = await api("/api/version-checks");
    renderStackTab(lastVersionsData, r.checks);
  } catch (e) {
    // best-effort — static version cards are already shown, upstream check just stays "checking…"
  }
}

async function refreshUpdateCheck() {
  const el = document.getElementById("updateBanner");
  const count = document.getElementById("updateCount");
  try {
    const info = await api("/api/update-check");
    if (info.commitsBehind > 0) {
      count.textContent = info.commitsBehind > 99 ? "99+" : String(info.commitsBehind);
      count.style.display = "";
      el.style.display = "block";
      el.innerHTML =
        "<b>" + (info.target && info.target !== "origin/main"
          ? "Release " + escapeHtml(info.target)
          : info.commitsBehind + " update" + (info.commitsBehind > 1 ? "s" : "")) + " available.</b> " +
        "The deployment flow checks the new release before switching traffic. " +
        "<button class=\\"secondary\\" data-action=\\"open-deploy\\">Open deployments</button><br>" +
        "<span style=\\"font-size:0.8rem;opacity:0.85\\">" + info.commits.slice(0, 5).map(escapeHtml).join("<br>") + "</span>";
    } else {
      el.style.display = "none";
      count.style.display = "none";
    }
  } catch (e) {
    // An unknown check must be visible: hiding it looks exactly like "latest".
    el.style.display = "block";
    el.replaceChildren();
    const message = document.createElement("b");
    message.textContent = "Update check unavailable. ";
    const details = document.createTextNode(e.message + " ");
    const retry = document.createElement("button");
    retry.className = "secondary";
    retry.dataset.action = "refresh-update-check";
    retry.textContent = "Retry";
    el.append(message, details, retry);
    count.style.display = "none";
  }
}

async function refresh() {
  try {
    const data = await api("/api/status");
    document.getElementById("git").textContent = "HEAD: " + (data.git || "unknown");
    document.getElementById("versionGitLine").textContent = "Git HEAD: " + (data.git || "unknown");
    document.getElementById("uptime").textContent = data.host && data.host.uptime ? data.host.uptime : "";
    renderHost(data.host);
    const grid = document.getElementById("services");
    grid.innerHTML = "";
    const byName = {};
    for (const s of data.services || []) byName[s.Service || s.Name] = s;
    for (const name of SERVICES) {
      const s = byName[name] || {};
      const d = statusDot(s);
      pushHistory(name, d.up);
      const card = document.createElement("div");
      card.className = "svc-card";
      const head = document.createElement("div");
      head.className = "svc-head";
      const b = document.createElement("b");
      b.textContent = name;
      head.appendChild(d.el);
      head.appendChild(b);
      card.appendChild(head);
      const state = document.createElement("div");
      state.className = "muted";
      state.textContent = (s.State || "unknown") + (s.Health ? " (" + s.Health + ")" : "");
      card.appendChild(state);
      card.appendChild(historyEl(name));
      const actions = document.createElement("div");
      actions.className = "row";
      actions.appendChild(actionButton("Restart", name, "restart", false));
      actions.appendChild(actionButton("Stop", name, "stop", true));
      actions.appendChild(actionButton("Start", name, "start", true));
      card.appendChild(actions);
      grid.appendChild(card);
    }
    renderContainers(data.containers || []);
    const d = data.deploy;
    const track = document.getElementById("deployTrack");
    const fill = document.getElementById("deployFill");
    document.getElementById("deployState").textContent = d.running
      ? "Deploy running since " + d.startedAt + "…"
      : d.finishedAt
        ? "Last deploy: exit " + d.exitCode + " at " + d.finishedAt
        : "No deploy run yet.";
    if (d.running) {
      track.style.display = "block";
      fill.className = "progress-fill running";
      pollDeployLog();
    } else if (d.finishedAt) {
      track.style.display = "block";
      fill.className = "progress-fill " + (d.exitCode === 0 ? "success" : "fail");
    } else {
      track.style.display = "none";
    }
  } catch (e) {
    document.getElementById("git").textContent = "Error: " + e.message;
  }
}

async function refreshSecurity(force = false) {
  const status = document.getElementById("securityStatus");
  status.textContent = "Checking the dependency lockfile and registry…";
  status.className = "security-status unknown";
  try {
    const data = await api("/api/security" + (force ? "?refresh=1" : ""));
    const labels = { clear: "No known dependency advisory detected", attention: "Security update recommended", unknown: "Security state could not be verified" };
    status.textContent = labels[data.level] || labels.unknown;
    status.className = "security-status " + (data.level || "unknown");
    document.getElementById("securityCheckedAt").textContent = "Checked " + new Date(data.checkedAt).toLocaleString();
    const trackedList = document.getElementById("trackedSecurity");
    trackedList.replaceChildren();
    for (const item of data.tracked || []) {
      const row = document.createElement("div");
      row.className = "security-item";
      const title = document.createElement("strong");
      title.textContent = item.name + " " + (item.versions.join(", ") || "not in lockfile") + " — " + item.status;
      const meta = document.createElement("small");
      meta.textContent = item.scope + " · " + item.severity + " · fixed in " + item.fixed + " · ";
      const advice = document.createElement("div");
      advice.textContent = item.recommendation;
      row.append(title, meta);
      for (const advisory of item.advisories || []) {
        const link = document.createElement("a");
        link.href = "https://github.com/advisories/" + advisory;
        link.textContent = advisory + " ";
        link.rel = "noopener noreferrer";
        link.target = "_blank";
        row.append(link);
      }
      row.append(advice);
      trackedList.append(row);
    }
    const summary = document.getElementById("securityAuditSummary");
    summary.replaceChildren();
    const details = document.getElementById("securityAdvisories");
    details.replaceChildren();
    for (const [scope, report] of [["Production", data.production], ["Development", data.development]]) {
      const card = document.createElement("div");
      card.className = "card";
      const heading = document.createElement("div");
      heading.className = "label";
      heading.textContent = scope + " dependencies";
      const value = document.createElement("div");
      value.className = "value";
      value.textContent = report.status === "unknown" ? "Unknown" : report.total + " advisories";
      const sub = document.createElement("div");
      sub.className = "muted";
      sub.textContent = report.status === "unknown" ? report.error :
        ["critical", "high", "moderate", "low"].map((level) => level + ": " + (report.counts[level] || 0)).join(" · ");
      card.append(heading, value, sub);
      summary.append(card);
      for (const advisory of report.advisories || []) {
        const row = document.createElement("div");
        row.className = "security-item";
        const title = document.createElement("strong");
        title.textContent = scope + " · " + advisory.severity + " · " + advisory.name + " · " + advisory.title;
        row.append(title);
        const info = document.createElement("small");
        info.textContent = "Patched versions: " + (advisory.patched || "no published fix");
        row.append(info);
        if (/^GHSA-[a-z0-9-]+$/i.test(advisory.id)) {
          const link = document.createElement("a");
          link.href = "https://github.com/advisories/" + advisory.id;
          link.textContent = " · " + advisory.id;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          row.append(link);
        }
        details.append(row);
      }
    }
    const recommendations = document.getElementById("securityRecommendations");
    recommendations.replaceChildren();
    for (const recommendation of data.recommendations || []) {
      const item = document.createElement("li");
      item.textContent = recommendation;
      recommendations.append(item);
    }
  } catch (error) {
    status.textContent = "Security state could not be verified: " + error.message;
  }
}

async function refreshDb() {
  try {
    const d = await api("/api/db/status");
    document.getElementById("dbDot").className = "dot " + (d.ok ? "up" : "down");
    document.getElementById("dbStatus").textContent = (d.ok ? "up — " : "down — ") + (d.output || "");
  } catch (e) {
    document.getElementById("dbStatus").textContent = "Error: " + e.message;
  }
}

async function dbRestart() {
  try {
    await api("/api/db/restart", { method: "POST" });
    setTimeout(refreshDb, 1500);
  } catch (e) {
    alert(e.message);
  }
}

async function act(name, action) {
  try {
    await api("/api/service/" + name + "/" + action, { method: "POST" });
    setTimeout(refresh, 1500);
  } catch (e) {
    alert(e.message);
  }
}

async function pull(button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Checking update…";
  try {
    let pre = null;
    try {
      pre = await api("/api/preflight");
    } catch (e) {
      if (!confirm("Could not run the pre-update safety check (" + e.message + "). Proceed anyway?")) return;
    }
    if (pre) {
      if (pre.verdict === "up-to-date") {
        if (!confirm("Already on the latest commit — redeploy anyway?")) return;
      } else if (pre.verdict === "blocked") {
        alert("Update blocked:\\n\\n" + pre.reasons.join("\\n"));
        return;
      } else {
        const label = pre.verdict === "caution" ? "⚠ Needs attention" : "✓ Safe to update";
        const msg =
          label + " — " + pre.commitsBehind + " commit(s) behind " + (pre.target || "origin/main") + ":\\n\\n" +
          pre.reasons.join("\\n\\n") + "\\n\\nProceed with \\"Pull latest & deploy\\"?";
        if (!confirm(msg)) return;
      }
    }
    button.textContent = "Starting deploy…";
    try {
      await api("/api/pull", { method: "POST" });
      pollDeployLog();
      refresh();
    } catch (e) {
      alert(e.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function rollback() {
  if (!confirm("Roll back to the previously deployed color? This flips live traffic to whatever was running before the last deploy.")) return;
  try {
    await api("/api/rollback", { method: "POST" });
    pollDeployLog();
    refresh();
  } catch (e) {
    alert(e.message);
  }
}

async function gitSync(button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const result = await api("/api/git/sync", { method: "POST" });
    alert(result.message);
  } catch (e) {
    alert(e.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

let polling = false;
async function pollDeployLog() {
  if (polling) return;
  polling = true;
  const pre = document.getElementById("deployLog");
  pre.style.display = "block";
  const tick = async () => {
    try {
      const log = await api("/api/pull/log");
      pre.innerHTML = colorizeLog(log);
      pre.scrollTop = pre.scrollHeight;
      const st = await api("/api/pull/status");
      if (st.running) {
        setTimeout(tick, 2000);
      } else {
        polling = false;
        refresh();
        refreshVersions();
      }
    } catch (e) {
      // The pull step restarts the monitor's own process, so a request can
      // briefly fail while it bounces — keep retrying instead of dying here.
      setTimeout(tick, 2000);
    }
  };
  tick();
}

async function issueSsl() {
  const domain = document.getElementById("sslDomain").value.trim();
  const email = document.getElementById("sslEmail").value.trim();
  const pre = document.getElementById("sslLog");
  pre.style.display = "block";
  pre.textContent = "Running certbot for " + domain + "…";
  try {
    const body = await api("/api/ssl/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, email }),
    });
    pre.innerHTML = colorizeLog("done\\n" + (body.stdout || "") + (body.stderr || ""));
  } catch (e) {
    pre.innerHTML = colorizeLog("error\\n" + e.message);
  }
}

async function showLogs(name) {
  document.getElementById("logs").textContent = "loading…";
  try {
    const text = await api("/api/logs/" + name + "?tail=300");
    document.getElementById("logs").innerHTML = colorizeLog(text);
  } catch (e) {
    document.getElementById("logs").textContent = "Error: " + e.message;
  }
}

let accountUsername = "";
async function refreshAccounts() {
  const list = document.getElementById("accountsList");
  try {
    const data = await api("/api/users");
    accountUsername = data.currentUser;
    document.getElementById("accountsCurrent").textContent = "Signed in as " + accountUsername;
    list.replaceChildren();
    for (const user of data.users) {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("span");
      label.textContent = user.name + (user.name === accountUsername ? " (you)" : "");
      row.appendChild(label);
      if (user.name !== accountUsername) {
        const button = document.createElement("button");
        button.className = "secondary";
        button.textContent = "Remove";
        button.dataset.action = "remove-account";
        button.dataset.username = user.name;
        row.appendChild(button);
      }
      list.appendChild(row);
    }
  } catch (error) {
    list.textContent = "Could not load accounts: " + error.message;
  }
}

function accountStatus(message) {
  document.getElementById("accountsMsg").textContent = message;
}

function accountInput(id) {
  return document.getElementById(id).value;
}

async function changeAccountPassword() {
  const currentPassword = accountInput("accountCurrentPassword");
  const newPassword = accountInput("accountNewPassword");
  if (newPassword !== accountInput("accountNewConfirm")) return accountStatus("New passwords do not match.");
  try {
    await api("/api/users/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    document.getElementById("accountCurrentPassword").value = "";
    document.getElementById("accountNewPassword").value = "";
    document.getElementById("accountNewConfirm").value = "";
    accountStatus("Password changed. Close this tab and reopen the monitor to sign in with the new password.");
  } catch (error) { accountStatus("Password change failed: " + error.message); }
}

async function addAccount() {
  const currentPassword = accountInput("accountCurrentPassword");
  const username = accountInput("accountAddUsername").trim();
  const password = accountInput("accountAddPassword");
  if (password !== accountInput("accountAddConfirm")) return accountStatus("New passwords do not match.");
  try {
    await api("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, username, password }),
    });
    document.getElementById("accountCurrentPassword").value = "";
    document.getElementById("accountAddUsername").value = "";
    document.getElementById("accountAddPassword").value = "";
    document.getElementById("accountAddConfirm").value = "";
    accountStatus("Administrator added. Share the password through a secure channel.");
    refreshAccounts();
  } catch (error) { accountStatus("Could not add administrator: " + error.message); }
}

async function removeAccount(button) {
  const username = button.dataset.username;
  if (!confirm("Remove monitor administrator " + username + "?")) return;
  try {
    await api("/api/users/remove", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, currentPassword: accountInput("accountCurrentPassword") }),
    });
    document.getElementById("accountCurrentPassword").value = "";
    accountStatus("Administrator removed.");
    refreshAccounts();
  } catch (error) { accountStatus("Could not remove administrator: " + error.message); }
}

// The CSP blocks inline event attributes. Keep every action in this
// nonce-authorized script, including buttons inserted by later refreshes.
const dashboardActions = new Map([
  ["toggle-sidebar", toggleSidebar],
  ["close-sidebar", closeSidebar],
  ["open-deploy", () => switchTab("deploy")],
  ["pull", pull],
  ["rollback", rollback],
  ["git-sync", gitSync],
  ["refresh", () => { refresh(); refreshUpdateCheck(); }],
  ["refresh-update-check", refreshUpdateCheck],
  ["refresh-security", () => refreshSecurity(true)],
  ["db-restart", dbRestart],
  ["refresh-disk-usage", refreshDiskUsage],
  ["show-disk-usage-detail", showDiskUsageDetail],
  ["refresh-db-sizes", refreshDbSizes],
  ["save-backup-destination", saveBackupDestination],
  ["apply-backup-cron-update", applyBackupCronUpdate],
  ["send-test-alert", sendTestAlert],
  ["issue-ssl", issueSsl],
  ["change-account-password", changeAccountPassword],
  ["add-account", addAccount],
  ["remove-account", removeAccount],
]);
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button) return;
  if (button.classList.contains("tab-btn")) {
    switchTab(button.dataset.tab);
    return;
  }
  if (button.dataset.action === "stack-test") {
    stackTest(button.dataset.stackKey, button);
  } else if (button.dataset.action === "stack-update") {
    stackUpdate(button.dataset.stackKey, button.dataset.stackLabel, button);
  } else {
    const action = dashboardActions.get(button.dataset.action);
    if (action) action(button);
  }
});
document.getElementById("backupDestType").addEventListener("change", onBackupDestTypeChange);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSidebar(); });
window.addEventListener("hashchange", () => switchTab(window.location.hash.slice(1), false));
switchTab(window.location.hash.slice(1) || "overview", false);
init();
</script>
</body>
</html>`;
