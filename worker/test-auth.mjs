import { verifyTotp, generateTotpSecret, base32Decode, jwtSign, jwtVerify, createTemp2FaToken, verifyTemp2FaToken, sha256Hex } from "./auth";
import crypto from "node:crypto";

// Independent TOTP (RFC 6238) via node:crypto — the reference implementation
function refTotp(secretB32, counter) {
  const keyBytes = base32DecodeManual(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", Buffer.from(keyBytes)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

function base32DecodeManual(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of s.toUpperCase()) {
    const idx = A.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out;
}

let pass = 0, fail = 0;
function check(name, ok) {
  console.log(ok ? "PASS" : "FAIL", name);
  if (ok) pass++; else fail++;
}

// 1. TOTP round-trip: my secret gen -> ref code -> my verify
const { secret, otpauthUrl } = generateTotpSecret("admin@test.com");
check("secret is base32 of 16 chars", /^[A-Z2-7]{16}$/.test(secret));
check("otpauth url format", otpauthUrl.startsWith("otpauth://totp/AnvioTalk:admin%40test.com?secret=") && otpauthUrl.includes("issuer=AnvioTalk"));

const step = Math.floor(Date.now() / 1000 / 30);
const refCode = refTotp(secret, step);
check("TOTP current code verifies", await verifyTotp(secret, refCode));
check("TOTP previous-window code verifies (drift -1)", await verifyTotp(secret, refTotp(secret, step - 1)));
check("TOTP next-window code verifies (drift +1)", await verifyTotp(secret, refTotp(secret, step + 1)));
check("TOTP wrong code rejected", !(await verifyTotp(secret, refCode === "000000" ? "000001" : "000000")));
check("TOTP garbage rejected", !(await verifyTotp(secret, "abc123")));

// 2. JWT sign/verify + tamper + expiry
const env = { ADMIN_JWT_SECRET: "x".repeat(40) };
const token = await jwtSign({ uid: "u1", role: "SUPER_ADMIN" }, env.ADMIN_JWT_SECRET, 60);
const claims = await jwtVerify(token, env.ADMIN_JWT_SECRET);
check("jwt round-trip", !!claims && claims.uid === "u1" && claims.role === "SUPER_ADMIN");
const expired = await jwtSign({ uid: "u1" }, env.ADMIN_JWT_SECRET, -10);
check("jwt expired rejected", (await jwtVerify(expired, env.ADMIN_JWT_SECRET)) === null);
const parts = token.split(".");
const tampered = parts[0] + "." + Buffer.from(JSON.stringify({ uid: "hacker" })).toString("base64url") + "." + parts[2];
check("jwt tamper rejected", (await jwtVerify(tampered, env.ADMIN_JWT_SECRET)) === null);
check("jwt wrong secret rejected", (await jwtVerify(token, "y".repeat(40))) === null);

// 3. temp 2FA token
const temp = await createTemp2FaToken(env, "admin-uid-1");
const p = await verifyTemp2FaToken(env, temp);
check("temp token round-trip", !!p && p.uid === "admin-uid-1");
check("temp token garbage rejected", (await verifyTemp2FaToken(env, "garbage.token.here")) === null);

// 4. sha256
check("sha256 hex", (await sha256Hex("abc")) === crypto.createHash("sha256").update("abc").digest("hex"));
check("base32Decode round-trip", Buffer.from(base32Decode(secret)).toString("hex") === Buffer.from(base32DecodeManual(secret)).toString("hex"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
