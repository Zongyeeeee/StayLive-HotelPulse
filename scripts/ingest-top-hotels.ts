/**
 * StayLive Top Hotels Data Ingestion Script
 *
 * Fetches reviews for specific top hotels using known TripAdvisor Location IDs.
 * Bypasses the search step for faster and more reliable data ingestion.
 *
 * Usage:
 *   npx tsx scripts/ingest-top-hotels.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  // API Keys
  TRIPADVISOR_API_KEY: process.env.TRIPADVISOR_API_KEY || '',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',

  // Supabase
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Review Filters
  MAX_REVIEWS_PER_HOTEL: 20,
  MAX_REVIEW_RATING: 3, // Only process reviews with rating <= 3
  MAX_REVIEW_AGE_DAYS: 0, // 0 = no limit

  // Rate Limiting
  API_DELAY_MS: 500,

  // System Reporter
  SYSTEM_REPORTER_NAME: 'StayLive Assistant',
  ANONYMOUS_PROBABILITY: 0.3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Top Hotels with TripAdvisor Location IDs
// ─────────────────────────────────────────────────────────────────────────────

const TOP_HOTELS = [
  { name: 'Crown Towers Melbourne', tripAdvisorId: '229340' },
  { name: 'Grand Hyatt Melbourne', tripAdvisorId: '155019' },
  { name: 'The Ritz-Carlton, Melbourne', tripAdvisorId: '25413156' },
  { name: 'W Melbourne', tripAdvisorId: '19853381' },
  { name: 'Sofitel Melbourne On Collins', tripAdvisorId: '155025' },
  { name: 'The Langham, Melbourne', tripAdvisorId: '155021' },
  { name: 'Pan Pacific Melbourne', tripAdvisorId: '1217730' },
  { name: 'InterContinental Melbourne', tripAdvisorId: '1168434' },
  { name: 'Park Hyatt Melbourne', tripAdvisorId: '155023' },
  { name: 'QT Melbourne', tripAdvisorId: '10243454' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TripAdvisorReview {
  id: string;
  title: string;
  text: string;
  rating: number;
  published_date: string;
  travel_date?: string;
}

interface ProcessedReport {
  hotel_name: string;
  issue_key: string;
  severity: 'warning' | 'critical';
  description: string;
  is_anonymous: boolean;
  is_verified: boolean;
  source: 'system';
  system_reporter_name: string | null;
  external_review_id: string;
  external_review_date: string;
}

const VALID_ISSUE_KEYS = [
  'power', 'construction', 'water', 'wifi', 'ac', 'elevator',
  'noise', 'pool', 'restaurant', 'cleaning', 'other',
] as const;

type IssueKey = (typeof VALID_ISSUE_KEYS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info'): void {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
  };
  console.log(`${prefix[type]} ${message}`);
}

function validateConfig(): void {
  const required = ['TRIPADVISOR_API_KEY', 'DEEPSEEK_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missing = required.filter(key => !CONFIG[key as keyof typeof CONFIG]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function validateIssueKey(key: string): IssueKey {
  const normalized = key?.toLowerCase().trim() as IssueKey;
  return VALID_ISSUE_KEYS.includes(normalized) ? normalized : 'other';
}

function shouldBeAnonymous(): boolean {
  return Math.random() < CONFIG.ANONYMOUS_PROBABILITY;
}

function isReviewWithinDateLimit(publishDate: string): boolean {
  if (CONFIG.MAX_REVIEW_AGE_DAYS === 0) return true;
  const reviewDate = new Date(publishDate);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.MAX_REVIEW_AGE_DAYS);
  return reviewDate >= cutoffDate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Loading
// ─────────────────────────────────────────────────────────────────────────────

function loadSystemPrompt(): string {
  const promptPath = path.join(process.cwd(), 'config', 'prompts', 'safety-analyst.secret.md');
  try {
    if (!fs.existsSync(promptPath)) {
      log(`Prompt file not found at ${promptPath}`, 'error');
      process.exit(1);
    }
    const content = fs.readFileSync(promptPath, 'utf-8');
    const systemPromptMatch = content.match(/## System Prompt\s*```([\s\S]*?)```/);
    if (!systemPromptMatch) {
      log('Could not parse system prompt from config file', 'error');
      process.exit(1);
    }
    return systemPromptMatch[1].trim();
  } catch (error) {
    log(`Error loading prompt file: ${error}`, 'error');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TripAdvisor API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTripAdvisorReviews(locationId: string): Promise<TripAdvisorReview[]> {
  const reviewsUrl = `https://api.content.tripadvisor.com/api/v1/location/${locationId}/reviews?key=${CONFIG.TRIPADVISOR_API_KEY}&language=en`;

  try {
    const response = await fetch(reviewsUrl, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://staylive.ai/',
      },
    });

    if (!response.ok) {
      log(`Failed to fetch reviews for location ${locationId}: ${response.status}`, 'warn');
      return [];
    }

    const data = await response.json();

    if (!data.data) {
      return [];
    }

    // Filter for negative reviews and within date limit
    const negativeReviews = data.data
      .filter((review: TripAdvisorReview) => review.rating <= CONFIG.MAX_REVIEW_RATING)
      .filter((review: TripAdvisorReview) => isReviewWithinDateLimit(review.published_date))
      .slice(0, CONFIG.MAX_REVIEWS_PER_HOTEL);

    return negativeReviews;
  } catch (error) {
    log(`Error fetching reviews: ${error}`, 'error');
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek LLM Transformation
// ─────────────────────────────────────────────────────────────────────────────

async function transformReviewToSafetyInsight(
  reviewText: string,
  hotelName: string,
  systemPrompt: string,
  isAnonymous: boolean
): Promise<{ insight: string; issueKey: IssueKey; severity: 'warning' | 'critical' }> {
  const perspective = isAnonymous ? 'FIRST_PERSON' : 'THIRD_PERSON';
  const perspectiveInstruction = isAnonymous
    ? 'Write in FIRST PERSON as if you are the guest (use "I", "my", "me").'
    : 'Write in THIRD PERSON as a professional analyst (use "Guest reported", "A visitor noted").';

  const userPrompt = `Hotel: ${hotelName}
Review: "${reviewText}"

**Perspective: ${perspective}**
${perspectiveInstruction}

Analyze this review and provide:
1. A safety insight (1-2 sentences) in the specified perspective
2. The most relevant issue category from: ${VALID_ISSUE_KEYS.join(', ')}
3. Severity level: "critical" if it poses immediate safety/health risk, otherwise "warning"

Respond in JSON format only:
{"insight": "...", "issueKey": "...", "severity": "..."}`;

  try {
    const response = await fetch(CONFIG.DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        insight: parsed.insight || 'Safety concern reported by guest.',
        issueKey: validateIssueKey(parsed.issueKey),
        severity: parsed.severity === 'critical' ? 'critical' : 'warning',
      };
    }

    return {
      insight: content.slice(0, 500) || 'Guest reported concerns during stay.',
      issueKey: 'other',
      severity: 'warning',
    };
  } catch (error) {
    log(`DeepSeek transformation error: ${error}`, 'error');
    return {
      insight: 'Guest reported concerns during their stay.',
      issueKey: 'other',
      severity: 'warning',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Operations
// ─────────────────────────────────────────────────────────────────────────────

function createSupabaseClient(): SupabaseClient {
  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);
}

async function checkExistingReport(supabase: SupabaseClient, externalReviewId: string): Promise<boolean> {
  const { data } = await supabase
    .from('reports')
    .select('id')
    .eq('external_review_id', externalReviewId)
    .limit(1);
  return data !== null && data.length > 0;
}

async function upsertReport(supabase: SupabaseClient, report: ProcessedReport): Promise<boolean> {
  try {
    const { error } = await supabase.from('reports').insert({
      hotel_name: report.hotel_name,
      issue_key: report.issue_key,
      severity: report.severity,
      description: report.description,
      reporter_id: null,
      is_anonymous: report.is_anonymous,
      is_verified: true,
      source: 'system',
      system_reporter_name: report.system_reporter_name,
      external_review_id: report.external_review_id,
      external_review_date: report.external_review_date,
      created_at: report.external_review_date,
    });

    if (error) {
      log(`Failed to insert report for ${report.hotel_name}: ${error.message}`, 'error');
      return false;
    }
    return true;
  } catch (error) {
    log(`Database error: ${error}`, 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runIngestion(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       StayLive Top Hotels Data Ingestion Pipeline              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    validateConfig();
    log('Configuration validated', 'success');
  } catch (error) {
    log(`${error}`, 'error');
    process.exit(1);
  }

  log('Loading AI prompt from config...');
  const systemPrompt = loadSystemPrompt();
  log('AI prompt loaded', 'success');

  const supabase = createSupabaseClient();
  let totalReviews = 0;
  let skippedReviews = 0;
  let successfulReports = 0;

  log(`\n🏨 Processing ${TOP_HOTELS.length} top hotels...\n`);

  for (let i = 0; i < TOP_HOTELS.length; i++) {
    const hotel = TOP_HOTELS[i];
    log(`\n[${i + 1}/${TOP_HOTELS.length}] Processing: ${hotel.name}`);
    log(`  └─ TripAdvisor ID: ${hotel.tripAdvisorId}`);

    await sleep(CONFIG.API_DELAY_MS);

    // Fetch reviews directly using known TripAdvisor ID
    const reviews = await fetchTripAdvisorReviews(hotel.tripAdvisorId);

    if (reviews.length === 0) {
      log(`  └─ No negative reviews found (rating ≤ ${CONFIG.MAX_REVIEW_RATING})`, 'info');
      continue;
    }

    log(`  └─ Found ${reviews.length} negative reviews`, 'success');

    // Process each review
    for (const review of reviews) {
      totalReviews++;
      const externalReviewId = `tripadvisor_${review.id}`;

      // Check for duplicates
      const exists = await checkExistingReport(supabase, externalReviewId);
      if (exists) {
        log(`    └─ Review ${review.id} already processed, skipping`, 'info');
        skippedReviews++;
        continue;
      }

      const isAnonymous = shouldBeAnonymous();
      await sleep(CONFIG.API_DELAY_MS);

      log(`    └─ Transforming review (${isAnonymous ? 'anonymous' : 'attributed'})...`);

      const transformed = await transformReviewToSafetyInsight(
        review.text,
        hotel.name,
        systemPrompt,
        isAnonymous
      );

      const report: ProcessedReport = {
        hotel_name: hotel.name,
        issue_key: transformed.issueKey,
        severity: transformed.severity,
        description: transformed.insight,
        is_anonymous: isAnonymous,
        is_verified: true,
        source: 'system',
        system_reporter_name: isAnonymous ? null : CONFIG.SYSTEM_REPORTER_NAME,
        external_review_id: externalReviewId,
        external_review_date: review.published_date,
      };

      const success = await upsertReport(supabase, report);
      if (success) {
        successfulReports++;
        log(`    └─ Report saved: [${report.severity.toUpperCase()}] ${report.issue_key}`, 'success');
      }
    }
  }

  // Summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    Ingestion Complete                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Hotels processed: ${TOP_HOTELS.length}`);
  console.log(`  Total reviews found: ${totalReviews}`);
  console.log(`  Skipped (duplicates): ${skippedReviews}`);
  console.log(`  Reports saved: ${successfulReports}`);
  console.log('\n');
}

// Run
runIngestion();
