/**
 * Closed value sets for the genealogy fact layer.
 *
 * Each set is a flat `as const` array of `lower_snake_case` strings so the same
 * list can drive the TypeScript union, Zod validation and the database CHECK
 * constraint (`readCheckConstraintValues` asserts the two stay equal). Adding a
 * value is therefore a migration, never a silent widening.
 */

// --- person ----------------------------------------------------------------

/** GEDCOM `SEX`; `other` covers recorded-but-unstated, `unknown` covers 失考. */
export const PERSON_SEX_VALUES = [
  'male',
  'female',
  'other',
  'unknown',
] as const;
export type PersonSex = (typeof PERSON_SEX_VALUES)[number];

export const LIVING_STATUS_VALUES = ['living', 'deceased', 'unknown'] as const;
export type LivingStatus = (typeof LIVING_STATUS_VALUES)[number];

/** `restricted` is visible to members but redacted in exports and shares. */
export const PRIVACY_LEVEL_VALUES = [
  'public',
  'restricted',
  'private',
] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVEL_VALUES)[number];

/** Whether a name is recorded at all: 已详 / 失考 / 部分失考. */
export const NAME_STATUS_VALUES = ['known', 'unknown', 'partial'] as const;
export type NameStatus = (typeof NAME_STATUS_VALUES)[number];

/**
 * GEDCOM 7 `NAME.TYPE` (`birth`, `maiden`, `married`, `aka`, `religious`,
 * `professional`, `immigrant` folded into `other`) plus the Chinese genealogy
 * name kinds: 字 `courtesy`, 号 `art`, 谥 `posthumous`, 庙 `temple`,
 * 乳名 `childhood`, 学名 `school`, 官名 `official`.
 */
export const PERSON_NAME_TYPE_VALUES = [
  'birth',
  'courtesy',
  'art',
  'posthumous',
  'temple',
  'childhood',
  'maiden',
  'married',
  'aka',
  'religious',
  'professional',
  'school',
  'official',
  'other',
] as const;
export type PersonNameType = (typeof PERSON_NAME_TYPE_VALUES)[number];

// --- family ----------------------------------------------------------------

/** `blood` is 血亲/本宗, `spouse` is 姻亲. */
export const PARTNER_ROLE_VALUES = ['blood', 'spouse'] as const;
export type PartnerRole = (typeof PARTNER_ROLE_VALUES)[number];

export const PARTNER_STATUS_VALUES = [
  'current',
  'divorced',
  'widowed',
  'separated',
  'unknown',
] as const;
export type PartnerStatus = (typeof PARTNER_STATUS_VALUES)[number];

/** `traditional` is 过继/入嗣 where no adoption record exists. */
export const PARENTAGE_TYPE_VALUES = [
  'birth',
  'adoptive',
  'foster',
  'step',
  'traditional',
  'unknown',
] as const;
export type ParentageType = (typeof PARENTAGE_TYPE_VALUES)[number];

export const UNION_TYPE_VALUES = [
  'marriage',
  'cohabitation',
  'unknown',
] as const;
export type UnionType = (typeof UNION_TYPE_VALUES)[number];

// --- events ----------------------------------------------------------------

/**
 * Which GEDCOM structure an event row came from. GEDCOM 7 has two independent
 * axes: the subject (`person_id` vs `family_id`, plus P2's generated
 * `subject_type`) and whether the structure is an event or an attribute. Only
 * the second axis is stored here; folding the subject into this column would
 * duplicate it and could not represent a family attribute (e.g. RESI on FAM).
 *
 * `attribute` rows must use one of `ATTRIBUTE_EVENT_TYPE_VALUES`; Task 6 writes
 * `CHECK (event_kind = 'attribute') = (event_type IN (...))` from that list, so
 * the column and the enum cannot drift.
 */
export const EVENT_KIND_VALUES = ['event', 'attribute'] as const;
export type EventKind = (typeof EVENT_KIND_VALUES)[number];

/**
 * Open enum: every standard GEDCOM 7 individual/family event and attribute tag,
 * the Chinese genealogy events the P1 backfill writes, and the `custom`/`other`
 * fallbacks. `custom` requires `custom_type`; `other` is "the tag exists in the
 * source but is not in this list", so imports never have to drop a fact.
 */
export const EVENT_TYPE_VALUES = [
  // Individual events (GEDCOM 7 INDIVIDUAL_EVENT_STRUCTURE). GRAD and RETI are
  // events, not attributes; `event` (EVEN) is a real tag, not a fallback;
  // `migration` has no GEDCOM 7 tag (EMIG/IMMI cover it) but the brief names it.
  'birth',
  'death',
  'burial',
  'cremation',
  'adoption',
  'baptism',
  'christening',
  'adult_christening',
  'barmitzvah',
  'basmitzvah',
  'blessing',
  'confirmation',
  'first_communion',
  'ordination',
  'census',
  'probate',
  'will',
  'naturalization',
  'emigration',
  'immigration',
  'migration',
  'graduation',
  'retirement',
  'event',
  // Individual attributes (GEDCOM 7 INDIVIDUAL_ATTRIBUTE_STRUCTURE). RESI is an
  // attribute, not an event; `fact` (FACT) is a real tag, not a fallback;
  // `military_service` is carried as EVEN + TYPE in GEDCOM 7 but the brief
  // names it.
  'occupation',
  'education',
  'residence',
  'title',
  'nationality',
  'property',
  'religion',
  'caste',
  'physical_description',
  'national_id_number',
  'number_of_children',
  'number_of_marriages',
  'social_security_number',
  'military_service',
  'fact',
  // Family events.
  'engagement',
  'marriage',
  'marriage_bann',
  'marriage_contract',
  'marriage_license',
  'marriage_settlement',
  'divorce',
  'divorce_filed',
  'annulment',
  // Chinese genealogy events (承嗣、祠堂、修谱、改名、谥号).
  'succession',
  'ancestral_hall',
  'genealogy_compiled',
  'name_change',
  'posthumous_title',
  // Fallbacks. `custom` requires `custom_type`; `other` means the source tag is
  // not in this list. Neither is an attribute.
  'custom',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPE_VALUES)[number];

/**
 * The `EVENT_TYPE_VALUES` members that GEDCOM 7 defines as attribute
 * structures (CAST, DSCR, EDUC, IDNO, NATI, NCHI, NMR, OCCU, PROP, RELI, RESI,
 * SSN, TITL, FACT) rather than events. `custom` and `other` are fallbacks, not
 * attributes, and every member here must also be in `EVENT_TYPE_VALUES` (the
 * `satisfies` clause enforces that at compile time). Task 6 writes
 * `CHECK (event_kind = 'attribute') = (event_type IN (...))` from this list, so
 * the column and the enum cannot drift.
 */
export const ATTRIBUTE_EVENT_TYPE_VALUES = [
  'occupation',
  'education',
  'residence',
  'title',
  'nationality',
  'property',
  'religion',
  'caste',
  'physical_description',
  'national_id_number',
  'number_of_children',
  'number_of_marriages',
  'social_security_number',
  'fact',
] as const satisfies readonly EventType[];

// --- dates -----------------------------------------------------------------

/** Display granularity only; it never changes the stored bounds. */
export const DATE_PRECISION_VALUES = [
  'day',
  'month',
  'year',
  'decade',
  'century',
] as const;
export type DatePrecision = (typeof DATE_PRECISION_VALUES)[number];

/**
 * Drives which of `date_start` / `date_end` must be set: `before` keeps only
 * the end bound, `after` only the start bound, `unknown` neither.
 */
export const DATE_QUALIFIER_VALUES = [
  'exact',
  'about',
  'estimated',
  'calculated',
  'before',
  'after',
  'between',
  'period',
  'unknown',
] as const;
export type DateQualifier = (typeof DATE_QUALIFIER_VALUES)[number];

/** `french_r` is the French Republican calendar. */
export const CALENDAR_VALUES = [
  'gregorian',
  'julian',
  'hebrew',
  'french_r',
  'chinese_lunar',
  'other',
] as const;
export type Calendar = (typeof CALENDAR_VALUES)[number];
