const manifest = {
    name: 'Calendar',
    slug: 'calendar',
    version: '0.4.0',
    description: 'Shared calendars, events and reminders',
    routes: { directory: 'screens' },
    nav: { label: 'Calendar', icon: 'calendar', order: 8, shortcut: 'c' },
    sidebar: { component: 'sidebar' },
    slots: ['sidebar.after-calendars'],
    // Other packages contribute read-only event feeds (e.g. boards' due dates)
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
    // Contributes the `tinycld calendar` command group. Its OAuth scopes are
    // registered by server/oauth_scopes.go: read for agenda/list/events/show/
    // export, write for add/rm/rsvp/import.
    cli: {
        package: 'cli',
        module: 'tinycld.org/packages/calendar/cli',
    },
    // Server-side TS hooks: drop a *.pb.ts into pb-hooks/ to extend calendar
    // behavior alongside the Go, including the caldavHook interception points
    // (see help/caldav-hooks.md).
    hooks: { directory: 'pb-hooks' },
    repository: { url: 'https://github.com/tinycld/calendar' },
    peerVersions: { '@tinycld/core': '>=0.6.3 <0.7.0' },
}

export default manifest
