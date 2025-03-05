import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import { ScriptIterationOptions } from './general.interfaces';

export interface FilePathConfig {
  outputDir: string;
  subDir: string;
}

export interface FileConfig {
  extension: string;
}

export interface ScriptFileOptions extends FilePathConfig, FileConfig, ScriptIterationOptions {}

export function formatPath(options: FilePathConfig): string {
  const { outputDir, subDir } = options
  return path.join(outputDir, subDir);
}

export function formatFullPath(options: ScriptFileOptions & FileConfig): string {
  const { index, title, extension, subDir, outputDir } = options;
  const fileName = formatFilename({ index, title, extension });
  const dir = formatPath({ outputDir, subDir });
  return path.join(dir, fileName);
}

export function formatFilename(options: ScriptIterationOptions & FileConfig): string {
  const { index, title, extension } = options;
  const formattedTitle = title.replace(/\s+/g, '_').toLowerCase();
  const sanitizedTitle = sanitize(formattedTitle);
  return `${index + 1}_${sanitizedTitle}.${extension}`;
}

export function getExistingFile(options: ScriptFileOptions): string | null {
  const { index, title, extension, subDir, outputDir } = options;
  const fullPath = formatFullPath({ index, title, extension, subDir, outputDir });
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf8');
  }
  return null;
}

export async function saveContentToFile(content: string, options: ScriptFileOptions, append = false): Promise<string> {
  const { index, title, extension, subDir, outputDir } = options;
  try {
    const dir = formatPath({ subDir, outputDir });
    // Ensure subdirectory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    const filePath = formatFullPath({ index, title, extension, subDir, outputDir });

    if (append) {
      fs.appendFileSync(filePath, content, 'utf8');
    } else {
      fs.writeFileSync(filePath, content, 'utf8');
    }

    return filePath;
  } catch (error) {
    throw error;
  }
}
