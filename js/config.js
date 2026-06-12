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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID"
};
