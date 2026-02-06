/**
 * useUpgrade Hook
 * Handles subscription upgrade flow with Stripe Checkout.
 * Supports weekly, monthly, and annually billing periods.
 */

'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UpgradeTier = 'pro' | 'ultra';
export type BillingPeriod = 'weekly' | 'monthly' | 'annually';

interface UpgradeState {
  isLoading: boolean;
  loadingTier: UpgradeTier | null;
  error: string | null;
}

interface UseUpgradeReturn extends UpgradeState {
  handleUpgrade: (tier: UpgradeTier, billingPeriod?: BillingPeriod) => Promise<void>;
  clearError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useUpgrade(): UseUpgradeReturn {
  const { user, isAuthenticated } = useAuth();
  const [state, setState] = useState<UpgradeState>({
    isLoading: false,
    loadingTier: null,
    error: null,
  });

  const handleUpgrade = useCallback(async (tier: UpgradeTier, billingPeriod: BillingPeriod = 'monthly') => {
    console.log('[useUpgrade] handleUpgrade called:', { tier, billingPeriod, isAuthenticated, userId: user?.id });

    // Check authentication
    if (!isAuthenticated || !user?.id) {
      console.log('[useUpgrade] Auth check failed:', { isAuthenticated, userId: user?.id });
      setState(prev => ({
        ...prev,
        error: 'Please sign in to upgrade your subscription.',
      }));
      return;
    }

    // Validate tier
    if (tier !== 'pro' && tier !== 'ultra') {
      setState(prev => ({
        ...prev,
        error: 'Invalid subscription tier.',
      }));
      return;
    }

    // Validate billing period
    if (!['weekly', 'monthly', 'annually'].includes(billingPeriod)) {
      setState(prev => ({
        ...prev,
        error: 'Invalid billing period.',
      }));
      return;
    }

    // Set loading state
    setState({
      isLoading: true,
      loadingTier: tier,
      error: null,
    });

    try {
      // Call checkout API with tier and billing period
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier,
          userId: user.id,
          billingPeriod,
        }),
      });

      const data = await response.json();
      console.log('[useUpgrade] API response:', { status: response.status, ok: response.ok, data });

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        console.log('[useUpgrade] Redirecting to Stripe checkout:', data.url);
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      console.error('[useUpgrade] Error:', message);
      setState({
        isLoading: false,
        loadingTier: null,
        error: message,
      });
    }
  }, [isAuthenticated, user?.id]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    handleUpgrade,
    clearError,
  };
}
