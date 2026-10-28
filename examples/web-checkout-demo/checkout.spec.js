/**
 * Playwright / Vitest E2E Test Suite for SleuthStore Checkout Workflow
 *
 * This test file documents the intended application behavior:
 * - Happy Path: Fill form -> Click Pay -> /api/v1/charge returns 200 -> OrderConfirmed
 * - Known Failure Mode 1: Payment gateway times out after 8s -> PaymentFailed with retry
 * - Known Failure Mode 2: Payment gateway CORS rejection -> Network error state
 */

import { test, expect } from '@playwright/test';

test.describe('Checkout & Payment Workflow', () => {

  test('happy_path: user completes purchase with valid payment', async ({ page }) => {
    // 1. GIVEN user is on checkout page
    await page.goto('/checkout');
    await expect(page.locator('text=SleuthStore')).toBeVisible();

    // 2. WHEN user fills out shipping and payment details
    await page.fill('#firstName', 'Alex');
    await page.fill('#lastName', 'Rivera');
    await page.fill('#cardNumber', '4242424242424242');

    // Select Happy Path scenario
    await page.selectOption('#simScenario', 'success');

    // 3. AND user clicks Pay Now
    await page.click('#btnPay');

    // 4. THEN app enters processing state and completes
    await expect(page.locator('#successBox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Order Confirmed')).toBeVisible();
  });

  test('timeout_failure_path: payment gateway times out after 8 seconds', async ({ page }) => {
    // 1. GIVEN user is on checkout page
    await page.goto('/checkout');

    // Select Timeout scenario
    await page.selectOption('#simScenario', 'timeout');

    // 2. WHEN user clicks Pay Now
    await page.click('#btnPay');

    // 3. THEN the gateway call /api/v1/charge times out
    // Expect error alert and user retry button re-enabled
    await expect(page.locator('#errorBox')).toBeVisible({ timeout: 12000 });
    await expect(page.locator('text=Payment Gateway timed out')).toBeVisible();
    await expect(page.locator('#btnPay')).toBeEnabled();
  });

  test('cors_error_path: payment gateway rejected by browser CORS policy', async ({ page }) => {
    await page.goto('/checkout');
    await page.selectOption('#simScenario', 'cors');
    await page.click('#btnPay');

    await expect(page.locator('#errorBox')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=CORS policy')).toBeVisible();
  });

});
