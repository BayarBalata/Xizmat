import { db, auth, storage } from "./firebase-config.js";
import { collection, getDocs, getDoc, query, where, addDoc, doc, updateDoc, deleteDoc, Timestamp, setDoc, orderBy, limit, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { RecaptchaVerifier, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
let allReviews = [];
let currentFilter = 'all';
let currentUser = null;
let map = null;
let markers = [];
let infoWindow = null;
let isPickingLocation = false;
let pickerMarker = null;
let pickedLocation = null;
let venueProfileMap = null;
let venueProfileMapMarker = null;

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

        // Centralized UI Update
        updateUIForUser();

        // Close auth modal if open
        closeModal('auth-modal');

        console.log("DEV login successful for:", currentUser.role);

        showToast(`Welcome back, ${currentUser.name}! `, 'success');

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
    setupHomepageMotion();
    updateHomepageMetrics();
    await loadOffersData(); // Load offers first so discounts show on cards
    await loadReviewsData(); // Load reviews for star ratings on cards
    await loadMerchants();
    loadSponsorsForCustomer();

    // Persistent Login
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Extract phone from dummy email (phone@hewrina.app)
            let phone = null;
            if (user.email && user.email.includes('@hewrina.app')) {
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
        updateHomepageMetrics();
    } catch (error) {
        console.error('Error loading offers:', error);
    }
}

function toSafeDate(value) {
    if (!value) return null;
    const dateValue = value?.toDate ? value.toDate() : new Date(value);
    return isNaN(dateValue.getTime()) ? null : dateValue;
}

function normalizeOfferInputTime(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const parts = timeValue.split(':');
    if (parts.length < 2) return null;
    const hour = Number(parts[0]);
    const minute = Number(parts[1]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }
    return `${hour}:${String(minute).padStart(2, '0')}`;
}

function parseTimeToMinutes(timeValue) {
    const normalized = normalizeOfferInputTime(timeValue);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    return (h * 60) + m;
}

function isOfferTimeRestricted(offer) {
    return parseTimeToMinutes(offer?.validFromTime) !== null && parseTimeToMinutes(offer?.validToTime) !== null;
}

function formatOfferHours(offer) {
    if (!isOfferTimeRestricted(offer)) return 'All day';
    const from = normalizeOfferInputTime(offer.validFromTime);
    const to = normalizeOfferInputTime(offer.validToTime);
    if (!from || !to) return 'All day';
    return `${formatTime12h(from)} - ${formatTime12h(to)}`;
}

function getBookingDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const selectedDate = new Date(dateStr);
    if (isNaN(selectedDate.getTime())) return null;
    const normalizedTime = normalizeOfferInputTime(timeStr);
    if (!normalizedTime) return null;
    const [hours, minutes] = normalizedTime.split(':').map(Number);
    return new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        hours,
        minutes
    );
}

function isOfferActiveAt(offer, atDate = new Date()) {
    if (!offer || !offer.active) return false;
    const startDate = toSafeDate(offer.startDate);
    const endDate = toSafeDate(offer.endDate);
    const checkDate = atDate instanceof Date && !isNaN(atDate.getTime()) ? atDate : new Date();
    if (startDate && startDate > checkDate) return false;
    if (endDate && endDate < checkDate) return false;
    return true;
}

function isTimeWithinOfferWindow(offer, timeStr) {
    if (!isOfferTimeRestricted(offer)) return true;
    const timeMinutes = parseTimeToMinutes(timeStr);
    const startMinutes = parseTimeToMinutes(offer.validFromTime);
    const endMinutes = parseTimeToMinutes(offer.validToTime);
    if (timeMinutes === null || startMinutes === null || endMinutes === null) return false;

    // Handles both same-day windows (10:00-13:00) and overnight windows (22:00-02:00).
    if (startMinutes < endMinutes) return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    if (startMinutes > endMinutes) return timeMinutes >= startMinutes || timeMinutes < endMinutes;
    return true;
}

function getActiveMerchantOffers(merchantId, atDate = new Date()) {
    if (!merchantId) return [];
    return allOffers.filter(offer => offer.storeId === merchantId && isOfferActiveAt(offer, atDate));
}

function getBestServiceOffer(serviceName, merchantId, atDate, timeStr, options = {}) {
    if (!serviceName || !merchantId) return null;
    const { ignoreTimeRestricted = false } = options;
    const checkDate = atDate instanceof Date && !isNaN(atDate.getTime()) ? atDate : new Date();

    const candidates = getActiveMerchantOffers(merchantId, checkDate).filter(offer => {
        if (offer.serviceName !== serviceName) return false;
        if (!isOfferTimeRestricted(offer)) return true;
        if (ignoreTimeRestricted || !timeStr) return false;
        return isTimeWithinOfferWindow(offer, timeStr);
    });

    if (candidates.length === 0) return null;
    return candidates.reduce((best, current) => {
        const bestDiscount = Number(best?.discountPercent || 0);
        const currentDiscount = Number(current?.discountPercent || 0);
        return currentDiscount > bestDiscount ? current : best;
    }, null);
}

function getServiceBasePrice(service) {
    const value = Number(service?.basePrice ?? service?.price ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function calculateBookingPricing(options = {}) {
    const merchantId = bookingState?.merchant?.id;
    const dateStr = options.dateStr ?? bookingState.date;
    const timeStr = options.timeStr ?? bookingState.time;
    const includeTimeRestricted = options.includeTimeRestricted ?? true;
    const selectedDateTime = getBookingDateTime(dateStr, timeStr) || new Date();

    const services = bookingState.services || [];
    const baseTotal = services.reduce((sum, service) => sum + getServiceBasePrice(service), 0);
    const totalDuration = services.reduce((sum, service) => sum + (Number(service.duration) || 0), 0);

    let discountTotal = 0;
    const appliedOffers = [];

    services.forEach(service => {
        const basePrice = getServiceBasePrice(service);
        const offer = getBestServiceOffer(service.name, merchantId, selectedDateTime, timeStr, {
            ignoreTimeRestricted: !includeTimeRestricted
        });
        if (!offer) return;

        const discountPercent = Number(offer.discountPercent) || 0;
        if (discountPercent <= 0) return;

        const discountAmount = Math.round(basePrice * (discountPercent / 100));
        if (discountAmount <= 0) return;

        discountTotal += discountAmount;
        appliedOffers.push({
            serviceName: service.name,
            discountPercent,
            discountAmount,
            validFromTime: offer.validFromTime || null,
            validToTime: offer.validToTime || null
        });
    });

    const finalTotal = Math.max(0, baseTotal - discountTotal);
    return { baseTotal, discountTotal, finalTotal, totalDuration, appliedOffers };
}

function calculateTotal(options = {}) {
    return calculateBookingPricing(options).finalTotal;
}

function formatCompactStat(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '0';
    if (numericValue >= 1000) {
        return `${(numericValue / 1000).toFixed(numericValue >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
    }
    return numericValue.toLocaleString();
}

function setHomepageMetricValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;

    const numericValue = Math.max(0, Number(value) || 0);
    const previousValue = Number(element.dataset.rawValue || 0);
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (prefersReducedMotion || previousValue === numericValue) {
        element.textContent = formatCompactStat(numericValue);
        element.dataset.rawValue = String(numericValue);
        return;
    }

    if (element._countRaf) {
        cancelAnimationFrame(element._countRaf);
    }

    const startValue = Number.isFinite(previousValue) ? previousValue : 0;
    const duration = 700;
    const startTime = performance.now();
    element.dataset.rawValue = String(numericValue);

    const tick = (now) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const currentValue = Math.round(startValue + ((numericValue - startValue) * progress));
        element.textContent = formatCompactStat(currentValue);
        if (progress < 1) {
            element._countRaf = requestAnimationFrame(tick);
        } else {
            element._countRaf = null;
        }
    };

    element._countRaf = requestAnimationFrame(tick);
}

function updateHomepageMetrics() {
    const totalServices = allMerchants.reduce((sum, merchant) => sum + ((merchant.services || []).length), 0);
    const liveOffers = allOffers.filter(offer => isOfferActiveAt(offer, new Date())).length;

    setHomepageMetricValue('home-stat-venues', allMerchants.length);
    setHomepageMetricValue('home-stat-services', totalServices);
    setHomepageMetricValue('home-stat-reviews', allReviews.length);
    setHomepageMetricValue('home-stat-offers', liveOffers);
}

function setupHomepageMotion() {
    const revealTargets = document.querySelectorAll('[data-reveal]');
    if (!revealTargets.length) return;

    revealTargets.forEach((element, index) => {
        element.style.setProperty('--reveal-delay', `${Math.min(index * 70, 280)}ms`);
    });

    if (!('IntersectionObserver' in window) || window.matchMedia?.('(max-width: 768px)')?.matches) {
        revealTargets.forEach(element => element.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px 180px 0px' });

    revealTargets.forEach(element => observer.observe(element));
}

window.quickSearchCategory = function(category) {
    const categoryInput = document.getElementById('search-category');
    const treatmentInput = document.getElementById('search-treatment');
    const sortInput = document.getElementById('search-sort');

    if (categoryInput) categoryInput.value = category;
    if (treatmentInput) treatmentInput.value = '';
    if (sortInput) sortInput.value = 'default';

    performSearch();
    document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' });
};

function getBookableStaffOptions(merchant = bookingState.merchant) {
    const explicitStaff = Array.isArray(merchant?.staff)
        ? merchant.staff
            .filter(st => st && typeof st.name === 'string' && st.name.trim())
            .map((st, idx) => ({
                id: st.id || `staff-${idx}`,
                name: st.name.trim(),
                role: st.role || 'Staff',
                image: st.image || ''
            }))
        : [];

    if (explicitStaff.length > 0) return explicitStaff;

    const workerCount = Math.max(0, Number(merchant?.workerCount) || 0);
    if (workerCount <= 0) return [];

    return Array.from({ length: workerCount }, (_, idx) => ({
        id: workerCount > 1 ? `worker-${idx + 1}` : 'solo-worker',
        name: workerCount > 1 ? `Worker ${idx + 1}` : 'Main Specialist',
        role: workerCount > 1 ? 'Team Member' : (merchant?.category || 'Specialist'),
        image: ''
    }));
}

function getAutomaticStaffChoice() {
    return {
        id: 'anyone',
        name: 'Any available worker',
        role: 'Automatically assigned',
        image: ''
    };
}

function normalizeStaffMember(staff) {
    if (!staff) return null;

    const id = staff.id != null ? String(staff.id).trim() : '';
    const name = String(staff.name || '').trim();
    if (!id && !name) return null;

    return {
        id: id || `staff-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name: name || 'Assigned Staff',
        role: String(staff.role || '').trim(),
        image: String(staff.image || '').trim()
    };
}

function hasSpecificStaffSelection() {
    return !!bookingState.selectedStaff && bookingState.selectedStaff.id !== 'anyone';
}

function doesBookingMatchSelectedStaff(bookingData, selectedStaff = bookingState.selectedStaff) {
    if (!selectedStaff || selectedStaff.id === 'anyone') return true;

    const bookingStaffId = bookingData?.staffMember?.id != null ? String(bookingData.staffMember.id) : '';
    const bookingStaffName = (bookingData?.staffMember?.name || '').trim().toLowerCase();
    const selectedStaffId = String(selectedStaff.id);
    const selectedStaffName = (selectedStaff.name || '').trim().toLowerCase();

    if (!bookingStaffId || bookingStaffId === 'anyone') {
        return false;
    }

    return bookingStaffId === selectedStaffId || (bookingStaffName && bookingStaffName === selectedStaffName);
}

function getNormalizedBookingStatus(status) {
    return String(status || '').trim().toLowerCase();
}

function isCancelledBookingStatus(status) {
    const normalizedStatus = getNormalizedBookingStatus(status);
    return normalizedStatus === 'cancelled' || normalizedStatus === 'canceled';
}

function getBookingDateValue(bookingLike) {
    const value = bookingLike?.bookingDate ?? bookingLike;
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getBookingTimeKey(bookingLike) {
    const rawTime = String(bookingLike?.bookingTime || bookingLike?.time || '').trim();
    if (rawTime) return rawTime;

    const bookingDate = getBookingDateValue(bookingLike);
    if (!bookingDate) return '';
    return `${bookingDate.getHours()}:${String(bookingDate.getMinutes()).padStart(2, '0')}`;
}

function isSameBookingSlot(bookingLike, targetDate, targetTimeKey) {
    const bookingDate = getBookingDateValue(bookingLike);
    if (!bookingDate) return false;

    return bookingDate.getFullYear() === targetDate.getFullYear()
        && bookingDate.getMonth() === targetDate.getMonth()
        && bookingDate.getDate() === targetDate.getDate()
        && getBookingTimeKey(bookingLike) === targetTimeKey;
}

function resolveRequestedStaffMember(staffOptions, selectedStaff) {
    const normalizedSelectedStaff = normalizeStaffMember(selectedStaff);
    if (!normalizedSelectedStaff || normalizedSelectedStaff.id === 'anyone') return null;

    return staffOptions.find(staff => String(staff.id) === normalizedSelectedStaff.id)
        || staffOptions.find(staff => String(staff.name || '').trim().toLowerCase() === normalizedSelectedStaff.name.toLowerCase())
        || null;
}

function pickAutomaticallyAssignedStaff(staffOptions, seedValue = 0) {
    if (!Array.isArray(staffOptions) || staffOptions.length === 0) return null;
    const normalizedSeed = Math.abs(Number(seedValue) || 0);
    return staffOptions[normalizedSeed % staffOptions.length];
}

function getBookingDateKey(dateValue) {
    const bookingDate = getBookingDateValue(dateValue);
    if (!bookingDate) return '';

    const year = bookingDate.getFullYear();
    const month = String(bookingDate.getMonth() + 1).padStart(2, '0');
    const day = String(bookingDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getBookingSlotDocId(storeId, dateValue, timeKey) {
    const dateKey = getBookingDateKey(dateValue);
    const normalizedTime = String(timeKey || '').replace(/:/g, '-');
    return `${storeId}_${dateKey}_${normalizedTime}`;
}

function getBookingSlotRef(storeId, dateValue, timeKey) {
    return doc(db, "bookingSlotAvailability", getBookingSlotDocId(storeId, dateValue, timeKey));
}

function getSlotAvailabilityState(slotSnap) {
    const slotData = slotSnap?.exists?.() ? slotSnap.data() : {};

    return {
        slotData,
        totalBookings: Math.max(0, Number(slotData.totalBookings) || 0),
        occupiedStaffIds: Array.isArray(slotData.occupiedStaffIds) ? slotData.occupiedStaffIds.map(id => String(id)) : [],
        occupiedStaffNames: Array.isArray(slotData.occupiedStaffNames)
            ? slotData.occupiedStaffNames.map(name => String(name).trim().toLowerCase()).filter(Boolean)
            : [],
        bookingIds: Array.isArray(slotData.bookingIds) ? slotData.bookingIds.map(id => String(id)) : []
    };
}

async function refreshBookedSlotsForCurrentSelection() {
    if (!bookingState?.merchant?.id || !bookingState.date) return;
    bookingState.bookedSlots = undefined;
    renderBookingWizard();
    const bookedSlots = await fetchBookedSlots(bookingState.merchant.id, bookingState.date);
    bookingState.bookedSlots = bookedSlots;
    renderBookingWizard();
}

function getSlotDiscountSummary(timeStr, dateStr = bookingState.date) {
    if (!bookingState?.merchant?.id || !dateStr || !Array.isArray(bookingState.services) || bookingState.services.length === 0) {
        return { hasDiscount: false };
    }

    const slotDate = getBookingDateTime(dateStr, timeStr);
    if (!slotDate) return { hasDiscount: false };

    let maxDiscount = 0;
    let discountedServices = 0;

    bookingState.services.forEach(service => {
        const offer = getBestServiceOffer(service.name, bookingState.merchant.id, slotDate, timeStr, {
            ignoreTimeRestricted: false
        });
        if (!offer) return;
        discountedServices++;
        maxDiscount = Math.max(maxDiscount, Number(offer.discountPercent) || 0);
    });

    if (discountedServices === 0 || maxDiscount <= 0) {
        return { hasDiscount: false };
    }

    const serviceSuffix = discountedServices > 1 ? ` • ${discountedServices} services` : '';
    return {
        hasDiscount: true,
        maxDiscount,
        discountedServices,
        label: `${maxDiscount}% OFF${serviceSuffix}`
    };
}

async function loadReviewsData() {
    try {
        const snapshot = await getDocs(collection(db, "reviews"));
        allReviews = [];
        snapshot.forEach(docSnap => {
            allReviews.push({ id: docSnap.id, ...docSnap.data() });
        });
        console.log(`Loaded ${allReviews.length} reviews`);
        updateHomepageMetrics();
    } catch (error) {
        console.error('Error loading reviews:', error);
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
            if (header) header.innerText = ' Explore Stores in Erbil';
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
                // Fetch User Data from Firestore to get their active auth email
                const userDoc = await checkUserExists(phone);

                if (!userDoc) {
                    showToast('Account data not found. Please sign up.', 'error');
                    return;
                }

                // Login with their real email (if set) or fallback to default
                const email = userDoc.email || phone + '@hewrina.app';
                await signInWithEmailAndPassword(auth, email, password);

                currentUser = userDoc;
                showToast('Welcome back, ' + currentUser.name + '!', 'success');
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUIForUser();
                authModal.style.display = 'none';

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

                const dummyEmail = tempAuthData.phone + '@hewrina.app';
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
                showToast(`Welcome to Hewrina, ${newUser.name}!`, 'success');

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
    resetTransientUIState();
    if (loginBtn) loginBtn.style.display = 'none';
    const profileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    if (profileDiv && userNameSpan) {
        profileDiv.style.display = 'flex'; // Changed to flex for alignment
        userNameSpan.textContent = currentUser.name;
    }

    // Hide Main Nav Links and Map Button for non-customers
    const mainNav = document.getElementById('main-nav-links');
    const mapBtn = document.getElementById('map-btn');
    if (currentUser.role === 'owner' || currentUser.role === 'admin') {
        if (mainNav) mainNav.style.display = 'none';
        if (mapBtn) mapBtn.style.display = 'none';
    } else {
        if (mainNav) mainNav.style.display = 'flex';
        if (mapBtn) mapBtn.style.display = 'block';
    }

    // Redirect logic based on role
    if (currentUser.role === 'owner') {
        const ownerDash = document.getElementById('dashboard-owner');
        if (!ownerDash && !window.location.href.includes('index.html') && !window.location.pathname.endsWith('/')) {
            window.location.href = 'index.html';
        } else {
            loadOwnerDashboard();
        }
    } else if (currentUser.role === 'admin') {
        const adminDash = document.getElementById('dashboard-admin');
        if (!adminDash && !window.location.href.includes('index.html') && !window.location.pathname.endsWith('/')) {
            window.location.href = 'index.html';
        } else {
            loadAdminDashboard();
        }
    } else {
        // Customer - Ensure customer view is shown and others hidden
        const custDash = document.getElementById('dashboard-customer');
        const ownerDash = document.getElementById('dashboard-owner');
        const adminDash = document.getElementById('dashboard-admin');

        if (custDash) custDash.style.display = 'block';
        if (ownerDash) ownerDash.style.display = 'none';
        if (adminDash) adminDash.style.display = 'none';
        const navMyAppts = document.getElementById('nav-my-appointments');
        if (navMyAppts) navMyAppts.style.display = 'flex';
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
    if (merchantsGrid) merchantsGrid.innerHTML = skeletonHTML;

    try {
        const querySnapshot = await getDocs(collection(db, "merchants"));
        allMerchants = [];
        querySnapshot.forEach((doc) => {
            allMerchants.push({ id: doc.id, ...doc.data() });
        });
        updateHomepageMetrics();
        renderMerchants();
    } catch (error) {
        console.error("Error loading merchants:", error);
        if (merchantsGrid) merchantsGrid.innerHTML = '<div style="text-align:center">Failed to load data. Please ensure Firestore is enabled and seeded.</div>';
    }
}

// Render Grid with Photos
function getStoreRating(storeId) {
    const storeReviews = allReviews.filter(r => r.storeId === storeId);
    if (storeReviews.length === 0) return { avg: 0, count: 0 };
    const sum = storeReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return { avg: (sum / storeReviews.length).toFixed(1), count: storeReviews.length };
}

function generateStarHTML(rating, maxStars = 5) {
    let html = '';
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.3;
    for (let i = 0; i < fullStars; i++) html += '★';
    if (hasHalf && fullStars < maxStars) html += '★';
    const remaining = maxStars - fullStars - (hasHalf ? 1 : 0);
    for (let i = 0; i < remaining; i++) html += '☆';
    return html;
}

function renderMerchants() {
    const filtered = currentFilter === 'all'
        ? allMerchants
        : allMerchants.filter(m => m.type === currentFilter);

    if (filtered.length === 0) {
        if (merchantsGrid) merchantsGrid.innerHTML = '<div class="empty-state">No venues found.</div>';
        return;
    }

    if (merchantsGrid) merchantsGrid.innerHTML = filtered.map(merchant => {
        // Check if merchant has a photo URL
        const imageContent = merchant.photoUrl
            ? `<img src="${merchant.photoUrl}" alt="${merchant.name}" onerror="this.outerHTML='<span class=\\'emoji-fallback\\'>${merchant.image || ''}</span>'">`
            : `<span class="emoji-fallback">${merchant.image || ''}</span>`;

        // Check if this merchant has active offers
        const now = new Date();
        const merchantOffers = getActiveMerchantOffers(merchant.id, now);
        const hasDiscount = merchantOffers.length > 0;
        const maxDiscount = hasDiscount ? Math.max(...merchantOffers.map(o => o.discountPercent)) : 0;

        // Get star rating
        const rating = getStoreRating(merchant.id);
        const ratingHTML = rating.count > 0
            ? `<div class="card-rating">
                    <span class="stars">${generateStarHTML(parseFloat(rating.avg))}</span>
                    <span class="rating-score">${rating.avg}</span>
                    <span class="rating-count">(${rating.count})</span>
               </div>`
            : `<div class="card-rating"><span class="rating-count" style="color:#9ca3af;">No reviews yet</span></div>`;

        return `
        <div class="merchant-card" onclick="openMerchantDetails('${merchant.id}')">
            <div class="card-img-top">
                ${imageContent}
                ${hasDiscount ? `<div class="discount-badge"> Up to ${maxDiscount}% OFF</div>` : ''}
            </div>
            <div class="card-body">
                <span class="card-tag">${merchant.category}</span>
                <h3 class="card-title">${merchant.name}</h3>
                ${ratingHTML}
                <div class="card-meta">
                    <span>${merchant.distance}</span>
                </div>
                <p style="color: #6b7280; font-size: 0.9rem;">${merchant.address}</p>
                ${merchant.lat && merchant.lng ? `<span class="btn-map-link" onclick="event.stopPropagation(); showOnMap('${merchant.id}')"> View on Map</span>` : ''}
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

function getMerchantCoordinates(merchant) {
    const lat = Number(merchant?.lat);
    const lng = Number(merchant?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

// Add markers for all merchants
function addMarkersToMap() {
    // Clear existing markers
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    if (!map) return;

    allMerchants.forEach(merchant => {
        const coords = getMerchantCoordinates(merchant);
        if (!coords) return;

        const markerColor = merchant.type === 'salon' ? '#9d4edd' : '#e0aaff';

        const marker = new google.maps.Marker({
            position: coords,
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
                <div class="merchant-header-info">
                <h2>${merchant.name}</h2>
                <div class="badge">${merchant.category}</div>
                <p>${merchant.distance}</p>
            </div>
                <p> ${merchant.address}</p>
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

        showToast('Booking Confirmed! ', 'success');
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
    const coords = getMerchantCoordinates(merchant);
    if (!merchant || !coords) return;

    if (!window.google?.maps) {
        window.open(`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`, '_blank', 'noopener');
        return;
    }

    mapModal.style.display = 'flex';

    if (!map) {
        initMap();
        // Wait for map to initialize then center
        setTimeout(() => {
            google.maps.event.trigger(map, 'resize');
            map.setCenter(coords);
            map.setZoom(15);
            // Find and click the marker
            const marker = markers.find(m => m.getTitle() === merchant.name);
            if (marker) {
                google.maps.event.trigger(marker, 'click');
            }
        }, 300);
    } else {
        google.maps.event.trigger(map, 'resize');
        map.setCenter(coords);
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
let bookingState = {
    merchant: null,
    services: [],
    selectedStaff: null,
    date: null,
    time: null,
    step: 1,
    bookedSlots: null,
    policyAgreed: false,
    autoAssignSeed: null
};

function resetBookingState() {
    bookingState = {
        merchant: null,
        services: [],
        selectedStaff: null,
        date: null,
        time: null,
        step: 1,
        bookedSlots: null,
        policyAgreed: false,
        autoAssignSeed: null
    };
    bookingCalendarMonth = new Date();
    bookedSlotsCache = {};
}

function resetTransientUIState() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });

    const venueProfileView = document.getElementById('venue-profile-view');
    if (venueProfileView) {
        venueProfileView.style.display = 'none';
    }

    const dropdownMenu = document.getElementById('user-dropdown-menu');
    if (dropdownMenu) {
        dropdownMenu.style.display = 'none';
    }

    isPickingLocation = false;
    pickedLocation = null;
    if (pickerMarker) {
        pickerMarker.setMap(null);
        pickerMarker = null;
    }

    const confirmLocationBtn = document.getElementById('btn-confirm-location');
    if (confirmLocationBtn) {
        confirmLocationBtn.style.display = 'none';
    }

    resetBookingState();
}

function renderBookingWizard() {
    const body = document.getElementById('booking-modal-body');
    const footer = document.getElementById('booking-modal-footer');
    
    // Hide default close button for step 4 if we want to show our own top bar
    const defaultCloseBtn = document.querySelector('.close-booking');
    if (defaultCloseBtn) {
        defaultCloseBtn.style.display = bookingState.step === 4 ? 'none' : 'block';
    }

    let content = '';

    if (bookingState.step === 4) {
        // Step 4 specific top bar
        content += `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; padding-bottom: 15px; margin-bottom: 20px;">
                <h3 style="margin: 0; font-weight: 700; font-size: 1.1rem; color: #333;">Confirm Appointment</h3>
                <span style="font-size: 1.5rem; cursor: pointer; color: #888; line-height: 1;" onclick="closeModal('booking-modal')">&times;</span>
            </div>
        `;
    } else {
        // Header (Static for steps 1, 2 and 3)
        let headerStepText = '';
        if(bookingState.step === 1) headerStepText = 'Step 1 of 3: Select Services';
        if(bookingState.step === 2) headerStepText = 'Step 2 of 3: Select Staff';
        if(bookingState.step === 3) headerStepText = 'Step 3 of 3: Date & Time';

        content += `
            <div class="modal-header" style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin-bottom: 5px;">${bookingState.merchant.name}</h2>
                <p style="color: #666;">${headerStepText}</p>
            </div>
        `;
    }

    // Step 1: Select Services
    if (bookingState.step === 1) {
        content += renderBookingStep1();
        footer.innerHTML = `
            <button class="btn-outline" onclick="closeModal('booking-modal')">Cancel</button>
            <button class="btn-primary" onclick="nextBookingStep()" ${bookingState.services.length === 0 ? 'disabled' : ''}>Next </button>
        `;
    }
    // Step 2: Select Staff
    else if (bookingState.step === 2) {
        content += renderBookingStepStaff();
        const canProceed = getBookableStaffOptions(bookingState.merchant).length === 0 || !!bookingState.selectedStaff;
        footer.innerHTML = `
            <button class="btn-outline" onclick="prevBookingStep()">← Back</button>
            <button class="btn-primary" onclick="nextBookingStep()" ${!canProceed ? 'disabled' : ''}>Next </button>
        `;
    }
    // Step 3: Select Date & Time
    else if (bookingState.step === 3) {
        content += renderBookingStep2();
        
        const needsPolicy = !!bookingState.merchant.cancellationPolicy;
        const canProceed = bookingState.date && bookingState.time && (!needsPolicy || bookingState.policyAgreed);
        
        footer.innerHTML = `
            <button class="btn-outline" onclick="prevBookingStep()">← Back</button>
            <button class="btn-primary" onclick="nextBookingStep()" ${!canProceed ? 'disabled' : ''}>Next </button>
        `;
    }
    // Step 4: Confirm
    else if (bookingState.step === 4) {
        content += renderBookingStep3();
        footer.innerHTML = `
            <button class="btn-outline" onclick="prevBookingStep()">← Back</button>
            <button class="btn-primary full-width" onclick="submitBooking()" style="background: #C19A6B; border: none; font-size: 1.05rem; padding: 14px; border-radius: 8px; font-weight: 500;">Confirm Booking</button>
        `;
    }

    body.innerHTML = content;
}



// --- STEP 1: SERVICES ---
function renderBookingStep1() {
    const merchant = bookingState.merchant;
    const now = new Date();

    // Get active offers
    const merchantOffers = getActiveMerchantOffers(merchant.id, now);

    const servicesList = merchant.services ? merchant.services.map((s) => {
        const isSelected = bookingState.services.some(sel => sel.name === s.name);
        const basePrice = Number(s.price) || 0;
        const duration = Number(s.duration) || 0;
        const serviceOffers = merchantOffers.filter(o => o.serviceName === s.name);
        const allDayOffers = serviceOffers.filter(o => !isOfferTimeRestricted(o));
        const timedOffers = serviceOffers.filter(o => isOfferTimeRestricted(o));

        const bestAllDayOffer = allDayOffers.reduce((best, current) => {
            const bestDiscount = Number(best?.discountPercent || 0);
            const currentDiscount = Number(current?.discountPercent || 0);
            return currentDiscount > bestDiscount ? current : best;
        }, null);

        const bestTimedOffer = timedOffers.reduce((best, current) => {
            const bestDiscount = Number(best?.discountPercent || 0);
            const currentDiscount = Number(current?.discountPercent || 0);
            return currentDiscount > bestDiscount ? current : best;
        }, null);

        const allDayDiscount = Number(bestAllDayOffer?.discountPercent || 0);
        const hasAllDayDeal = allDayDiscount > 0;
        const displayPrice = hasAllDayDeal ? Math.round(basePrice * (1 - allDayDiscount / 100)) : basePrice;

        let offerTag = '';
        let offerHint = '';
        if (hasAllDayDeal) {
            offerTag = `<span class="service-discount-tag">${allDayDiscount}% OFF</span>`;
        } else if (bestTimedOffer) {
            offerTag = `<span class="service-discount-tag">${Number(bestTimedOffer.discountPercent) || 0}% OFF</span>`;
            offerHint = `<div class="service-offpeak-hint">Valid ${formatOfferHours(bestTimedOffer)}</div>`;
        }

        const safeServiceName = (s.name || '').replace(/'/g, "\\'");
        const priceHtml = hasAllDayDeal
            ? `<div style="display:flex; flex-direction:column; align-items:flex-end; line-height:1.2;">
                   <span style="font-size: 0.78rem; color: #9ca3af; text-decoration: line-through;">${basePrice.toLocaleString()} IQD</span>
                   <span>${displayPrice.toLocaleString()} IQD</span>
               </div>`
            : `${displayPrice.toLocaleString()} IQD`;

        return `
        <div class="service-select-item ${isSelected ? 'selected' : ''}" onclick="toggleServiceSelection('${safeServiceName}', ${basePrice}, ${duration})">
            <div style="display: flex; align-items: center;">
                <div class="checkbox-circle"></div>
                <div>
                    <div style="font-weight: 500;">
                        ${s.name} ${offerTag}
                    </div>
                    <div style="font-size: 0.8rem; color: #666;">${duration} mins</div>
                    ${offerHint}
                </div>
            </div>
            <div style="font-weight: 600;">${priceHtml}</div>
        </div>
        `;
    }).join('') : '<p>No services available.</p>';

    const previewPricing = calculateBookingPricing({ includeTimeRestricted: false });
    const hasTimeRestrictedDeals = bookingState.services.some(service =>
        merchantOffers.some(offer => offer.serviceName === service.name && isOfferTimeRestricted(offer))
    );

    return `
        <h3 style="margin-bottom: 15px;">Select Services</h3>
        <div class="services-list" style="max-height: 300px; overflow-y: auto;">
            ${servicesList}
        </div>
        <div class="booking-total">
            <span>Total (${bookingState.services.length} services):</span>
            <span>${previewPricing.finalTotal.toLocaleString()} IQD</span>
        </div>
        ${previewPricing.discountTotal > 0 ? `<div style="margin-top: 6px; font-size: 0.8rem; color: #16a34a;">All-day discounts applied: -${previewPricing.discountTotal.toLocaleString()} IQD</div>` : ''}
        ${hasTimeRestrictedDeals ? `<div style="margin-top: 6px; font-size: 0.8rem; color: #6b7280;">Off-peak deals will be applied automatically when you select eligible time slots.</div>` : ''}
    `;
}

window.toggleServiceSelection = function (name, basePrice, duration) {
    const index = bookingState.services.findIndex(s => s.name === name);
    if (index === -1) {
        bookingState.services.push({ name, price: basePrice, basePrice, duration });
    } else {
        bookingState.services.splice(index, 1);
    }
    renderBookingWizard();
}

// --- STEP 2: DATE & TIME ---
// Cache booked slots per date to avoid re-fetching
let bookedSlotsCache = {};

async function fetchBookedSlots(merchantId, dateStr) {
    const selectedStaffKey = hasSpecificStaffSelection() ? String(bookingState.selectedStaff.id) : 'all';
    const cacheKey = `${merchantId}_${dateStr}_${selectedStaffKey}`;
    if (bookedSlotsCache[cacheKey]) return bookedSlotsCache[cacheKey];

    try {
        const selectedDate = new Date(dateStr);
        const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        let snapshot;
        try {
            // Try composite index query first (storeId + bookingDate range)
            const q = query(
                collection(db, "bookings"),
                where("storeId", "==", merchantId),
                where("bookingDate", ">=", dayStart),
                where("bookingDate", "<", dayEnd)
            );
            snapshot = await getDocs(q);
        } catch (indexError) {
            // Fallback: query by storeId only, then filter dates client-side
            console.warn("Composite index not ready, using fallback query:", indexError.message);
            const fallbackQ = query(
                collection(db, "bookings"),
                where("storeId", "==", merchantId)
            );
            snapshot = await getDocs(fallbackQ);
        }

        // Map of time -> booking count (instead of a Set)
        const bookedTimes = new Map();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Only count non-cancelled bookings
            if (isCancelledBookingStatus(data.status)) return;

            const bDate = data.bookingDate?.toDate ? data.bookingDate.toDate() : new Date(data.bookingDate);
            
            // Filter by date (needed for fallback path)
            if (bDate.getFullYear() !== dayStart.getFullYear() ||
                bDate.getMonth() !== dayStart.getMonth() ||
                bDate.getDate() !== dayStart.getDate()) {
                return;
            }

            if (!doesBookingMatchSelectedStaff(data)) {
                return;
            }

            const h = bDate.getHours();
            const m = bDate.getMinutes();
            const timeKey = `${h}:${m === 0 ? '00' : String(m).padStart(2, '0')}`;
            bookedTimes.set(timeKey, (bookedTimes.get(timeKey) || 0) + 1);
        });

        bookedSlotsCache[cacheKey] = bookedTimes;
        return bookedTimes;
    } catch (e) {
        console.error("Error fetching booked slots:", e);
        return new Map();
    }
}

function formatTime12h(time) {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

function renderTimeSlotWithCapacity(time, isSelected, bookedCount, spotsLeft, workerCount, offerSummary = null) {
    const display = formatTime12h(time);
    const hasDiscount = !!offerSummary?.hasDiscount;
    const dealClass = hasDiscount ? 'deal' : '';
    const dealBadge = hasDiscount ? `<span class="time-slot-deal-badge">${offerSummary.label}</span>` : '';

    if (offerSummary?.isPastTime) {
        return `<div class="time-slot booked past" title="This time has already passed">
            <span style="text-decoration: line-through;">${display}</span>
            <span style="font-size:0.65rem; display:block; color:#9ca3af;">Passed</span>
        </div>`;
    }

    if (spotsLeft <= 0) {
        // Fully booked
        return `<div class="time-slot booked" title="All ${workerCount} workers booked">
            <span style="text-decoration: line-through;">${display}</span>
            <span style="font-size:0.65rem; display:block; color:#ef4444;">Full</span>
        </div>`;
    } else if (bookedCount > 0) {
        // Partially booked — still available
        return `<div class="time-slot partial ${dealClass} ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${time}')" title="${spotsLeft} of ${workerCount} workers available">
            <span>${display}</span>
            ${dealBadge}
            <span style="font-size:0.6rem; display:block; color:#d97706;">${spotsLeft} spot${spotsLeft > 1 ? 's' : ''} left</span>
        </div>`;
    } else {
        // Fully available
        return `<div class="time-slot ${dealClass} ${isSelected ? 'selected' : ''}" onclick="selectBookingTime('${time}')">
            <span>${display}</span>
            ${dealBadge}
        </div>`;
    }
}

// Customer booking calendar month tracker
let bookingCalendarMonth = new Date();

function renderBookingStep2() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = bookingCalendarMonth.getFullYear();
    const month = bookingCalendarMonth.getMonth();
    const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Build calendar grid cells
    let calendarCells = '';

    // Day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(d => {
        calendarCells += `<div class="booking-cal-header">${d}</div>`;
    });

    // Empty cells for offset
    for (let i = 0; i < firstDay; i++) {
        calendarCells += `<div class="booking-cal-cell empty"></div>`;
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        const dateStr = cellDate.toDateString();
        const isToday = cellDate.toDateString() === new Date().toDateString();
        const isPast = cellDate < today;
        const isSelected = bookingState.date === dateStr;

        // Check if we know how many booked slots exist for this day (from cache)
        const cacheKey = `${bookingState.merchant.id}_${dateStr}`;
        const cachedSlots = bookedSlotsCache[cacheKey];
        let badgeHtml = '';
        if (cachedSlots && cachedSlots.size > 0) {
            let totalBookings = 0;
            cachedSlots.forEach(count => totalBookings += count);
            badgeHtml = `<span class="cal-booked-badge">${totalBookings} Booked</span>`;
        }

        const classes = ['booking-cal-cell',
            isToday ? 'today' : '',
            isPast ? 'past' : '',
            isSelected ? 'selected' : ''
        ].filter(Boolean).join(' ');

        if (isPast) {
            calendarCells += `<div class="${classes}"><span class="cal-day-num">${day}</span></div>`;
        } else {
            calendarCells += `<div class="${classes}" onclick="selectBookingDate('${dateStr}')"><span class="cal-day-num">${day}</span>${badgeHtml}</div>`;
        }
    }

    // Time slots section (shown when date selected)
    let timesHtml = '';
    if (bookingState.date) {
        if (bookingState.bookedSlots === undefined) {
            timesHtml = '<div class="booking-times-loading"> Loading available times...</div>';
        } else {
            const startHour = 10;
            const endHour = 20;
            const selectedDate = new Date(bookingState.date);
            const now = new Date();
            const isTodaySelected = selectedDate.toDateString() === now.toDateString();
            const currentMinutes = (now.getHours() * 60) + now.getMinutes();
            const bookedSlots = bookingState.bookedSlots || new Map();
            const workerCount = hasSpecificStaffSelection()
                ? 1
                : Math.max(1, Number(bookingState.merchant.workerCount) || getBookableStaffOptions(bookingState.merchant).length || 1);
            let openSlotCount = 0;
            let fullyBookedCount = 0;
            let pastSlotCount = 0;
            let discountedSlotCount = 0;
            const slotEntries = [];

            for (let h = startHour; h < endHour; h++) {
                ['00', '30'].forEach(m => {
                    const timeKey = `${h}:${m}`;
                    const count = bookedSlots.get(timeKey) || 0;
                    const spotsLeft = workerCount - count;
                    const isSelected = bookingState.time === timeKey;
                    const offerSummary = getSlotDiscountSummary(timeKey, bookingState.date);
                    const slotMinutes = parseTimeToMinutes(timeKey);
                    const isPastTime = isTodaySelected && slotMinutes !== null && slotMinutes <= currentMinutes;

                    if (isPastTime) {
                        pastSlotCount++;
                    } else if (count >= workerCount) {
                        fullyBookedCount++;
                    } else {
                        openSlotCount++;
                        if (offerSummary.hasDiscount) discountedSlotCount++;
                    }

                    slotEntries.push({
                        time: timeKey,
                        count,
                        spotsLeft,
                        isSelected,
                        offerSummary: {
                            ...offerSummary,
                            isPastTime
                        }
                    });
                });
            }

            timesHtml = `
                <div class="booking-times-header">
                    <h4> ${new Date(bookingState.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
                    <div class="slots-summary">
                        <span class="slots-available"> ${openSlotCount} Open</span>
                        ${fullyBookedCount > 0 ? `<span class="slots-booked"> ${fullyBookedCount} Full</span>` : ''}
                        ${pastSlotCount > 0 ? `<span class="slots-booked"> ${pastSlotCount} Passed</span>` : ''}
                        ${discountedSlotCount > 0 ? `<span class="slots-deals"> ${discountedSlotCount} Deal Slots</span>` : ''}
                        ${workerCount > 1 ? `<span style="color:#666;font-size:0.75rem;"> ${workerCount} workers</span>` : ''}
                    </div>
                </div>
                <div class="time-slots-grid">
            `;

            slotEntries.forEach(slot => {
                timesHtml += renderTimeSlotWithCapacity(
                    slot.time,
                    slot.isSelected,
                    slot.count,
                    slot.spotsLeft,
                    workerCount,
                    slot.offerSummary
                );
            });

            timesHtml += `</div>`;
        }
    }

    const selectedSlotSummary = bookingState.date && bookingState.time
        ? getSlotDiscountSummary(bookingState.time, bookingState.date)
        : { hasDiscount: false };
    const canGoPrev = month > new Date().getMonth() || year > new Date().getFullYear();

    return `
        <div class="booking-calendar-wrapper">
            <div class="booking-cal-nav">
                <button class="cal-nav-btn" onclick="changeBookingCalMonth(-1)" ${!canGoPrev ? 'disabled' : ''}>‹</button>
                <h3 class="cal-month-label">${monthLabel}</h3>
                <button class="cal-nav-btn" onclick="changeBookingCalMonth(1)">›</button>
            </div>
            <div class="booking-cal-grid">
                ${calendarCells}
            </div>
        </div>

        ${bookingState.date ? `<div class="booking-times-panel">${timesHtml}</div>` : `
            <div class="booking-times-placeholder">
                <p> Select a date on the calendar to see available time slots</p>
            </div>
        `}
        ${selectedSlotSummary.hasDiscount ? `
            <div style="margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(193,154,107,0.35); background: rgba(193,154,107,0.08); border-radius: 8px; font-size: 0.82rem; color: #6b4f2c;">
                Deal applied for this slot: <strong>${selectedSlotSummary.label}</strong>
            </div>
        ` : ''}
        
        ${bookingState.date && bookingState.time && bookingState.merchant.cancellationPolicy ? `
            <div class="booking-policy-box" style="margin-top: 20px; padding: 15px; background: #fdf2f8; border-radius: 8px; border: 1px solid #fbcfe8;">
                <h4 style="margin-bottom: 8px; color: #9d174d; font-size: 0.95rem;">Cancellation & No-Show Policy</h4>
                <p style="font-size: 0.85rem; color: #831843; margin-bottom: 12px;">${bookingState.merchant.cancellationPolicy}</p>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem; color: #4b5563;">
                    <input type="checkbox" id="booking-policy-check" onchange="togglePolicyAgreement(this.checked)" ${bookingState.policyAgreed ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--primary);">
                    I agree to the cancellation policy
                </label>
            </div>
        ` : ''}
    `;
}

window.changeBookingCalMonth = function (offset) {
    bookingCalendarMonth.setMonth(bookingCalendarMonth.getMonth() + offset);
    renderBookingWizard();
};

window.selectBookingDate = async function (dateStr) {
    bookingState.date = dateStr;
    bookingState.time = null;
    bookingState.policyAgreed = false;
    bookingState.bookedSlots = undefined;
    renderBookingWizard();
    
    // ... rest of the logic ...

    const bookedSlots = await fetchBookedSlots(bookingState.merchant.id, dateStr);
    bookingState.bookedSlots = bookedSlots;
    renderBookingWizard();
}

window.selectBookingTime = function (timeStr) {
    bookingState.time = timeStr;
    bookingState.policyAgreed = false;
    renderBookingWizard();
}

window.togglePolicyAgreement = function (checked) {
    bookingState.policyAgreed = checked;
    renderBookingWizard();
}

// --- STEP 3: CONFIRM ---
function renderBookingStep3() {
    const pricing = calculateBookingPricing({
        dateStr: bookingState.date,
        timeStr: bookingState.time,
        includeTimeRestricted: true
    });
    const totalCost = pricing.finalTotal;
    const totalDuration = pricing.totalDuration;
    const serviceNames = bookingState.services.map(s => s.name).join(', ');
    const bookableStaff = getBookableStaffOptions(bookingState.merchant);
    const hasMultipleWorkers = bookableStaff.length > 1;
    const isAutomaticAssignment = hasMultipleWorkers && !hasSpecificStaffSelection();
    const selectedStaffLabel = hasSpecificStaffSelection()
        ? bookingState.selectedStaff.name
        : bookableStaff.length === 1
            ? bookableStaff[0].name
            : 'Any available worker';

    // Date formatting (e.g., "Tue, Mar 31")
    let dateStr = bookingState.date;
    try {
        const d = new Date(bookingState.date);
        if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    } catch(e) {}

    return `
        <div style="text-align: left; margin-bottom: 20px;">
            <button class="btn-text" style="color: #888; font-size: 0.95rem; padding: 0; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px;" onclick="prevBookingStep()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
                Back
            </button>
        </div>

        <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 24px;">
            <div style="background: #F0F9F4; color: #4CAF50; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
            <h2 style="margin-bottom: 8px; font-weight: 700; color: #222; font-size: 1.4rem;">Confirm Your Booking</h2>
            <p style="color: #888; font-size: 0.95rem; margin: 0;">Please review your appointment details</p>
        </div>

        <div style="background: #FAFAFA; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">Salon</span>
                <div style="text-align: right; max-width: 60%;">
                    <div style="color: #333; font-weight: 500; font-size: 0.95rem;">${bookingState.merchant.name}</div>
                    ${bookingState.merchant.address ? `<div style="color: #888; font-size: 0.8rem; margin-top: 2px;">${bookingState.merchant.address}</div>` : ''}
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">Service</span>
                <span style="color: #333; font-weight: 500; font-size: 0.95rem; text-align: right; max-width: 60%;">${serviceNames}</span>
            </div>
            ${(bookableStaff.length > 0 || bookingState.selectedStaff) ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">${isAutomaticAssignment ? 'Staff Preference' : 'Staff Member'}</span>
                <span style="color: #333; font-weight: 500; font-size: 0.95rem;">${selectedStaffLabel}</span>
            </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">Duration</span>
                <span style="color: #333; font-weight: 500; font-size: 0.95rem;">${totalDuration} minutes</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">Date</span>
                <span style="color: #333; font-weight: 500; font-size: 0.95rem;">${dateStr}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                <span style="color: #888; font-size: 0.95rem;">Time</span>
                <span style="color: #333; font-weight: 500; font-size: 0.95rem;">${formatTime12h(bookingState.time)}</span>
            </div>
            
            <div style="height: 1px; background: #EBEBEB; margin: 20px 0;"></div>

            ${pricing.discountTotal > 0 ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span style="color: #888; font-size: 0.92rem;">Subtotal</span>
                <span style="color: #333; font-weight: 500; font-size: 0.92rem;">${pricing.baseTotal.toLocaleString()} IQD</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span style="color: #16a34a; font-size: 0.92rem;">Discount</span>
                <span style="color: #16a34a; font-weight: 600; font-size: 0.92rem;">-${pricing.discountTotal.toLocaleString()} IQD</span>
            </div>
            ` : ''}
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0;">
                <span style="color: #888; font-size: 0.95rem;">Total</span>
                <span style="color: #C19A6B; font-weight: 700; font-size: 1.2rem;">${totalCost.toLocaleString()} IQD</span>
            </div>
        </div>

        ${isAutomaticAssignment ? `
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 0.84rem; color: #1d4ed8; line-height: 1.5;">
            A worker will be assigned automatically from the available team when you confirm this booking.
        </div>
        ` : ''}

        <div style="background: #FFF8E1; border: 1px solid #FFE082; border-radius: 10px; padding: 14px 16px; margin-bottom: 8px; display: flex; gap: 10px; align-items: flex-start;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F9A825" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width: 20px; margin-top: 1px;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div style="font-size: 0.82rem; color: #5D4037; line-height: 1.5;">
                <strong style="display: block; margin-bottom: 2px; color: #E65100;">Health & Allergy Disclaimer</strong>
                Upon arrival at the salon, please inform the staff of any allergies, skin sensitivities, or medical conditions you may have. Some treatments may involve products or procedures that could cause adverse reactions. Hewrina is not liable for any reactions resulting from undisclosed conditions.
            </div>
        </div>
    `;
}

// Navigation
// --- STEP 2: STAFF SELECTION ---
window.selectStaff = function(staffId, staffName) {
    bookingState.selectedStaff = staffId === 'anyone'
        ? getAutomaticStaffChoice()
        : normalizeStaffMember({ id: staffId, name: staffName });
    bookingState.time = null;

    if (bookingState.date) {
        refreshBookedSlotsForCurrentSelection();
        return;
    }

    renderBookingWizard();
}

function renderBookingStepStaff() {
    const staff = getBookableStaffOptions(bookingState.merchant);

    if (staff.length === 0) {
        return `
            <div class="staff-selection-container" style="padding: 18px; border: 1px solid var(--border); border-radius: 14px; background: #fff;">
                <h3 style="margin: 0 0 8px;">Worker assignment</h3>
                <p style="margin: 0; color: #6b7280; line-height: 1.5;">This venue has not set up named workers yet. Your booking will be assigned to the available team member automatically.</p>
            </div>
        `;
    }

    let staffHTML = `
        <div class="staff-selection-container" style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px; max-height: 400px; overflow-y: auto;">
            <div style="padding: 6px 2px 10px; color: #6b7280; font-size: 0.9rem;">${staff.length > 1 ? 'Choose a worker or let Hewrina assign the available one automatically.' : 'Choose the worker for this appointment.'}</div>
    `;

    if (staff.length > 1) {
        const isAutomaticSelection = !hasSpecificStaffSelection();
        staffHTML += `
            <div class="staff-card ${isAutomaticSelection ? 'selected' : ''}" 
                 onclick="selectStaff('anyone', 'Any available worker')"
                 style="display: flex; align-items: center; padding: 15px; border: 1px solid ${isAutomaticSelection ? 'var(--primary)' : 'var(--border)'}; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: ${isAutomaticSelection ? '#fdfdfb' : '#fff'};">
                <div style="width: 50px; height: 50px; border-radius: 50%; background: #ede9fe; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #5b21b6; margin-right: 15px; font-size: 1rem;">Any</div>
                <div>
                    <h4 style="margin: 0; font-size: 1.05rem;">No preference</h4>
                    <p style="margin: 4px 0 0; font-size: 0.85rem; color: #666;">We will assign one of the available workers for this time.</p>
                </div>
            </div>
        `;
    }

    staff.forEach((st) => {
        const isSelected = bookingState.selectedStaff?.id === st.id;
        const defaultIcon = `<div style="width: 50px; height: 50px; border-radius: 50%; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #64748b; margin-right: 15px; font-size: 1.2rem;">${st.name.charAt(0)}</div>`;
        const imgIcon = `<img src="${st.image}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; margin-right: 15px;">`;

        staffHTML += `
            <div class="staff-card ${isSelected ? 'selected' : ''}" 
                 onclick="selectStaff('${String(st.id).replace(/'/g, "\\'")}', '${st.name.replace(/'/g, "\\'")}')"
                 style="display: flex; align-items: center; padding: 15px; border: 1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: ${isSelected ? '#fdfdfb' : '#fff'};">
                ${st.image ? imgIcon : defaultIcon}
                <div>
                    <h4 style="margin: 0; font-size: 1.1rem;">${st.name}</h4>
                    <p style="margin: 4px 0 0; font-size: 0.85rem; color: #666;">${st.role || 'Staff'}</p>
                </div>
            </div>
        `;
    });

    staffHTML += `</div>`;
    return staffHTML;
}

// Navigation
window.nextBookingStep = function () {
    bookingState.step++;
    if (bookingState.step === 2) {
        const bookableStaff = getBookableStaffOptions(bookingState.merchant);
        if (bookableStaff.length <= 1) {
            const onlyStaff = normalizeStaffMember(bookableStaff[0]);
            bookingState.selectedStaff = onlyStaff;
            bookingState.step++; 
        } else if (!bookingState.selectedStaff) {
            bookingState.selectedStaff = getAutomaticStaffChoice();
        }
    }
    renderBookingWizard();

    if (bookingState.step === 3 && bookingState.date && bookingState.bookedSlots === undefined) {
        refreshBookedSlotsForCurrentSelection();
    }
}

window.prevBookingStep = function () {
    bookingState.step--;
    if (bookingState.step === 2) {
        if (getBookableStaffOptions(bookingState.merchant).length <= 1) {
            bookingState.step--; 
        }
    }
    renderBookingWizard();
}

async function createBookingTransaction({
    bookingDateObj,
    bookingServices,
    pricing,
    totalCost,
    totalDuration,
    commission,
    autoAssignSeed
}) {
    const merchantRef = doc(db, "merchants", bookingState.merchant.id);
    const bookingRef = doc(collection(db, 'bookings'));
    const requestedTimeKey = bookingState.time;
    const requestedStaff = normalizeStaffMember(bookingState.selectedStaff);
    const requestedUiCount = Math.max(0, Number(bookingState.bookedSlots?.get?.(requestedTimeKey)) || 0);

    return runTransaction(db, async (transaction) => {
        const merchantSnap = await transaction.get(merchantRef);
        if (!merchantSnap.exists()) {
            throw new Error('Store not found.');
        }

        const latestMerchant = { id: merchantSnap.id, ...merchantSnap.data() };
        const staffOptions = getBookableStaffOptions(latestMerchant)
            .map(staff => normalizeStaffMember(staff))
            .filter(Boolean);
        const slotRef = getBookingSlotRef(latestMerchant.id, bookingDateObj, requestedTimeKey);
        const slotSnap = await transaction.get(slotRef);
        const slotState = getSlotAvailabilityState(slotSnap);
        const bookingsAtRequestedTime = Math.max(slotState.totalBookings, requestedUiCount);
        const occupiedStaffIds = new Set(slotState.occupiedStaffIds);
        const occupiedStaffNames = new Set(slotState.occupiedStaffNames);

        let assignedStaff = null;
        let assignmentMode = 'unassigned';

        if (staffOptions.length <= 1) {
            if (bookingsAtRequestedTime >= 1) {
                throw new Error('This time slot just filled up. Please choose another time.');
            }
            assignedStaff = staffOptions[0] || null;
            assignmentMode = assignedStaff ? 'single-worker' : 'unassigned';
        } else {
            const requestedSpecificStaff = requestedStaff && requestedStaff.id !== 'anyone'
                ? resolveRequestedStaffMember(staffOptions, requestedStaff)
                : null;

            if (requestedStaff && requestedStaff.id !== 'anyone' && !requestedSpecificStaff) {
                throw new Error('Selected worker is no longer available. Please choose another worker.');
            }

            if (requestedSpecificStaff) {
                const isOccupied = occupiedStaffIds.has(String(requestedSpecificStaff.id))
                    || occupiedStaffNames.has(String(requestedSpecificStaff.name || '').trim().toLowerCase());
                if (isOccupied) {
                    throw new Error(`${requestedSpecificStaff.name} is no longer available at this time.`);
                }
                assignedStaff = requestedSpecificStaff;
                assignmentMode = 'selected';
            } else {
                if (bookingsAtRequestedTime >= staffOptions.length) {
                    throw new Error('This time slot just filled up. Please choose another time.');
                }

                const availableStaff = staffOptions.filter((staff) => {
                    const normalizedName = String(staff.name || '').trim().toLowerCase();
                    return !occupiedStaffIds.has(String(staff.id)) && !occupiedStaffNames.has(normalizedName);
                });
                const assignmentPool = availableStaff.length > 0 ? availableStaff : staffOptions;
                assignedStaff = pickAutomaticallyAssignedStaff(assignmentPool, autoAssignSeed);
                assignmentMode = 'automatic';
            }
        }

        const bookingData = {
            userId: currentUser.id || currentUser.phone,
            customerName: currentUser.name,
            customerPhone: currentUser.phone,
            storeId: latestMerchant.id,
            merchantId: latestMerchant.id,
            storeName: latestMerchant.name,

            services: bookingServices,
            staffMember: assignedStaff || null,
            staffAssignmentMode: assignmentMode,

            serviceName: bookingState.services.map(s => s.name).join(', '),
            servicePrice: totalCost,
            price: totalCost,
            serviceDuration: totalDuration,
            basePriceTotal: pricing.baseTotal,
            discountTotal: pricing.discountTotal,
            appliedOffers: pricing.appliedOffers,

            bookingDate: bookingDateObj,
            bookingTime: requestedTimeKey,
            status: 'pending',
            commission: commission,
            createdAt: new Date().toISOString()
        };

        transaction.set(bookingRef, bookingData);
        transaction.set(slotRef, {
            storeId: latestMerchant.id,
            storeName: latestMerchant.name || '',
            bookingDateKey: getBookingDateKey(bookingDateObj),
            bookingDate: bookingDateObj,
            bookingTime: requestedTimeKey,
            totalBookings: bookingsAtRequestedTime + 1,
            occupiedStaffIds: assignedStaff?.id
                ? Array.from(new Set([...slotState.occupiedStaffIds, String(assignedStaff.id)]))
                : slotState.occupiedStaffIds,
            occupiedStaffNames: assignedStaff?.name
                ? Array.from(new Set([...slotState.occupiedStaffNames, assignedStaff.name.toLowerCase()]))
                : slotState.occupiedStaffNames,
            bookingIds: Array.from(new Set([...slotState.bookingIds, bookingRef.id])),
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return {
            bookingId: bookingRef.id,
            assignedStaff,
            assignmentMode
        };
    });
}

// Submit
window.submitBooking = async function () {
    if (!currentUser) {
        showToast("Please login first.", 'error');
        document.getElementById('booking-modal').style.display = 'none';
        authModal.style.display = 'flex';
        return;
    }

    const pricing = calculateBookingPricing({
        dateStr: bookingState.date,
        timeStr: bookingState.time,
        includeTimeRestricted: true
    });
    const totalCost = pricing.finalTotal;
    const totalDuration = pricing.totalDuration;
    const bookingDateObj = getBookingDateTime(bookingState.date, bookingState.time);
    if (!bookingDateObj) {
        showToast("Invalid date/time selected.", 'error');
        return;
    }

    // Validate booking date is not in the past
    if (bookingDateObj < new Date()) {
        showToast("Cannot book in the past. Please select a future date/time.", 'error');
        return;
    }

    // Recalculate commission from final discounted total (10%)
    const commission = Math.round(totalCost * 0.1);
    const bookingServices = bookingState.services.map(service => ({
        name: service.name,
        price: getServiceBasePrice(service),
        duration: Number(service.duration) || 0
    }));
    const autoAssignSeed = bookingState.autoAssignSeed ?? Date.now();
    bookingState.autoAssignSeed = autoAssignSeed;

    try {
        const transactionResult = await createBookingTransaction({
            bookingDateObj,
            bookingServices,
            pricing,
            totalCost,
            totalDuration,
            commission,
            autoAssignSeed
        });

        // Invalidate booked slots cache so the slot shows as taken
        bookedSlotsCache = {};

        const assignedStaffName = transactionResult?.assignedStaff?.name;
        const successMessage = assignedStaffName
            ? `Booking Request Sent! Assigned to ${assignedStaffName}.`
            : 'Booking Request Sent!';
        showToast(successMessage, 'success');
        document.getElementById('booking-modal').style.display = 'none';
        resetBookingState();

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
            if (tab.dataset.tab === 'orders') loadAdminOrders('all');
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
                        ${store.suspended ? ' Suspended' : ' Active'}
                    </span>
                </td>
                <td>
                    <button class="action-btn" onclick="editStore('${store.id}')">️ Edit</button>
                    <button class="action-btn ${store.suspended ? '' : 'danger'}" onclick="toggleSuspend('${store.id}', ${!store.suspended})">
                        ${store.suspended ? '▶️ Activate' : '️ Suspend'}
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
    
    const policyEl = document.getElementById('store-cancellation-policy');
    if (policyEl) policyEl.value = store.cancellationPolicy || '';

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
        header.innerText = ' Click on Map to Select Location';
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
        <div class="sortable-item" draggable="true" data-index="${i}" data-name="${s.name}" data-category="${s.category || ''}" data-price="${s.price}" data-duration="${s.duration}">
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
                <button type="button" class="service-action-btn edit" onclick="openEditServiceModal(${i})" title="Edit Service">️</button>
                <button type="button" class="service-action-btn delete" onclick="deleteService(${i})" title="Delete Service">️</button>
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
        const name = (item.dataset.name || '').trim();
        const price = Math.max(0, parseInt(item.dataset.price) || 0);
        const duration = Math.max(1, parseInt(item.dataset.duration) || 30);

        // Skip empty or invalid service names
        if (!name) return;

        newServices.push({ name, price, duration });
    });

    if (newServices.length === 0) {
        showToast('Please add at least one valid service.', 'error');
        return;
    }

    try {
        await updateDoc(doc(db, "merchants", storeId), { services: newServices });

        // Update local data
        store.services = newServices;

        showToast(' Services saved successfully!', 'success');
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
    document.getElementById('service-edit-category').value = item.dataset.category || '';
    document.getElementById('service-edit-price').value = item.dataset.price;
    document.getElementById('service-edit-duration').value = item.dataset.duration;

    document.getElementById('service-modal').style.display = 'flex';
};

// Open modal to add a new service
window.openAddServiceModal = function () {
    document.getElementById('service-modal-title').textContent = 'Add New Service';
    document.getElementById('service-edit-index').value = '-1'; // -1 indicates new service
    document.getElementById('service-form').reset();
    document.getElementById('service-edit-category').value = '';

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
    const category = document.getElementById('service-edit-category').value.trim();
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
            <div class="sortable-item" draggable="true" data-index="${newIndex}" data-name="${name}" data-category="${category}" data-price="${price}" data-duration="${duration}">
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
                    <button type="button" class="service-action-btn edit" onclick="openEditServiceModal(${newIndex})" title="Edit Service">️</button>
                    <button type="button" class="service-action-btn delete" onclick="deleteService(${newIndex})" title="Delete Service">️</button>
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
            item.dataset.category = category;
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
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'none';

    if (modalId === 'booking-modal') {
        resetBookingState();
    }
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
            cancellationPolicy: document.getElementById('store-cancellation-policy')?.value || '',
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
                    category: item.dataset.category || '',
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
        showToast(' Store and services saved successfully!', 'success');

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

    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, "offers"));
        allOffers = [];
        snapshot.forEach(docSnap => {
            allOffers.push({ id: docSnap.id, ...docSnap.data() });
        });

        if (allOffers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No offers yet</td></tr>';
            return;
        }

        const now = new Date();
        tbody.innerHTML = allOffers.map(offer => {
            const store = allMerchants.find(m => m.id === offer.storeId);
            const startDate = toSafeDate(offer.startDate);
            const endDate = toSafeDate(offer.endDate);
            const isScheduled = startDate ? startDate > now : false;
            const isExpired = endDate ? endDate < now : false;
            const isActive = offer.active && !isScheduled && !isExpired;
            const daysLeft = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;
            const durationLabel = isExpired
                ? 'Ended'
                : isScheduled
                    ? `Starts ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : daysLeft !== null
                        ? `${daysLeft} days left`
                        : 'No end date';
            const statusText = isExpired ? 'Expired' : isScheduled ? 'Scheduled' : isActive ? 'Active' : 'Inactive';
            const statusClass = isExpired ? 'expired' : isScheduled ? 'suspended' : isActive ? 'active' : 'suspended';

            return `
            <tr>
                <td>${store?.name || 'Unknown'}</td>
                <td>${offer.serviceName}</td>
                <td><strong style="color: #16a34a;">${offer.discountPercent}% OFF</strong></td>
                <td>${formatOfferHours(offer)}</td>
                <td>${durationLabel}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${statusText}
                    </span>
                </td>
                <td>
                    <button class="action-btn danger" onclick="deleteOffer('${offer.id}')">️ Delete</button>
                </td>
            </tr>
        `}).join('');
    } catch (error) {
        console.error('Error loading offers:', error);
        tbody.innerHTML = '<tr><td colspan="7">Error loading offers</td></tr>';
    }
}

window.openCreateOfferModal = function () {
    const offerForm = document.getElementById('offer-form');
    const storeSelect = document.getElementById('offer-store');
    if (!offerForm || !storeSelect) return;
    offerForm.reset();

    const activeStores = allMerchants.filter(m => !m.suspended);
    if (activeStores.length === 0) {
        showToast('No active stores available for offers.', 'error');
        return;
    }

    storeSelect.innerHTML = activeStores
        .map(m => `<option value="${m.id}">${m.name}</option>`)
        .join('');

    if (!storeSelect.value && storeSelect.options.length > 0) {
        storeSelect.value = storeSelect.options[0].value;
    }

    // Load services for first store
    updateOfferServices();

    document.getElementById('offer-modal').style.display = 'flex';
};

function updateOfferServices() {
    const storeId = document.getElementById('offer-store').value;
    const store = allMerchants.find(m => m.id === storeId);
    const serviceSelect = document.getElementById('offer-service');

    if (store?.services?.length) {
        serviceSelect.innerHTML = store.services.map((s, i) =>
            `<option value="${i}">${s.name} - ${s.price.toLocaleString()} IQD</option>`
        ).join('');
    } else {
        serviceSelect.innerHTML = '<option value="">No services</option>';
    }
}

document.getElementById('offer-store')?.addEventListener('change', updateOfferServices);

document.getElementById('offer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const storeId = document.getElementById('offer-store').value;
    const store = allMerchants.find(m => m.id === storeId);
    const serviceIndex = parseInt(document.getElementById('offer-service').value, 10);
    const service = store?.services?.[serviceIndex];

    if (!store || !service) {
        showToast('Please select a valid store and service.', 'error');
        return;
    }

    const discountPercent = parseInt(document.getElementById('offer-discount').value, 10);
    const durationDays = parseInt(document.getElementById('offer-duration').value, 10);
    const validFromTime = normalizeOfferInputTime(document.getElementById('offer-start-time').value);
    const validToTime = normalizeOfferInputTime(document.getElementById('offer-end-time').value);

    if ((validFromTime && !validToTime) || (!validFromTime && validToTime)) {
        showToast('Set both valid hours fields or leave both empty.', 'error');
        return;
    }
    if (validFromTime && validToTime && validFromTime === validToTime) {
        showToast('Offer start and end time cannot be the same.', 'error');
        return;
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
        showToast('Discount must be between 1 and 100.', 'error');
        return;
    }
    if (!Number.isFinite(durationDays) || durationDays < 1) {
        showToast('Duration must be at least 1 day.', 'error');
        return;
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    // Use serviceName (not serviceIndex) so offers survive service reordering
    const offerData = {
        storeId,
        storeName: store.name,
        serviceName: service.name,
        discountPercent,
        validFromTime: validFromTime || null,
        validToTime: validToTime || null,
        startDate: Timestamp.now(),
        endDate: Timestamp.fromDate(endDate),
        active: true
    };

    try {
        await addDoc(collection(db, "offers"), offerData);
        closeModal('offer-modal');
        loadAdminOffers();
        showToast('Offer created successfully.', 'success');
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
                    <button class="action-btn danger" onclick="deleteSponsor('${s.id}')">️</button>
                </div>
            `;
        }).join('') : '<p class="sponsor-empty">No sponsored stores yet</p>';

        adsList.innerHTML = externalSponsors.length ? externalSponsors.map(s => `
            <div class="sponsored-item-card">
                <img src="${s.imageUrl || 'https://via.placeholder.com/60'}" alt="">
                <div class="sponsored-item-info">
                    <h4>${s.title || 'Advertisement'}</h4>
                    <p><a href="${s.linkUrl}" target="_blank"> ${s.linkUrl?.substring(0, 30)}...</a></p>
                </div>
                <button class="action-btn danger" onclick="deleteSponsor('${s.id}')">️</button>
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

// ========== ADMIN ORDERS FUNCTIONS ==========
let currentAdminOrderFilter = 'all';

window.filterAdminOrders = function (status) {
    currentAdminOrderFilter = status;
    const btns = document.querySelectorAll('#admin-orders .filter-btn');
    btns.forEach(b => {
        if (b.innerText.toLowerCase() === status || (status === 'all' && b.innerText === 'All')) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    loadAdminOrders(status);
};

async function loadAdminOrders(status = 'all') {
    const tbody = document.getElementById('admin-orders-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';

    try {
        const snapshot = await getDocs(collection(db, "orders"));
        let orders = [];
        snapshot.forEach(docSnap => {
            orders.push({ id: docSnap.id, ...docSnap.data() });
        });

        orders.sort((a, b) => {
            const dateA = toSafeDate(a.createdAt) || new Date(0);
            const dateB = toSafeDate(b.createdAt) || new Date(0);
            return dateB - dateA;
        });

        if (status !== 'all') {
            orders = orders.filter(order => (order.status || '').toLowerCase() === status);
        }

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">No orders found.</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(order => {
            const createdAt = toSafeDate(order.createdAt);
            const createdAtLabel = createdAt ? createdAt.toLocaleString() : 'N/A';
            const statusValue = (order.status || 'pending').toLowerCase();
            const items = Array.isArray(order.items) ? order.items : [];
            const totalItems = Number(order.totalItems) || items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            const previewItems = items.slice(0, 2).map(item => `${item.name || 'Item'} x${Number(item.quantity) || 1}`).join(', ');
            const total = Number(order.subtotal ?? order.total ?? 0);

            const actionButtons = statusValue === 'pending'
                ? `
                    <button class="action-btn" onclick="updateShopOrderStatus('${order.id}', 'confirmed')">Confirm</button>
                    <button class="action-btn danger" onclick="updateShopOrderStatus('${order.id}', 'cancelled')">Cancel</button>
                `
                : statusValue === 'confirmed'
                    ? `
                        <button class="action-btn" onclick="updateShopOrderStatus('${order.id}', 'fulfilled')">Fulfill</button>
                        <button class="action-btn danger" onclick="updateShopOrderStatus('${order.id}', 'cancelled')">Cancel</button>
                    `
                    : '<span style="color:#9ca3af; font-size:0.8rem;">No actions</span>';

            return `
                <tr>
                    <td>#${order.id.slice(0, 8)}</td>
                    <td>${order.storeName || 'Store'}</td>
                    <td>
                        <div>${order.customerName || 'Customer'}</div>
                        <div style="font-size:0.78rem; color:#666;">${order.customerPhone || ''}</div>
                    </td>
                    <td>
                        <div>${totalItems} item${totalItems === 1 ? '' : 's'}</div>
                        <div style="font-size:0.78rem; color:#666;">${previewItems}${items.length > 2 ? ' ...' : ''}</div>
                    </td>
                    <td>${total.toLocaleString()} IQD</td>
                    <td>${createdAtLabel}</td>
                    <td>
                        <span class="status-badge order-status-${statusValue}">
                            ${statusValue.charAt(0).toUpperCase() + statusValue.slice(1)}
                        </span>
                    </td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading admin orders:', error);
        tbody.innerHTML = '<tr><td colspan="8">Error loading orders.</td></tr>';
    }
}

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
            if (sponsorCarousel) sponsorCarousel.innerHTML = '';
            sponsorCarousel.parentElement.parentElement.style.display = 'none';
            return;
        }

        sponsorCarousel.parentElement.parentElement.style.display = 'block';

        if (sponsorCarousel) sponsorCarousel.innerHTML = activeSponsors.map(sponsor => {
            if (sponsor.type === 'store') {
                const store = allMerchants.find(m => m.id === sponsor.storeId);
                if (!store) return '';
                return `
                    <div class="sponsor-card" onclick="openMerchantDetails('${store.id}')">
                        <img src="${store.photoUrl || 'https://via.placeholder.com/320x140'}" alt="${store.name}">
                        <div class="sponsor-card-body">
                            <h4>${store.name}</h4>
                            <p> ${store.address || store.category}</p>
                        </div>
                    </div>
                `;
            } else {
                return `
                    <a href="${sponsor.linkUrl}" target="_blank" class="sponsor-card" style="text-decoration: none;">
                        <img src="${sponsor.imageUrl || 'https://via.placeholder.com/320x140'}" alt="${sponsor.title}">
                        <div class="sponsor-card-body">
                            <h4>${sponsor.title || 'Special Offer'}</h4>
                            <p> Learn More</p>
                        </div>
                    </a>
                `;
            }
        }).join('');

    } catch (error) {
        console.error('Error loading sponsors:', error);
        if (sponsorCarousel) sponsorCarousel.innerHTML = '';
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

    // Load Bookings from Firestore with pagination (max 500 per load)
    if (currentUser.role === 'admin') {
        const q = query(collection(db, "bookings"), orderBy("bookingDate", "desc"), limit(500));
        const snapshot = await getDocs(q);

        allBookings = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            allBookings.push({
                id: docSnap.id,
                ...data,
                bookingDate: data.bookingDate?.toDate ? data.bookingDate.toDate() : new Date(data.bookingDate)
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
            inv.bookings.forEach(b => paidBookingIds.add(b.id || b.bookingId));
        }
    });

    // Calculate stats from FILTERED bookings (for revenue table)
    const completedBookings = filteredBookings.filter(b => b.status === 'completed');

    const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.servicePrice || 0), 0);
    const totalCommission = completedBookings.reduce((sum, b) => sum + (b.commission || 0), 0);

    // PENDING PAYOUTS: Use ALL bookings (not filtered!) to show true outstanding debt
    const allCompletedBookings = allBookings.filter(b => b.status === 'completed');
    const pendingPayoutAmount = allCompletedBookings
        .filter(b => !paidBookingIds.has(b.id))
        .reduce((sum, b) => sum + (b.commission || 0), 0);

    // This month stats (always from current month)
    const thisMonthBookings = allBookings.filter(b => {
        return b.bookingDate.getMonth() === now.getMonth() &&
            b.bookingDate.getFullYear() === now.getFullYear() &&
            b.status === 'completed';
    });
    const thisMonthCommission = thisMonthBookings.reduce((sum, b) => sum + (b.commission || 0), 0);

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
            statusText = ' Paid';
        } else if (booking.status === 'completed') {
            statusBadgeClass = 'completed'; // You might need to add this class in CSS if not exists, or use 'paid' style
            statusText = ' Completed (Unpaid)';
        } else if (booking.status === 'confirmed') {
            statusBadgeClass = 'active';
            statusText = ' Confirmed';
        } else {
            statusBadgeClass = 'pending-payment';
            statusText = ' Pending';
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
                `<button class="action-btn" onclick="viewInvoice(${index})"> Invoice</button>` :
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
                    <button class="action-btn" onclick="markInvoicePaidById('${inv.id}')"> Paid</button>
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
                    <button class="action-btn" onclick="openEditUserModal('${user.phone || user.id}')">️ Edit Role</button>
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
    const filterBtns = document.querySelectorAll('#admin-financials .financial-filters .filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const range = btn.dataset.range || currentFinancialFilter;
            loadFinancials(range);
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
        document.getElementById('owner-store-badge').innerText = ` ${store.name}`;
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
            if (tab.dataset.tab === 'orders') loadOwnerOrders('all');
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
let currentOrderFilter = 'all';

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
            const createdStr = b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : new Date(b.createdAt).toLocaleString();
            // Show the actual appointment date and time
            let appointmentStr = 'N/A';
            if (b.bookingDate) {
                const bDate = b.bookingDate?.toDate ? b.bookingDate.toDate() : new Date(b.bookingDate);
                appointmentStr = bDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
            const bookingTime = b.bookingTime || (b.bookingDate ? (() => {
                const bDate = b.bookingDate?.toDate ? b.bookingDate.toDate() : new Date(b.bookingDate);
                const h = bDate.getHours();
                const m = bDate.getMinutes();
                return `${h}:${m === 0 ? '00' : String(m).padStart(2, '0')}`;
            })() : 'N/A');
            return `
            <tr>
                <td>${b.customerName || 'Customer'}</td>
                <td>${b.serviceName || 'Service'}</td>
                <td>
                    <div> ${appointmentStr}</div>
                    <div style="font-size:0.8rem; color:#666;"> ${bookingTime}</div>
                </td>
                <td>${(b.price || 0).toLocaleString()} IQD</td>
                <td>
                    <span class="status-badge ${b.status}">
                        ${b.status ? b.status.charAt(0).toUpperCase() + b.status.slice(1) : 'Unknown'}
                    </span>
                </td>
                <td>
                    ${b.status === 'pending' ? `
                        <button class="action-btn" onclick="updateBookingStatus('${b.id}', 'confirmed')"> Accept</button>
                        <button class="action-btn danger" onclick="updateBookingStatus('${b.id}', 'cancelled')"> Reject</button>
                    ` : b.status === 'confirmed' ? `
                        <button class="action-btn" onclick="updateBookingStatus('${b.id}', 'completed')"> Complete</button>
                    ` : ''}
                </td>
            </tr>
        `}).join('');

    } catch (e) {
        console.error("Error loading bookings:", e);
        tbody.innerHTML = '<tr><td colspan="6">Error loading bookings. Check console.</td></tr>';
    }
}

// 2a. Shop Orders Tab
window.filterOwnerOrders = function (status) {
    currentOrderFilter = status;
    const btns = document.querySelectorAll('#owner-orders .filter-btn');
    btns.forEach(b => {
        if (b.innerText.toLowerCase() === status || (status === 'all' && b.innerText === 'All')) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    loadOwnerOrders(status);
};

function parseDateValue(value) {
    if (!value) return null;
    const dateValue = value?.toDate ? value.toDate() : new Date(value);
    return isNaN(dateValue.getTime()) ? null : dateValue;
}

async function loadOwnerOrders(status = 'all') {
    const tbody = document.getElementById('owner-orders-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    if (!currentUser || !currentUser.storeId) {
        tbody.innerHTML = '<tr><td colspan="7">No store linked to this account.</td></tr>';
        return;
    }

    try {
        const q = query(collection(db, "orders"), where("storeId", "==", currentUser.storeId));
        const snapshot = await getDocs(q);
        let orders = [];
        snapshot.forEach(d => orders.push({ id: d.id, ...d.data() }));

        orders.sort((a, b) => {
            const dateA = parseDateValue(a.createdAt) || new Date(0);
            const dateB = parseDateValue(b.createdAt) || new Date(0);
            return dateB - dateA;
        });

        if (status !== 'all') {
            orders = orders.filter(o => (o.status || '').toLowerCase() === status);
        }

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">No orders found.</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(order => {
            const createdAt = parseDateValue(order.createdAt);
            const createdAtLabel = createdAt ? createdAt.toLocaleString() : 'N/A';
            const statusValue = (order.status || 'pending').toLowerCase();
            const items = Array.isArray(order.items) ? order.items : [];
            const totalItems = Number(order.totalItems) || items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            const itemPreview = items.slice(0, 2).map(item => `${item.name || 'Item'} x${Number(item.quantity) || 1}`).join(', ');
            const itemsLabel = items.length > 0
                ? `<div>${totalItems} item${totalItems === 1 ? '' : 's'}</div><div style="font-size:0.78rem; color:#666;">${itemPreview}${items.length > 2 ? ' ...' : ''}</div>`
                : '<span style="color:#888;">No items</span>';
            const total = Number(order.subtotal ?? order.total ?? 0);

            const actionButtons = statusValue === 'pending'
                ? `
                    <button class="action-btn" onclick="updateShopOrderStatus('${order.id}', 'confirmed')">Confirm</button>
                    <button class="action-btn danger" onclick="updateShopOrderStatus('${order.id}', 'cancelled')">Cancel</button>
                `
                : statusValue === 'confirmed'
                    ? `
                        <button class="action-btn" onclick="updateShopOrderStatus('${order.id}', 'fulfilled')">Fulfill</button>
                        <button class="action-btn danger" onclick="updateShopOrderStatus('${order.id}', 'cancelled')">Cancel</button>
                    `
                    : '<span style="color:#9ca3af; font-size:0.8rem;">No actions</span>';

            return `
                <tr>
                    <td>#${order.id.slice(0, 8)}</td>
                    <td>
                        <div>${order.customerName || 'Customer'}</div>
                        <div style="font-size:0.78rem; color:#666;">${order.customerPhone || ''}</div>
                    </td>
                    <td>${itemsLabel}</td>
                    <td>${total.toLocaleString()} IQD</td>
                    <td>${createdAtLabel}</td>
                    <td>
                        <span class="status-badge order-status-${statusValue}">
                            ${statusValue.charAt(0).toUpperCase() + statusValue.slice(1)}
                        </span>
                    </td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error("Error loading owner orders:", error);
        tbody.innerHTML = '<tr><td colspan="7">Error loading orders.</td></tr>';
    }
}

async function restockCancelledOrderItems(orderData) {
    const storeId = orderData.storeId;
    const items = Array.isArray(orderData.items) ? orderData.items : [];
    if (!storeId || items.length === 0) return;

    const storeRef = doc(db, "merchants", storeId);
    const storeSnap = await getDoc(storeRef);
    if (!storeSnap.exists()) return;

    const storeData = storeSnap.data();
    const products = Array.isArray(storeData.products) ? [...storeData.products] : [];
    let hasStockChanges = false;

    items.forEach(item => {
        const itemName = (item.name || '').trim().toLowerCase();
        const quantity = Math.max(0, Number(item.quantity) || 0);
        if (!itemName || quantity <= 0) return;

        const productIndex = products.findIndex(p => (p.name || '').trim().toLowerCase() === itemName);
        if (productIndex === -1) return;

        const currentStock = Math.max(0, Number(products[productIndex].stock) || 0);
        products[productIndex] = {
            ...products[productIndex],
            stock: currentStock + quantity
        };
        hasStockChanges = true;
    });

    if (!hasStockChanges) return;

    await updateDoc(storeRef, { products });

    const merchantIndex = allMerchants.findIndex(m => m.id === storeId);
    if (merchantIndex >= 0) {
        allMerchants[merchantIndex] = { ...allMerchants[merchantIndex], products };
    }
}

window.updateShopOrderStatus = async function (orderId, newStatus) {
    const confirmMessages = {
        confirmed: 'Confirm this order?',
        fulfilled: 'Mark this order as fulfilled?',
        cancelled: 'Cancel this order? Stock will be restored.'
    };
    if (!await showConfirm(confirmMessages[newStatus] || 'Update order status?')) return;

    try {
        const orderRef = doc(db, "orders", orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            showToast('Order not found.', 'error');
            return;
        }

        const orderData = orderSnap.data();
        if (currentUser.role === 'owner' && orderData.storeId !== currentUser.storeId) {
            showToast('You can only manage orders for your own store.', 'error');
            return;
        }

        const previousStatus = (orderData.status || 'pending').toLowerCase();
        if (previousStatus === newStatus) {
            showToast('Order is already in this status.', 'info');
            return;
        }

        await updateDoc(orderRef, {
            status: newStatus,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.id || currentUser.phone || 'owner'
        });

        if (newStatus === 'cancelled' && previousStatus !== 'cancelled') {
            await restockCancelledOrderItems(orderData);
        }

        showToast(`Order updated to ${newStatus}.`, 'success');
        if (currentUser.role === 'owner') {
            loadOwnerOrders(currentOrderFilter);
        }
        if (currentUser.role === 'admin') {
            loadAdminOrders(currentAdminOrderFilter);
        }
    } catch (error) {
        console.error('Error updating shop order:', error);
        showToast('Failed to update order status.', 'error');
    }
};

async function reconcileStoreCalendarEntries(bookingId, newStatus, canonicalEvent = null) {
    const calendarQuery = query(collection(db, "storeCalendar"), where("bookingId", "==", bookingId));
    const calendarSnapshot = await getDocs(calendarQuery);
    const operations = [];

    if (newStatus === 'cancelled') {
        calendarSnapshot.forEach((calendarDoc) => {
            operations.push(deleteDoc(doc(db, "storeCalendar", calendarDoc.id)));
        });
        await Promise.all(operations);
        return;
    }

    if (newStatus === 'confirmed') {
        let hasCanonicalDoc = false;
        calendarSnapshot.forEach((calendarDoc) => {
            if (calendarDoc.id === bookingId) {
                hasCanonicalDoc = true;
                return;
            }
            operations.push(deleteDoc(doc(db, "storeCalendar", calendarDoc.id)));
        });

        if (!hasCanonicalDoc && canonicalEvent) {
            operations.push(setDoc(doc(db, "storeCalendar", bookingId), canonicalEvent));
        }

        await Promise.all(operations);
        return;
    }

    if (newStatus === 'completed') {
        const completedAt = new Date().toISOString();
        calendarSnapshot.forEach((calendarDoc) => {
            if (calendarDoc.id === bookingId) {
                operations.push(updateDoc(doc(db, "storeCalendar", calendarDoc.id), {
                    status: 'completed',
                    updatedAt: completedAt
                }));
                return;
            }
            operations.push(deleteDoc(doc(db, "storeCalendar", calendarDoc.id)));
        });

        await Promise.all(operations);
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
        const calendarRef = doc(db, "storeCalendar", bookingId);
        const normalizedNewStatus = getNormalizedBookingStatus(newStatus);

        const transactionResult = await runTransaction(db, async (transaction) => {
            const bookingSnap = await transaction.get(bookingRef);
            if (!bookingSnap.exists()) {
                throw new Error('Booking not found!');
            }

            const bookingData = bookingSnap.data();

            // Authorization: Only the merchant who owns this booking's store (or admin) can update
            if (currentUser.role === 'owner' && bookingData.storeId !== currentUser.storeId) {
                throw new Error('You can only update bookings for your own store.');
            }

            const previousStatus = getNormalizedBookingStatus(bookingData.status || 'pending');
            const statusChanged = previousStatus !== normalizedNewStatus;
            const calendarSnap = await transaction.get(calendarRef);
            const slotRef = getBookingSlotRef(
                bookingData.storeId || bookingData.merchantId || '',
                bookingData.bookingDate,
                bookingData.bookingTime || bookingData.time
            );
            const slotSnap = await transaction.get(slotRef);
            const slotState = getSlotAvailabilityState(slotSnap);
            const updatedAt = new Date().toISOString();
            let calendarEvent = null;

            transaction.update(bookingRef, {
                status: normalizedNewStatus,
                updatedAt
            });

            if (normalizedNewStatus === 'confirmed') {
                const existingCalendar = calendarSnap.exists() ? calendarSnap.data() : {};
                calendarEvent = {
                    bookingId: bookingId,
                    storeId: bookingData.storeId || '',
                    storeName: bookingData.storeName || '',
                    customerName: bookingData.customerName || 'Customer',
                    customerPhone: bookingData.customerPhone || '',
                    serviceName: bookingData.serviceName || 'Service',
                    staffMember: bookingData.staffMember || null,
                    price: bookingData.price || 0,
                    duration: bookingData.serviceDuration || bookingData.duration || 30,
                    bookingDate: bookingData.bookingDate || new Date().toISOString(),
                    bookingTime: bookingData.bookingTime || bookingData.time || '10:00',
                    status: 'confirmed',
                    createdAt: existingCalendar.createdAt || updatedAt,
                    updatedAt
                };
                transaction.set(calendarRef, calendarEvent, { merge: true });
            } else if (normalizedNewStatus === 'cancelled') {
                if (calendarSnap.exists()) {
                    transaction.delete(calendarRef);
                }
                if (slotSnap.exists()) {
                    const assignedStaff = normalizeStaffMember(bookingData.staffMember);
                    const nextTotalBookings = Math.max(0, slotState.totalBookings - 1);
                    const nextOccupiedStaffIds = assignedStaff?.id
                        ? slotState.occupiedStaffIds.filter(id => id !== String(assignedStaff.id))
                        : slotState.occupiedStaffIds;
                    const normalizedAssignedName = String(assignedStaff?.name || '').trim().toLowerCase();
                    const nextOccupiedStaffNames = normalizedAssignedName
                        ? slotState.occupiedStaffNames.filter(name => name !== normalizedAssignedName)
                        : slotState.occupiedStaffNames;
                    const nextBookingIds = slotState.bookingIds.filter(id => id !== bookingId);

                    if (nextTotalBookings <= 0) {
                        transaction.delete(slotRef);
                    } else {
                        transaction.set(slotRef, {
                            totalBookings: nextTotalBookings,
                            occupiedStaffIds: nextOccupiedStaffIds,
                            occupiedStaffNames: nextOccupiedStaffNames,
                            bookingIds: nextBookingIds,
                            updatedAt
                        }, { merge: true });
                    }
                }
            } else if (normalizedNewStatus === 'completed') {
                if (calendarSnap.exists()) {
                    transaction.update(calendarRef, {
                        status: 'completed',
                        updatedAt
                    });
                }
            }

            return {
                bookingData,
                previousStatus,
                statusChanged,
                calendarEvent
            };
        });

        if (normalizedNewStatus === 'confirmed') {
            await reconcileStoreCalendarEntries(bookingId, 'confirmed', transactionResult.calendarEvent);
            showToast(' Booking Confirmed & Added to Calendar!', 'success');
        } else if (normalizedNewStatus === 'cancelled') {
            await reconcileStoreCalendarEntries(bookingId, 'cancelled');
            showToast(' Booking Declined', 'info');
        } else if (normalizedNewStatus === 'completed') {
            await reconcileStoreCalendarEntries(bookingId, 'completed');

            // === FINANCIAL TRACKING ===
            // Handle both legacy and new price fields
            let servicePrice = 0;
            if (transactionResult.bookingData.price !== undefined) servicePrice = Number(transactionResult.bookingData.price);
            else if (transactionResult.bookingData.servicePrice !== undefined) servicePrice = Number(transactionResult.bookingData.servicePrice);

            const commission = Math.round(servicePrice * 0.10); // 10% commission
            const storeId = transactionResult.bookingData.storeId || transactionResult.bookingData.merchantId || currentUser.storeId;

            console.log('Financial tracking:', { storeId, servicePrice, commission, raw: transactionResult.bookingData });

            if (!storeId) {
                console.error('No storeId found for financial tracking!');
                showToast('Warning: Financials not updated (missing store ID)', 'warning');
            } else if (transactionResult.statusChanged) {
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
                            storeName: transactionResult.bookingData.storeName || '',
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
                        storeName: transactionResult.bookingData.storeName || '',
                        bookingId: bookingId,
                        type: 'revenue',
                        amount: servicePrice,
                        commission: commission,
                        serviceName: transactionResult.bookingData.serviceName || 'Service',
                        customerName: transactionResult.bookingData.customerName || 'Customer',
                        createdAt: new Date().toISOString()
                    });
                } catch (err) {
                    console.error('Error adding transaction:', err);
                }

                showToast(` Complete! +${servicePrice.toLocaleString()} IQD Revenue`, 'success');

                // Refresh financials tab if visible
                if (document.getElementById('owner-financials').style.display !== 'none') {
                    loadOwnerFinancials();
                }
            } else {
                showToast(' Booking already marked as completed.', 'info');
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
            <h2 style="margin: 0;"> ${dateString}</h2>
            <span class="close-modal" onclick="closeModal('calendar-day-modal')">&times;</span>
        </div>
    `;

    if (bookings.length === 0) {
        modalContent += `
            <div style="text-align: center; padding: 40px; color: #888;">
                <span style="font-size: 3rem;"></span>
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
                            <span style="color: #666;"> Customer:</span> <strong>${b.customerName || 'N/A'}</strong>
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;"> Phone:</span> ${b.customerPhone || 'N/A'}
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;"> Time:</span> <strong>${bookingTime}</strong>
                        </div>
                        <div style="margin-top: 4px;">
                            <span style="color: #666;"> Price:</span> ${(b.price || 0).toLocaleString()} IQD
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
                    <button class="btn-primary" style="padding: 6px 16px; font-size: 0.85rem;" onclick="updateBookingStatus('${b.id}', 'confirmed')"> Accept</button>
                    <button class="btn-outline" style="padding: 6px 16px; font-size: 0.85rem; border-color: #ef4444; color: #ef4444;" onclick="updateBookingStatus('${b.id}', 'cancelled')"> Reject</button>
                </div>
                ` : b.status === 'confirmed' ? `
                <div style="margin-top: 12px;">
                    <button class="btn-primary" style="padding: 6px 16px; font-size: 0.85rem;" onclick="updateBookingStatus('${b.id}', 'completed')"> Mark Complete</button>
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
    document.getElementById('owner-store-workers').value = store.workerCount || 1;
    document.getElementById('owner-cancellation-policy').value = store.cancellationPolicy || '';
    document.getElementById('owner-store-lat').value = store.lat || '';
    document.getElementById('owner-store-lng').value = store.lng || '';

    // Services
    renderOwnerServices(store.services || []);
    
    // Staff
    if(window.renderOwnerStaff) {
        renderOwnerStaff(store.staff || []);
    }

    // Products
    if (window.renderOwnerProducts) {
        renderOwnerProducts(store.products || []);
    }
}

function renderOwnerServices(services) {
    const list = document.getElementById('owner-services-list');
    list.innerHTML = services.map((s, i) => `
         <div class="sortable-item">
             <div class="service-info">
                <div class="service-name">${s.name} ${s.category ? `<span style="font-size: 0.75rem; background: #eee; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${s.category}</span>` : ''}</div>
                <div class="service-meta">${s.duration} mins • ${s.price.toLocaleString()} IQD</div>
            </div>
             <div class="service-actions">
                <button type="button" class="service-action-btn edit" onclick="editOwnerService(${i})">️</button>
                <button type="button" class="service-action-btn delete" onclick="deleteOwnerService(${i})">️</button>
            </div>
        </div>
    `).join('');
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
                    ? '<div class="date" style="color: green;"> Paid</div>'
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
    try {
        const nameEle = document.getElementById('owner-store-name');
        const addressEle = document.getElementById('owner-store-address');
        const workersEle = document.getElementById('owner-store-workers');
        const latEle = document.getElementById('owner-store-lat');
        const lngEle = document.getElementById('owner-store-lng');
        const photoFile = document.getElementById('owner-store-photo-file').files[0];

        if (!nameEle || !workersEle) {
            alert("Error: Critical form elements are missing from the page.");
            return;
        }

        const name = nameEle.value;
        const address = addressEle ? addressEle.value : '';
        const workerCount = Math.max(1, parseInt(workersEle.value) || 1);
        const cancellationPolicy = document.getElementById('owner-cancellation-policy')?.value || '';
        
        let updateData = {
            name: name,
            address: address,
            workerCount: workerCount,
            cancellationPolicy: cancellationPolicy
        };

        if (latEle && lngEle) {
            let lat = parseFloat(latEle.value);
            let lng = parseFloat(lngEle.value);
            if (!isNaN(lat) && !isNaN(lng)) {
                updateData.lat = lat;
                updateData.lng = lng;
            } else {
                updateData.lat = null;
                updateData.lng = null;
            }
        }

        if (!currentUser || !currentUser.storeId) {
            alert("Error: You are not linked to a store.");
            return;
        }

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
        console.error("Save Error:", e);
        alert('Failed to update store: ' + e.message);
        showToast('Failed to update store: ' + e.message, 'error');
    }
}

// 6. Owner Service Management
window.openAddServiceModalForOwner = function () {
    window.isOwnerServiceEdit = true; // Context flag
    document.getElementById('service-modal-title').innerText = 'Add New Service';
    document.getElementById('service-edit-index').value = -1; // New
    document.getElementById('service-edit-name').value = '';
    document.getElementById('service-edit-category').value = '';
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
    document.getElementById('service-edit-category').value = service.category || '';
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
    const category = document.getElementById('service-edit-category').value;
    const price = parseInt(document.getElementById('service-edit-price').value);
    const duration = parseInt(document.getElementById('service-edit-duration').value);
    const index = parseInt(document.getElementById('service-edit-index').value);

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store.services) store.services = [];

    const newService = { name, category, price, duration };

    if (index === -1) {
        store.services.push(newService);
    } else {
        store.services[index] = newService;
    }

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { services: store.services });
        renderOwnerServices(store.services);
        document.getElementById('service-edit-category').value = '';
        closeModal('service-modal');
    } catch (e) {
        console.error(e);
        showToast('Error saving service', 'error');
    }
}

// ========== STAFF MEMBERS (OWNER) ==========
window.renderOwnerStaff = function (staffArray) {
    const list = document.getElementById('owner-staff-list');
    if (!list) return;
    
    list.innerHTML = staffArray.map((st, i) => `
         <div class="sortable-item">
            ${st.image ? `<img src="${st.image}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:10px;">` : `<div style="width:40px; height:40px; border-radius:50%; background:#e2e8f0; display:flex; align-items:center; justify-content:center; margin-right:10px; font-weight:bold; color:#64748b;">${st.name.charAt(0)}</div>`}
             <div class="service-info">
                <div class="service-name">${st.name}</div>
                <div class="service-meta" style="color:var(--primary); font-weight:500;">${st.role || 'Staff Member'}</div>
            </div>
             <div class="service-actions">
                <button type="button" class="service-action-btn edit" onclick="editOwnerStaff(${i})">️</button>
                <button type="button" class="service-action-btn delete" onclick="deleteOwnerStaff(${i})">️</button>
            </div>
        </div>
    `).join('');
};

window.openAddStaffModalForOwner = function () {
    document.getElementById('staff-modal-title').textContent = 'Add New Staff Member';
    document.getElementById('staff-edit-index').value = '-1';
    document.getElementById('staff-form').reset();

    const form = document.getElementById('staff-form');
    form.onsubmit = saveOwnerStaff;

    document.getElementById('staff-modal').style.display = 'flex';
};

window.editOwnerStaff = function (index) {
    const store = allMerchants.find(m => m.id === currentUser.storeId);
    const st = store.staff[index];

    document.getElementById('staff-modal-title').textContent = 'Edit Staff Member';
    document.getElementById('staff-edit-index').value = index;
    document.getElementById('staff-edit-name').value = st.name;
    document.getElementById('staff-edit-role').value = st.role || '';
    document.getElementById('staff-edit-image').value = st.image || '';

    const form = document.getElementById('staff-form');
    form.onsubmit = saveOwnerStaff;

    document.getElementById('staff-modal').style.display = 'flex';
};

window.deleteOwnerStaff = async function (index) {
    if (!await showConfirm('Are you sure you want to delete this staff member?')) return;

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    store.staff.splice(index, 1);

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { staff: store.staff });
        renderOwnerStaff(store.staff);
    } catch (e) {
        showToast('Error deleting staff member', 'error');
    }
};

async function saveOwnerStaff(e) {
    e.preventDefault();
    const name = document.getElementById('staff-edit-name').value.trim();
    const role = document.getElementById('staff-edit-role').value.trim();
    const image = document.getElementById('staff-edit-image').value.trim();
    const index = parseInt(document.getElementById('staff-edit-index').value);

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store.staff) store.staff = [];

    const existingId = index >= 0 ? (store.staff[index]?.id || null) : null;
    const newStaff = {
        id: existingId || `staff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        role,
        image
    };

    if (index === -1) {
        store.staff.push(newStaff);
    } else {
        store.staff[index] = newStaff;
    }

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { staff: store.staff });
        renderOwnerStaff(store.staff);
        closeModal('staff-modal');
    } catch (e) {
        console.error(e);
        showToast('Error saving staff member', 'error');
    }
}

// ========== PRODUCTS (OWNER SHOP) ==========
window.renderOwnerProducts = function (productsArray) {
    const list = document.getElementById('owner-products-list');
    if (!list) return;

    if (!productsArray || productsArray.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="padding: 18px; font-size: 0.9rem;">
                No products yet. Add your first product to start selling in the Shop tab.
            </div>
        `;
        return;
    }

    list.innerHTML = productsArray.map((p, i) => {
        const price = Number(p.price) || 0;
        const stock = Number(p.stock) || 0;
        const image = p.image || '';
        return `
            <div class="sortable-item">
                ${image
                    ? `<img src="${image}" alt="${p.name}" style="width:40px; height:40px; border-radius:8px; object-fit:cover; margin-right:10px;">`
                    : `<div style="width:40px; height:40px; border-radius:8px; background:#f3f4f6; display:flex; align-items:center; justify-content:center; margin-right:10px; color:#9ca3af; font-size:0.85rem;">IMG</div>`
                }
                <div class="service-info">
                    <div class="service-name">${p.name}</div>
                    <div class="service-meta">${price.toLocaleString()} IQD • Stock: ${stock}</div>
                </div>
                <div class="service-actions">
                    <button type="button" class="service-action-btn edit" onclick="editOwnerProduct(${i})">️</button>
                    <button type="button" class="service-action-btn delete" onclick="deleteOwnerProduct(${i})">️</button>
                </div>
            </div>
        `;
    }).join('');
};

window.openAddProductModalForOwner = function () {
    const form = document.getElementById('product-form');
    if (!form) return;
    document.getElementById('product-modal-title').textContent = 'Add Product';
    document.getElementById('product-edit-index').value = '-1';
    form.reset();
    form.onsubmit = saveOwnerProduct;
    document.getElementById('product-modal').style.display = 'flex';
};

window.editOwnerProduct = function (index) {
    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store?.products?.[index]) return;
    const product = store.products[index];

    document.getElementById('product-modal-title').textContent = 'Edit Product';
    document.getElementById('product-edit-index').value = String(index);
    document.getElementById('product-edit-name').value = product.name || '';
    document.getElementById('product-edit-price').value = Number(product.price) || 0;
    document.getElementById('product-edit-stock').value = Number(product.stock) || 0;
    document.getElementById('product-edit-image').value = product.image || '';

    const form = document.getElementById('product-form');
    form.onsubmit = saveOwnerProduct;
    document.getElementById('product-modal').style.display = 'flex';
};

window.deleteOwnerProduct = async function (index) {
    if (!await showConfirm('Delete this product from your shop?')) return;

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store) return;
    if (!Array.isArray(store.products)) store.products = [];
    store.products.splice(index, 1);

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { products: store.products });
        renderOwnerProducts(store.products);
        showToast('Product removed.', 'success');
    } catch (e) {
        console.error('Delete product error:', e);
        showToast('Error deleting product', 'error');
    }
};

async function saveOwnerProduct(e) {
    e.preventDefault();

    const name = document.getElementById('product-edit-name').value.trim();
    const price = parseInt(document.getElementById('product-edit-price').value, 10);
    const stock = parseInt(document.getElementById('product-edit-stock').value, 10);
    const image = document.getElementById('product-edit-image').value.trim();
    const index = parseInt(document.getElementById('product-edit-index').value, 10);

    if (!name) {
        showToast('Product name is required.', 'error');
        return;
    }
    if (!Number.isFinite(price) || price < 0) {
        showToast('Product price must be 0 or higher.', 'error');
        return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
        showToast('Product stock must be 0 or higher.', 'error');
        return;
    }

    const store = allMerchants.find(m => m.id === currentUser.storeId);
    if (!store) return;
    if (!Array.isArray(store.products)) store.products = [];

    const newProduct = { name, price, stock, image };
    if (index === -1) {
        store.products.push(newProduct);
    } else {
        store.products[index] = newProduct;
    }

    try {
        await updateDoc(doc(db, "merchants", currentUser.storeId), { products: store.products });
        renderOwnerProducts(store.products);
        closeModal('product-modal');
        showToast('Product saved successfully.', 'success');
    } catch (e) {
        console.error('Save product error:', e);
        showToast('Error saving product', 'error');
    }
}


// ==========================================================
// ================== SERVICE BUDGET SEARCH =================
// ==========================================================

const SERVICE_CATEGORIES = [
    {
        name: 'Nails ',
        key: 'nails',
        subServices: ['Nail Polish', 'Gel Nails', 'Acrylic Nails', 'Manicure', 'Pedicure', 'Nail Art', 'French Tips', 'Nail Extensions']
    },
    {
        name: 'Hair ',
        key: 'hair',
        subServices: ['Haircut', 'Hair Color', 'Highlights', 'Keratin Treatment', 'Hair Blowout', 'Balayage', 'Hair Extensions', 'Hair Treatment']
    },
    {
        name: 'Skin & Glow ',
        key: 'skin',
        subServices: ['Facial', 'Deep Cleansing', 'Chemical Peel', 'Microdermabrasion', 'Hydrafacial', 'Anti-Aging Treatment', 'Skin Brightening', 'Acne Treatment']
    },
    {
        name: 'Massage ',
        key: 'massage',
        subServices: ['Swedish Massage', 'Deep Tissue Massage', 'Hot Stone Massage', 'Aromatherapy', 'Couple Massage', 'Back Massage', 'Foot Massage', 'Head Massage']
    },
    {
        name: 'Makeup ',
        key: 'makeup',
        subServices: ['Full Makeup', 'Natural Makeup', 'Bridal Makeup', 'Party Makeup', 'Eyeshadow', 'Eyelashes', 'Contouring', 'Airbrush Makeup']
    },
    {
        name: 'Brows & Lashes ️',
        key: 'brows',
        subServices: ['Eyebrow Threading', 'Eyebrow Tinting', 'Eyebrow Lamination', 'Lash Lift', 'Lash Extensions', 'Lash Tint', 'HD Brows']
    },
    {
        name: 'Laser & Aesthetics ',
        key: 'laser',
        subServices: ['Laser Hair Removal', 'Botox', 'Filler', 'PRP', 'Carbon Peel', 'Mesotherapy', 'RF Lifting']
    },
    {
        name: 'Waxing & Threading 🧖',
        key: 'waxing',
        subServices: ['Full Body Wax', 'Leg Wax', 'Arm Wax', 'Underarm Wax', 'Facial Wax', 'Threading']
    }
];

let serviceSearchState = {
    selectedCategory: null,
    selectedSubService: null,
    budget: null
};

window.openServiceSearch = function () {
    serviceSearchState = { selectedCategory: null, selectedSubService: null, budget: null };
    renderServiceSearchStep('categories');
    document.getElementById('service-search-modal').style.display = 'flex';
};

function renderServiceSearchStep(step) {
    const body = document.getElementById('service-search-body');

    if (step === 'categories') {
        body.innerHTML = `
            <h2 style="margin-bottom:6px;">Find a Service</h2>
            <p style="color: var(--text-light); margin-bottom: 24px; font-size: 0.95rem;">What are you looking for today?</p>
            <div class="service-category-grid">
                ${SERVICE_CATEGORIES.map(cat => `
                    <div class="service-category-card" onclick="selectServiceCategory('${cat.key}')">
                        <span class="cat-icon">${cat.name.split(' ').slice(-1)[0]}</span>
                        <span class="cat-name">${cat.name.split(' ').slice(0, -1).join(' ')}</span>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (step === 'subservices') {
        const cat = SERVICE_CATEGORIES.find(c => c.key === serviceSearchState.selectedCategory);
        body.innerHTML = `
            <button class="btn-back" onclick="renderServiceSearchStep('categories')">← Back</button>
            <h2 style="margin-bottom:6px;">${cat.name}</h2>
            <p style="color: var(--text-light); margin-bottom: 20px; font-size: 0.95rem;">Select a specific service</p>
            <div class="service-subservice-list">
                ${cat.subServices.map(s => `
                    <div class="service-subservice-item" onclick="selectSubService('${s}')">
                        <span>${s}</span>
                        <span style="color: var(--primary); font-size: 1.1rem;">→</span>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (step === 'budget') {
        body.innerHTML = `
            <button class="btn-back" onclick="renderServiceSearchStep('subservices')">← Back</button>
            <h2 style="margin-bottom:6px;">${serviceSearchState.selectedSubService}</h2>
            <p style="color: var(--text-light); margin-bottom: 24px; font-size: 0.95rem;">Set your budget <span style="font-weight:500;">(optional)</span></p>
            <div class="budget-input-wrapper">
                <input type="number" id="budget-input" class="budget-input" placeholder="e.g. 40000" min="0" step="1000">
                <span class="budget-currency">IQD</span>
            </div>
            <p style="color: var(--text-light); font-size: 0.8rem; text-align: center; margin-top: 10px;">Leave empty to see all salons offering this service</p>
            <button class="btn-primary" style="width: 100%; margin-top: 24px;" onclick="applyServiceBudgetFilter()">
                 Search Salons
            </button>
        `;
        // Allow pressing Enter to search
        setTimeout(() => {
            const inp = document.getElementById('budget-input');
            if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') applyServiceBudgetFilter(); });
        }, 50);
    } else if (step === 'results') {
        // Show loading state while searching
        body.innerHTML = `
            <div style="text-align:center; padding:60px 0;">
                <div style="font-size:2rem; margin-bottom:12px;"></div>
                <p style="color: var(--text-light);">Searching salons...</p>
            </div>
        `;
        setTimeout(() => renderServiceSearchResults(), 100);
    }
}

window.selectServiceCategory = function (key) {
    serviceSearchState.selectedCategory = key;
    renderServiceSearchStep('subservices');
};

window.selectSubService = function (name) {
    serviceSearchState.selectedSubService = name;
    renderServiceSearchStep('budget');
};

window.applyServiceBudgetFilter = function () {
    const budgetRaw = document.getElementById('budget-input')?.value?.trim();
    serviceSearchState.budget = budgetRaw ? parseInt(budgetRaw, 10) : null;
    renderServiceSearchStep('results');
};

function renderServiceSearchResults() {
    const body = document.getElementById('service-search-body');
    const { selectedSubService, budget } = serviceSearchState;
    const key = selectedSubService.toLowerCase();

    // Find merchants with a matching service
    const results = [];
    allMerchants.forEach(merchant => {
        if (!merchant.services || merchant.services.length === 0) return;
        merchant.services.forEach(s => {
            if (!s.name.toLowerCase().includes(key)) return;
            if (budget !== null && s.price > budget) return;
            results.push({ merchant, service: s });
        });
    });

    const budgetLabel = budget ? `Budget: ${budget.toLocaleString()} IQD` : 'No budget limit';

    if (results.length === 0) {
        body.innerHTML = `
            <button class="btn-back" onclick="renderServiceSearchStep('budget')">← Back</button>
            <h2 style="margin-bottom:6px;">${selectedSubService}</h2>
            <p style="color: var(--text-light); margin-bottom:20px; font-size:0.9rem;">${budgetLabel}</p>
            <div class="empty-state" style="padding: 40px 0;">
                <div style="font-size:3rem; margin-bottom:12px;"></div>
                <p>No salons found for this service${budget ? ' in your budget' : ''}.</p>
                <button class="btn-outline" style="margin-top:16px;" onclick="renderServiceSearchStep('budget')">Try a higher budget</button>
            </div>
        `;
        return;
    }

    body.innerHTML = `
        <button class="btn-back" onclick="renderServiceSearchStep('budget')">← Back</button>
        <h2 style="margin-bottom:6px;">${selectedSubService}</h2>
        <p style="color: var(--text-light); margin-bottom:20px; font-size:0.9rem;">${budgetLabel} · <strong>${results.length} salon${results.length > 1 ? 's' : ''} found</strong></p>
        <div class="service-results-list">
            ${results.map(({ merchant, service }) => {
                const imageContent = merchant.photoUrl
                    ? `<img src="${merchant.photoUrl}" alt="${merchant.name}">`
                    : `<span style="font-size:2.5rem;">${merchant.image || ''}</span>`;
                return `
                <div class="service-result-card" onclick="openMerchantDetails('${merchant.id}'); closeModal('service-search-modal');">
                    <div class="service-result-img">${imageContent}</div>
                    <div class="service-result-info">
                        <div class="service-result-name">${merchant.name}</div>
                        <div class="service-result-meta"> ${merchant.address}</div>
                        <div class="service-result-service">
                            <span>${service.name}</span>
                            <span class="service-result-price">${service.price.toLocaleString()} IQD</span>
                        </div>
                    </div>
                    <div class="service-result-action">
                        <button class="btn-primary" style="padding: 10px 18px; font-size:0.9rem;" onclick="event.stopPropagation(); openMerchantDetails('${merchant.id}', '${encodeURIComponent(JSON.stringify(service))}'); closeModal('service-search-modal');">
                            Book
                        </button>
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
}


// Start
init();
initDarkMode();

/* =========================================
   CUSTOMER PROFILE MANAGEMENT
========================================= */

window.openCustomerProfile = async function() {
    if (!currentUser) return;
    document.getElementById('profile-name').value = currentUser.name || '';
    document.getElementById('profile-phone').value = currentUser.phone || '';
    document.getElementById('profile-email').value = currentUser.email || '';
    
    // Clear password fields
    document.getElementById('profile-curr-pass').value = '';
    document.getElementById('profile-new-pass').value = '';

    switchProfileTab('personal');
    document.getElementById('customer-profile-modal').style.display = 'flex';
};

window.switchProfileTab = function(tabName) {
    // Hide all tabs
    document.getElementById('profile-tab-personal').style.display = 'none';
    document.getElementById('profile-tab-security').style.display = 'none';
    document.getElementById('profile-tab-history').style.display = 'none';

    // Remove active styles
    document.getElementById('profile-tab-btn-personal').classList.remove('active');
    document.getElementById('profile-tab-btn-security').classList.remove('active');
    document.getElementById('profile-tab-btn-history').classList.remove('active');

    // Show selected
    document.getElementById(`profile-tab-${tabName}`).style.display = 'block';
    document.getElementById(`profile-tab-btn-${tabName}`).classList.add('active');

    if (tabName === 'history') {
        loadCustomerHistory();
    }
};

// 1. Personal Info Form
const profilePersonalForm = document.getElementById('profile-personal-form');
if (profilePersonalForm) {
    profilePersonalForm.onsubmit = async (e) => {
        e.preventDefault();
        const newName = document.getElementById('profile-name').value.trim();
        const newEmail = document.getElementById('profile-email').value.trim();
        const submitBtn = profilePersonalForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        
        try {
            // Update Auth Email if it changed and exists
            if (newEmail && newEmail !== currentUser.email && auth.currentUser) {
                await updateEmail(auth.currentUser, newEmail);
            }
            
            // Update Firestore Profile
            const userRef = doc(db, 'users', currentUser.phone);
            await updateDoc(userRef, {
                name: newName,
                email: newEmail
            });

            // Update local state
            currentUser.name = newName;
            currentUser.email = newEmail;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateUIForUser();
            
            showToast('Profile updated successfully!', 'success');
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/requires-recent-login') {
                showToast('Email change requires recent login. Please logout and login again.', 'error');
            } else {
                showToast('Error updating profile: ' + error.message, 'error');
            }
        } finally {
            submitBtn.disabled = false;
        }
    };
}

// 2. Security (Password) Form
const profileSecurityForm = document.getElementById('profile-security-form');
if (profileSecurityForm) {
    profileSecurityForm.onsubmit = async (e) => {
        e.preventDefault();
        const currentPass = document.getElementById('profile-curr-pass').value;
        const newPass = document.getElementById('profile-new-pass').value;
        const submitBtn = profileSecurityForm.querySelector('button[type="submit"]');
        
        if (newPass.length < 6) {
            showToast('New password must be at least 6 characters.', 'error');
            return;
        }

        submitBtn.disabled = true;

        try {
            // Re-authenticate user before changing password
            const userEmail = currentUser.email || currentUser.phone + '@hewrina.app';
            const credential = EmailAuthProvider.credential(userEmail, currentPass);
            await reauthenticateWithCredential(auth.currentUser, credential);
            
            // Update Password
            await updatePassword(auth.currentUser, newPass);
            
            document.getElementById('profile-curr-pass').value = '';
            document.getElementById('profile-new-pass').value = '';
            showToast('Password updated successfully!', 'success');
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                showToast('Incorrect current password.', 'error');
            } else {
                showToast('Error updating password: ' + error.message, 'error');
            }
        } finally {
            submitBtn.disabled = false;
        }
    };
}

// 3. Load Visit History
async function loadCustomerHistory() {
    const listContainer = document.getElementById('customer-visit-history');
    listContainer.innerHTML = '<p>Loading your history...</p>';
    
    try {
        const q = query(collection(db, 'bookings'), where('customerPhone', '==', currentUser.phone), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            listContainer.innerHTML = '<div style="text-align: center; padding: 32px; background: #f9f9f9; border-radius: 8px;"><p style="color: #666; margin: 0;">No visit history found.</p></div>';
            return;
        }
        
        listContainer.innerHTML = '';
        snapshot.forEach(docSnap => {
            const b = docSnap.data();
            const bookingId = docSnap.id;
            const dateObj = typeof b.bookingDate === 'string' ? new Date(b.bookingDate) : b.bookingDate.toDate();
            
            // Format status colors correctly
            let bgColor = '#f3f4f6';
            let textColor = '#4b5563';
            if (b.status === 'confirmed') { bgColor = '#dbeafe'; textColor = '#2563eb'; }
            if (b.status === 'completed') { bgColor = '#d1fae5'; textColor = '#059669'; }
            if (b.status === 'cancelled' || b.status === 'canceled') { bgColor = '#fee2e2'; textColor = '#dc2626'; }
            if (b.status === 'pending') { bgColor = '#fef3c7'; textColor = '#d97706'; }
            
            // Check if already reviewed
            const existingReview = allReviews.find(r => r.bookingId === bookingId);
            let reviewBtnHTML = '';
            if (b.status === 'completed') {
                if (existingReview) {
                    reviewBtnHTML = `<span class="btn-reviewed">✓ Reviewed (${existingReview.rating}★)</span>`;
                } else {
                    reviewBtnHTML = `<button class="btn-leave-review" onclick="event.stopPropagation(); openReviewModal('${bookingId}', '${b.storeId}', '${(b.storeName || '').replace(/'/g, "\\'")}')">★ Leave a Review</button>`;
                }
            }
            
            const card = document.createElement('div');
            card.style.cssText = 'background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 8px;';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 600;">${b.storeName}</h4>
                        <p style="margin: 4px 0 0 0; color: #4b5563; font-size: 0.95rem;">${b.serviceName} &bull; ${b.servicePrice.toLocaleString()} IQD</p>
                    </div>
                    <span style="background: ${bgColor}; color: ${textColor}; padding: 4px 12px; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; text-transform: capitalize;">
                        ${b.status}
                    </span>
                </div>
                <div style="font-size: 0.85rem; color: #6b7280; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f3f4f6; padding-top: 8px; margin-top: 8px;">
                    <span>Visit Date:</span>
                    <span style="font-weight: 500;">
                        ${dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                </div>
                ${reviewBtnHTML ? `<div style="margin-top: 10px; display: flex; justify-content: flex-end;">${reviewBtnHTML}</div>` : ''}
            `;
            listContainer.appendChild(card);
        });
        
    } catch (error) {
        console.error("Error fetching history:", error);
        listContainer.innerHTML = '<p style="color: red;">Failed to load history.</p>';
    }
}


// ========== RATINGS & REVIEWS SYSTEM ==========

let pendingReview = { bookingId: null, storeId: null, storeName: '', rating: 0 };

window.setReviewRating = function(value) {
    pendingReview.rating = value;
    const stars = document.querySelectorAll('#star-picker .star');
    stars.forEach((star, i) => {
        star.classList.toggle('active', i < value);
    });
    const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    document.getElementById('rating-label').textContent = labels[value] || '';
};

window.openReviewModal = function(bookingId, storeId, storeName) {
    pendingReview = { bookingId, storeId, storeName, rating: 0 };
    
    // Reset UI
    document.getElementById('review-store-name').textContent = `How was your visit to ${storeName}?`;
    document.getElementById('review-comment').value = '';
    document.getElementById('rating-label').textContent = 'Tap a star to rate';
    document.querySelectorAll('#star-picker .star').forEach(s => s.classList.remove('active'));
    
    document.getElementById('review-modal').style.display = 'flex';
};

window.submitReview = async function() {
    if (pendingReview.rating === 0) {
        showToast('Please select a star rating', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-submit-review');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    
    try {
        const reviewData = {
            bookingId: pendingReview.bookingId,
            storeId: pendingReview.storeId,
            storeName: pendingReview.storeName,
            customerId: currentUser.phone,
            customerName: currentUser.name || 'Anonymous',
            rating: pendingReview.rating,
            comment: document.getElementById('review-comment').value.trim(),
            createdAt: Timestamp.now()
        };
        
        await addDoc(collection(db, 'reviews'), reviewData);
        
        // Update local cache
        allReviews.push(reviewData);
        
        // Refresh UI
        renderMerchants();
        
        closeModal('review-modal');
        showToast('Thank you for your review! ⭐', 'success');
        
        // Refresh visit history to show "Reviewed" badge
        loadCustomerHistory();
        
    } catch (error) {
        console.error('Error submitting review:', error);
        showToast('Failed to submit review. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Review';
    }
};



// ========== ENHANCED SEARCH ==========

let isSearchActive = false;
let discoveryMapInstance = null;
let discoveryMarkers = [];
let discoveryMapVisible = false;

window.toggleInlineMap = function () {
    discoveryMapVisible = !discoveryMapVisible;
    const panel = document.getElementById('discovery-map-panel');
    const layout = document.getElementById('discovery-layout');
    const btn = document.getElementById('map-toggle-btn');

    if (discoveryMapVisible) {
        panel.style.display = 'block';
        layout.classList.add('map-active');
        btn.classList.add('active');
        btn.textContent = '✕ Hide Map';
        // Initialize map if first time
        if (!discoveryMapInstance && typeof google !== 'undefined') {
            discoveryMapInstance = new google.maps.Map(document.getElementById('discovery-map'), {
                center: { lat: 36.191, lng: 44.009 }, // Erbil default
                zoom: 13,
                styles: [
                    { featureType: "poi", stylers: [{ visibility: "off" }] },
                    { featureType: "transit", stylers: [{ visibility: "off" }] }
                ],
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false
            });
        }
        updateDiscoveryMapMarkers();
    } else {
        panel.style.display = 'none';
        layout.classList.remove('map-active');
        btn.classList.remove('active');
        btn.textContent = '🗺️ Map';
    }
};

function updateDiscoveryMapMarkers(filteredMerchants) {
    if (!discoveryMapInstance) return;
    
    // Clear existing markers
    discoveryMarkers.forEach(m => m.setMap(null));
    discoveryMarkers = [];

    const merchants = filteredMerchants || allMerchants;
    const bounds = new google.maps.LatLngBounds();
    let hasValidCoords = false;

    merchants.forEach(merchant => {
        if (!merchant.lat || !merchant.lng) return;
        hasValidCoords = true;
        const pos = { lat: parseFloat(merchant.lat), lng: parseFloat(merchant.lng) };
        bounds.extend(pos);

        const marker = new google.maps.Marker({
            position: pos,
            map: discoveryMapInstance,
            title: merchant.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: '#C19A6B',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2,
                scale: 8
            }
        });

        const infoWindow = new google.maps.InfoWindow({
            content: `<div style="padding:4px 8px;"><strong>${merchant.name}</strong><br><span style="color:#666;font-size:0.85rem;">${merchant.address || ''}</span><br><a href="#" onclick="event.preventDefault(); openMerchantDetails('${merchant.id}')" style="color:#C19A6B; font-weight:500;">View Profile →</a></div>`
        });
        marker.addListener('click', () => {
            discoveryMarkers.forEach(m => m.infoWindow?.close());
            infoWindow.open(discoveryMapInstance, marker);
        });
        marker.infoWindow = infoWindow;
        marker.merchantId = merchant.id;
        discoveryMarkers.push(marker);
    });

    if (hasValidCoords) {
        discoveryMapInstance.fitBounds(bounds);
        if (merchants.length === 1) {
            discoveryMapInstance.setZoom(15);
        }
    }
}

window.performSearch = function() {
    const treatmentQuery = (document.getElementById('search-treatment')?.value || '').trim().toLowerCase();
    const categoryFilter = document.getElementById('search-category')?.value || 'all';
    const sortBy = document.getElementById('search-sort')?.value || 'default';
    
    // Check if any filter is active
    isSearchActive = treatmentQuery !== '' || categoryFilter !== 'all' || sortBy !== 'default';
    
    let filtered = [...allMerchants];
    
    // Filter by treatment name (search through services)
    if (treatmentQuery) {
        filtered = filtered.filter(m => {
            const services = m.services || [];
            const nameMatch = m.name.toLowerCase().includes(treatmentQuery);
            const serviceMatch = services.some(s => s.name.toLowerCase().includes(treatmentQuery));
            return nameMatch || serviceMatch;
        });
    }
    
    // Filter by category
    if (categoryFilter !== 'all') {
        filtered = filtered.filter(m => m.category === categoryFilter);
    }
    
    // Also apply the current type filter (All / Salons / Beauty Centers chips)
    if (currentFilter !== 'all') {
        filtered = filtered.filter(m => m.type === currentFilter);
    }
    
    // Sort
    if (sortBy === 'rating') {
        filtered.sort((a, b) => {
            const rA = getStoreRating(a.id);
            const rB = getStoreRating(b.id);
            return parseFloat(rB.avg) - parseFloat(rA.avg);
        });
    } else if (sortBy === 'reviews') {
        filtered.sort((a, b) => {
            const rA = getStoreRating(a.id);
            const rB = getStoreRating(b.id);
            return rB.count - rA.count;
        });
    } else if (sortBy === 'nearest') {
        filtered.sort((a, b) => {
            const distA = parseFloat(a.distance) || 999;
            const distB = parseFloat(b.distance) || 999;
            return distA - distB;
        });
    }
    
    // Show search results info
    const infoBar = document.getElementById('search-results-info');
    const countEl = document.getElementById('search-results-count');
    
    if (isSearchActive) {
        infoBar.style.display = 'flex';
        let label = `${filtered.length} venue${filtered.length !== 1 ? 's' : ''} found`;
        if (treatmentQuery) label += ` for "${treatmentQuery}"`;
        if (categoryFilter !== 'all') label += ` in ${categoryFilter}`;
        countEl.textContent = label;
        // Show map toggle button
        const mapToggleBtn = document.getElementById('map-toggle-btn');
        if (mapToggleBtn) mapToggleBtn.style.display = 'inline-block';
    } else {
        infoBar.style.display = 'none';
        // Hide map toggle and collapse map when clearing search
        const mapToggleBtn = document.getElementById('map-toggle-btn');
        if (mapToggleBtn) mapToggleBtn.style.display = 'none';
        if (discoveryMapVisible) {
            discoveryMapVisible = false;
            const panel = document.getElementById('discovery-map-panel');
            const layout = document.getElementById('discovery-layout');
            if (panel) panel.style.display = 'none';
            if (layout) layout.classList.remove('map-active');
        }
    }
    
    // Update map markers if map is visible
    if (discoveryMapVisible) {
        updateDiscoveryMapMarkers(filtered);
    }
    
    // Render filtered results
    if (filtered.length === 0) {
        if (merchantsGrid) merchantsGrid.innerHTML = '<div class="empty-state">No venues match your search. Try different keywords.</div>';
        return;
    }
    
    if (merchantsGrid) merchantsGrid.innerHTML = filtered.map(merchant => {
        const imageContent = merchant.photoUrl
            ? `<img src="${merchant.photoUrl}" alt="${merchant.name}" onerror="this.outerHTML='<span class=\\'emoji-fallback\\'>${merchant.image || ''}</span>'">`
            : `<span class="emoji-fallback">${merchant.image || ''}</span>`;
        
        const now = new Date();
        const merchantOffers = getActiveMerchantOffers(merchant.id, now);
        const hasDiscount = merchantOffers.length > 0;
        const maxDiscount = hasDiscount ? Math.max(...merchantOffers.map(o => o.discountPercent)) : 0;
        
        const rating = getStoreRating(merchant.id);
        const ratingHTML = rating.count > 0
            ? `<div class="card-rating">
                    <span class="stars">${generateStarHTML(parseFloat(rating.avg))}</span>
                    <span class="rating-score">${rating.avg}</span>
                    <span class="rating-count">(${rating.count})</span>
               </div>`
            : `<div class="card-rating"><span class="rating-count" style="color:#9ca3af;">No reviews yet</span></div>`;
        
        return `
        <div class="merchant-card" onclick="openMerchantDetails('${merchant.id}')">
            <div class="card-img-top">
                ${imageContent}
                ${hasDiscount ? `<div class="discount-badge"> Up to ${maxDiscount}% OFF</div>` : ''}
            </div>
            <div class="card-body">
                <span class="card-tag">${merchant.category}</span>
                <h3 class="card-title">${merchant.name}</h3>
                ${ratingHTML}
                <div class="card-meta">
                    <span>${merchant.distance}</span>
                </div>
                <p style="color: #6b7280; font-size: 0.9rem;">${merchant.address}</p>
                ${merchant.lat && merchant.lng ? `<span class="btn-map-link" onclick="event.stopPropagation(); showOnMap('${merchant.id}')"> View on Map</span>` : ''}
            </div>
        </div>
    `}).join('');
};

window.clearSearch = function() {
    document.getElementById('search-treatment').value = '';
    document.getElementById('search-category').value = 'all';
    document.getElementById('search-sort').value = 'default';
    document.getElementById('search-results-info').style.display = 'none';
    isSearchActive = false;
    
    // Collapse discovery map
    discoveryMapVisible = false;
    const panel = document.getElementById('discovery-map-panel');
    const layout = document.getElementById('discovery-layout');
    const btn = document.getElementById('map-toggle-btn');
    if (panel) panel.style.display = 'none';
    if (layout) layout.classList.remove('map-active');
    if (btn) { btn.style.display = 'none'; btn.classList.remove('active'); btn.textContent = '🗺️ Map'; }
    
    renderMerchants();
};


// ========== VENUE PROFILE PAGE ==========

let currentVenueProfileMerchantId = null;
const venueProfileState = {
    activeTabByMerchant: {},
    cartByMerchant: {}
};

function renderVenueProfileMiniMap(merchant) {
    const mapContainer = document.getElementById('venue-profile-mini-map');
    if (!mapContainer) return;

    const coords = getMerchantCoordinates(merchant);
    if (!coords) {
        mapContainer.innerHTML = '<div class="venue-mini-map-fallback">Location coordinates are not available for this store yet.</div>';
        return;
    }

    if (!window.google?.maps) {
        mapContainer.innerHTML = '<div class="venue-mini-map-fallback">Map is still loading. Use the directions button to open the store location.</div>';
        return;
    }

    venueProfileMap = new google.maps.Map(mapContainer, {
        center: coords,
        zoom: 15,
        disableDefaultUI: true,
        gestureHandling: 'cooperative',
        clickableIcons: false,
        styles: [
            {
                featureType: 'poi.business',
                stylers: [{ visibility: 'off' }]
            }
        ]
    });

    venueProfileMapMarker = new google.maps.Marker({
        position: coords,
        map: venueProfileMap,
        title: merchant.name
    });
}

function getVenueCartItems(merchantId) {
    if (!venueProfileState.cartByMerchant[merchantId]) {
        venueProfileState.cartByMerchant[merchantId] = [];
    }
    return venueProfileState.cartByMerchant[merchantId];
}

function syncVenueCartWithProducts(merchantId, products) {
    const productList = Array.isArray(products) ? products : [];
    const cartItems = getVenueCartItems(merchantId);

    const synced = cartItems
        .filter(item => productList[item.productIndex])
        .map(item => {
            const stock = Math.max(0, Number(productList[item.productIndex].stock) || 0);
            const quantity = stock > 0 ? Math.max(1, Math.min(item.quantity, stock)) : 0;
            return { ...item, quantity };
        })
        .filter(item => item.quantity > 0);

    venueProfileState.cartByMerchant[merchantId] = synced;
    return synced;
}

function calculateVenueCartTotals(cartItems, products) {
    const productList = Array.isArray(products) ? products : [];
    return cartItems.reduce((acc, item) => {
        const product = productList[item.productIndex];
        if (!product) return acc;
        const price = Math.max(0, Number(product.price) || 0);
        const quantity = Math.max(1, Number(item.quantity) || 1);
        acc.totalItems += quantity;
        acc.subtotal += price * quantity;
        return acc;
    }, { totalItems: 0, subtotal: 0 });
}

function getVenueGalleryImages(merchant) {
    const galleryImages = Array.isArray(merchant?.gallery)
        ? merchant.gallery.filter(url => typeof url === 'string' && url.trim())
        : [];
    const primaryImage = typeof merchant?.photoUrl === 'string' && merchant.photoUrl.trim()
        ? [merchant.photoUrl]
        : [];

    return [...new Set([...primaryImage, ...galleryImages])].slice(0, 5);
}

function getVenueTeamMembers(merchant) {
    const explicitTeam = getBookableStaffOptions(merchant);
    if (explicitTeam.length > 0) return explicitTeam;

    const workerCount = Math.max(0, Number(merchant?.workerCount) || 0);
    if (workerCount <= 0) return [];

    return Array.from({ length: workerCount }, (_, idx) => ({
        id: workerCount > 1 ? `worker-${idx + 1}` : 'solo-worker',
        name: workerCount > 1 ? `Worker ${idx + 1}` : 'Main Specialist',
        role: merchant?.category || 'Specialist',
        image: ''
    }));
}

function getVenueInitials(name = '') {
    const parts = String(name)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    if (parts.length === 0) return 'HV';
    return parts.map(part => part[0].toUpperCase()).join('');
}

function getVenueSectionId(sectionName) {
    return `venue-section-${sectionName}`;
}

function scrollVenueProfileSection(sectionName, behavior = 'smooth') {
    const section = document.getElementById(getVenueSectionId(sectionName));
    if (!section) return;
    section.scrollIntoView({ behavior, block: 'start' });
}

window.openMerchantDetails = function (id, preselectedServiceJson = null) {
    const merchant = allMerchants.find(m => m.id === id);
    if (!merchant) return;

    // If a service was pre-selected (from search), go directly to booking
    if (preselectedServiceJson) {
        openBookingFromProfile(id, preselectedServiceJson);
        return;
    }

    if (!venueProfileState.activeTabByMerchant[id]) {
        venueProfileState.activeTabByMerchant[id] = 'services';
    }
    getVenueCartItems(id);

    // Otherwise, show the venue profile page
    renderVenueProfile(merchant);
};

window.switchVenueTab = function (tabName) {
    if (!currentVenueProfileMerchantId) return;
    const merchant = allMerchants.find(m => m.id === currentVenueProfileMerchantId);
    if (!merchant) return;
    venueProfileState.activeTabByMerchant[currentVenueProfileMerchantId] = tabName;
    renderVenueProfile(merchant, { preserveScroll: true, focusSection: tabName });
};

window.addProductToCart = function (merchantId, productIndex) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    const products = merchant?.products || [];
    const product = products[productIndex];
    if (!merchant || !product) return;

    const stock = Math.max(0, Number(product.stock) || 0);
    if (stock <= 0) {
        showToast('This product is out of stock.', 'error');
        return;
    }

    const cartItems = getVenueCartItems(merchantId);
    const existing = cartItems.find(item => item.productIndex === productIndex);
    if (existing) {
        if (existing.quantity >= stock) {
            showToast(`Only ${stock} left in stock.`, 'error');
            return;
        }
        existing.quantity += 1;
    } else {
        cartItems.push({ productIndex, quantity: 1 });
    }

    venueProfileState.activeTabByMerchant[merchantId] = 'shop';
    showToast('Product added to cart.', 'success');
    renderVenueProfile(merchant, { preserveScroll: true, focusSection: 'shop' });
};

window.changeShopCartQuantity = function (merchantId, productIndex, delta) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    const products = merchant?.products || [];
    const product = products[productIndex];
    if (!merchant || !product) return;

    const cartItems = getVenueCartItems(merchantId);
    const item = cartItems.find(entry => entry.productIndex === productIndex);
    if (!item) return;

    const stock = Math.max(0, Number(product.stock) || 0);
    if (delta > 0 && item.quantity >= stock) {
        showToast(`Only ${stock} left in stock.`, 'error');
        return;
    }

    item.quantity += delta;
    if (item.quantity <= 0) {
        venueProfileState.cartByMerchant[merchantId] = cartItems.filter(entry => entry.productIndex !== productIndex);
    }

    renderVenueProfile(merchant, { preserveScroll: true, focusSection: 'shop' });
};

window.removeFromShopCart = function (merchantId, productIndex) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    if (!merchant) return;
    const cartItems = getVenueCartItems(merchantId);
    venueProfileState.cartByMerchant[merchantId] = cartItems.filter(entry => entry.productIndex !== productIndex);
    renderVenueProfile(merchant, { preserveScroll: true, focusSection: 'shop' });
};

window.checkoutShopCart = async function (merchantId) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    if (!merchant) return;

    if (!currentUser) {
        showToast("Please login first.", 'error');
        authModal.style.display = 'flex';
        return;
    }

    const products = merchant.products || [];
    const cartItems = syncVenueCartWithProducts(merchantId, products);
    if (!cartItems.length) {
        showToast('Your cart is empty.', 'error');
        return;
    }

    const orderItems = [];
    for (const item of cartItems) {
        const product = products[item.productIndex];
        if (!product) continue;
        const stock = Math.max(0, Number(product.stock) || 0);
        if (item.quantity > stock) {
            showToast(`${product.name}: only ${stock} left in stock.`, 'error');
            return;
        }

        const unitPrice = Math.max(0, Number(product.price) || 0);
        const quantity = Math.max(1, Number(item.quantity) || 1);
        orderItems.push({
            productIndex: item.productIndex,
            name: product.name || 'Product',
            image: product.image || '',
            unitPrice,
            quantity,
            lineTotal: unitPrice * quantity
        });
    }

    if (orderItems.length === 0) {
        showToast('Your cart is empty.', 'error');
        return;
    }

    const totalItems = orderItems.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);

    if (!await showConfirm(`Confirm order for ${subtotal.toLocaleString()} IQD?`)) return;

    try {
        const merchantRef = doc(db, "merchants", merchantId);
        const orderRef = doc(collection(db, 'orders'));

        const transactionResult = await runTransaction(db, async (transaction) => {
            const merchantSnap = await transaction.get(merchantRef);
            if (!merchantSnap.exists()) {
                throw new Error('Store not found.');
            }

            const latestMerchant = merchantSnap.data();
            const latestProducts = Array.isArray(latestMerchant.products) ? [...latestMerchant.products] : [];
            const orderPayload = [];

            for (const item of cartItems) {
                const product = latestProducts[item.productIndex];
                if (!product) {
                    throw new Error('One of the selected products is no longer available.');
                }

                const stock = Math.max(0, Number(product.stock) || 0);
                const quantity = Math.max(1, Number(item.quantity) || 1);
                if (quantity > stock) {
                    throw new Error(`${product.name}: only ${stock} left in stock.`);
                }

                const unitPrice = Math.max(0, Number(product.price) || 0);
                latestProducts[item.productIndex] = {
                    ...product,
                    stock: Math.max(0, stock - quantity)
                };

                orderPayload.push({
                    name: product.name || 'Product',
                    image: product.image || '',
                    price: unitPrice,
                    quantity,
                    total: unitPrice * quantity
                });
            }

            const transactionTotalItems = orderPayload.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            const transactionSubtotal = orderPayload.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

            transaction.set(orderRef, {
                userId: currentUser.id || currentUser.phone,
                customerName: currentUser.name || 'Customer',
                customerPhone: currentUser.phone || '',
                storeId: merchant.id,
                merchantId: merchant.id,
                storeName: merchant.name,
                items: orderPayload,
                totalItems: transactionTotalItems,
                subtotal: transactionSubtotal,
                status: 'pending',
                createdAt: Timestamp.now()
            });
            transaction.update(merchantRef, { products: latestProducts });

            return {
                updatedProducts: latestProducts,
                totalItems: transactionTotalItems,
                subtotal: transactionSubtotal
            };
        });
        const updatedProducts = transactionResult.updatedProducts;

        const merchantIndex = allMerchants.findIndex(m => m.id === merchantId);
        if (merchantIndex >= 0) {
            allMerchants[merchantIndex] = { ...allMerchants[merchantIndex], products: updatedProducts };
        }

        venueProfileState.cartByMerchant[merchantId] = [];
        showToast('Order placed successfully!', 'success');
        renderVenueProfile(allMerchants.find(m => m.id === merchantId) || merchant, { preserveScroll: true, focusSection: 'shop' });
    } catch (error) {
        console.error('Checkout error:', error);
        showToast(error?.message || 'Failed to place order. Please try again.', 'error');
    }
};

function renderVenueProfile(merchant, options = {}) {
    currentVenueProfileMerchantId = merchant.id;
    const container = document.getElementById('venue-profile-content');
    if (!container) return;

    const rating = getStoreRating(merchant.id);
    const now = new Date();
    const activeTab = venueProfileState.activeTabByMerchant[merchant.id] || 'services';
    const merchantOffers = getActiveMerchantOffers(merchant.id, now);
    const storeReviews = allReviews.filter(r => r.storeId === merchant.id)
        .sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
            return dateB - dateA;
        });

    const services = merchant.services || [];
    const products = Array.isArray(merchant.products) ? merchant.products : [];
    const cartItems = syncVenueCartWithProducts(merchant.id, products);
    const cartTotals = calculateVenueCartTotals(cartItems, products);
    const images = getVenueGalleryImages(merchant);
    const teamMembers = getVenueTeamMembers(merchant);
    const teamCount = Math.max(teamMembers.length, Math.max(0, Number(merchant.workerCount) || 0));
    const canPreselectStaff = getBookableStaffOptions(merchant).length > 0;
    const aboutText = String(merchant.description || merchant.about || merchant.bio || '').trim();
    const aboutFallback = `${merchant.name} is available for online booking on Hewrina. Browse services, review the team, and use the location section for directions before you book.`;

    const merchantCoords = getMerchantCoordinates(merchant);
    const directionsUrl = merchantCoords
        ? `https://www.google.com/maps/search/?api=1&query=${merchantCoords.lat},${merchantCoords.lng}`
        : '#';

    const ratingHTML = rating.count > 0
        ? `<div class="venue-hero-rating">
                <span class="stars">${generateStarHTML(parseFloat(rating.avg))}</span>
                <span class="score">${rating.avg}</span>
                <span class="count">${rating.count.toLocaleString()} review${rating.count > 1 ? 's' : ''}</span>
           </div>`
        : `<div class="venue-hero-rating"><span class="count" style="color:#9ca3af;">New venue on Hewrina</span></div>`;

    let galleryHTML = '';
    if (images.length > 0) {
        const secondaryTiles = Array.from({ length: 4 }, (_, idx) => {
            const imageUrl = images[idx + 1];
            if (imageUrl) {
                return `
                    <div class="venue-gallery-tile">
                        <img src="${imageUrl}" alt="${merchant.name}" onerror="this.closest('.venue-gallery-tile').classList.add('is-hidden')">
                    </div>
                `;
            }

            const fallbackLabel = idx === 0
                ? (merchant.category || 'Venue')
                : idx === 1
                    ? (merchant.address || 'Profile details')
                    : idx === 2
                        ? `${services.length} service${services.length === 1 ? '' : 's'}`
                        : `${teamCount || 1} specialist${(teamCount || 1) === 1 ? '' : 's'}`;

            return `
                <div class="venue-gallery-tile venue-gallery-placeholder">
                    <span>${fallbackLabel}</span>
                </div>
            `;
        }).join('');

        galleryHTML = `
            <div id="${getVenueSectionId('photos')}" class="venue-gallery-mosaic ${images.length === 1 ? 'single-photo' : ''}">
                <div class="venue-gallery-tile venue-gallery-main">
                    <img src="${images[0]}" alt="${merchant.name}" onerror="this.closest('.venue-gallery-main').innerHTML='<div class=&quot;venue-gallery-placeholder main&quot;><span>${merchant.name}</span></div>'">
                    <div class="venue-gallery-caption">
                        <strong>${merchant.name}</strong>
                        <span>${merchant.category || 'Venue profile'}</span>
                    </div>
                </div>
                ${secondaryTiles}
                <div class="venue-gallery-count">${images.length} photo${images.length === 1 ? '' : 's'}</div>
            </div>
        `;
    } else {
        galleryHTML = `
            <div id="${getVenueSectionId('photos')}" class="venue-gallery-mosaic no-photos">
                <div class="venue-gallery-tile venue-gallery-main venue-gallery-placeholder main">
                    <div class="venue-gallery-caption">
                        <strong>${merchant.name}</strong>
                        <span>${merchant.category || 'Photo gallery coming soon'}</span>
                    </div>
                </div>
                <div class="venue-gallery-tile venue-gallery-placeholder"><span>${merchant.category || 'Venue'}</span></div>
                <div class="venue-gallery-tile venue-gallery-placeholder"><span>${merchant.address || 'Address coming soon'}</span></div>
                <div class="venue-gallery-tile venue-gallery-placeholder"><span>${services.length} services</span></div>
                <div class="venue-gallery-tile venue-gallery-placeholder"><span>${teamCount || 1} specialist${(teamCount || 1) === 1 ? '' : 's'}</span></div>
            </div>
        `;
    }

    let servicesHTML = '';
    if (services.length > 0) {
        const categorized = {};
        services.forEach(service => {
            const cat = service.category || 'Featured Services';
            if (!categorized[cat]) categorized[cat] = [];
            categorized[cat].push(service);
        });

        for (const [catName, catServices] of Object.entries(categorized)) {
            servicesHTML += `
                <div class="venue-service-group">
                    <div class="venue-service-group-head">
                        <div>
                            <h3 class="venue-service-category-title">${catName}</h3>
                            <p>${catServices.length} service${catServices.length === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    <div class="venue-service-list">
                        ${catServices.map(service => {
                            const basePrice = Number(service.price) || 0;
                            const serviceOffers = merchantOffers.filter(offer => offer.serviceName === service.name);
                            const allDayOffers = serviceOffers.filter(offer => !isOfferTimeRestricted(offer));
                            const timedOffers = serviceOffers.filter(offer => isOfferTimeRestricted(offer));

                            const bestAllDayOffer = allDayOffers.reduce((best, current) => {
                                const bestDiscount = Number(best?.discountPercent || 0);
                                const currentDiscount = Number(current?.discountPercent || 0);
                                return currentDiscount > bestDiscount ? current : best;
                            }, null);
                            const bestTimedOffer = timedOffers.reduce((best, current) => {
                                const bestDiscount = Number(best?.discountPercent || 0);
                                const currentDiscount = Number(current?.discountPercent || 0);
                                return currentDiscount > bestDiscount ? current : best;
                            }, null);

                            const hasAllDayOffer = !!bestAllDayOffer;
                            const discountedPrice = hasAllDayOffer
                                ? Math.round(basePrice * (1 - ((Number(bestAllDayOffer.discountPercent) || 0) / 100)))
                                : basePrice;
                            const priceDisplay = hasAllDayOffer
                                ? `<span class="price-original">${basePrice.toLocaleString()} IQD</span><span class="price">${discountedPrice.toLocaleString()} IQD</span>`
                                : `<span class="price">${basePrice.toLocaleString()} IQD</span>`;

                            const tagHTML = hasAllDayOffer
                                ? `<span class="venue-service-tag">-${bestAllDayOffer.discountPercent}%</span>`
                                : bestTimedOffer
                                    ? `<span class="venue-service-tag off-peak">-${bestTimedOffer.discountPercent}% Off-peak</span>`
                                    : '';

                            const offPeakHint = !hasAllDayOffer && bestTimedOffer
                                ? `<span class="service-detail off-peak">Valid ${formatOfferHours(bestTimedOffer)}</span>`
                                : '';

                            const serviceJson = encodeURIComponent(JSON.stringify({
                                name: service.name,
                                price: basePrice,
                                duration: service.duration
                            }));

                            return `
                                <div class="venue-service-card">
                                    <div class="venue-service-info">
                                        <h4>${service.name}</h4>
                                        <div class="venue-service-meta-line">
                                            <span class="service-detail">${service.duration} min</span>
                                            ${tagHTML}
                                        </div>
                                        ${offPeakHint}
                                    </div>
                                    <div class="venue-service-price">
                                        ${priceDisplay}
                                        <button class="btn-book-service" onclick="event.stopPropagation(); openBookingFromProfile('${merchant.id}', '${serviceJson}')">Book</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
    } else {
        servicesHTML = '<div class="venue-no-reviews">No services listed yet.</div>';
    }

    const productCardsHTML = products.length > 0
        ? products.map((product, index) => {
            const price = Math.max(0, Number(product.price) || 0);
            const stock = Math.max(0, Number(product.stock) || 0);
            const outOfStock = stock <= 0;
            const image = product.image || '';
            const cartItem = cartItems.find(item => item.productIndex === index);
            const inCartQty = cartItem ? cartItem.quantity : 0;

            return `
                <div class="shop-product-card ${outOfStock ? 'out-of-stock' : ''}">
                    <div class="shop-product-image-wrap">
                        ${image
                            ? `<img class="shop-product-image" src="${image}" alt="${product.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
                            : ''
                        }
                        <div class="shop-product-fallback" style="${image ? 'display:none;' : 'display:flex;'}">Product</div>
                    </div>
                    <div class="shop-product-body">
                        <h4>${product.name || 'Product'}</h4>
                        <p class="shop-product-price">${price.toLocaleString()} IQD</p>
                        <div class="shop-product-stock ${outOfStock ? 'empty' : ''}">
                            ${outOfStock ? 'Out of stock' : `${stock} in stock`}
                        </div>
                        <button class="btn-book-service shop-add-btn" ${outOfStock ? 'disabled' : ''} onclick="addProductToCart('${merchant.id}', ${index})">
                            ${outOfStock ? 'Unavailable' : inCartQty > 0 ? `Add More (${inCartQty} in cart)` : 'Add to Cart'}
                        </button>
                    </div>
                </div>
            `;
        }).join('')
        : '<div class="venue-no-reviews">No products available in this shop yet.</div>';

    const cartListHTML = cartItems.length > 0
        ? cartItems.map(item => {
            const product = products[item.productIndex];
            if (!product) return '';
            const unitPrice = Math.max(0, Number(product.price) || 0);
            const lineTotal = unitPrice * item.quantity;
            const stock = Math.max(0, Number(product.stock) || 0);

            return `
                <div class="shop-cart-item">
                    <div class="shop-cart-item-main">
                        <div class="shop-cart-item-name">${product.name}</div>
                        <div class="shop-cart-item-meta">${unitPrice.toLocaleString()} IQD each • ${stock} left</div>
                    </div>
                    <div class="shop-cart-item-actions">
                        <button class="shop-qty-btn" onclick="changeShopCartQuantity('${merchant.id}', ${item.productIndex}, -1)">−</button>
                        <span class="shop-qty-value">${item.quantity}</span>
                        <button class="shop-qty-btn" onclick="changeShopCartQuantity('${merchant.id}', ${item.productIndex}, 1)" ${item.quantity >= stock ? 'disabled' : ''}>+</button>
                        <button class="shop-remove-btn" onclick="removeFromShopCart('${merchant.id}', ${item.productIndex})">Remove</button>
                    </div>
                    <div class="shop-cart-item-total">${lineTotal.toLocaleString()} IQD</div>
                </div>
            `;
        }).join('')
        : '<div class="shop-cart-empty">Your cart is empty.</div>';

    let reviewsHTML = '';
    if (storeReviews.length > 0) {
        reviewsHTML = storeReviews.slice(0, 6).map(review => {
            const date = review.createdAt?.toDate ? review.createdAt.toDate() : new Date(review.createdAt);
            const reviewerName = review.customerName || 'Anonymous';
            return `
                <div class="venue-review-card">
                    <div class="review-card-header">
                        <div class="venue-reviewer">
                            <span class="venue-reviewer-avatar">${getVenueInitials(reviewerName)}</span>
                            <span class="reviewer-name">${reviewerName}</span>
                        </div>
                        <span class="review-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                    <div class="review-stars">${generateStarHTML(review.rating)}</div>
                    ${review.comment ? `<p class="review-text">${review.comment}</p>` : ''}
                </div>
            `;
        }).join('');
    } else {
        reviewsHTML = '<div class="venue-no-reviews">No reviews yet. Be the first to rate this venue!</div>';
    }

    const reviewIntro = rating.count > 0
        ? `<div class="venue-review-summary-card">
                <div class="venue-review-score">${rating.avg}</div>
                <div>
                    <div class="review-stars">${generateStarHTML(parseFloat(rating.avg))}</div>
                    <p>Based on ${rating.count.toLocaleString()} review${rating.count > 1 ? 's' : ''}</p>
                </div>
           </div>`
        : `<div class="venue-review-summary-card empty"><p>No ratings yet. The first completed visits will appear here.</p></div>`;

    const teamHTML = teamMembers.length > 0 ? `
        <div id="${getVenueSectionId('team')}" class="venue-section venue-surface-card">
            <div class="venue-section-heading">
                <div>
                    <span class="venue-section-kicker">Team</span>
                    <h2>Choose your specialist</h2>
                </div>
                <button class="venue-inline-link" onclick="openBookingFromProfile('${merchant.id}')">Book any available</button>
            </div>
            <div class="venue-team-grid">
                ${teamMembers.map(member => {
                    const avatar = member.image
                        ? `<img src="${member.image}" alt="${member.name}" onerror="this.closest('.venue-team-avatar').innerHTML='<span>${getVenueInitials(member.name)}</span>'">`
                        : `<span>${getVenueInitials(member.name)}</span>`;
                    const cta = canPreselectStaff && member.id !== 'solo-worker'
                        ? `openBookingForStaff('${merchant.id}', '${member.id}')`
                        : `openBookingFromProfile('${merchant.id}')`;
                    return `
                        <div class="venue-team-card">
                            <div class="venue-team-avatar">${avatar}</div>
                            <div class="venue-team-content">
                                <h3>${member.name}</h3>
                                <p>${member.role || 'Team Member'}</p>
                            </div>
                            <button class="btn-outline" onclick="${cta}">Book with ${member.name.split(' ')[0]}</button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';

    const aboutFacts = [
        merchant.category || null,
        services.length ? `${services.length} bookable service${services.length === 1 ? '' : 's'}` : null,
        teamCount ? `${teamCount} specialist${teamCount === 1 ? '' : 's'}` : null,
        products.length ? `${products.length} retail product${products.length === 1 ? '' : 's'}` : null,
        merchantCoords ? 'Interactive map and directions' : null,
        merchant.cancellationPolicy ? 'Cancellation policy shown before confirmation' : null
    ].filter(Boolean);

    const locationSectionHTML = merchantCoords ? `
        <div id="${getVenueSectionId('location')}" class="venue-section venue-surface-card venue-location-section">
            <div class="venue-section-heading">
                <div>
                    <span class="venue-section-kicker">Location</span>
                    <h2>Visit the store</h2>
                </div>
            </div>
            <div class="venue-location-grid">
                <div class="venue-location-copy">
                    <div class="venue-location-address">${merchant.address || 'Address not provided yet.'}</div>
                    <div class="venue-location-coords">Lat ${merchantCoords.lat.toFixed(6)} • Lng ${merchantCoords.lng.toFixed(6)}</div>
                    <div class="venue-location-actions">
                        <button class="btn-primary" onclick="showOnMap('${merchant.id}')">Open Interactive Map</button>
                        <a class="btn-outline" href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Directions</a>
                    </div>
                </div>
                <div id="venue-profile-mini-map" class="venue-profile-mini-map"></div>
            </div>
        </div>
    ` : `
        <div id="${getVenueSectionId('location')}" class="venue-section venue-surface-card venue-location-section">
            <div class="venue-section-heading">
                <div>
                    <span class="venue-section-kicker">Location</span>
                    <h2>Visit the store</h2>
                </div>
            </div>
            <div class="venue-mini-map-fallback">This store has not added a map location yet.</div>
        </div>
    `;

    const sectionButtons = [
        { key: 'services', label: `Services (${services.length})` },
        ...(teamMembers.length > 0 ? [{ key: 'team', label: `Team (${teamMembers.length})` }] : []),
        ...(products.length > 0 ? [{ key: 'shop', label: `Shop (${products.length})` }] : []),
        { key: 'reviews', label: `Reviews (${storeReviews.length})` },
        { key: 'about', label: 'About' },
        { key: 'location', label: 'Location' }
    ];

    container.innerHTML = `
        <button class="venue-back-btn" onclick="closeVenueProfile()">← Back to all venues</button>

        <div class="venue-profile-shell">
            ${galleryHTML}

            <div class="venue-summary-card">
                <div class="venue-summary-main">
                    <div class="venue-summary-chips">
                        <span class="venue-summary-chip primary">${merchant.category || 'Venue'}</span>
                        ${merchant.distance ? `<span class="venue-summary-chip">${merchant.distance}</span>` : ''}
                        ${services.length ? `<span class="venue-summary-chip">${services.length} service${services.length === 1 ? '' : 's'}</span>` : ''}
                        ${teamCount ? `<span class="venue-summary-chip">${teamCount} specialist${teamCount === 1 ? '' : 's'}</span>` : ''}
                    </div>
                    <h1>${merchant.name}</h1>
                    ${ratingHTML}
                    <div class="venue-meta-row">
                        ${merchant.address ? `<span>📍 ${merchant.address}</span>` : ''}
                        ${merchantCoords ? `<span class="btn-map-link" onclick="showOnMap('${merchant.id}')">View on Map</span>` : ''}
                    </div>
                    <p class="venue-summary-copy">${aboutText || aboutFallback}</p>
                </div>

                <div class="venue-summary-side">
                    <div class="venue-booking-card">
                        <div class="venue-booking-card-head">
                            <span>Book online</span>
                            <strong>${merchant.name}</strong>
                        </div>
                        <div class="venue-booking-stats">
                            <div><strong>${services.length || 0}</strong><span>Services</span></div>
                            <div><strong>${teamCount || 1}</strong><span>${(teamCount || 1) === 1 ? 'Specialist' : 'Specialists'}</span></div>
                            <div><strong>${rating.count > 0 ? rating.avg : 'New'}</strong><span>Rating</span></div>
                        </div>
                        <button class="btn-primary full-width" onclick="openBookingFromProfile('${merchant.id}')">Book now</button>
                        ${merchantCoords ? `<a class="btn-outline full-width venue-directions-btn" href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Get directions</a>` : ''}
                        ${merchant.cancellationPolicy ? `<p class="venue-booking-note">${merchant.cancellationPolicy}</p>` : `<p class="venue-booking-note">Choose a service, pick a worker when available, and confirm your appointment in a few steps.</p>`}
                    </div>
                </div>
            </div>

            <div class="venue-profile-tabs">
                ${sectionButtons.map(section => `
                    <button class="venue-profile-tab ${activeTab === section.key ? 'active' : ''}" onclick="switchVenueTab('${section.key}')">${section.label}</button>
                `).join('')}
            </div>

            <div id="${getVenueSectionId('services')}" class="venue-section venue-surface-card">
                <div class="venue-section-heading">
                    <div>
                        <span class="venue-section-kicker">Services</span>
                        <h2>Book a treatment</h2>
                    </div>
                </div>
                ${servicesHTML}
            </div>

            ${teamHTML}

            ${products.length > 0 ? `
                <div id="${getVenueSectionId('shop')}" class="venue-section venue-surface-card">
                    <div class="venue-section-heading">
                        <div>
                            <span class="venue-section-kicker">Shop</span>
                            <h2>Retail products</h2>
                        </div>
                    </div>
                    <div class="venue-shop-layout">
                        <div class="venue-shop-grid">
                            ${productCardsHTML}
                        </div>
                        <div class="venue-shop-cart">
                            <h3>Cart (${cartTotals.totalItems})</h3>
                            <div class="shop-cart-list">${cartListHTML}</div>
                            <div class="shop-cart-summary">
                                <div><span>Subtotal</span><strong>${cartTotals.subtotal.toLocaleString()} IQD</strong></div>
                            </div>
                            <button class="btn-primary full-width" onclick="checkoutShopCart('${merchant.id}')" ${cartItems.length === 0 ? 'disabled' : ''}>
                                Checkout
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}

            <div id="${getVenueSectionId('reviews')}" class="venue-section venue-surface-card">
                <div class="venue-section-heading">
                    <div>
                        <span class="venue-section-kicker">Reviews</span>
                        <h2>What customers say</h2>
                    </div>
                </div>
                ${reviewIntro}
                <div class="venue-reviews-list">
                    ${reviewsHTML}
                </div>
            </div>

            <div id="${getVenueSectionId('about')}" class="venue-section venue-surface-card">
                <div class="venue-section-heading">
                    <div>
                        <span class="venue-section-kicker">About</span>
                        <h2>Venue details</h2>
                    </div>
                </div>
                <div class="venue-about-grid">
                    <div class="venue-about-copy">
                        <p>${aboutText || aboutFallback}</p>
                    </div>
                    <div class="venue-about-facts">
                        ${aboutFacts.map(item => `<span class="venue-about-pill">${item}</span>`).join('')}
                    </div>
                </div>
            </div>

            ${locationSectionHTML}
        </div>
    `;

    document.getElementById('dashboard-customer').style.display = 'none';
    document.getElementById('venue-profile-view').style.display = 'block';
    renderVenueProfileMiniMap(merchant);

    if (options.focusSection) {
        requestAnimationFrame(() => scrollVenueProfileSection(options.focusSection));
    } else if (!options.preserveScroll) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

window.closeVenueProfile = function() {
    currentVenueProfileMerchantId = null;
    venueProfileMap = null;
    venueProfileMapMarker = null;
    document.getElementById('venue-profile-view').style.display = 'none';
    document.getElementById('dashboard-customer').style.display = 'block';
};

window.openBookingFromProfile = function(merchantId, preselectedServiceJson = null) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    if (!merchant) return;

    let initialServices = [];
    if (preselectedServiceJson) {
        try {
            const preselectedService = JSON.parse(decodeURIComponent(preselectedServiceJson));
            const basePrice = Number(preselectedService.price) || 0;
            initialServices.push({
                name: preselectedService.name,
                price: basePrice,
                basePrice: basePrice,
                duration: preselectedService.duration
            });
        } catch(e) {
            console.error("Failed to parse preselected service:", e);
        }
    }

    // Reset State
    bookedSlotsCache = {};
    bookingState = {
        merchant: merchant,
        services: initialServices,
        selectedStaff: null,
        date: null,
        time: null,
        step: 1,
        bookedSlots: null,
        policyAgreed: false,
        autoAssignSeed: null
    };

    renderBookingWizard();
    document.getElementById('booking-modal').style.display = 'flex';
};

window.openBookingForStaff = function(merchantId, staffId) {
    const merchant = allMerchants.find(m => m.id === merchantId);
    if (!merchant) return;

    openBookingFromProfile(merchantId);
    const selectedStaff = getBookableStaffOptions(merchant).find(member => member.id === staffId);
    if (!selectedStaff) return;

    bookingState.selectedStaff = selectedStaff;
    renderBookingWizard();
};

// ========== CONTACT FORM ==========
window.handleContactSubmit = async function() {
    const nameEle = document.getElementById('contact-name');
    const emailEle = document.getElementById('contact-email');
    const subjectEle = document.getElementById('contact-subject');
    const messageEle = document.getElementById('contact-message');

    if (!nameEle || !emailEle || !subjectEle || !messageEle) return;

    const name = nameEle.value.trim();
    const email = emailEle.value.trim();
    const subject = subjectEle.value.trim();
    const message = messageEle.value.trim();

    if (!name || !email || !subject || !message) {
        showToast('Please fill out all fields', 'error');
        return;
    }

    try {
        await addDoc(collection(db, "messages"), {
            name,
            email,
            subject,
            message,
            createdAt: Timestamp.now()
        });
        showToast('Message sent successfully! We will get back to you soon.', 'success');
        document.getElementById('contact-form').reset();
    } catch (e) {
        console.error("Error sending message: ", e);
        showToast('Failed to send message. Please try again.', 'error');
    }
};

// ========== CUSTOMER DASHBOARD (My Appointments) ==========
window.openMyAppointments = async function() {
    if (!currentUser || currentUser.role !== 'customer') return;

    // Hide everything else
    document.getElementById('dashboard-customer').style.display = 'none';
    const venueProfileView = document.getElementById('venue-profile-view');
    if(venueProfileView) venueProfileView.style.display = 'none';
    
    document.getElementById('customer-appointments-view').style.display = 'block';

    const upcomingList = document.getElementById('appointments-list-upcoming');
    const pastList = document.getElementById('appointments-list-past');

    upcomingList.innerHTML = '<div class="loading-spinner">Loading...</div>';
    pastList.innerHTML = '<div class="loading-spinner">Loading...</div>';

    try {
        // Query by userId (which is how submitBooking saves it)
        const userId = currentUser.id || currentUser.phone;
        const q = query(collection(db, "bookings"), where("userId", "==", userId));
        const snapshot = await getDocs(q);

        const now = new Date();
        let upcoming = [];
        let past = [];

        snapshot.forEach(docSnap => {
            const b = { id: docSnap.id, ...docSnap.data() };
            // Parse appointment date from bookingDate (Timestamp or Date) or fall back to date string
            let appointmentDate;
            try {
                if (b.bookingDate?.toDate) {
                    appointmentDate = b.bookingDate.toDate();
                } else if (b.bookingDate) {
                    appointmentDate = new Date(b.bookingDate);
                } else if (b.date && b.time) {
                    appointmentDate = new Date(`${b.date}T${b.time}`);
                } else {
                    appointmentDate = new Date(0); // fallback to epoch
                }
            } catch(e) {
                appointmentDate = new Date(0);
            }
            
            if (appointmentDate > now && b.status !== 'cancelled') {
                upcoming.push(b);
            } else {
                past.push(b);
            }
        });

        // Render upcoming
        if (upcoming.length > 0) {
            upcoming.sort((a,b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
            upcomingList.innerHTML = upcoming.map(b => generateAppointmentCard(b, true)).join('');
        } else {
            upcomingList.innerHTML = '<p style="color:#666;">No upcoming appointments.</p>';
        }

        // Render past
        if (past.length > 0) {
            past.sort((a,b) => new Date(`${b.date}T${b.time}`) - new Date(`${a.date}T${a.time}`));
            pastList.innerHTML = past.map(b => generateAppointmentCard(b, false)).join('');
        } else {
            pastList.innerHTML = '<p style="color:#666;">No past appointments.</p>';
        }

    } catch (e) {
        console.error("Error loading customer bookings: ", e);
        upcomingList.innerHTML = '<p>Failed to load bookings.</p>';
        pastList.innerHTML = '<p>Failed to load bookings.</p>';
    }
};

window.closeMyAppointments = function() {
    document.getElementById('customer-appointments-view').style.display = 'none';
    document.getElementById('dashboard-customer').style.display = 'block';
};

window.switchAppointmentTab = function(tab) {
    document.getElementById('tab-upcoming').classList.remove('active');
    document.getElementById('tab-past').classList.remove('active');
    document.getElementById('appointments-list-upcoming').style.display = 'none';
    document.getElementById('appointments-list-past').style.display = 'none';

    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`appointments-list-${tab}`).style.display = 'flex';
};

function generateAppointmentCard(b, isUpcoming) {
    const statusClass = b.status === 'cancelled' ? 'status-cancelled' : (isUpcoming ? 'status-upcoming' : 'status-past');
    const statusText = b.status === 'cancelled' ? 'Cancelled' : (isUpcoming ? 'Upcoming' : 'Completed');
    
    // Resolve store name
    const storeNameDisplay = b.storeName || (allMerchants.find(m => m.id === b.storeId)?.name) || 'Hewrina Venue';

    // Parse date - could be bookingDate (Timestamp), date (string), or bookingTime
    let dateDisplay = 'Date unavailable';
    let timeDisplay = b.bookingTime || b.time || '';
    try {
        const d = b.bookingDate?.toDate ? b.bookingDate.toDate() : (b.bookingDate ? new Date(b.bookingDate) : (b.date ? new Date(b.date) : null));
        if (d && !isNaN(d.getTime())) {
            dateDisplay = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            if (!timeDisplay) {
                timeDisplay = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            }
        }
    } catch(e) {}

    const staffLine = b.staffMember && b.staffMember.name && b.staffMember.name !== 'Anyone available' 
        ? `<p><strong>Staff:</strong> ${b.staffMember.name}</p>` : '';

    return `
        <div class="appointment-card">
            <div class="appointment-info">
                <h3>${storeNameDisplay}</h3>
                <p><strong>Date:</strong> ${dateDisplay} at ${timeDisplay}</p>
                <p><strong>Services:</strong> ${b.services ? b.services.map(s => s.name).join(', ') : (b.serviceName || 'Details unavailable')}</p>
                ${staffLine}
                <p><strong>Total:</strong> ${(b.price || b.servicePrice || b.totalPrice) ? (b.price || b.servicePrice || b.totalPrice).toLocaleString() + ' IQD' : 'N/A'}</p>
            </div>
            <div class="appointment-meta">
                <span class="appointment-status ${statusClass}">${statusText}</span>
                ${!isUpcoming && b.status !== 'cancelled' ? `<button class="btn-outline" style="padding: 6px 12px; font-size: 0.85rem;" onclick="closeMyAppointments(); setTimeout(() => openMerchantDetails('${b.storeId}'), 100)">Rebook</button>` : ''}
            </div>
        </div>
    `;
}
