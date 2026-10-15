const { httpError } = require('../lib/errors');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
function validateFoodInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Invalid meal request.');
  const { description = '', mealType = '', imageDataUrl, hasPhoto } = input;
  if (typeof description !== 'string' || description.length > 4000 || typeof mealType !== 'string' || mealType.length > 30) throw httpError(400, 'Invalid meal description or type.');
  if (hasPhoto !== undefined && typeof hasPhoto !== 'boolean') throw httpError(400, 'Invalid photo flag.');
  if (hasPhoto && !imageDataUrl) throw httpError(400, 'Select the photo again; its image data is missing.');
  if (!description.trim() && !imageDataUrl) throw httpError(400, 'Provide a food description or image.');
  if (imageDataUrl !== undefined) {
    if (typeof imageDataUrl !== 'string' || imageDataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) throw httpError(400, 'Choose a JPEG, PNG or WebP image up to 5 MB.');
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
    if (!match) throw httpError(400, 'Choose a JPEG, PNG or WebP image up to 5 MB.');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = bytes.length > 12 && bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === match[2] && (
      (match[1] === 'jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) ||
      (match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
      (match[1] === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'));
    if (!valid) throw httpError(400, 'The photo format is invalid. Select another photo.');
  }
  return { description, mealType, imageDataUrl, hasPhoto };
}
module.exports = { validateFoodInput };
