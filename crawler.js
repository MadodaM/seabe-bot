const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// 📍 Array of Apostolic Faith Mission (AFM/AGS) Targets
// Note: You can add specific regional AFM assembly links here as you find them
const targetURLs = [
    { url: "https://afm-ags.org/assemblies/", denom: "AFM National" },
    { url: "https://afm-ags.org/contact-us/", denom: "AFM Head Office" },
    // You can add regional or mega-assembly links here, e.g.:
    // { url: "https://afm-impact.org/contact/", denom: "AFM Impact" }
];

// 📱 Helper to format SA numbers for WhatsApp (+27 format)
function cleanPhone(phoneText) {
    if (!phoneText) return "N/A";
    const clean = phoneText.replace(/\D/g, '');
    return clean.length >= 9 ? '27' + clean.slice(-9) : clean;
}

// 📍 Helper to extract City/Province based on SA Postal Codes
function extractLocation(text) {
    const locationMatch = text.match(/([A-Z][a-zA-Z\s]+)\s+(\d{4})/);
    return locationMatch ? `${locationMatch[1].trim()}, South Africa` : "South Africa";
}

async function runAFMCrawler() {
    console.log("🚀 Starting Seabe AFM-Specific Crawler for South Africa...");
    let allLeads = [];

    for (const target of targetURLs) {
        console.log(`\n🔍 Scraping AFM Directory: ${target.denom}`);
        try {
            const response = await axios.get(target.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SeabeBot/3.0' },
                timeout: 20000 
            });
            
            const $ = cheerio.load(response.data);
            
            $('tr, li, p, div, address').each((i, element) => {
                const text = $(element).text().replace(/\s+/g, ' ').trim();
                
                // 1. Title Regex (AFM leaders often use Dr, Pastor, Pastoor, Ds)
                const nameMatch = text.match(/(Pastor|Pastoor|Past|Ps|Dr|Prof|Ds|Evangelist)\.?\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
                
                // 2. Phone & Email Regex
                const phoneMatch = text.match(/(\+27|0)\d{2}[\s-]?\d{3}[\s-]?\d{4}/);
                const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                
                // 3. AFM-Specific Church Name Extraction
                // Looks for "AFM Word and Life", "AGS Brakpan", "Apostolic Faith Mission"
                const churchMatch = text.match(/(AFM|AGS|Apostolic Faith Mission)\s+([A-Z][a-zA-Z\s]+(Assembly|Gemeente|Church|Ministries)?)/i);
                
                // 4. Look for 2026 Event Dates (AFM National Conferences, Easter weekend, etc.)
                const eventDateMatch = text.match(/\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+2026/i);

                if (nameMatch && (phoneMatch || emailMatch)) {
                    allLeads.push({
                        firstName: nameMatch[2],
                        surname: nameMatch[3],
                        churchName: churchMatch ? churchMatch[0].trim() : target.denom,
                        phone: phoneMatch ? cleanPhone(phoneMatch[0]) : "N/A",
                        email: emailMatch ? emailMatch[0] : "N/A",
                        address: extractLocation(text),
                        eventName: eventDateMatch ? "AFM 2026 Event" : "Check Assembly Site",
                        eventDate: eventDateMatch ? eventDateMatch[0] : "Ongoing 2026"
                    });
                }
            });
        } catch (error) {
            console.error(`❌ Failed to scrape ${target.denom}: ${error.message} (Site might block bots or be offline)`);
        }
    }

    // 🧹 Clean Data: Remove duplicate pastors
    const uniqueLeads = Array.from(new Set(allLeads.map(a => a.phone !== "N/A" ? a.phone : a.email)))
        .map(id => allLeads.find(a => a.phone === id || a.email === id))
        .filter(Boolean);

    // 💾 Export to CSV
    if (uniqueLeads.length > 0) {
        const csvHeader = "First Name,Surname,Church Name,Phone,Email,Address,Event Name,Event Date\n";
        const csvRows = uniqueLeads.map(lead => 
            `"${lead.firstName}","${lead.surname}","${lead.churchName}","${lead.phone}","${lead.email}","${lead.address}","${lead.eventName}","${lead.eventDate}"`
        ).join('\n');
        
        fs.writeFileSync('AFM_Pastors_SouthAfrica_2026.csv', csvHeader + csvRows, 'utf8');
        console.log(`\n✅ Done! Successfully saved ${uniqueLeads.length} unique AFM pastors to AFM_Pastors_SouthAfrica_2026.csv!`);
    } else {
        console.log("\n⚠️ No leads found. You may need to add specific AFM assembly URLs to the targetURLs array.");
    }
}

runAFMCrawler();