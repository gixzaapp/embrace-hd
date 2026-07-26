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
    // Backend probes source and picks 720p/1080p (falls back to 720p).
    preset: 'auto' as const,
    statusLengthSec: OUTPUT_REQUIREMENTS.defaultStatusLengthSec,
    statusExport: {
      fitToStatusDuration: true,
      verticalCrop: true,
      preset: 'auto' as const,
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
