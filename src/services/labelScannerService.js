// Label Scanner Service
// Handles AI-powered nutrition extraction from OCR text,
// portion scaling, and persistence of scanned labels.

const { getPrisma } = require('../lib/prisma');

/**
 * Scale nutrition values from labeled serving size to actual portion.
 * @param {object} labelNutrition - { calories, proteinG, carbsG, fatG, fiberG, sugarG }
 * @param {number} servingSizeG - labeled serving size in grams
 * @param {number} actualPortionG - user's actual portion in grams
 * @returns {object} adjusted nutrition values
 */
function adjustPortion(labelNutrition, servingSizeG, actualPortionG) {
  if (!servingSizeG || servingSizeG <= 0) {
    throw new Error('servingSizeG must be > 0');
  }
  if (!actualPortionG || actualPortionG <= 0) {
    throw new Error('actualPortionG must be > 0');
  }

  const ratio = actualPortionG / servingSizeG;

  return {
    adjCalories: Math.round(labelNutrition.calories * ratio),
    adjProteinG: Math.round(labelNutrition.proteinG * ratio * 10) / 10,
    adjCarbsG: Math.round(labelNutrition.carbsG * ratio * 10) / 10,
    adjFatG: Math.round(labelNutrition.fatG * ratio * 10) / 10,
    adjFiberG: Math.round((labelNutrition.fiberG || 0) * ratio * 10) / 10,
    adjSugarG: Math.round((labelNutrition.sugarG || 0) * ratio * 10) / 10,
  };
}

/**
 * Parse nutrition label text using OpenAI (or fallback to regex).
 * Expects raw OCR text from the label image.
 * @param {string} ocrText - Raw text from OCR
 * @returns {Promise<object>} extracted nutrition data
 */
async function extractNutritionFromText(ocrText) {
  if (!ocrText || !ocrText.trim()) {
    throw new Error('No OCR text provided');
  }

  // Try OpenAI extraction if available
  if (process.env.OPENAI_API_KEY) {
    try {
      return await extractWithOpenAI(ocrText);
    } catch (err) {
      console.error('OpenAI extraction failed, using regex fallback:', err.message);
    }
  }

  // Regex-based fallback extraction
  return extractWithRegex(ocrText);
}

/**
 * Extract nutrition using OpenAI GPT.
 */
async function extractWithOpenAI(ocrText) {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `Extract nutrition facts from this food label text. Return ONLY a valid JSON object with these fields:
{
  "productName": "string or null",
  "ingredients": "string or null (comma-separated list)",
  "servingSizeG": number (serving size in grams, estimate if given in cups/oz),
  "servingsPerContainer": number or null,
  "calories": number,
  "proteinG": number,
  "carbsG": number (total carbohydrates),
  "fatG": number (total fat),
  "fiberG": number,
  "sugarG": number,
  "sodiumMg": number,
  "confidence": number between 0 and 1
}

If a value cannot be determined, use 0. Here is the label text:

${ocrText}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty OpenAI response');

  const parsed = JSON.parse(content);
  return {
    productName: parsed.productName || null,
    ingredients: parsed.ingredients || null,
    servingSizeG: Number(parsed.servingSizeG) || 100,
    servingsPerContainer: parsed.servingsPerContainer ? Number(parsed.servingsPerContainer) : null,
    calories: Number(parsed.calories) || 0,
    proteinG: Number(parsed.proteinG) || 0,
    carbsG: Number(parsed.carbsG) || 0,
    fatG: Number(parsed.fatG) || 0,
    fiberG: Number(parsed.fiberG) || 0,
    sugarG: Number(parsed.sugarG) || 0,
    sodiumMg: Number(parsed.sodiumMg) || 0,
    confidence: Number(parsed.confidence) || 0.7,
  };
}

/**
 * Regex-based fallback for extracting nutrition from OCR text.
 */
function extractWithRegex(ocrText) {
  const text = ocrText.toLowerCase();

  function findNumber(patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return 0;
  }

  const calories = findNumber([
    /calories\s*[:=]?\s*(\d+)/,
    /(\d+)\s*cal/,
    /energy\s*[:=]?\s*(\d+)/,
  ]);

  const proteinG = findNumber([
    /protein\s*[:=]?\s*(\d+\.?\d*)\s*g/,
    /(\d+\.?\d*)\s*g\s*protein/,
  ]);

  const carbsG = findNumber([
    /total\s*carb(?:ohydrate)?s?\s*[:=]?\s*(\d+\.?\d*)\s*g/,
    /carb(?:ohydrate)?s?\s*[:=]?\s*(\d+\.?\d*)\s*g/,
  ]);

  const fatG = findNumber([
    /total\s*fat\s*[:=]?\s*(\d+\.?\d*)\s*g/,
    /fat\s*[:=]?\s*(\d+\.?\d*)\s*g/,
  ]);

  const fiberG = findNumber([
    /(?:dietary\s*)?fiber\s*[:=]?\s*(\d+\.?\d*)\s*g/,
  ]);

  const sugarG = findNumber([
    /(?:total\s*)?sugars?\s*[:=]?\s*(\d+\.?\d*)\s*g/,
  ]);

  const sodiumMg = findNumber([
    /sodium\s*[:=]?\s*(\d+)\s*mg/,
  ]);

  // Serving size: look for grams
  let servingSizeG = findNumber([
    /serving\s*size\s*[:=]?\s*(\d+\.?\d*)\s*g/,
    /(\d+\.?\d*)\s*g\s*per\s*serving/,
    /per\s*(\d+\.?\d*)\s*g/,
  ]);
  if (!servingSizeG) servingSizeG = 100; // default

  return {
    productName: null,
    ingredients: null,
    servingSizeG,
    servingsPerContainer: null,
    calories,
    proteinG,
    carbsG,
    fatG,
    fiberG,
    sugarG,
    sodiumMg,
    confidence: 0.4, // low confidence for regex
  };
}

/**
 * Save a scanned label and create an adjusted food log entry.
 * @param {string} userId
 * @param {object} data - extracted + adjusted data
 * @returns {Promise<object>} saved ScannedLabel record + FoodLog
 */
async function saveScannedLabel(userId, data) {
  const prisma = getPrisma();

  const {
    productName,
    ingredients,
    servingSizeG,
    servingsPerContainer,
    labelCalories,
    labelProteinG,
    labelCarbsG,
    labelFatG,
    labelFiberG,
    labelSugarG,
    labelSodiumMg,
    actualPortionG,
    mealType,
    photoUri,
    ocrRawText,
    aiConfidence,
  } = data;

  // Compute adjusted values
  const adjusted = adjustPortion(
    {
      calories: labelCalories,
      proteinG: labelProteinG,
      carbsG: labelCarbsG,
      fatG: labelFatG,
      fiberG: labelFiberG || 0,
      sugarG: labelSugarG || 0,
    },
    servingSizeG,
    actualPortionG,
  );

  // Create the FoodLog entry with adjusted values
  const foodLog = await prisma.foodLog.create({
    data: {
      userId,
      foodName: productName || 'Scanned food',
      quantityG: actualPortionG,
      calories: adjusted.adjCalories,
      proteinG: adjusted.adjProteinG,
      carbsG: adjusted.adjCarbsG,
      fatG: adjusted.adjFatG,
      fiberG: adjusted.adjFiberG,
      mealType: mealType || 'meal',
    },
  });

  // Save the scanned label with both raw and adjusted data
  const scannedLabel = await prisma.scannedLabel.create({
    data: {
      userId,
      productName,
      ingredients,
      servingSizeG,
      servingsPerContainer,
      labelCalories,
      labelProteinG,
      labelCarbsG,
      labelFatG,
      labelFiberG: labelFiberG || 0,
      labelSugarG: labelSugarG || 0,
      labelSodiumMg: labelSodiumMg || 0,
      actualPortionG,
      adjCalories: adjusted.adjCalories,
      adjProteinG: adjusted.adjProteinG,
      adjCarbsG: adjusted.adjCarbsG,
      adjFatG: adjusted.adjFatG,
      adjFiberG: adjusted.adjFiberG,
      adjSugarG: adjusted.adjSugarG,
      foodLogId: foodLog.id,
      photoUri,
      ocrRawText,
      aiConfidence,
      mealType,
    },
  });

  return { scannedLabel, foodLog, adjusted };
}

/**
 * Get a user's scanned label history.
 */
async function getUserLabels(userId, limit = 20) {
  const prisma = getPrisma();
  return prisma.scannedLabel.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

module.exports = {
  adjustPortion,
  extractNutritionFromText,
  extractWithRegex,
  saveScannedLabel,
  getUserLabels,
};
