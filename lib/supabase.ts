/**
 * Supabase Client Module
 * Singleton pattern for browser-side Supabase client.
 */

import { createBrowserClient } from '@supabase/ssr';

// Fallback values (used if env vars are not set)
const FALLBACK_SUPABASE_URL = 'https://wbrxjicxaliddqkpfrhx.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnhqaWN4YWxpZGRxa3Bmcmh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MjQyMzMsImV4cCI6MjA4NTEwMDIzM30.CYbptp597wngkjHHkK2P_55xZ2W2JNKYXthVF0lIeNw';

// Read from environment variables with fallback
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

// Log environment variable status (only in browser, once)
let hasLoggedEnvStatus = false;

function logEnvStatus() {
  if (hasLoggedEnvStatus || typeof window === 'undefined') return;
  hasLoggedEnvStatus = true;

  const urlFromEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyFromEnv = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  console.log('[Supabase] Environment variable status:');
  console.log(`  NEXT_PUBLIC_SUPABASE_URL: ${urlFromEnv ? '✓ loaded from env' : '✗ using fallback'}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${keyFromEnv ? '✓ loaded from env' : '✗ using fallback'}`);
  console.log(`  URL: ${SUPABASE_URL.substring(0, 30)}...`);

  if (!urlFromEnv || !keyFromEnv) {
    console.warn('[Supabase] Some environment variables are missing. Using fallback values.');
  }
}

// Singleton instance
let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Get or create Supabase client instance (singleton)
 */
export function getSupabaseClient() {
  if (!client) {
    logEnvStatus();
    console.log('[Supabase] Creating new client instance...');
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[Supabase] Client created successfully');
  }
  return client;
}

/**
 * Get Supabase configuration
 */
export function getConfig() {
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  };
}
