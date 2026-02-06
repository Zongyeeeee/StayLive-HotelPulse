/**
 * Data Service Module
 * Handles all data fetching, transformation, and persistence operations.
 */

import { getSupabaseClient } from './supabase';
import type { Report, ReportRow, ReportFormData, ReportStats, Profile, Translations } from './types';

export const BATCH_SIZE = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Data Fetching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch initial batch of reports
 */
export async function fetchInitialReports(
  translations: Translations
): Promise<{ reports: Report[]; error: Error | null }> {
  const client = getSupabaseClient();

  try {
    // Try with profiles join first (include system report fields)
    let { data, error } = await client
      .from('reports')
      .select('*, source, system_reporter_name, profiles!reporter_id(display_name)')
      .order('created_at', { ascending: false })
      .range(0, BATCH_SIZE - 1);

    // Fallback: if join fails, query without profiles
    if (error) {
      console.warn('[DataService] Profiles join failed, retrying without join:', error.message);
      const result = await client
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, BATCH_SIZE - 1);
      data = result.data;
      error = result.error;
    }

    if (error) {
      throw error;
    }

    const reports = mapReportsToViewModel(data || [], translations);
    return { reports, error: null };
  } catch (e) {
    console.error('[DataService] Fetch error:', e);
    return { reports: [], error: e as Error };
  }
}

/**
 * Fetch complete dataset
 */
export async function fetchFullDataset(
  translations: Translations
): Promise<{ reports: Report[]; error: Error | null }> {
  const client = getSupabaseClient();

  try {
    let { data, error } = await client
      .from('reports')
      .select('*, source, system_reporter_name, profiles!reporter_id(display_name)')
      .order('created_at', { ascending: false });

    // Fallback without profiles join
    if (error) {
      const result = await client
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });
      data = result.data;
      error = result.error;
    }

    if (!error && data) {
      const reports = mapReportsToViewModel(data, translations);
      return { reports, error: null };
    }

    return { reports: [], error };
  } catch (e) {
    console.error('[DataService] Full dataset fetch error:', e);
    return { reports: [], error: e as Error };
  }
}

/**
 * Submit a new report
 */
export async function submitReport(
  reportData: ReportFormData,
  reporterId: string
): Promise<{ success: boolean; error: Error | null }> {
  const client = getSupabaseClient();

  const baseData = {
    hotel_name: reportData.hotel_name,
    issue_key: reportData.issue_key,
    severity: reportData.severity,
    description: reportData.description,
    reporter_id: reporterId,
    is_verified: false,
  };

  try {
    // Try with is_anonymous if column exists
    let { error } = await client
      .from('reports')
      .insert([{ ...baseData, is_anonymous: reportData.is_anonymous }]);

    // Fallback: retry without is_anonymous if column doesn't exist
    if (error?.code === 'PGRST204' || error?.message?.includes('is_anonymous')) {
      console.warn('[DataService] is_anonymous column not found, retrying without it');
      const result = await client.from('reports').insert([baseData]);
      error = result.error;
    }

    if (error) {
      console.error('[DataService] Submit error:', error);
      return { success: false, error };
    }

    return { success: true, error: null };
  } catch (e) {
    console.error('[DataService] Submit exception:', e);
    return { success: false, error: e as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Transformation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map raw database records to view model format
 */
export function mapReportsToViewModel(data: ReportRow[], translations: Translations): Report[] {
  return data.map((r) => ({
    id: r.id,
    hotel: r.hotel_name || 'Unknown',
    issueKey: r.issue_key || 'other',
    severity: r.severity || 'warning',
    description: r.description || '',
    timestamp: new Date(r.created_at || Date.now()),
    reporterName: getReporterDisplayName(r, translations),
    verified: r.is_verified || false,
  }));
}

/**
 * Get the display name for a report's reporter
 * Handles: anonymous, system reports, and user profiles
 */
function getReporterDisplayName(report: ReportRow, translations: Translations): string {
  // Anonymous reports
  if (report.is_anonymous === true) {
    return translations['anonymous'] || 'Anonymous';
  }

  // System-generated reports (data ingestion)
  if (report.source === 'system' && report.system_reporter_name) {
    return report.system_reporter_name;
  }

  // User profile display name
  if (report.profiles?.display_name) {
    return report.profiles.display_name;
  }

  // Fallback for system reports without system_reporter_name
  if (report.source === 'system') {
    return 'StayLive Assistant';
  }

  // Default fallback
  return translations['guest-prefix'] || 'Guest';
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate statistics from reports
 */
export function calculateStats(reports: Report[]): ReportStats {
  return {
    total: reports.length,
    critical: reports.filter((r) => r.severity === 'critical').length,
    verified: reports.filter((r) => r.verified).length,
    hotels: new Set(reports.map((r) => r.hotel)).size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hotel Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all hotels sorted alphabetically
 */
export async function fetchHotels(): Promise<{ hotels: string[]; error: Error | null }> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('hotels')
      .select('name')
      .order('name', { ascending: true });

    if (error) {
      console.error('[DataService] Hotels fetch error:', error);
      return { hotels: [], error };
    }

    const hotels = (data || []).map((h: { name: string }) => h.name);
    return { hotels, error: null };
  } catch (e) {
    console.error('[DataService] Hotels fetch exception:', e);
    return { hotels: [], error: e as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch user profile by ID
 */
export async function fetchUserProfile(userId: string): Promise<Profile | null> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      return data as Profile;
    }
  } catch (e) {
    console.error('[DataService] Profile fetch error:', e);
  }

  return null;
}

/**
 * Nickname validation constants
 */
const MAX_NICKNAME_LENGTH = 15;

/**
 * Validate and clean nickname
 */
export function validateNickname(nickname: string): {
  valid: boolean;
  cleaned: string;
  error?: string;
} {
  // Clean: trim and remove all whitespace
  const cleaned = nickname.trim().replace(/\s/g, '');

  if (!cleaned) {
    return { valid: false, cleaned, error: 'Nickname is required' };
  }

  if (cleaned.length > MAX_NICKNAME_LENGTH) {
    return {
      valid: false,
      cleaned: cleaned.slice(0, MAX_NICKNAME_LENGTH),
      error: `Nickname must be ${MAX_NICKNAME_LENGTH} characters or less`,
    };
  }

  return { valid: true, cleaned };
}

/**
 * Update user profile display name
 */
export async function updateProfileDisplayName(
  userId: string,
  displayName: string
): Promise<{ success: boolean; error: Error | null }> {
  const client = getSupabaseClient();

  try {
    // Validate and clean the nickname
    const validation = validateNickname(displayName);

    if (!validation.valid) {
      return { success: false, error: new Error(validation.error) };
    }

    const { error } = await client.from('profiles').upsert({
      id: userId,
      display_name: validation.cleaned,
      updated_at: new Date().toISOString(),
    });

    if (!error) {
      return { success: true, error: null };
    }

    console.error('[DataService] Profile update error:', error);
    return { success: false, error };
  } catch (e) {
    console.error('[DataService] Profile update exception:', e);
    return { success: false, error: e as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format timestamp to relative time string
 */
export function formatTimeAgo(timestamp: Date, translations: Translations): string {
  const diff = Date.now() - timestamp.getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 60) {
    return `${mins}${translations['time-minutes'] || 'm'}`;
  }
  if (mins < 1440) {
    return `${Math.floor(mins / 60)}${translations['time-hours'] || 'h'}`;
  }
  return `${Math.floor(mins / 1440)}${translations['time-days'] || 'd'}`;
}
