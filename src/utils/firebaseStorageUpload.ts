import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, collection, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, storage, db } from "../firebase";
import { compressImage } from "./imageCompressor";

export interface UploadProgressCallback {
  (progress: number): void;
}

/**
 * Prepares image file or dataUrl: compresses image to max 1280px JPG at 0.75 quality
 */
export async function prepareCompressedBlob(imageInput: File | Blob | string): Promise<Blob> {
  let blobInput: Blob | File;

  if (typeof imageInput === "string") {
    if (imageInput.startsWith("data:") || imageInput.startsWith("blob:") || imageInput.startsWith("http")) {
      const res = await fetch(imageInput);
      blobInput = await res.blob();
    } else {
      const res = await fetch(`data:image/jpeg;base64,${imageInput}`);
      blobInput = await res.blob();
    }
  } else {
    blobInput = imageInput;
  }

  try {
    const compressed = await compressImage(blobInput, 1280, 0.75);
    console.log(`[Firebase Upload] Compressed image from ${(blobInput.size / 1024).toFixed(1)}KB to ${(compressed.blob.size / 1024).toFixed(1)}KB`);
    return compressed.blob;
  } catch (err) {
    console.warn("[Firebase Upload] Compression skipped (using raw image):", err);
    return blobInput;
  }
}

/**
 * Ensures user is authenticated before upload
 */
export function verifyFirebaseAuth() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    console.warn("[Firebase Upload Warning] auth.currentUser is null. Proceeding with fallback base64 storage strategy.");
    return null;
  }
  return currentUser;
}

/**
 * Helper to convert Blob to Base64 data URL
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Uploads file to Firebase Storage with single automatic retry on failure,
 * 12s attempt timeout, progress callback, and returns getDownloadURL().
 * If Firebase Storage is disabled, times out, or fails, falls back to compressed Base64 URL.
 */
export async function uploadToStorageWithRetry(
  storagePath: string,
  imageInput: File | Blob | string,
  onProgress?: UploadProgressCallback,
  maxAttempts = 2
): Promise<string> {
  console.log(`[Firebase Upload] Starting upload to ${storagePath}...`);
  // 1. Verify Auth
  const currentUser = verifyFirebaseAuth();

  // 2. Prepare media
  // If it's a video, we skip the image compression step
  let mediaBlob: Blob | File;
  const isVideo = typeof imageInput !== 'string' && (imageInput as File).type?.startsWith('video/');

  if (isVideo) {
    mediaBlob = imageInput as File;
  } else {
    mediaBlob = await prepareCompressedBlob(imageInput);
  }

  console.log(`[Firebase Upload] Media prepared. Size: ${(mediaBlob.size / 1024).toFixed(1)} KB`);

  // If user is not authenticated with Firebase Auth, skip storage task and return base64
  if (!currentUser) {
    console.log("[Firebase Upload] Unauthenticated user upload: returning compressed Base64 data URL.");
    if (onProgress) onProgress(100);
    return isVideo ? "" : await blobToBase64(mediaBlob as Blob);
  }

  let attempt = 0;
  let lastError: any = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      console.log(`[Firebase Upload] Starting Storage upload attempt ${attempt}/${maxAttempts} for path: "${storagePath}"`);

      const fileRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(fileRef, mediaBlob, {
        contentType: isVideo ? (mediaBlob as File).type : "image/jpeg"
      });

      const downloadUrl = await new Promise<string>((resolve, reject) => {
        let isSettled = false;

        // 45-second timeout per attempt to prevent stuck progress
        const timeoutId = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            try {
              uploadTask.cancel();
            } catch (e) {}
            reject(new Error(`Storage upload task timed out after 45s on attempt ${attempt}`));
          }
        }, 45000);

        uploadTask.on(
          "state_changed",
          (snapshot) => {
            if (snapshot.totalBytes > 0) {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              console.log(`[Firebase Upload] Path: "${storagePath}" progress: ${progress}%`);
              if (onProgress) {
                onProgress(progress);
              }
            }
          },
          (error) => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeoutId);
              console.error(`[Firebase Upload Error] Storage task attempt ${attempt} error:`, error);
              reject(error);
            }
          },
          async () => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeoutId);
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                console.log(`[Firebase Upload Success] Successfully obtained download URL for "${storagePath}"`);
                resolve(url);
              } catch (urlErr) {
                console.error("[Firebase Upload Error] getDownloadURL failed:", urlErr);
                reject(urlErr);
              }
            }
          }
        );
      });

      return downloadUrl;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Firebase Upload Warning] Storage upload attempt ${attempt} failed for path "${storagePath}": ${err?.message || err}`);
      if (attempt >= maxAttempts) {
        break;
      }
      // Wait 800ms before retrying once
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  // Fallback to compressed Base64 Data URL if Firebase Storage fails or times out
  console.warn(`[Firebase Upload Notice] Storage bucket upload failed after ${maxAttempts} attempts (${lastError?.message || 'Storage unavailable'}). Falling back to direct compressed Base64 data URL.`);
  if (onProgress) {
    onProgress(100);
  }
  
  try {
    const base64Url = await blobToBase64(mediaBlob as Blob);
    return base64Url;
  } catch (fallbackErr) {
    console.error("[Firebase Upload Error] Base64 fallback failed:", fallbackErr);
    throw lastError || fallbackErr;
  }
}

export interface PublishStoryParams {
  imageSrc: File | Blob | string;
  mediaType?: "image" | "video";
  caption?: string;
  audience?: "everyone" | "followers";
  userProfile?: any;
  onProgress?: UploadProgressCallback;
}

/**
 * Upload Story to stories/{userId}/{storyId}/media and then save Firestore document
 */
export async function uploadStory({
  imageSrc,
  mediaType = "image",
  caption = "",
  audience = "everyone",
  userProfile,
  onProgress
}: PublishStoryParams): Promise<{ storyId: string; imageUrl: string }> {
  try {
    const currentUser = auth.currentUser;
    const userId = currentUser?.uid || userProfile?.uid || "anonymous_user";

    // 1. Prepare Story Firestore Document to get an ID first
    const storyDocRef = doc(collection(db, "stories"));
    const storyId = storyDocRef.id;

    console.log(`[Firebase Story] Initiating ${mediaType} upload for user: ${userId}, storyId: ${storyId}`);

    // 2. Upload to Storage at the new specific path
    const extension = mediaType === "video" ? "mp4" : "jpg";
    const storagePath = `stories/${userId}/${storyId}/media.${extension}`;
    const imageUrl = await uploadToStorageWithRetry(storagePath, imageSrc, onProgress);

    if (!imageUrl) {
      throw new Error("Failed to obtain media download URL.");
    }

    // 3. Generate and upload thumbnail if it's a video
    let thumbnailUrl = "";
    if (mediaType === "video") {
      try {
        const { generateThumbnail } = await import("./mediaProcessor");
        const thumbBase64 = await generateThumbnail(imageSrc);
        if (thumbBase64) {
          thumbnailUrl = await uploadToStorageWithRetry(`stories/${userId}/${storyId}/thumbnail.jpg`, thumbBase64);
        }
      } catch (thumbErr) {
        console.warn("[Firebase Story] Thumbnail generation failed:", thumbErr);
      }
    }

    console.log(`[Firebase Story] Media uploaded. Finalizing Firestore document...`);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const defaultUsername = currentUser?.email?.split("@")[0] || "user";
    const authorName =
      userProfile?.displayName ||
      userProfile?.fullName ||
      userProfile?.name ||
      (userProfile?.username ? `@${userProfile.username}` : defaultUsername);

    const storyData = {
      storyId: storyId,
      id: storyId, // Keeping both for compatibility
      userId: userId,
      authorUid: userId,
      imageUrl: imageUrl,
      mediaUrl: imageUrl,
      thumbnailUrl: thumbnailUrl,
      mediaType: mediaType,
      caption: caption,
      audience: audience,
      createdAt: serverTimestamp(),
      expiresAt: expiresAt,
      viewCount: 0,
      viewerIds: [],
      viewedBy: [],
      authorUsername: userProfile?.username || defaultUsername,
      authorName: authorName,
      authorAvatar: userProfile?.avatarUrl || userProfile?.portfolioPhotos?.[0] || "",
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0
    };

    // 4. Save to Firestore
    await setDoc(storyDocRef, storyData);
    console.log(`[Firebase Story Success] Story published successfully ID: ${storyId}`);

    return { storyId, imageUrl };
  } catch (err: any) {
    console.error("[Firebase Upload Error] uploadStory failed:", err);
    throw err;
  }
}

export interface SendChatImageParams {
  chatId: string;
  imageInput: File | Blob | string;
  text?: string;
  userProfile?: any;
  onProgress?: UploadProgressCallback;
}

/**
 * Upload Chat Image to chatImages/{chatId}/{timestamp}.jpg and then save message in Firestore
 */
export async function uploadChatImage({
  chatId,
  imageInput,
  text = "",
  userProfile,
  onProgress
}: SendChatImageParams): Promise<{ messageId: string; imageUrl: string }> {
  try {
    const currentUser = auth.currentUser;
    const senderId = currentUser?.uid || userProfile?.uid || "anonymous_sender";
    const timestamp = Date.now();
    const storagePath = `chatImages/${chatId}/${timestamp}.jpg`;

    console.log(`[Firebase Chat Image] Initiating chat image upload for chat: ${chatId}...`);

    // 1. Upload to Storage with retry, timeout, Base64 fallback and progress
    const imageUrl = await uploadToStorageWithRetry(storagePath, imageInput, onProgress);

    if (!imageUrl) {
      throw new Error("Failed to obtain image download URL or Base64 fallback.");
    }

    console.log(`[Firebase Chat Image] Image ready. Creating message document in Firestore...`);

    // 2. Prepare Chat Image Message
    const msgDocRef = doc(collection(db, "chats", chatId, "messages"));
    const messageId = msgDocRef.id;

    const senderName =
      userProfile?.displayName ||
      userProfile?.fullName ||
      userProfile?.username ||
      currentUser?.displayName ||
      "You";

    const messageData = {
      messageId: messageId,
      chatId: chatId,
      senderId: senderId,
      imageUrl: imageUrl,
      mediaUrl: imageUrl,
      type: "image",
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: "sent",
      senderName: senderName,
      senderAvatar: userProfile?.avatarUrl || "",
      text: text
    };

    // 3. Save message in Firestore
    try {
      await setDoc(msgDocRef, messageData);
      console.log(`[Firebase Chat Image Success] Message document created in Firestore with ID: ${messageId}`);
    } catch (msgErr: any) {
      console.error("[Firebase Chat Image Firestore Error] Failed to write message document:", msgErr);
      throw new Error(`Firestore message creation failed: ${msgErr.message || msgErr}`);
    }

    // 4. Update parent chat doc
    try {
      await updateDoc(doc(db, "chats", chatId), {
        lastMessageText: text ? `📷 ${text}` : "📸 Shared a photo",
        lastMessageSenderName: senderName,
        lastMessageSenderAvatar: userProfile?.avatarUrl || "",
        lastMessageAt: serverTimestamp()
      });
    } catch (parentErr) {
      console.warn("[Firebase Chat Image Notice] Could not update parent chat document:", parentErr);
    }

    return { messageId, imageUrl };
  } catch (err: any) {
    console.error("[Firebase Upload Error] uploadChatImage failed:", err);
    throw err;
  }
}

