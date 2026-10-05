/** Edit settings from the app Edit tab — applied before HD Status encode. */

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
};

export function isNoOpEditRecipe(
  recipe: EditRecipe | null | undefined,
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
