import { db, auth } from "./firebase-config.js";
import { collection, getDocs, query, where, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { seedDatabase } from "./seed.js";

// DOM Elements
const merchantsGrid = document.getElementById('merchants-grid');
const loginBtn = document.getElementById('login-btn');
const authModal = document.getElementById('auth-modal');
const bookingModal = document.getElementById('booking-modal');
const bookingModalBody = document.getElementById('booking-modal-body');
const seedBtn = document.getElementById('seed-btn');
const filterChips = document.querySelectorAll('.filter-chip');

// State
let allMerchants = [];
let currentFilter = 'all';
let currentUser = null;

// Initialization
async function init() {
    setupEventListeners();
    await loadMerchants();
}

function setupEventListeners() {
    // Dashboard Switching
    window.switchDashboard = (role) => {
        document.querySelectorAll('main').forEach(el => el.style.display = 'none');
        document.getElementById(`dashboard-${role}`).style.display = 'block';
        
        document.querySelectorAll('.dev-btn').forEach(btn => btn.classList.remove('active'));
        // Find the button that called this (approximated)
        const btns = Array.from(document.querySelectorAll('.dev-btn'));
        const targetBtn = btns.find(b => b.innerText.toLowerCase().includes(role));
        if (targetBtn) targetBtn.classList.add('active');
    };

    // Login Modal
    if (loginBtn) {
        loginBtn.onclick = () => authModal.style.display = 'flex';
    }

    // Close Modals
    document.querySelectorAll('.close, .close-booking').forEach(btn => {
        btn.onclick = () => {
            authModal.style.display = 'none';
            bookingModal.style.display = 'none';
        };
    });

    // Seed DB
    if (seedBtn) {
        seedBtn.onclick = async () => {
            if(confirm("This will add sample data to your Firestore. Continue?")) {
                seedBtn.disabled = true;
                seedBtn.textContent = "Seeding...";
                await seedDatabase();
                seedBtn.textContent = "Done";
                seedBtn.disabled = false;
                loadMerchants(); // Reload
            }
        };
    }

    // Filters
    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.type;
            renderMerchants();
        });
    });

    // Auth Form (Simulation for Prototype)
    const authForm1 = document.getElementById('auth-form-step-1');
    const authForm2 = document.getElementById('auth-form-step-2');
    
    if (authForm1) {
        authForm1.onsubmit = (e) => {
            e.preventDefault();
            // Simulate sending code
            const name = document.getElementById('auth-name').value;
            const phone = document.getElementById('auth-phone').value;
            localStorage.setItem('temp_user', JSON.stringify({ name, phone, role: 'customer' }));
            
            authForm1.style.display = 'none';
            authForm2.style.display = 'block';
        };
    }

    if (authForm2) {
        authForm2.onsubmit = (e) => {
            e.preventDefault();
            const code = document.getElementById('auth-code').value;
            if (code === '123456') { // Mock verification
                const user = JSON.parse(localStorage.getItem('temp_user'));
                currentUser = user;
                updateUIForUser();
                authModal.style.display = 'none';
                alert(`Welcome back, ${user.name}!`);
            } else {
                alert('Invalid code (use 123456)');
            }
        };
    }
}

function updateUIForUser() {
    if (!currentUser) return;
    if (loginBtn) loginBtn.style.display = 'none';
    const profileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    if (profileDiv && userNameSpan) {
        profileDiv.style.display = 'block';
        userNameSpan.textContent = currentUser.name;
    }
}

// Fetch Data
async function loadMerchants() {
    merchantsGrid.innerHTML = '<div class="loading-spinner">Loading venues...</div>';
    
    try {
        const querySnapshot = await getDocs(collection(db, "merchants"));
        allMerchants = [];
        querySnapshot.forEach((doc) => {
            allMerchants.push({ id: doc.id, ...doc.data() });
        });
        renderMerchants();
    } catch (error) {
        console.error("Error loading merchants:", error);
        merchantsGrid.innerHTML = '<div style="text-align:center">Failed to load data. Please ensure Firestore is enabled and seeded.</div>';
    }
}

// Render Grid
function renderMerchants() {
    const filtered = currentFilter === 'all' 
        ? allMerchants 
        : allMerchants.filter(m => m.type === currentFilter);

    if (filtered.length === 0) {
        merchantsGrid.innerHTML = '<div class="empty-state">No venues found.</div>';
        return;
    }

    merchantsGrid.innerHTML = filtered.map(merchant => `
        <div class="merchant-card" onclick="openMerchantDetails('${merchant.id}')">
            <div class="card-img-top">${merchant.image || '✨'}</div>
            <div class="card-body">
                <span class="card-tag">${merchant.category}</span>
                <h3 class="card-title">${merchant.name}</h3>
                <div class="card-meta">
                    <span>⭐ ${merchant.rating}</span>
                    <span>•</span>
                    <span>📍 ${merchant.distance}</span>
                </div>
                <p style="color: #6b7280; font-size: 0.9rem;">${merchant.address}</p>
            </div>
        </div>
    `).join('');
}

// Global scope for HTML access
window.openMerchantDetails = function(id) {
    const merchant = allMerchants.find(m => m.id === id);
    if (!merchant) return;

    // Generate services HTML
    const servicesHtml = merchant.services ? merchant.services.map(s => `
        <div class="service-row" style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
            <div>
                <div style="font-weight: 500;">${s.name}</div>
                <div style="font-size: 0.8rem; color: #888;">${s.duration} mins</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="font-weight: 600;">$${s.price}</div>
                <button class="btn-outline" style="padding: 4px 12px; font-size: 0.8rem;" 
                    onclick="initiateBooking('${merchant.id}', '${s.name}', ${s.price})">Book</button>
            </div>
        </div>
    `).join('') : '<p>No services listed.</p>';

    bookingModalBody.innerHTML = `
        <div class="modal-header" style="text-align: center; margin-bottom: 20px;">
            <h2 style="margin-bottom: 5px;">${merchant.name}</h2>
            <p style="color: #666;">${merchant.address}</p>
        </div>
        <h3 style="margin-bottom: 15px; font-size: 1.1rem;">Select Service</h3>
        <div class="services-list">
            ${servicesHtml}
        </div>
    `;
    bookingModal.style.display = 'flex';
}

window.initiateBooking = async function(merchantId, serviceName, price) {
    if (!currentUser) {
        alert("Please login first to book an appointment.");
        bookingModal.style.display = 'none';
        authModal.style.display = 'flex';
        return;
    }

    if(confirm(`Confirm booking for ${serviceName} ($${price})?`)) {
        try {
            await addDoc(collection(db, "bookings"), {
                merchantId,
                serviceName,
                price,
                customerId: currentUser.phone, // using phone as ID for simple prototype
                customerName: currentUser.name,
                status: 'pending',
                createdAt: new Date()
            });
            alert("Booking request sent! The owner will confirm shortly.");
            bookingModal.style.display = 'none';
        } catch (e) {
            console.error("Error booking:", e);
            alert("Failed to book. Try again.");
        }
    }
}

// Start
init();
