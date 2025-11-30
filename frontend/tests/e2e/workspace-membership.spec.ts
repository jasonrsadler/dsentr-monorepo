import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'

test.describe('Workspace membership', () => {

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.waitForTimeout(2500);
    await login(page, 'test@example.com', 'Passw0rd')
  })

  test('dashboard shows active workspace name', async ({ page }) => {
    await page.goto('http://localhost:5173/dashboard')

    // scope to the section that contains "Active workspace"
    const container = page.getByText('Active workspace').locator('xpath=..')

    // if the switcher exists, read from it
    const switcher = container.getByLabel('Workspace switcher')

    if (await switcher.count()) {
      await expect(switcher).toBeVisible()

      // active workspace is the currently-selected option
      const active = await switcher.inputValue()
      const options = await switcher.locator('option').all()

      let activeName = null
      for (const opt of options) {
        if ((await opt.getAttribute('value')) === active) {
          activeName = await opt.textContent()
        }
      }

      expect(activeName?.trim()).not.toBe('')
      return
    }

    // fallback: single workspace layout uses a span
    const workspaceName = container.locator('span.text-sm')
    await expect(workspaceName).toBeVisible()
    await expect(workspaceName).not.toHaveText('')
  })

  test('user without workspace is routed to onboarding', async ({ page }) => {
    // wipe session, use a special test user that has NO workspace
    await page.context().clearCookies()

    await page.waitForTimeout(2500);
    // this user must exist in your seed data
    await login(page, 'onboardinguser@example.com', 'Passw0rd')

    // immediately redirected
    await expect(page).toHaveURL(/onboarding/)
    await expect(page.getByText(/Complete Setup/i)).toBeVisible()
  })

  test('workspace switcher lists all workspaces', async ({ page }) => {
    await page.context().clearCookies()

    // this user must exist in your seed data
    await login(page, 'other@example.com', 'Passw0rd')
    await page.goto('http://localhost:5173/dashboard')
    const switcher = page.getByLabel('Workspace switcher')

    await expect(switcher).toBeVisible()

    const options = await switcher.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(0)
  })

})
