<%*
/* --- Settings --- */
const peopleFolder = "People"; // Change or set to "" to disable folder-based suggestions
const fallbackPeople = ["Jens", "Lukas", "Daniel"]; // Edit your quick-pick list

/* --- Build suggestion list --- */
let choices = [];
if (peopleFolder) {
  const folder = app.vault.getAbstractFileByPath(peopleFolder);
  if (folder && "children" in folder) {
    choices = folder.children
      .filter(f => f.extension === "md")
      .map(f => f.basename);
  }
}
if (!choices.length) choices = fallbackPeople;

/* --- Pick attendees (multi-select loop) --- */
let attendees = [];
while (true) {
	const available = choices.filter(c => !attendees.includes(c));
	const labels = ["[Done]", "Custom name…", ...available];
	const values = ["DONE", "CUSTOM", ...available];
	const sel = await tp.system.suggester(labels, values, false, "Pick attendees");
	if (!sel || sel === "DONE") break;
	if (sel === "CUSTOM") {
	const typed = await tp.system.prompt("Enter name");
	if (typed) attendees.push(typed.trim());
} else {
	attendees.push(sel);
}
}
	if (!attendees.length) {
	const typed = await tp.system.prompt("Who are you meeting?");
	attendees = [typed ? typed.trim() : "TBD"];
}

/* --- Ask for date/time (default = today) --- */
const defWhen = tp.date.now("YYYY-MM-DD");
const whenInput = await tp.system.prompt("When is the meeting? (YYYY-MM-DD or YYYY-MM-DD HH:mm)", defWhen);

// Try to parse; fall back to now if invalid
const m = window.moment(whenInput, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD", window.moment.ISO_8601], true);
const whenISO = (m.isValid() ? m : window.moment()).format("YYYY-MM-DD HH:mm");
const dateOnly = whenISO.substring(0,10);
const timeOnly = whenISO.substring(11);

/* --- Rename file --- */
const fileName = `PhD Notes/Meetings/${dateOnly} - Meeting with ${attendees.join(", ")}`;
await tp.file.move(fileName);
-%>
---
type: meeting
meeting_with:
<%* for (const p of attendees) { tR += `  - ${p}\n`; } %>
date: <% dateOnly %>  # Click this in Properties to use Obsidian's calendar picker
time: <% timeOnly %>
---

## Agenda
- 

## Notes
- 

## Actions
- 

#meeting