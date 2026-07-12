import type PocketBase from 'pocketbase'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:calendar] ${args.join(' ')}\n`)
}

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

function today() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

function dateAt(dayOffset: number, hour: number, minute = 0) {
    const d = today()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d.toISOString()
}

function allDayDate(dayOffset: number) {
    const d = today()
    d.setDate(d.getDate() + dayOffset)
    return d.toISOString()
}

const CALENDARS = [
    { name: 'Work', color: 'blue', description: 'Work calendar' },
    { name: 'Personal', color: 'green', description: 'Personal events' },
    { name: 'Team', color: 'teal', description: 'Shared team calendar' },
    { name: 'Holidays', color: 'red', description: 'Company holidays' },
] as const

const EVENTS = [
    // =========================================================================
    // VISIBLE DAYS (this week / this month). Events are spread so at most two
    // overlap at any moment and most stand alone — the calendar reads cleanly in
    // week and month view for marketing screenshots. The dense overlap layout is
    // still exercised by the single STRESS-TEST DAY below (day -35, last month,
    // outside the screenshot window) and by the layout unit tests.
    //
    // Constraint: today (day 0) has no timed event before 09:00 — calendar-drag
    // e2e creates a one-off 08:00 event and relies on nothing overlapping it.
    // =========================================================================

    // DAY -7
    {
        title: 'Quarterly Planning',
        description: 'Full-day planning session',
        location: 'Board Room',
        start: () => dateAt(-7, 9, 0),
        end: () => dateAt(-7, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Lunch Run',
        description: '',
        location: '',
        start: () => dateAt(-7, 12, 30),
        end: () => dateAt(-7, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },

    // DAY -6
    {
        title: 'Kickoff Meeting',
        description: '',
        location: 'Room 101',
        start: () => dateAt(-6, 9, 0),
        end: () => dateAt(-6, 10, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Architecture Review',
        description: '',
        location: 'Room 101',
        start: () => dateAt(-6, 10, 30),
        end: () => dateAt(-6, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Design Sync',
        description: '',
        location: 'Zoom',
        start: () => dateAt(-6, 14, 0),
        end: () => dateAt(-6, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY -5
    {
        title: 'Deep Work Block',
        description: 'Long focus session',
        location: '',
        start: () => dateAt(-5, 9, 0),
        end: () => dateAt(-5, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Quick Standup',
        description: '',
        location: 'Slack huddle',
        start: () => dateAt(-5, 13, 0),
        end: () => dateAt(-5, 13, 15),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY -4
    {
        title: 'Interview: Round 1',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 10, 0),
        end: () => dateAt(-4, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Interview: Round 2',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 13, 0),
        end: () => dateAt(-4, 14, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'accepted', role: 'attendee' },
        ],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Debrief',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 15, 0),
        end: () => dateAt(-4, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'private',
    },

    // DAY -3
    {
        title: 'Exec Sync',
        description: '',
        location: 'Board Room',
        start: () => dateAt(-3, 9, 30),
        end: () => dateAt(-3, 10, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Coffee Chat',
        description: '',
        location: 'Lobby',
        start: () => dateAt(-3, 11, 0),
        end: () => dateAt(-3, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Sprint Retro',
        description: '',
        location: 'Room B',
        start: () => dateAt(-3, 14, 0),
        end: () => dateAt(-3, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY -2
    {
        title: 'Morning Standup',
        description: '',
        location: 'Slack',
        start: () => dateAt(-2, 9, 0),
        end: () => dateAt(-2, 9, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Code Review',
        description: '',
        location: '',
        start: () => dateAt(-2, 10, 30),
        end: () => dateAt(-2, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Design Workshop',
        description: '',
        location: 'Room C',
        start: () => dateAt(-2, 14, 0),
        end: () => dateAt(-2, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY -1
    {
        title: 'Strategy Session',
        description: '',
        location: 'Board Room',
        start: () => dateAt(-1, 9, 0),
        end: () => dateAt(-1, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Client Lunch',
        description: '',
        location: 'Cafe Milano',
        start: () => dateAt(-1, 12, 30),
        end: () => dateAt(-1, 14, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Platform Sync',
        description: '',
        location: 'Zoom',
        start: () => dateAt(-1, 15, 0),
        end: () => dateAt(-1, 16, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY 0 (TODAY) — no timed event before 09:00 (calendar-drag needs 08:00 free)
    {
        title: 'Team Standup',
        description: 'Daily sync',
        location: 'Room A',
        start: () => dateAt(0, 9, 0),
        end: () => dateAt(0, 9, 30),
        all_day: false,
        recurrence: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Design Review',
        description: '',
        location: 'Figma',
        start: () => dateAt(0, 10, 30),
        end: () => dateAt(0, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' },
        ],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Lunch & Learn',
        description: '',
        location: 'Kitchen',
        start: () => dateAt(0, 12, 0),
        end: () => dateAt(0, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Product Review',
        description: '',
        location: 'Room C',
        start: () => dateAt(0, 14, 0),
        end: () => dateAt(0, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
        ],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Focus Time',
        description: '',
        location: '',
        start: () => dateAt(0, 15, 30),
        end: () => dateAt(0, 17, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY +1 — early and late bookends
    {
        title: 'Gym',
        description: '',
        location: 'Fitness Center',
        start: () => dateAt(1, 6, 30),
        end: () => dateAt(1, 7, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 15,
        busy_status: 'free',
        visibility: 'private',
    },
    {
        title: '1:1 with Manager',
        description: '',
        location: 'Office',
        start: () => dateAt(1, 10, 0),
        end: () => dateAt(1, 10, 45),
        all_day: false,
        recurrence: 'FREQ=WEEKLY',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Board Game Night',
        description: '',
        location: "Bob's place",
        start: () => dateAt(1, 20, 0),
        end: () => dateAt(1, 22, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Eve Miller', email: 'eve@acme.co', rsvp: 'accepted', role: 'attendee' },
        ],
        reminder: 60,
        busy_status: 'free',
        visibility: 'default',
    },

    // DAY +2
    {
        title: 'Product Demo',
        description: '',
        location: 'Main Room',
        start: () => dateAt(2, 10, 0),
        end: () => dateAt(2, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'public',
    },
    {
        title: 'Vendor Call',
        description: '',
        location: 'Zoom',
        start: () => dateAt(2, 14, 0),
        end: () => dateAt(2, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY +3
    {
        title: 'Dentist',
        description: '',
        location: 'Dr. Smith Office',
        start: () => dateAt(3, 10, 0),
        end: () => dateAt(3, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 120,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Yoga Class',
        description: '',
        location: 'Downtown Studio',
        start: () => dateAt(3, 18, 0),
        end: () => dateAt(3, 19, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 60,
        busy_status: 'free',
        visibility: 'default',
    },

    // DAY +4
    {
        title: 'Sync: Frontend',
        description: '',
        location: '',
        start: () => dateAt(4, 9, 0),
        end: () => dateAt(4, 9, 45),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sync: Backend',
        description: '',
        location: '',
        start: () => dateAt(4, 11, 0),
        end: () => dateAt(4, 11, 45),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'All-Hands',
        description: '',
        location: 'Auditorium',
        start: () => dateAt(4, 14, 0),
        end: () => dateAt(4, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'public',
    },

    // DAY +5
    {
        title: 'Breakout Session',
        description: '',
        location: 'Room E',
        start: () => dateAt(5, 10, 0),
        end: () => dateAt(5, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // DAY +7 — late night edge
    {
        title: 'Deploy Window',
        description: 'Late-night maintenance window',
        location: '',
        start: () => dateAt(7, 23, 0),
        end: () => dateAt(7, 23, 59),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 60,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // STRESS-TEST DAY (day -35, last month — OUTSIDE the screenshot window).
    // Preserves the dense overlap fixture for manual/visual layout verification:
    // a six-way overlap peaking at 14:00, a long block split by two tiny events,
    // and back-to-back zero-gap meetings — the cases the layout algorithm has to
    // get right. Kept off the current month so it never appears in marketing
    // screenshots. (The layout unit tests cover overlaps independently.)
    // =========================================================================
    {
        title: 'Deep Work Block',
        description: 'Long focus session split by tiny events',
        location: '',
        start: () => dateAt(-35, 9, 0),
        end: () => dateAt(-35, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Fire Drill',
        description: 'Tiny event inside the block',
        location: '',
        start: () => dateAt(-35, 10, 0),
        end: () => dateAt(-35, 10, 15),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Interview: Round 1',
        description: 'Back-to-back, zero gap',
        location: 'Room A',
        start: () => dateAt(-35, 10, 30),
        end: () => dateAt(-35, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Interview: Round 2',
        description: 'Starts exactly when Round 1 ends',
        location: 'Room A',
        start: () => dateAt(-35, 11, 30),
        end: () => dateAt(-35, 12, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Exec Sync',
        description: 'Six-way overlap peaking at 14:00',
        location: 'Board Room',
        start: () => dateAt(-35, 13, 0),
        end: () => dateAt(-35, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Bug Triage',
        description: '',
        location: '',
        start: () => dateAt(-35, 13, 30),
        end: () => dateAt(-35, 14, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Vendor Call',
        description: '',
        location: 'Zoom',
        start: () => dateAt(-35, 14, 0),
        end: () => dateAt(-35, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Coffee Chat',
        description: '',
        location: 'Lobby',
        start: () => dateAt(-35, 14, 0),
        end: () => dateAt(-35, 14, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: '1:1 with PM',
        description: '',
        location: 'Office',
        start: () => dateAt(-35, 14, 15),
        end: () => dateAt(-35, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Sprint Retro',
        description: '',
        location: 'Room B',
        start: () => dateAt(-35, 14, 30),
        end: () => dateAt(-35, 16, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // ALL-DAY EVENTS — multi-day spans. These read cleanly in week and month
    // view (they pack into the all-day header rows), so they stay as-is.
    // =========================================================================
    {
        title: 'Sprint 42',
        description: 'Full sprint marker',
        location: '',
        start: () => allDayDate(-7),
        end: () => allDayDate(-1),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Alice OOO',
        description: 'Vacation',
        location: '',
        start: () => allDayDate(-5),
        end: () => allDayDate(-2),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Release Day',
        description: '',
        location: '',
        start: () => allDayDate(-3),
        end: () => allDayDate(-3),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'public',
    },
    {
        title: 'Contractor Visit',
        description: 'Spans across the week boundary',
        location: '',
        start: () => allDayDate(-2),
        end: () => allDayDate(1),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Matt OOO',
        description: 'Out of office',
        location: '',
        start: () => allDayDate(0),
        end: () => allDayDate(0),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Feature Freeze',
        description: '',
        location: '',
        start: () => allDayDate(0),
        end: () => allDayDate(4),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'public',
    },
    {
        title: 'Company Holiday',
        description: 'Office closed',
        location: '',
        start: () => allDayDate(6),
        end: () => allDayDate(6),
        all_day: true,
        recurrence: '',
        calendar: 'Holidays',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'public',
    },
    {
        title: 'Team Offsite',
        description: '',
        location: 'Mountain Lodge',
        start: () => allDayDate(5),
        end: () => allDayDate(7),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 1440,
        busy_status: 'busy',
        visibility: 'default',
    },
]

function roleForCalendar(calName: string) {
    if (calName === 'Work' || calName === 'Personal') return 'owner'
    if (calName === 'Team') return 'editor'
    return 'viewer'
}

async function seedCalendars(
    pb: PocketBase,
    orgId: string,
    userOrgId: string,
    otherMembers: { id: string }[]
) {
    const calendarMap: Record<string, string> = {}
    for (const cal of CALENDARS) {
        log(`Creating calendar: ${cal.name}`)
        const record = await pb.collection('calendar_calendars').create({
            org: orgId,
            name: cal.name,
            description: cal.description,
            color: cal.color,
        })
        calendarMap[cal.name] = record.id

        await pb.collection('calendar_members').create({
            calendar: record.id,
            user_org: userOrgId,
            role: roleForCalendar(cal.name),
        })

        if (cal.name === 'Team' || cal.name === 'Holidays') {
            for (const member of otherMembers) {
                await pb.collection('calendar_members').create({
                    calendar: record.id,
                    user_org: member.id,
                    role: cal.name === 'Team' ? 'editor' : 'viewer',
                })
            }
        }
    }
    return calendarMap
}

async function seedEvents(pb: PocketBase, calendarMap: Record<string, string>, userOrgId: string) {
    for (const event of EVENTS) {
        await pb.collection('calendar_events').create({
            calendar: calendarMap[event.calendar],
            created_by: userOrgId,
            title: event.title,
            description: event.description,
            location: event.location,
            start: event.start(),
            end: event.end(),
            all_day: event.all_day,
            recurrence: event.recurrence,
            guests: event.guests,
            reminder: event.reminder,
            busy_status: event.busy_status,
            visibility: event.visibility,
        })
    }
}

export default async function seed(pb: PocketBase, { org, userOrg }: SeedContext) {
    // Check for existing seed events (not calendars, since the lifecycle hook
    // auto-creates a personal calendar when user_org is created)
    const existingEvents = await pb.collection('calendar_events').getList(1, 1, {
        filter: `created_by = "${userOrg.id}"`,
    })
    if (existingEvents.totalItems > 0) {
        log(`Skipping (${existingEvents.totalItems} events already exist)`)
        return
    }

    const otherMembers = await pb.collection('user_org').getFullList({
        filter: `org = "${org.id}" && id != "${userOrg.id}"`,
    })

    const calendarMap = await seedCalendars(pb, org.id, userOrg.id, otherMembers)

    log(`Creating ${EVENTS.length} events...`)
    await seedEvents(pb, calendarMap, userOrg.id)

    log(`Created ${CALENDARS.length} calendars and ${EVENTS.length} events`)
}
