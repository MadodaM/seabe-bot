const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding production data...');

  // 1. Seed a Church
  const church = await prisma.church.upsert({
    where: { 
      code: 'CH-001' // Using code because name isn't unique
    },
    update: {},
    create: {
      code: 'CH-001',
      name: 'Test Church A',
      type: 'Standard',
      // adminPhone: '0123456789', // Add if required by your schema
    },
  });
  console.log('✅ Church seeded:', church.name);

  // 2. Seed a Burial Society
  // Note: If you have a separate 'BurialSociety' model, change 'prisma.church' 
  // to 'prisma.burialSociety'. Otherwise, use 'type' to distinguish them.
  const society = await prisma.church.upsert({
    where: { 
      code: 'BS-001' 
    },
    update: {},
    create: {
      code: 'BS-001',
      name: 'Test Burial Society A',
      type: 'Society', 
    },
  });
  console.log('✅ Society seeded:', society.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });