/* ============================================================
   BACKEND CONFIG
   ------------------------------------------------------------
   To enable LIVE shared betting (everyone sees submissions
   instantly), paste your Firebase project config below.

   Setup (5 minutes, free):
     1. Go to https://console.firebase.google.com  ->  Add project
     2. Build  ->  Realtime Database  ->  Create database
        (start in "locked mode", then paste the rules from README)
     3. Project settings (gear icon)  ->  General  ->  "Your apps"
        ->  Web app (</>)  ->  register  ->  copy the firebaseConfig
     4. Replace the object below with your config and commit.

   Until a real databaseURL is filled in, the site runs in
   LOCAL mode: balances are saved in your browser and shared by
   downloading + committing data/betting.json.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBKwzKHxOGJqoliA92oPmHwNigCAZ4beGk",
  authDomain: "worldcupbets-family.firebaseapp.com",
  databaseURL:
    "https://worldcupbets-family-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "worldcupbets-family",
  storageBucket: "worldcupbets-family.firebasestorage.app",
  messagingSenderId: "199758537486",
  appId: "1:199758537486:web:08382a735fbbf47246ed5f"
};
