import type { MediaItem, MediaProvider } from './types';
import type { SiteSettings } from './settings';

export interface UploadResult {
  url: string;
  file_name: string;
  provider_file_id: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime_type: string | null;
  provider: MediaProvider;
}

// fetch() exposes no upload progress, so uploads go through XMLHttpRequest.
const postForm = (url: string, form: FormData, onProgress: (percent: number) => void): Promise<any> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let payload: any = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        // Providers return HTML or plain text for some failures.
      }
      if (request.status >= 200 && request.status < 300 && payload) {
        resolve(payload);
        return;
      }
      const detail = payload?.error?.message || payload?.message || request.responseText?.trim().slice(0, 300);
      reject(new Error(detail
        ? `${detail} (HTTP ${request.status})`
        : `The upload service returned HTTP ${request.status} with no message.`));
    };
    request.onerror = () => reject(new Error('Network error during upload. Check the cloud name and your connection.'));
    request.send(form);
  });

export const uploadToCloudinary = async (
  file: File,
  settings: SiteSettings,
  onProgress: (percent: number) => void,
): Promise<UploadResult> => {
  if (!settings.cloudinary_cloud_name || !settings.cloudinary_upload_preset) {
    throw new Error('Set the Cloudinary cloud name and unsigned upload preset under Media → Upload settings first.');
  }
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', settings.cloudinary_upload_preset);

  const result = await postForm(
    `https://api.cloudinary.com/v1_1/${settings.cloudinary_cloud_name}/auto/upload`,
    form,
    onProgress,
  );

  return {
    url: result.secure_url,
    file_name: result.original_filename || file.name,
    provider_file_id: result.public_id ?? null,
    width: result.width ?? null,
    height: result.height ?? null,
    bytes: result.bytes ?? file.size,
    mime_type: result.format ? `${result.resource_type}/${result.format}` : file.type || null,
    provider: 'cloudinary',
  };
};

export const uploadToImageKit = async (
  file: File,
  settings: SiteSettings,
  onProgress: (percent: number) => void,
): Promise<UploadResult> => {
  if (!settings.imagekit_public_key) {
    throw new Error('Set the ImageKit public key under Media → Upload settings first.');
  }
  // The signature needs the private key, so it has to come from the server.
  const authResponse = await fetch('/api/imagekit-auth');
  if (!authResponse.ok) {
    const payload = await authResponse.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not get ImageKit upload credentials from the server.');
  }
  const { token, expire, signature } = await authResponse.json();

  const form = new FormData();
  form.append('file', file);
  form.append('fileName', file.name);
  form.append('publicKey', settings.imagekit_public_key);
  form.append('token', token);
  form.append('expire', String(expire));
  form.append('signature', signature);

  const result = await postForm('https://upload.imagekit.io/api/v1/files/upload', form, onProgress);

  return {
    url: result.url,
    file_name: result.name || file.name,
    provider_file_id: result.fileId ?? null,
    width: result.width ?? null,
    height: result.height ?? null,
    bytes: result.size ?? file.size,
    mime_type: result.fileType || file.type || null,
    provider: 'imagekit',
  };
};

export const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const describeDimensions = (item: MediaItem): string =>
  item.width && item.height ? `${item.width} × ${item.height}` : '—';
