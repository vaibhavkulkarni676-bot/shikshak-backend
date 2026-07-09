// Calls whichever AI provider is configured. Supports Anthropic (Claude) and
// Google Gemini. If both keys are set, ANTHROPIC is used by default unless
// the request explicitly asks for "gemini".

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function callAnthropic(system, prompt, maxTokens){
  if(!ANTHROPIC_API_KEY){
    throw new Error('ANTHROPIC_API_KEY is not set on the server.');
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if(!response.ok){
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return (data.content || []).map(b => b.text || '').filter(Boolean).join('\n');
}

async function callGemini(system, prompt, maxTokens){
  if(!GEMINI_API_KEY){
    throw new Error('GEMINI_API_KEY is not set on the server.');
  }
  // Google's newer "AQ." auth keys must be sent as the x-goog-api-key header,
  // not as a ?key= URL query parameter (which only works with the older
  // AIzaSy... key format). Sending it as a header works for both formats.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });

  if(!response.ok){
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').filter(Boolean).join('\n');
}

/**
 * Generate text using the requested provider, falling back to whichever
 * provider actually has a key configured.
 * @param {'anthropic'|'gemini'} provider
 */
async function generateText({ provider, system, prompt, maxTokens = 1000 }){
  const wantsGemini = provider === 'gemini';
  const geminiAvailable = !!GEMINI_API_KEY;
  const anthropicAvailable = !!ANTHROPIC_API_KEY;

  if(wantsGemini && geminiAvailable){
    return { text: await callGemini(system, prompt, maxTokens), provider: 'gemini' };
  }
  if(!wantsGemini && anthropicAvailable){
    return { text: await callAnthropic(system, prompt, maxTokens), provider: 'anthropic' };
  }
  // Fall back to whichever is actually configured
  if(anthropicAvailable){
    return { text: await callAnthropic(system, prompt, maxTokens), provider: 'anthropic' };
  }
  if(geminiAvailable){
    return { text: await callGemini(system, prompt, maxTokens), provider: 'gemini' };
  }
  throw new Error('No AI provider is configured. Set ANTHROPIC_API_KEY and/or GEMINI_API_KEY in your .env file.');
}

module.exports = { generateText };
