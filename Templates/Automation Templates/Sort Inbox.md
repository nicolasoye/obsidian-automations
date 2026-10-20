<%*
const sortInbox = tp.user?.sort_inbox;
if (typeof sortInbox !== "function") {
  new tp.obsidian.Notice(
    "Inbox sorter is unavailable. In Settings → Templater, set Script files folder location to .obsidian/Scripts, then reload Templater.",
    15000
  );
} else {
  tp.hooks.on_all_templates_executed(async () => {
    try {
      await sortInbox(tp, ".obsidian/Scripts/inbox_sorter_config.json");
    } catch (error) {
      new tp.obsidian.Notice(`Inbox sorter could not start: ${error.message}`, 15000);
      console.error("Inbox sorter launcher:", error);
    }
  });
}
-%>
