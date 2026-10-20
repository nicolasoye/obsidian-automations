<%*
const sortNotes = tp.user?.sort_notes;
if (typeof sortNotes !== "function") {
  new tp.obsidian.Notice(
    "Note sorter is unavailable. In Settings → Templater, set Script files folder location to Scripts, then reload Templater.",
    15000
  );
} else {
  tp.hooks.on_all_templates_executed(async () => {
    try {
      await sortNotes(tp, "Scripts/note_sorter_config.json");
    } catch (error) {
      new tp.obsidian.Notice(`Note sorter could not start: ${error.message}`, 15000);
      console.error("Note sorter launcher:", error);
    }
  });
}
-%>
