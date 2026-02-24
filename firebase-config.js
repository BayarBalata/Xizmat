// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  projectId: "docbook-ziqdad-1770046906",
  appId: "1:84479890988:web:3c75900202d85136cca389",
  storageBucket: "docbook-ziqdad-1770046906.firebasestorage.app",
  apiKey: "AIzaSyDCV-e3QJYZoPN9piI6yerAKeQKbrzdAp8",
  authDomain: "docbook-ziqdad-1770046906.firebaseapp.com",
  messagingSenderId: "84479890988"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };
