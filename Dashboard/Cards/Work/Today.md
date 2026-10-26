### Tasks

```tasks
filter by function task.file.path.startsWith("PhD Notes/")
not done
due today
sort by description
limit 30
```

### Outlook calendar

```dataviewjs
const ics = app.plugins.getPlugin("ics");

if (!ics) {
  dv.paragraph("⚠️ Install and enable the **ICS** community plugin, then add your Outlook ICS URL in its settings.");
  return;
}

let events = [];
try {
  events = await ics.getEvents(moment());
} catch (error) {
  dv.paragraph(`⚠️ Calendar events could not be loaded: ${error.message ?? error}`);
  return;
}

events = [...events].sort((a, b) => (a.utime ?? 0) - (b.utime ?? 0));

if (events.length === 0) {
  dv.paragraph("_No calendar events today._");
  return;
}

const rows = events.map((event) => {
  const time = event.allDay
    ? "All day"
    : [event.time, event.endTime].filter(Boolean).join("–");
  return [
    time || "—",
    event.summary || "(Untitled event)",
    event.location || ""
  ];
});

dv.table(["Time", "Event", "Location"], rows);
```
