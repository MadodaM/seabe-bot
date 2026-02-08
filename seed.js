const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting safe seed...');

  // 1. Upsert Standard Church
  const church = await prisma.church.upsert({
    where: { code: 'AFM001' },
    update: {}, // If exists, do nothing
    create: {
      name: 'AFM Life in Christ',
      code: 'AFM001',
      subaccountCode: 'ACCT_12345',
      email: 'madoda.mavuso@gmail.com',
      type: 'CHURCH',
      status: 'Active',
      subscriptionFee: 0.00
    },
  });
  console.log(`✅ Verified Church: ${church.name}`);

  // 2. Upsert Burial Society
  const society = await prisma.church.upsert({
    where: { code: 'KOP001' },
    update: {},
    create: {
      name: 'Kopanang Burial Society',
      code: 'KOP001',
      subaccountCode: 'ACCT_67890',
      email: 'madoda@seabe.co.za',
      type: 'BURIAL_SOCIETY',
      status: 'Active',
      subscriptionFee: 150.00
    },
  });
  console.log(`✅ Verified Society: ${society.name}`);

  // 3. Upsert Member
  // We use 'phone' as the unique key
  const member = await prisma.member.upsert({
    where: { phone: '27123456789' },
    update: { 
        churchCode: society.code,
        // Ensure we don't overwrite name if it exists, or update if needed
    },
    create: {
      firstName: 'Thabo',
      lastName: 'Molefe',
      phone: '27832182707',
      churchCode: society.code,
      status: 'ACTIVE',
      policyNumber: 'POL-998877',
      joinedAt: new Date()
    }
  });
  console.log(`✅ Verified Member: ${member.firstName}`);
  
  // 4. Create Dependent (Only if not exists)
  const existingDependent = await prisma.dependent.findFirst({
      where: { memberId: member.id, firstName: 'Lerato' }
  });

  if (!existingDependent) {
      await prisma.dependent.create({
        data: {
          firstName: 'Lerato',
          lastName: 'Molefe',
          relation: 'Spouse',
          memberId: member.id,
          dateOfBirth: new Date('1990-01-01') // Optional DOB
        }
      });
      console.log(`✅ Created Dependent: Lerato`);
  } else {
      console.log(`🔹 Dependent already exists.`);
  }

} // <--- This closing brace was likely missing or misplaced!

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });