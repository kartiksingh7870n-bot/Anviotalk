<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7ba37f9a-04a1-44bd-9dd0-9dbcba2e3757

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Push Notifications Architecture

This application supports **Server-Side Push Notifications** running directly inside the Node server (`server.ts` / `dist/server.cjs`) via the Firebase Admin SDK.

### 1. Long-Lived Node Server Requirement
Unlike serverless Firebase Cloud Functions (which require the paid Firebase **Blaze** plan), this approach runs directly as part of your always-on Node process in `server.ts`.
- **Requirement:** Your host must support long-lived Node.js processes with active background listeners (e.g., Cloud Run, Render, Railway, Fly.io, or a VPS).
- **Free Spark Plan Compatible:** Works on the free Firebase Spark plan without requiring an upgrade to Blaze.

### 2. Service Account Key Configuration
To grant elevated Firestore listener and FCM messaging permissions to the Node server:
1. Go to **Firebase Console** → **Project Settings** → **Service Accounts**.
2. Click **"Generate new private key"** and download the JSON credentials file.
3. Set the service account credentials on your hosting environment using the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable:
   - **Single-line JSON:** Compact the JSON file into a single line and set `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`.
   - **Base64 String:** If your hosting platform restricts multi-line or special characters in environment variables, Base64 encode the JSON file string (`cat service-account.json | base64`) and set `FIREBASE_SERVICE_ACCOUNT_JSON` to the encoded output.

### 3. Deploying Firestore Security Rules
Even though the Firebase Admin SDK on the server bypasses security rules, client-side app reads/writes still rely on Firestore rules:
- Deploy updated security rules at any time using:
  ```bash
  firebase deploy --only firestore:rules
  ```
- Deployment of Firestore rules is fully supported on the free **Spark** plan.

## Firebase Cloud Functions (Alternative / Legacy)

An alternative Cloud Functions implementation is also maintained in the `functions/` folder. Note that deploying Cloud Functions requires upgrading your Firebase project to the **Blaze** plan.

