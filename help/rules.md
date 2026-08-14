---
title: Calendar rules
summary: Create events automatically when something happens
tags: [rules, automation, workflow, reminders]
order: 100
---

Calendar takes part in [automation rules](help://core:rules) two ways: a rule
can start when an event is added, and any rule can create an event as one of
its actions.

## When an event is added

The trigger **An event is added** fires for every new event on any calendar you
belong to — not only events you created yourself. You can filter on title,
location, start, end, all-day, which calendar it landed on, and whether it came
from a subscribed feed.

That last one matters if you subscribe to an external calendar. A feed sync can
import hundreds of events at once, so a rule that reacts to every new event
will react to all of them. Add the condition **From a subscribed feed is
false** to limit a rule to events people actually created.

## Creating an event from a rule

The action **Create an event** adds an event to your calendar. Instead of a
date, you say how far ahead it should start:

- **Starts in (days)** — 0 for today, 1 for tomorrow, and so on.
- **Duration (minutes)** — defaults to 30.
- **All day** — anchors the event to the whole day rather than the current
  time.
- **Remind before (minutes)** — sends the usual event reminder.

Title and description accept placeholders, so the event can describe whatever
started the rule.

The event goes on the calendar you own. If you only belong to shared calendars,
it goes on one of those.

## The recipe this exists for

**Turn a message into a reminder.** When a message arrives, if the subject
contains `invoice`, create an event titled `{{subject}}` starting in 3 days
with a 60-minute reminder. The `{{ }}` button in the builder inserts the
placeholder.

This needs the mail package installed. If it isn't, that trigger simply won't
appear in the list.

## What rules can't do yet

- **Timing relative to an event.** "Fifteen minutes before this starts" isn't
  expressible — rules react to an event being *added or changed*, not to time
  passing. Use the event's own reminder for that.
- **A specific date.** Events are scheduled as an offset from now, not as a
  calendar date, because rule parameters carry no date arithmetic yet.
- **Changing an existing event.** A rule can create an event, but it can't find
  one and move it. Only the record that started the rule can be updated.
