/**
 * Utility to process images and videos for Instagram-style Stories
 */

export interface ProcessedMedia {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Fits an image into a 9:16 Story canvas.
 * If the image is not 9:16, it adds a blurred or solid background.
 */
export async function fitToStoryAspect(
  imageSource: string | File | Blob,
  targetWidth = 1080,
  targetHeight = 1920
): Promise<ProcessedMedia> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      // 1. Draw Background (Blurred or Dark)
      ctx.fillStyle = "#1B1C1C";
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // 2. Calculate dimensions to fit (contain) or cover
      const imgAspect = img.width / img.height;
      const targetAspect = targetWidth / targetHeight;

      let drawWidth, drawHeight, offsetX, offsetY;

      if (imgAspect > targetAspect) {
        // Image is wider than 9:16 (Landscape)
        drawWidth = targetWidth;
        drawHeight = targetWidth / imgAspect;
        offsetX = 0;
        offsetY = (targetHeight - drawHeight) / 2;

        // Optional: Draw a blurred background if it's landscape
        ctx.save();
        ctx.filter = 'blur(30px) brightness(0.5)';
        ctx.drawImage(img, -50, -50, targetWidth + 100, targetHeight + 100);
        ctx.restore();
      } else {
        // Image is taller than 9:16 or matches
        drawHeight = targetHeight;
        drawWidth = targetHeight * imgAspect;
        offsetY = 0;
        offsetX = (targetWidth - drawWidth) / 2;
      }

      // 3. Draw main image
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve({
              blob,
              dataUrl: canvas.toDataURL("image/jpeg", 0.85),
              width: targetWidth,
              height: targetHeight,
            });
          } else {
            reject(new Error("Canvas toBlob failed"));
          }
        },
        "image/jpeg",
        0.85
      );
    };

    img.onerror = (err) => reject(err);

    if (typeof imageSource === "string") {
      img.src = imageSource;
    } else {
      img.src = URL.createObjectURL(imageSource);
    }
  });
}

/**
 * Generates a small thumbnail from an image or video frame
 */
export async function generateThumbnail(
  source: string | File | Blob,
  size = 240
): Promise<string> {
  if (typeof source !== 'string' && (source as File).type?.startsWith('video')) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.autoplay = false;
      video.muted = true;
      video.src = URL.createObjectURL(source as File);

      video.onloadeddata = () => {
        video.currentTime = 1; // Seek to 1 second
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = (size * 16) / 9;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } else {
          resolve("");
        }
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => resolve("");
    });
  }

  const processed = await fitToStoryAspect(source, size, (size * 16) / 9);
  return processed.dataUrl;
}

/**
 * Validates if a file is a supported image or video and checks duration
 */
export async function validateMedia(file: File): Promise<{ valid: boolean; error?: string }> {
  const maxSize = 25 * 1024 * 1024; // 25MB
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedVideoTypes = ["video/mp4", "video/quicktime", "video/webm"];

  if (file.size > maxSize) {
    return { valid: false, error: "File size exceeds 25MB limit" };
  }

  const isVideo = allowedVideoTypes.includes(file.type);
  const isImage = allowedImageTypes.includes(file.type);

  if (!isImage && !isVideo) {
    return { valid: false, error: "Unsupported file type" };
  }

  if (isVideo) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        if (video.duration > 60) {
          resolve({ valid: false, error: "Video duration exceeds 60s limit" });
        } else {
          resolve({ valid: true });
        }
      };
      video.onerror = () => resolve({ valid: false, error: "Invalid video file" });
      video.src = URL.createObjectURL(file);
    });
  }

  return { valid: true };
}
