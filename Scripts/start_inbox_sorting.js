/** QuickAdd entry point for the dashboard button. Keeps the active canvas open. */
const CONFIG_PATH = "Scripts/inbox_sorter_config.json";
const TEMPLATE_PATH = "Templates/TemplaterTemplates/Sort Inbox.md";
const START_LOCK = Symbol.for("notes.inbox-sorter.starting");
const SORT_LOCK = Symbol.for("notes.inbox-sorter.running");

module.exports = async function startInboxSorting({ app, obsidian }) {
  const notify = message => { if (obsidian?.Notice) new obsidian.Notice(message, 10000); };
  const locks = globalThis[START_LOCK] ?? (globalThis[START_LOCK] = new WeakSet());
  if (!app) throw new Error("The inbox button must be run through QuickAdd.");
  if (locks.has(app) || globalThis[SORT_LOCK]?.has(app)) {
    notify("Inbox sorting is already running.");
    return { status: "error", error: "Inbox sorting is already running." };
  }
  locks.add(app);
  try {
    const plugin = app.plugins?.getPlugin?.("templater-obsidian") ?? app.plugins?.plugins?.["templater-obsidian"];
    const engine = plugin?.templater;
    if (typeof engine?.create_running_config !== "function" || typeof engine.functions_generator?.generate_object !== "function") {
      throw new Error("Enable Templater before starting inbox sorting.");
    }
    const template = app.vault.getAbstractFileByPath(TEMPLATE_PATH);
    if (!template || template.extension !== "md") throw new Error(`Inbox launcher not found: ${TEMPLATE_PATH}`);
    // Templater 2.20's StartupTemplate mode provides a note context without
    // inserting a template into the active canvas or creating a launch note.
    const config = engine.create_running_config(template, template, 5);
    const tp = await engine.functions_generator.generate_object(config);
    if (typeof tp.user?.sort_inbox !== "function") {
      throw new Error("Set Templater's Script files folder location to Scripts, then reload Templater.");
    }
    return await tp.user.sort_inbox(tp, CONFIG_PATH);
  } catch (error) {
    notify(`Inbox sorting could not start: ${error.message}`);
    return { status: "error", error: error.message };
  } finally {
    locks.delete(app);
  }
};
