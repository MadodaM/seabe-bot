/*
  Warnings:

  - You are about to drop the column `target` on the `Ad` table. All the data in the column will be lost.
  - You are about to drop the column `text` on the `Ad` table. All the data in the column will be lost.
  - You are about to drop the column `tosAcceptedAt` on the `Church` table. All the data in the column will be lost.
  - You are about to drop the column `target` on the `News` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[kycToken]` on the table `Member` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `churchId` to the `Ad` table without a default value. This is not possible if the table is not empty.
  - Added the required column `content` to the `Ad` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Church` table without a default value. This is not possible if the table is not empty.
  - Made the column `expiryDate` on table `Event` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `firstName` to the `Member` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `Member` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('CHURCH', 'BURIAL_SOCIETY', 'NON_PROFIT');

-- DropForeignKey
ALTER TABLE "Member" DROP CONSTRAINT "Member_churchCode_fkey";

-- AlterTable
ALTER TABLE "Ad" DROP COLUMN "target",
DROP COLUMN "text",
ADD COLUMN     "churchId" INTEGER NOT NULL,
ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Church" DROP COLUMN "tosAcceptedAt",
ADD COLUMN     "adminPhone" TEXT,
ADD COLUMN     "defaultPremium" DOUBLE PRECISION DEFAULT 150.0,
ADD COLUMN     "otp" TEXT,
ADD COLUMN     "otpExpires" TIMESTAMP(3),
ADD COLUMN     "subscriptionFee" DOUBLE PRECISION DEFAULT 0.0,
ADD COLUMN     "type" TEXT NOT NULL,
ALTER COLUMN "subaccountCode" DROP NOT NULL,
ALTER COLUMN "subaccountCode" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDonation" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "expiryDate" SET NOT NULL;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "address" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idPhotoUrl" TEXT,
ADD COLUMN     "idType" TEXT DEFAULT 'SA_ID',
ADD COLUMN     "isIdVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "kycToken" TEXT,
ADD COLUMN     "kycTokenExpires" TIMESTAMP(3),
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "monthlyPremium" DOUBLE PRECISION,
ADD COLUMN     "policyNumber" TEXT,
ADD COLUMN     "proofOfAddressUrl" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "societyCode" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ALTER COLUMN "churchCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "News" DROP COLUMN "target",
ADD COLUMN     "churchId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "status" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Dependent" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" SERIAL NOT NULL,
    "churchCode" TEXT NOT NULL,
    "memberPhone" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "payoutAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "churchId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" SERIAL NOT NULL,
    "churchCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memberId" INTEGER,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_phone_key" ON "Admin"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Member_kycToken_key" ON "Member"("kycToken");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_churchCode_fkey" FOREIGN KEY ("churchCode") REFERENCES "Church"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_societyCode_fkey" FOREIGN KEY ("societyCode") REFERENCES "Church"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_phone_fkey" FOREIGN KEY ("phone") REFERENCES "Member"("phone") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_churchCode_fkey" FOREIGN KEY ("churchCode") REFERENCES "Church"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_memberPhone_fkey" FOREIGN KEY ("memberPhone") REFERENCES "Member"("phone") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
