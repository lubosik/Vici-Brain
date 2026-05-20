# Intelligence Signals
> Auto-generated. Do not edit.

```dataview
TABLE priority AS "Priority", status AS "Status", date AS "Date"
FROM "Vici Brain/Intelligence"
WHERE file.name != "_Index"
SORT date DESC
LIMIT 20
```

## Daily Briefs
```dataview
LIST
FROM "Vici Brain/Intelligence"
WHERE contains(tags, "daily-brief")
SORT date DESC
LIMIT 30
```

## All Signals
- None yet
