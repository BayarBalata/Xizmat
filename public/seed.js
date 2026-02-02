import { db } from "./firebase-config.js";
import { collection, addDoc, writeBatch, doc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const categories = [
    { type: 'salon', category: 'Hair Salon', services: ['Haircut', 'Coloring', 'Blowdry', 'Styling', 'Keratin Treatment'] },
    { type: 'salon', category: 'Nail Salon', services: ['Manicure', 'Pedicure', 'Nail Art', 'Gel Polish', 'Acrylics'] },
    { type: 'beauty_center', category: 'Aesthetics', services: ['Facial', 'Laser Hair Removal', 'Microdermabrasion', 'Lash Lift', 'Brow Tinting'] },
    { type: 'beauty_center', category: 'Spa & Wellness', services: ['Massage', 'Sauna', 'Body Scrub', 'Aromatherapy', 'Hot Stone Massage'] },
    { type: 'salon', category: 'Barber Shop', services: ['Haircut', 'Beard Trim', 'Shave', 'Face Massage'] },
    { type: 'beauty_center', category: 'Makeup Studio', services: ['Bridal Makeup', 'Evening Makeup', 'Party Makeup', 'Hairstyling'] }
];

const locations = [
    "Dream City, Erbil", "Royal Towers, Erbil", "Empire World, Erbil", "Ankawa, Erbil", "English Village, Erbil",
    "Italian Village, Erbil", "Gulan Street, Erbil", "Massif Road, Erbil", "Duhok Center", "Sulaymaniyah Center"
];

const merchantNames = [
    "Glow", "Radiance", "Zen", "Elite", "Prime", "Luxe", "Opulence", "Divine", "Serenity", "Bliss",
    "Aura", "Harmony", "Pure", "Velvet", "Crystal", "Diamond", "Sapphire", "Ruby", "Emerald", "Gold",
    "Silver", "Platinum", "Urban", "Chic", "Vogue", "Style", "Trend", "Modish", "Classy", "Elegant",
    "Grace", "Charm", "Allure", "Beauty", "Glamour", "Dazzle", "Sparkle", "Shine", "Bloom", "Flourish"
];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Clear existing merchants before seeding to avoid duplicates/mixing types
async function clearDatabase() {
    console.log("Clearing existing merchants...");
    const q = query(collection(db, "merchants")); // Get all
    // Since query() needs constraints, we can just use collection ref to get all.
    // However, in client SDK getting all docs and deleting is slow but okay for dev.
    // Better: just fetch and delete in batch.
    
    const snapshot = await getDocs(collection(db, "merchants"));
    const batch = writeBatch(db);
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    console.log("Database cleared.");
}

export async function seedDatabase() {
    if(confirm("This will clear existing merchants and re-seed 40 new ones. Continue?")) {
        try {
            // Optional: Clear DB first (commented out to be safe, but useful for dev)
            // await clearDatabase(); 
            
            console.log("Starting data seeding...");
            const batch = writeBatch(db);
            let count = 0;

            for (let i = 0; i < 40; i++) {
                const cat = getRandomItem(categories);
                const name = `${getRandomItem(merchantNames)} ${cat.category.split(' ').pop()}`;
                const merchantRef = doc(collection(db, "merchants"));
                
                const merchantData = {
                    name: name,
                    type: cat.type,
                    category: cat.category,
                    address: getRandomItem(locations),
                    rating: (Math.random() * 2 + 3).toFixed(1), // 3.0 to 5.0
                    description: `Experience the best ${cat.category.toLowerCase()} services in town.`,
                    // Image logic: Salon = 💇‍♀️, Beauty Center = 🧖‍♀️ (No doctors)
                    image: cat.type === 'salon' ? '💇‍♀️' : '🧖‍♀️',
                    distance: `${getRandomInt(1, 15)} km`
                };

                batch.set(merchantRef, merchantData);

                // Add Services
                const numServices = getRandomInt(3, 6);
                const selectedServices = [];
                while (selectedServices.length < numServices) {
                    const s = getRandomItem(cat.services);
                    if (!selectedServices.includes(s)) selectedServices.push(s);
                }

                merchantData.services = selectedServices.map(s => ({
                    name: s,
                    price: getRandomInt(20, 150),
                    duration: getRandomInt(30, 90)
                }));
                
                batch.set(merchantRef, merchantData);
                count++;
            }

            await batch.commit();
            console.log(`Successfully seeded ${count} merchants.`);
            alert("Database seeded successfully! (Old data may still exist if not manually cleared, but new beauty data added)");
        } catch (e) {
            console.error("Error seeding database: ", e);
            alert("Error seeding database. Check console.");
        }
    }
}
