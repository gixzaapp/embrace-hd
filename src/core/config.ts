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
    // Clideo / WhatsApp Status: 720p survives Status better than 1080p/4K.
    preset: '720p' as const,
    statusLengthSec: OUTPUT_REQUIREMENTS.defaultStatusLengthSec,
    statusExport: {
      fitToStatusDuration: true,
      verticalCrop: true,
      preset: '720p' as const,
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
