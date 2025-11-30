import { test, expect } from '@playwright/test'
import { login, logout } from '../helpers/auth'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.waitForTimeout(2500);
  })

  test.beforeAll(async () => {
    await new Promise(r => setTimeout(r, 2000))
  })

  test('invalid password shows error', async ({ page }) => {
    await page.waitForTimeout(500)

    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.goto('http://localhost:5173/login');

    await page.locator('#emailField').fill('test@example.com');
    await page.locator('#passwordField').fill('wrongpass');

    await page.locator('form button[type="submit"]').first().click();

    await expect(page.getByText(/Invalid credentials/i)).toBeVisible()
  })

  test('logout clears session', async ({ page }) => {
    await page.waitForTimeout(500)

    await login(page, 'test@example.com', 'Passw0rd')

    await logout(page)
    await expect(page).toHaveURL(/login/)
  })
})
