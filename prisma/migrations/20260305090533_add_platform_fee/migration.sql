/*
  Warnings:

  - You are about to drop the column `memberPhone` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Dependent` table. All the data in the column will be lost.
  - Made the column `dateOfBirth` on table `Dependent` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "TxModule" AS ENUM ('SUREPOL_PREMIUM', 'CHURCH_TITHE', 'LMS_COURSE', 'EVENT_TICKET', 'RESTAURANT_BILL', 'RETAIL_ORDER');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- DropForeignKey
ALTER TABLE "Claim" DROP CONSTRAINT "Claim_memberPhone_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_phone_fkey";

-- DropIndex
DROP INDEX "Member_phone_key";

-- AlterTable
ALTER TABLE "Church" ADD COLUMN     "cipcDocUrl" TEXT,
ADD COLUMN     "directorIdsUrl" TEXT,
ADD COLUMN     "ficaStatus" TEXT NOT NULL DEFAULT 'LEVEL_1_PENDING',
ADD COLUMN     "npcRegUrl" TEXT,
ADD COLUMN     "pastorIdUrl" TEXT,
ADD COLUMN     "proofOfBankUrl" TEXT,
ADD COLUMN     "tosAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Claim" DROP COLUMN "memberPhone",
ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "causeOfDeath" TEXT,
ADD COLUMN     "claimantPhone" TEXT,
ADD COLUMN     "dateOfDeath" TIMESTAMP(3),
ADD COLUMN     "deceasedIdNumber" TEXT,
ADD COLUMN     "documentUrl" TEXT,
ADD COLUMN     "memberId" INTEGER;

-- AlterTable
ALTER TABLE "Dependent" DROP COLUMN "createdAt",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "dateOfBirth" SET NOT NULL,
ALTER COLUMN "dateOfBirth" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "collectionDay" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "description" TEXT,
ADD COLUMN     "memberId" INTEGER,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "platformFee" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "flagType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "bankDetails" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestForQuote" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredBy" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestForQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" SERIAL NOT NULL,
    "rfqId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "poNumber" TEXT NOT NULL,
    "churchId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "lineItems" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyPlan" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "planName" TEXT NOT NULL,
    "targetGroup" TEXT NOT NULL,
    "monthlyPremium" DOUBLE PRECISION NOT NULL,
    "benefitsSummary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joiningFee" DOUBLE PRECISION,
    "coverAmount" DOUBLE PRECISION,
    "maxMembers" INTEGER,

    CONSTRAINT "PolicyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAddon" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "addonName" TEXT NOT NULL,
    "monthlyCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "churchId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentUrl" TEXT,
    "dailyLessonText" TEXT,
    "quizQuestion" TEXT,
    "quizAnswer" TEXT,
    "quizExplanation" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "progress" INTEGER NOT NULL DEFAULT 1,
    "quizState" TEXT NOT NULL DEFAULT 'IDLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "phone" TEXT NOT NULL,
    "step" TEXT,
    "mode" TEXT,
    "data" JSONB DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "TransactionLedger" (
    "id" TEXT NOT NULL,
    "netcashRef" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "seabeFee" DOUBLE PRECISION,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "module" "TxModule" NOT NULL,
    "churchId" INTEGER NOT NULL,
    "collectionId" INTEGER,
    "eventId" INTEGER,
    "courseId" INTEGER,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "TransactionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePrice" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_modelName_recordId_idx" ON "AuditLog"("modelName", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionLedger_netcashRef_key" ON "TransactionLedger"("netcashRef");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionLedger_collectionId_key" ON "TransactionLedger"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePrice_code_key" ON "ServicePrice"("code");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestForQuote" ADD CONSTRAINT "RequestForQuote_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RequestForQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPlan" ADD CONSTRAINT "PolicyPlan_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAddon" ADD CONSTRAINT "PolicyAddon_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLedger" ADD CONSTRAINT "TransactionLedger_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
