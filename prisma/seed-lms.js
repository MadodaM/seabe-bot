const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("⏳ Seeding database with LMS Course Data...");

    // 1. Ensure the Organization exists (TFBS)
    const tfbs = await prisma.church.upsert({
        where: { code: 'TFBS' },
        update: {},
        create: { name: 'Thuso Fund Burial Society', code: 'TFBS', type: 'BURIAL_SOCIETY' }
    });

    // 2. Clear old LMS data to prevent duplicates if you run this twice
    await prisma.enrollment.deleteMany({});
    await prisma.courseModule.deleteMany({});
    await prisma.course.deleteMany({});

    // 3. Create a Paid Mentorship Course
    const mentorshipCourse = await prisma.course.create({
        data: {
            churchId: tfbs.id,
            title: 'Financial Stewardship & Wealth Mentorship',
            description: 'A complete guide to managing finances, eradicating debt, and building generational wealth.',
            price: 200, // R200
        }
    });

    // 4. Create a Free Community Course
    const freeCourse = await prisma.course.create({
        data: {
            churchId: tfbs.id,
            title: 'Community Leadership Foundation',
            description: 'Basic leadership principles for community and society leaders.',
            price: 0, // Free
        }
    });

    // 5. Inject the Modules (The actual content)
    await prisma.courseModule.createMany({
        data: [
            // Paid Course Modules
            {
                courseId: mentorshipCourse.id,
                title: 'Module 1: The Foundation of Stewardship',
                contentUrl: 'https://seabe.tech/assets/mentorship-module-1.pdf', // Example link
                order: 1
            },
            {
                courseId: mentorshipCourse.id,
                title: 'Module 2: Eradicating Debt',
                contentUrl: 'https://seabe.tech/assets/mentorship-module-2.pdf',
                order: 2
            },
            // Free Course Modules
            {
                courseId: freeCourse.id,
                title: 'Module 1: Servant Leadership',
                contentUrl: 'https://seabe.tech/assets/leadership-module-1.pdf',
                order: 1
            }
        ]
    });

    console.log("✅ LMS Database successfully seeded with Courses and Modules!");
}

main()
    .catch(e => {
        console.error("❌ Seed Error:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });