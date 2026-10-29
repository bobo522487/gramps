CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid,
	"family_id" uuid,
	"event_kind" text DEFAULT 'event' NOT NULL,
	"event_type" text DEFAULT 'event' NOT NULL,
	"custom_type" text,
	"gedcom_tag" text,
	"title" text,
	"value" text,
	"description" text,
	"date_original" text,
	"date_start" date,
	"date_end" date,
	"date_precision" text,
	"date_qualifier" text DEFAULT 'unknown' NOT NULL,
	"calendar" text DEFAULT 'gregorian' NOT NULL,
	"date_cn" jsonb,
	"age_text" text,
	"age_years" smallint,
	"age_basis" text,
	"place_original" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_event_organization_project_id" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "ck_event_type" CHECK ("event"."event_type" in ('birth', 'death', 'burial', 'cremation', 'adoption', 'baptism', 'christening', 'adult_christening', 'barmitzvah', 'basmitzvah', 'blessing', 'confirmation', 'first_communion', 'ordination', 'census', 'probate', 'will', 'naturalization', 'emigration', 'immigration', 'migration', 'graduation', 'retirement', 'event', 'occupation', 'education', 'residence', 'title', 'nationality', 'property', 'religion', 'caste', 'physical_description', 'national_id_number', 'number_of_children', 'number_of_marriages', 'social_security_number', 'military_service', 'fact', 'engagement', 'marriage', 'marriage_bann', 'marriage_contract', 'marriage_license', 'marriage_settlement', 'divorce', 'divorce_filed', 'annulment', 'succession', 'ancestral_hall', 'genealogy_compiled', 'name_change', 'posthumous_title', 'custom', 'other')),
	CONSTRAINT "ck_event_kind" CHECK ("event"."event_kind" in ('event', 'attribute')),
	CONSTRAINT "ck_event_kind_matches_type" CHECK (("event"."event_kind" = 'attribute') = ("event"."event_type" in ('occupation', 'education', 'residence', 'title', 'nationality', 'property', 'religion', 'caste', 'physical_description', 'national_id_number', 'number_of_children', 'number_of_marriages', 'social_security_number', 'fact'))),
	CONSTRAINT "ck_event_subject_exactly_one" CHECK (num_nonnulls("event"."person_id", "event"."family_id") = 1),
	CONSTRAINT "ck_event_custom_type" CHECK ("event"."event_type" <> 'custom' or "event"."custom_type" is not null),
	CONSTRAINT "ck_event_age_pair" CHECK (("event"."age_years" is null) = ("event"."age_basis" is null))
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "fk_event_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "fk_event_person" FOREIGN KEY ("organization_id","project_id","person_id") REFERENCES "public"."person"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "fk_event_family" FOREIGN KEY ("organization_id","project_id","family_id") REFERENCES "public"."family"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_subject" ON "event" USING btree ("organization_id","project_id","person_id","date_start");--> statement-breakpoint
CREATE INDEX "idx_event_family" ON "event" USING btree ("organization_id","project_id","family_id");--> statement-breakpoint
CREATE INDEX "idx_event_type" ON "event" USING btree ("organization_id","project_id","event_type");