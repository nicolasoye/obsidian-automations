[Sort inbox](obsidian://quickadd?choice=Sort%20Inbox%20Button) [Sort work notes](obsidian://quickadd?choice=Sort%20Notes%20Button&value-dashboardContext=work) [Plan work week](obsidian://quickadd?choice=Create%20weekly%20planning%20board&value-dashboardContext=work)
```dataviewjs
if (app.vault.getAbstractFileByPath("_WeeklyPlanning/session.json")) {
  dv.paragraph("[[_WeeklyPlanning/Weekly planning|Open existing planning session]]");
}
```
