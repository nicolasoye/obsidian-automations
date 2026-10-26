/** QuickAdd: switch the complete dashboard state, preserving the shared layout. */
const CANVAS_PATH = "Dashboard/Home.canvas";
const LAYOUT_PATH = "Dashboard/Layout.json";
const LOCK = Symbol.for("obsidian.dashboard.switching");
const SLOTS = {
  "dashboardcontext": "Context",
  "e5f60718293a4b5c": "Current Week Focus",
  "f60718293a4b5c6d": "Overdue",
  "0718293a4b5c6d7e": "Today",
  "18293a4b5c6d7e8f": "Next 7 Days",
  "293a4b5c6d7e8f90": "Calendar Week",
  "e46b7520db1efd36": "Projects",
  "4b5c6d7e8f901234": "Navigation",
  "8a19bd03c4756e2f": "Inbox and actions"
};
const CALENDAR_IDS = new Set(["c3d4e5f60718293a", "293a4b5c6d7e8f90"]);
const GROUPS = {
  "a1b2c3d4e5f60718": "Priorities",
  "b2c3d4e5f6071829": "Today",
  "db3d348c308d4d6f": "Coming up",
  "c3d4e5f60718293a": "Calendar",
  "d4e5f60718293a4b": "Projects and actions"
};

function state(canvas, context, layout = {}) {
  if (!["work", "personal"].includes(context)) throw new Error("Choose Work or Personal.");
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) throw new Error("Invalid dashboard canvas.");
  const label = context === "work" ? "Work" : "Personal";
  const activeIds = new Set(canvas.nodes.map(node => node.id));
  const nodes = [...canvas.nodes];
  const parked = (layout.calendarNodes ?? []).filter(node => !activeIds.has(node.id))
    .sort((a, b) => (layout.calendarOrder?.[a.id] ?? Infinity) - (layout.calendarOrder?.[b.id] ?? Infinity));
  for (const node of parked) nodes.splice(layout.calendarOrder?.[node.id] ?? nodes.length, 0, node);
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length) throw new Error("The dashboard contains duplicate node IDs.");
  for (const id of Object.keys(SLOTS)) {
    if (!ids.has(id)) throw new Error(`Restore the missing dashboard card: ${SLOTS[id]}`);
  }
  const mapped = nodes.map(node => {
    const updated = { ...node };
    if (SLOTS[node.id]) {
      updated.type = "file";
      const cardContext = node.id === "293a4b5c6d7e8f90" ? "Work" : label;
      updated.file = `Dashboard/Cards/${cardContext}/${SLOTS[node.id]}.md`;
    }
    if (GROUPS[node.id]) updated.label = `${GROUPS[node.id]} · ${label}`;
    if (node.id === "dashboardcontext") updated.color = context === "work" ? "2" : "4";
    return updated;
  });
  const hidden = node => context === "personal" && CALENDAR_IDS.has(node.id);
  const edgeIds = new Set(canvas.edges.map(edge => edge.id));
  const calendarWasHidden = !activeIds.has("293a4b5c6d7e8f90");
  const storedEdges = calendarWasHidden ? (layout.calendarEdges ?? []) : [];
  const edges = [...canvas.edges, ...storedEdges.filter(edge => !edgeIds.has(edge.id))]
    .filter(edge => ids.has(edge.fromNode) && ids.has(edge.toNode));
  const hiddenEdge = edge => context === "personal" && (CALENDAR_IDS.has(edge.fromNode) || CALENDAR_IDS.has(edge.toNode));
  return {
    canvas: { ...canvas, nodes: mapped.filter(node => !hidden(node)), edges: edges.filter(edge => !hiddenEdge(edge)) },
    // Store inactive geometry outside Canvas: Canvas saves only its own schema.
    // Always retain a copy, so an interrupted switch cannot lose hidden nodes.
    layout: {
      version: 1,
      calendarNodes: mapped.filter(node => CALENDAR_IDS.has(node.id)),
      calendarOrder: Object.fromEntries(mapped.map((node, index) => [node.id, index]).filter(([id]) => CALENDAR_IDS.has(id))),
      calendarEdges: edges.filter(edge => CALENDAR_IDS.has(edge.fromNode) || CALENDAR_IDS.has(edge.toNode))
    }
  };
}

module.exports = async function switchDashboard({ app, obsidian, quickAddApi, variables = {} }) {
  const locks = globalThis[LOCK] ?? (globalThis[LOCK] = new WeakSet());
  if (locks.has(app)) return { status: "busy" };
  locks.add(app);
  const views = [];
  let changed = false;
  try {
    const context = variables.dashboardContext ?? await quickAddApi.suggester(["Work", "Personal"], ["work", "personal"]);
    if (context == null) return { status: "cancelled" };
    const file = app.vault.getAbstractFileByPath(CANVAS_PATH);
    if (!file) throw new Error(`Dashboard not found: ${CANVAS_PATH}`);
    const layoutFile = app.vault.getAbstractFileByPath(LAYOUT_PATH);
    if (!layoutFile) throw new Error(`Dashboard layout not found: ${LAYOUT_PATH}`);
    const layout = JSON.parse(await app.vault.read(layoutFile));
    const preview = state(JSON.parse(await app.vault.read(file)), context, layout);
    for (const node of preview.canvas.nodes) {
      if (SLOTS[node.id] && !app.vault.getAbstractFileByPath(node.file)) throw new Error(`Dashboard card not found: ${node.file}`);
    }
    // Closing and reopening through public workspace APIs flushes pending Canvas
    // edits and prevents a live Canvas view overwriting the changed file.
    for (const leaf of app.workspace.getLeavesOfType("canvas")) {
      const viewState = leaf.getViewState();
      if (viewState.state?.file === CANVAS_PATH) views.push({ leaf, viewState });
    }
    for (const { leaf } of views) await leaf.setViewState({ type: "empty" });
    const current = await app.vault.read(file);
    const next = state(JSON.parse(current), context, layout);
    await app.vault.process(layoutFile, () => JSON.stringify(next.layout, null, 2) + "\n");
    await app.vault.process(file, latest => {
      if (latest !== current) throw new Error("The canvas changed during switching; retry.");
      return JSON.stringify(next.canvas, null, 2) + "\n";
    });
    changed = true;
    for (const { leaf, viewState } of views) await leaf.setViewState(viewState);
    if (!views.length) await app.workspace.getLeaf(false).openFile(file);
    return { status: "switched", context };
  } catch (error) {
    // Restore any tabs closed before a failed write. The saved file remains the
    // source of truth if a write succeeded but reopening failed.
    for (const { leaf, viewState } of views) {
      try { await leaf.setViewState(viewState); } catch (_) { /* report original error */ }
    }
    if (obsidian?.Notice) new obsidian.Notice(`Dashboard ${changed ? "saved; reopen Home.canvas" : "could not switch"}: ${error.message}`, 15000);
    return { status: "error", error: error.message };
  } finally { locks.delete(app); }
};
module.exports.state = state;
