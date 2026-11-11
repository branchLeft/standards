CREATE SCHEMA "portal";
--> statement-breakpoint
CREATE TABLE "portal"."tenant_register" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"zitadel_org_id" text NOT NULL,
	CONSTRAINT "tenant_register_zitadel_org_id_unique" UNIQUE("zitadel_org_id")
);
--> statement-breakpoint
ALTER TABLE "portal"."tenant_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "portal"."tenant_register" AS PERMISSIVE FOR ALL TO "portal_tenant" USING ("portal"."tenant_register"."tenant_id" = public.bound_tenant());
