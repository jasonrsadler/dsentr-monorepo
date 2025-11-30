import { Page } from '@playwright/test';

export async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.context().clearPermissions();
  await page.goto('http://localhost:5173/login');

  await page.locator('#emailField').fill(email);
  await page.locator('#passwordField').fill(password);

  const [response] = await Promise.all([
    page.waitForResponse(res =>
      res.url().includes('/api/auth/login') &&
      (res.status() === 200 || res.status() === 401 || res.status() === 429)
    ),
    page.locator('form button[type="submit"]').first().click()
  ]);

  const status = response.status();
  if (status !== 200) {
    throw new Error(`Login failed: backend returned HTTP ${status}`);
  }

  await page.waitForURL('**/dashboard', { timeout: 30000 });
}


export async function logout(page: Page) {
  await page.click('a[href="/logout"]')
}

