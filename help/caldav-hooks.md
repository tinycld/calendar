---
title: Customizing CalDAV behavior
summary: Block writes or hide events over CalDAV with a server-side TypeScript hook
tags: [caldav, hooks, typescript, customize, admin]
order: 115
---

## What this is for

Calendar's CalDAV server enforces the same access rules as the web UI: you see the calendars you're a member of, and only owners and editors can change events. Some deployments need more — freezing a calendar so clients can read but not write it, keeping personal events out of a shared client, refusing deletes on a calendar that feeds a room display.

You can add rules like that in TypeScript, without changing Calendar itself. This is an administrator-level task: it requires access to the server's `pb-hooks/` directory.

> **Nothing is enabled by default.** A deployment that adds no hooks runs Calendar's normal path with no overhead at all — the rules below cost nothing until you write one.

## Where the code goes

Create or edit a `.pb.ts` file in Calendar's `pb-hooks/` directory, and call `caldavHook` with the points you want:

```ts
caldavHook({
    beforeWrite(e) {
        if (e.calendarId === 'room-display-calendar-id') {
            throw new Error('this calendar is managed centrally')
        }
    },
    filterList(e) {
        return e.items.filter(function (uid) { return uid.indexOf('private-') === -1 })
    },
})
```

Restart the server to pick up changes.

## The four points

| Point | Fires on | What it receives | What it can do |
|---|---|---|---|
| `beforeWrite` | a client saving an event (PUT) | `slug`, `calendarId`, `icalUid`, `userId`, `isCreate` | throw to reject |
| `beforeDelete` | a client deleting an event | `slug`, `id`, `calendarId`, `icalUid`, `userId` | throw to reject |
| `canRead` | each event fetched or listed | `slug`, `id`, `calendarId`, `icalUid`, `userId` | return `false` to hide it |
| `filterList` | each calendar listing | `slug`, `calendarId`, `userId`, `items` (the iCal UIDs) | return the UIDs to keep |

`isCreate` distinguishes a new event from an update to an existing one, so you can allow edits while refusing new entries (or the reverse).

The message you throw reaches the server log, so make it explain the rule.

There is no `beforeMove` point. CalDAV has no move: a client relocating an event saves it to the new calendar and deletes the old copy, so `beforeWrite` and `beforeDelete` already see both halves.

## What a hook cannot do

**A hook can only take access away, never grant it.** Calendar checks its own permissions first, so `canRead` is asked only about events you could already see, and any UID `filterList` returns that Calendar did not authorize is discarded. There is no way to widen access from a hook — which means a mistake here can hide events, but cannot expose someone else's calendar.

The same applies to writes. `beforeWrite` runs in addition to the normal owner/editor check, so it can refuse a write an editor would otherwise be allowed, but it cannot let a viewer through.

Two practical limits:

- A handler must be **self-contained**. Anything it needs has to live inside its own body — a `const` or helper function declared at the top of the file is not visible when the handler runs.
- Handlers are **synchronous**. Don't use `async` or return a Promise.

## Performance

`filterList` is called once per calendar with the whole batch of UIDs, not once per event, so filtering a busy calendar costs one call. `canRead` is called per event, so prefer `filterList` when you can express the rule as a filter over UIDs.

## Examples

Freeze a calendar against client writes, while leaving it readable:

```ts
caldavHook({
    beforeWrite(e) {
        if (e.calendarId === 'the-frozen-calendar-id') {
            throw new Error('this calendar is read-only over CalDAV')
        }
    },
    beforeDelete(e) {
        if (e.calendarId === 'the-frozen-calendar-id') {
            throw new Error('this calendar is read-only over CalDAV')
        }
    },
})
```

Allow edits to existing events but no new ones:

```ts
caldavHook({
    beforeWrite(e) {
        if (e.isCreate) {
            throw new Error('new events must be created in the web app')
        }
    },
})
```

Keep events tagged private out of every CalDAV listing:

```ts
caldavHook({
    filterList(e) {
        return e.items.filter(function (uid) {
            return uid.indexOf('urn:uuid:private-') !== 0
        })
    },
})
```

## Multi-org deployments

Under the multi-org router each organization runs in its own process, and a tenant process links no feature code of its own — it serves CalDAV from configuration the router hands it. Those processes do not currently run package TypeScript, so **`caldavHook` applies to single-organization deployments only.** The rest of CalDAV, including all of its access checks, works identically in both.
