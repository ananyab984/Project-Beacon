-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'RECRUITER', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'NEGOTIATING', 'INVITE_SENT', 'ONBOARDED', 'COLD');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'AWAITING_REPLY', 'REPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'NEGOTIATION', 'OFFERED', 'PLACED', 'ON_HOLD', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE_NOW', 'AVAILABLE_FROM', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadFlagType" AS ENUM ('DNC', 'ON_HOLD', 'WATCHING', 'HIGH_PRIORITY');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "FlagAction" AS ENUM ('ADDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'FLAGGED_REVIEW');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('LINKEDIN', 'PROZ', 'APOLLO', 'REFERRAL', 'IMPORT', 'GITHUB');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('EMAIL', 'LINKEDIN_DM');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('INTERVIEW', 'CALL');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "MetricGroup" AS ENUM ('ACTIVITY_AND_EFFORT', 'RESPONSIVENESS', 'OWNERSHIP_AND_FOLLOW_THROUGH', 'OUTCOME_METRICS', 'ADDITIONAL_BUSINESS_METRICS');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('COUNT', 'PCT', 'DAYS', 'ATTEMPTS');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('FINAL');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('ME', 'THEM');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('HOUR', 'MINUTE', 'PROJECT');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'GBP', 'INR');

-- CreateEnum
CREATE TYPE "PreferredContact" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "EscalationPriority" AS ENUM ('P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS');

-- CreateEnum
CREATE TYPE "EmailQueueStatus" AS ENUM ('AI_DRAFTED', 'FOLLOW_UP', 'REVIEW_NEEDED');

-- CreateEnum
CREATE TYPE "ClientDemandPriority" AS ENUM ('STANDARD', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ClientDemandStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "UserFlagType" AS ENUM ('DNU');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "verify_token" TEXT,
    "reset_token" TEXT,
    "reset_token_expires_at" TIMESTAMP(3),
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headline" TEXT,
    "country_of_residence" TEXT,
    "timezone" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "preferred_contact" "PreferredContact",
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_language" TEXT,
    "target_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondary_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "years_of_experience" DECIMAL(4,1),
    "vendor_experience" TEXT,
    "rate_amount" DECIMAL(10,2),
    "rate_unit" "RateUnit",
    "currency" "Currency" DEFAULT 'USD',
    "resume_filename" TEXT,
    "resume_size_kb" INTEGER,
    "portfolio_url" TEXT,
    "linkedin_url" TEXT,
    "proz_url" TEXT,
    "website_url" TEXT,
    "availability_status" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "available_from" TIMESTAMP(3),
    "weekly_capacity_hours" INTEGER,
    "blackout_dates" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],
    "notify_new_lead" BOOLEAN NOT NULL DEFAULT true,
    "notify_duplicate" BOOLEAN NOT NULL DEFAULT true,
    "notify_message" BOOLEAN NOT NULL DEFAULT true,
    "notify_weekly_digest" BOOLEAN NOT NULL DEFAULT false,
    "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_rules" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "enrichment_gate" "EnrichmentStatus",
    "access_level" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "visibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "created_by_recruiter_id" TEXT,
    "created_by_contractor_id" TEXT,
    "assigned_recruiter_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "is_self_sourced" BOOLEAN NOT NULL DEFAULT false,
    "claimed_by_recruiter_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "dup_flagged" BOOLEAN NOT NULL DEFAULT false,
    "dup_flagged_field" TEXT,
    "enrichment_status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "promoted_to_global_at" TIMESTAMP(3),
    "just_enriched_until" TIMESTAMP(3),
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority",
    "flags" "LeadFlagType"[] DEFAULT ARRAY[]::"LeadFlagType"[],
    "closure_reason" TEXT,
    "closure_reason_logged_at" TIMESTAMP(3),
    "masked_label" TEXT,
    "identity_resolved" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "first_name" TEXT,
    "full_name" TEXT,
    "profile_link" TEXT,
    "country_of_residence" TEXT,
    "contact_number" TEXT,
    "email_address" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "reachout_date" TIMESTAMP(3),
    "application_date" TIMESTAMP(3),
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_language" TEXT,
    "target_language" TEXT,
    "secondary_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "LeadSource" NOT NULL,
    "proz_profile_id" TEXT,
    "linkedin_urn" TEXT,
    "years_of_experience" DECIMAL(4,1),
    "vendor_experience" TEXT,
    "yoe_confidence" DECIMAL(4,3),
    "linkedin_match_confidence" DECIMAL(4,3),
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "availability_from_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_vendor_matches" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "competitor_id" TEXT NOT NULL,
    "confidence" DECIMAL(4,3),
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_vendor_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_stage" "LeadStage",
    "to_stage" "LeadStage" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_recruiter_id" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_flag_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "flag" "LeadFlagType" NOT NULL,
    "action" "FlagAction" NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'CONFIRMED',
    "set_by_recruiter_id" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_recruiter_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "reason" TEXT,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "lead_flag_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "direction" "InteractionDirection" NOT NULL,
    "channel" "InteractionChannel" NOT NULL,
    "recruiter_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "is_urgent_flag" BOOLEAN NOT NULL DEFAULT false,
    "recruiter_responded_at" TIMESTAMP(3),
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "ai_draft_text" TEXT,
    "sent_text" TEXT,
    "ai_reply_classification" TEXT,
    "ai_classification_confidence" DECIMAL(4,3),
    "delivery_status" TEXT,

    CONSTRAINT "interaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_activity_logs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_config" (
    "id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "group" "MetricGroup" NOT NULL,
    "label" TEXT NOT NULL,
    "unit" "MetricUnit" NOT NULL,
    "weight" DECIMAL(5,2),
    "target" DECIMAL(10,4),
    "good_band" DECIMAL(10,4),
    "direction" "MetricDirection" NOT NULL,
    "scored" BOOLEAN NOT NULL DEFAULT true,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "kpi_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_score_snapshots" (
    "id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "overall_score" DECIMAL(5,2) NOT NULL,
    "previous_score" DECIMAL(5,2),
    "band_label" TEXT,
    "summary" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kpi_config_snapshot" JSONB NOT NULL,
    "excluded_metrics" JSONB,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'FINAL',

    CONSTRAINT "recruiter_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_metric_snapshots" (
    "id" TEXT NOT NULL,
    "score_snapshot_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "current_value" DECIMAL(10,4) NOT NULL,
    "previous_value" DECIMAL(10,4),
    "baseline" DECIMAL(10,4),
    "change_pct" DECIMAL(6,2),
    "trend" TEXT,
    "metric_status" TEXT,
    "normalized" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "recruiter_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_monthly_metrics" (
    "id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "recruiter_monthly_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours_calendar" (
    "id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_holiday" BOOLEAN NOT NULL DEFAULT false,
    "holiday_date" TIMESTAMP(3),

    CONSTRAINT "business_hours_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "client_demand" (
    "id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "recruiter_id" TEXT,
    "headcount_needed" INTEGER NOT NULL,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "gap" INTEGER NOT NULL DEFAULT 0,
    "project_name" TEXT,
    "priority" "ClientDemandPriority" NOT NULL DEFAULT 'STANDARD',
    "deadline" TIMESTAMP(3),
    "status" "ClientDemandStatus" NOT NULL DEFAULT 'ACTIVE',
    "sheet_row_id" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_demand_services" (
    "id" TEXT NOT NULL,
    "client_demand_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "needed" INTEGER NOT NULL,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "gap" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_demand_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_sync_config" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "sheet_url" TEXT,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "sheet_sync_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_queue_items" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "candidate_role" TEXT,
    "status" "EmailQueueStatus" NOT NULL DEFAULT 'AI_DRAFTED',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "candidate_role" TEXT,
    "channel" "ConversationChannel" NOT NULL,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "text" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_flag_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flag" "UserFlagType" NOT NULL,
    "action" "FlagAction" NOT NULL,
    "set_by_recruiter_id" TEXT NOT NULL,
    "set_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_recruiter_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "reason" TEXT,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "user_flag_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_assignments" (
    "id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "contractor_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL,
    "priority" "EscalationPriority" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "sla_hours_remaining" DECIMAL(6,2),
    "impact" TEXT,
    "recruiter_id" TEXT,
    "lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_kpi_summaries" (
    "id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "outreach_effectiveness" DECIMAL(5,2) NOT NULL,
    "response_rate" DECIMAL(5,2) NOT NULL,
    "sla_adherence" DECIMAL(5,2) NOT NULL,
    "overall_score" DECIMAL(5,2) NOT NULL,
    "outreach_volume" INTEGER NOT NULL,
    "dnc_pct" DECIMAL(5,2) NOT NULL,
    "interview_to_offer" DECIMAL(5,2) NOT NULL,
    "offer_acceptance" DECIMAL(5,2) NOT NULL,
    "profile_quality" DECIMAL(5,2) NOT NULL,
    "client_satisfaction" DECIMAL(5,2) NOT NULL,
    "ai_adoption" DECIMAL(5,2) NOT NULL,
    "pipeline_health" DECIMAL(5,2) NOT NULL,
    "email_open_rate" DECIMAL(5,2) NOT NULL,
    "avg_turnaround_days" DECIMAL(6,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiter_kpi_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "visibility_rules_role_key" ON "visibility_rules"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "leads_enrichment_status_idx" ON "leads"("enrichment_status");

-- CreateIndex
CREATE INDEX "leads_assigned_recruiter_id_idx" ON "leads"("assigned_recruiter_id");

-- CreateIndex
CREATE INDEX "leads_claimed_by_recruiter_id_idx" ON "leads"("claimed_by_recruiter_id");

-- CreateIndex
CREATE INDEX "leads_stage_idx" ON "leads"("stage");

-- CreateIndex
CREATE INDEX "leads_country_of_residence_idx" ON "leads"("country_of_residence");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_name_key" ON "competitors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lead_vendor_matches_lead_id_competitor_id_key" ON "lead_vendor_matches"("lead_id", "competitor_id");

-- CreateIndex
CREATE INDEX "stage_history_lead_id_idx" ON "stage_history"("lead_id");

-- CreateIndex
CREATE INDEX "lead_flag_events_lead_id_idx" ON "lead_flag_events"("lead_id");

-- CreateIndex
CREATE INDEX "lead_flag_events_flag_status_idx" ON "lead_flag_events"("flag", "status");

-- CreateIndex
CREATE INDEX "interaction_events_lead_id_idx" ON "interaction_events"("lead_id");

-- CreateIndex
CREATE INDEX "interaction_events_direction_occurred_at_idx" ON "interaction_events"("direction", "occurred_at");

-- CreateIndex
CREATE INDEX "manual_activity_logs_lead_id_idx" ON "manual_activity_logs"("lead_id");

-- CreateIndex
CREATE INDEX "manual_activity_logs_type_idx" ON "manual_activity_logs"("type");

-- CreateIndex
CREATE INDEX "kpi_config_metric_key_idx" ON "kpi_config"("metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_config_metric_key_effective_date_key" ON "kpi_config"("metric_key", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_score_snapshots_recruiter_id_period_key" ON "recruiter_score_snapshots"("recruiter_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_metric_snapshots_score_snapshot_id_metric_key_key" ON "recruiter_metric_snapshots"("score_snapshot_id", "metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_monthly_metrics_recruiter_id_metric_name_month_key" ON "recruiter_monthly_metrics"("recruiter_id", "metric_name", "month");

-- CreateIndex
CREATE UNIQUE INDEX "client_demand_sheet_row_id_key" ON "client_demand"("sheet_row_id");

-- CreateIndex
CREATE INDEX "client_demand_language_idx" ON "client_demand"("language");

-- CreateIndex
CREATE INDEX "client_demand_status_idx" ON "client_demand"("status");

-- CreateIndex
CREATE UNIQUE INDEX "client_demand_services_client_demand_id_service_key" ON "client_demand_services"("client_demand_id", "service");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_sync_config_owner_user_id_key" ON "sheet_sync_config"("owner_user_id");

-- CreateIndex
CREATE INDEX "email_queue_items_lead_id_idx" ON "email_queue_items"("lead_id");

-- CreateIndex
CREATE INDEX "email_queue_items_status_idx" ON "email_queue_items"("status");

-- CreateIndex
CREATE INDEX "conversations_lead_id_idx" ON "conversations"("lead_id");

-- CreateIndex
CREATE INDEX "conversations_recruiter_id_idx" ON "conversations"("recruiter_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_idx" ON "conversation_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "user_flag_events_user_id_idx" ON "user_flag_events"("user_id");

-- CreateIndex
CREATE INDEX "user_flag_events_flag_idx" ON "user_flag_events"("flag");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_assignments_contractor_id_key" ON "contractor_assignments"("contractor_id");

-- CreateIndex
CREATE INDEX "escalations_status_idx" ON "escalations"("status");

-- CreateIndex
CREATE INDEX "escalations_priority_idx" ON "escalations"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_kpi_summaries_recruiter_id_key" ON "recruiter_kpi_summaries"("recruiter_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_recruiter_id_fkey" FOREIGN KEY ("created_by_recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_contractor_id_fkey" FOREIGN KEY ("created_by_contractor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_recruiter_id_fkey" FOREIGN KEY ("assigned_recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_claimed_by_recruiter_id_fkey" FOREIGN KEY ("claimed_by_recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_vendor_matches" ADD CONSTRAINT "lead_vendor_matches_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_vendor_matches" ADD CONSTRAINT "lead_vendor_matches_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_changed_by_recruiter_id_fkey" FOREIGN KEY ("changed_by_recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_flag_events" ADD CONSTRAINT "lead_flag_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_flag_events" ADD CONSTRAINT "lead_flag_events_set_by_recruiter_id_fkey" FOREIGN KEY ("set_by_recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_flag_events" ADD CONSTRAINT "lead_flag_events_confirmed_by_recruiter_id_fkey" FOREIGN KEY ("confirmed_by_recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_activity_logs" ADD CONSTRAINT "manual_activity_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_activity_logs" ADD CONSTRAINT "manual_activity_logs_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_score_snapshots" ADD CONSTRAINT "recruiter_score_snapshots_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_metric_snapshots" ADD CONSTRAINT "recruiter_metric_snapshots_score_snapshot_id_fkey" FOREIGN KEY ("score_snapshot_id") REFERENCES "recruiter_score_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_monthly_metrics" ADD CONSTRAINT "recruiter_monthly_metrics_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_demand" ADD CONSTRAINT "client_demand_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_demand_services" ADD CONSTRAINT "client_demand_services_client_demand_id_fkey" FOREIGN KEY ("client_demand_id") REFERENCES "client_demand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_queue_items" ADD CONSTRAINT "email_queue_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_queue_items" ADD CONSTRAINT "email_queue_items_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flag_events" ADD CONSTRAINT "user_flag_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flag_events" ADD CONSTRAINT "user_flag_events_set_by_recruiter_id_fkey" FOREIGN KEY ("set_by_recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_flag_events" ADD CONSTRAINT "user_flag_events_confirmed_by_recruiter_id_fkey" FOREIGN KEY ("confirmed_by_recruiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_assignments" ADD CONSTRAINT "contractor_assignments_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_assignments" ADD CONSTRAINT "contractor_assignments_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_kpi_summaries" ADD CONSTRAINT "recruiter_kpi_summaries_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
