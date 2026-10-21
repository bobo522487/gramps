ALTER TABLE "organizations" DROP CONSTRAINT "organizations_stripe_customer_id_unique";--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "stripe_customer_id";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "stripe_product_id";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "plan_name";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "subscription_status";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "tier";