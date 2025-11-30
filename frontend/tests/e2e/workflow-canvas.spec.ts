import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'
import { dragNode } from '../helpers/node'

test.describe('workflow toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.waitForTimeout(2500);
    await login(page, 'test@example.com', 'Passw0rd')
    await page.goto('http://localhost:5173/dashboard')
    await page.click('button:has-text("New Workflow")')
    await page.waitForSelector('.react-flow__nodes')
  })

  test.beforeAll(async () => {
    await new Promise(r => setTimeout(r, 2000))
  })

  test('initial toolbar state', async ({ page }) => {
    await page.waitForTimeout(500)
    const save = page.locator('button:has-text("Save")')
    const runStatus = page.locator('button:has-text("Run Status")')
    const dirtyDot = page.locator('.w-2.h-2.rounded-full.bg-blue-500')

    await expect(save).toBeDisabled()
    await expect(runStatus).toBeDisabled()
    await expect(dirtyDot).toHaveCount(0)
  })

  test('editing any node enables Save and shows dirty dot', async ({ page }) => {
    await page.waitForTimeout(500)

    await dragNode(page, 'Add Trigger')

    const node = page.locator('[data-testid^="rf__node-"]').first()
    await node.click()

    const field = page.locator('textarea, input').first()
    const old = await field.inputValue()
    await field.fill(old + 'x')

    const save = page.locator('button:has-text("Save")')
    const dirtyDot =
      page.locator('button:has-text("Save") + span.w-2.h-2.rounded-full.bg-blue-500')

    await expect(save).toBeEnabled()
    await expect(dirtyDot).toHaveCount(1)
    await expect(dirtyDot).toBeVisible()
  })

  test('Save sends PUT and disables after save', async ({ page }) => {
    await page.waitForTimeout(500)
    await dragNode(page, 'Add Trigger')
    // mutate
    const anyNode = page.locator('[data-testid^="rf__node-"]').first()
    await anyNode.click()
    const field = page.locator('textarea, input').first()
    const old = await field.inputValue()
    await field.fill(old + 'x')

    const save = page.locator('button:has-text("Save")')
    const dirtyDot = page.locator('.w-2.h-2.rounded-full.bg-blue-500')

    // intercept PUT
    const reqPromise = page.waitForRequest(req =>
      req.method() === 'PUT' && req.url().includes('/api/workflows/')
    )

    await save.click()
    await reqPromise

    await expect(save).toBeDisabled()
    await expect(dirtyDot).toHaveCount(0)
  })

  test('double click Save does not double submit', async ({ page }) => {
    await page.waitForTimeout(500)
    await dragNode(page, 'Add Trigger')
    const anyNode = page.locator('[data-testid^="rf__node-"]').first()
    await anyNode.click()
    const field = page.locator('textarea, input').first()
    const old = await field.inputValue()
    await field.fill(old + 'x')

    const save = page.locator('button:has-text("Save")')

    let count = 0
    page.on('request', req => {
      if (req.method() === 'PUT' && req.url().includes('/api/workflows/')) count++
    })

    await Promise.all([save.click(), save.click()])
    await page.waitForTimeout(500)

    expect(count).toBe(1)
  })

  test('workflow switch resets Save state', async ({ page }) => {
    await page.waitForTimeout(500)

    // add a node so the workflow becomes dirty
    await dragNode(page, 'Add Trigger')

    const node = page.locator('[data-testid^="rf__node-"]').first()
    await node.click()

    const field = page.locator('textarea, input').first()
    const old = await field.inputValue()
    await field.fill(old + 'x')

    const save = page.locator('button:has-text("Save")')
    const dirtyDot =
      page.locator('button:has-text("Save") + span.w-2.h-2.rounded-full.bg-blue-500')

    await expect(save).toBeEnabled()
    await expect(dirtyDot).toHaveCount(1)

    // workflow dropdown
    const select = page.locator('main').locator('select').first()

    // gather all workflow options
    const options = await select.locator('option').all()
    if (options.length < 2) throw new Error('Need at least 2 workflows to test switching')

    // current workflow id
    const currentValue = await select.inputValue()

    // pick the first workflow that isn't the current one
    let nextValue = null
    for (const opt of options) {
      const val = await opt.getAttribute('value')
      if (val !== currentValue) {
        nextValue = val
        break
      }
    }

    if (!nextValue) throw new Error('Unable to find an alternate workflow option')

    // begin switching (modal appears here)
    const switchPromise = select.selectOption(nextValue)

    // wait for modal to appear by its unique heading text
    const modal = page.locator('text=Unsaved changes').first()
    await modal.waitFor()

    // click the destructive option
    await page.locator('button:has-text("Discard and Switch")').click()

    // wait for workflow switch to complete
    await switchPromise

    // after the switch, Save must be disabled and no dirty dot present
    await expect(save).toBeDisabled()
    await expect(dirtyDot).toHaveCount(0)
  })

  test('Lock does not affect the local user’s ability to edit or save', async ({ page }) => {
    await page.waitForTimeout(500)

    await dragNode(page, 'Add SendGrid Email')

    const node = page.locator('[data-testid^="rf__node-"]').first()
    await node.click()

    const toggle = node.locator('button[aria-label="Open in detail flyout"]')
    await toggle.click()

    const field = node.locator('input, textarea').first()
    await field.waitFor()
    const before = await field.inputValue()

    const save = page.locator('button:has-text("Save")')

    // change field so save becomes enabled
    await field.fill(before + 'x')
    await expect(save).toBeEnabled()

    // now lock the workflow
    const lock = page.locator('button:has-text("Lock")')
    await lock.click()

    // local user can still edit
    await field.fill(before + 'xyz')
    await expect(field).toHaveValue(before + 'xyz')

    // Save should remain enabled (same behavior as before lock)
    await expect(save).toBeEnabled()
  })

  test('Reload clears dirty state', async ({ page }) => {
    await page.waitForTimeout(500)
    await dragNode(page, 'Add SendGrid Email')
    const anyNode = page.locator('[data-testid^="rf__node-"]').first()
    await anyNode.click()
    const field = page.locator('textarea, input').first()
    const old = await field.inputValue()
    await field.fill(old + 'x')

    await page.reload()

    const save = page.locator('button:has-text("Save")')
    const dirtyDot = page.locator('.w-2.h-2.rounded-full.bg-blue-500')

    await expect(save).toBeDisabled()
    await expect(dirtyDot).toHaveCount(0)
  })
})
