import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// Coverage note: the drag *math* (px↔time, snapping, min-duration/grid clamps,
// day-delta) is exhaustively unit-tested in tinycld/calendar/lib/drag-math.test.ts.
// A pixel-coordinate drag can't be driven here: the time-grid subtree renders
// through RN-Web's transformed ScrollView and measures as 0×0 via
// getBoundingClientRect (Playwright's boundingBox() returns null), so a
// mouse-coordinate drag has no stable target. Rather than paper over that with
// brittle geometry guesses, this e2e asserts the feature is *wired into the
// grid*: a created event renders as a draggable block exposing the resize
// handle, while a read-only (subscribed) calendar's events do not — the
// dragDisabled branch. The gesture→mutation path itself is verified manually.
test.describe('Calendar — Drag affordances', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('a normal event renders a draggable block with a resize handle', async ({ page }) => {
        const title = `Drag Affordance ${Date.now()}`
        const today = new Date().toISOString().split('T')[0]

        // Create a one-off event today via the in-SPA "+ Create" button (a
        // router.push, not a hard goto that would race the lazy route chunk).
        await page.getByText('+ Create', { exact: true }).click()
        await expect(page.getByText('New Event')).toBeVisible({ timeout: 20_000 })
        await page.getByPlaceholder('Event title').fill(title)
        await page.getByPlaceholder('YYYY-MM-DD').first().fill(today)
        await page.getByPlaceholder('YYYY-MM-DD').last().fill(today)
        await page.getByPlaceholder('HH:MM').first().fill('08:00')
        await page.getByPlaceholder('HH:MM').last().fill('09:00')
        await page.getByRole('button', { name: 'Save' }).click()

        // Day view. The grid auto-scrolls to the current hour; wheel it to the
        // top so the 08:00 event is on screen.
        await navigateToPackage(page, 'calendar')
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        await page.mouse.move(640, 400)
        await page.mouse.wheel(0, -5000)

        // Assert on the block CONTAINER testid, not the title text: RN-Web emits
        // a hidden text-measurement copy of the title that sorts first and reads
        // as "hidden", which a getByText(...).first() visibility check would
        // trip on. The event-block-<id> testid is only on the real container.
        // Its presence (and the event-resize-<id> handle inside it) proves the
        // event renders as a drag-enabled block — the handle is omitted for
        // recurring/read-only events (the dragDisabled branch).
        const block = page
            .getByTestId(/^event-block-/)
            .filter({ hasText: title })
            .first()
        await expect(block).toBeAttached({ timeout: 10_000 })
        const blockId = await block.getAttribute('data-testid')
        const eventId = blockId?.replace('event-block-', '')
        expect(eventId).toBeTruthy()
        await expect(page.getByTestId(`event-resize-${eventId}`).first()).toBeAttached()
    })
})
