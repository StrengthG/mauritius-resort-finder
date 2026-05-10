/**
 * block_assembler.js
 * Mauritius Resort Finder — Page Orchestration Layer, Module 6
 * Version: 1.0.0
 *
 * Converts ranked hotel arrays, ExplanationObjects, page context, and affiliate
 * metadata into ordered, validated block sequences ready for the rendering layer.
 *
 * Architecture position: Layer 6 — Page Assembly (post-explanation).
 * Upstream:    explanation_engine.js  (produces ExplanationObjects)
 * Downstream:  renderer               (consumes ordered block arrays)
 *
 * Assembly pipeline (14 stages, all deterministic):
 *   [1]  Input Validation       — hotel array, explanation array, page context, affiliate links
 *   [2]  Hero Block             — page header with keyword and persona context
 *   [3]  Ranking Summary Block  — hotel roster overview
 *   [4]  Methodology Block      — scoring transparency (trust anchor)
 *   [5]  Hotel Card Blocks      — one per hotel in rank order
 *   [6]  Trust Depth Tracking   — cumulative trust score updated after each block
 *   [7]  CTA Eligibility Check  — affiliate link presence, exclusion flag, trust gate
 *   [8]  Deferred CTA Queue     — CTAs deferred until trust threshold is met; dropped if never met
 *   [9]  Comparison Block       — optional, inserted after hotel cards if data provided
 *   [10] FAQ Block              — always inserted for all page types
 *   [11] Disclosure Block       — always inserted; must precede related_content
 *   [12] Related Content Block  — always inserted at bottom
 *   [13] Final Validation       — block sequence invariants checked
 *   [14] Ordered Block Output   — frozen AssemblyResult returned
 *
 * Trust model:
 *   Trust depth accumulates as trust-contributing blocks are committed.
 *   CTA blocks require trust depth ≥ 6 before they may be inserted.
 *   If threshold is never reached, deferred CTAs are marked 'dropped'.
 *   Trust contributions: Hero+1, RankingSummary+2, Methodology+2,
 *   ExpandedCard+3, StandardCard+2, CompactCard+1, Comparison+2, FAQ+1.
 *
 * Card variant rules:
 *   Rank 1      → expanded  (+3 trust)
 *   Ranks 2–5   → standard  (+2 trust)
 *   Ranks 6–10+ → compact   (+1 trust)
 *
 * CTA governance:
 *   - affiliate_disclosure is ALWAYS true (immutable)
 *   - fabricated_urgency is ALWAYS false (immutable)
 *   - No CTA is ever inserted before trust depth ≥ 6
 *   - No CTA if affiliate link is absent or hotel is excluded
 *   - Suppressed CTAs remain auditable in dropped_blocks
 *
 * Design invariants:
 *   - Stateless. Pure functions only. No side effects. No mutations of inputs.
 *   - Deterministic: same inputs always produce identical block sequence.
 *   - No HTML generation. No ranking modification. No explanation modification.
 *   - Always returns an AssemblyResult regardless of content sparsity.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION
// ─────────────────────────────────────────────────────────────────────────────

const ASSEMBLER_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// TRUST WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trust depth contributed by each block type when committed.
 * Disclosure and RelatedContent do not contribute — they are editorial/legal.
 */
const TRUST_WEIGHTS = Object.freeze({
  hero:                1,
  ranking_summary:     2,
  methodology:         2,
  hotel_card_expanded: 3,
  hotel_card_standard: 2,
  hotel_card_compact:  1,
  comparison:          2,
  faq:                 1,
});

/**
 * Minimum cumulative trust depth required before ANY affiliate CTA may be inserted.
 * Standard path: Hero(1) + Summary(3) + Methodology(5) + ExpandedCard(8) → first CTA fires.
 */
const CTA_MIN_TRUST_DEPTH = 6;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** All recognised block type strings. */
const BLOCK_TYPES = Object.freeze({
  HERO:            'hero',
  RANKING_SUMMARY: 'ranking_summary',
  METHODOLOGY:     'methodology',
  HOTEL_CARD:      'hotel_card',
  COMPARISON:      'comparison',
  FAQ:             'faq',
  AFFILIATE_CTA:   'affiliate_cta',
  DISCLOSURE:      'disclosure',
  RELATED_CONTENT: 'related_content',
  INTERNAL_LINKS:  'internal_links',
});

/** Ordered list of all valid block type strings. */
const BLOCK_TYPE_VALUES = Object.freeze(Object.values(BLOCK_TYPES));

/** Recognised page type strings. */
const PAGE_TYPES = Object.freeze(['ranking', 'comparison', 'editorial', 'hotel_detail']);

/** Card variant identifiers. */
const CARD_VARIANTS = Object.freeze({
  EXPANDED: 'expanded',
  STANDARD: 'standard',
  COMPACT:  'compact',
});

/** Block lifecycle statuses. */
const VALIDATION_STATUS = Object.freeze({
  VALID:    'valid',
  DEFERRED: 'deferred',
  DROPPED:  'dropped',
  INVALID:  'invalid',
});

/**
 * Block types that are mandatory in every AssemblyResult.
 * These types must always appear exactly once.
 */
const REQUIRED_BLOCK_TYPES = Object.freeze([
  BLOCK_TYPES.HERO,
  BLOCK_TYPES.RANKING_SUMMARY,
  BLOCK_TYPES.METHODOLOGY,
  BLOCK_TYPES.DISCLOSURE,
]);

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

class BlockAssemblerError extends Error {
  constructor(message, stage, details) {
    super(message);
    this.name    = 'BlockAssemblerError';
    this.stage   = stage   || null;
    this.details = details || null;
  }
}

class InvalidInputError extends BlockAssemblerError {
  constructor(message, details) {
    super(message, 'input_validation', details);
    this.name = 'InvalidInputError';
  }
}

class InvalidPageContextError extends BlockAssemblerError {
  constructor(message, details) {
    super(message, 'input_validation', details);
    this.name = 'InvalidPageContextError';
  }
}

class BlockSequenceError extends BlockAssemblerError {
  constructor(message, details) {
    super(message, 'final_validation', details);
    this.name = 'BlockSequenceError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical hotel id from a hotel object.
 * Accepts hotel_id or id (alias).
 *
 * @param  {Object} hotel
 * @returns {string|null}
 */
function _getHotelId(hotel) {
  if (!hotel) return null;
  return hotel.hotel_id || hotel.id || null;
}

/**
 * Returns the canonical hotel name from a hotel object.
 *
 * @param  {Object} hotel
 * @returns {string|null}
 */
function _getHotelName(hotel) {
  if (!hotel) return null;
  return hotel.hotel_name || hotel.name || null;
}

/**
 * Returns the card variant for a given rank number.
 *
 * Rank 1      → 'expanded'  (+3 trust)
 * Ranks 2–5   → 'standard'  (+2 trust)
 * Ranks 6+    → 'compact'   (+1 trust)
 * Invalid/NaN → 'compact'   (safe default)
 *
 * @param  {number} rank
 * @returns {'expanded'|'standard'|'compact'}
 */
function _getCardVariant(rank) {
  if (typeof rank !== 'number' || isNaN(rank) || rank < 1) return CARD_VARIANTS.COMPACT;
  if (rank === 1)  return CARD_VARIANTS.EXPANDED;
  if (rank <= 5)   return CARD_VARIANTS.STANDARD;
  return CARD_VARIANTS.COMPACT;
}

/**
 * Returns the trust depth contribution of a card variant.
 *
 * @param  {'expanded'|'standard'|'compact'} variant
 * @returns {number}
 */
function _cardTrustGain(variant) {
  switch (variant) {
    case CARD_VARIANTS.EXPANDED: return TRUST_WEIGHTS.hotel_card_expanded;
    case CARD_VARIANTS.STANDARD: return TRUST_WEIGHTS.hotel_card_standard;
    case CARD_VARIANTS.COMPACT:  return TRUST_WEIGHTS.hotel_card_compact;
    default:                     return 0;
  }
}

/**
 * Checks whether an affiliate CTA is eligible for a given hotel.
 *
 * Returns true only when ALL of the following hold:
 *   - affiliateLinks is a non-null object
 *   - the hotel has a non-null id that appears in affiliateLinks
 *   - the link entry is not marked excluded
 *   - the link entry has a non-empty booking_url string
 *
 * @param  {Object}      hotel
 * @param  {Object|null} affiliateLinks
 * @returns {boolean}
 */
function _isCTAEligible(hotel, affiliateLinks) {
  if (!affiliateLinks || typeof affiliateLinks !== 'object' || Array.isArray(affiliateLinks)) return false;
  const id = _getHotelId(hotel);
  if (!id) return false;
  const link = affiliateLinks[id];
  if (!link || typeof link !== 'object')  return false;
  if (link.excluded === true)             return false;
  if (!link.booking_url || typeof link.booking_url !== 'string' || link.booking_url.trim() === '') return false;
  return true;
}

/**
 * Builds a hotel_id → ExplanationObject lookup map.
 *
 * @param  {Object[]} explanationObjects
 * @returns {Object}  { [hotel_id]: ExplanationObject }
 */
function _buildExplanationMap(explanationObjects) {
  if (!Array.isArray(explanationObjects)) return {};
  const map = {};
  for (const exp of explanationObjects) {
    if (exp && exp.hotel_id) map[exp.hotel_id] = exp;
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates all inputs to assemble().
 *
 * @throws {InvalidInputError}       on invalid ranked_hotels or affiliate_links
 * @throws {InvalidPageContextError} on invalid page_context
 */
function _validateInputs(rankedHotels, explanationObjects, pageContext, affiliateLinks) {
  if (!Array.isArray(rankedHotels)) {
    throw new InvalidInputError('ranked_hotels must be an array');
  }
  if (rankedHotels.length === 0) {
    throw new InvalidInputError('ranked_hotels must contain at least one hotel');
  }

  for (let i = 0; i < rankedHotels.length; i++) {
    const hotel = rankedHotels[i];
    if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) {
      throw new InvalidInputError(`ranked_hotels[${i}] must be a plain object`);
    }
    if (!hotel.score_breakdown || typeof hotel.score_breakdown !== 'object') {
      throw new InvalidInputError(
        `ranked_hotels[${i}] ("${_getHotelId(hotel) || '?'}") is missing score_breakdown`,
      );
    }
    if (typeof hotel.rank !== 'number' || isNaN(hotel.rank)) {
      throw new InvalidInputError(
        `ranked_hotels[${i}] ("${_getHotelId(hotel) || '?'}") is missing a numeric rank field`,
      );
    }
  }

  if (!Array.isArray(explanationObjects)) {
    throw new InvalidInputError('explanation_objects must be an array');
  }

  if (!pageContext || typeof pageContext !== 'object' || Array.isArray(pageContext)) {
    throw new InvalidPageContextError('page_context must be a plain object');
  }
  if (!PAGE_TYPES.includes(pageContext.page_type)) {
    throw new InvalidPageContextError(
      `page_context.page_type must be one of: ${PAGE_TYPES.join(', ')} (got "${pageContext.page_type}")`,
      { received: pageContext.page_type },
    );
  }
  if (!pageContext.persona || typeof pageContext.persona !== 'string') {
    throw new InvalidPageContextError('page_context.persona must be a non-empty string');
  }

  if (affiliateLinks !== null && affiliateLinks !== undefined) {
    if (typeof affiliateLinks !== 'object' || Array.isArray(affiliateLinks)) {
      throw new InvalidInputError('affiliate_links must be a plain object or null/undefined');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the committed block sequence against all structural invariants.
 *
 * Checks:
 *   - No duplicate block_ids
 *   - Positions are sequential (1-based)
 *   - Trust scores are non-decreasing
 *   - No CTA inserted below CTA_MIN_TRUST_DEPTH
 *   - All CTA blocks have affiliate_disclosure: true
 *   - All CTA blocks have fabricated_urgency: false
 *   - All REQUIRED_BLOCK_TYPES are present
 *   - First block is type 'hero'
 *   - Disclosure appears before related_content
 *
 * @param  {Object[]} committed
 * @throws {BlockSequenceError} on any violation
 */
function _validateBlockSequence(committed) {
  const seenIds   = new Set();
  let   prevTrust = -Infinity;

  for (let i = 0; i < committed.length; i++) {
    const block = committed[i];

    // No duplicate block_ids
    if (seenIds.has(block.block_id)) {
      throw new BlockSequenceError(`Duplicate block_id detected: "${block.block_id}"`);
    }
    seenIds.add(block.block_id);

    // Sequential 1-based positions
    if (block.position !== i + 1) {
      throw new BlockSequenceError(
        `Block "${block.block_id}" has position ${block.position}, expected ${i + 1}`,
      );
    }

    // Non-decreasing trust scores
    if (block.trust_score < prevTrust) {
      throw new BlockSequenceError(
        `Block "${block.block_id}" trust_score (${block.trust_score}) is less than previous (${prevTrust})`,
      );
    }
    prevTrust = block.trust_score;

    // CTA trust gate
    if (block.block_type === BLOCK_TYPES.AFFILIATE_CTA) {
      if (block.trust_score < CTA_MIN_TRUST_DEPTH) {
        throw new BlockSequenceError(
          `CTA "${block.block_id}" inserted at trust_score ${block.trust_score} — ` +
          `minimum required is ${CTA_MIN_TRUST_DEPTH}`,
        );
      }
      // Affiliate disclosure must be present
      if (block.payload.affiliate_disclosure !== true) {
        throw new BlockSequenceError(
          `CTA "${block.block_id}" is missing required affiliate_disclosure: true`,
        );
      }
      // Fabricated urgency must be absent
      if (block.payload.fabricated_urgency !== false) {
        throw new BlockSequenceError(
          `CTA "${block.block_id}" has disallowed fabricated_urgency: ${block.payload.fabricated_urgency}`,
        );
      }
    }
  }

  // Required block types must all be present
  const presentTypes = new Set(committed.map(b => b.block_type));
  for (const required of REQUIRED_BLOCK_TYPES) {
    if (!presentTypes.has(required)) {
      throw new BlockSequenceError(`Required block type "${required}" is absent from committed sequence`);
    }
  }

  // Hero must be first
  if (committed.length > 0 && committed[0].block_type !== BLOCK_TYPES.HERO) {
    throw new BlockSequenceError(
      `First committed block must be type "hero"; got "${committed[0].block_type}"`,
    );
  }

  // Disclosure must precede related_content
  const disclosureIdx = committed.findIndex(b => b.block_type === BLOCK_TYPES.DISCLOSURE);
  const relatedIdx    = committed.findIndex(b => b.block_type === BLOCK_TYPES.RELATED_CONTENT);
  if (disclosureIdx !== -1 && relatedIdx !== -1 && disclosureIdx > relatedIdx) {
    throw new BlockSequenceError('Disclosure block must appear before related_content block');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
//
// All factories return a mutable block object with placeholder position (-1)
// and trust_score (-1). The assemble() function's commit() closure sets both
// to their final values before the block enters the committed list.
//
// position and trustScore parameters are kept for direct unit-test use.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the hero block — always first, establishes page identity.
 *
 * @param  {Object} pageContext
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeHeroBlock(pageContext, position, trustScore) {
  return {
    block_id:          'hero_001',
    block_type:        BLOCK_TYPES.HERO,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      title:          pageContext.title          || null,
      persona:        pageContext.persona,
      target_keyword: pageContext.target_keyword || null,
      page_type:      pageContext.page_type,
      slug:           pageContext.slug           || null,
    },
    dependencies:      [],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates the ranking summary block — hotel roster overview.
 *
 * @param  {Object[]} rankedHotels
 * @param  {Object}   pageContext
 * @param  {number}   [position=-1]
 * @param  {number}   [trustScore=-1]
 * @returns {Object} Block
 */
function _makeRankingSummaryBlock(rankedHotels, pageContext, position, trustScore) {
  return {
    block_id:          'ranking_summary_001',
    block_type:        BLOCK_TYPES.RANKING_SUMMARY,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      total_hotels: rankedHotels.length,
      persona:      pageContext.persona,
      hotels:       rankedHotels.map(h => ({
        rank:     h.rank,
        hotel_id: _getHotelId(h),
        name:     _getHotelName(h),
      })),
    },
    dependencies:      ['hero_001'],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates the methodology block — scoring transparency anchor.
 * This is the primary trust-building block before hotel content begins.
 *
 * @param  {Object} pageContext
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeMethodologyBlock(pageContext, position, trustScore) {
  return {
    block_id:          'methodology_001',
    block_type:        BLOCK_TYPES.METHODOLOGY,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      scoring_dimensions: [
        'overall_score',
        'location_score',
        'amenity_score',
        'brand_score',
        'value_score',
      ],
      persona:   pageContext.persona,
      page_type: pageContext.page_type,
    },
    dependencies:      ['ranking_summary_001'],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates a hotel card block for a given hotel and rank.
 *
 * @param  {Object}      hotel
 * @param  {Object|null} explanation   — ExplanationObject or null if absent
 * @param  {string}      variant       — 'expanded' | 'standard' | 'compact'
 * @param  {Object|null} affiliateLinks
 * @param  {number}      [position=-1]
 * @param  {number}      [trustScore=-1]
 * @returns {Object} Block
 */
function _makeHotelCardBlock(hotel, explanation, variant, affiliateLinks, position, trustScore) {
  return {
    block_id:          `hotel_card_rank_${hotel.rank}`,
    block_type:        BLOCK_TYPES.HOTEL_CARD,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      rank:         hotel.rank,
      hotel_id:     _getHotelId(hotel),
      hotel_data:   hotel,
      explanation:  explanation || null,
      card_variant: variant,
      cta_eligible: _isCTAEligible(hotel, affiliateLinks),
    },
    dependencies:      ['methodology_001'],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates an affiliate CTA block for a given hotel.
 *
 * Invariants baked into every CTA block:
 *   - affiliate_disclosure: true  (always required, immutable)
 *   - fabricated_urgency:   false (never permitted, immutable)
 *
 * @param  {Object} hotel
 * @param  {Object} affiliateLink — entry from affiliateLinks map
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeAffiliateCTABlock(hotel, affiliateLink, position, trustScore) {
  return {
    block_id:          `cta_${_getHotelId(hotel)}`,
    block_type:        BLOCK_TYPES.AFFILIATE_CTA,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      hotel_id:             _getHotelId(hotel),
      hotel_name:           _getHotelName(hotel),
      booking_url:          affiliateLink.booking_url,
      provider:             affiliateLink.provider         || null,
      commission_tier:      affiliateLink.commission_tier  || null,
      affiliate_disclosure: true,   // IMMUTABLE — must always be true
      fabricated_urgency:   false,  // IMMUTABLE — must always be false
    },
    dependencies:      [`hotel_card_rank_${hotel.rank}`],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates a comparison block from optional comparison_data.
 *
 * @param  {Object}   comparisonData
 * @param  {Object[]} rankedHotels    — for dependency tracking
 * @param  {number}   [position=-1]
 * @param  {number}   [trustScore=-1]
 * @returns {Object} Block
 */
function _makeComparisonBlock(comparisonData, rankedHotels, position, trustScore) {
  const hotelCardIds = rankedHotels
    .filter(h => typeof h.rank === 'number')
    .map(h => `hotel_card_rank_${h.rank}`);

  return {
    block_id:          'comparison_001',
    block_type:        BLOCK_TYPES.COMPARISON,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      dimensions:      (comparisonData && comparisonData.dimensions) || [],
      hotel_ids:       (comparisonData && comparisonData.hotels)     || [],
      comparison_data: comparisonData,
    },
    dependencies:      hotelCardIds,
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates the FAQ block.
 *
 * @param  {Object} pageContext
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeFAQBlock(pageContext, position, trustScore) {
  return {
    block_id:          'faq_001',
    block_type:        BLOCK_TYPES.FAQ,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      persona:   pageContext.persona,
      page_type: pageContext.page_type,
      slug:      pageContext.slug || null,
    },
    dependencies:      ['methodology_001'],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates the disclosure block.
 * Contains the affiliate relationship disclosure text.
 * Always present; does not contribute to trust depth.
 *
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeDisclosureBlock(position, trustScore) {
  return {
    block_id:          'disclosure_001',
    block_type:        BLOCK_TYPES.DISCLOSURE,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      affiliate_disclosure_text:
        'This page contains affiliate links. Hotel rankings and explanations are determined ' +
        'by an independent scoring methodology. Affiliate commission rates do not influence ' +
        'rankings, explanations, or the content of any recommendation.',
      methodology_link: '/methodology',
    },
    dependencies:      [],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

/**
 * Creates the related content block.
 * Always appears last; depends on disclosure.
 *
 * @param  {Object} pageContext
 * @param  {number} [position=-1]
 * @param  {number} [trustScore=-1]
 * @returns {Object} Block
 */
function _makeRelatedContentBlock(pageContext, position, trustScore) {
  return {
    block_id:          'related_content_001',
    block_type:        BLOCK_TYPES.RELATED_CONTENT,
    position:          position   !== undefined ? position   : -1,
    trust_score:       trustScore !== undefined ? trustScore : -1,
    payload: {
      persona:   pageContext.persona,
      page_type: pageContext.page_type,
      slug:      pageContext.slug || null,
    },
    dependencies:      ['disclosure_001'],
    validation_status: VALIDATION_STATUS.VALID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles an ordered, validated block sequence from ranked hotels and context.
 *
 * Returns an AssemblyResult containing:
 *   - blocks[]         — committed blocks in page order (frozen)
 *   - dropped_blocks[] — CTAs that were deferred but never fired (frozen)
 *   - assembly_summary — metadata about the assembly run (frozen)
 *
 * @param  {Object[]}    rankedHotels      — hotels sorted by rank ascending
 * @param  {Object[]}    explanationObjects — ExplanationObjects (one per hotel)
 * @param  {Object}      pageContext        — { page_type, persona, title, slug, target_keyword }
 * @param  {Object|null} affiliateLinks     — { [hotel_id]: { booking_url, provider, commission_tier, excluded } }
 * @param  {Object|null} [comparisonData]   — optional comparison table data
 * @returns {Object} frozen AssemblyResult
 * @throws {InvalidInputError}       on invalid hotel array or affiliate_links
 * @throws {InvalidPageContextError} on invalid page_context
 * @throws {BlockSequenceError}      if final validation fails (internal invariant violation)
 */
function assemble(rankedHotels, explanationObjects, pageContext, affiliateLinks, comparisonData) {

  // ── Stage 1: Input Validation ──────────────────────────────────────────────
  _validateInputs(rankedHotels, explanationObjects, pageContext, affiliateLinks || null);

  const explanationMap = _buildExplanationMap(explanationObjects);
  const links          = affiliateLinks || null;

  // Sort hotels by rank ascending for deterministic card ordering.
  // Input order is not trusted — rank field is the source of truth.
  const sortedHotels = rankedHotels.slice().sort((a, b) => a.rank - b.rank);

  // Mutable assembly state (internal only — never exposed to callers)
  const committed = [];   // blocks committed in order
  const deferred  = [];   // CTA blocks deferred pending trust threshold
  let   trust     = 0;    // cumulative trust depth
  let   position  = 0;    // 1-based position counter

  /**
   * Commits a block: assigns final position and trust_score, appends to committed.
   * trust must be updated BEFORE calling commit() for trust-contributing blocks.
   */
  function commit(block) {
    block.position    = ++position;
    block.trust_score = trust;
    committed.push(block);
  }

  /**
   * Drains deferred CTA queue. Any deferred CTA whose trust gate is now met
   * is committed immediately (FIFO order). Others remain deferred.
   */
  function drainDeferred() {
    let i = 0;
    while (i < deferred.length) {
      if (trust >= CTA_MIN_TRUST_DEPTH) {
        const cta = deferred.splice(i, 1)[0];  // remove from front
        cta.validation_status = VALIDATION_STATUS.VALID;
        commit(cta);
        // don't increment i — next item shifted to index i
      } else {
        i++;
      }
    }
  }

  // ── Stage 2: Hero Block ────────────────────────────────────────────────────
  trust += TRUST_WEIGHTS.hero;
  commit(_makeHeroBlock(pageContext));

  // ── Stage 3: Ranking Summary Block ────────────────────────────────────────
  trust += TRUST_WEIGHTS.ranking_summary;
  commit(_makeRankingSummaryBlock(sortedHotels, pageContext));

  // ── Stage 4: Methodology Block ────────────────────────────────────────────
  trust += TRUST_WEIGHTS.methodology;
  commit(_makeMethodologyBlock(pageContext));

  // ── Stages 5–8: Hotel Card Blocks + CTA Governance ────────────────────────
  for (const hotel of sortedHotels) {
    const hotelId   = _getHotelId(hotel);
    const variant   = _getCardVariant(hotel.rank);
    const trustGain = _cardTrustGain(variant);
    const exp       = explanationMap[hotelId] || null;

    // Stage 5 + 6: Commit card, update trust
    trust += trustGain;
    commit(_makeHotelCardBlock(hotel, exp, variant, links));

    // Stage 8: Drain deferred queue first (FIFO — older CTAs fire before newer)
    drainDeferred();

    // Stage 7: CTA eligibility check for this hotel
    if (_isCTAEligible(hotel, links)) {
      const affLink = links[hotelId];
      const cta     = _makeAffiliateCTABlock(hotel, affLink);

      if (trust >= CTA_MIN_TRUST_DEPTH) {
        // Fire immediately
        commit(cta);
      } else {
        // Defer until trust threshold is met
        cta.validation_status = VALIDATION_STATUS.DEFERRED;
        deferred.push(cta);
      }
    }
  }

  // Final deferred drain after all hotel cards
  drainDeferred();

  // Mark any still-deferred CTAs as dropped
  for (const cta of deferred) {
    cta.validation_status = VALIDATION_STATUS.DROPPED;
  }

  // ── Stage 9: Comparison Block (optional) ──────────────────────────────────
  if (comparisonData && typeof comparisonData === 'object' && !Array.isArray(comparisonData)) {
    trust += TRUST_WEIGHTS.comparison;
    commit(_makeComparisonBlock(comparisonData, sortedHotels));
  }

  // ── Stage 10: FAQ Block ───────────────────────────────────────────────────
  trust += TRUST_WEIGHTS.faq;
  commit(_makeFAQBlock(pageContext));

  // ── Stage 11: Disclosure Block (always) ───────────────────────────────────
  // Disclosure does NOT contribute to trust depth.
  commit(_makeDisclosureBlock());

  // ── Stage 12: Related Content Block ──────────────────────────────────────
  // Related content does NOT contribute to trust depth.
  commit(_makeRelatedContentBlock(pageContext));

  // ── Stage 13: Final Validation ────────────────────────────────────────────
  _validateBlockSequence(committed);

  // ── Stage 14: Return frozen AssemblyResult ────────────────────────────────
  return Object.freeze({
    blocks:         Object.freeze(committed.slice()),
    dropped_blocks: Object.freeze(deferred.slice()),
    assembly_summary: Object.freeze({
      total_blocks:      committed.length,
      dropped_ctas:      deferred.length,
      deferred_ctas:     0,  // all remaining are either committed or dropped by this point
      final_trust_depth: trust,
      hotel_count:       sortedHotels.length,
      has_comparison:    !!(comparisonData && typeof comparisonData === 'object' && !Array.isArray(comparisonData)),
      assembler_version: ASSEMBLER_VERSION,
      generated_at:      new Date().toISOString(),
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Primary API ────────────────────────────────────────────────────────────
  assemble,

  // ── Internal helpers (exported for unit testing) ──────────────────────────
  _getHotelId,
  _getHotelName,
  _getCardVariant,
  _cardTrustGain,
  _isCTAEligible,
  _buildExplanationMap,
  _validateInputs,
  _validateBlockSequence,

  // ── Block factory functions (exported for unit testing) ───────────────────
  _makeHeroBlock,
  _makeRankingSummaryBlock,
  _makeMethodologyBlock,
  _makeHotelCardBlock,
  _makeAffiliateCTABlock,
  _makeComparisonBlock,
  _makeFAQBlock,
  _makeDisclosureBlock,
  _makeRelatedContentBlock,

  // ── Constants ─────────────────────────────────────────────────────────────
  ASSEMBLER_VERSION,
  TRUST_WEIGHTS,
  CTA_MIN_TRUST_DEPTH,
  BLOCK_TYPES,
  BLOCK_TYPE_VALUES,
  PAGE_TYPES,
  CARD_VARIANTS,
  VALIDATION_STATUS,
  REQUIRED_BLOCK_TYPES,

  // ── Error types ────────────────────────────────────────────────────────────
  BlockAssemblerError,
  InvalidInputError,
  InvalidPageContextError,
  BlockSequenceError,
};
