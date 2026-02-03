-- CreateTable
CREATE TABLE "Church" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "subaccountCode" TEXT NOT NULL DEFAULT 'PENDING',
    "tosAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Church_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "churchCode" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "churchCode" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "expiryDate" TIMESTAMP(3),
    "churchCode" TEXT NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'Global',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" SERIAL NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "target" TEXT NOT NULL DEFAULT 'Global',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Church_code_key" ON "Church"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Member_phone_key" ON "Member"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_churchCode_fkey" FOREIGN KEY ("churchCode") REFERENCES "Church"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_churchCode_fkey" FOREIGN KEY ("churchCode") REFERENCES "Church"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_churchCode_fkey" FOREIGN KEY ("churchCode") REFERENCES "Church"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
