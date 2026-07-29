import { expect, test } from '@playwright/test'
import { type CalDAVCalendar, propfindCalendars } from '@tinycld/core/e2e-caldav-helpers'
import { createInvitedUser, type InvitedUser, login } from '@tinycld/core/e2e-helpers'

// Pick the auto-created personal calendar, which is named after the user and
// always exists (a users-create hook mints one per account).
//
// Single-org: the deployment IS the org, so displaynames are no longer suffixed
// with an org name — the bare name is the only form.
function pickPersonalCalendar(calendars: CalDAVCalendar[]): CalDAVCalendar {
    const personal = calendars.find(c => c.name === 'Test User')
    if (personal) return personal
    throw new Error(
        `No "Test User" calendar in PROPFIND result; got: ${calendars.map(c => c.name).join(', ')}`
    )
}

// PB sits behind the dev.ts proxy on the test Expo port. /api/* and /caldav/*
// route through to PB transparently — see scripts/dev.ts::isPbPath.
const PB_URL = 'http://127.0.0.1:7200'

/**
 * Issue an authenticated PROPFIND on /caldav/u/cal/ as the given user.
 * Returns the parsed calendar list, used to verify that a sharee can see
 * a calendar shared with them (or that a non-sharee cannot).
 *
 * Read-only, so a direct protocol request is the point rather than a bypass:
 * driving CalDAV IS what this asserts.
 */
async function propfindCalendarsAs(user: InvitedUser): Promise<{ id: string; name: string }[]> {
    const auth = `Basic ${Buffer.from(`${user.email}:${user.password}`).toString('base64')}`
    const res = await fetch(`${PB_URL}/caldav/u/cal/`, {
        method: 'PROPFIND',
        headers: {
            Authorization: auth,
            Depth: '1',
            'Content-Type': 'application/xml; charset=utf-8',
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
    <prop>
        <displayname/>
        <resourcetype/>
    </prop>
</propfind>`,
    })
    if (res.status !== 207) {
        throw new Error(`PROPFIND as ${user.email} expected 207, got ${res.status}`)
    }
    const xml = await res.text()
    const out: { id: string; name: string }[] = []
    const responseRe = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g
    for (const m of xml.matchAll(responseRe)) {
        const block = m[1]
        const hrefMatch = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)
        if (!hrefMatch) continue
        const dnMatch = /<(?:\w+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/.exec(
            block
        )
        const idMatch = /\/caldav\/u\/cal\/([^/]+)\/?$/.exec(hrefMatch[1].trim())
        if (idMatch?.[1]) {
            out.push({ id: idMatch[1], name: dnMatch?.[1].trim() ?? '' })
        }
    }
    return out
}

// Run serially: each test mutates calendar_members on the shared calendar
// and the next test relies on a clean slate. Parallel runs would step on
// each other's "added member" state.
test.describe.configure({ mode: 'serial' })

test.describe('Calendar — Sharing UI', () => {
    test('Owner sees themselves in the Shared with list', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickPersonalCalendar(calendars)

        await login(page)
        // Deep-link straight to the settings route for the specific calendar
        // whose id came back from PROPFIND. The in-app path (kebab menu →
        // "Settings & sharing") isn't expressible here: navigateToPackage +
        // sidebar clicks can't target a calendar known only by its PB id
        // (the sidebar matches by name, and the id→name mapping isn't
        // available to the test). A record deep-link is the only stable way
        // to land on this exact calendar's settings, so the goto is
        // intentional rather than in-app screen navigation.
        await page.goto(`/calendar/settings/${cal.id}`)
        await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

        // The seed user "Test User" appears as a member with the "Owner" role.
        // Both the avatar text and the role pill come from the same joined live
        // query, so seeing both confirms the row rendered end to end (membership
        // row + users join). Scope to the member row testID — a bare
        // page.getByText('Owner') is satisfiable by other packages' UI.
        const memberRow = page.getByTestId(/^calendar-member-row-/).filter({ hasText: 'Test User' })
        await expect(memberRow.first()).toBeVisible()
        await expect(memberRow.filter({ hasText: 'Owner' }).first()).toBeVisible()
    })

    test('Owner can add a member; sharee can list the calendar via CalDAV', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickPersonalCalendar(calendars)

        // Mint a real second account by driving the invite flow — no raw PB
        // writes. Its own browser context is discarded; only the credentials
        // matter here, for authenticating CalDAV as the sharee.
        const { user: sharee, close } = await createInvitedUser(page, 'calshare')

        try {
            // Before sharing, the sharee must NOT see the owner's calendar.
            const beforeShare = await propfindCalendarsAs(sharee)
            expect(beforeShare.find(c => c.id === cal.id)).toBeUndefined()

            // Drive the sharing UI as the owner.
            await login(page)
            await page.goto(`/calendar/settings/${cal.id}`)
            await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

            await page.getByRole('button', { name: 'Add people' }).click()
            const searchField = page.getByPlaceholder('Search by name or email')
            await expect(searchField).toBeVisible({ timeout: 5_000 })

            // createInvitedUser names the account "Invited Tester"; filter to it.
            await searchField.fill('Invited Tester')

            // The candidate row shows the user's display name. AddMemberDialog
            // renders email only when name is empty (matches Google's nicer
            // "Holly Stitt / holly@stitt.org" two-line format).
            await expect(page.getByText('Invited Tester').first()).toBeVisible({ timeout: 5_000 })
            await page.getByRole('button', { name: 'Add' }).last().click()

            // Dialog closes on success — wait for the search field to disappear.
            await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible({
                timeout: 5_000,
            })

            // The cross-tier check: the sharee must now see the calendar in
            // their PROPFIND. This proves the membership row landed AND that
            // the CalDAV listing honors calendar_calendars' list rule — the one
            // definition core evaluates via CanAccessRecord.
            await expect(async () => {
                const after = await propfindCalendarsAs(sharee)
                const match = after.find(c => c.id === cal.id)
                if (!match) {
                    throw new Error(
                        `${sharee.email} doesn't see calendar ${cal.id} yet; got: ${after.map(c => c.name).join(', ')}`
                    )
                }
            }).toPass({ timeout: 5_000 })

            // The OWNER's view of the share (R1/D4). A reload discards the
            // optimistic insert, so this row can only come from the server's
            // list rule — the self-only rule 1830000007 replaced passed every
            // assertion above while "Shared with" showed nobody but the
            // caller. Do not weaken this to a pre-reload check.
            await page.reload()
            await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })
            await expect(
                page.getByTestId(/^calendar-member-row-/).filter({ hasText: 'Invited Tester' })
            ).toBeVisible({ timeout: 5_000 })
        } finally {
            await close()
        }
    })

    test('Last-owner removal is rejected with a clear error', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickPersonalCalendar(calendars)

        await login(page)
        await page.goto(`/calendar/settings/${cal.id}`)
        await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

        // The current user (Test User) is the only owner of their personal
        // calendar. The remove (×) button on the owner row should be hidden
        // when they're the last owner — render-time guard mirrored from the
        // server's guardLastOwner protection. Verify the button isn't
        // there and the role pill is a plain text badge, not a dropdown.
        // Scope by the row testID rather than walking ../.. from a text node —
        // the structure walk breaks on any layout change and can land on an
        // unrelated ancestor.
        const ownerRow = page
            .getByTestId(/^calendar-member-row-/)
            .filter({ hasText: 'Test User' })
            .first()
        await expect(ownerRow.getByRole('button', { name: /Remove/i })).toHaveCount(0)
    })
})
