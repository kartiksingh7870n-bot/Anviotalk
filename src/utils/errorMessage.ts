/**
 * Sanitizes technical error messages, network errors, and Firebase exceptions 
 * into clean, user-friendly messages. Prevents raw stack traces, error codes, 
 * or internal file paths from leaking to end users.
 */
export function formatUserFriendlyErrorMessage(error: unknown, fallbackMessage?: string): string {
  const defaultFallback = fallbackMessage || "Network issue, please check your connection and try again.";
  
  if (!error) return defaultFallback;

  // Print full technical error details to console for developer debugging
  console.error("[App Error caught]:", error);

  const rawMessage = typeof error === 'string' 
    ? error 
    : (error as any)?.message || (error as any)?.toString() || '';

  if (!rawMessage) return defaultFallback;

  const lower = rawMessage.toLowerCase();

  // If it's a known non-technical user-facing validation rule or account restriction, keep it clean
  if (
    lower.includes("permanently banned") ||
    lower.includes("temporarily suspended") ||
    lower.includes("account has been") ||
    lower.includes("please enter your email") ||
    lower.includes("password must be at least") ||
    lower.includes("full name is required") ||
    lower.includes("username is required") ||
    lower.includes("date of birth is required") ||
    lower.includes("you must be 18 years") ||
    lower.includes("city, state, and country") ||
    lower.includes("minimum withdrawal threshold") ||
    lower.includes("complete and save your bank") ||
    lower.includes("withdrawal request is already pending")
  ) {
    return rawMessage;
  }

  // Auth specific user-friendly mappings
  if (lower.includes("auth/invalid-credential") || lower.includes("auth/wrong-password") || lower.includes("auth/user-not-found")) {
    return "Incorrect email or password. Please check your credentials and try again.";
  }
  if (lower.includes("auth/email-already-in-use")) {
    return "An account with this email address already exists. Please try logging in.";
  }
  if (lower.includes("auth/weak-password")) {
    return "Password is too weak. Please use at least 6 characters.";
  }
  if (lower.includes("auth/invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (lower.includes("auth/too-many-requests")) {
    return "Too many failed attempts. Please wait a moment and try again.";
  }
  if (lower.includes("auth/network-request-failed") || lower.includes("network-request-failed")) {
    return "Network issue, please check your connection and try again.";
  }
  if (lower.includes("auth/popup-closed-by-user") || lower.includes("popup_closed_by_user")) {
    return "Sign-in was cancelled. Please try again.";
  }

  // Firestore / Storage / Network / API errors
  if (lower.includes("permission-denied") || lower.includes("insufficient permissions")) {
    return "Access issue. Please check your account permissions or try signing in again.";
  }
  if (lower.includes("storage/unauthorized") || lower.includes("storage/quota-exceeded")) {
    return "Upload failed. Please check your network connection and try again.";
  }
  if (lower.includes("unavailable") || lower.includes("failed-precondition") || lower.includes("resource-exhausted")) {
    return "Service temporarily busy. Please check your connection and try again.";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("failed to fetch") ||
    lower.includes("offline") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused")
  ) {
    return "Network issue, please check your connection and try again.";
  }

  // If message contains technical codes, stack trace noise, JSON or technical keywords, hide them
  if (
    lower.includes("firebaseerror") ||
    lower.includes("typeerror") ||
    lower.includes("syntaxerror") ||
    lower.includes("rangeerror") ||
    lower.includes("uncaught") ||
    lower.includes("at ") ||
    lower.includes("http ") ||
    lower.includes("status code") ||
    rawMessage.includes("{") ||
    rawMessage.includes("}")
  ) {
    return defaultFallback;
  }

  // Truncate long messages if needed and return clean version
  if (rawMessage.length > 120) {
    return defaultFallback;
  }

  return rawMessage;
}
