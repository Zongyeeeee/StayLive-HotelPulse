/**
 * StayLive Data Ingestion Script
 *
 * Fetches hotel data from Google Places API, extracts negative reviews from TripAdvisor,
 * transforms them into professional safety insights using DeepSeek, and upserts to Supabase.
 *
 * Usage:
 *   npx tsx scripts/ingest-hotel-data.ts
 *
 * Or via npm:
 *   npm run ingest
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
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  TRIPADVISOR_API_KEY: process.env.TRIPADVISOR_API_KEY || '',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',

  // Supabase
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Search Parameters
  SEARCH_LOCATION: 'Melbourne CBD, Victoria, Australia',
  SEARCH_RADIUS: 5000, // meters
  MAX_HOTELS: 300, // Process up to 300 hotels from database
  MAX_REVIEWS_PER_HOTEL: 20, // Fetch 20 reviews per hotel
  MAX_REVIEW_RATING: 3, // Only process reviews with rating <= 3 (negative)
  MAX_REVIEW_AGE_DAYS: 30, // Only process reviews from the last 30 days (0 = no limit)

  // Rate Limiting
  API_DELAY_MS: 500,

  // System Reporter
  SYSTEM_REPORTER_NAME: 'StayLive Assistant',
  ANONYMOUS_PROBABILITY: 0.3, // 30% chance of being anonymous

  // Random Sampling (use --random flag)
  RANDOM_SAMPLE_SIZE: 20, // Number of hotels to randomly sample
};

// Parse command line arguments
const args = process.argv.slice(2);
const randomSizeArg = args.find(arg => arg.startsWith('--random='));
const useRandomSampling = args.includes('--random') || randomSizeArg !== undefined;
const useUnprocessedOnly = args.includes('--unprocessed');
const RANDOM_SAMPLE_COUNT = randomSizeArg
  ? parseInt(randomSizeArg.split('=')[1], 10)
  : CONFIG.RANDOM_SAMPLE_SIZE;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GooglePlace {
  place_id: string;
  name: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
}

interface GoogleReview {
  name: string; // Review resource name (used as ID)
  relativePublishTimeDescription: string;
  rating: number;
  text: {
    text: string;
    languageCode: string;
  };
  originalText?: {
    text: string;
    languageCode: string;
  };
  authorAttribution: {
    displayName: string;
    uri?: string;
  };
  publishTime: string; // ISO timestamp
}

// Unified review interface for both sources
interface UnifiedReview {
  id: string;
  text: string;
  rating: number;
  publishDate: string;
  source: 'tripadvisor' | 'google';
  authorName?: string;
}

interface TripAdvisorLocation {
  location_id: string;
  name: string;
  address_obj?: {
    street1?: string;
    city?: string;
    country?: string;
  };
}

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

// Valid issue keys from database schema
const VALID_ISSUE_KEYS = [
  'power',
  'construction',
  'water',
  'wifi',
  'ac',
  'elevator',
  'noise',
  'pool',
  'restaurant',
  'cleaning',
  'other',
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
  const required = [
    'GOOGLE_MAPS_API_KEY',
    'TRIPADVISOR_API_KEY',
    'DEEPSEEK_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
  ];

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
  if (CONFIG.MAX_REVIEW_AGE_DAYS === 0) return true; // No limit

  const reviewDate = new Date(publishDate);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.MAX_REVIEW_AGE_DAYS);

  return reviewDate >= cutoffDate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Loading (from private config)
// ─────────────────────────────────────────────────────────────────────────────

function loadSystemPrompt(): string {
  const promptPath = path.join(process.cwd(), 'config', 'prompts', 'safety-analyst.secret.md');

  try {
    if (!fs.existsSync(promptPath)) {
      log(`Prompt file not found at ${promptPath}`, 'error');
      log('Please ensure config/prompts/safety-analyst.secret.md exists', 'error');
      process.exit(1);
    }

    const content = fs.readFileSync(promptPath, 'utf-8');

    // Extract the system prompt from the markdown (between ``` code blocks in System Prompt section)
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
// Google Places API (New) - Uses the newer API endpoint
// ─────────────────────────────────────────────────────────────────────────────

// Melbourne CBD coordinates (hardcoded to avoid Geocoding API issues)
const MELBOURNE_CBD_COORDS = {
  lat: -37.8136,
  lng: 144.9631,
};

// Response type for Places API (New)
interface PlacesNewResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

async function searchHotelsGoogle(): Promise<GooglePlace[]> {
  log(`Searching for hotels in ${CONFIG.SEARCH_LOCATION}...`);

  const lat = MELBOURNE_CBD_COORDS.lat;
  const lng = MELBOURNE_CBD_COORDS.lng;

  log(`Using Melbourne CBD coordinates: ${lat}, ${lng}`);

  // Use Places API (New) with POST request
  const placesUrl = 'https://places.googleapis.com/v1/places:searchNearby';

  const requestBody = {
    includedTypes: ['lodging', 'hotel'],
    maxResultCount: CONFIG.MAX_HOTELS,
    locationRestriction: {
      circle: {
        center: {
          latitude: lat,
          longitude: lng,
        },
        radius: CONFIG.SEARCH_RADIUS,
      },
    },
  };

  try {
    const placesResponse = await fetch(placesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
      },
      body: JSON.stringify(requestBody),
    });

    const placesData: PlacesNewResponse = await placesResponse.json();

    // Check for errors
    if (placesData.error) {
      log(`Places API (New) error: ${JSON.stringify(placesData.error)}`, 'error');

      if (placesData.error.status === 'PERMISSION_DENIED') {
        log('Places API (New) permission denied. Please check:', 'error');
        log('  1. Enable "Places API (New)" in Google Cloud Console', 'error');
        log('  2. Remove HTTP referer restrictions from API key (for server use)', 'error');
        log('  3. Or create a new API key without restrictions', 'error');
        log('  4. Ensure billing is enabled', 'error');
      }

      throw new Error(`Places search failed: ${placesData.error.message}`);
    }

    if (!placesData.places || placesData.places.length === 0) {
      log('No hotels found in the area', 'warn');
      return [];
    }

    const hotels: GooglePlace[] = placesData.places.map(place => ({
      place_id: place.id,
      name: place.displayName?.text || 'Unknown Hotel',
      formatted_address: place.formattedAddress,
      rating: place.rating,
      user_ratings_total: place.userRatingCount,
    }));

    log(`Found ${hotels.length} hotels`, 'success');
    return hotels;
  } catch (error) {
    // If Places API (New) fails, try legacy API as fallback
    log(`Places API (New) failed: ${error}`, 'warn');
    log('Trying legacy Places API...', 'info');

    return searchHotelsGoogleLegacy(lat, lng);
  }
}

// Fallback to legacy Places API
async function searchHotelsGoogleLegacy(lat: number, lng: number): Promise<GooglePlace[]> {
  const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${CONFIG.SEARCH_RADIUS}&type=lodging&key=${CONFIG.GOOGLE_MAPS_API_KEY}`;

  const placesResponse = await fetch(placesUrl);
  const placesData = await placesResponse.json();

  if (placesData.status !== 'OK') {
    log(`Legacy Places API also failed: ${placesData.status}`, 'error');
    log(`Error: ${placesData.error_message || 'Unknown'}`, 'error');
    log('', 'error');
    log('=== SOLUTION ===', 'error');
    log('Your API key has HTTP referer restrictions which block server-side calls.', 'error');
    log('', 'error');
    log('Option 1: Create a new API key for server use:', 'error');
    log('  1. Go to Google Cloud Console > APIs & Services > Credentials', 'error');
    log('  2. Create a new API key', 'error');
    log('  3. Set restriction to "None" or "IP addresses" (add your server IP)', 'error');
    log('  4. Enable "Places API" and "Places API (New)"', 'error');
    log('  5. Update GOOGLE_MAPS_API_KEY in .env.local', 'error');
    log('', 'error');
    log('Option 2: Remove restrictions from current key:', 'error');
    log('  1. Go to Google Cloud Console > APIs & Services > Credentials', 'error');
    log('  2. Edit your API key', 'error');
    log('  3. Under "Application restrictions", select "None"', 'error');

    throw new Error(`Places search failed: ${placesData.status}`);
  }

  const hotels: GooglePlace[] = placesData.results
    .slice(0, CONFIG.MAX_HOTELS)
    .map((place: GooglePlace) => ({
      place_id: place.place_id,
      name: place.name,
      formatted_address: place.formatted_address,
      rating: place.rating,
      user_ratings_total: place.user_ratings_total,
    }));

  log(`Found ${hotels.length} hotels (legacy API)`, 'success');
  return hotels;
}

// ─────────────────────────────────────────────────────────────────────────────
// TripAdvisor API
// ─────────────────────────────────────────────────────────────────────────────

async function searchHotelTripAdvisor(hotelName: string): Promise<TripAdvisorLocation | null> {
  const searchUrl = `https://api.content.tripadvisor.com/api/v1/location/search?key=${CONFIG.TRIPADVISOR_API_KEY}&searchQuery=${encodeURIComponent(hotelName)}&category=hotels&language=en`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://staylive.ai/',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log(`TripAdvisor search failed for "${hotelName}": ${response.status}`, 'warn');
      if (response.status === 403) {
        log(`  └─ 403 Response: ${errorBody.slice(0, 200)}`, 'warn');
      }
      return null;
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      log(`No TripAdvisor match for "${hotelName}"`, 'warn');
      return null;
    }

    return data.data[0] as TripAdvisorLocation;
  } catch (error) {
    log(`TripAdvisor search error for "${hotelName}": ${error}`, 'error');
    return null;
  }
}

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

    // Filter for negative reviews (rating <= 3), within date limit, and take the most recent ones
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
// Google Reviews API (Place Details)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGoogleReviews(placeId: string, hotelName: string): Promise<UnifiedReview[]> {
  // Use Places API (New) - Place Details endpoint
  const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}`;

  try {
    const response = await fetch(detailsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'reviews',
      },
    });

    if (!response.ok) {
      log(`Google Reviews fetch failed for "${hotelName}": ${response.status}`, 'warn');
      return [];
    }

    const data = await response.json();

    if (!data.reviews || data.reviews.length === 0) {
      log(`No Google reviews found for "${hotelName}"`, 'info');
      return [];
    }

    // Filter for negative reviews (rating <= 3) and convert to unified format
    const negativeReviews: UnifiedReview[] = data.reviews
      .filter((review: GoogleReview) => review.rating <= CONFIG.MAX_REVIEW_RATING)
      .slice(0, CONFIG.MAX_REVIEWS_PER_HOTEL)
      .map((review: GoogleReview) => ({
        id: `google_${review.name.replace('places/', '').replace('/reviews/', '_')}`,
        text: review.originalText?.text || review.text?.text || '',
        rating: review.rating,
        publishDate: review.publishTime,
        source: 'google' as const,
        authorName: review.authorAttribution?.displayName,
      }));

    return negativeReviews;
  } catch (error) {
    log(`Error fetching Google reviews for "${hotelName}": ${error}`, 'error');
    return [];
  }
}

// Convert TripAdvisor reviews to unified format
function convertTripAdvisorToUnified(reviews: TripAdvisorReview[]): UnifiedReview[] {
  return reviews.map(review => ({
    id: `tripadvisor_${review.id}`,
    text: review.text,
    rating: review.rating,
    publishDate: review.published_date,
    source: 'tripadvisor' as const,
    authorName: undefined,
  }));
}

/**
 * Fetch ALL Google reviews for a hotel (up to MAX_REVIEWS_PER_HOTEL)
 * Returns all reviews regardless of rating - filtering done separately
 */
async function fetchGoogleReviewsAll(placeId: string, hotelName: string): Promise<UnifiedReview[]> {
  const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}`;

  try {
    const response = await fetch(detailsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'reviews',
      },
    });

    if (!response.ok) {
      log(`  └─ Google Reviews fetch failed: ${response.status}`, 'warn');
      return [];
    }

    const data = await response.json();

    if (!data.reviews || data.reviews.length === 0) {
      return [];
    }

    // Return up to MAX_REVIEWS_PER_HOTEL reviews (all ratings)
    const reviews: UnifiedReview[] = data.reviews
      .slice(0, CONFIG.MAX_REVIEWS_PER_HOTEL)
      .map((review: GoogleReview) => ({
        id: `google_${review.name.replace('places/', '').replace('/reviews/', '_')}`,
        text: review.originalText?.text || review.text?.text || '',
        rating: review.rating,
        publishDate: review.publishTime,
        source: 'google' as const,
        authorName: review.authorAttribution?.displayName,
      }));

    return reviews;
  } catch (error) {
    log(`  └─ Error fetching reviews: ${error}`, 'error');
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
  // Determine perspective based on anonymity
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

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        insight: parsed.insight || 'Safety concern reported by guest.',
        issueKey: validateIssueKey(parsed.issueKey),
        severity: parsed.severity === 'critical' ? 'critical' : 'warning',
      };
    }

    // Fallback if JSON parsing fails
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

// Database hotel record
interface DatabaseHotel {
  name: string;
  google_place_id: string | null;
}

/**
 * Fetch hotels from database (already populated by fetch-hotels script)
 */
async function fetchHotelsFromDatabase(supabase: SupabaseClient): Promise<DatabaseHotel[]> {
  log('Fetching hotels from database...');

  const { data, error } = await supabase
    .from('hotels')
    .select('name, google_place_id')
    .not('google_place_id', 'is', null)
    .order('name', { ascending: true })
    .limit(CONFIG.MAX_HOTELS);

  if (error) {
    log(`Database fetch error: ${error.message}`, 'error');
    return [];
  }

  if (!data || data.length === 0) {
    log('No hotels found in database. Run "npm run fetch-hotels" first.', 'warn');
    return [];
  }

  log(`Loaded ${data.length} hotels from database`, 'success');
  return data as DatabaseHotel[];
}

/**
 * Randomly select N hotels from the database
 */
async function fetchRandomHotels(supabase: SupabaseClient, count: number): Promise<DatabaseHotel[]> {
  log(`Randomly selecting ${count} hotels from database...`);

  // Fetch all hotels with google_place_id
  const { data, error } = await supabase
    .from('hotels')
    .select('name, google_place_id')
    .not('google_place_id', 'is', null);

  if (error) {
    log(`Database fetch error: ${error.message}`, 'error');
    return [];
  }

  if (!data || data.length === 0) {
    log('No hotels found in database. Run "npm run fetch-hotels" first.', 'warn');
    return [];
  }

  // Fisher-Yates shuffle and take first N
  const shuffled = [...data];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  log(`Randomly selected ${selected.length} hotels from ${data.length} total`, 'success');

  return selected as DatabaseHotel[];
}

/**
 * Fetch hotels that have no reports yet (unprocessed)
 */
async function fetchUnprocessedHotels(supabase: SupabaseClient, count: number): Promise<DatabaseHotel[]> {
  log(`Fetching up to ${count} unprocessed hotels (no reports yet)...`);

  // Get all hotel IDs that already have reports
  const { data: processedHotels, error: reportsError } = await supabase
    .from('reports')
    .select('hotel_id')
    .not('hotel_id', 'is', null);

  if (reportsError) {
    log(`Error fetching processed hotels: ${reportsError.message}`, 'error');
    return [];
  }

  // Create set of processed hotel IDs
  const processedHotelIds = new Set(
    (processedHotels || []).map(r => r.hotel_id).filter(Boolean)
  );

  log(`Found ${processedHotelIds.size} hotels with existing reports`, 'info');

  // Fetch all hotels with google_place_id
  const { data: allHotels, error: hotelsError } = await supabase
    .from('hotels')
    .select('id, name, google_place_id')
    .not('google_place_id', 'is', null);

  if (hotelsError) {
    log(`Error fetching hotels: ${hotelsError.message}`, 'error');
    return [];
  }

  // Filter to only unprocessed hotels
  const unprocessedHotels = (allHotels || []).filter(
    hotel => !processedHotelIds.has(hotel.id)
  );

  log(`Found ${unprocessedHotels.length} unprocessed hotels`, 'info');

  if (unprocessedHotels.length === 0) {
    log('All hotels have been processed!', 'success');
    return [];
  }

  // Shuffle and take first N
  const shuffled = [...unprocessedHotels];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  log(`Selected ${selected.length} unprocessed hotels to process`, 'success');

  return selected as DatabaseHotel[];
}

async function checkExistingReport(
  supabase: SupabaseClient,
  externalReviewId: string
): Promise<boolean> {
  // Check if we already have a report from this external review
  const { data } = await supabase
    .from('reports')
    .select('id')
    .eq('external_review_id', externalReviewId)
    .limit(1);

  return data !== null && data.length > 0;
}

async function upsertReport(supabase: SupabaseClient, report: ProcessedReport): Promise<boolean> {
  try {
    // Use is_anonymous and system_reporter_name from report (determined before LLM call)
    const { error } = await supabase.from('reports').insert({
      hotel_name: report.hotel_name,
      issue_key: report.issue_key,
      severity: report.severity,
      description: report.description,
      reporter_id: null, // System-generated reports have no user
      is_anonymous: report.is_anonymous,
      is_verified: true, // System reports are verified
      source: 'system',
      system_reporter_name: report.system_reporter_name,
      external_review_id: report.external_review_id,
      external_review_date: report.external_review_date,
      // Use original review date as report creation time
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
// Main Ingestion Pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runIngestion(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           StayLive Hotel Data Ingestion Pipeline               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Validate configuration
  try {
    validateConfig();
    log('Configuration validated', 'success');
  } catch (error) {
    log(`${error}`, 'error');
    process.exit(1);
  }

  // Load system prompt from private config
  log('Loading AI prompt from config...');
  const systemPrompt = loadSystemPrompt();
  log('AI prompt loaded', 'success');

  const supabase = createSupabaseClient();
  let totalReviews = 0;
  let skippedReviews = 0;
  let successfulReports = 0;

  try {
    // Step 1: Fetch hotels from database (populated by fetch-hotels script)
    log('\n📍 Step 1: Loading hotels from database...');

    // Determine which hotels to process based on flags
    let dbHotels: DatabaseHotel[];

    if (useUnprocessedOnly) {
      // --unprocessed flag: only process hotels with no reports
      dbHotels = await fetchUnprocessedHotels(supabase, RANDOM_SAMPLE_COUNT);
      log(`🆕 Unprocessed mode: processing ${dbHotels.length} hotels with no existing reports`, 'info');
    } else if (useRandomSampling) {
      // --random flag: randomly sample from all hotels
      dbHotels = await fetchRandomHotels(supabase, RANDOM_SAMPLE_COUNT);
      log(`🎲 Random sampling mode: processing ${RANDOM_SAMPLE_COUNT} random hotels`, 'info');
    } else {
      // Default: process all hotels up to MAX_HOTELS
      dbHotels = await fetchHotelsFromDatabase(supabase);
    }

    if (dbHotels.length === 0) {
      log('No hotels found. Please run "npm run fetch-hotels" first.', 'error');
      process.exit(1);
    }

    // Step 2: Process each hotel - fetch Google reviews and process negatives
    log('\n🏨 Step 2: Fetching reviews and processing negatives...\n');

    for (let i = 0; i < dbHotels.length; i++) {
      const hotel = dbHotels[i];

      // Skip hotels without Google Place ID
      if (!hotel.google_place_id) {
        log(`[${i + 1}/${dbHotels.length}] Skipping ${hotel.name} (no Google Place ID)`);
        continue;
      }

      log(`\n[${i + 1}/${dbHotels.length}] Processing: ${hotel.name}`);

      // Rate limiting
      await sleep(CONFIG.API_DELAY_MS);

      // Fetch TripAdvisor Reviews
      log(`  └─ Searching TripAdvisor for hotel...`);

      // First, search for the hotel on TripAdvisor
      const tripAdvisorLocation = await searchHotelTripAdvisor(hotel.name);

      if (!tripAdvisorLocation) {
        log(`  └─ Hotel not found on TripAdvisor, trying Google Reviews...`, 'warn');
        // Fallback to Google Reviews
        const googleReviews = await fetchGoogleReviewsAll(hotel.google_place_id, hotel.name);
        if (googleReviews.length === 0) {
          log(`  └─ No reviews found`, 'info');
          continue;
        }
        const negativeGoogleReviews = googleReviews
          .filter(r => r.rating <= CONFIG.MAX_REVIEW_RATING)
          .filter(r => isReviewWithinDateLimit(r.publishDate));
        log(`  └─ Found ${googleReviews.length} Google reviews, ${negativeGoogleReviews.length} negative`);

        // Process Google reviews as fallback
        for (const review of negativeGoogleReviews) {
          totalReviews++;
          const exists = await checkExistingReport(supabase, review.id);
          if (exists) {
            log(`    └─ Review ${review.id} already processed, skipping`, 'info');
            skippedReviews++;
            continue;
          }
          const isAnonymous = shouldBeAnonymous();
          await sleep(CONFIG.API_DELAY_MS);
          log(`    └─ Transforming review with DeepSeek (${isAnonymous ? 'anonymous/1st person' : 'attributed/3rd person'})...`);
          const transformed = await transformReviewToSafetyInsight(review.text, hotel.name, systemPrompt, isAnonymous);
          const report: ProcessedReport = {
            hotel_name: hotel.name,
            issue_key: transformed.issueKey,
            severity: transformed.severity,
            description: transformed.insight,
            is_anonymous: isAnonymous,
            is_verified: true,
            source: 'system',
            system_reporter_name: isAnonymous ? null : CONFIG.SYSTEM_REPORTER_NAME,
            external_review_id: review.id,
            external_review_date: review.publishDate,
          };
          const success = await upsertReport(supabase, report);
          if (success) {
            successfulReports++;
            log(`    └─ Report saved: [${report.severity.toUpperCase()}] ${report.issue_key}`, 'success');
          }
        }
        continue;
      }

      // Fetch TripAdvisor reviews
      log(`  └─ Found on TripAdvisor: ${tripAdvisorLocation.name} (ID: ${tripAdvisorLocation.location_id})`);
      await sleep(CONFIG.API_DELAY_MS);

      const tripAdvisorReviews = await fetchTripAdvisorReviews(tripAdvisorLocation.location_id);

      if (tripAdvisorReviews.length === 0) {
        log(`  └─ No negative TripAdvisor reviews found`, 'info');
        continue;
      }

      // Convert to unified format
      const allReviews = convertTripAdvisorToUnified(tripAdvisorReviews);
      const negativeReviews = allReviews; // Already filtered in fetchTripAdvisorReviews

      log(`  └─ Found ${allReviews.length} negative TripAdvisor reviews (rating ≤ ${CONFIG.MAX_REVIEW_RATING})`);

      if (negativeReviews.length === 0) {
        log(`  └─ Skipping (all reviews are positive)`, 'info');
        continue;
      }

      // Step 3: Transform each negative review with DeepSeek
      for (const review of negativeReviews) {
        totalReviews++;

        // Check for existing report (deduplication)
        const exists = await checkExistingReport(supabase, review.id);
        if (exists) {
          log(`    └─ Review ${review.id} already processed, skipping`, 'info');
          skippedReviews++;
          continue;
        }

        // Determine anonymity BEFORE LLM call (affects perspective)
        const isAnonymous = shouldBeAnonymous();

        // Transform with LLM (perspective based on anonymity)
        await sleep(CONFIG.API_DELAY_MS);
        log(`    └─ Transforming review with DeepSeek (${isAnonymous ? 'anonymous/1st person' : 'attributed/3rd person'})...`);

        const transformed = await transformReviewToSafetyInsight(
          review.text,
          hotel.name,
          systemPrompt,
          isAnonymous
        );

        // Step 2d: Upsert to Supabase
        const report: ProcessedReport = {
          hotel_name: hotel.name,
          issue_key: transformed.issueKey,
          severity: transformed.severity,
          description: transformed.insight,
          is_anonymous: isAnonymous,
          is_verified: true,
          source: 'system',
          system_reporter_name: isAnonymous ? null : CONFIG.SYSTEM_REPORTER_NAME,
          external_review_id: review.id,
          external_review_date: review.publishDate,
        };

        const success = await upsertReport(supabase, report);

        if (success) {
          successfulReports++;
          log(
            `    └─ Report saved: [${report.severity.toUpperCase()}] ${report.issue_key}`,
            'success'
          );
        }
      }
    }

    // Summary
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    Ingestion Complete                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n  Hotels processed: ${dbHotels.length}`);
    console.log(`  Total reviews found: ${totalReviews}`);
    console.log(`  Skipped (duplicates): ${skippedReviews}`);
    console.log(`  Reports saved: ${successfulReports}`);
    console.log('\n');
  } catch (error) {
    log(`Fatal error: ${error}`, 'error');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

runIngestion();
