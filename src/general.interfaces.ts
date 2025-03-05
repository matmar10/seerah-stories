import { Axios } from 'axios';
import { Ora } from 'ora';

export interface ScriptConfig {
  outputDir: string;
  openaiApiKey: string;
  youtubeApiKey: string;
}

export interface ScriptArguments extends ScriptConfig {
  apiClient: Axios;
  spinner: Ora;
}

export interface ScriptIterationOptions {
  index: number;
  title: string;
}

