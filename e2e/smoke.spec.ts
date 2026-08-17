import { expect, test } from '@playwright/test'

test('app loads and shows the landing page', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Pairly English').first()).toBeVisible()
})
