import { YoutubeTranscript } from 'youtube-transcript';
import { encoding_for_model as encodingForModel } from 'tiktoken';
import { ScriptArguments, ScriptIterationOptions } from './general.interfaces';
import { getExistingFile, FilePathConfig, saveContentToFile } from './file.utils';
import { delay } from './general.utils';

const MAX_LENGTH = 1000; // The manageable text size
const LOOKAHEAD = 200; // 100 preceding, 100 following

export async function fetchPlaylistVideos(playlistId: string, args: ScriptArguments) {
  const { apiClient, spinner, youtubeApiKey } = args;
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${playlistId}&key=${youtubeApiKey}`;
  spinner.start('Fetching playlist videos...');
  spinner.info(`URL: ${url}`);
  try {
    const response = await apiClient.get(url);
    const videos = response.data.items.map((item: any) => ({
      title: item.snippet.title,
      videoId: item.snippet.resourceId.videoId,
    }));
    spinner.succeed('Playlist videos fetched successfully.');
    return videos;
  } catch (error) {
    spinner.fail('Failed to fetch playlist videos.');
    throw error;
  }
}

export async function fetchVideoTranscript(videoId: string, args:  ScriptArguments & ScriptIterationOptions) {
  const { spinner, index, title } = args;
  spinner.start(`Fetching transcript for video ${videoId}...`);
  try {
    const existing = getExistingFile({
      index,
      title,
      outputDir: args.outputDir,
      extension: 'txt',
      subDir: 'transcripts/raw',
    });
    if (existing) {
      spinner.info(`Loaded transcript from file for video ${videoId}.`);
      return existing;
    }
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const transcriptText = transcript.map((line: any) => line.text).join(' ');
    spinner.succeed(`Transcript fetched for video ${videoId}.`);
    await saveContentToFile(transcriptText, {
      index,
      title,
      extension: 'txt',
      subDir: 'transcripts/raw',
      outputDir: args.outputDir,
    });
    spinner.info(`Transcript saved to file for video ${videoId}.`);
    return transcriptText;
  } catch (error) {
    spinner.fail(`Failed to fetch transcript for video ${videoId}.`);
    throw error;
  }
}


export async function getBestBoundary(text: string, args:  ScriptArguments): Promise<number> {
  const { apiClient, openaiApiKey } = args;
  const prompt = `Find the best natural sentence or paragraph boundary within the following text snippet:

"${text}"

Return only the character index where the best split should occur.`;

  const response = await apiClient.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [{ role: "system", content: prompt }],
      max_tokens: 10,
  }, {
      headers: { "Authorization": `Bearer ${openaiApiKey}` }
  });

  return parseInt(response.data.choices[0].message.content.trim(), 10);
}

async function fixPunctuation(text: string, args:  ScriptArguments): Promise<string> {
  const { apiClient, openaiApiKey } = args;
  const response = await apiClient.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [{
        role: 'system',
        content: 'You are an assistant that formats unstructured transcripts into well-punctuated, readable text. The source text is an English lecture about Islam which uses some Arabic words. IMPORTANT: Do not try to translate Arabic transliterated text.  IMPORTANT: keep as much of the same source text as possible and do not rephrase.',
      },
      {
        role: 'user',
        content: `Fix the punctuation in the following text while maintaining its meaning:\n\n${text}`,
      }],
      max_tokens: text.length + 50,
  }, {
      headers: { "Authorization": `Bearer ${openaiApiKey}` }
  });

  return response.data.choices[0].message.content.trim();
}

async function processTranscriptInBatches(transcript: string, args: ScriptIterationOptions & ScriptArguments & Omit<FilePathConfig, 'subDir'>): Promise<string> {
  const { spinner, outputDir, index, title } = args;
  let result: string[] = [];
  let position = 0;
  while (position < transcript.length) {
    spinner.start(`Processing transcript... ${Math.round(position / transcript.length * 100)}%`);
    let end = Math.min(position + MAX_LENGTH, transcript.length);
    if (end < transcript.length) {
      let boundaryText = transcript.slice(end - LOOKAHEAD / 2, end + LOOKAHEAD / 2);
      let boundaryIndex = await getBestBoundary(boundaryText, args);
      end = end - LOOKAHEAD / 2 + boundaryIndex;
    }

    let chunk = transcript.slice(position, end);
    let correctedText = await fixPunctuation(chunk, args);

    saveContentToFile(correctedText, {
      index,
      title,
      extension: 'md',
      subDir: 'transcripts/structured',
      outputDir,
    }, true);
    result.push(correctedText);
    position = end;
    await delay(2000, spinner);
  }
  return result.join('\n');
}

export async function structureTranscript(
  transcript: string,
  args: ScriptIterationOptions & ScriptArguments & Omit<FilePathConfig, 'subDir'>,
): Promise<string> {
  const { spinner, outputDir, index, title } = args;
  spinner.start('Structuring transcript into proper sentences...');

  const existing = getExistingFile({
    index,
    title,
    outputDir,
    extension: 'md',
    subDir: 'transcripts/structured',
  });

  if (existing) {
    spinner.info('Loaded structured transcript from file.');
    return existing;
  }

  try {
    spinner.start('Structuring transcript...');
    const structuredTranscript = await processTranscriptInBatches(transcript, {
      ...args,
      outputDir,
    });
    spinner.succeed('Structured transcript successfully.');

    return structuredTranscript;
  } catch (error) {
    spinner.fail('Failed to structure transcript.');
    throw error;
  }
}

function getLastNumberedListValue(markdown: string): number {
  const lines = markdown.split('\n').reverse();

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s/);
    if (match) {
      return parseInt(match[1], 10); // Extract and return the last found number
    }
  }

  return 0;
}

export async function summarizeTranscript(transcript: string, args: ScriptIterationOptions & ScriptArguments) {
  const { apiClient, spinner, index, title, openaiApiKey, outputDir } = args;
  spinner.start('Summarizing transcript...');
  const existing = getExistingFile({
    index,
    title,
    outputDir: args.outputDir,
    extension: 'md',
    subDir: 'summaries',
  });
  if (existing) {
    spinner.succeed('Loaded summary of transcript from file.');
    return existing;
  }

  const MAX_TOKENS = 4096; // Adjust based on model limits
  const encoder = encodingForModel('gpt-4-turbo');
  const words = transcript.split(' ');

  let currentChunk: string[] = [];
  let currentTokenCount = 0;
  let summary = '';

  async function getSummary(chunk: string, lastNumber: number, i: number) {
    spinner.start(`Summarizing transcript chunk #${i}.`);
    const response = await apiClient.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: 'You are a virtual assistant. Your job is to reformat the given text into an outline as numbered list format in markdown. Keep as much detail as possible. Use markdown format numbered list. Do not use headings, just use a numbered list. Continue the list based on the number provided. IMPORTANT: keep all the content, merely reword and reformat it into a bulleted list - DO NOT SUMMARIZE.' },
          { role: 'user', content: `Turn this section into a numbered outline using markdown (the previous number in the list was ${lastNumber}): \n\n${chunk}` },
        ],
      },
      {
        headers: { Authorization: `Bearer ${openaiApiKey}` },
      }
    );
    const content = response.data.choices[0].message.content;

    await saveContentToFile(content, {
      index,
      title,
      outputDir,
      extension: 'md',
      subDir: 'summaries',
    }, true);

    spinner.succeed(`Summarized transcript chunk #${i} OK.`);

    await delay(2000, spinner);

    return content + '\n\n';
  }

  try {
    let i = 0;
    let lastHeadingLevel = 0;
    for (const word of words) {
      const tokenCount = encoder.encode(word).length;

      if (currentTokenCount + tokenCount > MAX_TOKENS) {
        const section = await getSummary(currentChunk.join(' '), lastHeadingLevel, i);
        lastHeadingLevel = getLastNumberedListValue(section);
        summary += section;
        i++;
        currentChunk = [];
        currentTokenCount = 0;
      }

      currentChunk.push(word);
      currentTokenCount += tokenCount;
    }

    if (currentChunk.length > 0) {
      summary += await getSummary(currentChunk.join(' '), lastHeadingLevel, i + 1);
    }

    spinner.succeed('Summarized transcript successfully.');
    return summary.trim();
  } catch (error) {
    spinner.fail('Failed to summarize transcript.');
    throw error;
  }
}

async function summarizeStory(text: string, args: ScriptArguments): Promise<string> {
  const { apiClient, openaiApiKey } = args;
  const response = await apiClient.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: "Summarize the following text while preserving key details and style." },
        { role: 'user', content: text },
      ],
      temperature: 0.5,
      max_tokens: 500,
    },
    {
      headers: { Authorization: `Bearer ${openaiApiKey}` },
    }
  );

  return response.data.choices[0].message.content;
}

async function continueStory(
  content: string,
  summary: string,
  args: ScriptIterationOptions & ScriptArguments
): Promise<{ newText: string, summary: string }> {
  const { spinner, index, title, apiClient, outputDir, openaiApiKey } = args;
  try {
    const response = await apiClient.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: "You are a skilled children's storyteller that turns factual, non-fiction content and turns it into engaging, descriptive, and captivating stories for young chidlren. Write an engaging and detailed novel-like biography story. Write in the style similar to Jean Fritz and Brad Meltzer." },
          { role: 'user', content: `Here is summary from the previous part of the story:\n\n${summary}\n\nContinue the story in the same style using this new content:${content}` }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      {
        headers: { Authorization: `Bearer ${openaiApiKey}` },
      }
    );

    const newText = response.data.choices[0].message.content;

    await saveContentToFile(JSON.stringify({
      content,
      newText,
      summary,
    }, null, 2), {
      index,
      title,
      outputDir,
      extension: 'md',
      subDir: 'debug',
    });

    // Maintain a sliding window
    summary += "\n\n" + newText;

    // Summarize older content when reaching a limit
    if (summary.length > 4000) {
      summary = await summarizeStory(summary, args);
    }

    return {
      newText,
      summary
    };
  } catch (error) {
    spinner.fail(`Failed to continue story: ${error.message}`);
    throw error;
  }
}

export async function generateChildrenStory(summary: string, args: ScriptIterationOptions & ScriptArguments) {
  const { spinner, index, title, apiClient, outputDir, openaiApiKey } = args;
  spinner.start('Generating children’s story...');

  // const existing = getExistingFile({
  //   index,
  //   title,
  //   outputDir,
  //   extension: 'md',
  //   subDir: 'stories',
  // });
  // if (existing) {
  //   spinner.info('Loaded children’s story from file.');
  //   return existing;
  // }

  const MAX_TOKENS = 4096; // Adjust based on model limits
  const encoder = encodingForModel('gpt-4-turbo');
  const words = summary.split(' ');

  let currentChunk: string[] = [];
  let currentTokenCount = 0;

  try {
    let i = 0;
    let story = '';
    let summary = '';
    for (const word of words) {
      const tokenCount = encoder.encode(word).length;

      if (currentTokenCount + tokenCount > MAX_TOKENS) {
        spinner.start(`Writing story chunk #${i}...`);
        const {
          newText,
          summary: newSummary
        } = await continueStory(currentChunk.join(' '), summary, args);
        story += newText;
        await saveContentToFile(newText, {
          index,
          title,
          outputDir,
          extension: 'md',
          subDir: 'stories',
        });
        summary = newSummary;
        i++;
        spinner.info(`Wrote story chunk #${i} OK.`);
        await delay(2000, spinner);
        currentChunk = [];
        currentTokenCount = 0;
      }

      currentChunk.push(word);
      currentTokenCount += tokenCount;
    }

    if (currentChunk.length > 0) {
      spinner.start(`Writing chunk #${i + 1}...`);
      const { newText, summary: newSummary } = await continueStory(currentChunk.join(' '), '', args);
      story += newText;
      await saveContentToFile(newText, {
        index,
        title,
        outputDir,
        extension: 'md',
        subDir: 'stories',
      });
      spinner.info(`Wrote story chunk #${i + 1} OK.`);
      await delay(2000, spinner);
    }
    return story;
  } catch (error) {
    spinner.fail('Failed to generate children’s story.');
    throw error;
  }
}