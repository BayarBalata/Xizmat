# Hewrina Platform - AI Handoff Document

This document is designed to give a new AI agent complete context on the "Hewrina" project (located in `VS_apps/DocBook`), its current state, and the remaining tasks.

## Project Overview
Hewrina is a premium, Fresha-inspired booking and discovery platform for beauty and wellness venues. 
- **Tech Stack:** Vanilla HTML5, CSS3, JavaScript (no framework frontend)
- **Backend:** Firebase (Firestore, Authentication, Storage)
- **Design Aesthetic:** Minimalist, premium "Fresha-style" UI. Grayscale base (`--primary: #101820`, `--surface: #fafaf9`) with a warm gold accent (`--accent: #C19A6B`).

## Architecture & Codebase Structure
- `index.html`: The main single-page application (SPA) shell containing the landing page, search/discovery layout, customer dashboard, and owner dashboard. (Note: `about.html` and `contact.html` are separate static pages).
- `app.js`: The monolithic JavaScript file handling all frontend logic, DOM manipulation, state management (`bookingState`), and Firebase interactions.
- `style.css`: Contains all styling, including CSS variables for the theming, responsive media queries, and component styles.
- `firebase-config.js`: Firebase initialization. 

## Completed Phases (1-4)
1. **Core Infrastructure & Auth:** Authentication roles (Customer vs. Owner). Owner dashboard to manage store details, services, employees/staff, and view bookings.
2. **Search & Venue Profiles:** Filtering venues by category, viewing venue profiles natively inline.
3. **Enhanced Booking Flow & Dashboards:** 
   - 4-step Booking Wizard (`renderBookingWizard` in `app.js`): Services → Staff Selection → Date/Time → Confirm.
   - Dedicated Customer Dashboard showing Upcoming vs. Past appointments.
4. **Discovery & Visuals (Fresha Polish):** 
   - Split-screen map discovery layout (list on the left, sticky Google map on the right).
   - Fully audited UI to match the premium Fresha aesthetic (updated CSS variables, softer shadows, increased padding, consistent border radii).
   - Fully responsive for mobile devices.

## What Needs to Be Edited Next (Phase 5)

The immediate next step is to implement **Phase 5: Advanced Revenue Tools**.

### Task 5: Smart Deals & Off-Peak Pricing
**Goal:** Allow venue owners to create offers/discounts that only apply to specific hours of the day.
- **Current State:** Offers can be created, but they apply broadly. 
- **What to edit:**
  1. Update the Owner Dashboard "Offers" creation form in `index.html` and `app.js` (`saveOffer()`) to accept "Valid Hours" (e.g., 10:00 AM - 1:00 PM).
  2. Modify `renderBookingStep2()` in `app.js` (the time slot selection step) to cross-reference the available time slots with active offers.
  3. Visually highlight discounted time slots in the booking calendar.
  4. Ensure `calculateTotal()` applies the correct discount if an off-peak slot is selected.

### Task 6: Venues Product Shop (E-Commerce)
**Goal:** Allow venues to sell physical products alongside services.
- **What to edit:**
  1. Update the Owner Dashboard to allow adding `products` (Name, Price, Image, Stock).
  2. In the Venue Profile UI (`openMerchantDetails`), add a new "Shop" tab next to "Services" and "Reviews".
  3. Implement a simple visual shopping cart for the customer to add products and checkout (saving the order to Firestore).

## Crucial Tips for the New Agent
- **Avoid complete rewrites:** `app.js` is quite large (~5,000 lines). Make targeted modifications using precise line replacements. 
- **DOM Structure:** Be careful modifying `index.html` IDs and classes, as `app.js` heavily relies on vanilla DOM selection (`document.getElementById`).
- **Styling:** Adhere strictly to the new CSS variables in `style.css` (`--primary` is dark charcoal, `--surface` is warm white, `--accent` is gold). Avoid adding new hardcoded colors.
- **Testing:** The app runs locally via `npx serve`. Use the `view_file` or `grep_search` tools to pinpoint where variables like `allOffers` or `bookingState` are used before modifying them.
