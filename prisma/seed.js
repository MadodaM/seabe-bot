const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Seed...');

  // 1. Create the Church
  const church = await prisma.church.upsert({
    where: { code: 'AFM01' },
    update: {},
    create: {
      code: 'AFM01',
      name: 'AFM - Life in Christ',
      subaccountCode: 'ACCT_xxxxxxxxxxxx',
      adminPhone: '27831234567',
      type: 'CHURCH' 
    },
  });
  console.log(`✅ Church Created: ${church.name}`);

  // 2. Create the Society
  const society = await prisma.church.upsert({
    where: { code: 'SIYA01' },
    update: {},
    create: {
      code: 'SIYA01',
      name: 'Siyakhula Burial Society',
      subaccountCode: 'ACCT_yyyyyyyyyyyy',
      adminPhone: '27831234567',
      type: 'BURIAL_SOCIETY' 
    },
  });
  console.log(`✅ Society Created: ${society.name}`);

  // 3. Create a Test Member
  // I removed 'monthlyPremium' and 'societyCode' to match your schema's current state
  const member = await prisma.member.upsert({
    where: { phone: '27831234567' },
    update: {},
    create: {
      phone: '27831234567',
      firstName: 'Test',
      lastName: 'Member',
      status: 'ACTIVE',
      policyNumber: 'POL-999',
      churchCode: 'AFM01' // Assuming this is how you link them
    },
  });
  console.log(`✅ Member Created: ${member.firstName}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed Error:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });