const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🛠️ Repairing Admin Access...");

  // 1. Ensure the Church exists
  const church = await prisma.church.upsert({
    where: { code: 'AFM01' },
    update: { type: 'CHURCH' }, // Ensure it's set to Church for your testing
    create: {
      code: 'AFM01',
      name: 'AFM Church',
      type: 'CHURCH',
      adminPhone: '+27832182707'
    }
  });

  // 2. Authorize your phone number in the Admin table
  await prisma.admin.upsert({
    where: { phone: '+27832182707' },
    update: { churchId: church.id, role: 'OWNER' },
    create: {
      phone: '+27832182707',
      name: 'Madoda',
      role: 'OWNER',
      churchId: church.id
    }
  });

  console.log("✅ Success! +27832182707 is now an authorized Admin for AFM01.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());