const manifest = {
    name: 'Calendar',
    slug: 'calendar',
    version: '0.1.0',
    description: 'Shared calendar for your organization',
    routes: { directory: 'screens' },
    nav: { label: 'Calendar', icon: 'calendar', order: 8, shortcut: 'c' },
    sidebar: { component: 'sidebar' },
    slots: ['sidebar.after-calendars'],
    provider: { component: 'provider' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    seed: { script: 'seed' },
    help: { directory: 'help' },
    server: { package: 'server', module: 'tinycld.org/packages/calendar' },
    repository: { url: 'https://github.com/tinycld/calendar' },
}

export default manifest
