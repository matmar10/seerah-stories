import axios, { Axios } from 'axios';
import dotenv from 'dotenv';
import ora from 'ora';
import { httpErrorInterceptor } from './src/http.utils';
import { fetchPlaylistVideos, structureTranscript, fetchVideoTranscript, summarizeTranscript, generateChildrenStory } from './src/api.utils';
import { ScriptArguments, ScriptConfig } from './src/general.interfaces';

dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID!;
const OUTPUT_DIR = './output';

const MAX_VIDEOS = 1;

async function init(options: ScriptConfig): Promise<ScriptArguments> {
  const apiClient: Axios = axios.create({});
  apiClient.interceptors.response.use(res => res, httpErrorInterceptor);
  const spinner = ora('Starting script...');

  const shutdown = (type: string) => {
    spinner.succeed(`Gracefully shutting down (${type})...`);
    spinner.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return Promise.resolve({
    ...options,
    apiClient,
    spinner,
  });
}

async function processPlaylist(args: ScriptArguments) {
  const { spinner } = args;

  const videos = await fetchPlaylistVideos(PLAYLIST_ID, args);

  // for (let i = 0; i < videos.length; i++) {
  for (let index = 0; index < MAX_VIDEOS && index < videos.length; index++) {
    const { title, videoId } = videos[index];
    try {
      spinner.start(`Processing video ${index + 1}: ${title}`);
      const common = {
        ...args,
        index,
        title,
      };
      const transcript = await fetchVideoTranscript(videoId, common);
      const structuredTranscript = await structureTranscript(transcript, common);
      const summary = await summarizeTranscript(structuredTranscript, common);
      const story = await generateChildrenStory(summary, common);
      spinner.succeed(`Video ${title} processed successfully.`);
    } catch (err) {
      spinner.fail(`Error processing video ${title}: ${err.message}`);
      return Promise.reject(err);
    }
  }

  spinner.stop();
}

init({
  outputDir: OUTPUT_DIR,
  openaiApiKey: OPENAI_API_KEY,
  youtubeApiKey: YOUTUBE_API_KEY,
})
  .then(async (args) => {
    const { spinner } = args;
    return processPlaylist(args)
      .then(() => {
        spinner.succeed('Script completed successfully.');
      })
      .catch((error) => {
        // detect if was axios error
        if (error.response) {
          spinner.fail(error);
          console.error(error.response.data);
        } else {
          spinner.fail(error);
        }
      })
  });