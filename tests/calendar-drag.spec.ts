import { expect, type Locator, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// RN-Web mounts each time-grid block twice under the same testid: one copy
// measures 0×0 (getBoundingClientRect/getClientRects empty) and the other
// carries the real layout box. Playwright's .first() can land on the 0×0 one,
// so boundingBox() returns null. Pick the copy that actually has a box.
async function measurableBox(locator: Locator) {
    const count = await locator.count()
    for (let i = 0; i < count; i++) {
        const box = await locator.nth(i).boundingBox()
        if (box && box.width > 0 && box.height > 0) return box
    }
    return null
}

async function gridBlock(page: Page, title: string): Promise<Locator> {
    return page.getByTestId(/^event-block-/).filter({ hasText: title })
}

// Drives the bottom-edge resize gesture end-to-end on web and asserts the new
// end time is persisted (read back from the detail popover, not pixel
// geometry). useDragGesture engages after a 3px move, so the drag is performed
// as stepped mouse moves that cross the threshold — a single jump wouldn't
// engage. No retries / bumped timeouts: each step gates on a deterministic
// signal (the measurable block, then the committed popover text).
test.describe('Calendar — Drag to resize', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('dragging an event bottom edge extends its end time', async ({ page }) => {
        const title = `Drag Resize ${Date.now()}`
        const today = new Date().toISOString().split('T')[0]

        // Create a one-off event today 08:00–09:00 — earlier than the seed's
        // first event (09:00), so nothing overlaps it. The in-SPA "+ Create"
        // button is a router.push, not a hard goto that would race the lazy
        // route chunk's compile.
        await page.getByText('+ Create', { exact: true }).click()
        await expect(page.getByText('New Event')).toBeVisible({ timeout: 20_000 })
        await page.getByPlaceholder('Event title').fill(title)
        await page.getByPlaceholder('YYYY-MM-DD').first().fill(today)
        await page.getByPlaceholder('YYYY-MM-DD').last().fill(today)
        await page.getByPlaceholder('HH:MM').first().fill('08:00')
        await page.getByPlaceholder('HH:MM').last().fill('09:00')
        await page.getByRole('button', { name: 'Save' }).click()

        // Day view, then wheel the grid to the top so the 08:00 block is on
        // screen (the grid auto-scrolls to the current hour). RN's ScrollView
        // scrolls via the wheel; scrollIntoViewIfNeeded doesn't drive it.
        await navigateToPackage(page, 'calendar')
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        const block = await gridBlock(page, title)
        await expect(block.first()).toBeAttached({ timeout: 10_000 })
        // Wheel fully to the top, then back down so the 08:00 block sits
        // mid-viewport — at the very top it straddles the bottom fold and the
        // downward resize drag would run off-screen.
        await page.mouse.move(640, 400)
        await page.mouse.wheel(0, -5000)
        await page.mouse.wheel(0, 260)

        // Find the copy that has a real box, then grab its bottom edge (the
        // resize handle strip) and drag down one hour. HOUR_HEIGHT is 60px, so
        // +60px ≈ +60min after 15-min snapping.
        let box: Awaited<ReturnType<typeof measurableBox>> = null
        await expect(async () => {
            box = await measurableBox(block)
            expect(box).not.toBeNull()
        }).toPass({ timeout: 10_000 })
        if (!box) throw new Error('event block has no measurable box')

        // Press the bottom edge, then nudge downward until the floating drag
        // ghost appears — proof the gesture actually engaged (useDragGesture
        // needs continuous movement past its 3px threshold, and under CPU load
        // the moves can arrive before pointer capture is ready, silently
        // no-opping). Only once it's live do we travel the full hour and
        // release, so the resize can't be dropped. Mirrors drive's
        // poll-for-the-drag-preview pattern.
        const grabX = box.x + box.width / 2
        const grabY = box.y + box.height - 2
        // RN-Web double-mounts the ghost under one testid (same as the blocks),
        // so match the first.
        const ghost = page.getByTestId('drag-ghost').first()
        await page.mouse.move(grabX, grabY)
        await page.mouse.down()
        await expect(async () => {
            await page.mouse.move(grabX, grabY + 6)
            await page.mouse.move(grabX, grabY + 12)
            await expect(ghost).toBeAttached({ timeout: 200 })
        }).toPass({ timeout: 10_000 })
        for (let dy = 18; dy <= 60; dy += 6) {
            await page.mouse.move(grabX, grabY + dy)
        }
        await page.mouse.up()

        // Re-measure the now-taller block and click its vertical centre — well
        // clear of the top slot boundary and the bottom resize handle — to open
        // the detail popover. Confirm the end advanced to 10:00 while the start
        // stayed at 08:00. The popover renders "start – end".
        const after = await measurableBox(block)
        if (!after) throw new Error('resized block has no measurable box')
        await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2)
        await expect(page.getByText(/8:00\s*AM\s*–\s*10:00\s*AM/)).toBeVisible()
    })
})
