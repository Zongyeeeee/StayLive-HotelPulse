/**
 * StayLive Type Definitions
 * Core TypeScript types for the application.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Database Types (Supabase)
// ─────────────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportRow {
  id: string;
  hotel_name: string;
  issue_key: IssueKey;
  severity: Severity;
  description: string;
  reporter_id: string | null;
  is_anonymous: boolean;
  is_verified: boolean;
  created_at: string;
  // System report fields (data ingestion)
  source?: 'user' | 'system';
  system_reporter_name?: string | null;
  external_review_id?: string | null;
  external_review_date?: string | null;
  profiles?: {
    display_name: string | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Application Types
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'warning' | 'critical';

export type IssueKey =
  | 'power'
  | 'construction'
  | 'water'
  | 'wifi'
  | 'ac'
  | 'elevator'
  | 'noise'
  | 'pool'
  | 'restaurant'
  | 'cleaning'
  | 'other';

export interface Report {
  id: string;
  hotel: string;
  issueKey: IssueKey;
  severity: Severity;
  description: string;
  timestamp: Date;
  reporterName: string;
  verified: boolean;
}

export interface ReportFormData {
  hotel_name: string;
  issue_key: IssueKey;
  severity: Severity;
  description: string;
  is_anonymous: boolean;
}

export interface ReportStats {
  total: number;
  critical: number;
  verified: number;
  hotels: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Types
// ─────────────────────────────────────────────────────────────────────────────

export type FilterType = 'all' | 'critical' | 'verified' | 'hotels' | null;

// ─────────────────────────────────────────────────────────────────────────────
// Session Types
// ─────────────────────────────────────────────────────────────────────────────

export type SessionType = 'visitor' | 'authenticated' | null;

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: {
    name?: string;
    avatar_url?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme Types
// ─────────────────────────────────────────────────────────────────────────────

export type Theme = 'night' | 'warm';

// ─────────────────────────────────────────────────────────────────────────────
// Language Types
// ─────────────────────────────────────────────────────────────────────────────

export type Language = 'EN' | 'CN';

export interface Translations {
  [key: string]: string;
}

export interface TranslationDict {
  EN: Translations;
  CN: Translations;
}
