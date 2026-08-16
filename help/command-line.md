---
title: Calendar from the command line
summary: Check your agenda, add and delete events, RSVP, and move calendars as .ics files from a terminal.
tags: [cli, terminal, automation, ical, ics, export, import, agenda]
order: 110
---

The `tinycld` command line tool includes a `calendar` command group when the
Calendar package is installed. To download the tool and log in, see
[Command line tool](help://core:command-line). Everything below assumes you
are logged in.

Calendars can be named by id or by name, so `--calendar Work` works as well as
`--calendar cal123`. Events are addressed by id, shown in the last column of
`agenda`, `events`, and `show`.

## What you can do depends on your role

Every calendar you can see is one you are a member of, and your role decides
what the commands will let you do:

| Role | Can |
|---|---|
| viewer | read the calendar and export it |
| editor | also add, change, and delete events, and import |
| owner | also manage the calendar itself |

`tinycld calendar list` shows your role for each calendar, so check there
first if a write is refused.

## Looking at your schedule

```
tinycld calendar agenda                  # the next 7 days, all calendars
tinycld calendar agenda --days 30        # look further ahead
tinycld calendar agenda --calendar Work  # just one calendar
tinycld calendar list                    # your calendars and your role on each
```

`agenda` starts from right now, so a meeting that has already finished today
does not appear. For an explicit window — including the past — use `events`:

```
tinycld calendar events --from 2026-08-01 --to 2026-09-01
tinycld calendar show evt123             # one event, every field and guest
```

The range is half-open: an event starting exactly at `--to` is not included.

## Adding and removing events

```
tinycld calendar add --calendar Work --title Standup --start "2026-08-20 09:30"
tinycld calendar add --calendar Work --title Offsite --start 2026-09-01 --all-day
tinycld calendar add --calendar Work --title Review --start "2026-08-21 14:00" \
    --end "2026-08-21 15:30" --location "Room 4" \
    --guest ada@example.com --guest grace@example.com
tinycld calendar rm evt123
```

Times accept `2026-08-20`, `"2026-08-20 14:30"`, or a full RFC3339 timestamp.
Without `--end` an event lasts an hour, or the whole day with `--all-day`.
`--recurrence` takes `daily`, `weekly`, `monthly`, or `yearly`, and
`--reminder` takes minutes before the start.

Calendar events have no trash, so `rm` asks for confirmation naming the event
and its date. Pass `--yes` in scripts.

## Replying to invitations

```
tinycld calendar rsvp evt123 yes
tinycld calendar rsvp evt123 maybe
```

Answers are `yes`, `no`, or `maybe`. You must already be on the event's guest
list — the command replies to an invitation rather than adding you to one.

## Moving calendars in and out

```
tinycld calendar export --calendar Work --out work.ics
tinycld calendar export --calendar Work > backup.ics
tinycld calendar import --calendar Work work.ics
```

Export writes a calendar as a standard iCalendar (`.ics`) file, which any
other calendar application can read.

Import matches each event on its UID, so re-importing a file you exported
updates those events instead of duplicating them. An event that cannot be read
is reported and skipped rather than failing the whole file. Importing needs
editor or owner access — being able to read a calendar is not enough.

To follow a calendar that someone else keeps updated, subscribe to its URL
instead of importing once — see
[Items from other apps on your calendar](help://calendar:event-sources). To
keep a desktop or phone client continuously in sync, use CalDAV — see
[Connecting a calendar client](help://calendar:caldav).

## Scripting

Every command accepts `--json` for stable, machine-readable output:

```
tinycld calendar agenda --json | jq '.[].title'
tinycld calendar list --json | jq '.[].name'
```
