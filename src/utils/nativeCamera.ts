import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export async function takeNativePhoto(): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: true,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt // Prompt gives both "Take Photo" and "Choose from Gallery"
    });

    if (photo.webPath) {
      const response = await fetch(photo.webPath);
      const blob = await response.blob();
      const filename = `photo_${Date.now()}.${photo.format || 'jpg'}`;
      return new File([blob], filename, { type: blob.type || 'image/jpeg' });
    }
  } catch (err) {
    console.warn('Native camera capture dismissed or error:', err);
  }

  return null;
}
