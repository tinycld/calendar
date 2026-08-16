const manifest = {
    name: 'Calendar',
    slug: 'calendar',
    version: '0.3.0',
    description: 'Shared calendars, events and reminders',
    routes: { directory: 'screens' },
    nav: { label: 'Calendar', icon: 'calendar', order: 8, shortcut: 'c' },
    sidebar: { component: 'sidebar' },
    slots: ['sidebar.after-calendars'],
    // Other packages contribute read-only event feeds (e.g. cards' due dates)
    // that render on the grid with a sidebar visibility toggle. See
    // core/lib/event-sources/types.ts for the contract.
    eventSourceHost: true,
    provider: { component: 'provider' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    // Trigger + action catalog for workflow rules. The Go side
    // (server/automation.go) registers the calendar_members owner resolver and
    // the create-event handler.
    automation: { definitions: 'automation' },
    seed: { script: 'seed' },
    help: { directory: 'help' },
    server: { package: 'server', module: 'tinycld.org/packages/calendar' },
    // Contributes the `tinycld calendar` command group. Both scopes are needed:
    // read for agenda/list/events/show/export, write for add/rm/rsvp/import.
    cli: {
        package: 'cli',
        module: 'tinycld.org/packages/calendar/cli',
        scopes: ['calendar:read', 'calendar:write'],
    },
    // Server-side TS hooks: drop a *.pb.ts into pb-hooks/ to extend calendar
    // behavior alongside the Go, including the caldavHook interception points
    // (see help/caldav-hooks.md).
    hooks: { directory: 'pb-hooks' },
    // CalDAV over /caldav, served by core (tinycld.org/core/caldav). This
    // mirrors the calDAVSource literal in server/register.go, which is what the
    // single-tenant app registers. A multi-org tenant serves CalDAV from this
    // block (the router materializes it into the tenant's runtime config) —
    // that is why the Go-side mount is host-only even though calendar's other
    // Go links into tenants via RegisterTenant.
    //
    // No permissions appear here: authorization comes from the collections' own
    // PocketBase rules, which core evaluates with app.CanAccessRecord.
    caldav: {
        calendarCollection: 'calendar_calendars',
        eventCollection: 'calendar_events',
        calendar: {
            name: 'name',
            description: 'description',
        },
        event: {
            calendar: 'calendar',
            uid: 'ical_uid',
            owner: 'created_by',
            title: 'title',
            description: 'description',
            location: 'location',
            start: 'start',
            end: 'end',
            allDay: 'all_day',
            recurrence: 'recurrence',
            guests: 'guests',
            reminder: 'reminder',
            busyStatus: 'busy_status',
            visibility: 'visibility',
            updated: 'updated',
            created: 'created',
            // Required selects with no schema default. A minimal VEVENT carries
            // neither TRANSP nor CLASS, so without these a client PUT is
            // rejected — and a tenant's CalDAV runs from this materialized
            // block, so the defaults must ride here as data.
            defaults: {
                busy_status: 'busy',
                visibility: 'default',
            },
        },
    },
    repository: { url: 'https://github.com/tinycld/calendar' },
    peerVersions: { '@tinycld/core': '>=0.0.4 <0.1.0' },
}

export default manifest
