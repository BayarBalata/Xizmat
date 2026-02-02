const providers = [
    // Doctors
    {
        id: 1,
        name: "Dr. Sarah Johnson",
        type: "medical",
        category: "Cardiologist",
        experience: "12 years experience",
        availability: "Mon - Fri, 9am - 5pm",
        distance: "2.4 km",
        address: "123 Medical Blvd, Erbil",
        services: ["Consultation", "Heart Checkup", "ECG", "Blood Pressure Monitoring"],
        image: "👩‍⚕️"
    },
    {
        id: 2,
        name: "Dr. Michael Chen",
        type: "medical",
        category: "Dermatologist",
        experience: "8 years experience",
        availability: "Tue - Sat, 10am - 6pm",
        distance: "5.1 km",
        address: "45 Skin Care Ave, Erbil",
        services: ["Acne Treatment", "Laser Therapy", "Skin Screening"],
        image: "👨‍⚕️"
    },
    {
        id: 3,
        name: "Dr. Emily Davis",
        type: "medical",
        category: "Pediatrician",
        experience: "15 years experience",
        availability: "Mon - Thu, 8am - 4pm",
        distance: "1.2 km",
        address: "88 Kids Health Way, Duhok",
        services: ["Child Vaccination", "General Checkup", "Growth Monitoring"],
        image: "👩‍⚕️"
    },
    // Beauty
    {
        id: 4,
        name: "Glow Beauty Salon",
        type: "beauty",
        category: "Hair & Makeup",
        experience: "Top Rated Salon",
        availability: "Daily, 10am - 8pm",
        distance: "0.8 km",
        address: "Dream City, Erbil",
        services: ["Bridal Makeup", "Hair Coloring", "Manicure & Pedicure", "Facials"],
        image: "💇‍♀️"
    },
    {
        id: 5,
        name: "Zen Spa & Wellness",
        type: "beauty",
        category: "Spa Center",
        experience: "Premium Relaxation",
        availability: "Daily, 9am - 9pm",
        distance: "3.5 km",
        address: "Royal Towers, Erbil",
        services: ["Full Body Massage", "Sauna", "Skin Rejuvenation", "Aromatherapy"],
        image: "🧖‍♀️"
    }
];

// Elements
const doctorsList = document.getElementById('doctors-list');
const filterBtns = document.querySelectorAll('.filter-btn');
const specialtySelect = document.getElementById('specialty-filter');
const distanceInput = document.getElementById('distance-filter');
const distanceValSpan = document.getElementById('distance-val');

// State
let currentType = 'all';
let currentSpecialty = 'all';
let maxDistance = 10;

// Initialize
function init() {
    setupFilters();
    updateSpecialtyOptions();
    renderProviders();
}

// Setup Event Listeners
function setupFilters() {
    // Type Buttons
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.filter;
            currentSpecialty = 'all'; // Reset specialty on type change
            updateSpecialtyOptions();
            renderProviders();
        });
    });

    // Specialty Select
    specialtySelect.addEventListener('change', (e) => {
        currentSpecialty = e.target.value;
        renderProviders();
    });

    // Distance Slider
    distanceInput.addEventListener('input', (e) => {
        maxDistance = parseFloat(e.target.value);
        distanceValSpan.textContent = maxDistance;
        renderProviders();
    });
}

// Populate Specialty Dropdown dynamically
function updateSpecialtyOptions() {
    const relevantProviders = currentType === 'all' 
        ? providers 
        : providers.filter(p => p.type === currentType);
    
    const uniqueCategories = [...new Set(relevantProviders.map(p => p.category))].sort();

    specialtySelect.innerHTML = '<option value="all">All Specialties</option>' + 
        uniqueCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
}

// Parse distance string to float
function getDistance(distStr) {
    return parseFloat(distStr.split(' ')[0]);
}

// Render Grid
function renderProviders() {
    // Filter Logic
    const filtered = providers.filter(provider => {
        const typeMatch = currentType === 'all' || provider.type === currentType;
        const specialtyMatch = currentSpecialty === 'all' || provider.category === currentSpecialty;
        const distanceMatch = getDistance(provider.distance) <= maxDistance;

        return typeMatch && specialtyMatch && distanceMatch;
    });

    // Render HTML
    if (filtered.length === 0) {
        doctorsList.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #6b7280;">No professionals found matching your criteria.</div>';
        return;
    }

    doctorsList.innerHTML = filtered.map(provider => `
        <div class="doctor-card">
            <div class="doctor-img">${provider.image}</div>
            <div class="doctor-info">
                <div>
                    <span class="category-tag tag-${provider.type}">${provider.category}</span>
                    <h3>${provider.name}</h3>
                    <div class="distance-badge">📍 ${provider.distance} away</div>
                    <p>🎓 ${provider.experience}</p>
                </div>
                <button class="btn-primary full-width" style="margin-top: auto;" onclick="openDetails(${provider.id})">View Services & Book</button>
            </div>
        </div>
    `).join('');
}

// --- Modal Logic (Same as before) ---
const modal = document.getElementById('booking-modal');
const modalBody = document.getElementById('modal-body');
const closeBtn = document.querySelector('.close');

function openDetails(id) {
    const provider = providers.find(p => p.id === id);
    if (!provider) return;

    modalBody.innerHTML = `
        <div class="modal-header">
            <div class="modal-img">${provider.image}</div>
            <div>
                <h2>${provider.name}</h2>
                <span class="category-tag tag-${provider.type}">${provider.category}</span>
                <p>📍 ${provider.distance} • ${provider.availability}</p>
            </div>
        </div>

        <h3 class="section-title">Services Offered</h3>
        <ul class="services-list">
            ${provider.services.map(s => `<li class="service-item">${s}</li>`).join('')}
        </ul>

        <div class="location-box">
            <h4>📍 Location</h4>
            <p>${provider.address}</p>
            <div class="map-placeholder">
                (Map View: ${provider.distance})
            </div>
        </div>

        <h3 class="section-title">Book Appointment</h3>
        <form id="booking-form" onsubmit="handleBooking(event, '${provider.name}')">
            <div class="form-group">
                <label>Your Name</label>
                <input type="text" required placeholder="John Doe">
            </div>
            <div class="form-group">
                <label>Date & Time</label>
                <div style="display: flex; gap: 10px;">
                    <input type="date" required>
                    <select required>
                        <option>09:00 AM</option>
                        <option>11:00 AM</option>
                        <option>02:00 PM</option>
                        <option>04:00 PM</option>
                    </select>
                </div>
            </div>
            <button type="submit" class="btn-primary full-width">Confirm Booking</button>
        </form>
    `;
    modal.style.display = 'flex';
}

window.handleBooking = function(e, providerName) {
    e.preventDefault();
    alert(`Booking Confirmed for ${providerName}!\nWe will send you a confirmation message.`);
    modal.style.display = 'none';
}

closeBtn.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; }

// Start
init();
