import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// Drives the bottom-edge resize gesture end-to-end on web and asserts the new
// end time is persisted (read back from the detail popover, not pixel
// geometry). useDragGesture engages after a 3px move, so the drag is performed
// as stepped mouse moves that cross the threshold — a single jump wouldn't
// engage. No retries / bumped timeouts: every step gates on a deterministic
// post-commit signal (the form, then the popover text).
//
// The event is created today at 08:00 — earlier than the seed's earliest event
// (09:00), so nothing overlaps it to occlude the hit target. The grid is
// wheel-scrolled to the top so 08:00 is in view; the RN ScrollView scrolls via
// wheel, not Playwright's scrollIntoViewIfNeeded.
test.describe('Calendar — Drag to resize', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('dragging an event bottom edge extends its end time', async ({ page }) => {
        const title = `Drag Resize ${Date.now()}`
        const today = new Date().toISOString().split('T')[0]

        // Create a one-off event today 08:00–09:00 via the in-SPA "+ Create"
        // button (a router.push, not a hard goto that would race the lazy
        // route chunk's compile).
        await page.getByText('+ Create', { exact: true }).click()
        await expect(page.getByText('New Event')).toBeVisible({ timeout: 20_000 })
        await page.getByPlaceholder('Event title').fill(title)
        await page.getByPlaceholder('YYYY-MM-DD').first().fill(today)
        await page.getByPlaceholder('YYYY-MM-DD').last().fill(today)
        await page.getByPlaceholder('HH:MM').first().fill('08:00')
        await page.getByPlaceholder('HH:MM').last().fill('09:00')
        await page.getByRole('button', { name: 'Save' }).click()

        // Day view makes today's column unambiguous.
        await navigateToPackage(page, 'calendar')
        await page.getByRole('button', { name: 'Day', exact: true }).click()

        // Target the block CONTAINER (testID event-block-<id>) filtered by the
        // unique title, not the inner title text node: in RN-Web the
        // numberOfLines={1} <Text> compiles to a div Playwright treats as
        // zero-box, so boundingBox() on it returns null. The container View has
        // an explicit pixel height, so it measures. toBeVisible() also scrolls
        // it into the actionable viewport (the manual mouse-wheel didn't reliably
        // settle the RN ScrollView for boundingBox).
        const block = page
            .getByTestId(/^event-block-/)
            .filter({ hasText: title })
            .first()
        await expect(block).toBeVisible()
        await block.scrollIntoViewIfNeeded()

        const box = await block.boundingBox()
        if (!box) throw new Error('event block has no bounding box')

        // Grab the bottom edge (the resize handle strip) and drag down one
        // hour. HOUR_HEIGHT is 60px, so +60px ≈ +60min after 15-min snapping.
        const grabX = box.x + box.width / 2
        const grabY = box.y + box.height - 2
        await page.mouse.move(grabX, grabY)
        await page.mouse.down()
        for (let dy = 6; dy <= 60; dy += 6) {
            await page.mouse.move(grabX, grabY + dy)
        }
        await page.mouse.up()

        // Open the detail popover (click the block body, away from the handle)
        // and confirm the end advanced to 10:00 while the start stayed at
        // 08:00. The popover renders "start – end".
        await page.mouse.click(grabX, box.y + 8)
        await expect(page.getByText(/8:00\s*AM\s*–\s*10:00\s*AM/)).toBeVisible()
    })
})
