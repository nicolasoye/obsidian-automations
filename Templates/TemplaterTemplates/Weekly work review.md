# Review
## What happened last week work wise?

## What did you plan last week? How did it go?

## Projects worked on

```dataviewjs
const previousWeek = moment(dv.current().file.name, "GGGG-[W]WW", true)
  .subtract(1, "week")
  .format("GGGG-[W]WW");
await dv.view("Views/project-system", { mode: "weekly", week: previousWeek });
```

![[Dashboard/Cards/Last Week Focus]]
## How is your organization going? How can you improve it?


# Planning
## What will happen this week? Anything non-routine to look out for (events, deadlines)?

## What is your focus?

<%*
const weekTitle = window.moment().format("GG[W]WW");
const monday = window.moment(weekTitle, "GG[W]WW").startOf("isoWeek");
const monday2 = monday.clone().subtract(1, "week");
const friday = monday.clone().add(4, "day");
%>

# Done Tasks
```tasks
done
done <% monday2.format("YYYY-MM-DD") %> <% friday.format("YYYY-MM-DD") %>
group by function task.done.format("[%%]YYYY-MM-DD[%%]dddd, MMM D")
sort by done reverse
```


# Overdue tasks
```tasks
folder does not include Personal Notes/
not done
due before today
sort by due reverse
```

#review 
<%* 
await tp.file.move(`PhD Notes/Planning/Weekly/Reviews/${tp.date.now("GGGG-[W]WW")}`);
%>

[Create weekly planning board](obsidian://quickadd?choice=Create%20weekly%20planning%20board)
