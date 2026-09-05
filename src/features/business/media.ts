const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SOURCE_SIZE = 12 * 1024 * 1024;

export type CompressedImage = {
  blob: Blob;
  extension: 'png' | 'jpg' | 'webp';
  previewUrl: string;
};

export async function compressImage(file: File, maxDimension: number): Promise<CompressedImage> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Gunakan gambar PNG, JPEG, atau WebP.');
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new Error('Ukuran gambar maksimal 12 MB sebelum kompresi.');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browser tidak mendukung kompresi gambar.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const mimeType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/jpeg' ? 0.86 : 0.9);
  return { blob, extension, previewUrl: URL.createObjectURL(blob) };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak dapat dibaca.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Gagal mengompres gambar.'));
    }, type, quality);
  });
}
