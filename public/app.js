import { db, auth, storage } from "./firebase-config.js";
import { collection, getDocs, getDoc, query, where, addDoc, doc, updateDoc, deleteDoc, Timestamp, setDoc, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { RecaptchaVerifier, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// DOM Elements
const merchantsGrid = document.getElementById('merchants-grid');
const loginBtn = document.getElementById('login-btn');
const authModal = document.getElementById('auth-modal');
const bookingModal = document.getElementById('booking-modal');
const bookingModalBody = document.getElementById('booking-modal-body');
const filterChips = document.querySelectorAll('.filter-chip');
const mapBtn = document.getElementById('map-btn');
const mapModal = document.getElementById('map-modal');
const sponsorCarousel = document.getElementById('sponsor-carousel');

// State
let allMerchants = [];
let allOffers = [];
let allSponsors = [];
let currentFilter = 'all';
let currentUser = null;
let map = null;
let markers = [];
let infoWindow = null;
let isPickingLocation = false;
let pickerMarker = null;
let pickedLocation = null;

// Utility: Custom Toast
window.showToast = function (message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    // Click to dismiss
    toast.onclick = () => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
};

// Utility: Custom Confirm Modal (Promise-based)
window.showConfirm = function (message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        if (!modal || !msgEl || !btnOk || !btnCancel) {
            // Fallback if elements missing
            resolve(confirm(message));
            return;
        }

        msgEl.textContent = message;
        modal.style.display = 'flex';

        // Cleanup function
        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => {
            cleanup();
            resolve(true);
        };

        btnCancel.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
};

// Initialization
async function init() {
    setupEventListeners();
    await loadOffersData(); // Load offers first so discounts show on cards
    await loadMerchants();
    loadSponsorsForCustomer();
}

// Load offers data (for discount display)
async function loadOffersData() {
    try {
        const snapshot = await getDocs(collection(db, "offers"));
        allOffers = [];
        snapshot.forEach(docSnap => {
            allOffers.push({ id: docSnap.id, ...docSnap.data() });
        });
    } catch (error) {
        console.error('Error loading offers:', error);
    }
}


// ========== UI POLISH (Dark Mode & Dropdown) ==========

function initDarkMode() {
    const isDark = localStorage.getItem('theme') === 'dark';
    if (isDark) {
        document.body.classList.add('dark-mode');
        document.getElementById('checkbox-dark-mode').checked = true;
    }
}

window.toggleDarkMode = function () {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('checkbox-dark-mode').checked = isDark;
}

window.toggleUserDropdown = function () {
    const menu = document.getElementById('user-dropdown-menu');
    menu.classList.toggle('show');
    event.stopPropagation(); // Prevent immediate closing
}

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
    const menu = document.getElementById('user-dropdown-menu');
    if (menu && menu.classList.contains('show')) {
        // If click is NOT inside the dropdown container
        if (!e.target.closest('#user-profile')) {
            menu.classList.remove('show');
        }
    }
});

function setupEventListeners() {
    // Dashboard Switching


    // Login Modal


    // Close Modals
    document.querySelectorAll('.close, .close-booking').forEach(btn => {
        btn.onclick = () => {
            authModal.style.display = 'none';
            bookingModal.style.display = 'none';
        };
    });

    // Close Map Modal
    const closeMapBtn = document.querySelector('.close-map');
    if (closeMapBtn) {
        closeMapBtn.onclick = () => {
            mapModal.style.display = 'none';
            // Reset Pick State
            isPickingLocation = false;
            if (pickerMarker) pickerMarker.setMap(null);
            document.getElementById('btn-confirm-location').style.display = 'none';
            const header = document.querySelector('.map-header h2');
            if (header) header.innerText = '📍 Explore Stores in Erbil';
        };
    }

    // Map Button
    if (mapBtn) {
        mapBtn.onclick = () => {
            mapModal.style.display = 'flex';
            if (!map) {
                initMap();
            } else {
                // Refresh markers in case data changed
                addMarkersToMap();
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


    // Authentication Logic


    // AUTHENTICATION LOGIC (Redesigned)
    let authStep = 'choice';
    let tempAuthData = null;


    // 1. Initialize ReCAPTCHA
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {
                // reCAPTCHA solved, allow signInWithPhoneNumber.
                // onSignInSubmit(); 
            }
        });
    }

    // 2. Open Auth Modal
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            authModal.style.display = 'flex';
            showAuthStep('choice');
        });
    }

    // 2. Step Switching Logic
    window.showAuthStep = function (step) {
        authStep = step;
        // Hide all
        document.getElementById('auth-step-0').style.display = 'none';
        document.getElementById('auth-form-register').style.display = 'none';
        document.getElementById('auth-form-login').style.display = 'none';
        document.getElementById('auth-form-owner').style.display = 'none';
        document.getElementById('auth-form-verify').style.display = 'none';

        // Show target
        if (step === 'choice') {
            document.getElementById('auth-step-0').style.display = 'block';
        } else if (step === 'register') {
            document.getElementById('auth-form-register').style.display = 'block';
        } else if (step === 'login') {
            document.getElementById('auth-form-login').style.display = 'block';
        } else if (step === 'verify') {
            document.getElementById('auth-form-verify').style.display = 'block';
            document.getElementById('verify-phone-display').innerText = '+964 ' + tempAuthData.phone;
        } else if (step === 'back') {
            tempAuthData = null;
            showAuthStep('choice');
        }
    }

    // 3. Register Form Submit
    const regForm = document.getElementById('auth-form-register');
    if (regForm) {
        regForm.onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('reg-name').value.trim();
            const phone = document.getElementById('reg-phone').value.trim();
            const password = document.getElementById('reg-password').value;

            if (phone.length < 10) {
                showToast('Please enter a valid phone number', 'error');
                return;
            }
            if (password.length < 6) {
                showToast('Password must be at least 6 characters', 'error');
                return;
            }

            try {
                const userExists = await checkUserExists(phone);
                if (userExists) {
                    showToast('This phone number is already registered. Please Sign In.', 'info');
                    showAuthStep('login');
                    document.getElementById('login-phone').value = phone;
                    return;
                }
                // Proceed to verify
                const appVerifier = window.recaptchaVerifier;
                // OTP Step is ONLY for registration
                signInWithPhoneNumber(auth, '+964' + phone, appVerifier)
                    .then((confirmationResult) => {
                        window.confirmationResult = confirmationResult;
                        tempAuthData = { type: 'register', name, phone, password };
                        showAuthStep('verify');
                        showToast('Verification code sent!', 'success');
                    }).catch((error) => {
                        console.error("SMS Error:", error);
                        showToast("Error sending SMS: " + error.message, 'error');
                        window.recaptchaVerifier.render().then(function (widgetId) {
                            grecaptcha.reset(widgetId);
                        });
                    });

            } catch (error) {
                console.error("Auth Error:", error);
                showToast("Error checking user. Please try again.", 'error');
            }
        };
    }

    // 4. Login Form Submit (Password Based)
    const loginForm = document.getElementById('auth-form-login');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const phone = document.getElementById('login-phone').value.trim();
            const password = document.getElementById('login-password').value;

            if (phone.length < 10) {
                showToast('Please enter a valid phone number', 'error');
                return;
            }

            try {
                // Login with Dummy Email
                const email = phone + '@docbook.app';
                await signInWithEmailAndPassword(auth, email, password);

                // Fetch User Data from Firestore
                const userDoc = await checkUserExists(phone);

                if (userDoc) {
                    currentUser = userDoc;
                    showToast('Welcome back, ' + currentUser.name + '!', 'success');
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    updateUIForUser();
                    authModal.style.display = 'none';
                } else {
                    showToast('Account data not found.', 'error');
                }

            } catch (error) {
                console.error("Login Error:", error);
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                    showToast("Invalid phone number or password.", 'error');
                } else {
                    showToast("Error logging in: " + error.message, 'error');
                }
            }
        }
    }



    // 6. Verification (OTP) Logic - Registration ONLY
    const verifyForm = document.getElementById('auth-form-verify');
    if (verifyForm) {
        verifyForm.onsubmit = async (e) => {
            e.preventDefault();
            const code = document.getElementById('auth-code').value;

            if (!window.confirmationResult) {
                showToast('No verification session found.', 'error');
                return;
            }

            if (!tempAuthData || tempAuthData.type !== 'register') {
                showToast('Invalid session state.', 'error');
                return;
            }

            try {
                // Verify OTP
                await window.confirmationResult.confirm(code);

                // OTP Success - Now create Real Account
                await signOut(auth); // Sign out of the temporary phone session

                const dummyEmail = tempAuthData.phone + '@docbook.app';
                await createUserWithEmailAndPassword(auth, dummyEmail, tempAuthData.password);

                // Create Firestore Doc
                const newUser = {
                    name: tempAuthData.name,
                    phone: tempAuthData.phone,
                    role: 'customer',
                    createdAt: new Date().toISOString()
                };

                await setDoc(doc(db, "users", tempAuthData.phone), newUser);

                currentUser = newUser;
                showToast(`Welcome to DocBook, ${newUser.name}!`, 'success');

                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUIForUser();
                authModal.style.display = 'none';

            } catch (error) {
                console.error("Verification Error:", error);
                if (error.code === 'auth/email-already-in-use') {
                    showToast("Account already exists. Please login.", 'error');
                    showAuthStep('login');
                } else {
                    showToast("Verification failed: " + error.message, 'error');
                }
            }
        };
    }
}


// Helper: Check if user exists in Firestore
async function checkUserExists(phone) {
    try {
        const docRef = doc(db, "users", phone);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (e) {
        console.error("Error checking user:", e);
        throw e;
    }
}

function updateUIForUser() {
    if (!currentUser) return;
    if (loginBtn) loginBtn.style.display = 'none';
    const profileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    if (profileDiv && userNameSpan) {
        profileDiv.style.display = 'flex'; // Changed to flex for alignment
        userNameSpan.textContent = currentUser.name;
    }

    // Redirect logic based on role
    if (currentUser.role === 'owner') {
        loadOwnerDashboard();
    } else if (currentUser.role === 'admin') {
        loadAdminDashboard();
    } else {
        // Customer - Ensure customer view is shown and others hidden
        const custDash = document.getElementById('dashboard-customer');
        const ownerDash = document.getElementById('dashboard-owner');
        const adminDash = document.getElementById('dashboard-admin');

        if (custDash) custDash.style.display = 'block';
        if (ownerDash) ownerDash.style.display = 'none';
        if (adminDash) adminDash.style.display = 'none';
    }
}

window.handleLogout = async function () {
    try {
        await signOut(auth);
        currentUser = null;
        localStorage.removeItem('currentUser');
        window.location.reload(); // Simple reload to clear state
    } catch (error) {
        console.error("Logout Error:", error);
    }
}

// Fetch Data
async function loadMerchants() {
    // Show skeleton loading cards
    const skeletonCount = 6;
    let skeletonHTML = '';
    for (let i = 0; i < skeletonCount; i++) {
        skeletonHTML += `
            <div class="skeleton-card">
                <div class="skeleton-image"></div>
                <div class="skeleton skeleton-text short"></div>
                <div class="skeleton skeleton-text title"></div>
                <div class="skeleton skeleton-text medium"></div>
                <div class="skeleton skeleton-text short"></div>
            </div>
        `;
    }
    merchantsGrid.innerHTML = skeletonHTML;

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

// Render Grid with Photos
function renderMerchants() {
    const filtered = currentFilter === 'all'
        ? allMerchants
        : allMerchants.filter(m => m.type === currentFilter);

    if (filtered.length === 0) {
        merchantsGrid.innerHTML = '<div class="empty-state">No venues found.</div>';
        return;
    }

    merchantsGrid.innerHTML = filtered.map(merchant => {
        // Check if merchant has a photo URL
        const imageContent = merchant.photoUrl
            ? `<img src="${merchant.photoUrl}" alt="${merchant.name}" onerror="this.outerHTML='<span class=\\'emoji-fallback\\'>${merchant.image || '✨'}</span>'">`
            : `<span class="emoji-fallback">${merchant.image || '✨'}</span>`;

        // Check if this merchant has active offers
        const now = new Date();
        const merchantOffers = allOffers.filter(o => {
            if (o.storeId !== merchant.id) return false;
            const endDate = o.endDate?.toDate ? o.endDate.toDate() : new Date(o.endDate);
            return endDate > now && o.active;
        });
        const hasDiscount = merchantOffers.length > 0;
        const maxDiscount = hasDiscount ? Math.max(...merchantOffers.map(o => o.discountPercent)) : 0;

        return `
        <div class="merchant-card" onclick="openMerchantDetails('${merchant.id}')">
            <div class="card-img-top">
                ${imageContent}
                ${hasDiscount ? `<div class="discount-badge">🔥 Up to ${maxDiscount}% OFF</div>` : ''}
            </div>
            <div class="card-body">
                <span class="card-tag">${merchant.category}</span>
                <h3 class="card-title">${merchant.name}</h3>
                <div class="card-meta">
                    <span>⭐ ${merchant.rating}</span>
                    <span>•</span>
                    <span>📍 ${merchant.distance}</span>
                </div>
                <p style="color: #6b7280; font-size: 0.9rem;">${merchant.address}</p>
                ${merchant.lat && merchant.lng ? `<span class="btn-map-link" onclick="event.stopPropagation(); showOnMap('${merchant.id}')">📍 View on Map</span>` : ''}
            </div>
        </div>
    `}).join('');
}

// ========== MAP FUNCTIONALITY ==========

// Initialize Google Map
function initMap() {
    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    // Center on Erbil
    const erbilCenter = { lat: 36.1912, lng: 44.0095 };

    map = new google.maps.Map(mapContainer, {
        center: erbilCenter,
        zoom: 13,
        styles: [
            {
                "featureType": "poi.business",
                "stylers": [{ "visibility": "off" }]
            }
        ]
    });

    infoWindow = new google.maps.InfoWindow();

    // Map Click Listener for Pinning
    map.addListener('click', (e) => {
        if (isPickingLocation) {
            pickedLocation = e.latLng;

            if (pickerMarker) pickerMarker.setMap(null);

            pickerMarker = new google.maps.Marker({
                position: e.latLng,
                map: map,
                title: "Selected Location",
                draggable: true,
                animation: google.maps.Animation.DROP
            });

            // Allow dragging to adjust
            pickerMarker.addListener('dragend', (evt) => {
                pickedLocation = evt.latLng;
            });
        }
    });

    addMarkersToMap();
}

// Add markers for all merchants
function addMarkersToMap() {
    // Clear existing markers
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    if (!map) return;

    allMerchants.forEach(merchant => {
        if (!merchant.lat || !merchant.lng) return;

        const markerColor = merchant.type === 'salon' ? '#9d4edd' : '#e0aaff';

        const marker = new google.maps.Marker({
            position: { lat: merchant.lat, lng: merchant.lng },
            map: map,
            title: merchant.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: markerColor,
                fillOpacity: 0.9,
                strokeColor: '#ffffff',
                strokeWeight: 2
            }
        });

        // Create info window content
        const infoContent = `
            <div class="map-info-window">
                <h3>${merchant.name}</h3>
                <p><strong>${merchant.category}</strong></p>
                <p>⭐ ${merchant.rating} • ${merchant.distance}</p>
                <p>📍 ${merchant.address}</p>
                <button class="btn-primary" onclick="openMerchantDetails('${merchant.id}'); document.getElementById('map-modal').style.display='none';">
                    View Details
                </button>
            </div>
        `;

        marker.addListener('click', () => {
            infoWindow.setContent(infoContent);
            infoWindow.open(map, marker);
        });

        markers.push(marker);
    });
}

window.confirmRealBooking = async function (storeId, storeName, serviceName, price, duration) {
    if (!currentUser) {
        showToast("Please login first to book an appointment.", 'error');
        document.getElementById('booking-modal').style.display = 'none';
        document.getElementById('auth-modal').style.display = 'flex'; // Assuming auth-modal is the login modal
        return;
    }

    if (!await showConfirm(`Confirm booking for ${serviceName} at ${storeName} for ${price.toLocaleString()} IQD?`)) {
        return;
    }

    try {
        const bookingData = {
            userId: currentUser.id || currentUser.phone, // fallback to phone if id missing
            customerName: currentUser.name,
            customerPhone: currentUser.phone,
            storeId: storeId,
            storeName: storeName,
            serviceName: serviceName,
            servicePrice: price,
            serviceDuration: duration,
            bookingDate: new Date(), // Current time for now
            status: 'completed', // Auto-complete for MVP
            commission: Math.round(price * 0.1),
            createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, 'bookings'), bookingData);

        showToast('Booking Confirmed! ✅', 'success');
        document.getElementById('booking-modal').style.display = 'none';

        // Refresh dashboard if admin is viewing
        if (currentUser.role === 'admin') {
            loadFinancials();
        }

    } catch (e) {
        console.error("Booking Error:", e);
        showToast("Failed to book service.", 'error');
    }
}

// Show specific merchant on map
window.showOnMap = function (id) {
    const merchant = allMerchants.find(m => m.id === id);
    if (!merchant || !merchant.lat || !merchant.lng) return;

    mapModal.style.display = 'flex';

    if (!map) {
        initMap();
        // Wait for map to initialize then center
        setTimeout(() => {
            map.setCenter({ lat: merchant.lat, lng: merchant.lng });
            map.setZoom(15);
            // Find and click the marker
            const marker = markers.find(m => m.getTitle() === merchant.name);
            if (marker) {
                google.maps.event.trigger(marker, 'click');
            }
        }, 300);
    } else {
        map.setCenter({ lat: merchant.lat, lng: merchant.lng });
        map.setZoom(15);
        const marker = markers.find(m => m.getTitle() === merchant.name);
        if (marker) {
            google.maps.event.trigger(marker, 'click');
        }
    }
}

// Global callback for Google Maps API
window.initMapCallback = function () {
    console.log('Google Maps API loaded');
}

// Global scope for HTML access
window.openMerchantDetails = function (id) {
    const merchant = allMerchants.find(m => m.id === id);
    if (!merchant) return;

    // Get active offers for this merchant
    const now = new Date();
    const merchantOffers = allOffers.filter(o => {
        if (o.storeId !== merchant.id) return false;
        const endDate = o.endDate?.toDate ? o.endDate.toDate() : new Date(o.endDate);
        return endDate > now && o.active;
    });

    // Generate services HTML with discounts
    const servicesHtml = merchant.services ? merchant.services.map((s, index) => {
        // Match by serviceName instead of serviceIndex to survive reordering
        const offer = merchantOffers.find(o => o.serviceName === s.name);
        const hasDiscount = !!offer;
        const discountPercent = offer?.discountPercent || 0;
        const newPrice = hasDiscount ? Math.round(s.price * (1 - discountPercent / 100)) : s.price;

        return `
        <div class="service-row" style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee;">
            <div>
                <div style="font-weight: 500; display: flex; align-items: center; gap: 8px;">
                    ${s.name}
                    ${hasDiscount ? `<span class="service-discount-tag">${discountPercent}% OFF</span>` : ''}
                </div>
                <div style="font-size: 0.8rem; color: #888;">${s.duration} mins</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="text-align: right;">
                    ${hasDiscount ? `
                        <div style="font-size: 0.75rem; color: #999; text-decoration: line-through;">${s.price.toLocaleString()} IQD</div>
                        <div style="font-weight: 600; color: #16a34a;">${newPrice.toLocaleString()} IQD</div>
                    ` : `
                        <div style="font-weight: 600;">${s.price.toLocaleString()} IQD</div>
                    `}
                </div>
                <button class="btn-outline" style="padding: 4px 12px; font-size: 0.8rem;" 
                    onclick="confirmRealBooking('${merchant.id}', '${merchant.name}', '${s.name}', ${newPrice}, ${s.duration})">Book</button>
            </div>
        </div>
    `}).join('') : '<p>No services listed.</p>';

    // Photo or emoji for header
    const headerImage = merchant.photoUrl
        ? `<img src="${merchant.photoUrl}" alt="${merchant.name}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 15px;">`
        : '';

    bookingModalBody.innerHTML = `
        ${headerImage}
        <div class="modal-header" style="text-align: center; margin-bottom: 20px;">
            <h2 style="margin-bottom: 5px;">${merchant.name}</h2>
            <p style="color: #666;">${merchant.address}</p>
            ${merchant.lat && merchant.lng ? `<span class="btn-map-link" onclick="showOnMap('${merchant.id}'); document.getElementById('booking-modal').style.display='none';">📍 View on Map</span>` : ''}
        </div>
        <h3 style="margin-bottom: 15px; font-size: 1.1rem;">Select Service</h3>
        <div class="services-list">
            ${servicesHtml}
        </div>
    `;
    bookingModal.style.display = 'flex';
}

window.initiateBooking = async function (merchantId, serviceName, price) {
    if (!currentUser) {
        showToast("Please login first to book an appointment.", 'error');
        bookingModal.style.display = 'none';
        authModal.style.display = 'flex';
        return;
    }

    if (await showConfirm(`Confirm booking for ${serviceName} ($${price})?`)) {
        try {
            await addDoc(collection(db, "bookings"), {
                merchantId,
                serviceName,
                price,
                customerId: currentUser.phone,
                customerName: currentUser.name,
                status: 'pending',
                createdAt: new Date()
            });
            showToast("Booking request sent! The owner will confirm shortly.", 'success');
            bookingModal.style.display = 'none';
        } catch (e) {
            console.error("Error booking:", e);
            showToast("Failed to book. Try again.", 'error');
        }
    }
}

// ========== ADMIN FUNCTIONS ==========

// Admin Tab Switching
window.addEventListener('DOMContentLoaded', () => {
    const adminTabs = document.querySelectorAll('.admin-tab');
    adminTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            adminTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Hide all panels
            document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');

            // Show target panel
            const targetId = `admin-${tab.dataset.tab}`;
            document.getElementById(targetId).style.display = 'block';

            // Load data for the tab
            if (tab.dataset.tab === 'stores') loadAdminStores();
            if (tab.dataset.tab === 'offers') loadAdminOffers();
            if (tab.dataset.tab === 'sponsors') loadAdminSponsors();
            if (tab.dataset.tab === 'financials') loadFinancials();
            if (tab.dataset.tab === 'users') loadAdminUsers();
        });
    });
});

// Load admin stores
async function loadAdminStores() {
    const tbody = document.getElementById('stores-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, "merchants"));
        allMerchants = [];
        snapshot.forEach(docSnap => {
            allMerchants.push({ id: docSnap.id, ...docSnap.data() });
        });

        tbody.innerHTML = allMerchants.map(store => `
            <tr>
                <td><strong>${store.name}</strong></td>
                <td>${store.category}</td>
                <td>${store.address || 'N/A'}</td>
                <td>
                    <span class="status-badge ${store.suspended ? 'suspended' : 'active'}">
                        ${store.suspended ? '🔴 Suspended' : '🟢 Active'}
                    </span>
                </td>
                <td>
                    <button class="action-btn" onclick="editStore('${store.id}')">✏️ Edit</button>
                    <button class="action-btn ${store.suspended ? '' : 'danger'}" onclick="toggleSuspend('${store.id}', ${!store.suspended})">
                        ${store.suspended ? '▶️ Activate' : '⏸️ Suspend'}
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading stores:', error);
        tbody.innerHTML = '<tr><td colspan="5">Error loading stores</td></tr>';
    }
}

// Open create store modal
window.openCreateStoreModal = function () {
    document.getElementById('store-modal-title').innerText = 'Create New Store';
    document.getElementById('store-form').reset();
    document.getElementById('store-id').value = '';

    // Clear preview
    const preview = document.getElementById('store-photo-preview');
    preview.src = '';
    preview.style.display = 'none';
    document.getElementById('store-photo').value = '';

    // Explicitly clear manual coords
    const latEl = document.getElementById('store-lat');
    const lngEl = document.getElementById('store-lng');
    if (latEl) latEl.value = '';
    if (lngEl) lngEl.value = '';

    // Clear services list to prevent stale data
    document.getElementById('services-sortable-list').innerHTML = '';

    // Hide services section for new stores
    document.getElementById('services-reorder-section').style.display = 'none';

    document.getElementById('store-modal').style.display = 'flex';
};

// Edit store
window.editStore = function (id) {
    const store = allMerchants.find(m => m.id === id);
    if (!store) return;

    document.getElementById('store-modal-title').innerText = 'Edit Store';
    document.getElementById('store-id').value = id;
    document.getElementById('store-name').value = store.name;
    document.getElementById('store-type').value = store.type;
    document.getElementById('store-address').value = store.address || '';

    const latEl = document.getElementById('store-lat');
    const lngEl = document.getElementById('store-lng');
    if (latEl) latEl.value = store.lat || '';
    if (lngEl) lngEl.value = store.lng || '';

    // Update preview + hidden input
    document.getElementById('store-photo').value = store.photoUrl || '';
    const preview = document.getElementById('store-photo-preview');
    if (store.photoUrl) {
        preview.src = store.photoUrl;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }

    // Show services reorder section and populate it
    const servicesSection = document.getElementById('services-reorder-section');
    servicesSection.style.display = 'block';
    renderServicesForReorder(store.services || []);

    document.getElementById('store-modal').style.display = 'flex';
};

// Open Map for Location Picking
window.openLocationPicker = function () {
    isPickingLocation = true;
    pickedLocation = null;
    if (pickerMarker) pickerMarker.setMap(null);

    // Show map
    document.getElementById('map-modal').style.display = 'flex';
    if (!map) {
        initMap();
    } else {
        // If editing existing store with coords, center there?
        const latInput = document.getElementById('store-lat');
        const lngInput = document.getElementById('store-lng');
        const currentLat = latInput ? parseFloat(latInput.value) : null;
        const currentLng = lngInput ? parseFloat(lngInput.value) : null;

        if (currentLat && currentLng) {
            const pos = { lat: currentLat, lng: currentLng };
            map.setCenter(pos);
            map.setZoom(15);
            // Also place the picker marker there initially
            pickerMarker = new google.maps.Marker({
                position: pos,
                map: map,
                title: "Current Location",
                draggable: true,
                animation: google.maps.Animation.DROP
            });
            pickedLocation = new google.maps.LatLng(currentLat, currentLng);
            pickerMarker.addListener('dragend', (evt) => {
                pickedLocation = evt.latLng;
            });
        }
    }

    // UI Updates
    document.getElementById('btn-confirm-location').style.display = 'inline-block';
    const header = document.querySelector('.map-header h2');
    if (header) {
        header.dataset.originalText = header.innerText;
        header.innerText = '📍 Click on Map to Select Location';
    }
};

// Confirm Location Selection
window.confirmLocationSelection = function () {
    if (!pickedLocation) {
        showToast('Please click on the map to select a location first.', 'error');
        return;
    }

    const latEl = document.getElementById('store-lat');
    const lngEl = document.getElementById('store-lng');
    if (latEl && lngEl) {
        latEl.value = pickedLocation.lat().toFixed(6);
        lngEl.value = pickedLocation.lng().toFixed(6);
    }

    // Low-level close interaction to ensure reset logic (attached to close button) runs
    const closeBtn = document.querySelector('.close-map');
    if (closeBtn) closeBtn.click();
};

// File input preview listener
document.getElementById('store-photo-file')?.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const preview = document.getElementById('store-photo-preview');
            preview.src = e.target.result;
            preview.style.display = 'block';
        }
        reader.readAsDataURL(file);
    }
});

// Store the current editing store ID for service reorder
let currentEditingStoreId = null;

// Render services for management (edit, delete, reorder)
function renderServicesForReorder(services) {
    const container = document.getElementById('services-sortable-list');
    currentEditingStoreId = document.getElementById('store-id').value;

    if (!services || services.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center;">No services yet. Add your first service!</p>';
        return;
    }

    container.innerHTML = services.map((s, i) => `
        <div class="sortable-item" draggable="true" data-index="${i}" data-name="${s.name}" data-price="${s.price}" data-duration="${s.duration}">
            <div class="drag-handle">
                <div class="drag-handle-bar"></div>
                <div class="drag-handle-bar"></div>
                <div class="drag-handle-bar"></div>
            </div>
            <div class="service-info">
                <div class="service-name">${s.name}</div>
                <div class="service-meta">${s.duration} mins • ${s.price.toLocaleString()} IQD</div>
            </div>
            <div class="service-actions">
                <button type="button" class="service-action-btn edit" onclick="openEditServiceModal(${i})" title="Edit Service">✏️</button>
                <button type="button" class="service-action-btn delete" onclick="deleteService(${i})" title="Delete Service">🗑️</button>
            </div>
            <div class="service-order">${i + 1}</div>
        </div>
    `).join('');

    // Setup drag and drop
    setupDragAndDrop();
}

// Setup drag and drop functionality
function setupDragAndDrop() {
    const container = document.getElementById('services-sortable-list');
    const items = container.querySelectorAll('.sortable-item');

    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.sortable-item').forEach(item => {
        item.classList.remove('drag-over');
    });
    updateOrderNumbers();
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        const container = document.getElementById('services-sortable-list');
        const allItems = [...container.querySelectorAll('.sortable-item')];
        const fromIndex = allItems.indexOf(draggedItem);
        const toIndex = allItems.indexOf(this);

        if (fromIndex < toIndex) {
            this.parentNode.insertBefore(draggedItem, this.nextSibling);
        } else {
            this.parentNode.insertBefore(draggedItem, this);
        }
    }
    this.classList.remove('drag-over');
}

function updateOrderNumbers() {
    const items = document.querySelectorAll('#services-sortable-list .sortable-item');
    items.forEach((item, i) => {
        item.dataset.index = i;
        item.querySelector('.service-order').textContent = i + 1;
    });
}

// Save services (including any edits, additions, or reordering)
window.saveServicesOrder = async function () {
    const storeId = document.getElementById('store-id').value;
    if (!storeId) return;

    const store = allMerchants.find(m => m.id === storeId);
    if (!store) return;

    // Get current order from DOM (services may have been added, edited, or reordered)
    const items = document.querySelectorAll('#services-sortable-list .sortable-item');
    const newServices = [];

    items.forEach(item => {
        const name = item.dataset.name;
        const price = parseInt(item.dataset.price);
        const duration = parseInt(item.dataset.duration);
        newServices.push({ name, price, duration });
    });

    try {
        await updateDoc(doc(db, "merchants", storeId), { services: newServices });

        // Update local data
        store.services = newServices;

        showToast('✅ Services saved successfully!', 'success');
        loadAdminStores();
        renderMerchants();
    } catch (error) {
        console.error('Error saving services:', error);
        showToast('Failed to save services', 'error');
    }
};

// Open modal to edit an existing service
window.openEditServiceModal = function (index) {
    const items = document.querySelectorAll('#services-sortable-list .sortable-item');
    const item = items[index];
    if (!item) return;

    document.getElementById('service-modal-title').textContent = 'Edit Service';
    document.getElementById('service-edit-index').value = index;
    document.getElementById('service-edit-name').value = item.dataset.name;
    document.getElementById('service-edit-price').value = item.dataset.price;
    document.getElementById('service-edit-duration').value = item.dataset.duration;

    document.getElementById('service-modal').style.display = 'flex';
};

// Open modal to add a new service
window.openAddServiceModal = function () {
    document.getElementById('service-modal-title').textContent = 'Add New Service';
    document.getElementById('service-edit-index').value = '-1'; // -1 indicates new service
    document.getElementById('service-form').reset();

    document.getElementById('service-modal').style.display = 'flex';
};

// Delete a service from the list
window.deleteService = async function (index) {
    const items = document.querySelectorAll('#services-sortable-list .sortable-item');
    const item = items[index];
    if (!item) return;

    const serviceName = item.dataset.name;
    if (!await showConfirm(`Delete service "${serviceName}"? This will be saved when you click "Save Changes".`)) return;

    // Remove from DOM
    item.remove();

    // Update order numbers
    updateOrderNumbers();
};

// Service form submission (for both edit and add)
document.getElementById('service-form')?.addEventListener('submit', function (e) {
    e.preventDefault();

    const index = parseInt(document.getElementById('service-edit-index').value);
    const name = document.getElementById('service-edit-name').value.trim();
    const price = parseInt(document.getElementById('service-edit-price').value);
    const duration = parseInt(document.getElementById('service-edit-duration').value);

    if (!name || isNaN(price) || isNaN(duration)) {
        showToast('Please fill in all fields correctly.', 'error');
        return;
    }

    const container = document.getElementById('services-sortable-list');
    const items = container.querySelectorAll('.sortable-item');

    if (index === -1) {
        // Adding new service
        const newIndex = items.length;
        const newItemHtml = `
            <div class="sortable-item" draggable="true" data-index="${newIndex}" data-name="${name}" data-price="${price}" data-duration="${duration}">
                <div class="drag-handle">
                    <div class="drag-handle-bar"></div>
                    <div class="drag-handle-bar"></div>
                    <div class="drag-handle-bar"></div>
                </div>
                <div class="service-info">
                    <div class="service-name">${name}</div>
                    <div class="service-meta">${duration} mins • ${price.toLocaleString()} IQD</div>
                </div>
                <div class="service-actions">
                    <button type="button" class="service-action-btn edit" onclick="openEditServiceModal(${newIndex})" title="Edit Service">✏️</button>
                    <button type="button" class="service-action-btn delete" onclick="deleteService(${newIndex})" title="Delete Service">🗑️</button>
                </div>
                <div class="service-order">${newIndex + 1}</div>
            </div>
        `;

        // Check if there's an "empty" message and remove it
        const emptyMsg = container.querySelector('p');
        if (emptyMsg) {
            container.innerHTML = '';
        }

        container.insertAdjacentHTML('beforeend', newItemHtml);

        // Re-setup drag and drop for the new item
        const newItem = container.lastElementChild;
        newItem.addEventListener('dragstart', handleDragStart);
        newItem.addEventListener('dragend', handleDragEnd);
        newItem.addEventListener('dragover', handleDragOver);
        newItem.addEventListener('drop', handleDrop);
        newItem.addEventListener('dragenter', handleDragEnter);
        newItem.addEventListener('dragleave', handleDragLeave);
    } else {
        // Editing existing service
        const item = items[index];
        if (item) {
            item.dataset.name = name;
            item.dataset.price = price;
            item.dataset.duration = duration;
            item.querySelector('.service-name').textContent = name;
            item.querySelector('.service-meta').textContent = `${duration} mins • ${price.toLocaleString()} IQD`;
        }
    }

    closeModal('service-modal');
    updateOrderNumbers();
});

// Hide services section when opening create modal
window.openCreateStoreModal = function () {
    document.getElementById('store-modal-title').innerText = 'Create New Store';
    document.getElementById('store-form').reset();
    document.getElementById('store-id').value = '';
    document.getElementById('services-reorder-section').style.display = 'none';
    document.getElementById('store-modal').style.display = 'flex';
};

// Toggle suspend
window.toggleSuspend = async function (id, suspend) {
    try {
        await updateDoc(doc(db, "merchants", id), { suspended: suspend });
        loadAdminStores();
        renderMerchants(); // Refresh customer view too
    } catch (error) {
        console.error('Error updating store:', error);
        showToast('Failed to update store status', 'error');
    }
};

// Close modal
window.closeModal = function (modalId) {
    document.getElementById(modalId).style.display = 'none';
};

// Helper to upload image
async function uploadImage(file, path) {
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    return await getDownloadURL(snapshot.ref);
}

// Store form submit (Handles Store Details + Services + Photo Upload)
document.getElementById('store-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('store-id').value;
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
        let photoUrl = document.getElementById('store-photo').value;
        const fileInput = document.getElementById('store-photo-file');

        // Handle File Upload
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const path = `stores/${Date.now()}_${file.name}`;
            photoUrl = await uploadImage(file, path);
        }

        const latEl = document.getElementById('store-lat');
        const lngEl = document.getElementById('store-lng');

        const storeData = {
            name: document.getElementById('store-name').value,
            type: document.getElementById('store-type').value,
            category: document.getElementById('store-category').value,
            address: document.getElementById('store-address').value,
            lat: latEl ? (parseFloat(latEl.value) || null) : null,
            lng: lngEl ? (parseFloat(lngEl.value) || null) : null,
            photoUrl: photoUrl
        };

        // Gather services from the sortable list
        // This ensures any edits, reordering, or additions are saved
        const serviceItems = document.querySelectorAll('#services-sortable-list .sortable-item');
        if (serviceItems.length > 0) {
            const services = [];
            serviceItems.forEach(item => {
                services.push({
                    name: item.dataset.name,
                    price: parseInt(item.dataset.price),
                    duration: parseInt(item.dataset.duration)
                });
            });
            storeData.services = services;
        } else {
            // No services by default - Manual entry required
            storeData.services = [];
        }

        if (id) {
            // Update existing store
            storeData.suspended = false;
            await updateDoc(doc(db, "merchants", id), storeData);
        } else {
            // Create New Store
            storeData.rating = 5.0; // Default rating for new stores
            storeData.distance = '0 km'; // Placeholder until real geo-calc is implemented
            storeData.suspended = false;
            await addDoc(collection(db, "merchants"), storeData);
        }

        closeModal('store-modal');
        loadAdminStores();
        loadMerchants();
        loadAdminStores();
        loadMerchants();
        showToast('✅ Store and services saved successfully!', 'success');

    } catch (error) {
        console.error('Error saving store:', error);
        showToast('Failed to save store: ' + error.message, 'error');
    } finally {
        saveBtn.textContent = originalBtnText;
        saveBtn.disabled = false;
    }
});

// ========== OFFERS FUNCTIONS ==========

async function loadAdminOffers() {
    const tbody = document.getElementById('offers-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, "offers"));
        allOffers = [];
        snapshot.forEach(docSnap => {
            allOffers.push({ id: docSnap.id, ...docSnap.data() });
        });

        if (allOffers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">No offers yet</td></tr>';
            return;
        }

        const now = new Date();
        tbody.innerHTML = allOffers.map(offer => {
            const store = allMerchants.find(m => m.id === offer.storeId);
            const endDate = offer.endDate?.toDate ? offer.endDate.toDate() : new Date(offer.endDate);
            const isExpired = endDate < now;
            const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

            return `
            <tr>
                <td>${store?.name || 'Unknown'}</td>
                <td>${offer.serviceName}</td>
                <td><strong style="color: #16a34a;">${offer.discountPercent}% OFF</strong></td>
                <td>${isExpired ? 'Ended' : `${daysLeft} days left`}</td>
                <td>
                    <span class="status-badge ${isExpired ? 'expired' : 'active'}">
                        ${isExpired ? '⚫ Expired' : '🟢 Active'}
                    </span>
                </td>
                <td>
                    <button class="action-btn danger" onclick="deleteOffer('${offer.id}')">🗑️ Delete</button>
                </td>
            </tr>
        `}).join('');
    } catch (error) {
        console.error('Error loading offers:', error);
        tbody.innerHTML = '<tr><td colspan="6">Error loading offers</td></tr>';
    }
}

window.openCreateOfferModal = function () {
    const storeSelect = document.getElementById('offer-store');
    storeSelect.innerHTML = allMerchants
        .filter(m => !m.suspended)
        .map(m => `<option value="${m.id}">${m.name}</option>`)
        .join('');

    // Load services for first store
    updateOfferServices();

    document.getElementById('offer-form').reset();
    document.getElementById('offer-modal').style.display = 'flex';
};

function updateOfferServices() {
    const storeId = document.getElementById('offer-store').value;
    const store = allMerchants.find(m => m.id === storeId);
    const serviceSelect = document.getElementById('offer-service');

    if (store?.services) {
        serviceSelect.innerHTML = store.services.map((s, i) =>
            `<option value="${i}">${s.name} - ${s.price.toLocaleString()} IQD</option>`
        ).join('');
    } else {
        serviceSelect.innerHTML = '<option>No services</option>';
    }
}

document.getElementById('offer-store')?.addEventListener('change', updateOfferServices);

document.getElementById('offer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const storeId = document.getElementById('offer-store').value;
    const store = allMerchants.find(m => m.id === storeId);
    const serviceIndex = parseInt(document.getElementById('offer-service').value);
    const service = store?.services?.[serviceIndex];

    const durationDays = parseInt(document.getElementById('offer-duration').value);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    // Use serviceName (not serviceIndex) so offers survive service reordering
    const offerData = {
        storeId,
        storeName: store?.name,
        serviceName: service?.name || 'Service',
        discountPercent: parseInt(document.getElementById('offer-discount').value),
        startDate: Timestamp.now(),
        endDate: Timestamp.fromDate(endDate),
        active: true
    };

    try {
        await addDoc(collection(db, "offers"), offerData);
        closeModal('offer-modal');
        loadAdminOffers();
    } catch (error) {
        console.error('Error creating offer:', error);
        showToast('Failed to create offer', 'error');
    }
});

window.deleteOffer = async function (id) {
    if (!await showConfirm('Delete this offer?')) return;
    try {
        await deleteDoc(doc(db, "offers", id));
        loadAdminOffers();
    } catch (error) {
        console.error('Error deleting offer:', error);
    }
};

// ========== SPONSORS FUNCTIONS ==========

async function loadAdminSponsors() {
    const storesList = document.getElementById('sponsored-stores-list');
    const adsList = document.getElementById('external-ads-list');
    if (!storesList || !adsList) return;

    try {
        const snapshot = await getDocs(collection(db, "sponsors"));
        allSponsors = [];
        snapshot.forEach(docSnap => {
            allSponsors.push({ id: docSnap.id, ...docSnap.data() });
        });

        const storeSponsors = allSponsors.filter(s => s.type === 'store');
        const externalSponsors = allSponsors.filter(s => s.type === 'external');

        storesList.innerHTML = storeSponsors.length ? storeSponsors.map(s => {
            const store = allMerchants.find(m => m.id === s.storeId);
            return `
                <div class="sponsored-item-card">
                    <img src="${store?.photoUrl || 'https://via.placeholder.com/60'}" alt="">
                    <div class="sponsored-item-info">
                        <h4>${store?.name || 'Store'}</h4>
                        <p>${store?.category || ''}</p>
                    </div>
                    <button class="action-btn danger" onclick="deleteSponsor('${s.id}')">🗑️</button>
                </div>
            `;
        }).join('') : '<p class="sponsor-empty">No sponsored stores yet</p>';

        adsList.innerHTML = externalSponsors.length ? externalSponsors.map(s => `
            <div class="sponsored-item-card">
                <img src="${s.imageUrl || 'https://via.placeholder.com/60'}" alt="">
                <div class="sponsored-item-info">
                    <h4>${s.title || 'Advertisement'}</h4>
                    <p><a href="${s.linkUrl}" target="_blank">🔗 ${s.linkUrl?.substring(0, 30)}...</a></p>
                </div>
                <button class="action-btn danger" onclick="deleteSponsor('${s.id}')">🗑️</button>
            </div>
        `).join('') : '<p class="sponsor-empty">No external ads yet</p>';

    } catch (error) {
        console.error('Error loading sponsors:', error);
    }
}

window.openCreateSponsorModal = function () {
    const storeSelect = document.getElementById('sponsor-store');
    storeSelect.innerHTML = allMerchants
        .filter(m => !m.suspended)
        .map(m => `<option value="${m.id}">${m.name}</option>`)
        .join('');

    document.getElementById('sponsor-form').reset();
    document.getElementById('sponsor-store-fields').style.display = 'block';
    document.getElementById('sponsor-external-fields').style.display = 'none';
    document.getElementById('sponsor-modal').style.display = 'flex';
};

window.toggleSponsorFields = function () {
    const type = document.getElementById('sponsor-type').value;
    document.getElementById('sponsor-store-fields').style.display = type === 'store' ? 'block' : 'none';
    document.getElementById('sponsor-external-fields').style.display = type === 'external' ? 'block' : 'none';
};

document.getElementById('sponsor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const type = document.getElementById('sponsor-type').value;
    const durationDays = parseInt(document.getElementById('sponsor-duration').value);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    const sponsorData = {
        type,
        startDate: Timestamp.now(),
        endDate: Timestamp.fromDate(endDate),
        active: true
    };

    if (type === 'store') {
        sponsorData.storeId = document.getElementById('sponsor-store').value;
    } else {
        sponsorData.imageUrl = document.getElementById('sponsor-image').value;
        sponsorData.linkUrl = document.getElementById('sponsor-link').value;
        sponsorData.title = document.getElementById('sponsor-title').value;
    }

    try {
        await addDoc(collection(db, "sponsors"), sponsorData);
        closeModal('sponsor-modal');
        loadAdminSponsors();
        loadSponsorsForCustomer();
    } catch (error) {
        console.error('Error creating sponsor:', error);
        showToast('Failed to add sponsor', 'error');
    }
});

window.deleteSponsor = async function (id) {
    if (!await showConfirm('Remove this sponsor?')) return;
    try {
        await deleteDoc(doc(db, "sponsors", id));
        loadAdminSponsors();
        loadSponsorsForCustomer();
    } catch (error) {
        console.error('Error deleting sponsor:', error);
    }
};

// ========== CUSTOMER SPONSOR BANNER ==========

async function loadSponsorsForCustomer() {
    if (!sponsorCarousel) return;

    try {
        const snapshot = await getDocs(collection(db, "sponsors"));
        const now = new Date();
        const activeSponsors = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const endDate = data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate);
            if (endDate > now && data.active) {
                activeSponsors.push({ id: docSnap.id, ...data });
            }
        });

        if (activeSponsors.length === 0) {
            sponsorCarousel.innerHTML = '';
            sponsorCarousel.parentElement.parentElement.style.display = 'none';
            return;
        }

        sponsorCarousel.parentElement.parentElement.style.display = 'block';

        sponsorCarousel.innerHTML = activeSponsors.map(sponsor => {
            if (sponsor.type === 'store') {
                const store = allMerchants.find(m => m.id === sponsor.storeId);
                if (!store) return '';
                return `
                    <div class="sponsor-card" onclick="openMerchantDetails('${store.id}')">
                        <img src="${store.photoUrl || 'https://via.placeholder.com/320x140'}" alt="${store.name}">
                        <div class="sponsor-card-body">
                            <h4>${store.name}</h4>
                            <p>📍 ${store.address || store.category}</p>
                        </div>
                    </div>
                `;
            } else {
                return `
                    <a href="${sponsor.linkUrl}" target="_blank" class="sponsor-card" style="text-decoration: none;">
                        <img src="${sponsor.imageUrl || 'https://via.placeholder.com/320x140'}" alt="${sponsor.title}">
                        <div class="sponsor-card-body">
                            <h4>${sponsor.title || 'Special Offer'}</h4>
                            <p>🔗 Learn More</p>
                        </div>
                    </a>
                `;
            }
        }).join('');

    } catch (error) {
        console.error('Error loading sponsors:', error);
        sponsorCarousel.innerHTML = '';
    }
}

// Load sponsors when merchants load
const originalLoadMerchants = loadMerchants;
async function loadMerchantsWithSponsors() {
    await originalLoadMerchants.call(this);
    loadSponsorsForCustomer();
}

// ========== FINANCIALS SECTION ==========
let allBookings = [];
let currentFinancialFilter = 'all';

// Sample booking data for demo purposes


// Load Financials
async function loadFinancials(filter = currentFinancialFilter) {
    currentFinancialFilter = filter;

    // Load invoices from Firestore
    await loadInvoicesFromFirestore();

    // Load Bookings from Firestore (Real Data)
    if (currentUser.role === 'admin') {
        const q = query(collection(db, "bookings"), orderBy("bookingDate", "desc"));
        const snapshot = await getDocs(q);

        allBookings = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            allBookings.push({
                id: docSnap.id,
                ...data,
                bookingDate: data.bookingDate.toDate ? data.bookingDate.toDate() : new Date(data.bookingDate)
            });
        });
    }

    // Populate store selector for invoice generation using allMerchants
    const storeSelect = document.getElementById('invoice-store-select');
    if (storeSelect && storeSelect.options.length <= 1 && allMerchants && allMerchants.length > 0) {
        allMerchants.forEach(store => {
            const opt = document.createElement('option');
            opt.value = store.id;
            opt.textContent = store.name;
            storeSelect.appendChild(opt);
        });
    }

    // Set default dates for invoice generation (start of month to today)
    const startDateInput = document.getElementById('invoice-start-date');
    const endDateInput = document.getElementById('invoice-end-date');
    if (startDateInput && !startDateInput.value) {
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startDateInput.value = firstOfMonth.toISOString().split('T')[0];
        endDateInput.value = now.toISOString().split('T')[0];
    }

    // Filter by date range
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    let filteredBookings = allBookings;
    if (filter === 'today') {
        filteredBookings = allBookings.filter(b => b.bookingDate >= today);
    } else if (filter === 'week') {
        filteredBookings = allBookings.filter(b => b.bookingDate >= weekAgo);
    } else if (filter === 'month') {
        filteredBookings = allBookings.filter(b => b.bookingDate >= monthAgo);
    }

    // Calculate stats
    const completedBookings = filteredBookings.filter(b => b.status === 'completed');
    const pendingBookings = filteredBookings.filter(b => b.status === 'pending');

    const totalRevenue = completedBookings.reduce((sum, b) => sum + b.servicePrice, 0);
    const totalCommission = completedBookings.reduce((sum, b) => sum + b.commission, 0);
    const pendingAmount = pendingBookings.reduce((sum, b) => sum + b.commission, 0);

    // This month stats (always from current month)
    const thisMonthBookings = allBookings.filter(b => {
        return b.bookingDate.getMonth() === now.getMonth() &&
            b.bookingDate.getFullYear() === now.getFullYear() &&
            b.status === 'completed';
    });
    const thisMonthCommission = thisMonthBookings.reduce((sum, b) => sum + b.commission, 0);

    // Update stat cards
    document.getElementById('stat-total-revenue').textContent = totalRevenue.toLocaleString() + ' IQD';
    document.getElementById('stat-commission').textContent = totalCommission.toLocaleString() + ' IQD';
    document.getElementById('stat-pending').textContent = pendingAmount.toLocaleString() + ' IQD';
    document.getElementById('stat-this-month').textContent = thisMonthCommission.toLocaleString() + ' IQD';

    // Update table
    const tbody = document.getElementById('financials-tbody');
    if (filteredBookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No bookings found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredBookings.slice(0, 15).map((booking, index) => `
        <tr>
            <td>${booking.bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><strong>${booking.storeName}</strong></td>
            <td>${booking.serviceName}</td>
            <td>${booking.servicePrice.toLocaleString()} IQD</td>
            <td style="color: #059669; font-weight: 600;">${booking.commission.toLocaleString()} IQD</td>
            <td>
                <span class="status-badge ${booking.status === 'completed' ? 'paid' : 'pending-payment'}">
                    ${booking.status === 'completed' ? '✓ Paid' : '⏳ Pending'}
                </span>
            </td>
            <td>
                ${booking.status === 'completed' ?
            `<button class="action-btn" onclick="viewInvoice(${index})">📄 Invoice</button>` :
            '-'}
            </td>
        </tr>
    `).join('');
}

// Invoice storage
let allInvoices = [];
let currentInvoiceData = null;

// Load invoices from Firestore
async function loadInvoicesFromFirestore() {
    try {
        const invoicesRef = collection(db, 'invoices');
        const q = query(invoicesRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        allInvoices = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: data.id,
                storeId: data.storeId, // Added storeId
                storeName: data.storeName,
                period: data.period,
                startDate: new Date(data.startDate),
                endDate: new Date(data.endDate),
                serviceCount: data.serviceCount,
                grossRevenue: data.grossRevenue,
                commission: data.commission,
                createdAt: new Date(data.createdAt),
                isPaid: data.isPaid || false,
                paidAt: data.paidAt ? new Date(data.paidAt) : null,
                // Convert booking summaries back to usable format
                bookings: (data.bookingSummaries || []).map(b => ({
                    bookingDate: new Date(b.date),
                    serviceName: b.serviceName,
                    customerName: b.customerName,
                    servicePrice: b.servicePrice,
                    commission: b.commission
                }))
            };
        });

        renderInvoiceLists();
        console.log(`Loaded ${allInvoices.length} invoices from Firestore`);
    } catch (error) {
        console.error('Error loading invoices:', error);
    }
}

// Generate Store Invoice (using date range inputs)
window.generateStoreInvoice = function () {
    const storeSelect = document.getElementById('invoice-store-select');
    const storeId = storeSelect.value;
    const storeName = storeSelect.options[storeSelect.selectedIndex].text;

    const startDateInput = document.getElementById('invoice-start-date').value;
    const endDateInput = document.getElementById('invoice-end-date').value;

    if (!storeId) {
        showToast('Please select a store', 'error');
        return;
    }

    if (!startDateInput || !endDateInput) {
        showToast('Please select both start and end dates', 'error');
        return;
    }

    const startDate = new Date(startDateInput);
    const endDate = new Date(endDateInput);
    endDate.setHours(23, 59, 59); // Include full end day

    if (startDate > endDate) {
        showToast('Start date must be before end date', 'error');
        return;
    }

    const periodLabel = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Filter bookings for this store in the period
    const storeBookings = allBookings.filter(b =>
        b.storeId === storeId &&
        b.status === 'completed' &&
        b.bookingDate >= startDate &&
        b.bookingDate <= endDate
    );

    if (storeBookings.length === 0) {
        showToast('No completed bookings found for this store in the selected period.', 'info');
        return;
    }

    // Calculate totals
    const grossRevenue = storeBookings.reduce((sum, b) => sum + b.servicePrice, 0);
    const totalCommission = storeBookings.reduce((sum, b) => sum + b.commission, 0);
    const now = new Date();

    // Generate invoice number
    const invoiceNum = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(allInvoices.length + 1).padStart(3, '0')}`;

    // Store current invoice data for saving
    currentInvoiceData = {
        id: invoiceNum,
        storeId: storeId,
        storeName: storeName,
        period: periodLabel,
        startDate: startDate,
        endDate: endDate,
        serviceCount: storeBookings.length,
        grossRevenue: grossRevenue,
        commission: totalCommission,
        createdAt: now,
        isPaid: false,
        bookings: storeBookings
    };

    // Populate invoice modal
    document.getElementById('invoice-number').textContent = `#${invoiceNum}`;
    document.getElementById('invoice-store-name').textContent = storeName;
    document.getElementById('invoice-store-address').textContent = 'Erbil, Kurdistan Region, Iraq';
    document.getElementById('invoice-period').textContent = `Period: ${periodLabel}`;

    // Service items
    document.getElementById('invoice-items').innerHTML = storeBookings.map(b => `
        <tr>
            <td>${b.bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
            <td>${b.serviceName}</td>
            <td>${b.customerName}</td>
            <td>${b.servicePrice.toLocaleString()} IQD</td>
            <td style="color: var(--primary); font-weight: 500;">${b.commission.toLocaleString()} IQD</td>
        </tr>
    `).join('');

    // Totals
    document.getElementById('invoice-service-count').textContent = storeBookings.length;
    document.getElementById('invoice-gross').textContent = grossRevenue.toLocaleString() + ' IQD';
    document.getElementById('invoice-commission').textContent = totalCommission.toLocaleString() + ' IQD';
    document.getElementById('invoice-total').textContent = totalCommission.toLocaleString() + ' IQD';
    document.getElementById('invoice-generated-date').textContent = now.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // Hide PAID stamp initially
    document.getElementById('invoice-stamp').style.display = 'none';

    // Reset buttons for new invoice
    const btnMarkPaid = document.getElementById('btn-mark-paid');
    const btnSave = document.getElementById('btn-save-invoice');

    if (btnSave) btnSave.style.display = 'inline-block';
    if (btnMarkPaid) btnMarkPaid.style.display = 'inline-block';

    // Show modal
    document.getElementById('invoice-modal').style.display = 'flex';
};

// Save current invoice to Firestore
window.saveInvoice = async function () {
    if (!currentInvoiceData) return;

    try {
        // Convert for Firestore storage (no Date objects directly, store booking info as simplified array)
        const invoiceForFirestore = {
            id: currentInvoiceData.id,
            storeId: currentInvoiceData.storeId, // Persist Store ID
            storeName: currentInvoiceData.storeName,
            period: currentInvoiceData.period,
            startDate: currentInvoiceData.startDate.toISOString(),
            endDate: currentInvoiceData.endDate.toISOString(),
            serviceCount: currentInvoiceData.serviceCount,
            grossRevenue: currentInvoiceData.grossRevenue,
            commission: currentInvoiceData.commission,
            createdAt: new Date().toISOString(),
            isPaid: false,
            // Store booking summaries (not full objects)
            bookingSummaries: currentInvoiceData.bookings.map(b => ({
                date: b.bookingDate.toISOString(),
                serviceName: b.serviceName,
                customerName: b.customerName,
                servicePrice: b.servicePrice,
                commission: b.commission
            }))
        };

        // Save to Firestore using modular syntax
        const invoiceDocRef = doc(db, 'invoices', currentInvoiceData.id);
        await setDoc(invoiceDocRef, invoiceForFirestore);

        // Add to local array for immediate display
        allInvoices.push({ ...currentInvoiceData });

        renderInvoiceLists();
        closeModal('invoice-modal');
        showToast('Invoice saved to database!', 'success');
    } catch (error) {
        console.error('Error saving invoice:', error);
        showToast('Error saving invoice: ' + error.message, 'error');
    }
};

// Mark Invoice as Paid (updates Firestore)
window.markInvoicePaid = async function () {
    if (!currentInvoiceData) return;

    try {
        // Update in Firestore using modular syntax
        const invoiceDocRef = doc(db, 'invoices', currentInvoiceData.id);
        await updateDoc(invoiceDocRef, {
            isPaid: true,
            paidAt: new Date().toISOString()
        });

        currentInvoiceData.isPaid = true;

        // Update in local array
        const existingIndex = allInvoices.findIndex(inv => inv.id === currentInvoiceData.id);
        if (existingIndex >= 0) {
            allInvoices[existingIndex].isPaid = true;
        } else {
            allInvoices.push({ ...currentInvoiceData });
        }

        document.getElementById('invoice-stamp').style.display = 'block';
        if (document.getElementById('btn-mark-paid')) {
            document.getElementById('btn-mark-paid').style.display = 'none';
        }
        renderInvoiceLists();
        showToast('Invoice marked as paid!', 'success');
    } catch (error) {
        console.error('Error marking invoice as paid:', error);
        showToast('Error updating invoice: ' + error.message, 'error');
    }
};

// Render invoice lists
function renderInvoiceLists() {
    const unpaidList = document.getElementById('unpaid-invoices-list');
    const paidList = document.getElementById('paid-invoices-list');

    const unpaidInvoices = allInvoices.filter(inv => !inv.isPaid);
    const paidInvoices = allInvoices.filter(inv => inv.isPaid);

    if (unpaidInvoices.length === 0) {
        unpaidList.innerHTML = '<div class="empty-state">No unpaid invoices</div>';
    } else {
        unpaidList.innerHTML = unpaidInvoices.map(inv => `
            <div class="invoice-card">
                <div class="invoice-card-info">
                    <h4>${inv.storeName}</h4>
                    <p>${inv.period} • ${inv.serviceCount} services</p>
                </div>
                <div class="invoice-card-amount">
                    <div class="amount">${inv.commission.toLocaleString()} IQD</div>
                    <div class="date">${inv.createdAt.toLocaleDateString()}</div>
                </div>
                <div class="invoice-card-actions">
                    <button class="action-btn" onclick="viewSavedInvoice('${inv.id}')">View</button>
                    <button class="action-btn" onclick="markInvoicePaidById('${inv.id}')">✓ Paid</button>
                </div>
            </div>
        `).join('');
    }

    if (paidInvoices.length === 0) {
        paidList.innerHTML = '<div class="empty-state">No paid invoices yet</div>';
    } else {
        paidList.innerHTML = paidInvoices.map(inv => `
            <div class="invoice-card">
                <div class="invoice-card-info">
                    <h4>${inv.storeName}</h4>
                    <p>${inv.period} • ${inv.serviceCount} services</p>
                </div>
                <div class="invoice-card-amount">
                    <div class="amount" style="color: #059669;">${inv.commission.toLocaleString()} IQD</div>
                    <div class="date">Paid ${inv.createdAt.toLocaleDateString()}</div>
                </div>
                <div class="invoice-card-actions">
                    <button class="action-btn" onclick="viewSavedInvoice('${inv.id}')">View</button>
                </div>
            </div>
        `).join('');
    }
}

// View saved invoice
window.viewSavedInvoice = function (invoiceId) {
    const invoice = allInvoices.find(inv => inv.id === invoiceId);
    if (!invoice) return;

    currentInvoiceData = invoice;

    document.getElementById('invoice-number').textContent = `#${invoice.id}`;
    document.getElementById('invoice-store-name').textContent = invoice.storeName;
    document.getElementById('invoice-store-address').textContent = 'Erbil, Kurdistan Region, Iraq';
    document.getElementById('invoice-period').textContent = `Period: ${invoice.period}`;

    document.getElementById('invoice-items').innerHTML = invoice.bookings.map(b => `
        <tr>
            <td>${b.bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
            <td>${b.serviceName}</td>
            <td>${b.customerName}</td>
            <td>${b.servicePrice.toLocaleString()} IQD</td>
            <td style="color: var(--primary); font-weight: 500;">${b.commission.toLocaleString()} IQD</td>
        </tr>
    `).join('');

    document.getElementById('invoice-service-count').textContent = invoice.serviceCount;
    document.getElementById('invoice-gross').textContent = invoice.grossRevenue.toLocaleString() + ' IQD';
    document.getElementById('invoice-commission').textContent = invoice.commission.toLocaleString() + ' IQD';
    document.getElementById('invoice-total').textContent = invoice.commission.toLocaleString() + ' IQD';
    document.getElementById('invoice-generated-date').textContent = invoice.createdAt.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    document.getElementById('invoice-stamp').style.display = invoice.isPaid ? 'block' : 'none';

    // UI Logic for Buttons
    const btnMarkPaid = document.getElementById('btn-mark-paid');
    const btnSave = document.getElementById('btn-save-invoice');

    if (btnSave) btnSave.style.display = 'none'; // Already saved

    if (btnMarkPaid) {
        btnMarkPaid.style.display = invoice.isPaid ? 'none' : 'inline-block';
    }

    document.getElementById('invoice-modal').style.display = 'flex';
};

// Mark invoice as paid by ID (updates Firestore)
window.markInvoicePaidById = async function (invoiceId) {
    try {
        // Update in Firestore using modular syntax
        const invoiceDocRef = doc(db, 'invoices', invoiceId);
        await updateDoc(invoiceDocRef, {
            isPaid: true,
            paidAt: new Date().toISOString()
        });

        // Update in local array
        const invoice = allInvoices.find(inv => inv.id === invoiceId);
        if (invoice) {
            invoice.isPaid = true;
        }

        renderInvoiceLists();
        showToast('Invoice marked as paid!', 'success');
    } catch (error) {
        console.error('Error marking invoice as paid:', error);
        showToast('Error updating invoice: ' + error.message, 'error');
    }
};

// View Invoice for individual booking (from table)
window.viewInvoice = function (bookingIndex) {
    const filteredBookings = allBookings.filter(b => {
        if (currentFinancialFilter === 'today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return b.bookingDate >= today;
        } else if (currentFinancialFilter === 'week') {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return b.bookingDate >= weekAgo;
        } else if (currentFinancialFilter === 'month') {
            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return b.bookingDate >= monthAgo;
        }
        return true;
    });

    const booking = filteredBookings[bookingIndex];
    if (!booking) return;

    // Use generateStoreInvoice with this booking's store pre-selected
    document.getElementById('invoice-store-select').value = booking.storeName;
    document.getElementById('invoice-period-select').value = 'current';
    generateStoreInvoice();
};

// Mark Invoice as Paid
window.markInvoicePaid = function () {
    document.getElementById('invoice-stamp').style.display = 'block';
    showToast('Invoice marked as paid!', 'success');
};

// ========== USER MANAGEMENT FUNCTIONS ==========

// Load Admin Dashboard
window.loadAdminDashboard = async function () {
    if (!currentUser || currentUser.role !== 'admin') return;

    // Show dashboard
    document.getElementById('dashboard-customer').style.display = 'none';
    document.getElementById('dashboard-owner').style.display = 'none';
    document.getElementById('dashboard-admin').style.display = 'block';

    // Load initial data
    loadAdminUsers();
}

let allUsers = [];
let currentUserFilter = 'all';

// Filter Users
window.filterUsers = function (role) {
    currentUserFilter = role;
    const btns = document.querySelectorAll('#admin-users .filter-btn');
    btns.forEach(b => {
        if (b.innerText.toLowerCase().includes(role) || (role === 'all' && b.innerText === 'All')) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    renderUsersTable();
}

// Load Users from Firestore
async function loadAdminUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6">Loading users...</td></tr>';

    try {
        // Optimisation: Limit to 50 or paginated in real app
        const snapshot = await getDocs(collection(db, "users"));
        allUsers = [];
        snapshot.forEach(docSnap => {
            allUsers.push({ id: docSnap.id, ...docSnap.data() }); // id is phone usually
        });

        renderUsersTable();
    } catch (error) {
        console.error("Error loading users:", error);
        tbody.innerHTML = '<tr><td colspan="6">Error loading users.</td></tr>';
        showToast("Failed to load users", "error");
    }
}

// Render Users Table
function renderUsersTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    let filtered = allUsers;
    if (currentUserFilter !== 'all') {
        filtered = allUsers.filter(u => u.role === currentUserFilter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(user => {
        const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
        let storeName = '-';

        if (user.role === 'owner' && user.storeId) {
            const store = allMerchants.find(m => m.id === user.storeId);
            storeName = store ? store.name : '(Unlinked Store)';
        }

        const roleBadgeColor =
            user.role === 'admin' ? 'purple' :
                user.role === 'owner' ? 'orange' : 'gray';

        return `
            <tr>
                <td>
                    <div style="font-weight: 500;">${user.name || 'Unknown'}</div>
                </td>
                <td>${user.phone || user.id}</td>
                <td>
                    <span class="status-badge" style="background-color: var(--${roleBadgeColor}-100, #eee); color: var(--${roleBadgeColor}-800, #333);">
                        ${user.role ? user.role.toUpperCase() : 'CUSTOMER'}
                    </span>
                </td>
                <td>${storeName}</td>
                <td>${joinDate}</td>
                <td>
                    <button class="action-btn" onclick="openEditUserModal('${user.phone || user.id}')">✏️ Edit Role</button>
                    <!-- <button class="action-btn danger">Ban</button> --> 
                </td>
            </tr>
        `;
    }).join('');
}

// Open Edit Modal
window.openEditUserModal = function (userId) {
    const user = allUsers.find(u => (u.phone === userId || u.id === userId));
    if (!user) return;

    document.getElementById('edit-user-phone').value = userId;
    document.getElementById('edit-user-name').value = user.name || '';
    document.getElementById('edit-user-role').value = user.role || 'customer';

    // Populate Store Dropdown
    const storeSelect = document.getElementById('edit-user-store');
    storeSelect.innerHTML = '<option value="">-- Select Store --</option>' +
        allMerchants.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    // Set current store if owner
    if (user.role === 'owner' && user.storeId) {
        storeSelect.value = user.storeId;
    }

    toggleStoreAssignment();
    document.getElementById('user-role-modal').style.display = 'flex';
}

// Toggle Store Dropdown visibility
window.toggleStoreAssignment = function () {
    const role = document.getElementById('edit-user-role').value;
    const group = document.getElementById('assign-store-group');
    if (role === 'owner') {
        group.style.display = 'block';
    } else {
        group.style.display = 'none';
        document.getElementById('edit-user-store').value = "";
    }
}

// Save User Role
document.getElementById('user-role-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userId = document.getElementById('edit-user-phone').value;
    const newRole = document.getElementById('edit-user-role').value;
    const storeId = document.getElementById('edit-user-store').value;

    if (newRole === 'owner' && !storeId) {
        showToast('Please select a store for the Store Owner', 'error');
        return;
    }

    try {
        const updateData = { role: newRole };
        if (newRole === 'owner') {
            updateData.storeId = storeId;
        } else {
            // Remove store association if demoted
            updateData.storeId = deleteDoc; // Actually field deletion syntax varies, usually updateDoc with { storeId: deleteField() }
            // For simplicity in this non-modular import setup, we might set to null or just ignore
            updateData.storeId = null;
        }

        const userRef = doc(db, "users", userId);
        await updateDoc(userRef, updateData);

        // Update local state
        const userIndex = allUsers.findIndex(u => u.phone === userId || u.id === userId);
        if (userIndex >= 0) {
            allUsers[userIndex] = { ...allUsers[userIndex], ...updateData };
        }

        showToast(`User role updated to ${newRole.toUpperCase()}`, 'success');
        closeModal('user-role-modal');
        renderUsersTable();

    } catch (error) {
        console.error("Error updating user role:", error);
        showToast("Failed to update role", "error");
    }
});


// Print Invoice
window.printInvoice = function () {
    window.print();
};

// Filter button handlers
document.addEventListener('DOMContentLoaded', () => {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadFinancials(btn.dataset.range);
        });
    });
});


// ========== OWNER DASHBOARD FUNCTIONS ==========

// Load Owner Dashboard
window.loadOwnerDashboard = async function () {
    if (!currentUser || currentUser.role !== 'owner') return;

    // Show dashboard
    document.getElementById('dashboard-customer').style.display = 'none';
    document.getElementById('dashboard-owner').style.display = 'block';

    // Update Store Badge
    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (store) {
        document.getElementById('owner-store-badge').innerText = `🏪 ${store.name}`;
    }

    // Setup Owner Tab Switching
    const tabs = document.querySelectorAll('.owner-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Hide panels
            document.querySelectorAll('.owner-panel').forEach(p => p.style.display = 'none');
            // Show target
            document.getElementById(`owner-${tab.dataset.tab}`).style.display = 'block';

            if (tab.dataset.tab === 'overview') loadOwnerOverview();
            if (tab.dataset.tab === 'bookings') loadOwnerBookings('all');
            if (tab.dataset.tab === 'mystore') loadOwnerStore();
            if (tab.dataset.tab === 'financials') loadOwnerFinancials();
        });
    });

    // Initial Load
    loadOwnerOverview();
};

// 1. Overview Tab
async function loadOwnerOverview() {
    const storeId = currentUser.storeId;
    if (!storeId) return;

    // Fetch stats (mocked logic or real aggregation)
    let totalRevenue = 0;
    let todayBookingsCount = 0;
    let pendingCount = 0;

    // Logic to calculate from bookings collection would go here
    // For now, we will just use dummy or fetch if bookings collection exists
    // Let's assume we fetch all bookings for this merchant
    try {
        const q = query(collection(db, "bookings"), where("merchantId", "==", storeId));
        const snapshot = await getDocs(q);
        const bookings = [];
        snapshot.forEach(d => bookings.push({ id: d.id, ...d.data() }));

        const today = new Date().toDateString();

        bookings.forEach(b => {
            // Calculate Revenue
            if (b.status === 'completed') {
                totalRevenue += (b.price || 0);
            }
            // Count Today's
            if (b.createdAt && b.createdAt.toDate().toDateString() === today) {
                todayBookingsCount++;
            }
            // Count Pending
            if (b.status === 'pending') {
                pendingCount++;
            }
        });

        document.getElementById('owner-stat-today').innerText = todayBookingsCount;
        document.getElementById('owner-stat-pending').innerText = pendingCount;
        document.getElementById('owner-stat-revenue').innerText = `${totalRevenue.toLocaleString()} IQD`;

        // Populate Pending List
        const pendingList = document.getElementById('owner-urgent-bookings-list');
        const pendingBookings = bookings.filter(b => b.status === 'pending');

        if (pendingBookings.length === 0) {
            pendingList.innerHTML = '<div class="empty-state">No pending bookings.</div>';
        } else {
            pendingList.innerHTML = pendingBookings.map(b => `
                <div class="appointment-card" style="padding: 15px; border: 1px solid #eee; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid #eab308;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${b.customerName || 'Customer'}</strong> requested <strong>${b.serviceName}</strong>
                            <div style="font-size: 0.85rem; color: #888;">${b.createdAt ? b.createdAt.toDate().toLocaleString() : ''}</div>
                        </div>
                        <div>
                            <button class="btn-primary" style="padding: 4px 12px; font-size: 0.8rem;" onclick="updateBookingStatus('${b.id}', 'confirmed')">Accept</button>
                            <button class="btn-outline" style="padding: 4px 12px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444;" onclick="updateBookingStatus('${b.id}', 'cancelled')">Decline</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }

    } catch (e) {
        console.error("Error loading owner stats:", e);
    }
}

// 2. Bookings Tab
let currentBookingFilter = 'all';
window.filterOwnerBookings = function (status) {
    currentBookingFilter = status;
    const btns = document.querySelectorAll('#owner-bookings .filter-btn');
    btns.forEach(b => {
        if (b.innerText.toLowerCase() === status || (status === 'all' && b.innerText === 'All')) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    loadOwnerBookings(status);
}

async function loadOwnerBookings(status) {
    const tbody = document.getElementById('owner-bookings-tbody');
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

    try {
        const q = query(collection(db, "bookings"), where("merchantId", "==", currentUser.storeId), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q); // In real app, might need composite index
        let bookings = [];
        snapshot.forEach(d => bookings.push({ id: d.id, ...d.data() }));

        if (status !== 'all') {
            bookings = bookings.filter(b => b.status === status);
        }

        if (bookings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No bookings found.</td></tr>';
            return;
        }

        tbody.innerHTML = bookings.map(b => `
            <tr>
                <td>${b.customerName}</td>
                <td>${b.serviceName}</td>
                <td>${b.createdAt ? b.createdAt.toDate().toLocaleString() : 'N/A'}</td>
                <td>${b.price.toLocaleString()} IQD</td>
                <td>
                    <span class="status-badge ${b.status}">
                        ${b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                    </span>
                </td>
                <td>
                    ${b.status === 'pending' ? `
                        <button class="action-btn" onclick="updateBookingStatus('${b.id}', 'confirmed')">✅ Accept</button>
                        <button class="action-btn danger" onclick="updateBookingStatus('${b.id}', 'cancelled')">❌ Reject</button>
                    ` : b.status === 'confirmed' ? `
                        <button class="action-btn" onclick="updateBookingStatus('${b.id}', 'completed')">🏁 Complete</button>
                    ` : ''}
                </td>
            </tr>
        `).join('');

    } catch (e) {
        console.error("Error loading bookings:", e);
        // Fallback if index missing
        tbody.innerHTML = '<tr><td colspan="6">Error or Missing Index. Please check console.</td></tr>';
    }
}

// Global action for booking status
window.updateBookingStatus = async function (id, status) {
    try {
        await updateDoc(doc(db, "bookings", id), { status: status });
        // Refresh views
        loadOwnerOverview(); // Update stats
        if (document.getElementById('owner-bookings').style.display !== 'none') {
            loadOwnerBookings(currentBookingFilter);
        }
        showToast(`Booking marked as ${status}`, 'success');
    } catch (e) {
        console.error(e);
        showToast('Failed to update status', 'error');
    }
}

// 3. My Store Tab
async function loadOwnerStore() {
    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store) return;

    // Populate Form
    document.getElementById('owner-store-name').value = store.name;
    document.getElementById('owner-store-address').value = store.address || '';
    document.getElementById('owner-store-lat').value = store.lat || '';
    document.getElementById('owner-store-lng').value = store.lng || '';

    // Services
    renderOwnerServices(store.services || []);
}

function renderOwnerServices(services) {
    const list = document.getElementById('owner-services-list');
    list.innerHTML = services.map((s, i) => `
         <div class="sortable-item">
            <div class="service-info">
                <div class="service-name">${s.name}</div>
                <div class="service-meta">${s.duration} mins • ${s.price.toLocaleString()} IQD</div>
            </div>
             <div class="service-actions">
                <button type="button" class="service-action-btn edit" onclick="editOwnerService(${i})">✏️</button>
                <button type="button" class="service-action-btn delete" onclick="deleteOwnerService(${i})">🗑️</button>
            </div>
        </div>
    `).join('');
}

window.saveOwnerStoreDetails = async function () {
    const name = document.getElementById('owner-store-name').value;
    const address = document.getElementById('owner-store-address').value;
    const lat = parseFloat(document.getElementById('owner-store-lat').value);
    const lng = parseFloat(document.getElementById('owner-store-lng').value);

    // Only update these fields
    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), {
            name, address, lat, lng
        });
        showToast('Store details updated!', 'success');
    } catch (e) {
        console.error(e);
        showToast('Failed to update store', 'error');
    }
}

// 4. Financials Tab
async function loadOwnerFinancials() {
    const storeId = currentUser.storeId;
    if (!storeId) return;

    // 1. Calculate Total Revenue & Commission Due
    let totalRevenue = 0;

    try {
        // Fetch bookings for revenue
        const bookingsQ = query(collection(db, "bookings"), where("merchantId", "==", storeId));
        const bookingSnapshot = await getDocs(bookingsQ);

        bookingSnapshot.forEach(doc => {
            const b = doc.data();
            if (b.status === 'completed') {
                totalRevenue += (b.price || 0);
            }
        });

        document.getElementById('owner-fin-total').innerText = `${totalRevenue.toLocaleString()} IQD`;

    } catch (e) {
        console.error("Error calculating owner revenue:", e);
    }

    // 2. Fetch Invoices for Commission Due & History
    try {
        const invoicesQ = query(collection(db, "invoices"), where("storeId", "==", storeId), orderBy("createdAt", "desc"));
        const invoiceSnapshot = await getDocs(invoicesQ);

        const invoices = [];
        let commissionDue = 0;

        invoiceSnapshot.forEach(doc => {
            const inv = { id: doc.id, ...doc.data() };
            invoices.push(inv);
            if (!inv.isPaid) {
                commissionDue += (inv.commission || 0);
            }
        });

        document.getElementById('owner-fin-due').innerText = `${commissionDue.toLocaleString()} IQD`;

        // Render Invoices List
        const invoicesList = document.getElementById('owner-invoices-list');
        if (invoices.length === 0) {
            invoicesList.innerHTML = '<div class="empty-state">No invoices generated by admin yet.</div>';
        } else {
            invoicesList.innerHTML = invoices.map(inv => `
                <div class="invoice-card">
                    <div class="invoice-card-info">
                        <h4>${inv.period}</h4>
                        <p>${inv.serviceCount} services • ${new Date(inv.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div class="invoice-card-amount">
                        <div class="amount">${inv.commission.toLocaleString()} IQD</div>
                        ${inv.isPaid
                    ? '<div class="date" style="color: green;">✓ Paid</div>'
                    : '<div class="date" style="color: var(--primary);">Due</div>'}
                    </div>
                     <div class="invoice-card-actions">
                        <button class="action-btn" onclick="viewSavedInvoice('${inv.id}')">View</button>
                    </div>
                </div>
            `).join('');
        }

    } catch (e) {
        console.error("Error loading owner invoices:", e);
        document.getElementById('owner-invoices-list').innerHTML = '<div class="empty-state">Error loading invoices. Check console.</div>';
    }
}

// Helper for location picker in owner mode
window.openLocationPickerForOwner = function () {
    window.isOwnerEditing = true; // flag to differentiate
    openLocationPicker();
    // We reuse the same logic but need to ensure it writes back to owner inputs
    // Override the confirm logic temporarily or handle in confirmLocationSelection
    const originalConfirm = window.confirmLocationSelection;
    window.confirmLocationSelection = function () {
        if (!pickedLocation) return;

        document.getElementById('owner-store-lat').value = pickedLocation.lat().toFixed(6);
        document.getElementById('owner-store-lng').value = pickedLocation.lng().toFixed(6);

        const closeBtn = document.querySelector('.close-map');
        if (closeBtn) closeBtn.click();

        // Restore
        window.confirmLocationSelection = originalConfirm;
    };
}

// 5. Store Photo Handling (Owner)
const ownerPhotoFile = document.getElementById('owner-store-photo-file');
const ownerPhotoPreview = document.getElementById('owner-store-photo-preview');

if (ownerPhotoFile) {
    ownerPhotoFile.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                ownerPhotoPreview.src = e.target.result;
                ownerPhotoPreview.style.display = 'block';
            }
            reader.readAsDataURL(file);
        }
    });
}

window.saveOwnerStoreDetails = async function () {
    const name = document.getElementById('owner-store-name').value;
    const address = document.getElementById('owner-store-address').value;
    const lat = parseFloat(document.getElementById('owner-store-lat').value);
    const lng = parseFloat(document.getElementById('owner-store-lng').value);
    const photoFile = document.getElementById('owner-store-photo-file').files[0];

    // Prepare Update Object
    let updateData = { name, address, lat, lng };

    try {
        // Upload Photo if new one selected
        if (photoFile) {
            const storageRef = ref(storage, `stores/${currentUser.storeId}/${Date.now()}_${photoFile.name}`);
            const snapshot = await uploadBytes(storageRef, photoFile);
            const downloadURL = await getDownloadURL(snapshot.ref);
            updateData.photo = downloadURL;
        }

        await updateDoc(doc(db, "merchants", currentUser.storeId), updateData);
        showToast('Store details updated successfully!', 'success');

        // Refresh local store data
        const storeIndex = allMerchants.findIndex(m => m.id === currentUser.storeId);
        if (storeIndex >= 0) {
            allMerchants[storeIndex] = { ...allMerchants[storeIndex], ...updateData };
        }
    } catch (e) {
        console.error(e);
        showToast('Failed to update store: ' + e.message, 'error');
    }
}

// 6. Owner Service Management
window.openAddServiceModalForOwner = function () {
    window.isOwnerServiceEdit = true; // Context flag
    document.getElementById('service-modal-title').innerText = 'Add New Service';
    document.getElementById('service-edit-index').value = -1; // New
    document.getElementById('service-edit-name').value = '';
    document.getElementById('service-edit-price').value = '';
    document.getElementById('service-edit-duration').value = '';

    // Override Save Handler
    const form = document.getElementById('service-form');
    form.onsubmit = saveOwnerService;

    document.getElementById('service-modal').style.display = 'flex';
}

window.editOwnerService = function (index) {
    window.isOwnerServiceEdit = true;
    const store = allMerchants.find(m => m.id === currentUser.storeId);
    const service = store.services[index];

    document.getElementById('service-modal-title').innerText = 'Edit Service';
    document.getElementById('service-edit-index').value = index;
    document.getElementById('service-edit-name').value = service.name;
    document.getElementById('service-edit-price').value = service.price;
    document.getElementById('service-edit-duration').value = service.duration;

    const form = document.getElementById('service-form');
    form.onsubmit = saveOwnerService;

    document.getElementById('service-modal').style.display = 'flex';
}

window.deleteOwnerService = async function (index) {
    if (!await showConfirm('Are you sure you want to delete this service?')) return;

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    store.services.splice(index, 1);

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { services: store.services });
        renderOwnerServices(store.services);
    } catch (e) {
        showToast('Error deleting service', 'error');
    }
}

async function saveOwnerService(e) {
    e.preventDefault();
    const name = document.getElementById('service-edit-name').value;
    const price = parseInt(document.getElementById('service-edit-price').value);
    const duration = parseInt(document.getElementById('service-edit-duration').value);
    const index = parseInt(document.getElementById('service-edit-index').value);

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store.services) store.services = [];

    const newService = { name, price, duration };

    if (index === -1) {
        store.services.push(newService);
    } else {
        store.services[index] = newService;
    }

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { services: store.services });
        renderOwnerServices(store.services);
        closeModal('service-modal');
    } catch (e) {
        console.error(e);
        showToast('Error saving service', 'error');
    }
}


// Start
init();
initDarkMode();
