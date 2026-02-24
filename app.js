import { db, auth, storage } from "./firebase-config.js";
import { collection, getDocs, getDoc, query, where, addDoc, doc, updateDoc, deleteDoc, Timestamp, setDoc, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { RecaptchaVerifier, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

// DEV MODE: Quick Login
window.devLogin = async function (phone, password) {
    try {
        // Find user by phone
        const q = query(collection(db, "users"), where("phone", "==", phone));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            showToast(`User ${phone} not found!`, 'error');
            return;
        }

        const userData = snapshot.docs[0].data();

        // DEV MODE: Skip password check for quick testing
        // In production, remove this and use proper auth

        // Set current user
        currentUser = { id: snapshot.docs[0].id, ...userData };

        // Update UI
        document.getElementById('login-btn').style.display = 'none';
        document.getElementById('user-profile').style.display = 'flex';
        document.getElementById('user-name').textContent = currentUser.name || 'User';

        // Close auth modal if open
        closeModal('auth-modal');

        // Load role-specific dashboard
        if (currentUser.role === 'admin') {
            document.getElementById('dashboard-admin').style.display = 'block';
            loadAdminDashboard();
        } else if (currentUser.role === 'owner') {
            loadOwnerDashboard();
        }

        showToast(`Welcome back, ${currentUser.name}! 👋`, 'success');

    } catch (error) {
        console.error('Dev login error:', error);
        showToast('Login failed: ' + error.message, 'error');
    }
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

    // Persistent Login
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Extract phone from dummy email (phone@docbook.app)
            let phone = null;
            if (user.email && user.email.includes('@docbook.app')) {
                phone = user.email.split('@')[0];
            }

            if (phone) {
                try {
                    const userDoc = await checkUserExists(phone);
                    if (userDoc) {
                        currentUser = userDoc;
                        console.log("Session restored:", currentUser.name);
                        updateUIForUser();
                    }
                } catch (e) {
                    console.error("Error restoring session:", e);
                }
            }
        } else {
            // User is signed out
            currentUser = null;
            // Optional: update UI to show login button if needed, but it's default
        }
    });
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
            showAuthStep('login');
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
            status: 'pending', // Initial status is pending
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
// Global scope for HTML access
let bookingState = {
    merchant: null,
    services: [], // Array of selected service objects
    date: null,
    time: null,
    step: 1
};

window.openMerchantDetails = function (id) {
    const merchant = allMerchants.find(m => m.id === id);
    if (!merchant) return;

    // Reset State
    bookingState = {
        merchant: merchant,
        services: [],
        date: null,
        time: null,
        step: 1
    };

    renderBookingWizard();
    document.getElementById('booking-modal').style.display = 'flex';
}

function renderBookingWizard() {
    const body = document.getElementById('booking-modal-body');
    const footer = document.getElementById('booking-modal-footer');

    // Header (Static for all steps)
    let content = `
        <div class="modal-header" style="text-align: center; margin-bottom: 20px;">
            <h2 style="margin-bottom: 5px;">${bookingState.merchant.name}</h2>
            <p style="color: #666;">Step ${bookingState.step} of 3</p>
        </div>
    `;

    // Step 1: Select Services
    if (bookingState.step === 1) {
        content += renderBookingStep1();
        footer.innerHTML = `
            <button class="btn-outline" onclick="closeModal('booking-modal')">Cancel</button>
            <button class="btn-primary" onclick="nextBookingStep()" ${bookingState.services.length === 0 ? 'disabled' : ''}>Next ➝</button>
        `;
    }
    // Step 2: Select Date & Time
    else if (bookingState.step === 2) {
        content += renderBookingStep2();
        footer.innerHTML = `
            <button class="btn-outline" onclick="prevBookingStep()">← Back</button>
            <button class="btn-primary" onclick="nextBookingStep()" ${!bookingState.date || !bookingState.time ? 'disabled' : ''}>Next ➝</button>
        `;
    }
    // Step 3: Confirm
    else if (bookingState.step === 3) {
        content += renderBookingStep3();
        footer.innerHTML = `
            <button class="btn-outline" onclick="prevBookingStep()">← Back</button>
            <button class="btn-primary" onclick="submitBooking()" style="background: #059669;">Confirm Booking ✅</button>
        `;
    }

    body.innerHTML = content;
}


// --- STEP 1: SERVICES ---
function renderBookingStep1() {
    const merchant = bookingState.merchant;
    const now = new Date();

    // Get active offers
    const merchantOffers = allOffers.filter(o => {
        if (o.storeId !== merchant.id) return false;
        const endDate = o.endDate?.toDate ? o.endDate.toDate() : new Date(o.endDate);
        return endDate > now && o.active;
    });

    const servicesList = merchant.services ? merchant.services.map((s, index) => {
        const isSelected = bookingState.services.some(sel => sel.name === s.name);

        // Calculate Price with Offer
        const offer = merchantOffers.find(o => o.serviceName === s.name);
        const hasDiscount = !!offer;
        const discountPercent = offer?.discountPercent || 0;
        const currentPrice = hasDiscount ? Math.round(s.price * (1 - discountPercent / 100)) : s.price;

        return `
        <div class="service-select-item ${isSelected ? 'selected' : ''}" onclick="toggleServiceSelection('${s.name}', ${currentPrice}, ${s.duration})">
            <div style="display: flex; align-items: center;">
                <div class="checkbox-circle"></div>
                <div>
                    <div style="font-weight: 500;">
                        ${s.name} ${hasDiscount ? `<span class="service-discount-tag">${discountPercent}% OFF</span>` : ''}
                    </div>
                    <div style="font-size: 0.8rem; color: #666;">${s.duration} mins</div>
                </div>
            </div>
            <div style="font-weight: 600;">${currentPrice.toLocaleString()} IQD</div>
        </div>
        `;
    }).join('') : '<p>No services available.</p>';

    // Calculate Totals
    const totalCost = bookingState.services.reduce((sum, s) => sum + s.price, 0);
    const totalTime = bookingState.services.reduce((sum, s) => sum + s.duration, 0);

    return `
        <h3 style="margin-bottom: 15px;">Select Services</h3>
        <div class="services-list" style="max-height: 300px; overflow-y: auto;">
            ${servicesList}
        </div>
        <div class="booking-total">
            <span>Total (${bookingState.services.length} services):</span>
            <span>${totalCost.toLocaleString()} IQD</span>
        </div>
    `;
}

window.toggleServiceSelection = function (name, price, duration) {
    const index = bookingState.services.findIndex(s => s.name === name);
    if (index === -1) {
        bookingState.services.push({ name, price, duration });
    } else {
        bookingState.services.splice(index, 1);
    }
    renderBookingWizard();
}

// --- STEP 2: DATE & TIME ---
function renderBookingStep2() {
    // Generate next 14 days
    let datesHtml = '';
    const today = new Date();

    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toDateString();
        const isSelected = bookingState.date === dateStr;

        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = d.getDate();

        datesHtml += `
            <div class="date-card ${isSelected ? 'selected' : ''}" onclick="selectBookingDate('${dateStr}')">
                <div style="font-size: 0.8rem;">${dayName}</div>
                <div style="font-weight: 700; font-size: 1.2rem;">${dayNum}</div>
            </div>
        `;
    }

    // Generate Time Slots (10:00 to 20:00)
    let timesHtml = '';
    if (bookingState.date) {
        const startHour = 10;
        const endHour = 20;
        for (let h = startHour; h < endHour; h++) {
            // :00
            const time1 = `${h}:00`;
            const isSel1 = bookingState.time === time1;
            timesHtml += `<div class="time-slot ${isSel1 ? 'selected' : ''}" onclick="selectBookingTime('${time1}')">${time1}</div>`;

            // :30
            const time2 = `${h}:30`;
            const isSel2 = bookingState.time === time2;
            timesHtml += `<div class="time-slot ${isSel2 ? 'selected' : ''}" onclick="selectBookingTime('${time2}')">${time2}</div>`;
        }
    } else {
        timesHtml = '<p style="grid-column: span 3; text-align: center; color: #888;">Select a date first</p>';
    }

    return `
        <h3 style="margin-bottom: 10px;">Select Date</h3>
        <div class="date-picker-grid">
            ${datesHtml}
        </div>
        
        <h3 style="margin-bottom: 10px;">Select Time</h3>
        <div class="time-slots-grid">
            ${timesHtml}
        </div>
    `;
}

window.selectBookingDate = function (dateStr) {
    bookingState.date = dateStr;
    bookingState.time = null; // Reset time on date change
    renderBookingWizard();
}

window.selectBookingTime = function (timeStr) {
    bookingState.time = timeStr;
    renderBookingWizard();
}

// --- STEP 3: CONFIRM ---
function renderBookingStep3() {
    const totalCost = bookingState.services.reduce((sum, s) => sum + s.price, 0);

    const servicesSummary = bookingState.services.map(s => `
        <div class="booking-detail-item">
            <span>${s.name}</span>
            <span>${s.price.toLocaleString()} IQD</span>
        </div>
    `).join('');

    return `
        <h3 style="margin-bottom: 15px;">Confirm Details</h3>
        <div class="booking-summary">
            <div class="booking-detail-item">
                <strong style="color: #666;">Date & Time</strong>
                <strong>${bookingState.date}, ${bookingState.time}</strong>
            </div>
            <div style="margin-top: 15px; margin-bottom: 5px; font-weight: 600; color: #666;">Services</div>
            ${servicesSummary}
            <div class="booking-total">
                <span>Total Amount:</span>
                <span style="color: var(--primary);">${totalCost.toLocaleString()} IQD</span>
            </div>
        </div>
        <p style="text-align: center; margin-top: 15px; font-size: 0.9rem; color: #666;">
            Payment will be collected at the venue.
        </p>
    `;
}

// Navigation
window.nextBookingStep = function () {
    bookingState.step++;
    renderBookingWizard();
}

window.prevBookingStep = function () {
    bookingState.step--;
    renderBookingWizard();
}

// Submit
window.submitBooking = async function () {
    if (!currentUser) {
        showToast("Please login first.", 'error');
        document.getElementById('booking-modal').style.display = 'none';
        authModal.style.display = 'flex';
        return;
    }

    const totalCost = bookingState.services.reduce((sum, s) => sum + s.price, 0);
    const totalDuration = bookingState.services.reduce((sum, s) => sum + s.duration, 0);

    // Create Date Object
    const dateTimeStr = `${bookingState.date} ${bookingState.time}`;
    const bookingDateObj = new Date(dateTimeStr);

    try {
        const bookingData = {
            userId: currentUser.id || currentUser.phone,
            customerName: currentUser.name,
            customerPhone: currentUser.phone,
            storeId: bookingState.merchant.id, // Ensure this is saved as storeId
            merchantId: bookingState.merchant.id, // Keep for backward compatibility
            storeName: bookingState.merchant.name,

            // New Array Structure
            services: bookingState.services,

            // Legacy fields for backward compat (using first service or summary)
            serviceName: bookingState.services.map(s => s.name).join(', '),
            servicePrice: totalCost,
            price: totalCost, // key for owner dashboard compatibility
            serviceDuration: totalDuration,

            bookingDate: bookingDateObj,
            status: 'pending',
            commission: Math.round(totalCost * 0.1),
            createdAt: new Date().toISOString()
        };

        await addDoc(collection(db, 'bookings'), bookingData);

        showToast('Booking Request Sent! 🚀', 'success');
        document.getElementById('booking-modal').style.display = 'none';

        // Refresh if needed
        if (currentUser.role === 'admin') loadFinancials();

    } catch (e) {
        console.error("Booking Error:", e);
        showToast("Failed to book service.", 'error');
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

    // Create a Set of all paid booking IDs for efficient lookup
    const paidBookingIds = new Set();
    allInvoices.forEach(inv => {
        if (inv.isPaid && inv.bookings) {
            inv.bookings.forEach(b => paidBookingIds.add(b.id || b.bookingId)); // Handle potential schema variations
        }
    });

    // Calculate stats
    const completedBookings = filteredBookings.filter(b => b.status === 'completed');

    const totalRevenue = completedBookings.reduce((sum, b) => sum + b.servicePrice, 0);
    const totalCommission = completedBookings.reduce((sum, b) => sum + b.commission, 0);

    // Pending Payouts = Commission from COMPLETED bookings that are NOT paid
    const pendingPayoutAmount = completedBookings
        .filter(b => !paidBookingIds.has(b.id))
        .reduce((sum, b) => sum + b.commission, 0);

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
    document.getElementById('stat-pending').textContent = pendingPayoutAmount.toLocaleString() + ' IQD';
    document.getElementById('stat-this-month').textContent = thisMonthCommission.toLocaleString() + ' IQD';

    // Update table
    const tbody = document.getElementById('financials-tbody');
    if (filteredBookings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No bookings found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredBookings.slice(0, 15).map((booking, index) => {
        const isPaid = paidBookingIds.has(booking.id);

        let statusBadgeClass = '';
        let statusText = '';

        if (isPaid) {
            statusBadgeClass = 'paid';
            statusText = '✓ Paid';
        } else if (booking.status === 'completed') {
            statusBadgeClass = 'completed'; // You might need to add this class in CSS if not exists, or use 'paid' style
            statusText = '🏁 Completed (Unpaid)';
        } else if (booking.status === 'confirmed') {
            statusBadgeClass = 'active';
            statusText = '📅 Confirmed';
        } else {
            statusBadgeClass = 'pending-payment';
            statusText = '⏳ Pending';
        }

        return `
        <tr>
            <td>${booking.bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
            <td><strong>${booking.storeName}</strong></td>
            <td>${booking.serviceName}</td>
            <td>${booking.servicePrice.toLocaleString()} IQD</td>
            <td style="color: #059669; font-weight: 600;">${booking.commission.toLocaleString()} IQD</td>
            <td>
                <span class="status-badge ${statusBadgeClass}">
                    ${statusText}
                </span>
            </td>
            <td>
                ${booking.status === 'completed' && !isPaid ?
                `<button class="action-btn" onclick="viewInvoice(${index})">📄 Invoice</button>` :
                '-'}
            </td>
        </tr>
    `}).join('');
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
                    id: b.id, // Linked Booking ID
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
                id: b.id, // Linked Booking ID
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
        loadFinancials(); // Refresh main table to show "Paid" status
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
    document.getElementById('dashboard-admin').style.display = 'none'; // Ensure admin dashboard is hidden
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
            if (tab.dataset.tab === 'calendar') loadOwnerCalendar();
            if (tab.dataset.tab === 'store') loadOwnerStore();
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
        const q = query(collection(db, "bookings"), where("storeId", "==", storeId));
        const snapshot = await getDocs(q);
        const bookings = [];
        snapshot.forEach(d => bookings.push({ id: d.id, ...d.data() }));

        const today = new Date().toDateString();

        bookings.forEach(b => {
            // Calculate Revenue
            if (b.status === 'completed') {
                totalRevenue += (b.price || 0);
            }
            // Count Today's - handle both ISO string and Firestore Timestamp
            const createdDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            if (createdDate && createdDate.toDateString() === today) {
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
            pendingList.innerHTML = pendingBookings.map(b => {
                const dateStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : new Date(b.createdAt).toLocaleString();
                return `
                <div class="appointment-card" style="padding: 15px; border: 1px solid #eee; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid #eab308;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${b.customerName || 'Customer'}</strong> requested <strong>${b.serviceName}</strong>
                            <div style="font-size: 0.85rem; color: #888;">${dateStr}</div>
                        </div>
                        <div>
                            <button class="btn-primary" style="padding: 4px 12px; font-size: 0.8rem;" onclick="updateBookingStatus('${b.id}', 'confirmed')">Accept</button>
                            <button class="btn-outline" style="padding: 4px 12px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444;" onclick="updateBookingStatus('${b.id}', 'cancelled')">Decline</button>
                        </div>
                    </div>
                </div>
            `}).join('');
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

    // Check if storeId exists
    if (!currentUser || !currentUser.storeId) {
        tbody.innerHTML = '<tr><td colspan="6">No store linked to this account.</td></tr>';
        return;
    }

    try {
        // Query without orderBy to avoid composite index requirement
        const q = query(collection(db, "bookings"), where("storeId", "==", currentUser.storeId));
        const snapshot = await getDocs(q);
        let bookings = [];
        snapshot.forEach(d => bookings.push({ id: d.id, ...d.data() }));

        // Sort by createdAt in JS (descending)
        bookings.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            return dateB - dateA;
        });

        if (status !== 'all') {
            bookings = bookings.filter(b => b.status === status);
        }

        if (bookings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No bookings found.</td></tr>';
            return;
        }

        tbody.innerHTML = bookings.map(b => {
            const dateStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : new Date(b.createdAt).toLocaleString();
            return `
            <tr>
                <td>${b.customerName || 'Customer'}</td>
                <td>${b.serviceName || 'Service'}</td>
                <td>${dateStr}</td>
                <td>${(b.price || 0).toLocaleString()} IQD</td>
                <td>
                    <span class="status-badge ${b.status}">
                        ${b.status ? b.status.charAt(0).toUpperCase() + b.status.slice(1) : 'Unknown'}
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
        `}).join('');

    } catch (e) {
        console.error("Error loading bookings:", e);
        tbody.innerHTML = '<tr><td colspan="6">Error loading bookings. Check console.</td></tr>';
    }
}

// Update Booking Status (Confirm/Reject/Complete)
window.updateBookingStatus = async function (bookingId, newStatus) {
    // Confirmation messages for each action
    const confirmMessages = {
        'confirmed': 'Are you sure you want to ACCEPT this booking?',
        'cancelled': 'Are you sure you want to REJECT this booking?',
        'completed': 'Mark this booking as COMPLETED?'
    };

    const confirmed = await showConfirm(confirmMessages[newStatus] || 'Are you sure?');
    if (!confirmed) return;

    try {
        const bookingRef = doc(db, "bookings", bookingId);
        const bookingSnap = await getDoc(bookingRef);

        if (!bookingSnap.exists()) {
            showToast('Booking not found!', 'error');
            return;
        }

        const bookingData = bookingSnap.data();

        // Update booking status
        await updateDoc(bookingRef, {
            status: newStatus,
            updatedAt: new Date().toISOString()
        });

        // If confirmed, add to store calendar
        if (newStatus === 'confirmed') {
            const calendarEvent = {
                bookingId: bookingId,
                storeId: bookingData.storeId || '',
                storeName: bookingData.storeName || '',
                customerName: bookingData.customerName || 'Customer',
                customerPhone: bookingData.customerPhone || '',
                serviceName: bookingData.serviceName || 'Service',
                price: bookingData.price || 0,
                duration: bookingData.serviceDuration || bookingData.duration || 30,
                bookingDate: bookingData.bookingDate || new Date().toISOString(),
                bookingTime: bookingData.bookingTime || bookingData.time || '10:00',
                status: 'confirmed',
                createdAt: new Date().toISOString()
            };

            await addDoc(collection(db, "storeCalendar"), calendarEvent);
            showToast('✅ Booking Confirmed & Added to Calendar!', 'success');
        } else if (newStatus === 'cancelled') {
            // Remove from calendar if exists
            const calQ = query(collection(db, "storeCalendar"), where("bookingId", "==", bookingId));
            const calSnap = await getDocs(calQ);
            calSnap.forEach(async (d) => {
                await deleteDoc(doc(db, "storeCalendar", d.id));
            });
            showToast('❌ Booking Declined', 'info');
        } else if (newStatus === 'completed') {
            // Update calendar event status
            const calQ = query(collection(db, "storeCalendar"), where("bookingId", "==", bookingId));
            const calSnap = await getDocs(calQ);
            calSnap.forEach(async (d) => {
                await updateDoc(doc(db, "storeCalendar", d.id), { status: 'completed' });
            });

            // === FINANCIAL TRACKING ===
            // Handle both legacy and new price fields
            let servicePrice = 0;
            if (bookingData.price !== undefined) servicePrice = Number(bookingData.price);
            else if (bookingData.servicePrice !== undefined) servicePrice = Number(bookingData.servicePrice);

            const commission = Math.round(servicePrice * 0.10); // 10% commission
            const storeId = bookingData.storeId || bookingData.merchantId || currentUser.storeId;

            console.log('Financial tracking:', { storeId, servicePrice, commission, raw: bookingData });

            if (!storeId) {
                console.error('No storeId found for financial tracking!');
                showToast('Warning: Financials not updated (missing store ID)', 'warning');
            } else {
                // Update store financials
                const storeFinRef = doc(db, "storeFinancials", storeId);

                try {
                    const storeFinSnap = await getDoc(storeFinRef);

                    if (storeFinSnap.exists()) {
                        const currentData = storeFinSnap.data();
                        await updateDoc(storeFinRef, {
                            totalRevenue: (currentData.totalRevenue || 0) + servicePrice,
                            totalCommission: (currentData.totalCommission || 0) + commission,
                            updatedAt: new Date().toISOString()
                        });
                    } else {
                        await setDoc(storeFinRef, {
                            storeId: storeId,
                            storeName: bookingData.storeName || '',
                            totalRevenue: servicePrice,
                            totalCommission: commission,
                            paidCommission: 0,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });
                    }
                    console.log('Financials updated successfully');
                } catch (err) {
                    console.error('Error updating financials doc:', err);
                }

                // Create transaction
                try {
                    await addDoc(collection(db, "storeTransactions"), {
                        storeId: storeId,
                        storeName: bookingData.storeName || '',
                        bookingId: bookingId,
                        type: 'revenue',
                        amount: servicePrice,
                        commission: commission,
                        serviceName: bookingData.serviceName || 'Service',
                        customerName: bookingData.customerName || 'Customer',
                        createdAt: new Date().toISOString()
                    });
                } catch (err) {
                    console.error('Error adding transaction:', err);
                }

                showToast(`🏁 Complete! +${servicePrice.toLocaleString()} IQD Revenue`, 'success');

                // Refresh financials tab if visible
                if (document.getElementById('owner-financials').style.display !== 'none') {
                    loadOwnerFinancials();
                }
            }
        }



        // Refresh bookings list
        loadOwnerBookings('all');
        loadOwnerCalendar();

    } catch (error) {
        console.error('Error updating booking:', error);
        showToast('Failed to update booking: ' + error.message, 'error');
    }
};

// 2b. Calendar Tab
let currentCalendarDate = new Date();

async function loadOwnerCalendar() {
    const storeId = currentUser.storeId;
    if (!storeId) return;

    try {
        const q = query(collection(db, "bookings"), where("storeId", "==", storeId));
        const snapshot = await getDocs(q);
        const bookings = [];
        snapshot.forEach(d => bookings.push({ id: d.id, ...d.data() }));

        renderOwnerCalendar(bookings);
    } catch (e) {
        console.error("Error loading calendar:", e);
    }
}

function renderOwnerCalendar(bookings) {
    const grid = document.getElementById('owner-calendar-grid');
    grid.innerHTML = '';

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    // Update Header
    document.getElementById('calendar-month-year').innerText = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells for previous month
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        grid.appendChild(emptyCell);
    }

    // Days
    for (let i = 1; i <= daysInMonth; i++) {
        const dayDate = new Date(year, month, i);
        const dateString = dayDate.toDateString();

        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';

        // Day number
        const dayNum = document.createElement('span');
        dayNum.className = 'day-number';
        dayNum.innerText = i;
        dayCell.appendChild(dayNum);

        // Check for bookings
        const dayBookings = bookings.filter(b => {
            if (!b.bookingDate) return false;
            // Handle Firestore Timestamp or Date object or ISO string
            const bDate = b.bookingDate.toDate ? b.bookingDate.toDate() : new Date(b.bookingDate);
            return bDate.toDateString() === dateString;
        });

        if (dayBookings.length > 0) {
            dayCell.classList.add('has-bookings');

            // Add line break
            dayCell.appendChild(document.createElement('br'));

            // Booking count badge
            const badge = document.createElement('span');
            badge.className = 'booking-count-badge';
            badge.innerText = dayBookings.length === 1 ? '1 Event' : `${dayBookings.length} Events`;
            dayCell.appendChild(badge);
        }

        // Highlight today
        if (dayDate.toDateString() === new Date().toDateString()) {
            dayCell.classList.add('today');
        }

        dayCell.onclick = () => openCalendarDayModal(dayBookings, dateString);
        grid.appendChild(dayCell);
    }
}

window.changeCalendarMonth = function (offset) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + offset);
    loadOwnerCalendar();
}

function openCalendarDayModal(bookings, dateString) {
    // Create modal content
    let modalContent = `
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0;">📅 ${dateString}</h2>
            <span class="close-modal" onclick="closeModal('calendar-day-modal')">&times;</span>
        </div>
    `;

    if (bookings.length === 0) {
        modalContent += `
            <div style="text-align: center; padding: 40px; color: #888;">
                <span style="font-size: 3rem;">📭</span>
                <p>No bookings for this day.</p>
            </div>
        `;
    } else {
        modalContent += `
            <div style="margin-bottom: 15px; padding: 10px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border-radius: 8px; text-align: center;">
                <strong>${bookings.length}</strong> booking${bookings.length > 1 ? 's' : ''} scheduled
            </div>
        `;

        modalContent += bookings.map(b => {
            const bookingTime = b.bookingTime || b.time || 'TBD';
            const dateStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : new Date(b.createdAt).toLocaleString();

            return `
            <div style="background: #f9fafb; padding: 15px; border-radius: 10px; margin-bottom: 12px; border-left: 4px solid ${b.status === 'confirmed' ? '#22c55e' : b.status === 'pending' ? '#eab308' : b.status === 'completed' ? '#3b82f6' : '#ef4444'
                };">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <strong style="font-size: 1.1rem;">${b.serviceName || 'Service'}</strong>
                        <div style="margin-top: 8px;">
                            <span style="color: #666;">👤 Customer:</span> <strong>${b.customerName || 'N/A'}</strong>
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;">📞 Phone:</span> ${b.customerPhone || 'N/A'}
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;">🕐 Time:</span> <strong>${bookingTime}</strong>
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;">💰 Price:</span> ${(b.price || 0).toLocaleString()} IQD
                        </div>
                        <div style="margin-top: 4px; font-size: 0.8rem; color: #888;">
                            Booked: ${dateStr}
                        </div>
                    </div>
                    <span class="status-badge ${b.status}" style="padding: 5px 12px;">
                        ${b.status ? b.status.charAt(0).toUpperCase() + b.status.slice(1) : 'Unknown'}
                    </span>
                </div>
                ${b.status === 'pending' ? `
                <div style="margin-top: 12px; display: flex; gap: 8px;">
                    <button class="btn-primary" style="padding: 6px 16px; font-size: 0.85rem;" onclick="updateBookingStatus('${b.id}', 'confirmed')">✅ Accept</button>
                    <button class="btn-outline" style="padding: 6px 16px; font-size: 0.85rem; border-color: #ef4444; color: #ef4444;" onclick="updateBookingStatus('${b.id}', 'cancelled')">❌ Reject</button>
                </div>
                ` : b.status === 'confirmed' ? `
                <div style="margin-top: 12px;">
                    <button class="btn-primary" style="padding: 6px 16px; font-size: 0.85rem;" onclick="updateBookingStatus('${b.id}', 'completed')">🏁 Mark Complete</button>
                </div>
                ` : ''}
            </div>
        `}).join('');
    }

    // Create or update modal
    let modal = document.getElementById('calendar-day-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'calendar-day-modal';
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content" style="max-width: 500px;"></div>`;
        document.body.appendChild(modal);
    }

    modal.querySelector('.modal-content').innerHTML = modalContent;
    modal.style.display = 'flex';
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

    try {
        // 1. Load store financials from storeFinancials collection
        const storeFinRef = doc(db, "storeFinancials", storeId);
        const storeFinSnap = await getDoc(storeFinRef);

        let totalRevenue = 0;
        let totalCommission = 0;
        let paidCommission = 0;

        if (storeFinSnap.exists()) {
            const data = storeFinSnap.data();
            totalRevenue = data.totalRevenue || 0;
            totalCommission = data.totalCommission || 0;
            paidCommission = data.paidCommission || 0;
        }

        const pendingCommission = totalCommission - paidCommission;
        const netEarnings = totalRevenue - totalCommission;

        // Update stat cards
        document.getElementById('owner-fin-total').innerText = `${totalRevenue.toLocaleString()} IQD`;
        document.getElementById('owner-fin-due').innerText = `${pendingCommission.toLocaleString()} IQD`;

        // Update net earnings if element exists
        const netEl = document.getElementById('owner-fin-net');
        if (netEl) netEl.innerText = `${netEarnings.toLocaleString()} IQD`;

    } catch (e) {
        console.error("Error loading store financials:", e);
    }

    // 2. Load recent transactions
    try {
        const transQ = query(
            collection(db, "storeTransactions"),
            where("storeId", "==", storeId)
        );
        const transSnap = await getDocs(transQ);
        const transactions = [];
        transSnap.forEach(d => transactions.push({ id: d.id, ...d.data() }));

        // Sort by date (newest first)
        transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Render recent transactions
        const transactionsList = document.getElementById('owner-transactions-list');
        if (transactionsList) {
            if (transactions.length === 0) {
                transactionsList.innerHTML = '<div class="empty-state">No transactions yet. Complete bookings to see revenue here.</div>';
            } else {
                transactionsList.innerHTML = transactions.slice(0, 10).map(t => `
                    <div class="transaction-item" style="display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid #eee;">
                        <div>
                            <strong>${t.serviceName}</strong>
                            <div style="font-size: 0.85rem; color: #666;">${t.customerName} • ${new Date(t.createdAt).toLocaleDateString()}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="color: #22c55e; font-weight: 600;">+${t.amount.toLocaleString()} IQD</div>
                            <div style="font-size: 0.75rem; color: #888;">-${t.commission.toLocaleString()} commission</div>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (e) {
        console.error("Error loading transactions:", e);
    }

    // 3. Fetch Invoices from Admin
    try {
        const invoicesQ = query(collection(db, "invoices"), where("storeId", "==", storeId));
        const invoiceSnapshot = await getDocs(invoicesQ);

        const invoices = [];
        invoiceSnapshot.forEach(d => {
            invoices.push({ id: d.id, ...d.data() });
        });

        // Sort by date
        invoices.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Render Invoices List
        const invoicesList = document.getElementById('owner-invoices-list');
        if (invoices.length === 0) {
            invoicesList.innerHTML = '<div class="empty-state">No invoices from admin yet.</div>';
        } else {
            invoicesList.innerHTML = invoices.map(inv => `
                <div class="invoice-card">
                    <div class="invoice-card-info">
                        <h4>${inv.period || 'Invoice'}</h4>
                        <p>${inv.serviceCount || 0} services • ${new Date(inv.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div class="invoice-card-amount">
                        <div class="amount">${(inv.commission || 0).toLocaleString()} IQD</div>
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
        document.getElementById('owner-invoices-list').innerHTML = '<div class="empty-state">Error loading invoices.</div>';
    }
}


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
