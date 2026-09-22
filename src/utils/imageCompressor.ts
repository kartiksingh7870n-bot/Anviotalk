export interface CompressedImageResult {
  blob: Blob;
  file: File;
  dataUrl: string;
  sizeBytes: number;
}

/**
 * Compress and resize an image file client-side using canvas.
 * - Max dimension: 1280px on the longest side
 * - Export format: JPEG
 * - Quality: 0.7
 */
export async function compressImage(
  file: File | Blob,
  maxDimension = 1280,
  quality = 0.7
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      if (!e.target?.result) {
        reject(new Error("Failed to read image file"));
        return;
      }
      img.src = e.target.result as string;
    };

    reader.onerror = (err) => reject(err);

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas 2D context"));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", quality);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob failed"));
            return;
          }

          const originalName = (file as File).name || "image.jpg";
          const fileName = originalName.replace(/\.[^/.]+$/, "") + ".jpg";

          const compressedFile = new File([blob], fileName, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });

          resolve({
            blob,
            file: compressedFile,
            dataUrl,
            sizeBytes: blob.size,
          });
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => reject(new Error("Failed to decode image"));

    reader.readAsDataURL(file);
  });
}
