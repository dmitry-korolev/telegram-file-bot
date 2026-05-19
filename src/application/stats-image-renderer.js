'use strict';

const sharp = require('sharp');
const { buildStatsImageModel, buildStatsImageSvg } = require('../domain/stats-image');

function createStatsImageRenderer() {
  return {
    renderStatsImage
  };
}

async function renderStatsImage(data) {
  const model = buildStatsImageModel(data);
  const svg = buildStatsImageSvg(model);

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  createStatsImageRenderer,
  renderStatsImage
};
