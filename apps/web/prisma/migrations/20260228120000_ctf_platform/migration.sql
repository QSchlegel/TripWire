-- CreateEnums
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ChallengeTheme" AS ENUM ('devops', 'wallet', 'support');
CREATE TYPE "ChallengeMode" AS ENUM ('vulnerable', 'hardened');
CREATE TYPE "ChallengeSessionInputType" AS ENUM ('chat', 'tool', 'mixed');
CREATE TYPE "ChallengeSessionStatus" AS ENUM ('active', 'solved', 'archived');
CREATE TYPE "AttemptSource" AS ENUM ('chat', 'tool');
CREATE TYPE "ModerationStatus" AS ENUM ('clean', 'blocked');
CREATE TYPE "DecisionStatus" AS ENUM ('allow', 'require_approval', 'block', 'blocked_by_moderation', 'error');
CREATE TYPE "ChallengeGoalType" AS ENUM ('flag_exfiltration', 'blocked_action_bypass');
CREATE TYPE "LeaderboardScope" AS ENUM ('THEME_MODE', 'GLOBAL');
CREATE TYPE "RlCandidateStatus" AS ENUM ('pending', 'approved', 'rejected', 'applied');
CREATE TYPE "RlCandidateType" AS ENUM ('prompt_patch', 'policy_patch', 'combined');

-- CreateTable
CREATE TABLE "Profile" (
  "id" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "isTrainingOptOut" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChallengeSession" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "theme" "ChallengeTheme" NOT NULL,
  "mode" "ChallengeMode" NOT NULL,
  "inputType" "ChallengeSessionInputType" NOT NULL,
  "status" "ChallengeSessionStatus" NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "dailyFlagVersion" TEXT NOT NULL,
  CONSTRAINT "ChallengeSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChallengeAttempt" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "source" "AttemptSource" NOT NULL,
  "requestId" TEXT NOT NULL,
  "redactedPayload" JSONB NOT NULL,
  "rawPayloadHash" TEXT NOT NULL,
  "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'clean',
  "moderationReason" TEXT,
  "decisionStatus" "DecisionStatus" NOT NULL,
  "decisionTrace" JSONB,
  "executionStatus" TEXT,
  "challengeMeta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChallengeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChallengeOutcome" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "theme" "ChallengeTheme" NOT NULL,
  "mode" "ChallengeMode" NOT NULL,
  "goalType" "ChallengeGoalType" NOT NULL,
  "solvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "solveMs" INTEGER NOT NULL,
  "verificationData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChallengeOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderboardEntry" (
  "id" TEXT NOT NULL,
  "scope" "LeaderboardScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "theme" "ChallengeTheme",
  "mode" "ChallengeMode",
  "solvedAt" TIMESTAMP(3) NOT NULL,
  "solveMs" INTEGER NOT NULL,
  "goalType" "ChallengeGoalType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RlDatasetSnapshot" (
  "id" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL,
  "successCount" INTEGER NOT NULL,
  "blockedCount" INTEGER NOT NULL,
  "aggregateMetrics" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RlDatasetSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RlCandidate" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT,
  "candidateType" "RlCandidateType" NOT NULL,
  "status" "RlCandidateStatus" NOT NULL DEFAULT 'pending',
  "promptDiff" JSONB,
  "policyDiff" JSONB,
  "offlineMetrics" JSONB NOT NULL,
  "hackSuccessDelta" DOUBLE PRECISION NOT NULL,
  "legitCompletionDrop" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewReason" TEXT,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "RlCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RlDeployment" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "configVersion" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousDeploymentId" TEXT,
  CONSTRAINT "RlDeployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitCounter" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile"("handle");
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_profileId_status_idx" ON "ApiKey"("profileId", "status");
CREATE INDEX "ChallengeSession_profileId_startedAt_idx" ON "ChallengeSession"("profileId", "startedAt");
CREATE INDEX "ChallengeSession_theme_mode_startedAt_idx" ON "ChallengeSession"("theme", "mode", "startedAt");
CREATE INDEX "ChallengeAttempt_sessionId_createdAt_idx" ON "ChallengeAttempt"("sessionId", "createdAt");
CREATE INDEX "ChallengeAttempt_profileId_createdAt_idx" ON "ChallengeAttempt"("profileId", "createdAt");
CREATE INDEX "ChallengeAttempt_decisionStatus_createdAt_idx" ON "ChallengeAttempt"("decisionStatus", "createdAt");
CREATE UNIQUE INDEX "ChallengeOutcome_sessionId_goalType_key" ON "ChallengeOutcome"("sessionId", "goalType");
CREATE INDEX "ChallengeOutcome_profileId_theme_mode_solvedAt_idx" ON "ChallengeOutcome"("profileId", "theme", "mode", "solvedAt");
CREATE UNIQUE INDEX "LeaderboardEntry_scopeKey_key" ON "LeaderboardEntry"("scopeKey");
CREATE INDEX "LeaderboardEntry_scope_theme_mode_solveMs_solvedAt_idx" ON "LeaderboardEntry"("scope", "theme", "mode", "solveMs", "solvedAt");
CREATE INDEX "LeaderboardEntry_scope_solveMs_solvedAt_idx" ON "LeaderboardEntry"("scope", "solveMs", "solvedAt");
CREATE INDEX "RlDatasetSnapshot_windowStart_windowEnd_idx" ON "RlDatasetSnapshot"("windowStart", "windowEnd");
CREATE INDEX "RlCandidate_status_createdAt_idx" ON "RlCandidate"("status", "createdAt");
CREATE UNIQUE INDEX "RlDeployment_configVersion_key" ON "RlDeployment"("configVersion");
CREATE INDEX "RlDeployment_isActive_activatedAt_idx" ON "RlDeployment"("isActive", "activatedAt");
CREATE UNIQUE INDEX "RateLimitCounter_key_key" ON "RateLimitCounter"("key");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeSession" ADD CONSTRAINT "ChallengeSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeAttempt" ADD CONSTRAINT "ChallengeAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChallengeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeAttempt" ADD CONSTRAINT "ChallengeAttempt_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeOutcome" ADD CONSTRAINT "ChallengeOutcome_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChallengeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeOutcome" ADD CONSTRAINT "ChallengeOutcome_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RlCandidate" ADD CONSTRAINT "RlCandidate_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RlDatasetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RlDeployment" ADD CONSTRAINT "RlDeployment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RlCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
