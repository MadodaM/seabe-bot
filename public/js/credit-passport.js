// public/js/credit-passport.js
// Frontend Logic for the Zero-Knowledge Credit Passport UI

// --- 1. State & Mock Data ---
const members = [
    { id: "M-8492", name: "Thabo Ndlovu", history: 36, avg: 2500, status: "Eligible" },
    { id: "M-1102", name: "Sipho Khumalo", history: 12, avg: 1500, status: "Ineligible" },
    { id: "M-9931", name: "Lerato Mokoena", history: 48, avg: 3000, status: "Eligible" }
];

// --- 2. Initialize Table ---
function renderTable() {
    const tbody = document.getElementById('member-tbody');
    tbody.innerHTML = '';
    
    members.forEach(m => {
        const statusHtml = m.status === 'Eligible' 
            ? '<span class="px-2 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700">Eligible</span>'
            : '<span class="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700">Ineligible</span>';
        
        const btnHtml = m.status === 'Eligible'
            ? `<button onclick="generatePassport('${m.id}')" class="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium py-2 px-4 rounded-lg shadow-sm transition-all flex items-center space-x-2 ml-auto"><i class="ph-bold ph-file-text text-base"></i><span>Generate Passport</span></button>`
            : `<button disabled class="bg-slate-300 cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center space-x-2 ml-auto"><i class="ph-bold ph-file-text text-base"></i><span>Generate Passport</span></button>`;

        tbody.innerHTML += `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="p-4 flex items-center space-x-3">
                    <div class="bg-slate-200 p-2 rounded-full"><i class="ph-fill ph-user text-slate-600"></i></div>
                    <span class="font-medium">${m.name}</span>
                </td>
                <td class="p-4 text-slate-600">${m.history} Months</td>
                <td class="p-4 text-slate-600">R ${m.avg}</td>
                <td class="p-4">${statusHtml}</td>
                <td class="p-4 text-right">${btnHtml}</td>
            </tr>
        `;
    });
}

// --- 3. View Switchers ---
function switchTab(tab) {
    document.getElementById('tab-dashboard').classList.toggle('hidden', tab !== 'dashboard');
    document.getElementById('tab-verify').classList.toggle('hidden', tab !== 'verify');
    
    const navDash = document.getElementById('nav-dashboard');
    const navVer = document.getElementById('nav-verify');
    
    if(tab === 'dashboard') {
        navDash.className = "px-3 py-1 rounded transition-colors bg-slate-800 text-emerald-400";
        navVer.className = "px-3 py-1 rounded transition-colors hover:text-emerald-300";
        showTable();
    } else {
        navDash.className = "px-3 py-1 rounded transition-colors hover:text-emerald-300";
        navVer.className = "px-3 py-1 rounded transition-colors bg-slate-800 text-emerald-400";
        resetVerify();
    }
}

function showTable() {
    document.getElementById('view-table').classList.remove('hidden');
    document.getElementById('view-pdf').classList.add('hidden');
}

function generatePassport(id) {
    const member = members.find(m => m.id === id);
    
    // Populate PDF visual
    document.getElementById('pdf-name').innerText = member.name;
    document.getElementById('pdf-history').innerText = member.history + ' Mos';
    document.getElementById('pdf-avg').innerText = 'R ' + member.avg;
    
    // Generate the mock JWT token
    const mockJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.seabe_zk_proof_m${member.id}_h${member.history}_a${member.avg}.signature_hash_8f92a1`;
    document.getElementById('pdf-token').innerText = mockJwt;

    // Switch views
    document.getElementById('view-table').classList.add('hidden');
    document.getElementById('view-pdf').classList.remove('hidden');
}

// --- 4. Bank Verify Logic ---
function checkInput() {
    const val = document.getElementById('verify-textarea').value;
    document.getElementById('verify-btn').disabled = val.trim() === '';
}

function processVerification() {
    const val = document.getElementById('verify-textarea').value;
    const btn = document.getElementById('verify-btn');
    
    // Show loading state
    btn.innerHTML = `<i class="ph-bold ph-spinner animate-spin text-xl"></i><span>Verifying...</span>`;
    
    setTimeout(() => {
        document.getElementById('verify-input-screen').classList.add('hidden');
        
        // Simple validation check for the mock
        if (val.includes('seabe_zk_proof')) {
            document.getElementById('verify-success-screen').classList.remove('hidden');
        } else {
            document.getElementById('verify-fail-screen').classList.remove('hidden');
        }
        
        // Reset button state
        btn.innerHTML = `<i class="ph-bold ph-magnifying-glass text-xl"></i><span>Verify Cryptographic Signature</span>`;
    }, 800);
}

function resetVerify() {
    document.getElementById('verify-textarea').value = '';
    document.getElementById('verify-btn').disabled = true;
    document.getElementById('verify-input-screen').classList.remove('hidden');
    document.getElementById('verify-success-screen').classList.add('hidden');
    document.getElementById('verify-fail-screen').classList.add('hidden');
}

// --- 5. Boot up ---
document.addEventListener('DOMContentLoaded', () => {
    renderTable();
});