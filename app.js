const doctors = [
    {
        id: 1,
        name: "Dr. Sarah Johnson",
        specialty: "Cardiologist",
        experience: "12 years experience",
        availability: "Mon - Fri, 9am - 5pm",
        image: "👩‍⚕️"
    },
    {
        id: 2,
        name: "Dr. Michael Chen",
        specialty: "Dermatologist",
        experience: "8 years experience",
        availability: "Tue - Sat, 10am - 6pm",
        image: "👨‍⚕️"
    },
    {
        id: 3,
        name: "Dr. Emily Davis",
        specialty: "Pediatrician",
        experience: "15 years experience",
        availability: "Mon - Thu, 8am - 4pm",
        image: "👩‍⚕️"
    }
];

// Load Doctors
const doctorsList = document.getElementById('doctors-list');

function renderDoctors() {
    doctorsList.innerHTML = doctors.map(doctor => `
        <div class="doctor-card">
            <div class="doctor-img">${doctor.image}</div>
            <div class="doctor-info">
                <h3>${doctor.name}</h3>
                <span class="specialty">${doctor.specialty}</span>
                <p>🎓 ${doctor.experience}</p>
                <p>🕒 ${doctor.availability}</p>
                <button class="btn-primary full-width" onclick="openModal('${doctor.name}')">Book Appointment</button>
            </div>
        </div>
    `).join('');
}

// Modal Logic
const modal = document.getElementById('booking-modal');
const closeBtn = document.querySelector('.close');
const doctorNameSpan = document.getElementById('booking-doctor-name');
const bookingForm = document.getElementById('booking-form');

function openModal(doctorName) {
    modal.style.display = 'flex';
    doctorNameSpan.textContent = `Booking with ${doctorName}`;
}

closeBtn.onclick = function() {
    modal.style.display = 'none';
}

window.onclick = function(event) {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

// Handle Form Submit
bookingForm.onsubmit = function(e) {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const date = document.getElementById('date').value;
    const time = document.getElementById('time').value;

    alert(`Appointment Confirmed!\n\nPatient: ${name}\nDate: ${date}\nTime: ${time}\n\nWe will send you a confirmation email shortly.`);
    modal.style.display = 'none';
    bookingForm.reset();
}

// Initialize
renderDoctors();
