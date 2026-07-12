import { expect, type Page, test } from '@playwright/test'
import {
    type CalDAVCalendar,
    deleteEvent,
    getEvent,
    parseICalSummary,
    propfindCalendars,
    propfindEvents,
    putEvent,
    rawCaldavRequest,
} from '@tinycld/core/e2e-caldav-helpers'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// RN-Web mounts each time-grid block twice under the same node — one copy
// measures 0×0 (hidden), the other carries the real layout box. Which one is
// .first() isn't stable, so match by visibility rather than order: the
// filtered locator resolves to the single laid-out copy (same idea as
// calendar-drag.spec.ts's measurableBox, expressed as a locator filter).
function visibleEventText(page: Page, summary: string) {
    return page.getByText(summary).filter({ visible: true })
}

// Opens the calendar day view on the given event's local day, entirely via
// in-SPA navigation (no page.goto). A goto tears down the SPA and cancels the
// in-flight boot, forcing a full re-boot; under CI load the serialized
// re-resolution of org/package → calendars → visibleIds → events pushes the
// events render past the assertion budget while the view sits in its loading
// skeleton — the root cause of this file's intermittent failures.
// navigateToPackage + router.push (the Day button) keeps the boot that
// login() already started.
//
// `start = now + Nh` normally lands on today, but within N hours of local
// midnight it rolls onto tomorrow — the day view opens on today, so click
// "Next" once to reach the event's day. Local-time throughout: the app's
// focusDate and the event's start both use the browser's local day.
async function openDayViewFor(page: Page, eventStart: Date) {
    await navigateToPackage(page, 'calendar')
    await page.getByRole('button', { name: 'Day', exact: true }).click()

    const today = new Date()
    const isSameLocalDay =
        eventStart.getFullYear() === today.getFullYear() &&
        eventStart.getMonth() === today.getMonth() &&
        eventStart.getDate() === today.getDate()
    if (!isSameLocalDay) {
        await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
}

// PROPFIND returns calendars from every org the test user has membership
// in, so a multi-org test user has same-named entries (the user_org
// lifecycle hook auto-creates a "Test User" calendar per org). The CalDAV
// server suffixes displaynames with the org name when the user belongs to
// more than one org, so the test-org personal calendar comes back as
// "Test User (Test Organization)". The web view is org-scoped to test-org,
// so an event PUT into the acme calendar would never appear in the
// WeekView/DayView the test then asserts on — match the suffixed name to
// pin to test-org.
const TEST_ORG_NAME = 'Test Organization'
const TEST_ORG_SUFFIX = ` (${TEST_ORG_NAME})`
function pickTestOrgCalendar(calendars: CalDAVCalendar[]): CalDAVCalendar {
    const personal = calendars.find(c => c.name === `Test User${TEST_ORG_SUFFIX}`)
    if (personal) return personal
    // Fallback for the single-org case (no disambiguation suffix).
    const bare = calendars.find(c => c.name === 'Test User')
    if (bare) return bare
    throw new Error(
        `No test-org "Test User" calendar in PROPFIND result; got: ${calendars
            .map(c => c.name)
            .join(', ')}`
    )
}

test.describe('Calendar — CalDAV Integration', () => {
    test('CalDAV PUT appears in web UI', async ({ page }) => {
        const calendars = await propfindCalendars()
        const calId = pickTestOrgCalendar(calendars).id
        const uid = `caldav-roundtrip-${Date.now()}`
        const summary = `CalDAV PUT ${Date.now()}`

        const start = new Date(Date.now() + 60 * 60 * 1000)
        const end = new Date(start.getTime() + 60 * 60 * 1000)

        await putEvent(calId, uid, { summary, start, end })

        await login(page)
        await openDayViewFor(page, start)
        await expect(visibleEventText(page, summary)).toBeVisible({ timeout: 10_000 })
    })

    test('Web UI event appears in CalDAV listing', async ({ page }) => {
        const calendars = await propfindCalendars()
        expect(calendars.length).toBeGreaterThan(0)
        const title = `Web event ${Date.now()}`

        // Click "+ Create" rather than goto('/calendar/new') so the router
        // has a back-stack entry for onSuccess to consume. Direct deep-link
        // arrivals leave the stack empty; useNavigateBack handles that for
        // real users by replacing with the package root, but the spec wants
        // to assert the normal flow — form unmounts on save.
        await login(page)
        await navigateToPackage(page, 'calendar')
        await page.getByText('+ Create', { exact: true }).click()
        await expect(page.getByPlaceholder('Event title')).toBeVisible()
        await page.getByPlaceholder('Event title').fill(title)

        // Save stays disabled until userOrg + defaultCalendar resolve from
        // the live queries. Gluestack's <Button isDisabled> sets a CSS
        // data-disabled attribute, not the HTML disabled property, so
        // Playwright's toBeEnabled can't see it — assert the attribute
        // explicitly. toHaveAttribute(name, 'false') fails closed if the
        // disabled-state contract ever changes.
        const saveButton = page.getByRole('button', { name: 'Save' })
        await expect(saveButton).toHaveAttribute('data-disabled', 'false', { timeout: 10_000 })
        await saveButton.click()

        // After save, the form unmounts (onSuccess navigates away).
        await expect(page.getByPlaceholder('Event title')).toBeHidden({ timeout: 5_000 })

        // The form's default calendar comes from useVisibleCalendars, which
        // may not be calendars[0] from PROPFIND. Search across all of them —
        // this test asserts the cross-tier contract, not which calendar the
        // form happens to default to.
        await expect(async () => {
            for (const cal of calendars) {
                const events = await propfindEvents(cal.id)
                for (const e of events) {
                    const ics = await getEvent(cal.id, e.uid)
                    if (parseICalSummary(ics) === title) return
                }
            }
            throw new Error(`event with summary "${title}" not yet visible via CalDAV`)
        }).toPass({ timeout: 10_000 })
    })

    test('CalDAV DELETE removes from web UI', async ({ page }) => {
        const calendars = await propfindCalendars()
        const calId = pickTestOrgCalendar(calendars).id
        const uid = `caldav-delete-${Date.now()}`
        const summary = `CalDAV DELETE ${Date.now()}`

        const start = new Date(Date.now() + 2 * 60 * 60 * 1000)
        const end = new Date(start.getTime() + 60 * 60 * 1000)
        await putEvent(calId, uid, { summary, start, end })

        await login(page)
        await openDayViewFor(page, start)
        await expect(visibleEventText(page, summary)).toBeVisible({ timeout: 10_000 })

        await deleteEvent(calId, uid)

        // Re-fetch the events collection fresh so the day view reflects the
        // CalDAV DELETE. reload() re-boots the current URL exactly once (a
        // clean single boot — unlike a goto arriving mid-boot, which aborts
        // the in-flight boot and forces a serialized re-boot). getFullList on
        // that boot excludes the deleted row without depending on the realtime
        // delete echo, which can be racy.
        await page.reload()
        // No copy of the event should remain in the DOM after the delete.
        await expect(page.getByText(summary)).toHaveCount(0, { timeout: 10_000 })
    })

    test('CalDAV PUT updates an existing event', async () => {
        const calendars = await propfindCalendars()
        const calId = calendars[0].id
        const uid = `caldav-update-${Date.now()}`

        const start = new Date(Date.now() + 3 * 60 * 60 * 1000)
        const end = new Date(start.getTime() + 60 * 60 * 1000)

        await putEvent(calId, uid, { summary: 'Original summary', start, end })
        await putEvent(calId, uid, { summary: 'Updated summary', start, end })

        const ics = await getEvent(calId, uid)
        expect(parseICalSummary(ics)).toBe('Updated summary')
    })

    test('CalDAV without auth returns 401', async () => {
        const status = await rawCaldavRequest('PROPFIND', '/u/cal/')
        expect(status).toBe(401)
    })

    // Regression test for the Saturday-events-not-showing bug. WeekView and
    // MonthView used to pass `addDays(rangeStart, dayCount-1)` (= last day at
    // midnight) as rangeEnd; eventOverlapsRange's exclusive right bound
    // (`eventStart < rangeEnd`) silently dropped every event timestamped
    // after 00:00 on that last day. Saturday is the canonical case (last
    // column of a Sun-start week), but the bug applied to any "last shown
    // day" in any view. Drive the bug from CalDAV (deterministic timing,
    // no form-race) and assert the event is rendered in the week view.
    test('event on this-week Saturday appears in week view', async ({ page }) => {
        const calendars = await propfindCalendars()
        const calId = pickTestOrgCalendar(calendars).id
        const uid = `caldav-saturday-${Date.now()}`
        const summary = `Saturday event ${Date.now()}`

        // Pick the Saturday in the same Sun-start week as today, so we don't
        // have to navigate forward to find it. If today IS Saturday we just
        // use today at 14:00. getDay(): Sun=0, Sat=6.
        const start = new Date()
        const daysUntilSat = 6 - start.getDay()
        start.setDate(start.getDate() + daysUntilSat)
        start.setHours(14, 0, 0, 0)
        const end = new Date(start.getTime() + 60 * 60 * 1000)

        await putEvent(calId, uid, { summary, start, end })

        await login(page)
        // In-SPA navigation to the calendar (no page.goto — a goto arriving
        // mid-boot aborts login()'s boot and forces a serialized re-boot that
        // races the assertion under CI load). The default view is 'week' and
        // the default focusDate is today, so navigateToPackage lands directly
        // on the week that contains this event; click "Week" to make the view
        // explicit regardless of any persisted preference.
        await navigateToPackage(page, 'calendar')
        await page.getByRole('button', { name: 'Week', exact: true }).click()
        await expect(visibleEventText(page, summary)).toBeVisible({ timeout: 10_000 })
    })
})
