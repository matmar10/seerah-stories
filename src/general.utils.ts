import { Ora } from 'ora';

export async function delay(ms: number, spinner: Ora) {
  spinner.start(`Pausing for ${ms / 1000} seconds...`);
  return new Promise<void>((resolve) => setTimeout(() => {
    resolve();
    spinner.stop();
  }, ms));
}