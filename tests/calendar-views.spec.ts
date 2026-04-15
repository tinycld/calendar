import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../tests/e2e/helpers'

test.describe('Calendar — Views', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('calendar renders default view', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()
    })

    test('switch to Day view', async ({ page }) => {
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible()
    })

    test('switch to Week view', async ({ page }) => {
        await page.getByRole('button', { name: 'Week' }).click()
        await expect(page.getByRole('button', { name: 'Week' })).toBeVisible()
    })

    test('switch to Month view', async ({ page }) => {
        await page.getByRole('button', { name: 'Month' }).click()
        await expect(page.getByRole('button', { name: 'Month' })).toBeVisible()
    })

    test('Today button is clickable', async ({ page }) => {
        await page.getByRole('button', { name: 'Today' }).click()
        await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()
    })

    test('date label is visible', async ({ page }) => {
        // Calendar shows a date label like "April 2026"
        await expect(page.getByText(/\w+ \d{4}/).first()).toBeVisible()
    })
})
