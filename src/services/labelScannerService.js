// Label Scanner Service
// Handles AI-powered nutrition extraction from OCR text,
// portion scaling, and persistence of scanned labels.

const { getPrisma } = require('../lib/prisma');
const invalid = message => Object.assign(new Error(message), { status: 400 });

/**
 * Scale nutrition values from labeled serving size to actual portion.
 * @param {object} labelNutrition - { calories, proteinG, carbsG, fatG, fiberG, sugarG }
 * @param {number} servingSizeG - labeled serving size in grams
 * @param {number} actualPortionG - user's actual portion in grams
 * @returns {object} adjusted nutrition values
 */
function adjustPortion(labelNutrition, servingSizeG, actualPortionG) {
  if (!Number.isFinite(servingSizeG) || servingSizeG <= 0 || servingSizeG > 10000) {
    throw invalid('servingSizeG must be > 0');
  }
  if (!Number.isFinite(actualPortionG) || actualPortionG <= 0 || actualPortionG > 10000) {
    throw invalid('actualPortionG must be > 0');
  }

  for (const field of ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG']) {
    const value = labelNutrition[field];
    if (value == null && ['fiberG', 'sugarG'].includes(field)) continue;
    if (!Number.isFinite(value) || value < 0 || value > 100000) throw invalid(`Invalid ${field}`);
  }
  const ratio = actualPortionG / servingSizeG;

  const round = (value, precision = 10) => {
    if (value == null) return null;
    const scaled = value * ratio;
    if (!Number.isFinite(scaled) || scaled > 100000) throw invalid('Adjusted nutrition is out of range');
    return Math.round((scaled + Number.EPSILON * Math.max(1, scaled)) * precision) / precision;
  };
  return {
    adjCalories: round(labelNutrition.calories, 1),
    adjProteinG: round(labelNutrition.proteinG),
    adjCarbsG: round(labelNutrition.carbsG),
    adjFatG: round(labelNutrition.fatG),
    adjFiberG: round(labelNutrition.fiberG),
    adjSugarG: round(labelNutrition.sugarG),
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
  "servingSizeG": number or null (explicit mass only; never infer grams from volume),
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

If a value cannot be determined, use null, never zero. Do not infer serving mass or fill missing nutrients. Copy one consistent nutrition column only. Here is the label text:

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
  const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    productName: parsed.productName || null,
    ingredients: parsed.ingredients || null,
    servingSizeG: known(parsed.servingSizeG),
    servingsPerContainer: parsed.servingsPerContainer ? Number(parsed.servingsPerContainer) : null,
    calories: known(parsed.calories),
    proteinG: known(parsed.proteinG),
    carbsG: known(parsed.carbsG),
    fatG: known(parsed.fatG),
    fiberG: known(parsed.fiberG),
    sugarG: known(parsed.sugarG),
    sodiumMg: known(parsed.sodiumMg),
    confidence: Number(parsed.confidence) || 0.7,
  };
}

/**
 * Regex-based fallback for extracting nutrition from OCR text.
 */
function extractWithRegex(ocrText) {
  // Remove the footnote sentence that contains "2,000 calories a day" to avoid
  // false matches.  Also normalize commas out of numbers (e.g. "2,000" → "2000").
  const cleaned = ocrText
    .replace(/2[,.]?000\s*calories\s*a\s*day[^.]*\.?/gi, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  const text = cleaned.toLowerCase();

  function findNumber(patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseFloat(match[1]);
    }
    return null;
  }

  // Calories – match "Calories 170" style, avoid "XX calories a day" leftovers
  const calories = findNumber([
    /calories\s*[:=]?\s*(\d+\.?\d*)/,
    /amount\s*per\s*serving\s*[:=]?\s*(\d+)/,
    /(\d+)\s*kcal/,
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

  // Serving size: support formats like "(87g)", "87 g", "Serving size 87g"
  let servingSizeG = findNumber([
    /serving\s*size\s*[:=]?\s*\(?\s*(\d+\.?\d*)\s*g\)?/,
    /\(\s*(\d+\.?\d*)\s*g\s*\)/,
    /(\d+\.?\d*)\s*g\s*per\s*serving/,
    /per\s*(\d+\.?\d*)\s*g/,
  ]);
  // Unknown serving mass must be reviewed, never defaulted to 100 g.

  return {
    productName: null,
    ingredients: ocrText.match(/ingredients\s*:\s*([^\n]+)/i)?.[1]?.trim() || null,
    servingSizeG,
    servingsPerContainer: findNumber([/(\d+\.?\d*)\s*servings?\s*per\s*container/, /servings?\s*per\s*container\s*[:=]?\s*(\d+\.?\d*)/]),
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
      fiberG: labelFiberG ?? null,
      sugarG: labelSugarG ?? null,
    },
    servingSizeG,
    actualPortionG,
  );

  const existing = await prisma.scannedLabel.findUnique({ where: { id: data.id } });
  const response = async (label) => {
    if (label.userId !== userId) { const error = new Error('Label id conflict'); error.status = 409; throw error; }
    const foodLog = label.foodLogId ? await prisma.foodLog.findUnique({ where: { id: label.foodLogId } }) : null;
    if (!foodLog) throw Object.assign(new Error('This meal was removed'), { status: 410 });
    return { scannedLabel: label, foodLog,
      adjusted: Object.fromEntries(['adjCalories','adjProteinG','adjCarbsG','adjFatG','adjFiberG','adjSugarG'].map(key => [key, label[key]])) };
  };
  if (existing) return response(existing);
  try { return await prisma.$transaction(async tx => {
    // Create the FoodLog entry with adjusted values
    const foodLog = await tx.foodLog.create({
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
    const scannedLabel = await tx.scannedLabel.create({
      data: {
        id: data.id,
        userId,
        productName,
        ingredients,
        servingSizeG,
        servingsPerContainer,
        labelCalories,
        labelProteinG,
        labelCarbsG,
        labelFatG,
        labelFiberG: labelFiberG ?? null,
        labelSugarG: labelSugarG ?? null,
        labelSodiumMg: labelSodiumMg ?? null,
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
  }); } catch (error) {
    if (error.code !== 'P2002') throw error;
    const saved = await prisma.scannedLabel.findUnique({ where: { id: data.id } });
    if (!saved) throw error;
    return response(saved);
  }
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
