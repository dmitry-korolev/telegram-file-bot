'use strict';

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
});
const EMOJI_GRAPHEME_PATTERN = /^(?:(?:\p{Regional_Indicator}{2})|\p{Extended_Pictographic})(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?)*$/u;

function extractMessageAuthor(caption) {
  if (typeof caption !== 'string') {
    return null;
  }

  const firstLine = caption.split(/\r?\n/, 1)[0].trim();

  if (!firstLine) {
    return null;
  }

  const contentAfterEmoji = stripLeadingEmoji(firstLine);

  if (!contentAfterEmoji) {
    return null;
  }

  const match = contentAfterEmoji.match(/^(.+?)\s+\(([^()\r\n]+)\)$/u);

  if (!match) {
    return null;
  }

  const author = match[1].trim();
  const level = match[2].trim();

  return author && level ? author : null;
}

function stripLeadingEmoji(value) {
  const segments = Array.from(graphemeSegmenter.segment(value), (entry) => entry.segment);
  let index = 0;
  let emojiCount = 0;

  while (index < segments.length) {
    if (isEmojiGrapheme(segments[index])) {
      emojiCount += 1;
      index += 1;
      continue;
    }

    if (emojiCount > 0 && isWhitespace(segments[index])) {
      let nextIndex = index;

      while (nextIndex < segments.length && isWhitespace(segments[nextIndex])) {
        nextIndex += 1;
      }

      if (nextIndex < segments.length && isEmojiGrapheme(segments[nextIndex])) {
        index = nextIndex;
        continue;
      }
    }

    break;
  }

  if (emojiCount === 0) {
    return null;
  }

  const remainder = segments.slice(index).join('');

  if (!/^\s+/u.test(remainder)) {
    return null;
  }

  return remainder.trim();
}

function isEmojiGrapheme(value) {
  return EMOJI_GRAPHEME_PATTERN.test(value);
}

function isWhitespace(value) {
  return /^\s+$/u.test(value);
}

module.exports = {
  extractMessageAuthor
};
