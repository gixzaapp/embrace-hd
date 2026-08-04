/** Edit settings — applied on backend Convert (native FFmpeg). */

export type EditCropInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type EditRecipe = {
  crop?: EditCropInsets;
  trim?: { startSec: number; endSec: number };
  soundMode: 'keep' | 'mute' | 'file';
  musicOffsetSec?: number;
  /** Local audio URI when soundMode === 'file' (uploaded separately; not always persisted long-term). */
  musicUri?: string;
  musicName?: string;
};

/** JSON-safe recipe for FormData / gateway (no local music URI). */
export type EditRecipeWire = {
  crop?: EditCropInsets;
  trim?: { startSec: number; endSec: number };
  soundMode: 'keep' | 'mute' | 'file';
  musicOffsetSec?: number;
};

export function toEditRecipeWire(recipe: EditRecipe): EditRecipeWire {
  return {
    crop: recipe.crop,
    trim: recipe.trim,
    soundMode: recipe.soundMode,
    musicOffsetSec: recipe.musicOffsetSec,
  };
}

export function hasMeaningfulEditRecipe(recipe: EditRecipe | null | undefined): boolean {
  if (!recipe) return false;
  if (recipe.soundMode === 'mute' || recipe.soundMode === 'file') return true;
  if (recipe.crop) {
    const { top, bottom, left, right } = recipe.crop;
    if (top > 0 || bottom > 0 || left > 0 || right > 0) return true;
  }
  if (recipe.trim) {
    const len = recipe.trim.endSec - recipe.trim.startSec;
    if (recipe.trim.startSec > 0.05 || len > 0) return true;
  }
  return false;
}

export function isNoOpEditRecipe(
  recipe: EditRecipe | EditRecipeWire | null | undefined,
  sourceDurationSec?: number
): boolean {
  if (!recipe) return true;
  if (recipe.soundMode !== 'keep') return false;
  if (recipe.crop) {
    const { top = 0, bottom = 0, left = 0, right = 0 } = recipe.crop;
    if (top > 0 || bottom > 0 || left > 0 || right > 0) return false;
  }
  if (recipe.trim) {
    const start = recipe.trim.startSec;
    const end = recipe.trim.endSec;
    if (start > 0.05) return false;
    if (sourceDurationSec != null && end < sourceDurationSec - 0.1) return false;
  }
  return true;
}
