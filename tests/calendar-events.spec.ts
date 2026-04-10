import { expect, test } from '@playwright/test'
import { login, navigateToAddon, ORG_SLUG } from '../../../tests/e2e/helpers'

test.describe('Calendar — Events', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('calendar loads with view controls', async ({ page }) => {
        await navigateToAddon(page, 'calendar')
        await page.getByRole('button', { name: 'Week' }).click()
        await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()
    })

    test('new event form renders', async ({ page }) => {
        await page.goto(`/a/${ORG_SLUG}/calendar/new`)
        await expect(page.getByText('New Event')).toBeVisible()
        await expect(page.getByPlaceholder('Event title')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
    })

    test('create new event form can be filled', async ({ page }) => {
        const title = `Test Event ${Date.now()}`

        await page.goto(`/a/${ORG_SLUG}/calendar/new`)
        await expect(page.getByText('New Event')).toBeVisible()

        await page.getByPlaceholder('Event title').fill(title)

        // Verify the title was filled
        await expect(page.getByPlaceholder('Event title')).toHaveValue(title)

        // Save button should be enabled
        await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    test('event form shows validation on empty title', async ({ page }) => {
        await page.goto(`/a/${ORG_SLUG}/calendar/new`)
        await expect(page.getByText('New Event')).toBeVisible()

        // Clear the title field (may have default text) and try to save
        const titleInput = page.getByPlaceholder('Event title')
        await titleInput.clear()
        await page.getByRole('button', { name: 'Save' }).click()

        // Validation should prevent save — form should still be visible
        await expect(page.getByText('New Event')).toBeVisible()
    })

    test('toggle calendar visibility in sidebar', async ({ page }) => {
        await navigateToAddon(page, 'calendar')
        const personalCalendar = page.getByText('Personal').first()
        if (await personalCalendar.isVisible()) {
            await personalCalendar.click()
            await personalCalendar.click()
        }
    })
})
