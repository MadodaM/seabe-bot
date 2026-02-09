// ==========================================
// SEABE SEED SCRIPT (TEST DATA)
// ==========================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Database Seed...');

  // 1. CLEANUP (Delete old data to avoid conflicts)
  // Order matters: Delete children first (Dependents), then Parents (Members), then Orgs
  await prisma.dependent.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.news.deleteMany({});
  await prisma.ad.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.church.deleteMany({});
  
  console.log('🧹 Cleaned up old data.');

  // 2. CREATE ORGANIZATIONS
  
  // -- Organization A: The Church --
  const afm = await prisma.church.create({
    data: {
      code: 'AFM001',
      name: 'AFM Life in Christ',
      type: 'CHURCH',
      email: 'pastor@afm.org',
      subaccountCode: 'ACCT_12345', // Fake Paystack Code
      subscriptionFee: 0.0
    }
  });

  // -- Organization B: The Burial Society --
  const kopanang = await prisma.church.create({
    data: {
      code: 'KOP001',
      name: 'Kopanang Burial Society',
      type: 'BURIAL_SOCIETY',
      email: 'admin@kopanang.org',
      subaccountCode: 'ACCT_67890', // Fake Paystack Code
      subscriptionFee: 150.00
    }
  });

  console.log('✅ Created Organizations: AFM & Kopanang');

  // 3. CREATE MEMBERS (Different Scenarios)

  // -- User 1: Church Member ONLY --
  // Use this phone to test "Hi" (works) and "Society" (fails)
  await prisma.member.create({
    data: {
      phone: '27821111111', 
      firstName: 'John',
      lastName: 'Churchman',
      churchCode: afm.code,
      societyCode: null, // No Society
      status: 'ACTIVE'
    }
  });

  // -- User 2: Society Member ONLY --
  // Use this phone to test "Society" (works) and "Hi" (fails/search)
  const societyUser = await prisma.member.create({
    data: {
      phone: '27822222222',
      firstName: 'Mary',
      lastName: 'Societylady',
      churchCode: null, // No Church
      societyCode: kopanang.code,
      policyNumber: 'POL-998877',
      status: 'ACTIVE'
    }
  });

  // -- User 3: DUAL MEMBER (The "Super User") --
  // Use this phone to test BOTH bots working side-by-side
  await prisma.member.create({
    data: {
      phone: '27832182707', // <--- YOUR NUMBER (For easy testing)
      firstName: 'Neo',
      lastName: 'Matrix',
      churchCode: afm.code,
      societyCode: kopanang.code,
      policyNumber: 'POL-000001',
      status: 'ACTIVE'
    }
  });

  console.log('✅ Created Test Members (John, Mary, Neo)');

  // 4. CREATE DEPENDENTS (For Society User)
  await prisma.dependent.create({
    data: {
      firstName: 'Little',
      lastName: 'Societylady',
      relation: 'Child',
      memberId: societyUser.id
    }
  });
  
  console.log('✅ Added Dependents');

  // 5. CREATE CHURCH CONTENT (Events, News, Ads)
  
  // Event
  await prisma.event.create({
    data: {
      churchCode: afm.code,
      name: 'Worship Night',
      date: new Date('2025-12-25'),
      price: 50.00,
      description: 'A night of praise.',
      status: 'Active',
      expiryDate: new Date('2026-01-01')
    }
  });

  // News
  await prisma.news.create({
    data: {
      headline: 'Building Project Update',
      body: 'We have reached 50% of our goal!',
      status: 'Active',
      expiryDate: new Date('2026-01-01')
    }
  });

  // Ad
  await prisma.ad.create({
    data: {
      churchId: afm.id,
      content: 'Buy 1 Get 1 Free at Joe\'s Pizza! 🍕',
      status: 'Active',
      expiryDate: new Date('2026-01-01')
    }
  });

  console.log('✅ Created Content (Events, News, Ads)');
  console.log('🌱 Seed Completed Successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });