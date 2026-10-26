```dataviewjs
const ics = app.plugins.getPlugin("ics");
const fullCalendar = app.plugins.getPlugin("obsidian-full-calendar");

if (!ics || !fullCalendar) {
  const missing = [
    !ics ? "ICS" : null,
    !fullCalendar ? "Full Calendar" : null
  ].filter(Boolean).join(" and ");

  dv.paragraph(
    `⚠️ Install and enable ${missing} to display the calendar overview.`
  );
  return;
}

// Convert ICS events into FullCalendar events
function toFullCalendarEvent(event) {
  const start = event.startDateTime
    ? new Date(event.startDateTime)
    : moment.unix(event.utime).toDate();

  const end = event.endDateTime
    ? new Date(event.endDateTime)
    : event.endUtime
      ? moment.unix(event.endUtime).toDate()
      : moment(start).add(1, "hour").toDate();

  return {
    // Include the occurrence time because recurring ICS events may share a UID
    id: `${event.uid || event.summary || "event"}-${start.getTime()}`,
    start,
    end,
    allDay: Boolean(event.allDay),
    title: event.summary || "(Untitled event)"
  };
}

// Load whatever date range FullCalendar currently needs
async function loadEvents(fetchInfo, successCallback, failureCallback) {
  try {
    const start = moment(fetchInfo.start).startOf("day");
    const end = moment(fetchInfo.end).startOf("day");

    // fetchInfo.end is exclusive
    const dates = [];

    for (
      let date = start.clone();
      date.isBefore(end);
      date.add(1, "day")
    ) {
      dates.push(date.clone());
    }

    const sourceEvents = await ics.getEvents(...dates);

    const events = sourceEvents.map(toFullCalendarEvent);

    successCallback(events);
  } catch (error) {
    console.error("Calendar events could not be loaded:", error);
    failureCallback(error);
  }
}

this.container.style.minHeight = "460px";

const calendar = fullCalendar.renderCalendar(this.container, {
  // FullCalendar calls this whenever its visible date range changes
  events: loadEvents,

  initialView: "timeGridWeek",

  // Monday is the first day
  firstDay: 1,

  // Hide Saturday and Sunday
  weekends: false,

  nowIndicator: true,
  height: 450,

  headerToolbar: {
    left: "prev,next today",
    center: "title",
    right: "timeGridWeek,dayGridMonth"
  }
});

calendar.render();
```
