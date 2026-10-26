---
root: PhD Notes
label: Work
weekly_review_enabled: true
calendar_enabled: true
weekly_note_folder: PhD Notes/Planning/Weekly
weekly_note_format: "[Reviews/]GGGG-[W]WW"
weekly_note_date_basis: current_date
weekly_focus_heading: What is your focus?
project_folder: PhD Notes/Projects
project_index_note: Dashboard/Cards/Work/Projects
meeting_notes_folder: PhD Notes/Meetings
meeting_notes_index: PhD Notes/Meetings/Meeting Notes
---

# Work dashboard settings

Edit the properties above once so the dashboard matches your vault.

- `weekly_note_folder`: Folder containing weekly reviews, relative to the vault root.
- `weekly_note_format`: Moment.js format used for the weekly-note filename. The default resolves to names such as `2026-W31`.
- `weekly_note_date_basis`: Use `current_date` for week-number filenames, or `iso_week_start` when the filename is the Monday date.
- `weekly_focus_heading`: Exact heading text to extract from the current weekly note.
- `project_folder`: Folder for project notes.
- `project_index_note`: Note opened by the Projects navigation link.
- `meeting_notes_folder`: Folder containing meeting notes.
- `meeting_notes_index`: Note opened by the Meeting notes navigation link.

The current configuration reads `PhD Notes/Planning/Weekly/Reviews/YYYY-Www.md` and extracts the heading configured by `weekly_focus_heading`, for example:

```markdown
## What is your focus?

- [ ] write down a model documentation
- [o] Start planning out next paper 📅 2026-07-30
```
