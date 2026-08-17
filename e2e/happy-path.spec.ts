import { expect, test } from '@playwright/test'

test('full learning flow: landing to dashboard', async ({ page }) => {
  await page.goto('/')

  // Landing -> Partner Connection -> Onboarding
  await page.getByText('Get Started', { exact: true }).first().click()
  await page.getByPlaceholder('e.g. Hyunji').fill('TestUser')
  await page.getByText('Simulate Partner Joining ✓').click()
  await expect(page.getByText("You're paired up!")).toBeVisible()
  await page.getByText('Start Learning Together →').click()

  // Onboarding
  await expect(page.getByText("Let's set up your learning")).toBeVisible()
  await page.getByText('Intermediate', { exact: true }).click()
  await page.getByText('Culture', { exact: true }).click()
  await page.getByText('Continue to Dashboard →').click()

  // Dashboard -> News Reader
  await expect(page.getByText('Good evening, TestUser')).toBeVisible()
  await page.getByText('Start Reading →').click()

  // News Reader: save enough words to continue
  await expect(page.getByText('My Vocabulary')).toBeVisible()
  const words = ['harbinger', 'hallyu', 'ambivalent', 'subsidy', 'aesthetic', 'infrastructure']
  for (const word of words) {
    await page.getByText(word, { exact: true }).first().click()
    await page.getByText('+ Add to Vocabulary').click()
  }
  await page.getByText('Continue to Vocabulary →').click()

  // Vocabulary Study: mark words memorized
  await expect(page.getByText('Vocabulary Study')).toBeVisible()
  for (const word of words) {
    const card = page.getByText(word, { exact: true }).locator('xpath=ancestor::div[3]')
    await card.locator('button').nth(1).click()
  }
  await page.getByText('Start Writing →').click()

  // Reflection: write and submit
  await expect(page.getByText('Write Your Reflection')).toBeVisible()
  await page.getByPlaceholder('Reflection title...').fill('My reflection on K-culture')
  await page.getByPlaceholder(/Start writing your reflection/).fill(
    'Korean culture harbinger hallyu ambivalent subsidy aesthetic infrastructure has changed global entertainment in ways that surprised even industry insiders around the world today.'
  )
  await page.getByText('Submit Reflection →').click()
  await page.getByText('Submit', { exact: true }).click()

  // Partner Waiting -> AI Comparison
  await expect(page.getByText('Your partner is still writing.')).toBeVisible()
  await page.getByText('Simulate: Partner Submitted → Compare Now').click()

  // AI Comparison: pick a topic -> Discussion
  await expect(page.getByText('Questions Worth Discussing')).toBeVisible({ timeout: 5000 })
  await page.getByText(/Is K-culture's global rise/).click()
  await page.getByText('Start Discussion →').click()

  // Discussion Room: select an audio file -> analyze
  await expect(page.getByText('Upload Discussion Audio')).toBeVisible()
  await page.getByLabel('Select discussion audio file').setInputFiles({
    name: 'discussion.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('fake-audio-content'),
  })
  await expect(page.getByText('discussion.mp3')).toBeVisible()
  await page.getByText('Analyze Conversation →').click()

  // Speaking Feedback -> mark complete
  await expect(page.getByText('🎉 Mark Today Complete')).toBeVisible({ timeout: 5000 })
  await page.getByText('🎉 Mark Today Complete').click()

  // Learning Complete -> back to Dashboard
  await expect(page.getByText("Today's session complete!")).toBeVisible()
  await page.getByText('Back to Dashboard →').click()
  await expect(page.getByText('Good evening, TestUser')).toBeVisible()
})
