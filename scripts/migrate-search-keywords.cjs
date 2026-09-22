/**
 * Standalone Admin Migration Script
 * 
 * Usage:
 *   node scripts/migrate-search-keywords.cjs [path-to-service-account.json]
 * 
 * Or with Environment Variable:
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"project_id":...}' node scripts/migrate-search-keywords.cjs
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function generateSearchKeywords(name = '', username = '', specialty = '', city = '', tags = []) {
  const safeTags = Array.isArray(tags) ? tags : [];
  const text = `${name || ''} ${username || ''} ${specialty || ''} ${city || ''} ${safeTags.join(' ')}`.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const keywordsSet = new Set();

  words.forEach((w) => {
    const maxLen = Math.min(w.length, 40);
    for (let i = 1; i <= maxLen; i++) {
      keywordsSet.add(w.slice(0, i));
    }
  });

  return Array.from(keywordsSet);
}

async function runMigration() {
  console.log('========================================================');
  console.log('🚀 Anvio Talk - User searchKeywords Admin Migration');
  console.log('========================================================\n');

  let serviceAccount = null;
  const argPath = process.argv[2];

  if (argPath && fs.existsSync(argPath)) {
    console.log(`📁 Loading service account from argument: ${argPath}`);
    serviceAccount = JSON.parse(fs.readFileSync(argPath, 'utf8'));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log('🔑 Loading service account from FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    if (raw.startsWith('{')) {
      serviceAccount = JSON.parse(raw);
    } else {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      } catch (e) {
        serviceAccount = JSON.parse(raw);
      }
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    console.log(`📁 Loading service account from GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    try {
      console.log('⚡ Attempting default application credentials...');
      admin.initializeApp();
    } catch (e) {
      console.error('\n❌ ERROR: No Firebase service account credentials found!');
      console.error('Please pass the path to your service-account.json file:');
      console.error('  node scripts/migrate-search-keywords.cjs ./service-account.json\n');
      process.exit(1);
    }
  }

  const db = admin.firestore();
  console.log('📡 Connected to Firestore. Fetching users collection...');

  const usersSnap = await db.collection('users').get();
  console.log(`👥 Found ${usersSnap.size} total user documents.\n`);

  if (usersSnap.empty) {
    console.log('✅ No user documents to migrate.');
    process.exit(0);
  }

  let batch = db.batch();
  let batchCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const name = data.displayName || data.fullName || data.name || '';
    const username = data.username || '';
    const specialty = data.specialty || data.occupation || '';
    const city = data.city || '';
    const tags = data.skillTags || data.interests || [];

    const newKeywords = generateSearchKeywords(name, username, specialty, city, tags);

    // Only update if keywords don't exist or have changed
    const existingKeywords = Array.isArray(data.searchKeywords) ? data.searchKeywords : [];
    const hasSameLength = existingKeywords.length === newKeywords.length;
    const isIdentical = hasSameLength && newKeywords.every(k => existingKeywords.includes(k));

    if (isIdentical) {
      skippedCount++;
      continue;
    }

    batch.update(doc.ref, {
      searchKeywords: newKeywords,
      searchKeywordsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    batchCount++;
    updatedCount++;

    // Firestore batch limit is 500 operations
    if (batchCount >= 400) {
      console.log(`💾 Committing batch of ${batchCount} user updates...`);
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    console.log(`💾 Committing final batch of ${batchCount} user updates...`);
    await batch.commit();
  }

  console.log('\n========================================================');
  console.log(`🎉 Migration Completed Successfully!`);
  console.log(`   - Updated users: ${updatedCount}`);
  console.log(`   - Already up-to-date: ${skippedCount}`);
  console.log(`   - Total processed: ${usersSnap.size}`);
  console.log('========================================================\n');
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('\n❌ Migration script failed with error:', err);
  process.exit(1);
});
