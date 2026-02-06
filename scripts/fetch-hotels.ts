/**
 * StayLive Hotel Discovery Script
 *
 * Fetches hotels from Melbourne area via Google Places API (New)
 * and saves basic info (ID, name, coordinates) to the hotels table.
 *
 * Usage:
 *   npx tsx scripts/fetch-hotels.ts
 *
 * Or via npm:
 *   npm run fetch-hotels
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Search Parameters
  TARGET_HOTEL_COUNT: 500,
  MAX_RESULTS_PER_REQUEST: 20,
  SEARCH_RADIUS: 5000, // meters

  // Rate Limiting
  API_DELAY_MS: 300,
};

// Melbourne search locations (CBD + major suburbs)
// Spread out to cover different areas and get unique hotels
const MELBOURNE_SEARCH_LOCATIONS = [
  // CBD & Inner City
  { name: 'Melbourne CBD', lat: -37.8136, lng: 144.9631 },
  { name: 'Southbank', lat: -37.8226, lng: 144.9580 },
  { name: 'Docklands', lat: -37.8145, lng: 144.9395 },
  { name: 'Carlton', lat: -37.7963, lng: 144.9687 },
  { name: 'Fitzroy', lat: -37.7989, lng: 144.9784 },
  { name: 'Collingwood', lat: -37.8020, lng: 144.9878 },
  { name: 'Richmond', lat: -37.8181, lng: 144.9983 },
  { name: 'South Yarra', lat: -37.8380, lng: 144.9930 },
  { name: 'Prahran', lat: -37.8500, lng: 144.9920 },
  { name: 'St Kilda', lat: -37.8598, lng: 144.9794 },

  // Inner Suburbs
  { name: 'North Melbourne', lat: -37.7990, lng: 144.9420 },
  { name: 'West Melbourne', lat: -37.8080, lng: 144.9350 },
  { name: 'East Melbourne', lat: -37.8130, lng: 144.9870 },
  { name: 'Parkville', lat: -37.7850, lng: 144.9520 },
  { name: 'Brunswick', lat: -37.7670, lng: 144.9600 },
  { name: 'Northcote', lat: -37.7700, lng: 145.0020 },
  { name: 'Hawthorn', lat: -37.8230, lng: 145.0340 },
  { name: 'Kew', lat: -37.8050, lng: 145.0350 },
  { name: 'Camberwell', lat: -37.8260, lng: 145.0570 },
  { name: 'Malvern', lat: -37.8630, lng: 145.0290 },

  // Middle Suburbs
  { name: 'Brighton', lat: -37.9050, lng: 145.0010 },
  { name: 'Caulfield', lat: -37.8780, lng: 145.0230 },
  { name: 'Glen Waverley', lat: -37.8780, lng: 145.1650 },
  { name: 'Box Hill', lat: -37.8190, lng: 145.1220 },
  { name: 'Doncaster', lat: -37.7850, lng: 145.1260 },
  { name: 'Heidelberg', lat: -37.7560, lng: 145.0670 },
  { name: 'Preston', lat: -37.7440, lng: 145.0130 },
  { name: 'Coburg', lat: -37.7430, lng: 144.9640 },
  { name: 'Essendon', lat: -37.7510, lng: 144.9170 },
  { name: 'Moonee Ponds', lat: -37.7650, lng: 144.9210 },

  // Outer Areas & Airport
  { name: 'Tullamarine (Airport)', lat: -37.6690, lng: 144.8410 },
  { name: 'Footscray', lat: -37.8000, lng: 144.9000 },
  { name: 'Williamstown', lat: -37.8570, lng: 144.8980 },
  { name: 'Port Melbourne', lat: -37.8370, lng: 144.9370 },
  { name: 'Albert Park', lat: -37.8420, lng: 144.9570 },
  { name: 'South Melbourne', lat: -37.8320, lng: 144.9570 },
  { name: 'Toorak', lat: -37.8410, lng: 145.0150 },
  { name: 'Armadale', lat: -37.8550, lng: 145.0180 },
  { name: 'Clayton', lat: -37.9150, lng: 145.1200 },
  { name: 'Dandenong', lat: -37.9870, lng: 145.2150 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GooglePlaceNew {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  rating?: number;
  userRatingCount?: number;
}

interface HotelRecord {
  google_place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_rating: number | null;
  google_reviews_count: number | null;
}

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
  const required = ['GOOGLE_MAPS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missing = required.filter(key => !CONFIG[key as keyof typeof CONFIG]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places API (New)
// ─────────────────────────────────────────────────────────────────────────────

async function searchHotelsAtLocation(
  lat: number,
  lng: number,
  locationName: string
): Promise<GooglePlaceNew[]> {
  const placesUrl = 'https://places.googleapis.com/v1/places:searchNearby';

  const requestBody = {
    includedTypes: ['lodging', 'hotel'],
    maxResultCount: CONFIG.MAX_RESULTS_PER_REQUEST,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: CONFIG.SEARCH_RADIUS,
      },
    },
  };

  try {
    const response = await fetch(placesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.error) {
      log(`API error at ${locationName}: ${data.error.message}`, 'error');
      return [];
    }

    return data.places || [];
  } catch (error) {
    log(`Fetch error at ${locationName}: ${error}`, 'error');
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Operations
// ─────────────────────────────────────────────────────────────────────────────

function createSupabaseClient(): SupabaseClient {
  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);
}

async function upsertHotel(supabase: SupabaseClient, hotel: HotelRecord): Promise<boolean> {
  try {
    const { error } = await supabase.from('hotels').upsert(
      {
        google_place_id: hotel.google_place_id,
        name: hotel.name,
        address: hotel.address,
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        google_rating: hotel.google_rating,
        google_reviews_count: hotel.google_reviews_count,
      },
      {
        onConflict: 'google_place_id',
      }
    );

    if (error) {
      // If google_place_id conflict fails, try name conflict
      if (error.code === '23505') {
        const { error: nameError } = await supabase.from('hotels').upsert(
          {
            google_place_id: hotel.google_place_id,
            name: hotel.name,
            address: hotel.address,
            latitude: hotel.latitude,
            longitude: hotel.longitude,
            google_rating: hotel.google_rating,
            google_reviews_count: hotel.google_reviews_count,
          },
          {
            onConflict: 'name',
          }
        );
        if (nameError) {
          log(`Upsert failed for ${hotel.name}: ${nameError.message}`, 'warn');
          return false;
        }
      } else {
        log(`Upsert failed for ${hotel.name}: ${error.message}`, 'warn');
        return false;
      }
    }

    return true;
  } catch (error) {
    log(`Database error for ${hotel.name}: ${error}`, 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Existing Hotels
// ─────────────────────────────────────────────────────────────────────────────

async function fetchExistingHotelIds(supabase: SupabaseClient): Promise<Set<string>> {
  const existingIds = new Set<string>();

  try {
    const { data, error } = await supabase
      .from('hotels')
      .select('google_place_id, name');

    if (error) {
      log(`Error fetching existing hotels: ${error.message}`, 'error');
      return existingIds;
    }

    for (const hotel of data || []) {
      if (hotel.google_place_id) {
        existingIds.add(hotel.google_place_id);
      }
    }

    log(`Found ${existingIds.size} existing hotels in database`, 'info');
  } catch (error) {
    log(`Error fetching existing hotels: ${error}`, 'error');
  }

  return existingIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runHotelDiscovery(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           StayLive Hotel Discovery Pipeline                    ║');
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

  const supabase = createSupabaseClient();
  const discoveredHotels = new Map<string, HotelRecord>();

  // Fetch existing hotels to avoid duplicates
  log('\n📋 Checking existing hotels in database...');
  const existingHotelIds = await fetchExistingHotelIds(supabase);

  log(`\n🏨 Searching for hotels across ${MELBOURNE_SEARCH_LOCATIONS.length} Melbourne locations...\n`);

  // Search each location
  for (let i = 0; i < MELBOURNE_SEARCH_LOCATIONS.length; i++) {
    const location = MELBOURNE_SEARCH_LOCATIONS[i];

    // Stop if we have enough hotels
    if (discoveredHotels.size >= CONFIG.TARGET_HOTEL_COUNT) {
      log(`\n✓ Reached target of ${CONFIG.TARGET_HOTEL_COUNT} hotels`, 'success');
      break;
    }

    log(`[${i + 1}/${MELBOURNE_SEARCH_LOCATIONS.length}] Searching: ${location.name}...`);

    await sleep(CONFIG.API_DELAY_MS);

    const places = await searchHotelsAtLocation(location.lat, location.lng, location.name);

    let newCount = 0;
    let skippedCount = 0;
    for (const place of places) {
      // Skip if already in database
      if (existingHotelIds.has(place.id)) {
        skippedCount++;
        continue;
      }
      // Skip if already discovered in this run
      if (!discoveredHotels.has(place.id)) {
        discoveredHotels.set(place.id, {
          google_place_id: place.id,
          name: place.displayName?.text || 'Unknown Hotel',
          address: place.formattedAddress || null,
          latitude: place.location?.latitude || null,
          longitude: place.location?.longitude || null,
          google_rating: place.rating || null,
          google_reviews_count: place.userRatingCount || null,
        });
        newCount++;
      }
    }

    log(`  └─ Found ${places.length} hotels, ${newCount} new, ${skippedCount} already in DB (Total new: ${discoveredHotels.size})`);
  }

  if (discoveredHotels.size === 0) {
    log('\n✓ No new hotels to add - all discovered hotels already exist in database', 'success');
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    Discovery Complete                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n  Locations searched: ${MELBOURNE_SEARCH_LOCATIONS.length}`);
    console.log(`  Existing hotels in DB: ${existingHotelIds.size}`);
    console.log(`  New hotels found: 0`);
    console.log('\n');
    return;
  }

  log(`\n📥 Saving ${discoveredHotels.size} NEW hotels to database...\n`);

  // Save to database
  let savedCount = 0;
  let index = 0;

  for (const hotel of discoveredHotels.values()) {
    index++;
    const success = await upsertHotel(supabase, hotel);
    if (success) {
      savedCount++;
    }

    // Progress log every 50 hotels
    if (index % 50 === 0) {
      log(`Progress: ${index}/${discoveredHotels.size} processed, ${savedCount} saved`);
    }
  }

  // Summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    Discovery Complete                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Locations searched: ${MELBOURNE_SEARCH_LOCATIONS.length}`);
  console.log(`  Existing hotels in DB: ${existingHotelIds.size}`);
  console.log(`  New hotels found: ${discoveredHotels.size}`);
  console.log(`  New hotels saved: ${savedCount}`);
  console.log(`  Total hotels now: ${existingHotelIds.size + savedCount}`);
  console.log('\n');
}

// Run the script
runHotelDiscovery().catch(error => {
  log(`Fatal error: ${error}`, 'error');
  process.exit(1);
});
