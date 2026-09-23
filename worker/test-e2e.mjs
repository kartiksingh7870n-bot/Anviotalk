import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const WORKER = "http://127.0.0.1:8790";
const FIREBASE_API_KEY = "AIzaSyBR9e8eLDsyr5cHhwkcanRTbPqqjfGBBHU";
const TEST_EMAIL = "test-admin-smoke@anviotalk.com";
const TEST_PASS = "SmokeTest#2026x";

const sa = JSON.parse(readFileSync(new URL("../service-account.json", import.meta.url), "utf8"));
const j = async (res) => { const d = await res.json().catch(() => ({})); return { status: res.status, data: d }; };

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
  if (ok) pass++; else fail++;
}

// --- Firestore REST via service account (Node reference client) --------------
async function fsToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri, iat: now, exp: now + 3600
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key, "base64url");
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` })
  });
  const data = await res.json();
  return data.access_token;
}

async function fsReq(method, path, body) {
  const token = await fsToken();
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// value encoders
const vStr = (s) => ({ stringValue: s });
const vBool = (b) => ({ booleanValue: b });

// --- TOTP reference (Node crypto) --------------------------------------------
function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of s.toUpperCase()) {
    const idx = A.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secretB32, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

// =============================================================================
async function main() {
  // 0. cleanup any stale test admin
  const q = await fsReq("POST", "admin_users:runQuery", {
    structuredQuery: { from: [{ collectionId: "admin_users" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: vStr(TEST_EMAIL) } }, limit: 1 }
  });
  const staleDocs = Array.isArray(q.data) ? q.data : [];
  for (const doc of staleDocs) {
    if (doc.document) {
      const id = doc.document.name.split("/").pop();
      await fsReq("DELETE", `admin_users/${id}`);
      console.log("(cleaned stale test admin doc:", id + ")");
    }
  }

  // 1. create Firebase test user
  const signUp = await j(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, returnSecureToken: true })
  }));
  const testUid = signUp.data?.localId;
  check("firebase test user created", !!testUid, JSON.stringify(signUp.data).slice(0, 120));

  // 2. add admin_users doc (SUPPORT role to test RBAC)
  const add = await fsReq("POST", "admin_users", {
    fields: {
      email: vStr(TEST_EMAIL), role: vStr("SUPPORT"), isActive: vBool(true),
      totpSecret: vStr(""), totpEnabled: vBool(false), displayName: vStr("Smoke Test Admin")
    }
  });
  check("admin_users doc created", add.status === 200 || add.status === 201, JSON.stringify(add.data).slice(0, 150));

  // 3. login step 1
  const login = await j(await fetch(WORKER + "/api/admin/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS })
  }));
  check("login step1 success", login.status === 200 && login.data.success && login.data.totpEnabled === false, JSON.stringify(login.data).slice(0, 150));
  const tempToken = login.data.tempToken;

  // 4. 2FA setup (QR)
  const setup = await j(await fetch(WORKER + "/api/admin/auth/2fa/setup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempToken })
  }));
  check("2fa setup returns QR + secret", setup.status === 200 && setup.data.success && typeof setup.data.qrDataUrl === "string" && setup.data.qrDataUrl.startsWith("data:image/svg+xml;base64,"), JSON.stringify(setup.data).slice(0, 150));
  const secret = setup.data.secret;
  check("otpauth url present", typeof setup.data.otpauthUrl === "string" && setup.data.otpauthUrl.startsWith("otpauth://totp/"));

  // 5. 2FA verify with TOTP code
  const code = totp(secret);
  const verify = await j(await fetch(WORKER + "/api/admin/auth/2fa", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tempToken, code })
  }));
  check("2fa verify issues admin JWT", verify.status === 200 && verify.data.success && typeof verify.data.token === "string" && verify.data.role === "SUPPORT", JSON.stringify(verify.data).slice(0, 150));
  const adminToken = verify.data.token;

  // 6. /me
  const me = await j(await fetch(WORKER + "/api/admin/auth/me", { headers: { Authorization: "Bearer " + adminToken } }));
  check("me returns email+role", me.status === 200 && me.data.email === TEST_EMAIL && me.data.role === "SUPPORT", JSON.stringify(me.data).slice(0, 150));

  // 7. RBAC: SUPPORT cannot access payouts (no payouts.view) -> 403
  const payouts = await j(await fetch(WORKER + "/api/admin/payouts", { headers: { Authorization: "Bearer " + adminToken } }));
  check("RBAC: SUPPORT blocked from payouts (403)", payouts.status === 403, `got ${payouts.status}: ${JSON.stringify(payouts.data).slice(0, 120)}`);

  // 8. RBAC: SUPPORT CAN access analytics (analytics.view) — but overview/analytics scans users; may be slow. Use audit-logs (audit.view allowed)
  const audit = await j(await fetch(WORKER + "/api/admin/audit-logs?limit=5", { headers: { Authorization: "Bearer " + adminToken } }));
  check("RBAC: SUPPORT allowed audit-logs", audit.status === 200 && audit.data.success, `got ${audit.status}: ${JSON.stringify(audit.data).slice(0, 120)}`);

  // 9. no-permission route unmapped still denied
  const fabricate = await j(await fetch(WORKER + "/api/admin/users/x/fabricate", { method: "POST", headers: { Authorization: "Bearer " + adminToken } }));
  check("unmapped action denied", fabricate.status === 404 || fabricate.status === 403, `got ${fabricate.status}`);

  // 10. logout revokes session
  const logout = await j(await fetch(WORKER + "/api/admin/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + adminToken, "Content-Type": "application/json" }, body: "{}" }));
  check("logout success", logout.status === 200 && logout.data.success);
  const meAfter = await j(await fetch(WORKER + "/api/admin/auth/me", { headers: { Authorization: "Bearer " + adminToken } }));
  check("token invalid after logout (401)", meAfter.status === 401, `got ${meAfter.status}`);

  // 11. cleanup: delete test admin doc + firebase user
  const q2 = await fsReq("POST", "admin_users:runQuery", {
    structuredQuery: { from: [{ collectionId: "admin_users" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: vStr(TEST_EMAIL) } }, limit: 1 }
  });
  for (const doc of (Array.isArray(q2.data) ? q2.data : [])) {
    if (doc.document) {
      const id = doc.document.name.split("/").pop();
      await fsReq("DELETE", `admin_users/${id}`);
    }
  }
  // delete sessions of this test user (they carry adminUid)
  const sq = await fsReq("POST", "admin_sessions:runQuery", {
    structuredQuery: { from: [{ collectionId: "admin_sessions" }], where: { fieldFilter: { field: { fieldPath: "adminUid" }, op: "EQUAL", value: vStr(testUid) } }, limit: 20 }
  });
  for (const doc of (Array.isArray(sq.data) ? sq.data : [])) {
    if (doc.document) {
      const id = doc.document.name.split("/").pop();
      await fsReq("DELETE", `admin_sessions/${id}`);
    }
  }
  const del = await j(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: signUp.data.idToken })
  }));
  check("test user cleaned up", del.status === 200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("E2E crashed:", e); process.exit(1); });
