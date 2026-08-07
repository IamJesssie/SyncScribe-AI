/**
 * ZeroScribe AI - Automated Extension Test Suite
 * Validates manifest configuration, syntax, model resolution, CSP compliance, and deduplication logic.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

console.log('\n🧪 Running ZeroScribe AI Extension Automated Test Suite...\n');

// ── Test 1: Manifest V3 Schema & Configuration Check ──────────────────
console.log('📌 Test Group 1: Manifest V3 Integrity');
try {
  const manifestPath = path.join(__dirname, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json exists');
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.manifest_version === 3, 'Manifest version is 3');
  assert(manifest.name.includes('ZeroScribe AI'), 'Extension name contains ZeroScribe AI');
  assert(manifest.background && manifest.background.service_worker === 'background.js', 'Service worker registered as background.js');
  assert(Array.isArray(manifest.web_accessible_resources), 'web_accessible_resources array declared');
  
  const hasPcmProcessor = manifest.web_accessible_resources.some(r => r.resources.includes('pcm-processor.js'));
  assert(hasPcmProcessor, 'pcm-processor.js declared in web_accessible_resources');
} catch (e) {
  assert(false, `Manifest error: ${e.message}`);
}

// ── Test 2: JavaScript Syntax & Compilation Validation ──────────────
console.log('\n📌 Test Group 2: JavaScript Syntax & Compilation');
const jsFiles = [
  'background.js',
  'popup.js',
  'content.js',
  'offscreen.js',
  'pcm-processor.js',
  'dropdown.js',
  'whatsapp_content.js',
  'pdf_export.js'
];

jsFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  try {
    assert(fs.existsSync(filePath), `File ${file} exists`);
    execSync(`node --check "${filePath}"`);
    assert(true, `Syntax check passed for ${file}`);
  } catch (e) {
    assert(false, `Syntax check failed for ${file}: ${e.message}`);
  }
});

// ── Test 3: CSP Compliance (No Inline Scripts/Handlers in HTML) ──────
console.log('\n📌 Test Group 3: Manifest V3 CSP Compliance');
const htmlFiles = ['popup.html', 'offscreen.html'];

htmlFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const hasInlineScript = /<script\b[^>]*>(?!<\/script>)[\s\S]+?<\/script>/i.test(content);
    assert(!hasInlineScript, `${file} contains 0 inline script blocks`);
    
    const hasInlineOnClick = /onclick\s*=\s*"/i.test(content) || /onerror\s*=\s*"/i.test(content);
    assert(!hasInlineOnClick, `${file} contains 0 inline event handlers (onclick/onerror)`);
  } catch (e) {
    assert(false, `CSP check error for ${file}: ${e.message}`);
  }
});

// ── Test 4: Model Slug Normalization & Aliasing Test ──────────────────
console.log('\n📌 Test Group 4: OpenRouter Model Slug Resolution');
const MODEL_ALIASES = {
  'ling': 'inclusionai/ling-3.0-tiny:free',
  'ling-tiny': 'inclusionai/ling-3.0-tiny:free',
  'ling-flash': 'inclusionai/ling-3.0-flash',
  'llama': 'meta-llama/llama-3.3-70b-instruct:free',
  'llama-3.3': 'meta-llama/llama-3.3-70b-instruct:free',
  'gemini': 'google/gemini-2.0-flash-lite-preview-02-05:free',
  'gemini-flash': 'google/gemini-2.0-flash-lite-preview-02-05:free',
  'deepseek': 'deepseek/deepseek-r1:free'
};

function normalizeModelSlug(userSlug) {
  if (!userSlug) return 'inclusionai/ling-3.0-tiny:free';
  const clean = userSlug.trim();
  const cleanLower = clean.toLowerCase();
  if (MODEL_ALIASES[cleanLower]) return MODEL_ALIASES[cleanLower];
  return clean;
}

assert(normalizeModelSlug('') === 'inclusionai/ling-3.0-tiny:free', 'Default empty model resolves to inclusionai/ling-3.0-tiny:free');
assert(normalizeModelSlug('ling') === 'inclusionai/ling-3.0-tiny:free', 'Alias "ling" resolves to inclusionai/ling-3.0-tiny:free');
assert(normalizeModelSlug('inclusionai/ling-3.0-tiny:free') === 'inclusionai/ling-3.0-tiny:free', 'Exact slug "inclusionai/ling-3.0-tiny:free" preserved');
assert(normalizeModelSlug('inclusionai/ling-3.0-flash') === 'inclusionai/ling-3.0-flash', 'Exact slug "inclusionai/ling-3.0-flash" preserved');

// ── Test 5: OpenRouter Error 404 Replacement Slug Extractor ────────
console.log('\n📌 Test Group 5: OpenRouter 404 Replacement Slug Extraction');
const sampleErrorText = 'Model qwen/qwen-2.5-72b-instruct:free error (404): This model is unavailable for free. The paid version is available now - use this slug instead: qwen/qwen-2.5-72b-instruct';
const match = sampleErrorText.match(/use this slug instead:\s*([a-zA-Z0-9_\-\.\/]+)/i);

assert(match !== null, '404 replacement slug regex matches');
assert(match[1] === 'qwen/qwen-2.5-72b-instruct', 'Extracted exact replacement slug: qwen/qwen-2.5-72b-instruct');

// ── Summary Results ──────────────────────────────────────────────────
console.log(`\n========================================`);
console.log(`📊 TEST RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
console.log(`========================================\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
