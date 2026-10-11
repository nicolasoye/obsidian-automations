```dataviewjs
const settings = dv.page("Dashboard/Dashboard Settings");
const folder = String(settings?.weekly_note_folder ?? "").replace(/^\/+|\/+$/g, "");
const format = String(settings?.weekly_note_format ?? "GGGG-[W]WW");
const basis = String(settings?.weekly_note_date_basis ?? "current_date");
const weeklyMoment = basis === "iso_week_start"
  ? moment().startOf("isoWeek")
  : moment();
const weeklyTitle = weeklyMoment.format(format);
const weeklyPath = folder ? `${folder}/${weeklyTitle}` : weeklyTitle;

const links = [
  dv.fileLink(weeklyPath, false, "Current weekly note / review"),
  dv.fileLink(String(settings?.project_index_note ?? "Projects/Projects"), false, "Work projects"),
  dv.fileLink(String(settings?.meeting_notes_index ?? "Meetings/Meeting Notes"), false, "Meeting notes"),
  dv.fileLink("Dashboard/Dashboard Settings", false, "Dashboard settings")
];

dv.list(links);
```

Use your existing QuickAdd task-capture command or hotkey from this page. Captured tasks can remain in the weekly note; tasks created elsewhere will still appear in the date-based dashboard queries.
