/**
 * Production AI Bill & Receipt Parsing Service
 * Leverages OpenRouter LLM (e.g. google/gemini-3.5-flash-lite) + Groq SDK + Tesseract OCR
 * Parses receipts, invoices, and bills into structured financial expense data.
 * Guarantees mathematical integrity so Subtotal and Grand Total are NEVER confused.
 */

const { Groq } = require('groq-sdk');
const Tesseract = require('tesseract.js');

// Initialize Groq client dynamically
function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Groq({ apiKey });
}

// Supported Categories
const VALID_CATEGORIES = [
  'FOOD',
  'ACCOMMODATION',
  'TRANSPORT',
  'ACTIVITY',
  'SHOPPING',
  'UTILITIES',
  'MISC'
];

/**
 * Perform OCR on image buffer using Tesseract.js
 */
async function extractTextFromBuffer(fileBuffer, mimeType) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return '';
  }

  try {
    const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng', {
      logger: () => {} // Suppress verbose logs
    });
    return text ? text.trim() : '';
  } catch (err) {
    console.error('[ReceiptService OCR Error]:', err.message);
    return '';
  }
}

/**
 * Currency Normalizer
 */
function normalizeCurrency(rawCurrency, rawText = '') {
  const curr = (rawCurrency || '').toUpperCase().trim();
  if (curr.includes('INR') || curr.includes('RS') || curr.includes('₹') || rawText.includes('₹') || /₹|Rs\.|INR/i.test(rawText)) {
    return 'INR';
  }
  if (curr.includes('EUR') || curr.includes('€') || rawText.includes('€')) {
    return 'EUR';
  }
  if (curr.includes('GBP') || curr.includes('£') || rawText.includes('£')) {
    return 'GBP';
  }
  if (curr.includes('USD') || curr.includes('$') || rawText.includes('$')) {
    return 'USD';
  }
  if (curr.includes('CAD')) return 'CAD';
  if (curr.includes('AUD')) return 'AUD';
  if (curr.includes('JPY') || curr.includes('¥')) return 'JPY';
  
  return 'INR'; // Default currency fallback
}

/**
 * Deterministic Financial Text Scanner
 * Uses strict word boundaries & negative lookbehinds so SUBTOTAL NEVER matches TOTAL.
 */
function extractFinancialAmountsFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { explicitGrandTotal: 0, explicitSubtotal: 0, explicitTax: 0, standaloneTotal: 0 };
  }

  // 1. Explicit Grand Total Markers
  let explicitGrandTotal = 0;
  const grandTotalPatterns = [
    /(?:grand\s*total|total\s*payable|net\s*payable|net\s*amount|amount\s*payable|amount\s*due|final\s*amount|final\s*total|bill\s*total|total\s*paid|paid\s*amount|balance\s*due)\s*[:=-]?\s*(?:rs\.?|inr|₹|\$|€|£)?\s*([\d,]+\.?\d{0,2})/i,
    /(?:total\s*amount)\s*[:=-]?\s*(?:rs\.?|inr|₹|\$|€|£)?\s*([\d,]+\.?\d{0,2})/i
  ];
  for (const pat of grandTotalPatterns) {
    const match = rawText.match(pat);
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        explicitGrandTotal = val;
        break;
      }
    }
  }

  // 2. Explicit Subtotal Markers
  let explicitSubtotal = 0;
  const subtotalPatterns = [
    /(?:sub\s*[-.]?\s*total|gross\s*(?:amount|total)|base\s*amount|items?\s*total|food\s*total|room\s*total|sum)\s*[:=-]?\s*(?:rs\.?|inr|₹|\$|€|£)?\s*([\d,]+\.?\d{0,2})/i
  ];
  for (const pat of subtotalPatterns) {
    const match = rawText.match(pat);
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        explicitSubtotal = val;
        break;
      }
    }
  }

  // 3. Explicit Taxes (CGST, SGST, IGST, GST, VAT, SALES TAX, SERVICE TAX)
  let explicitTax = 0;
  const taxMatches = rawText.matchAll(/(?:cgst|sgst|igst|gst|vat|sales\s*tax|service\s*tax|tax)\s*(?:\([^)]*\)|@\s*\d+%|\d+%)?\s*[:=-]?\s*(?:rs\.?|inr|₹|\$|€|£)?\s*([\d,]+\.?\d{0,2})/gi);
  for (const match of taxMatches) {
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        explicitTax += val;
      }
    }
  }
  explicitTax = Math.round(explicitTax * 100) / 100;

  // 4. Standalone Total (MUST NOT be preceded by sub / gross / items and NOT followed by items / count)
  let standaloneTotal = 0;
  const standaloneMatch = rawText.match(/(?<!sub[-\s]*|gross[-\s]*|items?[-\s]*)total(?!\s*items|\s*qty|\s*count)\s*[:=-]?\s*(?:rs\.?|inr|₹|\$|€|£)?\s*([\d,]+\.?\d{0,2})/i);
  if (standaloneMatch && standaloneMatch[1]) {
    const val = parseFloat(standaloneMatch[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0) {
      standaloneTotal = val;
    }
  }

  return { explicitGrandTotal, explicitSubtotal, explicitTax, standaloneTotal };
}

/**
 * Financial Integrity & Sanity Checker
 * Enforces strict distinction between Subtotal and Grand Total.
 */
function sanitizeAndValidateParsedData(data, rawText = '') {
  // Merchant
  let merchant = (data.merchant || '').trim();
  if (!merchant || merchant.toLowerCase() === 'null' || merchant.toLowerCase() === 'unknown') {
    merchant = 'Receipt Merchant';
  }

  // Category
  let category = (data.category || '').toUpperCase().trim();
  if (!VALID_CATEGORIES.includes(category)) {
    if (/hotel|resort|stay|inn|lodge|room|airbnb/i.test(merchant + ' ' + rawText)) {
      category = 'ACCOMMODATION';
    } else if (/taxi|cab|uber|flight|train|bus|fuel|petrol|diesel|fare/i.test(merchant + ' ' + rawText)) {
      category = 'TRANSPORT';
    } else if (/restaurant|cafe|bistro|dine|food|pizza|burger|bar|coffee|swiggy|zomato/i.test(merchant + ' ' + rawText)) {
      category = 'FOOD';
    } else if (/ticket|entry|tour|park|museum|event|cinema|movie|show/i.test(merchant + ' ' + rawText)) {
      category = 'ACTIVITY';
    } else if (/store|shop|mart|supermarket|amazon|flipkart|mall/i.test(merchant + ' ' + rawText)) {
      category = 'SHOPPING';
    } else {
      category = 'FOOD';
    }
  }

  // Date
  let date = data.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = new Date().toISOString().split('T')[0];
  }

  // Currency
  const currency = normalizeCurrency(data.currency, rawText);

  // Items
  let items = Array.isArray(data.items) ? data.items : [];
  items = items.map(item => {
    const name = (item.name || 'Item').trim();
    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
    const price = Math.max(0, Math.round((parseFloat(item.price) || 0) * 100) / 100);
    return { name, quantity, price };
  }).filter(item => item.price > 0 || item.name !== 'Item');

  const itemsSum = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  let subtotal = Math.max(0, Math.round((parseFloat(data.subtotal) || 0) * 100) / 100);
  let tax = Math.max(0, Math.round((parseFloat(data.tax) || 0) * 100) / 100);
  let tip = Math.max(0, Math.round((parseFloat(data.tip) || 0) * 100) / 100);
  let total = Math.max(0, Math.round((parseFloat(data.total) || 0) * 100) / 100);

  // Scan OCR raw text for ground-truth financial figures
  const extracted = extractFinancialAmountsFromText(rawText);

  // 1. If tax is 0 in AI output but explicit taxes exist in raw text, adopt it
  if (tax === 0 && extracted.explicitTax > 0) {
    tax = extracted.explicitTax;
  }

  // 2. If subtotal is 0, use explicit subtotal or items sum
  if (subtotal === 0) {
    if (extracted.explicitSubtotal > 0) {
      subtotal = extracted.explicitSubtotal;
    } else if (itemsSum > 0) {
      subtotal = itemsSum;
    }
  }

  // 3. CASE: INVERTED TOTAL & SUBTOTAL (total < subtotal)
  // When AI confused the two and put the higher amount as subtotal:
  if (total > 0 && subtotal > 0 && total < subtotal) {
    console.warn(`[ReceiptService]: Inverted total (${total}) < subtotal (${subtotal}) detected. Swapping.`);
    const temp = total;
    total = subtotal;
    subtotal = temp;
  }

  // 4. CASE: AI RETURNED SUBTOTAL AS TOTAL (total === subtotal while tax/tip exist)
  if (total > 0 && total === subtotal && (tax > 0 || tip > 0)) {
    console.warn(`[ReceiptService]: Total (${total}) matches subtotal despite taxes (${tax}). Calculating true grand total.`);
    total = Math.round((subtotal + tax + tip) * 100) / 100;
  }

  // 5. CASE: RAW TEXT CONTAINS AN EXPLICIT GRAND TOTAL HIGHER THAN EXTRACTED TOTAL
  // (e.g. raw text has "Subtotal: 1000" and "Grand Total: 1180", but AI returned total: 1000)
  if (extracted.explicitGrandTotal > 0 && extracted.explicitGrandTotal > total) {
    console.warn(`[ReceiptService]: Found explicit grand total ${extracted.explicitGrandTotal} > current total ${total}. Upgrading.`);
    if (subtotal === 0 || subtotal === total) {
      subtotal = total;
    }
    total = extracted.explicitGrandTotal;
  }

  // 6. CASE: STANDALONE TOTAL IN RAW TEXT IS HIGHER THAN TOTAL
  if (extracted.standaloneTotal > 0 && extracted.standaloneTotal > total && extracted.standaloneTotal !== subtotal) {
    if (extracted.explicitSubtotal > 0 && extracted.standaloneTotal >= extracted.explicitSubtotal) {
      total = extracted.standaloneTotal;
      if (subtotal === 0 || subtotal === total) {
        subtotal = extracted.explicitSubtotal;
      }
    }
  }

  // 7. Mathematical consistency check
  const calculatedGrandTotal = Math.round((subtotal + tax + tip) * 100) / 100;
  if (calculatedGrandTotal > total && (tax > 0 || tip > 0)) {
    total = calculatedGrandTotal;
  }

  // If total is greater than subtotal and tax is 0 and tip is 0, derive tax = total - subtotal
  if (total > subtotal && subtotal > 0 && tax === 0 && tip === 0) {
    tax = Math.round((total - subtotal) * 100) / 100;
  }

  // If subtotal is still 0, derive from total
  if (subtotal === 0 && total > 0) {
    subtotal = Math.max(0, Math.round((total - tax - tip) * 100) / 100);
  }

  // Confidence Score Calculation
  let confidence = parseInt(data.confidence, 10);
  if (isNaN(confidence) || confidence <= 0) {
    confidence = 50;
    if (merchant !== 'Receipt Merchant') confidence += 20;
    if (total > 0) confidence += 20;
    if (items.length > 0) confidence += 10;
  }
  confidence = Math.min(99, Math.max(50, confidence));

  return {
    merchant,
    category,
    date,
    currency,
    items,
    subtotal,
    tax,
    tip,
    total,
    confidence,
    aiParsed: true
  };
}

/**
 * Fallback Regex Parser when AI API is unavailable
 */
function localRegexParser(extractedText, fileName = '') {
  let merchant = 'Parsed Bill';
  const lines = extractedText.split('\n').map(l => l.trim()).filter(Boolean);
  
  if (lines.length > 0) {
    merchant = lines[0].substring(0, 40);
  } else if (fileName) {
    merchant = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  }

  const { explicitGrandTotal, explicitSubtotal, explicitTax, standaloneTotal } = extractFinancialAmountsFromText(extractedText);

  let total = explicitGrandTotal || standaloneTotal || 0;
  let subtotal = explicitSubtotal || 0;
  let tax = explicitTax || 0;

  if (total === 0 && subtotal > 0) {
    total = subtotal + tax;
  }

  return sanitizeAndValidateParsedData({
    merchant,
    category: 'FOOD',
    date: new Date().toISOString().split('T')[0],
    currency: normalizeCurrency('', extractedText),
    items: [],
    subtotal: subtotal || total,
    tax,
    tip: 0,
    total: Math.max(total, subtotal + tax),
    confidence: 65
  }, extractedText);
}

/**
 * Call OpenRouter API for Receipt Parsing (Supports multimodal vision when imageUrl is provided)
 */
async function callOpenRouterReceipt(prompt, imageUrl = null) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash-lite';
  const siteUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  try {
    console.log(`[ReceiptService]: Calling OpenRouter (${model}) with ${imageUrl ? 'Multimodal Vision' : 'Text'}...`);
    const userContent = imageUrl
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      : prompt;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': siteUrl,
        'X-Title': 'NexusTrip Receipt Parser',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are an expert AI financial receipt, invoice, and bill parser. Return strictly valid JSON.' },
          { role: 'user', content: userContent }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[ReceiptService]: OpenRouter responded with status ${response.status}: ${errText}`);
      return null;
    }

    const json = await response.json();
    return json?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn('[ReceiptService]: OpenRouter receipt error:', err.message);
    return null;
  }
}

/**
 * Call Groq API for Receipt Parsing (Fallback)
 */
async function callGroqReceipt(extractedText, prompt) {
  const groq = getGroqClient();
  if (!groq) return null;

  const modelsToTry = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

  for (const model of modelsToTry) {
    try {
      console.log(`[ReceiptService]: Calling Groq (${model}) for receipt parsing...`);
      const response = await groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are an expert AI financial receipt, invoice, and bill parser. Return strictly valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1000
      });

      if (response && response.choices && response.choices[0]?.message?.content) {
        return response.choices[0].message.content.trim();
      }
    } catch (err) {
      console.warn(`[ReceiptService]: Groq model ${model} failed: ${err.message}. Trying next...`);
    }
  }
  return null;
}

/**
 * Main AI Receipt Data Parsing Handler
 * @param {Buffer|null} fileBuffer - File buffer from Multer
 * @param {string} fileName - File name
 * @param {string} mimeType - File MIME type
 * @param {string} [rawTextInput] - Direct text input if available
 */
async function parseReceiptData(fileBuffer, fileName = 'receipt.jpg', mimeType = 'image/jpeg', rawTextInput = '') {
  let extractedText = rawTextInput || '';
  let imageUrl = null;

  if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
    const safeMime = (mimeType && mimeType.startsWith('image/')) ? mimeType : 'image/jpeg';
    imageUrl = `data:${safeMime};base64,${fileBuffer.toString('base64')}`;
  }

  const prompt = `
You are an expert AI financial receipt, invoice, and bill parser.
Analyze this receipt/invoice image or text and extract structured JSON output.

STRICT JSON OUTPUT FORMAT RULES:
Return ONLY a valid JSON object without markdown code blocks, backticks, or extra commentary.
The JSON object MUST conform to this exact structure:
{
  "merchant": "Merchant / Store / Vendor Name",
  "category": "FOOD | ACCOMMODATION | TRANSPORT | ACTIVITY | SHOPPING | UTILITIES | MISC",
  "date": "YYYY-MM-DD",
  "currency": "INR | USD | EUR | GBP | CAD | AUD | JPY",
  "items": [
    { "name": "Item Description", "quantity": 1, "price": 100.00 }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "confidence": 95
}

CRITICAL RULES FOR ACCURACY:
1. "items": Extract ALL items listed on the bill with their exact names, quantities, and individual total line prices.
2. "subtotal": The pre-tax sum of items (labeled "Subtotal", "Sub Total", "Food Total", "Gross Amount").
3. "tax": The sum of all taxes (GST, CGST, SGST, VAT, sales tax).
4. "tip": Include service charges, tips, other fees, or delivery charges.
5. "total": MUST BE THE FINAL GRAND TOTAL / NET AMOUNT PAYABLE after adding all taxes and fees (e.g., Grand Total, Total Payable, Net Amount, Balance Due).
6. FINANCIAL SANITY CHECK:
   - On almost all receipts: total = subtotal + tax + tip - discount.
   - If taxes or fees exist on the bill, "total" MUST be strictly GREATER than "subtotal".
   - If the receipt lists both "Subtotal: X" and "Grand Total: Y" (where Y > X), NEVER set "total" to X. "total" MUST be Y!

${extractedText ? `OPTIONAL EXTRACTED TEXT CONTEXT:\n${extractedText}` : ''}
`;

  // Step 1: Query OpenRouter with Vision if image is present
  let aiResponseContent = null;
  if (imageUrl || extractedText) {
    aiResponseContent = await callOpenRouterReceipt(prompt, imageUrl);
  }

  // Step 2: Fallback to OCR + Groq if OpenRouter failed
  if (!aiResponseContent) {
    if (!extractedText && fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
      console.log('[ReceiptService]: Running fallback Tesseract OCR...');
      extractedText = await extractTextFromBuffer(fileBuffer, mimeType);
    }
    if (!extractedText || extractedText.length < 10) {
      extractedText = `Receipt file: ${fileName || 'receipt.jpg'}. Extract details based on filename and standard receipt defaults.`;
    }

    aiResponseContent = await callGroqReceipt(extractedText, prompt);
  }

  // Step 3: Fallback to deterministic regex parser if both AI models failed
  if (!aiResponseContent) {
    console.warn('[ReceiptService]: All AI models failed. Using local regex parser fallback.');
    return localRegexParser(extractedText, fileName);
  }

  // Clean JSON response (strip markdown wrappers or extraneous text if present)
  let cleanJsonString = aiResponseContent.trim();
  if (cleanJsonString.startsWith('```json')) {
    cleanJsonString = cleanJsonString.replace(/^```json\s*/, '').replace(/```$/, '').trim();
  } else if (cleanJsonString.startsWith('```')) {
    cleanJsonString = cleanJsonString.replace(/^```\s*/, '').replace(/```$/, '').trim();
  }

  // Extract json object substring {...}
  const jsonMatch = cleanJsonString.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanJsonString = jsonMatch[0];
  }

  try {
    const rawParsed = JSON.parse(cleanJsonString);
    const result = sanitizeAndValidateParsedData(rawParsed, extractedText);
    result.source = imageUrl ? 'openrouter-vision' : 'openrouter-text';
    return result;
  } catch (parseErr) {
    console.error('[ReceiptService JSON Parse Error]:', parseErr.message, 'Raw response:', aiResponseContent);
    return localRegexParser(extractedText, fileName);
  }
}

module.exports = {
  parseReceiptData,
  sanitizeAndValidateParsedData,
  normalizeCurrency,
  extractFinancialAmountsFromText
};
