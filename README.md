# @tinycld/calendar

Shared calendars — with day, week, month, and schedule views, recurring events, guest management, RSVPs, reminders, external subscriptions, and a native CalDAV endpoint.

Part of [TinyCld](https://tinycld.org/) — the open-source, self-hosted Google Workspace alternative.

## Features

- **Multiple calendars.** Each user can own any number of calendars and be invited to others as owner, editor, or viewer.
- **Day, Week, Month, Schedule views.** Keyboard-navigable, color-coded, with a live "now" indicator and all-day event bar.
- **Recurring events.** Daily, weekly, monthly, yearly — stored as iCalendar RRULEs so they round-trip through CalDAV.
- **Guests & RSVP.** Invite attendees by email with `accepted` / `declined` / `tentative` / `pending` status. Organizer vs. attendee roles.
- **Reminders.** Per-event reminder offsets flow through the app shell's unified notification bus (toast + drawer + Expo push).
- **Busy / free & visibility.** Mark events busy or free; keep event details private, public, or default per calendar.
- **Color-coded categories.** 17 named colors (`blueberry`, `sage`, `tangerine`, …) that work in light and dark themes.
- **Calendar subscriptions.** Subscribe to any external `.ics` URL (holidays, sports schedules, teammate calendars). The server polls and refreshes them on a schedule.
- **CalDAV sync.** Native `/caldav/` endpoint. Apple Calendar, GNOME Calendar, DAVx5, Thunderbird — any CalDAV client just works.
- **Real-time updates.** Edits from any client appear instantly in every other session.
- **Quick create.** One-keystroke event creation from any view.

## Automation rules

Four triggers and one action, published to the automation-rules engine:

- **`calendar:event-added`** — "An event is added". A `calendar_events` create, ownerField `created_by`. Condition fields: `title`, `location`, `start`, `end`, `all_day`, `calendar`, `from_subscription`. Filter on `from_subscription` false to ignore the hundreds of events a feed sync can import at once.
- **`calendar:event-rescheduled`** — "An event is rescheduled". An update watching `start` and `end` only, so editing a title or location stays quiet.
- **`calendar:event-removed`** — "An event is removed". A delete, ownerField `created_by`.
- **`calendar:feed-sync-failed`** — "A calendar feed fails to sync". A `calendar_calendars` update watching `subscription_error`. Condition fields: `name`, `subscription_error`, `subscription_url`. Without a rule this failure is silent — the calendar just stops updating.
- **`calendar:create-event`** — "Create an event". A `kind: 'native'` action with `title`, `description`, `starts_in_days` (number), `duration_minutes` (number), `all_day` (boolean), and `reminder_minutes` (number) params. It is scheduled as an offset from now rather than a calendar date because rule params carry no date arithmetic, and it files on a calendar the rule owner can write.

`server/automation.go` holds the server-side pieces: `eventOwnerResolver` fans out over `calendar_members` (superseding the ownerField fallback) on the three event triggers; `calendarOwnerResolver` plus a `calendarSyncFailed` filter handle feed-sync-failed; and `actionCreateEvent` routes its write through `MarkEngineWrite`, because `calendar:event-added` watches the very collection it creates into.

Rules are declared with `automation: { definitions: 'automation' }` in `manifest.ts` plus a `"./automation"` entry in the `package.json` exports map; the catalog lives in `tinycld/calendar/automation.ts`. In-app help is `help/rules.md`. See [Automation rules](https://tinycld.org/docs/automation-rules) and [the automation anatomy reference](https://tinycld.org/docs/anatomy/automation).

## Protocol

| Protocol | RFC       | Port | Purpose                         |
|----------|-----------|------|---------------------------------|
| CalDAV   | RFC 4791  | 443  | Read/write calendars & events   |

## Relationship to the app shell

`@tinycld/calendar` is a feature package for the [TinyCld app shell](https://github.com/tinycld/tinycld). The shell nests `@tinycld/core` (auth, routing, storage, UI primitives) at `tinycld/core/`. The app shell ships with **no** feature packages; install this one to add a Calendar app.

This package contributes:

- **Screens** — routes at `/calendar`.
- **Provider** — a wrapping context that loads calendar memberships and visible-calendar state.
- **Nav entry** — sidebar icon with keyboard shortcut `c`.
- **Sidebar slot** — `sidebar.after-calendars`, exposed for other packages to inject sections (e.g. "My Booking Pages") below the calendar list. See [Sidebar slots](https://tinycld.org/docs/anatomy/sidebar-slots).
- **Collections** — `calendar_calendars`, `calendar_members`, `calendar_events` (pbtsdb, live-queried).
- **Migrations** — schema under `pb-migrations/`.
- **Go server module** — the CalDAV field map core's protocol server is driven by (`tinycld.org/core/caldav`), plus the subscription poller, reminder scheduler, and membership guards, wired into the app shell's PocketBase binary.
- **TS hook points** — `caldavHook({ beforeWrite, beforeDelete, canRead, filterList })` for customizing CalDAV without forking the Go. See `help/caldav-hooks.md`.

The package depends on `@tinycld/core` at runtime (React, pbtsdb, `~/lib/*`). The app shell has no knowledge of this package at compile time — everything is discovered at generator time by scanning the workspace members.

## Installation

From inside your app shell checkout (`tinycld/tinycld`):

```sh
pnpm run packages:install <this-repo-git-url>
```

That clones the repo next to the app shell as a workspace member sibling, symlinks it into `node_modules/@tinycld/calendar`, and runs the generator to wire up routes, collections, migrations, and Go server extensions.

To remove:

```sh
pnpm run packages:unlink @tinycld/calendar
```

## Command line

This package's command group in the `tinycld` binary. The Go source lives in `cli/`, declared by a `cli` block in `manifest.ts` naming the Go module and the OAuth scopes (`calendar:read`, `calendar:write`). The server cross-compiles the binary; users download it from **Settings → Personal → About**.

Nine commands, under `tinycld calendar` (alias `cal`):

```sh
tinycld cal agenda
tinycld cal list        # your calendars, with a ROLE column
tinycld cal events
tinycld cal show
tinycld cal add
tinycld cal rm
tinycld cal rsvp
tinycld cal export
tinycld cal import
```

Reading requires membership in any role, but writing requires owner or editor — `calendar list`'s ROLE column is the only advance indication of which you have. `rsvp` is refused if you are not on the guest list.

In-app help is `help/command-line.md`. See [the command line tool](https://tinycld.org/docs/command-line-tool) and the [CLI reference](https://tinycld.org/docs/reference/cli-reference).

## Development

This package is not run standalone — it only makes sense inside an app shell checkout.

```sh
cd ../tinycld
pnpm run dev              # expo + pocketbase with calendar linked
pnpm run test             # includes this package's layout tests
pnpm run checks           # biome + tsc across the app shell + linked packages
```

**Do not** run `pnpm install` (or any other package manager's install) inside this directory. Peer dependencies resolve through the app shell's `node_modules/`; installing here creates duplicate copies of `react`, `react-native`, etc. and breaks TypeScript.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, nav, sidebar, collections, migrations, server module, automation, cli, help)
- `package.json` — name, exports map, peer deps
- `tsconfig.json` — thin extend of the app shell's package tsconfig base
- `pb-migrations/` — PocketBase migrations
- `server/` — Go server module: CalDAV field map, subscription poller, reminder scheduler, membership guards, and `automation.go`
- `cli/` — Go source for this package's `tinycld` command group
- `help/` — in-app help topics (markdown + frontmatter)
- `tests/` — vitest unit tests + Playwright e2e specs
- `tinycld/calendar/` — TypeScript source (screens, provider, collections, and `automation.ts`)

## License

See the root TinyCld repository for licensing.
