/*
  Warnings:

  - You are about to alter the column `price` on the `Course` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to drop the `CourseModule` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT "Course_churchId_fkey";

-- DropForeignKey
ALTER TABLE "CourseModule" DROP CONSTRAINT "CourseModule_courseId_fkey";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "churchId" DROP NOT NULL,
ALTER COLUMN "price" SET DEFAULT 0.0,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Enrollment" ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
ALTER COLUMN "progress" SET DEFAULT 0,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "netSettlement" DOUBLE PRECISION,
ADD COLUMN     "netcashFee" DOUBLE PRECISION,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- DropTable
DROP TABLE "CourseModule";

-- CreateTable
CREATE TABLE "Module" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "dailyLessonText" TEXT,
    "quizQuestion" TEXT,
    "quizAnswer" TEXT,
    "contentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceLog" (
    "id" TEXT NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "isPepFound" BOOLEAN NOT NULL DEFAULT false,
    "isSanctionHit" BOOLEAN NOT NULL DEFAULT false,
    "isCtrTriggered" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeConfiguration" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "baseFee" DOUBLE PRECISION NOT NULL,
    "percentFee" DOUBLE PRECISION NOT NULL,
    "seabeFixed" DOUBLE PRECISION NOT NULL DEFAULT 5.00,
    "seabePercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceLog_transactionId_key" ON "ComplianceLog"("transactionId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLog" ADD CONSTRAINT "ComplianceLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
