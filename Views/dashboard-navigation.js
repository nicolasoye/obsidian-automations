// Each card passes its context explicitly; opening another card cannot change it.
const context = input?.context;
if (!["work", "personal"].includes(context)) throw new Error("Invalid dashboard context.");
const label = context === "work" ? "Work" : "Personal";
const settingsPath = `Dashboard/Settings/${label}`;
const settings = dv.page(settingsPath);
if (!settings) {
  dv.paragraph(`Dashboard settings not found: [[${settingsPath}]]`);
  return;
}
const links = [];
if (settings.weekly_review_enabled && settings.weekly_note_folder) {
  const date = settings.weekly_note_date_basis === "iso_week_start" ? moment().startOf("isoWeek") : moment();
  links.push(dv.fileLink(`${settings.weekly_note_folder}/${date.format(String(settings.weekly_note_format))}`, false, "Current weekly review"));
}
if (settings.project_index_note) links.push(dv.fileLink(String(settings.project_index_note), false, `${label} projects`));
if (settings.meeting_notes_index) links.push(dv.fileLink(String(settings.meeting_notes_index), false, "Meeting notes"));
links.push(dv.fileLink(settingsPath, false, `${label} dashboard settings`));
dv.list(links);
const root = String(settings.root);
const topics = dv.pages(`"${root}/Topics"`)
  .where(page => page.file.name.endsWith(" hub"))
  .sort(page => page.file.name, "asc");
if (topics.length) {
  dv.header(3, "Topics");
  dv.list(topics.map(page => page.file.link));
}
