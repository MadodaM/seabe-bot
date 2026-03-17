// routes/adminPricing.js
const express = require('express');
const router = express.Router();

module.exports = (app, { prisma }) => {
    
    // 📊 THE PRICING DASHBOARD
    router.get('/pricing', async (req, res) => {
        try {
            // Fetch all live prices from the database
            const prices = await prisma.servicePrice.findMany({
                orderBy: { code: 'asc' }
            });

            // Calculate some quick stats for the header
            const platformFees = prices.filter(p => p.code.includes('MOD_'));
            const gatewayFees = prices.filter(p => p.code.includes('TX_'));

            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script src="https://cdn.tailwindcss.com"></script>
                <title>Seabe Pay | Pricing Engine</title>
                <style>
                    body { background-color: #f8fafc; font-family: 'Inter', sans-serif; }
                    .glass { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); }
                </style>
            </head>
            <body class="p-4 md:p-8">
                <div class="max-w-5xl mx-auto">
                    <!-- Header -->
                    <div class="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                        <div>
                            <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight">Pricing Engine</h1>
                            <p class="text-slate-500 font-medium">Manage Seabe Pay platform fees and gateway variables.</p>
                        </div>
                        <div class="flex gap-2">
                            <span class="bg-teal-100 text-teal-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Live Production</span>
                            <span class="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">${prices.length} Variables</span>
                        </div>
                    </div>

                    <!-- Stats Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                        <div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                            <div class="text-slate-400 text-xs font-bold uppercase mb-2">Platform Flat Fee</div>
                            <div class="text-3xl font-black text-teal-600">R${prices.find(p => p.code === 'MOD_STANDARD_FLAT')?.amount || '0.00'}</div>
                        </div>
                        <div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                            <div class="text-slate-400 text-xs font-bold uppercase mb-2">Avg. Card Rate</div>
                            <div class="text-3xl font-black text-slate-800">${(prices.find(p => p.code === 'TX_CARD_RT_PCT')?.amount * 100 || 0).toFixed(2)}%</div>
                        </div>
                        <div class="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                            <div class="text-slate-400 text-xs font-bold uppercase mb-2">Active Modules</div>
                            <div class="text-3xl font-black text-slate-800">${platformFees.length}</div>
                        </div>
                    </div>

                    <!-- Pricing Table -->
                    <div class="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="bg-slate-50 border-bottom border-slate-100">
                                    <th class="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Pricing Code</th>
                                    <th class="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Description</th>
                                    <th class="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                                ${prices.map(p => `
                                    <tr class="hover:bg-slate-50 transition-colors cursor-pointer group">
                                        <td class="px-6 py-4">
                                            <code class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md group-hover:bg-teal-50 group-hover:text-teal-700 transition-colors">${p.code}</code>
                                        </td>
                                        <td class="px-6 py-4">
                                            <div class="text-sm font-semibold text-slate-700">${p.description || 'System standard variable'}</div>
                                        </td>
                                        <td class="px-6 py-4 text-right">
                                            <span class="text-sm font-black ${p.code.includes('PCT') ? 'text-indigo-600' : 'text-slate-900'}">
                                                ${p.code.includes('PCT') ? (p.amount * 100).toFixed(2) + '%' : 'R' + parseFloat(p.amount).toFixed(2)}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="mt-8 text-center">
                        <p class="text-slate-400 text-xs font-medium uppercase tracking-widest">© 2026 Seabe Digital Pay Engine • Secured by AES-256</p>
                    </div>
                </div>
            </body>
            </html>
            `);
        } catch (error) {
            console.error("Dashboard Error:", error);
            res.status(500).send("<h1>Dashboard Error</h1><p>" + error.message + "</p>");
        }
    });

    app.use('/', router);
};