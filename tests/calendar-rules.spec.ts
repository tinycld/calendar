import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'

// Proves calendar:create-event closes the loop: a rule built in the real
// builder produces an event that actually renders on the grid.
//
// The trigger is core:manual rather than mail's "a message arrives" — this
// package's CI assembles only tinycld + calendar, so a cross-package rule
// would pass locally and fail there. The action and its date math are the same
// either way; what mail adds is where the templated title comes from.
// Far enough ahead to stay off today's grid (other specs create and measure
// events there in parallel), close enough that the month view showing "today"
// still contains it — a larger offset would need date navigation, which is
// exactly the kind of layout dependency this is avoiding. 1 day is the
// smallest offset that satisfies both.
const DAYS_AHEAD = 1

async function navigateToRulesSettings(page: Page) {
    await page.getByTestId('nav-settings').click()
    await page.getByText('Rules', { exact: true }).first().click()
    await expect(page.getByText('My rules', { exact: true })).toBeVisible()
}

async function selectFromMenu(
    page: Page,
    trigger: import('@playwright/test').Locator,
    optionLabel: string
) {
    await trigger.click()
    await page.getByText(optionLabel, { exact: true }).click()
}

function ruleRow(page: Page, ruleName: string) {
    return page
        .locator('div')
        .filter({ has: page.getByText(ruleName, { exact: true }) })
        .filter({ has: page.getByLabel('More actions') })
        .last()
}

test.describe('Calendar — Rules', () => {
    test('a rule creates an event that renders on the grid', async ({ page }) => {
        await login(page)

        const stamp = Date.now()
        const ruleName = `E2E create-event ${stamp}`
        const title = `Ruled event ${stamp}`

        await navigateToRulesSettings(page)

        await page.getByText('New rule', { exact: true }).first().click()
        await expect(page.getByText('New rule', { exact: true }).last()).toBeVisible()
        await page.getByPlaceholder('Rule name').fill(ruleName)

        await selectFromMenu(
            page,
            page.getByText('Select a trigger…', { exact: true }),
            'Run manually'
        )

        await page.getByText('add action', { exact: true }).click()
        await page.getByText('Create an event', { exact: true }).click()

        await page
            .getByText('Title', { exact: true })
            .locator('..')
            .getByRole('textbox')
            .first()
            .fill(title)
        // A week out, deliberately NOT today. Other specs in this package
        // (calendar-drag, calendar-caldav) create and measure events on
        // today's grid, and they run in parallel against the same database —
        // an extra block from this test shifts the layout they depend on.
        // Scheduling ahead also exercises the offset arithmetic, which is the
        // whole reason create-event is a native action.
        await page
            .getByText('Starts in (days)', { exact: true })
            .locator('..')
            .getByRole('textbox')
            .first()
            .fill(String(DAYS_AHEAD))
        await page
            .getByText('Duration (minutes)', { exact: true })
            .locator('..')
            .getByRole('textbox')
            .first()
            .fill('45')

        await page.getByText('Save', { exact: true }).click()
        await expect(page.getByText(ruleName, { exact: true })).toBeVisible()

        await ruleRow(page, ruleName).getByLabel('More actions').click()
        await page.getByText('Run now', { exact: true }).click()

        // The visible effect: the event block exists on the grid, on the day
        // the offset put it. Day view + one "Next" lands on tomorrow, matching
        // DAYS_AHEAD — Month view can't be used for this assertion because
        // MonthCell renders its own compact rows rather than EventBlock, so
        // there is no event-block-* testID there.
        //
        // toBeAttached rather than toBeVisible — react-native-web renders the
        // block as nested divs Playwright's visibility heuristic reports as
        // hidden, and the grid scrolls (same reasoning as
        // calendar-drag.spec.ts).
        await navigateToPackage(page, 'calendar')
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        await page.getByLabel('Next').first().click()
        await expect(
            page
                .getByTestId(/^event-block-/)
                .filter({ hasText: title })
                .first()
        ).toBeAttached({ timeout: 20_000 })
    })

    test('the calendar rules help topic is searchable and renders', async ({ page }) => {
        await login(page)

        await page.getByTestId('nav-help').click()
        await expect(page).toHaveURL(/\/help$/)

        await page.getByPlaceholder('Search help topics').fill('calendar rules')
        await page.getByText('Calendar rules', { exact: true }).click()

        await expect(page).toHaveURL(/\/help\/calendar\/rules$/)
        await expect(page.getByText('When an event is added', { exact: true })).toBeVisible()
    })
})
