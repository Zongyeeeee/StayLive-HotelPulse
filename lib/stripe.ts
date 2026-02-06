/**
 * Stripe Configuration Module
 * Server-side Stripe initialization and utilities.
 * Supports weekly, monthly, and annually billing periods.
 */

import Stripe from 'stripe';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MembershipTier = 'free' | 'pro' | 'ultra';
export type BillingPeriod = 'weekly' | 'monthly' | 'annually';

export interface BillingConfig {
  duration_days: number;
  token_multiplier: number; // relative to monthly (1 = monthly base)
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing Period Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const BILLING_CONFIGS: Record<BillingPeriod, BillingConfig> = {
  weekly: {
    duration_days: 7,
    token_multiplier: 0.25, // 1/4 of monthly tokens
  },
  monthly: {
    duration_days: 30,
    token_multiplier: 1, // base
  },
  annually: {
    duration_days: 365,
    token_multiplier: 12, // 12x monthly tokens
  },
};

// Legacy export for backward compatibility
export const SUBSCRIPTION_DURATION_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Client (Server-side only)
// ─────────────────────────────────────────────────────────────────────────────

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    // Match reference pattern - use specific API version
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Price ID Mapping (read at runtime to avoid caching issues)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all price IDs from environment variables (read at runtime)
 */
function getPriceIds() {
  const ids = {
    // Monthly (default)
    pro_monthly: process.env.STRIPE_PRICE_ID_PRO || '',
    ultra_monthly: process.env.STRIPE_PRICE_ID_ULTRA || '',
    // Weekly
    pro_weekly: process.env.STRIPE_PRICE_ID_PRO_WK || '',
    ultra_weekly: process.env.STRIPE_PRICE_ID_ULTRA_WK || '',
    // Annually
    pro_annually: process.env.STRIPE_PRICE_ID_PRO_YR || '',
    ultra_annually: process.env.STRIPE_PRICE_ID_ULTRA_YR || '',
  };

  // Debug logging
  console.log('[Stripe getPriceIds] Raw env values:', {
    STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
    STRIPE_PRICE_ID_ULTRA: process.env.STRIPE_PRICE_ID_ULTRA,
    STRIPE_PRICE_ID_PRO_WK: process.env.STRIPE_PRICE_ID_PRO_WK,
    STRIPE_PRICE_ID_ULTRA_WK: process.env.STRIPE_PRICE_ID_ULTRA_WK,
    STRIPE_PRICE_ID_PRO_YR: process.env.STRIPE_PRICE_ID_PRO_YR,
    STRIPE_PRICE_ID_ULTRA_YR: process.env.STRIPE_PRICE_ID_ULTRA_YR,
  });
  console.log('[Stripe getPriceIds] Mapped IDs:', ids);

  return ids;
}

/**
 * Get tier and billing period from a Stripe price ID
 */
export function getTierAndPeriodFromPriceId(priceId: string): { tier: MembershipTier; period: BillingPeriod } | null {
  const PRICE_IDS = getPriceIds();

  // Monthly
  if (priceId === PRICE_IDS.pro_monthly) return { tier: 'pro', period: 'monthly' };
  if (priceId === PRICE_IDS.ultra_monthly) return { tier: 'ultra', period: 'monthly' };
  // Weekly
  if (priceId === PRICE_IDS.pro_weekly) return { tier: 'pro', period: 'weekly' };
  if (priceId === PRICE_IDS.ultra_weekly) return { tier: 'ultra', period: 'weekly' };
  // Annually
  if (priceId === PRICE_IDS.pro_annually) return { tier: 'pro', period: 'annually' };
  if (priceId === PRICE_IDS.ultra_annually) return { tier: 'ultra', period: 'annually' };

  return null;
}

/**
 * Legacy function - returns just the tier for backward compatibility
 */
export function getTierFromPriceId(priceId: string): MembershipTier | null {
  const result = getTierAndPeriodFromPriceId(priceId);
  return result ? result.tier : null;
}

/**
 * Get price ID for a tier and billing period
 */
export function getPriceIdForTierAndPeriod(
  tier: Exclude<MembershipTier, 'free'>,
  period: BillingPeriod = 'monthly'
): string {
  const PRICE_IDS = getPriceIds();
  const key = `${tier}_${period}` as keyof ReturnType<typeof getPriceIds>;
  const priceId = PRICE_IDS[key];

  if (!priceId) {
    console.error('[Stripe] Price ID not found:', { tier, period, key, availableIds: PRICE_IDS });
    throw new Error(`Price ID not configured for ${tier} ${period}`);
  }

  return priceId;
}

/**
 * Legacy function - returns monthly price ID for backward compatibility
 */
export function getPriceIdForTier(tier: Exclude<MembershipTier, 'free'>): string {
  return getPriceIdForTierAndPeriod(tier, 'monthly');
}

/**
 * Get duration in days for a billing period
 */
export function getDurationForPeriod(period: BillingPeriod): number {
  return BILLING_CONFIGS[period].duration_days;
}

/**
 * Get token multiplier for a billing period (relative to monthly base)
 */
export function getTokenMultiplierForPeriod(period: BillingPeriod): number {
  return BILLING_CONFIGS[period].token_multiplier;
}
