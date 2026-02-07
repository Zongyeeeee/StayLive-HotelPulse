# StayLive

**v3.7.0** | Real-time Hotel Pulse

[![Stars](https://img.shields.io/github/stars/Zongyeeeee/StayLive-HotelPulse?style=flat)](https://github.com/Zongyeeeee/StayLive-HotelPulse/stargazers)
[![Live](https://img.shields.io/badge/Live-stay--live.com-00D4FF?style=flat)](https://stay-live.com)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)

---

## What's New in v3.7.0

### Mobile Responsive Optimization
Full mobile-first responsive redesign for seamless experience across all devices:

- **Adaptive Navigation** — Collapsible nav bar with mobile-friendly controls
- **Responsive Dashboard** — Stats grid, live feed, and report cards adapt to screen size
- **Touch-Optimized Forms** — Larger tap targets, proper input sizing, and mobile keyboard support
- **Flexible Layouts** — CSS grid and flexbox adjustments for small screens

### Multi-Channel Authentication
Expanded login options beyond Google OAuth:

- **Email/Password Sign Up** — Register with any email, verified via 6-digit OTP code
- **Email/Password Sign In** — Direct login with email and password
- **OTP Email Verification** — Secure email confirmation during registration
- **Password Visibility Toggle** — Eye icon to show/hide password on sign-in page
- **Rate Limiting** — Max 3 OTP requests per email per 24 hours
- **Gmail Guard** — Gmail users redirected to Google OAuth for streamlined login
- **Duplicate Detection** — Prevents re-registration of already-registered emails

### Previous: v3.6.0 — SEO & Server-Side Optimization

#### SEO Optimization
Full search engine optimization for better discoverability:

- **Rich Metadata** — Open Graph, Twitter Cards, and keywords for social sharing and search results
- **Structured Data** — JSON-LD schema (WebApplication + TravelApplication) for Google rich results
- **Sitemap & Robots** — Auto-generated `sitemap.xml` and `robots.txt` for crawler guidance
- **Google Search Console** — Site verified and sitemap submitted for indexing

### Server-Side Data Loading
Dashboard and visitor pages refactored from client-side to server-side data processing:

- **Server-Side Stats** — Aggregated stats via Postgres RPC function (`get_report_stats`) instead of loading all reports into browser memory
- **Server-Side Search** — Database `ILIKE` queries with debounced input (300ms) replace client-side filtering
- **True Pagination** — Offset-based `.range()` queries for Load More, no full dataset preload
- **Reduced Memory** — Only displayed reports kept in state, not the entire dataset

### Report Rate Limiting & Moderation
Multi-layer submission protection to prevent abuse:

- **Daily Limit** — Max 10 reports per user per day
- **Cooldown System** — 5 attempts per 20-minute window, then cooldown
- **Failed Attempts Count** — All submission attempts (including rejected ones) count toward limits
- **Hybrid Tracking** — In-memory tracking for failed attempts + DB fallback for server restarts
- **Specific Error Messages** — Each moderation layer now shows its own error message to users

#### Previous: v3.5.0 — Flexible Membership Billing
- **Flexible Subscriptions** — Switch between weekly, monthly, and annual plans
- **Proportional usage Allocation** — Usages scale with billing period
- **Seamless Stripe Integration** — All billing periods use Stripe's recurring subscription system

#### Previous: v3.4.0 — Real Hotel Data & AI Styles
- **Realistic Issue Reports** — Power outages, WiFi problems, elevator maintenance, construction noise
- **AI Response Styles** — Concise, Balanced, and Creative modes for Jin AI

#### Previous: v3.3.0 — Stripe Payment Integration
Seamless subscription management with **Stripe Checkout** — upgrade your membership with secure, one-click payments.

- **Stripe Checkout Sessions** — Secure payment flow for Pro & Ultra plans
- **Webhook Integration** — Real-time subscription status updates
- **Automatic Token Reset** — Tokens reset to 0 when upgrading tiers
- **Smart Redirect Flow** — Pre-auth upgrade flow saves plan selection through OAuth

#### Previous: v3.2.0 — Jin AI Assistant
Meet **Jin** — your personal AI consultant for hotel insights, travel tips, and smart booking decisions. Powered by DeepSeek, Jin provides intelligent answers about hotels, travel planning, and helps you make informed choices.

- Conversational AI chat interface
- Persistent conversation history
- Editable chat titles (right-click to rename)
- Token quota system for fair usage
- Pro/Ultra membership tiers for unlimited access


---

## What is StayLive?

A crowdsourced hotel status platform where travelers share real-time updates about hotel issues — power outages, WiFi failures, construction noise, and more.

**Think "Waze for hotels."**

### The Problem

Hotels don't always inform guests about ongoing issues. Travelers discover problems only after check-in — leading to frustration and wasted bookings.

### The Solution

StayLive creates a transparent feedback loop where guests warn each other before booking.

---

## Core Features

### Jin AI Assistant
- **Intelligent Chat** — Ask Jin anything about hotels, travel tips, and booking advice
- **Conversation History** — All chats saved and organized by date
- **Editable Titles** — Right-click any chat to rename it
- **Title Truncation** — Long titles display with "..." for clean UI
- **Response Style** — Choose Concise, Balanced, or Creative response modes
- **Membership Tiers** — Free, Pro, and Ultra plans with weekly/monthly/annual billing

### Real-time Live Feed
- Instant hotel status updates from travelers worldwide
- Smart filtering by issue type and severity
- Search by hotel name or location
- Paginated feed with "Load More" for performance
- Expandable report details — click to view full description

### Authentication
- **Google OAuth** — One-click sign in via Supabase
- **Guest Mode** — Browse reports without login
- **Profile Management** — Customizable display names (max 15 characters, no spaces)

### Report System
- **11 Issue Categories**: Power, WiFi, Water, AC, Elevator, Noise, Construction, Pool, Restaurant, Cleaning, Other
- **Severity Levels**: Warning and Critical
- **Anonymous Option** — Privacy-first reporting
- **Guest Verification** — Verified guest badges
- **Detail Modal** — View full report with all information

### Theme System
| Theme | Description |
|-------|-------------|
| **Dark Mode** | Navy blue (#0A0F1E) with cyan/green glassmorphism |
| **Sunset Glow** | Warm cream (#F8F6F4) with terracotta accents |

Preference auto-saved to localStorage.

### Bilingual Support
- Full English/Chinese (中文) translation
- All UI elements, forms, and messages translated
- Language preference persisted

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5.5 |
| **UI** | React 18, Framer Motion |
| **Database** | Supabase PostgreSQL |
| **Auth** | Supabase Auth (Google OAuth + PKCE) |
| **Payments** | Stripe (Weekly/Monthly/Annual Subscriptions) |
| **Reviews API** | TripAdvisor Content API + Google Places |
| **Security** | Row Level Security (RLS) |
| **Styling** | CSS Variables + Glassmorphism |
| **Fonts** | Outfit (headlines) + Manrope (body) |

---

## Project Structure

```
StayLive-HotelPulse/
├── app/                        # Next.js App Router
│   ├── page.tsx                # Landing page
│   ├── login/page.tsx          # Login page
│   ├── dashboard/page.tsx      # Main dashboard (authenticated)
│   ├── visitor/page.tsx        # Guest dashboard
│   ├── aichat/page.tsx         # Jin AI Assistant
│   ├── auth/callback/page.tsx  # OAuth callback handler
│   ├── api/
│   │   ├── chat/route.ts       # AI chat endpoint
│   │   ├── checkout/route.ts   # Stripe Checkout session
│   │   ├── webhooks/stripe/    # Stripe webhook handler
│   │   ├── conversations/      # Conversation management
│   │   └── profile/update/     # Profile update endpoint
│   ├── layout.tsx              # Root layout with providers
│   └── globals.css             # Global styles + themes
│
├── components/                 # UI Components
│   ├── Navigation.tsx          # Top nav with auth/theme/language
│   ├── Logo.tsx                # Animated SVG logo
│   ├── Modal.tsx               # Reusable modal
│   ├── Footer.tsx              # Page footer
│   └── dashboard/
│       ├── LiveFeed.tsx        # Real-time report feed
│       ├── ReportCard.tsx      # Individual report display
│       ├── ReportForm.tsx      # Issue submission form
│       ├── ReportDetailModal.tsx # Full report view modal
│       └── StatsGrid.tsx       # Statistics cards
│
├── contexts/                   # React Context Providers
│   ├── AuthContext.tsx         # Auth state + Supabase session
│   ├── ThemeContext.tsx        # Dark/Light theme state
│   ├── LanguageContext.tsx     # i18n translations
│   └── index.tsx               # Combined AppProviders
│
├── lib/                        # Utilities
│   ├── supabase.ts             # Supabase client singleton
│   ├── stripe.ts               # Stripe client + tier mapping
│   ├── data-service.ts         # Data fetching + pagination
│   ├── translations.ts         # EN/CN translation strings
│   └── types.ts                # TypeScript definitions
│
├── scripts/                    # Data ingestion pipelines
    ├── fetch-hotels.ts         # Discover hotels via Google Places
    ├── ingest-hotel-data.ts    # Ingest reviews for all hotels
    └── ingest-top-hotels.ts    # Ingest reviews for top 10 hotels

```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Supabase project (free tier works)

### Installation

```bash
# Clone
git clone https://github.com/zongyeeeee/StayLive-HotelPulse.git
cd StayLive-HotelPulse

# Install dependencies
npm install
```

### Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

### Build for Production

```bash
npm run build
npm start
```

---

## Database Schema

### Tables

**profiles**
- `id` (uuid, FK to auth.users)
- `display_name` (text, max 15 chars, no spaces)
- `avatar_url` (text)
- `membership_status` (enum: free, pro, ultra)
- `tokens_used` (integer, default 0)
- `token_limit` (integer, auto-synced by tier)
- `membership_expires_at` (timestamp)
- `ai_response_style` (enum: concise, balanced, creative)
- `ai_context_window` (integer, conversation history limit)

**subscription_plans**
- `id` (uuid)
- `name` (text: free, pro, ultra)
- `price` (decimal)
- `token_quota` (integer)
- `features` (jsonb)

**reports**
- `id` (uuid)
- `user_id` (uuid, FK to profiles)
- `hotel_name` (text)
- `issue_type` (enum)
- `severity` (enum: warning, critical)
- `description` (text)
- `is_anonymous` (boolean)
- `created_at` (timestamp)

**conversations**
- `id` (uuid)
- `user_id` (uuid, FK to profiles)
- `title` (text, max 100 chars)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**chat_messages**
- `id` (uuid)
- `conversation_id` (uuid, FK to conversations)
- `role` (text: user, assistant)
- `content` (text)
- `created_at` (timestamp)

### Security
- Row Level Security enabled on all tables
- Anyone can read reports
- Only authenticated users can create reports
- Users can only access their own conversations
- Auto-profile creation on signup via database trigger

---

## Usage Guide

### Chat with Jin AI

1. Sign in with Google
2. Click the "Ask Jin" button on the dashboard
3. Type your question about hotels or travel
4. Jin responds with helpful insights
5. Your conversation is automatically saved
6. Right-click any chat title to rename it

### Submit a Report

1. Sign in with Google (or continue as guest to browse only)
2. Click the report form
3. Enter hotel name
4. Select issue type and severity
5. Write a description
6. Toggle "Submit Anonymously" if desired
7. Submit

Reports appear instantly in the live feed.

### View Report Details

Click on any report card to open the full detail modal with complete information.

### Switch Theme

Click the sun/moon icon in the navigation bar.

### Switch Language

Click **中文** or **EN** in the navigation bar.

### Edit Profile

1. Sign in
2. Click the pencil icon next to your name
3. Enter new display name (max 15 characters, no spaces)
4. Save

---

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npx tsx scripts/fetch-hotels.ts` | Discover Melbourne hotels via Google Places |
| `npx tsx scripts/ingest-hotel-data.ts` | Ingest reviews for all hotels |
| `npx tsx scripts/ingest-top-hotels.ts` | Ingest reviews for top 10 hotels |

### Code Style
- TypeScript strict mode
- ESLint with Next.js config
- Component-based architecture
- Context API for global state

---

## Author

**Zongye Lyu**

[LinkedIn](https://linkedin.com/in/zongye-lyu) · [GitHub](https://github.com/zongyeeeee) · lyuzongye@gmail.com

---

### Contact for Licensing

For commercial licensing inquiries, partnerships, or permissions, please contact:

**Zongye Lyu** — lyuzongye@gmail.com

Unauthorized use of this project may result in legal action.

---

<div align="center">

**Built in Melbourne, Australia**

[Live Demo](https://stay-live.com) · [Report Bug](https://github.com/zongyeeeee/StayLive-HotelPulse/issues) · [Request Feature](https://github.com/zongyeeeee/StayLive-HotelPulse/issues)

</div>
