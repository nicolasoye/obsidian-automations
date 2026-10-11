## Tasks

```tasks
folder does not include Personal Notes/
not done
due after today
due before in 8 days
group by function task.due.format("[%%]YYYY-MM-DD[%%]dddd, MMM D")
sort by due
limit 50
```

### Outlook calendar

```dataviewjs
const ics = app.plugins.getPlugin("ics");

if (!ics) {
  dv.paragraph("⚠️ Install and enable the **ICS** community plugin, then add your Outlook ICS URL in its settings.");
  return;
}

const dates = Array.from({ length: 7 }, (_, index) =>
  moment().add(index + 1, "day")
);

let events = [];
try {
  events = await ics.getEvents(...dates);
} catch (error) {
  dv.paragraph(`⚠️ Calendar events could not be loaded: ${error.message ?? error}`);
  return;
}

events = [...events].sort((a, b) => (a.utime ?? 0) - (b.utime ?? 0));

if (events.length === 0) {
  dv.paragraph("_No calendar events in the next seven days._");
  return;
}

const grouped = new Map();
for (const event of events) {
  const key = moment.unix(event.utime).format("YYYY-MM-DD");
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(event);
}

for (const [date, dayEvents] of grouped) {
  dv.header(4, moment(date, "YYYY-MM-DD").format("dddd, MMMM D"));
  const rows = dayEvents.map((event) => {
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
}
```
