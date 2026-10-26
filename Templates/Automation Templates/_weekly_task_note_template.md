<%*
const weekTitle = window.moment().format("GG[W]WW");
const monday = window.moment(weekTitle, "GG[W]WW").startOf("isoWeek");
const tuesday = monday.clone().add(1, "day");
const wednesday = monday.clone().add(2, "day");
const thursday = monday.clone().add(3, "day");
const friday = monday.clone().add(4, "day");
%>
# Open
```tasks
not done
due <% monday.format("YYYY-MM-DD") %> <% friday.format("YYYY-MM-DD") %>
group by function task.due.format("[%%]YYYY-MM-DD[%%]dddd, MMM D")
sort by due
```
# Done
```tasks
done
done <% monday.format("YYYY-MM-DD") %> <% friday.format("YYYY-MM-DD") %>
group by function task.done.format("[%%]YYYY-MM-DD[%%]dddd, MMM D")
sort by done reverse
```


# New Tasks
