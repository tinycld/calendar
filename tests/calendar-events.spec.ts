import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// Reach the new-event form the way a user does: SPA-navigate to the
// calendar package, then click "+ Create". A page.goto('/calendar/new')
// would be a hard browser navigation that tears down the SPA and cancels
// in-flight lazy chunks (slow Metro recompile + flaky CI); it also leaves
// the router back-stack empty. Clicking keeps the SPA warm and gives the
// form a back entry for onSuccess to consume.
async function openNewEventForm(page: Page) {
    await navigateToPackage(page, 'calendar')
    await page.getByText('+ Create', { exact: true }).click()
    await expect(page.getByText('New Event')).toBeVisible()
}

test.describe('Calendar — Events', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('create new event form can be filled', async ({ page }) => {
        const title = `Test Event ${Date.now()}`

        await openNewEventForm(page)

        await page.getByPlaceholder('Event title').fill(title)
        await expect(page.getByPlaceholder('Event title')).toHaveValue(title)
        await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    test('event form blocks save with empty title', async ({ page }) => {
        await openNewEventForm(page)

        const titleInput = page.getByPlaceholder('Event title')
        await titleInput.clear()
        await page.getByRole('button', { name: 'Save' }).click()

        // Validation should prevent save — form should still be visible.
        await expect(page.getByText('New Event')).toBeVisible()
    })
})
