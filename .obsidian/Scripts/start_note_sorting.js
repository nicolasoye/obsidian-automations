/** QuickAdd entry point for the dashboard note sorter button. Keeps the active canvas open. */
const CONFIG_PATH = ".obsidian/Scripts/note_sorter_config.json";
const TEMPLATE_PATH = "Templates/Automation Templates/Sort Notes.md";
const START_LOCK = Symbol.for("notes.note-sorter.starting");
const SORT_LOCK = Symbol.for("notes.note-sorter.running");

module.exports = async function startNoteSorting({ app, obsidian }) {
  const notify = message => { if (obsidian?.Notice) new obsidian.Notice(message, 10000); };
  const locks = globalThis[START_LOCK] ?? (globalThis[START_LOCK] = new WeakSet());
  if (!app) throw new Error("The note sorting button must be run through QuickAdd.");
  if (locks.has(app) || globalThis[SORT_LOCK]?.has(app)) {
    notify("Note sorting is already running.");
    return { status: "error", error: "Note sorting is already running." };
  }
  locks.add(app);
  try {
    const plugin = app.plugins?.getPlugin?.("templater-obsidian") ?? app.plugins?.plugins?.["templater-obsidian"];
    const engine = plugin?.templater;
    if (typeof engine?.create_running_config !== "function" || typeof engine.functions_generator?.generate_object !== "function") {
      throw new Error("Enable Templater before starting note sorting.");
    }
    const template = app.vault.getAbstractFileByPath(TEMPLATE_PATH);
    if (!template || template.extension !== "md") throw new Error(`Note sorter launcher not found: ${TEMPLATE_PATH}`);
    // StartupTemplate mode provides a note context without opening a launch note.
    const config = engine.create_running_config(template, template, 5);
    const tp = await engine.functions_generator.generate_object(config);
    if (typeof tp.user?.sort_notes !== "function") {
      throw new Error("Set Templater's Script files folder location to .obsidian/Scripts, then reload Templater.");
    }
    return await tp.user.sort_notes(tp, CONFIG_PATH);
  } catch (error) {
    notify(`Note sorting could not start: ${error.message}`);
    return { status: "error", error: error.message };
  } finally {
    locks.delete(app);
  }
};
