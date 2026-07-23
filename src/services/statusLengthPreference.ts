import { appConfig, STATUS_LENGTH_OPTIONS, type StatusLengthSec } from '../core';

const STORAGE_KEY = 'embrace_hd_status_length_sec';

export function getPreferredStatusLength(): StatusLengthSec {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    if (STATUS_LENGTH_OPTIONS.includes(n as StatusLengthSec)) {
      return n as StatusLengthSec;
    }
  } catch {
    // ignore
  }
  return appConfig.defaults.statusLengthSec;
}

export function setPreferredStatusLength(length: StatusLengthSec): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(length));
  } catch {
    // ignore
  }
}
