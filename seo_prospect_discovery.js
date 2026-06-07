'use strict';

/**
 * seo_prospect_discovery.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Curated prospect database: 82 sites not already in seo_outreach_tracker.csv.
 * Covers travel blogs, tourism directories, startup communities, universities,
 * and niche media across 9 subcategories.
 *
 * Each prospect has scoring metadata used by seo_prospect_scorer.js:
 *   relevance    — direct | strong | moderate | tangential
 *   traffic_tier — high | medium | low_medium | low
 *   link_likelihood — high | medium | low
 *
 * Usage (CLI):
 *   node seo_prospect_discovery.js                  → full list
 *   node seo_prospect_discovery.js --category=golf  → filter by category/subcategory
 *   node seo_prospect_discovery.js --merge          → merge with tracker CSV
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Prospect Database ─────────────────────────────────────────────────────────

const PROSPECT_DATABASE = [

  // ── TRAVEL BLOGS — LUXURY ──────────────────────────────────────────────────
  {
    id: 'D001', site_name: 'AFAR Magazine', domain: 'afar.com', da_estimate: 75,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: 'editorial@afar.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Modern experiential travel authority; pitch a "hidden gem" Mauritius narrative',
  },
  {
    id: 'D002', site_name: 'Departures Magazine', domain: 'departures.com', da_estimate: 68,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: 'editorial@departures.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'AmEx Centurion card companion; ultra-luxury readership — pitch overwater villas angle',
  },
  {
    id: 'D003', site_name: 'Luxury Travel Advisor', domain: 'luxurytraveladvisor.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: 'editor@luxurytraveladvisor.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Trade magazine for luxury travel agents; our methodology as third-party ranking tool',
  },
  {
    id: 'D004', site_name: 'Andrew Harper Travel', domain: 'andrewharper.com', da_estimate: 45,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Members-only ultra-luxury travel club; resource link to independent rankings',
  },
  {
    id: 'D005', site_name: 'Virtuoso Traveler', domain: 'virtuoso.com', da_estimate: 70,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Global luxury travel network; editorial link to independent hotel rankings',
  },
  {
    id: 'D006', site_name: 'Quintessentially Travel', domain: 'quintessentially.com', da_estimate: 60,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: 'travel@quintessentially.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'strong',
    notes: 'Concierge lifestyle brand; Mauritius is core Indian Ocean destination for their clients',
  },
  {
    id: 'D007', site_name: "National Geographic Travel", domain: 'nationalgeographic.com', da_estimate: 94,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Highest-DA target; long-shot but metric rankings could be cited as data source',
  },
  {
    id: 'D008', site_name: 'Vogue Travel', domain: 'vogue.com', da_estimate: 91,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Fashion luxury crossover; adults-only honeymoon resort list fits editorial',
  },
  {
    id: 'D009', site_name: "Fodor's Travel", domain: 'fodors.com', da_estimate: 80,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: 'editorial@fodors.com', contact_name: '',
    outreach_type: 'broken_link', target_page: '/methodology',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Check Mauritius hotel pages for broken outbound links; methodology resource pitch',
  },
  {
    id: 'D010', site_name: 'Travel Channel', domain: 'travelchannel.com', da_estimate: 82,
    category: 'travel_blog', subcategory: 'luxury',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Mass-market luxury travel TV brand; pitch rankings as editorial data resource',
  },

  // ── TRAVEL BLOGS — HONEYMOON ───────────────────────────────────────────────
  {
    id: 'D011', site_name: 'Brides Magazine', domain: 'brides.com', da_estimate: 79,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'editorial@brides.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Dedicated honeymoon section; pitch "Best Mauritius Honeymoon Resorts" as expert guide',
  },
  {
    id: 'D012', site_name: 'Junebug Weddings', domain: 'junebugweddings.com', da_estimate: 68,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'hello@junebugweddings.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Active contributor programme; destination wedding + honeymoon resort angle',
  },
  {
    id: 'D013', site_name: 'Green Wedding Shoes', domain: 'greenweddingshoes.com', da_estimate: 65,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'jasmine@greenweddingshoes.com', contact_name: 'Jasmine',
    outreach_type: 'guest_post', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Eco-chic wedding brand; Mauritius sustainability + luxury narrative fits perfectly',
  },
  {
    id: 'D014', site_name: 'Destination Wedding Details', domain: 'destinationweddingdetails.com', da_estimate: 45,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'editor@destinationweddingdetails.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'direct',
    notes: 'Niche destination wedding site; strong Mauritius angle with overwater villa resorts',
  },
  {
    id: 'D015', site_name: 'Honeyfund Blog', domain: 'honeyfund.com', da_estimate: 55,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'blog@honeyfund.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'direct',
    notes: 'Honeymoon registry platform; resource link to Mauritius resort list for registry givers',
  },
  {
    id: 'D016', site_name: 'Martha Stewart Weddings', domain: 'marthastewart.com', da_estimate: 85,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Massive DA; pitch Mauritius as a "best honeymoon destination" resource for editors',
  },
  {
    id: 'D017', site_name: 'One Honeymoon', domain: 'onehoneymoon.com', da_estimate: 35,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: 'hello@onehoneymoon.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'direct',
    notes: 'Niche honeymoon travel blog; low DA but highly targeted audience and responsive',
  },
  {
    id: 'D018', site_name: 'Cosmopolitan Travel', domain: 'cosmopolitan.com', da_estimate: 88,
    category: 'travel_blog', subcategory: 'honeymoon',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/adults-only-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Mass-market womens magazine; honeymoon destinations roundup reference pitch',
  },

  // ── TRAVEL BLOGS — AFRICA / INDIAN OCEAN ──────────────────────────────────
  {
    id: 'D019', site_name: 'Getaway Magazine', domain: 'getaway.co.za', da_estimate: 45,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'editor@getaway.co.za', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'South African travel magazine; Mauritius is a top holiday for SA market',
  },
  {
    id: 'D020', site_name: 'Africa Geographic', domain: 'africageographic.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'editorial@africageographic.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Premium Africa nature + travel; pitch Mauritius marine ecosystem + luxury angle',
  },
  {
    id: 'D021', site_name: 'African Travel Resource', domain: 'africantravelresource.com', da_estimate: 42,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'info@africantravelresource.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Africa travel portal with resource pages; hotel rankings as editorial reference',
  },
  {
    id: 'D022', site_name: 'Beneath African Skies', domain: 'beneathafricanskies.com', da_estimate: 38,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'hello@beneathafricanskies.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'strong',
    notes: 'Luxury Africa travel blog; lower DA but active and accepts quality contributions',
  },
  {
    id: 'D023', site_name: 'Le Figaro Voyage', domain: 'voyage.lefigaro.fr', da_estimate: 68,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'strong',
    notes: 'French market — Mauritius is historically a premier French holiday destination',
  },
  {
    id: 'D024', site_name: 'Air Mauritius Travel Blog', domain: 'airmauritius.com', da_estimate: 48,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'marketing@airmauritius.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'direct',
    notes: 'National airline blog; independent hotel rankings as value-add for travellers',
  },
  {
    id: 'D025', site_name: 'Island Travel', domain: 'islandtravel.co.uk', da_estimate: 38,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'info@islandtravel.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'direct',
    notes: 'UK island holiday specialist; Mauritius is a primary destination for them',
  },
  {
    id: 'D026', site_name: 'Indian Ocean Holidays', domain: 'indianoceanholidays.co.uk', da_estimate: 35,
    category: 'travel_blog', subcategory: 'africa',
    contact_email: 'info@indianoceanholidays.co.uk', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'direct',
    notes: 'Boutique Indian Ocean specialist; our rankings as editorial resource for clients',
  },

  // ── TRAVEL BLOGS — FAMILY ──────────────────────────────────────────────────
  {
    id: 'D027', site_name: 'Family Traveller', domain: 'familytraveller.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'family',
    contact_email: 'editorial@familytraveller.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/family-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'UK family travel magazine; pitch "Best Mauritius Family Resorts" expert guide',
  },
  {
    id: 'D028', site_name: 'Tots Too Travel', domain: 'totstoo.com', da_estimate: 38,
    category: 'travel_blog', subcategory: 'family',
    contact_email: 'hello@totstoo.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/family-resorts-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'moderate',
    notes: 'Toddler travel blog; Mauritius resorts with kids clubs and shallow beaches',
  },
  {
    id: 'D029', site_name: 'Family Travel Forum', domain: 'familytravelforum.com', da_estimate: 48,
    category: 'travel_blog', subcategory: 'family',
    contact_email: 'editor@familytravelforum.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/family-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'moderate',
    notes: 'UK family travel community; resource section links to destination resort guides',
  },
  {
    id: 'D030', site_name: 'Family Vacation Critic', domain: 'familyvacationcritic.com', da_estimate: 58,
    category: 'travel_blog', subcategory: 'family',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/family-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'TripAdvisor family travel property; pitch family resort rankings as research tool',
  },
  {
    id: 'D031', site_name: 'We Are Family Traveller', domain: 'wearefamilytraveller.com', da_estimate: 45,
    category: 'travel_blog', subcategory: 'family',
    contact_email: 'info@wearefamilytraveller.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/family-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'moderate',
    notes: 'Family travel blog with active contributor section; Mauritius family package angle',
  },
  {
    id: 'D032', site_name: 'The Travelling Mom', domain: 'thetravellingmom.ca', da_estimate: 40,
    category: 'travel_blog', subcategory: 'family',
    contact_email: 'sue@thetravellingmom.ca', contact_name: 'Sue',
    outreach_type: 'guest_post', target_page: '/family-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'moderate',
    notes: 'Canadian family travel blog; pitch Mauritius as ultimate family beach holiday',
  },

  // ── TRAVEL BLOGS — WELLNESS ────────────────────────────────────────────────
  {
    id: 'D033', site_name: 'Spafinder', domain: 'spafinder.com', da_estimate: 62,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'editorial@spafinder.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Global spa discovery platform; wellness resort rankings as resource for searches',
  },
  {
    id: 'D034', site_name: 'Healing Hotels of the World', domain: 'healinghotels.de', da_estimate: 45,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'info@healinghotels.de', contact_name: '',
    outreach_type: 'resource_link', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Curated wellness hotel network; independent rankings complement their directory',
  },
  {
    id: 'D035', site_name: 'Wellness Tourism Association', domain: 'wellnesstourism.org', da_estimate: 44,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'info@wellnesstourism.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Trade body for wellness tourism; independent resort data as research reference',
  },
  {
    id: 'D036', site_name: 'The Wellness Traveller', domain: 'thewellnesstraveller.co.uk', da_estimate: 38,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'hello@thewellnesstraveller.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'strong',
    notes: 'UK wellness travel blog; pitch Mauritius as premier Indian Ocean wellness destination',
  },
  {
    id: 'D037', site_name: 'Balance Magazine', domain: 'balancemagazine.co.uk', da_estimate: 48,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'editor@balancemagazine.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'UK wellness lifestyle magazine with travel section; spa resort retreat angle',
  },
  {
    id: 'D038', site_name: 'Spa Business Magazine', domain: 'spabusiness.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'wellness',
    contact_email: 'editorial@spabusiness.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/wellness-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'B2B spa industry; independent resort ratings as credibility reference for operators',
  },

  // ── NICHE MEDIA — GOLF ─────────────────────────────────────────────────────
  {
    id: 'D039', site_name: 'Golf Digest', domain: 'golfdigest.com', da_estimate: 82,
    category: 'niche_media', subcategory: 'golf',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/golf-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'strong',
    notes: 'Top golf authority; pitch our Mauritius golf resort guide as editorial resource',
  },
  {
    id: 'D040', site_name: 'Golf.com', domain: 'golf.com', da_estimate: 78,
    category: 'niche_media', subcategory: 'golf',
    contact_email: 'editorial@golf.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/golf-resorts-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Golf Magazine digital; travel section covers golf resort destinations worldwide',
  },
  {
    id: 'D041', site_name: 'Golf Around The World', domain: 'golfaroundtheworld.com', da_estimate: 42,
    category: 'niche_media', subcategory: 'golf',
    contact_email: 'info@golfaroundtheworld.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/golf-resorts-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'direct',
    notes: 'Golf travel specialist; Mauritius golf guide guest post with course reviews',
  },
  {
    id: 'D042', site_name: "Today's Golfer", domain: 'todaysgolfer.co.uk', da_estimate: 52,
    category: 'niche_media', subcategory: 'golf',
    contact_email: 'editor@todaysgolfer.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/golf-resorts-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'UK golf magazine with golf travel section; pitch Mauritius golf holiday guide',
  },
  {
    id: 'D043', site_name: 'Golf Travel Guru', domain: 'golftravelguru.com', da_estimate: 38,
    category: 'niche_media', subcategory: 'golf',
    contact_email: 'hello@golftravelguru.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/golf-resorts-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'direct',
    notes: 'Golf travel niche blog; lower DA but highly targeted and responsive to pitches',
  },

  // ── NICHE MEDIA — DIVING / WATER SPORTS ───────────────────────────────────
  {
    id: 'D044', site_name: 'Scuba Diving Magazine', domain: 'scubadiving.com', da_estimate: 65,
    category: 'niche_media', subcategory: 'diving',
    contact_email: 'editorial@scubadiving.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Top diving authority; Mauritius has world-class dive sites — resort guide as resource',
  },
  {
    id: 'D045', site_name: 'PADI Travel', domain: 'travel.padi.com', da_estimate: 72,
    category: 'niche_media', subcategory: 'diving',
    contact_email: 'travel@padi.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: "World's largest dive training org; pitch resort guide as accommodation reference",
  },
  {
    id: 'D046', site_name: 'Dive Magazine', domain: 'divemagazine.co.uk', da_estimate: 52,
    category: 'niche_media', subcategory: 'diving',
    contact_email: 'editor@divemagazine.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'UK dive magazine; pitch "Mauritius: Best Resorts for Divers" expert guide',
  },
  {
    id: 'D047', site_name: 'Undercurrent', domain: 'undercurrent.org', da_estimate: 48,
    category: 'niche_media', subcategory: 'diving',
    contact_email: 'editor@undercurrent.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Consumer dive reviews; hotel data as supplementary accommodation resource',
  },
  {
    id: 'D048', site_name: 'Sport Diver', domain: 'sportdiver.com', da_estimate: 60,
    category: 'niche_media', subcategory: 'diving',
    contact_email: 'editorial@sportdiver.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'PADI-adjacent dive travel magazine; resort guide as destination planning resource',
  },

  // ── NICHE MEDIA — GENERAL ──────────────────────────────────────────────────
  {
    id: 'D049', site_name: 'Atlas Obscura', domain: 'atlasobscura.com', da_estimate: 82,
    category: 'niche_media', subcategory: 'general',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Unique places discovery platform; Mauritius natural wonders + resort guide angle',
  },
  {
    id: 'D050', site_name: 'Responsible Travel', domain: 'responsibletravel.com', da_estimate: 62,
    category: 'niche_media', subcategory: 'general',
    contact_email: 'info@responsibletravel.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Ethical/eco travel platform; our sustainability ratings angle fits their editorial',
  },
  {
    id: 'D051', site_name: 'Sustainable Travel International', domain: 'sustainabletravel.org', da_estimate: 48,
    category: 'niche_media', subcategory: 'general',
    contact_email: 'hello@sustainabletravel.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'NGO promoting sustainable tourism; methodology resource if our ratings factor eco-scores',
  },
  {
    id: 'D052', site_name: 'Incentive Travel Magazine', domain: 'incentivetravel.co.uk', da_estimate: 48,
    category: 'niche_media', subcategory: 'general',
    contact_email: 'editor@incentivetravel.co.uk', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'moderate',
    notes: 'Corporate incentive travel B2B; Mauritius is top incentive destination in region',
  },

  // ── TOURISM DIRECTORIES ────────────────────────────────────────────────────
  {
    id: 'D053', site_name: 'UNWTO', domain: 'unwto.org', da_estimate: 72,
    category: 'tourism_directory', subcategory: 'global',
    contact_email: 'omt@unwto.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'moderate',
    notes: 'UN tourism body; methodology as third-party research tool — long-shot but high DA',
  },
  {
    id: 'D054', site_name: 'World Travel & Tourism Council', domain: 'wttc.org', da_estimate: 70,
    category: 'tourism_directory', subcategory: 'global',
    contact_email: 'info@wttc.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Global tourism industry body; independent hotel scoring as research reference',
  },
  {
    id: 'D055', site_name: 'African Tourism Board', domain: 'africantourismboard.com', da_estimate: 38,
    category: 'tourism_directory', subcategory: 'regional',
    contact_email: 'info@africantourismboard.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Africa tourism advocacy body; independent Mauritius rankings as editorial reference',
  },
  {
    id: 'D056', site_name: 'Indian Ocean Tourism', domain: 'indian-ocean-tourism.com', da_estimate: 35,
    category: 'tourism_directory', subcategory: 'regional',
    contact_email: 'contact@indian-ocean-tourism.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'direct',
    notes: 'Indian Ocean destination directory; Mauritius resort guide highly complementary',
  },
  {
    id: 'D057', site_name: 'Commonwealth Tourism Centre', domain: 'commonwealthtourism.com', da_estimate: 45,
    category: 'tourism_directory', subcategory: 'regional',
    contact_email: 'info@commonwealthtourism.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Commonwealth member states tourism network; Mauritius is active Commonwealth member',
  },
  {
    id: 'D058', site_name: 'Hotel Investment Today', domain: 'hotelinvestmenttoday.com', da_estimate: 48,
    category: 'tourism_directory', subcategory: 'industry',
    contact_email: 'editor@hotelinvestmenttoday.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Hotel industry trade press; methodology and scoring data angle for B2B audience',
  },
  {
    id: 'D059', site_name: 'Tourism Intelligence', domain: 'tourismintelligence.com', da_estimate: 45,
    category: 'tourism_directory', subcategory: 'industry',
    contact_email: 'info@tourismintelligence.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Tourism data and reports platform; our independent ranking methodology as reference',
  },
  {
    id: 'D060', site_name: 'Green Globe', domain: 'greenglobe.com', da_estimate: 42,
    category: 'tourism_directory', subcategory: 'industry',
    contact_email: 'info@greenglobe.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Sustainable tourism certification body; eco-score methodology angle',
  },
  {
    id: 'D061', site_name: 'Island Tourism Organisation', domain: 'islandtourism.org', da_estimate: 38,
    category: 'tourism_directory', subcategory: 'regional',
    contact_email: 'info@islandtourism.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low', link_likelihood: 'high', relevance: 'direct',
    notes: 'Island destination advocacy network; Mauritius resort data as member resource',
  },
  {
    id: 'D062', site_name: 'PATA', domain: 'pata.org', da_estimate: 55,
    category: 'tourism_directory', subcategory: 'regional',
    contact_email: 'info@pata.org', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Pacific Asia Travel Association; methodology reference for regional tourism data',
  },

  // ── STARTUP / TECH COMMUNITIES ─────────────────────────────────────────────
  {
    id: 'D063', site_name: 'Product Hunt', domain: 'producthunt.com', da_estimate: 89,
    category: 'startup_community', subcategory: 'tech',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'high', relevance: 'tangential',
    notes: 'List the tool on PH — upvotes create backlinks from discussions and shares',
  },
  {
    id: 'D064', site_name: 'Indie Hackers', domain: 'indiehackers.com', da_estimate: 75,
    category: 'startup_community', subcategory: 'tech',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'high', relevance: 'tangential',
    notes: 'Post a project showcase — IH threads and milestones generate dofollow backlinks',
  },
  {
    id: 'D065', site_name: 'Hacker News', domain: 'news.ycombinator.com', da_estimate: 91,
    category: 'startup_community', subcategory: 'tech',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'tangential',
    notes: 'Show HN post of the ranking methodology — technical readership appreciates data-driven tools',
  },
  {
    id: 'D066', site_name: 'TechCrunch', domain: 'techcrunch.com', da_estimate: 92,
    category: 'startup_community', subcategory: 'tech',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'tangential',
    notes: 'Long-shot — pitch travel tech angle if we can frame as algorithmic hotel finder startup',
  },
  {
    id: 'D067', site_name: 'Sifted', domain: 'sifted.eu', da_estimate: 62,
    category: 'startup_community', subcategory: 'tech',
    contact_email: 'news@sifted.eu', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'tangential',
    notes: 'European startup media; travel-tech angle with persona-based hotel matching',
  },

  // ── UNIVERSITY / RESEARCH ──────────────────────────────────────────────────
  {
    id: 'D068', site_name: 'Tourism Geographies Journal', domain: 'tandfonline.com', da_estimate: 78,
    category: 'university', subcategory: 'research',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Academic journal; methodology page as cited resource in tourism research papers',
  },
  {
    id: 'D069', site_name: 'Journal of Sustainable Tourism', domain: 'jstor.org', da_estimate: 88,
    category: 'university', subcategory: 'research',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'high', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Top academic tourism journal; methodology could be cited if eco-scores are included',
  },
  {
    id: 'D070', site_name: 'Island Studies Journal', domain: 'islandstudies.ca', da_estimate: 55,
    category: 'university', subcategory: 'research',
    contact_email: 'editor@islandstudies.ca', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Academic journal on island geography + tourism; Mauritius is a key case study island',
  },
  {
    id: 'D071', site_name: 'University of Mauritius', domain: 'uom.ac.mu', da_estimate: 45,
    category: 'university', subcategory: 'research',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'direct',
    notes: "Local university with tourism faculty; independent resort data cited in student projects",
  },
  {
    id: 'D072', site_name: 'Griffith University Tourism', domain: 'griffith.edu.au', da_estimate: 72,
    category: 'university', subcategory: 'research',
    contact_email: '', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'medium', link_likelihood: 'low', relevance: 'moderate',
    notes: 'Top-ranked tourism research university; methodology reference for Indian Ocean research',
  },
  {
    id: 'D073', site_name: 'Tourism Review International', domain: 'cognizantcommunication.com', da_estimate: 42,
    category: 'university', subcategory: 'research',
    contact_email: 'editor@cognizantcommunication.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Academic tourism review journal; methodology and scoring data as citeable resource',
  },
  {
    id: 'D074', site_name: 'Caribbean Tourism Blog', domain: 'caribbeantourism.com', da_estimate: 48,
    category: 'university', subcategory: 'research',
    contact_email: 'info@caribbeantourism.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/methodology',
    traffic_tier: 'low_medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Regional tourism authority blog; parallel island destination — methodology reference',
  },

  // ── TRAVEL BLOGS — ADVENTURE / GENERAL ────────────────────────────────────
  {
    id: 'D075', site_name: 'World Nomads Blog', domain: 'worldnomads.com', da_estimate: 72,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'editorial@worldnomads.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Travel insurance + inspiration brand; pitch authentic Mauritius experience guide',
  },
  {
    id: 'D076', site_name: 'Matador Network', domain: 'matadornetwork.com', da_estimate: 75,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'editor@matadornetwork.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'high', relevance: 'strong',
    notes: 'Community travel network; active contributor programme, Mauritius fits Africa section',
  },
  {
    id: 'D077', site_name: 'Travel Massive', domain: 'travelmassive.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'hello@travelmassive.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'moderate',
    notes: 'Global travel industry community; pitch rankings as travel professional resource',
  },
  {
    id: 'D078', site_name: 'Culture Trip', domain: 'theculturetrip.com', da_estimate: 72,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'editorial@theculturetrip.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Travel + culture platform; pitch Mauritius cultural experiences + resort guide',
  },
  {
    id: 'D079', site_name: 'iExplore', domain: 'iexplore.com', da_estimate: 58,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'info@iexplore.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/rankings',
    traffic_tier: 'medium', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Adventure + luxury travel booking platform; rankings as editorial decision tool',
  },
  {
    id: 'D080', site_name: 'Geographic Traveller', domain: 'geographictraveller.com', da_estimate: 45,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'editor@geographictraveller.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'low_medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'National Geographic style independent magazine; Mauritius geography + luxury angle',
  },
  {
    id: 'D081', site_name: 'Fathom Away', domain: 'fathomaway.com', da_estimate: 52,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'hello@fathomaway.com', contact_name: '',
    outreach_type: 'guest_post', target_page: '/best-resort-mauritius',
    traffic_tier: 'medium', link_likelihood: 'high', relevance: 'strong',
    notes: 'Independent travel storytelling platform; Mauritius narrative + resort picks angle',
  },
  {
    id: 'D082', site_name: 'Airfarewatchdog Blog', domain: 'airfarewatchdog.com', da_estimate: 68,
    category: 'travel_blog', subcategory: 'adventure',
    contact_email: 'editorial@airfarewatchdog.com', contact_name: '',
    outreach_type: 'resource_link', target_page: '/best-resort-mauritius',
    traffic_tier: 'high', link_likelihood: 'medium', relevance: 'strong',
    notes: 'Deals + destination travel platform; pitch resort guide as companion to Mauritius flight deals',
  },
];

// ── Discovery functions ────────────────────────────────────────────────────────

/**
 * Filter discovery database by optional criteria.
 *
 * @param  {Object} filters  { category, subcategory, outreach_type, min_da }
 * @returns {Object[]}
 */
function discoverProspects(filters = {}) {
  return PROSPECT_DATABASE.filter(p => {
    if (filters.category     && p.category     !== filters.category)     return false;
    if (filters.subcategory  && p.subcategory  !== filters.subcategory)  return false;
    if (filters.outreach_type && p.outreach_type !== filters.outreach_type) return false;
    if (filters.min_da !== undefined && p.da_estimate < filters.min_da)  return false;
    return true;
  });
}

/**
 * Merge discovery prospects with existing CSV tracker records.
 * Deduplicates by domain — tracker records take priority.
 * Adds `source` ('tracker' | 'discovery') and normalises fields.
 *
 * @param  {Object[]} csvRecords   Records from parseCSV(seo_outreach_tracker.csv)
 * @returns {Object[]}             Unified prospect array
 */
function mergeWithTracker(csvRecords) {
  const trackerDomains = new Set(csvRecords.map(r => (r.domain || '').toLowerCase()));

  const discoveryNew = PROSPECT_DATABASE.filter(
    p => !trackerDomains.has(p.domain.toLowerCase()),
  ).map(p => ({
    id:             p.id,
    site_name:      p.site_name,
    domain:         p.domain,
    da_estimate:    String(p.da_estimate),
    page_url:       '',
    contact_email:  p.contact_email || '',
    contact_name:   p.contact_name  || '',
    outreach_type:  p.outreach_type,
    target_page:    p.target_page,
    status:         'not_started',
    date_contacted: '',
    date_followed_up: '',
    date_response:  '',
    response_type:  '',
    notes:          p.notes,
    // scoring metadata
    category:         p.category,
    subcategory:      p.subcategory,
    traffic_tier:     p.traffic_tier,
    link_likelihood:  p.link_likelihood,
    relevance:        p.relevance,
    source:           'discovery',
  }));

  const trackerWithMeta = csvRecords.map(r => ({
    ...r,
    category:        _inferCategory(r),
    subcategory:     _inferSubcategory(r),
    traffic_tier:    _inferTrafficTier(parseInt(r.da_estimate, 10) || 0),
    link_likelihood: _inferLinkLikelihood(r),
    relevance:       _inferRelevance(r),
    source:          'tracker',
  }));

  return [...trackerWithMeta, ...discoveryNew];
}

// ── Inference helpers (for tracker records lacking scoring metadata) ───────────

function _inferCategory(r) {
  const d = r.domain || '';
  if (d.match(/\.edu|\.ac\.|university|research/i)) return 'university';
  if (d.match(/tourism|travel-council|wttc|unwto/i)) return 'tourism_directory';
  return 'travel_blog';
}

function _inferSubcategory(r) {
  const n = (r.site_name || '').toLowerCase();
  if (n.match(/honeymoon|wedding|couple/)) return 'honeymoon';
  if (n.match(/family|kids|children/))    return 'family';
  if (n.match(/wellness|spa|yoga/))       return 'wellness';
  if (n.match(/golf/))                    return 'golf';
  if (n.match(/africa|african/))          return 'africa';
  if (n.match(/luxury|departures|virtuoso/)) return 'luxury';
  return 'general';
}

function _inferTrafficTier(da) {
  if (da >= 80) return 'high';
  if (da >= 60) return 'medium';
  if (da >= 40) return 'low_medium';
  return 'low';
}

function _inferLinkLikelihood(r) {
  if (r.outreach_type === 'broken_link')   return 'high';
  if (r.outreach_type === 'resource_link') return 'medium';
  return 'medium';
}

function _inferRelevance(r) {
  const d = (r.domain || '').toLowerCase();
  const n = (r.site_name || '').toLowerCase();
  if (d.match(/mauritius|indian.ocean/))   return 'direct';
  if (n.match(/luxury|africa|honeymoon/))  return 'strong';
  return 'moderate';
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  dim:    isTTY ? '\x1b[2m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
};

if (require.main === module) {
  const args = process.argv.slice(2).reduce((acc, a) => {
    if (a === '--merge') { acc.merge = true; return acc; }
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {});

  if (args.merge) {
    const { parseCSV } = require('./seo_outreach.js');
    const CSV_PATH = path.join(__dirname, 'seo_outreach_tracker.csv');
    if (!fs.existsSync(CSV_PATH)) {
      console.error('CSV not found:', CSV_PATH);
      process.exit(1);
    }
    const records = mergeWithTracker(parseCSV(fs.readFileSync(CSV_PATH, 'utf8')));
    console.log(`${c.bold}Merged prospect pool: ${records.length} prospects${c.reset}`);
    console.log(`  From tracker:    ${records.filter(r => r.source === 'tracker').length}`);
    console.log(`  From discovery:  ${records.filter(r => r.source === 'discovery').length}`);
    console.log('');
    return;
  }

  const filters = {};
  if (args.category)    filters.category    = args.category;
  if (args.subcategory) filters.subcategory = args.subcategory;
  if (args.min_da)      filters.min_da      = parseInt(args.min_da, 10);

  const prospects = discoverProspects(filters);
  console.log(`\n${c.bold}Discovery Database — ${prospects.length} prospects${c.reset}`);

  const cats = {};
  for (const p of prospects) {
    cats[p.category] = (cats[p.category] || 0) + 1;
  }
  for (const [cat, n] of Object.entries(cats)) {
    console.log(`  ${c.cyan}${cat.padEnd(22)}${c.reset} ${n}`);
  }

  console.log(`\n  ${c.dim}Use --category=<name>, --subcategory=<name>, --min_da=<n>${c.reset}`);
  console.log(`  ${c.dim}Use --merge to combine with seo_outreach_tracker.csv${c.reset}\n`);
}

module.exports = {
  PROSPECT_DATABASE,
  discoverProspects,
  mergeWithTracker,
  // exposed for testing
  _inferCategory,
  _inferSubcategory,
  _inferTrafficTier,
  _inferLinkLikelihood,
  _inferRelevance,
};
