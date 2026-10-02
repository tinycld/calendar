import { expect, type Locator, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// RN-Web mounts each time-grid block twice under the same testid, and one copy
// measures 0×0. Click the copy that carries the real layout box.
async function clickMeasurable(page: Page, locator: Locator) {
    await expect(async () => {
        const count = await locator.count()
        for (let i = 0; i < count; i++) {
            const box = await locator.nth(i).boundingBox()
            if (box && box.width > 0 && box.height > 0) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
                return
            }
        }
        throw new Error('event block has no measurable box')
    }).toPass({ timeout: 10_000 })
}

function localToday() {
    const now = new Date()
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-')
}

async function createTodayEvent(page: Page, title: string) {
    const today = localToday()
    // "+ Create" no-ops until the router has committed the calendar route, so
    // the click is retried until the form is up (see calendar-drag.spec.ts).
    await expect(async () => {
        await page.getByText('+ Create', { exact: true }).click()
        await expect(page.getByText('New Event')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await page.getByPlaceholder('Event title').fill(title)
    await page.getByPlaceholder('YYYY-MM-DD').first().fill(today)
    await page.getByPlaceholder('YYYY-MM-DD').last().fill(today)
    await page.getByPlaceholder('HH:MM').first().fill('07:00')
    await page.getByPlaceholder('HH:MM').last().fill('08:00')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('New Event')).toBeHidden({ timeout: 20_000 })
}

async function openEventPopover(page: Page, title: string) {
    await navigateToPackage(page, 'calendar')
    const block = page.getByTestId(/^event-block-/).filter({ hasText: title })
    await expect(async () => {
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        await expect(block.first()).toBeAttached({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await page.mouse.move(640, 400)
    await page.mouse.wheel(0, -5000)
    await page.mouse.wheel(0, 200)
    await clickMeasurable(page, block)
    const popover = page.getByTestId('event-detail-popover')
    await expect(popover.getByText(title)).toBeVisible()
    return popover
}

// The event popover must close on a press ANYWHERE outside it — not only on the
// calendar grid. It used to carry its own backdrop inside the calendar screen,
// so presses on the package sidebar never reached it and the popover stayed up.
test.describe('Calendar — Event popover dismissal', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('a press on a sidebar control closes the event popover', async ({ page }) => {
        const title = `Popover Sidebar ${Date.now()}`
        await createTodayEvent(page, title)
        const popover = await openEventPopover(page, title)

        // A mid-month day is unique in the mini calendar (no spill-over days
        // from the months either side), and never today, so the press must
        // also reach the control and move the view to it.
        const day = new Date().getDate() < 15 ? 20 : 10
        await page
            .getByTestId('package-sidebar-mounted')
            .getByText(String(day), { exact: true })
            .click()

        await expect(popover).toBeHidden()
        await expect(page.getByText(new RegExp(` ${day}, \\d{4}$`))).toBeVisible()
    })

    test('Escape closes the event popover', async ({ page }) => {
        const title = `Popover Escape ${Date.now()}`
        await createTodayEvent(page, title)
        const popover = await openEventPopover(page, title)

        await page.keyboard.press('Escape')

        await expect(popover).toBeHidden()
    })
})
