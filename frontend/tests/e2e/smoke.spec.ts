import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
test.beforeEach(async ({ page }) => {
  await page.context().clearCookies()
  await page.waitForTimeout(2500);
})

test('user can log in and reach dashboard', async ({ page }) => {
  await page.waitForTimeout(500)

  await login(page, 'test@example.com', 'Passw0rd');
  await expect(page).toHaveURL(/\/dashboard$/);
})

test('unauthenticated user gets redirected to login', async ({ page }) => {
  await page.waitForTimeout(500)

  await page.goto('http://localhost:5173/dashboard');
  await expect(page).toHaveURL('http://localhost:5173/login');
});

test('authenticated /me returns correct user', async ({ page }) => {
  await page.waitForTimeout(500)

  await login(page, 'test@example.com', 'Passw0rd');

  const res = await page.request.get('http://localhost:3000/api/auth/me');
  expect(res.status()).toBe(200);

  const data = await res.json();
  expect(data.user.email).toBe('test@example.com');
});
