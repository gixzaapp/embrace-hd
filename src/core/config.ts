import { APP, HD_PRESETS } from './constants';
import {
  OUTPUT_REQUIREMENTS,
  PERFORMANCE_REQUIREMENTS,
  QUALITY_REQUIREMENTS,
  WHATSAPP_STATUS,
} from './requirements';

export const appConfig = {
  app: APP,
  defaults: {
    // Full HD Status encode (WhatsApp may still re-encode on post).
    preset: '1080p' as const,
    statusLengthSec: OUTPUT_REQUIREMENTS.defaultStatusLengthSec,
    statusExport: {
      fitToStatusDuration: true,
      verticalCrop: true,
      preset: '1080p' as const,
      statusLengthSec: OUTPUT_REQUIREMENTS.defaultStatusLengthSec,
    },
  },
  requirements: {
    output: OUTPUT_REQUIREMENTS,
    quality: QUALITY_REQUIREMENTS,
    performance: PERFORMANCE_REQUIREMENTS,
  },
  whatsapp: WHATSAPP_STATUS,
  presets: HD_PRESETS,
} as const;

export type AppConfig = typeof appConfig;
